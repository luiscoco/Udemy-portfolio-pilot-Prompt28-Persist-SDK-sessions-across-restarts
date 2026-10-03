import { requireAuthorization } from '../../../../../lib/authorization';
import { portfolioResponse } from '../../../../../lib/portfolio-http';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export function PUT(request: Request, context: Context) { return portfolioResponse(request, async () => ({ rule: await (await requireAuthorization(request)).alerts.edit((await context.params).id, await request.json()) })); }
export function DELETE(request: Request, context: Context) { return portfolioResponse(request, async () => (await requireAuthorization(request)).alerts.remove((await context.params).id)); }
