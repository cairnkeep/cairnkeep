import { existsSync, lstatSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const USAGE = `Usage:
  cairn-container stdio [--image IMAGE] [--volume VOLUME]
  cairn-container http --token-file FILE [--port PORT] [--name NAME]
                       [--allowed-hosts HOSTS] [--image IMAGE]
                       [--volume VOLUME] [--env-file FILE]
  cairn-container workspace --repo PATH [--mode sandbox|shared]
                            [--image IMAGE] [--data-volume VOLUME]
                            [--workspace-volume VOLUME] [--home-volume VOLUME]
                            [--env-file FILE] [--secret NAME=FILE]... [--] [COMMAND...]`;

function options(args) {
  const values = new Map();
  const rest = [];
  const valued = new Set(["--image", "--volume", "--token-file", "--port", "--name", "--allowed-hosts", "--env-file", "--repo", "--mode", "--data-volume", "--workspace-volume", "--home-volume", "--secret"]);
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--") { rest.push(...args.slice(index + 1)); break; }
    if (!args[index].startsWith("--")) { rest.push(...args.slice(index)); break; }
    if (!valued.has(args[index])) throw new Error(`unknown option: ${args[index]}`);
    if (index + 1 >= args.length) throw new Error(`${args[index]} requires a value`);
    const value = args[++index];
    if (args[index - 1] === "--secret") values.set("--secret", [...(values.get("--secret") ?? []), value]);
    else values.set(args[index - 1], value);
  }
  return { values, rest };
}

function regularFile(path) {
  const absolute = resolve(path);
  if (!existsSync(absolute)) throw new Error(`not a regular file: ${path}`);
  const info = lstatSync(absolute);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`refusing non-regular or symlink file: ${path}`);
  if (process.platform === "win32") {
    const script = "$m=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$a=Get-Acl -LiteralPath $args[0];$ok=@($m,'S-1-5-18','S-1-5-32-544');foreach($e in $a.Access){if($e.AccessControlType -eq 'Allow'){$s=$e.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value;if($ok -notcontains $s){exit 1}}};exit 0";
    const acl = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script, absolute], { stdio: "ignore", windowsHide: true });
    if (acl.status !== 0) throw new Error(`secret file ACL must be restricted to the current user and system administrators: ${path}`);
  }
  return absolute;
}

function execute(engine, args) {
  const result = spawnSync(engine, args, { stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

function baseArgs() {
  return ["run", "--rm", "--userns=keep-id:uid=10001,gid=10001", "--cap-drop=all", "--security-opt=no-new-privileges", "--read-only", "--tmpfs=/tmp:rw,noexec,nosuid,size=64m,mode=1777"];
}

export function runNativeContainer(args, root = ROOT, executor = execute) {
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const engine = process.env.CONTAINER_ENGINE || "podman.exe";
  const serverImage = process.env.CAIRNKEEP_CONTAINER_IMAGE || `ghcr.io/cairnkeep/cairnkeep:${pkg.version}`;
  const workspaceImage = process.env.CAIRNKEEP_WORKSPACE_IMAGE || `ghcr.io/cairnkeep/cairnkeep-workspace:${pkg.version}`;
  const [command = "help", ...commandArgs] = args;
  if (["help", "-h", "--help"].includes(command)) { console.log(USAGE); return; }
  const { values, rest } = options(commandArgs);
  const common = baseArgs();
  if (command === "stdio") {
    executor(engine, [...common, "-i", "--volume", `${values.get("--volume") || "cairnkeep-data"}:/data:Z,U`, values.get("--image") || serverImage, "stdio"]);
    return;
  }
  if (command === "http") {
    if (!values.get("--token-file")) throw new Error("http mode requires --token-file");
    const token = regularFile(values.get("--token-file"));
    const port = values.get("--port") || "7801";
    if (!/^\d+$/.test(port)) throw new Error(`invalid port: ${port}`);
    const hosts = values.get("--allowed-hosts") || `localhost:${port},127.0.0.1:${port},localhost:7801,127.0.0.1:7801`;
    const extra = values.get("--env-file") ? ["--env-file", regularFile(values.get("--env-file"))] : [];
    executor(engine, [...common, "--detach", "--replace", "--name", values.get("--name") || "cairnkeep", ...extra,
      "--publish", `127.0.0.1:${port}:7801`, "--volume", `${values.get("--volume") || "cairnkeep-data"}:/data:Z,U`,
      "--volume", `${token}:/run/secrets/http-token:ro,Z`, "--env", "MCP_HTTP_HOST=0.0.0.0", "--env", "MCP_HTTP_PORT=7801",
      "--env", `CAIRN_MEMORY_HTTP_ALLOWED_HOSTS=${hosts}`, "--env", "CAIRN_MEMORY_HTTP_TOKEN_FILE=/run/secrets/http-token",
      values.get("--image") || serverImage, "http"]);
    return;
  }
  if (command === "workspace") {
    if (!values.get("--repo")) throw new Error("workspace mode requires --repo");
    const repo = resolve(values.get("--repo"));
    if (!existsSync(repo) || !lstatSync(repo).isDirectory()) throw new Error(`not a directory: ${repo}`);
    const mode = values.get("--mode") || "sandbox";
    if (!["sandbox", "shared"].includes(mode)) throw new Error("--mode must be sandbox or shared");
    const slug = basename(repo).toLowerCase().replace(/[^a-z0-9_.-]/g, "-");
    const id = createHash("sha256").update(repo).digest("hex").slice(0, 12);
    const workspace = values.get("--workspace-volume") || `cairnkeep-workspace-${slug}-${id}`;
    const mounts = mode === "shared" ? ["--volume", `${repo}:/workspace:rw,Z`] : ["--volume", `${repo}:/source:ro,Z`, "--volume", `${workspace}:/workspace:Z,U`];
    const secrets = [];
    for (const specification of values.get("--secret") ?? []) {
      const index = specification.indexOf("=");
      if (index < 1) throw new Error("--secret requires NAME=FILE");
      const name = specification.slice(0, index);
      if (!/^[A-Z0-9_]+$/.test(name)) throw new Error(`invalid secret variable name: ${name}`);
      const file = regularFile(specification.slice(index + 1));
      const target = name.toLowerCase().replace(/[^a-z0-9_.-]/g, "-");
      secrets.push("--volume", `${file}:/run/secrets/${target}:ro,Z`, "--env", `${name}_FILE=/run/secrets/${target}`);
    }
    const envFile = values.get("--env-file") ? ["--env-file", regularFile(values.get("--env-file"))] : [];
    executor(engine, [...common, "-i", "--volume", `${values.get("--data-volume") || "cairnkeep-data"}:/data:Z,U`,
      "--volume", `${values.get("--home-volume") || "cairnkeep-home"}:/home/cairn:Z,U`, "--env", `CAIRN_WORKSPACE_MODE=${mode}`,
      ...mounts, ...envFile, ...secrets, values.get("--image") || workspaceImage, ...(rest.length ? rest : ["bash"])]);
    return;
  }
  throw new Error(`unknown command: ${command}`);
}

export async function main(args) {
  if (process.platform !== "win32") {
    const result = spawnSync(resolve(ROOT, "scripts", "cairn-container"), args, { stdio: "inherit" });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
    return;
  }
  runNativeContainer(args);
}
