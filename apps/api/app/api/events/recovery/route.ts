import { requireAuthorization } from '../../../../lib/authorization';
import { portfolioResponse } from '../../../../lib/portfolio-http';
import { cursorCodec } from '../../../../lib/event-cursor';
export const runtime = 'nodejs';
// Snapshot recovery: stream cursors captured before the owner's PostgreSQL snapshot (ADR 0007).
export function GET(request: Request) {
  return portfolioResponse(request, async () => {
    const auth = await requireAuthorization(request);
    const snapshot = await auth.recovery();
    const { user, market } = snapshot.streams;
    return { ...snapshot, cursor: user && market ? cursorCodec().encode(auth.user.id, { user, market }) : null };
  });
}
