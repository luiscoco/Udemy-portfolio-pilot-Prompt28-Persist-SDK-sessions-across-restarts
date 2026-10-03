import { requireAuthorization } from '../../../../../lib/authorization';
import { portfolioResponse } from '../../../../../lib/portfolio-http';
import { chatPage } from '../../../../../lib/chat';
export const runtime = 'nodejs';
// Persisted, completed messages only. New answers are created as runs: POST ../runs.
export function GET(request: Request, context: { params: Promise<{ conversationId: string }> }) {
  return portfolioResponse(request, async () => {
    const { chat } = await requireAuthorization(request);
    return chat.messages((await context.params).conversationId, chatPage(request));
  });
}
