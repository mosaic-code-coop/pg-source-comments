import type { SourceLocation, QueryIdConfig } from './types.js';
import { defaultPathTransformer } from './stack-trace.js';

/**
 * Sanitizes values that might appear in comments to prevent SQL injection
 */
export function sanitizeForComment(value: string): string {
  return value
    .replace(/\*\//g, '')
    .replace(/\/\*/g, '')
    .replace(/[\r\n]/g, ' ');
}

/**
 * Formats a source location into a SQL comment
 * Default format shows path and line number, with optional column and function name
 */
export function formatComment(
  location: SourceLocation,
  config: QueryIdConfig = {}
): string {
  const {
    includeFunctionName = false,
    includeColumn = false,
    pathTransformer = defaultPathTransformer,
  } = config;

  const path = sanitizeForComment(pathTransformer(location.filePath));
  const line = location.lineNumber;
  const column = location.columnNumber;
  const fn = location.functionName ? sanitizeForComment(location.functionName) : undefined;

  // Build comment: /* path:line[:column] [in function] */
  let comment = `/* ${path}:${line}`;

  if (includeColumn && column !== undefined) {
    comment += `:${column}`;
  }

  if (includeFunctionName && fn) {
    comment += ` in ${fn}`;
  }

  comment += ' */';

  return comment;
}

/**
 * Prepends a comment to a SQL query string
 */
export function prependComment(sql: string, comment: string): string {
  return `${comment} ${sql}`;
}
