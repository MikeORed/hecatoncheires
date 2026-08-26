import { describe, it, expect } from 'vitest';
import { NamingGenerator } from './naming.js';
import { ValidationError } from '../errors/index.js';

describe('NamingGenerator', () => {
  describe('constructor', () => {
    it('throws ValidationError for empty string', () => {
      expect(() => new NamingGenerator('')).toThrow(ValidationError);
    });

    it('throws ValidationError for whitespace-only string', () => {
      expect(() => new NamingGenerator('   ')).toThrow(ValidationError);
    });

    it('creates instance with valid stage', () => {
      expect(() => new NamingGenerator('dev')).not.toThrow();
    });
  });

  describe('with stage "dev" and configName "sre-ops"', () => {
    const naming = new NamingGenerator('dev');
    const configName = 'sre-ops';

    it('roleName produces correct pattern', () => {
      expect(naming.roleName(configName)).toBe('hecaton-dev-sre-ops-agent-role');
    });

    it('profileName produces correct pattern', () => {
      expect(naming.profileName(configName)).toBe('hecaton-dev-sre-ops-profile');
    });

    it('guardrailName produces correct pattern', () => {
      expect(naming.guardrailName(configName)).toBe('hecaton-dev-sre-ops-guardrail');
    });

    it('alarmNames produces correct patterns', () => {
      expect(naming.alarmNames(configName)).toEqual({
        token: 'hecaton-dev-sre-ops-token-alarm',
        block: 'hecaton-dev-sre-ops-block-alarm',
        observation: 'hecaton-dev-sre-ops-observation-alarm',
      });
    });

    it('queueNames produces correct patterns', () => {
      expect(naming.queueNames(configName)).toEqual({
        signals: 'hecaton-dev-sre-ops-signals.fifo',
        dlq: 'hecaton-dev-sre-ops-signals-dlq.fifo',
      });
    });

    it('lambdaName produces correct pattern', () => {
      expect(naming.lambdaName('grant-modulate')).toBe('hecaton-dev-grant-modulate');
    });

    it('ruleName produces correct pattern', () => {
      expect(naming.ruleName(configName, 'schedule')).toBe(
        'hecaton-dev-sre-ops-schedule',
      );
    });

    it('harnessName produces correct pattern', () => {
      expect(naming.harnessName(configName)).toBe('hecaton-dev-sre-ops-harness');
    });

    it('stackName capitalizes first letter of stage', () => {
      expect(naming.stackName('SharedInfra')).toBe('Hecaton-Dev-SharedInfra');
    });

    it('tableName produces correct pattern', () => {
      expect(naming.tableName()).toBe('hecaton-dev-grant-ledger');
    });

    it('busName produces correct pattern', () => {
      expect(naming.busName()).toBe('hecaton-dev-ops-bus');
    });

    it('snsTopicName produces correct pattern', () => {
      expect(naming.snsTopicName()).toBe('hecaton-dev-notifications');
    });

    it('apiGatewayName produces correct pattern', () => {
      expect(naming.apiGatewayName()).toBe('hecaton-dev-api');
    });

    it('agentRegistryTableName produces correct pattern', () => {
      expect(naming.agentRegistryTableName()).toBe('hecaton-dev-agent-registry');
    });
  });

  describe('AppConfig and infrastructure extension methods', () => {
    const naming = new NamingGenerator('dev');
    const configName = 'sre-ops';

    it('appConfigApplicationName produces correct pattern', () => {
      expect(naming.appConfigApplicationName()).toBe('hecaton-dev-platform');
    });

    it('appConfigEnvironmentName defaults to stage when no argument provided', () => {
      expect(naming.appConfigEnvironmentName()).toBe('hecaton-dev-dev');
    });

    it('appConfigEnvironmentName uses explicit environmentName when provided', () => {
      expect(naming.appConfigEnvironmentName('staging')).toBe('hecaton-dev-staging');
    });

    it('appConfigProfileName produces correct pattern', () => {
      expect(naming.appConfigProfileName(configName)).toBe('hecaton-dev-sre-ops-tunables');
    });

    it('driftDetectionLambdaName produces correct pattern', () => {
      expect(naming.driftDetectionLambdaName()).toBe('hecaton-dev-drift-detection');
    });

    it('bedrockLogGroupName produces correct pattern', () => {
      expect(naming.bedrockLogGroupName()).toBe('/aws/bedrock/invocations/dev');
    });
  });

  describe('AppConfig and infrastructure extension methods across stages', () => {
    it.each([
      { stage: 'prod', expected: 'hecaton-prod-platform' },
      { stage: 'staging', expected: 'hecaton-staging-platform' },
      { stage: 'sit', expected: 'hecaton-sit-platform' },
    ])(
      'appConfigApplicationName() for stage "$stage" → $expected',
      ({ stage, expected }) => {
        expect(new NamingGenerator(stage).appConfigApplicationName()).toBe(expected);
      },
    );

    it.each([
      { stage: 'prod', expected: 'hecaton-prod-prod' },
      { stage: 'staging', expected: 'hecaton-staging-staging' },
      { stage: 'sit', expected: 'hecaton-sit-sit' },
    ])(
      'appConfigEnvironmentName() defaults to stage for stage "$stage" → $expected',
      ({ stage, expected }) => {
        expect(new NamingGenerator(stage).appConfigEnvironmentName()).toBe(expected);
      },
    );

    it.each([
      { stage: 'prod', envName: 'canary', expected: 'hecaton-prod-canary' },
      { stage: 'staging', envName: 'beta', expected: 'hecaton-staging-beta' },
      { stage: 'sit', envName: 'integration', expected: 'hecaton-sit-integration' },
    ])(
      'appConfigEnvironmentName("$envName") for stage "$stage" → $expected',
      ({ stage, envName, expected }) => {
        expect(new NamingGenerator(stage).appConfigEnvironmentName(envName)).toBe(expected);
      },
    );

    it.each([
      { stage: 'prod', expected: 'hecaton-prod-sre-ops-tunables' },
      { stage: 'staging', expected: 'hecaton-staging-sre-ops-tunables' },
      { stage: 'sit', expected: 'hecaton-sit-sre-ops-tunables' },
    ])(
      'appConfigProfileName("sre-ops") for stage "$stage" → $expected',
      ({ stage, expected }) => {
        expect(new NamingGenerator(stage).appConfigProfileName('sre-ops')).toBe(expected);
      },
    );

    it.each([
      { stage: 'prod', expected: 'hecaton-prod-drift-detection' },
      { stage: 'staging', expected: 'hecaton-staging-drift-detection' },
      { stage: 'sit', expected: 'hecaton-sit-drift-detection' },
    ])(
      'driftDetectionLambdaName() for stage "$stage" → $expected',
      ({ stage, expected }) => {
        expect(new NamingGenerator(stage).driftDetectionLambdaName()).toBe(expected);
      },
    );

    it.each([
      { stage: 'prod', expected: '/aws/bedrock/invocations/prod' },
      { stage: 'staging', expected: '/aws/bedrock/invocations/staging' },
      { stage: 'sit', expected: '/aws/bedrock/invocations/sit' },
    ])(
      'bedrockLogGroupName() for stage "$stage" → $expected',
      ({ stage, expected }) => {
        expect(new NamingGenerator(stage).bedrockLogGroupName()).toBe(expected);
      },
    );
  });

  describe('infrastructure naming across stages', () => {
    it.each([
      { stage: 'prod', expected: 'hecaton-prod-ops-bus' },
      { stage: 'staging', expected: 'hecaton-staging-ops-bus' },
      { stage: 'sit', expected: 'hecaton-sit-ops-bus' },
    ])('busName() for stage "$stage" → $expected', ({ stage, expected }) => {
      expect(new NamingGenerator(stage).busName()).toBe(expected);
    });

    it.each([
      { stage: 'prod', expected: 'hecaton-prod-notifications' },
      { stage: 'staging', expected: 'hecaton-staging-notifications' },
      { stage: 'sit', expected: 'hecaton-sit-notifications' },
    ])('snsTopicName() for stage "$stage" → $expected', ({ stage, expected }) => {
      expect(new NamingGenerator(stage).snsTopicName()).toBe(expected);
    });

    it.each([
      { stage: 'prod', expected: 'hecaton-prod-api' },
      { stage: 'staging', expected: 'hecaton-staging-api' },
      { stage: 'sit', expected: 'hecaton-sit-api' },
    ])('apiGatewayName() for stage "$stage" → $expected', ({ stage, expected }) => {
      expect(new NamingGenerator(stage).apiGatewayName()).toBe(expected);
    });
  });

  describe('projectPrefix and projectFullName properties', () => {
    const naming = new NamingGenerator('dev');

    it('projectPrefix is "hecaton"', () => {
      expect(naming.projectPrefix).toBe('hecaton');
    });

    it('projectFullName is "hecatoncheires"', () => {
      expect(naming.projectFullName).toBe('hecatoncheires');
    });

    it('properties are consistent across instances with different stages', () => {
      const prod = new NamingGenerator('prod');
      const staging = new NamingGenerator('staging');
      expect(prod.projectPrefix).toBe(naming.projectPrefix);
      expect(prod.projectFullName).toBe(naming.projectFullName);
      expect(staging.projectPrefix).toBe(naming.projectPrefix);
      expect(staging.projectFullName).toBe(naming.projectFullName);
    });
  });

  describe('operatingPolicyName', () => {
    it('returns "hecaton-operating-policy"', () => {
      const naming = new NamingGenerator('dev');
      expect(naming.operatingPolicyName()).toBe('hecaton-operating-policy');
    });

    it('returns same value regardless of stage', () => {
      const dev = new NamingGenerator('dev');
      const prod = new NamingGenerator('prod');
      const staging = new NamingGenerator('staging');
      expect(dev.operatingPolicyName()).toBe('hecaton-operating-policy');
      expect(prod.operatingPolicyName()).toBe('hecaton-operating-policy');
      expect(staging.operatingPolicyName()).toBe('hecaton-operating-policy');
    });
  });

  describe('tagsToCfn', () => {
    const naming = new NamingGenerator('sit');

    it('produces base tags as { key, value } array', () => {
      const result = naming.tagsToCfn('my-agent');
      expect(result).toEqual([
        { key: 'hecatoncheires:managed', value: 'true' },
        { key: 'hecatoncheires:config', value: 'my-agent' },
        { key: 'hecatoncheires:stage', value: 'sit' },
      ]);
    });

    it('includes phase when provided', () => {
      const result = naming.tagsToCfn('my-agent', { phase: 'onboarding' });
      expect(result).toContainEqual({ key: 'hecatoncheires:phase', value: 'onboarding' });
    });

    it('includes harnessType when provided', () => {
      const result = naming.tagsToCfn('my-agent', { harnessType: 'AgentCore Managed' });
      expect(result).toContainEqual({
        key: 'hecatoncheires:harness-type',
        value: 'AgentCore Managed',
      });
    });

    it('includes both phase and harnessType when provided', () => {
      const result = naming.tagsToCfn('my-agent', {
        phase: 'active',
        harnessType: 'OpenClaw',
      });
      expect(result).toEqual([
        { key: 'hecatoncheires:managed', value: 'true' },
        { key: 'hecatoncheires:config', value: 'my-agent' },
        { key: 'hecatoncheires:stage', value: 'sit' },
        { key: 'hecatoncheires:phase', value: 'active' },
        { key: 'hecatoncheires:harness-type', value: 'OpenClaw' },
      ]);
    });

    it('produces same key-value pairs as tags() method', () => {
      const options = { phase: '1', harnessType: 'AgentCore Managed' };
      const cfnResult = naming.tagsToCfn('sre-ops', options);
      const tagsResult = naming.tags('sre-ops', options);

      // Convert cfn array back to record for comparison
      const cfnAsRecord: Record<string, string> = {};
      for (const { key, value } of cfnResult) {
        cfnAsRecord[key] = value;
      }
      expect(cfnAsRecord).toEqual(tagsResult);
    });
  });

  describe('tags', () => {
    const naming = new NamingGenerator('sit');

    it('produces base tags without options', () => {
      expect(naming.tags('my-agent')).toEqual({
        'hecatoncheires:managed': 'true',
        'hecatoncheires:config': 'my-agent',
        'hecatoncheires:stage': 'sit',
      });
    });

    it('includes phase when provided', () => {
      const result = naming.tags('my-agent', { phase: 'onboarding' });
      expect(result['hecatoncheires:phase']).toBe('onboarding');
    });

    it('includes harnessType when provided', () => {
      const result = naming.tags('my-agent', { harnessType: 'AgentCore Managed' });
      expect(result['hecatoncheires:harness-type']).toBe('AgentCore Managed');
    });

    it('includes both phase and harnessType when provided', () => {
      const result = naming.tags('my-agent', {
        phase: 'active',
        harnessType: 'OpenClaw',
      });
      expect(result).toEqual({
        'hecatoncheires:managed': 'true',
        'hecatoncheires:config': 'my-agent',
        'hecatoncheires:stage': 'sit',
        'hecatoncheires:phase': 'active',
        'hecatoncheires:harness-type': 'OpenClaw',
      });
    });
  });
});
