import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";

const TRAJECTORY_ENTRY = "@@INFRA_ROOT@@/mcp-memory-server/dist/trajectory-cli.js";
const CAPTURE_TIMEOUT_MS = 3000;

function captureEnabled(): boolean {
    return /^(?:1|true|yes|on)$/i.test(process.env.CAIRN_TRAJECTORY_CAPTURE?.trim() ?? "");
}

function submitTrajectory(projectRoot: string, payload: string): Promise<void> {
    return new Promise((resolvePromise) => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolvePromise();
        };
        const child = spawn(process.execPath, [TRAJECTORY_ENTRY, "capture-pi", projectRoot], {
            stdio: ["pipe", "ignore", "ignore"],
        });
        const timer = setTimeout(() => {
            try {
                child.kill("SIGKILL");
            } catch {
                // Best-effort timeout; capture always fails open.
            }
            finish();
        }, CAPTURE_TIMEOUT_MS);

        child.on("close", finish);
        child.on("error", finish);
        child.stdin.on("error", () => {
            // EPIPE is expected when validation or timeout closes the child.
        });
        child.stdin.end(payload);
    });
}

export default function cairnTrajectoryExtension(pi: ExtensionAPI): void {
    pi.on("session_shutdown", async (_event, ctx: ExtensionContext) => {
        if (!captureEnabled()) return;
        try {
            const id = ctx.sessionManager.getSessionId();
            const entries = ctx.sessionManager.getBranch();
            if (!id) return;
            await submitTrajectory(ctx.cwd, JSON.stringify({
                session: { id, version: 3, cwd: ctx.cwd, entries },
            }));
        } catch {
            // Local trajectory capture must never block or fail a Pi shutdown.
        }
    });
}
