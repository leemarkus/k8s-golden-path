# ArgoCD sync failure

Owner: tenant owner (application), platform owner (platform and approval). Scope: one
`TENANT` / `ENV` on homelab unless explicitly expanded. Operational
instructions, not evidence of activation; live activation owns the live drill.

## Trigger

A tenant Application is OutOfSync/Degraded, reports sync/comparison errors or remains on an old revision despite successful app CI.

## Impact

The deployment boundary may correctly be blocking a bad change. Synced+Healthy only describes Argo's selected deploy revision, not whether main has reached it.

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
```sh
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" get applications.argoproj.io -n argocd "$NS" -o yaml
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" get applicationsets.argoproj.io -n argocd -o yaml
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" get appprojects.argoproj.io -n argocd tenants -o yaml
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" get namespace "$NS" --show-labels
```

Rank the break: app publication/dev commit; seven-job validation; fast-forward
promotion; generator directory/env filter; child source revision; namespace/project
permission; manifest admission; image pull/readiness. Check preservation=true,
CreateNamespace=false, dev automated prune/selfHeal and absence of prod automation.
Read operationState/conditions/resources and last reconciliation timestamp.
For repository/registry reachability errors, the Git host runs outside the cluster
and upstream DNS or the reverse proxy may be involved.


## Remediation

1. **needs operator approval:** fix the first failed boundary in its owner repository and rerun validation. CI must fast-forward deploy only after all seven jobs succeed. Diverged deploy needs human history repair; never force-push, manually advance deploy or repoint Argo at main.
2. **needs operator approval:** reconcile missing platform namespace declarations before tenant sync; correct ApplicationSet/project paths and allowed destinations without opening cluster-scoped access.
3. **needs operator approval:** after admission/pull/config faults are fixed and the intended revision reaches deploy, the platform owner syncs prod in the Argo UI. Dev should self-reconcile. Use [policy rejection](policy-rejection.md) or [registry rotation](rotate-secrets.md) for their specific faults.
4. If the Argo controller or the off-cluster Git host itself is unavailable, hand the evidence to the platform owner for the current platform recovery procedure; a tenant runbook does not reinstall controllers.

## Rollback

**needs operator approval:** revert only the faulty tenant/platform configuration through the gate, or [roll back the image](rollback.md). Preserve both generator and child deploy tracking; the historical bootstrap ADR's temporary main workaround is not a tenant rollback procedure.

## Verify

Repeat the relevant read-only commands above after the change and record fresh
payload evidence, not just a successful command or green controller status.

| VERIFY item | Evidence required | Initial status / owner |
|---|---|---|
| V-argocd-sync-failure-1 | All seven checks passed for the intended main commit, deploy advanced without force, generator/child track deploy, fresh reconciliation and ready pods match that revision/digest, and private content succeeds. | Open — tenant owner / live activation |
| V-argocd-sync-failure-2 | Record UTC start/end, expected versus observed result, evidence source, current digest/revision, gaps and the platform owner's approval reference for any mutation. | Open — the platform owner |

Close each row separately as observed, failed, blocked or skipped (with reason).
An offline pass never clears a live row. Preserve the sanitized incident record.

## Escalation

Escalate blocked promotion, repository access, missing namespace bootstrap or shared Argo failure to the platform owner; provide the first failed boundary and its timestamp. Critical severity goes to **page**; every other severity goes to
the **hourly status board** through the existing null route. No notify tier or
new tenant notification bridge. The cluster board cannot honor cluster silences;
check its source freshness and delivery health before interpreting silence.

See the [index and authorization contract](README.md),
[ADR-0015](../adr/0015-runbooks.md) and [usage](../usage.md).
