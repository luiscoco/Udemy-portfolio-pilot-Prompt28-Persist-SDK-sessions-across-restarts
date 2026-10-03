import { requireAuthorization } from '../../../lib/authorization';
import { portfolioResponse } from '../../../lib/portfolio-http';
import { chatBody, chatPage } from '../../../lib/chat';
export const runtime = 'nodejs';
export function GET(request: Request) {
  return portfolioResponse(request, async () => (await requireAuthorization(request)).chat.list(chatPage(request)));
}
export function POST(request: Request) {
  return portfolioResponse(request, async () => {
    const { chat } = await requireAuthorization(request);
    return { conversation: await chat.create(await chatBody(request)) };
  }, 201);
}
