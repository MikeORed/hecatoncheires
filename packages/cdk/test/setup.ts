/**
 * Vitest global setup: replaces NodejsFunction with a standard Lambda Function
 * using inline code. This eliminates esbuild invocations during test synthesis,
 * making CDK assertion tests near-instant.
 *
 * All CloudFormation resource properties (runtime, architecture, environment,
 * memorySize, timeout, functionName) are preserved — only the bundling step
 * is skipped.
 */
import { vi } from 'vitest';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

vi.mock('aws-cdk-lib/aws-lambda-nodejs', () => {
  return {
    NodejsFunction: class NodejsFunction extends lambda.Function {
      constructor(scope: Construct, id: string, props: Record<string, unknown>) {
        // Strip NodejsFunction-specific props and use inline code
        const {
          entry: _entry,
          handler,
          bundling: _bundling,
          depsLockFilePath: _depsLockFilePath,
          projectRoot: _projectRoot,
          ...rest
        } = props;

        super(scope, id, {
          ...rest,
          runtime: (props.runtime as lambda.Runtime) ?? lambda.Runtime.NODEJS_20_X,
          handler: (handler as string) ?? 'index.handler',
          code: lambda.Code.fromInline('exports.handler = async () => ({})'),
        } as lambda.FunctionProps);
      }
    },
  };
});
