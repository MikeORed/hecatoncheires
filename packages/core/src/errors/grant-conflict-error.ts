import { DomainError } from './domain-error.js';

export class GrantConflictError extends DomainError {
  readonly code = 'GRANT_CONFLICT' as const;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
  }
}
