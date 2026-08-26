import { EVENT_DETAIL_TYPE, EVENT_SOURCE } from '@hecaton/core';

import type { BusEvent } from '../../../ports/bus-emitter.port.js';

export interface GrantChangedDetail {
  configName: string;
  grantId: string;
  shapeName: string;
  action: 'granted' | 'revoked';
  timestamp: string;
}

export interface CapabilityChangedDetail {
  configName: string;
  action: 'onboarded';
  timestamp: string;
}

export interface BreakerTrippedDetail {
  configName: string;
  roleName: string;
  alarmName: string;
  reason: string;
  timestamp: string;
}

/** Builds a BusEvent for the grant-changed event */
export function toGrantChangedEvent(detail: GrantChangedDetail, correlationId?: string): BusEvent {
  return {
    source: EVENT_SOURCE.API,
    detailType: EVENT_DETAIL_TYPE.GRANT_CHANGED,
    detail: { ...detail },
    ...(correlationId !== undefined && { correlationId }),
  };
}

/** Builds a BusEvent for the capability-changed event */
export function toCapabilityChangedEvent(detail: CapabilityChangedDetail): BusEvent {
  return {
    source: EVENT_SOURCE.API,
    detailType: EVENT_DETAIL_TYPE.CAPABILITY_CHANGED,
    detail: { ...detail },
  };
}

/** Builds a BusEvent for the breaker-tripped event */
export function toBreakerTrippedEvent(detail: BreakerTrippedDetail): BusEvent {
  return {
    source: EVENT_SOURCE.API,
    detailType: EVENT_DETAIL_TYPE.BREAKER_TRIPPED,
    detail: { ...detail },
  };
}
