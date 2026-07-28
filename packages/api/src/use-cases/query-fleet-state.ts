import type { GrantRecord } from '@hecaton/core';

import type { Dependencies } from '../shared/dependencies.js';

/**
 * Query-fleet-state use-case.
 *
 * Scans all grants from the ledger and groups them by configName.
 * Returns an empty record if the ledger is empty.
 */
export async function queryFleetState(
  deps: Dependencies,
): Promise<Record<string, GrantRecord[]>> {
  const allGrants = await deps.grantLedger.scanAllConfigs();

  if (allGrants.length === 0) {
    return {};
  }

  const grouped: Record<string, GrantRecord[]> = {};
  for (const grant of allGrants) {
    if (!grouped[grant.configName]) {
      grouped[grant.configName] = [];
    }
    grouped[grant.configName].push(grant);
  }

  return grouped;
}
