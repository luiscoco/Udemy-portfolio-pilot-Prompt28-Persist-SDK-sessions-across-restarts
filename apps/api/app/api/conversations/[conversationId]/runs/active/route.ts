import { requireAuthorization } from '../../../../../../lib/authorization';
import { portfolioResponse } from '../../../../../../lib/portfolio-http';
export const runtime = 'nodejs';
/** Reconnection recovery: the conversation's running run, if any (lost runs are first marked interrupted). */
export function GET(request: Request, context: { params: Promise<{ conversationId: string }> }) {
  return portfolioResponse(request, async () => {
    const auth = await requireAuthorization(request);
    const conversationId = (await context.params).conversationId;
    await auth.chat.get(conversationId);
    return { run: await auth.chat.activeRun(conversationId) };
  });
}
