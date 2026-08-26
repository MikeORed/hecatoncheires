# Requirements Document

## Introduction

Set up a documentation and blog site for the Hecatoncheires project using Astro with MDX content collections. The site lives in `packages/docs`, integrates into the pnpm monorepo, and deploys to GitHub Pages via a dedicated GitHub Actions workflow using the official Astro deployment action. Existing CI workflows are updated to ignore the docs package. The goal is a minimal, working pipeline with a landing page and one placeholder blog post.

## Glossary

- **Docs_Package**: The Astro site located at `packages/docs` within the monorepo.
- **Docs_Workflow**: The GitHub Actions workflow responsible for building and deploying the Docs_Package to GitHub Pages.
- **Existing_Workflows**: The four pre-existing CI workflows (`core.yml`, `api.yml`, `cdk.yml`, `web.yml`) in `.github/workflows/`.
- **Landing_Page**: The index page of the Docs_Package served at the site root.
- **Blog_Collection**: An Astro content collection stored in `packages/docs/src/content/blog/` containing MDX blog posts with a defined schema.
- **Astro_Action**: The `withastro/action@v6` GitHub Action used to build and deploy Astro sites to GitHub Pages.
- **Base_Path**: The URL path prefix `/hecatoncheires/` required for GitHub Pages project site deployment.

## Requirements

### Requirement 1: Package Scaffold

**User Story:** As a maintainer, I want `packages/docs` to be a valid pnpm workspace member with Astro configured, so that I can build and preview the docs site locally.

#### Acceptance Criteria

1. THE Docs_Package SHALL contain a `package.json` with `"name": "@hecaton/docs"` and `"type": "module"`.
2. THE Docs_Package SHALL declare Astro as a dependency and include `build`, `dev`, and `preview` scripts that invoke the Astro CLI.
3. THE Docs_Package SHALL contain an `astro.config.mjs` (or `.ts`) that sets the `site` to `https://hecatoncheires.github.io` and the `base` to `/hecatoncheires/`.
4. THE Docs_Package SHALL include the `@astrojs/mdx` integration in its Astro configuration.
5. WHEN `pnpm install` is run at the workspace root, THE Docs_Package SHALL be resolved as a workspace member without manual changes to `pnpm-workspace.yaml`.

### Requirement 2: Landing Page

**User Story:** As a visitor, I want a hello-world landing page that briefly describes Hecatoncheires, so that I understand what the project is about.

#### Acceptance Criteria

1. THE Docs_Package SHALL serve an index page at the Base_Path root (`/hecatoncheires/`).
2. THE Landing_Page SHALL contain the project name "Hecatoncheires" and a brief description of the project as a governance and observability platform for autonomous AI agent fleets on AWS.
3. THE Landing_Page SHALL include a navigation link to the blog listing page.

### Requirement 3: Blog Content Collection

**User Story:** As a maintainer, I want a typed blog content collection with a schema, so that blog posts are validated at build time.

#### Acceptance Criteria

1. THE Docs_Package SHALL define a content collection named `blog` in `src/content/config.ts` (or equivalent content configuration file).
2. THE Blog_Collection schema SHALL require a `title` (string), `description` (string), `pubDate` (date), and optional `updatedDate` (date) field for each post.
3. THE Blog_Collection SHALL contain at least one placeholder MDX post about agent governance and observability on AWS.
4. WHEN `pnpm --filter @hecaton/docs build` is run, THE Docs_Package SHALL validate blog post frontmatter against the defined schema.

### Requirement 4: Blog Listing and Post Pages

**User Story:** As a visitor, I want to browse blog posts and read individual posts, so that I can consume the project's written content.

#### Acceptance Criteria

1. THE Docs_Package SHALL render a blog listing page that displays all posts from the Blog_Collection sorted by publication date descending.
2. THE Docs_Package SHALL render individual blog post pages at a URL path derived from the post slug.
3. THE Docs_Package SHALL generate an RSS feed for the Blog_Collection.

### Requirement 5: GitHub Pages Deployment Workflow

**User Story:** As a maintainer, I want the docs site to automatically deploy to GitHub Pages on push to main, so that published content stays current without manual steps.

#### Acceptance Criteria

1. THE Docs_Workflow SHALL be defined in `.github/workflows/docs.yml`.
2. THE Docs_Workflow SHALL trigger on pushes to the `main` branch that include changes under `packages/docs/**`.
3. THE Docs_Workflow SHALL use the Astro_Action (`withastro/action@v6`) to build the Docs_Package with the correct package path (`packages/docs`).
4. THE Docs_Workflow SHALL deploy the built output to GitHub Pages using `actions/deploy-pages@v4`.
5. THE Docs_Workflow SHALL configure the `pages` environment with a `url` output matching the deployed site URL.
6. THE Docs_Workflow SHALL use Node.js 20 and pnpm for dependency installation.

### Requirement 6: Existing CI Isolation

**User Story:** As a maintainer, I want existing CI workflows to skip runs when only docs files change, so that unrelated pipelines do not waste compute on documentation edits.

#### Acceptance Criteria

1. WHEN only files under `packages/docs/**` change, THE Existing_Workflows SHALL skip execution by means of a `paths-ignore` filter containing `packages/docs/**`.
2. THE Existing_Workflows SHALL continue to trigger on pushes to `main` that include changes outside `packages/docs/**`.

### Requirement 7: Local Build Verification

**User Story:** As a maintainer, I want the docs site to build successfully as part of the monorepo build, so that broken docs are caught before merge.

#### Acceptance Criteria

1. WHEN `pnpm --filter @hecaton/docs build` is run, THE Docs_Package SHALL produce a static site output in the configured Astro output directory without errors.
2. THE Docs_Package SHALL build independently without depending on other workspace packages (`@hecaton/core`, `@hecaton/api`, `@hecaton/cdk`).
