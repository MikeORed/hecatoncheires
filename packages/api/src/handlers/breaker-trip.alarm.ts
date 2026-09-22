import { getBreakerDependencies } from '../shared/dependencies.js';
import { tripBreaker } from '../use-cases/trip-breaker.js';

/**
 * The breaker Lambda is wired as a DIRECT CloudWatch alarm action on the
 * per-agent composite alarm (composite alarm → Lambda). CloudWatch delivers the
 * alarm-action payload shape below (AlarmName / NewStateValue), NOT the
 * EventBridge `detail.state` envelope.
 *
 * A composite alarm's action payload does NOT carry the component alarm's
 * metric dimensions, so we cannot read InferenceProfileId from it. Instead we
 * resolve the agent from the composite alarm name, which embeds the configName
 * (pattern: hecaton-{stage}-{configName}-composite).
 */
export interface CloudWatchAlarmActionEvent {
  source?: string;
  alarmArn?: string;
  // Direct Lambda alarm-action payload nests alarm details under `alarmData`.
  alarmData?: {
    alarmName?: string;
    state?: { value?: 'ALARM' | 'OK' | 'INSUFFICIENT_DATA'; reason?: string };
  };
  // SNS-style flat payload (fallback).
  AlarmName?: string;
  NewStateValue?: 'ALARM' | 'OK' | 'INSUFFICIENT_DATA';
  NewStateReason?: string;
  // EventBridge alarm-state-change envelope (fallback).
  detail?: {
    alarmName?: string;
    alarmArn?: string;
    state?: { value?: 'ALARM' | 'OK' | 'INSUFFICIENT_DATA'; reason?: string };
  };
}

/** Backwards-compatible alias retained for existing imports. */
export type CloudWatchAlarmEvent = CloudWatchAlarmActionEvent;

interface NormalizedAlarm {
  alarmName: string;
  stateValue: 'ALARM' | 'OK' | 'INSUFFICIENT_DATA' | undefined;
  reason: string;
}

/** Normalize across the three possible alarm payload shapes. */
function normalizeAlarm(event: CloudWatchAlarmActionEvent): NormalizedAlarm {
  // 1. Direct Lambda alarm-action payload (composite alarm → Lambda): alarmData.*
  if (event.alarmData !== undefined) {
    return {
      alarmName: event.alarmData.alarmName ?? '',
      stateValue: event.alarmData.state?.value,
      reason: event.alarmData.state?.reason ?? '',
    };
  }
  // 2. SNS-style flat payload (fallback).
  if (event.NewStateValue !== undefined || event.AlarmName !== undefined) {
    return {
      alarmName: event.AlarmName ?? '',
      stateValue: event.NewStateValue,
      reason: event.NewStateReason ?? '',
    };
  }
  // 3. EventBridge alarm-state-change envelope (fallback).
  return {
    alarmName: event.detail?.alarmName ?? '',
    stateValue: event.detail?.state?.value,
    reason: event.detail?.state?.reason ?? '',
  };
}

/**
 * Derive the agent configName from a per-agent alarm name.
 * Composite: hecaton-{stage}-{configName}-composite
 * Component: hecaton-{stage}-{configName}-{label}-{type}-alarm
 * We strip the leading `hecaton-{stage}-` and the trailing `-composite`
 * (composite is the alarm wired to the breaker), leaving the configName.
 */
function extractConfigName(alarmName: string): string | undefined {
  const m = /^hecaton-[^-]+-(.+)-composite$/.exec(alarmName);
  return m ? m[1] : undefined;
}

export async function handler(event: CloudWatchAlarmActionEvent): Promise<void> {
  const alarm = normalizeAlarm(event);

  // 1. No-op for non-ALARM state transitions.
  if (alarm.stateValue !== 'ALARM') {
    return;
  }

  // 2. Resolve the agent's configName from the (composite) alarm name.
  const configName = extractConfigName(alarm.alarmName);
  if (!configName) {
    console.error('Cannot extract configName from alarm name', JSON.stringify(event));
    return; // Do not throw — prevents retry on unparseable events.
  }

  // 3. Resolve agent identity via registry.
  const deps = getBreakerDependencies();
  const agent = await deps.agentRegistry.getByConfigName(configName);
  if (!agent) {
    console.error('Cannot resolve configName to agent', { configName });
    return; // Do not throw.
  }

  // 4. Invoke trip-breaker use-case (throws on IAM write failure → Lambda retries).
  await tripBreaker(
    {
      configName: agent.configName,
      roleName: agent.roleName,
      agentId: agent.agentId,
      reason: alarm.reason,
      alarmName: alarm.alarmName,
    },
    deps,
  );
}
