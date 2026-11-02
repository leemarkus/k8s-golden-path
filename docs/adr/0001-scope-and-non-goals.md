# ADR-0001 — Scope and non-goals

## Status

Accepted design; implemented by the CLI stage.

## Date

2026-10-03

## Context

The lab has one operator and one target cluster. The lab's first iteration spent capacity on tooling while adoption lagged. The paved road was reopened on 2026-10-03 with that sequencing lesson in force.

## Decision

The supported road is templates, policies, tests, documentation and a small `gp` CLI. Support stateless HTTP services on homelab. No portal or additional cluster. Database workloads wait for a stateful ADR and a CloudNativePG review; tracing waits for a later ADR; public exposure belongs to the Cloudflare Tunnel path; multi-cluster is out of scope. A first real tenant (the portfolio website's internal build) must prove the extracted path before it expands. Live activation is a separate step the platform owner approves.

## Alternatives considered

- **Backstage:** Rejected. A runtime, plugin lifecycle and portal UI are disproportionate for one user; the first iteration already showed how surfaces proliferate.
- **A new platform cluster and full database/tracing stack:** Rejected. Adds unconsumed infrastructure, contradicting the first-workload sequence and the deferred database and tracing decisions.

## Consequences

Keeping a small contract makes manual review practical. Stateful services and public endpoints must wait; no template may imply those capabilities exist.

## Evidence

Sources are the lab's private repositories (cluster GitOps, alert routing, the reference service and the SRE agent); their paths are omitted from this public copy.

## Verification

The CLI stage documents the boundary; first-tenant acceptance exercises a real tenant; live activation alone proves the live delivery and alert loop.
