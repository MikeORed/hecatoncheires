import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { InternalError } from '@hecaton/core';

import { BusEmitterAdapter } from './bus-emitter.adapter.js';
import type { BusEvent } from '../../ports/bus-emitter.port.js';

describe('BusEmitterAdapter', () => {
  let mockClient: { send: ReturnType<typeof vi.fn> };
  let adapter: BusEmitterAdapter;

  const testEvent: BusEvent = {
    source: 'hecatoncheires.api',
    detailType: 'GrantChanged',
    detail: { configName: 'test-agent', action: 'granted' },
  };

  beforeEach(() => {
    mockClient = { send: vi.fn() };
    adapter = new BusEmitterAdapter(
      mockClient as unknown as EventBridgeClient,
      'arn:aws:events:us-east-1:123:event-bus/ops',
    );
    // Mock the private delay method to resolve immediately
    vi.spyOn(adapter as unknown as { delay: (ms: number) => Promise<void> }, 'delay').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends PutEventsCommand with correct entry', async () => {
    mockClient.send.mockResolvedValue({ FailedEntryCount: 0, Entries: [{}] });
    await adapter.emit(testEvent);

    expect(mockClient.send).toHaveBeenCalledOnce();
    const command = mockClient.send.mock.calls[0][0];
    expect(command.input.Entries[0].EventBusName).toBe(
      'arn:aws:events:us-east-1:123:event-bus/ops',
    );
    expect(command.input.Entries[0].Source).toBe('hecatoncheires.api');
    expect(command.input.Entries[0].DetailType).toBe('GrantChanged');
  });

  it('includes correlationId in detail when present', async () => {
    mockClient.send.mockResolvedValue({ FailedEntryCount: 0, Entries: [{}] });
    await adapter.emit({ ...testEvent, correlationId: 'corr-123' });

    const command = mockClient.send.mock.calls[0][0];
    const detail = JSON.parse(command.input.Entries[0].Detail);
    expect(detail.correlationId).toBe('corr-123');
  });

  it('retries on FailedEntryCount > 0 and succeeds on retry', async () => {
    mockClient.send
      .mockResolvedValueOnce({
        FailedEntryCount: 1,
        Entries: [{ ErrorCode: 'InternalFailure', ErrorMessage: 'oops' }],
      })
      .mockResolvedValueOnce({ FailedEntryCount: 0, Entries: [{}] });

    await adapter.emit(testEvent);

    expect(mockClient.send).toHaveBeenCalledTimes(2);
  });

  it('throws InternalError after all retries exhausted on FailedEntryCount', async () => {
    mockClient.send.mockResolvedValue({
      FailedEntryCount: 1,
      Entries: [{ ErrorCode: 'InternalFailure', ErrorMessage: 'persistent failure' }],
    });

    await expect(adapter.emit(testEvent)).rejects.toThrow(InternalError);
    expect(mockClient.send).toHaveBeenCalledTimes(4); // initial + 3 retries
  });

  it('throws InternalError on SDK exception after retries', async () => {
    mockClient.send.mockRejectedValue(new Error('Network error'));

    await expect(adapter.emit(testEvent)).rejects.toThrow(InternalError);
    expect(mockClient.send).toHaveBeenCalledTimes(4);
  });
});
