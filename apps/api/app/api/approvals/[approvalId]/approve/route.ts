import { requireAuthorization } from '../../../../../lib/authorization';
import { portfolioResponse } from '../../../../../lib/portfolio-http';
import { chatBody } from '../../../../../lib/chat';
export const runtime = 'nodejs';
export function POST(request: Request, context: { params: Promise<{ approvalId: string }> }) {
 return portfolioResponse(request, async () => {
  const auth = await requireAuthorization(request);
  const id = (await context.params).approvalId;
  return { approval: await auth.approvals.decide(id, 'approved', await chatBody(request)) };
 });
}
