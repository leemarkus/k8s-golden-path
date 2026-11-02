# ADR-0013 — The live Kyverno set is the policy oracle

## Status

Accepted design; implemented by the guard stage.

## Date

2026-10-03

## Context

The lab already validates rendered overlays against Kyverno and treats violation totals as blocking. Current namespace Enforce overrides explicitly name HQ/ci/default/forgejo; new tenant namespaces do not automatically inherit Enforce.

## Decision

Use the gitops checkout’s `clusters/homelab/config/kyverno-policies.yaml`, not a golden-path copy or reconstructed schema. Apply it to full rendered dev/prod resources with the local Kyverno CLI; require process success, a nonzero pass count and zero fail/warn/error counts. No registry or cluster flags. The guard stage must add reviewed tenant namespace enforcement coverage in the future gitops change and prove a negative admission control at live activation; offline conformance alone does not prove live enforcement.

Exceptions require their own ADR documenting the exact policy/rules, namespace/resources, evidence, compensating control, owner, expiry and removal test; implement a narrowly scoped PolicyException. No blanket exclusions, silent Audit flip or forked policy file. The guard stage must check installed Kyverno PolicyException feature/API support and test the exception with the same CLI context; unsupported exceptions block onboarding, never weaken the shared policy. Other security guarantees (PSS, networking, immutable digest, namespace fence) need their own checks where the current oracle does not cover them.

## Alternatives considered

- **Golden-path copies of ClusterPolicies:** Rejected. Drifts away from the cluster’s oracle; later policy updates can invalidate apparently green tenants.
- **Conftest/custom lint only:** Rejected. A second language misses Kyverno autogen, preconditions and enforcement semantics.
- **Global namespace exclusions for exceptions:** Rejected. Removes unrelated controls and obscures the intended expiry.

## Consequences

New tenants must pass even Audit policies offline. Live enforcement expansion and exception support are later work, clearly distinct from this foundation.

## Evidence

Sources are the lab's private repositories (cluster GitOps, alert routing, the reference service and the SRE agent); their paths are omitted from this public copy.

## Verification

The guard stage supplies a known-good and deliberately violating fixture; both must reach the real oracle and produce the expected verdict. Live activation checks actual namespace rejection separately from PSS.

## Implementation notes (the guard stage, 2026-10-03)

Verification runs the actual reference file with `kyverno apply --audit-warn`:
Enforce violations appear as fail, Audit violations as warn. Both remain blocking
under this ADR's stricter all-policy requirement; pass must be nonzero and
fail/warn/error must all be zero. Positive fixtures pass all five workload rule
checks. A deliberately latest-tagged fixture produces Audit warn in fixture-dev;
the same offline payload with namespace hq-dev produces Enforce fail. No fixture
is submitted to the cluster. Existing override lists leave new tenants Audit.

`platform/integration-gitops.patch` proposes tenant wildcard Enforce overrides,
rendered tenant discovery/exclusion fixes, a blocking tenant Trivy config gate,
and honest ApplicationSet/PolicyException kubeconform skips for the future
authorized gitops change. This repository cannot change that read-only repository.
The existing generic kustomize-overlays discovery already sees tenants; only
Kyverno's HQ-only discovery and raw-base exclusions needed expansion.

Kubeconform v0.8.0 uses an explicit local-only schema location plus
-ignore-missing-schemas; without a cache it reports SKIP, never PASS. This avoids
the network access its default schema URL would otherwise attempt. Set
GP_KUBECONFORM_SCHEMA_DIR to a pre-provisioned local schema directory to validate.
Trivy uses embedded checks with updates/version checks disabled; this is IaC
validation only, not a fresh image CVE scan.

No PolicyException is needed or emitted. Local CLI help exposes --exception;
the read-only Kyverno values do not explicitly enable exceptions. Cluster/API
support cannot be established offline and must be checked before any future
exception is accepted. No policy was weakened or copied into the templates.
