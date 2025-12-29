# prisma-query-ids

Prepend SQL queries with source file location comments for Prisma ORM. Debug slow database queries by identifying exactly where they originated in your TypeScript code.

## Features

- **Works with ALL queries** - Both ORM queries (`findMany`, `create`, etc.) and raw queries (`$queryRaw`, `$executeRaw`)
- **TypeScript source locations** - Uses source maps to show original `.ts` file paths, not compiled `.js`
- **Prepends comments** - Comments appear at the start of queries, avoiding truncation in database logs
- **Prisma v7 compatible** - Uses driver adapters for modern Prisma versions
- **Zero runtime overhead** when disabled - Can be toggled off for production
- **Configurable** - Customize path display, include function names, and more

## Requirements

- Node.js 22.9.0+ (for `util.getCallSites()` with source map support)
- Prisma 5.0.0+ (for driver adapter support)
- Run with `--enable-source-maps` for accurate TypeScript locations

## Installation

```bash
npm install prisma-query-ids pg @prisma/adapter-pg
```

## Quick Start

```typescript
// src/prisma.ts
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createTrackedPool } from 'prisma-query-ids';

// Create a tracked pool
const pool = createTrackedPool(process.env.DATABASE_URL!, {
  enabled: process.env.NODE_ENV !== 'production',
});

// Create Prisma with the tracked pool
const adapter = new PrismaPg(pool);
export const prisma = new PrismaClient({ adapter });
```

Run your app with source maps enabled:

```bash
node --enable-source-maps dist/index.js
```

Queries in your database logs will now include source locations:

```sql
/* src/api/users.ts:45 */ SELECT "id", "name" FROM "User" WHERE "id" = $1
/* src/services/auth.ts:123 */ UPDATE "Session" SET "lastActive" = $1 WHERE "userId" = $2
```

## How It Works

The library wraps the `pg` Pool at the driver level. When Prisma executes any query (ORM or raw), it passes through the underlying `pg` driver, where we:

1. Capture the call stack using `util.getCallSites()`
2. Find the first frame that's user code (not in `node_modules` or Prisma internals)
3. Map the location back to TypeScript source using source maps
4. Prepend a SQL comment with the file path and line number

```
User Code → PrismaClient → @prisma/adapter-pg → TrackedPool → pg → PostgreSQL
                                                          ↑
                                              Intercept & prepend comment
```

## Configuration Options

```typescript
const pool = createTrackedPool(process.env.DATABASE_URL!, {
  // Enable/disable query tracking (default: true)
  enabled: true,

  // Customize how file paths are displayed
  pathTransformer: (fullPath) => {
    // Make paths relative to project root
    return fullPath.replace('/home/user/myapp/', '');
  },

  // Include function name in comment (default: false)
  includeFunctionName: true,

  // Include column number in comment (default: false)
  includeColumn: true,

  // Additional patterns to exclude from stack trace
  excludePatterns: [/__tests__/, /mock-data/],

  // Number of stack frames to capture (default: 20)
  frameCount: 50,

  // Enable debug logging
  debug: true,
  logger: {
    debug: console.debug,
  },
});
```

### Comment Format

Default format: `/* path:line */`

With `includeFunctionName: true`: `/* path:line in functionName */`

With `includeColumn: true`: `/* path:line:column */`

You can also specify a custom format:

```typescript
const pool = createTrackedPool(process.env.DATABASE_URL!, {
  commentFormat: '-- {path}:{line}',
});
```

Available placeholders: `{path}`, `{line}`, `{column}`, `{function}`

## Transaction Support

Queries within transactions are automatically tracked:

```typescript
await prisma.$transaction(async (tx) => {
  // Each query gets its own source location
  const user = await tx.user.findUnique({ where: { id: 1 } });
  await tx.post.create({ data: { title: 'Hello', authorId: user.id } });
});
```

Database sees:
```sql
/* src/routes/user.ts:67 */ BEGIN
/* src/routes/user.ts:69 */ SELECT ... FROM "User" ...
/* src/routes/user.ts:70 */ INSERT INTO "Post" ...
/* src/routes/user.ts:67 */ COMMIT
```

## TypeScript Setup

For accurate source locations, ensure your `tsconfig.json` has:

```json
{
  "compilerOptions": {
    "sourceMap": true
  }
}
```

And run with source maps enabled:

```bash
# Option 1: Node.js flag
node --enable-source-maps dist/index.js

# Option 2: Using tsx
tsx src/index.ts

# Option 3: Using ts-node
ts-node --esm src/index.ts
```

## API Reference

### `createTrackedPool(poolOrConfig, queryIdConfig)`

Creates a wrapped `pg` Pool that prepends source location comments to all queries.

**Parameters:**

- `poolOrConfig` - An existing `Pool` instance, `PoolConfig` object, or connection string
- `queryIdConfig` - Configuration options (optional)

**Returns:** A `TrackedPool` that behaves like a standard `pg` Pool

### Type Exports

```typescript
import type {
  QueryIdConfig,
  SourceLocation,
  TrackedPool,
  TrackedPoolClient,
} from 'prisma-query-ids';
```

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Type check
npm run typecheck

# Build
npm run build
```

## Why Prepend Instead of Append?

Database query logs often truncate long queries. Appending comments at the end means they get cut off. Prepending ensures the source location is always visible, even when the query itself is truncated.

## License

MIT
