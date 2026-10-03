import { requireAuthorization } from '../../../../lib/authorization';
import { portfolioResponse } from '../../../../lib/portfolio-http';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return portfolioResponse(request, async () => ({ portfolio: await (await requireAuthorization(request)).portfolios.get((await context.params).id) }));
}
export function PATCH(request: Request, context: Context) {
  return portfolioResponse(request, async () => {
    const { portfolios } = await requireAuthorization(request);
    return { portfolio: await portfolios.edit((await context.params).id, await request.json()) };
  });
}
export function DELETE(request: Request, context: Context) {
  return portfolioResponse(request, async () => ({ portfolio: await (await requireAuthorization(request)).portfolios.archive((await context.params).id) }));
}
