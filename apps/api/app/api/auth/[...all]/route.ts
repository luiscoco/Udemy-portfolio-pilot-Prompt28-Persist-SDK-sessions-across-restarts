import { getAuthentication, assertMutationOrigin } from '../../../../lib/auth';
import { accessResponse, AccessError } from '../../../../lib/authorization';
import { parseServerConfig } from '@portfolio-pilot/config/server';
export const runtime = 'nodejs';
async function handle(request: Request) {
  try {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === '/api/auth/options') {
      const config = parseServerConfig(process.env);
      return Response.json({ demo: config.DEMO_AUTH_ENABLED, microsoft: Boolean(config.ENTRA_CLIENT_ID) }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const allowed = request.method === 'GET' ? path === '/api/auth/callback/microsoft' :
      request.method === 'POST' && ['/api/auth/demo-sign-in', '/api/auth/sign-in/social', '/api/auth/sign-out'].includes(path);
    if (!allowed) throw new AccessError(404, 'Resource not found.');
    try { assertMutationOrigin(request); } catch { throw new AccessError(403, 'Untrusted request origin.'); }
    const response = await (await getAuthentication()).handler(request);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) { return accessResponse(request, error); }
}
export const GET = handle;
export const POST = handle;
