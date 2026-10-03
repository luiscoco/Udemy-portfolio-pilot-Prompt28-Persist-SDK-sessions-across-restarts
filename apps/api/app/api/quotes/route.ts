import { requireAuthorization } from '../../../lib/authorization';
import { portfolioResponse } from '../../../lib/portfolio-http';
export const runtime = 'nodejs';
// Latest persisted quote per security, cache-aside (15 s ± 20%). Each quote keeps its provider asOf.
export function GET(request: Request) {
  return portfolioResponse(request, async () => (await requireAuthorization(request)).quotes.latest(new URL(request.url).searchParams.getAll('securityId')));
}
