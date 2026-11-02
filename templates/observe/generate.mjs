#!/usr/bin/env node
const RUNBOOK_BASE = 'https://github.com/leemarkus/k8s-golden-path/blob/main/docs/runbooks/';
// Authoring helper, not a gp renderer extension. Commit its deterministic .tmpl output.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const tenant = '{{tenant}}';
const windows = ['5m', '30m', '1h', '2h', '6h', '1d', '3d'];
const objectives = { availability: '{{slo_availability}}', latency: '{{slo_latency}}' };
const disabled = 'and on() (vector(0) == 1)';
const arms = {
  Fast: [[14.4, '5m', '1h'], [6, '30m', '6h']],
  Slow: [[3, '2h', '1d'], [1, '6h', '3d']],
};
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const labels = (env, slo) => ({ tenant, env, namespace: `${tenant}-${env}`, slo });
const select = (env, extra = '') => [
  `exported_namespace="${tenant}-${env}",ingress="${tenant}"${extra}`,
  `namespace="${tenant}-${env}",exported_namespace="",ingress="${tenant}"${extra}`,
];
const metric = (name, env, extra = '') => select(env, extra).map(s => `${name}{${s}}`);
const rate = (name, env, window, extra = '') =>
  `sum(${metric(name, env, extra).map(s => `rate(${s}[${window}])`).join(' or ')})`;
const absent = (name, env, extra = '') =>
  `sum(${metric(name, env, extra).map(s => `absent(${s})`).join(' and on() ')})`;
const request = 'nginx_ingress_controller_requests';
const duration = 'nginx_ingress_controller_request_duration_seconds';
const record = window => `gp:slo_error_ratio:rate${window}`;
const recorded = (env, slo, window) => `${record(window)}{tenant="${tenant}",env="${env}",slo="${slo}"}`;

function recordings(env, slo) {
  return windows.map(window => {
    const total = rate(slo === 'availability' ? request : `${duration}_count`, env, window);
    const bad = slo === 'availability'
      ? `(${rate(request, env, window, ',status=~"5.."')} or (0 * ${total})) / ${total}`
      : `1 - ${rate(`${duration}_bucket`, env, window, ',le="{{slo_latency_seconds}}"')} / ${total}`;
    return { record: record(window), expr: `(${bad}) and (${total} > 0)`, labels: labels(env, slo) };
  });
}
function burnAlerts(env, slo) {
  return Object.entries(arms).map(([speed, pairs]) => ({
    alert: `GoldenPath${slo === 'availability' ? 'Availability' : 'Latency'}${speed}Burn`,
    expr: `(${pairs.map(([multiplier, short, long]) =>
      `(${[short, long].map(window => `(${recorded(env, slo, window)} / (1 - ${objectives[slo]}) > ${multiplier})`).join(' and ')})`
    ).join(' or ')})${slo === 'latency' ? ` ${disabled}` : ''}`,
    for: speed === 'Fast' ? '2m' : '15m',
    labels: { ...labels(env, slo), severity: speed === 'Fast' ? 'critical' : 'warning' },
    annotations: {
      summary: `${tenant}-${env} ${slo} error budget ${speed.toLowerCase()} burn`,
      description: `${slo === 'availability' ? 'Measured ingress 5xx fraction' : 'Measured fraction slower than {{slo_latency_seconds}}s'} exceeds paired ${pairs.map(([m, s, l]) => `${m}x (${s} AND ${l})`).join(' OR ')} burn thresholds against the nominal 30-day objective ${objectives[slo]}. ${speed === 'Fast' ? 'Critical routes to page.' : 'Warning appears on the hourly status board.'} Low volume is a prior, not a fitted target; absent or zero traffic is not success. Check telemetry diagnostics.`,
      runbook_url: `${RUNBOOK_BASE}slo-burn.md`,
      activation: slo === 'availability'
        ? 'ENABLED: repository runbook body published by the runbook stage; live activation verifies live discovery/routing and runbooks use the golden-path repository main-branch URL.'
        : 'DISABLED AND EXCLUDED: additionally require live activation real user traffic, measured latency distribution, verified histogram bucket and reviewed objective (ADR-0011).',
    },
  }));
}
function diagnostics(env) {
  return [
    ['GoldenPathAvailabilityTelemetryMissing', 'availability', absent(request, env),
      'Ingress request counters are missing or stale; availability is unobserved, not healthy. Check ingress existence, scrape discovery, release labels and exported_namespace/namespace selectors.'],
    ['GoldenPathLatencyTelemetryMissing', 'latency', `${absent(`${duration}_count`, env)} or ${absent(`${duration}_bucket`, env, ',le="{{slo_latency_seconds}}"')}`,
      'The latency count or required {{slo_latency_seconds}}s bucket is missing or stale. Latency is unobserved; verify histogram configuration and scraping before activation.'],
    ['GoldenPathNoTraffic', 'availability', `${rate(request, env, '5m')} == 0`,
      'Counters exist but no requests were observed in the trailing 5m for at least 15m. This is no observation, not perfect availability or a measured outage. Check expected traffic and ingress routing.'],
  ].map(([alert, slo, expr, description]) => ({
    alert, expr: `(${expr})`, for: '15m',
    labels: { ...labels(env, slo), severity: 'warning' },
    annotations: {
      summary: `${tenant}-${env}: ${alert.replace('GoldenPath', '')}`,
      description, runbook_url: `${RUNBOOK_BASE}telemetry-missing.md`,
      activation: 'ENABLED: repository runbook body published by the runbook stage; 15m startup grace. live activation verifies live discovery/routing.',
    },
  }));
}
function ruleResource(env, latencyOnly = false) {
  return {
    apiVersion: 'monitoring.coreos.com/v1', kind: 'PrometheusRule',
    metadata: {
      name: `${tenant}-${latencyOnly ? 'latency-staged' : 'slo'}`, namespace: `${tenant}-${env}`,
      labels: { 'app.kubernetes.io/name': tenant, tenant, env, release: 'kube-prometheus-stack' },
      annotations: { 'golden-path/activation': 'Availability and diagnostic rules enabled with repository runbooks; latency burns staged. live activation must verify live discovery/routing. See templates/observe/README.md in golden-path.' },
    },
    spec: { groups: latencyOnly ? [{ name: `${tenant}-${env}-latency-staged`, interval: '30s', rules: burnAlerts(env, 'latency') }] : [
      ...Object.keys(objectives).map(slo => ({ name: `${tenant}-${env}-${slo}`, interval: '30s', rules: recordings(env, slo) })),
      { name: `${tenant}-${env}-availability-alerts`, interval: '30s', rules: [...burnAlerts(env, 'availability'), ...diagnostics(env)] },
    ] },
  };
}

function dashboard(env) {
  const datasource = { type: 'prometheus', uid: '${datasource}' };
  const panel = (id, title, unit, queries, description = '') => ({
    id, title, type: 'timeseries', datasource, description,
    gridPos: { x: ((id - 1) % 2) * 12, y: Math.floor((id - 1) / 2) * 8, w: 12, h: 8 },
    fieldConfig: { defaults: { unit, noValue: 'No observation' }, overrides: [] },
    options: { legend: { displayMode: 'list', placement: 'bottom' } },
    targets: queries.map(([legendFormat, expr], i) => ({ refId: String.fromCharCode(65 + i), expr, legendFormat, datasource })),
  });
  const content = {
    title: `${tenant} / ${env} — SLO and ingress`, tags: ['golden-path', tenant, env],
    editable: false, schemaVersion: 39, version: 1, refresh: '1m', timezone: 'browser',
    time: { from: 'now-6h', to: 'now' },
    description: 'Availability 99.5% and latency 99% within 0.5s are initial priors. Latency burn alerts are staged. Seven-day retention cannot establish 30-day compliance; empty SLI panels mean no observation.',
    templating: { list: [{ name: 'datasource', label: 'Prometheus', type: 'datasource', query: 'prometheus', refresh: 1 }] },
    panels: [
      panel(1, 'Request rate (5m) — zero is no traffic', 'reqps', [['requests/s', rate(request, env, '5m')]], 'Low traffic and missing data remain visible; no zero-fill of absent telemetry.'),
      panel(2, 'Availability error ratio (5m)', 'percentunit', [['5xx / all', recorded(env, 'availability', '5m')]]),
      panel(3, 'Budget remaining — trailing 3d estimate', 'percentunit', [['remaining', `1 - ${recorded(env, 'availability', '3d')} / (1 - {{slo_availability}})`]], 'Fraction of the permitted bad-request ratio remaining over available trailing 3d samples. Not a 30-day compliance claim. Negative values mean this window exceeds the objective; partial history and missing traffic are not success.'),
      panel(4, 'Availability burn rates', 'none', windows.map(w => [w, `${recorded(env, 'availability', w)} / (1 - {{slo_availability}})`]), 'Page candidates: 14.4x at 5m AND 1h, or 6x at 30m AND 6h. Status: 3x at 2h AND 1d, or 1x at 6h AND 3d. Availability alerts use the published repository runbooks; live routing requires live activation proof.'),
      panel(5, 'Ingress latency p50 / p95 / p99', 's', [0.5, 0.95, 0.99].map(q => [`p${q * 100}`, `histogram_quantile(${q}, sum by (le) (${metric(`${duration}_bucket`, env).map(s => `rate(${s}[5m])`).join(' or ')})) and on() (${rate(`${duration}_count`, env, '5m')} > 0)`]), 'Observed histogram quantiles only; latency paging is unactivated under ADR-0011.'),
      panel(6, 'Pod restarts (1h)', 'short', [['restarts', `sum(increase(kube_pod_container_status_restarts_total{namespace="${tenant}-${env}",pod=~"${tenant}-.+"}[1h]))`]], 'Deployment pods in this tenant namespace; empty is missing kube-state-metrics, not zero.'),
      panel(7, 'Latency bad fraction (5m) — alerts staged', 'percentunit', [['slower than {{slo_latency_seconds}}s', recorded(env, 'latency', '5m')]]),
      panel(8, 'Requests observed (5m)', 'short', [['requests', `sum(${metric(request, env).map(s => `increase(${s}[5m])`).join(' or ')})`]], 'A few requests can dominate short-window ratios. Always inspect the paired long window.'),
    ],
  };
  return {
    apiVersion: 'v1', kind: 'ConfigMap',
    metadata: { name: `${tenant}-slo-dashboard`, namespace: `${tenant}-${env}`, labels: { 'app.kubernetes.io/name': tenant, tenant, env, grafana_dashboard: '1' } },
    data: { [`${tenant}-${env}-slo.json`]: json(content) },
  };
}
function monitor(env) {
  return {
    apiVersion: 'monitoring.coreos.com/v1', kind: 'ServiceMonitor',
    metadata: { name: `${tenant}-metrics`, namespace: `${tenant}-${env}`, labels: { 'app.kubernetes.io/name': tenant, tenant, env, release: 'kube-prometheus-stack' } },
    spec: {
      // Empty selector scope means this ServiceMonitor's own namespace only.
      namespaceSelector: { matchNames: [`${tenant}-${env}`] },
      selector: { matchLabels: { 'app.kubernetes.io/name': tenant, 'golden-path/metrics': 'enabled' } },
      endpoints: [{ port: 'metrics', path: '/metrics', interval: '30s', scrapeTimeout: '10s', honorLabels: false }],
    },
  };
}
const kustomization = resources => ({ apiVersion: 'kustomize.config.k8s.io/v1beta1', kind: 'Kustomization', resources });

// Promtool inputs are YAML's JSON subset too. Kept outside all Kustomizations.
function promtoolFiles(resources) {
  const productionGroups = resources.flatMap(r => r.spec.groups);
  const candidateGroups = productionGroups.map(g => ({ ...g,
    rules: g.rules.filter(r => r.alert).map(r => ({ ...r, expr: r.expr.replace(` ${disabled}`, '') })),
  })).filter(g => g.rules.length);
  const tests = [];
  // Independent budget fractions and hours derive the four burn multipliers.
  const budgetArms = [[0.02, 1, '5m', '1h', 'Fast'], [0.05, 6, '30m', '6h', 'Fast'], [0.10, 24, '2h', '1d', 'Slow'], [0.10, 72, '6h', '3d', 'Slow']];
  for (const env of ['dev', 'prod']) for (const slo of Object.keys(objectives)) {
    for (const [fraction, hours, short, long, speed] of budgetArms) {
      const multiplier = fraction * (30 * 24) / hours;
      const alert = candidateGroups.flatMap(g => g.rules).find(r => r.alert === `GoldenPath${slo === 'availability' ? 'Availability' : 'Latency'}${speed}Burn` && r.labels.env === env);
      // Values are promtool sample numbers, so compute from the contract priors.
      const threshold = (1 - (slo === 'availability' ? 0.995 : 0.99)) * multiplier;
      for (const scenario of ['below', 'short-only', 'long-only', 'both']) {
        const high = threshold * 1.01;
        const low = threshold * 0.99;
        const values = { [short]: scenario === 'long-only' || scenario === 'below' ? low : high, [long]: scenario === 'short-only' || scenario === 'below' ? low : high };
        tests.push({
          name: `${env} ${slo} ${short}/${long} ${scenario}`, interval: '1m',
          input_series: Object.entries(values).map(([w, value]) => ({ series: recorded(env, slo, w), values: `${value}+0x20` })),
          alert_rule_test: [{ eval_time: '20m', alertname: alert.alert, exp_alerts: scenario === 'both' ? [{ exp_labels: alert.labels, exp_annotations: alert.annotations }] : [] }],
        });
      }
    }
  }
  const productionTests = [];
  for (const env of ['dev', 'prod']) {
    for (const style of ['exported', 'native']) {
      const selector = style === 'exported' ? `namespace="ingress-nginx",exported_namespace="${tenant}-${env}",ingress="${tenant}"` : `namespace="${tenant}-${env}",ingress="${tenant}"`;
      productionTests.push({
        name: `${env} ${style}: healthy tenant ignores foreign errors`, interval: '1m',
        input_series: [
          { series: `${request}{${selector},status="200"}`, values: '0+100x20' },
          { series: `${duration}_count{${selector}}`, values: '0+100x20' },
          { series: `${duration}_bucket{${selector},le="{{slo_latency_seconds}}"}`, values: '0+100x20' },
          { series: `${request}{namespace="${tenant}-${env}",exported_namespace="foreign-${env}",ingress="${tenant}",status="500"}`, values: '0+10000x20' },
          { series: `${request}{namespace="ingress-nginx",exported_namespace="${tenant}-${env}",ingress="foreign",status="500"}`, values: '0+10000x20' },
        ],
        promql_expr_test: Object.keys(objectives).flatMap(slo => windows.map(w => ({ expr: recorded(env, slo, w), eval_time: '20m', exp_samples: [{ labels: `${record(w)}{tenant="${tenant}",env="${env}",namespace="${tenant}-${env}",slo="${slo}"}`, value: 0 }] }))),
      });
    }
    productionTests.push({
      name: `${env}: idle counters produce no ratio`, interval: '1m',
      input_series: [request, `${duration}_count`, `${duration}_bucket`].map(name => ({ series: `${name}{namespace="ingress-nginx",exported_namespace="${tenant}-${env}",ingress="${tenant}"${name.endsWith('_bucket') ? ',le="{{slo_latency_seconds}}"' : ''}}`, values: '0+0x20' })),
      promql_expr_test: Object.keys(objectives).flatMap(slo => windows.map(w => ({ expr: recorded(env, slo, w), eval_time: '20m', exp_samples: [] }))),
    });
    productionTests.push({
      name: `${env}: measured failures and counter reset activate availability while latency stays gated`, interval: '1m',
      input_series: [
        [request, ',status="200"', '0+80x10 0+80x9'],
        [request, ',status="503"', '0+20x10 0+20x9'],
        [`${duration}_count`, '', '0+100x10 0+100x9'],
        [`${duration}_bucket`, ',le="{{slo_latency_seconds}}"', '0+80x10 0+80x9'],
      ].map(([name, extra, values]) => ({ series: `${name}{namespace="ingress-nginx",exported_namespace="${tenant}-${env}",ingress="${tenant}"${extra}}`, values })),
      promql_expr_test: Object.keys(objectives).flatMap(slo => windows.map(w => ({ expr: recorded(env, slo, w), eval_time: '20m', exp_samples: [{ labels: `${record(w)}{tenant="${tenant}",env="${env}",namespace="${tenant}-${env}",slo="${slo}"}`, value: 0.2 }] }))),
      alert_rule_test: ['Availability', 'Latency'].flatMap(slo => ['Fast', 'Slow'].map(speed => ({ eval_time: '20m', alertname: `GoldenPath${slo}${speed}Burn`, exp_alerts: slo === 'Availability' ? productionGroups.flatMap(g => g.rules).filter(r => r.alert === `GoldenPath${slo}${speed}Burn` && r.labels.env === env).map(r => ({ exp_labels: r.labels, exp_annotations: r.annotations })) : [] }))),
    });
  }
  const allAlerts = [...new Set(candidateGroups.flatMap(g => g.rules.map(r => r.alert)))];
  productionTests.push({ name: 'Missing telemetry fires diagnostics; burns require observations', interval: '1m', input_series: [],
    alert_rule_test: allAlerts.map(alertname => ({ eval_time: '20m', alertname, exp_alerts: /TelemetryMissing$/.test(alertname) ? productionGroups.flatMap(g => g.rules).filter(r => r.alert === alertname).map(r => ({ exp_labels: r.labels, exp_annotations: r.annotations })) : [] })) });
  for (const alertname of ['GoldenPathAvailabilityTelemetryMissing', 'GoldenPathLatencyTelemetryMissing']) {
    const matching = candidateGroups.flatMap(g => g.rules).filter(r => r.alert === alertname);
    tests.push({ name: `${alertname}: startup grace and absent telemetry`, interval: '1m', input_series: [],
      alert_rule_test: [
        { eval_time: '14m', alertname, exp_alerts: [] },
        { eval_time: '16m', alertname, exp_alerts: matching.map(r => ({ exp_labels: r.labels, exp_annotations: r.annotations })) },
      ] });
  }
  const noTraffic = candidateGroups.flatMap(g => g.rules).filter(r => r.alert === 'GoldenPathNoTraffic');
  tests.push({ name: 'Idle counters report no observation after grace', interval: '1m',
    input_series: ['dev', 'prod'].map(env => ({ series: `${request}{namespace="ingress-nginx",exported_namespace="${tenant}-${env}",ingress="${tenant}"}`, values: '0+0x20' })),
    alert_rule_test: [{ eval_time: '20m', alertname: 'GoldenPathNoTraffic', exp_alerts: noTraffic.map(r => ({ exp_labels: r.labels, exp_annotations: r.annotations })) }],
  });
  const missingBucket = candidateGroups.flatMap(g => g.rules).find(r => r.alert === 'GoldenPathLatencyTelemetryMissing' && r.labels.env === 'dev');
  tests.push({ name: 'Missing dev latency bucket cannot be hidden by prod histogram', interval: '1m',
    input_series: [
      ...['dev', 'prod'].map(env => ({ series: `${duration}_count{namespace="ingress-nginx",exported_namespace="${tenant}-${env}",ingress="${tenant}"}`, values: '0+100x20' })),
      { series: `${duration}_bucket{namespace="ingress-nginx",exported_namespace="${tenant}-prod",ingress="${tenant}",le="{{slo_latency_seconds}}"}`, values: '0+100x20' },
    ],
    alert_rule_test: [{ eval_time: '16m', alertname: 'GoldenPathLatencyTelemetryMissing', exp_alerts: [{ exp_labels: missingBucket.labels, exp_annotations: missingBucket.annotations }] }],
  });
  return {
    'tests/production-rules.yaml.tmpl': json({ groups: productionGroups }),
    'tests/candidate-alert-rules.yaml.tmpl': json({ groups: candidateGroups }),
    'tests/production.test.yaml.tmpl': json({ rule_files: ['production-rules.yaml'], evaluation_interval: '30s', fuzzy_compare: true, tests: productionTests }),
    'tests/candidate.test.yaml.tmpl': json({ rule_files: ['candidate-alert-rules.yaml'], evaluation_interval: '30s', fuzzy_compare: true, tests }),
  };
}

export function generatedFiles() {
  const files = {};
  const rules = [];
  for (const env of ['dev', 'prod']) {
    // Root is the dev bundle. A sibling prod bundle avoids unsupported {{env}}.
    const prefix = env === 'dev' ? '' : 'prod/';
    const main = ruleResource(env);
    const latency = ruleResource(env, true);
    rules.push(main, latency);
    files[`${prefix}prometheusrule-slo.yaml.tmpl`] = json(main);
    files[`${prefix}dashboard-configmap.yaml.tmpl`] = json(dashboard(env));
    files[`${prefix}kustomization.yaml.tmpl`] = json(kustomization(['prometheusrule-slo.yaml', 'dashboard-configmap.yaml']));
    files[`${prefix}staged/prometheusrule-latency.yaml.tmpl`] = json(latency);
    files[`${prefix}staged/kustomization.yaml.tmpl`] = json(kustomization(['prometheusrule-latency.yaml']));
    files[`${prefix}optional/servicemonitor.yaml.tmpl`] = json(monitor(env));
    files[`${prefix}optional/kustomization.yaml.tmpl`] = json(kustomization(['servicemonitor.yaml']));
  }
  return { ...files, ...promtoolFiles(rules) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  for (const [name, text] of Object.entries(generatedFiles())) {
    const file = path.join(root, name);
    if (check) {
      if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) throw new Error(`Regenerate ${name}: node templates/observe/generate.mjs`);
    } else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    }
  }
  console.log(`Observe templates: ${Object.keys(generatedFiles()).length} ${check ? 'checked' : 'generated'}`);
}
