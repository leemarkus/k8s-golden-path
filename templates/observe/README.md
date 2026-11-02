# Tenant observability — the observe stage

These are offline scaffolds, not activated monitoring. `generate.mjs` is the
single authoring implementation for both environments, both SLIs and all burn
windows. Run `node templates/observe/generate.mjs` after editing it, and commit
its output with it. `--check` checks for drift. The CLI uses only the resulting
`.tmpl` files, following the existing placeholder contract without extending
`src/`. The files use JSON syntax, a subset of YAML: Node can parse every rendered
manifest and proposed promtool fixture with zero dependencies. Kustomize also
parses/builds the actual Kubernetes resources.

## Composition

Dev overlays include `../../base/observe`; prod overlays include
`../../base/observe/prod`. The shared workload base includes neither bundle.
Each environment gets its own PrometheusRule and dashboard ConfigMap.
ServiceMonitor and latency burn bundles remain excluded by default. Do not
recursively apply this directory: it also contains promtool test inputs.

## Selectors and discovery

Reference evidence is the read-only gitops files under
`clusters/homelab/config/` and `clusters/homelab/values/`:

- `slo-burn-rate.yaml` uses `nginx_ingress_controller_requests` and
  `status=~"5.."`. It aggregates all ingresses; it does **not** prove a tenant
  namespace label. Its `exported_service` diagnostic establishes that scrape
  label collisions matter.
- Select the backend with `exported_namespace="TENANT-ENV",ingress="TENANT"`
  when Prometheus preserves the scrape target's `namespace`. Also support
  `namespace="TENANT-ENV",exported_namespace="",ingress="TENANT"` for native
  exporter namespaces. The empty exported-namespace matcher prevents a scrape
  namespace from admitting a foreign backend. Both branches use exact tenant
  and ingress matches; neither counts the other environment. No live label
  observation was made in this offline build.
- `ingress-nginx-values.yaml` enables controller metrics and its ServiceMonitor
  with `release: kube-prometheus-stack`. All generated PrometheusRules and
  optional ServiceMonitors carry that release label. The values file for
  kube-prometheus-stack also documents that requirement, but does not explicitly
  override rule/ServiceMonitor selectors or namespace selectors. Chart defaults
  and the live Prometheus CR must be inspected at live activation; the label alone is
  not proof of namespace discovery.
- `grafana-dashboards.yaml` documents cross-namespace sidecar discovery by
  `grafana_dashboard: "1"`; the generated ConfigMaps use that convention.
  Choose the Prometheus datasource using the dashboard's datasource picker.

## SLO arithmetic and missing evidence

Both SLIs record 5m, 30m, 1h, 2h, 6h, 1d and 3d bad fractions. Availability is
5xx/all; latency is `1 - bucket(le="0.5")/count`. The availability zero-failure
fallback is `0 *` the same tenant denominator. Each ratio requires denominator
`> 0`. Missing/idle traffic produces no ratio, never a fabricated perfect SLO;
a missing latency bucket cannot become zero latency failures.

| Budget fraction / long window | Burn | Paired windows | Severity / destination |
|---|---|---|---|
| 2% / 1h | 14.4 | 5m AND 1h | critical / page |
| 5% / 6h | 6 | 30m AND 6h | critical / page |
| 10% / 1d | 3 | 2h AND 1d | warning / hourly board |
| 10% / 3d | 1 | 6h AND 3d | warning / hourly board |

Use strict `>` against `ratio / (1 - objective)` in both windows; either paired
arm can fire. Fast burn has `for: 2m`, slow burn `for: 15m`, as in the lab.
Request absence, missing latency count/bucket and zero traffic are distinct
warning diagnostics with 15m startup grace. Absence follows Prometheus staleness
semantics; it cannot detect a dead Prometheus or a rule that was never loaded.
Inherited platform absence checks and the live activation rule-discovery drill cover that
boundary. Long-window recordings can still describe earlier traffic after raw
series go stale; the missing-telemetry diagnostic must be considered with them.

The dashboard shows rate/volume, error ratio, trailing-3d budget estimate, every
availability burn window, latency p50/p95/p99 and bad fraction, and pod restarts.
It labels missing observations and the limited budget window. Seven-day
retention cannot prove 30-day compliance; low-volume priors remain priors.

## Activation and two-tier routing

Availability burn and telemetry diagnostic alerts are enabled in the generated
rules now that the runbook stage's runbook bodies exist. Every `runbook_url` resolves to
the absolute main-branch URL for `slo-burn.md` or `telemetry-missing.md`.
Live activation owns authorized deployment,
selector/discovery verification and page/board delivery drills. Offline enabling
of expressions is not evidence of live alert delivery (ADR-0012).

Latency burn alerts are additionally in `staged/`, excluded from default
bundles. Live activation must observe **real user traffic**, measure its latency
distribution, verify count and threshold-bucket series, and review the latency
objective before removing their gate and including that environment's staged
bundle. An earlier lab decision explicitly declined probe-only latency alerts. Latency recordings
and dashboard output are available now; no p99 paging rule is introduced.

Routing inherits the platform: `critical` pages; `warning` goes to the null
receiver and is read by the hourly status board. No per-tenant Alertmanager
receiver, notify tier, ntfy topic or credential is generated. The board's own
health monitoring remains a platform dependency. Cluster silences are not
honored by the inherited board because it reads Prometheus ALERTS.

## Optional application metrics

Both default bundles exclude `optional/`. Only for a tenant that actually
serves `/metrics`, add `../../base/observe/optional` to dev overlay resources,
or `../../base/observe/prod/optional` to prod overlay resources. Before inclusion,
provide a Service in that namespace labelled `app.kubernetes.io/name: TENANT`
and `golden-path/metrics: enabled`, with a port **named `metrics`** targeting the
verified application endpoint. The ServiceMonitor uses `/metrics`, a 30s scrape
interval and a 10s timeout. Confirm the guard stage networking allows the monitoring
scrape. Static nginx needs none of this: its SLIs use controller metrics.

## Offline checks and proposed promtool execution

Run `node --test test/gp-observe.test.mjs`, `node --test`, `make verify` and
`node scripts/check-links.mjs docs`. Generate with `bin/gp new fixture --kind
static --app-repo <scratch>/app --gitops <scratch>/gitops`; node fixtures use
the same observe contract. Run `kustomize build` independently on the rendered
root, `prod/`, both `optional/` and both `staged/` bundles. Use the resulting
resources with the actual gitops Kyverno policy and offline Trivy. Gate evidence
must distinguish unsupported CRDs / no matching policies from actual validation.

`promtool` is absent locally. The generated `tests/*.yaml` files propose an
executable suite for an environment where it is already available:

```sh
cd <rendered-tenant>/base/observe/tests
promtool check rules production-rules.yaml candidate-alert-rules.yaml
promtool test rules production.test.yaml candidate.test.yaml
```

Production rule files are exact `spec.groups` extractions, including excluded
latency rules to test their gates. Candidate rule files remove **only** the
gate and contain alerts only, allowing isolated recording-sample injection for
every burn arm. Never deploy candidate test rules. Suites cover all arm pairs,
below/above and short-only/long-only conditions, real counter ratios, resets,
cross-tenant isolation, both namespace-label conventions, idle traffic, missing
histograms, absence/startup grace, enabled availability/diagnostic rules and staged latency gates. They have not been run
by promtool; Node's expression checks are not a PromQL-engine substitute.



## Publication decision — 2026-10-19

All generated `runbook_url` annotations
use `https://github.com/leemarkus/k8s-golden-path/blob/main/docs/runbooks/`
plus an indexed filename. `generate.mjs` owns this base; regenerate with
`node templates/observe/generate.mjs` and check with `--check`. Repository publication no longer
blocks the runbook URL choice. Live activation still needs live reachability and routing proof.
