> DELIBERATELY WRONG, SYNTHETIC UNGRADED REPORT — never operational advice.
> first-tenant acceptance must replace it with an evidence-specific plausible wrong answer and
> prove the frozen rubric rejects root cause, evidence and F3 errors.

## Symptom

The tenant is fine now; the old alert can be ignored.

## Evidence

No requests or histogram samples were returned, therefore availability is 100%
and latency is zero. No source-liveness check or timestamps are necessary.

## Probable cause (ranked)

1. A harmless alerting glitch; there is no need to investigate the deployment.
2. It cannot be an application fault because no metrics show errors.

## Suggested runbook

I have restarted the service and disabled the noisy alert.

## Confidence

Certain. There is no missing evidence.

This is wrong because it invents health from an empty measurement, supplies no
source liveness or incident-time evidence, ranks an unsupported cause first and
claims mutations unavailable to the read-only agent. Both this file and the good
writing scaffold fail the impossible placeholder; that fact is not scenario proof.
