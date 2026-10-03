import { requireAuthorization } from '../../../../lib/authorization';
import { portfolioResponse } from '../../../../lib/portfolio-http';
export const runtime = 'nodejs';
export function PATCH(request: Request, context: { params: Promise<{ id: string }> }) { return portfolioResponse(request, async () => (await requireAuthorization(request)).research.disposition((await context.params).id, await request.json())); }
