import { z } from 'zod';
import { ConfigNamePattern } from '@hecaton/core';

export const OnboardAgentRequestSchema = z.object({
  configName: z.string().regex(ConfigNamePattern),
  roleName: z.string().min(1),
});

export type OnboardAgentRequest = z.infer<typeof OnboardAgentRequestSchema>;
