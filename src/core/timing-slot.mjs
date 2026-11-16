// Timing schedule record inside the autoloader save itself.
//
// The winning FS timing schedule (roleDelays / guardDelays in effect when
// the canary campaign succeeds) is stored in a fixed-size segment appended
// to the trigger record value: " XCFG:1:<120 hex chars>". The save codec
// installs the segment zeroed; this module reads it back at the start of
// the next run and patches it in place after a successful run.
//
// Reading is possible before the FS race because the game's own "save"
// mount is reachable through the SDK mount table from payload start (the
// campaign's setup clones the same mount). Writing patches only the 120
// hex characters at their existing offset: the file size, the record
// framing and every other byte stay untouched, and the result is verified
// by reading it back.
//
// Safety: any inconsistency (missing segment, bad magic, CRC mismatch,
// out-of-range or non-monotonic delays) makes the record be ignored and
// the stock schedule is used, exactly as without this module. Recording
// is best-effort and never blocks a successful run. Reinstalling the
// save (which rewrites the record from the pristine template) resets
// the record to zero.

import coreRuntime from "./runtime.mjs";
import {createFspIdentityConfig} from "./config.mjs";

const {
    allocPage,
    cloneObject,
    closeHandle,
    cmifReply,
    getMountHandle,
    ipcCommit,
    ipcOpenFile,
    prepPacket,
    read64,
    read8,
    sendIPC,
    write8,
    write32,
    write64
} = coreRuntime;

export const SLOT_MARKER = " XCFG:1:";
const SLOT_HEX_LEN = 120; // 60 bytes, hex encoded
const SAVE_PATH = "/saves/Single/XSTRIG.Civ7Save";

// Bounds mirroring campaign.mjs: retune drift is capped at
// TIMING_MAX_DRIFT_US around the baseline and consecutive roles keep at
// least TIMING_MIN_ROLE_GAP_NS between them, so a recorded schedule
// always satisfies both against the stock table.
const MAX_DRIFT_NS = 1000000;
const MIN_GAP_NS = 50000;

function baselines() {
    const config = createFspIdentityConfig();
    return {
        roleDelays: config.roleDelays.slice(),
        guardDelays: config.guardDelays.slice()
    };
}

// -- CRC32 (IEEE) over the first 56 record bytes ----------------------------

function crc32(bytes, length) {
    let crc = 0xffffffff;
    for (let i = 0; i < length; i++) {
        crc ^= bytes[i];
        for (let bit = 0; bit < 8; bit++)
            crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

// -- Record encode / decode (pure; also used by offline tests) ---------------

export function encodeSlotHex(roleDelays, guardDelays, wins) {
    const bytes = new Uint8Array(60);
    const view = new DataView(bytes.buffer);
    bytes[0] = 0x41; // 'A'
    bytes[1] = 0x4c; // 'L'
    bytes[2] = 0x43; // 'C'
    bytes[3] = 0x31; // '1'
    for (let i = 0; i < 10; i++)
        view.setUint32(4 + i * 4, roleDelays[i] >>> 0, true);
    for (let i = 0; i < 2; i++)
        view.setUint32(44 + i * 4, guardDelays[i] >>> 0, true);
    view.setUint32(52, wins >>> 0, true);
    view.setUint32(56, crc32(bytes, 56), true);
    let hex = "";
    for (let i = 0; i < bytes.length; i++)
        hex += ("0" + bytes[i].toString(16)).slice(-2);
    return hex;
}

function validDelays(values, base) {
    if (!Array.isArray(values) || values.length !== base.length) return false;
    for (let i = 0; i < values.length; i++) {
        if (!Number.isSafeInteger(values[i]) || values[i] < 0) return false;
        if (Math.abs(values[i] - base[i]) > MAX_DRIFT_NS) return false;
        if (i > 0 && values[i] - values[i - 1] < MIN_GAP_NS) return false;
    }
    return true;
}

export function decodeSlotHex(hex) {
    if (typeof hex !== "string" || hex.length !== SLOT_HEX_LEN ||
        !/^[0-9a-f]+$/.test(hex)) return null;
    const bytes = new Uint8Array(60);
    for (let i = 0; i < 60; i++)
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (bytes[0] !== 0x41 || bytes[1] !== 0x4c ||
        bytes[2] !== 0x43 || bytes[3] !== 0x31) return null;
    const view = new DataView(bytes.buffer);
    if (view.getUint32(56, true) !== crc32(bytes, 56)) return null;
    const roleDelays = [];
    for (let i = 0; i < 10; i++) roleDelays.push(view.getUint32(4 + i * 4, true));
    const guardDelays = [];
    for (let i = 0; i < 2; i++) guardDelays.push(view.getUint32(44 + i * 4, true));
    const wins = view.getUint32(52, true);
    if (wins < 1) return null;
    const base = baselines();
    if (!validDelays(roleDelays, base.roleDelays) ||
        !validDelays(guardDelays, base.guardDelays)) return null;
    return {roleDelays, guardDelays, wins};
}

export function findSlotSegment(bytes) {
    const marker = SLOT_MARKER;
    for (let i = 0; i + marker.length + SLOT_HEX_LEN <= bytes.length; i++) {
        let match = true;
        for (let j = 0; j < marker.length; j++) {
            if (bytes[i + j] !== marker.charCodeAt(j)) { match = false; break; }
        }
        if (!match) continue;
        let hex = "";
        for (let j = 0; j < SLOT_HEX_LEN; j++)
            hex += String.fromCharCode(bytes[i + marker.length + j]);
        return {offset: i + marker.length, hex};
    }
    return null;
}

// -- Save file IO through the game's save mount -------------------------------

function simpleCmd(handle, command) {
    const packet = allocPage(0x2000);
    prepPacket(packet, 4, 8, [[16, 0x49434653], [24, command]]);
    sendIPC(handle, packet);
    return {packet, reply: cmifReply(packet)};
}

function fileRead(file, offset, size) {
    const data = allocPage(size + 0x1000);
    const packet = allocPage(0x2000);
    prepPacket(packet, (4 | (1 << 24)) >>> 0, 0x0E, []);
    write32(packet + 8n, BigInt(size));
    write32(packet + 12n, BigInt(Number(data & 0xFFFFFFFFn)));
    write32(packet + 16n, BigInt(((1 |
        (Number((data >> 36n) & 7n) << 2) |
        (Number((data >> 32n) & 15n) << 28)) >>> 0)));
    write32(packet + 0x20n, 0x49434653n);
    write32(packet + 0x28n, 0n);
    write32(packet + 0x30n, 0n);
    write64(packet + 0x38n, BigInt(offset));
    write64(packet + 0x40n, BigInt(size));
    sendIPC(file, packet);
    const reply = cmifReply(packet);
    if (reply.result) throw new Error("IFile read @" + offset + " result=0x" +
        Number(reply.result).toString(16));
    const count = Number(read64(packet + BigInt(reply.data)));
    if (!Number.isSafeInteger(count) || count < 0 || count > size)
        throw new Error("IFile read count invalid");
    const bytes = [];
    for (let i = 0; i < count; i++) bytes.push(Number(read8(data + BigInt(i))));
    return bytes;
}

function fileWrite(file, offset, part) {
    const data = allocPage(part.length + 0x1000);
    for (let i = 0; i < part.length; i++)
        write8(data + BigInt(i), BigInt(part[i]));
    const packet = allocPage(0x2000);
    prepPacket(packet, (4 | (1 << 20)) >>> 0, 0x0E, []);
    write32(packet + 8n, BigInt(part.length));
    write32(packet + 12n, BigInt(Number(data & 0xFFFFFFFFn)));
    write32(packet + 16n, BigInt(((1 |
        (Number((data >> 36n) & 7n) << 2) |
        (Number((data >> 32n) & 15n) << 28)) >>> 0)));
    write32(packet + 0x20n, 0x49434653n);
    write32(packet + 0x28n, 1n);
    write32(packet + 0x30n, 1n);
    write64(packet + 0x38n, BigInt(offset));
    write64(packet + 0x40n, BigInt(part.length));
    sendIPC(file, packet);
    return cmifReply(packet).result;
}

function openSaveMount() {
    const mount = getMountHandle("save");
    if (!mount) return null;
    const handle = cloneObject(mount.handle, mount.objId);
    return handle || null;
}

function readSaveBytes(fs) {
    const file = ipcOpenFile(fs, SAVE_PATH, 1);
    if (!file) throw new Error("OpenFile " + SAVE_PATH + " failed");
    try {
        const cmd = simpleCmd(file, 4);
        if (cmd.reply.result) throw new Error("GetSize result=0x" +
            Number(cmd.reply.result).toString(16));
        const size = Number(read64(cmd.packet + BigInt(cmd.reply.data)));
        if (!Number.isSafeInteger(size) || size <= 0 || size > 8 * 1024 * 1024)
            throw new Error("save size invalid");
        const bytes = [];
        for (let off = 0; off < size; off += 0x8000) {
            const part = fileRead(file, off, Math.min(0x8000, size - off));
            for (const b of part) bytes.push(b);
        }
        return bytes;
    } finally {
        closeHandle(file);
    }
}

// Returns {schedule, wins} for a valid record, or null. Never throws.
export async function loadRecordedSchedule() {
    let fs = null;
    try {
        fs = openSaveMount();
        if (!fs) return null;
        const seg = findSlotSegment(readSaveBytes(fs));
        if (!seg) return null;
        const rec = decodeSlotHex(seg.hex);
        if (!rec) return null;
        const base = baselines();
        return {
            wins: rec.wins,
            schedule: {
                roleDelays: rec.roleDelays,
                guardDelays: rec.guardDelays,
                baselineRoleDelays: base.roleDelays,
                baselineGuardDelays: base.guardDelays
            }
        };
    } catch (ignored) {
        return null;
    } finally {
        if (fs) { try { closeHandle(fs); } catch (ignored) {} }
    }
}

// Patches the record with the schedule that just won. Returns success.
// Never throws; a failed record leaves the previous bytes untouched
// unless the write itself partially landed, which the readback check
// detects and reports as failure (the next load then rejects the CRC).
export async function storeRecordedSchedule(schedule) {
    let fs = null;
    try {
        if (!schedule || !validDelays(schedule.roleDelays, baselines().roleDelays) ||
            !validDelays(schedule.guardDelays, baselines().guardDelays))
            return false;
        fs = openSaveMount();
        if (!fs) return false;
        const before = readSaveBytes(fs);
        const seg = findSlotSegment(before);
        if (!seg) return false;
        const prev = decodeSlotHex(seg.hex);
        const hex = encodeSlotHex(schedule.roleDelays, schedule.guardDelays,
            (prev ? prev.wins : 0) + 1);
        const data = [];
        for (let i = 0; i < hex.length; i++) data.push(hex.charCodeAt(i));
        const file = ipcOpenFile(fs, SAVE_PATH, 3);
        if (!file) return false;
        let result;
        try {
            result = fileWrite(file, seg.offset, data);
        } finally {
            closeHandle(file);
        }
        if (result !== 0) return false;
        if (ipcCommit(fs) !== 0) return false;
        const back = findSlotSegment(readSaveBytes(fs));
        return !!back && back.hex === hex && !!decodeSlotHex(back.hex);
    } catch (ignored) {
        return false;
    } finally {
        if (fs) { try { closeHandle(fs); } catch (ignored) {} }
    }
}
