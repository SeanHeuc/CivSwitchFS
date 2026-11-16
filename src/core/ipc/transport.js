// HIPC transport helpers - packet construction, descriptors, and dispatch.

// -- Low-level IPC ------------------------------------------------

// Zero a buffer and write the HIPC header + extra words.
//   tag0 = HIPC word0 (type + descriptor counts)
//   tag1 = HIPC word1 (raw_words + flags)
//   words = [[offset, value], ...] - additional u32 writes
function prepPacket(buf, tag0, tag1, words) {
    for (let i = 0n; i < 0x200n; i += 8n) write64(buf + i, 0n);
    write32(buf, BigInt(tag0 >>> 0));
    write32(buf + 4n, BigInt(tag1 >>> 0));
    for (const [off, v] of words)
        write32(buf + BigInt(off), BigInt(v >>> 0));
}

// Write an X (pointer) buffer descriptor at the given offset.
// Switchbrew format:
//   word0 bits 31:16=size, 15:12=address[35:32], 8:6=address[38:36], 5:0=index
//   word1: addr[31:0]
// descriptorIndex is the ordinal in the request's X-descriptor list (0, 1, ...).
function writeXDesc(buf, descOffset, dataAddr, dataSize, descriptorIndex) {
    descriptorIndex = descriptorIndex || 0;
    const addrLow  = Number(dataAddr & 0xFFFFFFFFn);
    const addr3235 = Number((dataAddr >> 32n) & 0xFn);
    const addr3638 = Number((dataAddr >> 36n) & 0x7n);
    const word0 = (dataSize << 16) | (addr3638 << 6) | (addr3235 << 12) |
        (descriptorIndex & 0x3F);
    write32(buf + BigInt(descOffset), BigInt(word0 >>> 0));
    write32(buf + BigInt(descOffset + 4), BigInt(addrLow >>> 0));
}

// Send an IPC message via the dispatcher using a heap buffer.
// Forces the svc #0x22 path (heap buffer != tpidrro_el0).
//
// The send runs on a sacrificial raw thread with a bounded wait.
// svcSendSyncRequest has no timeout: if the file-system service stops
// replying (a known failure mode of the reserved-gap race), a direct
// send blocks the payload's only JS thread forever and the console
// appears frozen at whatever the last status line was. With the
// sacrificial thread the main thread waits at most IPC_SEND_TIMEOUT_NS;
// on timeout the service is declared wedged, the packet is poisoned so
// reply parsing reports an error, and every later send fails fast so
// the run can stop with visible output instead of freezing. The blocked
// worker thread is leaked (one per run at most, because of the latch).
// If the raw-thread machinery is unavailable, fall back to a direct
// send (the original behavior).
var IPC_SEND_TIMEOUT_NS = 10000000000n; // 10 s; healthy replies take ms
var IPC_SEND_FAILED = 0xFA110000; // nonzero transport-style error
var ipcSendState = null; // { frame, count, resources, scheduling }
var ipcWedged = false;

function ipcSendInit() {
    if (ipcSendState) return ipcSendState;
    if (typeof buildRawFrame !== "function" ||
        typeof createRawWorker !== "function" ||
        typeof startRawWorker !== "function" ||
        typeof waitRawThread !== "function" ||
        typeof closeRawThread !== "function" ||
        typeof borrowThreadScheduling !== "function" ||
        typeof frameArgSlot !== "function" ||
        typeof readFrameResult !== "function") return null;
    var scheduling = borrowThreadScheduling();
    if (!scheduling) return null;
    var built = buildRawFrame([{ fn: IPC_SEND_DISPATCHER,
        args: [0n, 0n, 0x1000n, 0n] }]);
    if (!built || !built.frame) return null;
    ipcSendState = {
        frame: built.frame, count: built.count,
        resources: { stack: allocPage(0x10000), handleBuf: allocPage(0x10),
            waitBuf: allocPage(0x20) },
        scheduling: scheduling
    };
    return ipcSendState;
}

function sendIPC(handle, buf) {
    if (ipcWedged) return IPC_SEND_FAILED;
    var st = ipcSendInit();
    if (!st) return call_rop(IPC_SEND_DISPATCHER, BigInt(handle), buf, 0x1000n);
    // Patch the reusable one-call frame for this send and reset its
    // result slot, then run the send on a raw worker thread.
    write64(frameArgSlot(st.frame, st.count, 0, 0), BigInt(handle));
    write64(frameArgSlot(st.frame, st.count, 0, 1), BigInt(buf));
    write64(st.frame + BigInt(FRAME_RESULT), FRAME_SENTINEL);
    var worker = createRawWorker(st.frame, st.scheduling, st.resources);
    if (worker.rc !== 0 || !worker.handle)
        return call_rop(IPC_SEND_DISPATCHER, BigInt(handle), buf, 0x1000n);
    if (startRawWorker(worker) !== 0) {
        closeRawThread(worker.handle);
        return call_rop(IPC_SEND_DISPATCHER, BigInt(handle), buf, 0x1000n);
    }
    var rc = waitRawThread(worker.handle, IPC_SEND_TIMEOUT_NS,
        st.resources.waitBuf);
    if (rc === 0) {
        closeRawThread(worker.handle);
        var result = readFrameResult(st.frame, 0);
        return result === FRAME_SENTINEL ? IPC_SEND_FAILED
            : Number(result) >>> 0;
    }
    // The send did not complete in time: the service is wedged. Poison
    // the packet so cmifReply() reports an error (an untouched request
    // buffer could otherwise parse as a success), latch the wedge so
    // later sends fail fast, and leak the blocked worker.
    ipcWedged = true;
    globalThis.__IPC_WEDGED = true;
    for (var i = 0n; i < 0x20n; i += 8n) write64(buf + i, 0n);
    write32(buf + 24n, 0xFFFFFFFFn);
    return IPC_SEND_FAILED;
}

// Close a kernel handle (svc #0x16 wrapper)
function closeHandle(handle) {
    return call_rop(F_CloseHandle, BigInt(handle));
}
