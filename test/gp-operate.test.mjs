import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const books = path.join(root, 'docs/runbooks');
const headings = ['Trigger', 'Impact', 'Read-only diagnosis', 'Remediation', 'Rollback', 'Verify', 'Escalation'];
const stable = ['onboard.md', 'deploy-rollback.md', 'slo-burn.md', 'telemetry-missing.md', 'rotate-secrets.md', 'decommission.md'];
const focused = ['rollback.md', 'slo-fast-burn.md', 'slo-slow-burn.md', 'image-scan-failure.md', 'policy-rejection.md', 'argocd-sync-failure.md'];
const prefix = 'kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig"';
const read = file => fs.readFileSync(file, 'utf8');

// Deliberately small shell grammar: direct commands, quoted arguments and line
// continuations. Refuse shell operators/wrappers instead of pretending to parse
// arbitrary shell safely. This checks documentation; nothing is executed.
function shellWords(line) {
  const words = []; let word = ''; let quote = ''; let active = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = '';
      else {
        if (quote === '"' && (c === '`' || (c === '$' && line[i + 1] === '('))) throw new Error('shell substitution');
        word += c;
      }
      continue;
    }
    if (c === "'" || c === '"') { quote = c; active = true; }
    else if (/\s/.test(c)) { if (active) words.push(word); word = ''; active = false; }
    else if (';|&<>`\\'.includes(c) || (c === '$' && line[i + 1] === '(')) throw new Error('shell operator');
    else { word += c; active = true; }
  }
  assert.equal(quote, '', 'unterminated quote');
  if (active) words.push(word);
  return words;
}
function checkCommand(line) {
  assert.ok(line.startsWith(`${prefix} `), `explicit readonly kubeconfig required: ${line}`);
  const words = shellWords(line);
  const verb = words[3];
  assert.ok(['get', 'describe', 'logs', 'top', 'events', 'auth'].includes(verb), `write/unknown verb: ${verb}`);
  if (verb === 'auth') assert.equal(words[4], 'can-i', 'auth must be can-i');
  assert.ok(words.length > 4 || verb === 'events', 'missing command arguments');
  for (const word of words.slice(4)) {
    assert.ok(!/^--(?:kubeconfig|context|server|token|username|password|as(?:-group)?|raw|certificate-authority|client-key|client-certificate)(?:=|$)/.test(word), `credential/endpoint override: ${word}`);
    assert.ok(!/^(?:--template(?:=|$)|(?:-o|--output=)?(?:go-template|jsonpath)-file)/.test(word), 'file-backed output forbidden');
  }
  if (['get', 'describe'].includes(verb)) {
    assert.ok(!words[4].split(',').some(kind => /^(?:secrets?)(?:\/|$)/.test(kind)), 'Secret read forbidden');
  }
}
function checkDiagnosis(source) {
  const section = source.split('## Read-only diagnosis\n')[1]?.split('\n## ')[0];
  assert.ok(section?.trim(), 'missing diagnosis');
  let commands = 0;
  const inspect = text => {
    for (const line of text.replace(/\\\r?\n\s*/g, ' ').split('\n')) {
      if (!/\bkubectl\b/.test(line) || line.trimStart().startsWith('#')) continue;
      checkCommand(line.trim()); commands++;
    }
  };
  // Check all fenced languages, so changing a fence label cannot evade the gate.
  const prose = section.replace(/```[^\n]*\n([\s\S]*?)```/g, (_, code) => { inspect(code); return ''; });
  const remaining = prose.replace(/`([^`\n]+)`/g, (_, inline) => { inspect(inline); return ''; });
  inspect(remaining); // Indented/unfenced commands cannot bypass the gate.
  assert.ok(commands > 0, 'each runbook needs executable read-only inspection');
}
function indexTargets(directory) {
  const index = read(path.join(directory, 'README.md'));
  const targets = [...index.matchAll(/\[[^\]\n]+\]\(([^)]+\.md)\)/g)]
    .map(m => m[1]).filter(target => !target.includes('/'));
  assert.ok(targets.length > 0, 'empty index');
  for (const target of targets) {
    assert.notEqual(target, 'README.md', 'body must not be index');
    assert.ok(fs.statSync(path.join(directory, target)).isFile(), `missing ${target}`);
  }
  return targets;
}

test('every indexed runbook exists, and all bodies are indexed including stable filenames', () => {
  const targets = indexTargets(books);
  assert.equal(new Set(targets).size, targets.length, 'duplicate index entry');
  for (const file of [...stable, ...focused]) assert.ok(targets.includes(file), `missing planned operation ${file}`);
  const bodies = fs.readdirSync(books).filter(f => f.endsWith('.md') && f !== 'README.md');
  assert.deepEqual([...targets].sort(), bodies.sort());
});

test('every runbook has the seven ordered substantive sections and readonly diagnosis', () => {
  for (const file of fs.readdirSync(books).filter(f => f.endsWith('.md') && f !== 'README.md')) {
    const source = read(path.join(books, file));
    assert.deepEqual([...source.matchAll(/^## (.+)$/gm)].map(m => m[1]), headings, file);
    for (const heading of headings) {
      const body = source.split(`## ${heading}\n`)[1].split('\n## ')[0].trim();
      assert.ok(body.length > 60, `${file}: empty ${heading}`);
    }
    assert.match(source, /Owner:/, file);
    assert.match(source, /VERIFY item/, file);
    assert.match(source, /Open —/, file);
    assert.match(source.split('## Remediation')[1].split('## Verify')[0], /needs operator approval/, file);
    checkDiagnosis(source);
  }
});

test('diagnosis guard rejects writes, shell chains, credential overrides and hidden file reads', () => {
  for (const suffix of ['apply -f resource.yaml', 'delete pods x', 'rollout restart deployment x',
    'exec pod -- id', 'port-forward svc/x 8080:80', 'auth reconcile -f role.yaml',
    'get pods; kubectl delete pods x', 'get pods | sh', 'get pods --context admin',
    'get pods --kubeconfig other', 'get --raw=/api/v1/namespaces/default/secrets',
    'get secrets -o yaml', 'get pods -o jsonpath-file=/tmp/private',
    'get pods --template=/tmp/private', 'get pods "$(touch /tmp/x)"']) {
    assert.throws(() => checkCommand(`${prefix} ${suffix}`), suffix);
  }
  assert.throws(() => checkCommand('kubectl get pods'));
  assert.throws(() => checkDiagnosis(`## Read-only diagnosis\n    ${prefix} delete pods x\n## Remediation\n`));
  assert.throws(() => checkCommand(`sudo ${prefix} get pods`));
  for (const suffix of ['get pods', 'describe deployments x', 'logs pod/x --tail=50 --since=15m',
    'top pods', 'events -n fixture-dev', 'auth can-i get pods -n fixture-dev']) checkCommand(`${prefix} ${suffix}`);
  checkDiagnosis(`## Read-only diagnosis\n\n\`\`\`sh\n${prefix} \\\nget pods\n\`\`\`\n## Remediation\n`);
  assert.throws(() => checkDiagnosis(`## Read-only diagnosis\n\n\`${prefix} delete pods x\`\n## Remediation\n`));
});

test('index gate fails on a missing body (temporary fixture)', t => {
  const scratch = path.join(root, '.gp-tmp');
  fs.mkdirSync(scratch, { recursive: true });
  const temp = fs.mkdtempSync(path.join(scratch, 'gp-operate-index-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  fs.writeFileSync(path.join(temp, 'README.md'), '[onboard](onboard.md)\n');
  assert.throws(() => indexTargets(temp));
  fs.writeFileSync(path.join(temp, 'onboard.md'), '# fixture');
  assert.deepEqual(indexTargets(temp), ['onboard.md']);
});

test('SRE documentation instantiates real file/alert/replay shapes without executing tools', () => {
  const dir = path.join(root, 'docs/sre-scenarios/TEMPLATE');
  const instantiate = text => text.replaceAll('__TENANT__', 'fixture').replaceAll('__ENV__', 'dev')
    .replaceAll('__ALERTNAME__', 'FixtureAvailabilityFastBurn').replaceAll('__PAGE_RECEIVER__', 'page-fixture');
  const scenario = JSON.parse(instantiate(read(path.join(dir, 'scenario.json'))));
  assert.match(scenario.id, /^[a-z0-9][a-z0-9-]*$/);
  for (const key of ['title', 'description', 'failureClass', 'expectedRootCause']) assert.ok(scenario[key].length);
  assert.equal(scenario.mode, 'triage');
  assert.equal(scenario.alertProvenance, 'constructed');
  assert.equal(scenario.answerKey, 'frontier-provisional');
  assert.equal(scenario.provenance, undefined, 'no fabricated run provenance');
  assert.deepEqual(scenario.dynamicRefs, []);
  assert.deepEqual(scenario.expectedToolFailures, []);
  assert.deepEqual(scenario.rubric.incidentTimeOnly, []);
  assert.equal(scenario.rubric.emptyVectorRule, true);
  assert.ok(scenario.rubric.rootCause.patterns.length > 0);
  for (const key of ['alert', 'replay', 'knownGoodReport', 'knownBadReport']) {
    const filename = scenario.files[key];
    assert.equal(path.basename(filename), filename, 'contained file pointer');
    assert.ok(fs.statSync(path.join(dir, filename)).isFile());
  }
  for (const report of ['knownGoodReport', 'knownBadReport']) {
    const text = read(path.join(dir, scenario.files[report]));
    assert.deepEqual([...text.matchAll(/^## (.+)$/gm)].map(m => m[1]),
      ['Symptom', 'Evidence', 'Probable cause (ranked)', 'Suggested runbook', 'Confidence']);
    assert.ok(scenario.rubric.rootCause.patterns.some(p => !new RegExp(p.pattern, p.flags ?? 'i').test(text)), 'unpopulated report cannot pass');
  }
  const alert = JSON.parse(instantiate(read(path.join(dir, scenario.files.alert))));
  assert.equal(alert.version, '4');
  assert.equal(alert.status, 'firing');
  assert.ok(alert.alerts.length);
  for (const item of alert.alerts) {
    assert.equal(item.labels.tenant, 'fixture');
    assert.equal(item.labels.env, 'dev');
    assert.equal(item.labels.namespace, 'fixture-dev');
    assert.equal(item.labels.severity, 'critical');
    assert.deepEqual(item.labels, alert.commonLabels);
    assert.deepEqual(item.annotations, alert.commonAnnotations);
    assert.ok(item.annotations.summary && item.annotations.description);
    const url = item.annotations.runbook_url;
    assert.match(url, /^https:\/\/github\.com\/leemarkus\/k8s-golden-path\/blob\/main\/docs\/runbooks\/[a-z-]+\.md$/);
    assert.notEqual(path.basename(url), 'README.md');
    assert.ok(read(path.join(root, 'docs/runbooks/README.md')).includes(path.basename(url)));
    assert.ok(fs.statSync(path.join(root, 'docs/runbooks', path.basename(url))).isFile());
    for (const invented of ['startsAt', 'endsAt', 'fingerprint', 'generatorURL']) assert.equal(item[invented], undefined);
  }
  const replay = JSON.parse(instantiate(read(path.join(dir, scenario.files.replay))));
  assert.ok(replay.turns.length);
  let calls = 0;
  for (const turn of replay.turns) {
    assert.ok(turn.text.length);
    for (const use of turn.tool_uses ?? []) {
      calls++;
      assert.equal(use.name, 'kubectl_read');
      assert.ok(['get', 'describe', 'logs'].includes(use.input.subcommand));
      assert.equal(use.input.namespace, 'fixture-dev');
      assert.ok(['deployments', 'pods', 'endpointslices', 'ingresses', 'events'].includes(use.input.resource));
      for (const key of Object.keys(use.input)) assert.ok(['subcommand', 'namespace', 'resource', 'output', 'name', 'tailLines', 'since'].includes(key));
      if (use.input.output) assert.ok(['wide', 'yaml', 'json'].includes(use.input.output));
      if (use.input.subcommand === 'logs') assert.ok(use.input.name && use.input.tailLines);
    }
  }
  assert.ok(calls > 0);
});
