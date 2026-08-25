import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DomainError } from '@hecaton/core';

import { RevokeShapeRequestSchema } from '../adapters/http/dto/requests/revoke-shape.request.js';
import { toResponse } from '../adapters/http/dto/mappers/revoke-shape.mapper.js';
import { successResponse, errorResponse } from '../adapters/http/dto/responses/envelope.js';
import { errorStatusMap } from '../adapters/http/error-status-map.js';
import { getDependencies } from '../shared/dependencies.js';
import { revokeShape } from '../use-cases/revoke-shape.js';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  // 1. Parse request body
  const parseResult = RevokeShapeRequestSchema.safeParse(JSON.parse(event.body ?? '{}'));
  if (!parseResult.success) {
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request body', parseResult.error.issues);
  }

  // 2. Resolve agentId → configName + roleName via registry
  const deps = getDependencies();
  const agent = await deps.agentRegistry.getByAgentId(parseResult.data.agentId);
  if (!agent) {
    return errorResponse(404, 'AGENT_NOT_FOUND', `Agent not found: ${parseResult.data.agentId}`);
  }

  // 3. Execute use-case with resolved identity
  try {
    const result = await revokeShape(
      {
        configName: agent.configName,
        roleName: agent.roleName,
        grantId: parseResult.data.grantId,
      },
      deps,
    );
    return successResponse(200, toResponse(result, agent.agentId));
  } catch (err) {
    if (err instanceof DomainError) {
      const status = errorStatusMap[err.code] ?? 500;
      return errorResponse(status, err.code, err.message, err.details);
    }
    return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  }
}
