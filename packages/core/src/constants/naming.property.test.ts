// Feature: core-foundation, Property 10: Naming generator produces pattern-conforming resource names
// Feature: core-foundation, Property 11: Naming generator rejects empty or whitespace-only stage
// Feature: phase1-infra-completion, Property 1: NamingGenerator methods produce stage-embedded, pattern-conforming names
// Feature: phase1-infra-completion, Property 2: NamingGenerator methods produce unique names across different methods
// Feature: tag-consolidation, Property 1: Agent tag set content
// Feature: tag-consolidation, Property 2: Shared tag set content and exclusions
// Feature: tag-consolidation, Property 3: No phase key emitted
// Feature: tag-consolidation, Property 4: Agent CFN round-trip
// Feature: tag-consolidation, Property 5: Shared CFN round-trip

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { NamingGenerator } from './naming.js';
import { ValidationError } from '../errors/index.js';
import type { AgentType } from '../types/index.js';

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

/**
 * Generator for valid AgentType enum values.
 */
const validAgentType = fc.constantFrom<AgentType>(
  'agentcore-managed',
  'openclaw',
  'agentcore-runtime',
);

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

    it('all agent tag keys contain projectFullName as substring', () => {
      fc.assert(
        fc.property(validStage, validConfigName, validAgentType, (stage, configName, agentType) => {
          const naming = new NamingGenerator(stage);
          const tagsRecord = naming.agentTags(configName, { agentType });

          for (const key of Object.keys(tagsRecord)) {
            expect(key).toContain(naming.projectFullName);
          }
        }),
        { numRuns: 100 },
      );
    });
  });
});


describe('Tag Consolidation Properties', () => {
  const projectFullName = 'hecatoncheires';

  describe('Feature: tag-consolidation, Property 1: Agent tag set content', () => {
    // **Validates: Requirements 1.1, 1.9, 6.4, 6.5**
    it('agentTags returns exactly the four agent keys with correct values', () => {
      fc.assert(
        fc.property(validStage, validConfigName, validAgentType, (stage, configName, agentType) => {
          const naming = new NamingGenerator(stage);
          const result = naming.agentTags(configName, { agentType });

          const keys = Object.keys(result).sort();
          expect(keys).toEqual(
            [
              `${projectFullName}:managed`,
              `${projectFullName}:stage`,
              `${projectFullName}:config`,
              `${projectFullName}:agent-type`,
            ].sort(),
          );

          expect(result[`${projectFullName}:managed`]).toBe('true');
          expect(result[`${projectFullName}:stage`]).toBe(stage);
          expect(result[`${projectFullName}:config`]).toBe(configName);
          expect(result[`${projectFullName}:agent-type`]).toBe(agentType);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('Feature: tag-consolidation, Property 2: Shared tag set content and exclusions', () => {
    // **Validates: Requirements 1.2, 1.5, 6.1, 6.2, 6.4, 6.5**
    it('sharedTags returns exactly managed and stage, never config or agent-type', () => {
      fc.assert(
        fc.property(validStage, (stage) => {
          const naming = new NamingGenerator(stage);
          const result = naming.sharedTags();

          const keys = Object.keys(result).sort();
          expect(keys).toEqual(
            [`${projectFullName}:managed`, `${projectFullName}:stage`].sort(),
          );

          expect(result[`${projectFullName}:managed`]).toBe('true');
          expect(result[`${projectFullName}:stage`]).toBe(stage);

          expect(result).not.toHaveProperty(`${projectFullName}:config`);
          expect(result).not.toHaveProperty(`${projectFullName}:agent-type`);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('Feature: tag-consolidation, Property 3: No phase key emitted', () => {
    // **Validates: Requirements 1.6**
    it('no tag method emits a hecatoncheires:phase key', () => {
      fc.assert(
        fc.property(validStage, validConfigName, validAgentType, (stage, configName, agentType) => {
          const naming = new NamingGenerator(stage);
          const phaseKey = `${projectFullName}:phase`;

          const agentKeys = Object.keys(naming.agentTags(configName, { agentType }));
          const sharedKeys = Object.keys(naming.sharedTags());
          const agentCfnKeys = naming.agentTagsToCfn(configName, { agentType }).map((t) => t.key);
          const sharedCfnKeys = naming.sharedTagsToCfn().map((t) => t.key);

          expect(agentKeys).not.toContain(phaseKey);
          expect(sharedKeys).not.toContain(phaseKey);
          expect(agentCfnKeys).not.toContain(phaseKey);
          expect(sharedCfnKeys).not.toContain(phaseKey);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('Feature: tag-consolidation, Property 4: Agent CFN round-trip', () => {
    // **Validates: Requirements 1.3**
    it('Object.fromEntries of agentTagsToCfn equals agentTags, with matching length', () => {
      fc.assert(
        fc.property(validStage, validConfigName, validAgentType, (stage, configName, agentType) => {
          const naming = new NamingGenerator(stage);
          const record = naming.agentTags(configName, { agentType });
          const cfnArray = naming.agentTagsToCfn(configName, { agentType });

          const reconstructed = Object.fromEntries(cfnArray.map(({ key, value }) => [key, value]));
          expect(reconstructed).toEqual(record);
          expect(cfnArray.length).toBe(Object.keys(record).length);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('Feature: tag-consolidation, Property 5: Shared CFN round-trip', () => {
    // **Validates: Requirements 1.4**
    it('Object.fromEntries of sharedTagsToCfn equals sharedTags, with matching length', () => {
      fc.assert(
        fc.property(validStage, (stage) => {
          const naming = new NamingGenerator(stage);
          const record = naming.sharedTags();
          const cfnArray = naming.sharedTagsToCfn();

          const reconstructed = Object.fromEntries(cfnArray.map(({ key, value }) => [key, value]));
          expect(reconstructed).toEqual(record);
          expect(cfnArray.length).toBe(Object.keys(record).length);
        }),
        { numRuns: 100 },
      );
    });
  });
});


describe('Multi-Profile Identity: Per-profile alarm naming', () => {
  // Feature: multi-profile-identity
  // **Validates: Requirements 5.5**

  /**
   * Generator for valid model binding labels matching ^[a-z][a-z0-9-]*$, 1–30 chars.
   */
  const validLabel = fc
    .stringMatching(/^[a-z][a-z0-9-]*$/)
    .filter((s) => s.length >= 1 && s.length <= 30);

  describe('Property 5: Per-profile alarm naming follows pattern', () => {
    it('perProfileAlarmNames.token matches hecaton-{stage}-{configName}-{label}-token-alarm', () => {
      fc.assert(
        fc.property(validStage, validConfigName, validLabel, (stage, configName, label) => {
          const naming = new NamingGenerator(stage);
          const alarms = naming.perProfileAlarmNames(configName, label);
          expect(alarms.token).toBe(
            `hecaton-${stage}-${configName}-${label}-token-alarm`,
          );
        }),
        { numRuns: 200 },
      );
    });

    it('perProfileAlarmNames.block matches hecaton-{stage}-{configName}-{label}-block-alarm', () => {
      fc.assert(
        fc.property(validStage, validConfigName, validLabel, (stage, configName, label) => {
          const naming = new NamingGenerator(stage);
          const alarms = naming.perProfileAlarmNames(configName, label);
          expect(alarms.block).toBe(
            `hecaton-${stage}-${configName}-${label}-block-alarm`,
          );
        }),
        { numRuns: 200 },
      );
    });

    it('perProfileAlarmNames.observation matches hecaton-{stage}-{configName}-{label}-observation-alarm', () => {
      fc.assert(
        fc.property(validStage, validConfigName, validLabel, (stage, configName, label) => {
          const naming = new NamingGenerator(stage);
          const alarms = naming.perProfileAlarmNames(configName, label);
          expect(alarms.observation).toBe(
            `hecaton-${stage}-${configName}-${label}-observation-alarm`,
          );
        }),
        { numRuns: 200 },
      );
    });

    it('multiProfileName matches hecaton-{stage}-{configName}-{label}-profile', () => {
      fc.assert(
        fc.property(validStage, validConfigName, validLabel, (stage, configName, label) => {
          const naming = new NamingGenerator(stage);
          expect(naming.multiProfileName(configName, label)).toBe(
            `hecaton-${stage}-${configName}-${label}-profile`,
          );
        }),
        { numRuns: 200 },
      );
    });

    it('perProfileAlarmNames returns exactly three keys: token, block, observation', () => {
      fc.assert(
        fc.property(validStage, validConfigName, validLabel, (stage, configName, label) => {
          const naming = new NamingGenerator(stage);
          const alarms = naming.perProfileAlarmNames(configName, label);
          const keys = Object.keys(alarms).sort();
          expect(keys).toEqual(['block', 'observation', 'token']);
        }),
        { numRuns: 200 },
      );
    });

    it('perProfileAlarmNames produces distinct values for all three alarm types', () => {
      fc.assert(
        fc.property(validStage, validConfigName, validLabel, (stage, configName, label) => {
          const naming = new NamingGenerator(stage);
          const alarms = naming.perProfileAlarmNames(configName, label);
          const values = [alarms.token, alarms.block, alarms.observation];
          expect(new Set(values).size).toBe(3);
        }),
        { numRuns: 200 },
      );
    });

    it('perProfileAlarmNames and multiProfileName are deterministic', () => {
      fc.assert(
        fc.property(validStage, validConfigName, validLabel, (stage, configName, label) => {
          const naming1 = new NamingGenerator(stage);
          const naming2 = new NamingGenerator(stage);
          expect(naming1.perProfileAlarmNames(configName, label)).toEqual(
            naming2.perProfileAlarmNames(configName, label),
          );
          expect(naming1.multiProfileName(configName, label)).toBe(
            naming2.multiProfileName(configName, label),
          );
        }),
        { numRuns: 100 },
      );
    });
  });
});
