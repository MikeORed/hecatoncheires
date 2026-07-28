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
  reason: string;
  timestamp: string;
}

/** Builds a BusEvent for the grant-changed event */
export function toGrantChangedEvent(detail: GrantChangedDetail, correlationId?: string): BusEvent {
  return {
    source: 'hecatoncheires.api',
    detailType: 'GrantChanged',
    detail: { ...detail },
    ...(correlationId !== undefined && { correlationId }),
  };
}

/** Builds a BusEvent for the capability-changed event */
export function toCapabilityChangedEvent(detail: CapabilityChangedDetail): BusEvent {
  return {
    source: 'hecatoncheires.api',
    detailType: 'CapabilityChanged',
    detail: { ...detail },
  };
}

/** Builds a BusEvent for the breaker-tripped event */
export function toBreakerTrippedEvent(detail: BreakerTrippedDetail): BusEvent {
  return {
    source: 'hecatoncheires.api',
    detailType: 'BreakerTripped',
    detail: { ...detail },
  };
}
