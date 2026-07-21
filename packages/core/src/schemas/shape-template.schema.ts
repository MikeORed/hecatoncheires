import { z } from 'zod';

/**
 * Schema for an IAM statement template within a capability shape.
 *
 * Structurally identical to a standard IAM statement, but Resource values
 * may contain `${param}` placeholders that are resolved at grant time.
 */
export const IamStatementTemplateSchema = z.object({
  Effect: z.enum(['Allow', 'Deny']),
  Action: z.union([z.string(), z.array(z.string())]),
  Resource: z.union([z.string(), z.array(z.string())]),
  Condition: z.record(z.string(), z.record(z.string(), z.string())).optional(),
});

/**
 * Schema for a capability shape template.
 *
 * Each shape defines a risk-tier bundle of IAM statement templates that,
 * when resolved with parameters, produces concrete IAM policy statements.
 */
export const ShapeTemplateSchema = z.object({
  shapeName: z.string().min(1),
  riskTier: z.enum(['low', 'medium', 'high', 'critical']),
  requiredParameters: z.array(z.string()),
  statements: z.array(IamStatementTemplateSchema),
});
