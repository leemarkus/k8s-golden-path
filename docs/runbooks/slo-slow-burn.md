# SLO slow burn

Owner: tenant owner (application), platform owner (platform and approval). Scope: one
`TENANT` / `ENV` on homelab unless explicitly expanded. Operational
instructions, not evidence of activation; live activation owns the live drill.

## Trigger

Warning burn: (2h AND 1d > 3) OR (6h AND 3d > 1), same tenant/env and SLI. It appears on the hourly status board.

## Impact

Persistent error-budget consumption needs planned investigation; it is not an extra notify tier. A short quiet interval cannot establish multi-day recovery.

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

1. Compare the paired long/short windows with traffic mix, periodic jobs, deployment history and resource trends. Inspect the status board timestamp and current firing set; yesterday's alert is not proof it fires now.
2. **needs operator approval:** schedule a reviewed digest/config/resource fix with the tenant owner, including a hypothesis and observation period covering the relevant windows. Use [rollback](rollback.md) if a release regression is demonstrated.
3. **needs operator approval:** tune objectives only through the documented evidence/ADR process, never simply to remove an inconvenient warning. Keep latency paging conditional on the real-user traffic qualification.

## Rollback

**needs operator approval:** revert the planned change through the normal gate if it increases bad requests/latency or admission fails. Preserve the original SLO target and rule history.

## Verify

Repeat the relevant read-only commands above after the change and record fresh
payload evidence, not just a successful command or green controller status.

| VERIFY item | Evidence required | Initial status / owner |
|---|---|---|
| V-slo-slow-burn-1 | Both windows recover with fresh denominators, the board publishes the current/resolved condition and its sources are reachable; multi-day history and seven-day retention limits are stated. | Open — tenant owner / live activation |
| V-slo-slow-burn-2 | Record UTC start/end, expected versus observed result, evidence source, current digest/revision, gaps and the platform owner's approval reference for any mutation. | Open — the platform owner |

Close each row separately as observed, failed, blocked or skipped (with reason).
An offline pass never clears a live row. Preserve the sanitized incident record.

## Escalation

Escalate an observed critical fast-burn transition to the platform owner immediately; use the board for noncritical work and investigate missing board delivery independently. Critical severity goes to **page**; every other severity goes to
the **hourly status board** through the existing null route. No notify tier or
new tenant notification bridge. The cluster board cannot honor cluster silences;
check its source freshness and delivery health before interpreting silence.

See the [index and authorization contract](README.md),
[ADR-0015](../adr/0015-runbooks.md) and [usage](../usage.md).
