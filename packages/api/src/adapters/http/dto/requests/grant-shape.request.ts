import { z } from 'zod';
import { ConfigNamePattern } from '@hecaton/core';

export const GrantShapeRequestSchema = z.object({
  configName: z.string().regex(ConfigNamePattern),
  roleName: z.string().min(1),
  shapeName: z.string().min(1),
  parameters: z.record(z.string(), z.string()),
  grantedBy: z.string().min(1),
  expiresAt: z.string().datetime().optional(),
});

export type GrantShapeRequest = z.infer<typeof GrantShapeRequestSchema>;
