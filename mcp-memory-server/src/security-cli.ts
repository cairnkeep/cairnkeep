import { securityDoctor } from "./security-doctor.js";
import { projectEnvironment } from "./project-environment.js";

function usage(exitCode = 2): never {
    process.stderr.write("Usage: cairn security doctor [--project PATH] [--json]\n");
    process.exit(exitCode);
}

function option(args: string[], name: string): string | undefined {
    const index = args.indexOf(name);
    if (index < 0) return undefined;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) usage();
    args.splice(index, 2);
    return value;
}

const args = process.argv.slice(2);
const command = args.shift();
if (["help", "--help", "-h"].includes(command ?? "")) usage(0);
if (command !== "doctor") usage();
const jsonIndex = args.indexOf("--json");
const json = jsonIndex >= 0;
if (json) args.splice(jsonIndex, 1);
const projectRoot = option(args, "--project") ?? process.cwd();
if (args.length) usage();

const loaded = projectEnvironment(projectRoot, process.env);
const report = securityDoctor({ projectRoot, env: loaded.env, environmentIssue: loaded.issue });
if (json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
} else {
    process.stdout.write("cairn security doctor\n");
    for (const check of report.checks) {
        process.stdout.write(`  [${check.state}] ${check.summary}\n`);
        if (check.remediation && check.state !== "PASS" && check.state !== "SKIP") {
            process.stdout.write(`         ${check.remediation}\n`);
        }
    }
    process.stdout.write(`Summary: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail, ${report.summary.skip} skip\n`);
}
if (!report.ok) process.exitCode = 1;
