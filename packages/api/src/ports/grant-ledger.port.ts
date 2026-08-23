import type { GrantRecord } from '@hecaton/core';

export interface GrantLedgerPort {
  putGrant(grant: GrantRecord): Promise<void>;
  deleteGrant(configName: string, grantId: string): Promise<void>;
  queryGrantsByConfig(configName: string): Promise<GrantRecord[]>;
  scanAllConfigs(): Promise<GrantRecord[]>;
}
