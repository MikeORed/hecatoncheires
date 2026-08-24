import type { GrantRecord } from '@hecaton/core';
import { validateGrant, assemblePolicy, validatePolicySize, SHAPE_CATALOG } from '@hecaton/core';

import type { Dependencies } from '../shared/dependencies.js';
import { toGrantChangedEvent } from '../adapters/eventbridge/dto/event.mapper.js';

const DEFAULT_POLICY_NAME = 'hecaton-operating-policy';

/**
 * Grant-shape use-case.
 *
 * Validates the grant, writes it to the ledger, reassembles the operating policy,
 * validates policy size, writes the policy to IAM, and emits an event (best-effort).
 * If the assembled policy exceeds the size limit, the grant is rolled back.
 */
export async function grantShape(
  grant: GrantRecord,
  roleName: string,
  deps: Dependencies,
): Promise<GrantRecord> {
  // 1. Validate the grant against the shape catalog
  const validation = validateGrant(grant, SHAPE_CATALOG);
  if (!validation.valid) {
    throw validation.error;
  }

  // 2. Write grant to ledger
  await deps.grantLedger.putGrant(grant);

  // 3. Query all grants for same configName
  const allGrants = await deps.grantLedger.queryGrantsByConfig(grant.configName);

  // 4. Assemble the operating policy
  const policyDocument = assemblePolicy(allGrants, SHAPE_CATALOG);

  // 5. Validate the policy size
  const sizeValidation = validatePolicySize(policyDocument);
  if (!sizeValidation.valid) {
    // Rollback: delete the newly written grant
    await deps.grantLedger.deleteGrant(grant.configName, grant.grantId!);
    throw sizeValidation.error;
  }

  // 6. Write the assembled policy to IAM
  await deps.operatingPolicy.writePolicy(roleName, DEFAULT_POLICY_NAME, policyDocument);

  // 7. Emit grant-changed event (best-effort)
  try {
    const event = toGrantChangedEvent({
      configName: grant.configName,
      grantId: grant.grantId!,
      shapeName: grant.shapeName,
      action: 'granted',
      timestamp: grant.grantedAt,
    });
    await deps.busEmitter.emit(event);
  } catch {
    // Best-effort — failure is swallowed
  }

  return grant;
}
