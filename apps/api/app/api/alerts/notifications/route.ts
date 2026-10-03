import { requireAuthorization } from '../../../../lib/authorization';
import { portfolioResponse } from '../../../../lib/portfolio-http';
export const runtime = 'nodejs';
export function GET(request: Request) { return portfolioResponse(request, async () => ({ notifications: await (await requireAuthorization(request)).alerts.notifications() })); }
