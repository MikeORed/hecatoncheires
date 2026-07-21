import { z } from 'zod';

/**
 * Regex pattern for UUIDv7 validation.
 *
 * Validates the canonical UUID format with:
 *   - Version nibble `7` in the 13th position
 *   - Variant bits `10xx` (first nibble of 4th group is `8`, `9`, `a`, or `b`)
 */
const UUIDV7_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Schema validating that a string conforms to the UUIDv7 format.
 *
 * Used by all entity schemas that include an `id` field.
 */
export const IdSchema = z.string().regex(UUIDV7_REGEX, 'Must be a valid UUIDv7');
