import { requireAuthorization } from '../../../lib/authorization';
import { portfolioResponse } from '../../../lib/portfolio-http';
export const runtime = 'nodejs';
// Owner-scoped research recommendations (?status=open|active|stale&limit=). Freshness is re-checked on read.
export function GET(request: Request) {
  return portfolioResponse(request, async () => {
    const { research } = await requireAuthorization(request);
    return { recommendations: await research.list(Object.fromEntries(new URL(request.url).searchParams)), generatedAt: new Date().toISOString() };
  });
}
