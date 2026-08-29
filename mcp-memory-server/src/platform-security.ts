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
    const script = [
        "$p=$env:CK_INTERNAL_PRIVATE_PATH",
        "$me=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
        "$ok=@($me,'SY','BA','S-1-5-18','S-1-5-32-544')",
        "$acl=Get-Acl -LiteralPath $p",
        "$sddl=$acl.GetSecurityDescriptorSddlForm([System.Security.AccessControl.AccessControlSections]::Access)",
        "$seen=0;$start=$sddl.IndexOf('(');while($start -ge 0){$end=$sddl.IndexOf(')',$start);if($end -lt 0){exit 1};$fields=$sddl.Substring($start+1,$end-$start-1).Split(';');if($fields.Count -lt 6){exit 1};if($fields[0].StartsWith('A')){$seen++;if($ok -notcontains $fields[5]){exit 1}};$start=$sddl.IndexOf('(',$end+1)}",
        "if($seen -eq 0){exit 1}",
        "exit 0",
    ].join(";");
    const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
        encoding: "utf8",
        windowsHide: true,
        env: { ...process.env, CK_INTERNAL_PRIVATE_PATH: path },
    });
    return result.status === 0;
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
