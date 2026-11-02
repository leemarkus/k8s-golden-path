import fs from 'node:fs';
import path from 'node:path';
import { repoRoot, kinds, planNew, writePlan } from '../src/scaffold.mjs';
import { verify, available, execute } from '../src/verify.mjs';
import { walk, safePath } from '../src/files.mjs';

let failed = false;
for (const [command, args] of [
  ['shellcheck', walk(repoRoot).filter(f => f.endsWith('.sh'))],
  ['node', ['--test']], ['node', ['scripts/check-links.mjs', '.']],
]) {
  if (!available(command)) { console.log(`FAIL ${command}: required repository gate is not installed`); failed = true; continue; }
  const result = execute(command, args, { cwd: repoRoot });
  process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
  console.log(`${result.status === 0 ? 'PASS' : 'FAIL'} ${command} ${args.join(' ')}`);
  if (result.status !== 0 || result.error) failed = true;
}
const scratch = path.join(repoRoot, '.gp-tmp'); fs.mkdirSync(scratch, { recursive: true });
const fixture = fs.mkdtempSync(path.join(scratch, 'fixture-'));
try {
  for (const kind of kinds) {
    const appRepo = path.join(fixture, kind, 'app'); const gitops = path.join(fixture, kind, 'gitops');
    const plan = planNew({ tenant: `fixture-${kind}`, kind, appRepo, gitops }); writePlan(plan);
    // Apply the actual reference file, never a bundled or reconstructed policy.
    const reference = process.env.GP_GITOPS_REFERENCE ?? path.resolve(repoRoot, '../gitops');
    const policy = safePath(path.join(reference, 'clusters/homelab/config/kyverno-policies.yaml'));
    if (fs.existsSync(policy)) {
      console.log(`POLICY SOURCE ${policy}`);
    }
    console.log(`FIXTURE ${kind}: ${plan.receipt.templateFiles} template files`);
    const result = verify(appRepo, { policyPath: policy });
    if (result.failed) failed = true;
    for (const gate of result.results.filter(r => r.status === 'SKIP')) {
      const allowed = (gate.name === 'docker build' && gate.reason.startsWith('unset '))
        || (gate.name.startsWith('kubeconform ') && gate.reason.includes('missing schemas are not validation'))
        || (['kind', 'promtool', 'conftest'].includes(gate.name) && gate.reason.startsWith('not installed'));
      if (!allowed) { console.log(`FAIL unexpected fixture SKIP ${gate.name}: ${gate.reason}`); failed = true; }
    }
  }
} finally { fs.rmSync(fixture, { recursive: true, force: true }); }
process.exitCode = failed ? 1 : 0;
