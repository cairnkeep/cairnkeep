// Diagnose an orphaned SQLite WAL: determine checksum byte order, and tally how many
// frame slots carry the *current* header salt (recoverable) vs a stale salt (orphaned
// pre-reset frames whose data was checkpointed into the now-deleted main db).
import { readFileSync } from "node:fs";

const walPath = process.argv[2];
const wal = readFileSync(walPath);
const pageSize = wal.readUInt32BE(8);
const hdrSalt1 = wal.readUInt32BE(16);
const hdrSalt2 = wal.readUInt32BE(20);
const wantC0 = wal.readUInt32BE(24);
const wantC1 = wal.readUInt32BE(28);

function checksum(buf, s0, s1, be) {
    for (let i = 0; i < buf.length; i += 8) {
        const x0 = be ? buf.readUInt32BE(i) : buf.readUInt32LE(i);
        const x1 = be ? buf.readUInt32BE(i + 4) : buf.readUInt32LE(i + 4);
        s0 = (s0 + x0 + s1) >>> 0;
        s1 = (s1 + x1 + s0) >>> 0;
    }
    return [s0, s1];
}

for (const be of [true, false]) {
    const [c0, c1] = checksum(wal.subarray(0, 24), 0, 0, be);
    console.log(`header checksum ${be ? "BE" : "LE"}: got(${c0},${c1}) want(${wantC0},${wantC1}) ${c0 === wantC0 && c1 === wantC1 ? "MATCH" : "no"}`);
}

const frameSize = 24 + pageSize;
const slots = Math.floor((wal.length - 32) / frameSize);
const saltTally = new Map();
let headerSaltFrames = 0, commitFramesHeaderSalt = 0;
for (let s = 0; s < slots; s++) {
    const off = 32 + s * frameSize;
    const s1 = wal.readUInt32BE(off + 8);
    const s2 = wal.readUInt32BE(off + 12);
    const dbSize = wal.readUInt32BE(off + 4);
    const k = `${s1},${s2}`;
    saltTally.set(k, (saltTally.get(k) || 0) + 1);
    if (s1 === hdrSalt1 && s2 === hdrSalt2) {
        headerSaltFrames++;
        if (dbSize !== 0) commitFramesHeaderSalt++;
    }
}
console.log(`pageSize=${pageSize} totalFrameSlots=${slots}`);
console.log(`headerSalt=(${hdrSalt1},${hdrSalt2}) framesWithHeaderSalt=${headerSaltFrames} commitFramesWithHeaderSalt=${commitFramesHeaderSalt}`);
console.log(`salt distribution across slots:`);
for (const [k, n] of [...saltTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
    console.log(`  salt(${k}) -> ${n} slots${k === `${hdrSalt1},${hdrSalt2}` ? "  <= current header salt" : ""}`);
}
