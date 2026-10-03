import { getDatabase, closeConnections } from './index.js';
import { assertLocalSeed, seedDemo } from './seed.js';
assertLocalSeed(process.env);
try {
  await seedDemo(await getDatabase(process.env.DATABASE_URL!));
  console.log('Synthetic demo seeded at 2025-01-15T16:00:00Z; prices are not current market data.');
} finally { await closeConnections(); }
