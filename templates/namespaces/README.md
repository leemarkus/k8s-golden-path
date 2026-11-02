# Platform-owned tenant namespaces

Scaffolds tenant-dev/prod Namespaces with PSS restricted v1.34 and paired quotas
and LimitRanges. These stay outside tenant Applications. Add the generated tenant
directory to the shared platform namespace Kustomization explicitly; gp never
rewrites that shared index. See platform/README.md for ordering and project
permissions. Namespace removal is deliberately not automatic pruning.
