# Usage

Use this path for a stateless HTTP service that can run non-root with a read-only root filesystem and ship to the cluster's internal ingress. Database writers, public exposure, tracing and additional clusters are out of scope ([ADR-0001](adr/0001-scope-and-non-goals.md)).

`gp` scaffolds the static or Node app, its CI, the deploy/guard/observe templates and a `gp.json` receipt. It never deploys anything. The [runbooks](runbooks/README.md) cover operations after that.

## Onboarding in eight steps

1. Choose a tenant slug (a lowercase DNS name, at most 48 characters) and the `static` or `node` kind. Record the owner, internal hosts, resource budget, health endpoint, dependencies and SLO priors. Confirm the service can roll back statelessly.
2. Create two scratch directories and preview: `bin/gp new demo --kind static --app-repo "$PWD/.gp-tmp/demo-app" --gitops "$PWD/.gp-tmp/demo-gitops" --dry-run`. Review every destination.
3. Remove `--dry-run` to generate. Existing output files, overlapping roots, symlinked paths and unknown placeholders are errors, and there is no force flag. For an existing app, scaffold into scratch and merge the reviewed diff by hand.
4. Complete the app's build and CI contract: base-image pins and image tests.
5. Review the dev/prod overlays, namespace bootstrap, resource budget, deny-by-default networking, internal TLS and host, SLOs and runbook links. Supply a verified image digest; a guessed pin is never deployable. Platform declarations must create namespaces before the tenant Applications. The [gitops integration patch](../platform/integration-gitops.patch) shows the one-time platform change.
6. Follow the human-owned sealing step in the [onboarding](runbooks/onboard.md) and [registry rotation](runbooks/rotate-secrets.md) runbooks. `gp` emits no credential or sealed manifest. Seal dev and prod separately, and commit the ciphertext together with the resource that consumes it.
7. Run `bin/gp verify <app-dir>` (or point it at `<gitops>/clusters/homelab/tenants/<tenant>`) and `make verify`. Read each PASS, FAIL and SKIP; an exit of 0 with INCOMPLETE is not acceptance. Fill in the synthetic SRE scenario and check the runbook links.
8. Review the actual diffs, digest receipts and gate output. Activation is a separate, approved step: gitops push, pipeline publication, Argo CD sync, private ingress proof and an alert and runbook drill. Generating files or committing locally approves nothing.

## What the completed path gives you

A reviewed image/CI definition, base and two overlays, namespace isolation and quotas, internal ingress, generated availability/latency SLO definitions, inherited logs, a dashboard, policy validation, runbooks and a read-only SRE scenario. It reuses the lab controllers rather than installing a separate stack per tenant. These templates and documents exist; runtime activation is a separate step.

## Deviations and upgrades

Record the need, lab evidence, at least two alternatives, consequence and verification in an ADR before changing the supported contract. A policy exception also needs a scoped PolicyException with owner, expiry and removal test; passing a custom policy copy is not conformance. The live gitops file remains the oracle. Non-policy deviations still need an ADR but do not invent meaningless PolicyExceptions.

Generated files belong to the receiving repository. For an upgrade, scaffold the new version into fresh scratch directories, compare and review a normal diff, rerun all gates, then promote through gitops. gp deliberately has no overwrite/update command. `.raw` templates preserve native CI/controller expressions; `.tmpl` files have strict placeholder checks. See [template contract](template-contract.md).

## Lifecycle

**Dev:** main app CI scans/publishes one artifact and commits the verified tag+digest to the gitops dev overlay. Gitops validates and advances deploy; dev auto-syncs with prune+selfHeal. Check actual running digest, readiness and ingress, not just CI success.

**Prod:** after dev acceptance, a human selects that same digest, updates prod, waits for the gitops gate and manually syncs prod. Neither a rebuild nor a tag retarget is promotion. Rollback selects the prior known-good digest through the same path; the [deploy/promote](runbooks/deploy-rollback.md) and [rollback](runbooks/rollback.md) runbooks give the operational sequence.

**Decommission:** record owner approval, stop promotions and traffic, remove the ApplicationSet directory with resource preservation, explicitly delete the intended namespaced resources/Application after review, revoke registry credentials, remove platform namespace declarations last, and retain the audit/runbook/scenario history. Confirm DNS/routes, alerts and resources are gone and other tenants still work. This destructive operation is never a side effect of gp new or verify.

## Offline verification inputs

`gp verify` runs the generated app test script, shellcheck, dev/prod Kustomize,
Kyverno against the actual reference policy file and offline Trivy config scans.
Kubeconform uses only local schemas (`GP_KUBECONFORM_SCHEMA_DIR`); missing schemas
are SKIP. Promtool runs the generated check/test suites if installed. kind and
conftest remain explicit supplemental gaps. UNRELEASED is a live blocker, not a
successful release check; it never becomes a fabricated digest for fixture gates.

Docker base pins resolve in this order: `--node-digest` / `--nginx-digest` flags,
`NODE_DIGEST` / `NGINX_DIGEST` environment variables, then generated
`ops/ci/base-images.json` (`node` / `nginx`). Static requires both; Node requires
only NODE_DIGEST. Missing pins produce SKIP with the exact command to run.
Malformed supplied pins fail; with pins present, missing cached images, daemon
access or build errors fail. No pulls or build network are allowed.

```sh
bin/gp verify .gp-tmp/demo-app --node-digest "$NODE_DIGEST" --nginx-digest "$NGINX_DIGEST"
```

Base-image pins do not establish the application artifact digest. CI promotion
sets the dev overlay's `images[].newTag` and `images[].digest`; prod receives that
same verified digest through the manual promotion runbook.
