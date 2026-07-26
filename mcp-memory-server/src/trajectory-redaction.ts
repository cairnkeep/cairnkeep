import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";

import type { RedactedTrajectory, TrajectorySession } from "./trajectory-schema.js";

const MAX_CUSTOM_PATTERNS = 32;
const MAX_PATTERN_LENGTH = 256;
const MAX_REPLACEMENT_LENGTH = 128;
const REDACTED = "[REDACTED]";

const redactionConfigSchema = z.object({
    version: z.literal(1),
    patterns: z.array(z.object({
        pattern: z.string().min(1).max(MAX_PATTERN_LENGTH),
        flags: z.string().regex(/^[gimsu]*$/).optional(),
        replacement: z.string().max(MAX_REPLACEMENT_LENGTH).optional(),
    }).strict()).max(MAX_CUSTOM_PATTERNS),
}).strict();

type CompiledPattern = { regex: RegExp; replacement: string; literalReplacement?: boolean };

const secretKeyPattern = /^(?:authorization|password|passwd|secret|token|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key)$/i;

const builtinPatterns: CompiledPattern[] = [
    { regex: /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, replacement: "Bearer [REDACTED]" },
    { regex: /\bsk-[A-Za-z0-9_-]{8,}/g, replacement: "[REDACTED:API_KEY]" },
    {
        regex: /\b(password|passwd|api[_-]?key|token|secret)\s*[:=]\s*[^\s"'&,;]+/gi,
        replacement: "$1=[REDACTED]",
    },
    {
        regex: /([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi,
        replacement: "$1[REDACTED]@",
    },
    {
        regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
        replacement: "[REDACTED:PRIVATE_KEY]",
    },
];

function assertContainedConfigPath(projectRoot: string, configuredPath: string): string {
    const allowedRoot = resolve(projectRoot);
    const candidate = resolve(projectRoot, configuredPath);
    const rel = relative(allowedRoot, candidate);
    if (rel.startsWith("..") || isAbsolute(rel)) {
        throw new Error("Trajectory redaction configuration must be inside the project root.");
    }
    return candidate;
}

function compileCustomPatterns(projectRoot: string): CompiledPattern[] {
    const explicitPath = process.env.CAIRN_TRAJECTORY_REDACTION_FILE?.trim();
    const defaultPath = ".ai/trajectory-redaction.json";
    const configuredPath = explicitPath || (existsSync(resolve(projectRoot, defaultPath)) ? defaultPath : "");
    if (!configuredPath) return [];
    const path = assertContainedConfigPath(projectRoot, configuredPath);
    const parsed = redactionConfigSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    return parsed.patterns.map((entry) => {
        const flags = entry.flags?.includes("g") ? entry.flags : `${entry.flags ?? ""}g`;
        return {
            regex: new RegExp(entry.pattern, flags),
            replacement: entry.replacement ?? "[REDACTED:CUSTOM]",
            literalReplacement: true,
        };
    });
}

function secretEnvironmentValues(): string[] {
    const values: string[] = [];
    for (const [name, value] of Object.entries(process.env)) {
        if (!value || !/(?:^|_)(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD)$/i.test(name)) continue;
        if (value.length < 6) continue;
        values.push(value);
    }
    return Array.from(new Set(values)).sort((a, b) => b.length - a.length);
}

function redactString(value: string, patterns: CompiledPattern[], environmentSecrets: string[]): string {
    let result = value;
    for (const secret of environmentSecrets) {
        if (result.includes(secret)) result = result.split(secret).join("[REDACTED:ENV]");
    }
    for (const { regex, replacement, literalReplacement } of patterns) {
        regex.lastIndex = 0;
        result = literalReplacement
            ? result.replace(regex, () => replacement)
            : result.replace(regex, replacement);
    }
    return result;
}

function redactValue(
    value: unknown,
    patterns: CompiledPattern[],
    environmentSecrets: string[],
    key?: string,
): unknown {
    if (key && secretKeyPattern.test(key)) return REDACTED;
    if (typeof value === "string") return redactString(value, patterns, environmentSecrets);
    if (Array.isArray(value)) return value.map((item) => redactValue(item, patterns, environmentSecrets));
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
            childKey,
            redactValue(childValue, patterns, environmentSecrets, childKey),
        ]));
    }
    return value;
}

export function redactTrajectory(session: TrajectorySession, projectRoot: string): RedactedTrajectory {
    const patterns = [...builtinPatterns, ...compileCustomPatterns(projectRoot)];
    const redacted = redactValue(session, patterns, secretEnvironmentValues());
    return redacted as RedactedTrajectory;
}
