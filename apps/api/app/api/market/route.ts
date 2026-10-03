import { parseServerConfig } from '@portfolio-pilot/config/server';
import { selectProviders } from '@portfolio-pilot/providers';
import { requireAuthorization, accessResponse } from '../../../lib/authorization';
import { MarketService } from '../../../lib/market-service';

export const runtime = 'nodejs';
let service: MarketService | undefined;
let configKey: string | undefined;
export async function GET(request: Request): Promise<Response> {
  try {
    await requireAuthorization(request);
    const config = parseServerConfig(process.env);
    const key = JSON.stringify([config.DATA_MODE, config.MOCK_START_AT, config.MOCK_NEWS_INTERVAL_MS, config.MOCK_SCENARIO]);
    if (!service || key !== configKey) {
      const providers = config.DATA_MODE === 'mock' ? selectProviders('mock', { intervalMs: config.MOCK_NEWS_INTERVAL_MS, scenario: config.MOCK_SCENARIO, ...(config.MOCK_START_AT ? { startAt: config.MOCK_START_AT } : {}) }) : undefined;
      service = new MarketService(config.DATA_MODE, providers, config.MOCK_NEWS_INTERVAL_MS); configKey = key;
    }
    return Response.json(await service.snapshot(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return accessResponse(request, error); }
}
