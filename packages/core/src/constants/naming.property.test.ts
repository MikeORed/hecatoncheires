// Feature: core-foundation, Property 10: Naming generator produces pattern-conforming resource names
// Feature: core-foundation, Property 11: Naming generator rejects empty or whitespace-only stage
// Feature: phase1-infra-completion, Property 1: NamingGenerator methods produce stage-embedded, pattern-conforming names
// Feature: phase1-infra-completion, Property 2: NamingGenerator methods produce unique names across different methods

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


describe('NamingGenerator extension property tests', () => {
  // **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5**

  /**
   * Generator for valid environment names (non-empty alphanumeric + dashes).
   */
  const validEnvName = fc
    .stringMatching(/^[a-z][a-z0-9-]*[a-z0-9]$/)
    .filter((s) => s.length >= 2 && s.length <= 40);

  describe('Property 1: NamingGenerator methods produce stage-embedded, pattern-conforming names', () => {
    it('appConfigApplicationName matches hecaton-{stage}-platform', () => {
      fc.assert(
        fc.property(validStage, (stage) => {
          const naming = new NamingGenerator(stage);
          const result = naming.appConfigApplicationName();
          expect(result).toBe(`hecaton-${stage}-platform`);
          expect(result).toContain(stage);
        }),
        { numRuns: 100 },
      );
    });

    it('appConfigEnvironmentName with explicit envName matches hecaton-{stage}-{envName}', () => {
      fc.assert(
        fc.property(validStage, validEnvName, (stage, envName) => {
          const naming = new NamingGenerator(stage);
          const result = naming.appConfigEnvironmentName(envName);
          expect(result).toBe(`hecaton-${stage}-${envName}`);
          expect(result).toContain(stage);
          expect(result).toContain(envName);
        }),
        { numRuns: 100 },
      );
    });

    it('appConfigEnvironmentName without envName defaults to stage', () => {
      fc.assert(
        fc.property(validStage, (stage) => {
          const naming = new NamingGenerator(stage);
          const result = naming.appConfigEnvironmentName();
          expect(result).toBe(`hecaton-${stage}-${stage}`);
          expect(result).toContain(stage);
        }),
        { numRuns: 100 },
      );
    });

    it('appConfigProfileName matches hecaton-{stage}-{configName}-tunables', () => {
      fc.assert(
        fc.property(validStage, validConfigName, (stage, configName) => {
          const naming = new NamingGenerator(stage);
          const result = naming.appConfigProfileName(configName);
          expect(result).toBe(`hecaton-${stage}-${configName}-tunables`);
          expect(result).toContain(stage);
          expect(result).toContain(configName);
        }),
        { numRuns: 100 },
      );
    });

    it('driftDetectionLambdaName matches hecaton-{stage}-drift-detection', () => {
      fc.assert(
        fc.property(validStage, (stage) => {
          const naming = new NamingGenerator(stage);
          const result = naming.driftDetectionLambdaName();
          expect(result).toBe(`hecaton-${stage}-drift-detection`);
          expect(result).toContain(stage);
        }),
        { numRuns: 100 },
      );
    });

    it('bedrockLogGroupName matches /aws/bedrock/invocations/{stage}', () => {
      fc.assert(
        fc.property(validStage, (stage) => {
          const naming = new NamingGenerator(stage);
          const result = naming.bedrockLogGroupName();
          expect(result).toBe(`/aws/bedrock/invocations/${stage}`);
          expect(result).toContain(stage);
        }),
        { numRuns: 100 },
      );
    });

    it('all new methods are deterministic (same inputs → same output)', () => {
      fc.assert(
        fc.property(validStage, validConfigName, (stage, configName) => {
          const naming1 = new NamingGenerator(stage);
          const naming2 = new NamingGenerator(stage);
          expect(naming1.appConfigApplicationName()).toBe(naming2.appConfigApplicationName());
          expect(naming1.appConfigEnvironmentName()).toBe(naming2.appConfigEnvironmentName());
          expect(naming1.appConfigProfileName(configName)).toBe(
            naming2.appConfigProfileName(configName),
          );
          expect(naming1.driftDetectionLambdaName()).toBe(naming2.driftDetectionLambdaName());
          expect(naming1.bedrockLogGroupName()).toBe(naming2.bedrockLogGroupName());
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('Property 2: NamingGenerator methods produce unique names across different methods', () => {
    it('no two NamingGenerator methods produce the same output for identical inputs', () => {
      fc.assert(
        fc.property(validStage, validConfigName, (stage, configName) => {
          const naming = new NamingGenerator(stage);

          // Collect all outputs from methods that take configName
          const configNameOutputs = [
            naming.roleName(configName),
            naming.profileName(configName),
            naming.guardrailName(configName),
            naming.alarmNames(configName).token,
            naming.alarmNames(configName).block,
            naming.alarmNames(configName).observation,
            naming.queueNames(configName).signals,
            naming.queueNames(configName).dlq,
            naming.harnessName(configName),
            naming.appConfigProfileName(configName),
            naming.ruleName(configName, 'default'),
          ];

          // Collect all outputs from no-arg / stage-only methods
          const noArgOutputs = [
            naming.tableName(),
            naming.busName(),
            naming.snsTopicName(),
            naming.apiGatewayName(),
            naming.agentRegistryTableName(),
            naming.appConfigApplicationName(),
            naming.appConfigEnvironmentName(),
            naming.driftDetectionLambdaName(),
            naming.bedrockLogGroupName(),
          ];

          // All combined outputs must be unique
          const allOutputs = [...configNameOutputs, ...noArgOutputs];
          const uniqueOutputs = new Set(allOutputs);
          expect(uniqueOutputs.size).toBe(allOutputs.length);
        }),
        { numRuns: 100 },
      );
    });

    it('new extension methods produce outputs distinct from each other', () => {
      fc.assert(
        fc.property(validStage, validConfigName, (stage, configName) => {
          const naming = new NamingGenerator(stage);

          const extensionOutputs = [
            naming.appConfigApplicationName(),
            naming.appConfigEnvironmentName(),
            naming.appConfigProfileName(configName),
            naming.driftDetectionLambdaName(),
            naming.bedrockLogGroupName(),
          ];

          const uniqueOutputs = new Set(extensionOutputs);
          expect(uniqueOutputs.size).toBe(extensionOutputs.length);
        }),
        { numRuns: 100 },
      );
    });
  });
});


describe('Magic String Cleanup Properties', () => {
  // **Validates: Requirements 1.3**

  describe('Property 1: Name methods embed projectPrefix', () => {
    it('all resource name methods contain projectPrefix as substring', () => {
      fc.assert(
        fc.property(
          validStage,
          validConfigName,
          validHandlerName,
          validPurpose,
          (stage, configName, handlerName, purpose) => {
            const naming = new NamingGenerator(stage);

            // All name methods should contain projectPrefix
            const nameOutputs = [
              naming.roleName(configName),
              naming.profileName(configName),
              naming.guardrailName(configName),
              naming.alarmNames(configName).token,
              naming.alarmNames(configName).block,
              naming.alarmNames(configName).observation,
              naming.queueNames(configName).signals,
              naming.queueNames(configName).dlq,
              naming.lambdaName(handlerName),
              naming.ruleName(configName, purpose),
              naming.harnessName(configName),
              naming.tableName(),
              naming.busName(),
              naming.snsTopicName(),
              naming.apiGatewayName(),
              naming.agentRegistryTableName(),
              naming.appConfigApplicationName(),
              naming.appConfigEnvironmentName(),
              naming.appConfigProfileName(configName),
              naming.driftDetectionLambdaName(),
              naming.operatingPolicyName(),
            ];

            for (const name of nameOutputs) {
              expect(name).toContain(naming.projectPrefix);
            }

            // stackName uses capitalized projectPrefix
            const stack = naming.stackName(purpose);
            const capitalizedPrefix =
              naming.projectPrefix.charAt(0).toUpperCase() + naming.projectPrefix.slice(1);
            expect(stack).toContain(capitalizedPrefix);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('all tag keys contain projectFullName as substring', () => {
      fc.assert(
        fc.property(validStage, validConfigName, (stage, configName) => {
          const naming = new NamingGenerator(stage);
          const tagsRecord = naming.tags(configName, { phase: '1', harnessType: 'test' });

          for (const key of Object.keys(tagsRecord)) {
            expect(key).toContain(naming.projectFullName);
          }
        }),
        { numRuns: 100 },
      );
    });
  });
});


describe('Magic String Cleanup Properties', () => {
  // **Validates: Requirements 1.3, 2.2, 2.3, 2.4**

  describe('Property 2: tagsToCfn equivalence with tags', () => {
    const optionalPhase = fc.option(
      fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
      { nil: undefined },
    );
    const optionalHarnessType = fc.option(
      fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
      { nil: undefined },
    );

    it('converting tagsToCfn array back to Record equals tags() output', () => {
      fc.assert(
        fc.property(
          validStage,
          validConfigName,
          optionalPhase,
          optionalHarnessType,
          (stage, configName, phase, harnessType) => {
            const naming = new NamingGenerator(stage);
            const options = { phase, harnessType };

            const tagsRecord = naming.tags(configName, options);
            const cfnArray = naming.tagsToCfn(configName, options);

            // Convert cfnArray back to Record
            const reconstructed: Record<string, string> = {};
            for (const { key, value } of cfnArray) {
              reconstructed[key] = value;
            }

            expect(reconstructed).toEqual(tagsRecord);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('tagsToCfn produces one element per tag entry', () => {
      fc.assert(
        fc.property(
          validStage,
          validConfigName,
          optionalPhase,
          optionalHarnessType,
          (stage, configName, phase, harnessType) => {
            const naming = new NamingGenerator(stage);
            const options = { phase, harnessType };

            const tagsRecord = naming.tags(configName, options);
            const cfnArray = naming.tagsToCfn(configName, options);

            expect(cfnArray.length).toBe(Object.keys(tagsRecord).length);
          },
        ),
        { numRuns: 200 },
      );
    });
  });
});
