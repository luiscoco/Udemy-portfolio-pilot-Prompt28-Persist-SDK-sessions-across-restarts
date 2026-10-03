import { closeConnections, getDatabase, ingestionRepository } from '@portfolio-pilot/db';
import { assertFixtureEnvironment, fixtureArticle, injectFixture } from './fixture.js';
try {
  assertFixtureEnvironment(process.env); // Before any connection or mutation, including production.
  const [id = 'lesson16', revision = '1', publishedAt] = process.argv.slice(2);
  fixtureArticle(id, Number(revision), publishedAt ?? new Date().toISOString());
  const db = await getDatabase(process.env.DATABASE_URL!);
  // Store the first timestamp in the schedule so repeated CLI calls have identical fingerprints.
  const state = await ingestionRepository(db).initialize(`dev-fixture-clock:${id}`, publishedAt ? new Date(publishedAt) : new Date());
  await injectFixture(ingestionRepository(db), { id, revision: Number(revision), publishedAt: publishedAt ?? state.mockStartAt.toISOString() });
  console.log(`Fixture ${id} revision ${revision} committed through ingestion; outbox dispatch delivers it.`);
} catch (error) { console.error(error instanceof Error ? error.message : 'Fixture injection failed'); process.exitCode = 1; }
finally { await closeConnections(); }
