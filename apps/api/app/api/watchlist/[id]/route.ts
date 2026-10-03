import { requireAuthorization } from '../../../../lib/authorization';
import { portfolioResponse } from '../../../../lib/portfolio-http';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export function PATCH(request: Request, context: Context) {
  return portfolioResponse(request, async () => { const { watchlist } = await requireAuthorization(request); return { entry: await watchlist.edit((await context.params).id, await request.json()) }; });
}
export function DELETE(request: Request, context: Context) {
  return portfolioResponse(request, async () => (await requireAuthorization(request)).watchlist.remove((await context.params).id));
}
