import { lstatSync, type Stats } from "node:fs";
import { mkdir, rm } from "node:fs/promises";

type PointerLockOperations = {
    platform: NodeJS.Platform;
    create: (path: string) => Promise<unknown>;
    inspect: (path: string) => Pick<Stats, "isDirectory" | "isSymbolicLink">;
    remove: (path: string) => Promise<void>;
    wait: (milliseconds: number) => Promise<void>;
};

const filesystem: PointerLockOperations = {
    platform: process.platform,
    create: (path) => mkdir(path, { mode: 0o700 }),
    inspect: (path) => lstatSync(path),
    remove: (path) => rm(path, { recursive: true, force: true }),
    wait: (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds)),
};

// The internal filesystem seam lets offline controls reproduce platform errors
// without replacing process.platform or weakening the real filesystem checks.
export async function acquireContextPackPointerLock(
    lock: string,
    operations: PointerLockOperations = filesystem,
): Promise<() => Promise<void>> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
        try {
            await operations.create(lock);
            return () => operations.remove(lock);
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            const windowsContention = operations.platform === "win32" && code === "EPERM";
            if (code !== "EEXIST" && !windowsContention) throw error;
            let info;
            try {
                info = operations.inspect(lock);
            } catch (inspectionError) {
                const inspectionCode = (inspectionError as NodeJS.ErrnoException).code;
                if (inspectionCode === "ENOENT") {
                    // A Windows delete-pending directory can temporarily appear
                    // absent; pace this case under the same bounded retry budget.
                    if (windowsContention) await operations.wait(10);
                    continue;
                }
                if (operations.platform === "win32" && ["EPERM", "EBUSY"].includes(inspectionCode ?? "")) {
                    await operations.wait(10);
                    continue;
                }
                throw inspectionError;
            }
            if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Context pack project pointer lock is unsafe.");
            await operations.wait(10);
        }
    }
    throw new Error("Context pack project pointer is locked; retry after the active update finishes.");
}
