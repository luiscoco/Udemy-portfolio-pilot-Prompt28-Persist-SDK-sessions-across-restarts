import type { PortfolioToolContext, PortfolioToolData } from '@portfolio-pilot/agent';
import { agentToolReads, type AuthenticatedOwner, type Cache } from '@portfolio-pilot/db';

type Database = Parameters<typeof agentToolReads>[0];

/**
 * Composition root for agent tools. The owner is the opaque context minted by `authenticateOwner`
 * from the verified session cookie (see `requireAuthorization`); the model can never supply it.
 * Build one context per authenticated run and never share it between users.
 */
export function portfolioToolContext(db: Database, cache: Cache, owner: AuthenticatedOwner, dataMode: 'mock' | 'live', now?: () => Date): PortfolioToolContext {
  // The explicit annotation makes TypeScript check the repository against the agent's port.
  const data: PortfolioToolData = agentToolReads(db, cache, owner);
  return { data, dataMode, ...(now ? { now } : {}) };
}
