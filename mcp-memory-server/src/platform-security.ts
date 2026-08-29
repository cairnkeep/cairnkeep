import { chmodSync, existsSync, lstatSync, rmSync } from "node:fs";
import { rename } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

function currentWindowsSid(): string {
    const result = spawnSync("whoami.exe", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true });
    if (result.status !== 0) throw new Error("Unable to resolve the current Windows security identity.");
    const match = result.stdout.match(/"(S-1-[0-9-]+)"/i);
    if (!match) throw new Error("Unable to resolve the current Windows security identity.");
    return match[1];
}

function currentWindowsAccount(): string {
    const result = spawnSync("whoami.exe", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true });
    const match = result.stdout.match(/^"([^"]+)","S-1-[0-9-]+"/im);
    if (result.status !== 0 || !match) throw new Error("Could not resolve the current Windows account.");
    return match[1];
}

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
        const result = spawnSync("icacls.exe", [path], { encoding: "utf8", windowsHide: true });
        if (result.status !== 0 || !result.stdout) return false;
        const principals = result.stdout.split(/\r?\n/).flatMap((line) => {
            const body = line.startsWith(path) ? line.slice(path.length).trim() : line.trim();
            const marker = body.indexOf(":(");
            if (marker < 0) return [];
            const permissions = body.slice(marker + 1).toUpperCase();
            if (permissions.includes("(DENY)") || permissions.includes("(NW)")) return [];
            return [body.slice(0, marker).trim().toLowerCase()];
        });
        return principals.length > 0
            && principals.every((principal) => principal === account || principal.endsWith(` ${account}`));
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
