import { chmodSync, existsSync, lstatSync, rmSync } from "node:fs";
import { rename } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

let cachedWindowsIdentity: { account: string; sid: string; logonAccount?: string } | undefined;

function currentWindowsIdentity(): { account: string; sid: string; logonAccount?: string } {
    if (cachedWindowsIdentity) return cachedWindowsIdentity;
    const result = spawnSync("whoami.exe", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true });
    if (result.status !== 0) throw new Error("Unable to resolve the current Windows security identity.");
    const match = result.stdout.match(/^"([^"]+)","(S-1-[0-9-]+)"/im);
    if (!match) throw new Error("Unable to resolve the current Windows security identity.");
    const groups = spawnSync("whoami.exe", ["/groups", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true });
    const logonRow = groups.status === 0
        ? groups.stdout.split(/\r?\n/).find((line) => /"S-1-5-5-[0-9-]+"/i.test(line))
        : undefined;
    const logonAccount = logonRow?.match(/^"([^"]+)"/)?.[1];
    cachedWindowsIdentity = { account: match[1], sid: match[2], ...(logonAccount ? { logonAccount } : {}) };
    return cachedWindowsIdentity;
}

export function hardenPrivatePath(path: string): void {
    if (process.platform !== "win32") {
        chmodSync(path, lstatSync(path).isDirectory() ? 0o700 : 0o600);
        return;
    }
    const identity = currentWindowsIdentity();
    const args = [
        path,
        "/inheritance:r",
        "/remove:g", "*S-1-5-18", "*S-1-5-32-544",
        "/grant:r", `*${identity.sid}:(F)`,
    ];
    const result = spawnSync("icacls.exe", args, { encoding: "utf8", windowsHide: true });
    if (result.status !== 0) throw new Error("Unable to restrict Windows ACLs for private Cairnkeep state.");
}

export function privatePathIsSafe(path: string): boolean {
    if (!existsSync(path)) return false;
    const info = lstatSync(path);
    if (info.isSymbolicLink()) return false;
    if (process.platform !== "win32") return (info.mode & 0o077) === 0;
    try {
        const identity = currentWindowsIdentity();
        const allowedAccounts = [identity.account, identity.logonAccount].filter((value): value is string => Boolean(value)).map((value) => value.toLowerCase());
        const result = spawnSync("icacls.exe", [path], { encoding: "utf8", windowsHide: true });
        if (result.status !== 0 || !result.stdout) return false;
        const grants = result.stdout.split(/\r?\n/).filter((line) => {
            const body = line.trim();
            const marker = body.indexOf(":(");
            if (marker < 0) return false;
            const permissions = body.slice(marker + 1).toUpperCase();
            return !permissions.includes("(DENY)") && !permissions.includes("(NW)");
        });
        return grants.length > 0 && grants.every((grant) => {
            const normalized = grant.toLowerCase();
            return allowedAccounts.some((account) => normalized.includes(`${account}:(`));
        });
    } catch {
        return false;
    }
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

export async function atomicReplace(source: string, destination: string): Promise<void> {
    if (process.platform === "win32") {
        let lastError = "Windows atomic replacement failed.";
        for (let attempt = 0; attempt < 12; attempt += 1) {
            if (!existsSync(destination)) {
                try {
                    await rename(source, destination);
                    return;
                } catch (error) {
                    lastError = error instanceof Error ? error.message : String(error);
                }
            } else {
                const backup = `${destination}.replace-backup-${randomUUID()}`;
                const result = spawnSync("powershell.exe", [
                    "-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
                    "[IO.File]::Replace($env:CK_INTERNAL_ATOMIC_SOURCE,$env:CK_INTERNAL_ATOMIC_DESTINATION,$env:CK_INTERNAL_ATOMIC_BACKUP,$true)",
                ], {
                    encoding: "utf8",
                    windowsHide: true,
                    env: {
                        ...process.env,
                        CK_INTERNAL_ATOMIC_SOURCE: source,
                        CK_INTERNAL_ATOMIC_DESTINATION: destination,
                        CK_INTERNAL_ATOMIC_BACKUP: backup,
                    },
                });
                if (result.status === 0) {
                    rmSync(backup, { force: true });
                    return;
                }
                rmSync(backup, { force: true });
                lastError = result.stderr.trim() || result.stdout.trim() || lastError;
            }
            await delay(25 * (attempt + 1));
        }
        throw new Error(lastError);
    }
    await rename(source, destination);
}
