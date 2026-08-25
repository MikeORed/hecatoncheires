import { getDriftDependencies } from '../shared/dependencies.js';

/**
 * CloudTrail IAM mutation event shape delivered via EventBridge.
 * Only the fields used by this handler are typed.
 */
export interface DriftDetectEvent {
  detail: {
    eventName: string;
    eventTime: string;
    userIdentity: {
      arn: string;
      type: string;
    };
    requestParameters: {
      roleName: string;
      policyName?: string;
      policyArn?: string;
    };
  };
}

/**
 * Extracts the IAM role name from an ARN.
 * Handles two formats:
 * - IAM role: arn:aws:iam::ACCOUNT:role/ROLE_NAME
 * - STS assumed-role: arn:aws:sts::ACCOUNT:assumed-role/ROLE_NAME/SESSION
 *
 * Returns undefined if the ARN does not match either format.
 */
function extractRoleName(arn: string): string | undefined {
  // IAM role format: arn:aws:iam::ACCOUNT:role/ROLE_NAME
  const iamMatch = arn.match(/^arn:aws:iam::[^:]*:role\/(.+)$/);
  if (iamMatch) {
    return iamMatch[1];
  }

  // STS assumed-role format: arn:aws:sts::ACCOUNT:assumed-role/ROLE_NAME/SESSION
  const stsMatch = arn.match(/^arn:aws:sts::[^:]*:assumed-role\/([^/]+)\//);
  if (stsMatch) {
    return stsMatch[1];
  }

  return undefined;
}

/**
 * Determines whether the modifier ARN is a known platform principal.
 * Extracts the role name from the modifier ARN and checks if it matches
 * any role name extracted from the known principals list.
 *
 * Exported for independent testing (property-based tests).
 */
export function isKnownPrincipal(modifierArn: string, knownPrincipals: string[]): boolean {
  const modifierRole = extractRoleName(modifierArn);
  if (!modifierRole) {
    return false;
  }

  for (const principal of knownPrincipals) {
    const principalRole = extractRoleName(principal);
    if (principalRole && principalRole === modifierRole) {
      return true;
    }
  }

  return false;
}

/**
 * Parses the KNOWN_PRINCIPALS environment variable.
 * Returns an empty array if the value is missing or not valid JSON.
 */
function parseKnownPrincipals(): string[] {
  const raw = process.env['KNOWN_PRINCIPALS'];
  if (!raw) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.error('KNOWN_PRINCIPALS is not a JSON array', { value: raw });
      return [];
    }
    return parsed as string[];
  } catch (err) {
    console.error('Failed to parse KNOWN_PRINCIPALS', {
      value: raw,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

export async function handler(event: DriftDetectEvent): Promise<void> {
  // 1. Gracefully handle missing userIdentity.arn
  const modifierArn = event.detail?.userIdentity?.arn;
  if (!modifierArn) {
    console.warn('Skipping drift event: missing userIdentity.arn', JSON.stringify(event));
    return;
  }

  // 2. Parse known principals from environment
  const knownPrincipals = parseKnownPrincipals();

  // 3. If modifier is a known platform principal, take no action
  if (isKnownPrincipal(modifierArn, knownPrincipals)) {
    return;
  }

  // 4. Unknown principal — emit drift.detected event and publish SNS alert
  const deps = getDriftDependencies();
  const { eventName, eventTime, requestParameters } = event.detail;
  const roleName = requestParameters.roleName;

  await deps.busEmitter.emit({
    source: 'hecatoncheires.drift',
    detailType: 'drift.detected',
    detail: {
      roleName,
      modifyingPrincipalArn: modifierArn,
      apiAction: eventName,
      timestamp: eventTime,
      ...(requestParameters.policyName && { policyName: requestParameters.policyName }),
      ...(requestParameters.policyArn && { policyArn: requestParameters.policyArn }),
    },
  });

  const subject = `Hecatoncheires Drift Alert: ${roleName}`;
  const message = [
    'Unauthorized IAM modification detected.',
    `Role: ${roleName}`,
    `Action: ${eventName}`,
    `Principal: ${modifierArn}`,
    `Time: ${eventTime}`,
  ].join('\n');

  await deps.snsNotifier.publish(subject, message);
}
