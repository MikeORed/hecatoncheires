/**
 * Abstract base class for all domain errors in the Hecatoncheires platform.
 * Provides a machine-readable `code` property and optional structured `details`.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.details = details;
  }
}
