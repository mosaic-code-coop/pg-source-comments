import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTrackedPool } from '../src/pool-wrapper.js';
import type { Pool, PoolClient, QueryResult, QueryConfig, QueryResultRow } from 'pg';

// Mock captureSourceLocation to return predictable results
vi.mock('../src/stack-trace.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/stack-trace.js')>();
  return {
    ...original,
    captureSourceLocation: vi.fn().mockReturnValue({
      filePath: '/project/src/api/users.ts',
      lineNumber: 42,
      columnNumber: 10,
      functionName: 'getUsers',
    }),
  };
});

// Create a mock pool factory that returns properly typed mocks
function createMockPool() {
  const mockClientQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const mockClientRelease = vi.fn();

  const mockClient = {
    query: mockClientQuery,
    release: mockClientRelease,
  } as unknown as PoolClient;

  const mockPoolQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const mockPoolConnect = vi.fn().mockResolvedValue(mockClient);
  const mockPoolEnd = vi.fn().mockResolvedValue(undefined);
  const mockPoolOn = vi.fn().mockReturnThis();

  const mockPool = {
    query: mockPoolQuery,
    connect: mockPoolConnect,
    end: mockPoolEnd,
    on: mockPoolOn,
  } as unknown as Pool;

  return {
    pool: mockPool,
    client: mockClient,
    spies: {
      poolQuery: mockPoolQuery,
      poolConnect: mockPoolConnect,
      poolEnd: mockPoolEnd,
      poolOn: mockPoolOn,
      clientQuery: mockClientQuery,
      clientRelease: mockClientRelease,
    },
  };
}

describe('createTrackedPool', () => {
  let mocks: ReturnType<typeof createMockPool>;
  let cwdStub: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks = createMockPool();
    cwdStub = vi.spyOn(process, 'cwd').mockReturnValue('/project');
  });

  afterEach(() => {
    cwdStub?.mockRestore();
  });

  describe('pool.query()', () => {
    it('prepends comment to string queries', async () => {
      const tracked = createTrackedPool(mocks.pool, { enabled: true });
      await tracked.query('SELECT * FROM users');

      expect(mocks.spies.poolQuery).toHaveBeenCalledTimes(1);
      const calledWith = mocks.spies.poolQuery.mock.calls[0][0];
      expect(calledWith).toMatch(/^\/\* src\/api\/users\.ts:42 \*\/ SELECT \* FROM users$/);
    });

    it('prepends comment to QueryConfig objects', async () => {
      const tracked = createTrackedPool(mocks.pool, { enabled: true });
      await tracked.query({ text: 'SELECT * FROM users WHERE id = $1', values: [1] });

      expect(mocks.spies.poolQuery).toHaveBeenCalledTimes(1);
      const calledWith = mocks.spies.poolQuery.mock.calls[0][0] as QueryConfig;
      expect(calledWith.text).toMatch(/^\/\* src\/api\/users\.ts:42 \*\/ SELECT \* FROM users WHERE id = \$1$/);
      expect(calledWith.values).toEqual([1]);
    });

    it('passes query with values array', async () => {
      const tracked = createTrackedPool(mocks.pool, { enabled: true });
      await tracked.query('SELECT * FROM users WHERE id = $1', [1]);

      expect(mocks.spies.poolQuery).toHaveBeenCalledTimes(1);
      const calls = mocks.spies.poolQuery.mock.calls[0];
      expect(calls[0]).toMatch(/^\/\* src\/api\/users\.ts:42 \*\/ SELECT/);
      expect(calls[1]).toEqual([1]);
    });

    it('passes through when disabled', async () => {
      const tracked = createTrackedPool(mocks.pool, { enabled: false });
      await tracked.query('SELECT * FROM users');

      expect(mocks.spies.poolQuery).toHaveBeenCalledWith('SELECT * FROM users');
    });

    it('marks pool as tracked', () => {
      const tracked = createTrackedPool(mocks.pool, { enabled: true });
      expect((tracked as unknown as { __isTrackedPool: boolean }).__isTrackedPool).toBe(true);
    });
  });

  describe('pool.connect() and client.query()', () => {
    it('wraps clients from connect()', async () => {
      const tracked = createTrackedPool(mocks.pool, { enabled: true });
      const client = await tracked.connect();

      expect((client as unknown as { __isTrackedClient: boolean }).__isTrackedClient).toBe(true);
    });

    it('prepends comment to client queries', async () => {
      const tracked = createTrackedPool(mocks.pool, { enabled: true });
      const client = await tracked.connect();

      await client.query('BEGIN');

      expect(mocks.spies.clientQuery).toHaveBeenCalledTimes(1);
      const calledWith = mocks.spies.clientQuery.mock.calls[0][0];
      expect(calledWith).toMatch(/^\/\* src\/api\/users\.ts:42 \*\/ BEGIN$/);
    });

    it('client passes through when disabled', async () => {
      const tracked = createTrackedPool(mocks.pool, { enabled: false });
      const client = await tracked.connect();

      await client.query('BEGIN');

      expect(mocks.spies.clientQuery).toHaveBeenCalledWith('BEGIN');
    });

    it('client handles QueryConfig objects', async () => {
      const tracked = createTrackedPool(mocks.pool, { enabled: true });
      const client = await tracked.connect();

      await client.query({ text: 'INSERT INTO users VALUES ($1)', values: ['test'] });

      const calledWith = mocks.spies.clientQuery.mock.calls[0][0] as QueryConfig;
      expect(calledWith.text).toMatch(/^\/\* src\/api\/users\.ts:42 \*\/ INSERT INTO users VALUES/);
      expect(calledWith.values).toEqual(['test']);
    });

    it('client release still works', async () => {
      const tracked = createTrackedPool(mocks.pool, { enabled: true });
      const client = await tracked.connect();

      client.release();

      expect(mocks.spies.clientRelease).toHaveBeenCalled();
    });
  });

  describe('configuration options', () => {
    it('uses custom path transformer', async () => {
      const tracked = createTrackedPool(mocks.pool, {
        enabled: true,
        pathTransformer: () => 'custom/path.ts',
      });

      await tracked.query('SELECT 1');

      const calledWith = mocks.spies.poolQuery.mock.calls[0][0] as string;
      expect(calledWith).toContain('custom/path.ts');
    });

    it('includes function name when configured', async () => {
      const tracked = createTrackedPool(mocks.pool, {
        enabled: true,
        includeFunctionName: true,
      });

      await tracked.query('SELECT 1');

      const calledWith = mocks.spies.poolQuery.mock.calls[0][0] as string;
      expect(calledWith).toContain('in getUsers');
    });
  });

  describe('passthrough behavior', () => {
    it('passes through end() method', async () => {
      const tracked = createTrackedPool(mocks.pool, { enabled: true });
      await tracked.end();

      expect(mocks.spies.poolEnd).toHaveBeenCalled();
    });

    it('passes through on() method', () => {
      const tracked = createTrackedPool(mocks.pool, { enabled: true });
      const callback = vi.fn();
      tracked.on('error', callback);

      expect(mocks.spies.poolOn).toHaveBeenCalledWith('error', callback);
    });
  });
});
