import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { planNew, writePlan, repoRoot } from '../src/scaffold.mjs';
import { render } from '../src/render.mjs';

function fixture(t, kind = 'static') {
  fs.mkdirSync(path.join(repoRoot, '.gp-tmp'), { recursive: true });
  const root = fs.mkdtempSync(path.join(repoRoot, '.gp-tmp/gp-build-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const options = { tenant: 'fixture', kind, appRepo: path.join(root, 'app'), gitops: path.join(root, 'gitops') };
  writePlan(planNew(options));
  const read = name => fs.readFileSync(path.join(options.appRepo, name), 'utf8');
  return { root, ...options, read };
}
const run = (cmd, args, options = {}) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 15000, ...options });
const hash = bytes => `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;

test('build: digest input has no fallback and strict validation; native syntax is workflow-only', t => {
  const f = fixture(t);
  const pin = hash('test artifact only, not a deployable pin');
  assert.equal(render('{{image_digest}}', { image_digest: pin }), pin);
  assert.throws(() => render('{{image_digest}}', {}), /Unknown/);
  for (const value of ['', 'sha256:bad', pin.toUpperCase(), `${pin}\n`, 4]) {
    assert.throws(() => render('', { image_digest: value }), /image_digest/);
    assert.throws(() => planNew({ ...f, appRepo: path.join(f.root, 'new'), imageDigest: value }), /image_digest/);
  }
  const native = '${{ secrets.REGISTRY_TOKEN }}';
  assert.throws(() => render(native, {}), /Leftover/);
  assert.equal(render(`${native} {{tenant}}`, { tenant: 'demo' }, { forgejoExpressions: true }), `${native} demo`);
  assert.throws(() => render('${{ broken {{tenant}} }}', { tenant: 'demo' }, { forgejoExpressions: true }), /Leftover/);
  assert.throws(() => render('{{unknown}}', {}, { forgejoExpressions: true }), /Unknown/);
  assert.throws(() => render('\0GP_EXPRESSION_0\0', {}, { forgejoExpressions: true }), /NUL/);
  const templates = path.join(f.root, 'templates/deploy/overlays/dev'); fs.mkdirSync(templates, { recursive: true });
  fs.writeFileSync(path.join(templates, 'pin.tmpl'), '{{image_digest}}');
  const options = { ...f, appRepo: path.join(f.root, 'new'), gitops: path.join(f.root, 'new-gitops'), templateRoot: path.join(f.root, 'templates') };
  assert.throws(() => planNew({ ...options, imageDigest: undefined }), /Unknown/);
  assert.equal(planNew({ ...options, imageDigest: pin }).files[0].content, pin);
  const cli = run(process.execPath, ['bin/gp', 'new', 'fixture', '--kind', 'node', '--app-repo', options.appRepo, '--gitops', options.gitops, '--dry-run'], { cwd: repoRoot, env: { ...process.env, GP_IMAGE_DIGEST: 'bad' } });
  assert.notEqual(cli.status, 0); assert.match(cli.stderr, /image_digest/);
});

for (const kind of ['static', 'node']) test(`build: ${kind} scaffold hardening, example and workflow YAML structure`, t => {
  const f = fixture(t, kind);
  const docker = f.read('Dockerfile');
  assert.equal((docker.match(/^FROM /gm) ?? []).length, 2);
  for (const from of docker.match(/^FROM .+$/gm)) assert.match(from, /@\$\{(?:NODE|NGINX)_DIGEST\}/);
  for (const label of ['source', 'revision', 'created', 'title']) assert.ok(docker.includes(`org.opencontainers.image.${label}`));
  assert.match(docker, kind === 'static' ? /USER 101:101/ : /USER 1000:1000/);
  assert.match(docker, new RegExp(`EXPOSE ${kind === 'static' ? 8080 : 3000}`));
  assert.match(docker, /HEALTHCHECK.+\/healthz/);
  for (const name of ['.env', '.env.*', '.secrets', '**/.env', '**/.env.*', '**/.secrets']) assert.ok(f.read('.dockerignore').split('\n').includes(name));
  assert.equal(run('npm', ['test'], { cwd: f.appRepo }).status, 0);
  if (kind === 'static') {
    assert.ok(fs.existsSync(path.join(f.appRepo, 'dist/index.html')));
    const nginx = f.read('nginx.conf');
    assert.match(nginx, /listen 8080;/); assert.match(nginx, /location = \/healthz/); assert.match(nginx, /return 200/);
    assert.match(nginx, /server_tokens off/); assert.match(nginx, /pid \/tmp\//);
    for (const line of nginx.split('\n').filter(line => /_temp_path/.test(line))) assert.match(line, /\/tmp\//);
    for (const header of ['X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy']) assert.ok(nginx.includes(header));
  }
  // JSON is a strict YAML subset: parse the actual generated workflow, then
  // check its graph, types, expressions and privilege boundaries without deps.
  const workflow = JSON.parse(f.read('.forgejo/workflows/ci.yml'));
  assert.deepEqual(Object.keys(workflow.on).sort(), ['pull_request', 'push']);
  assert.deepEqual(workflow.on.push.branches, ['main']);
  assert.equal(workflow.env.IMAGE, 'registry.example.com/apps/fixture');
  assert.equal(workflow.env.BUILDKIT_ADDR, 'tcp://buildkitd.ci.svc.cluster.local:1234');
  assert.equal(workflow.concurrency['cancel-in-progress'], true);
  const { checks, 'build-scan-publish': build, 'promote-dev': promote } = workflow.jobs;
  assert.deepEqual(build.needs, ['checks']); assert.deepEqual(promote.needs, ['build-scan-publish']);
  const mainGuard = "github.event_name == 'push' && github.ref == 'refs/heads/main'";
  assert.equal(promote.if, mainGuard);
  assert.equal(build.steps.find(step => step.id === 'publish').if, mainGuard);
  assert.equal(build.outputs.digest, '${{ steps.publish.outputs.digest }}');
  assert.equal(promote.env.DIGEST, '${{ needs.build-scan-publish.outputs.digest }}');
  assert.equal(promote.env.OVERLAY, 'clusters/homelab/tenants/fixture/overlays/dev');
  for (const job of [checks, build, promote]) {
    assert.equal(job['runs-on'], 'docker'); assert.ok(Array.isArray(job.steps));
    for (const step of job.steps) { assert.ok(Boolean(step.run) !== Boolean(step.uses)); if (step.run) assert.equal(typeof step.run, 'string'); }
  }
  assert.deepEqual(Object.keys(build.steps.find(step => step.id === 'publish').env), ['REGISTRY_TOKEN']);
  assert.deepEqual([...f.read('.forgejo/workflows/ci.yml').matchAll(/secrets\.([A-Z_]+)/g)].map(m => m[1]).sort(), ['GITOPS_TOKEN', 'REGISTRY_TOKEN']);
  const scan = f.read('ops/ci/scan-publish.sh');
  assert.equal((scan.match(/buildctl --addr/g) ?? []).length, 1);
  assert.match(scan, /--severity HIGH,CRITICAL --exit-code 1/); assert.doesNotMatch(scan, /--ignore-unfixed/);
  assert.match(scan, /IMAGE_SHA="\$\{IMAGE\}:sha-\$\{GITHUB_SHA\}"/);
  assert.ok(scan.indexOf(' before-scan') < scan.indexOf('--severity HIGH,CRITICAL'));
  assert.ok(scan.indexOf('--severity HIGH,CRITICAL') < scan.indexOf(' after-scan'));
  const pins = run(process.execPath, ['ops/ci/validate.mjs', 'pin', 'node'], { cwd: f.appRepo });
  assert.notEqual(pins.status, 0); assert.match(pins.stderr, /verified sha256/);
});

test('build: reviewed ignores and fresh DB required, malformed/expired/future inputs rejected', async t => {
  const f = fixture(t);
  const { validateIgnores, validateDatabase } = await import(pathToFileURL(path.join(f.appRepo, 'ops/ci/validate.mjs')));
  const now = Date.parse('2026-10-03T12:00:00Z');
  const entry = { id: 'CVE-2026-12345', statement: 'Scoped reason', owner: 'operator', review: 'https://review.invalid/1', expired_at: '2026-10-04' };
  validateIgnores({ vulnerabilities: [] }, now); validateIgnores({ vulnerabilities: [entry] }, now);
  for (const bad of [{ ...entry, expired_at: '2026-10-03' }, { ...entry, expired_at: '2026-02-30' }, { ...entry, statement: '' }, { ...entry, review: '' }, { ...entry, owner: '' }, { ...entry, id: '*' }, { ...entry, paths: ['*'] }]) assert.throws(() => validateIgnores({ vulnerabilities: [bad] }, now));
  assert.throws(() => validateIgnores({ vulnerabilities: [entry, entry] }, now));
  assert.throws(() => validateIgnores({ vulnerabilities: [], misconfigurations: [] }, now));
  validateDatabase({ Version: 2, UpdatedAt: '2026-10-03T00:00:00Z' }, now);
  for (const metadata of [{}, { Version: 1, UpdatedAt: '2026-10-03T00:00:00Z' }, { Version: 2, UpdatedAt: '2026-10-02T00:00:00Z' }, { Version: 2, UpdatedAt: '2026-10-04T00:00:00Z' }]) assert.throws(() => validateDatabase(metadata, now));
});

function ociFixture(f) {
  const directory = path.join(f.root, 'oci'); const layout = path.join(directory, 'layout');
  fs.mkdirSync(path.join(layout, 'blobs/sha256'), { recursive: true });
  const put = (object, mediaType) => {
    const bytes = Buffer.from(JSON.stringify(object)); const digest = hash(bytes);
    fs.writeFileSync(path.join(layout, 'blobs/sha256', digest.slice(7)), bytes);
    return { mediaType, size: bytes.length, digest };
  };
  const config = put({ os: 'linux', architecture: 'amd64', rootfs: { type: 'layers', diff_ids: [] } }, 'application/vnd.oci.image.config.v1+json');
  const manifest = put({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json', config, layers: [] }, 'application/vnd.oci.image.manifest.v1+json');
  fs.writeFileSync(path.join(layout, 'oci-layout'), '{"imageLayoutVersion":"1.0.0"}');
  fs.writeFileSync(path.join(layout, 'index.json'), JSON.stringify({ schemaVersion: 2, manifests: [manifest] }));
  fs.writeFileSync(path.join(directory, 'build-meta.json'), JSON.stringify({ 'containerimage.digest': manifest.digest, 'containerimage.config.digest': config.digest }));
  const env = { ...process.env, GP_CI_DIR: directory, GITHUB_OUTPUT: path.join(directory, 'output'), GITHUB_STEP_SUMMARY: path.join(directory, 'summary'), IMAGE_SHA: `registry.example.com/apps/fixture:sha-${'1'.repeat(40)}`, GITHUB_SHA: '1'.repeat(40), GITHUB_REF: 'refs/heads/main' };
  const phase = name => run('python3', ['ops/ci/artifact.py', name], { cwd: f.appRepo, env });
  return { directory, layout, config, manifest, env, phase };
}

test('build: extracted OCI verifier rejects metadata mismatch and post-scan byte mutation', t => {
  const f = fixture(t); const oci = ociFixture(f);
  assert.equal(oci.phase('before-scan').status, 0);
  assert.equal(oci.phase('after-scan').status, 0);
  const receipt = JSON.parse(fs.readFileSync(path.join(oci.directory, 'scanned.json')));
  assert.equal(receipt.manifest_digest, oci.manifest.digest);
  fs.writeFileSync(path.join(oci.directory, 'build-meta.json'), '{}');
  assert.notEqual(oci.phase('publish').status, 0);
  fs.appendFileSync(path.join(oci.layout, 'blobs/sha256', oci.config.digest.slice(7)), '\n');
  const result = oci.phase('publish'); assert.notEqual(result.status, 0); assert.match(result.stderr, /digest mismatch/);
});

test('build: registry transfers exact scanned bytes and rejects resolved digest mismatch without network', t => {
  const f = fixture(t); const oci = ociFixture(f);
  const script = `
import sys, io, json, importlib.util
from pathlib import Path
spec = importlib.util.spec_from_file_location('artifact', 'ops/ci/artifact.py')
a = importlib.util.module_from_spec(spec); spec.loader.exec_module(a)
layout = a.Layout(Path(sys.argv[1])); identity = layout.verify(a.read_json(Path(sys.argv[1]) / 'build-meta.json'))
class Response(io.BytesIO):
    def __init__(self, body=b'', status=200, headers=None):
        super().__init__(body); self.status=status; self.headers=headers or {}
class Registry(a.Registry):
    def __init__(self, mismatch):
        self.base='https://registry.invalid/v2/apps/fixture'; self.mismatch=mismatch; self.uploads=[]
    def request(self, method, url, expected, data=None, headers=None, authenticate=True):
        if method == 'HEAD':
            return Response(status=404 if '/manifests/' in url else 200)
        if method == 'PUT':
            assert data == layout.manifest_bytes
            self.uploads.append(data)
            return Response(status=201, headers={'Docker-Content-Digest': identity['manifest_digest']})
        assert method == 'GET'
        return Response(body=b'wrong' if self.mismatch else layout.manifest_bytes,
                        headers={'Docker-Content-Digest': identity['manifest_digest']})
good=Registry(False)
assert good.publish(layout, identity, ['sha-' + '1'*40]) == identity['manifest_digest']
assert len(good.uploads) == 1
try: Registry(True).publish(layout, identity, ['sha-' + '1'*40])
except a.Refusal: pass
else: raise AssertionError('accepted a mismatched published artifact')
print('same bytes published; mismatched resolution refused')
`;
  const result = run('python3', ['-c', script, oci.directory], { cwd: f.appRepo });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /mismatched resolution refused/);
});

for (const pushResult of ['retry-success', 'always-fail']) test(`build: promote-dev ${pushResult}, exactly one rebase/retry, no force or prod`, t => {
  const f = fixture(t); const bin = path.join(f.root, 'bin'); fs.mkdirSync(bin);
  // These executables replace all git/registry access. No credentials or remote
  // operations are used by the test; the token is a clearly labelled sentinel.
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/bash
set -eu
printf '%s\\n' "$*" >> "$TEST_LOG"
case "$1" in
  clone) mkdir -p "\${@: -1}/$OVERLAY" ;;
  diff) if [[ \${2:-} == --quiet ]]; then exit 1; fi; printf '%s\\n' "$OVERLAY/kustomization.yaml" ;;
  push) if [[ -f $TEST_COUNT && $TEST_RESULT == retry-success ]]; then exit 0; fi; touch "$TEST_COUNT"; exit 1 ;;
esac
`);
  fs.writeFileSync(path.join(bin, 'kustomize'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TEST_LOG"\n');
  for (const command of ['git', 'kustomize']) fs.chmodSync(path.join(bin, command), 0o755);
  const logfile = path.join(f.root, 'calls');
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: f.root, GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: '1'.repeat(40), DIGEST: hash('synthetic test artifact'), IMAGE: 'registry.example.com/apps/fixture', OVERLAY: 'clusters/homelab/tenants/fixture/overlays/dev', GITOPS_REPO: 'git.example.com/platform/gitops', GITOPS_TOKEN: 'test-only-sentinel', TEST_LOG: logfile, TEST_COUNT: path.join(f.root, 'push-count'), TEST_RESULT: pushResult };
  const result = run('bash', ['ops/ci/promote-dev.sh'], { cwd: f.appRepo, env });
  assert.equal(result.status, pushResult === 'retry-success' ? 0 : 1, result.stderr);
  const calls = fs.readFileSync(logfile, 'utf8');
  assert.equal((calls.match(/^push origin HEAD:main$/gm) ?? []).length, 2);
  assert.equal((calls.match(/^pull --rebase origin main$/gm) ?? []).length, 1);
  assert.match(calls, new RegExp(`sha-${env.GITHUB_SHA}@${env.DIGEST}`));
  assert.doesNotMatch(calls, /--force|overlays\/prod|test-only-sentinel/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /test-only-sentinel/);
  const pr = run('bash', ['ops/ci/promote-dev.sh'], { cwd: f.appRepo, env: { ...env, GITHUB_EVENT_NAME: 'pull_request' } });
  assert.notEqual(pr.status, 0);
});

test('build: real kustomize preserves full tag plus digest and copies the identical digest to prod', t => {
  const f = fixture(t);
  const version = run('kustomize', ['version']);
  if (version.error?.code === 'ENOENT') { t.skip('kustomize absent; structural coverage only'); return; }
  assert.equal(version.status, 0, version.stderr);
  // Synthetic offline-only image identity, never written to a shipped template.
  const digest = hash('same synthetic artifact in dev and prod'); const tag = `sha-${'2'.repeat(40)}`;
  const image = 'registry.example.com/apps/fixture';
  const images = [];
  for (const env of ['dev', 'prod']) {
    const dir = path.join(f.root, env); fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'kustomization.yaml'), `apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nresources: [pod.yaml]\nimages:\n- name: ${image}\n  newTag: UNRELEASED\n`);
    fs.writeFileSync(path.join(dir, 'pod.yaml'), `apiVersion: v1\nkind: Pod\nmetadata:\n  name: fixture\nspec:\n  containers:\n  - name: app\n    image: ${image}\n`);
    const edit = run('kustomize', ['edit', 'set', 'image', `${image}=${image}:${tag}@${digest}`], { cwd: dir });
    assert.equal(edit.status, 0, edit.stderr);
    const source = fs.readFileSync(path.join(dir, 'kustomization.yaml'), 'utf8');
    assert.ok(source.includes(`newTag: ${tag}`)); assert.ok(source.includes(`digest: ${digest}`));
    const build = run('kustomize', ['build', dir]); assert.equal(build.status, 0, build.stderr);
    assert.ok(build.stdout.includes(`${image}:${tag}@${digest}`)); images.push(build.stdout.match(/image: (.+)/)[1]);
  }
  assert.equal(images[0], images[1]);
});

test('build: actual scan script stops on HIGH/CRITICAL and records only successful scans', t => {
  const f = fixture(t, 'node'); const oci = ociFixture(f);
  const bin = path.join(f.root, 'tools'); fs.mkdirSync(bin);
  const db = path.join(f.root, 'shared/trivy-cache/db'); fs.mkdirSync(db, { recursive: true });
  fs.writeFileSync(path.join(db, 'metadata.json'), JSON.stringify({ Version: 2, UpdatedAt: new Date().toISOString() }));
  fs.writeFileSync(path.join(db, 'trivy.db'), 'synthetic test DB only');
  fs.writeFileSync(path.join(f.appRepo, 'ops/ci/base-images.json'), JSON.stringify({ node: hash('synthetic test pin'), nginx: '' }));
  const stubs = {
    buildctl: `#!/bin/bash
set -eu
printf '%s\\n' build >> "$TEST_CALLS"
cp -R "$TEST_OCI/layout" "$GP_CI_DIR/layout"
cp "$TEST_OCI/build-meta.json" "$GP_CI_DIR/build-meta.json"
`,
    flock: '#!/bin/sh\nshift\nexec "$@"\n',
    trivy: `#!/bin/bash
set -eu
printf '%s\\n' "$*" >> "$TEST_CALLS"
case "$*" in
  *--download-db-only*) echo 'Unexpected network refresh' >&2; exit 88 ;;
  *--severity*) exit "$TEST_SCAN_EXIT" ;;
  *) while (( $# )); do if [[ $1 == --output ]]; then printf '{}\\n' > "$2"; break; fi; shift; done ;;
esac
`,
  };
  for (const [name, body] of Object.entries(stubs)) { fs.writeFileSync(path.join(bin, name), body); fs.chmodSync(path.join(bin, name), 0o755); }
  const calls = path.join(f.root, 'calls'); const envfile = path.join(f.root, 'env');
  const env = { ...oci.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: f.root, GITHUB_ENV: envfile, GITHUB_SERVER_URL: 'https://git.example.com', GITHUB_REPOSITORY: 'apps/fixture', IMAGE: 'registry.example.com/apps/fixture', BUILDKIT_ADDR: 'stub-only', GP_TRIVY_OFFLINE: '1', GP_TRIVY_SHARED_DIR: path.join(f.root, 'shared'), TEST_OCI: oci.directory, TEST_CALLS: calls };
  for (const exit of ['1', '0']) {
    fs.writeFileSync(envfile, ''); fs.writeFileSync(calls, '');
    const result = run('bash', ['ops/ci/scan-publish.sh', 'scan'], { cwd: f.appRepo, env: { ...env, TEST_SCAN_EXIT: exit } });
    assert.equal(result.status, Number(exit), result.stderr);
    const directory = fs.readFileSync(envfile, 'utf8').trim().slice('GP_CI_DIR='.length);
    const log = fs.readFileSync(calls, 'utf8'); assert.equal((log.match(/^build$/gm) ?? []).length, 1);
    assert.match(log, /--severity HIGH,CRITICAL --exit-code 1/);
    if (exit === '1') { assert.equal(fs.existsSync(directory), false); assert.doesNotMatch(log, /--format cyclonedx/); }
    else {
      assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'scanned.json'))).manifest_digest, oci.manifest.digest);
      assert.ok(fs.existsSync(path.join(directory, 'scan-policy.json')));
      const cleanup = run('bash', ['ops/ci/scan-publish.sh', 'cleanup'], { cwd: f.appRepo, env: { ...env, GP_CI_DIR: directory } });
      assert.equal(cleanup.status, 0, cleanup.stderr); assert.equal(fs.existsSync(directory), false);
    }
  }
});
