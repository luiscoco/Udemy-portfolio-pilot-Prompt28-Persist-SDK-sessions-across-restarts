import { defineConfig } from 'prisma/config';
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'node dist/seed-cli.js' },
  datasource: { url: process.env.DATABASE_URL ?? 'postgresql://portfolio_local:local_only_change_me@127.0.0.1:5432/portfolio_pilot' }
});
