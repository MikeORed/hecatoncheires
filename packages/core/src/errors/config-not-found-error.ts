import { DomainError } from './domain-error.js';

export class ConfigNotFoundError extends DomainError {
  readonly code = 'CONFIG_NOT_FOUND' as const;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
  }
}
