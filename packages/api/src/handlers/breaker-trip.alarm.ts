import { getDependencies } from '../shared/dependencies.js';
import { tripBreaker } from '../use-cases/trip-breaker.js';

/**
 * CloudWatch Alarm state change event shape (simplified).
 * Only the fields used by this handler are typed.
 */
export interface CloudWatchAlarmEvent {
  source: string;
  detail: {
    alarmName: string;
    state: {
      value: 'ALARM' | 'OK' | 'INSUFFICIENT_DATA';
      reason: string;
    };
    configuration?: {
      metrics?: Array<{
        metricStat?: {
          metric?: {
            dimensions?: Record<string, string>;
          };
        };
      }>;
    };
  };
}

/**
 * Extracts configName and roleName from alarm dimensions.
 * Expected dimensions: configName, roleName (set when the alarm was created).
 */
function extractFromAlarmDimensions(
  event: CloudWatchAlarmEvent,
): { configName?: string; roleName?: string } {
  const metrics = event.detail.configuration?.metrics;
  if (!metrics || metrics.length === 0) {
    return {};
  }
  const dimensions = metrics[0]?.metricStat?.metric?.dimensions;
  if (!dimensions) {
    return {};
  }
  return {
    configName: dimensions['configName'],
    roleName: dimensions['roleName'],
  };
}

export async function handler(event: CloudWatchAlarmEvent): Promise<void> {
  // No-op for non-ALARM state transitions
  if (event.detail.state.value !== 'ALARM') {
    return;
  }

  // Extract configName and roleName from alarm dimensions
  const { configName, roleName } = extractFromAlarmDimensions(event);
  if (!configName || !roleName) {
    console.error('Cannot extract configName/roleName from alarm event', JSON.stringify(event));
    return; // Do not throw — alarm handlers must not retry on parse failures
  }

  // Invoke use-case (allowed to throw — Lambda will retry for breaker trips)
  const deps = getDependencies();
  await tripBreaker(
    { configName, roleName, reason: event.detail.state.reason },
    deps,
  );
}
