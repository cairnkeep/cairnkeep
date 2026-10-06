import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { resolve } from "node:path";

import { privatePathIsSafe } from "./platform-security.js";

export type HttpTokenResolution =
    | { ok: true; source: "environment" | "file"; token: string; file?: string }
    | { ok: false; reason: "missing" | "multiple" | "token-unsafe" | "file-missing" | "file-unsafe" | "file-changed" | "file-unreadable"; file?: string };

export function bearerTokenIsSafe(token: string): boolean {
    return /^[A-Za-z0-9._~+/-]+=*$/.test(token);
}

export function normalizeHttpHost(raw: string | undefined): string {
    return raw?.trim() || "127.0.0.1";
}

export type HttpPortResolution =
    | { enabled: false }
    | { enabled: true; port: number }
    | { enabled: false; error: "invalid" };

export function parseHttpPort(raw: string | undefined): HttpPortResolution {
    if (raw === undefined || raw === "") return { enabled: false };
    if (!/^[1-9][0-9]{0,4}$/.test(raw)) return { enabled: false, error: "invalid" };
    const port = Number(raw);
    return port <= 65535 ? { enabled: true, port } : { enabled: false, error: "invalid" };
}

export function formatHostAuthority(host: string, port: number): string {
    const normalized = host.trim();
    return `${normalized.includes(":") && !normalized.startsWith("[") ? `[${normalized}]` : normalized}:${port}`;
}

export function normalizeHostAuthority(raw: string | undefined, defaultPort?: number): string | undefined {
    if (!raw || raw.trim() !== raw || /[/\\@]/.test(raw)) return undefined;
    const explicit = /^\[([^\]]+)\]:([0-9]+)$/.exec(raw) ?? /^([^:]+):([0-9]+)$/.exec(raw);
    const implicit = defaultPort === undefined ? undefined : /^\[([^\]]+)\]$/.exec(raw) ?? /^([^:]+)$/.exec(raw);
    const match = explicit ?? implicit;
    if (!match) return undefined;
    const port = parseHttpPort(explicit ? match[2] : String(defaultPort));
    if (!port.enabled || "error" in port) return undefined;
    try {
        const bracketed = raw.startsWith("[");
        const parsed = new URL(`http://${bracketed ? `[${match[1]}]` : match[1]}/`);
        if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return undefined;
        return `${parsed.hostname}:${port.port}`;
    } catch {
        return undefined;
    }
}

function readBoundedDescriptor(descriptor: number, approvedSize: number): Buffer {
    const buffer = Buffer.allocUnsafe(approvedSize + 1);
    let offset = 0;
    while (offset < buffer.byteLength) {
        const bytesRead = readSync(descriptor, buffer, offset, buffer.byteLength - offset, null);
        if (bytesRead === 0) break;
        offset += bytesRead;
    }
    return buffer.subarray(0, offset);
}

export function resolveHttpToken(env: NodeJS.ProcessEnv, options: { baseDirectory?: string } = {}): HttpTokenResolution {
    const direct = env.CAIRN_MEMORY_HTTP_TOKEN?.trim();
    const rawFile = env.CAIRN_MEMORY_HTTP_TOKEN_FILE?.trim();
    if (direct && rawFile) return { ok: false, reason: "multiple", file: rawFile };
    if (direct) return bearerTokenIsSafe(direct)
        ? { ok: true, source: "environment", token: direct }
        : { ok: false, reason: "token-unsafe" };
    if (!rawFile) return { ok: false, reason: "missing" };
    const file = resolve(options.baseDirectory ?? process.cwd(), rawFile);
    let descriptor: number | undefined;
    try {
        const nonBlocking = process.platform === "win32" ? 0 : (constants.O_NONBLOCK ?? 0);
        descriptor = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | nonBlocking);
        const opened = fstatSync(descriptor);
        if (!opened.isFile() || opened.size > 64 * 1024) return { ok: false, reason: "file-unsafe", file };
        const tokenBytes = readBoundedDescriptor(descriptor, opened.size);
        const afterRead = fstatSync(descriptor);
        const named = lstatSync(file);
        if (named.isSymbolicLink() || !named.isFile()
            || opened.dev !== afterRead.dev || opened.ino !== afterRead.ino || opened.size !== afterRead.size
            || opened.mtimeMs !== afterRead.mtimeMs || opened.ctimeMs !== afterRead.ctimeMs
            || opened.dev !== named.dev || opened.ino !== named.ino
            || tokenBytes.byteLength !== afterRead.size || tokenBytes.byteLength > 64 * 1024) {
            return { ok: false, reason: "file-changed", file };
        }
        if (!privatePathIsSafe(file)) return { ok: false, reason: "file-unsafe", file };
        const namedAfterAcl = lstatSync(file);
        if (namedAfterAcl.dev !== opened.dev || namedAfterAcl.ino !== opened.ino || namedAfterAcl.isSymbolicLink()) {
            return { ok: false, reason: "file-changed", file };
        }
        const token = tokenBytes.toString("utf8").trim();
        return bearerTokenIsSafe(token)
            ? { ok: true, source: "file", token, file }
            : { ok: false, reason: "token-unsafe", file };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ok: false, reason: "file-missing", file };
        return { ok: false, reason: "file-unreadable", file };
    } finally {
        if (descriptor !== undefined) closeSync(descriptor);
    }
}
