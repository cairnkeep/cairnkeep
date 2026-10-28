import { chmodSync, existsSync, lstatSync, rmSync } from "node:fs";
import { rename } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";

let cachedWindowsIdentity: { account: string; sid: string } | undefined;
const WINDOWS_COMMAND_TIMEOUT_MS = 10_000;
const WINDOWS_COMMAND_MAX_BUFFER = 1024 * 1024;

export type WindowsAclSnapshot = {
    owner_sid: string;
    protected: boolean;
    access: Array<{ sid: string; type: string; rights: number; inherit_only?: boolean }>;
};

export type WindowsAclOperation = readonly string[];

const WINDOWS_SYSTEM_SIDS = new Set(["S-1-5-18", "S-1-5-32-544"]);
const WINDOWS_REPLACEMENT_RIGHTS = 2 | 4 | 16 | 64 | 256 | 65_536 | 262_144 | 524_288;
const WINDOWS_INSTALLER_SID = 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464';
const WINDOWS_ANCESTOR_MUTATION_RIGHTS = (WINDOWS_REPLACEMENT_RIGHTS & ~4) | 0x10000000 | 0x40000000;

function trustedWindowsSid(sid: string, currentSid: string): boolean {
    return sid.toUpperCase() === currentSid.toUpperCase() || WINDOWS_SYSTEM_SIDS.has(sid.toUpperCase());
}

export function posixOwnerIsTrusted(uid: number, currentUid = process.getuid?.()): boolean {
    return currentUid !== undefined && (uid === currentUid || uid === 0);
}

export function posixPrivateMetadataIsSafe(info: { uid: number; mode: number }): boolean {
    return posixOwnerIsTrusted(info.uid) && (info.mode & 0o077) === 0;
}

export function windowsPrivateAclIsSafe(snapshot: WindowsAclSnapshot, currentSid: string): boolean {
    if (!snapshot.protected || !trustedWindowsSid(snapshot.owner_sid, currentSid)) return false;
    const allows = snapshot.access.filter(({ type }) => type.toLowerCase() === "allow");
    return allows.some(({ sid }) => sid.toUpperCase() === currentSid.toUpperCase())
        && allows.every(({ sid }) => trustedWindowsSid(sid, currentSid));
}

export function windowsReplacementAclIsSafe(snapshot: WindowsAclSnapshot, currentSid: string): boolean {
    if (!trustedWindowsSid(snapshot.owner_sid, currentSid)) return false;
    return snapshot.access.every(({ sid, type, rights }) => type.toLowerCase() !== "allow"
        || trustedWindowsSid(sid, currentSid)
        || (rights & WINDOWS_REPLACEMENT_RIGHTS) === 0);
}

/** Existing directories: AddSubdirectory alone cannot replace an existing name.
 * Inherit-only ACEs are checked on the descendant where they actually apply.
 * Private leaves and other stores retain their stricter, unchanged policies. */
export function windowsMemoryAncestorAclIsSafe(snapshot: WindowsAclSnapshot, currentSid: string, volumeRoot = false): boolean {
    const trusted = (sid: string) => trustedWindowsSid(sid, currentSid)
        || (volumeRoot && sid.toUpperCase() === WINDOWS_INSTALLER_SID);
    if (!trusted(snapshot.owner_sid)) return false;
    const allows = snapshot.access.filter(ace => ace.type.toLowerCase() === 'allow' && !ace.inherit_only);
    return allows.some(ace => trusted(ace.sid)) && allows.every(ace => trusted(ace.sid)
        || (ace.rights & WINDOWS_ANCESTOR_MUTATION_RIGHTS) === 0);
}

export function windowsPrivateAclHardeningPlan(
    snapshot: WindowsAclSnapshot,
    identity: { account: string; sid: string },
    directory: boolean,
): WindowsAclOperation[] {
    const grant = directory ? `*${identity.sid}:(OI)(CI)(F)` : `*${identity.sid}:(F)`;
    const untrustedAllows = [...new Set(snapshot.access
        .filter(({ sid, type }) => type.toLowerCase() === "allow" && !trustedWindowsSid(sid, identity.sid))
        .map(({ sid }) => sid.toUpperCase()))];
    const denies = [...new Set(snapshot.access
        .filter(({ type }) => type.toLowerCase() === "deny")
        .map(({ sid }) => sid.toUpperCase()))];
    return [
        ["/grant:r", grant],
        ["/inheritance:r"],
        ...untrustedAllows.map((sid) => ["/remove:g", `*${sid}`] as const),
        ...denies.map((sid) => ["/remove:d", `*${sid}`] as const),
        ["/setowner", identity.account],
    ];
}

function windowsAclSnapshots(paths: string[]): WindowsAclSnapshot[] {
    if (!paths.length || paths.length > 128 || JSON.stringify(paths).length > 16_384) throw new Error('Windows ACL inspection path bound exceeded.');
    const script = [
        "$ErrorActionPreference='Stop'",
        "$snapshots=@(foreach($path in (ConvertFrom-Json $env:CK_INTERNAL_ACL_PATHS)){",
        "$sections=[System.Security.AccessControl.AccessControlSections]::Owner -bor [System.Security.AccessControl.AccessControlSections]::Access",
        "$acl=if([System.IO.Directory]::Exists($path)){[System.Security.AccessControl.DirectorySecurity]::new($path,$sections)}else{[System.Security.AccessControl.FileSecurity]::new($path,$sections)}",
        "$owner=$acl.Owner",
        "try{$owner=([System.Security.Principal.NTAccount]$owner).Translate([System.Security.Principal.SecurityIdentifier]).Value}catch{}",
        "$access=@($acl.Access|ForEach-Object{$sid=$_.IdentityReference.Value;try{$sid=$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value}catch{};[pscustomobject]@{sid=$sid;type=$_.AccessControlType.ToString();rights=[int64]$_.FileSystemRights;inherit_only=(($_.PropagationFlags -band 2) -ne 0)}})",
        "[pscustomobject]@{owner_sid=$owner;protected=$acl.AreAccessRulesProtected;access=$access}",
        "})",
        "ConvertTo-Json -InputObject @($snapshots) -Compress -Depth 4",
    ].join(";");
    const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
        encoding: "utf8",
        windowsHide: true,
        timeout: WINDOWS_COMMAND_TIMEOUT_MS,
        maxBuffer: WINDOWS_COMMAND_MAX_BUFFER,
        env: { ...process.env, CK_INTERNAL_ACL_PATHS: JSON.stringify(paths) },
    });
    if (result.status !== 0 || !result.stdout.trim()) {
        const detail = result.error?.message || result.stderr.trim();
        throw new Error(`Unable to inspect Windows ACL${detail ? `: ${detail}` : "."}`);
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(result.stdout);
    } catch {
        throw new Error("Unable to parse the Windows ACL inspection result.");
    }
    const snapshots = (Array.isArray(parsed) ? parsed : [parsed]) as Partial<WindowsAclSnapshot>[];
    if (snapshots.length !== paths.length) throw new Error('Windows ACL inspection returned an invalid count.');
    return snapshots.map(parsed => {
    if (!parsed || typeof parsed.owner_sid !== "string" || typeof parsed.protected !== "boolean" || !Array.isArray(parsed.access)) {
        throw new Error("Windows ACL inspection returned an invalid structure.");
    }
    const access = parsed.access.filter((ace): ace is { sid: string; type: string; rights: number } => Boolean(ace)
        && typeof ace.sid === "string" && typeof ace.type === "string" && Number.isSafeInteger(ace.rights)
        && (ace.inherit_only === undefined || typeof ace.inherit_only === 'boolean'));
    if (access.length !== parsed.access.length) throw new Error("Windows ACL inspection returned an invalid access rule.");
    return { owner_sid: parsed.owner_sid, protected: parsed.protected, access };
    });
}
function windowsAclSnapshot(path: string): WindowsAclSnapshot {
    const script = [
        "$ErrorActionPreference='Stop'",
        "$sections=[System.Security.AccessControl.AccessControlSections]::Owner -bor [System.Security.AccessControl.AccessControlSections]::Access",
        "$acl=if([System.IO.Directory]::Exists($env:CK_INTERNAL_ACL_PATH)){[System.Security.AccessControl.DirectorySecurity]::new($env:CK_INTERNAL_ACL_PATH,$sections)}else{[System.Security.AccessControl.FileSecurity]::new($env:CK_INTERNAL_ACL_PATH,$sections)}",
        "$owner=$acl.Owner",
        "try{$owner=([System.Security.Principal.NTAccount]$owner).Translate([System.Security.Principal.SecurityIdentifier]).Value}catch{}",
        "$access=@($acl.Access|ForEach-Object{$sid=$_.IdentityReference.Value;try{$sid=$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value}catch{};[pscustomobject]@{sid=$sid;type=$_.AccessControlType.ToString();rights=[int64]$_.FileSystemRights;inherit_only=(($_.PropagationFlags -band 2) -ne 0)}})",
        "[pscustomobject]@{owner_sid=$owner;protected=$acl.AreAccessRulesProtected;access=$access}|ConvertTo-Json -Compress -Depth 4",
    ].join(";");
    const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
        encoding: "utf8",
        windowsHide: true,
        timeout: WINDOWS_COMMAND_TIMEOUT_MS,
        maxBuffer: WINDOWS_COMMAND_MAX_BUFFER,
        env: { ...process.env, CK_INTERNAL_ACL_PATH: path },
    });
    if (result.status !== 0 || !result.stdout.trim()) {
        const detail = result.error?.message || result.stderr.trim();
        throw new Error(`Unable to inspect Windows ACL${detail ? `: ${detail}` : "."}`);
    }
    let parsed: Partial<WindowsAclSnapshot>;
    try {
        parsed = JSON.parse(result.stdout) as Partial<WindowsAclSnapshot>;
    } catch {
        throw new Error("Unable to parse the Windows ACL inspection result.");
    }
    if (typeof parsed.owner_sid !== "string" || typeof parsed.protected !== "boolean" || !Array.isArray(parsed.access)) {
        throw new Error("Windows ACL inspection returned an invalid structure.");
    }
    const access = parsed.access.filter((ace): ace is { sid: string; type: string; rights: number } => Boolean(ace)
        && typeof ace.sid === "string" && typeof ace.type === "string" && Number.isSafeInteger(ace.rights)
        && (ace.inherit_only === undefined || typeof ace.inherit_only === 'boolean'));
    if (access.length !== parsed.access.length) throw new Error("Windows ACL inspection returned an invalid access rule.");
    return { owner_sid: parsed.owner_sid, protected: parsed.protected, access };
}

function currentWindowsIdentity(): { account: string; sid: string } {
    if (cachedWindowsIdentity) return cachedWindowsIdentity;
    const result = spawnSync("whoami.exe", ["/user", "/fo", "csv", "/nh"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: WINDOWS_COMMAND_TIMEOUT_MS,
        maxBuffer: WINDOWS_COMMAND_MAX_BUFFER,
    });
    if (result.status !== 0) {
        const detail = result.error?.message || result.stderr.trim();
        throw new Error(`Unable to resolve the current Windows security identity${detail ? `: ${detail}` : "."}`);
    }
    const match = result.stdout.match(/^"([^"]+)","(S-1-[0-9-]+)"/im);
    if (!match) throw new Error("Unable to resolve the current Windows security identity.");
    cachedWindowsIdentity = { account: match[1], sid: match[2] };
    return cachedWindowsIdentity;
}

export function hardenPrivatePath(path: string): void {
    if (process.platform !== "win32") {
        chmodSync(path, lstatSync(path).isDirectory() ? 0o700 : 0o600);
        return;
    }
    const identity = currentWindowsIdentity();
    const directory = lstatSync(path).isDirectory();
    let snapshot: WindowsAclSnapshot;
    try {
        snapshot = windowsAclSnapshot(path);
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Unable to inspect Windows ACLs before hardening private Cairnkeep state: ${detail}`);
    }
    for (const operation of windowsPrivateAclHardeningPlan(snapshot, identity, directory)) {
        const args = [path, ...operation];
        const result = spawnSync("icacls.exe", args, {
            encoding: "utf8",
            windowsHide: true,
            timeout: WINDOWS_COMMAND_TIMEOUT_MS,
            maxBuffer: WINDOWS_COMMAND_MAX_BUFFER,
        });
        if (result.status !== 0) {
            const detail = result.error?.message || result.stderr.trim() || result.stdout.trim();
            throw new Error(`Unable to restrict Windows ACLs for private Cairnkeep state${detail ? `: ${detail}` : "."}`);
        }
    }
    if (!privatePathIsSafe(path)) throw new Error("Unable to verify private Windows ACLs after hardening.");
}

export function privatePathIsSafe(path: string): boolean {
    if (!existsSync(path)) return false;
    const info = lstatSync(path);
    if (info.isSymbolicLink()) return false;
    if (process.platform !== "win32") return posixPrivateMetadataIsSafe(info);
    try {
        const identity = currentWindowsIdentity();
        const snapshot = windowsAclSnapshot(path);
        return Boolean(snapshot && windowsPrivateAclIsSafe(snapshot, identity.sid));
    } catch {
        return false;
    }
}

export function replacementBoundaryIsSafe(path: string): boolean {
    if (!existsSync(path)) return false;
    const info = lstatSync(path);
    if (!info.isDirectory() || info.isSymbolicLink()) return false;
    if (process.platform !== "win32") return posixOwnerIsTrusted(info.uid) && (info.mode & 0o022) === 0;
    try {
        const identity = currentWindowsIdentity();
        const snapshot = windowsAclSnapshot(path);
        return Boolean(snapshot && windowsReplacementAclIsSafe(snapshot, identity.sid));
    } catch {
        return false;
    }
}

export function parentReplacementBoundaryIsSafe(path: string): boolean {
    const parentPath = dirname(path);
    if (!existsSync(parentPath)) return false;
    const info = lstatSync(parentPath);
    if (!info.isDirectory() || info.isSymbolicLink()) return false;
    if (process.platform === "win32") return replacementBoundaryIsSafe(parentPath);
    const writableByOthers = (info.mode & 0o022) !== 0;
    const sticky = (info.mode & 0o1000) !== 0;
    return posixOwnerIsTrusted(info.uid) && (!writableByOthers || sticky);
}

/** A private leaf is insufficient when another user can replace an ancestor.
 * Sticky POSIX temporary roots retain their existing owner-only rename rule. */
export function memoryPathAncestorsAreSafe(path: string): boolean {
    if (process.platform === 'win32') {
        try {
            const parents: string[] = [];
            let current = resolve(path);
            for (;;) {
                const parent = dirname(current), info = lstatSync(parent);
                if (!info.isDirectory() || info.isSymbolicLink() || parents.length >= 128) return false;
                if (parents.at(-1) !== parent) parents.push(parent);
                if (parent === current) break;
                current = parent;
            }
            const sid = currentWindowsIdentity().sid;
            return windowsAclSnapshots(parents).every((snapshot, index) =>
                windowsMemoryAncestorAclIsSafe(snapshot, sid, dirname(parents[index]) === parents[index]));
        } catch { return false; }
    }
    let current = resolve(path);
    for (;;) {
        if (!parentReplacementBoundaryIsSafe(current)) return false;
        const parent = dirname(current);
        if (parent === current) return true;
        current = parent;
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
                    timeout: WINDOWS_COMMAND_TIMEOUT_MS,
                    maxBuffer: WINDOWS_COMMAND_MAX_BUFFER,
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
                if (result.error) throw new Error(`Windows atomic replacement failed: ${result.error.message}`);
                lastError = result.stderr?.trim() || result.stdout?.trim() || lastError;
            }
            await delay(25 * (attempt + 1));
        }
        throw new Error(lastError);
    }
    await rename(source, destination);
}
