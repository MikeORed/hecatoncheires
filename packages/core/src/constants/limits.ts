/**
 * AWS service limits relevant to Hecatoncheires governance.
 * These constants are used by validators and policy assembly logic
 * to enforce AWS constraints at the domain level.
 */

/** Maximum size in bytes for an AWS IAM inline policy document. */
export const AWS_INLINE_POLICY_SIZE_LIMIT = 10_240;

/** Maximum length of an IAM role name. */
export const AWS_IAM_ROLE_NAME_MAX_LENGTH = 64;

/** Maximum number of policy versions that can exist for a managed policy. */
export const AWS_IAM_POLICY_VERSION_MAX_COUNT = 5;

/** Maximum number of managed policies that can be attached to an IAM role. */
export const AWS_MANAGED_POLICIES_PER_ROLE_MAX = 10;
