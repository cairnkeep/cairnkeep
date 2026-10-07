import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, type Stats } from "node:fs";
import { dirname } from "node:path";

import { posixPrivateMetadataIsSafe, privatePathIsSafe } from "./platform-security.js";

type ReadOptions = { label: string; maxBytes: number; private?: boolean };

function sameFile(left: Stats, right: Stats): boolean {
    return right.isFile() && !right.isSymbolicLink()
        && left.dev === right.dev && left.ino === right.ino && left.size === right.size
        && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs
        && left.uid === right.uid && left.gid === right.gid && left.mode === right.mode;
}

/** Bind bounded runtime reads to the inspected file, not a later pathname. */
export function readStableFile(path: string, options: ReadOptions): { bytes: Buffer; stat: Stats } {
    const { label, maxBytes } = options;
    let descriptor: number | undefined;
    try {
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error();
        // Opening never relies on a prior pathname check. Nonblocking/no-ctty
        // flags make special-file admission bounded before descriptor inspection.
        descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
            | (constants.O_NOCTTY ?? 0) | (process.platform === "win32" ? 0 : constants.O_NONBLOCK ?? 0));
        const opened = fstatSync(descriptor);
        if (!opened.isFile() || opened.size > maxBytes) throw new Error();
        const parent = lstatSync(dirname(path));
        const named = lstatSync(path);
        if (named.isSymbolicLink() || parent.isSymbolicLink()) throw new Error(`${label} crosses a symlink.`);
        if (!parent.isDirectory() || !sameFile(opened, named)) throw new Error();
        if (options.private) {
            if (process.platform === "win32" ? !privatePathIsSafe(path) : !posixPrivateMetadataIsSafe(opened)) throw new Error();
            if (!sameFile(opened, lstatSync(path))) throw new Error();
        }
        // One extra byte detects growth without following it or growing allocation.
        const buffer = Buffer.allocUnsafe(opened.size + 1);
        let offset = 0;
        while (offset < buffer.length) {
            const count = readSync(descriptor, buffer, offset, buffer.length - offset, null);
            if (count === 0) break;
            offset += count;
        }
        const after = fstatSync(descriptor);
        const parentAfter = lstatSync(dirname(path));
        if (!sameFile(opened, after) || offset !== opened.size
            || !parentAfter.isDirectory() || parentAfter.isSymbolicLink()
            || parent.dev !== parentAfter.dev || parent.ino !== parentAfter.ino
            || (options.private && process.platform === "win32" && !privatePathIsSafe(path))
            || !sameFile(opened, lstatSync(path))) throw new Error();
        return { bytes: buffer.subarray(0, offset), stat: opened };
    } catch (error) {
        // Do not quote paths, private payloads or operating-system diagnostics.
        if (error instanceof Error && error.message === `${label} crosses a symlink.`) throw error;
        if ((error as NodeJS.ErrnoException).code === "ELOOP") throw new Error(`${label} crosses a symlink.`);
        throw new Error(`${label} is unsafe, changed or unreadable.`);
    } finally {
        if (descriptor !== undefined) closeSync(descriptor);
    }
}

export function readStableText(path: string, options: ReadOptions): { text: string; stat: Stats } {
    const { bytes, stat } = readStableFile(path, options);
    try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), stat }; }
    catch { throw new Error(`${options.label} contains invalid UTF-8.`); }
}

export function readStableJson(path: string, options: ReadOptions): unknown {
    const { text } = readStableText(path, options);
    try { return JSON.parse(text) as unknown; }
    catch { throw new Error(`${options.label} contains invalid JSON.`); }
}
