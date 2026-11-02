# Template contract — the CLI stage / the build stage

Templates are ordinary UTF-8 files. `.tmpl` renders text and filenames; `.raw` copies text unchanged but renders filenames. Strip the suffix at the destination. README files without those suffixes are ignored. Preserve executable mode. Do not put secret material in any template. Native Forgejo `${{ ... }}` expressions are preserved only in `ci/.forgejo/workflows/*.yml.tmpl` (or `.yaml.tmpl`) content via an explicit renderer option. Filenames and all other templates stay strict. Argo Go templates and Prometheus `{{ ... }}` belong in deliberate `.raw` files. The renderer does not evaluate native expressions.

| Source under templates/ | Destination |
|---|---|
| app/static/ or app/node/ | app repository root |
| ci/ | app repository root; include .forgejo/workflows/ or ops/ci/ in source paths |
| deploy/base/ | gitops clusters/homelab/tenants/TENANT/base/ |
| deploy/overlays/dev/ or prod/ | same tenant overlays/dev/ or prod/ |
| observe/ | same tenant base/observe/ |
| guard/ | same tenant base/guard/ |
| namespaces/ (the deploy stage extension point) | gitops clusters/homelab/tenant-namespaces/TENANT/ |

The shared base composes guard; dev/prod overlays compose their matching observe bundles. ServiceMonitor and staged latency burns are opt-in. Namespace templates may use `{{tenant}}-dev` and `{{tenant}}-prod` explicitly; they are outside the namespaced tenant Applications. Platform files are not auto-installed by gp.

| Placeholder | Value / scope |
|---|---|
| tenant, kind | Validated slug and static/node |
| env | dev or prod, overlay templates only |
| image | registry.example.com/apps/TENANT (repository name, no guessed digest) |
| image_digest | Optional verified `sha256:` plus exactly 64 lowercase hex digits; supplied by `planNew({ imageDigest })` or `GP_IMAGE_DIGEST` for CLI. No default. A template referencing it fails if absent. |
| image_tag | UNRELEASED; marker only, never acceptable for live deployment |
| host | TENANT-ENV.apps.example.com, overlays only; proposed internal DNS, must be reviewed/provisioned |
| port | static 8080, node 3000 |
| health_path | /healthz |
| run_as_user | static 101, node 1000; shared UID/GID and fsGroup |
| priority_class | workload-default |
| slo_availability | 0.995 |
| slo_latency | 0.99 |
| slo_latency_seconds | 0.5 |

Unknown keys fail. Supplied image digests are validated even when unused; syntax validation does not establish provenance. A caller must verify the digest against its artifact receipt. Any leftover `{{` after rendering fails, even if it came from a value, except the original native Forgejo expressions protected by the workflow-only option. NUL sentinel input is rejected. Rendering does not escape YAML/JSON/shell; templates must quote their known scalar values appropriately. Configurable hosts, pins and SLO overrides require a validated input schema rather than guessing arbitrary token values.

`gp.json` (version 2) in both the app root and the gitops tenant root is a local receipt with tenant, kind, templateFiles, and appRepo/gitops/tenantDir stored relative to the receipt's own directory, so a moved checkout still resolves. Legacy version-1 receipts with absolute paths are rejected. An integrated tenant may set optional `dockerfile` to `Dockerfile.<suffix>` (letters, digits, underscore or hyphen) so verification selects its cluster image rather than a separate public preview; the default remains `Dockerfile`. Paths and symlinks are refused for this field. It is not a secret or deploy manifest. With empty templates, receipts are the only output. gp prints that incompleteness explicitly.

Preflight renders every file and checks all collisions before writing. Writes use exclusive creation; on an I/O failure, newly written files roll back, though empty directories may remain. Concurrent hostile directory replacement is outside the single-operator contract; do not run competing writers against the same destinations. Symlinks, path escapes, .env paths and .secrets paths are refused.

The build stage image bases are separate mandatory Docker ARG pins recorded in generated `ops/ci/base-images.json`; these are not gp placeholders and start empty. See generated `ops/ci/README.md` for authorized digest resolution, read-only runtime mounts, Trivy review format, and manual same-digest prod promotion.
