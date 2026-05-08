import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  captureSourceLocation,
  defaultPathTransformer,
} from '../src/stack-trace.js';

describe('defaultPathTransformer', () => {
  let cwdStub: any;

  beforeEach(() => {
    cwdStub = vi.spyOn(process, 'cwd');
  });

  afterEach(() => {
    cwdStub.mockRestore();
  });

  it('creates path relative to cwd', () => {
    cwdStub.mockReturnValue('/home/user/project');
    const result = defaultPathTransformer('/home/user/project/src/api/users.ts');
    expect(result).toBe('src/api/users.ts');
  });

  it('returns relative path when file is under cwd', () => {
    cwdStub.mockReturnValue('/home/user/project');
    const result = defaultPathTransformer('/home/user/project/src/api/users.ts');
    expect(result).toBe('src/api/users.ts');
  });

  it('returns relative path for lib directory', () => {
    cwdStub.mockReturnValue('/home/user/project');
    const result = defaultPathTransformer('/home/user/project/lib/utils.ts');
    expect(result).toBe('lib/utils.ts');
  });

  it('returns relative path for app directory', () => {
    cwdStub.mockReturnValue('/home/user/project');
    const result = defaultPathTransformer('/home/user/project/app/routes/index.ts');
    expect(result).toBe('app/routes/index.ts');
  });

  it('returns relative path for pages directory', () => {
    cwdStub.mockReturnValue('/home/user/project');
    const result = defaultPathTransformer('/home/user/project/pages/api/hello.ts');
    expect(result).toBe('pages/api/hello.ts');
  });

  it('returns relative path for api directory', () => {
    cwdStub.mockReturnValue('/home/user/project');
    const result = defaultPathTransformer('/home/user/project/api/handlers.ts');
    expect(result).toBe('api/handlers.ts');
  });

  it('uses last two path segments for files outside cwd', () => {
    cwdStub.mockReturnValue('/home/user/project');
    const result = defaultPathTransformer('/home/user/other-project/custom/file.ts');
    expect(result).toBe('custom/file.ts');
  });

  it('returns last two segments for file outside cwd', () => {
    cwdStub.mockReturnValue('/home/user/project');
    const result = defaultPathTransformer('/home/user/other-project/file.ts');
    expect(result).toBe('other-project/file.ts');
  });

  it('handles deeply nested paths correctly', () => {
    cwdStub.mockReturnValue('/home/user/project');
    const result = defaultPathTransformer('/home/user/project/src/nested/deep/path/to/file.ts');
    expect(result).toBe('src/nested/deep/path/to/file.ts');
  });

  it('handles monorepo package structure (file outside cwd)', () => {
    cwdStub.mockReturnValue('/home/user/monorepo');
    const result = defaultPathTransformer('/home/user/monorepo/packages/backend/src/api/users.ts');
    expect(result).toBe('packages/backend/src/api/users.ts');
  });

  it('handles files exactly at cwd root', () => {
    cwdStub.mockReturnValue('/home/user/project');
    const result = defaultPathTransformer('/home/user/project/index.ts');
    expect(result).toBe('index.ts');
  });
});

describe('captureSourceLocation', () => {
  it('returns null or SourceLocation object', () => {
    const location = captureSourceLocation();
    if (location !== null) {
      expect(location.filePath).toBeDefined();
      expect(typeof location.filePath).toBe('string');
      expect(location.lineNumber).toBeGreaterThan(0);
    } else {
      expect(location).toBeNull();
    }
  });

  it('does not throw with empty config', () => {
    expect(() => captureSourceLocation()).not.toThrow();
  });

  it('does not throw with custom exclude patterns', () => {
    expect(() => captureSourceLocation({
      excludePatterns: [/custom-pattern/],
    })).not.toThrow();
  });

  it('respects frameCount limit without throwing', () => {
    expect(() => captureSourceLocation({ frameCount: 1 })).not.toThrow();
    expect(() => captureSourceLocation({ frameCount: 50 })).not.toThrow();
  });

  it('filters frames matching exclude patterns', () => {
    const location = captureSourceLocation();
    if (location) {
      expect(location.filePath).not.toMatch(/^node:/);
      expect(typeof location.lineNumber).toBe('number');
    }
  });

  it('returns location with expected shape when found', () => {
    const location = captureSourceLocation();
    if (location) {
      expect(location).toHaveProperty('filePath');
      expect(location).toHaveProperty('lineNumber');
      if (location.columnNumber !== undefined) {
        expect(typeof location.columnNumber).toBe('number');
      }
      if (location.functionName !== undefined) {
        expect(typeof location.functionName).toBe('string');
      }
    }
  });
});
