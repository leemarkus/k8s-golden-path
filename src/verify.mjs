import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { walk, safePath, inside } from './files.mjs';
import { repoRoot } from './scaffold.mjs';

export function available(command) {
  return (process.env.PATH ?? '').split(path.delimiter).some(dir => {
    try { fs.accessSync(path.join(dir, command), fs.constants.X_OK); return true; } catch { return false; }
  });
}
export function execute(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024, ...options });
}
export function policyPassed(output) {
  const summaries = [...output.matchAll(/pass:\s*(\d+),\s*fail:\s*(\d+),\s*warn:\s*(\d+),\s*error:\s*(\d+),\s*skip:\s*(\d+)/g)];
  return summaries.length > 0 && summaries.some(m => Number(m[1]) > 0)
    && summaries.every(m => Number(m[2]) === 0 && Number(m[3]) === 0 && Number(m[4]) === 0);
}
export function configScanned(output) {
  try {
    const report = JSON.parse(output);
    return report.Results?.some(result => result.Type === 'kubernetes') === true
      && report.Results.every(result => !(result.Misconfigurations ?? []).some(
        finding => ['HIGH', 'CRITICAL'].includes(finding.Severity) && finding.Status !== 'PASS'));
  } catch { return false; }
}
export function schemaSummary(output) {
  try {
    const { summary } = JSON.parse(output);
    if (!summary || !['valid', 'invalid', 'errors', 'skipped'].every(key => Number.isInteger(summary[key]) && summary[key] >= 0)) return;
    return summary;
  } catch { return; }
}
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'";
export function dockerBuildPlan(appRepo, source, { nodeDigest, nginxDigest, env = process.env, dockerfile = 'Dockerfile' } = {}) {
  inside(appRepo, dockerfile);
  const pinsPath = safePath(path.join(appRepo, 'ops/ci/base-images.json'));
  const pins = fs.existsSync(pinsPath) ? JSON.parse(fs.readFileSync(pinsPath, 'utf8')) : {};
  const supplied = { NODE_DIGEST: nodeDigest ?? env.NODE_DIGEST ?? pins.node,
    NGINX_DIGEST: nginxDigest ?? env.NGINX_DIGEST ?? pins.nginx };
  const buildArgs = []; const commandArgs = []; const missing = [];
  for (const key of ['NODE_DIGEST', 'NGINX_DIGEST']) {
    const value = supplied[key];
    if (value !== undefined && value !== '' && (typeof value !== 'string' || !digestPattern.test(value))) {
      throw new Error(`Invalid ${key}: expected sha256 plus 64 lowercase hex characters`);
    }
    const token = '${' + key + '}';
    if (!source.includes(token)) continue;
    if (!value) { missing.push(key); commandArgs.push('--build-arg', `"${key}=$` + `{${key}:?set reviewed ${key}}"`); }
    else {
      source = source.split(token).join(value);
      buildArgs.push('--build-arg', `${key}=${value}`);
      commandArgs.push('--build-arg', shellQuote(`${key}=${value}`));
    }
  }
  const command = ['docker build --pull=false --network=none', ...commandArgs,
    '--file', shellQuote(path.join(appRepo, dockerfile)), '--tag gp-verify:local', shellQuote(appRepo)].join(' ');
  return { source, buildArgs, missing, command };
}
export function verify(directory, { has = available, run = execute, log = console.log, policyPath, nodeDigest, nginxDigest, env = process.env } = {}) {
  directory = safePath(directory);
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) throw new Error(`Not a directory: ${directory}`);
  let appRepo = directory; let tenantDir = directory; let gitops; let dockerfileName = 'Dockerfile';
  const receiptPath = safePath(path.join(directory, 'gp.json'));
  if (fs.existsSync(receiptPath)) {
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    if (receipt.dockerfile !== undefined) {
      if (typeof receipt.dockerfile !== 'string' || !/^Dockerfile(?:[.][a-zA-Z0-9_-]+)?$/.test(receipt.dockerfile)) throw Error('Invalid receipt dockerfile');
      dockerfileName = receipt.dockerfile;
    }
    const keys = ['appRepo', 'tenantDir', 'gitops'];
    if (receipt.version === 1 || keys.some(key => typeof receipt[key] === 'string' && path.isAbsolute(receipt[key]))) {
      throw new Error('Legacy absolute gp.json receipt; regenerate with gp new in scratch and reintegrate receipts for the current checkouts');
    }
    if (receipt.version !== 2) throw new Error('Unsupported gp.json version; regenerate receipts with the current gp');
    const roots = keys.map(key => {
      if (typeof receipt[key] !== 'string' || !receipt[key].trim()) throw new Error(`Invalid receipt path: ${key}; regenerate receipts`);
      const root = safePath(path.resolve(directory, receipt[key]));
      if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
        throw new Error(`Receipt directory missing: ${key} (${receipt[key]}) relative to ${directory}; restore the checkout layout or regenerate receipts`);
      }
      return root;
    });
    [appRepo, tenantDir, gitops] = roots;
  }
  const results = [];
  function record(name, status, reason) { results.push({ name, status, reason }); log(`${status} ${name}: ${reason}`); }
  function gate(name, command, args, options = {}, validate) {
    if (!has(command)) { record(name, 'SKIP', `${command} is not installed; installation requires the operator's approval`); return; }
    const result = run(command, args, { cwd: appRepo, ...options });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    if (output.trim()) log(output.trim());
    const ok = result.status === 0 && !result.error && (!validate || validate(result.stdout ?? ''));
    record(name, ok ? 'PASS' : 'FAIL', result.error?.message ?? `exit ${result.status}${validate && !ok ? '; expected evidence absent or failing' : ''}`);
    return ok ? result : undefined;
  }
  const appFiles = walk(appRepo);
  const shell = appFiles.filter(file => file.endsWith('.sh'));
  if (shell.length) gate('shellcheck', 'shellcheck', shell);
  else record('shellcheck', 'SKIP', 'no .sh files');
  const tests = appFiles.filter(file => /(?:^|\/)(?:test|tests)\//.test(file) && /\.(?:mjs|cjs|js)$/.test(file));
  if (tests.length) gate('node --test', 'node', ['--test']);
  else {
    const packageFile = path.join(appRepo, 'package.json');
    const appPackage = fs.existsSync(packageFile) ? JSON.parse(fs.readFileSync(packageFile, 'utf8')) : {};
    if (appPackage.scripts?.test) gate('app test', 'npm', ['--offline', 'test']);
    else record('node --test', 'SKIP', 'no Node tests or package test script in tenant app');
  }
  const manifests = walk(tenantDir);
  const overlays = manifests.filter(file => /\/overlays\/[^/]+\/(?:kustomization\.ya?ml|Kustomization)$/.test(file));
  const tmpRoot = path.join(repoRoot, '.gp-tmp'); fs.mkdirSync(tmpRoot, { recursive: true });
  const temp = fs.mkdtempSync(path.join(tmpRoot, 'verify-'));
  function schemas(name, resource) {
    if (!has('kubeconform')) { record(name, 'SKIP', 'kubeconform is not installed'); return; }
    // Override the default HTTP schema location: ignore-missing alone can still fetch.
    const schemaDir = process.env.GP_KUBECONFORM_SCHEMA_DIR
      ? safePath(process.env.GP_KUBECONFORM_SCHEMA_DIR) : path.join(temp, 'offline-schemas');
    const result = run('kubeconform', ['-strict', '-summary', '-output', 'json',
      '-kubernetes-version', '1.34.0', '-ignore-missing-schemas',
      '-schema-location', path.join(schemaDir, '{{.ResourceKind}}{{.KindSuffix}}.json'), resource], { cwd: appRepo });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    if (output.trim()) log(output.trim());
    const summary = schemaSummary(result.stdout ?? '');
    if (result.status !== 0 || result.error || !summary || summary.invalid || summary.errors) {
      record(name, 'FAIL', result.error?.message ?? `exit ${result.status}; schema evidence missing or invalid`);
    } else {
      record(name, summary.skipped || !summary.valid ? 'SKIP' : 'PASS',
        `${summary.valid} validated, ${summary.skipped} skipped; local schemas only (${schemaDir}); missing schemas are not validation`);
    }
  }
  try {
    if (!overlays.length) {
      for (const name of ['kustomize', 'kyverno', 'trivy config', 'kubeconform']) record(name, 'SKIP', 'no tenant overlays');
    }
    if (overlays.length && !fs.existsSync(path.join(tenantDir, 'base/observe/kustomization.yaml'))) {
      record('observe composition', 'SKIP', 'observe bundle is absent; no observability composition was validated');
    }
    for (const file of overlays) {
      const env = path.basename(path.dirname(file));
      const observe = path.join(tenantDir, 'base/observe');
      if (fs.existsSync(path.join(observe, 'kustomization.yaml'))) {
        const expected = `../../base/observe${env === 'prod' ? '/prod' : ''}`;
        const overlay = fs.readFileSync(file, 'utf8');
        const base = fs.readFileSync(path.join(tenantDir, 'base/kustomization.yaml'), 'utf8');
        record(`observe composition ${env}`, overlay.split(/\r?\n/).some(line => line.trim() === `- ${expected}`)
          && !/^\s*-\s*(?:\.\/)?observe\s*$/m.test(base) ? 'PASS' : 'FAIL',
        `expected ${expected} in overlay only; ServiceMonitor and latency burns remain opt-in`);
      }
      // Remote bases, Helm inflation and plugins are outside the offline contract.
      const kustomizations = manifests.filter(f => /(?:kustomization\.ya?ml|Kustomization)$/.test(f));
      if (kustomizations.some(f => /https?:|git@|github\.com|gitlab\.com|git::|helmCharts:|helmGlobals:|secretGenerator:|\.env\b|\.secrets\b/.test(fs.readFileSync(f, 'utf8')))) {
        record(`kustomize ${env}`, 'FAIL', 'remote bases, Helm and secret inputs are forbidden in offline tenant manifests'); continue;
      }
      const command = has('kustomize') ? 'kustomize' : 'kubectl';
      const rendered = gate(`kustomize ${env}`, command, [command === 'kubectl' ? 'kustomize' : 'build', path.dirname(file)], {}, output => output.includes('kind:'));
      if (!rendered) {
        record(`kyverno ${env}`, 'SKIP', 'render did not succeed'); record(`trivy config ${env}`, 'SKIP', 'render did not succeed'); continue;
      }
      const resourceDir = path.join(temp, env); fs.mkdirSync(resourceDir);
      const resource = path.join(resourceDir, 'rendered.yaml'); fs.writeFileSync(resource, rendered.stdout);
      const ownPolicy = gitops && safePath(path.join(gitops, 'clusters/homelab/config/kyverno-policies.yaml'));
      const policy = policyPath ? safePath(policyPath) : ownPolicy && fs.existsSync(ownPolicy) ? ownPolicy
        : safePath(path.join(process.env.GP_GITOPS_REFERENCE ?? path.resolve(repoRoot, '../gitops'), 'clusters/homelab/config/kyverno-policies.yaml'));
      if (!policy || !fs.existsSync(policy)) record(`kyverno ${env}`, 'SKIP', 'live gitops config/kyverno-policies.yaml is missing; no bundled substitute');
      else {
        const policyText = fs.readFileSync(policy, 'utf8');
        if (/apiCall:|imageRegistry:|service:/.test(policyText)) record(`kyverno ${env}`, 'FAIL', 'policy requires external context; offline adapter/evidence required');
        else {
          log(`POLICY SOURCE ${policy}`);
          log('Kyverno scope: --audit-warn reports Enforce violations as fail and Audit violations as warn. Both block offline acceptance (ADR-0013); this is not live Enforce coverage.');
          gate(`kyverno ${env}`, 'kyverno', ['apply', policy, '--resource', resource, '--audit-warn', '--detailed-results'], {}, policyPassed);
        }
      }
      gate(`trivy config ${env}`, 'trivy', ['config', '--skip-check-update', '--skip-version-check', '--exit-code', '1', '--severity', 'HIGH,CRITICAL', '--format', 'json', '--cache-dir', path.join(temp, 'trivy-cache'), resourceDir], {}, configScanned);
      schemas(`kubeconform ${env}`, resource);
      if (/UNRELEASED/.test(rendered.stdout)) log(`LIVE BLOCKER ${env}: UNRELEASED scaffold; verified image digest and separately sealed registry credential required before live activation (not an offline gate)`);
    }
    if (gitops && overlays.length) {
      const tenant = path.basename(tenantDir);
      const namespaceRoot = path.join(gitops, 'clusters/homelab/tenant-namespaces', tenant);
      if (!fs.existsSync(path.join(namespaceRoot, 'kustomization.yaml'))) record('platform namespaces', 'SKIP', 'platform-owned namespace tree is absent');
      else {
        const command = has('kustomize') ? 'kustomize' : 'kubectl';
        const rendered = gate('platform namespaces', command, [command === 'kubectl' ? 'kustomize' : 'build', namespaceRoot], {}, output => output.includes('kind: Namespace'));
        if (rendered) {
          const resource = path.join(temp, 'namespaces.yaml'); fs.writeFileSync(resource, rendered.stdout);
          schemas('kubeconform namespaces', resource);
        }
      }
    }
    const dockerfile = inside(appRepo, dockerfileName);
    if (!fs.existsSync(dockerfile)) record('docker build', 'SKIP', 'no Dockerfile; image templates pending the build stage');
    else {
      const plan = dockerBuildPlan(appRepo, fs.readFileSync(dockerfile, 'utf8'), { nodeDigest, nginxDigest, env, dockerfile: dockerfileName });
      const { source, buildArgs, missing, command } = plan;
      if (missing.length) record('docker build', 'SKIP', `unset ${missing.join(', ')}; run: ${command}`);
      else if (!has('docker')) record('docker build', 'FAIL', `docker is not installed; run: ${command}`);
      else {
        const bases = [...source.matchAll(/^FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/gim)];
        const aliases = new Set(); let reason;
        if (/^#\s*syntax=|^ADD\s+.*(?:https?:|git@)|--mount=type=(?:secret|ssh)/im.test(source)) reason = 'external frontend, remote ADD, or secret mount requires a reviewed offline build';
        for (const [, base, alias] of bases) {
          if (base !== 'scratch' && !aliases.has(base.toLowerCase())) {
            if (!/@sha256:[a-f0-9]{64}$/.test(base)) reason = `base must be pinned by digest: ${base}`;
            else if (run('docker', ['image', 'inspect', base], { cwd: appRepo }).status !== 0) reason = `base is not cached locally: ${base}; no pull attempted`;
          }
          if (alias) aliases.add(alias.toLowerCase());
        }
        if (!bases.length) reason = 'no literal FROM found';
        const ignore = path.join(appRepo, '.dockerignore');
        if (!fs.existsSync(ignore) || !['.env', '.env.*', '.secrets', '**/.env', '**/.env.*', '**/.secrets'].every(pattern => fs.readFileSync(ignore, 'utf8').split(/\r?\n/).includes(pattern))) reason = 'Docker context must exclude .env, .env.*, .secrets at root and recursively';
        if (reason) record('docker build', 'FAIL', `${reason}; run: ${command}`);
        else {
          // Do not hand a context containing excluded secret paths to the daemon,
          // even if a later .dockerignore negation would re-include them.
          const context = path.join(temp, 'docker-context'); fs.mkdirSync(context);
          for (const file of appFiles) {
            const dest = path.join(context, path.relative(appRepo, file));
            fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(file, dest);
          }
          gate('docker build', 'docker', ['build', '--pull=false', '--network=none', ...buildArgs, '--file', path.join(context, dockerfileName), '--tag', 'gp-verify:local', context]);
        }
      }
    }
    const promDir = path.join(tenantDir, 'base/observe/tests');
    if (has('promtool') && fs.existsSync(path.join(promDir, 'production.test.yaml'))) {
      gate('promtool check', 'promtool', ['check', 'rules', 'production-rules.yaml', 'candidate-alert-rules.yaml'], { cwd: promDir });
      gate('promtool test', 'promtool', ['test', 'rules', 'production.test.yaml', 'candidate.test.yaml'], { cwd: promDir });
    } else record('promtool', 'SKIP', has('promtool') ? 'no observe rule fixtures' : 'not installed');
    for (const tool of ['kind', 'conftest']) {
      record(tool, 'SKIP', has(tool) ? 'installed; supplemental gate not configured (offline schemas/rules required)' : "not installed; installation requires the operator's approval");
    }
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  const failed = results.filter(r => r.status === 'FAIL').length;
  const skipped = results.filter(r => r.status === 'SKIP').length;
  log(`Verification: ${results.filter(r => r.status === 'PASS').length} passed, ${failed} failed, ${skipped} skipped${skipped ? ' — INCOMPLETE; not tenant acceptance or live proof' : ''}`);
  return { results, failed, skipped };
}
