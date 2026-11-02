# Tenant platform integration

These are one-time manifests for the cluster's GitOps repository. Live activation owns activation
and requires the platform owner's approval. No command here applies, pushes or contacts the
cluster. Templates continue to contain UNRELEASED until CI supplies a verified
artifact; do not install the ApplicationSet against unreleased tenant directories.

## Destination and install order

1. Review `integration-gitops.patch` against your gitops checkout. It is an
   illustrative diff from the lab's own integration, kept as a worked example. It adds
   tenant Enforce coverage, tenant-aware Kyverno discovery, a blocking rendered
   tenant IaC scan, honest missing-CRD schema exclusions, and platform destinations
   for the first tenant's budgets (`website-dev`/`website-prod`). Register
   explicit destinations for later tenants. Adapt it rather than applying it as-is.
   Existing gitops kustomize-overlay discovery already covers tenant paths.
2. In an authorized change, copy `appproject-tenants.yaml` into
   `clusters/homelab/apps/`. Promote and confirm the project exists before
   any Application references it. Verify negated namespace destinations against
   the installed Argo version: HQ and protected namespaces must be rejected,
   tenant-dev/prod accepted, and cluster-scoped resources denied. The fence is
   for a single operator, not hostile tenant isolation.
3. Copy `tenant-namespaces/kustomization.yaml` into
   `clusters/homelab/tenant-namespaces/` once. For each generated tenant, add
   its directory to that aggregator, e.g. `resources: [website]`. gp generates
   each tenant's subdirectory but never overwrites this shared index. Copy
   `application-tenant-namespaces.yaml` into `apps/`. Its existing platform project
   allows the empty Application destination; the new explicit per-namespace
   entries allow the namespaced quotas and LimitRanges. Manually sync it and
   confirm Namespace/PSS, quota, LimitRange and workload-default exist first.
4. Complete first-tenant acceptance. Confirm static UID/GID 101 or Node UID/GID 1000 works with
   the runtime, `/tmp` is its writable path, all health probes pass, observe is
   composed, the image digest is verified, and separate dev/prod registry
   SealedSecrets are included. Provision internal DNS and NPM TLS/routing using
   HQ's HTTP ingress boundary. No public forwarding is authorized.
5. Only after those prerequisites and live activation approval, copy
   `applicationset-tenants.yaml` into `apps/`, promote through the gitops gate,
   and verify actual generated Applications. Dev automates prune/selfHeal; prod
   has no automated block and requires human digest promotion and sync. The
   directory generator enumerates only dev/prod. Both generator and sources
   follow deploy. Namespaces are never auto-created by tenant Applications.
6. Prove routing, metrics discovery, NetworkPolicy allowed/denied traffic and a
   negative Kyverno admission control in a tenant namespace. It must be rejected
   by Kyverno, not merely by PSS. Verify fresh private-image pulls and the running
   digest before claiming live acceptance.

`kustomization.yaml` here is for local rendering/inspection. The existing root
Application uses recursive directory mode for apps/: copy only the three Argo
resource files there, not this Kustomization, this README or the patch. Sync waves
alone cannot sequence independent Applications; use separate promotions and
readiness checks. Platform namespace sync stays manual, Namespace prune is
false, and ApplicationSet resource preservation is true with no child cascade
finalizer. Decommission requires an explicit reviewed runbook action.

## Local checks and limits

`node --test test/gp-deploy.test.mjs` generates both kinds with the real gp CLI,
parses rendered YAML using Ruby's standard-library YAML parser, verifies quota
headroom, selectors, hardening, same-digest rendering, platform structure and
positive/negative Kyverno controls. There are no npm dependencies. Missing local
external test tools are explicit skips. `make verify` invokes the full fixture
harness, including Trivy config. The local Argo client version is not evidence of
the installed server version; appset generate needs a server and was not run.
Structural assertions are not a CRD schema or live controller validation.

The live policy file currently yields five Audit passes per tenant overlay,
zero Enforce failures and zero Audit warnings; it does not yet enforce tenants.
The verifier uses --audit-warn to report those violation classes separately and
still blocks any warning under ADR-0013. No policy exception was needed.

Kubeconform is installed at v0.8.0. By default it uses an empty local schema
location with -ignore-missing-schemas and reports SKIP. To use pre-provisioned
schemas, set GP_KUBECONFORM_SCHEMA_DIR to a local directory containing the
`{{.ResourceKind}}{{.KindSuffix}}.json` filenames expected by kubeconform. No
HTTP schema fallback is used. Trivy uses embedded checks without downloads.

## Metrics

Optional ServiceMonitor expects an explicitly reviewed metrics Service label,
named Service/container port `metrics`, and `/metrics` endpoint. The default
monitoring NetworkPolicy allows that named port; neither default app enables it.
