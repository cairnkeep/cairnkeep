// Forensic reconstruction of a SQLite database from an orphaned WAL file
// (project.db-wal present, project.db deleted). Parses WAL frames per the SQLite
// WAL format, validates the salt + checksum chain, replays committed frames, and
// writes a standalone .db. Reads the WAL read-only; never mutates the source.
//
// Usage: node wal-reconstruct.mjs /path/to/project.db-wal /path/to/output.db
import { readFileSync, writeFileSync } from "node:fs";

const walPath = process.argv[2];
const outPath = process.argv[3];
if (!walPath || !outPath) {
    console.error("usage: node wal-reconstruct.mjs <input.db-wal> <output.db>");
    process.exit(2);
}

const wal = readFileSync(walPath);
if (wal.length < 32) {
    console.error("WAL too short for a header");
    process.exit(1);
}

const magic = wal.readUInt32BE(0);
if (magic !== 0x377f0682 && magic !== 0x377f0683) {
    console.error(`bad WAL magic 0x${magic.toString(16)}`);
    process.exit(1);
}
const pageSize = wal.readUInt32BE(8);
const hdrSalt1 = wal.readUInt32BE(16);
const hdrSalt2 = wal.readUInt32BE(20);
let cs0 = wal.readUInt32BE(24);
let cs1 = wal.readUInt32BE(28);

function checksum(buf, s0, s1, be) {
    for (let i = 0; i < buf.length; i += 8) {
        const x0 = be ? buf.readUInt32BE(i) : buf.readUInt32LE(i);
        const x1 = be ? buf.readUInt32BE(i + 4) : buf.readUInt32LE(i + 4);
        s0 = (s0 + x0 + s1) >>> 0;
        s1 = (s1 + x1 + s0) >>> 0;
    }
    return [s0, s1];
}

// Auto-detect checksum byte order by which one validates the header checksum.
let bigEndianChecksum = true;
{
    const [be0, be1] = checksum(wal.subarray(0, 24), 0, 0, true);
    const [le0, le1] = checksum(wal.subarray(0, 24), 0, 0, false);
    if (be0 === cs0 && be1 === cs1) bigEndianChecksum = true;
    else if (le0 === cs0 && le1 === cs1) bigEndianChecksum = false;
    else console.error(`WARN: header checksum matches neither byte order — proceeding with BE`);
}
console.log(`WAL: pageSize=${pageSize} salt=(${hdrSalt1},${hdrSalt2}) checksum=${bigEndianChecksum ? "BE" : "LE"}`);

const frameHdr = 24;
const frameSize = frameHdr + pageSize;
let off = 32;
let run0 = cs0, run1 = cs1;

let committed = new Map();   // pgno -> Buffer (last committed snapshot)
let pending = new Map();     // pgno -> Buffer (since last commit)
let committedDbSize = 0;
let frameCount = 0, commitCount = 0;

while (off + frameSize <= wal.length) {
    const fh = wal.subarray(off, off + frameHdr);
    const pgno = fh.readUInt32BE(0);
    const dbSize = fh.readUInt32BE(4);
    const fSalt1 = fh.readUInt32BE(8);
    const fSalt2 = fh.readUInt32BE(12);
    const fc0 = fh.readUInt32BE(16);
    const fc1 = fh.readUInt32BE(20);
    const page = wal.subarray(off + frameHdr, off + frameSize);

    if (fSalt1 !== hdrSalt1 || fSalt2 !== hdrSalt2) break; // end of valid frames

    // checksum chains over first 8 bytes of frame header + page data
    let [c0, c1] = checksum(wal.subarray(off, off + 8), run0, run1, bigEndianChecksum);
    [c0, c1] = checksum(page, c0, c1, bigEndianChecksum);
    if (c0 !== fc0 || c1 !== fc1) break; // checksum chain broken -> stop

    run0 = c0; run1 = c1;
    frameCount++;
    pending.set(pgno, Buffer.from(page));

    if (dbSize !== 0) {
        // commit frame: fold pending into committed snapshot
        for (const [p, b] of pending) committed.set(p, b);
        pending.clear();
        committedDbSize = dbSize;
        commitCount++;
    }
    off += frameSize;
}

console.log(`frames(valid)=${frameCount} commits=${commitCount} committedDbSize=${committedDbSize} pagesCaptured=${committed.size}`);

if (committedDbSize === 0 || !committed.has(1)) {
    console.error(`cannot reconstruct: committedDbSize=${committedDbSize} hasPage1=${committed.has(1)}`);
    process.exit(3);
}

const out = Buffer.alloc(committedDbSize * pageSize); // missing pages -> zero-filled
let missing = 0;
for (let p = 1; p <= committedDbSize; p++) {
    const b = committed.get(p);
    if (b) b.copy(out, (p - 1) * pageSize);
    else missing++;
}
writeFileSync(outPath, out);
console.log(`wrote ${outPath} (${committedDbSize} pages, ${missing} missing/zero-filled)`);
