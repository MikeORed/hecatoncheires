import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { EVENT_SOURCE, EVENT_DETAIL_TYPE } from '@hecaton/core';

import {
  toGrantChangedEvent,
  toCapabilityChangedEvent,
  toBreakerTrippedEvent,
} from './event.mapper.js';
import type {
  GrantChangedDetail,
  CapabilityChangedDetail,
  BreakerTrippedDetail,
} from './event.mapper.js';

const arbIsoDatetime = fc
  .date({ min: new Date('2020-01-01T00:00:00Z'), max: new Date('2030-12-31T23:59:59Z') })
  .map((d) => d.toISOString());

const arbGrantChangedDetail: fc.Arbitrary<GrantChangedDetail> = fc
  .tuple(
    fc.string({ minLength: 1, maxLength: 40 }),
    fc.string({ minLength: 1, maxLength: 40 }),
    fc.string({ minLength: 1, maxLength: 40 }),
    fc.constantFrom('granted' as const, 'revoked' as const),
    arbIsoDatetime,
  )
  .map(([configName, grantId, shapeName, action, timestamp]) => ({
    configName,
    grantId,
    shapeName,
    action,
    timestamp,
  }));

const arbCapabilityChangedDetail: fc.Arbitrary<CapabilityChangedDetail> = fc
  .tuple(fc.string({ minLength: 1, maxLength: 40 }), arbIsoDatetime)
  .map(([configName, timestamp]) => ({
    configName,
    action: 'onboarded' as const,
    timestamp,
  }));

const arbBreakerTrippedDetail: fc.Arbitrary<BreakerTrippedDetail> = fc
  .tuple(
    fc.string({ minLength: 1, maxLength: 40 }),
    fc.string({ minLength: 1, maxLength: 40 }),
    fc.string({ minLength: 1, maxLength: 80 }),
    fc.string({ minLength: 1, maxLength: 200 }),
    arbIsoDatetime,
  )
  .map(([configName, roleName, alarmName, reason, timestamp]) => ({
    configName,
    roleName,
    alarmName,
    reason,
    timestamp,
  }));

describe('Feature: phase-1-api-package-setup', () => {
  describe('Property 5: Event mapper output consistency', () => {
    it('toGrantChangedEvent produces a BusEvent with correct source and detailType', () => {
      fc.assert(
        fc.property(arbGrantChangedDetail, (detail) => {
          const event = toGrantChangedEvent(detail);
          expect(event.source).toBe(EVENT_SOURCE.API);
          expect(event.detailType).toBe(EVENT_DETAIL_TYPE.GRANT_CHANGED);
          expect(event.detail).toEqual({ ...detail });
        }),
        { numRuns: 100 },
      );
    });

    it('toCapabilityChangedEvent produces a BusEvent with correct source and detailType', () => {
      fc.assert(
        fc.property(arbCapabilityChangedDetail, (detail) => {
          const event = toCapabilityChangedEvent(detail);
          expect(event.source).toBe(EVENT_SOURCE.API);
          expect(event.detailType).toBe(EVENT_DETAIL_TYPE.CAPABILITY_CHANGED);
          expect(event.detail).toEqual({ ...detail });
        }),
        { numRuns: 100 },
      );
    });

    it('toBreakerTrippedEvent produces a BusEvent with correct source and detailType', () => {
      fc.assert(
        fc.property(arbBreakerTrippedDetail, (detail) => {
          const event = toBreakerTrippedEvent(detail);
          expect(event.source).toBe(EVENT_SOURCE.API);
          expect(event.detailType).toBe(EVENT_DETAIL_TYPE.BREAKER_TRIPPED);
          expect(event.detail).toEqual({ ...detail });
        }),
        { numRuns: 100 },
      );
    });

    it('toGrantChangedEvent includes correlationId when provided', () => {
      fc.assert(
        fc.property(
          arbGrantChangedDetail,
          fc.string({ minLength: 1, maxLength: 50 }),
          (detail, correlationId) => {
            const event = toGrantChangedEvent(detail, correlationId);
            expect(event.correlationId).toBe(correlationId);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
