/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  rules: {
    // Disallow @ts-ignore and @ts-expect-error suppression comments
    '@typescript-eslint/ban-ts-comment': [
      'error',
      {
        'ts-ignore': true,
        'ts-expect-error': true,
        'ts-nocheck': true,
        'ts-check': false,
      },
    ],
    // Disallow explicit `any` annotations
    '@typescript-eslint/no-explicit-any': 'error',
    // Block subpath imports into any workspace package
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['@hecaton/core/*'],
            message: 'Deep imports into @hecaton/core are not allowed. Use the bare specifier "@hecaton/core" instead.',
          },
          {
            group: ['@hecaton/api/*'],
            message: 'Deep imports into @hecaton/api are not allowed. Use the bare specifier "@hecaton/api" instead.',
          },
          {
            group: ['@hecaton/cdk/*'],
            message: 'Deep imports into @hecaton/cdk are not allowed. Use the bare specifier "@hecaton/cdk" instead.',
          },
          {
            group: ['@hecaton/web/*'],
            message: 'Deep imports into @hecaton/web are not allowed. Use the bare specifier "@hecaton/web" instead.',
          },
        ],
      },
    ],
  },
  overrides: [
    // @hecaton/core: cannot import from api, cdk, or web
    {
      files: ['packages/core/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['@hecaton/core/*'],
                message: 'Deep imports into @hecaton/core are not allowed. Use the bare specifier "@hecaton/core" instead.',
              },
              {
                group: ['@hecaton/api', '@hecaton/api/*'],
                message: '@hecaton/core cannot import from @hecaton/api.',
              },
              {
                group: ['@hecaton/cdk', '@hecaton/cdk/*'],
                message: '@hecaton/core cannot import from @hecaton/cdk.',
              },
              {
                group: ['@hecaton/web', '@hecaton/web/*'],
                message: '@hecaton/core cannot import from @hecaton/web.',
              },
            ],
          },
        ],
      },
    },
    // @hecaton/api: cannot import from cdk or web
    {
      files: ['packages/api/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['@hecaton/core/*'],
                message: 'Deep imports into @hecaton/core are not allowed. Use the bare specifier "@hecaton/core" instead.',
              },
              {
                group: ['@hecaton/api/*'],
                message: 'Deep imports into @hecaton/api are not allowed. Use the bare specifier "@hecaton/api" instead.',
              },
              {
                group: ['@hecaton/cdk', '@hecaton/cdk/*'],
                message: '@hecaton/api cannot import from @hecaton/cdk.',
              },
              {
                group: ['@hecaton/web', '@hecaton/web/*'],
                message: '@hecaton/api cannot import from @hecaton/web.',
              },
            ],
          },
        ],
      },
    },
    // @hecaton/cdk: cannot import from api or web
    {
      files: ['packages/cdk/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['@hecaton/core/*'],
                message: 'Deep imports into @hecaton/core are not allowed. Use the bare specifier "@hecaton/core" instead.',
              },
              {
                group: ['@hecaton/cdk/*'],
                message: 'Deep imports into @hecaton/cdk are not allowed. Use the bare specifier "@hecaton/cdk" instead.',
              },
              {
                group: ['@hecaton/api', '@hecaton/api/*'],
                message: '@hecaton/cdk cannot import from @hecaton/api.',
              },
              {
                group: ['@hecaton/web', '@hecaton/web/*'],
                message: '@hecaton/cdk cannot import from @hecaton/web.',
              },
            ],
          },
        ],
      },
    },
    // @hecaton/web: cannot import from api or cdk
    {
      files: ['packages/web/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['@hecaton/core/*'],
                message: 'Deep imports into @hecaton/core are not allowed. Use the bare specifier "@hecaton/core" instead.',
              },
              {
                group: ['@hecaton/web/*'],
                message: 'Deep imports into @hecaton/web are not allowed. Use the bare specifier "@hecaton/web" instead.',
              },
              {
                group: ['@hecaton/api', '@hecaton/api/*'],
                message: '@hecaton/web cannot import from @hecaton/api.',
              },
              {
                group: ['@hecaton/cdk', '@hecaton/cdk/*'],
                message: '@hecaton/web cannot import from @hecaton/cdk.',
              },
            ],
          },
        ],
      },
    },
  ],
  ignorePatterns: ['dist/', 'node_modules/', '*.js', '!.eslintrc.js'],
};
