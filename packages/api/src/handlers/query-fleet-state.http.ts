import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DomainError } from '@hecaton/core';

import { successResponse, errorResponse } from '../adapters/http/dto/responses/envelope.js';
import { errorStatusMap } from '../adapters/http/error-status-map.js';
import { getDependencies } from '../shared/dependencies.js';
import { queryFleetState } from '../use-cases/query-fleet-state.js';

export async function handler(_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const deps = getDependencies();
    const result = await queryFleetState(deps);
    return successResponse(200, result);
  } catch (err) {
    if (err instanceof DomainError) {
      const status = errorStatusMap[err.code] ?? 500;
      return errorResponse(status, err.code, err.message, err.details);
    }
    return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  }
}
