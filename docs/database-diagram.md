# Database diagram — milestone 06

```mermaid
erDiagram
  User ||--o{ Session : authenticates
  User ||--o{ Account : identifies
  User ||--o{ Portfolio : owns
  User ||--o{ WatchlistEntry : owns
  Portfolio ||--o{ PortfolioTransaction : ledger
  Security ||--o{ PortfolioTransaction : listing
  Security ||--o{ WatchlistEntry : listing
  Security ||--o{ QuoteSnapshot : snapshots
  Security ||--o{ NewsArticleSecurity : mentions
  NewsArticle ||--o{ NewsArticleSecurity : links
  User {
    string id PK
    string email UK
    datetime createdAt
    datetime updatedAt
  }
  Session {
    string id PK
    string token UK
    string userId FK
    datetime expiresAt
  }
  Account {
    string id PK
    string userId FK
    string providerId "composite unique"
    string accountId "composite unique"
  }
  Verification {
    string id PK
    string identifier "indexed"
    string value
    datetime expiresAt
  }
  Portfolio {
    string id PK
    string ownerId FK "unique with name"
    string name
    string currency "USD"
  }
  Security {
    string id PK
    string exchangeMic "unique with symbol"
    string symbol
    string currency "USD"
    string assetType "STOCK"
  }
  PortfolioTransaction {
    string id PK
    string portfolioId FK
    string securityId FK
    enum side
    numeric quantity "28,10"
    numeric price "28,10"
    numeric fees "28,10"
    numeric amount "38,10"
    datetime occurredAt
  }
  WatchlistEntry {
    string id PK
    string ownerId FK "unique with securityId"
    string securityId FK
  }
  QuoteSnapshot {
    string id PK
    string securityId FK "unique with provider and asOf"
    string provider
    datetime asOf
    numeric price "28,10"
    boolean isSynthetic
  }
  NewsArticle {
    string id PK
    string provider "unique with providerArticleId"
    string providerArticleId
    datetime publishedAt
    boolean isSynthetic
  }
  NewsArticleSecurity {
    string newsArticleId PK,FK
    string securityId PK,FK
  }
```

Every model has createdAt/updatedAt UTC timestamptz(3). Verification is deliberately independent (email/reset identifiers can precede a user). No Position table: derive positions from ordered transactions. Indexes support owner lists, ordered portfolio ledgers, expiry cleanup, symbol discovery, quote history, news chronology and reverse news links. Exact uniques, foreign keys and SQL checks are in the schema/migration; see [database ADR](decisions/0002-database-ledger-and-auth.md) for deletion policy and auth boundaries.
