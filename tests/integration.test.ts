import { describe, it, expect, beforeAll } from 'vitest';
import { Pool } from 'pg';
import { getCallSites } from 'node:util';
import { createTrackedPool } from '../src/pool-wrapper.js';
import { trackPrismaClient } from '../src/prisma-client.js';
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

  describe('comment presence in pg_stat_statements', () => {
    // PostgreSQL 18 drops leading comments from pg_stat_statements query text,
    // so comments must survive being placed after the first keyword.
    it('keeps comments in pg_stat_statements query text', async () => {
      const pool = createTrackedPool(TEST_DATABASE_URL, { enabled: true });

      try {
        await pool.query('CREATE EXTENSION IF NOT EXISTS pg_stat_statements');
        await pool.query('CREATE TABLE IF NOT EXISTS stat_statements_test (id int)');
        await pool.query('SELECT pg_stat_statements_reset()');

        await pool.query('SELECT id FROM stat_statements_test WHERE id = $1', [1]);
        await pool.query('(SELECT id FROM stat_statements_test) UNION (SELECT 2)');

        const result = await pool.query(`
          SELECT query FROM pg_stat_statements
          WHERE query LIKE '%stat_statements_test%' AND query NOT LIKE '%pg_stat_statements%'
          ORDER BY query
        `);

        expect(result.rows.map((row) => row.query)).toEqual([
          expect.stringMatching(/^\(SELECT \/\* .*:\d+ \*\/ id FROM stat_statements_test\) UNION/),
          expect.stringMatching(/^SELECT \/\* .*:\d+ \*\/ id FROM stat_statements_test WHERE id = \$1$/),
        ]);
      } finally {
        await pool.query('DROP TABLE IF EXISTS stat_statements_test');
        await pool.end();
      }
    });
  });

  describe('Prisma Client integration', () => {
    beforeAll(async () => {
      const { execSync } = await import('child_process');
      execSync('npx prisma db push --schema tests/prisma/schema.prisma', {
        env: { ...process.env, TEST_DATABASE_URL },
        stdio: 'inherit',
      });
    });

    it('works with Prisma Client queries', async () => {
      const pool = createTrackedPool(TEST_DATABASE_URL, { enabled: true });
      const adapter = new PrismaPg(pool);
      const prisma = new PrismaClient({ adapter });

      try {
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

    it('comments Prisma queries with their call site when the client is tracked', async () => {
      const pool = createTrackedPool(TEST_DATABASE_URL, { enabled: true });
      const untracked = new PrismaClient({ adapter: new PrismaPg(pool) });
      const prisma = trackPrismaClient(untracked);

      try {
        await pool.query('SELECT pg_stat_statements_reset()');

        await prisma.user.findMany({ where: { name: 'tracked' } });
        const findManyLine = currentLine() - 1;
        await prisma.$queryRaw`SELECT id FROM "User" WHERE name = ${'raw'}`;
        await prisma.$transaction(async (tx) => tx.user.count({ where: { name: 'interactive' } }));
        await prisma.$transaction([prisma.user.findFirst({ where: { id: -1 } })]);
        await prisma.$extends({}).user.findFirst({ where: { name: 'extended' } });
        await untracked.user.findMany({ where: { id: { gt: 0 } } });

        const result = await pool.query<{ query: string }>(`
          SELECT query FROM pg_stat_statements
          WHERE query LIKE '%"User"%' AND query NOT LIKE '%pg_stat_statements%'
        `);
        const statementMatching = (sqlPart: string) => {
          const statement = result.rows.map((row) => row.query).find((query) => query.includes(sqlPart));
          expect(statement, `no captured statement contains ${sqlPart}`).toBeDefined();
          return statement!;
        };
        const callSiteComment = /^\w+ \/\* tests\/integration\.test\.ts:\d+ \*\/ /;

        expect(statementMatching('"public"."User"."name" = $1 OFFSET')).toMatch(
          new RegExp(`^SELECT /\\* tests/integration\\.test\\.ts:${findManyLine} \\*/ `)
        );
        expect(statementMatching('id FROM "User" WHERE name')).toMatch(callSiteComment);
        expect(statementMatching('COUNT(*)')).toMatch(callSiteComment);
        expect(statementMatching('"public"."User"."id" = $1')).toMatch(callSiteComment);
        expect(statementMatching('"public"."User"."name" = $1 LIMIT')).toMatch(callSiteComment);
        // Without trackPrismaClient, Prisma queries have no user code on the stack
        expect(statementMatching('"public"."User"."id" > $1')).not.toContain('/*');
      } finally {
        await untracked.$disconnect();
        await pool.end();
      }
    });
  });
});

function currentLine(): number {
  return getCallSites()[1].lineNumber;
}
