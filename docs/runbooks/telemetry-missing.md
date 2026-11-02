# SLO no data / missing telemetry

Owner: tenant owner (application), platform owner (platform and approval). Scope: one
`TENANT` / `ENV` on homelab unless explicitly expanded. Operational
instructions, not evidence of activation; live activation owns the live drill.

## Trigger

Ingress request series or latency histograms are absent after the 15m startup grace, a rule is not loaded, a dashboard is empty or the board reports an unreachable source.

## Impact

The service outcome is unknown from this measurement. Zero requests with present series, absent series and stale samples are three different states; none proves 100% availability.

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
```sh
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" get prometheuses.monitoring.coreos.com -n monitoring -o yaml
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" get servicemonitors.monitoring.coreos.com -n monitoring
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" get configmaps -n "$NS" -l grafana_dashboard=1 -o name
```

Inspect ruleNamespaceSelector/ruleSelector and the tenant namespace labels;
require `release: kube-prometheus-stack` on PrometheusRule. Inspect loaded
rules/targets in the existing UI, not just Kubernetes object existence. Check
histogram bucket `le="0.5"` and that selector namespace/ingress labels match
actual series. Alloy is shared; no log-agent pod in a tenant is expected.


## Remediation

1. **needs operator approval:** fix the demonstrated discovery label, namespace selector, ingress scrape, histogram or rule expression via its owning gitops config. Review cross-tenant effects and run gates first.
2. **needs operator approval:** test an approved private request and controlled absence/recovery drill only after discovery is repaired. Request generation is an active verification action, not read-only diagnosis.
3. For true idle traffic, record no observation and retain the denominator gate. **needs operator approval:** alter activation/grace settings only with measured justification; never replace missing series with synthetic success or page on an unqualified latency objective.

## Rollback

**needs operator approval:** restore the previous selector/rule/network change through gitops if other tenants lose telemetry. Keep the diagnostic visible and report the unresolved gap; do not revert to fabricated zero errors.

## Verify

Repeat the relevant read-only commands above after the change and record fresh
payload evidence, not just a successful command or green controller status.

| VERIFY item | Evidence required | Initial status / owner |
|---|---|---|
| V-telemetry-missing-1 | Expected rules are loaded/evaluating, current request and bucket samples arrive after an approved request, the absence condition clears honestly, and the controlled missing-source drill never reports health; dashboard/log discovery and board freshness checked. | Open — tenant owner / live activation |
| V-telemetry-missing-2 | Record UTC start/end, expected versus observed result, evidence source, current digest/revision, gaps and the platform owner's approval reference for any mutation. | Open — the platform owner |

Close each row separately as observed, failed, blocked or skipped (with reason).
An offline pass never clears a live row. Preserve the sanitized incident record.

## Escalation

Escalate cluster-wide missing telemetry or board-health critical alerts to the platform owner; an inaccessible read-only UI is an evidence gap, not justification for write access. Critical severity goes to **page**; every other severity goes to
the **hourly status board** through the existing null route. No notify tier or
new tenant notification bridge. The cluster board cannot honor cluster silences;
check its source freshness and delivery health before interpreting silence.

See the [index and authorization contract](README.md),
[ADR-0015](../adr/0015-runbooks.md) and [usage](../usage.md).
