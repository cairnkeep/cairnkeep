import { chmodSync, existsSync, lstatSync, rmSync } from "node:fs";
import { rename } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

let cachedWindowsIdentity: { account: string; sid: string } | undefined;

function currentWindowsIdentity(): { account: string; sid: string } {
    if (cachedWindowsIdentity) return cachedWindowsIdentity;
    const result = spawnSync("whoami.exe", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true });
    if (result.status !== 0) throw new Error("Unable to resolve the current Windows security identity.");
    const match = result.stdout.match(/^"([^"]+)","(S-1-[0-9-]+)"/im);
    if (!match) throw new Error("Unable to resolve the current Windows security identity.");
    cachedWindowsIdentity = { account: match[1], sid: match[2] };
    return cachedWindowsIdentity;
}

function currentWindowsSid(): string { return currentWindowsIdentity().sid; }

function currentWindowsAccount(): string { return currentWindowsIdentity().account; }

export function hardenPrivatePath(path: string): void {
    if (process.platform !== "win32") {
        chmodSync(path, lstatSync(path).isDirectory() ? 0o700 : 0o600);
        return;
    }
    const sid = currentWindowsSid();
    const args = [
        path,
        "/inheritance:r",
        "/remove:g", "*S-1-5-18", "*S-1-5-32-544",
        "/grant:r", `*${sid}:(F)`,
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
        const account = currentWindowsAccount().toLowerCase();
        for (let attempt = 0; attempt < 4; attempt += 1) {
            const result = spawnSync("icacls.exe", [path], { encoding: "utf8", windowsHide: true });
            if (result.status === 0 && result.stdout) {
                const grants = result.stdout.split(/\r?\n/).filter((line) => {
                    const body = line.trim();
                    const marker = body.indexOf(":(");
                    if (marker < 0) return false;
                    const permissions = body.slice(marker + 1).toUpperCase();
                    return !permissions.includes("(DENY)") && !permissions.includes("(NW)");
                });
                if (grants.length === 1 && grants[0].toLowerCase().includes(`${account}:(`)) return true;
            }
            if (attempt < 3) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
        }
        return false;
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
