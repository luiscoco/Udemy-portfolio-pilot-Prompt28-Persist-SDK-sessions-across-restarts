import { PortfolioError } from '@portfolio-pilot/db';
import { accessResponse } from './authorization';
import { errorResponse, getRequestId } from './http';
export async function portfolioResponse(request: Request, operation: () => Promise<unknown>, status = 200) {
  try { return Response.json(await operation(), { status, headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) {
    let response: Response;
    if (error instanceof PortfolioError) response = errorResponse(error.status === 400 ? 'BAD_REQUEST' : error.status === 404 ? 'NOT_FOUND' : error.status === 409 ? 'CONFLICT' : error.status === 429 ? 'BUDGET_EXHAUSTED' : 'INTERNAL_ERROR', error.message, getRequestId(request), error.status);
    else if (error instanceof SyntaxError || (error as { name?: string }).name === 'ZodError') response = errorResponse('BAD_REQUEST', 'Invalid request.', getRequestId(request), 400);
    else if ((error as { code?: string }).code === 'P2002') response = errorResponse('CONFLICT', 'An entry with that name or security already exists.', getRequestId(request), 409);
    else response = accessResponse(request, error);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
}
