import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DomainError } from '@hecaton/core';

import { GrantShapeRequestSchema } from '../adapters/http/dto/requests/grant-shape.request.js';
import { toDomain, toResponse } from '../adapters/http/dto/mappers/grant-shape.mapper.js';
import { successResponse, errorResponse } from '../adapters/http/dto/responses/envelope.js';
import { errorStatusMap } from '../adapters/http/error-status-map.js';
import { getDependencies } from '../shared/dependencies.js';
import { grantShape } from '../use-cases/grant-shape.js';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  // 1. Parse request body
  const parseResult = GrantShapeRequestSchema.safeParse(JSON.parse(event.body ?? '{}'));
  if (!parseResult.success) {
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request body', parseResult.error.issues);
  }

  // 2. Resolve agentId → configName + roleName via registry
  const deps = getDependencies();
  const agent = await deps.agentRegistry.getByAgentId(parseResult.data.agentId);
  if (!agent) {
    return errorResponse(404, 'AGENT_NOT_FOUND', `Agent not found: ${parseResult.data.agentId}`);
  }

  // 3. Map to domain (using resolved configName)
  const grant = toDomain(parseResult.data, agent.configName);

  // 4. Execute use-case with resolved roleName
  try {
    const result = await grantShape(grant, agent.roleName, deps);
    return successResponse(201, toResponse(result, agent.agentId));
  } catch (err) {
    if (err instanceof DomainError) {
      const status = errorStatusMap[err.code] ?? 500;
      return errorResponse(status, err.code, err.message, err.details);
    }
    return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  }
}
