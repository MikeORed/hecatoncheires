export interface RevokeShapeResponse {
  configName: string;
  grantId: string;
  operation: 'revoked';
}

/** Maps revocation result to the response payload shape */
export function toResponse(result: {
  configName: string;
  grantId: string;
}): RevokeShapeResponse {
  return {
    configName: result.configName,
    grantId: result.grantId,
    operation: 'revoked',
  };
}
