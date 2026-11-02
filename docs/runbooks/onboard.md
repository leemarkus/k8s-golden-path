# Onboard a tenant

Owner: tenant owner (application), platform owner (platform and approval). Scope: one
`TENANT` / `ENV` on homelab unless explicitly expanded. Operational
instructions, not evidence of activation; live activation owns the live drill.

## Trigger

A named owner requests a stateless internal HTTP service. Record kind, tenant slug, dev/prod hosts, dependencies, health path and rollback contract before generating anything.

## Impact

Onboarding adds two namespaces and consumes shared ingress, registry, monitoring and runner capacity. It does not authorize public exposure, databases or a second cluster.

## Read-only diagnosis

```sh
TENANT=fixture # replace with the affected tenant slug
ENV=dev # choose dev or prod from the alert/change request
NS="$TENANT-$ENV"
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" auth can-i get pods -n "$NS"
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" get deployments,pods,services,ingresses -n "$NS" -o wide
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" get events -n "$NS" --sort-by=.metadata.creationTimestamp
```

Record UTC time, tenant/env, current alert state and the exact command outcome.
A Forbidden response, timeout, empty list or old event is missing evidence,
not health. Never switch to write credentials to complete diagnosis. Human
read-only permissions may exceed the SRE agent's namespaced allowlist;
record agent blind spots instead of expanding its access. Logs can contain
application-sensitive data: inspect only the bounded window and redact before
sharing; never inspect Secret data, environment dumps or private keys.

```sh
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" get namespaces "$TENANT-dev" "$TENANT-prod" --show-labels
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" get applications.argoproj.io -n argocd "$TENANT-dev" "$TENANT-prod"
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" get resourcequota,limitrange,networkpolicy -n "$NS"
```

NotFound is expected for a new tenant; an existing owner or resource is a collision
requiring review, not permission to overwrite. Inspect scratch generated receipts,
local overlay renders and gate results using [usage](../usage.md).
Confirm the seven gitops jobs actually discover tenant overlays, the platform
namespace owner runs first, and the tenants AppProject admits no cluster kinds.


## Remediation

1. **needs operator approval — receiving-repository changes:** integrate the reviewed scratch output; preserve application tests and audience gates. Supply approved cached base pins and a scanned immutable image digest; UNRELEASED is a blocker.
2. **needs operator approval — platform setup:** reconcile the separate namespace declarations with restricted PSS, quota/LimitRange, workload-default and reviewed default-deny allow paths before tenant Applications. Verify live Kyverno namespace Enforce coverage; do not infer it from offline PASS.
3. **needs operator approval — credential creation/sealing:** follow [registry rotation](rotate-secrets.md) separately for dev and prod; add ciphertext and its kustomization reference together. Never put a Secret or dummy credential in generated output.
4. **needs operator approval — live activation:** provision internal-only DNS/NPM/TLS and authorize app publication plus gitops main push. Follow [deploy and promote](deploy-rollback.md); dev auto-syncs after the deploy gate, prod requires human sync. Do not forward the internal artifact publicly.
5. **needs operator approval — observability activation:** set real published runbook URLs after repository publication, prove namespace/rule/dashboard/log discovery and two-tier delivery. Keep latency paging unactivated until real-user traffic and histogram buckets qualify it.

## Rollback

**needs operator approval:** stop new publication/promotions, revert only the onboarding diff through the gate and explicitly review cleanup using [decommission](decommission.md). ApplicationSet deletion preserves resources; deleting a directory is not rollback completion. Preserve any pre-existing tenant and credentials until ownership is resolved.

## Verify

Repeat the relevant read-only commands above after the change and record fresh
payload evidence, not just a successful command or green controller status.

| VERIFY item | Evidence required | Initial status / owner |
|---|---|---|
| V-onboard-1 | Both namespaces have correct ownership/PSS, dev and prod run the approved digest, private health/content and fresh pulls succeed, deny/allow paths and loaded rules are proved; real page/board delivery and runbook reachability recorded. | Open — tenant owner / live activation |
| V-onboard-2 | Record UTC start/end, expected versus observed result, evidence source, current digest/revision, gaps and the platform owner's approval reference for any mutation. | Open — the platform owner |

Close each row separately as observed, failed, blocked or skipped (with reason).
An offline pass never clears a live row. Preserve the sanitized incident record.

## Escalation

Escalate missing platform prerequisites, scope exceptions or ownership collisions to the platform owner before activation. Critical severity goes to **page**; every other severity goes to
the **hourly status board** through the existing null route. No notify tier or
new tenant notification bridge. The cluster board cannot honor cluster silences;
check its source freshness and delivery health before interpreting silence.

See the [index and authorization contract](README.md),
[ADR-0015](../adr/0015-runbooks.md) and [usage](../usage.md).
