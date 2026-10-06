import { posix, win32 } from "node:path";

const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/i;

function hasUnpairedSurrogate(value: string): boolean {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code >= 0xd800 && code <= 0xdbff) {
            const next = value.charCodeAt(index + 1);
            if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
            index += 1;
        } else if (code >= 0xdc00 && code <= 0xdfff) return true;
    }
    return false;
}

/**
 * Returns a stable reason when a path cannot be interpreted identically on
 * POSIX and Windows. These paths are persisted in portable Cairnkeep formats,
 * so validation must not depend on the host performing the validation.
 */
export function portableRelativePathIssue(value: string, options: { allowCurrentDirectory?: boolean } = {}): string | undefined {
    if (!value) return "empty";
    if (value !== value.normalize("NFC")) return "non-canonical-unicode";
    if (hasUnpairedSurrogate(value)) return "unpaired-surrogate";
    if (/[<>:"\\|?*\u0000-\u001f\u007f]/.test(value)) return "separator-or-control";
    if (posix.isAbsolute(value) || win32.isAbsolute(value)) return "absolute";
    if (value === "." && options.allowCurrentDirectory) return undefined;
    const segments = value.split("/");
    if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return "invalid-segment";
    if (segments.some((segment) => /[ .]$/.test(segment) || WINDOWS_DEVICE.test(segment))) {
        return "non-portable-segment";
    }
    return undefined;
}

export function portablePathCollisionKey(value: string): string {
    // Windows' case-insensitive comparison is closer to invariant uppercase
    // mapping than to lowercasing. In particular, final sigma (ς/σ), long-s
    // (ſ/s), and dotless-i (ı/i) converge when uppercased but not when
    // lowercased. NFC first also makes the key stable across macOS and Linux.
    return value.normalize("NFC").toLocaleUpperCase("en-US");
}
