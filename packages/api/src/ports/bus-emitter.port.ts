export interface BusEvent {
  source: string;
  detailType: string;
  detail: Record<string, unknown>;
  correlationId?: string;
}

export interface BusEmitterPort {
  emit(event: BusEvent): Promise<void>;
}
