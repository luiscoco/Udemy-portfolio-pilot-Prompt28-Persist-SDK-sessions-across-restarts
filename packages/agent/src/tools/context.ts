import type { NewsDetail, NewsFeed, NewsSearchQuery, PortfolioSummary, PortfolioTransactionDto, QuoteList } from '@portfolio-pilot/contracts';

/**
 * Read-only data port, already bound to the authenticated owner by the application (see
 * `agentToolReads` in @portfolio-pilot/db). No method takes a user ID. Repositories enforce ownership
 * and report foreign or missing records identically, as an error with `status: 404`.
 */
export interface PortfolioToolData {
  listPortfolios(take: number): Promise<Array<{ id: string; name: string; archivedAt: string | null }>>;
  getSummary(portfolioId: string, now: Date): Promise<PortfolioSummary>;
  listTransactions(portfolioId: string, page: { limit: number; offset: number }): Promise<{ transactions: PortfolioTransactionDto[]; nextOffset: number | null }>;
  /** Only securities in the owner's interest (traded in an owned portfolio or watchlisted). */
  listSecurities(securityIds: readonly string[] | null, take: number): Promise<Array<{ id: string; symbol: string; exchangeMic: string; name: string; currency: string; watchlisted: boolean; traded: boolean }>>;
  latestQuotes(securityIds: readonly string[]): Promise<QuoteList>;
  searchNews(input: NewsSearchQuery): Promise<NewsFeed>;
  getNewsArticle(articleId: string): Promise<NewsDetail>;
}

/** Trusted per-run context supplied by the server application, never by the model or browser. */
export interface PortfolioToolContext {
  readonly resultBytes?: number;
  readonly onLimit?: (code: 'tool_result_limit' | 'scope_limit') => void;
  readonly approval?: {
    rules(): Promise<import('@portfolio-pilot/contracts').AlertRule[]>;
    authorize(change: unknown, signal: AbortSignal): Promise<boolean>;
    execute(change: unknown): Promise<{ mutationId: string; applied: boolean }>;
  };
  readonly signal?: AbortSignal;
  /** Server-only observation of validated, bounded results; never sent to React. */
  readonly onResult?: (name: string, result: Record<string, unknown>) => void;
  readonly data: PortfolioToolData;
  /** Server configuration DATA_MODE, surfaced so answers can label synthetic data. */
  readonly dataMode: 'mock' | 'live';
  readonly now?: () => Date;
  readonly quoteStaleAfterMs?: number;
}
