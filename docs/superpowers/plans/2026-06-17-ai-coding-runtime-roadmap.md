# AI Coding Runtime Roadmap And Task Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each phase task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an AI Coding Runtime that lets coding tools delegate complex work to a cost-aware supervisor/router/worker system while preserving final verification quality.

**Architecture:** The Runtime starts as a local-first service with CLI and MCP interfaces. External coding tools such as Codex Desktop, Codex CLI, Cursor, and OpenCode connect to it as a tool provider, while the Runtime handles task planning, model routing, worker execution, verification, trace logging, and reporting.

**Tech Stack:** Local service, CLI, MCP server, HTTP API, model provider adapters, file-system workspace adapter, verification command runner, structured run database, policy config.

---

## Final Target

AI Coding Runtime is a local-first orchestration layer for AI programming work. It does not replace Codex, Cursor, OpenCode, or other coding agents at the beginning. Instead, it becomes the shared runtime those tools call when a task should be split, routed to different model tiers, executed by constrained workers, verified, and reported.

The final product should provide:

- A common runtime for multiple AI coding tools.
- Cost-aware task decomposition and model routing.
- Supervisor-worker execution with strict task contracts.
- Verification before final output.
- Full traceability of decisions, cost, model choice, failures, retries, and final results.
- Policy controls for budget, risk, allowed actions, and approval gates.
- Adapters for Codex Desktop, Codex CLI, Cursor, OpenCode, CI, and future IDE or web clients.

The product principle is simple:

```text
Use the cheapest model that can safely complete the task, and reserve premium models for planning, risky work, and final verification.
```

## Core Runtime Model

The Runtime uses this execution pattern:

```text
User request
  -> host coding tool
  -> Runtime gateway
  -> planner
  -> classifier
  -> router
  -> constrained workers
  -> verifier
  -> supervisor final review
  -> report and patch
```

Runtime roles:

- **Supervisor:** Strong model or host agent responsible for understanding, planning, and final acceptance.
- **Router:** Runtime component that selects model tiers based on difficulty, risk, context need, budget, and verifiability.
- **Workers:** Cheaper or specialized models that execute explicit task contracts.
- **Verifier:** Deterministic and AI-assisted checks that validate diffs, tests, acceptance criteria, and requirement alignment.
- **Policy Engine:** User or team rules for model use, budget, approvals, file access, and risk handling.

## Phase 0: Product Definition And Constraints

**Objective:** Define the Runtime's scope, core vocabulary, non-goals, and first supported workflows before building code.

**Deliverables:**

- Product brief.
- Runtime vocabulary.
- Task contract schema draft.
- Model tier policy draft.
- First integration target list.
- Security and safety principles.

**Tasks:**

- [ ] Define the one-sentence product positioning: "AI Coding Runtime is a local-first orchestration layer for AI coding tasks."
- [ ] Define core concepts: run, task, task graph, task contract, model tier, worker, supervisor, verifier, policy, trace.
- [ ] Define first model tiers: `cheap`, `standard`, `premium`.
- [ ] Define first task levels: `L0` read-only, `L1` simple generation, `L2` local code change, `L3` cross-module change, `L4` high-risk architecture or security work.
- [ ] Define first routing rule: final verification always uses `premium` unless the user explicitly disables it.
- [ ] Define first non-goals: no custom IDE, no hosted SaaS, no autonomous production deployment, no hidden file edits, no unbounded model calls.
- [ ] Define first supported host tools: Codex CLI, Codex Desktop, Cursor, OpenCode.
- [ ] Define first safety rule: workers can only act within explicit task contracts.

**Acceptance Criteria:**

- A reader can explain what the Runtime is and is not.
- The first version can be built without needing a desktop UI or hosted service.
- All later phases can reference the same vocabulary.

## Phase 1: Local Runtime Skeleton

**Objective:** Create the minimal local runtime process that can accept requests, create runs, store traces, and return structured status.

**Deliverables:**

- Local daemon command.
- CLI entrypoint.
- Runtime config file.
- Run storage.
- Structured logging.
- Basic report output.

**Tasks:**

- [ ] Add `ai-coding-runtime start` to launch the local service.
- [ ] Add `ai-coding-runtime run "<request>"` to start a one-off runtime run.
- [ ] Add `ai-coding-runtime status <run-id>` to inspect progress.
- [ ] Add `ai-coding-runtime report <run-id>` to print final results.
- [ ] Define default local ports for HTTP and MCP access.
- [ ] Define a config file, such as `runtime.config.json` or `runtime.config.toml`.
- [ ] Store each run under a stable local data directory with request, task graph, events, model calls, verification output, and final report.
- [ ] Add event types: `run_started`, `task_planned`, `task_routed`, `task_started`, `task_finished`, `verification_started`, `verification_finished`, `run_finished`, `run_failed`.

**Acceptance Criteria:**

- A user can start the Runtime locally.
- A request can create a run ID.
- A run can be inspected even if no real model execution exists yet.
- The Runtime produces deterministic JSON output for integrations.

## Phase 2: MCP And HTTP Gateway

**Objective:** Make the Runtime usable by external coding tools without requiring those tools to know internal implementation details.

**Deliverables:**

- MCP server interface.
- HTTP API interface.
- Tool schemas.
- Auth and local trust model.
- Integration examples.

**MCP Tools:**

- `runtime_plan`: create a task plan without executing it.
- `runtime_estimate`: estimate difficulty, risk, cost, and suggested model tiers.
- `runtime_run`: plan and execute a runtime run.
- `runtime_status`: return run progress.
- `runtime_collect`: return worker outputs and intermediate artifacts.
- `runtime_verify`: run verification on a run or workspace diff.
- `runtime_report`: return final report.
- `runtime_cancel`: cancel a running task or run.

**HTTP API:**

- `POST /api/runs`
- `GET /api/runs/:id`
- `POST /api/runs/:id/cancel`
- `POST /api/plan`
- `POST /api/estimate`
- `POST /api/verify`
- `GET /api/runs/:id/report`

**Tasks:**

- [ ] Define MCP tool input and output schemas.
- [ ] Define HTTP request and response schemas matching the MCP tools.
- [ ] Add local-only default binding to avoid exposing the service publicly by accident.
- [ ] Add optional API token for non-local access.
- [ ] Add example config for Codex CLI.
- [ ] Add example config for Codex Desktop.
- [ ] Add example config for Cursor.
- [ ] Add example config for OpenCode.

**Acceptance Criteria:**

- Codex CLI, Cursor, and OpenCode can discover the Runtime as an MCP server.
- Tool responses are structured enough for host agents to reason about them.
- The same run can be created through CLI, MCP, or HTTP.

## Phase 3: Task Planning And Contract System

**Objective:** Convert user requests into explicit task graphs and worker-safe task contracts.

**Deliverables:**

- Task graph schema.
- Task contract schema.
- Planning prompt.
- Plan review output.
- Human approval gate for medium/high-risk plans.

**Task Contract Shape:**

```yaml
task_id: T-001
title: Add validation tests
goal: Add tests for empty password and invalid email.
difficulty: L1
risk: low
context_need: low
verification: easy
model_tier: cheap
allowed_files:
  - tests/auth.test.ts
forbidden_actions:
  - modify production auth logic
  - change public API behavior
acceptance:
  - test covers empty password
  - test covers invalid email
  - project test command passes
expected_output:
  - patch
  - explanation
  - verification notes
```

**Tasks:**

- [ ] Define task graph fields: `run_id`, `tasks`, `dependencies`, `approval_required`, `estimated_cost`, `risk_summary`.
- [ ] Define task contract fields: `task_id`, `goal`, `difficulty`, `risk`, `allowed_files`, `forbidden_actions`, `acceptance`, `expected_output`.
- [ ] Implement planning mode that produces a plan but does not modify files.
- [ ] Implement plan validation that rejects tasks without acceptance criteria.
- [ ] Implement dependency validation that rejects circular task graphs.
- [ ] Implement human approval gate for `risk: medium` and `risk: high`.
- [ ] Add plan report format for host tools to show users before execution.

**Acceptance Criteria:**

- Every executable worker task has a task contract.
- A task cannot execute if it has no acceptance criteria.
- Plans can be inspected and approved before execution.

## Phase 4: Classifier And Model Router

**Objective:** Decide which model tier should handle each task and when to escalate.

**Deliverables:**

- Difficulty classifier.
- Risk classifier.
- Routing policy.
- Budget policy.
- Escalation policy.
- Model capability registry.

**Routing Inputs:**

- Task difficulty.
- Code risk.
- Context requirement.
- Verification strength.
- User budget.
- Model cost.
- Model historical reliability.
- Whether the task edits files.

**Default Routing Table:**

| Level | Task Type | Default Tier | Escalation Trigger |
| --- | --- | --- | --- |
| L0 | read-only search, summary, extraction | cheap | missing or conflicting result |
| L1 | docs, simple tests, simple generation | cheap | invalid patch or failed checks |
| L2 | local code change | standard | failed tests or uncertain diff |
| L3 | cross-module change | premium | always final review |
| L4 | architecture, security, migrations | premium | human approval required |

**Tasks:**

- [ ] Define classifier output fields: `difficulty`, `risk`, `context_need`, `verification`, `confidence`, `reasoning`.
- [ ] Define model registry fields: `provider`, `model`, `tier`, `cost_hint`, `context_window`, `tool_support`, `strengths`, `blocked_task_types`.
- [ ] Implement default model tier aliases: `cheap`, `standard`, `premium`.
- [ ] Add routing rules for file-editing tasks.
- [ ] Add routing rules for final verification.
- [ ] Add escalation rules for failed tests, malformed output, forbidden file access, low classifier confidence, and user policy violations.
- [ ] Add budget controls: max cost per run, max calls per run, max retry count.

**Acceptance Criteria:**

- The Runtime can explain why a task was routed to a tier.
- The Runtime can refuse execution if the budget or policy would be violated.
- Failed low-tier attempts can escalate to stronger models with trace records.

## Phase 5: Model Provider Adapters

**Objective:** Make the Runtime able to call multiple model providers through a common internal interface.

**Deliverables:**

- Provider interface.
- OpenAI-compatible adapter.
- Anthropic-compatible adapter.
- Gemini-compatible adapter.
- Local model adapter placeholder.
- Provider secrets configuration.
- Provider health check.

**Tasks:**

- [ ] Define a common `generate` interface with messages, tools, response schema, temperature, max tokens, and timeout.
- [ ] Define normalized model response shape with text, structured output, token usage, cost estimate, finish reason, and raw metadata.
- [ ] Implement provider config loading from environment variables and config file.
- [ ] Implement OpenAI-compatible provider.
- [ ] Implement Anthropic-compatible provider.
- [ ] Implement Gemini-compatible provider.
- [ ] Add provider health command.
- [ ] Add retry policy for transient provider failures.
- [ ] Add clear failure messages for missing API keys and unsupported models.

**Acceptance Criteria:**

- At least one real provider can execute a task.
- Provider errors do not crash the whole run.
- Model usage and estimated cost are recorded in the run trace.

## Phase 6: Worker Executor And Workspace Adapter

**Objective:** Let workers perform constrained tasks against a workspace without giving them uncontrolled authority.

**Deliverables:**

- Worker execution loop.
- Workspace reader.
- Patch applier.
- File allowlist enforcement.
- Forbidden action detection.
- Isolated task output.

**Tasks:**

- [ ] Implement workspace snapshot summary for a task.
- [ ] Implement context pack generation from allowed files and referenced files.
- [ ] Implement worker prompt template that includes task contract, allowed files, forbidden actions, acceptance criteria, and output schema.
- [ ] Require worker outputs to be structured: patch, explanation, verification notes, confidence, files touched.
- [ ] Reject patches that touch files outside `allowed_files`.
- [ ] Reject outputs that do not include required acceptance mapping.
- [ ] Apply worker patch only after Runtime validation.
- [ ] Record every worker attempt separately.

**Acceptance Criteria:**

- A worker cannot modify files outside its contract.
- A malformed worker result fails safely.
- Every applied change can be traced back to a task contract.

## Phase 7: Verification Engine

**Objective:** Verify results with commands, static checks, task acceptance checks, and final supervisor review.

**Deliverables:**

- Verification command runner.
- Test/lint/typecheck configuration.
- Diff checker.
- Acceptance checker.
- Final review step.
- Verification report.

**Default Checks:**

- `git diff --check`
- project test command when configured
- project lint command when configured
- project typecheck command when configured
- task acceptance mapping
- final AI review for medium/high-risk changes

**Tasks:**

- [ ] Define verification config fields: `diff_check`, `test`, `lint`, `typecheck`, `custom_commands`.
- [ ] Add timeout handling for verification commands.
- [ ] Capture stdout, stderr, exit code, duration, and command name.
- [ ] Fail the run when required verification commands fail.
- [ ] Add task-level acceptance review that maps each acceptance item to evidence.
- [ ] Add final supervisor review prompt that checks requirement alignment, diff risk, and verification evidence.
- [ ] Add escalation when verification fails after a cheap or standard worker attempt.

**Acceptance Criteria:**

- The Runtime never reports success without verification evidence.
- Failed verification blocks final completion.
- Final reports show which checks passed, failed, or were skipped.

## Phase 8: Host Tool Integrations

**Objective:** Make the Runtime easy to use from Codex Desktop, Codex CLI, Cursor, and OpenCode.

**Deliverables:**

- Codex Desktop setup guide.
- Codex CLI setup guide.
- Cursor setup guide.
- OpenCode setup guide.
- Recommended prompts/rules/skills for each tool.
- Example project configs.

**Codex Desktop Usage:**

```text
1. Start the Runtime locally.
2. Add the Runtime MCP server in Codex Desktop settings.
3. Use a skill or prompt rule telling Codex when to call the Runtime.
4. Ask Codex: "Use AI Coding Runtime for this task. Plan first, estimate cost, then wait for approval."
```

**Codex CLI Usage:**

```bash
ai-coding-runtime start
codex mcp add ai-coding-runtime -- npx -y ai-coding-runtime mcp
codex
```

Then prompt:

```text
Use ai-coding-runtime to plan, route, execute, verify, and report this task. Optimize for cost, but use premium final review.
```

**Cursor Usage:**

```json
{
  "mcpServers": {
    "ai-coding-runtime": {
      "url": "http://localhost:3847/mcp"
    }
  }
}
```

Cursor rule:

```md
Use AI Coding Runtime for multi-step, high-cost, risky, or verification-heavy tasks.
Plan first, ask for approval on medium/high risk, then execute through Runtime tools.
```

**OpenCode Usage:**

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "ai_runtime": {
      "type": "remote",
      "url": "http://localhost:3847/mcp",
      "enabled": true
    }
  }
}
```

OpenCode command:

```json
{
  "command": {
    "runtime": {
      "template": "Use ai_runtime to plan, route, execute, verify, and summarize this task: $ARGUMENTS",
      "description": "Run task through AI Coding Runtime"
    }
  }
}
```

**Tasks:**

- [ ] Write a setup guide for Codex Desktop.
- [ ] Write a setup guide for Codex CLI.
- [ ] Write a setup guide for Cursor.
- [ ] Write a setup guide for OpenCode.
- [ ] Add sample MCP configs for each tool.
- [ ] Add sample prompts for "plan only", "cost optimized", "premium final review", and "high risk require approval".
- [ ] Add a smoke test checklist for each integration.

**Acceptance Criteria:**

- A user can connect the Runtime to each supported tool.
- Each tool can call at least `runtime_plan`, `runtime_run`, `runtime_status`, and `runtime_report`.
- The user experience is consistent across tools.

## Phase 9: Reporting, Observability, And Cost Controls

**Objective:** Make every run understandable, auditable, and cost-aware.

**Deliverables:**

- Run report.
- Cost report.
- Trace viewer data.
- Model performance history.
- Failure analysis.
- Export format.

**Tasks:**

- [ ] Add final report sections: summary, changed files, task graph, model routing, cost estimate, verification, risks, follow-up recommendations.
- [ ] Add per-task model usage and cost estimate.
- [ ] Add reason fields for every routing and escalation decision.
- [ ] Add failure categories: provider error, malformed output, policy violation, verification failure, human approval rejected.
- [ ] Add `ai-coding-runtime report <run-id> --json`.
- [ ] Add `ai-coding-runtime report <run-id> --markdown`.
- [ ] Add historical model reliability metrics per task type.

**Acceptance Criteria:**

- The user can see where money was spent.
- The user can see why a stronger model was used.
- The Runtime can compare cheap vs standard vs premium success rates over time.

## Phase 10: Policy, Safety, And Team Mode

**Objective:** Allow individuals and teams to control Runtime behavior safely.

**Deliverables:**

- Policy config.
- Approval gates.
- Workspace trust model.
- Secret redaction.
- Team policy examples.
- Audit export.

**Example Policy:**

```yaml
budget:
  max_cost_per_run: 2.00
  max_worker_retries: 2

routing:
  final_review_model_tier: premium
  security_tasks_min_tier: premium
  readonly_tasks_allow_local_models: true

safety:
  require_human_approval_for_high_risk: true
  require_tests_for_code_changes: true
  block_secret_exfiltration: true
  block_unapproved_network_access: true
```

**Tasks:**

- [ ] Add policy schema.
- [ ] Add policy validation.
- [ ] Add budget enforcement.
- [ ] Add risk-based human approval.
- [ ] Add secret redaction in traces and prompts.
- [ ] Add file and command allowlists.
- [ ] Add team policy examples.
- [ ] Add audit export for completed runs.

**Acceptance Criteria:**

- The Runtime can enforce budget and risk limits.
- Secrets are not included in worker prompts or reports.
- High-risk actions can require explicit human approval.

## Phase 11: Learning And Optimization

**Objective:** Improve routing decisions over time using real run history.

**Deliverables:**

- Model performance database.
- Task-type success metrics.
- Routing recommendation improvements.
- Regression detection.
- Cost-quality dashboard data.

**Tasks:**

- [ ] Record outcome quality by task type and model tier.
- [ ] Record retry and escalation frequency.
- [ ] Record verification failure patterns.
- [ ] Recommend cheaper tiers for task types with high cheap-model success rates.
- [ ] Recommend stronger tiers for task types with frequent cheap-model failures.
- [ ] Add policy option to disable learning.
- [ ] Add export/import for routing history.

**Acceptance Criteria:**

- Routing gets more accurate with real project usage.
- Users can inspect why routing recommendations changed.
- Learning can be disabled for privacy-sensitive users.

## Phase 12: Optional UI And Hosted Extensions

**Objective:** Add optional interfaces after the local runtime is reliable.

**Deliverables:**

- Local web dashboard.
- Run trace viewer.
- Cost and model usage charts.
- Team hosted mode proposal.
- IDE extension proposal.

**Tasks:**

- [ ] Add local dashboard to inspect active and past runs.
- [ ] Add task graph visualization.
- [ ] Add verification timeline.
- [ ] Add cost breakdown UI.
- [ ] Add model performance view.
- [ ] Draft hosted team mode architecture.
- [ ] Draft IDE extension architecture.

**Acceptance Criteria:**

- UI is optional; CLI and MCP remain first-class.
- The dashboard improves visibility but is not required for execution.
- Hosted mode is not required for individual local usage.

## Recommended Build Order

Build in this order:

1. Phase 0: Product definition.
2. Phase 1: Local runtime skeleton.
3. Phase 2: MCP and HTTP gateway.
4. Phase 3: Task planning and contracts.
5. Phase 4: Classifier and router.
6. Phase 5: Model provider adapters.
7. Phase 6: Worker executor.
8. Phase 7: Verification engine.
9. Phase 8: Host tool integrations.
10. Phase 9: Reporting and cost controls.
11. Phase 10: Policy and safety.
12. Phase 11: Learning and optimization.
13. Phase 12: Optional UI and hosted extensions.

The first public alpha should include Phases 0 through 8. Phases 9 and 10 are needed before serious team usage. Phases 11 and 12 should wait until enough real runs exist to justify them.

## Alpha Scope

The alpha should support:

- Local runtime process.
- CLI.
- MCP server.
- HTTP API.
- `cheap`, `standard`, and `premium` model tiers.
- Plan-only mode.
- Execute mode.
- Basic task contracts.
- Basic routing.
- One real model provider.
- Workspace patch application.
- Verification command runner.
- Markdown and JSON reports.
- Setup examples for Codex CLI, Codex Desktop, Cursor, and OpenCode.

The alpha should not support:

- Hosted SaaS.
- Multi-user permissions.
- Visual dashboard.
- Autonomous production deployment.
- Complex learning-based routing.
- Unrestricted worker file access.

## Beta Scope

The beta should add:

- Multiple model providers.
- Stronger policy engine.
- Team-safe configs.
- Secret redaction.
- Better provider health checks.
- Better cost tracking.
- Historical routing performance.
- More robust tool integrations.
- Final AI review mode.

## Stable V1 Scope

V1 should be considered ready when:

- Host tools can reliably call Runtime through MCP.
- Runs can be reproduced and audited.
- Workers are constrained by task contracts.
- Verification blocks unsafe completion.
- Model routing saves cost on real workloads.
- Users can understand every routing and escalation decision.
- The Runtime fails safely when models, tools, tests, or policies fail.

## Key Risks

- **Weak task contracts:** Workers may make unsafe edits if contracts are vague.
- **Over-routing to cheap models:** Cost savings can reduce quality if verification is weak.
- **Underpowered verification:** The Runtime becomes unreliable if it trusts model output without tests and checks.
- **Provider fragmentation:** Too many model APIs too early can distract from core orchestration.
- **Tool integration drift:** Codex, Cursor, OpenCode, and other tools may change MCP or config behavior.
- **Hidden cost:** Retries and escalation can exceed user expectations without clear budgets.
- **Security leakage:** Workspace context can accidentally expose secrets to external models.

## Design Principles

- Start local-first.
- Use MCP as the main integration surface.
- Keep CLI and HTTP as first-class interfaces.
- Treat workers as constrained executors.
- Treat premium models as supervisors and verifiers.
- Prefer explicit policy over hidden automation.
- Never report success without evidence.
- Record every important decision.
- Make cost visible before and after execution.
- Escalate when uncertain.

## Open Decisions

- Which language should the first implementation use?
- Which model provider should be supported first?
- Should the host coding tool remain the supervisor, or should the Runtime own supervisor calls directly from alpha?
- Should file patches be applied automatically after verification, or staged for host-tool approval?
- What is the first target user: individual developer, power user, or small team?
- Should the first alpha prefer stdio MCP, HTTP MCP, or both?

## Next Step

Turn Phase 0 and Phase 1 into a concrete implementation plan with exact repository structure, commands, test strategy, and first working CLI/MCP skeleton.
