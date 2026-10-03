import { healthResponseSchema, REQUEST_ID_HEADER } from '@portfolio-pilot/contracts';
import { getRequestId } from '../../../../lib/http';

export const runtime = 'nodejs';
export async function GET(request: Request): Promise<Response> {
  const requestId = getRequestId(request);
  return Response.json(healthResponseSchema.parse({ status: 'ok', requestId }), { headers: { [REQUEST_ID_HEADER]: requestId } });
}
