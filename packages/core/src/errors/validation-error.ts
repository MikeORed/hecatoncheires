import { DomainError } from './domain-error.js';

export class ValidationError extends DomainError {
  readonly code = 'VALIDATION_ERROR' as const;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
  }
}
