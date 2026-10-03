import { requireAuthorization } from '../../../../lib/authorization';
import { portfolioResponse } from '../../../../lib/portfolio-http';
export const runtime = 'nodejs';
/** Durable run outcome; foreign and missing runs are both 404. */
export function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  return portfolioResponse(request, async () => {
    const auth = await requireAuthorization(request);
    const run = await auth.chat.getRun((await context.params).runId);
    return { run: await auth.chat.getRun(run.id) };
  });
}
