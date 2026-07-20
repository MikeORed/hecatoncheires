import { DomainError } from './domain-error.js';

export class InvalidShapeParametersError extends DomainError {
  readonly code = 'INVALID_SHAPE_PARAMETERS' as const;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
  }
}
