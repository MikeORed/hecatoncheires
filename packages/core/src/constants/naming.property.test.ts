// Feature: core-foundation, Property 10: Naming generator produces pattern-conforming resource names
// Feature: core-foundation, Property 11: Naming generator rejects empty or whitespace-only stage

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { NamingGenerator } from './naming.js';
import { ValidationError } from '../errors/index.js';

/**
 * Generator for valid configNames matching ^[a-z][a-z0-9-]*[a-z0-9]$, 2–40 chars.
 */
const validConfigName = fc
  .stringMatching(/^[a-z][a-z0-9-]*[a-z0-9]$/)
  .filter((s) => s.length >= 2 && s.length <= 40);

/**
 * Generator for non-empty, non-whitespace-only stage strings.
 */
const validStage = fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0);

/**
 * Generator for handler names (non-empty alphanumeric + dashes).
 */
const validHandlerName = fc
  .stringMatching(/^[a-z][a-z0-9-]*[a-z0-9]$/)
  .filter((s) => s.length >= 2 && s.length <= 40);

/**
 * Generator for purpose strings (non-empty).
 */
const validPurpose = fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0);

describe('NamingGenerator property tests', () => {
  // **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 7.13, 7.14, 7.15**

  describe('Property 10: Naming generator produces pattern-conforming resource names', () => {
    it('roleName matches hecaton-{stage}-{configName}-agent-role', () => {
      fc.assert(
        fc.property(validStage, validConfigName, (stage, configName) => {
          const naming = new NamingGenerator(stage);
          expect(naming.roleName(configName)).toBe(
            `hecaton-${stage}-${configName}-agent-role`,
          );
        }),
        { numRuns: 100 },
      );
    });

    it('profileName matches hecaton-{stage}-{configName}-profile', () => {
      fc.assert(
        fc.property(validStage, validConfigName, (stage, configName) => {
          const naming = new NamingGenerator(stage);
          expect(naming.profileName(configName)).toBe(
            `hecaton-${stage}-${configName}-profile`,
          );
        }),
        { numRuns: 100 },
      );
    });

    it('guardrailName matches hecaton-{stage}-{configName}-guardrail', () => {
      fc.assert(
        fc.property(validStage, validConfigName, (stage, configName) => {
          const naming = new NamingGenerator(stage);
          expect(naming.guardrailName(configName)).toBe(
            `hecaton-${stage}-${configName}-guardrail`,
          );
        }),
        { numRuns: 100 },
      );
    });

    it('alarmNames.token matches hecaton-{stage}-{configName}-token-alarm', () => {
      fc.assert(
        fc.property(validStage, validConfigName, (stage, configName) => {
          const naming = new NamingGenerator(stage);
          const alarms = naming.alarmNames(configName);
          expect(alarms.token).toBe(`hecaton-${stage}-${configName}-token-alarm`);
        }),
        { numRuns: 100 },
      );
    });

    it('alarmNames.block matches hecaton-{stage}-{configName}-block-alarm', () => {
      fc.assert(
        fc.property(validStage, validConfigName, (stage, configName) => {
          const naming = new NamingGenerator(stage);
          const alarms = naming.alarmNames(configName);
          expect(alarms.block).toBe(`hecaton-${stage}-${configName}-block-alarm`);
        }),
        { numRuns: 100 },
      );
    });

    it('alarmNames.observation matches hecaton-{stage}-{configName}-observation-alarm', () => {
      fc.assert(
        fc.property(validStage, validConfigName, (stage, configName) => {
          const naming = new NamingGenerator(stage);
          const alarms = naming.alarmNames(configName);
          expect(alarms.observation).toBe(
            `hecaton-${stage}-${configName}-observation-alarm`,
          );
        }),
        { numRuns: 100 },
      );
    });

    it('queueNames.signals matches hecaton-{stage}-{configName}-signals.fifo', () => {
      fc.assert(
        fc.property(validStage, validConfigName, (stage, configName) => {
          const naming = new NamingGenerator(stage);
          const queues = naming.queueNames(configName);
          expect(queues.signals).toBe(`hecaton-${stage}-${configName}-signals.fifo`);
        }),
        { numRuns: 100 },
      );
    });

    it('queueNames.dlq matches hecaton-{stage}-{configName}-signals-dlq.fifo', () => {
      fc.assert(
        fc.property(validStage, validConfigName, (stage, configName) => {
          const naming = new NamingGenerator(stage);
          const queues = naming.queueNames(configName);
          expect(queues.dlq).toBe(`hecaton-${stage}-${configName}-signals-dlq.fifo`);
        }),
        { numRuns: 100 },
      );
    });

    it('lambdaName matches hecaton-{stage}-{handlerName}', () => {
      fc.assert(
        fc.property(validStage, validHandlerName, (stage, handlerName) => {
          const naming = new NamingGenerator(stage);
          expect(naming.lambdaName(handlerName)).toBe(
            `hecaton-${stage}-${handlerName}`,
          );
        }),
        { numRuns: 100 },
      );
    });

    it('ruleName matches hecaton-{stage}-{configName}-{purpose}', () => {
      fc.assert(
        fc.property(validStage, validConfigName, validPurpose, (stage, configName, purpose) => {
          const naming = new NamingGenerator(stage);
          expect(naming.ruleName(configName, purpose)).toBe(
            `hecaton-${stage}-${configName}-${purpose}`,
          );
        }),
        { numRuns: 100 },
      );
    });

    it('harnessName matches hecaton-{stage}-{configName}-harness', () => {
      fc.assert(
        fc.property(validStage, validConfigName, (stage, configName) => {
          const naming = new NamingGenerator(stage);
          expect(naming.harnessName(configName)).toBe(
            `hecaton-${stage}-${configName}-harness`,
          );
        }),
        { numRuns: 100 },
      );
    });

    it('stackName produces Hecaton-{CapitalizedStage}-{purpose}', () => {
      fc.assert(
        fc.property(validStage, validPurpose, (stage, purpose) => {
          const naming = new NamingGenerator(stage);
          const capitalizedStage = stage.charAt(0).toUpperCase() + stage.slice(1);
          expect(naming.stackName(purpose)).toBe(
            `Hecaton-${capitalizedStage}-${purpose}`,
          );
        }),
        { numRuns: 100 },
      );
    });

    it('tableName matches hecaton-{stage}-grant-ledger', () => {
      fc.assert(
        fc.property(validStage, (stage) => {
          const naming = new NamingGenerator(stage);
          expect(naming.tableName()).toBe(`hecaton-${stage}-grant-ledger`);
        }),
        { numRuns: 100 },
      );
    });

    it('tags includes required keys', () => {
      fc.assert(
        fc.property(validStage, validConfigName, (stage, configName) => {
          const naming = new NamingGenerator(stage);
          const result = naming.tags(configName);
          expect(result['hecatoncheires:managed']).toBe('true');
          expect(result['hecatoncheires:config']).toBe(configName);
          expect(result['hecatoncheires:stage']).toBe(stage);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('Property 11: Naming generator rejects empty or whitespace-only stage', () => {
    it('throws ValidationError for empty or whitespace-only stage', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('', ' ', '\t', '\n', '   ', '\t\n'),
          (stage) => {
            expect(() => new NamingGenerator(stage)).toThrow(ValidationError);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
