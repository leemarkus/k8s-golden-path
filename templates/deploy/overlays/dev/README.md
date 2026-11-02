# Dev overlay

One replica, tenant-dev namespace, internal nginx ingress behind NPM TLS.
UNRELEASED is an offline marker. CI promotion writes the actual newTag plus
digest through Kustomize images; dev's Application then automates prune/selfHeal.
A separately sealed registry credential is a live prerequisite.
