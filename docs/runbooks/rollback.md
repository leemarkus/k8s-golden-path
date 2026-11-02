# Rollback to a known-good digest

Owner: tenant owner (application), platform owner (platform and approval). Scope: one
`TENANT` / `ENV` on homelab unless explicitly expanded. Operational
instructions, not evidence of activation; live activation owns the live drill.

## Trigger

A release causes a measured regression or fails acceptance. Identify the affected environment and the last independently verified good artifact.

## Impact

Rollback replaces stateless pods. It does not restore databases, fix platform outages or justify switching to a tag-only image.

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


## Remediation

1. Select the prior accepted tag+digest from the release evidence and git history. Confirm registry retention, scan/exception validity and unchanged dependency/config compatibility. If no verified artifact survives, stop and escalate.
2. **needs operator approval — rollback commit/push:** restore that image entry only in the affected overlay; preserve unrelated namespace, policy and observability changes. Render and run the same gates. Push main through the normal review/promotion boundary; never push deploy directly.
3. **needs operator approval — prod sync:** once deploy contains the rollback commit, manually sync the affected prod Application. Dev reconciles automatically. Observe fresh pod imageIDs and health, then compare the original symptom within its time window.

## Rollback

**needs operator approval:** if the rollback worsens the incident, restore the previously recorded pre-rollback digest through the same gated route only if it is safer, or keep promotion stopped and escalate. No known-good option means recovery is unresolved; do not cycle arbitrary historical tags.

## Verify

Repeat the relevant read-only commands above after the change and record fresh
payload evidence, not just a successful command or green controller status.

| VERIFY item | Evidence required | Initial status / owner |
|---|---|---|
| V-rollback-1 | The selected known-good digest is running on every intended replica, the original failure has recovered with current requests, and no new error or cross-tenant effect appears; recovery window and remaining telemetry gaps recorded. | Open — tenant owner / live activation |
| V-rollback-2 | Record UTC start/end, expected versus observed result, evidence source, current digest/revision, gaps and the platform owner's approval reference for any mutation. | Open — the platform owner |

Close each row separately as observed, failed, blocked or skipped (with reason).
An offline pass never clears a live row. Preserve the sanitized incident record.

## Escalation

Escalate an unavailable prior image, incompatible config, persistent failure or suspected stateful dependency to the platform owner; stop repeated rollouts. Critical severity goes to **page**; every other severity goes to
the **hourly status board** through the existing null route. No notify tier or
new tenant notification bridge. The cluster board cannot honor cluster silences;
check its source freshness and delivery health before interpreting silence.

See the [index and authorization contract](README.md),
[ADR-0015](../adr/0015-runbooks.md) and [usage](../usage.md).
