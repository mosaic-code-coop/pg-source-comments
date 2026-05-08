import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatComment,
  prependComment,
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

describe('prependComment', () => {
  it('prepends comment to SQL query', () => {
    const sql = 'SELECT * FROM users';
    const comment = '/* src/api.ts:42 */';
    const result = prependComment(sql, comment);
    expect(result).toBe('/* src/api.ts:42 */ SELECT * FROM users');
  });

  it('handles queries with leading whitespace', () => {
    const sql = '  SELECT * FROM users';
    const comment = '/* src/api.ts:42 */';
    const result = prependComment(sql, comment);
    expect(result).toBe('/* src/api.ts:42 */   SELECT * FROM users');
  });

  it('handles empty queries', () => {
    const sql = '';
    const comment = '/* src/api.ts:42 */';
    const result = prependComment(sql, comment);
    expect(result).toBe('/* src/api.ts:42 */ ');
  });
});
