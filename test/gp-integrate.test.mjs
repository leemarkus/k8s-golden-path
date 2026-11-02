import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { repoRoot, planNew, writePlan } from '../src/scaffold.mjs';
import { placeholders } from '../src/render.mjs';
import { walk } from '../src/files.mjs';
import { dockerBuildPlan, verify } from '../src/verify.mjs';

const read = file => fs.readFileSync(file, 'utf8');
const pin = `sha256:${'a'.repeat(64)}`;
function fixture(t, kind = 'static') {
  const root = fs.mkdtempSync(path.join(repoRoot, '.gp-tmp/integrate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const plan = planNew({ tenant: 'fixture', kind, appRepo: path.join(root, 'app'), gitops: path.join(root, 'gitops') });
  writePlan(plan);
  return { root, ...plan.receipt };
}
const run = (cmd, args, options = {}) => {
  const result = spawnSync(cmd, args, { encoding: 'utf8', ...options });
  assert.equal(result.status, 0, `${cmd}: ${result.stderr}\n${result.stdout}`);
  return result.stdout;
};

test('all template placeholders, including authoring sources and filenames, belong to the renderer and contract table', () => {
  const contract = read(path.join(repoRoot, 'docs/template-contract.md'));
  const documented = [...contract.matchAll(/^\| ([a-z][a-z_, ]*) \|/gm)].flatMap(m => m[1].split(', '));
  assert.deepEqual([...placeholders].sort(), documented.sort());
  const used = new Set();
  for (const file of walk(path.join(repoRoot, 'templates'))) {
    const source = `${file}\n${read(file)}`.replace(/\$\{\{[^{}]+\}\}/g, '');
    for (const [, key] of source.matchAll(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g)) {
      assert.ok(placeholders.includes(key), `${file}: ${key}`); used.add(key);
    }
  }
  assert.ok(used.size > 10);
});

test('Docker pins resolve flags over env over reviewed files; missing pins give an executable offline command', t => {
  const f = fixture(t); const source = read(path.join(f.appRepo, 'Dockerfile'));
  const missing = dockerBuildPlan(f.appRepo, source, { env: {} });
  assert.deepEqual(missing.missing, ['NODE_DIGEST', 'NGINX_DIGEST']);
  assert.ok(missing.command.includes('${NODE_DIGEST:?set reviewed NODE_DIGEST}'));
  assert.ok(missing.command.includes('--pull=false --network=none'));
  const b = `sha256:${'b'.repeat(64)}`; const c = `sha256:${'c'.repeat(64)}`;
  fs.writeFileSync(path.join(f.appRepo, 'ops/ci/base-images.json'), JSON.stringify({ node: pin, nginx: pin }));
  const pins = dockerBuildPlan(f.appRepo, source, { env: {} });
  assert.deepEqual(pins.buildArgs, ['--build-arg', `NODE_DIGEST=${pin}`, '--build-arg', `NGINX_DIGEST=${pin}`]);
  const override = dockerBuildPlan(f.appRepo, source, { env: { NODE_DIGEST: b }, nodeDigest: c });
  assert.ok(override.source.includes(`node:22-alpine@${c}`));
  assert.ok(dockerBuildPlan(f.appRepo, source, { env: { NODE_DIGEST: b } }).source.includes(b));
  assert.throws(() => dockerBuildPlan(f.appRepo, source, { nodeDigest: 'latest', env: {} }), /Invalid NODE_DIGEST/);
  // Exercise the real verifier's build-argument and cached-base paths without a daemon.
  const calls = [];
  const result = verify(f.appRepo, { nodeDigest: c, env: {}, has: cmd => cmd === 'docker', log: () => {}, run(cmd, args) {
    calls.push(args); return { status: 0, stdout: '' };
  } });
  assert.equal(result.failed, 0);
  assert.equal(calls.filter(args => args[0] === 'image').length, 2);
  assert.ok(calls.find(args => args[0] === 'build').includes(`NODE_DIGEST=${c}`));
  const failure = verify(f.appRepo, { env: {}, has: cmd => cmd === 'docker', log: () => {}, run: () => ({ status: 1 }) });
  assert.ok(failure.results.some(r => r.name === 'docker build' && r.status === 'FAIL'));
});

test('promote-dev edits the real generated dev image field and preserves prod', t => {
  const f = fixture(t); const bin = path.join(f.root, 'bin'); fs.mkdirSync(bin);
  // Only git transport is stubbed; promotion uses real kustomize against the generated overlay.
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh
case "$1" in
  clone) for last do :; done; cp -R "$FIXTURE_GITOPS" "$last" ;;
  diff) case "$2" in --quiet) exit 1;; --name-only) printf '%s/kustomization.yaml\\n' "$OVERLAY";; esac ;;
  push) cp "$OVERLAY/kustomization.yaml" "$PROMOTED" ;;
  *) exit 0 ;;
esac
`, { mode: 0o755 });
  const workflow = JSON.parse(read(path.join(f.appRepo, '.forgejo/workflows/ci.yml')));
  const overlay = workflow.jobs['promote-dev'].env.OVERLAY;
  assert.equal(path.join(f.gitops, overlay), path.join(f.tenantDir, 'overlays/dev'));
  const prod = path.join(f.tenantDir, 'overlays/prod/kustomization.yaml'); const before = read(prod);
  const promoted = path.join(f.root, 'promoted.yaml'); const sha = 'b'.repeat(40);
  run('bash', ['ops/ci/promote-dev.sh'], { cwd: f.appRepo, env: { ...process.env,
    PATH: `${bin}:${process.env.PATH}`, FIXTURE_GITOPS: f.gitops, PROMOTED: promoted, RUNNER_TEMP: f.root,
    GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: sha, DIGEST: pin,
    IMAGE: 'registry.example.com/apps/fixture', OVERLAY: overlay,
    GITOPS_REPO: 'git.example.com/platform/gitops', GITOPS_TOKEN: 'synthetic-offline-test-token',
  } });
  fs.copyFileSync(promoted, path.join(f.gitops, overlay, 'kustomization.yaml'));
  const rendered = run('kustomize', ['build', path.join(f.gitops, overlay)]);
  assert.ok(rendered.includes(`image: registry.example.com/apps/fixture:sha-${sha}@${pin}`));
  assert.equal(read(prod), before);
});

test('runbook named resource commands resolve to template and ApplicationSet identities', () => {
  const deployment = read(path.join(repoRoot, 'templates/deploy/base/deployment.yaml.tmpl'));
  const project = read(path.join(repoRoot, 'platform/appproject-tenants.yaml'));
  const appset = read(path.join(repoRoot, 'platform/applicationset-tenants.yaml'));
  assert.match(deployment, /name: forgejo-registry/);
  assert.match(project, /name: tenants/);
  assert.ok(appset.includes("{{ index .path.segments 3 }}-{{ .path.basename }}"));
  let named = 0;
  for (const file of walk(path.join(repoRoot, 'docs/runbooks')).filter(f => f.endsWith('.md'))) {
    for (const line of read(file).split('\n').filter(l => l.startsWith('kubectl '))) {
      const match = line.match(/ get ([a-z.,]+)\s+(.*)$/);
      if (!match) continue;
      const [, resource, rest] = match;
      const args = rest.replace(/-o\s+(?:'[^']*'|"[^"]*"|\S+)/g, '').replace(/-(?:n|l)\s+(?:"[^"]*"|\S+)/g, '').split(/\s+/).filter(v => v && !v.startsWith('-'));
      if (!args.length) continue;
      const allowed = {
        'applications.argoproj.io': ['"$NS"', '"$TENANT-dev"', '"$TENANT-prod"'],
        namespace: ['"$NS"'], namespaces: ['"$TENANT-dev"', '"$TENANT-prod"'],
        'appprojects.argoproj.io': ['tenants'], 'sealedsecrets.bitnami.com': ['forgejo-registry'],
      };
      assert.ok(allowed[resource], `${file}: unverified named resource command: ${line}`);
      for (const arg of args) assert.ok(allowed[resource].includes(arg), `${file}: ${arg}`);
      if (args.some(a => a.includes('$NS'))) assert.match(read(file), /NS="\$TENANT-\$ENV"/);
      named++;
    }
  }
  assert.ok(named >= 10);
});


test('CLI digest flags override environment pins and reject malformed or duplicate input', t => {
  const f = fixture(t);
  const cli = (args, env = {}) => spawnSync(process.execPath, [path.join(repoRoot, 'bin/gp'), 'verify', f.appRepo, ...args], {
    encoding: 'utf8', env: { PATH: '', ...env },
  });
  const result = cli(['--node-digest', pin], { NODE_DIGEST: 'invalid-env-pin' });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`NODE_DIGEST=${pin}`));
  assert.match(result.stdout, /SKIP docker build: unset NGINX_DIGEST/);
  for (const args of [['--node-digest', 'latest'], ['--node-digest', pin, '--node-digest', pin], ['--nginx-digest'], ['--runner-typo', pin]]) {
    assert.notEqual(cli(args).status, 0);
  }
});

test('available promtool executes both generated suites and propagates engine failures', t => {
  const f = fixture(t); const calls = [];
  const result = verify(f.appRepo, { env: {}, has: cmd => cmd === 'promtool', log: () => {}, run(cmd, args, options) {
    calls.push({ cmd, args, options }); return { status: 1, stderr: 'synthetic engine failure' };
  } });
  assert.equal(result.failed, 2);
  assert.deepEqual(calls.map(c => c.args.slice(0, 2)), [['check', 'rules'], ['test', 'rules']]);
  assert.ok(calls.every(c => c.options.cwd === path.join(f.tenantDir, 'base/observe/tests')));
});

test('tenant acceptance: separate tenant Dockerfile selects private pins and refuses receipt path escapes', t => {
  const f = fixture(t);
  const receipt = path.join(f.appRepo, 'gp.json');
  const data = JSON.parse(fs.readFileSync(receipt));
  fs.renameSync(path.join(f.appRepo, 'Dockerfile'), path.join(f.appRepo, 'Dockerfile.cluster'));
  fs.writeFileSync(path.join(f.appRepo, 'Dockerfile'), 'FROM public-preview:latest\n');
  fs.writeFileSync(receipt, JSON.stringify({ ...data, dockerfile: 'Dockerfile.cluster' }));
  const result = verify(f.appRepo, { has: () => false, log: () => {}, env: {} });
  const docker = result.results.find(r => r.name === 'docker build');
  assert.equal(docker.status, 'SKIP');
  assert.match(docker.reason, /unset NODE_DIGEST, NGINX_DIGEST/);
  assert.match(docker.reason, /--file '[^']+\/Dockerfile.cluster'/);
  for (const invalid of ['../Dockerfile', '/tmp/Dockerfile', '.env', 42]) {
    fs.writeFileSync(receipt, JSON.stringify({ ...data, dockerfile: invalid }));
    assert.throws(() => verify(f.appRepo, { has: () => false, log: () => {} }), /Invalid receipt dockerfile/);
  }
});

test('tenant acceptance: gitops integration excludes Promtool documents only from raw schema inputs', () => {
  const patch = read(path.join(repoRoot, 'platform/integration-gitops.patch'));
  assert.match(patch, /\+\s+-not -path "\*\/tenants\/\*\/base\/observe\/tests\/\*"/);
  assert.match(patch, /kustomize build "\$\(dirname "\$kfile"\)"/);
  assert.match(patch, /trivy config "\$tenant_scan_dir" --severity HIGH,CRITICAL --exit-code 1/);
});
