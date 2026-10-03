import { requireAuthorization } from '../../../../../lib/authorization';
import { portfolioResponse } from '../../../../../lib/portfolio-http';
import { publicEvent } from '../../../../../lib/browser-event';
import { appEventSchema } from '@portfolio-pilot/contracts';
export const runtime = 'nodejs';
export function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
 return portfolioResponse(request, async () => {
  const auth = await requireAuthorization(request);
  const events = await auth.chat.progress((await context.params).runId);
  return { events: events.map(event => publicEvent(appEventSchema.parse(event))).filter(event => event !== null) };
 });
}
