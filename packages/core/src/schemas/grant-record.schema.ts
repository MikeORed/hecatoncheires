import { z } from 'zod';

import { IdSchema } from './id.schema.js';
import { ConfigNamePattern } from './agent-configuration.schema.js';

/**
 * Schema for the Grant Record domain object.
 *
 * A grant record binds a specific capability shape (with parameters) to an
 * agent configuration, tracking who granted it and when it expires.
 */
export const GrantRecordSchema = z.object({
  /** UUIDv7 identifier for the grant; generated if not provided. */
  grantId: IdSchema.optional(),

  /** Agent configuration name this grant belongs to. */
  configName: z
    .string()
    .min(1)
    .max(40)
    .regex(
      ConfigNamePattern,
      'configName must start with a lowercase letter, end with a lowercase letter or digit, and contain only lowercase letters, digits, and hyphens',
    ),

  /** Name of the capability shape being granted. */
  shapeName: z.string().min(1),

  /** Key-value parameters scoping the granted capability. */
  parameters: z.record(z.string(), z.string()),

  /** ISO 8601 timestamp when the grant was issued. */
  grantedAt: z.string().datetime(),

  /** Identity of the principal that issued the grant. */
  grantedBy: z.string().min(1),

  /** Optional ISO 8601 expiration timestamp (must be after grantedAt — enforced by validator, not schema). */
  expiresAt: z.string().datetime().optional(),
});
