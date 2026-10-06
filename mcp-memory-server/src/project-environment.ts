import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";

import { parentReplacementBoundaryIsSafe, posixPrivateMetadataIsSafe, privatePathIsSafe, replacementBoundaryIsSafe } from "./platform-security.js";

const ASSIGNMENT = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;
const MAX_PROJECT_ENV_BYTES = 64 * 1024;

function readBoundedDescriptor(descriptor: number, approvedSize: number): Buffer {
    const buffer = Buffer.allocUnsafe(approvedSize + 1);
    let offset = 0;
    while (offset < buffer.byteLength) {
        const bytesRead = readSync(descriptor, buffer, offset, buffer.byteLength - offset, null);
        if (bytesRead === 0) break;
        offset += bytesRead;
    }
    return buffer.subarray(0, offset);
}

function literalValue(raw: string, line: number): string {
    if (/[\x00-\x1f\x7f]/.test(raw)) throw new Error(`.ai/.env line ${line} contains a control character`);
    if (/^\s/.test(raw)) throw new Error(`.ai/.env line ${line} has whitespace after the assignment operator`);
    const value = raw.trim();
    if (!value) return "";
    if (/^'[^']*'$/.test(value)) return value.slice(1, -1);
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
        const inner = value.slice(1, -1);
        if (!/^(?:[^"\\$`]|\\[\\"])*$/.test(inner)) {
            throw new Error(`.ai/.env line ${line} is not a literal double-quoted value`);
        }
        return inner.replace(/\\([\\"])/g, "$1");
    }
    const withoutComment = value.replace(/\s+#.*$/, "").trim();
    if (!/^[A-Za-z0-9_./:@%+,=-]*$/.test(withoutComment)) throw new Error(`.ai/.env line ${line} is not a literal assignment`);
    return withoutComment;
}

export function projectEnvironment(projectRoot: string, ambient: NodeJS.ProcessEnv): { env: NodeJS.ProcessEnv; issue?: string } {
    const requestedRoot = resolve(projectRoot);
    let approvedRootInfo: ReturnType<typeof lstatSync>;
    try {
        approvedRootInfo = lstatSync(requestedRoot);
        if (!approvedRootInfo.isDirectory() || approvedRootInfo.isSymbolicLink()
            || !replacementBoundaryIsSafe(requestedRoot) || !parentReplacementBoundaryIsSafe(requestedRoot)) {
            return { env: { ...ambient }, issue: "project root and its parent must be owner-controlled real directories" };
        }
    } catch {
        return { env: { ...ambient }, issue: "project root metadata could not be inspected" };
    }
    let canonicalRoot: string;
    try {
        canonicalRoot = realpathSync(requestedRoot);
        const requestedAfter = lstatSync(requestedRoot);
        const canonicalInfo = lstatSync(canonicalRoot);
        if (requestedAfter.dev !== approvedRootInfo.dev || requestedAfter.ino !== approvedRootInfo.ino
            || canonicalInfo.dev !== approvedRootInfo.dev || canonicalInfo.ino !== approvedRootInfo.ino
            || requestedAfter.isSymbolicLink() || !parentReplacementBoundaryIsSafe(canonicalRoot)) {
            return { env: { ...ambient }, issue: "project root changed while it was being inspected" };
        }
    } catch {
        return { env: { ...ambient }, issue: "project root could not be canonicalized safely" };
    }
    const directory = join(canonicalRoot, ".ai");
    const path = join(directory, ".env");
    try {
        const directoryInfo = lstatSync(directory);
        if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || !replacementBoundaryIsSafe(directory)) return { env: { ...ambient }, issue: ".ai must be an owner-controlled real directory" };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return { env: { ...ambient } };
        return { env: { ...ambient }, issue: ".ai/.env metadata could not be inspected" };
    }
    let text: string;
    let descriptor: number | undefined;
    try {
        const nonBlocking = process.platform === "win32" ? 0 : (constants.O_NONBLOCK ?? 0);
        descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | nonBlocking);
        const opened = fstatSync(descriptor);
        if (!opened.isFile() || opened.size > MAX_PROJECT_ENV_BYTES) return { env: { ...ambient }, issue: ".ai/.env must be a private regular file no larger than 64 KiB" };
        const bytes = readBoundedDescriptor(descriptor, opened.size);
        const afterRead = fstatSync(descriptor);
        const named = lstatSync(path);
        const descriptorPrivate = process.platform === "win32" || posixPrivateMetadataIsSafe(opened);
        if (!descriptorPrivate || named.isSymbolicLink() || !named.isFile()
            || opened.dev !== afterRead.dev || opened.ino !== afterRead.ino || opened.size !== afterRead.size
            || opened.mtimeMs !== afterRead.mtimeMs || opened.ctimeMs !== afterRead.ctimeMs
            || named.dev !== opened.dev || named.ino !== opened.ino
            || bytes.byteLength !== afterRead.size || bytes.byteLength > MAX_PROJECT_ENV_BYTES) {
            return { env: { ...ambient }, issue: ".ai/.env changed while it was being inspected" };
        }
        if (process.platform === "win32") {
            if (!privatePathIsSafe(path)) return { env: { ...ambient }, issue: ".ai/.env must be a private regular file no larger than 64 KiB" };
            const namedAfterAcl = lstatSync(path);
            if (namedAfterAcl.dev !== opened.dev || namedAfterAcl.ino !== opened.ino || namedAfterAcl.isSymbolicLink()) {
                return { env: { ...ambient }, issue: ".ai/.env changed while it was being inspected" };
            }
        }
        text = bytes.toString("utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return { env: { ...ambient } };
        return { env: { ...ambient }, issue: ".ai/.env is unreadable" };
    } finally {
        if (descriptor !== undefined) closeSync(descriptor);
    }
    const loaded: NodeJS.ProcessEnv = {};
    try {
        for (const [index, source] of text.split(/\r?\n/).entries()) {
            const line = source.trim();
            if (!line || line.startsWith("#")) continue;
            const match = ASSIGNMENT.exec(line);
            if (!match) throw new Error(`.ai/.env line ${index + 1} is not an assignment`);
            loaded[match[1]] = literalValue(match[2], index + 1);
        }
    } catch (error) {
        return { env: { ...loaded, ...ambient }, issue: error instanceof Error ? error.message : String(error) };
    }
    return { env: { ...loaded, ...ambient } };
}
