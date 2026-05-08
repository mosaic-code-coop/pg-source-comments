import { Pool, PoolClient, PoolConfig, QueryConfig, QueryResult, QueryResultRow } from 'pg';
import type { SourceCommentConfig, TrackedPool, TrackedPoolClient } from './types.js';
import { captureSourceLocation } from './stack-trace.js';
import { formatComment, prependComment } from './comment-formatter.js';

/**
 * Modifies a query by prepending a source location comment
 */
function modifyQuery(
  query: string | QueryConfig,
  config: SourceCommentConfig
): string | QueryConfig {
  if (config.enabled === false) {
    return query;
  }

  const location = captureSourceLocation(config);
  if (!location) {
    return query;
  }

  const comment = formatComment(location, config);

  if (typeof query === 'string') {
    return prependComment(query, comment);
  }

  return {
    ...query,
    text: prependComment(query.text, comment),
  };
}

/**
 * Creates a wrapped query function that prepends source comments
 */
function createTrackedQueryFn<T extends { query: Pool['query'] | PoolClient['query'] }>(
  target: T,
  config: SourceCommentConfig
) {
  return function trackedQuery<R extends QueryResultRow = QueryResultRow>(
    queryTextOrConfig: string | QueryConfig,
    valuesOrCallback?: unknown[] | ((err: Error, result: QueryResult<R>) => void),
    callback?: (err: Error, result: QueryResult<R>) => void
  ): Promise<QueryResult<R>> | void {
    // Callback as second arg: query(text, callback)
    if (typeof valuesOrCallback === 'function') {
      const modified = modifyQuery(queryTextOrConfig as string, config) as string;
      return target.query(
        modified,
        valuesOrCallback as (err: Error, result: QueryResult<R>) => void
      );
    }

    // Callback as third arg: query(text, values, callback)
    if (callback !== undefined) {
      const modified = modifyQuery(queryTextOrConfig as string, config) as string;
      return target.query(modified, valuesOrCallback as unknown[], callback);
    }

    // Values array: query(text, values) or query(config, values)
    if (valuesOrCallback !== undefined) {
      const modified = modifyQuery(queryTextOrConfig, config);
      return target.query(modified, valuesOrCallback as unknown[]);
    }

    // Simple: query(text) or query(config)
    const modified = modifyQuery(queryTextOrConfig, config);
    return target.query(modified);
  };
}

/**
 * Wraps a PoolClient to track queries within transactions
 */
function createTrackedClient(
  client: PoolClient,
  config: SourceCommentConfig
): TrackedPoolClient {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === '__isTrackedClient') {
        return true;
      }

      if (prop === 'query') {
        return createTrackedQueryFn(target, config);
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
  config: SourceCommentConfig = {}
): TrackedPool {
  // Create the underlying pool if config was passed, or use existing pool-like object
  const pool = isPoolLike(poolOrConfig)
    ? poolOrConfig
    : new Pool(typeof poolOrConfig === 'string' ? { connectionString: poolOrConfig } : poolOrConfig);

  const mergedConfig: SourceCommentConfig = {
    enabled: true,
    ...config,
  };

  // Create a proxy to intercept query methods
  return new Proxy(pool, {
    get(target, prop, receiver) {
      if (prop === '__isTrackedPool') {
        return true;
      }

      if (prop === 'query') {
        return createTrackedQueryFn(target, mergedConfig);
      }

      if (prop === 'connect') {
        return async function trackedConnect(): Promise<TrackedPoolClient> {
          const client = await target.connect();
          return createTrackedClient(client, mergedConfig);
        };
      }

      const value = Reflect.get(target, prop, receiver);

      if (typeof value === 'function') {
        return value.bind(target);
      }

      return value;
    },
  }) as TrackedPool;
}
