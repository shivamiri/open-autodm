/**
 * Instagram OAuth helpers - Instagram API with Unified Login
 * (Facebook Login for Business).
 *
 * New Meta apps can no longer use Instagram Business Login (Meta, Oct 2026):
 * there is no Instagram app ID/secret for them and instagram.com/oauth/authorize
 * rejects them with "Invalid platform app". Unified Login instead:
 *
 *  - Authorize at www.facebook.com/dialog/oauth with the META app ID and a
 *    Facebook Login for Business configuration ID (config_id). No scope list -
 *    the configuration carries the permissions.
 *  - Exchange the code at graph.facebook.com/<version>/oauth/access_token with
 *    the META app ID + META app secret. The result is a Business Integration
 *    System User Access Token (SUAT) belonging to the client's business
 *    portfolio - it survives the connecting person leaving the business.
 *  - With a SUAT, /me is the system user, NOT the Instagram account. Account
 *    discovery: GET /me/assigned_instagram_accounts.
 *  - Token expiry is chosen in the Meta configuration; when Meta returns no
 *    expires_in, the expiry is UNKNOWN and stored as NULL - never invented.
 *  - SUATs are not refreshable through the old ig_refresh_token endpoint, so
 *    refreshLongLivedToken reports 'invalid' and both consumers (cron
 *    auto-refresh + the manual refresh API) surface "reconnect needed"
 *    instead of silently retrying.
 *
 * Legacy Instagram Login helpers (exchangeForLongLivedToken,
 * getInstagramProfile) are kept only so older call sites keep compiling
 * during the migration; they are dead code for Unified Login apps.
 */

import { SignJWT, jwtVerify } from 'jose';
import { getEnv } from '@/lib/env';
import { randomToken } from '@/lib/crypto';
import type { IgLongLivedTokenResponse, IgUserProfile } from '@/lib/types';

const META_API_VERSION = 'v26.0';
const FB_OAUTH_URL = 'https://www.facebook.com/dialog/oauth';
const FB_GRAPH_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

// Legacy Instagram Login endpoints - used only by the legacy helpers below.
const IG_LONG_LIVED_URL = 'https://graph.instagram.com/access_token';
const IG_GRAPH_BASE = 'https://graph.instagram.com';

/**
 * Permissions live in the Meta configuration (config_id) now, not in a scope
 * list. Kept as documentation of what the configuration must contain.
 */
export const REQUIRED_SCOPES = [
  'instagram_basic',
  'instagram_manage_messages',
  'instagram_manage_comments',
].join(',');

// ── CSRF state JWT ──────────────────────────────────────────────────────────

function stateSecret(): Uint8Array {
  // HMAC key derived from the deployment's encryption key - one less env var
  // for self-hosters, and the state JWT is short-lived (10 minutes) anyway.
  return new TextEncoder().encode(`state:${getEnv().TOKEN_ENCRYPTION_KEY}`);
}

export async function signOAuthState(userId: string): Promise<string> {
  return new SignJWT({ userId, nonce: randomToken(8) })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(stateSecret());
}

export async function verifyOAuthState(token: string): Promise<{ userId: string }> {
  const { payload } = await jwtVerify(token, stateSecret());
  if (typeof payload['userId'] !== 'string') throw new Error('Invalid state payload');
  return { userId: payload['userId'] as string };
}

// ── OAuth URL + token exchange (Unified Login) ──────────────────────────────

export function buildOAuthUrl(appId: string, redirectUri: string, state: string, configId?: string): string {
  if (!configId) {
    throw new Error('setup_required: Configuration ID missing - save it in the Setup Wizard (Step 2) first.');
  }
  const params = new URLSearchParams({
    client_id: appId,
    config_id: configId,
    redirect_uri: redirectUri,
    response_type: 'code',
    // Always show both the Facebook and Instagram login options, even when a
    // Facebook session already exists in the browser.
    prompt: 'login',
    state,
  });
  return `${FB_OAUTH_URL}?${params.toString()}`;
}

export interface UnifiedTokenResponse {
  access_token: string;
  token_type?: string;
  /** Seconds until expiry. ABSENT for never-expiring configurations - treat
   *  absence as UNKNOWN, never as an invented date. */
  expires_in?: number;
}

export async function exchangeCodeForToken(
  code: string,
  appId: string,
  appSecret: string,
  redirectUri: string
): Promise<UnifiedTokenResponse> {
  // Server-to-server exchange with the META app credentials (NOT any
  // Instagram app pair - those do not exist for new apps).
  const params = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri,
    code,
  });
  const res = await fetch(`${FB_GRAPH_BASE}/oauth/access_token?${params.toString()}`);
  const json = (await res.json()) as UnifiedTokenResponse & { error?: { message?: string } };
  if (!res.ok || !json.access_token) {
    throw new Error(
      `Meta token exchange failed: ${res.status} ${JSON.stringify(json)} | redirect_uri="${redirectUri}". ` +
        'Check the Meta app ID/secret and that the Redirect URL in the configuration matches exactly.'
    );
  }
  return json;
}

export interface AssignedInstagramAccount {
  id: string;
  username?: string;
}

/** Lists the Instagram professional accounts the client shared during login. */
export async function getAssignedInstagramAccounts(accessToken: string): Promise<AssignedInstagramAccount[]> {
  const params = new URLSearchParams({ fields: 'id,username', access_token: accessToken });
  const res = await fetch(`${FB_GRAPH_BASE}/me/assigned_instagram_accounts?${params.toString()}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Instagram account discovery failed: ${res.status} ${body}`);
  }
  const json = (await res.json()) as { data?: AssignedInstagramAccount[] };
  return json.data ?? [];
}

/**
 * Diagnostics about the discovery RESPONSE SHAPE - never its secrets.
 * Whitelisted Meta error fields only (type/code/subcode/fbtrace_id are
 * Meta's own error taxonomy; error.message is deliberately EXCLUDED because
 * external text is not inherently secret-free).
 */
export interface IgDiscoveryDiagnostics {
  httpStatus: number;
  hadDataKey: boolean;
  dataLength: number;
  hadErrorKey: boolean;
  errorType?: string;
  errorCode?: number;
  errorSubcode?: number;
  fbtraceId?: string;
}

export interface AssignedInstagramAccountsResult {
  accounts: AssignedInstagramAccount[];
  diagnostics: IgDiscoveryDiagnostics;
}

/**
 * Same discovery as getAssignedInstagramAccounts, but returns response-shape
 * diagnostics for the callback's failure logging, and throws on a Graph
 * error payload EVEN when it arrives on HTTP 200 (Graph does that sometimes;
 * it must not masquerade as an empty account list). The thrown message
 * carries only whitelisted error fields - it surfaces in the Settings
 * banner's debug text, so never the raw body.
 */
export async function getAssignedInstagramAccountsWithDiagnostics(accessToken: string): Promise<AssignedInstagramAccountsResult> {
  const params = new URLSearchParams({ fields: 'id,username', access_token: accessToken });
  const res = await fetch(`${FB_GRAPH_BASE}/me/assigned_instagram_accounts?${params.toString()}`);
  const json = (await res.json().catch(() => null)) as {
    data?: AssignedInstagramAccount[];
    error?: { type?: string; code?: number; error_subcode?: number; fbtrace_id?: string };
  } | null;
  const diagnostics: IgDiscoveryDiagnostics = {
    httpStatus: res.status,
    hadDataKey: !!json && Array.isArray(json.data),
    dataLength: Array.isArray(json?.data) ? json.data.length : 0,
    hadErrorKey: !!json?.error,
    errorType: json?.error?.type,
    errorCode: json?.error?.code,
    errorSubcode: json?.error?.error_subcode,
    fbtraceId: json?.error?.fbtrace_id,
  };
  if (!res.ok || !json || json.error) {
    throw new Error(
      `Instagram account discovery failed: status=${diagnostics.httpStatus} ` +
        `type=${diagnostics.errorType ?? 'n/a'} code=${diagnostics.errorCode ?? 'n/a'} ` +
        `subcode=${diagnostics.errorSubcode ?? 'n/a'} fbtrace=${diagnostics.fbtraceId ?? 'n/a'}`
    );
  }
  return { accounts: json.data ?? [], diagnostics };
}

/** The business portfolio that owns the shared assets (needed by Meta's
 *  token-management API). Non-fatal when unavailable. */
export async function getClientBusinessId(accessToken: string): Promise<string | null> {
  const params = new URLSearchParams({ fields: 'client_business_id', access_token: accessToken });
  const res = await fetch(`${FB_GRAPH_BASE}/me?${params.toString()}`);
  if (!res.ok) return null;
  const json = (await res.json()) as { client_business_id?: string };
  return json.client_business_id ?? null;
}

/**
 * Unified Login SUATs cannot be refreshed through the old Instagram Login
 * endpoint (graph.instagram.com/refresh_access_token). Meta's Business
 * Integration System User Access Token Management API can manage them via the
 * client business ID - not wired up yet. Returning 'invalid' makes both
 * consumers (cron auto-refresh, manual refresh API) surface "reconnect
 * needed" visibly instead of silently retrying a dead endpoint.
 */
export async function refreshLongLivedToken(
  _currentToken: string
): Promise<{ access_token: string; expires_in: number } | { error: 'invalid' | 'failed'; status: number; body: string }> {
  return {
    error: 'invalid',
    status: 400,
    body: 'Unified Login tokens are not refreshed by this endpoint - reconnect the Instagram account from Settings if it stops working.',
  };
}

// ── Legacy Instagram Login helpers (dead code for Unified Login apps) ───────

export async function exchangeForLongLivedToken(
  shortLivedToken: string,
  appSecret: string
): Promise<IgLongLivedTokenResponse> {
  // Only grant_type, client_secret and access_token are accepted here -
  // extra params (e.g. client_id) make Meta reject the GET as unsupported.
  const params = new URLSearchParams({
    grant_type: 'ig_exchange_token',
    client_secret: appSecret,
    access_token: shortLivedToken,
  });
  const res = await fetch(`${IG_LONG_LIVED_URL}?${params.toString()}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Instagram long-lived token exchange failed: ${res.status} ${body}`);
  }
  return (await res.json()) as IgLongLivedTokenResponse;
}

export async function getInstagramProfile(accessToken: string): Promise<IgUserProfile> {
  const fields = 'user_id,username,name,profile_picture_url';
  const res = await fetch(`${IG_GRAPH_BASE}/me?fields=${fields}&access_token=${accessToken}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Instagram profile fetch failed: ${res.status} ${body}`);
  }
  return (await res.json()) as IgUserProfile;
}
