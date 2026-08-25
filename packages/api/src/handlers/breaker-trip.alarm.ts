import { getBreakerDependencies } from '../shared/dependencies.js';
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
 * Extracts the InferenceProfileId from alarm metric dimensions.
 * Returns undefined when the dimension is not present.
 */
function extractProfileEntityId(event: CloudWatchAlarmEvent): string | undefined {
  const metrics = event.detail.configuration?.metrics;
  if (!metrics || metrics.length === 0) return undefined;
  const dimensions = metrics[0]?.metricStat?.metric?.dimensions;
  return dimensions?.['InferenceProfileId'];
}

export async function handler(event: CloudWatchAlarmEvent): Promise<void> {
  // 1. No-op for non-ALARM state transitions
  if (event.detail.state.value !== 'ALARM') {
    return;
  }

  // 2. Extract profileEntityId from alarm metric dimensions
  const profileEntityId = extractProfileEntityId(event);
  if (!profileEntityId) {
    console.error('Cannot extract profileEntityId from alarm event', JSON.stringify(event));
    return; // Do not throw — prevents retry on parse failures
  }

  // 3. Resolve agent identity via registry
  const deps = getBreakerDependencies();
  const agent = await deps.agentRegistry.getByProfileEntityId(profileEntityId);
  if (!agent) {
    console.error('Cannot resolve profileEntityId to agent', { profileEntityId });
    return; // Do not throw
  }

  // 4. Invoke trip-breaker use-case (throws on IAM write failure → Lambda retries)
  await tripBreaker(
    {
      configName: agent.configName,
      roleName: agent.roleName,
      agentId: agent.agentId,
      reason: event.detail.state.reason,
      alarmName: event.detail.alarmName,
    },
    deps,
  );
}
