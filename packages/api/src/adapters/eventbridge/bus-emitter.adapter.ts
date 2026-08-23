import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { InternalError } from '@hecaton/core';

import type { BusEmitterPort, BusEvent } from '../../ports/bus-emitter.port.js';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 100;

export class BusEmitterAdapter implements BusEmitterPort {
  constructor(
    private readonly client: EventBridgeClient,
    private readonly busArn: string,
  ) {}

  async emit(event: BusEvent): Promise<void> {
    const detail = event.correlationId
      ? { ...event.detail, correlationId: event.correlationId }
      : event.detail;

    const entry = {
      EventBusName: this.busArn,
      Source: event.source,
      DetailType: event.detailType,
      Detail: JSON.stringify(detail),
    };

    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await this.client.send(new PutEventsCommand({ Entries: [entry] }));

        if ((result.FailedEntryCount ?? 0) > 0) {
          const failedEntry = result.Entries?.[0];
          lastError = new Error(
            `PutEvents failed: ${failedEntry?.ErrorCode} - ${failedEntry?.ErrorMessage}`,
          );

          if (attempt < MAX_RETRIES) {
            await this.delay(BASE_DELAY_MS * Math.pow(2, attempt));
            continue;
          }

          throw new InternalError('Failed to emit event after retries', {
            originalError: lastError instanceof Error ? lastError.message : String(lastError),
            errorCode: failedEntry?.ErrorCode,
          });
        }

        return;
      } catch (err) {
        if (err instanceof InternalError) throw err;
        lastError = err;

        if (attempt < MAX_RETRIES) {
          await this.delay(BASE_DELAY_MS * Math.pow(2, attempt));
          continue;
        }

        throw new InternalError('Failed to emit event', {
          originalError: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
