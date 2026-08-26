import { ValidationError } from '../errors/index.js';

/**
 * Deterministic resource name generator for all Hecatoncheires AWS resources.
 * Produces consistent, environment-aware names from a stage and configName.
 */
export class NamingGenerator {
  private readonly stage: string;

  /** The short project prefix used in all resource names. */
  readonly projectPrefix = 'hecaton' as const;

  /** The full project name used in tag keys and metadata. */
  readonly projectFullName = 'hecatoncheires' as const;

  constructor(stage: string) {
    if (!stage || stage.trim().length === 0) {
      throw new ValidationError('Stage must be a non-empty string');
    }
    this.stage = stage;
  }

  /**
   * The fixed inline policy name for the modulated operating policy.
   * Pattern: {projectPrefix}-operating-policy
   */
  operatingPolicyName(): string {
    return `${this.projectPrefix}-operating-policy`;
  }

  /** Pattern: hecaton-{stage}-{configName}-agent-role */
  roleName(configName: string): string {
    return `${this.projectPrefix}-${this.stage}-${configName}-agent-role`;
  }

  /** Pattern: hecaton-{stage}-{configName}-profile */
  profileName(configName: string): string {
    return `${this.projectPrefix}-${this.stage}-${configName}-profile`;
  }

  /** Pattern: hecaton-{stage}-{configName}-{label}-profile */
  multiProfileName(configName: string, label: string): string {
    return `${this.projectPrefix}-${this.stage}-${configName}-${label}-profile`;
  }

  /** Per-profile alarm naming. Pattern: hecaton-{stage}-{configName}-{label}-{type}-alarm */
  perProfileAlarmNames(
    configName: string,
    label: string,
  ): { token: string; block: string; observation: string } {
    const prefix = `${this.projectPrefix}-${this.stage}-${configName}-${label}`;
    return {
      token: `${prefix}-token-alarm`,
      block: `${prefix}-block-alarm`,
      observation: `${prefix}-observation-alarm`,
    };
  }

  /** Pattern: hecaton-{stage}-{configName}-guardrail */
  guardrailName(configName: string): string {
    return `${this.projectPrefix}-${this.stage}-${configName}-guardrail`;
  }

  /** Patterns: token-alarm, block-alarm, observation-alarm */
  alarmNames(configName: string): { token: string; block: string; observation: string } {
    const prefix = `${this.projectPrefix}-${this.stage}-${configName}`;
    return {
      token: `${prefix}-token-alarm`,
      block: `${prefix}-block-alarm`,
      observation: `${prefix}-observation-alarm`,
    };
  }

  /** Patterns: signals.fifo, signals-dlq.fifo */
  queueNames(configName: string): { signals: string; dlq: string } {
    const prefix = `${this.projectPrefix}-${this.stage}-${configName}`;
    return {
      signals: `${prefix}-signals.fifo`,
      dlq: `${prefix}-signals-dlq.fifo`,
    };
  }

  /** Pattern: hecaton-{stage}-{handlerName} */
  lambdaName(handlerName: string): string {
    return `${this.projectPrefix}-${this.stage}-${handlerName}`;
  }

  /** Pattern: hecaton-{stage}-{configName}-{purpose} */
  ruleName(configName: string, purpose: string): string {
    return `${this.projectPrefix}-${this.stage}-${configName}-${purpose}`;
  }

  /** Pattern: hecaton-{stage}-{configName}-harness */
  harnessName(configName: string): string {
    return `${this.projectPrefix}-${this.stage}-${configName}-harness`;
  }

  /** Pattern: Hecaton-{Stage}-{Purpose} (first letter of stage capitalized) */
  stackName(purpose: string): string {
    const capitalizedPrefix =
      this.projectPrefix.charAt(0).toUpperCase() + this.projectPrefix.slice(1);
    const capitalizedStage = this.stage.charAt(0).toUpperCase() + this.stage.slice(1);
    return `${capitalizedPrefix}-${capitalizedStage}-${purpose}`;
  }

  /** Pattern: hecaton-{stage}-grant-ledger */
  tableName(): string {
    return `${this.projectPrefix}-${this.stage}-grant-ledger`;
  }

  /** Pattern: hecaton-{stage}-ops-bus */
  busName(): string {
    return `${this.projectPrefix}-${this.stage}-ops-bus`;
  }

  /** Pattern: hecaton-{stage}-notifications */
  snsTopicName(): string {
    return `${this.projectPrefix}-${this.stage}-notifications`;
  }

  /** Pattern: hecaton-{stage}-api */
  apiGatewayName(): string {
    return `${this.projectPrefix}-${this.stage}-api`;
  }

  /** Pattern: hecaton-{stage}-agent-registry */
  agentRegistryTableName(): string {
    return `${this.projectPrefix}-${this.stage}-agent-registry`;
  }

  /** Pattern: hecaton-{stage}-platform */
  appConfigApplicationName(): string {
    return `${this.projectPrefix}-${this.stage}-platform`;
  }

  /** Pattern: hecaton-{stage}-{environmentName} (defaults to stage) */
  appConfigEnvironmentName(environmentName?: string): string {
    return `${this.projectPrefix}-${this.stage}-${environmentName ?? this.stage}`;
  }

  /** Pattern: hecaton-{stage}-{configName}-tunables */
  appConfigProfileName(configName: string): string {
    return `${this.projectPrefix}-${this.stage}-${configName}-tunables`;
  }

  /** Pattern: hecaton-{stage}-drift-detection */
  driftDetectionLambdaName(): string {
    return `${this.projectPrefix}-${this.stage}-drift-detection`;
  }

  /** Pattern: /aws/bedrock/invocations/{stage} */
  bedrockLogGroupName(): string {
    return `/aws/bedrock/invocations/${this.stage}`;
  }

  /**
   * Converts tags() output into CloudFormation-compatible format.
   * Returns { key, value }[] suitable for L1 construct `tags` props.
   */
  tagsToCfn(
    configName: string,
    options?: { phase?: string; harnessType?: string },
  ): { key: string; value: string }[] {
    const record = this.tags(configName, options);
    return Object.entries(record).map(([key, value]) => ({ key, value }));
  }

  /** Resource tags for Hecatoncheires-managed resources. */
  tags(
    configName: string,
    options?: { phase?: string; harnessType?: string },
  ): Record<string, string> {
    const result: Record<string, string> = {
      [`${this.projectFullName}:managed`]: 'true',
      [`${this.projectFullName}:config`]: configName,
      [`${this.projectFullName}:stage`]: this.stage,
    };

    if (options?.phase) {
      result[`${this.projectFullName}:phase`] = options.phase;
    }

    if (options?.harnessType) {
      result[`${this.projectFullName}:harness-type`] = options.harnessType;
    }

    return result;
  }
}
