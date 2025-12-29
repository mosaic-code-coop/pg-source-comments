import { Pool, PoolClient, PoolConfig, QueryConfig, QueryResult, QueryResultRow } from 'pg';
import type { QueryIdConfig, TrackedPool, TrackedPoolClient } from './types.js';
import { captureSourceLocation } from './stack-trace.js';
import { formatComment, prependComment } from './comment-formatter.js';

type LogFn = (message: string, ...args: unknown[]) => void;

/**
 * Creates a query modifier function with the given config and logger
 */
function createModifyQuery(config: QueryIdConfig, log: LogFn) {
  return {
    modifyString(query: string): string {
      if (config.enabled === false) {
        return query;
      }

      const location = captureSourceLocation(config, log);

      if (!location) {
        return query;
      }

      const comment = formatComment(location, config);
      log('Adding comment:', comment);

      return prependComment(query, comment);
    },

    modifyQueryConfig(query: QueryConfig): QueryConfig {
      if (config.enabled === false) {
        return query;
      }

      const location = captureSourceLocation(config, log);

      if (!location) {
        return query;
      }

      const comment = formatComment(location, config);
      log('Adding comment:', comment);

      return {
        ...query,
        text: prependComment(query.text, comment),
      };
    },

    modify(query: string | QueryConfig): string | QueryConfig {
      if (typeof query === 'string') {
        return this.modifyString(query);
      }
      return this.modifyQueryConfig(query);
    },
  };
}

/**
 * Wraps a PoolClient to track queries within transactions
 */
function createTrackedClient(
  client: PoolClient,
  config: QueryIdConfig,
  log: LogFn
): TrackedPoolClient {
  const modifyQuery = createModifyQuery(config, log);

  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === '__isTrackedClient') {
        return true;
      }

      if (prop === 'query') {
        return function trackedClientQuery<R extends QueryResultRow = QueryResultRow>(
          queryTextOrConfig: string | QueryConfig,
          valuesOrCallback?: unknown[] | ((err: Error, result: QueryResult<R>) => void),
          callback?: (err: Error, result: QueryResult<R>) => void
        ): Promise<QueryResult<R>> | void {
          // Handle callback-style queries
          if (typeof valuesOrCallback === 'function') {
            const modifiedQuery = modifyQuery.modifyString(queryTextOrConfig as string);
            return target.query(
              modifiedQuery,
              valuesOrCallback as (err: Error, result: QueryResult<R>) => void
            );
          }

          if (callback !== undefined) {
            const modifiedQuery = modifyQuery.modifyString(queryTextOrConfig as string);
            return target.query(
              modifiedQuery,
              valuesOrCallback as unknown[],
              callback
            );
          }

          if (valuesOrCallback !== undefined) {
            const modifiedQuery = typeof queryTextOrConfig === 'string'
              ? modifyQuery.modifyString(queryTextOrConfig)
              : modifyQuery.modifyQueryConfig(queryTextOrConfig);
            return target.query(modifiedQuery, valuesOrCallback as unknown[]);
          }

          const modifiedQuery = modifyQuery.modify(queryTextOrConfig);
          return target.query(modifiedQuery);
        };
      }

      const value = Reflect.get(target, prop, receiver);

      if (typeof value === 'function') {
        return value.bind(target);
      }

      return value;
    },
  }) as TrackedPoolClient;
}

/**
 * Check if an object looks like a pg Pool (duck typing for testability)
 */
function isPoolLike(obj: unknown): obj is Pool {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof (obj as Pool).query === 'function' &&
    typeof (obj as Pool).connect === 'function'
  );
}

/**
 * Creates a wrapped pg Pool that prepends source location comments to all queries
 */
export function createTrackedPool(
  poolOrConfig: Pool | PoolConfig | string,
  queryIdConfig: QueryIdConfig = {}
): TrackedPool {
  // Create the underlying pool if config was passed, or use existing pool-like object
  const pool = isPoolLike(poolOrConfig)
    ? poolOrConfig
    : new Pool(typeof poolOrConfig === 'string' ? { connectionString: poolOrConfig } : poolOrConfig);

  const config: QueryIdConfig = {
    enabled: true,
    ...queryIdConfig,
  };

  const log: LogFn = config.debug && config.logger
    ? config.logger.debug.bind(config.logger)
    : config.debug
      ? console.debug.bind(console, '[prisma-query-ids]')
      : () => {};

  const modifyQuery = createModifyQuery(config, log);

  // Create a proxy to intercept query methods
  const trackedPool = new Proxy(pool, {
    get(target, prop, receiver) {
      // Mark as tracked pool
      if (prop === '__isTrackedPool') {
        return true;
      }

      // Intercept query method
      if (prop === 'query') {
        return function trackedQuery<R extends QueryResultRow = QueryResultRow>(
          queryTextOrConfig: string | QueryConfig,
          valuesOrCallback?: unknown[] | ((err: Error, result: QueryResult<R>) => void),
          callback?: (err: Error, result: QueryResult<R>) => void
        ): Promise<QueryResult<R>> | void {
          // Handle callback-style queries
          if (typeof valuesOrCallback === 'function') {
            const modifiedQuery = modifyQuery.modifyString(queryTextOrConfig as string);
            return target.query(
              modifiedQuery,
              valuesOrCallback as (err: Error, result: QueryResult<R>) => void
            );
          }

          if (callback !== undefined) {
            const modifiedQuery = modifyQuery.modifyString(queryTextOrConfig as string);
            return target.query(
              modifiedQuery,
              valuesOrCallback as unknown[],
              callback
            );
          }

          if (valuesOrCallback !== undefined) {
            const modifiedQuery = typeof queryTextOrConfig === 'string'
              ? modifyQuery.modifyString(queryTextOrConfig)
              : modifyQuery.modifyQueryConfig(queryTextOrConfig);
            return target.query(modifiedQuery, valuesOrCallback as unknown[]);
          }

          const modifiedQuery = modifyQuery.modify(queryTextOrConfig);
          return target.query(modifiedQuery);
        };
      }

      // Intercept connect to wrap the client
      if (prop === 'connect') {
        return async function trackedConnect(): Promise<TrackedPoolClient> {
          const client = await target.connect();
          return createTrackedClient(client, config, log);
        };
      }

      // For all other properties, return the original
      const value = Reflect.get(target, prop, receiver);

      // Bind functions to the target
      if (typeof value === 'function') {
        return value.bind(target);
      }

      return value;
    },
  }) as TrackedPool;

  return trackedPool;
}
