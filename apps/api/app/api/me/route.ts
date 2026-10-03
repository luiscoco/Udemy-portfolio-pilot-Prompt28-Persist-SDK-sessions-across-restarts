import { requireAuthorization, accessResponse } from '../../../lib/authorization';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const { user, expiresAt } = await requireAuthorization(request);
    return Response.json({ user: { id: user.id, name: user.name, email: user.email }, expiresAt }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return accessResponse(request, error); }
}
