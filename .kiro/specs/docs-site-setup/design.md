# Design Document

## Introduction

This document describes the architecture and implementation plan for adding a documentation and blog site (`packages/docs`) to the Hecatoncheires monorepo. The site uses Astro with MDX content collections, deploys to GitHub Pages via a dedicated workflow, and integrates into the existing pnpm workspace without affecting other packages or CI pipelines.

## Architecture Overview

The docs package is a standalone Astro static site generator project. It has no dependency on other workspace packages and produces a fully static HTML/CSS/JS output deployed to GitHub Pages.

```
hecatoncheires/
├── packages/
│   └── docs/                    # New Astro site
│       ├── package.json         # @hecaton/docs, type: module
│       ├── astro.config.mjs     # Site + base path + MDX integration
│       ├── tsconfig.json        # Astro's recommended TS config
│       ├── src/
│       │   ├── content/
│       │   │   ├── config.ts    # Content collection schemas
│       │   │   └── blog/        # MDX blog posts
│       │   │       └── hello-agent-governance.mdx
│       │   ├── layouts/
│       │   │   └── BaseLayout.astro
│       │   └── pages/
│       │       ├── index.astro          # Landing page
│       │       ├── blog/
│       │       │   ├── index.astro      # Blog listing
│       │       │   └── [...slug].astro  # Individual post pages
│       │       └── rss.xml.ts           # RSS feed endpoint
│       └── public/              # Static assets (favicon, etc.)
├── .github/workflows/
│   ├── docs.yml                 # New: build + deploy to GitHub Pages
│   ├── core.yml                 # Modified: paths-ignore added
│   ├── api.yml                  # Modified: paths-ignore added
│   ├── cdk.yml                  # Modified: paths-ignore added
│   └── web.yml                  # Modified: paths-ignore added
└── pnpm-workspace.yaml          # Unchanged (packages/* glob covers docs)
```

## Components

### 1. Package Scaffold (`packages/docs/package.json`)

A minimal Astro project package with no workspace dependencies.

```json
{
  "name": "@hecaton/docs",
  "version": "0.0.1",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview"
  },
  "dependencies": {
    "astro": "^5.9",
    "@astrojs/mdx": "^4.3",
    "@astrojs/rss": "^4.0"
  }
}
```

Key decisions:
- `private: true` — this package is not published to npm.
- No `@hecaton/core` or other workspace dependency — the docs site is standalone.
- Astro 5.x is the current stable major version with native content collections.
- `@astrojs/rss` provides the RSS feed generation helper.

### 2. Astro Configuration (`packages/docs/astro.config.mjs`)

```javascript
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

export default defineConfig({
  site: 'https://hecatoncheires.github.io',
  base: '/hecatoncheires/',
  integrations: [mdx()],
});
```

- `site` — required for RSS feed absolute URLs and sitemap generation.
- `base` — prefixes all routes with `/hecatoncheires/` for GitHub Pages project-site deployment.
- `mdx()` — enables MDX content in blog posts.

### 3. Content Collection Schema (`src/content/config.ts`)

```typescript
import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
  }),
});

export const collections = { blog };
```

Astro uses Zod internally for schema validation. The schema enforces:
- `title` — required string
- `description` — required string
- `pubDate` — required, coerced to Date (accepts ISO strings in frontmatter)
- `updatedDate` — optional date

Blog posts live in `src/content/blog/` as `.mdx` files with YAML frontmatter validated against this schema at build time.

### 4. Page Components

#### Landing Page (`src/pages/index.astro`)

Renders the project name, a brief description, and a navigation link to `/hecatoncheires/blog/`. Uses a minimal `BaseLayout` wrapper for shared HTML boilerplate (`<html>`, `<head>`, `<body>`).

#### Blog Listing (`src/pages/blog/index.astro`)

Fetches all entries from the `blog` collection, sorts by `pubDate` descending, and renders a list of links with titles and dates.

```typescript
import { getCollection } from 'astro:content';

const posts = (await getCollection('blog')).sort(
  (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf()
);
```

#### Individual Post (`src/pages/blog/[...slug].astro`)

Uses Astro's dynamic routing with `getStaticPaths()` to generate one page per blog post. Renders the MDX content via Astro's `<Content />` component.

```typescript
import { getCollection } from 'astro:content';

export async function getStaticPaths() {
  const posts = await getCollection('blog');
  return posts.map((post) => ({
    params: { slug: post.id },
    props: post,
  }));
}
```

#### RSS Feed (`src/pages/rss.xml.ts`)

Uses `@astrojs/rss` to generate an RSS 2.0 feed:

```typescript
import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

export async function GET(context) {
  const posts = await getCollection('blog');
  return rss({
    title: 'Hecatoncheires Blog',
    description: 'Governance and observability for autonomous AI agent fleets',
    site: context.site,
    items: posts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.pubDate,
      description: post.data.description,
      link: `/blog/${post.id}/`,
    })),
  });
}
```

### 5. Layout (`src/layouts/BaseLayout.astro`)

Minimal HTML shell providing `<html>`, `<head>` (charset, viewport, title), and `<body>` with a `<slot />` for page content. No CSS framework — inline styles or a single minimal stylesheet is sufficient for the initial scaffold.

### 6. Placeholder Blog Post

`src/content/blog/hello-agent-governance.mdx`:

```markdown
---
title: 'Hello, Agent Governance'
description: 'Introducing Hecatoncheires — a governance and observability platform for autonomous AI agent fleets on AWS.'
pubDate: 2025-01-15
---

Welcome to the Hecatoncheires project blog. This post is a placeholder...
```

## Interfaces

### GitHub Actions Workflow Interface

#### `docs.yml` Workflow

```yaml
name: Deploy Docs

on:
  push:
    branches: [main]
    paths:
      - 'packages/docs/**'

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - uses: withastro/action@v6
        with:
          path: packages/docs

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

#### Existing Workflow Modification

Each of `core.yml`, `api.yml`, `cdk.yml`, `web.yml` receives a `paths-ignore` block:

```yaml
on:
  push:
    branches: [main]
    paths-ignore:
      - 'packages/docs/**'
```

This ensures docs-only changes do not trigger unrelated CI pipelines.

## Data Models

### Blog Post Frontmatter

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | Yes | Post title displayed in listing and page header |
| `description` | string | Yes | Short summary for RSS feed and meta description |
| `pubDate` | date | Yes | Publication date, used for sorting |
| `updatedDate` | date | No | Last revision date, shown if present |

### Build Output Structure

```
dist/
├── hecatoncheires/
│   ├── index.html           # Landing page
│   ├── blog/
│   │   ├── index.html       # Blog listing
│   │   └── hello-agent-governance/
│   │       └── index.html   # Individual post
│   └── rss.xml              # RSS feed
```

All output is nested under the `hecatoncheires/` directory corresponding to the configured `base` path.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Blog post missing required frontmatter field | Astro build fails with a schema validation error indicating the missing field and file |
| Invalid date format in `pubDate` or `updatedDate` | Zod coercion fails; Astro reports the validation error at build time |
| MDX syntax error in a blog post | Astro build fails with a parse error pointing to the file and line |
| Missing `@astrojs/mdx` integration | `.mdx` files are not processed; Astro emits a warning or fails if content collection expects MDX |
| `pnpm install` fails due to lockfile mismatch | CI fails at the install step with a clear pnpm error (frozen-lockfile mode) |
| GitHub Pages deployment fails (permissions) | `deploy-pages` step fails; requires `pages: write` and `id-token: write` permissions on the workflow |

All errors are caught at build time. There is no runtime error handling since the output is fully static.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

This feature is entirely infrastructure and configuration work (static site scaffolding, CI workflow setup, content collection definition). All acceptance criteria fall into SMOKE, EXAMPLE, or INTEGRATION categories:

- **SMOKE tests** (configuration assertions): Verify that config files contain expected values (package.json fields, astro.config settings, workflow YAML structure, paths-ignore filters).
- **EXAMPLE tests** (build output assertions): Verify the build produces expected files with expected content (landing page text, blog listing order, RSS feed existence, slug-based post URLs).
- **INTEGRATION tests** (build pipeline): Verify the full build completes without errors and that schema validation catches invalid frontmatter.

There are no pure functions with meaningful input variation that would benefit from property-based testing. The "logic" here is declarative configuration consumed by Astro and GitHub Actions — not custom code with a wide input space. Testing Astro's content collection validation or GitHub Actions trigger behavior is testing external tooling, not our code.

### Property 1: Build output completeness

*For any* valid Docs_Package source tree containing at least one blog post with valid frontmatter, running `astro build` SHALL produce an output directory containing: an `index.html` at the base path root, a `blog/index.html` listing page, one subdirectory per blog post slug containing an `index.html`, and an `rss.xml` file.

**Validates: Requirements 2.1, 4.1, 4.2, 4.3, 7.1**

### Property 2: Blog listing sort invariant

*For any* set of blog posts in the Blog_Collection, the blog listing page SHALL render posts in strictly descending order of `pubDate` — that is, for every adjacent pair of posts on the page, the earlier-listed post has a `pubDate` greater than or equal to the later-listed post.

**Validates: Requirements 4.1**

### Property 3: CI isolation via paths-ignore

*For all* Existing_Workflows (`core.yml`, `api.yml`, `cdk.yml`, `web.yml`), the workflow trigger configuration SHALL include a `paths-ignore` entry matching `packages/docs/**`, ensuring that pushes touching only docs files do not trigger those workflows.

**Validates: Requirements 6.1, 6.2**

### Property 4: Docs package independence

*For any* valid state of the Docs_Package `package.json`, the `dependencies` and `devDependencies` fields SHALL NOT contain any reference to `@hecaton/core`, `@hecaton/api`, `@hecaton/cdk`, or `@hecaton/web`, ensuring the docs site builds independently of other workspace packages.

**Validates: Requirements 7.2**
