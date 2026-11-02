# Deploy and promote dev to prod by digest

Owner: tenant owner (application), platform owner (platform and approval). Scope: one
`TENANT` / `ENV` on homelab unless explicitly expanded. Operational
instructions, not evidence of activation; live activation owns the live drill.

## Trigger

A reviewed app commit has passed its checks and the operator wants to release it. This stable planned filename covers deployment/promotion; the dedicated rollback procedure is linked below.

## Impact

Dev auto-sync with prune/selfHeal can roll immediately after green gitops CI advances deploy. Prod keeps the old artifact until the approved human sync.

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
The jobs are yamllint, kubeconform, kustomize-overlays, sealed-secret-check,
kyverno-admission, trivy and helm-template. Confirm they inspect this tenant,
not just the older HQ paths.


## Remediation

1. **needs operator approval — publication:** authorize the app main pipeline. Keep one install/checks job on the host runner; build one OCI artifact, scan HIGH/CRITICAL and produce SBOM/digest receipts, then publish those exact blobs to `registry.example.com/apps/TENANT`. CI has no cluster credentials.
2. **needs operator approval — dev change/push:** the scoped bot changes only the dev overlay image entry: `newTag: sha-<full app SHA>` for audit and `digest: sha256:<verified manifest hash>` as authority. Review the exact diff. CI may rebase/retry once; no force-push. All seven gitops checks must pass before deploy fast-forwards. Both ApplicationSet generator and child source follow deploy.
3. Inspect dev with the commands above, validate internal content/health and telemetry during a representative observation window. Record the accepted digest and previous prod digest before proceeding.
4. **needs operator approval — prod promotion/push:** a human copies the accepted dev tag AND digest into the prod overlay, reviews only that image change and submits through main and the seven checks. Do not rebuild for environment labels or retarget a tag.
5. **needs operator approval — prod sync:** after the expected commit is on deploy, the platform owner selects the generated `TENANT-prod` Application in ArgoCD and syncs that reviewed revision. Prod must have no automated block. Keep CreateNamespace=false and leave platform namespace ownership intact.

## Rollback

**needs operator approval:** follow [rollback](rollback.md) to restore the prior verified tag+digest through main → checks → deploy, followed by manual prod sync. Do not use an imperative rollout undo: dev selfHeal would compete with it.

## Verify

Repeat the relevant read-only commands above after the change and record fresh
payload evidence, not just a successful command or green controller status.

| VERIFY item | Evidence required | Initial status / owner |
|---|---|---|
| V-deploy-rollback-1 | CI scanned and published identical bytes; dev then prod show the intended immutable artifact, current observed generation/ready replicas and private content; Argo reconciled the expected deploy commit and representative SLI evidence is fresh. | Open — tenant owner / live activation |
| V-deploy-rollback-2 | Record UTC start/end, expected versus observed result, evidence source, current digest/revision, gaps and the platform owner's approval reference for any mutation. | Open — the platform owner |

Close each row separately as observed, failed, blocked or skipped (with reason).
An offline pass never clears a live row. Preserve the sanitized incident record.

## Escalation

If deploy lags main, use [Argo sync failure](argocd-sync-failure.md); for vulnerability rejection use [image scan failure](image-scan-failure.md). Escalate digest disagreement to the platform owner and stop promotion. Critical severity goes to **page**; every other severity goes to
the **hourly status board** through the existing null route. No notify tier or
new tenant notification bridge. The cluster board cannot honor cluster silences;
check its source freshness and delivery health before interpreting silence.

See the [index and authorization contract](README.md),
[ADR-0015](../adr/0015-runbooks.md) and [usage](../usage.md).
