import { RuntimeTunablesSchema } from '../schemas/runtime-tunables.schema.js';
import { ValidationError } from '../errors/validation-error.js';
import { RuntimeTunables } from '../types/index.js';

export function createRuntimeTunables(input: unknown): RuntimeTunables {
  const result = RuntimeTunablesSchema.safeParse(input);
  if (!result.success) {
    throw new ValidationError('Runtime tunables validation failed', {
      fieldErrors: result.error.flatten().fieldErrors,
    });
  }
  return Object.freeze(result.data);
}
