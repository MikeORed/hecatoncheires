import { DomainError } from './domain-error.js';

export class InternalError extends DomainError {
  readonly code = 'INTERNAL_ERROR' as const;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
  }
}
