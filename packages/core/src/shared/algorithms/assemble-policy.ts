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
 * - Empty profileArns → deny-all statement
 * - Single profile ARN → Resource is a string
 * - Multiple profile ARNs → Resource is a string array
 */
function resolveCoreInvocation(
  template: ShapeTemplate,
  context: PolicyAssemblyContext,
): IamStatement[] {
  if (context.profileArns.length === 0) {
    return [{ Effect: 'Deny', Action: '*', Resource: '*' }];
  }

  return template.statements.map((stmt) => ({
    Effect: stmt.Effect,
    Action: stmt.Action,
    Resource: context.profileArns.length === 1 ? context.profileArns[0] : context.profileArns,
  }));
}
