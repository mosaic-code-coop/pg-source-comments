import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatComment,
  insertComment,
} from '../src/comment-formatter.js';
import type { SourceLocation } from '../src/types.js';

describe('formatComment', () => {
  let cwdStub: any;

  beforeEach(() => {
    cwdStub = vi.spyOn(process, 'cwd').mockReturnValue('/home/user/project');
  });

  afterEach(() => {
    cwdStub.mockRestore();
  });

  const baseLocation: SourceLocation = {
    filePath: '/home/user/project/src/api/users.ts',
    lineNumber: 42,
    columnNumber: 10,
    functionName: 'getUser',
  };

  it('formats basic comment with default settings', () => {
    const result = formatComment(baseLocation);
    expect(result).toBe('/* src/api/users.ts:42 */');
  });

  it('includes column number when configured', () => {
    const result = formatComment(baseLocation, { includeColumn: true });
    expect(result).toBe('/* src/api/users.ts:42:10 */');
  });

  it('includes function name when configured', () => {
    const result = formatComment(baseLocation, { includeFunctionName: true });
    expect(result).toBe('/* src/api/users.ts:42 in getUser */');
  });

  it('includes both column and function when configured', () => {
    const result = formatComment(baseLocation, {
      includeColumn: true,
      includeFunctionName: true,
    });
    expect(result).toBe('/* src/api/users.ts:42:10 in getUser */');
  });

  it('uses custom path transformer', () => {
    const result = formatComment(baseLocation, {
      pathTransformer: (path) => path.replace('/home/user/project/', ''),
    });
    expect(result).toBe('/* src/api/users.ts:42 */');
  });

  it('handles location without function name', () => {
    const location: SourceLocation = {
      filePath: '/home/user/project/src/index.ts',
      lineNumber: 1,
    };
    const result = formatComment(location, { includeFunctionName: true });
    expect(result).toBe('/* src/index.ts:1 */');
  });
});

describe('insertComment', () => {
  const comment = '/* src/api.ts:42 */';

  it('inserts comment after the first keyword', () => {
    const result = insertComment('SELECT * FROM users', comment);
    expect(result).toBe('SELECT /* src/api.ts:42 */ * FROM users');
  });

  it('skips leading whitespace, comments and parentheses', () => {
    const sql = '  -- note\n/* existing */ (SELECT a FROM t) UNION (SELECT b FROM u)';
    const result = insertComment(sql, comment);
    expect(result).toBe(
      '  -- note\n/* existing */ (SELECT /* src/api.ts:42 */ a FROM t) UNION (SELECT b FROM u)'
    );
  });

  it('prepends when the query has no keyword', () => {
    const result = insertComment('', comment);
    expect(result).toBe('/* src/api.ts:42 */ ');
  });
});
