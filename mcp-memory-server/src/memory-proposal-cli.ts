#!/usr/bin/env node
import {
    applyMemoryProposal,
    createMemoryProposal,
    doctorMemoryProposals,
    listMemoryProposals,
    showMemoryProposal,
} from "./memory-proposal-store.js";
import type { ExtractionCategory } from "./memory-extraction.js";

const categories = new Set<ExtractionCategory>(["decision", "preference", "pattern", "pitfall", "constraint", "bug", "convention"]);

function usage(): string {
    return `cairn proposals — review-gated session memory proposals

Usage:
  cairn proposals create --session ID --scope SCOPE [--model MODEL] [--category CATEGORY] [--project PATH] [--json]
  cairn proposals list [--project PATH] [--json]
  cairn proposals show DIGEST [--project PATH] [--json]
  cairn proposals apply DIGEST [--project PATH] [--json]
  cairn proposals doctor [--project PATH] [--json]

Creation is explicit and reads an already stored local trajectory. Applying requires
the proposal's complete 64-character digest and fails atomically if its source or
any target memory changed after proposal creation.
`;
}

function valueAfter(args: string[], flag: string): string | undefined {
    const index = args.indexOf(flag);
    if (index < 0) return undefined;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
    return value;
}

function positionals(args: string[]): string[] {
    const valued = new Set(["--project", "--session", "--scope", "--model", "--category"]);
    const output: string[] = [];
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (valued.has(arg)) { index += 1; continue; }
        if (arg === "--json") continue;
        if (arg.startsWith("--")) throw new Error(`unknown option "${arg}".`);
        output.push(arg);
    }
    return output;
}

function print(value: unknown, json: boolean): void {
    if (json) process.stdout.write(`${JSON.stringify(value)}\n`);
    else process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(): Promise<void> {
    const [command = "help", ...args] = process.argv.slice(2);
    const projectRoot = valueAfter(args, "--project") ?? process.cwd();
    const json = args.includes("--json");
    try {
        if (["help", "--help", "-h"].includes(command)) { process.stdout.write(usage()); return; }
        if (command === "create") {
            const sessionId = valueAfter(args, "--session");
            const scope = valueAfter(args, "--scope");
            if (!sessionId || !scope) throw new Error("create requires --session ID and --scope SCOPE.");
            const rawCategory = valueAfter(args, "--category");
            if (rawCategory && !categories.has(rawCategory as ExtractionCategory)) throw new Error(`unsupported category "${rawCategory}".`);
            if (positionals(args).length !== 0) throw new Error("create accepts no positional arguments.");
            print(await createMemoryProposal({ projectRoot, sessionId, scope, model: valueAfter(args, "--model"), category: rawCategory as ExtractionCategory | undefined }), json);
            return;
        }
        if (command === "list") {
            if (positionals(args).length !== 0) throw new Error("list accepts no positional arguments.");
            const proposals = listMemoryProposals(projectRoot);
            print({ count: proposals.length, proposals: proposals.map(({ digest, created_at, scope, source, extraction, candidates }) => ({ digest, created_at, scope, source, extraction, candidate_count: candidates.length })) }, json);
            return;
        }
        if (command === "show") {
            const values = positionals(args);
            if (values.length !== 1) throw new Error("show requires one full proposal digest.");
            print(showMemoryProposal(values[0], projectRoot), json);
            return;
        }
        if (command === "apply") {
            const values = positionals(args);
            if (values.length !== 1) throw new Error("apply requires one full proposal digest.");
            print(await applyMemoryProposal(values[0], projectRoot), json);
            return;
        }
        if (command === "doctor") {
            if (positionals(args).length !== 0) throw new Error("doctor accepts no positional arguments.");
            const result = doctorMemoryProposals(projectRoot);
            print(result, json);
            if (!result.ok) process.exitCode = 2;
            return;
        }
        throw new Error(`unknown proposals command "${command}".`);
    } catch (error) {
        process.stderr.write(`cairn proposals: ${error instanceof Error ? error.message : "unknown error"}\n`);
        process.exitCode = 2;
    }
}

await main();
