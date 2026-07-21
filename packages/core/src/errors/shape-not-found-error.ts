import { DomainError } from './domain-error.js';

export class ShapeNotFoundError extends DomainError {
  readonly code = 'SHAPE_NOT_FOUND' as const;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
  }
}
