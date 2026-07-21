import type { IamStatement, ShapeTemplate } from '../../types/index.js';
import { InvalidShapeParametersError } from '../../errors/index.js';

/**
 * Substitutes parameter placeholders in a shape template's statements.
 * Placeholder format: `${paramName}` within Resource and Condition value strings.
 *
 * @throws InvalidShapeParametersError if required parameters are missing
 */
export function resolveShape(
  template: ShapeTemplate,
  parameters: Record<string, string>,
): IamStatement[] {
  const missing = template.requiredParameters.filter((p) => !(p in parameters));

  if (missing.length > 0) {
    throw new InvalidShapeParametersError(
      `Missing required parameters: ${missing.join(', ')}`,
      { missingParameters: missing },
    );
  }

  return template.statements.map((stmt) => {
    const resolved: IamStatement = {
      Effect: stmt.Effect,
      Action: stmt.Action,
      Resource: substituteResource(stmt.Resource, parameters),
    };

    if (stmt.Condition) {
      resolved.Condition = substituteCondition(stmt.Condition, parameters);
    }

    return resolved;
  });
}

function substitutePlaceholders(value: string, parameters: Record<string, string>): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, paramName: string) => parameters[paramName] ?? '');
}

function substituteResource(
  resource: string | string[],
  parameters: Record<string, string>,
): string | string[] {
  if (Array.isArray(resource)) {
    return resource.map((r) => substitutePlaceholders(r, parameters));
  }
  return substitutePlaceholders(resource, parameters);
}

function substituteCondition(
  condition: Record<string, Record<string, string>>,
  parameters: Record<string, string>,
): Record<string, Record<string, string>> {
  const resolved: Record<string, Record<string, string>> = {};

  for (const [operator, operatorMap] of Object.entries(condition)) {
    resolved[operator] = {};
    for (const [key, value] of Object.entries(operatorMap)) {
      resolved[operator][key] = substitutePlaceholders(value, parameters);
    }
  }

  return resolved;
}
