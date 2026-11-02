# ADR-0012 — Two alert tiers and resolvable runbooks

## Status

Accepted design; implemented by the observe and runbook stages.

## Date

2026-10-03

## Context

The lab retired its separate notify tier on 2026-09-14. The SLO YAML still contains an older “warning notifies” comment; the current alert taxonomy governs.

## Decision

`severity=critical` routes to page. Everything else follows Alertmanager’s null receiver and appears on the hourly status board, which reads the firing set; do not add a direct warning→ntfy route. Label every tenant alert with tenant and env. Require a `runbook_url` annotation pointing at a runbook body in this repository; the observe and runbook stages validate the URL’s repo-relative suffix resolves to an existing non-index runbook. Use the Forgejo main publication base recorded in ADR-0015 (2026-10-19), and verify reachability before live activation.

Reuse the platform’s page bridge, digest and digest-health alerts. No ntfy topic names or credentials enter templates. Fast and slow burn severity follow ADR-0011. Alert text must distinguish a failed measurement from a measured service failure and state missing/stale data explicitly.

## Alternatives considered

- **Restore warning/notify tier:** Rejected. Explicitly retired; reintroduces ambiguous actionability and interruptions.
- **Send every tenant event to page:** Rejected. Defeats the attention boundary and repeats the lab’s single-topic noise.
- **Build a tenant-specific status publisher:** Rejected. Duplicates the existing hourly board and its absence monitoring.

## Consequences

Noncritical alerts depend on the existing board’s health. The cluster board cannot honor cluster silences today; document this inherited limitation, do not promise different behavior.

## Evidence

Sources are the lab's private repositories (cluster GitOps, alert routing, the reference service and the SRE agent); their paths are omitted from this public copy.

## Verification

The observe stage validates labels/severity and the runbook stage resolves runbook paths offline. Live activation proves one critical page, a board entry/resolution, and honest missing-data behavior.

## Implementation notes (the observe stage, 2026-10-03)

Generated alerts use only critical/page and warning/hourly-board severities.
They carry tenant, env, namespace and slo labels, summary/description annotations,
and exactly the planned `docs/runbooks/slo-burn.md` or
`docs/runbooks/telemetry-missing.md` path. No receiver, notify tier or topic is
introduced. The inherited board's silence limitation and dependency on platform
board-health monitoring are documented in `templates/observe/README.md`.

The required runbook bodies and a real publication URL do not exist in this
worktree. Instead of inventing URLs or shipping active alerts with broken links,
every generated alert expression has `and on() (vector(0) == 1)` appended.
This leaves recordings/dashboard output usable and alert definitions reviewable,
but makes the alerts inert. Alternatives were omitting alert definitions (loses
reviewable/testable contracts) or enabling broken-link alerts (violates this
Decision). The runbook stage must supply the bodies, repository publication the published repository URLs,
and live activation verify discovery/routing and remove the availability/diagnostic gate
in its authorized activation. Latency has the additional ADR-0011 staging gate.

Offline tests enforce exact planned suffixes, routing labels and the closed
gate. Body verification reports SKIP while files are absent, never a successful
resolution. Publication and delivered alert/runbook drills remain incomplete;
a generated repository-relative path is not a reachable runbook URL.

## Integration notes (round 2, 2026-10-03)

The runbook stage has supplied the exact runbook bodies in this repository. Integration removes the empty-vector gates from availability and diagnostic expressions and makes body resolution mandatory in tests. This supersedes the earlier absent-body note above. Repository-relative paths satisfy offline suffix/body validation; no remote URL or delivery is claimed. The runbooks must be published at reachable URLs before live activation. Keeping all rules inert was considered but would preserve a resolved body-publication blocker; inventing remote URLs was rejected. Latency burns retain their independent ADR-0011 gate and remain excluded.

## Publication update — 2026-10-19

ADR-0015 now records the absolute runbook URL base on the repository's main branch. This supersedes
the historical repository publication URL blocker below the original Decision. Generated URLs
and scenario annotations use that base; live reachability/delivery remain live activation.
