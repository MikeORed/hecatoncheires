import { z } from 'zod';

export const GrantShapeRequestSchema = z.object({
  agentId: z.string().uuid(),
  shapeName: z.string().min(1),
  parameters: z.record(z.string(), z.string()),
  grantedBy: z.string().min(1),
  expiresAt: z.string().datetime().optional(),
});

export type GrantShapeRequest = z.infer<typeof GrantShapeRequestSchema>;
