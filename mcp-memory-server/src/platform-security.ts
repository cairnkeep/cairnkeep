import { chmodSync, existsSync, lstatSync } from "node:fs";
import { rename } from "node:fs/promises";
import { spawnSync } from "node:child_process";

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
        "$p=$args[0]",
        "$me=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
        "$ok=@($me,'S-1-5-18','S-1-5-32-544')",
        "$acl=Get-Acl -LiteralPath $p",
        "foreach($a in $acl.Access){",
        "if($a.AccessControlType -eq 'Allow'){",
        "try{$sid=$a.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value}catch{exit 1}",
        "if($ok -notcontains $sid){exit 1}",
        "}",
        "}",
        "exit 0",
    ].join(";");
    const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script, path], {
        encoding: "utf8",
        windowsHide: true,
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
                const result = spawnSync("powershell.exe", [
                    "-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
                    "[IO.File]::Replace($args[0],$args[1],$null,$true)",
                    source,
                    destination,
                ], { encoding: "utf8", windowsHide: true });
                if (result.status === 0) return;
                lastError = result.stderr.trim() || result.stdout.trim() || lastError;
            }
            await delay(25 * (attempt + 1));
        }
        throw new Error(lastError);
    }
    await rename(source, destination);
}
