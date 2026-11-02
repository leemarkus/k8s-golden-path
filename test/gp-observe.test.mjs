import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { generatedFiles } from '../templates/observe/generate.mjs';
import { render } from '../src/render.mjs';
import { repoRoot } from '../src/scaffold.mjs';

const values = { tenant: 'fixture', slo_availability: 0.995, slo_latency: 0.99, slo_latency_seconds: 0.5 };
const windows = ['5m', '30m', '1h', '2h', '6h', '1d', '3d'];
const sources = generatedFiles();
const parse = (file, overrides = {}) => JSON.parse(render(sources[file], { ...values, ...overrides }));
const rules = resource => resource.spec.groups.flatMap(g => g.rules);
const main = env => env === 'dev' ? 'prometheusrule-slo.yaml.tmpl' : 'prod/prometheusrule-slo.yaml.tmpl';
const staged = env => env === 'dev' ? 'staged/prometheusrule-latency.yaml.tmpl' : 'prod/staged/prometheusrule-latency.yaml.tmpl';
const burn = alert => /(?:Fast|Slow)Burn$/.test(alert.alert ?? '');
const gate = ' and on() (vector(0) == 1)';

test('checked-in templates match the single authoring implementation and parse as JSON-subset YAML', () => {
  for (const [name, expected] of Object.entries(sources)) {
    assert.equal(fs.readFileSync(path.join(repoRoot, 'templates/observe', name), 'utf8'), expected, name);
    const result = parse(name);
    assert.ok(result && typeof result === 'object', name);
    assert.ok(!render(expected, values).includes('{{'), name);
  }
});

test('gp new renders both fixture kinds without extending the placeholder contract', t => {
  fs.mkdirSync(path.join(repoRoot, '.gp-tmp'), { recursive: true });
  const scratch = fs.mkdtempSync(path.join(repoRoot, '.gp-tmp/observe-test-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  for (const kind of ['static', 'node']) {
    const target = path.join(scratch, kind);
    const args = ['new', 'fixture', '--kind', kind, '--app-repo', path.join(target, 'app'), '--gitops', path.join(target, 'gitops')];
    const dry = spawnSync(path.join(repoRoot, 'bin/gp'), [...args, '--dry-run'], { encoding: 'utf8' });
    assert.equal(dry.status, 0, dry.stderr);
    assert.ok(!fs.existsSync(target));
    const result = spawnSync(path.join(repoRoot, 'bin/gp'), args, { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const observe = path.join(target, 'gitops/clusters/homelab/tenants/fixture/base/observe');
    for (const name of Object.keys(sources)) {
      const output = fs.readFileSync(path.join(observe, name.replace(/\.tmpl$/, '')), 'utf8');
      assert.equal(output, render(sources[name], values));
      JSON.parse(output);
    }
  }
});

// This table re-derives the lab arithmetic from fractions of a 30-day budget,
// independently of the generator's multipliers. Evaluate the actual expression
// after substituting recording samples; this is not a PromQL engine claim.
const budgetWindows = [
  { fraction: 0.02, hours: 1, short: '5m', long: '1h', speed: 'Fast', ratio: 0.072 },
  { fraction: 0.05, hours: 6, short: '30m', long: '6h', speed: 'Fast', ratio: 0.03 },
  { fraction: 0.10, hours: 24, short: '2h', long: '1d', speed: 'Slow', ratio: 0.015 },
  { fraction: 0.10, hours: 72, short: '6h', long: '3d', speed: 'Slow', ratio: 0.005 },
];
function evaluateBurn(expr, samples) {
  const numeric = expr.replace(gate, '')
    .replace(/gp:slo_error_ratio:rate(5m|30m|1h|2h|6h|1d|3d)\{[^}]+\}/g, (_, window) => String(samples[window] ?? 0))
    .replace(/\band\b/g, '&&').replace(/\bor\b/g, '||');
  assert.match(numeric, /^[\d.()\s/+*>\-&|]+$/);
  return vm.runInNewContext(numeric, Object.create(null), { timeout: 100 });
}
test('every burn threshold is derived from slo_availability (and slo_latency), with both windows required', () => {
  for (const objective of [0.995, 0.99, 0.97, 0.999]) {
    for (const env of ['dev', 'prod']) for (const slo of ['availability', 'latency']) {
      const resource = parse(slo === 'availability' ? main(env) : staged(env), { [`slo_${slo}`]: objective });
      for (const alert of rules(resource).filter(burn)) {
        const speed = alert.alert.includes('Fast') ? 'Fast' : 'Slow';
        const pairs = budgetWindows.filter(w => w.speed === speed);
        const expectedArms = pairs.map(({ fraction, hours, short, long, ratio }) => {
          const multiplier = fraction * (30 * 24) / hours;
          const threshold = (1 - objective) * multiplier;
          if (objective === 0.995) assert.ok(Math.abs(threshold - ratio) < 1e-12);
          for (const [shortHigh, longHigh] of [[false, false], [true, false], [false, true], [true, true]]) {
            assert.equal(evaluateBurn(alert.expr, {
              [short]: threshold * (shortHigh ? 1.001 : 0.999),
              [long]: threshold * (longHigh ? 1.001 : 0.999),
            }), shortHigh && longHigh, `${env} ${slo} ${objective} ${short}/${long}`);
          }
          return `(${[short, long].map(w => `(gp:slo_error_ratio:rate${w}{tenant="fixture",env="${env}",slo="${slo}"} / (1 - ${objective}) > ${multiplier})`).join(' and ')})`;
        });
        assert.equal(alert.expr, `(${expectedArms.join(' or ')})${slo === 'latency' ? gate : ''}`);
        assert.equal(alert.for, speed === 'Fast' ? '2m' : '15m');
        assert.equal(alert.labels.severity, speed === 'Fast' ? 'critical' : 'warning');
      }
    }
  }
});

test('recordings isolate ingress and tenant/env, scope zero fallback to a positive denominator, and preserve missing histograms', () => {
  for (const env of ['dev', 'prod']) {
    const resource = parse(main(env));
    assert.equal(resource.metadata.namespace, `fixture-${env}`);
    assert.equal(resource.metadata.labels.release, 'kube-prometheus-stack');
    const recordings = rules(resource).filter(r => r.record);
    assert.equal(recordings.length, 14);
    for (const slo of ['availability', 'latency']) for (const window of windows) {
      const r = recordings.find(r => r.labels.slo === slo && r.record.endsWith(`rate${window}`));
      assert.deepEqual(r.labels, { tenant: 'fixture', env, namespace: `fixture-${env}`, slo });
      const selectors = [...r.expr.matchAll(/nginx_ingress_controller_[a-z_]+\{([^}]+)\}\[([^\]]+)\]/g)];
      assert.ok(selectors.length > 0);
      for (const [, selector, range] of selectors) {
        assert.equal(range, window);
        assert.ok(selector.startsWith(`exported_namespace="fixture-${env}",ingress="fixture"`) || selector.startsWith(`namespace="fixture-${env}",exported_namespace="",ingress="fixture"`), selector);
      }
      assert.match(r.expr, /\) and \(sum\(.+\) > 0\)$/);
      assert.doesNotMatch(r.expr, /vector\(0\)|clamp_min/);
      if (slo === 'availability') {
        assert.match(r.expr, /status=~"5\.\."/);
        assert.match(r.expr, / or \(0 \* sum\(rate\(nginx_ingress_controller_requests\{/);
      } else {
        assert.match(r.expr, /^\(1 - /);
        assert.match(r.expr, /_bucket\{[^}]+le="0\.5"/);
        assert.match(r.expr, /_count\{/);
        assert.doesNotMatch(r.expr, /0 \*|or vector/);
      }
    }
    for (const diagnostic of rules(resource).filter(r => r.alert && !burn(r))) {
      assert.equal(diagnostic.for, '15m');
      assert.equal(diagnostic.labels.severity, 'warning');
      if (/Missing$/.test(diagnostic.alert)) assert.match(diagnostic.expr, /absent\(.+ and on\(\) absent\(/);
      else assert.match(diagnostic.expr, /== 0\)/);
    }
  }
});

test('every alert has two-tier labels, useful annotations, a published exact runbook name and only latency burns gated', () => {
  const index = fs.readFileSync(path.join(repoRoot, 'docs/runbooks/README.md'), 'utf8');
  const planned = [...index.matchAll(/\[([a-z-]+\.md)\]\(/g)].map(m => m[1]);
  for (const env of ['dev', 'prod']) for (const file of [main(env), staged(env)]) {
    for (const alert of rules(parse(file)).filter(r => r.alert)) {
      assert.equal(alert.labels.tenant, 'fixture');
      assert.equal(alert.labels.env, env);
      assert.ok(['critical', 'warning'].includes(alert.labels.severity));
      assert.ok(alert.annotations.summary.includes(`fixture-${env}`));
      assert.ok(alert.annotations.description.length > 60);
      assert.match(alert.annotations.runbook_url, /^https:\/\/github\.com\/leemarkus\/k8s-golden-path\/blob\/main\/docs\/runbooks\/[a-z-]+\.md$/);
      assert.ok(planned.includes(path.basename(alert.annotations.runbook_url)));
      assert.ok(fs.statSync(path.join(repoRoot, 'docs/runbooks', path.basename(alert.annotations.runbook_url))).isFile());
      assert.equal(alert.expr.endsWith(gate), file === staged(env));
      assert.match(alert.annotations.activation, file === staged(env) ? /DISABLED/ : /ENABLED/);
    }
  }
});

test('published runbook bodies are mandatory and contain operational sections', () => {
  const names = ['slo-burn.md', 'telemetry-missing.md'];
  const missing = names.filter(name => !fs.existsSync(path.join(repoRoot, 'docs/runbooks', name)));
  assert.deepEqual(missing, []);
  for (const name of names) {
    const body = fs.readFileSync(path.join(repoRoot, 'docs/runbooks', name), 'utf8');
    for (const section of ['Trigger', 'Impact', 'Read-only diagnosis', 'Remediation', 'Rollback', 'Verify', 'Escalation']) assert.ok(body.includes(section), `${name}: ${section}`);
  }
});

test('dashboard uses sidecar discovery, unique filenames, scoped queries and honest budget/no-data units', () => {
  for (const env of ['dev', 'prod']) {
    const cm = parse(`${env === 'dev' ? '' : 'prod/'}dashboard-configmap.yaml.tmpl`);
    assert.equal(cm.metadata.labels.grafana_dashboard, '1');
    assert.equal(cm.metadata.namespace, `fixture-${env}`);
    assert.deepEqual(Object.keys(cm.data), [`fixture-${env}-slo.json`]);
    const dashboard = JSON.parse(Object.values(cm.data)[0]);
    assert.equal(dashboard.editable, false);
    assert.ok(dashboard.panels.length >= 6);
    for (const panel of dashboard.panels) for (const target of panel.targets) {
      assert.doesNotMatch(target.expr, /or vector\(0\)/);
      assert.equal(panel.fieldConfig.defaults.noValue, 'No observation');
      assert.ok(target.expr.includes(`fixture-${env}`) || target.expr.includes(`tenant="fixture",env="${env}"`));
    }
    const budget = dashboard.panels.find(p => p.title.startsWith('Budget'));
    assert.match(budget.title, /trailing 3d/);
    assert.match(budget.description, /Not a 30-day compliance claim/);
    assert.match(budget.targets[0].expr, /rate3d.+\/ \(1 - 0\.995\)$/);
    const latency = dashboard.panels.find(p => p.title.includes('p50'));
    assert.deepEqual(latency.targets.map(t => t.legendFormat), ['p50', 'p95', 'p99']);
  }
});

test('dev/prod bundles never load the other env, optional ServiceMonitor or staged latency alerts', () => {
  for (const env of ['dev', 'prod']) {
    const prefix = env === 'dev' ? '' : 'prod/';
    const bundle = parse(`${prefix}kustomization.yaml.tmpl`);
    assert.deepEqual(bundle.resources, ['prometheusrule-slo.yaml', 'dashboard-configmap.yaml']);
    const monitor = parse(`${prefix}optional/servicemonitor.yaml.tmpl`);
    assert.equal(monitor.metadata.labels.release, 'kube-prometheus-stack');
    assert.deepEqual(monitor.spec.namespaceSelector.matchNames, [`fixture-${env}`]);
    assert.deepEqual(monitor.spec.selector.matchLabels, { 'app.kubernetes.io/name': 'fixture', 'golden-path/metrics': 'enabled' });
    assert.equal(monitor.spec.endpoints[0].port, 'metrics');
    assert.equal(monitor.spec.endpoints[0].path, '/metrics');
    assert.ok(rules(parse(main(env))).filter(r => r.alert).every(r => !/Latency.*Burn$/.test(r.alert)));
  }
});

test('proposed promtool rules are exact extractions, candidates remove only the activation gate', () => {
  const production = parse('tests/production-rules.yaml.tmpl');
  const expected = ['dev', 'prod'].flatMap(env => [parse(main(env)), parse(staged(env))]).flatMap(r => r.spec.groups);
  assert.deepEqual(production.groups, expected);
  const candidates = parse('tests/candidate-alert-rules.yaml.tmpl');
  assert.deepEqual(candidates.groups, expected.map(g => ({ ...g, rules: g.rules.filter(r => r.alert).map(r => ({ ...r, expr: r.expr.replace(gate, '') })) })).filter(g => g.rules.length));
  const cases = parse('tests/candidate.test.yaml.tmpl').tests;
  assert.ok(cases.length >= 66);
  for (const arm of budgetWindows) {
    for (const env of ['dev', 'prod']) for (const slo of ['availability', 'latency']) for (const scenario of ['below', 'short-only', 'long-only', 'both']) {
      const example = cases.find(t => t.name === `${env} ${slo} ${arm.short}/${arm.long} ${scenario}`);
      assert.ok(example);
      assert.equal(example.alert_rule_test[0].exp_alerts.length, scenario === 'both' ? 1 : 0);
    }
  }
});
