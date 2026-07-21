import fc from 'fast-check';

import { arbConfigName, arbInvalidConfigName } from './agent-configuration.arb.js';

/**
 * Arbitrary for a valid UUIDv7 string.
 * Format: 8-4-4-4-12 hex with version nibble 7 and variant 10xx.
 */
export const arbUuidV7 = fc
  .tuple(
    fc.hexaString({ minLength: 8, maxLength: 8 }),
    fc.hexaString({ minLength: 4, maxLength: 4 }),
    fc.hexaString({ minLength: 3, maxLength: 3 }),
    fc.constantFrom('8', '9', 'a', 'b'),
    fc.hexaString({ minLength: 3, maxLength: 3 }),
    fc.hexaString({ minLength: 12, maxLength: 12 }),
  )
  .map(([p1, p2, p3, variant, p4, p5]) => `${p1}-${p2}-7${p3}-${variant}${p4}-${p5}`);

/**
 * Arbitrary for an ISO 8601 datetime string within a reasonable range.
 */
export const arbIsoDatetime = fc
  .date({
    min: new Date('2020-01-01T00:00:00Z'),
    max: new Date('2030-12-31T23:59:59Z'),
  })
  .map((d) => d.toISOString());

/**
 * Arbitrary for a valid GrantRecord conforming to GrantRecordSchema.
 */
export const arbGrantRecord = fc
  .tuple(
    arbConfigName,
    fc.string({ minLength: 1, maxLength: 80 }),
    fc.dictionary(
      fc.string({ minLength: 1, maxLength: 30 }),
      fc.string({ minLength: 1, maxLength: 100 }),
      { minKeys: 0, maxKeys: 5 },
    ),
    arbIsoDatetime,
    fc.string({ minLength: 1, maxLength: 80 }),
    fc.option(arbIsoDatetime, { nil: undefined }),
    fc.option(arbUuidV7, { nil: undefined }),
  )
  .map(([configName, shapeName, parameters, grantedAt, grantedBy, expiresAt, grantId]) => ({
    ...(grantId !== undefined ? { grantId } : {}),
    configName,
    shapeName,
    parameters,
    grantedAt,
    grantedBy,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  }));

/**
 * Arbitrary producing an invalid GrantRecord (invalid configName).
 */
export const arbInvalidGrantRecord = fc
  .tuple(
    arbInvalidConfigName,
    fc.string({ minLength: 1, maxLength: 80 }),
    fc.dictionary(
      fc.string({ minLength: 1, maxLength: 30 }),
      fc.string({ minLength: 1, maxLength: 100 }),
      { minKeys: 0, maxKeys: 5 },
    ),
    arbIsoDatetime,
    fc.string({ minLength: 1, maxLength: 80 }),
  )
  .map(([configName, shapeName, parameters, grantedAt, grantedBy]) => ({
    configName,
    shapeName,
    parameters,
    grantedAt,
    grantedBy,
  }));
