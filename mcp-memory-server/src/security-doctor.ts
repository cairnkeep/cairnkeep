import { lstatSync, realpathSync, type Stats } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import { normalizeHostAuthority, normalizeHttpHost, parseHttpPort, resolveHttpToken } from "./http-security.js";
import { resolveMcpToolProfile } from "./mcp-tool-profile.js";
import { parentReplacementBoundaryIsSafe, posixPrivateMetadataIsSafe, privatePathIsSafe, replacementBoundaryIsSafe } from "./platform-security.js";

export type SecurityCheckState = "PASS" | "WARN" | "FAIL" | "SKIP";
export type SecurityCheck = {
    id: string;
    state: SecurityCheckState;
    summary: string;
    remediation?: string;
};
export type SecurityDoctorReport = {
    schema_version: 1;
    ok: boolean;
    project_root: string;
    checks: SecurityCheck[];
    summary: { pass: number; warn: number; fail: number; skip: number };
};

const PRIVATE_PROJECT_FILES = [
    ".ai/.env",
    ".ai/capabilities.json",
    ".ai/mcp-tools.json",
    ".ai/playbooks.json",
] as const;

function loopbackHost(host: string): boolean {
    const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
    return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
}

function tokenStrength(token: string): "missing" | "weak" | "ok" {
    const bytes = Buffer.byteLength(token.trim(), "utf8");
    if (bytes === 0) return "missing";
    if (bytes < 32 || /^(.)(?:\1)+$/.test(token.trim())) return "weak";
    return "ok";
}

function lstatIfPresent(path: string): Stats | undefined {
    try {
        return lstatSync(path);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
    }
}

function checkPrivateDirectory(projectRoot: string): SecurityCheck {
    const path = join(projectRoot, ".ai");
    const info = lstatIfPresent(path);
    if (!info) return { id: "private-directory:.ai", state: "SKIP", summary: ".ai is not present" };
    const safePermissions = process.platform === "win32"
        ? privatePathIsSafe(path)
        : posixPrivateMetadataIsSafe(info) && (Number(info.mode) & 0o700) === 0o700;
    if (!info.isDirectory() || info.isSymbolicLink() || !safePermissions) {
        return { id: "private-directory:.ai", state: "FAIL", summary: ".ai is symlinked, non-directory, inaccessible, or not private to a trusted owner", remediation: process.platform === "win32" ? "Restrict .ai to the current account and remove inherited access." : "Replace symlinks, restore trusted ownership, and run: chmod 700 .ai" };
    }
    return { id: "private-directory:.ai", state: "PASS", summary: ".ai is a real directory not writable by other accounts" };
}

function checkPrivateFile(projectRoot: string, relativePath: string, safeParent: boolean): SecurityCheck {
    const path = join(projectRoot, ...relativePath.split("/"));
    if (!safeParent) return { id: `private-file:${relativePath}`, state: "SKIP", summary: `${relativePath} was not followed through an unsafe .ai directory` };
    let info: Stats | undefined;
    try {
        info = lstatIfPresent(path);
    } catch {
        return { id: `private-file:${relativePath}`, state: "FAIL", summary: `${relativePath} metadata is inaccessible`, remediation: "Restore trusted ownership and private directory traversal permissions." };
    }
    if (!info) return { id: `private-file:${relativePath}`, state: "SKIP", summary: `${relativePath} is not present` };
    if (!info.isFile() || info.isSymbolicLink() || !privatePathIsSafe(path)) {
        return {
            id: `private-file:${relativePath}`,
            state: "FAIL",
            summary: `${relativePath} is not a private regular file`,
            remediation: process.platform === "win32"
                ? `Restrict ${relativePath} to the current account and remove inherited access.`
                : `Run: chmod 600 ${relativePath}`,
        };
    }
    return { id: `private-file:${relativePath}`, state: "PASS", summary: `${relativePath} is private and non-symlinked` };
}

function sameFileIdentity(left: Stats, right: Stats): boolean {
    return left.dev === right.dev && left.ino === right.ino && left.isDirectory() === right.isDirectory();
}

export function securityDoctor(options: { projectRoot?: string; env?: NodeJS.ProcessEnv; environmentIssue?: string; testBeforeCanonicalize?: () => void } = {}): SecurityDoctorReport {
    const env = options.env ?? process.env;
    const requestedRoot = resolve(options.projectRoot ?? process.cwd());
    const checks: SecurityCheck[] = [];
    let projectRoot = requestedRoot;
    let projectRootTrusted = false;

    let requestedInfo: Stats | undefined;
    try {
        requestedInfo = lstatIfPresent(requestedRoot);
    } catch {
        checks.push({ id: "project-root", state: "FAIL", summary: "Project root metadata is inaccessible", remediation: "Restore trusted ownership and directory traversal permissions." });
    }
    if (!requestedInfo) {
        if (!checks.some(({ id }) => id === "project-root")) checks.push({ id: "project-root", state: "FAIL", summary: "Project root does not exist", remediation: "Run the command from a real project directory." });
    } else {
        const info = requestedInfo;
        if (!info.isDirectory() || info.isSymbolicLink() || !replacementBoundaryIsSafe(requestedRoot)) {
            checks.push({ id: "project-root", state: "FAIL", summary: "Project root is symlinked, non-directory, or writable by another account", remediation: process.platform === "win32" ? "Use a project directory whose ACL denies replacement by untrusted accounts." : "Use a canonical project directory and run: chmod go-w ." });
        } else if (!parentReplacementBoundaryIsSafe(requestedRoot)) {
            checks.push({ id: "project-root-parent", state: "FAIL", summary: "The requested project parent directory can replace the selected project root", remediation: "Move the project below an owner-controlled directory or restrict the parent directory permissions." });
        } else {
            try {
                options.testBeforeCanonicalize?.();
                const canonical = realpathSync(requestedRoot);
                const requestedAfter = lstatSync(requestedRoot);
                const canonicalInfo = lstatSync(canonical);
                if (requestedAfter.isSymbolicLink() || !sameFileIdentity(info, requestedAfter) || !sameFileIdentity(info, canonicalInfo)
                    || !parentReplacementBoundaryIsSafe(canonical)) throw new Error("project identity changed");
                projectRoot = canonical;
                projectRootTrusted = true;
                checks.push({ id: "project-root", state: "PASS", summary: "Project root and its immediate replacement boundary are protected" });
            } catch {
                checks.push({ id: "project-root", state: "FAIL", summary: "Project root identity or canonical location changed during inspection", remediation: "Retry after placing the project below an owner-controlled, non-symlink directory." });
            }
            if (projectRootTrusted) {
                const directoryCheck = checkPrivateDirectory(projectRoot);
                checks.push(directoryCheck);
                for (const file of PRIVATE_PROJECT_FILES) checks.push(checkPrivateFile(projectRoot, file, directoryCheck.state !== "FAIL"));
            }
        }
    }

    if (options.environmentIssue) checks.push({ id: "project-environment", state: "FAIL", summary: "Project .ai/.env could not be interpreted safely", remediation: options.environmentIssue });
    else checks.push({ id: "project-environment", state: "PASS", summary: "Project environment uses supported literal assignments or is absent" });

    let profileMode: string | undefined;
    if (!projectRootTrusted) {
        checks.push({ id: "mcp-profile", state: "SKIP", summary: "MCP tool profile was not read through an unsafe project root" });
    } else {
        try {
            const profile = resolveMcpToolProfile({ projectRoot, env });
            profileMode = profile.mode;
            checks.push({ id: "mcp-profile", state: "PASS", summary: `MCP tool profile is valid (${profile.mode})` });
        } catch {
            checks.push({ id: "mcp-profile", state: "FAIL", summary: "MCP tool profile is invalid or unsafe", remediation: "Run: cairn mcp-tools status --project ." });
        }
    }

    const portResolution = parseHttpPort(env.MCP_HTTP_PORT);
    if ("error" in portResolution) {
        checks.push({ id: "http-exposure", state: "FAIL", summary: "MCP_HTTP_PORT is invalid", remediation: "Unset MCP_HTTP_PORT or choose a canonical decimal port from 1 through 65535." });
    } else if (!portResolution.enabled) {
        checks.push({ id: "http-exposure", state: "SKIP", summary: "MCP HTTP transport is disabled" });
    } else {
        const port = portResolution.port;
        const host = normalizeHttpHost(env.MCP_HTTP_HOST);
        const resolution = !projectRootTrusted && env.CAIRN_MEMORY_HTTP_TOKEN_FILE && !isAbsolute(env.CAIRN_MEMORY_HTTP_TOKEN_FILE)
            ? { ok: false as const, reason: "unsafe-base" as const }
            : resolveHttpToken(env, { baseDirectory: projectRoot });
        let token: string | undefined;
        if (resolution.ok) {
            token = resolution.token;
            if (resolution.source === "file") checks.push({ id: "http-token-file", state: "PASS", summary: "HTTP token file is private and non-symlinked" });
        } else if (resolution.reason !== "missing") {
            const id = resolution.reason === "multiple" ? "http-token-source"
                : resolution.reason === "token-unsafe" ? "http-token"
                : "http-token-file";
            checks.push({ id, state: "FAIL", summary: `HTTP token resolution failed (${resolution.reason})`, remediation: "Set exactly one token source and use a readable, private, non-symlink token file with an ASCII Bearer token." });
        }
        const strength = tokenStrength(token ?? "");
        checks.push(strength === "ok"
            ? { id: "http-token", state: "PASS", summary: "HTTP bearer token meets the minimum length" }
            : { id: "http-token", state: "FAIL", summary: strength === "missing" ? "HTTP bearer token is missing" : "HTTP bearer token is too weak", remediation: "Generate at least 32 random bytes; for example: openssl rand -hex 32" });

        const nonLoopback = !loopbackHost(host);
        const hosts = (env.CAIRN_MEMORY_HTTP_ALLOWED_HOSTS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
        const invalidHosts = hosts.filter((value) => !normalizeHostAuthority(value));
        checks.push(invalidHosts.length > 0
            ? { id: "http-host-allowlist", state: "FAIL", summary: "HTTP Host allowlist contains an invalid authority", remediation: `Use host:port authorities matching port ${port}; bracket IPv6 literals.` }
            : nonLoopback && hosts.length === 0
            ? { id: "http-host-allowlist", state: "WARN", summary: "Non-loopback HTTP binding relies on the derived Host allowlist", remediation: "Set CAIRN_MEMORY_HTTP_ALLOWED_HOSTS explicitly to the public host names and ports." }
            : { id: "http-host-allowlist", state: "PASS", summary: nonLoopback ? "Non-loopback HTTP binding has an explicit Host allowlist" : "HTTP binding is loopback-only" });

        if (nonLoopback && profileMode === "full") {
            checks.push({ id: "http-least-authority", state: "WARN", summary: "Network HTTP exposure uses the full MCP tool profile", remediation: "Use CAIRN_MCP_TOOL_PROFILE=read-only or an explicit custom allowlist when mutations are unnecessary." });
        } else {
            checks.push({ id: "http-least-authority", state: "PASS", summary: "HTTP exposure and MCP tool authority are bounded" });
        }
    }

    const remote = env.CAIRN_MEMORY_REMOTE_URL?.trim();
    if (!remote) {
        checks.push({ id: "remote-transport", state: "SKIP", summary: "Remote memory endpoint is not configured" });
    } else {
        try {
            const url = new URL(remote);
            if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
                checks.push({ id: "remote-transport", state: "FAIL", summary: "Remote memory URL has an unsafe scheme or embedded credentials", remediation: "Use an HTTP(S) URL and provide credentials through the supported secret environment variable." });
            } else {
                const local = loopbackHost(url.hostname);
                checks.push(url.protocol === "https:" || local
                    ? { id: "remote-transport", state: "PASS", summary: "Remote memory transport is encrypted or loopback-only" }
                    : { id: "remote-transport", state: "WARN", summary: "Remote memory transport uses plaintext HTTP", remediation: "Use HTTPS or a separately authenticated private network." });
            }
        } catch {
            checks.push({ id: "remote-transport", state: "FAIL", summary: "Remote memory URL is invalid", remediation: "Set CAIRN_MEMORY_REMOTE_URL to an absolute HTTP or HTTPS URL." });
        }
    }

    const summary = { pass: 0, warn: 0, fail: 0, skip: 0 };
    for (const check of checks) summary[check.state.toLowerCase() as keyof typeof summary] += 1;
    return { schema_version: 1, ok: summary.fail === 0, project_root: projectRoot, checks, summary };
}
