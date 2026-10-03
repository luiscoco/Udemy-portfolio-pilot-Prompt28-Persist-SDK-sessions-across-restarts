import { requireAuthorization } from '../../../../../lib/authorization';
import { portfolioResponse } from '../../../../../lib/portfolio-http';
import { cancelChatRun } from '../../../../../lib/chat';
export const runtime = 'nodejs';
/** Explicit, idempotent cancellation. 202: the run settles as "cancelled" and is announced over SSE. */
export function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  return portfolioResponse(request, async () => {
    const auth = await requireAuthorization(request);
    return { run: await cancelChatRun({ ownerId: auth.user.id, chat: auth.chat, runId: (await context.params).runId }) };
  }, 202);
}
