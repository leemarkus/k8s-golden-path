# Policy rejection (Kyverno)

Owner: tenant owner (application), platform owner (platform and approval). Scope: one
`TENANT` / `ENV` on homelab unless explicitly expanded. Operational
instructions, not evidence of activation; live activation owns the live drill.

## Trigger

A rendered tenant fails the actual Kyverno oracle or a live admission event denies its workload.

## Impact

Dev/prod rollout may stall while prior pods remain. PSS, quota, AppProject and Kyverno failures have different owners and evidence; an offline pass does not prove live Enforce coverage.

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
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" get policyreports.wgpolicyk8s.io -n "$NS"
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" get clusterpolicies.kyverno.io
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" describe resourcequota -n "$NS"
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" get namespace "$NS" --show-labels
```

Record the exact policy/rule, resource, field, autogen rule (if applicable) and
admission message. Inspect the read-only policy source at
`<gitops>/clusters/homelab/config/kyverno-policies.yaml`.
Use the guide's offline oracle command on full rendered dev/prod output. Require
nonzero passes and zero fail/warn/error, not merely exit 0. Missing CRDs or denied
reads remain gaps. Check namespace-specific Enforce overrides and installed
PolicyException support with the platform owner before proposing an exception.


## Remediation

1. **needs operator approval:** fix the manifest to meet the existing rule (non-root, explicit resources, probes, permitted image or security context). Render both environments and rerun the real oracle; do not fork its policies.
2. **needs operator approval:** where unavoidable, follow [policy conformance](../adr/0013-policy-conformance.md): create a decision ADR and narrowly scoped PolicyException with exact policy/rules, namespace/resources, owner, expiry, compensating control and removal test. Prove installed API/feature support and CLI context before applying it. Unsupported exceptions block onboarding.
3. **needs operator approval:** The platform owner expands tenant namespace Enforce coverage and performs the negative admission drill. Never flip shared policies to Audit, globally exclude tenants or disable PSS to obtain a pass.

## Rollback

**needs operator approval:** revert the rejected manifest to the prior compliant digest/config through the gate. Remove an exception only after the replacement passes without it; restore the compensating control if a mitigation fails. Never weaken the oracle as rollback.

## Verify

Repeat the relevant read-only commands above after the change and record fresh
payload evidence, not just a successful command or green controller status.

| VERIFY item | Evidence required | Initial status / owner |
|---|---|---|
| V-policy-rejection-1 | Full dev/prod render passes the actual oracle with nonzero pass and zero fail/warn/error; live admission and negative-control rejection demonstrate coverage, and any exception expires/removes as documented. | Open — tenant owner / live activation |
| V-policy-rejection-2 | Record UTC start/end, expected versus observed result, evidence source, current digest/revision, gaps and the platform owner's approval reference for any mutation. | Open — the platform owner |

Close each row separately as observed, failed, blocked or skipped (with reason).
An offline pass never clears a live row. Preserve the sanitized incident record.

## Escalation

Escalate shared-policy defects or unsupported exception APIs to the platform owner/platform owner with the exact failing rule and minimal sanitized resource. Critical severity goes to **page**; every other severity goes to
the **hourly status board** through the existing null route. No notify tier or
new tenant notification bridge. The cluster board cannot honor cluster silences;
check its source freshness and delivery health before interpreting silence.

See the [index and authorization contract](README.md),
[ADR-0015](../adr/0015-runbooks.md) and [usage](../usage.md).
