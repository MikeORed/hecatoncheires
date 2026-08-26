import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

export default defineConfig({
  site: 'https://hecatoncheires.github.io',
  base: '/hecatoncheires/',
  integrations: [mdx()],
});
