/**
 * EventBridge source namespace constants.
 * Used in CDK event rules and API event emitters.
 */
export const EVENT_SOURCE = {
  API: 'hecatoncheires.api',
  SIGNALS: 'hecatoncheires.signals',
  DRIFT: 'hecatoncheires.drift',
} as const;

export type EventSource = (typeof EVENT_SOURCE)[keyof typeof EVENT_SOURCE];

/**
 * EventBridge detail-type constants.
 * Used in CDK event rules and API event emitters.
 */
export const EVENT_DETAIL_TYPE = {
  GRANT_CHANGED: 'GrantChanged',
  CAPABILITY_CHANGED: 'CapabilityChanged',
  BREAKER_TRIPPED: 'BreakerTripped',
  DRIFT_DETECTED: 'drift.detected',
} as const;

export type EventDetailType = (typeof EVENT_DETAIL_TYPE)[keyof typeof EVENT_DETAIL_TYPE];
