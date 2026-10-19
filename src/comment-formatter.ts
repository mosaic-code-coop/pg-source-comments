import type { SourceLocation, SourceCommentConfig } from './types.js';
import { defaultPathTransformer } from './stack-trace.js';

/**
 * Formats a source location into a SQL comment
 * Default format shows path and line number, with optional column and function name
 */
export function formatComment(
  location: SourceLocation,
  config: SourceCommentConfig = {}
): string {
  const {
    includeFunctionName = false,
    includeColumn = false,
    pathTransformer = defaultPathTransformer,
  } = config;

  const path = pathTransformer(location.filePath);
  const line = location.lineNumber;
  const column = location.columnNumber;
  const fn = location.functionName;

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
 * Inserts a comment into a SQL query string, directly after the first keyword
 * (e.g. `SELECT /* src/api.ts:42 *\/ * FROM users`).
 *
 * Placing it after the first keyword keeps it near the start, so it survives log
 * truncation, while also surviving PostgreSQL 18+, which drops leading comments from
 * the query text stored in pg_stat_statements. Falls back to prepending when the
 * query has no keyword (e.g. an empty string).
 */
export function insertComment(sql: string, comment: string): string {
  const keywordEnd = findFirstKeywordEnd(sql);

  if (keywordEnd === undefined) {
    return `${comment} ${sql}`;
  }

  return `${sql.slice(0, keywordEnd)} ${comment}${sql.slice(keywordEnd)}`;
}

/**
 * Returns the index just past the first keyword, skipping leading whitespace,
 * opening parentheses and comments. Returns undefined if no keyword is found.
 */
function findFirstKeywordEnd(sql: string): number | undefined {
  let index = 0;

  while (index < sql.length) {
    const char = sql[index];

    if (/\s/.test(char) || char === '(') {
      index += 1;
    } else if (sql.startsWith('/*', index)) {
      const commentEnd = sql.indexOf('*/', index + 2);
      if (commentEnd === -1) {
        return undefined;
      }
      index = commentEnd + 2;
    } else if (sql.startsWith('--', index)) {
      const lineEnd = sql.indexOf('\n', index + 2);
      if (lineEnd === -1) {
        return undefined;
      }
      index = lineEnd + 1;
    } else if (/[A-Za-z_]/.test(char)) {
      const wordMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(sql.slice(index));
      return index + wordMatch![0].length;
    } else {
      return undefined;
    }
  }

  return undefined;
}
