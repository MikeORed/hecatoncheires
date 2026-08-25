import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { InternalError } from '@hecaton/core';

import type { SnsNotifierPort } from '../../ports/sns-notifier.port.js';

export class SnsNotifierAdapter implements SnsNotifierPort {
  constructor(
    private readonly client: SNSClient,
    private readonly topicArn: string,
  ) {}

  async publish(subject: string, message: string): Promise<void> {
    try {
      await this.client.send(
        new PublishCommand({
          TopicArn: this.topicArn,
          Subject: subject,
          Message: message,
        }),
      );
    } catch (err) {
      throw new InternalError('Failed to publish SNS notification', {
        originalError: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
