# 05 — Local PostgreSQL and Redis

Compose runs PostgreSQL 17.6 and Redis 7.4.5 with health checks, localhost port bindings, and named volumes. `infra:stop` preserves data; `infra:reset` requires `--confirm-delete-volumes` and removes it. The example password is deliberately public and for local development only.

Prisma 7 uses the documented `@prisma/adapter-pg` driver adapter and a generated TypeScript client. The schema currently has no application models; milestone 06 adds those and migrations. The Redis wrapper uses node-redis 5 `createClient`, bounded reconnection, `ping`, and `close`. Configuration validates URL schemes; the API validates configuration at startup. Liveness checks the API process only. Readiness probes both dependencies and returns 503 when either fails, exposing only dependency state and a request ID.

The Compose file passed `docker compose -f compose.yaml config --quiet`. Docker engine access was denied on this host, so container health and the live readiness transition remain unverified. After restoring engine access, run the sequence in `README.md`, including `docker compose stop redis` and a second readiness request.

References: [Prisma 7 client setup](https://www.prisma.io/docs/orm/v7/prisma-client/setup-and-configuration/introduction), [Prisma generators](https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators), [Redis node client connection and retry](https://redis.io/docs/latest/develop/clients/nodejs/connect/).
