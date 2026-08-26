# Implementation Plan: Docs Site Setup

## Overview

Set up a documentation and blog site at `packages/docs` using Astro 5.x with MDX content collections, deploy via GitHub Actions to GitHub Pages, and isolate existing CI workflows from docs-only changes. This is infrastructure/config scaffolding — no custom business logic.

## Tasks

- [x] 1. Scaffold the docs package
  - [x] 1.1 Create `packages/docs/package.json` with Astro, MDX, and RSS dependencies
    - Set `name` to `@hecaton/docs`, `type` to `module`, `private` to `true`
    - Add `build`, `dev`, `preview` scripts invoking the Astro CLI
    - Dependencies: `astro ^5.9`, `@astrojs/mdx ^4.3`, `@astrojs/rss ^4.0`
    - _Requirements: 1.1, 1.2, 7.2_

  - [x] 1.2 Create `packages/docs/astro.config.mjs` with site, base, and MDX integration
    - Set `site` to `https://hecatoncheires.github.io`
    - Set `base` to `/hecatoncheires/`
    - Add `mdx()` integration
    - _Requirements: 1.3, 1.4_

  - [x] 1.3 Create `packages/docs/tsconfig.json` extending Astro's recommended config
    - Use `"extends": "astro/tsconfigs/strict"`
    - _Requirements: 1.1_

- [x] 2. Create content collection and placeholder post
  - [x] 2.1 Create `packages/docs/src/content.config.ts` with the blog collection schema
    - Define `blog` collection with `title` (string), `description` (string), `pubDate` (date), optional `updatedDate` (date)
    - Use Astro's content collection API with Zod schema
    - _Requirements: 3.1, 3.2, 3.4_

  - [x] 2.2 Create placeholder blog post `packages/docs/src/content/blog/hello-agent-governance.mdx`
    - Include valid frontmatter: title, description, pubDate
    - Write a brief placeholder paragraph about agent governance
    - _Requirements: 3.3_

- [x] 3. Create layouts and pages
  - [x] 3.1 Create `packages/docs/src/layouts/BaseLayout.astro`
    - Minimal HTML shell: `<html>`, `<head>` (charset, viewport, title prop), `<body>` with `<slot />`
    - _Requirements: 2.1_

  - [x] 3.2 Create landing page at `packages/docs/src/pages/index.astro`
    - Display project name "Hecatoncheires" and brief description
    - Include navigation link to the blog listing (`/hecatoncheires/blog/`)
    - Use BaseLayout
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.3 Create blog listing at `packages/docs/src/pages/blog/index.astro`
    - Fetch all posts from blog collection, sort by `pubDate` descending
    - Render list of post links with titles and dates
    - _Requirements: 4.1_

  - [x] 3.4 Create individual post page at `packages/docs/src/pages/blog/[...slug].astro`
    - Use `getStaticPaths()` to generate pages from blog collection
    - Render MDX content via `<Content />` component
    - _Requirements: 4.2_

  - [x] 3.5 Create RSS feed at `packages/docs/src/pages/rss.xml.ts`
    - Use `@astrojs/rss` to generate RSS 2.0 feed
    - Include title, description, pubDate, and link for each post
    - _Requirements: 4.3_

- [x] 4. Checkpoint - Verify local build
  - Ensure `pnpm install` and `pnpm --filter @hecaton/docs build` succeed without errors, ask the user if questions arise.

- [x] 5. Set up GitHub Actions workflow and CI isolation
  - [x] 5.1 Create `.github/workflows/docs.yml` for GitHub Pages deployment
    - Trigger on push to `main` with `paths: ['packages/docs/**']`
    - Use `actions/checkout@v4`, `actions/setup-node@v4` (Node 20), `pnpm/action-setup@v4`
    - Build with `withastro/action@v6` pointing to `packages/docs`
    - Deploy with `actions/deploy-pages@v4`
    - Set permissions: `contents: read`, `pages: write`, `id-token: write`
    - Configure `pages` environment with URL output
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 5.2 Add `paths-ignore` for `packages/docs/**` to existing workflows
    - Modify `core.yml`, `api.yml`, `cdk.yml`, `web.yml`
    - Add `paths-ignore: ['packages/docs/**']` to push trigger
    - _Requirements: 6.1, 6.2_

- [x] 6. Final checkpoint - Ensure build passes
  - Ensure `pnpm --filter @hecaton/docs build` still passes after all changes, ask the user if questions arise.

## Notes

- No property-based test tasks are included — the design's Correctness Properties section explicitly states this is declarative configuration work with no custom functions suitable for PBT. Validation is done via build assertions (build succeeds, output files exist).
- The `pnpm-workspace.yaml` already uses `packages/*` glob, so no changes are needed there.
- Tasks are ordered so the package scaffolds first, then content, then pages (each building on prior), then CI last.
- Checkpoints verify the build at key integration points.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "3.1"] },
    { "id": 3, "tasks": ["2.2", "3.2", "3.3", "3.4", "3.5"] },
    { "id": 4, "tasks": ["5.1", "5.2"] }
  ]
}
```
