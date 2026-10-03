import { requireAuthorization } from '../../../../../lib/authorization';
import { portfolioResponse } from '../../../../../lib/portfolio-http';
export const runtime = 'nodejs';
/** Persisted owner impact with read-time staleness. Never runs the model. */
export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return portfolioResponse(request, async () => {
    const { research } = await requireAuthorization(request);
    return { impact: await research.impact((await context.params).id) };
  });
}
/**
 * Recalculate: reuse (or create once) the shared article analysis, then recompute this owner's exposure
 * and recommendations. The request signal is deliberately not passed: a browser disconnect must not
 * cancel a shared analysis other owners may be waiting for.
 */
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return portfolioResponse(request, async () => {
    const { research } = await requireAuthorization(request);
    return { impact: await research.recalculate((await context.params).id) };
  });
}
