import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    // Short label for the sidebar/nav; falls back to `title` when absent.
    navTitle: z.string().optional(),
    // Explicit reading-order position; falls back to pubDate ordering when absent.
    order: z.number().optional(),
  }),
});

export const collections = { blog };
