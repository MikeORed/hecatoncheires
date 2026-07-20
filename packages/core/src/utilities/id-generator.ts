import { v7 as uuidv7 } from 'uuid';

/**
 * Generates a UUIDv7 string.
 *
 * Uses the `uuid` package which provides:
 *   - Cryptographically secure random bits (CSPRNG)
 *   - Monotonic ordering within the same millisecond
 *   - Correct RFC 9562 layout (version 7, variant 10)
 *
 * The timestamp prefix makes IDs K-sortable by creation time.
 */
export function generateId(): string {
  return uuidv7();
}
