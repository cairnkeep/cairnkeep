import { createHash } from "node:crypto";
import { relative, resolve } from "node:path";

import { failureSignatureSchema, type FailureFrame, type FailureSignature } from "./note-schema.js";

const ANSI = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g;
const INTERNAL_FRAME = /(?:node:internal|internal\/process|processTicksAndRejections|__node_internal|<anonymous>)/i;

export type FailureSignatureOptions = {
    root?: string;
    component?: string;
};

function hash(domain: string, value: unknown): string {
    return createHash("sha256")
        .update(`cairnkeep:hindsight:v1:${domain}\0`)
        .update(JSON.stringify(value))
        .digest("hex");
}

function safePath(value: string, root?: string): string {
    let path = value.trim().replace(/^['"(]|['"),]$/g, "").replaceAll("\\", "/");
    path = path.replace(/:\d+(?::\d+)?$/, "");
    if (root) {
        const normalizedRoot = resolve(root).replaceAll("\\", "/").replace(/\/$/, "");
        if (path === normalizedRoot) return "";
        if (path.startsWith(`${normalizedRoot}/`)) path = path.slice(normalizedRoot.length + 1);
        else {
            const candidate = relative(normalizedRoot, path).replaceAll("\\", "/");
            if (!candidate.startsWith("../") && candidate !== "..") path = candidate;
        }
    }
    const projectTail = path.match(/(?:^|\/)((?:src|pkg|lib|test|tests|app)\/[^\s:()]+)$/i);
    if (projectTail) path = projectTail[1];
    path = path.replace(/^\.?\//, "").replace(/^\/+/, "");
    return path.slice(0, 1024);
}

function normalizeVolatile(value: string, root?: string): string {
    let result = value.replace(ANSI, "").replaceAll("\r", "");
    if (root) {
        const normalizedRoot = resolve(root).replaceAll("\\", "/").replace(/\/$/, "");
        result = result.replaceAll(normalizedRoot, "<root>");
    }
    return result
        .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/gi, "<timestamp>")
        .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "<uuid>")
        .replace(/\breq_[a-z0-9_-]{16,}\b/gi, "req_<id>")
        .replace(/\bpid\s*[=:]?\s*\d+\b/gi, "pid <pid>")
        .replace(/\b0x[0-9a-f]+\b/gi, "<address>")
        .replace(/:(\d+)(?::\d+)?(?=\b|\))/g, ":<line>")
        .replace(/[\t\u00a0 ]+/g, " ")
        .trim();
}

function parseFrames(text: string, root?: string): FailureFrame[] {
    const frames: FailureFrame[] = [];
    const add = (fn: string, file: string) => {
        const normalizedFunction = fn.replace(/^async\s+/, "").trim();
        const normalizedFile = safePath(file, root);
        if (!normalizedFunction || !normalizedFile || INTERNAL_FRAME.test(`${normalizedFunction} ${normalizedFile}`)) return;
        if (!frames.some((frame) => frame.function === normalizedFunction && frame.file === normalizedFile)) {
            frames.push({ function: normalizedFunction.slice(0, 512), file: normalizedFile });
        }
    };

    for (const rawLine of text.replace(ANSI, "").replaceAll("\r", "").split("\n")) {
        const line = rawLine.trim();
        let match = line.match(/^at\s+(?:async\s+)?(.+?)\s+\((.+?):\d+(?::\d+)?\)$/);
        if (match) { add(match[1], match[2]); continue; }
        match = line.match(/^at\s+(.+?):\d+(?::\d+)?$/);
        if (match) { add("<module>", match[1]); continue; }
        match = line.match(/^File\s+["'](.+?)["'],\s+line\s+\d+,\s+in\s+(.+)$/);
        if (match) { add(match[2], match[1]); continue; }
        match = line.match(/^at\s+([\w.$<>]+)\(([^():]+\.java):\d+\)$/);
        if (match) { add(match[1], match[2]); continue; }
        match = line.match(/^\d+:\s+(?:0x[0-9a-f]+\s+-\s+)?(.+)$/i);
        if (match) {
            const source = text.match(/(?:^|[\s,])((?:\/[^\s,:]+)*\/(?:src|pkg|lib|test|tests)\/[^\s,:]+):\d+(?::\d+)?/im);
            if (source) add(match[1], source[1]);
        }
    }
    return frames.slice(0, 16);
}

function selectMessage(text: string, root?: string): string {
    const lines = normalizeVolatile(text, root).split("\n").map((line) => line.trim()).filter(Boolean);
    const python = [...lines].reverse().find((line) => /^[\w.]+(?:Error|Exception):/.test(line) || /^[A-Z][\w.]*Error:/.test(line));
    if (lines.some((line) => /^Traceback \(/.test(line)) && python) return python;
    const first = lines.find((line) => !/^(?:at\s+|File\s+|stack backtrace:|\d+:\s+(?:<address>|0x))/i.test(line));
    if (!first) return "unknown failure";
    return first
        .replace(/,\s*(?:<root>|\/?(?:[^\s,]+\/)*(?:src|pkg|lib|test|tests)\/[^\s,:]+):<line>$/i, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 4096);
}

function familyFor(message: string): string {
    if (/\bpanicked at\b/i.test(message)) return "panic";
    const diagnostic = message.match(/^([A-Z]{2,}\d{3,}):/);
    if (diagnostic) return diagnostic[1].toLowerCase();
    const typed = message.match(/^([A-Za-z_$][\w.$-]*(?:Error|Exception))\s*:/);
    const raw = typed?.[1].split(".").at(-1) ?? message.split(":", 1)[0] ?? "failure";
    return raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 128) || "failure";
}

export function buildFailureSignature(text: string, options: FailureSignatureOptions = {}): FailureSignature {
    const normalizedMessage = selectMessage(text, options.root);
    const frames = parseFrames(text, options.root);
    const explicitComponent = options.component ? safePath(options.component, options.root) : "";
    const sourceInMessage = text.match(/(?:^|[\s,])((?:\/[^\s,:]+)*\/(?:src|pkg|lib|test|tests)\/[^\s,:]+):\d+(?::\d+)?/im);
    const component = explicitComponent || frames[0]?.file || (sourceInMessage ? safePath(sourceInMessage[1], options.root) : "");
    const family = familyFor(normalizedMessage);
    const normalizedForHash = normalizedMessage.toLocaleLowerCase("en-US");
    const stackDigest = frames.length > 0 ? hash("stack", frames) : "";
    const fullDigest = hash("full", { family, message: normalizedForHash, stack_digest: stackDigest, component });
    const signature = {
        signature_version: 1 as const,
        family,
        normalized_message: normalizedMessage,
        stack_digest: stackDigest,
        component,
        frames,
        lookup_keys: {
            full: `v1:full:${fullDigest}`,
            message_stack: `v1:message-stack:${hash("message-stack", { family, message: normalizedForHash, stack_digest: stackDigest })}`,
            message_component: `v1:message-component:${hash("message-component", { family, message: normalizedForHash, component })}`,
            message: `v1:message:${hash("message", { family, message: normalizedForHash })}`,
        },
        fingerprint: fullDigest,
    };
    return failureSignatureSchema.parse(signature);
}
