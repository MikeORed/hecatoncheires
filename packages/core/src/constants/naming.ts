import { ValidationError } from '../errors/index.js';

/**
 * Deterministic resource name generator for all Hecatoncheires AWS resources.
 * Produces consistent, environment-aware names from a stage and configName.
 */
export class NamingGenerator {
  private readonly stage: string;

  constructor(stage: string) {
    if (!stage || stage.trim().length === 0) {
      throw new ValidationError('Stage must be a non-empty string');
    }
    this.stage = stage;
  }

  /** Pattern: hecaton-{stage}-{configName}-agent-role */
  roleName(configName: string): string {
    return `hecaton-${this.stage}-${configName}-agent-role`;
  }

  /** Pattern: hecaton-{stage}-{configName}-profile */
  profileName(configName: string): string {
    return `hecaton-${this.stage}-${configName}-profile`;
  }

  /** Pattern: hecaton-{stage}-{configName}-guardrail */
  guardrailName(configName: string): string {
    return `hecaton-${this.stage}-${configName}-guardrail`;
  }

  /** Patterns: token-alarm, block-alarm, observation-alarm */
  alarmNames(configName: string): { token: string; block: string; observation: string } {
    const prefix = `hecaton-${this.stage}-${configName}`;
    return {
      token: `${prefix}-token-alarm`,
      block: `${prefix}-block-alarm`,
      observation: `${prefix}-observation-alarm`,
    };
  }

  /** Patterns: signals.fifo, signals-dlq.fifo */
  queueNames(configName: string): { signals: string; dlq: string } {
    const prefix = `hecaton-${this.stage}-${configName}`;
    return {
      signals: `${prefix}-signals.fifo`,
      dlq: `${prefix}-signals-dlq.fifo`,
    };
  }

  /** Pattern: hecaton-{stage}-{handlerName} */
  lambdaName(handlerName: string): string {
    return `hecaton-${this.stage}-${handlerName}`;
  }

  /** Pattern: hecaton-{stage}-{configName}-{purpose} */
  ruleName(configName: string, purpose: string): string {
    return `hecaton-${this.stage}-${configName}-${purpose}`;
  }

  /** Pattern: hecaton-{stage}-{configName}-harness */
  harnessName(configName: string): string {
    return `hecaton-${this.stage}-${configName}-harness`;
  }

  /** Pattern: Hecaton-{Stage}-{Purpose} (first letter of stage capitalized) */
  stackName(purpose: string): string {
    const capitalizedStage = this.stage.charAt(0).toUpperCase() + this.stage.slice(1);
    return `Hecaton-${capitalizedStage}-${purpose}`;
  }

  /** Pattern: hecaton-{stage}-grant-ledger */
  tableName(): string {
    return `hecaton-${this.stage}-grant-ledger`;
  }

  /** Resource tags for Hecatoncheires-managed resources. */
  tags(
    configName: string,
    options?: { phase?: string; harnessType?: string },
  ): Record<string, string> {
    const result: Record<string, string> = {
      'hecatoncheires:managed': 'true',
      'hecatoncheires:config': configName,
      'hecatoncheires:stage': this.stage,
    };

    if (options?.phase) {
      result['hecatoncheires:phase'] = options.phase;
    }

    if (options?.harnessType) {
      result['hecatoncheires:harness-type'] = options.harnessType;
    }

    return result;
  }
}
