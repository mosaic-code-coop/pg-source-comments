import path from 'node:path';
import { getCallSites } from 'node:util';
import type { CallSiteInfo, SourceLocation, SourceCommentConfig } from './types.js';

// Default patterns to exclude from stack traces
const DEFAULT_EXCLUDE_PATTERNS: RegExp[] = [
  /node_modules/,
  /@prisma/,
  /prisma-client/,
  /pg-source-comments[\\/](?:src|dist)[\\/]/,
  /^node:/,
  /^internal\//,
];

/**
 * Captures the current call stack and returns the first user-code frame.
 * Uses util.getCallSites() with sourceMap support for accurate TS locations.
 */
export function captureSourceLocation(config: SourceCommentConfig = {}): SourceLocation | null {
  const {
    excludePatterns = [],
    frameCount = 20,
  } = config;

  // Combine default and custom exclude patterns
  const allExcludePatterns = [
    ...DEFAULT_EXCLUDE_PATTERNS,
    ...excludePatterns.map(p => typeof p === 'string' ? new RegExp(p) : p),
  ];

  let callSites: CallSiteInfo[];

  try {
    callSites = getCallSites({ sourceMap: true }) as CallSiteInfo[];
  } catch (error) {
    // Fallback if getCallSites is not available
    return null;
  }

  // Limit to requested frame count
  const limitedSites = callSites.slice(0, frameCount);

  // Find first frame that isn't excluded
  for (const site of limitedSites) {
    const scriptName = site.scriptName;

    // Skip frames without a script name
    if (!scriptName) continue;

    // Check if this frame matches any exclude pattern
    const isExcluded = allExcludePatterns.some(pattern => pattern.test(scriptName));

    if (!isExcluded) {
      return {
        filePath: scriptName,
        lineNumber: site.lineNumber,
        columnNumber: site.columnNumber,
        functionName: site.functionName || undefined,
      };
    }
  }

  return null;
}

/**
 * Default path transformer that creates a clean relative path from cwd
 */
export function defaultPathTransformer(fullPath: string): string {
  try {
    const cwd = process.cwd();
    const relative = path.relative(cwd, fullPath);

    // If path is outside cwd (monorepo, node_modules), use filename + parent dir
    if (relative.startsWith('..')) {
      const parts = fullPath.split(path.sep);
      return parts.length >= 2 ? parts.slice(-2).join(path.sep) : path.basename(fullPath);
    }

    return relative;
  } catch {
    // Fallback on error
    const parts = fullPath.split(path.sep);
    return parts.length >= 2 ? parts.slice(-2).join(path.sep) : fullPath;
  }
}
