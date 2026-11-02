# ADR-0015 — Runbooks and read-only SRE scenarios

## Status

Accepted design; implemented by the runbook stage.

## Date

2026-10-03

## Context

The lab's first iteration found stale runbooks and checker failures mistaken for payload failures. SRE already has scenario/alert/replay/rubric files and read-only tool boundaries.

## Decision

The runbook stage writes one page per operation with headings Trigger, Impact, Read-only diagnosis, Remediation, Rollback, Verify, Escalation. Every alert links a real body through runbook_url. Each page names tenant/env, ownership, authorization boundary and observable success/failure; begin with read-only inspection and distinguish unknown from healthy. Commands must describe the current VM-hosted Forgejo, deploy-branch boundary and Mac-resident SRE runtime.

Each tenant receives an SRE scenario stub at `tenants/<tenant>/scenarios/<tenant>-slo-burn/`: README.md, scenario.json, alert.json, replay.json, known-good.md and known-bad.md. Match the lab’s JSON shape: scenario `id`, `title`, `description`, `alertProvenance: "constructed"`, `files` mapping (alert, replay, knownGoodReport, knownBadReport), `dynamicRefs`, `rubric`, and explicit incident-time limitations. Alert uses an Alertmanager envelope with alerts[].labels/annotations. Replay uses `turns[].text` and `tool_uses` with `name: "kubectl_read"` and input subcommand/namespace/resource; only get/describe/logs, no writes. Stubs are ungraded and explicitly synthetic until populated/frozen from evidence; an empty rubric cannot count as a passed scenario. A replay may execute real read-only tools in the SRE harness, so creation is not authorization to run it.

The planned runbooks are indexed in [runbooks](../runbooks/README.md). Golden-path owns the bodies/stubs; SRE owns its runtime and grader. No new agent credential or auto-remediator.

## Alternatives considered

- **Only a generic troubleshooting README:** Rejected. Does not resolve individual alert triggers or establish a concrete verification/rollback path.
- **Autonomous write-capable remediation:** Rejected. Violates the lab’s read-only agent boundary and expands scope before human runbooks are proven.
- **Invent “known good” live evidence for scaffolds:** Rejected. Repeats wrapper-success and stale-evidence failures; synthetic fixtures must say what they are.

## Consequences

Runbook upkeep is part of every change to deployment or alerts. Scenario metadata can be generated offline, but captured evidence, grading and live agent runs remain separately gated.

## Evidence

Sources are the lab's private repositories (cluster GitOps, alert routing, the reference service and the SRE agent); their paths are omitted from this public copy.

## Verification

The runbook stage validates required headings, every runbook_url and synthetic scenario JSON shape without executing SRE. First-tenant acceptance fills a tenant stub; live activation exercises the human runbook and authorized read-only scenario.

## Implementation notes (the runbook stage, 2026-10-03)

- Implemented all six stable planned runbook filenames and added dedicated
  rollback, fast/slow burn, image-scan, policy-rejection and Argo-sync bodies.
  The index maps the requested operations to these names; original alert suffixes
  remain valid. Each body uses seven ordered headings, read-only diagnosis with
  the operator's read-only kubeconfig, human approval labels for mutations and open VERIFY
  rows. No live observations or drills are claimed.
- Added guides for the first-hour review packet, ongoing usage depth, ADR plus
  scoped PolicyException deviations, capacity arithmetic and scope FAQ. The hour
  is a preparation budget, conditional on integrated templates/caches/platform
  prerequisites, not a deployment-time measurement.
- The runbook stage supplies the six-file documentation template in
  `docs/sre-scenarios/TEMPLATE/`; first-tenant acceptance owns the instantiated tenant directory.
  This follows the ownership boundary rather than adding generator mappings
  or writing the website instance. Manual documentation markers are not gp
  placeholders and do not change the template contract.
- Read-only inspection of SRE `src/scenario.ts` showed required failureClass and
  expectedRootCause fields and a minimum of one rootCause pattern. The template
  therefore carries these fields and an impossible `(?!)` pattern, rather than
  an empty schema-invalid rubric or a permissive placeholder that could pass.
  description remains explanatory GP metadata; the SRE loader does not grade it.
  answerKey is explicitly frontier-provisional. All evidence is constructed and
  ungraded; the good report is a scaffold, not a passing fixture. This is a
  fail-closed format clarification, not a relaxation of the accepted Decision.
- SRE dry-run dispatches real tools. The local node test checks documentation
  structure, safe command syntax and instantiated JSON shapes only; it never
  invokes the SRE runtime, a cluster or network. First-tenant acceptance must freeze evidence-based
  rubric/report pairs; live activation owns authorized live proof. The publication base
  is settled by the 2026-10-19 note below.

## Publication decision — 2026-10-19

The private repository publishes runbooks from its own Git host. This public copy uses the absolute base
`https://github.com/leemarkus/k8s-golden-path/blob/main/docs/runbooks/`
for generated alerts and scenario annotations. Every basename must exist locally
and appear in the runbook index. The observe generator has one base constant;
checked-in templates are regenerated with it. This settles the runbook URL
question; offline link checks do not claim remote reachability or alert delivery.
