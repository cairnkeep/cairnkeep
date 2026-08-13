import { pathToFileURL } from "node:url";

/**
 * Declarative registry for every CLI harness supported by project setup.
 *
 * Keep harness-specific project assets and lifecycle guidance here. Consumers
 * must derive choices from this registry instead of maintaining local lists.
 */
const DEFINITIONS = [
  {
    id: "claude",
    title: "Claude Code",
    launcher: { template: "start-claude.sh.template", path: ".ai/start-claude.sh", mode: 0o755 },
    project_assets: [],
    machine_sync: "cairn sync --apply",
  },
  {
    id: "opencode",
    title: "OpenCode",
    launcher: { template: "start-opencode.sh.template", path: ".ai/start-opencode.sh", mode: 0o755 },
    project_assets: [],
    machine_sync: "cairn sync --apply",
  },
  {
    id: "pi",
    title: "Pi",
    launcher: { template: "start-pi.sh.template", path: ".ai/start-pi.sh", mode: 0o755 },
    project_assets: [],
    machine_sync: "cairn sync-pi --apply",
  },
  {
    id: "kimi",
    title: "Kimi Code",
    launcher: { template: "start-kimi.sh.template", path: ".ai/start-kimi.sh", mode: 0o755 },
    project_assets: [],
    machine_sync: "cairn sync-kimi --apply",
  },
  {
    id: "qwen",
    title: "Qwen Code",
    launcher: { template: "start-qwen.sh.template", path: ".ai/start-qwen.sh", mode: 0o755 },
    project_assets: [],
    machine_sync: null,
  },
  {
    id: "codex",
    title: "Codex CLI",
    launcher: { template: "start-codex.sh.template", path: ".ai/start-codex.sh", mode: 0o755 },
    project_assets: [
      {
        template: "codex-config.toml.template",
        path: ".codex/config.toml",
        mode: 0o644,
        memory: "local",
        // An existing operator-owned TOML file is valid when doctor finds the
        // exact MCP table; it must not become setup/uninstall-owned.
        required: false,
      },
    ],
    machine_sync: null,
  },
];

function freezeDefinition(definition) {
  const launcher = Object.freeze({ ...definition.launcher });
  const projectAssets = Object.freeze(definition.project_assets.map((asset) => Object.freeze({ ...asset })));
  return Object.freeze({ ...definition, launcher, project_assets: projectAssets });
}

export const HARNESS_REGISTRY = Object.freeze(DEFINITIONS.map(freezeDefinition));
export const HARNESS_IDS = Object.freeze(HARNESS_REGISTRY.map(({ id }) => id));

export function harnessDefinition(id) {
  return HARNESS_REGISTRY.find((definition) => definition.id === id) ?? null;
}

export function harnessProjectAssets(id, memory = "local") {
  const definition = harnessDefinition(id);
  if (!definition) throw new Error(`Unknown harness: ${id}.`);
  return Object.freeze([
    definition.launcher,
    ...definition.project_assets.filter((asset) => !asset.memory || asset.memory === memory),
  ]);
}

export function requiredHarnessAssetPaths(harnesses, memory = "local") {
  return Object.freeze(harnesses.flatMap((id) => harnessProjectAssets(id, memory)
    .filter((asset) => asset.required !== false)
    .map(({ path }) => path)));
}

export function machineSyncCommand(harnesses) {
  const commands = harnesses.map(harnessDefinition).map((definition) => definition?.machine_sync).filter(Boolean);
  if (commands.includes("cairn sync-pi --apply")) return "cairn sync-pi --apply";
  return commands[0] ?? null;
}

function validateRegistry() {
  if (new Set(HARNESS_IDS).size !== HARNESS_IDS.length) throw new Error("Harness registry contains duplicate IDs.");
  for (const definition of HARNESS_REGISTRY) {
    if (!/^[a-z][a-z0-9-]*$/.test(definition.id) || !definition.title) throw new Error("Invalid harness registry entry.");
    const assets = [definition.launcher, ...definition.project_assets];
    if (new Set(assets.map(({ path }) => path)).size !== assets.length) throw new Error(`Duplicate project asset for ${definition.id}.`);
    for (const asset of assets) {
      if (!asset.template || !asset.path || ![0o600, 0o644, 0o755].includes(asset.mode)) throw new Error(`Invalid project asset for ${definition.id}.`);
    }
  }
}

validateRegistry();

// The legacy bootstrap is a shell script for Bash 3.2 portability. This bounded
// output lets it consume the same registry without parsing JavaScript or JSON.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!new Set(["bootstrap-assets", "ids"]).has(process.argv[2])) {
    console.error("Usage: node harness-registry.mjs bootstrap-assets|ids");
    process.exitCode = 2;
  } else if (process.argv[2] === "ids") {
    process.stdout.write(`${HARNESS_IDS.join(" ")}\n`);
  } else {
    for (const definition of HARNESS_REGISTRY) {
      const asset = definition.launcher;
      process.stdout.write(`${asset.template}\t${asset.path}\t${asset.mode.toString(8)}\n`);
    }
  }
}
