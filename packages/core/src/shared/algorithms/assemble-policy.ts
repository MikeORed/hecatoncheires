import type { GrantRecord, ShapeTemplate, IamPolicyDocument, IamStatement } from '../../types/index.js';
import { ShapeNotFoundError } from '../../errors/index.js';
import { resolveShape } from './resolve-shape.js';

/**
 * Assembles an IAM policy document from a set of grant records.
 *
 * - Empty grants → deny-by-default (single Deny * statement)
 * - Non-empty → resolves each grant's shape template with its parameters
 *   and unions all resulting statements without deduplication
 *
 * @throws ShapeNotFoundError if a grant references a shapeName not in the catalog
 */
export function assemblePolicy(
  grants: GrantRecord[],
  catalog: readonly ShapeTemplate[],
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
      throw new ShapeNotFoundError(
        `Shape "${grant.shapeName}" not found in catalog`,
        { shapeName: grant.shapeName },
      );
    }

    const resolved = resolveShape(template, grant.parameters);
    statements.push(...resolved);
  }

  return {
    Version: '2012-10-17',
    Statement: statements,
  };
}
