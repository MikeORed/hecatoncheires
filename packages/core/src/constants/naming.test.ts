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
