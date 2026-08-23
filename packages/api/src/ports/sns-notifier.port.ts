export interface SnsNotifierPort {
  publish(subject: string, message: string): Promise<void>;
}
