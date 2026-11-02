# Tenant workload base

Deployment/Service and guard resources share one tenant selector. Static uses
UID/GID/fsGroup 101, Node 1000; both keep a read-only root, /tmp emptyDir and
/healthz probes. Environment overlays compose the matching observe bundles.
Namespace budgets remain platform-owned outside the tenant Application.
