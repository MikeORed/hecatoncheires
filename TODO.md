# Priority TODOs

Things I've noticed while building that are big enough to write down but not part of the work in front of me. Captured here so they can be picked up later without derailing current tasks. Not a full backlog, just the stuff worth not forgetting.

## Account-level setup (not yet automated)

Some features Hecatoncheires relies on are account/region-level settings, not stack resources. CDK can technically manage them, but they're singletons that outlive any single stack, so tearing down a stack shouldn't reach out and flip account-wide state. These are meant to be handled as documented manual steps plus checks, not as CDK resources. None of this is wired up yet.

- [ ] Cost allocation tag activation. The `hecatoncheires:*` tags land on resources (including inference profiles) at deploy, but they don't show up as groupable dimensions in Cost Explorer until each key is activated as a cost allocation tag in the Billing console. Activation is account-global and can take ~24h to propagate. Document the exact keys to activate and where.
- [ ] Bedrock invocation logging (Phase 2 dependency). The log/S3 destination and the Bedrock write role belong in a stack as normal resources. The account/region-level toggle that points Bedrock at them (`PutModelInvocationLoggingConfiguration`) is the manual step. Document how to enable it.
- [ ] Synth-time warnings. Emit `cdk.Annotations.addWarning()` for both features above so the reminder shows up in synth output. These are static reminders only; synth is offline and can't check whether the steps were actually done.
- [ ] Preflight check (`pnpm preflight` or similar). A read-only SDK check run before deploy: hard-error if invocation logging is off (it breaks the telemetry pipeline), soft-warn if the cost tags aren't activated (non-functional). Read-only on purpose, so it never mutates account state or gets entangled in teardown.
