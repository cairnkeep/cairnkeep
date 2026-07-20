# Containers

Cairnkeep publishes two OCI images for Podman and other OCI-compatible
engines:

| Image | Purpose |
|---|---|
| `ghcr.io/cairnkeep/cairnkeep:<version>` | Minimal MCP memory server, over stdio or authenticated HTTP |
| `ghcr.io/cairnkeep/cairnkeep-workspace:<version>` | Derivation base with Cairnkeep, Git, SSH, and ripgrep |

Both images run as the unprivileged user `10001:10001`. The workspace image is
not a preconfigured coding harness: a private distribution can derive from it
and install only its approved harnesses and policies.

## Local stdio

After installing `@cairnkeep/cli`, register the container launcher rather than
the host memory server:

```bash
claude mcp add cairn-memory -s user -- cairn-container stdio
```

Each harness session starts an ephemeral server container. Memory survives in
the `cairnkeep-data` named volume. The container does not discover or contact a
remote Cairnkeep server.

The equivalent direct Podman command is:

```bash
podman run --rm -i \
  --userns=keep-id:uid=10001,gid=10001 \
  --read-only --cap-drop=all --security-opt=no-new-privileges \
  --tmpfs=/tmp:rw,noexec,nosuid,size=64m,mode=1777 \
  --volume cairnkeep-data:/data:Z,U \
  ghcr.io/cairnkeep/cairnkeep:latest stdio
```

Pin a version instead of `latest` for managed installations.

## Authenticated HTTP

Generate the bearer token into a private file and start a loopback-only
listener:

```bash
install -m 700 -d ~/.config/cairnkeep/secrets
openssl rand -hex 32 > ~/.config/cairnkeep/secrets/http-token
chmod 600 ~/.config/cairnkeep/secrets/http-token

cairn-container http \
  --token-file ~/.config/cairnkeep/secrets/http-token \
  --port 7801
```

The launcher refuses token files that are symlinks or have a mode other than
`0400` or `0600`. It mounts the token read-only instead of putting it in the
container environment or image.

The listener is deliberately published only on `127.0.0.1`. For access from
other machines, keep it on loopback behind a TLS reverse proxy or encrypted
private network. Add the externally visible `Host` header to the DNS-rebinding
allowlist:

```bash
cairn-container http \
  --token-file ~/.config/cairnkeep/secrets/http-token \
  --allowed-hosts memory.example.com
```

The container always adds its own loopback address for health checks.

One HTTP server and bearer token form one trust domain. They are not a
multi-tenant authorization boundary; see [Memory storage and
deployment](storage.md).

## Persistent service

[`containers/compose.yaml`](../containers/compose.yaml) is a portable starting
point:

```bash
mkdir -p containers/secrets
openssl rand -hex 32 > containers/secrets/http-token
chmod 600 containers/secrets/http-token
podman compose -f containers/compose.yaml up -d
```

Set `CAIRNKEEP_VERSION` to pin the image and
`CAIRN_MEMORY_HTTP_ALLOWED_HOSTS` when a reverse proxy sends a different host
name. The named volume contains all memory state.

For rootless Podman managed by systemd, copy the files from
[`containers/quadlet`](../containers/quadlet) to
`~/.config/containers/systemd/`, create the referenced secret, and reload:

```bash
printf '%s' "$(openssl rand -hex 32)" |
  podman secret create cairnkeep-http-token -
systemctl --user daemon-reload
systemctl --user enable --now cairnkeep.service
```

Review the image tag, published port, allowed hosts, and backup location before
using the sample as a long-running service.

## Storage and backups

Inside the server image:

| Data | Container path |
|---|---|
| Local/legacy project database | `/data/project/.agentfs/project.db` |
| Named/global scopes | `/data/scopes/<scope>.db` |
| Header-routed HTTP projects | `/data/scopes/projects/<project-id>.db` |

All three paths are below `/data`, so replacing the container while retaining
the volume does not move or delete memory. Removing the volume does delete the
store. Back up the volume with the service stopped, or use SQLite online
backups for each database as described in [storage.md](storage.md).

## Model and RAG endpoints

Embedding, extraction, and document-RAG services remain optional external
services. Supply non-secret settings with an env file:

```dotenv
CAIRN_LLM_API_URL=https://models.example.com/v1
CAIRN_LLM_EXTRACTION_MODEL=example-chat-model
CAIRN_MEMORY_EMBEDDING_URL=https://models.example.com/v1
CAIRN_MEMORY_EMBEDDING_MODEL=example-embedding-model
```

For workspace containers, pass keys as files:

```bash
cairn-container workspace --repo . \
  --env-file ~/.config/cairnkeep/container.env \
  --secret CAIRN_LLM_API_KEY=~/.config/cairnkeep/secrets/llm-key
```

The entrypoint reads `CAIRN_LLM_API_KEY_FILE`,
`CAIRN_MEMORY_HTTP_TOKEN_FILE`, and `ANYTHINGLLM_API_KEY_FILE`. Do not bake
credentials, cookies, SSH private keys, or a populated `.env` into an image.

## Isolated workspaces

The default `sandbox` mode copies the selected repository into a persistent
named volume. Commands can change that copy but cannot write to the host
checkout:

```bash
cairn-container workspace --repo /path/to/repository
```

Rerunning the command with the same workspace volume resumes the copy. Use
`--workspace-volume` when repositories have the same basename or when an
explicit lifecycle is preferable.

`shared` mode is opt-in and bind-mounts the checkout read/write:

```bash
cairn-container workspace --repo /path/to/repository --mode shared
```

The container has normal outbound network access but receives no host home
directory, container-engine socket, or host credentials unless the operator
mounts them. For stricter execution, add network policy and resource limits in
the private distribution.

## Private derived images

A managed overlay should derive from a pinned workspace image:

```dockerfile
ARG CAIRNKEEP_VERSION
FROM ghcr.io/cairnkeep/cairnkeep-workspace:${CAIRNKEEP_VERSION}

USER root
# Install the approved harness package from the approved registry.
USER 10001:10001
```

The derived image may contain non-secret organization policy and launchers.
Machine credentials and repository access remain runtime secrets. Build and
publish that image from the private overlay repository to its approved private
registry; do not add private configuration to the public Cairnkeep image.
