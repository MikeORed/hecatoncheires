import { describe, it, expect } from 'vitest';
import { SHAPE_CATALOG } from './shape-catalog.js';

describe('SHAPE_CATALOG', () => {
  describe('core-invocation shape', () => {
    const shape = SHAPE_CATALOG.find((s) => s.shapeName === 'core-invocation');

    it('exists in the catalog', () => {
      expect(shape).toBeDefined();
    });

    it('includes all four Bedrock inference actions in a single statement', () => {
      const statement = shape!.statements[0];
      expect(statement.Action).toEqual([
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
        'bedrock:Converse',
        'bedrock:ConverseStream',
      ]);
    });

    it('uses * as a placeholder Resource (resolved at policy assembly time)', () => {
      const statement = shape!.statements[0];
      expect(statement.Resource).toBe('*');
    });

    it('has an empty requiredParameters array (profile ARNs come from context)', () => {
      expect(shape!.requiredParameters).toEqual([]);
    });
  });
});
