# Tenant runbooks

The runbook stage operational instructions for homelab. These bodies are authored offline;
VERIFY rows remain open until the stated observation or authorized drill occurs.
The six originally planned filenames stay stable for the observe stage.

| File | Operation / trigger |
|---|---|
| [onboard.md](onboard.md) | Onboard a tenant; namespace bootstrap, CI, registry sealing, private ingress |
| [deploy-rollback.md](deploy-rollback.md) | Deploy and promote dev → prod by the same digest; stable release entry point |
| [rollback.md](rollback.md) | Restore a previously verified digest through the delivery gate |
| [slo-burn.md](slo-burn.md) | Stable SLO alert target; dispatch fast versus slow burn |
| [slo-fast-burn.md](slo-fast-burn.md) | Critical paired-window burn → page |
| [slo-slow-burn.md](slo-slow-burn.md) | Warning paired-window burn → hourly status board |
| [telemetry-missing.md](telemetry-missing.md) | SLO no data, absent series, stale measurements and discovery failures |
| [image-scan-failure.md](image-scan-failure.md) | Vulnerability verdict, expired allowance or missing scan evidence |
| [policy-rejection.md](policy-rejection.md) | Kyverno admission/oracle failure and scoped exception process |
| [argocd-sync-failure.md](argocd-sync-failure.md) | Trace app CI → main → seven checks → deploy → ApplicationSet → pods |
| [rotate-secrets.md](rotate-secrets.md) | Rotate registry secret / initial per-environment strict sealing |
| [decommission.md](decommission.md) | Retire tenant traffic, resources, identities and namespaces in order |

## Authorization and evidence contract

Each body has Trigger, Impact, Read-only diagnosis, Remediation, Rollback, Verify
and Escalation, in that order. Set tenant/env from the incident, not an unrelated
example. Diagnosis uses only `~/.kube/readonly.kubeconfig`; permitted
verbs are get, describe, logs, top, events and auth can-i. Commands are instructions
for an authorized connected session; none were run against the cluster while
writing this repository. The network-free documentation task is not live permission.

Every mutation **needs operator approval**, including remote publication, gitops main
pushes, secret provisioning, prod sync, rollback, traffic generation/drills and
deletion. A main push can automatically deploy after CI fast-forwards deploy.
Never push deploy directly, use force-push, or hand the SRE agent write credentials.
Local scaffolding/gates in authorized scratch are safe preparation, not activation.

Record command/time/source, expected and observed payload, owner, approval for any
mutation and PASS/FAIL/BLOCKED/SKIP per VERIFY row. Missing RBAC, stale data, absent
objects and unknown host/tool state remain explicit gaps. Do not copy secret data
into an incident record. The lab's DR runbook's VERIFY ledger inspired this format;
its old SOPS/Forgejo Kubernetes recovery examples are not tenant procedures.

Critical → page; all other alerts → the hourly status board via the null route.
Check board/source freshness; the cluster board cannot honor cluster silences.
The Git host runs outside the cluster; the SRE agent is read-only.

## Links and scenarios

Observe may keep `slo-burn.md` and `telemetry-missing.md`, or select the new focused
bodies. A runbook_url must end in an existing `docs/runbooks/<body>.md`, never this
index. Use `https://github.com/leemarkus/k8s-golden-path/blob/main/docs/runbooks/`
plus the basename (2026-10-19). Live activation verifies reachability before activation.

[Usage](../usage.md) links the walkthrough, exception
process and capacity/FAQ. [Scenario TEMPLATE](../sre-scenarios/TEMPLATE/README.md)
is documentation only, using SRE's real file shapes. First-tenant acceptance owns the website
instance at `tenants/<tenant>/scenarios/<tenant>-slo-burn/`. No stub is graded or
executed by creation; even the SRE harness dry run can perform real cluster reads.
