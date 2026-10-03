import type { NewsItemDto, PortfolioDto, WatchlistItemDto } from '@portfolio-pilot/contracts';

export const demoPortfolios: PortfolioDto[] = [
  {
    id: 'growth', name: 'Growth Portfolio', accountLabel: 'Primary portfolio',
    totalValue: '87477.14', dayChange: '1842.36', dayChangePercent: '2.15',
    totalReturn: '18450.82', totalReturnPercent: '26.73', cashBalance: '8240.00',
    asOf: '2026-09-30T14:30:00Z', isDemo: true,
    holdings: [
      { symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technology', shares: '84', price: '246.38', marketValue: '20695.92', dayChangePercent: '1.24', allocationPercent: '16.11', trend: 'up' },
      { symbol: 'MSFT', name: 'Microsoft Corp.', sector: 'Technology', shares: '46', price: '421.70', marketValue: '19398.20', dayChangePercent: '0.86', allocationPercent: '15.10', trend: 'up' },
      { symbol: 'NVDA', name: 'NVIDIA Corp.', sector: 'Technology', shares: '120', price: '128.45', marketValue: '15414.00', dayChangePercent: '2.37', allocationPercent: '12.00', trend: 'up' },
      { symbol: 'AMZN', name: 'Amazon.com Inc.', sector: 'Consumer', shares: '62', price: '198.32', marketValue: '12295.84', dayChangePercent: '-0.42', allocationPercent: '9.57', trend: 'down' },
      { symbol: 'JPM', name: 'JPMorgan Chase & Co.', sector: 'Financials', shares: '51', price: '224.18', marketValue: '11433.18', dayChangePercent: '0.58', allocationPercent: '8.90', trend: 'up' },
    ]
  },
  {
    id: 'income', name: 'Income Portfolio', accountLabel: 'Long-term portfolio',
    totalValue: '54184.30', dayChange: '-218.47', dayChangePercent: '-0.40',
    totalReturn: '6420.15', totalReturnPercent: '13.44', cashBalance: '3120.00',
    asOf: '2026-09-30T14:30:00Z', isDemo: true,
    holdings: [
      { symbol: 'JPM', name: 'JPMorgan Chase & Co.', sector: 'Financials', shares: '110', price: '224.18', marketValue: '24659.80', dayChangePercent: '0.58', allocationPercent: '32.27', trend: 'up' },
      { symbol: 'KO', name: 'The Coca-Cola Company', sector: 'Consumer', shares: '205', price: '70.18', marketValue: '14386.90', dayChangePercent: '-0.21', allocationPercent: '18.83', trend: 'down' },
      { symbol: 'JNJ', name: 'Johnson & Johnson', sector: 'Healthcare', shares: '74', price: '162.40', marketValue: '12017.60', dayChangePercent: '-0.35', allocationPercent: '15.73', trend: 'down' },
    ]
  }
];

export const demoNews: NewsItemDto[] = [
  { id: 'n1', category: 'MARKET UPDATE', title: 'Technology shares lead a broad market advance', summary: 'Large-cap technology names gained as investors reviewed new economic data.', source: 'PortfolioPilot demo newsroom', publishedAt: '2026-09-30T13:45:00Z', symbols: ['AAPL', 'MSFT', 'NVDA'], url: 'https://example.com/demo/market-update', isDemo: true },
  { id: 'n2', category: 'EARNINGS', title: 'Investors turn attention to the next earnings cycle', summary: 'Upcoming company results could offer a clearer view of consumer and cloud demand.', source: 'PortfolioPilot demo newsroom', publishedAt: '2026-09-30T11:20:00Z', symbols: ['AMZN', 'MSFT'], url: 'https://example.com/demo/earnings', isDemo: true },
  { id: 'n3', category: 'SECTOR WATCH', title: 'Financial stocks steady as rate expectations shift', summary: 'Bank shares were mixed in a session shaped by changing interest-rate expectations.', source: 'PortfolioPilot demo newsroom', publishedAt: '2026-09-29T17:10:00Z', symbols: ['JPM'], url: 'https://example.com/demo/financials', isDemo: true },
];

export const demoWatchlist: WatchlistItemDto[] = [
  { symbol: 'GOOGL', name: 'Alphabet Inc.', price: '182.46', dayChangePercent: '0.73', trend: 'up' },
  { symbol: 'META', name: 'Meta Platforms Inc.', price: '567.20', dayChangePercent: '-0.34', trend: 'down' },
  { symbol: 'TSLA', name: 'Tesla Inc.', price: '248.15', dayChangePercent: '1.86', trend: 'up' },
];
