# Architecture decisions

Golden Path was designed as fifteen decision records, all accepted on 2026-10-03. Accepted means the design is agreed, not that it is deployed. This public copy carries the seven that shape the code here most directly. The rest record lab-specific wiring and stay in the private repository, so their numbers are skipped.

| ADR | Decision | Status |
|---|---|---|
| [ADR-0001](0001-scope-and-non-goals.md) | Scope and non-goals: one operator, one cluster, no portal | accepted |
| [ADR-0006](0006-build-once-promote-digest.md) | Build once and promote by digest | accepted-with-notes |
| [ADR-0011](0011-slos.md) | Generate tenant availability and latency SLOs | accepted-with-notes |
| [ADR-0012](0012-alert-routing.md) | Two alert tiers and resolvable runbooks | accepted-with-notes |
| [ADR-0013](0013-policy-conformance.md) | The live Kyverno policy set is the oracle | accepted-with-notes |
| [ADR-0014](0014-secrets.md) | Sealed Secrets, and scaffolds that never emit secrets | accepted-with-notes |
| [ADR-0015](0015-runbooks.md) | Runbooks and read-only SRE scenarios | accepted-with-notes |

`accepted-with-notes` means the decision stands as written, with implementation evidence, limits or clarifications appended. It does not imply deployment.

Each record names its private evidence in an Evidence section. The paths are left out of this copy, because they point into private repositories.
