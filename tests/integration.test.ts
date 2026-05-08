import { describe, it, expect, beforeAll } from 'vitest';
import { Pool } from 'pg';
import { createTrackedPool } from '../src/pool-wrapper.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://test:test@localhost:5433/test';

// Helper to ensure database is reachable - throws helpful error if not
async function requireDatabaseReachable(): Promise<void> {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await pool.query('SELECT 1');
  } catch (error) {
    throw new Error(
      '\n\n' +
      '❌ Cannot connect to test database at: ' + TEST_DATABASE_URL + '\n' +
      '\n' +
      'To run integration tests, you have two options:\n' +
      '\n' +
      '  1️⃣  Use the automated setup script (recommended):\n' +
      '      npm run test:integration:setup\n' +
      '\n' +
      '  2️⃣  Manual setup:\n' +
      '      docker compose up -d postgres-test\n' +
      '      npx prisma generate --schema tests/prisma/schema.prisma\n' +
      '      npx prisma db push --schema tests/prisma/schema.prisma --skip-generate\n' +
      '      npm run test:integration\n' +
      '\n' +
      'Original error: ' + (error instanceof Error ? error.message : String(error)) + '\n'
    );
  } finally {
    await pool.end();
  }
}

describe('integration tests with PostgreSQL', () => {
  beforeAll(async () => {
    // Fail loudly if database is not available
    await requireDatabaseReachable();

    // Generate Prisma client if not already generated
    const { spawn } = await import('child_process');
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('npx', ['prisma', 'generate', '--schema', 'tests/prisma/schema.prisma'], {
        stdio: 'inherit',
        env: { ...process.env, TEST_DATABASE_URL },
      });
      proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`prisma generate failed with code ${code}`)));
    });
  });

  describe('basic query syntax validation', () => {
    it('executes queries without syntax errors', async () => {
      const pool = createTrackedPool(TEST_DATABASE_URL, { enabled: true });

      try {
        // CREATE TEMP TABLE
        await pool.query('CREATE TEMP TABLE syntax_test (id int, name text)');

        // SELECT
        const selectResult = await pool.query('SELECT * FROM syntax_test');
        expect(selectResult.rows).toEqual([]);

        // INSERT
        await pool.query('INSERT INTO syntax_test VALUES (1, $1)', ['test']);

        // SELECT with data
        const result = await pool.query('SELECT * FROM syntax_test WHERE id = $1', [1]);
        expect(result.rows[0]).toEqual({ id: 1, name: 'test' });

        // UPDATE
        await pool.query('UPDATE syntax_test SET name = $1 WHERE id = $2', ['updated', 1]);
        const updated = await pool.query('SELECT * FROM syntax_test WHERE id = 1');
        expect(updated.rows[0].name).toBe('updated');

        // DELETE
        await pool.query('DELETE FROM syntax_test WHERE id = 1');
        const deleted = await pool.query('SELECT * FROM syntax_test WHERE id = 1');
        expect(deleted.rows).toEqual([]);
      } finally {
        await pool.end();
      }
    });
  });

  describe('comment presence in pg_stat_activity', () => {
    it('prepends comments visible in pg_stat_activity', async () => {
      const pool1 = createTrackedPool(TEST_DATABASE_URL, { enabled: true });
      const pool2 = createTrackedPool(TEST_DATABASE_URL, { enabled: true });

      const client1 = await pool1.connect();
      const client2 = await pool2.connect();

      // TEMP tables are session-scoped, so use a regular table both sessions can see.
      await client1.query('CREATE TABLE IF NOT EXISTS integration_test (id int)');

      try {
        // Transaction 1 acquires lock
        await client1.query('BEGIN');
        await client1.query('INSERT INTO integration_test VALUES (1)');
        const lockQueryPromise = client1.query('SELECT * FROM integration_test FOR UPDATE');

        // Transaction 2 will block on lock
        await client2.query('BEGIN');
        const blockedQueryPromise = client2.query('SELECT * FROM integration_test FOR UPDATE');

        // Wait a bit for T2 to block
        await new Promise(resolve => setTimeout(resolve, 100));

        // Query pg_stat_activity to find T2's query
        const result = await pool1.query(`
          SELECT query FROM pg_stat_activity
          WHERE query LIKE '%integration_test%'
          AND state = 'active'
        `);

        // Verify comment is present
        expect(result.rows.length).toBeGreaterThan(0);
        expect(result.rows[0].query).toMatch(/\/\* .*:\d+ \*\//);

        // Cleanup queries (they will resolve after rollback)
        await client1.query('ROLLBACK');
        await client2.query('ROLLBACK');

        // Wait for the async queries to complete/resolve
        await Promise.allSettled([lockQueryPromise, blockedQueryPromise]);
      } finally {
        // Ensure cleanup even if assertions fail
        try {
          await client1.query('ROLLBACK').catch(() => {});
          await client2.query('ROLLBACK').catch(() => {});
        } catch {}
        await client1.query('DROP TABLE IF EXISTS integration_test').catch(() => {});
        client1.release();
        client2.release();
        await pool1.end();
        await pool2.end();
      }
    });
  });

  describe('Prisma Client integration', () => {
    it('works with Prisma Client queries', async () => {
      const pool = createTrackedPool(TEST_DATABASE_URL, { enabled: true });
      const adapter = new PrismaPg(pool);
      const prisma = new PrismaClient({ adapter });

      try {
        // Push schema to database
        const { execSync } = await import('child_process');
        execSync('npx prisma db push --schema tests/prisma/schema.prisma', {
          env: { ...process.env, TEST_DATABASE_URL },
          stdio: 'inherit',
        });

        // Create test data via Prisma
        const user = await prisma.user.create({
          data: { name: 'Test User' }
        });

        expect(user.id).toBeGreaterThan(0);
        expect(user.name).toBe('Test User');

        // Query via Prisma
        const found = await prisma.user.findUnique({
          where: { id: user.id }
        });

        expect(found?.name).toBe('Test User');

        // Update via Prisma
        const updated = await prisma.user.update({
          where: { id: user.id },
          data: { name: 'Updated User' }
        });
        expect(updated.name).toBe('Updated User');

        // Delete via Prisma
        await prisma.user.delete({
          where: { id: user.id }
        });

        const deleted = await prisma.user.findUnique({
          where: { id: user.id }
        });
        expect(deleted).toBeNull();
      } finally {
        await prisma.$disconnect();
        await pool.end();
      }
    });
  });
});
