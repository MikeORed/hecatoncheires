# Tech Stack & Build System

## Runtime & Language

- **Node.js 20 LTS** (`.nvmrc`)
- **TypeScript ^5.5** — strict mode, `noImplicitAny`, `strictNullChecks`, `noUnusedLocals`, `noUnusedParameters`
- **ESM-only** — all packages set `"type": "module"`, module resolution is `Node16`

## Package Manager

- **pnpm 9.x** with workspaces (`packages/*`)
- Cross-package references use `workspace:*` protocol

## Key Dependencies

| Package | Used In | Purpose |
|---|---|---|
| zod ^3.23 | core | Schema validation (core's only external dep) |
| aws-cdk-lib ^2.258.0 | cdk | Infrastructure as code |
| constructs ^10.0 | cdk | CDK peer dependency |
| @aws-sdk/* ^3 | api | DynamoDB, IAM, EventBridge, CloudWatch clients |
| esbuild ^0.21 | api | Lambda handler bundling |

## Dev Dependencies (root)

| Tool | Version | Purpose |
|---|---|---|
| TypeScript | ^5.5 | Compiler |
| Vitest | ^4.1 | Test runner (all packages) |
| ESLint | ^8.57 | Linting with `@typescript-eslint` + `import` plugins |
| Prettier | ^3.9 | Code formatting |

## Code Style

- **Prettier**: single quotes, trailing commas, 100 char print width, semicolons
- **ESLint**: `@ts-ignore`/`@ts-expect-error` banned, `no-explicit-any` is an error, deep subpath imports into workspace packages are blocked

## Common Commands

Run from workspace root:

```bash
# Build all packages (sequential, respects dependency order)
pnpm build

# Run all tests
pnpm test

# Lint all TypeScript in packages/
pnpm lint

# Format all TypeScript
pnpm format

# Check formatting without writing
pnpm format:check

# Clean all build artifacts
pnpm clean
```

Per-package (from within a package directory or via filter):

```bash
# Build a single package
pnpm --filter @hecaton/core build

# Test a single package
pnpm --filter @hecaton/api test

# CDK synth
pnpm --filter @hecaton/cdk synth

# CDK deploy
pnpm --filter @hecaton/cdk deploy --all
```

## TypeScript Configuration

Shared base config (`tsconfig.base.json`):
- Target: ES2022
- Module: Node16 / Node16 resolution
- Composite project references for incremental builds
- Declaration maps and source maps enabled

Each package extends the base and adds `references` to its dependencies (e.g., `api` and `cdk` reference `core`).

## Testing

- **Runner**: Vitest 4.x, native ESM
- **Convention**: Co-located test files (`foo.test.ts` beside `foo.ts`)
- **Core tests**: Pure unit tests, no mocks — pass data in, assert output
- **API tests**: Mock adapters at the boundary
- **CDK tests**: `Template.fromStack()` assertion tests
- **Cross-package**: Integration tests in root `test/` folder
