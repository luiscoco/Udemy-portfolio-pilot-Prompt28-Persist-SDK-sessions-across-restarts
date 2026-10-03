import { accessResponse, requireAuthorization } from '../../../lib/authorization';
import { cursorCodec } from '../../../lib/event-cursor';
import { eventHub } from '../../../lib/events';
import { eventResponse } from '../../../lib/event-response';
import { errorResponse, getRequestId } from '../../../lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request): Promise<Response> {
  try {
    const auth = await requireAuthorization(request);
    const url = new URL(request.url);
    if ([...url.searchParams.keys()].some(key => key !== 'cursor') || url.searchParams.getAll('cursor').length > 1) {
      return errorResponse('BAD_REQUEST', 'Only one cursor parameter is accepted.', getRequestId(request), 400);
    }
    // Last-Event-ID takes precedence: EventSource keeps the original query on automatic reconnect.
    const cursor = request.headers.get('last-event-id') ?? url.searchParams.get('cursor');
    const positions = cursor ? cursorCodec().decode(auth.user.id, cursor) : null;
    return eventResponse(request, auth.user.id, auth.expiresAt, positions, eventHub(), async () => {
      const current = await requireAuthorization(request);
      return current.user.id === auth.user.id && current.expiresAt.getTime() > Date.now();
    }, cursor !== null ? 'invalid_cursor' : 'snapshot_required');
  } catch (error) { return accessResponse(request, error); }
}
