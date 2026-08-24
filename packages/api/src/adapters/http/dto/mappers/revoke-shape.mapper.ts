export interface RevokeShapeResponse {
  agentId: string;
  configName: string;
  grantId: string;
  operation: 'revoked';
}

/** Maps revocation result to the response payload shape */
export function toResponse(
  result: { configName: string; grantId: string },
  agentId: string,
): RevokeShapeResponse {
  return {
    agentId,
    configName: result.configName,
    grantId: result.grantId,
    operation: 'revoked',
  };
}
