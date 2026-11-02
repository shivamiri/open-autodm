/**
 * GET /api/instagram/connect - build the Instagram Business Login URL.
 * Returns { url }; the frontend navigates the browser there.
 */

import { getAuthenticatedUser, unauthorized } from '@/lib/auth';
import { getMetaSettings } from '@/lib/settings';
import { buildOAuthUrl, signOAuthState } from '@/lib/instagram/oauth';
import { getAppUrl } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();

  const settings = await getMetaSettings();
  if (!settings) {
    return Response.json(
      { error: 'setup_required', message: 'Complete the Setup Wizard (Meta App ID + Secret) before connecting Instagram.' },
      { status: 409 }
    );
  }
  // Unified Login needs the Facebook Login for Business configuration ID
  // (Setup Wizard step 2). Hard-guard instead of producing a broken OAuth URL.
  if (!settings.metaConfigId) {
    return Response.json(
      { error: 'setup_required', message: 'Add the Configuration ID in the Setup Wizard (Step 2) before connecting Instagram.' },
      { status: 409 }
    );
  }

  const state = await signOAuthState(user.id);
  const redirectUri = `${getAppUrl(request)}/api/instagram/callback`;
  const url = buildOAuthUrl(settings.metaAppId, redirectUri, state, settings.metaConfigId);

  return Response.json({ url });
}
