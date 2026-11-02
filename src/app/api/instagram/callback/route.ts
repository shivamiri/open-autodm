/**
 * GET /api/instagram/callback - Instagram redirects here after consent.
 *
 * Flow (identity comes exclusively from the signed state JWT - CSRF-safe):
 *   verify state → code → Unified Login system-user token
 *   → discover shared IG account → AES-256-GCM encrypt token
 *   → upsert instagram_accounts → subscribe to webhook fields → /settings
 */

import { getMetaSettings } from '@/lib/settings';
import { createServiceClient } from '@/lib/supabase/service';
import {
  verifyOAuthState,
  exchangeCodeForToken,
  getAssignedInstagramAccounts,
  getClientBusinessId,
} from '@/lib/instagram/oauth';
import { subscribeToWebhookFields } from '@/lib/instagram/api';
import { encrypt } from '@/lib/crypto';
import { getAppUrl, getEnv } from '@/lib/env';
import { createLogger } from '@/lib/logger';
import { debugLog } from '@/lib/debugLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const logger = createLogger('oauth-callback');

export async function GET(request: Request): Promise<Response> {
  const appUrl = getAppUrl(request);
  const settingsRedirect = (params: string): Response =>
    Response.redirect(`${appUrl}/settings?${params}`, 302);

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const stateToken = url.searchParams.get('state');
  const igError = url.searchParams.get('error');

  if (igError) {
    logger.warn({ igError }, 'User denied Instagram authorization');
    return settingsRedirect('instagram_error=access_denied');
  }
  if (!code || !stateToken) {
    return settingsRedirect('instagram_error=invalid_callback');
  }

  let userId: string;
  try {
    ({ userId } = await verifyOAuthState(stateToken));
  } catch {
    logger.warn({}, 'OAuth state JWT verification failed');
    return settingsRedirect('instagram_error=state_mismatch');
  }

  const settings = await getMetaSettings();
  if (!settings) {
    return settingsRedirect('instagram_error=setup_required');
  }

  try {
    const redirectUri = `${appUrl}/api/instagram/callback`;

    debugLog('oauth', 'info', 'oauth_exchange', 'processing', 'Exchanging authorization code for token', { userId });
    // Unified Login: the exchanged token is a Business Integration System
    // User Access Token. /me is the system user, NOT the Instagram account -
    // discover the shared IG accounts via /me/assigned_instagram_accounts.
    const token = await exchangeCodeForToken(code, settings.metaAppId, settings.metaAppSecret, redirectUri);
    const accounts = await getAssignedInstagramAccounts(token.access_token);
    // Connecting the wrong account is hard to spot later, so an ambiguous
    // result stops the flow: the user reconnects sharing exactly one account.
    if (accounts.length > 1) {
      const names = accounts.map((a) => `@${a.username ?? a.id}`).join(', ');
      throw new Error(
        `More than one Instagram account was shared during login (${names}). ` +
          'Reconnect and share ONLY the single account you want to automate.'
      );
    }
    const account = accounts.at(0);
    if (!account) {
      throw new Error('No Instagram account was shared during login - reconnect and select your Instagram account.');
    }

    const env = getEnv();
    const db = createServiceClient();
    const encryptedToken = encrypt(token.access_token, env.TOKEN_ENCRYPTION_KEY);
    // Meta omits expires_in for never-expiring configurations. Store NULL
    // ("unknown") rather than inventing an expiry date.
    const expiresAt = typeof token.expires_in === 'number' ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null;

    // Guarantee the FK target exists. Users created in the Supabase dashboard
    // BEFORE the migrations were applied have no profiles row (the auto-create
    // trigger didn't exist yet) - backfill it here so the account insert can
    // never hit a foreign-key violation.
    await db.from('profiles').upsert({ id: userId }, { onConflict: 'id', ignoreDuplicates: true });

    // Ownership check BEFORE writing: instagram_user_id is globally unique,
    // and an upsert would silently reassign the row (and overwrite the token)
    // if another local user already connected this IG account.
    const { data: existing } = await db
      .from('instagram_accounts')
      .select('id, user_id')
      .eq('instagram_user_id', account.id)
      .maybeSingle();

    if (existing && existing.user_id !== userId) {
      return settingsRedirect('instagram_error=account_already_connected');
    }

    const tokenFields = {
      username: account.username ?? 'unknown',
      name: null,
      profile_picture_url: null,
      access_token_encrypted: encryptedToken,
      token_expires_at: expiresAt,
      is_active: true,
      paused_until: null,
      pause_reason: null,
    };

    const { error } = existing
      ? await db.from('instagram_accounts').update(tokenFields).eq('id', existing.id)
      : await db.from('instagram_accounts').insert({ user_id: userId, instagram_user_id: account.id, ...tokenFields });

    if (error) {
      if (error.code === '23505') {
        return settingsRedirect('instagram_error=account_already_connected');
      }
      throw error;
    }

    // Client business ID (which portfolio owns the shared assets) - logged
    // for future token-management use; not stored yet.
    getClientBusinessId(token.access_token).then((id) =>
      debugLog('oauth', 'info', 'client_business', 'ok', `Client business ID: ${id ?? 'unavailable'}`, { userId })
    );

    // Per-account webhook subscription - without this NO events are delivered.
    // It reports failure instead of throwing, so surface it visibly rather
    // than redirecting to a false "connected" success.
    const sub = await subscribeToWebhookFields(account.id, token.access_token);
    if (!sub.ok) {
      debugLog('oauth', 'error', 'webhook_subscribe', 'error',
        `Webhook subscription failed for @${account.username ?? account.id}: ${sub.body.slice(0, 200)}`, { userId });
      return settingsRedirect(
        `instagram_error=webhook_subscription_failed&debug=${encodeURIComponent(
          'Account connected, but Meta rejected the webhook subscription. Check Setup Wizard Step 3 (Webhooks), then reconnect.'
        )}`
      );
    }

    debugLog('oauth', 'info', 'oauth_complete', 'ok', `Instagram @${account.username ?? account.id} connected`, { userId });
    logger.info({ userId, username: account.username }, 'Instagram account connected');
    return settingsRedirect('instagram_connected=true');
  } catch (err) {
    const message = describeError(err);
    logger.error({ err, userId }, 'Instagram OAuth callback failed');
    debugLog('oauth', 'error', 'oauth_failed', 'error', `OAuth exchange failed: ${message.slice(0, 300)}`, { userId });
    return settingsRedirect(`instagram_error=server_error&debug=${encodeURIComponent(message.slice(0, 200))}`);
  }
}

/**
 * Human-readable message from anything thrown - including Supabase/Postgrest
 * error objects, which are not Error instances and stringify to
 * "[object Object]" otherwise.
 */
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const e = err as { message?: string; details?: string; hint?: string; code?: string };
    const parts = [e.message, e.details, e.code ? `(code ${e.code})` : null].filter(Boolean);
    if (parts.length) return parts.join(' - ');
    try {
      return JSON.stringify(err).slice(0, 300);
    } catch {
      /* fall through */
    }
  }
  return String(err);
}
