import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { repoRoot } from '../src/scaffold.mjs';
import { available, policyPassed, configScanned, schemaSummary, verify } from '../src/verify.mjs';

const policy = path.join(process.env.GP_GITOPS_REFERENCE ?? path.resolve(repoRoot, '../gitops'), 'clusters/homelab/config/kyverno-policies.yaml');
const run = (command, args, options = {}) => spawnSync(command, args, { encoding: 'utf8', cwd: repoRoot, timeout: 120000, maxBuffer: 16 * 1024 * 1024, ...options });
function checked(command, args, options) {
  const result = run(command, args, options);
  assert.equal(result.status, 0, `${command}: ${result.error ?? ''}\n${result.stderr}\n${result.stdout}`);
  return result.stdout;
}
// Ruby's bundled YAML parser supplies structural assertions without npm packages.
// External tool gates explicitly skip if their local runtime is unavailable.
function yaml(text) {
  return JSON.parse(checked('ruby', ['-ryaml', '-rjson', '-e', 'puts JSON.generate(YAML.load_stream(STDIN.read))'], { input: text }));
}
const prerequisites = ['kustomize', 'ruby'].every(available);
function fixture(t, kind = 'static') {
  const scratch = path.join(repoRoot, '.gp-tmp'); fs.mkdirSync(scratch, { recursive: true });
  const dir = fs.mkdtempSync(path.join(scratch, 'deploy-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const app = path.join(dir, 'app'); const gitops = path.join(dir, 'gitops');
  const args = [path.join(repoRoot, 'bin/gp'), 'new', 'fixture', '--kind', kind, '--app-repo', app, '--gitops', gitops];
  checked(process.execPath, [...args, '--dry-run']);
  assert.equal(fs.existsSync(app), false);
  checked(process.execPath, args);
  return { dir, app, gitops, tenant: path.join(gitops, 'clusters/homelab/tenants/fixture') };
}
const build = dir => checked('kustomize', ['build', dir]);
const ofKind = (docs, kind) => docs.filter(d => d?.kind === kind);

for (const kind of ['static', 'node']) {
  test(`${kind}: real CLI fixtures render both environments with hardening, ownership, network fences and quota headroom`, { skip: !prerequisites }, t => {
    const f = fixture(t, kind);
    const namespaces = yaml(build(path.join(f.gitops, 'clusters/homelab/tenant-namespaces/fixture')));
    assert.equal(namespaces.length, 6);
    for (const env of ['dev', 'prod']) {
      const output = build(path.join(f.tenant, 'overlays', env));
      const docs = yaml(output);
      assert.equal(ofKind(docs, 'Namespace').length, 0);
      assert.equal(ofKind(docs, 'ResourceQuota').length, 0);
      assert.equal(ofKind(docs, 'LimitRange').length, 0);
      assert.equal(ofKind(docs, 'Secret').length, 0);
      assert.equal(ofKind(docs, 'SealedSecret').length, 0);
      assert.ok(docs.every(d => d.metadata.namespace === `fixture-${env}`));
      const deployment = ofKind(docs, 'Deployment')[0];
      assert.equal(deployment.spec.replicas, env === 'dev' ? 1 : 2);
      assert.deepEqual(deployment.spec.selector.matchLabels, { 'app.kubernetes.io/name': 'fixture' });
      const pod = deployment.spec.template.spec; const container = pod.containers[0];
      assert.equal(pod.automountServiceAccountToken, false);
      assert.equal(pod.priorityClassName, 'workload-default');
      assert.equal(pod.securityContext.runAsNonRoot, true);
      assert.equal(pod.securityContext.runAsUser, kind === 'static' ? 101 : 1000);
      assert.equal(pod.securityContext.seccompProfile.type, 'RuntimeDefault');
      assert.equal(container.securityContext.readOnlyRootFilesystem, true);
      assert.equal(container.securityContext.allowPrivilegeEscalation, false);
      assert.deepEqual(container.securityContext.capabilities.drop, ['ALL']);
      assert.deepEqual(pod.imagePullSecrets, [{ name: 'forgejo-registry' }]);
      assert.equal(container.image, 'registry.example.com/apps/fixture:UNRELEASED');
      assert.equal(container.ports[0].containerPort, kind === 'static' ? 8080 : 3000);
      for (const probe of ['readinessProbe', 'livenessProbe']) assert.equal(container[probe].httpGet.path, '/healthz');
      assert.equal(container.volumeMounts[0].mountPath, '/tmp');
      assert.ok(pod.volumes.every(v => v.emptyDir && !v.hostPath));
      const ingress = ofKind(docs, 'Ingress')[0];
      assert.equal(ingress.spec.ingressClassName, 'nginx');
      assert.equal(ingress.spec.rules[0].host, `fixture-${env}.apps.example.com`);
      assert.equal(ingress.spec.tls, undefined); // TLS terminates at NPM, as HQ does.
      // Cross-stage wiring is asserted on actual Kustomize output for both kinds/envs.
      const labels = deployment.spec.template.metadata.labels;
      const service = ofKind(docs, 'Service')[0];
      for (const [key, value] of Object.entries(service.spec.selector)) assert.equal(labels[key], value);
      assert.equal(service.metadata.name, deployment.metadata.name);
      assert.equal(service.metadata.labels['app.kubernetes.io/name'], 'fixture');
      const http = container.ports.find(p => p.name === service.spec.ports[0].targetPort);
      assert.equal(http.containerPort, kind === 'static' ? 8080 : 3000);
      for (const probe of ['readinessProbe', 'livenessProbe']) assert.equal(container[probe].httpGet.port, http.name);
      const backend = ingress.spec.rules[0].http.paths[0].backend.service;
      assert.equal(backend.name, service.metadata.name);
      assert.equal(backend.port.name, service.spec.ports[0].name);
      const dockerfile = fs.readFileSync(path.join(f.app, 'Dockerfile'), 'utf8');
      assert.ok(dockerfile.includes(`EXPOSE ${http.containerPort}`));
      assert.ok(dockerfile.includes(`127.0.0.1:${http.containerPort}${container.readinessProbe.httpGet.path}`));
      const uid = Number(dockerfile.match(/^USER (\d+):\d+$/m)[1]);
      for (const field of ['runAsUser', 'runAsGroup', 'fsGroup']) assert.equal(pod.securityContext[field], uid);
      const appSource = fs.readFileSync(path.join(f.app, kind === 'static' ? 'nginx.conf' : 'server.mjs'), 'utf8');
      assert.ok(appSource.includes(String(http.containerPort)));
      assert.ok(appSource.includes(container.readinessProbe.httpGet.path));
      for (const policy of ofKind(docs, 'NetworkPolicy').filter(p => p.metadata.name !== 'default-deny')) {
        for (const [key, value] of Object.entries(policy.spec.podSelector.matchLabels)) assert.equal(labels[key], value);
      }
      assert.equal(ofKind(docs, 'ServiceMonitor').length, 0);
      const monitor = yaml(build(path.join(f.tenant, 'base/observe', env === 'dev' ? 'optional' : 'prod/optional')))[0];
      assert.equal(monitor.spec.namespaceSelector.matchNames[0], service.metadata.namespace);
      assert.equal(monitor.spec.selector.matchLabels['app.kubernetes.io/name'], service.metadata.labels['app.kubernetes.io/name']);
      assert.equal(monitor.spec.selector.matchLabels['golden-path/metrics'], 'enabled');
      assert.equal(service.metadata.labels['golden-path/metrics'], undefined);
      assert.equal(monitor.spec.endpoints[0].path, '/metrics');
      const monitorPolicy = ofKind(docs, 'NetworkPolicy').find(p => p.metadata.name === 'allow-monitoring-scrape');
      assert.equal(monitor.spec.endpoints[0].port, monitorPolicy.spec.ingress[0].ports[0].port);
      assert.equal(container.ports.some(p => p.name === 'metrics'), false);
      const rules = ofKind(docs, 'PrometheusRule');
      assert.equal(rules.length, 1);
      assert.equal(ofKind(docs, 'ConfigMap').filter(c => c.metadata.labels.grafana_dashboard === '1').length, 1);
      for (const rule of rules[0].spec.groups.flatMap(g => g.rules)) {
        assert.equal(rule.labels.env, env);
        assert.equal(rule.labels.namespace, deployment.metadata.namespace);
        assert.equal(rule.labels.tenant, deployment.metadata.name);
        assert.ok(!rule.expr.includes(`fixture-${env === 'dev' ? 'prod' : 'dev'}`));
        if (rule.alert) {
          assert.doesNotMatch(rule.expr, /vector\(0\)/);
          assert.doesNotMatch(rule.alert, /Latency.*Burn/);
          assert.ok(rule.annotations.runbook_url.startsWith('https://github.com/leemarkus/k8s-golden-path/blob/main/docs/runbooks/'));
          assert.ok(fs.readFileSync(path.join(repoRoot, 'docs/runbooks/README.md'), 'utf8').includes(path.basename(rule.annotations.runbook_url)));
          assert.ok(fs.statSync(path.join(repoRoot, 'docs/runbooks', path.basename(rule.annotations.runbook_url))).isFile());
        }
      }
      const ns = ofKind(namespaces, 'Namespace').find(d => d.metadata.name === `fixture-${env}`);
      for (const mode of ['enforce', 'audit', 'warn']) {
        assert.equal(ns.metadata.labels[`pod-security.kubernetes.io/${mode}`], 'restricted');
        assert.equal(ns.metadata.labels[`pod-security.kubernetes.io/${mode}-version`], 'v1.34');
      }
      const quota = ofKind(namespaces, 'ResourceQuota').find(d => d.metadata.namespace === ns.metadata.name).spec.hard;
      const limits = ofKind(namespaces, 'LimitRange').find(d => d.metadata.namespace === ns.metadata.name).spec.limits[0];
      assert.equal(quota.persistentvolumeclaims, '0');
      assert.equal(quota['limits.cpu'], undefined); assert.equal(limits.default.cpu, undefined);
      assert.equal(container.resources.limits.cpu, undefined);
      const peak = deployment.spec.replicas + deployment.spec.strategy.rollingUpdate.maxSurge;
      assert.equal(pod.containers.length, 1); assert.equal(pod.initContainers, undefined);
      assert.ok(peak <= Number(quota.pods));
      assert.ok(peak * parseInt(container.resources.requests.cpu) <= Number(quota['requests.cpu']) * 1000);
      assert.ok(peak * parseInt(container.resources.requests.memory) <= parseInt(quota['requests.memory']) * 1024);
      assert.ok(peak * parseInt(container.resources.limits.memory) <= parseInt(quota['limits.memory']) * 1024);
      const policies = ofKind(docs, 'NetworkPolicy'); assert.equal(policies.length, 4);
      const deny = policies.find(p => p.metadata.name === 'default-deny').spec;
      assert.deepEqual(deny.podSelector, {}); assert.deepEqual(deny.policyTypes, ['Ingress', 'Egress']);
      assert.equal(deny.ingress, undefined); assert.equal(deny.egress, undefined);
      for (const [name, namespace, port] of [['allow-ingress-controller', 'ingress-nginx', kind === 'static' ? 8080 : 3000], ['allow-monitoring-scrape', 'monitoring', 'metrics']]) {
        const allow = policies.find(p => p.metadata.name === name).spec.ingress[0];
        assert.equal(allow.from.length, 1);
        assert.equal(allow.from[0].namespaceSelector.matchLabels['kubernetes.io/metadata.name'], namespace);
        assert.ok(Object.keys(allow.from[0].podSelector.matchLabels).length);
        assert.equal(allow.ports[0].port, port);
      }
      const egress = policies.flatMap(p => p.spec.egress ?? []); assert.equal(egress.length, 1);
      assert.equal(egress[0].to[0].namespaceSelector.matchLabels['kubernetes.io/metadata.name'], 'kube-system');
      assert.equal(egress[0].to[0].podSelector.matchLabels['k8s-app'], 'kube-dns');
      assert.deepEqual(egress[0].ports, [{ port: 53, protocol: 'UDP' }, { port: 53, protocol: 'TCP' }]);
    }
    assert.match(fs.readFileSync(path.join(f.tenant, 'base/guard/SEALED-SECRET-PLACEHOLDER.md'), 'utf8'), /PLACEHOLDER/);
    // Synthetic digest tests rendering identity only; it is never a claimed release.
    const digest = `sha256:${'a'.repeat(64)}`;
    for (const env of ['dev', 'prod']) {
      const file = path.join(f.tenant, 'overlays', env, 'kustomization.yaml');
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('newTag: UNRELEASED', `newTag: sha-test\n    digest: ${digest}`));
      const image = ofKind(yaml(build(path.dirname(file))), 'Deployment')[0].spec.template.spec.containers[0].image;
      assert.equal(image, `registry.example.com/apps/fixture:sha-test@${digest}`);
    }
  });
}

test('real oracle positive and negative controls separate Audit from Enforce', { skip: !prerequisites || !available('kyverno') || !fs.existsSync(policy) }, t => {
  const f = fixture(t); const resource = path.join(f.dir, 'policy-input.yaml');
  for (const env of ['dev', 'prod']) {
    const rendered = build(path.join(f.tenant, 'overlays', env));
    fs.writeFileSync(resource, rendered);
    const result = run('kyverno', ['apply', policy, '--resource', resource, '--audit-warn']);
    assert.equal(result.status, 0, result.stderr); assert.equal(policyPassed(result.stdout), true, result.stdout);
  }
  const valid = build(path.join(f.tenant, 'overlays/dev'));
  const invalid = valid.replace('registry.example.com/apps/fixture:UNRELEASED', 'registry.example.com/apps/fixture:latest');
  assert.notEqual(invalid, valid);
  // Audit control stays outside tenant Enforce namespaces after first-tenant acceptance.
  fs.writeFileSync(resource, invalid.replaceAll('namespace: fixture-dev', 'namespace: gp-audit-control'));
  const audit = run('kyverno', ['apply', policy, '--resource', resource, '--audit-warn']);
  assert.match(audit.stdout, /fail: 0, warn: [1-9]/); assert.equal(policyPassed(audit.stdout), false);
  // Namespace substitution is an offline control, never applied to HQ.
  fs.writeFileSync(resource, invalid.replaceAll('namespace: fixture-dev', 'namespace: hq-dev'));
  const enforce = run('kyverno', ['apply', policy, '--resource', resource, '--audit-warn']);
  assert.notEqual(enforce.status, 0); assert.match(enforce.stdout, /fail: [1-9]/);
});

test('platform manifests parse and preserve project, discovery, promotion and deletion boundaries', { skip: !prerequisites }, () => {
  const docs = yaml(build(path.join(repoRoot, 'platform')));
  const project = ofKind(docs, 'AppProject')[0]; const set = ofKind(docs, 'ApplicationSet')[0]; const bootstrap = ofKind(docs, 'Application')[0];
  const repo = 'https://git.example.com/platform/gitops.git';
  assert.deepEqual(project.spec.sourceRepos, [repo]);
  assert.deepEqual(project.spec.clusterResourceWhitelist, []);
  assert.deepEqual(project.spec.clusterResourceBlacklist, [{ group: '*', kind: '*' }]);
  assert.deepEqual(project.spec.namespaceResourceBlacklist.map(d => d.kind).sort(), ['LimitRange', 'ResourceQuota']);
  assert.ok(project.spec.destinations.every(d => d.server === 'https://kubernetes.default.svc'));
  assert.deepEqual(project.spec.destinations.filter(d => !d.namespace.startsWith('!')).map(d => d.namespace), ['*-dev', '*-prod']);
  for (const ns of ['hq-dev', 'hq-prod', 'kube-*', 'argocd', 'monitoring', 'default', 'ingress-nginx']) assert.ok(project.spec.destinations.some(d => d.namespace === `!${ns}`));
  assert.equal(set.spec.goTemplate, true); assert.deepEqual(set.spec.goTemplateOptions, ['missingkey=error']);
  assert.equal(set.spec.generators.length, 1);
  const generator = set.spec.generators[0].git;
  assert.equal(generator.repoURL, repo); assert.equal(generator.revision, 'deploy');
  assert.deepEqual(generator.directories.map(d => d.path), ['clusters/homelab/tenants/*/overlays/dev', 'clusters/homelab/tenants/*/overlays/prod']);
  assert.equal(set.spec.template.spec.source.targetRevision, 'deploy');
  assert.equal(set.spec.template.spec.source.repoURL, repo);
  assert.equal(set.spec.template.spec.source.path, '{{ .path.path }}');
  assert.equal(set.spec.template.spec.project, 'tenants');
  assert.equal(set.spec.template.metadata.name, '{{ index .path.segments 3 }}-{{ .path.basename }}');
  assert.equal(set.spec.template.spec.destination.namespace, set.spec.template.metadata.name);
  assert.equal(set.spec.template.spec.syncPolicy.automated, undefined);
  assert.deepEqual(set.spec.template.spec.syncPolicy.syncOptions, ['CreateNamespace=false']);
  // Validate the YAML conditional's body without claiming Argo Go-template execution.
  const patch = set.spec.templatePatch;
  assert.match(patch, /^\s*{{- if eq \.path.basename "dev" }}\n/);
  assert.match(patch, /{{- end }}\s*$/);
  const body = patch.split('\n').slice(1, -2).join('\n');
  assert.deepEqual(yaml(body)[0], { spec: { syncPolicy: { automated: { prune: true, selfHeal: true } } } });
  assert.equal(set.spec.syncPolicy.preserveResourcesOnDeletion, true);
  assert.equal(set.spec.template.metadata.finalizers, undefined);
  assert.equal(bootstrap.spec.project, 'platform');
  assert.equal(bootstrap.spec.source.targetRevision, 'deploy');
  assert.equal(bootstrap.spec.source.path, 'clusters/homelab/tenant-namespaces');
  assert.equal(bootstrap.spec.syncPolicy.automated, undefined);
  assert.equal(bootstrap.metadata.finalizers, undefined);
});

test('schema evidence never treats all-skipped as validation; scanner failures cannot hide behind exit zero', () => {
  assert.deepEqual(schemaSummary('{"summary":{"valid":0,"invalid":0,"errors":0,"skipped":7}}'), { valid: 0, invalid: 0, errors: 0, skipped: 7 });
  for (const output of ['', '{}', '{"summary":{"valid":0}}']) assert.equal(schemaSummary(output), undefined);
  assert.equal(configScanned(JSON.stringify({ Results: [{ Type: 'kubernetes', Misconfigurations: [{ Severity: 'HIGH', Status: 'FAIL' }] }] })), false);
});

test('verify invokes kubeconform with local-only schemas and reports skipped payload', { skip: !available('kustomize') }, t => {
  const f = fixture(t); const calls = [];
  const result = verify(f.app, { policyPath: policy, log: () => {}, has: c => ['kustomize', 'kubeconform'].includes(c), run(command, args, options) {
    calls.push([command, args]);
    if (command === 'kustomize') return run(command, args, options);
    return { status: 0, stdout: '{"summary":{"valid":0,"invalid":0,"errors":0,"skipped":7}}' };
  } });
  const checks = result.results.filter(r => r.name.startsWith('kubeconform '));
  assert.equal(checks.length, 3); assert.ok(checks.every(r => r.status === 'SKIP'));
  for (const [, args] of calls.filter(([command]) => command === 'kubeconform')) {
    assert.ok(args.includes('-ignore-missing-schemas'));
    assert.ok(path.isAbsolute(args[args.indexOf('-schema-location') + 1]));
    assert.ok(!args.includes('default'));
  }
});
