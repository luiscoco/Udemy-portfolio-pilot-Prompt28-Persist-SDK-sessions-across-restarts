import { requireAuthorization } from '../../../../../lib/authorization';
import { portfolioResponse } from '../../../../../lib/portfolio-http';
export const runtime = 'nodejs';
export function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
 return portfolioResponse(request, async () => {
  const auth = await requireAuthorization(request);
  return { approvals: await auth.approvals.list((await context.params).runId) };
 });
}
