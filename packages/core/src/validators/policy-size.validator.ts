import type { IamPolicyDocument } from '../types/index.js';
import type { DomainError } from '../errors/index.js';
import { ValidationError } from '../errors/index.js';
import { AWS_INLINE_POLICY_SIZE_LIMIT } from '../constants/limits.js';

export type ValidationResult = { valid: true } | { valid: false; error: DomainError };

/**
 * Validates that a policy document does not exceed the AWS inline policy size limit.
 *
 * Serializes the policy to JSON and checks that the UTF-8 byte length
 * is within AWS_INLINE_POLICY_SIZE_LIMIT (10,240 bytes).
 */
export function validatePolicySize(policy: IamPolicyDocument): ValidationResult {
  const json = JSON.stringify(policy);
  const actualSize = Buffer.byteLength(json, 'utf8');

  if (actualSize > AWS_INLINE_POLICY_SIZE_LIMIT) {
    return {
      valid: false,
      error: new ValidationError(
        `Policy size ${actualSize} bytes exceeds AWS inline policy limit of ${AWS_INLINE_POLICY_SIZE_LIMIT} bytes`,
        { actualSize, limit: AWS_INLINE_POLICY_SIZE_LIMIT },
      ),
    };
  }

  return { valid: true };
}
