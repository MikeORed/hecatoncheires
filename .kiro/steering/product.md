# Hecatoncheires — Product Summary

Hecatoncheires is a CDK-deployed AWS governance and observability platform for autonomous AI agent fleets. It enforces identity, cost, and capability boundaries on agents that use Amazon Bedrock, ensuring they cannot operate outside their granted permissions.

## Core Problem

Autonomous agents need a governance plane that matches their execution speed. Without it, they become unaccountable cost and security liabilities.

## What It Does

- **Identity & boundaries**: IAM role model (permission boundary → base config → operating policy) ensures agents must use assigned inference profiles and guardrails.
- **Capability control**: A modulated IAM operating policy grants and revokes capability shapes on agent roles. Deny-by-default resting state; the circuit breaker is the coarsest revocation (pulls invocation permission entirely).
- **Telemetry & observability**: Enrichment pipeline processes Bedrock invocation logs, emits structured events to an ops EventBridge bus, and powers a fleet-level CloudWatch dashboard.
- **Cost circuit breakers**: Alarm-based breakers halt runaway agents within minutes of threshold breach.
- **Event augmentation** (parallel workstream): Agents participate as signal processors on a shared EventBridge fabric via per-agent SQS FIFO queues.

## Agent Harness Types

| Harness | Description |
|---|---|
| AgentCore Managed | Config-driven, AWS-hosted agent loop (primary test rig) |
| OpenClaw | External agent assumes a governed role |
| AgentCore Runtime | Container-based custom agent code |

## Current Status

Phase 1 (Identity + Boundaries + Basic Safety) — scaffolding complete, implementation in progress. Single-account deployment for now; multi-account is a future enhancement.
