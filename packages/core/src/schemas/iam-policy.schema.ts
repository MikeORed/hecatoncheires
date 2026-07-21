import { z } from 'zod';

/**
 * Schema for a single IAM policy statement.
 *
 * Validates Effect (Allow/Deny), Action, and Resource fields.
 * Action and Resource accept either a single string or an array of strings.
 * An optional Condition block supports nested key-value maps.
 */
export const IamStatementSchema = z.object({
  Effect: z.enum(['Allow', 'Deny']),
  Action: z.union([z.string(), z.array(z.string())]),
  Resource: z.union([z.string(), z.array(z.string())]),
  Condition: z.record(z.string(), z.record(z.string(), z.string())).optional(),
});

/**
 * Schema for a complete IAM policy document.
 *
 * Enforces the AWS IAM policy JSON structure:
 *   - Version must be the literal `2012-10-17`
 *   - Statement must be a non-empty array of valid IAM statements
 */
export const IamPolicyDocumentSchema = z.object({
  Version: z.literal('2012-10-17'),
  Statement: z.array(IamStatementSchema).min(1),
});
