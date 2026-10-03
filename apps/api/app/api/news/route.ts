import { requireAuthorization } from '../../../lib/authorization';
import { portfolioResponse } from '../../../lib/portfolio-http';
export const runtime = 'nodejs';
// Owner-scoped news for holdings/watchlist, or one owned portfolio (?portfolioId=). generatedAt shows cache age.
export function GET(request: Request) {
  return portfolioResponse(request, async () => {
    const { news } = await requireAuthorization(request);
    const params = new URL(request.url).searchParams;
    return news.feed(Object.fromEntries(params));
  });
}
