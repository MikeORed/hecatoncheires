import { z } from 'zod';
import { ConfigNamePattern } from '@hecaton/core';

const UuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const RevokeShapeRequestSchema = z.object({
  configName: z.string().regex(ConfigNamePattern),
  roleName: z.string().min(1),
  grantId: z.string().regex(UuidV7Pattern),
});

export type RevokeShapeRequest = z.infer<typeof RevokeShapeRequestSchema>;
