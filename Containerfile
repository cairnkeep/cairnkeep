ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /src

COPY package.json package-lock.json ./
COPY mcp-memory-server/package.json mcp-memory-server/package-lock.json ./mcp-memory-server/
RUN npm ci --omit=dev --ignore-scripts \
    && npm --prefix mcp-memory-server ci --ignore-scripts

COPY . .
RUN npm --prefix mcp-memory-server run build \
    && mkdir -p /out/mcp-memory-server \
    && cp -a \
        AGENTS.md CHANGELOG.md CONTRIBUTING.md LICENSE README.md SECURITY.md \
        package.json bin claude docs examples opencode schemas scripts templates \
        node_modules /out/ \
    && cp -a mcp-memory-server/dist mcp-memory-server/package.json /out/mcp-memory-server/

FROM ${NODE_IMAGE} AS server
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 cairn \
    && useradd --uid 10001 --gid 10001 --create-home --home-dir /home/cairn cairn \
    && mkdir -p /data/project /data/scopes /workspace /opt/cairnkeep \
    && chown -R cairn:cairn /data /workspace /opt/cairnkeep

COPY --from=build --chown=cairn:cairn /out/ /opt/cairnkeep/
COPY --chmod=755 containers/entrypoint.sh /usr/local/bin/cairn-container-entrypoint
COPY --chmod=644 containers/healthcheck.mjs /usr/local/lib/cairnkeep/container-healthcheck.mjs
RUN ln -s /opt/cairnkeep/bin/cairn /usr/local/bin/cairn

ENV HOME=/home/cairn \
    CAIRN_AGENTFS_BASE_DIR=/data/scopes \
    CAIRN_SERVER_WORKDIR=/data/project \
    MCP_HTTP_PORT= \
    MCP_HTTP_HOST=
WORKDIR /data/project
VOLUME ["/data"]
EXPOSE 7801
USER 10001:10001
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/cairn-container-entrypoint"]
CMD ["stdio"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["node", "/usr/local/lib/cairnkeep/container-healthcheck.mjs"]

FROM server AS workspace
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends git openssh-client ripgrep \
    && rm -rf /var/lib/apt/lists/*
COPY --chmod=755 containers/workspace-entrypoint.sh /usr/local/bin/cairn-workspace-entrypoint
WORKDIR /workspace
USER 10001:10001
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/cairn-workspace-entrypoint"]
CMD ["bash"]
