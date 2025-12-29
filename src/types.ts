import type { Pool, PoolClient } from 'pg';

export interface CallSiteInfo {
  functionName: string | null;
  scriptName: string | null;
  lineNumber: number;
  columnNumber: number;
}

export interface SourceLocation {
  filePath: string;
  lineNumber: number;
  columnNumber?: number;
  functionName?: string;
}

export interface QueryIdConfig {
  /**
   * Whether to include the function name in the comment
   * @default false
   */
  includeFunctionName?: boolean;

  /**
   * Whether to include the column number
   * @default false
   */
  includeColumn?: boolean;

  /**
   * Custom path transformer (e.g., to make paths relative to project root)
   * @default strips everything before 'src/' or project root
   */
  pathTransformer?: (fullPath: string) => string;

  /**
   * Additional patterns to exclude from stack trace (beyond node_modules)
   * @default []
   */
  excludePatterns?: (string | RegExp)[];

  /**
   * Whether the library is enabled (useful for disabling in production)
   * @default true
   */
  enabled?: boolean;

  /**
   * Number of stack frames to capture
   * @default 20
   */
  frameCount?: number;

  /**
   * Logger for debugging
   */
  logger?: {
    debug: (message: string, ...args: unknown[]) => void;
  };

  /**
   * Enable debug logging
   * @default false
   */
  debug?: boolean;
}

export interface TrackedPool extends Pool {
  readonly __isTrackedPool: true;
}

export interface TrackedPoolClient extends PoolClient {
  readonly __isTrackedClient: true;
}
