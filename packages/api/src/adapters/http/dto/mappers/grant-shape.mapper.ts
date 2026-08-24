import type { GrantRecord } from '@hecaton/core';
import { generateId } from '@hecaton/core';

import type { GrantShapeRequest } from '../requests/grant-shape.request.js';

/** Maps validated HTTP request DTO to domain GrantRecord (generates grantId + grantedAt) */
export function toDomain(dto: GrantShapeRequest, configName: string): GrantRecord {
  return {
    grantId: generateId(),
    configName,
    shapeName: dto.shapeName,
    parameters: dto.parameters,
    grantedAt: new Date().toISOString(),
    grantedBy: dto.grantedBy,
    ...(dto.expiresAt !== undefined && { expiresAt: dto.expiresAt }),
  };
}

/** Maps domain GrantRecord to the response payload shape, including agentId */
export function toResponse(grant: GrantRecord, agentId: string): Record<string, unknown> {
  return {
    agentId,
    grantId: grant.grantId,
    configName: grant.configName,
    shapeName: grant.shapeName,
    parameters: grant.parameters,
    grantedAt: grant.grantedAt,
    grantedBy: grant.grantedBy,
    ...(grant.expiresAt !== undefined && { expiresAt: grant.expiresAt }),
  };
}
