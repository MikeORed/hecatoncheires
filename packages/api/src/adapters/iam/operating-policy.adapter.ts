import { IAMClient, PutRolePolicyCommand, DeleteRolePolicyCommand } from '@aws-sdk/client-iam';
import type { IamPolicyDocument } from '@hecaton/core';
import { InternalError } from '@hecaton/core';

import type { OperatingPolicyPort } from '../../ports/operating-policy.port.js';

export class OperatingPolicyAdapter implements OperatingPolicyPort {
  constructor(
    private readonly client: IAMClient,
    private readonly defaultPolicyName: string = 'hecaton-operating-policy',
  ) {}

  async writePolicy(
    roleName: string,
    policyName: string,
    policyDocument: IamPolicyDocument,
  ): Promise<void> {
    try {
      await this.client.send(
        new PutRolePolicyCommand({
          RoleName: roleName,
          PolicyName: policyName,
          PolicyDocument: JSON.stringify(policyDocument),
        }),
      );
    } catch (err) {
      throw new InternalError('Failed to write operating policy', {
        originalError: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async deletePolicy(roleName: string, policyName: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteRolePolicyCommand({
          RoleName: roleName,
          PolicyName: policyName,
        }),
      );
    } catch (err) {
      throw new InternalError('Failed to delete operating policy', {
        originalError: err instanceof Error ? err.message : String(err),
      });
    }
  }

  getDefaultPolicyName(): string {
    return this.defaultPolicyName;
  }
}
