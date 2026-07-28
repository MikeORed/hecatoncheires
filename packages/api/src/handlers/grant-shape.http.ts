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

  // 2. Map to domain
  const grant = toDomain(parseResult.data);

  // 3. Execute use-case
  try {
    const deps = getDependencies();
    const result = await grantShape(grant, deps);
    return successResponse(201, toResponse(result));
  } catch (err) {
    if (err instanceof DomainError) {
      const status = errorStatusMap[err.code] ?? 500;
      return errorResponse(status, err.code, err.message, err.details);
    }
    return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  }
}
