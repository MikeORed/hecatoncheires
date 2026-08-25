import { z } from 'zod';

export const RevokeShapeRequestSchema = z.object({
  agentId: z.string().uuid(),
  grantId: z.string().min(1),
});

export type RevokeShapeRequest = z.infer<typeof RevokeShapeRequestSchema>;
