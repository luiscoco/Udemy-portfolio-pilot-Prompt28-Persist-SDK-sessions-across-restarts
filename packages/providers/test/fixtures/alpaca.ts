// Synthetic values in official Alpaca OpenAPI response shapes (checked 2026-10-02).
// https://github.com/alpacahq/cli/blob/main/api/specs/market-data-api.json
export const article = { id: 123, headline: 'Fictional fixture headline', author: 'Fixture Author', created_at: '2026-10-02T10:00:00Z', updated_at: '2026-10-02T10:01:00Z', summary: 'Synthetic excerpt', content: 'FULL TEXT MUST NOT SURVIVE', url: 'https://example.com/story?utm_source=test', symbols: ['AAPL'], source: 'benzinga', images: [] };
export const news = { news: [article], next_page_token: 'page-2' };
export const trades = '{"trades":{"AAPL":{"t":"2026-10-02T11:59:59.123456789Z","p":123.1234567890,"i":456,"x":"V","s":100,"c":[],"z":"C"}}}';
