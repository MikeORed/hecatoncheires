export interface OnboardAgentResponse {
  configName: string;
}

/** Maps onboard result to the response payload shape */
export function toResponse(result: { configName: string }): OnboardAgentResponse {
  return {
    configName: result.configName,
  };
}
