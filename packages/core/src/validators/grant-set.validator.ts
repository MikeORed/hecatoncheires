import type { GrantRecord } from '../types/index.js';
import { GrantConflictError } from '../errors/index.js';
import type { ValidationResult } from './grant.validator.js';

/**
 * Validates a set of grant records for duplicate entries.
 *
 * A duplicate is defined as two grants with the same configName, same shapeName,
 * and deep-equal parameters (compared via sorted JSON key-value pairs).
 */
export function validateGrantSet(grants: GrantRecord[]): ValidationResult {
  const seen = new Map<string, GrantRecord>();

  for (const grant of grants) {
    const key = buildKey(grant);
    const existing = seen.get(key);

    if (existing) {
      return {
        valid: false,
        error: new GrantConflictError(
          `Duplicate grant detected for configName '${grant.configName}' with shape '${grant.shapeName}'`,
          {
            configName: grant.configName,
            shapeName: grant.shapeName,
            parameters: grant.parameters,
          },
        ),
      };
    }

    seen.set(key, grant);
  }

  return { valid: true };
}

/**
 * Builds a deterministic key for a grant based on configName, shapeName,
 * and parameters (sorted entries serialized to JSON for deep equality).
 */
function buildKey(grant: GrantRecord): string {
  const sortedParams = JSON.stringify(
    Object.entries(grant.parameters).sort(([a], [b]) => a.localeCompare(b)),
  );
  return `${grant.configName}::${grant.shapeName}::${sortedParams}`;
}
