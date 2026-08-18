#!/usr/bin/env node
import {
    PLAYBOOK_ACTIONS,
    evaluatePlaybook,
    inferChangeTypes,
    initializePlaybook,
    resetPlaybook,
    resetPlaybookOverride,
    resolvePlaybookStatus,
    setPlaybookOverride,
    setPlaybookProfile,
} from "./playbook.js";
import { doctorPlaybooks, listPlaybookReceipts, readPlaybookReceipt, recordPlaybookReceipt } from "./playbook-receipt.js";
import {
    PLAYBOOK_ACTION_IDS,
    PLAYBOOK_CHANGE_TYPES,
    PLAYBOOK_PROFILES,
    playbookActionIdSchema,
    playbookActorKindSchema,
    playbookComplexitySchema,
    playbookEventSchema,
    playbookFamiliaritySchema,
    playbookModeSchema,
    playbookOutcomeSchema,
    playbookProfileSchema,
    playbookRiskSchema,
    type PlaybookEvidence,
} from "./playbook-schema.js";

process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0);
    throw error;
});

function usage(): string {
    return `cairn playbook — bounded workflow policy for coding agents

Usage:
  cairn playbook list [--json]
  cairn playbook status [--project PATH] [--json]
  cairn playbook init [minimal|balanced|strict] [--project PATH] [--json]
  cairn playbook set minimal|balanced|strict [--project PATH] [--json]
  cairn playbook enable ACTION must|should|may [--project PATH] [--json]
  cairn playbook disable ACTION [--project PATH] [--json]
  cairn playbook reset [ACTION] [--project PATH] [--json]
  cairn playbook check start|check|finish [signals] [evidence] [--enforce] [--json]
  cairn playbook record --policy DIGEST --decision DIGEST --event EVENT --action ACTION --outcome OUTCOME [identity] [--json]
  cairn playbook receipts list|show [RECEIPT] [--project PATH] [--json]
  cairn playbook instructions install|check|remove [--project PATH] [--json]
  cairn playbook doctor [--project PATH] [--json]

Check signals:
  --complexity trivial|standard|complex   --familiarity known|mixed|unfamiliar
  --risk low|normal|high|security         --public-change
  --changed PATH...                       --change-type TYPE...
  --completed ACTION...                   --skipped ACTION=REASON...
  --failed ACTION=REASON...               --actor ID --actor-kind user|agent|service --session ID

Policies select only Cairnkeep-owned actions. Checking never executes an action,
contacts a network service, or grants approval. Actor identity is caller-supplied
and unauthenticated until a future team deployment binds it to authentication.
`;
}

function checkUsage(): string {
    return `Usage:
  cairn playbook check start|check|finish [signals] [evidence] [--enforce] [--json]

Signals:
  --complexity trivial|standard|complex   --familiarity known|mixed|unfamiliar
  --risk low|normal|high|security         --public-change
  --changed PATH...                       --change-type TYPE...

Evidence and provenance:
  --completed ACTION...                   --skipped ACTION=REASON...
  --failed ACTION=REASON...               --actor ID --actor-kind user|agent|service
  --session ID
`;
}

function recordUsage(): string {
    return `Usage:
  cairn playbook record --policy DIGEST --decision DIGEST --event start|check|finish \\
    --action ACTION --outcome completed|skipped|failed [--reason REASON] \\
    [--actor ID] [--actor-kind user|agent|service] [--session ID] \\
    [--project PATH] [--json]

Record one material action outcome per call using the exact policy and decision
digests returned by the corresponding check. Actor identity is caller-supplied
and unauthenticated in this release.

Actions:
  context.recall  context.explore  work.plan  verify.tests
  review.repository  review.security  docs.update  learning.capture
`;
}

type Parsed = {
    positional: string[];
    options: Map<string, string[]>;
    flags: Set<string>;
    json: boolean;
    projectRoot: string;
};

const VALUE_OPTIONS = new Set([
    "--project", "--complexity", "--familiarity", "--risk", "--changed", "--change-type",
    "--completed", "--skipped", "--failed", "--actor", "--actor-kind", "--session",
    "--policy", "--decision", "--event", "--action", "--outcome", "--reason",
]);
const FLAG_OPTIONS = new Set(["--json", "--enforce", "--public-change"]);
const MULTI_OPTIONS = new Set(["--changed", "--change-type", "--completed", "--skipped", "--failed"]);

function parse(raw: string[]): Parsed {
    const positional: string[] = [];
    const options = new Map<string, string[]>();
    const flags = new Set<string>();
    for (let index = 0; index < raw.length; index += 1) {
        const value = raw[index];
        if (FLAG_OPTIONS.has(value)) {
            if (flags.has(value)) throw new Error(`Duplicate ${value}.`);
            flags.add(value);
            continue;
        }
        if (VALUE_OPTIONS.has(value)) {
            const values = options.get(value) ?? [];
            if (!MULTI_OPTIONS.has(value) && values.length) throw new Error(`Duplicate ${value}.`);
            let consumed = 0;
            while (index + 1 < raw.length && !raw[index + 1].startsWith("--")) {
                values.push(raw[index + 1]);
                index += 1;
                consumed += 1;
                if (!MULTI_OPTIONS.has(value)) break;
            }
            if (consumed === 0) throw new Error(`Missing value for ${value}.`);
            options.set(value, values);
            continue;
        }
        if (value.startsWith("--")) throw new Error(`Unknown option ${value}.`);
        positional.push(value);
    }
    return {
        positional,
        options,
        flags,
        json: flags.has("--json"),
        projectRoot: options.get("--project")?.[0] ?? process.cwd(),
    };
}

function one(parsed: Parsed, name: string, fallback?: string): string | undefined {
    return parsed.options.get(name)?.[0] ?? fallback;
}

function many(parsed: Parsed, name: string): string[] {
    return parsed.options.get(name) ?? [];
}

function ensureAllowed(parsed: Parsed, allowedOptions: string[], allowedFlags: string[]): void {
    for (const key of parsed.options.keys()) if (!allowedOptions.includes(key)) throw new Error(`${key} is not valid for this command.`);
    for (const key of parsed.flags) if (!allowedFlags.includes(key)) throw new Error(`${key} is not valid for this command.`);
}

function output(value: unknown, json: boolean, human: string): void {
    process.stdout.write(`${json ? JSON.stringify(value) : human}\n`);
}

function humanStatus(status: Awaited<ReturnType<typeof resolvePlaybookStatus>>): string {
    return [
        `Profile: ${status.profile}`,
        `Source: ${status.source}`,
        `Policy digest: ${status.policy_digest}`,
        `Configuration: ${status.config_exists ? ".ai/playbooks.json" : "built-in balanced default"}`,
        `Issues: ${status.issues.length ? status.issues.join(", ") : "none"}`,
        ...PLAYBOOK_ACTION_IDS.map((id) => `${id}\t${status.modes[id]}${status.overrides[id] ? "\toverride" : ""}`),
    ].join("\n");
}

function parseEvidence(values: string[], outcome: PlaybookEvidence["outcome"]): PlaybookEvidence[] {
    return values.map((value) => {
        const separator = value.indexOf("=");
        const action = separator < 0 ? value : value.slice(0, separator);
        const reason = separator < 0 ? "" : value.slice(separator + 1);
        playbookActionIdSchema.parse(action);
        if (outcome !== "completed" && reason.trim().length === 0) throw new Error(`${outcome} evidence requires ACTION=REASON.`);
        return { action: action as PlaybookEvidence["action"], outcome, reason };
    });
}

function actor(parsed: Parsed) {
    const id = one(parsed, "--actor", process.env.CAIRN_PLAYBOOK_ACTOR ?? "local-agent") as string;
    const kind = playbookActorKindSchema.parse(one(parsed, "--actor-kind", process.env.CAIRN_PLAYBOOK_ACTOR_KIND ?? "agent"));
    return { id, kind, authenticated: false as const };
}

function session(parsed: Parsed): string {
    return one(parsed, "--session", process.env.CAIRN_PLAYBOOK_SESSION ?? `local-${process.pid}`) as string;
}

function humanDecision(value: Awaited<ReturnType<typeof evaluatePlaybook>>): string {
    const lines = [
        `Playbook: ${value.profile} (${value.policy_digest})`,
        `Decision: ${value.decision_digest}`,
        `Event: ${value.event}`,
    ];
    if (value.actions.length === 0) lines.push("Actions: none");
    else {
        lines.push("Actions:");
        for (const row of value.actions) {
            lines.push(`  [${row.outcome === "completed" ? "x" : " "}] ${row.mode.toUpperCase()} ${row.id} — ${row.title}`);
            lines.push(`      ${row.rationale}`);
            lines.push(`      ${row.command}`);
            if (row.reason) lines.push(`      evidence: ${row.outcome} — ${row.reason}`);
        }
    }
    lines.push(`Blocking: ${value.blocking_actions.length ? value.blocking_actions.join(", ") : "none"}`);
    lines.push("Actor authentication: unverified local assertion");
    return lines.join("\n");
}

async function check(parsed: Parsed): Promise<void> {
    ensureAllowed(parsed, ["--project", "--complexity", "--familiarity", "--risk", "--changed", "--change-type", "--completed", "--skipped", "--failed", "--actor", "--actor-kind", "--session"], ["--json", "--enforce", "--public-change"]);
    if (parsed.positional.length !== 1) throw new Error("check requires one lifecycle event.");
    const event = playbookEventSchema.parse(parsed.positional[0]);
    const explicitTypes = many(parsed, "--change-type").map((value) => {
        if (!(PLAYBOOK_CHANGE_TYPES as readonly string[]).includes(value)) throw new Error(`Unknown change type ${value}.`);
        return value as (typeof PLAYBOOK_CHANGE_TYPES)[number];
    });
    const changed = many(parsed, "--changed");
    const evidence = [
        ...parseEvidence(many(parsed, "--completed"), "completed"),
        ...parseEvidence(many(parsed, "--skipped"), "skipped"),
        ...parseEvidence(many(parsed, "--failed"), "failed"),
    ];
    const value = await evaluatePlaybook({
        projectRoot: parsed.projectRoot,
        event,
        actor: actor(parsed),
        sessionId: session(parsed),
        signals: {
            complexity: playbookComplexitySchema.parse(one(parsed, "--complexity", "standard")),
            familiarity: playbookFamiliaritySchema.parse(one(parsed, "--familiarity", "mixed")),
            risk: playbookRiskSchema.parse(one(parsed, "--risk", "normal")),
            public_change: parsed.flags.has("--public-change"),
            changed_paths: changed,
            change_types: inferChangeTypes(changed, explicitTypes),
        },
        evidence,
    });
    output(value, parsed.json, humanDecision(value));
    if (value.issues.length) process.exitCode = 2;
    else if (parsed.flags.has("--enforce") && value.blocking_actions.length) process.exitCode = 3;
}

async function record(parsed: Parsed): Promise<void> {
    ensureAllowed(parsed, ["--project", "--policy", "--decision", "--event", "--action", "--outcome", "--reason", "--actor", "--actor-kind", "--session"], ["--json"]);
    if (parsed.positional.length !== 0) throw new Error("record accepts options only.");
    const value = await recordPlaybookReceipt({
        projectRoot: parsed.projectRoot,
        policyDigest: one(parsed, "--policy") ?? "",
        decisionDigest: one(parsed, "--decision") ?? "",
        actor: actor(parsed),
        sessionId: session(parsed),
        event: playbookEventSchema.parse(one(parsed, "--event")),
        action: playbookActionIdSchema.parse(one(parsed, "--action")),
        outcome: playbookOutcomeSchema.parse(one(parsed, "--outcome")),
        reason: one(parsed, "--reason", ""),
    });
    output(value, parsed.json, `Recorded ${value.receipt_id}: ${value.action} ${value.outcome}.`);
}

async function main(): Promise<void> {
    const [command = "help", ...raw] = process.argv.slice(2);
    if (["help", "--help", "-h"].includes(command)) {
        if (raw.length) throw new Error("help accepts no arguments.");
        process.stdout.write(usage());
        return;
    }
    if (command === "check" && raw.some((value) => ["--help", "-h"].includes(value))) {
        const helpArguments = raw.filter((value) => !["--help", "-h"].includes(value));
        if (raw.length !== helpArguments.length + 1
            || helpArguments.length > 1
            || (helpArguments.length === 1 && !["start", "check", "finish"].includes(helpArguments[0]))) {
            throw new Error("check help accepts at most one event: start, check, or finish.");
        }
        process.stdout.write(checkUsage());
        return;
    }
    if (command === "record" && raw.length === 1 && ["--help", "-h"].includes(raw[0])) {
        process.stdout.write(recordUsage());
        return;
    }
    const parsed = parse(raw);
    if (command === "list") {
        ensureAllowed(parsed, [], ["--json"]);
        if (parsed.positional.length) throw new Error("list accepts no arguments.");
        const value = { schema_version: 1, profiles: PLAYBOOK_PROFILES, actions: PLAYBOOK_ACTIONS };
        output(value, parsed.json, PLAYBOOK_ACTIONS.map(({ id, title, command: actionCommand }) => `${id}\t${title}\t${actionCommand}`).join("\n"));
        return;
    }
    if (command === "status") {
        ensureAllowed(parsed, ["--project"], ["--json"]);
        if (parsed.positional.length) throw new Error("status accepts no positional arguments.");
        const value = await resolvePlaybookStatus({ projectRoot: parsed.projectRoot });
        output(value, parsed.json, humanStatus(value));
        if (value.issues.length) process.exitCode = 2;
        return;
    }
    if (command === "init" || command === "set") {
        ensureAllowed(parsed, ["--project"], ["--json"]);
        if (parsed.positional.length > 1 || (command === "set" && parsed.positional.length !== 1)) throw new Error(`${command} requires one profile.`);
        const profile = playbookProfileSchema.parse(parsed.positional[0] ?? "balanced");
        const value = command === "init"
            ? await initializePlaybook(parsed.projectRoot, profile)
            : await setPlaybookProfile(parsed.projectRoot, profile);
        output(value, parsed.json, humanStatus(value));
        return;
    }
    if (command === "enable" || command === "disable") {
        ensureAllowed(parsed, ["--project"], ["--json"]);
        if (parsed.positional.length !== (command === "enable" ? 2 : 1)) throw new Error(`${command} has invalid arguments.`);
        const action = playbookActionIdSchema.parse(parsed.positional[0]);
        const mode = command === "disable" ? "off" : playbookModeSchema.parse(parsed.positional[1]);
        if (mode === "off" && command === "enable") throw new Error("Use disable ACTION to turn an action off.");
        const value = await setPlaybookOverride(parsed.projectRoot, action, mode);
        output(value, parsed.json, humanStatus(value));
        return;
    }
    if (command === "reset") {
        ensureAllowed(parsed, ["--project"], ["--json"]);
        if (parsed.positional.length > 1) throw new Error("reset accepts at most one action.");
        const value = parsed.positional[0]
            ? await resetPlaybookOverride(parsed.projectRoot, playbookActionIdSchema.parse(parsed.positional[0]))
            : await resetPlaybook(parsed.projectRoot);
        output(value, parsed.json, humanStatus(value));
        return;
    }
    if (command === "check") { await check(parsed); return; }
    if (command === "record") { await record(parsed); return; }
    if (command === "receipts") {
        ensureAllowed(parsed, ["--project"], ["--json"]);
        const operation = parsed.positional[0] ?? "list";
        if (operation === "list" && parsed.positional.length === 1) {
            const value = await listPlaybookReceipts(parsed.projectRoot);
            output(value, parsed.json, value.receipts.length ? value.receipts.map(({ receipt_id, action, outcome, recorded_at }) => `${receipt_id}\t${outcome}\t${action}\t${recorded_at}`).join("\n") : "No playbook receipts found.");
            return;
        }
        if (operation === "show" && parsed.positional.length === 2) {
            const value = await readPlaybookReceipt(parsed.positional[1], parsed.projectRoot);
            output(value, parsed.json, JSON.stringify(value, null, 2));
            return;
        }
        throw new Error("receipts requires list or show RECEIPT.");
    }
    if (command === "doctor") {
        ensureAllowed(parsed, ["--project"], ["--json"]);
        if (parsed.positional.length) throw new Error("doctor accepts no positional arguments.");
        const value = await doctorPlaybooks(parsed.projectRoot);
        output(value, parsed.json, JSON.stringify(value, null, 2));
        if (!value.ok) process.exitCode = 2;
        return;
    }
    if (command === "instructions") {
        ensureAllowed(parsed, ["--project"], ["--json"]);
        if (parsed.positional.length !== 1 || !["install", "check", "remove"].includes(parsed.positional[0])) throw new Error("instructions requires install, check, or remove.");
        const moduleUrl = new URL("../../scripts/playbook-instructions.mjs", import.meta.url).href;
        const instructionModule = await import(moduleUrl) as {
            reconcilePlaybookInstructions: (root: string, options: { check: boolean }) => { schema_version: 1; path: string; status: string };
            removePlaybookInstructions: (root: string, options: { check: boolean }) => { schema_version: 1; path: string; status: string };
        };
        const value = parsed.positional[0] === "remove"
            ? instructionModule.removePlaybookInstructions(parsed.projectRoot, { check: false })
            : instructionModule.reconcilePlaybookInstructions(parsed.projectRoot, { check: parsed.positional[0] === "check" });
        output(value, parsed.json, `${value.status}: ${value.path}`);
        if (parsed.positional[0] === "check" && value.status !== "unchanged") process.exitCode = 1;
        return;
    }
    throw new Error(`unknown playbook command "${command}".`);
}

main().catch((error) => {
    process.stderr.write(`cairn playbook: ${error instanceof Error ? error.message : "invalid command or policy"}\n`);
    process.exitCode = 2;
});
