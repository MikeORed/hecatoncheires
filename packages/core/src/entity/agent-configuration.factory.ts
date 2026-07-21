import { AgentConfigurationSchema } from '../schemas/agent-configuration.schema.js';
import { ValidationError } from '../errors/validation-error.js';
import { AgentConfiguration } from '../types/index.js';

export function createAgentConfiguration(input: unknown): AgentConfiguration {
  const result = AgentConfigurationSchema.safeParse(input);
  if (!result.success) {
    throw new ValidationError('Agent configuration validation failed', {
      fieldErrors: result.error.flatten().fieldErrors,
    });
  }
  return Object.freeze(result.data);
}
