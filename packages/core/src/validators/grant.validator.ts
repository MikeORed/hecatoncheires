import type { GrantRecord, ShapeTemplate } from '../types/index.js';
import type { DomainError } from '../errors/index.js';
import {
  ShapeNotFoundError,
  InvalidShapeParametersError,
  ValidationError,
} from '../errors/index.js';

export type ValidationResult = { valid: true } | { valid: false; error: DomainError };

/**
 * Validates a grant record against a shape catalog.
 *
 * Checks:
 * 1. The grant's shapeName exists in the catalog.
 * 2. All required parameters declared by the shape are present in grant.parameters.
 * 3. If expiresAt is present, it must be strictly later than grantedAt.
 */
export function validateGrant(
  grant: GrantRecord,
  catalog: readonly ShapeTemplate[],
): ValidationResult {
  // 1. Check shape exists in catalog
  const template = catalog.find((s) => s.shapeName === grant.shapeName);
  if (!template) {
    return {
      valid: false,
      error: new ShapeNotFoundError(
        `Shape '${grant.shapeName}' not found in catalog`,
        { shapeName: grant.shapeName },
      ),
    };
  }

  // 2. Check all required parameters are present
  const missingParams = template.requiredParameters.filter(
    (param) => !(param in grant.parameters),
  );
  if (missingParams.length > 0) {
    return {
      valid: false,
      error: new InvalidShapeParametersError(
        `Missing required parameters for shape '${grant.shapeName}': ${missingParams.join(', ')}`,
        { shapeName: grant.shapeName, missingParameters: missingParams },
      ),
    };
  }

  // 3. Check expiresAt > grantedAt if expiresAt is present
  if (grant.expiresAt !== undefined) {
    if (grant.expiresAt <= grant.grantedAt) {
      return {
        valid: false,
        error: new ValidationError('expiresAt must be strictly later than grantedAt', {
          grantedAt: grant.grantedAt,
          expiresAt: grant.expiresAt,
        }),
      };
    }
  }

  return { valid: true };
}
