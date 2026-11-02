# Per-tenant SLO-burn scenario TEMPLATE

**Constructed, synthetic, ungraded, unexecuted.** This is documentation outside
SRE's scenario enumeration, not a captured incident or a runnable acceptance test.
The website instance belongs to first-tenant acceptance, at
`tenants/<tenant>/scenarios/<tenant>-slo-burn/`. Live activation separately owns any live drill.
Creation is not permission to run the agent: even SRE replay `--dry-run` invokes
real tools against the cluster. Its runtime stays outside the cluster with read-only
credentials and narrower access than the platform owner's human readonly kubeconfig.

## Files and substitution

The real SRE shape is six files: [scenario.json](scenario.json),
[alert.json](alert.json), [replay.json](replay.json), [known-good.md](known-good.md),
[known-bad.md](known-bad.md) and this README. Replace documentation markers manually:

| Marker | Required value |
|---|---|
| `__TENANT__` | Actual validated lowercase tenant slug |
| `__ENV__` | dev or prod |
| `__ALERTNAME__` | Exact generated/observed fast-burn alert name, not a guessed name |
| `__PAGE_RECEIVER__` | Actual critical receiver name from reviewed routing, not a secret topic |

These are documentation markers, **not** additions to gp's placeholder table.
There are no `.tmpl`/`.raw` assets or generator changes for scenarios. After
substitution, scenario id and tool namespaces must be valid slugs. File pointers
must remain within the scenario directory. The absolute runbook_url resolves
to [fast burn](../../runbooks/slo-fast-burn.md); live activation must verify its reachability
before enabling live alerts. For a warning
instance select the slow-burn body, warning severity and actual null receiver;
never resurrect the historical sample's retired notify receiver.

scenario.json includes the lab's required `failureClass` and
`expectedRootCause` as well as ADR-0015's explanatory `description`. The current
SRE loader does not use `description` for grading. It requires a nonempty
rootCause.patterns array: `(?!)` is an intentionally impossible placeholder,
not an invented cause. Both “known” reports remain templates and fail that check.
An empty or placeholder rubric cannot count as a pass. `answerKey` is explicitly
frontier-provisional, not the loader's human-authored default. No runDir/model/SHA
provenance object is invented because no run produced this template.

## Provenance and incident-time limits

The shape follows the SRE agent's scenario format (a six-file reference scenario,
its scenario loader and its read-only kubectl tool), inspected read-only on
2026-10-03. That agent lives in a private repository.

| Element | Provenance | What is missing |
|---|---|---|
| Alert envelope, labels and annotations | Entirely constructed | Actual firing set, exact rule name and rendered annotations |
| startsAt/endsAt, generatorURL, fingerprint, externalURL | Omitted | No captured timestamp, hash, endpoint or delivery; do not fabricate these |
| Replay turns / tool inputs | Handwritten suggestions | No tool outputs, transcript or model run |
| Expected evidence / ranked causes | Hypotheses for author guidance | Independent measurements and human cause confirmation |
| Rubric / known-good / known-bad | Ungraded placeholders | Frozen evidence-backed discriminators and demonstrated good-pass/bad-fail |
| dynamicRefs / incidentTimeOnly | Empty | No captured perishable names or proven historical-only checks yet |

No current pod/log/event evidence exists here. Later captures may age out or
refer to an old deployment; record observation time separately from incident time.
Only declare incidentTimeOnly for exact check IDs with per-check justification;
it must not turn missing live evidence into a pass. Record precise expected tool
failures only after observing them; never add a catch-all allowance.

## Expected evidence and ranked causes

Capture source and UTC times, tenant/env/SLI, alert firing state, real request
counts, both threshold windows, freshness and ingestion liveness. Availability
requires scoped 5xx/all requests; latency requires the actual 0.5s bucket and
count. An empty vector is a gap until source liveness and selectors are established.
Correlate deployment generation, ready replicas, current digest, endpoints,
events and bounded tenant logs. Use the existing metrics/log tools only in an
authorized SRE session; the documentation replay does not pretend kubectl proves
Prometheus ingestion. Any missing permissions remain explicit blind spots.

These are a starting investigation order, **not a claimed ground-truth ranking**:

1. Candidate release regression: supported by changed digest followed by current
   errors; weakened by no release change, healthy request evidence or recovery
   without rollback.
2. Backend readiness/capacity/network dependency failure: supported by absent
   endpoints, OOM/scheduling/probe events or denied intended flow; weakened by
   contemporaneously healthy backends and request outcomes.
3. Measurement/discovery failure or sparse traffic: supported by stale/absent
   scrape series, rule errors or zero denominator; if those are observed, rank
   this first and mark user impact unknown rather than inventing an outage.

Replace the ordering using the captured evidence; name disconfirming evidence
and unresolved alternatives. Never infer health from missing telemetry or call
an old alert a current incident. Suggested mutations are **needs operator approval** and
must link to the human runbook, not a write-capable tool call.

## Population, freezing and review

First-tenant acceptance copies/substitutes this documentation within its owned tenant directory,
records the field-by-field provenance and incident-time limitations, fills real
expected evidence and ranked causes, and writes specific rootCause/evidence/
forbidden checks. Freeze the rubric against independently observed ground truth
before model evaluation; retain a plausible wrong report that fails root cause,
evidence and empty-vector handling, not merely headings. The runbook stage's JSON/structure
test is not the SRE grader and does not establish either report's grade.

When an authorized harness run retrieves documents, preserve its actual retrieval
transcript (`fixtures/retrieval/<id>.retrieval.json` in the SRE workflow); citations
must quote exactly the fetched document and revision. Keep query/tool transcripts
when captured, label constructed material, and never invent incident-time output
to arm a grading check. Do not edit the read-only SRE repository from this repository.
Before any later SRE evaluation, follow its clean-source/no-concurrent-edits rule
and record the evaluated source commit. Model tuning or runtime changes are out
of scope. **needs operator approval:** any reproduction, request load, failure injection,
rollback or connected replay/drill is a separate scoped action, never authorized
by this documentation template.
