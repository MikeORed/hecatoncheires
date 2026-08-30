import { z } from 'zod';

import {
  AgentConfigurationSchema,
  ModelBindingSchema,
  ModelBindingThresholdsSchema,
  RuntimeTunablesSchema,
  ShapeTemplateSchema,
  GrantRecordSchema,
  IamPolicyDocumentSchema,
  IamStatementSchema,
} from '../schemas/index.js';

export type AgentConfiguration = z.infer<typeof AgentConfigurationSchema>;
export type AgentType = AgentConfiguration['agentType'];
export type ModelBinding = z.infer<typeof ModelBindingSchema>;
export type ModelBindingThresholds = z.infer<typeof ModelBindingThresholdsSchema>;
export type RuntimeTunables = z.infer<typeof RuntimeTunablesSchema>;
export type ShapeTemplate = z.infer<typeof ShapeTemplateSchema>;
export type GrantRecord = z.infer<typeof GrantRecordSchema>;
export type IamPolicyDocument = z.infer<typeof IamPolicyDocumentSchema>;
export type IamStatement = z.infer<typeof IamStatementSchema>;
