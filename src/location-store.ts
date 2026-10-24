import { AsyncLocalStorage } from 'node:async_hooks';
import type { SourceLocation } from './types.js';

/**
 * Source location of the ORM call currently running. Set by trackPrismaClient()
 * and read by the pool wrapper when the query's own call stack has no user code.
 */
export const locationStore = new AsyncLocalStorage<SourceLocation>();
