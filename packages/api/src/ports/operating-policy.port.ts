import type { IamPolicyDocument } from '@hecaton/core';

export interface OperatingPolicyPort {
  writePolicy(
    roleName: string,
    policyName: string,
    policyDocument: IamPolicyDocument,
  ): Promise<void>;
  deletePolicy(roleName: string, policyName: string): Promise<void>;
}
