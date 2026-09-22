import type { GrantRecord, ShapeTemplate, IamPolicyDocument, IamStatement } from '../../types/index.js';
import { ShapeNotFoundError } from '../../errors/index.js';
import { resolveShape } from './resolve-shape.js';

/**
 * Context provided to policy assembly for profile-aware resolution.
 * Supplied by the use-case layer from the agent registry.
 */
export interface PolicyAssemblyContext {
  /** All profile ARNs owned by the agent. Empty triggers deny-all for core-invocation. */
  profileArns: string[];
}

/**
 * Assembles an IAM policy document from a set of grant records.
 *
 * - Empty grants → deny-by-default (single Deny * statement)
 * - Non-empty → resolves each grant's shape template with its parameters
 *   and unions all resulting statements without deduplication
 * - `core-invocation` grants are resolved using the profile ARNs from the context
 *   rather than generic parameter substitution
 *
 * @throws ShapeNotFoundError if a grant references a shapeName not in the catalog
 */
export function assemblePolicy(
  grants: GrantRecord[],
  catalog: readonly ShapeTemplate[],
  context: PolicyAssemblyContext,
): IamPolicyDocument {
  if (grants.length === 0) {
    return {
      Version: '2012-10-17',
      Statement: [{ Effect: 'Deny', Action: '*', Resource: '*' }],
    };
  }

  const statements: IamStatement[] = [];

  for (const grant of grants) {
    const template = catalog.find((t) => t.shapeName === grant.shapeName);

    if (!template) {
      throw new ShapeNotFoundError(`Shape "${grant.shapeName}" not found in catalog`, {
        shapeName: grant.shapeName,
      });
    }

    if (grant.shapeName === 'core-invocation') {
      statements.push(...resolveCoreInvocation(template, context));
    } else {
      const resolved = resolveShape(template, grant.parameters);
      statements.push(...resolved);
    }
  }

  return {
    Version: '2012-10-17',
    Statement: statements,
  };
}

/**
 * Resolves a core-invocation shape template using profile ARNs from the assembly context.
 *
 * Invoking THROUGH an inference profile authorizes against BOTH the profile
 * resource AND each backing foundation-model resource. So each shape statement
 * expands into two:
 *   1. invoke on the profile ARN(s)
 *   2. invoke on foundation-model ARNs, gated by `aws:InferenceProfileArn` so
 *      the model is only reachable through the assigned profile
 * Without (2), the model leg of the authorization is denied and managed-harness
 * ConverseStream calls fail even though the profile is allowed.
 * See: https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-prereq.html
 *
 * - Empty profileArns → deny-all statement
 * - Single profile ARN → Resource is a string; multiple → string array
 *
 * NOTE: the IamStatement Condition schema only allows scalar string values, so
 * the aws:InferenceProfileArn condition uses the primary (first) profile ARN.
 * Multi-profile agents would need the schema widened to array condition values.
 */
function resolveCoreInvocation(
  template: ShapeTemplate,
  context: PolicyAssemblyContext,
): IamStatement[] {
  if (context.profileArns.length === 0) {
    return [{ Effect: 'Deny', Action: '*', Resource: '*' }];
  }

  const profileResource =
    context.profileArns.length === 1 ? context.profileArns[0] : context.profileArns;
  const primaryProfileArn = context.profileArns[0];

  const statements: IamStatement[] = [];
  for (const stmt of template.statements) {
    // 1. Invoke on the assigned inference profile resource(s).
    statements.push({
      Effect: stmt.Effect,
      Action: stmt.Action,
      Resource: profileResource,
    });
    // 2. Invoke on the backing foundation models, only through this profile.
    // The request context key is `bedrock:InferenceProfileArn` (NOT
    // `aws:InferenceProfileArn`, despite some AWS prose) — it is what Bedrock
    // populates to indicate a model is being called through a profile.
    statements.push({
      Effect: stmt.Effect,
      Action: stmt.Action,
      Resource: 'arn:aws:bedrock:*::foundation-model/*',
      Condition: {
        StringEquals: { 'bedrock:InferenceProfileArn': primaryProfileArn },
      },
    });
  }
  return statements;
}
