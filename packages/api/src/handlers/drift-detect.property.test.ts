// Feature: phase1-infra-completion, Property 3: Known principal identification is correct for all ARN formats
// Feature: phase1-infra-completion, Property 4: Known principal check is symmetric with list membership

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { isKnownPrincipal } from './drift-detect.event.js';

/**
 * Generator for valid AWS account IDs (12-digit numeric strings).
 */
const validAccountId = fc.stringMatching(/^[0-9]{12}$/);

/**
 * Generator for valid IAM role names (alphanumeric + hyphens, 1-64 chars).
 * IAM role names can contain letters, digits, hyphens, underscores, periods, and plus signs.
 * We constrain to alphanumeric + hyphens for typical usage.
 */
const validRoleName = fc
  .stringMatching(/^[a-zA-Z][a-zA-Z0-9-]*$/)
  .filter((s) => s.length >= 1 && s.length <= 64);

/**
 * Generator for valid session names (alphanumeric + common separators, 2-64 chars).
 */
const validSessionName = fc
  .stringMatching(/^[a-zA-Z0-9][a-zA-Z0-9_=-]*$/)
  .filter((s) => s.length >= 2 && s.length <= 64);

/**
 * Generator for IAM role ARN format: arn:aws:iam::ACCOUNT:role/ROLE_NAME
 */
const iamRoleArn = fc.tuple(validAccountId, validRoleName).map(([account, role]) => ({
  arn: `arn:aws:iam::${account}:role/${role}`,
  roleName: role,
}));

/**
 * Generator for STS assumed-role ARN format: arn:aws:sts::ACCOUNT:assumed-role/ROLE_NAME/SESSION
 */
const stsAssumedRoleArn = fc
  .tuple(validAccountId, validRoleName, validSessionName)
  .map(([account, role, session]) => ({
    arn: `arn:aws:sts::${account}:assumed-role/${role}/${session}`,
    roleName: role,
  }));

/**
 * Generator for any valid ARN (either IAM role or STS assumed-role format).
 */
const anyValidArn = fc.oneof(iamRoleArn, stsAssumedRoleArn);

/**
 * Generator for ARNs that are NOT valid IAM/STS formats (unrecognized formats).
 */
const unrecognizedArn = fc
  .tuple(validAccountId, validRoleName)
  .map(([account, name]) => `arn:aws:lambda::${account}:function/${name}`);

describe('isKnownPrincipal property tests', () => {
  // **Validates: Requirements 3.4, 3.7**

  describe('Property 3: Known principal identification is correct for all ARN formats', () => {
    it('returns true when modifier role name matches a known principal role name (IAM role ARN modifier)', () => {
      fc.assert(
        fc.property(
          iamRoleArn,
          validAccountId,
          fc.oneof(fc.constant('iam' as const), fc.constant('sts' as const)),
          validSessionName,
          (modifier, knownAccount, knownFormat, session) => {
            // Build a known principal ARN with the same role name but possibly different format/account
            const knownArn =
              knownFormat === 'iam'
                ? `arn:aws:iam::${knownAccount}:role/${modifier.roleName}`
                : `arn:aws:sts::${knownAccount}:assumed-role/${modifier.roleName}/${session}`;

            expect(isKnownPrincipal(modifier.arn, [knownArn])).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('returns true when modifier role name matches a known principal role name (STS assumed-role modifier)', () => {
      fc.assert(
        fc.property(
          stsAssumedRoleArn,
          validAccountId,
          fc.oneof(fc.constant('iam' as const), fc.constant('sts' as const)),
          validSessionName,
          (modifier, knownAccount, knownFormat, session) => {
            // Build a known principal ARN with the same role name but possibly different format/account
            const knownArn =
              knownFormat === 'iam'
                ? `arn:aws:iam::${knownAccount}:role/${modifier.roleName}`
                : `arn:aws:sts::${knownAccount}:assumed-role/${modifier.roleName}/${session}`;

            expect(isKnownPrincipal(modifier.arn, [knownArn])).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('returns false when modifier role name does not match any known principal role name', () => {
      fc.assert(
        fc.property(
          anyValidArn,
          fc.array(anyValidArn, { minLength: 0, maxLength: 10 }),
          (modifier, knownPrincipals) => {
            // Filter known principals to ensure NONE share the modifier's role name
            const disjointKnown = knownPrincipals
              .filter((kp) => kp.roleName !== modifier.roleName)
              .map((kp) => kp.arn);

            expect(isKnownPrincipal(modifier.arn, disjointKnown)).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('returns false for unrecognized ARN formats regardless of known principals', () => {
      fc.assert(
        fc.property(
          unrecognizedArn,
          fc.array(anyValidArn, { minLength: 1, maxLength: 5 }).map((arns) =>
            arns.map((a) => a.arn),
          ),
          (modifierArn, knownPrincipals) => {
            expect(isKnownPrincipal(modifierArn, knownPrincipals)).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('Property 4: Known principal check is symmetric with list membership', () => {
    it('isKnownPrincipal returns true iff modifier resolved role name is in the set of known resolved role names', () => {
      fc.assert(
        fc.property(
          anyValidArn,
          fc.array(anyValidArn, { minLength: 0, maxLength: 10 }),
          (modifier, knownPrincipals) => {
            const knownArnStrings = knownPrincipals.map((kp) => kp.arn);
            const result = isKnownPrincipal(modifier.arn, knownArnStrings);

            // Compute expected result: modifier's role name matches at least one known's role name
            const knownRoleNames = new Set(knownPrincipals.map((kp) => kp.roleName));
            const expectedResult = knownRoleNames.has(modifier.roleName);

            expect(result).toBe(expectedResult);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('result is independent of ARN format — same role name in different formats yields same result', () => {
      fc.assert(
        fc.property(
          validAccountId,
          validRoleName,
          validSessionName,
          validAccountId,
          fc.array(anyValidArn, { minLength: 0, maxLength: 5 }),
          (modAccount, roleName, session, knownAccount, knownPrincipals) => {
            const iamModifier = `arn:aws:iam::${modAccount}:role/${roleName}`;
            const stsModifier = `arn:aws:sts::${knownAccount}:assumed-role/${roleName}/${session}`;
            const knownArnStrings = knownPrincipals.map((kp) => kp.arn);

            // Both ARN formats for the same role name should produce identical results
            expect(isKnownPrincipal(iamModifier, knownArnStrings)).toBe(
              isKnownPrincipal(stsModifier, knownArnStrings),
            );
          },
        ),
        { numRuns: 100 },
      );
    });

    it('adding a matching principal to the list always makes the result true', () => {
      fc.assert(
        fc.property(
          anyValidArn,
          fc.array(anyValidArn, { minLength: 0, maxLength: 5 }),
          anyValidArn,
          (modifier, existingPrincipals, _extraArn) => {
            // Create a known principal with the same role name as modifier
            const matchingPrincipal = `arn:aws:iam::000000000000:role/${modifier.roleName}`;
            const knownArns = [
              ...existingPrincipals.map((kp) => kp.arn),
              matchingPrincipal,
            ];

            expect(isKnownPrincipal(modifier.arn, knownArns)).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('empty known principals list always returns false for any valid ARN', () => {
      fc.assert(
        fc.property(anyValidArn, (modifier) => {
          expect(isKnownPrincipal(modifier.arn, [])).toBe(false);
        }),
        { numRuns: 100 },
      );
    });
  });
});
