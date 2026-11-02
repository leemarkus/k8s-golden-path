import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { render } from '../src/render.mjs';
import { planNew, writePlan, repoRoot } from '../src/scaffold.mjs';
import { verify, policyPassed, configScanned } from '../src/verify.mjs';

function fixture(t) {
  const root = path.join(repoRoot, '.gp-tmp'); fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, 'test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const options = { tenant: 'demo', kind: 'static', appRepo: path.join(dir, 'app'), gitops: path.join(dir, 'gitops'), templateRoot: path.join(dir, 'templates') };
  const put = (name, data) => { const file = path.join(dir, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); return file; };
  return { dir, options, put };
}
const cli = args => spawnSync(process.execPath, [path.join(repoRoot, 'bin/gp'), ...args], { encoding: 'utf8', cwd: repoRoot });

test('renderer resolves all supplied scalars, rejects unknown and residual syntax', () => {
  assert.equal(render('{{tenant}} {{ env }} {{port}} {{enabled}}', { tenant: 'demo', env: 'dev', port: 8080, enabled: false }), 'demo dev 8080 false');
  for (const [source, values] of [['{{missing}}', {}], ['{{tenant.name}}', {}], ['{{unfinished', {}], ['{{tenant}}', { tenant: '{{bad}}' }], ['{{tenant}}', { tenant: {} }], ['{{constructor}}', {}]]) {
    assert.throws(() => render(source, values));
  }
});
test('both kinds scaffold receipts with honest zero-template status', t => {
  const { options } = fixture(t);
  for (const kind of ['static', 'node']) {
    const plan = planNew({ ...options, kind });
    assert.equal(plan.receipt.templateFiles, 0); assert.equal(plan.files.length, 2);
  }
  const plan = planNew(options); writePlan(plan);
  assert.equal(JSON.parse(fs.readFileSync(path.join(options.appRepo, 'gp.json'))).tenant, 'demo');
  assert.throws(() => planNew(options), /overwrite/);
});
test('template mapping handles dotfiles, environment, literal expressions and executable mode', t => {
  const { options, put } = fixture(t);
  const script = put('templates/ci/ops/ci/check.sh.tmpl', '#!/bin/sh\necho {{tenant}}\n'); fs.chmodSync(script, 0o755);
  put('templates/ci/.forgejo/workflows/ci.yml.raw', 'ref: ${{ github.ref }}\n');
  put('templates/deploy/overlays/dev/host.yaml.tmpl', '{{env}} {{host}} {{port}}');
  put('templates/deploy/overlays/prod/{{tenant}}.txt.tmpl', '{{env}}');
  put('templates/app/static/README.md', 'not generated');
  put('templates/app/static/.env', 'ignored sentinel');
  const plan = planNew(options); writePlan(plan);
  assert.equal(plan.receipt.templateFiles, 4);
  assert.equal(fs.readFileSync(path.join(options.appRepo, '.forgejo/workflows/ci.yml'), 'utf8'), 'ref: ${{ github.ref }}\n');
  assert.equal(fs.statSync(path.join(options.appRepo, 'ops/ci/check.sh')).mode & 0o777, 0o755);
  assert.equal(fs.readFileSync(path.join(plan.receipt.tenantDir, 'overlays/dev/host.yaml'), 'utf8'), 'dev demo-dev.apps.example.com 8080');
  assert.equal(fs.existsSync(path.join(options.appRepo, 'README.md')), false);
});
test('preflight refuses late collisions without creating earlier outputs', t => {
  const { options, put } = fixture(t);
  put('templates/app/static/a.txt.tmpl', 'new'); put('templates/app/static/z.txt.tmpl', 'new');
  const old = put('app/z.txt', 'keep');
  assert.throws(() => planNew(options), /overwrite/);
  assert.equal(fs.existsSync(path.join(options.appRepo, 'a.txt')), false);
  assert.equal(fs.readFileSync(old, 'utf8'), 'keep');
});
test('exclusive writes roll back created files when a collision appears after planning', t => {
  const { options, put } = fixture(t); const plan = planNew(options);
  const last = plan.files.at(-1).path; fs.mkdirSync(path.dirname(last), { recursive: true }); fs.writeFileSync(last, 'racing writer');
  assert.throws(() => writePlan(plan), /EEXIST/);
  assert.equal(fs.existsSync(plan.files[0].path), false);
  assert.equal(fs.readFileSync(last, 'utf8'), 'racing writer');
});
test('invalid slugs, kind, overlapping roots, forbidden paths and symlinks fail closed', t => {
  const { options, dir, put } = fixture(t);
  for (const tenant of ['../oops', 'Upper', 'a/b', '-a', 'a-', 'a'.repeat(49)]) assert.throws(() => planNew({ ...options, tenant }));
  assert.throws(() => planNew({ ...options, kind: 'db' }));
  assert.throws(() => planNew({ ...options, gitops: options.appRepo }), /overlap/);
  assert.throws(() => planNew({ ...options, appRepo: path.join(dir, '.secrets/app') }), /Forbidden/);
  fs.mkdirSync(options.appRepo); fs.symlinkSync(options.appRepo, path.join(dir, 'link'));
  assert.throws(() => planNew({ ...options, appRepo: path.join(dir, 'link') }), /symlink/);
  const real = put('real', 'content'); fs.mkdirSync(path.join(options.templateRoot, 'app/static'), { recursive: true });
  fs.symlinkSync(real, path.join(options.templateRoot, 'app/static/file.tmpl'));
  assert.throws(() => planNew(options), /symlink/);
});
test('unknown placeholder and duplicate destinations preflight before writes', t => {
  const { options, put } = fixture(t);
  const file = put('templates/app/static/one.tmpl', '{{bogus}}');
  assert.throws(() => planNew(options), /Unknown/); assert.equal(fs.existsSync(options.appRepo), false);
  fs.writeFileSync(file, 'one'); put('templates/ci/one.raw', 'two');
  assert.throws(() => planNew(options), /Duplicate/);
});
test('CLI dry-run changes no files and strict argument parsing rejects typos', t => {
  const { options } = fixture(t);
  const result = cli(['new', 'demo', '--kind', 'static', '--app-repo', options.appRepo, '--gitops', options.gitops, '--dry-run']);
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /DRY RUN/); assert.doesNotMatch(result.stdout, /INCOMPLETE/);
  for (const output of ['app/Dockerfile', 'app/.forgejo/workflows/ci.yml', 'base/deployment.yaml', 'base/observe/prometheusrule-slo.yaml', 'overlays/dev/kustomization.yaml', 'overlays/prod/kustomization.yaml', '/gp.json']) assert.ok(result.stdout.includes(output), output);
  assert.ok(Number(result.stdout.match(/DRY RUN (\d+) files/)[1]) > 2);
  assert.equal(fs.existsSync(options.appRepo), false); assert.equal(fs.existsSync(options.gitops), false);
  assert.equal(cli(['list-kinds']).stdout, 'static\nnode\n');
  for (const args of [['new', 'demo', '--force'], ['list-kinds', 'extra'], ['verify'], ['new', 'demo', '--kind', 'static', '--kind', 'node']]) assert.notEqual(cli(args).status, 0);
});
test('policy verdict requires actual passes and rejects zero/error/warning evidence', () => {
  assert.equal(policyPassed('pass: 4, fail: 0, warn: 0, error: 0, skip: 2'), true);
  for (const text of ['', 'pass: 0, fail: 0, warn: 0, error: 0, skip: 4', 'pass: 4, fail: 1, warn: 0, error: 0, skip: 0', 'pass: 4, fail: 0, warn: 0, error: 1, skip: 0', 'pass: 4, fail: 0, warn: 1, error: 0, skip: 0']) assert.equal(policyPassed(text), false);
});
test('verify skips absent templates honestly without invoking tools', t => {
  const { options } = fixture(t); writePlan(planNew(options));
  const result = verify(options.appRepo, { has: () => false, run: () => { throw Error('unexpected execution'); }, log: () => {} });
  assert.equal(result.failed, 0); assert.ok(result.skipped >= 8); assert.ok(result.results.every(r => r.status === 'SKIP'));
});
test('verify invokes live policy on rendered overlays, propagates policy and scanner failures', t => {
  const { options, put } = fixture(t);
  put('templates/deploy/overlays/dev/kustomization.yaml.tmpl', 'resources: []'); writePlan(planNew(options));
  const policy = put('gitops/clusters/homelab/config/kyverno-policies.yaml', 'kind: ClusterPolicy');
  const calls = [];
  const result = verify(options.appRepo, { has: () => true, log: () => {}, run(command, args) {
    calls.push([command, args]);
    if (command === 'kustomize') return { status: 0, stdout: 'kind: Deployment\n' };
    if (command === 'kyverno') return { status: 0, stdout: 'pass: 4, fail: 1, warn: 0, error: 0, skip: 0' };
    if (command === 'trivy') return { status: 1, stderr: 'misconfiguration' };
    if (command === 'kubeconform') return { status: 0, stdout: JSON.stringify({ summary: { valid: 0, invalid: 0, errors: 0, skipped: 1 } }) };
    throw Error(`unexpected tool: ${command}`);
  } });
  assert.equal(result.failed, 2);
  assert.equal(calls.find(c => c[0] === 'kyverno')[1][1], policy);
  assert.ok(calls.find(c => c[0] === 'trivy')[1].includes('--skip-check-update'));
});
test('render failure prevents dependent scans and remote bases fail offline', t => {
  const { options, put } = fixture(t);
  put('templates/deploy/overlays/dev/kustomization.yaml.tmpl', 'resources: []'); const plan = planNew(options); writePlan(plan);
  let calls = 0;
  const result = verify(options.appRepo, { has: () => true, log: () => {}, run: () => { calls++; return { status: 1, stderr: 'bad yaml' }; } });
  assert.equal(result.failed, 1); assert.equal(calls, 1);
  fs.writeFileSync(path.join(plan.receipt.tenantDir, 'overlays/dev/kustomization.yaml'), 'resources: [https://example.invalid/base]');
  calls = 0;
  assert.equal(verify(options.appRepo, { has: () => true, log: () => {}, run: () => { calls++; } }).failed, 1);
  assert.equal(calls, 0);
});
test('config scan must inspect actual Kubernetes resources, not merely exit zero', () => {
  assert.equal(configScanned('{"Results":[{"Type":"kubernetes","Target":"rendered.yaml"}]}'), true);
  for (const output of ['', '{}', '{"Results":[]}', '{"Results":[{"Type":"terraform"}]}']) assert.equal(configScanned(output), false);
});
test('offline docker gate uses cached bases and a filtered local context', t => {
  const { options, put } = fixture(t); writePlan(planNew(options));
  put('app/Dockerfile', `FROM example.invalid/base@sha256:${'a'.repeat(64)}\nUSER 1000\n`);
  put('app/.dockerignore', '.env\n.env.*\n.secrets\n**/.env\n**/.env.*\n**/.secrets\n');
  put('app/index.html', 'fixture');
  let built = false;
  const result = verify(options.appRepo, { has: () => true, log: () => {}, run(command, args) {
    assert.equal(command, 'docker');
    if (args[0] === 'build') {
      built = true; assert.ok(args.includes('--network=none')); assert.ok(args.includes('--pull=false'));
      assert.notEqual(args.at(-1), options.appRepo); assert.equal(fs.existsSync(path.join(args.at(-1), 'index.html')), true);
    }
    return { status: 0, stdout: '' };
  } });
  assert.equal(result.failed, 0); assert.equal(built, true);
});
test('available shell and node test failures are not converted to skips', t => {
  const { options, put } = fixture(t); writePlan(planNew(options));
  put('app/scripts/check.sh', '#!/bin/sh\nexit 1\n'); put('app/test/app.test.mjs', '// fixture');
  const commands = [];
  const result = verify(options.appRepo, { has: () => true, log: () => {}, run(command) { commands.push(command); return { status: 1, stdout: 'failed' }; } });
  assert.deepEqual(commands, ['shellcheck', 'node']); assert.equal(result.failed, 2);
});

test('relative receipts resolve from either receipt after the checkout group moves', t => {
  const { dir, options } = fixture(t);
  writePlan(planNew(options));
  const moved = `${dir}-moved`;
  fs.renameSync(dir, moved);
  t.after(() => fs.rmSync(moved, { recursive: true, force: true }));
  for (const relative of ['app', 'gitops/clusters/homelab/tenants/demo']) {
    const directory = path.join(moved, relative);
    const receipt = JSON.parse(fs.readFileSync(path.join(directory, 'gp.json')));
    assert.equal(receipt.version, 2);
    for (const key of ['appRepo', 'gitops', 'tenantDir']) assert.equal(path.isAbsolute(receipt[key]), false);
    assert.equal(verify(directory, { has: () => false, log: () => {} }).failed, 0);
  }
  fs.renameSync(path.join(moved, 'app'), path.join(moved, 'missing-app'));
  assert.throws(() => verify(path.join(moved, 'gitops/clusters/homelab/tenants/demo')),
    /Receipt directory missing: appRepo.*restore the checkout layout or regenerate/);
});

test('legacy absolute and malformed receipts fail before any gates run', t => {
  const { options } = fixture(t); const plan = planNew(options); writePlan(plan);
  const receiptPath = path.join(options.appRepo, 'gp.json');
  const current = JSON.parse(fs.readFileSync(receiptPath));
  for (const receipt of [{ ...plan.receipt, version: 1 }, { ...current, gitops: options.gitops }]) {
    fs.writeFileSync(receiptPath, JSON.stringify(receipt));
    assert.throws(() => verify(options.appRepo), /Legacy absolute gp.json receipt; regenerate/);
  }
  for (const value of [null, '', 42]) {
    fs.writeFileSync(receiptPath, JSON.stringify({ ...current, appRepo: value }));
    assert.throws(() => verify(options.appRepo), /Invalid receipt path: appRepo/);
  }
});
