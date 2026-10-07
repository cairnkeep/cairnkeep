import fs from "node:fs";
import { dirname } from "node:path";

function sameFile(left, right) {
  return right.isFile() && !right.isSymbolicLink()
    && left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs
    && left.uid === right.uid && left.gid === right.gid && left.mode === right.mode;
}

// Recheck an already descriptor-inspected mutation target. This is a
// point-in-time guard, not an operating-system compare-and-swap primitive.
export function assertFileUnchanged(path, expected, label) {
  try {
    const named = fs.lstatSync(path);
    if (expected && sameFile(expected, named)) return;
  } catch (error) {
    if (!expected && error?.code === "ENOENT") return;
  }
  throw new Error(`${label} changed or is unsafe before publication.`);
}

// Bootstrap utilities must work before the TypeScript server has been built.
// Keep the descriptor-first contract aligned with src/stable-file.ts.
export function readStableFile(path, { label, maxBytes, privateMode, nonExecutable = false }) {
  let descriptor;
  try {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error();
    descriptor = fs.openSync(path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
      | (fs.constants.O_NOCTTY ?? 0) | (process.platform === "win32" ? 0 : fs.constants.O_NONBLOCK ?? 0));
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.size > maxBytes) throw new Error();
    if (process.platform !== "win32") {
      if (nonExecutable && (opened.mode & 0o111) !== 0) throw new Error(`${label} has an unsafe executable mode.`);
      if (privateMode !== undefined && ((opened.mode & 0o777) !== privateMode
          || (typeof process.getuid === "function" && opened.uid !== process.getuid() && opened.uid !== 0))) throw new Error();
    }
    const parent = fs.lstatSync(dirname(path));
    const named = fs.lstatSync(path);
    if (named.isSymbolicLink() || parent.isSymbolicLink()) throw new Error(`${label} crosses a symlink.`);
    if (!parent.isDirectory() || !sameFile(opened, named)) throw new Error();
    const buffer = Buffer.allocUnsafe(opened.size + 1);
    let offset = 0;
    while (offset < buffer.byteLength) {
      const count = fs.readSync(descriptor, buffer, offset, buffer.byteLength - offset, null);
      if (count === 0) break;
      offset += count;
    }
    const after = fs.fstatSync(descriptor);
    const parentAfter = fs.lstatSync(dirname(path));
    if (!sameFile(opened, after) || offset !== opened.size
        || !parentAfter.isDirectory() || parentAfter.isSymbolicLink()
        || parent.dev !== parentAfter.dev || parent.ino !== parentAfter.ino
        || !sameFile(opened, fs.lstatSync(path))) throw new Error();
    return { bytes: buffer.subarray(0, offset), stat: opened };
  } catch (error) {
    if (error instanceof Error && [`${label} crosses a symlink.`, `${label} has an unsafe executable mode.`].includes(error.message)) throw error;
    if (error?.code === "ELOOP") throw new Error(`${label} crosses a symlink.`);
    throw new Error(`${label} is unsafe, changed or unreadable.`);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

export function readStableText(path, options) {
  const { bytes, stat } = readStableFile(path, options);
  try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), stat }; }
  catch { throw new Error(`${options.label} contains invalid UTF-8.`); }
}

export function readStableJson(path, options) {
  const { text } = readStableText(path, options);
  try { return JSON.parse(text); }
  catch { throw new Error(`${options.label} contains invalid JSON.`); }
}
