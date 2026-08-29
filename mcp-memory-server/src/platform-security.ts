import { chmodSync, existsSync, lstatSync, readFileSync, rmSync } from "node:fs";
import { rename } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

function currentWindowsSid(): string {
    const result = spawnSync("whoami.exe", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true });
    if (result.status !== 0) throw new Error("Unable to resolve the current Windows security identity.");
    const match = result.stdout.match(/"(S-1-[0-9-]+)"/i);
    if (!match) throw new Error("Unable to resolve the current Windows security identity.");
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
        "/grant:r", `*${sid}:(F)`,
        "/grant:r", "*S-1-5-18:(F)",
        "/grant:r", "*S-1-5-32-544:(F)",
    ];
    const result = spawnSync("icacls.exe", args, { encoding: "utf8", windowsHide: true });
    if (result.status !== 0) throw new Error("Unable to restrict Windows ACLs for private Cairnkeep state.");
}

export function privatePathIsSafe(path: string): boolean {
    if (!existsSync(path)) return false;
    const info = lstatSync(path);
    if (info.isSymbolicLink()) return false;
    if (process.platform !== "win32") return (info.mode & 0o077) === 0;
    const dumpPath = join(tmpdir(), `cairn-private-acl-${randomUUID()}.txt`);
    try {
        const result = spawnSync("icacls.exe", [path, "/save", dumpPath], { encoding: "utf8", windowsHide: true });
        if (result.status !== 0 || !existsSync(dumpPath)) return false;
        const bytes = readFileSync(dumpPath);
        const text = bytes[0] === 0xff && bytes[1] === 0xfe
            ? bytes.subarray(2).toString("utf16le")
            : bytes.toString("utf8");
        const allowed = new Set([currentWindowsSid(), "SY", "BA", "S-1-5-18", "S-1-5-32-544"]);
        const aces = [...text.matchAll(/\(([^)]+)\)/g)].map((match) => match[1].split(";"));
        const allowAces = aces.filter((fields) => fields.length >= 6 && fields[0].startsWith("A"));
        return allowAces.length > 0 && allowAces.every((fields) => allowed.has(fields[5]));
    } catch {
        return false;
    } finally {
        rmSync(dumpPath, { force: true });
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
