# Image scan failure

Owner: tenant owner (application), platform owner (platform and approval). Scope: one
`TENANT` / `ENV` on homelab unless explicitly expanded. Operational
instructions, not evidence of activation; live activation owns the live drill.

## Trigger

The pre-publication Trivy OCI/image gate fails HIGH/CRITICAL, an allowlist expires, scan database age is unacceptable, or scan evidence is missing.

## Impact

The candidate must not publish/promote. The prior verified artifact remains desired; a missing/stale database is an incomplete scan, not a clean image.

## Read-only diagnosis

```sh
TENANT=fixture # replace with the affected tenant slug
ENV=dev # choose dev or prod from the alert/change request
NS="$TENANT-$ENV"
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" auth can-i get pods -n "$NS"
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" get deployments,pods,services,ingresses -n "$NS" -o wide
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" get events -n "$NS" --sort-by=.metadata.creationTimestamp
```

Record UTC time, tenant/env, current alert state and the exact command outcome.
A Forbidden response, timeout, empty list or old event is missing evidence,
not health. Never switch to write credentials to complete diagnosis. Human
read-only permissions may exceed the SRE agent's namespaced allowlist;
record agent blind spots instead of expanding its access. Logs can contain
application-sensitive data: inspect only the bounded window and redact before
sharing; never inspect Secret data, environment dumps or private keys.

```sh
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" get applications.argoproj.io -n argocd "$NS" -o jsonpath='{.spec.source.targetRevision}{"\n"}{.status.sync.revision}{"\n"}{.status.sync.status}{"\n"}{.status.health.status}{"\n"}{.status.reconciledAt}{"\n"}'
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" get deployments -n "$NS" -o 'custom-columns=NAME:.metadata.name,GENERATION:.metadata.generation,OBSERVED:.status.observedGeneration,DESIRED:.spec.replicas,AVAILABLE:.status.availableReplicas,IMAGE:.spec.template.spec.containers[*].image'
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" get pods -n "$NS" -o 'custom-columns=NAME:.metadata.name,CREATED:.metadata.creationTimestamp,READY:.status.containerStatuses[*].ready,IMAGE:.spec.containers[*].image,IMAGEID:.status.containerStatuses[*].imageID'
```

In the reviewed local gitops checkout, set `GITOPS` to its absolute path. These
commands use existing refs without fetching (record when refs were last refreshed):

```sh
: "${GITOPS:?Set GITOPS to the reviewed local checkout}"
git -C "$GITOPS" log -5 --oneline -- "clusters/homelab/tenants/$TENANT/overlays"
git -C "$GITOPS" rev-parse main deploy
git -C "$GITOPS" rev-list --count deploy..main
git -C "$GITOPS" show "deploy:clusters/homelab/tenants/$TENANT/overlays/$ENV/kustomization.yaml"
```

Compare the app commit, scan receipt, published manifest digest, overlay digest,
Argo source revision and running imageID. Record image-index/platform-manifest
relationships if they differ; a runtime imageID mismatch needs explanation,
never silent acceptance. The Git host (Forgejo) runs outside the cluster, not in a tenant pod. Use its
existing UI for the seven jobs and current remote refs; local refs can be stale.

Inspect the existing CI artifact report, SBOM, database timestamp, scanner version,
OCI digest receipt and reviewed `.trivyignore.yaml` (not credential/config files).
Separate scanner execution failure from a vulnerability verdict; record CVE,
package, fixed version, reachability evidence and exact scanned digest. CI on
the off-cluster Git host uses a host runner: do not look for a tenant Docker daemon.


## Remediation

1. **needs operator approval — source/base update:** update the affected dependency or approved base pin, rerun app tests and build a new single artifact. Scan that artifact and publish only its exact bytes after success.
2. **needs operator approval — narrow exception:** if a CVE cannot immediately be fixed, review a versioned `.trivyignore.yaml` entry naming CVE, reason, owner, expiry and review reference. No blanket ignore-unfixed or severity downgrade. This vulnerability allowlist is not a Kyverno PolicyException.
3. **needs operator approval — cache provisioning:** arrange the approved database/base cache in a network-enabled session if missing. This offline build never downloads it. Repeat the scan with age validation; do not treat infrastructure repair alone as vulnerability clearance.

## Rollback

**needs operator approval:** revert a broken dependency/pin/allowlist change. Keep production on its previous accepted digest; if already deployed and impacted, use [rollback](rollback.md) only after validating the previous artifact's current security disposition.

## Verify

Repeat the relevant read-only commands above after the change and record fresh
payload evidence, not just a successful command or green controller status.

| VERIFY item | Evidence required | Initial status / owner |
|---|---|---|
| V-image-scan-failure-1 | The actual candidate digest has a successful current-DB HIGH/CRITICAL scan, valid scoped ignore entries, SBOM and matching publish receipt; previous failure is retained and no rebuild occurs between scan and publish. | Open — tenant owner / live activation |
| V-image-scan-failure-2 | Record UTC start/end, expected versus observed result, evidence source, current digest/revision, gaps and the platform owner's approval reference for any mutation. | Open — the platform owner |

Close each row separately as observed, failed, blocked or skipped (with reason).
An offline pass never clears a live row. Preserve the sanitized incident record.

## Escalation

Escalate exploitable findings, invalid digest receipts or expired exceptions to the platform owner; withhold publication when the scan cannot establish a verdict. Critical severity goes to **page**; every other severity goes to
the **hourly status board** through the existing null route. No notify tier or
new tenant notification bridge. The cluster board cannot honor cluster silences;
check its source freshness and delivery health before interpreting silence.

See the [index and authorization contract](README.md),
[ADR-0015](../adr/0015-runbooks.md) and [usage](../usage.md).
