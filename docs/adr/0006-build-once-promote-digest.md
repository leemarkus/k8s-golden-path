# ADR-0006 — Build once and promote by digest

## Status

Accepted design; implemented by the build stage.

## Date

2026-10-03

## Context

HQ now publishes the exact OCI layout it scanned. Its promotion writes a SHA tag and a digest audit message; tag-only deployment is a remaining distinction from immutable identity.

## Decision

One image per app commit and build contract, tagged `sha-<full git SHA>` in `registry.example.com/apps/<tenant>`. Scan the OCI layout, record its manifest digest, and publish those exact bytes. Do not rerun a build to publish. Internal/public audiences are separate artifacts; this path publishes only the internal artifact.

On successful main publication, CI commits only the dev overlay’s image entry in gitops: `newTag: sha-<SHA>` for audit plus `digest: sha256:<verified digest>` for deployment. Rendered Pod images must use `@sha256:`; the digest is authoritative. The commit names commit SHA and digest. One rebase/retry is allowed, never force-push or edits to prod. CI has registry and dedicated gitops-bot credentials but no kubeconfig, service-account token or ArgoCD credential. Forgejo credential containment comes from bot identity and repo membership, not a presumed per-repository PAT scope.

Gitops’s seven checks gate a fast-forward of `deploy`; ApplicationSet and child sources both track `deploy`. After dev acceptance, a human promotes the exact digest to prod and manually syncs it. Rollback restores a previously verified digest through the same gitops gate. A local commit or green app CI is not proof of deployment. No gitops clusters/main push without the platform owner’s yes because green CI auto-advances deploy.

## Alternatives considered

- **Rebuild for prod:** Rejected. Can change bytes after scanning; the lab's first iteration learned this the hard way.
- **Deploy mutable SHA/latest/semver tags alone:** Rejected. A tag can be overwritten; cannot prove scanned/deployed identity.
- **Give CI kubectl or ArgoCD deploy rights:** Rejected. Bypasses the lab promotion boundary and widens cluster reach.

## Consequences

Intentional tightening of HQ’s tag-only overlay. Promotion tooling must compare scan/publish/deploy digests and preserve the same image across environment changes.

## Evidence

Sources are the lab's private repositories (cluster GitOps, alert routing, the reference service and the SRE agent); their paths are omitted from this public copy.

## Verification

The build stage tests digest equality and racing push failure; the deploy stage renders @sha256 images; first-tenant acceptance demonstrates dev-to-prod and rollback without rebuilding; live activation observes running imageID.

## Implementation notes (the build stage, 2026-10-03)

Extracted HQ's host label (`docker`), BuildKit TCP address, OCI verifier/stdlib
registry client, and clone/kustomize/bot-commit/one-rebase-retry promotion.
Differences implement this Decision: full 40-character SHA tags, HIGH/CRITICAL
including unfixed findings, tag plus authoritative digest in the tenant dev
entry, and a post-push manifest GET that verifies both digest header and bytes.
Registry authentication references REGISTRY_TOKEN; gitops uses GITOPS_TOKEN via
askpass instead of HQ's token-bearing URL. No cluster credentials are generated.
Manual prod PR instructions copy the accepted dev tag and digest unchanged.

The image_digest placeholder is optional, strictly validated, and never defaulted:
programmatic imageDigest or CLI GP_IMAGE_DIGEST supplies verified evidence.
Missing pins remain a rendering error when a template needs one. Existing token
values and .raw semantics are unchanged. CI workflow .tmpl content alone opts in
to preserving native Forgejo expressions; ordinary unknown tokens still fail.
Alternatives were changing all CI files to .raw (loses tenant substitution) or
relaxing the global renderer (weakens every other template); the narrow option retains
both contracts. Workflow content uses JSON syntax (valid YAML), allowing Node
to parse and validate its job graph without adding a YAML dependency. Offline fixtures test artifact mutation and publication digest
mismatch, dev push races, and workflow structure; activation remains live activation.
