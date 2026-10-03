import { requireAuthorization } from '../../../lib/authorization';
import { portfolioResponse } from '../../../lib/portfolio-http';
export const runtime = 'nodejs';
export function GET(request: Request) {
  return portfolioResponse(request, async () => ({ entries: await (await requireAuthorization(request)).watchlist.list() }));
}
export function POST(request: Request) {
  return portfolioResponse(request, async () => { const { watchlist } = await requireAuthorization(request); return { entry: await watchlist.add(await request.json()) }; }, 201);
}
