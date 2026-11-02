# Prod overlay

Two replicas with headroom for one surge. Promotion copies the accepted dev
artifact's tag and digest; no rebuild or automatic prod sync. UNRELEASED remains
until an approved release. Namespace/PSS and budgets precede workload sync;
registry sealing, private DNS and NPM routing remain explicit prerequisites.
