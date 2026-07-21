import { GrantRecordSchema } from '../schemas/grant-record.schema.js';
import { ValidationError } from '../errors/validation-error.js';
import { GrantRecord } from '../types/index.js';
import { generateId } from '../utilities/id-generator.js';

export function createGrantRecord(input: unknown): GrantRecord {
  // Auto-generate grantId if not provided
  const data =
    typeof input === 'object' && input !== null
      ? { grantId: generateId(), ...input }
      : input;

  const result = GrantRecordSchema.safeParse(data);
  if (!result.success) {
    throw new ValidationError('Grant record validation failed', {
      fieldErrors: result.error.flatten().fieldErrors,
    });
  }
  return Object.freeze(result.data);
}
