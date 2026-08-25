import { DomainError } from './domain-error.js';

export class PolicySizeExceededError extends DomainError {
  readonly code = 'POLICY_SIZE_EXCEEDED' as const;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
  }
}
