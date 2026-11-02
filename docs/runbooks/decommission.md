# Decommission a tenant

Owner: platform owner (approval/platform), tenant owner (traffic and dependency inventory).
Scope: explicitly named tenant and environments; never a suffix-wide deletion.

## Trigger

The owner requests retirement and names the exact dev/prod resources, downstream
consumers and retention requirements. A directory disappearing is not approval.

## Impact

Traffic stops and credentials/resources are removed deliberately. ApplicationSet
`preserveResourcesOnDeletion: true` prevents directory removal from implicitly
cleaning up workloads. Namespace deletion is destructive and comes last.

## Read-only diagnosis

```sh
TENANT=fixture # replace with the approved tenant slug
ENV=dev # repeat inventory for prod
NS="$TENANT-$ENV"
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" auth can-i get pods -n "$NS"
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" get applications.argoproj.io -n argocd "$NS" -o yaml
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" get applicationsets.argoproj.io -n argocd -o yaml
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" get namespace "$NS" --show-labels
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" get deployments,pods,services,ingresses,networkpolicies,resourcequotas,limitranges,persistentvolumeclaims -n "$NS"
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" get prometheusrules.monitoring.coreos.com,servicemonitors.monitoring.coreos.com -n "$NS"
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" get configmaps -n "$NS" -o name
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" get events -n "$NS" --sort-by=.metadata.creationTimestamp
```

Compare desired manifests and live ownership/finalizers; list additional kinds
explicitly from those manifests rather than trusting `get all` to be exhaustive.
Record traffic/dependencies from existing ingress metrics and owner knowledge,
internal DNS/NPM entries, identity consumers and rollback image retention. Any
PVC is unexpected for this stateless path: stop and resolve retention/ownership.
Missing permissions are inventory gaps. Do not read Secret contents to inventory
credentials; use reviewed names and the platform owner's identity records.

## Remediation

1. **needs operator approval:** freeze app publication/promotions, agree the downtime
   window, preserve sanitized release/incident/scenario history and known-good
   manifests/digests. Stop new traffic at the reviewed internal DNS/NPM/ingress
   boundary; confirm consumers are drained before removing workloads.
2. **needs operator approval:** remove the intended overlay directory/directories through
   main → seven checks → deploy. Verify ApplicationSet deletion preservation
   before this step; pause if preservation/finalizers differ from the contract.
   Wait for generator reconciliation and record whether Applications were
   removed and which resources were retained. Do not fight dev selfHeal by
   deleting resources while the generator still desires them.
3. **needs operator approval:** The platform owner reviews an exact namespaced resource and remaining
   Application inventory, including deletion finalizers, then explicitly deletes
   only the approved retained objects using the platform operator's procedure.
   This is a human write session, never the readonly kubeconfig or SRE agent.
   Do not strip finalizers or run a broad delete-all command to force completion.
4. **needs operator approval:** revoke tenant-only registry/CI bot credentials after
   checking all consumers; remove tenant routes, monitor rules, dashboards and
   resource references through their owning repositories. Never revoke a shared
   identity until the other consumers have migrated.
5. **needs operator approval:** remove the separate platform namespace declarations last,
   after the empty-namespace and ownership review, then explicitly arrange their
   deletion with the platform owner. Keep tenant history and audit evidence. Namespace removal
   is not implicitly authorized by removing an ApplicationSet directory.

## Rollback

**needs operator approval:** before destructive cleanup, restore traffic and the approved
directories through gitops and verify the prior digest. After resource/namespace
removal, re-onboard in platform-namespace → separately sealed credentials →
workloads order; revoked credentials require new tokens. An unavailable old
artifact or unexpected lost state prevents an immediate rollback claim. Record
that limit before deletion, not after it.

## Verify

Repeat the scoped inventory reads; NotFound is success only for the explicitly
retired objects in this operation, never for an unrelated health question.

| VERIFY item | Evidence required | Status / owner |
|---|---|---|
| V-decommission-1 | Generator no longer desires the tenant, reviewed objects/Applications/namespaces removed, no recreation after reconciliation | Open — the platform owner |
| V-decommission-2 | Internal routes/DNS removed, credential identities revoked, tenant alerts/rules/dashboard gone, board resolution and freshness checked | Open — the platform owner |
| V-decommission-3 | Other tenants still serve requests/pull images; retained audit history and rollback limitations recorded with UTC times and approval | Open — tenant owner |

Inspect fresh reconciliation and traffic evidence; a successful deletion command
alone is insufficient. Record failed, blocked or skipped checks explicitly.

## Escalation

Stop on ambiguous ownership, finalizers, retained PVCs or shared credentials and
escalate to the platform owner. Critical collateral impact → page; other follow-up → hourly
status board. Removing a rule must not disguise an incident in another tenant.
See [onboarding](onboard.md).
