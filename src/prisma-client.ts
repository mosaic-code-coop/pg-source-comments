import type { SourceCommentConfig, SourceLocation } from './types.js';
import { captureSourceLocation } from './stack-trace.js';
import { locationStore } from './location-store.js';

/**
 * Client methods that run queries. Model delegate methods (findMany, create, ...)
 * are wrapped as well.
 */
const QUERY_METHODS = new Set([
  '$queryRaw',
  '$executeRaw',
  '$queryRawUnsafe',
  '$executeRawUnsafe',
  '$queryRawTyped',
  '$transaction',
]);

const PROMISE_METHODS = ['then', 'catch', 'finally'] as const;

type AnyFunction = (...args: unknown[]) => unknown;

/**
 * Wraps a Prisma client so its queries carry the source location of the calling code.
 *
 * Prisma runs queries after an async hop, so by the time they reach the pg pool the
 * caller is no longer on the call stack. This captures the location when a model or
 * raw-query method is called, and makes it available to the tracked pool.
 * Use together with createTrackedPool().
 */
export function trackPrismaClient<T extends object>(client: T, config: SourceCommentConfig = {}): T {
  if (config.enabled === false) {
    return client;
  }

  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (prop === '$extends' && typeof value === 'function') {
        return (...args: unknown[]) => trackPrismaClient(value.apply(target, args), config);
      }

      if (prop === '$transaction' && typeof value === 'function') {
        return wrapQueryMethod((...args: unknown[]) => {
          const [callbackOrQueries, ...rest] = args;
          if (typeof callbackOrQueries !== 'function') {
            return value.apply(target, args);
          }
          // Interactive transaction: track the transaction client passed to the callback
          const trackedCallback = (transactionClient: object) =>
            callbackOrQueries(trackPrismaClient(transactionClient, config));
          return value.apply(target, [trackedCallback, ...rest]);
        }, config);
      }

      if (typeof prop === 'string' && QUERY_METHODS.has(prop) && typeof value === 'function') {
        return wrapQueryMethod(value.bind(target) as AnyFunction, config);
      }

      if (isModelDelegate(prop, value)) {
        return trackModelDelegate(value, config);
      }

      return value;
    },
  });
}

function isModelDelegate(prop: string | symbol, value: unknown): value is object {
  return (
    typeof prop === 'string' &&
    !prop.startsWith('$') &&
    !prop.startsWith('_') &&
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { findMany?: unknown }).findMany === 'function'
  );
}

function trackModelDelegate(delegate: object, config: SourceCommentConfig): object {
  return new Proxy(delegate, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? wrapQueryMethod(value.bind(target) as AnyFunction, config) : value;
    },
  });
}

/**
 * Captures the caller's location (it is on the stack only during this synchronous call)
 * and runs the query, eagerly or lazily, with that location in the location store
 */
function wrapQueryMethod(method: AnyFunction, config: SourceCommentConfig): AnyFunction {
  return (...args: unknown[]) => {
    const location = captureSourceLocation(config);
    if (!location) {
      return method(...args);
    }

    const result = locationStore.run(location, () => method(...args));
    if (isThenable(result)) {
      runSettlementInLocation(result, location);
    }
    return result;
  };
}

function isThenable(value: unknown): value is Record<(typeof PROMISE_METHODS)[number], AnyFunction> {
  return typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';
}

/**
 * Prisma promises are lazy: the query runs in the async context that calls then().
 * Rebinds then/catch/finally on the same object (batch $transaction relies on the
 * promise's identity and internals) so they run with the captured location.
 */
function runSettlementInLocation(
  promise: Record<(typeof PROMISE_METHODS)[number], AnyFunction>,
  location: SourceLocation
): void {
  for (const methodName of PROMISE_METHODS) {
    const original = promise[methodName];
    if (typeof original !== 'function') {
      continue;
    }
    promise[methodName] = (...args: unknown[]) => locationStore.run(location, () => original.apply(promise, args));
  }
}
