# Implementation Plan: Initial Project Setup

## Overview

Scaffold the Hecatoncheires monorepo as a pnpm workspace with four packages (`@hecaton/core`, `@hecaton/api`, `@hecaton/cdk`, `@hecaton/web`), shared TypeScript/ESLint/Prettier tooling, CI workflow stubs, and Vitest workspace configuration. The end state is a green build: `pnpm install && pnpm build && pnpm test && pnpm lint` all exit 0 on an empty but correctly-typed skeleton.

## Tasks

- [ ] 1. Set up workspace root configuration
  - [x] 1.1 Create root package.json, pnpm-workspace.yaml, .nvmrc, and .gitignore
    - Run `git init` at the workspace root to initialize the repository
    - Create `pnpm-workspace.yaml` with `packages: ['packages/*']`
    - Create root `package.json` marked `private: true` with `name: "hecatoncheires"`, scripts for `build`, `test`, `lint`, `format`, `format:check`, and `clean` that delegate to workspace packages
    - `build` script: `pnpm -r --workspace-concurrency=1 run build`
    - `test` script: `vitest run --workspace vitest.workspace.ts`
    - `lint` script: `eslint --ext .ts packages/`
    - `format` script: `prettier --write "packages/**/*.ts"`
    - `format:check` script: `prettier --check "packages/**/*.ts"`
    - `clean` script: `pnpm -r run clean`
    - Create `.nvmrc` with `20`
    - Create `.gitignore` excluding `node_modules/`, `dist/`, `cdk.out/`, `.cdk.staging/`, `*.tsbuildinfo`, `coverage/`, `.env`, `.env.*`
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ] 1.2 Create tsconfig.base.json with strict compiler options
    - Set `target: ES2022`, `module: Node16`, `moduleResolution: Node16`, `lib: ["ES2022"]`
    - Enable all strict options: `strict`, `noImplicitAny`, `strictNullChecks`, `noUnusedLocals`, `noUnusedParameters`
    - Enable incremental build: `composite: true`, `incremental: true`
    - Enable declarations: `declaration`, `declarationMap`, `sourceMap`
    - Set interop: `skipLibCheck`, `esModuleInterop`, `forceConsistentCasingInFileNames`, `resolveJsonModule`, `isolatedModules`
    - Set `outDir: "./dist"` and `rootDir: "./src"`
    - _Requirements: 2.1, 2.2, 2.3, 12.5_

  - [ ] 1.3 Create shared ESLint configuration with import boundary rules
    - Install and configure `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`, `eslint-plugin-import`
    - Enforce import boundary rules via `no-restricted-imports` or `eslint-plugin-import` restricted patterns:
      - `@hecaton/core` cannot import from `@hecaton/api`, `@hecaton/cdk`, `@hecaton/web`
      - `@hecaton/api` cannot import from `@hecaton/cdk`, `@hecaton/web`
      - `@hecaton/cdk` cannot import from `@hecaton/api`, `@hecaton/web`
      - `@hecaton/web` cannot import from `@hecaton/api`, `@hecaton/cdk`
    - Block subpath imports into any workspace package (e.g., `@hecaton/core/domain/...`)
    - Allow `@hecaton/api`, `@hecaton/cdk`, `@hecaton/web` to import `@hecaton/core` via bare specifier
    - Add rule to disallow `@ts-ignore`, `@ts-expect-error`, and explicit `any` annotations
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.9, 12.6_

  - [ ] 1.4 Create .prettierrc and Vitest workspace configuration
    - Create `.prettierrc` with shared formatting rules (singleQuote, trailingComma, printWidth, semi)
    - Create `vitest.workspace.ts` referencing all four packages with test glob `**/*.test.ts`
    - _Requirements: 3.8, 11.1, 11.2, 11.3, 11.4_

- [ ] 2. Scaffold @hecaton/core package
  - [ ] 2.1 Create core package.json, tsconfig.json, and directory structure
    - Create `packages/core/package.json` with name `@hecaton/core`, version `0.0.1`, `type: "module"`
    - Set `main: "./dist/public-api.js"`, `types: "./dist/public-api.d.ts"`
    - Set `exports: { ".": { "types": "./dist/public-api.d.ts", "import": "./dist/public-api.js" } }`
    - Add scripts: `build: "tsc --build"`, `test: "vitest run"`, `lint: "eslint src/"`, `clean: "rm -rf dist *.tsbuildinfo"`
    - Add `dependencies: { "zod": "^3.23" }` — no AWS SDK or CDK deps
    - Create `packages/core/tsconfig.json` extending `../../tsconfig.base.json` with `composite: true`
    - Create directory structure under `src/`: `schemas/`, `types/`, `entity/`, `errors/`, `constants/`, `config/`, `shared/algorithms/`, `validators/`, `test-generators/`, `domain/identity/`, `domain/capability/`, `domain/telemetry/`, `domain/signals/`, `domain/fleet/` — each with `.gitkeep`
    - Create `src/public-api.ts` as a valid empty barrel export (e.g., `export {};`)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 8.1_

- [ ] 3. Scaffold @hecaton/api package
  - [ ] 3.1 Create api package.json, tsconfig.json, and directory structure
    - Create `packages/api/package.json` with name `@hecaton/api`, version `0.0.1`, `type: "module"`
    - Add scripts: `build: "tsc --build"`, `test: "vitest run"`, `lint: "eslint src/"`, `clean: "rm -rf dist *.tsbuildinfo"`
    - Add `dependencies`: `@hecaton/core: "workspace:*"`, `@aws-sdk/client-dynamodb: "^3"`, `@aws-sdk/client-iam: "^3"`, `@aws-sdk/client-eventbridge: "^3"`, `@aws-sdk/client-cloudwatch: "^3"`, `esbuild: "^0.21"`
    - Create `packages/api/tsconfig.json` extending `../../tsconfig.base.json` with `composite: true` and project reference to `../core`
    - Create directory structure under `src/`: `handlers/`, `use-cases/`, `adapters/http/dto/`, `adapters/dynamo/dto/`, `adapters/iam/`, `adapters/eventbridge/dto/`, `adapters/appconfig/`, `adapters/cloudwatch/` — each leaf with `.gitkeep`
    - Create `src/public-api.ts` as a valid empty barrel export
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 8.2_

- [ ] 4. Scaffold @hecaton/cdk package
  - [ ] 4.1 Create cdk package.json, tsconfig.json, cdk.json, and directory structure
    - Create `packages/cdk/package.json` with name `@hecaton/cdk`, version `0.0.1`, `type: "module"`
    - Add scripts: `build: "tsc --build"`, `test: "vitest run"`, `lint: "eslint lib/ bin/"`, `synth: "cdk synth"`, `clean: "rm -rf dist cdk.out *.tsbuildinfo"`
    - Add `dependencies`: `@hecaton/core: "workspace:*"`, `aws-cdk-lib: "^2.258.0"`, `constructs: "^10.0"`
    - Add `devDependencies`: `aws-cdk: "^2.258.0"`
    - Create `packages/cdk/tsconfig.json` extending `../../tsconfig.base.json` with `rootDir: "."`, `outDir: "./dist"`, project reference to `../core`
    - Create `packages/cdk/cdk.json` with `"app": "npx ts-node bin/app.ts"` (or appropriate CDK entry)
    - Create directory stubs: `bin/`, `lib/stacks/`, `lib/constructs/`, `lib/config/seeds/`, `test/constructs/`, `test/stacks/` — each with `.gitkeep`
    - Create `bin/app.ts` with minimal CDK App instantiation (`#!/usr/bin/env node`, import App from aws-cdk-lib, new App())
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 8.2_

- [ ] 5. Scaffold @hecaton/web package
  - [ ] 5.1 Create web package.json, tsconfig.json, and directory structure
    - Create `packages/web/package.json` with name `@hecaton/web`, version `0.0.1`, `type: "module"`
    - Add scripts: `build: "tsc --build"`, `test: "vitest run"`, `lint: "eslint src/"`, `clean: "rm -rf dist *.tsbuildinfo"`
    - Add `dependencies`: `@hecaton/core: "workspace:*"`
    - Create `packages/web/tsconfig.json` extending `../../tsconfig.base.json` with `composite: true` and project reference to `../core`
    - Create directories: `src/ui/`, `src/state/`, `src/lib/` — each with `.gitkeep`
    - Create `src/public-api.ts` as a valid empty barrel export
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 8.2_

- [ ] 6. Checkpoint - Verify workspace integrity
  - Ensure all tests pass, ask the user if questions arise.
  - Run `pnpm install` and verify exit code 0 with no unresolved workspace references
  - Run `pnpm build` and verify all four packages produce `dist/` directories
  - _Requirements: 1.5, 8.3, 9.1, 9.2_

- [ ] 7. Create CI workflow stubs
  - [ ] 7.1 Create GitHub Actions workflow files for all four packages
    - Create `.github/workflows/core.yml`, `api.yml`, `cdk.yml`, `web.yml`
    - Each workflow triggers on push to `main`
    - Steps in order: checkout, setup Node 20, setup pnpm, `pnpm install --frozen-lockfile`, build, lint, test
    - Use `pnpm install --frozen-lockfile` for deterministic resolution
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [ ] 8. Final validation checkpoint
  - [ ] 8.1 Run full build pipeline and verify green state
    - Execute `pnpm install` → exit 0
    - Execute `pnpm build` → exit 0, all packages have `dist/` with `.js` and `.d.ts` files
    - Execute `pnpm test` → exit 0 (zero tests = pass)
    - Execute `pnpm lint` → exit 0, zero errors, zero warnings
    - Execute `pnpm format:check` → exit 0
    - Verify no `@ts-ignore`, `@ts-expect-error`, or explicit `any` in source files
    - Verify dependency DAG: core has zero workspace deps, api/cdk/web each depend only on core
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 12.1, 12.2, 12.3, 12.4_

## Notes

- No property-based test tasks are included because the design explicitly states PBT is not applicable to this scaffolding spec (infrastructure/config files, no pure functions with varying inputs)
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation of the workspace setup
- Build order is enforced by TypeScript project references and pnpm's workspace-concurrency=1
- All source files use TypeScript strict mode with no suppression comments

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["3.1", "4.1", "5.1"] },
    { "id": 4, "tasks": ["7.1"] },
    { "id": 5, "tasks": ["8.1"] }
  ]
}
```
