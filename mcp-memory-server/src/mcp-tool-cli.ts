import { MCP_TOOL_CATALOG, MCP_TOOL_NAMES } from "./mcp-tool-catalog.js";
import { resetMcpToolProfile, resolveMcpToolProfile, setMcpToolProfile, type McpToolProfileMode } from "./mcp-tool-profile.js";

function usage(): never {
    process.stderr.write("Usage: cairn mcp-tools list [--json] | status [--project PATH] [--json] | set full|read-only [--project PATH] | set custom --tool NAME... [--project PATH] | reset [--project PATH]\n");
    process.exit(2);
}

function option(args: string[], name: string): string | undefined {
    const index = args.indexOf(name);
    if (index < 0) return undefined;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) usage();
    args.splice(index, 2);
    return value;
}

function flags(args: string[], name: string): string[] {
    const values: string[] = [];
    for (let index = 0; index < args.length;) {
        if (args[index] !== name) { index += 1; continue; }
        args.splice(index, 1);
        let consumed = 0;
        while (index < args.length && !args[index].startsWith("--")) {
            values.push(args[index]);
            args.splice(index, 1);
            consumed += 1;
        }
        if (consumed === 0) usage();
    }
    return values;
}

function output(value: unknown, json: boolean, human: string): void {
    process.stdout.write(`${json ? JSON.stringify(value) : human}\n`);
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const command = args.shift();
    const jsonIndex = args.indexOf("--json");
    const json = jsonIndex >= 0;
    if (json) args.splice(jsonIndex, 1);
    const projectRoot = option(args, "--project") ?? process.cwd();

    if (command === "list") {
        if (args.length) usage();
        const tools = MCP_TOOL_NAMES.map((name) => ({ name, title: MCP_TOOL_CATALOG[name].title, annotations: MCP_TOOL_CATALOG[name].annotations }));
        output({ schema_version: 1, tools }, json, tools.map(({ name, annotations }) => `${name}\t${annotations.readOnlyHint ? "read-only" : "mutation"}`).join("\n"));
        return;
    }
    if (command === "status") {
        if (args.length) usage();
        const status = resolveMcpToolProfile({ projectRoot });
        output(status, json, `Profile: ${status.mode}\nSource: ${status.source}\nDigest: ${status.profile_digest}\nTools: ${status.allowed_tools.join(", ")}`);
        return;
    }
    if (command === "set") {
        const mode = args.shift() as McpToolProfileMode | undefined;
        if (!mode || !["full", "read-only", "custom"].includes(mode)) usage();
        const allowedTools = flags(args, "--tool");
        if (args.length || (mode === "custom" && allowedTools.length === 0) || (mode !== "custom" && allowedTools.length > 0)) usage();
        const status = await setMcpToolProfile({ projectRoot, mode, allowedTools });
        output(status, json, `MCP tool profile set to ${mode} (${status.profile_digest}).`);
        return;
    }
    if (command === "reset") {
        if (args.length) usage();
        await resetMcpToolProfile(projectRoot);
        const status = resolveMcpToolProfile({ projectRoot });
        output(status, json, `Project MCP tool profile reset; effective profile is ${status.mode} from ${status.source}.`);
        return;
    }
    usage();
}

main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
