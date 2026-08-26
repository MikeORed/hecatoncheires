/**
 * Environment variable names forming the CDK-to-Lambda contract.
 * CDK stacks use these as keys in Lambda environment definitions;
 * API runtime uses them as keys in process.env lookups.
 */
export enum EnvVar {
  GRANT_LEDGER_TABLE_NAME = 'GRANT_LEDGER_TABLE_NAME',
  AGENT_REGISTRY_TABLE_NAME = 'AGENT_REGISTRY_TABLE_NAME',
  OPS_BUS_ARN = 'OPS_BUS_ARN',
  OPERATING_POLICY_NAME = 'OPERATING_POLICY_NAME',
  SNS_TOPIC_ARN = 'SNS_TOPIC_ARN',
  KNOWN_PRINCIPALS = 'KNOWN_PRINCIPALS',
}
