> SYNTHETIC UNGRADED TEMPLATE — a writing scaffold, not a passing answer key.

## Symptom

Fill tenant/env, exact firing alert, incident window, observed user impact and
whether this is measured burn or a failed measurement. No incident was captured.

## Evidence

Fill timestamped tool results and their scope: source liveness, nonzero request
denominator, both burn windows, loaded rule/series selectors, current digest,
readiness/endpoints/events and bounded logs. Separate source sample time from
collection time. Missing vectors, permissions, logs and historical-only evidence
remain named gaps; no invented retrieval citations or outputs.

## Probable cause (ranked)

1. UNESTABLISHED: fill the top cause supported by independent evidence, its
   disconfirming test and residual uncertainty. Current health is unknown here.
2. Fill a plausible alternative and the evidence that ranks it lower.
3. Account for telemetry failure/sparse traffic; promote it to first when evidence
   supports that explanation. Empty measurements cannot establish service health.

## Suggested runbook

Use the tenant's populated fast/slow-burn or no-data runbook. Start with read-only
diagnosis. Any proposed rollout, rollback or configuration change **needs the platform owner's
yes**; include scope, stop conditions, rollback digest and VERIFY evidence. The
SRE agent has not acted and has no write credentials.

## Confidence

Unestablished: the alert and replay are constructed, no incident evidence or tool
result is recorded and the rubric is unpopulated. List which fresh measurement
would change the ranking. This file does not pass the placeholder rubric.
