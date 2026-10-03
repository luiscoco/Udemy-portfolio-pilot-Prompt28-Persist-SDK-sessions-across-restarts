import { requireAuthorization } from '../../../../../lib/authorization';
import { portfolioResponse } from '../../../../../lib/portfolio-http';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export function GET(request: Request, context: Context) {
  return portfolioResponse(request, async () => {
    const { portfolios } = await requireAuthorization(request);
    return portfolios.transactions((await context.params).id, Object.fromEntries(new URL(request.url).searchParams));
  });
}
export function POST(request: Request, context: Context) {
  return portfolioResponse(request, async () => {
    const { portfolios } = await requireAuthorization(request);
    return portfolios.record((await context.params).id, await request.json(), request.headers.get('Idempotency-Key'));
  });
}
