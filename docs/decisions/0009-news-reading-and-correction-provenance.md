# 0009. News reading and correction provenance

- Status: Accepted
- Date: 2026-10-02
- Milestone: 16

## Context

News delivery is at least once. Provider corrections may reuse the record ID, change URLs or
arrive after a fresher observation. A reader must retain their place while reporting changes,
and one user's read state must never affect another user.

## Decision

Continue using canonical URLs and provider aliases to resolve one durable article. Immutable
observations preserve all normalized evidence. Persist the accepted observation ID on that article
so a stale delivery cannot supply its displayed revision, ingestion time or delay labels.
The pointer is server-owned and resolved with both observation and article IDs. The migration
backfills only observations matching the displayed title, summary and canonical URL; unknown
provenance remains explicitly unknown. The existing ingestion transaction updates the pointer,
article, securities and outbox together. Lower revisions at an equal provider timestamp remain
history. Corrections notify both old and new security audiences so removed relevance refreshes.
Canonical merges retain read records from the merged article.

`NewsRead` uses the compound owner/article key and stores the read timestamp and displayed
article revision timestamp. Marking the same revision read is idempotent; a correction becomes
unread without deleting the earlier read record. Ownership derives from the authenticated cookie.
Read mutations lock the article and check current relevance inside the transaction. Read state
is overlaid from PostgreSQL after loading cached public article data, so cached pages cannot
overwrite it. Cache keys add an `m16` suffix for the expanded DTO. Watchlist and cursor shapes
bypass the old cache key. Feed relevance and detail authorization match outbox fan-out: active
portfolios with positive remaining quantities, plus the user's watchlist.

Pagination orders publication time descending and ID ascending. An opaque, validated keyset
cursor bounds the next page; it is never authorization. Insertion at the top does not offset
already requested older pages. React retains displayed rows until an explicit update action,
deduplicates appended pages by article ID, and disables a loaded page query after appending it.
A reserved live-region area announces pending updates. A bounded list of the latest 100 validated
news notifications also surfaces updates outside the first page. Applying updates returns to
the newest page without automatic scrolling. Dialogs restore focus and support Escape.

Provider strings render as bounded, control-character-cleaned React text. No HTML or Markdown
is interpreted. HTTP(S) source links reject credentials and use `noopener noreferrer` and
`no-referrer`. Impact is deterministic related exposure and valuation, with quote freshness;
it is not AI analysis or a forecast.

## Consequences

Read state persists across reloads; another tab refreshes it on its next authoritative read.
There is no cross-tab read receipt event in this slice. Older observed records stay available
in the bounded detail history (100 observations), while accepted provenance is independently
loaded even if outside that history window. Notification counts are bounded, not a durable unread
counter. Pagination is not a historical snapshot: changed publication times can move records;
UI ID deduplication and an explicit refresh reconcile those changes.

## References

- Next.js 16.3.8 installed route-handler guide and `route.md`, inspected 2026-10-02;
  [official route context API](https://nextjs.org/docs/app/api-reference/file-conventions/route).
- Prisma 7.10.0 generated `NewsRead`/`NewsObservation` types, inspected and compiled 2026-10-02;
  [official compound key guidance](https://docs.prisma.io/docs/orm/prisma-client/special-fields-and-types/working-with-composite-ids-and-constraints).
