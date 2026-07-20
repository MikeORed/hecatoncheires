import { defineConfig } from 'vitest/config';

/**
 * Vitest workspace configuration for the Hecatoncheires monorepo.
 * Discovers test files matching **\/*.test.ts across all four packages:
 * - @hecaton/core (packages/core)
 * - @hecaton/api (packages/api)
 * - @hecaton/cdk (packages/cdk)
 * - @hecaton/web (packages/web)
 */
export default defineConfig({
  test: {
    include: [
      'packages/core/**/*.test.ts',
      'packages/api/**/*.test.ts',
      'packages/cdk/**/*.test.ts',
      'packages/web/**/*.test.ts',
    ],
    passWithNoTests: true,
  },
});
