# Tenant guards

Default-deny all ingress/egress, then allow only ingress-nginx controller HTTP,
monitoring Prometheus to an optional named metrics port, and kube-system kube-dns
TCP/UDP 53. Namespace and pod selectors are paired (AND). Live activation must verify the
actual controller labels and CNI behavior. Other egress requires review.

SEALED-SECRET-PLACEHOLDER.md.tmpl generates documentation, never secret material.
Only network-policy.yaml is included in the guard Kustomization.
