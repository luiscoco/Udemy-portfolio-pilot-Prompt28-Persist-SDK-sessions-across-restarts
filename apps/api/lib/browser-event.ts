import { browserEventSchema, type AppEvent, type BrowserEvent } from '@portfolio-pilot/contracts';

export function publicEvent(event: AppEvent): BrowserEvent | null {
  const base = { id: event.id, schemaVersion: event.schemaVersion, occurredAt: event.occurredAt, type: event.type };
  let dto: unknown;
  switch (event.type) {
    case 'research.updated': dto = { ...base, resourceId: event.entityId, ...event.payload }; break;
    case 'portfolio.updated': dto = { ...base, portfolioId: event.entityId, ...event.payload }; break;
    case 'watchlist.updated': dto = { ...base, entryId: event.entityId, ...event.payload }; break;
    case 'quote.updated': dto = { ...base, quotes: event.payload.quotes }; break;
    case 'news.available': dto = { ...base, articleId: event.entityId, change: event.payload.change,
      securityIds: event.payload.securityIds, portfolioIds: event.payload.portfolioIds, watchlisted: event.payload.watchlisted }; break;
    case 'agent.run.started': case 'agent.text.delta': case 'agent.block.completed':
    case 'agent.tool.status': case 'agent.message.completed': case 'agent.run.completed':
      dto = { ...base, runId: event.entityId, ...event.payload }; break;
    default: return null;
  }
  const result = browserEventSchema.safeParse(dto);
  return result.success ? result.data : null;
}
