# Requirements Document

## Introduction

This document specifies the requirements for scaffolding the Hecatoncheires monorepo — a CDK-deployed AWS governance platform for autonomous agent fleets. The scope covers the initial project structure: pnpm workspace configuration, four packages (`@hecaton/core`, `@hecaton/api`, `@hecaton/cdk`, `@hecaton/web`), shared TypeScript/ESLint/Prettier tooling, CI workflow stubs, and the structural invariants that ensure a buildable, testable, lintable skeleton with zero application logic.

## Glossary

- **Workspace**: The pnpm workspace root that orchestrates all packages, shared scripts, and shared tooling configuration
- **Package**: A discrete unit within the monorepo (`@hecaton/core`, `@hecaton/api`, `@hecaton/cdk`, `@hecaton/web`) with its own `package.json` and `tsconfig.json`
- **Barrel_Export**: A single `public-api.ts` file that re-exports the public interface of a package
- **Import_Boundary**: A lint-enforced rule that restricts which packages may import from which other packages
- **Dependency_DAG**: The directed acyclic graph of compile-time TypeScript import relationships between packages
- **Build_Pipeline**: The sequence of `pnpm install`, `pnpm build`, `pnpm test`, `pnpm lint` commands that validate the project
- **CI_Workflow**: A GitHub Actions workflow file that runs the Build_Pipeline for a specific package on push events
- **Project_References**: TypeScript composite project references that enable incremental builds across packages

## Requirements

### Requirement 1: Workspace Root Configuration

**User Story:** As a developer, I want a properly configured pnpm workspace root, so that all packages are discoverable, shared tooling is centralized, and workspace-wide scripts are available.

#### Acceptance Criteria

1. THE Workspace SHALL contain a `pnpm-workspace.yaml` file declaring `packages: ['packages/*']`
2. THE Workspace SHALL contain a root `package.json` marked `private: true` with scripts for `build`, `test`, `lint`, `format`, and `clean`, where each script delegates execution to all workspace packages via pnpm recursive or workspace-aware tooling
3. THE Workspace SHALL contain a `.nvmrc` file pinning Node.js to version 20 LTS
4. THE Workspace SHALL contain a `.gitignore` file excluding `node_modules/`, `dist/`, `cdk.out/`, `*.tsbuildinfo`, `coverage/`, and `.env` files
5. WHEN `pnpm install` is executed at the Workspace root, THE Workspace SHALL resolve all workspace dependencies and exit with code 0, with no unresolved `workspace:*` protocol references in the lockfile

### Requirement 2: Shared TypeScript Configuration

**User Story:** As a developer, I want a shared strict TypeScript base configuration, so that all packages compile under the same strict rules and support incremental builds.

#### Acceptance Criteria

1. THE Workspace SHALL contain a `tsconfig.base.json` at the repository root with the following compiler options set to `true`: `strict`, `noImplicitAny`, `strictNullChecks`, `noUnusedLocals`, `noUnusedParameters`, `declaration`, `declarationMap`, `sourceMap`, `skipLibCheck`, `esModuleInterop`, `forceConsistentCasingInFileNames`, `resolveJsonModule`, and `isolatedModules`
2. THE Workspace SHALL configure `tsconfig.base.json` with `composite: true` and `incremental: true` for Project References support
3. THE Workspace SHALL configure `tsconfig.base.json` with `target: ES2022`, `module: Node16`, `moduleResolution: Node16`, and `lib: ["ES2022"]`
4. WHEN a Package's `tsconfig.json` extends `tsconfig.base.json`, THE Package SHALL inherit all compiler options from the base configuration and SHALL NOT set any of the following options to a value different from the base: `strict`, `noImplicitAny`, `strictNullChecks`, `noUnusedLocals`, `noUnusedParameters`, `composite`, or `incremental`
5. IF a Package's `tsconfig.json` overrides any of the strict or incremental compiler options listed in criterion 4 to a different value, THEN the lint step SHALL report a configuration violation error

### Requirement 3: Shared Linting and Formatting

**User Story:** As a developer, I want shared ESLint and Prettier configuration with import boundary enforcement, so that code style is consistent and cross-package import violations are caught at lint time.

#### Acceptance Criteria

1. THE Workspace SHALL contain an ESLint configuration that enforces Import_Boundary rules as defined by the Dependency DAG
2. WHEN a source file in `@hecaton/core` imports from `@hecaton/api`, `@hecaton/cdk`, or `@hecaton/web`, THE ESLint configuration SHALL report an error
3. WHEN a source file in `@hecaton/api` imports from `@hecaton/cdk` or `@hecaton/web`, THE ESLint configuration SHALL report an error
4. WHEN a source file in `@hecaton/cdk` imports from `@hecaton/api` or `@hecaton/web`, THE ESLint configuration SHALL report an error
5. WHEN a source file in `@hecaton/web` imports from `@hecaton/api` or `@hecaton/cdk`, THE ESLint configuration SHALL report an error
6. WHEN a source file imports a subpath of any workspace package (e.g., `@hecaton/core/domain/capability/resolve-shape`, `@hecaton/api/handlers/grant-shape`), THE ESLint configuration SHALL report an error regardless of whether the importing package is otherwise permitted to depend on the target package
7. WHEN a source file in `@hecaton/api`, `@hecaton/cdk`, or `@hecaton/web` imports from `@hecaton/core` using the bare package specifier, THE ESLint configuration SHALL NOT report an import boundary error
8. THE Workspace SHALL contain a `.prettierrc` file defining the shared formatting rules, and WHEN `pnpm format:check` is executed on the freshly scaffolded project, THE Build_Pipeline SHALL exit with code 0
9. WHEN `pnpm lint` is executed on the freshly scaffolded project, THE Build_Pipeline SHALL exit with code 0

### Requirement 4: Core Package Structure

**User Story:** As a developer, I want the `@hecaton/core` package scaffolded with the correct directory structure and dependency constraints, so that it serves as a pure domain engine with zero AWS dependencies.

#### Acceptance Criteria

1. THE `@hecaton/core` Package SHALL have `zod` (version ^3.23) as its only runtime dependency in `package.json`, with zero entries referencing any `@aws-sdk/*` or `aws-cdk-lib` package
2. THE `@hecaton/core` Package SHALL export a barrel file at `src/public-api.ts` that re-exports all public symbols from submodules and is syntactically valid TypeScript that compiles without errors
3. THE `@hecaton/core` Package SHALL contain directories under `src/` for `schemas/`, `types/`, `entity/`, `errors/`, `constants/`, `config/`, `shared/algorithms/`, `validators/`, `test-generators/`, and `domain/` with subdirectories `identity/`, `capability/`, `telemetry/`, `signals/`, `fleet/`, where each leaf directory contains a `.gitkeep` placeholder file
4. THE `@hecaton/core` Package SHALL configure the `package.json` `exports` field with a single `"."` entry that maps `"types"` to `./dist/public-api.d.ts` and `"import"` to `./dist/public-api.js`, and SHALL set the top-level `main` field to `./dist/public-api.js` and `types` field to `./dist/public-api.d.ts`
5. THE `@hecaton/core` Package SHALL have `type: "module"` in `package.json`
6. THE `@hecaton/core` Package SHALL have scripts for `build` (tsc --build), `test` (vitest run), and `lint` (eslint src/)
7. THE `@hecaton/core` Package SHALL include a `tsconfig.json` that extends the workspace root `tsconfig.base.json` and enables `composite: true` for project-reference builds
8. THE `@hecaton/core` Package SHALL set `version` to `0.0.1` in `package.json`

### Requirement 5: API Package Structure

**User Story:** As a developer, I want the `@hecaton/api` package scaffolded with the correct directory structure and dependencies, so that it is ready for Lambda handler and adapter development.

#### Acceptance Criteria

1. THE `@hecaton/api` Package SHALL declare `@hecaton/core` as a workspace dependency using the `workspace:*` version specifier in the `dependencies` field of `packages/api/package.json`
2. THE `@hecaton/api` Package SHALL contain the following directory structure under `src/`: `handlers/`, `use-cases/`, and `adapters/` with subdirectories `adapters/http/dto/`, `adapters/dynamo/dto/`, `adapters/iam/`, `adapters/eventbridge/dto/`, `adapters/appconfig/`, `adapters/cloudwatch/`, where each leaf directory contains a `.gitkeep` file to ensure the directory is tracked by version control
3. THE `@hecaton/api` Package SHALL have `"type": "module"` set in its `package.json`
4. THE `@hecaton/api` Package SHALL declare the following scripts in `package.json`: `"build": "tsc --build"`, `"test": "vitest run"`, and `"lint": "eslint src/"`
5. THE `@hecaton/api` Package SHALL declare `@aws-sdk/client-dynamodb`, `@aws-sdk/client-iam`, `@aws-sdk/client-eventbridge`, `@aws-sdk/client-cloudwatch` in `dependencies` with version range `^3` and `esbuild` with version range `^0.21`
6. THE `@hecaton/api` Package SHALL have a `tsconfig.json` that extends the workspace root `tsconfig.base.json` and includes a project reference to `@hecaton/core`, enabling incremental compilation in dependency order
7. IF a developer runs `pnpm --filter @hecaton/api build` after `@hecaton/core` has been built, THEN THE `@hecaton/api` Package SHALL produce a `dist/` directory containing compiled JavaScript and declaration files with exit code 0

### Requirement 6: CDK Package Structure

**User Story:** As a developer, I want the `@hecaton/cdk` package scaffolded with the correct directory structure and CDK configuration, so that it is ready for infrastructure construct development.

#### Acceptance Criteria

1. THE `@hecaton/cdk` Package SHALL declare `@hecaton/core` as a workspace dependency (`workspace:*`) in the `dependencies` field of its `package.json`
2. THE `@hecaton/cdk` Package SHALL declare `aws-cdk-lib` (version `^2.258.0`) and `constructs` (version `^10.0`) as `dependencies`, and `aws-cdk` (version `^2.258.0`) as a `devDependencies` entry in its `package.json`
3. THE `@hecaton/cdk` Package SHALL contain a `cdk.json` file that specifies the `app` field pointing to the CDK app entry point (`bin/app.ts`) and is valid JSON
4. THE `@hecaton/cdk` Package SHALL contain directory stubs for `bin/`, `lib/stacks/`, `lib/constructs/`, `lib/config/seeds/`, `test/constructs/`, and `test/stacks/`, each containing a `.gitkeep` file to ensure the directory is tracked in version control
5. THE `@hecaton/cdk` Package SHALL have `type: "module"` set in its `package.json`
6. THE `@hecaton/cdk` Package SHALL have scripts in `package.json` for `build` (value: `tsc --build`), `test` (value: `vitest run`), `lint` (value: `eslint lib/ bin/`), and `synth` (value: `cdk synth`)
7. THE `@hecaton/cdk` Package SHALL contain a `tsconfig.json` that extends the workspace root `tsconfig.base.json`, sets `rootDir` to `.` (to include both `bin/` and `lib/`), sets `outDir` to `./dist`, and includes TypeScript project references to `@hecaton/core`
8. THE `@hecaton/cdk` Package SHALL contain a `bin/app.ts` file that serves as the CDK app entry point with a minimal valid CDK App instantiation that compiles without type errors

### Requirement 7: Web Package Structure

**User Story:** As a developer, I want the `@hecaton/web` package scaffolded as a placeholder, so that workspace tooling recognizes it and it is ready for Phase 3 development.

#### Acceptance Criteria

1. THE `@hecaton/web` Package SHALL declare `@hecaton/core` as a workspace dependency (`workspace:*`)
2. THE `@hecaton/web` Package SHALL contain directories `src/ui/`, `src/state/`, and `src/lib/`, each containing a `.gitkeep` placeholder file so that the directories are tracked by version control
3. THE `@hecaton/web` Package SHALL have `type: "module"` in `package.json`
4. THE `@hecaton/web` Package SHALL have scripts for `build` (tsc --build), `test` (vitest run), and `lint` (eslint src/), and all three scripts SHALL exit with code 0 when run against the empty scaffold
5. THE `@hecaton/web` Package SHALL contain a `tsconfig.json` that extends the workspace root `tsconfig.base.json` and declares a project reference to `@hecaton/core`

### Requirement 8: Dependency DAG Integrity

**User Story:** As a developer, I want the workspace dependency graph to be a strict DAG with no cycles or lateral edges, so that packages can be built in topological order and boundaries remain clean.

#### Acceptance Criteria

1. THE Dependency_DAG SHALL have `@hecaton/core` with zero workspace dependencies in both the `dependencies` and `devDependencies` fields of its `package.json`
2. THE Dependency_DAG SHALL have `@hecaton/api`, `@hecaton/cdk`, and `@hecaton/web` each declaring `@hecaton/core` as their only workspace dependency across both `dependencies` and `devDependencies` fields, with no lateral workspace references between them
3. WHEN `pnpm ls --depth 0` is executed, THE Workspace SHALL report exactly four workspace packages: `@hecaton/core`, `@hecaton/api`, `@hecaton/cdk`, and `@hecaton/web`
4. IF a circular dependency is introduced between workspace packages, THEN THE Build_Pipeline SHALL fail with a non-zero exit code during TypeScript compilation (`pnpm build`)

### Requirement 9: Build Pipeline Success on Empty Scaffold

**User Story:** As a developer, I want the freshly scaffolded project to pass all build gates with zero application logic, so that I can verify the structural setup is correct before implementing features.

#### Acceptance Criteria

1. WHEN `pnpm install` is executed on the freshly scaffolded project, THE Build_Pipeline SHALL resolve all workspace and external dependencies and exit with code 0
2. WHEN `pnpm build` is executed on the freshly scaffolded project, THE Build_Pipeline SHALL compile all four packages and exit with code 0, producing a `dist/` directory in each package containing `.js` and `.d.ts` files
3. WHEN `pnpm test` is executed on the freshly scaffolded project, THE Build_Pipeline SHALL execute Vitest in workspace mode across all four packages and exit with code 0, with zero tests treated as a passing result
4. WHEN `pnpm lint` is executed on the freshly scaffolded project, THE Build_Pipeline SHALL lint all TypeScript source files across all four packages and exit with code 0 with zero errors and zero warnings
5. THE Build_Pipeline SHALL build packages sequentially in dependency order: `@hecaton/core` first, then `@hecaton/api`, `@hecaton/cdk`, and `@hecaton/web`
6. IF any Build_Pipeline command exits with a non-zero code on the freshly scaffolded project, THEN THE Build_Pipeline SHALL output a diagnostic message indicating which package and which step failed

### Requirement 10: CI Workflow Stubs

**User Story:** As a developer, I want GitHub Actions CI workflow stubs for each package, so that automated validation runs on push and the project is ready for CI/CD from day one.

#### Acceptance Criteria

1. THE Workspace SHALL contain workflow files at `.github/workflows/core.yml`, `.github/workflows/api.yml`, `.github/workflows/cdk.yml`, and `.github/workflows/web.yml`
2. WHEN a push to the `main` branch occurs, THE CI_Workflow for each package SHALL execute steps in this order: install dependencies, build, lint, and test
3. THE CI_Workflow SHALL use `pnpm install --frozen-lockfile` to ensure deterministic dependency resolution
4. THE CI_Workflow SHALL configure the runner environment with Node.js 20 and pnpm before executing pipeline steps

### Requirement 11: Vitest Workspace Configuration

**User Story:** As a developer, I want Vitest configured as a workspace-aware test runner, so that tests across all packages are discovered and executed in parallel.

#### Acceptance Criteria

1. THE Workspace SHALL contain a `vitest.workspace.ts` file at the repository root that references all four packages (`@hecaton/core`, `@hecaton/api`, `@hecaton/cdk`, `@hecaton/web`)
2. WHEN `pnpm test` is executed at the workspace root, THE Workspace SHALL invoke Vitest in workspace mode discovering test files matching the `**/*.test.ts` glob pattern from all packages
3. IF zero test files exist across all packages, THEN THE Workspace SHALL produce a passing result (exit code 0)
4. THE root `package.json` `test` script SHALL invoke `vitest run` with the workspace configuration file

### Requirement 12: TypeScript Strict Compliance

**User Story:** As a developer, I want all scaffold code to comply with strict TypeScript without suppression comments, so that the project starts with maximum type safety and no technical debt.

#### Acceptance Criteria

1. THE scaffold source code SHALL contain no `// @ts-ignore` comments in any `.ts` or `.tsx` file under the `packages/` directory
2. THE scaffold source code SHALL contain no `// @ts-expect-error` comments in any `.ts` or `.tsx` file under the `packages/` directory
3. THE scaffold source code SHALL contain no explicit `any` type annotations (including `as any`, `: any`, `<any>`, and generic parameters defaulting to `any`) in any `.ts` or `.tsx` file under the `packages/` directory
4. WHEN `pnpm build` is executed, THE Build_Pipeline SHALL compile all scaffold code with the `strict` flag set to `true` in `tsconfig.base.json` and produce exit code 0 with zero type errors across all four packages (`core`, `api`, `cdk`, `web`)
5. THE `tsconfig.base.json` SHALL enable all strict-family options: `strict`, `noImplicitAny`, `strictNullChecks`, `noUnusedLocals`, and `noUnusedParameters` set to `true`
6. IF a scaffold source file contains a suppression comment (`@ts-ignore` or `@ts-expect-error`) or an explicit `any` annotation, THEN THE lint step SHALL report it as a violation with the file path and line number
