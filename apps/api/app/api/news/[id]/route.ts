import { requireAuthorization } from '../../../../lib/authorization';
import { portfolioResponse } from '../../../../lib/portfolio-http';
export const runtime = 'nodejs';
export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return portfolioResponse(request, async () => {
    const { news } = await requireAuthorization(request);
    return news.detail((await context.params).id);
  });
}
