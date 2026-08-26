import { DomainError } from './domain-error.js';

export class ProfileExclusivityError extends DomainError {
  readonly code = 'PROFILE_EXCLUSIVITY' as const;

  constructor(
    public readonly conflictingAgent: string,
    public readonly conflictingProfileArn: string,
  ) {
    super(
      `Profile exclusivity violation: ${conflictingProfileArn} already owned by agent ${conflictingAgent}`,
      { conflictingAgent, conflictingProfileArn },
    );
  }
}
