import { requireAuthorization } from '../../../../lib/authorization';
import { portfolioResponse } from '../../../../lib/portfolio-http';
export const runtime = 'nodejs';
export function GET(request: Request, context: { params: Promise<{ conversationId: string }> }) {
  return portfolioResponse(request, async () => {
    const { chat } = await requireAuthorization(request);
    return { conversation: await chat.get((await context.params).conversationId) };
  });
}
