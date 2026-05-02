import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const posts = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    categories: z.string().optional(),
    tags: z.array(z.string()).optional().default([]),
    description: z.string().optional(),
  }),
});

const projects = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/projects' }),
  schema: z.object({
    name: z.string(),
    tagline: z.string(),
    appUrl: z.string().url().optional(),
    appLabel: z.string().optional().default('Open app'),
    githubUrl: z.string().url().optional(),
    relatedPosts: z.array(z.string()).optional().default([]),
    order: z.number().optional().default(99),
  }),
});

export const collections = { posts, projects };
