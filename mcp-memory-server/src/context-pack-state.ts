import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, type Stats } from "node:fs";
import { dirname } from "node:path";

import { posixPrivateMetadataIsSafe, privatePathIsSafe } from "./platform-security.js";

function sameFile(left: Stats, right: Stats): boolean {
    return right.isFile() && !right.isSymbolicLink()
        && left.dev === right.dev && left.ino === right.ino && left.size === right.size
        && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs
        && left.uid === right.uid && left.mode === right.mode;
}

// Mutable private pack state must be inspected and read through one opened
// descriptor. Pathname checks alone cannot authorize a later pathname read.
export function readPrivatePackJson(
    path: string,
    options: { label: string; maxBytes: number; optional?: boolean },
): unknown | undefined {
    const { label, maxBytes } = options;
    let descriptor: number | undefined;
    try {
        const nonBlocking = process.platform === "win32" ? 0 : (constants.O_NONBLOCK ?? 0);
        descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | nonBlocking);
        const opened = fstatSync(descriptor);
        if (!opened.isFile() || opened.size > maxBytes
            || (process.platform !== "win32" && !posixPrivateMetadataIsSafe(opened))) {
            throw new Error(`${label} is unsafe or too large.`);
        }
        const parent = lstatSync(dirname(path));
        if (!parent.isDirectory() || parent.isSymbolicLink() || !sameFile(opened, lstatSync(path))) {
            throw new Error(`${label} is unsafe or changed.`);
        }
        if (process.platform === "win32") {
            if (!privatePathIsSafe(path)) throw new Error(`${label} is unsafe.`);
            if (!sameFile(opened, lstatSync(path))) throw new Error(`${label} changed during ACL inspection.`);
        }
        const buffer = Buffer.allocUnsafe(opened.size + 1);
        let offset = 0;
        while (offset < buffer.byteLength) {
            const count = readSync(descriptor, buffer, offset, buffer.byteLength - offset, null);
            if (count === 0) break;
            offset += count;
        }
        const after = fstatSync(descriptor);
        const named = lstatSync(path);
        const parentAfter = lstatSync(dirname(path));
        if (!sameFile(opened, after) || !sameFile(opened, named) || offset !== after.size
            || parentAfter.isSymbolicLink() || !parentAfter.isDirectory()
            || parent.dev !== parentAfter.dev || parent.ino !== parentAfter.ino) {
            throw new Error(`${label} changed while it was being read.`);
        }
        let text: string;
        try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, offset)); }
        catch { throw new Error(`${label} contains invalid UTF-8.`); }
        try { return JSON.parse(text) as unknown; }
        catch { throw new Error(`${label} contains invalid JSON.`); }
    } catch (error) {
        if (descriptor === undefined && options.optional && (error as NodeJS.ErrnoException).code === "ENOENT") {
            // A dangling link is unsafe state, not an absent project/source.
            try { lstatSync(path); throw new Error(`${label} is unsafe or changed.`); }
            catch (missingError) {
                if ((missingError as NodeJS.ErrnoException).code !== "ENOENT") throw missingError;
            }
            try {
                const parent = lstatSync(dirname(path));
                if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error(`${label} directory is unsafe.`);
            } catch (parentError) {
                if ((parentError as NodeJS.ErrnoException).code !== "ENOENT") throw parentError;
            }
            return undefined;
        }
        if (error instanceof Error && error.message.startsWith(`${label} `)) throw error;
        throw new Error(`${label} is unsafe or unreadable.`);
    } finally {
        if (descriptor !== undefined) closeSync(descriptor);
    }
}
