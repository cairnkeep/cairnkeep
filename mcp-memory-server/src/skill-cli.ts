#!/usr/bin/env node

import { resolve } from "node:path";

import { canonicalDigest } from "./eval-schema.js";
import { evaluateSkillProposal } from "./skill-evaluation.js";
import {
    applySkillProposal,
    approveSkillCandidate,
    harvestSkillCandidates,
    listSkillApplications,
    listSkillCandidates,
    listSkillEvaluations,
    listSkillProposals,
    proposeSkill,
    readSkillApplication,
    readSkillCandidate,
    readSkillEvaluation,
    readSkillProposal,
    rollbackSkillApplication,
} from "./skill-store.js";

process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0);
    throw error;
});

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const KINDS = ["candidate", "proposal", "evaluation", "application"] as const;
type Kind = typeof KINDS[number];

function usage(): string {
    return `cairn skill: reviewed, evidence-gated skill improvement

Usage:
  cairn skill harvest [--project PATH] [--minimum-occurrences N] [--json]
  cairn skill list [--project PATH] [--kind KIND] [--json]
  cairn skill show --kind KIND --id ID [--project PATH] [--json]
  cairn skill review --candidate ID --approve [--project PATH] [--json]
  cairn skill propose --candidate ID --target RELATIVE_PATH --adapter PATH [--edit-budget N] [--project PATH] [--json]
  cairn skill evaluate --proposal ID --exploration-task-set PATH --confirmation-task-set PATH --adapter PATH
                       [--output ROOT] [--repetitions N] [--seed VALUE] [--minimum-improvement N]
                       [--project PATH] --yes [--json]
  cairn skill apply --proposal ID --evaluation ID --confirm PROPOSAL_DIGEST [--project PATH] [--json]
  cairn skill rollback --application ID --confirm [--project PATH] [--json]

KIND is candidate, proposal, evaluation, or application. Proposal generation
receives evidence only after review. Evaluation is opt-in with CAIRN_EVAL=1,
uses disjoint committed exploration and confirmation task sets, and invokes the
operator-owned adapter. Apply is allowed only for an eligible exact evaluation.
`;
}

const valueFlags = new Set([
    "--project", "--minimum-occurrences", "--kind", "--id", "--candidate", "--target", "--adapter",
    "--edit-budget", "--proposal", "--exploration-task-set", "--confirmation-task-set", "--output",
    "--repetitions", "--seed", "--minimum-improvement", "--evaluation", "--application", "--confirm",
]);
const booleanFlags = new Set(["--json", "--approve", "--yes"]);

function parse(args: string[], allowed: string[]): Map<string, string | true> {
    const permitted = new Set(allowed);
    const result = new Map<string, string | true>();
    for (let index = 0; index < args.length; index += 1) {
        const flag = args[index];
        if (!flag.startsWith("--") || !permitted.has(flag)) throw new Error(`Unknown option: ${flag}`);
        if (result.has(flag)) throw new Error(`Option may be supplied only once: ${flag}`);
        if (flag === "--confirm" && (!args[index + 1] || args[index + 1].startsWith("--"))) {
            result.set(flag, true);
            continue;
        }
        if (booleanFlags.has(flag)) {
            result.set(flag, true);
            continue;
        }
        if (!valueFlags.has(flag)) throw new Error(`Unsupported option: ${flag}`);
        const value = args[index + 1];
        if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
        result.set(flag, value);
        index += 1;
    }
    return result;
}

function stringValue(flags: Map<string, string | true>, name: string, required = false): string | undefined {
    const value = flags.get(name);
    if (required && typeof value !== "string") throw new Error(`${name} is required.`);
    return typeof value === "string" ? value : undefined;
}

function positiveInteger(flags: Map<string, string | true>, name: string, fallback?: number): number | undefined {
    const raw = stringValue(flags, name);
    if (raw === undefined) return fallback;
    if (!/^[1-9][0-9]*$/.test(raw)) throw new Error(`${name} must be a positive integer.`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value)) throw new Error(`${name} is outside the supported range.`);
    return value;
}

function identifier(flags: Map<string, string | true>, name: string): string {
    const value = stringValue(flags, name, true)!;
    if (!ID_PATTERN.test(value)) throw new Error(`${name} must be a canonical artifact ID.`);
    return value;
}

function projectRoot(flags: Map<string, string | true>): string {
    return resolve(stringValue(flags, "--project") ?? process.cwd());
}

function kind(flags: Map<string, string | true>, fallback?: Kind): Kind {
    const value = stringValue(flags, "--kind") ?? fallback;
    if (!value || !KINDS.includes(value as Kind)) throw new Error(`--kind must be one of: ${KINDS.join(", ")}.`);
    return value as Kind;
}

function emit(value: unknown, json: boolean): void {
    process.stdout.write(`${JSON.stringify(value, null, json ? 0 : 2)}\n`);
}

function list(root: string, selected?: Kind): unknown {
    const values = {
        candidates: listSkillCandidates(root),
        proposals: listSkillProposals(root),
        evaluations: listSkillEvaluations(root),
        applications: listSkillApplications(root),
    };
    if (!selected) return values;
    return values[`${selected}s` as keyof typeof values];
}

function show(root: string, selected: Kind, id: string): unknown {
    if (selected === "candidate") return readSkillCandidate(root, id);
    if (selected === "proposal") return readSkillProposal(root, id);
    if (selected === "evaluation") return readSkillEvaluation(root, id);
    return readSkillApplication(root, id);
}

async function main(): Promise<void> {
    const [command = "help", ...args] = process.argv.slice(2);
    if (command === "help" || command === "--help" || command === "-h") {
        process.stdout.write(usage());
        return;
    }
    if (command === "harvest") {
        const flags = parse(args, ["--project", "--minimum-occurrences", "--json"]);
        emit(harvestSkillCandidates({
            projectRoot: projectRoot(flags),
            minimumOccurrences: positiveInteger(flags, "--minimum-occurrences"),
        }), flags.has("--json"));
        return;
    }
    if (command === "list") {
        const flags = parse(args, ["--project", "--kind", "--json"]);
        const selected = stringValue(flags, "--kind") ? kind(flags) : undefined;
        emit(list(projectRoot(flags), selected), flags.has("--json"));
        return;
    }
    if (command === "show") {
        const flags = parse(args, ["--project", "--kind", "--id", "--json"]);
        emit(show(projectRoot(flags), kind(flags), identifier(flags, "--id")), flags.has("--json"));
        return;
    }
    if (command === "review") {
        const flags = parse(args, ["--project", "--candidate", "--approve", "--json"]);
        if (!flags.has("--approve")) throw new Error("Review currently requires --approve.");
        emit(approveSkillCandidate(projectRoot(flags), identifier(flags, "--candidate")), flags.has("--json"));
        return;
    }
    if (command === "propose") {
        const flags = parse(args, ["--project", "--candidate", "--target", "--adapter", "--edit-budget", "--json"]);
        const controller = new AbortController();
        const cancel = (): void => controller.abort();
        process.once("SIGINT", cancel);
        process.once("SIGTERM", cancel);
        try {
            const proposal = await proposeSkill({
                projectRoot: projectRoot(flags),
                candidateId: identifier(flags, "--candidate"),
                targetPath: stringValue(flags, "--target", true)!,
                adapterPath: stringValue(flags, "--adapter", true)!,
                editBudget: positiveInteger(flags, "--edit-budget"),
                signal: controller.signal,
            });
            emit({ ...proposal, proposal_digest: canonicalDigest(proposal) }, flags.has("--json"));
        } finally {
            process.removeListener("SIGINT", cancel);
            process.removeListener("SIGTERM", cancel);
        }
        return;
    }
    if (command === "evaluate") {
        const flags = parse(args, [
            "--project", "--proposal", "--exploration-task-set", "--confirmation-task-set", "--adapter",
            "--output", "--repetitions", "--seed", "--minimum-improvement", "--yes", "--json",
        ]);
        const controller = new AbortController();
        const cancel = (): void => controller.abort();
        process.once("SIGINT", cancel);
        process.once("SIGTERM", cancel);
        try {
            emit(await evaluateSkillProposal({
                projectRoot: projectRoot(flags),
                proposalId: identifier(flags, "--proposal"),
                explorationTaskSetPath: stringValue(flags, "--exploration-task-set", true)!,
                confirmationTaskSetPath: stringValue(flags, "--confirmation-task-set", true)!,
                adapterPath: stringValue(flags, "--adapter", true)!,
                outputRoot: stringValue(flags, "--output"),
                repetitions: positiveInteger(flags, "--repetitions"),
                seed: stringValue(flags, "--seed"),
                minimumImprovement: positiveInteger(flags, "--minimum-improvement"),
                confirm: flags.has("--yes"),
                signal: controller.signal,
            }), flags.has("--json"));
        } finally {
            process.removeListener("SIGINT", cancel);
            process.removeListener("SIGTERM", cancel);
        }
        return;
    }
    if (command === "apply") {
        const flags = parse(args, ["--project", "--proposal", "--evaluation", "--confirm", "--json"]);
        const confirm = flags.get("--confirm");
        if (typeof confirm !== "string" || !DIGEST_PATTERN.test(confirm)) {
            throw new Error("--confirm requires the exact 64-character proposal digest.");
        }
        emit(applySkillProposal({
            projectRoot: projectRoot(flags),
            proposalId: identifier(flags, "--proposal"),
            evaluationId: identifier(flags, "--evaluation"),
            confirmDigest: confirm,
        }), flags.has("--json"));
        return;
    }
    if (command === "rollback") {
        const flags = parse(args, ["--project", "--application", "--confirm", "--json"]);
        emit(rollbackSkillApplication({
            projectRoot: projectRoot(flags),
            applicationId: identifier(flags, "--application"),
            confirm: flags.has("--confirm"),
        }), flags.has("--json"));
        return;
    }
    throw new Error(`Unknown skill command: ${command}`);
}

main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
