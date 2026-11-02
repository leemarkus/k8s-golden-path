# Rotate registry secret (also initial sealing)

Owner: the platform owner (credential identity/sealing), tenant owner (consumer verification).
Scope: one tenant, separately sealed for dev and prod. GP emits no credentials.

## Trigger

A registry credential expires, may be exposed or needs routine rotation; initial
onboarding uses the same sealing procedure without an old credential to revoke.

## Impact

An invalid pull credential can strand the next rollout while cached pods remain
healthy. The registry (Forgejo packages) runs outside the cluster. Rotation must account for
every actual consumer of the identity, not just the first namespace discovered.

## Read-only diagnosis

```sh
TENANT=fixture # replace with the reviewed tenant slug
ENV=dev # repeat for prod
NS="$TENANT-$ENV"
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" auth can-i get pods -n "$NS"
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" get pods -n "$NS" -o wide
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" get events -n "$NS" --sort-by=.metadata.creationTimestamp
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" get deployments -n "$NS" -o 'custom-columns=NAME:.metadata.name,PULLSECRETS:.spec.template.spec.imagePullSecrets[*].name,PULLPOLICY:.spec.template.spec.containers[*].imagePullPolicy,IMAGE:.spec.template.spec.containers[*].image'
kubectl --kubeconfig "$HOME/.kube/readonly.kubeconfig" get sealedsecrets.bitnami.com forgejo-registry -n "$NS" -o 'custom-columns=NAME:.metadata.name,GENERATION:.metadata.generation,OBSERVED:.status.observedGeneration,TYPE:.status.conditions[*].type,STATUS:.status.conditions[*].status'
```

Do not read Secret data, controller private keys, .env or .secrets files. Record
current-generation SealedSecret status, not ciphertext or credentials. Missing
objects before onboarding are expected; Forbidden/timeouts leave evidence open.
Read-only diagnosis cannot establish the token's validity without a fresh pull.
Inventory both environments and any other identity consumers from reviewed
manifests and the platform owner's credential inventory. The agent may not read SealedSecrets;
the human read-only kubeconfig has a separate scope. No permission expansion.

## Remediation

1. **needs operator approval — minting:** The platform owner creates a replacement `read:package`
   credential on an appropriately constrained identity in Forgejo. Scope verbs
   do not constrain repositories; identity/membership provides containment.
   Keep the old credential valid during normal rotation until all consumers
   pass. For compromise, the platform owner explicitly chooses immediate revocation and accepts
   any pull outage; never restore a compromised token.
2. **needs operator approval — sealing:** The platform owner obtains and independently verifies the
   current controller **public certificate**, supplied as a non-secret PEM file.
   Use the installed, reviewed kubeseal tool; missing tool/certificate blocks
   this step. Do not fetch credentials or controller keys. In a private terminal,
   Bash with tracing/session recording disabled, run the following once per
   namespace after setting `CERT`, `OUT` (a new ciphertext-only path), `TENANT`
   and `ENV`. Input uses a hidden terminal prompt; plaintext goes only through
   memory/stdin, never a file, argv, environment variable or log. The private
   human step is not executed by this repository or by the SRE agent.

```bash
# needs operator approval — writes ciphertext only; no cluster write credentials involved
set +x
set -euo pipefail
umask 077
: "${TENANT:?Set the tenant slug}" "${ENV:?Set dev or prod}"
: "${CERT:?Set verified public certificate path}" "${OUT:?Set new ciphertext path}"
case "$ENV" in dev|prod) ;; *) exit 1 ;; esac
export GP_SEAL_NAMESPACE="$TENANT-$ENV"
test -r "$CERT"
test ! -e "$OUT"
command -v kubeseal
# noclobber protects against an accidentally reused destination
set -o noclobber
python3 -c '
import base64, getpass, json, os, sys, warnings
warnings.simplefilter("error", getpass.GetPassWarning)
user = getpass.getpass("Forgejo username: ") if sys.stdin.isatty() else ""
if not user:
    raise SystemExit("Run interactively in a private terminal")
token = getpass.getpass("Replacement read:package token: ")
if not token:
    raise SystemExit("Empty token refused")
auth = base64.b64encode((user + ":" + token).encode()).decode()
config = json.dumps({"auths": {"registry.example.com": {"auth": auth}}})
secret = {"apiVersion": "v1", "kind": "Secret",
          "metadata": {"name": "forgejo-registry", "namespace": os.environ["GP_SEAL_NAMESPACE"]},
          "type": "kubernetes.io/dockerconfigjson",
          "data": {".dockerconfigjson": base64.b64encode(config.encode()).decode()}}
json.dump(secret, sys.stdout)
' | kubeseal --cert "$CERT" --scope strict --format yaml > "$OUT"
test -s "$OUT"
```

Both prompts use the terminal; stdout contains only the JSON passed to kubeseal.

3. **needs operator approval — integration:** add only the successfully sealed manifest
   to the matching environment overlay and its kustomization resource in the
   same reviewed commit. Strict scope binds namespace/name; never copy dev
   ciphertext into prod. Ensure the Deployment names `forgejo-registry` in
   imagePullSecrets. On pipeline failure stop; do not integrate an empty/partial
   output file. Reattempt with a new ciphertext path after resolving the error.
4. **needs operator approval — delivery:** run gates, push gitops main through the seven
   checks and deploy boundary; manually sync prod after review. For rotation,
   the platform owner approves a bounded fresh-pull rollout in each environment, using an
   inspected `Always` pull policy or another reviewed method proving an actual
   authenticated registry request. A new pod using cached bytes is insufficient.
5. **needs operator approval — revocation:** revoke the prior credential only after all
   actual consumers pass (except the explicit compromise path above). Record
   credential identity/version, never its value, and verify again after revocation.

## Rollback

**needs operator approval:** before revocation, restore the previous ciphertext/config
through gitops only if its credential remains safe and valid. After revocation
or compromise, mint/reseal a new credential; restoring old ciphertext cannot
restore token validity. Keep working pods available and stop repeated failed
rollouts. Controller key recovery belongs to the platform owner.

## Verify

Repeat metadata/pod/event reads above for dev and prod. Record the UTC window,
expected generation/digest and approval reference in the incident ledger.

| VERIFY item | Evidence required | Status / owner |
|---|---|---|
| V-rotate-1 | Current-generation Synced=True, correct namespace/name/type and consuming imagePullSecrets; no plaintext committed | Open — the platform owner |
| V-rotate-2 | Successful authenticated fresh registry pull for every actual consumer, new pod imageID/readiness and private content, before and after old-token revocation | Open — the platform owner / tenant owner |
| V-rotate-3 | Previous safe credential rollback available or replacement/resealing recovery documented; partial ciphertext never integrated | Open — the platform owner |

A cached Ready pod or Secret existence does not clear V-rotate-2. Failure to
observe authentication leaves it blocked, not passed.

## Escalation

Escalate missing certificate, decryption failures, unknown consumers, unavailable
registry or suspected disclosure to the platform owner. No secret values in the report. Critical
severity → page; everything else → hourly status board. The cluster board cannot
honor silences. See [onboarding](onboard.md), [Argo sync](argocd-sync-failure.md)
and [ADR-0014](../adr/0014-secrets.md).
