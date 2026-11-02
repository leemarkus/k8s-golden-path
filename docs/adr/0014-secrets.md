# ADR-0014 — Sealed-secrets without secret-emitting scaffolds

## Status

Accepted design; implemented by the guard and runbook stages.

## Date

2026-10-03

## Context

Gitops ADR 0001 selected one secrets system after an audit found undeclared secrets. HQ’s private registry pull credential is already namespaced and sealed.

## Decision

Inherit sealed-secrets. Each tenant-env receives its own strictly namespace/name-bound SealedSecret for `forgejo-registry` of type kubernetes.io/dockerconfigjson, using a read:package credential from an appropriately constrained identity. Deployment refers to that name via imagePullSecrets. The same secret name in dev/prod does not make ciphertext portable: seal separately for each namespace.

`gp` emits no Secret, dummy credential, ciphertext, .env file or private key. The runbook stage’s onboarding/rotation runbook contains a human-owned sealing step with controller public certificate and stdin-only plaintext, never plaintext on disk/argv/logs. This repository never reads .env, .secrets or sealed-secret plaintext. A generated overlay must not reference a nonexistent sealed file: adding the sealed manifest and kustomization resource is a deliberate onboarding step before live acceptance. Controller key escrow/recovery remains platform-owned.

## Alternatives considered

- **SOPS/KSOPS:** Rejected. Already rejected by gitops ADR 0001; adds Argo customization and a second key escrow path.
- **External Secrets/Vault now:** Rejected. Introduces an unneeded service/provider and operational lifecycle.
- **Generate placeholder/plaintext Secret YAML:** Rejected. Risks committed credentials and gives a false impression a pull secret is ready.

## Consequences

Offline rendering may precede sealing, but live onboarding cannot. Rotation affects all actual consumers and must verify successful pulls, not only secret existence.

## Evidence

Sources are the lab's private repositories (cluster GitOps, alert routing, the reference service and the SRE agent); their paths are omitted from this public copy.

## Verification

The guard stage asserts no plaintext Secret and correct imagePullSecrets reference; the runbook stage documents sealing without secrets; live activation verifies a new pod pulls successfully after sealing/rotation.

## Implementation notes (the guard stage, 2026-10-03)

The generated SEALED-SECRET-PLACEHOLDER.md is documentation only. No YAML Secret,
SealedSecret, dummy credential or absent-file resource reference is emitted.
The workload names forgejo-registry; a human must seal separately for dev/prod
and add ciphertext plus its overlay reference before the consuming workload is
activated. Tests inspect rendered resources and assert the pull-secret name and
absence of Secret/SealedSecret resources. Pull success, rotation and escrow are
unproven here and remain responsibilities of the runbooks and live activation.
