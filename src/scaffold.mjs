import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, placeholders } from './render.mjs';
import { safePath, inside, walk } from './files.mjs';

export const repoRoot = fileURLToPath(new URL('../', import.meta.url));
export const kinds = ['static', 'node'];
// Each on-disk receipt is anchored to its own directory, not the generating cwd.
export function receiptFor(directory, receipt) {
  return { ...receipt, version: 2, ...Object.fromEntries(
    ['appRepo', 'gitops', 'tenantDir'].map(key => [key, path.relative(directory, receipt[key]) || '.'])) };
}
export function planNew({ tenant, kind, appRepo, gitops, imageDigest = process.env.GP_IMAGE_DIGEST, templateRoot = path.join(repoRoot, 'templates') }) {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(tenant ?? '') || tenant.length > 48) {
    throw new Error('Tenant must be a lowercase DNS slug, 1–48 characters');
  }
  if (!kinds.includes(kind)) throw new Error(`Unknown kind: ${kind}; choose static or node`);
  if (!appRepo || !gitops) throw new Error('--app-repo and --gitops are required');
  appRepo = safePath(appRepo); gitops = safePath(gitops);
  if (appRepo === gitops || appRepo.startsWith(`${gitops}/`) || gitops.startsWith(`${appRepo}/`)) {
    throw new Error('App and gitops roots must be separate, non-overlapping directories');
  }
  for (const root of [appRepo, gitops]) {
    if (fs.existsSync(root) && !fs.statSync(root).isDirectory()) throw new Error(`Not a directory: ${root}`);
  }
  const tenantDir = inside(gitops, `clusters/homelab/tenants/${tenant}`);
  const values = {
    tenant, kind, run_as_user: kind === 'static' ? 101 : 1000, port: kind === 'static' ? 8080 : 3000,
    image: `registry.example.com/apps/${tenant}`, image_tag: 'UNRELEASED',
    ...(imageDigest === undefined ? {} : { image_digest: imageDigest }),
    slo_availability: 0.995, slo_latency: 0.99, slo_latency_seconds: 0.5,
    health_path: '/healthz', priority_class: 'workload-default',
  };
  // Validate supplied pins even when the current template set does not use them.
  render('', values);
  const files = [];
  const mappings = [
    [`app/${kind}`, appRepo], ['ci', appRepo], ['deploy/base', path.join(tenantDir, 'base')],
    ['observe', path.join(tenantDir, 'base/observe')], ['guard', path.join(tenantDir, 'base/guard')],
    ...['dev', 'prod'].map(env => [`deploy/overlays/${env}`, path.join(tenantDir, `overlays/${env}`), env]),
    // Cluster-scoped namespaces belong to the platform, outside tenant Applications.
    ['namespaces', path.join(gitops, 'clusters/homelab/tenant-namespaces', tenant)],
  ];
  for (const [source, destination, env] of mappings) {
    const root = path.join(templateRoot, source);
    for (const file of walk(root)) {
      if (!file.endsWith('.tmpl') && !file.endsWith('.raw')) continue;
      const context = { ...values, ...(env ? { env, host: `${tenant}-${env}.apps.example.com` } : {}) };
      for (const key of Object.keys(context)) {
        if (!placeholders.includes(key)) throw new Error(`Undocumented scaffold placeholder: ${key}`);
      }
      const relative = render(path.relative(root, file).replace(/\.(tmpl|raw)$/, ''), context);
      files.push({ path: inside(destination, relative), content: file.endsWith('.raw')
        ? fs.readFileSync(file, 'utf8') : render(fs.readFileSync(file, 'utf8'), context, {
          forgejoExpressions: source === 'ci' && /^\.forgejo\/workflows\/[^/]+\.ya?ml\.tmpl$/.test(path.relative(root, file)),
        }),
        mode: fs.statSync(file).mode & 0o777 });
    }
  }
  const receipt = { version: 2, tenant, kind, appRepo, gitops, tenantDir, templateFiles: files.length };
  for (const root of [appRepo, tenantDir]) files.push({ path: inside(root, 'gp.json'), content: `${JSON.stringify(receiptFor(root, receipt), null, 2)}\n`, mode: 0o644 });
  const seen = new Set();
  for (const file of files) {
    safePath(file.path);
    if (seen.has(file.path)) throw new Error(`Duplicate output: ${file.path}`);
    seen.add(file.path);
    if (fs.existsSync(file.path)) throw new Error(`Refusing to overwrite: ${file.path}`);
    let parent = path.dirname(file.path);
    while (!fs.existsSync(parent)) parent = path.dirname(parent);
    if (!fs.statSync(parent).isDirectory()) throw new Error(`Not a directory: ${parent}`);
  }
  return { files, receipt };
}
export function writePlan(plan) {
  const written = [];
  try {
    for (const file of plan.files) {
      safePath(file.path);
      fs.mkdirSync(path.dirname(file.path), { recursive: true });
      fs.writeFileSync(file.path, file.content, { flag: 'wx', mode: file.mode });
      written.push(file.path);
    }
  } catch (error) {
    for (const file of written.reverse()) fs.unlinkSync(file);
    throw error; // Empty directories may remain; never delete a pre-existing file.
  }
}
