# SLO burn triage

Owner: tenant owner (application), platform owner (platform and approval). Scope: one
`TENANT` / `ENV` on homelab unless explicitly expanded. Operational
instructions, not evidence of activation; live activation owns the live drill.

## Trigger

A tenant availability or latency budget alert arrives; this stable alert target dispatches to [fast burn](slo-fast-burn.md) or [slow burn](slo-slow-burn.md).

## Impact

Availability 99.5% and latency 99% within 0.5s are initial 30-day budget priors, not measured promises. Low traffic and seven-day retention limit compliance claims.

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
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" get prometheusrules.monitoring.coreos.com -n "$NS" --show-labels
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" get endpointslices.discovery.k8s.io -n "$NS"
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" get resourcequota,limitrange -n "$NS"
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" top pods -n "$NS"
```

Use the existing Grafana/Prometheus read-only view; select namespace `TENANT-ENV`
and ingress `TENANT` (replace those literal examples in the queries). Check source
sample timestamps, ingestion `up` for the actual ingress scrape target, loaded
rule health, denominator and current firing set before inferring a service fault.
Do not port-forward, exec, generate traffic or broaden credentials as diagnosis.

```promql
sum(increase(nginx_ingress_controller_requests{namespace="TENANT-ENV",ingress="TENANT"}[5m]))
sum(rate(nginx_ingress_controller_requests{namespace="TENANT-ENV",ingress="TENANT",status=~"5.."}[5m]))
sum(rate(nginx_ingress_controller_request_duration_seconds_bucket{namespace="TENANT-ENV",ingress="TENANT",le="0.5"}[5m]))
sum(rate(nginx_ingress_controller_request_duration_seconds_count{namespace="TENANT-ENV",ingress="TENANT"}[5m]))
```

For each window, availability bad fraction = 5xx / all requests (budget 0.005);
latency bad fraction = 1 - bucket-at-0.5 / count (budget 0.01). Burn is bad
fraction divided by budget. Require denominator > 0; evaluate the paired windows
on the same tenant/env/SLI. A missing 5xx series may be zero only when its scoped
request denominator exists. Missing histograms are not zero latency. Capture
bounded tenant logs via the existing Alloy/Loki view and compare release time,
readiness, 5xx, restart/OOM evidence and ingress endpoints. If source access is
unavailable, mark the measurement unknown and use [no data](telemetry-missing.md).


## Remediation

1. Select [fast burn](slo-fast-burn.md) for critical or [slow burn](slo-slow-burn.md) for warning, preserving tenant/env/slo labels and the exact paired-window evidence.
2. **needs operator approval:** apply only the bounded change supported by that branch, such as digest rollback for a correlated release regression or a reviewed resource/network fix. Keep the measurement failure branch separate.
3. **needs operator approval:** if latency paging was enabled without real-user/bucket qualification, correct activation through reviewed gitops; retain recordings/dashboard and explicitly record the unsupported page. Do not lower the objective to clear the alert.

## Rollback

**needs operator approval:** revert only the mitigation through gitops and manually sync prod when needed. Restore the prior digest/config from the incident record; continue observation rather than repeatedly restarting pods.

## Verify

Repeat the relevant read-only commands above after the change and record fresh
payload evidence, not just a successful command or green controller status.

| VERIFY item | Evidence required | Initial status / owner |
|---|---|---|
| V-slo-burn-1 | Both triggering windows fall below their original thresholds with fresh nonzero request evidence, service outcome recovers, and the page/status board shows the correct current/resolved state; no empty-vector success claim. | Open — tenant owner / live activation |
| V-slo-burn-2 | Record UTC start/end, expected versus observed result, evidence source, current digest/revision, gaps and the platform owner's approval reference for any mutation. | Open — the platform owner |

Close each row separately as observed, failed, blocked or skipped (with reason).
An offline pass never clears a live row. Preserve the sanitized incident record.

## Escalation

Escalate continuing critical burn immediately to the platform owner. Shared ingress/monitoring faults belong to the platform owner, not a tenant rebuild. Critical severity goes to **page**; every other severity goes to
the **hourly status board** through the existing null route. No notify tier or
new tenant notification bridge. The cluster board cannot honor cluster silences;
check its source freshness and delivery health before interpreting silence.

See the [index and authorization contract](README.md),
[ADR-0015](../adr/0015-runbooks.md) and [usage](../usage.md).
