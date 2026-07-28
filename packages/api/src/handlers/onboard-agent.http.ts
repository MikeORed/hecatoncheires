import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DomainError } from '@hecaton/core';

import { OnboardAgentRequestSchema } from '../adapters/http/dto/requests/onboard-agent.request.js';
import { toResponse } from '../adapters/http/dto/mappers/onboard-agent.mapper.js';
import { successResponse, errorResponse } from '../adapters/http/dto/responses/envelope.js';
import { errorStatusMap } from '../adapters/http/error-status-map.js';
import { getDependencies } from '../shared/dependencies.js';
import { onboardAgent } from '../use-cases/onboard-agent.js';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  // 1. Parse request body
  const parseResult = OnboardAgentRequestSchema.safeParse(JSON.parse(event.body ?? '{}'));
  if (!parseResult.success) {
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request body', parseResult.error.issues);
  }

  // 2. Execute use-case
  try {
    const deps = getDependencies();
    const result = await onboardAgent(parseResult.data, deps);
    return successResponse(201, toResponse(result));
  } catch (err) {
    if (err instanceof DomainError) {
      const status = errorStatusMap[err.code] ?? 500;
      return errorResponse(status, err.code, err.message, err.details);
    }
    return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  }
}
