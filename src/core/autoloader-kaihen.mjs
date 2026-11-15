// kaiHEN installation module.
//
// This module owns the SD layout, the native bootstrap NRO, ldr:ro mapping,
// and the later HEN process handoff.  It consumes only the facade exported by
// autoloader-fs.mjs, so the FS elevation path stays frozen.

const BOOTSTRAP_PATH = "/kaihen/bootstrap.bin";
const HEN_PATH = "/kaihen/bin/hen/main";
const GAME_PATH = "/kaihen/bin/game/main";
const NRO_SIZE = 0x12000;
const NRO_TEXT_LIMIT = 0xff80;
const PAGE = 0x1000;

function writeU32(bytes, offset, value) {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >>> 8) & 0xff;
    bytes[offset + 2] = (value >>> 16) & 0xff;
    bytes[offset + 3] = (value >>> 24) & 0xff;
}

// Civ7's pthread_t is nn::os::ThreadType* | 7. The bootstrap passes the
// tagged value to pthread_trywait, but nn::os::TryWaitThread (0x137110)
// takes the untagged ThreadType* and reads its kernel handle at +0x1b0.
// Supply the same adapter kaiHEN uses: and x0,x0,#~7 ; ldr x16 ; br x16.
const TRYWAIT_ADAPTER = [0x927df000, 0x58000070, 0xd61f0200, 0xd503201f];
const TRYWAIT_ADAPTER_SIZE = 0x18;

function makeBootstrapNro(text, tryWait) {
    if (text.length > NRO_TEXT_LIMIT)
        throw new Error("bootstrap exceeds the NRO text segment: " + text.length);
    const adapterOffset = (text.length + 15) & ~15;
    if (adapterOffset + TRYWAIT_ADAPTER_SIZE > 0x10000)
        throw new Error("bootstrap + trywait adapter exceeds the text segment");
    const image = new Uint8Array(NRO_SIZE);
    image[0x10] = 0x4e; image[0x11] = 0x52; image[0x12] = 0x4f; image[0x13] = 0x30;
    writeU32(image, 0x18, NRO_SIZE);
    writeU32(image, 0x24, 0x10000);
    writeU32(image, 0x28, 0x10000);
    writeU32(image, 0x2c, 0x1000);
    writeU32(image, 0x30, 0x11000);
    writeU32(image, 0x34, 0x1000);
    writeU32(image, 0x38, 0x1000);
    image.set(text, 0x80);
    const at = 0x80 + adapterOffset;
    for (let i = 0; i < TRYWAIT_ADAPTER.length; i++)
        writeU32(image, at + i * 4, TRYWAIT_ADAPTER[i]);
    const target = BigInt(tryWait);
    for (let i = 0; i < 8; i++)
        image[at + 16 + i] = Number((target >> BigInt(i * 8)) & 0xffn);
    return {image, adapterOffset};
}

async function ldrCommand(fs, handle, command, values, copies = []) {
    const words = 8 * (values.length + 1);
    const packet = fs.allocPage(0x2000);
    fs.write32(packet, 4n);
    fs.write32(packet + 4n,
        BigInt((0x80000000 | Math.ceil((32 + words) / 4)) >>> 0));
    fs.write32(packet + 8n, BigInt(1 | (copies.length << 1)));
    fs.write32(packet + 12n, 0n);
    fs.write32(packet + 16n, 0n);
    let at = 20;
    for (const copy of copies) {
        fs.write32(packet + BigInt(at), BigInt(copy));
        at += 4;
    }
    at = (at + 15) & ~15;
    fs.write32(packet + BigInt(at), 0x49434653n);
    fs.write32(packet + BigInt(at + 8), BigInt(command));
    // libnx's ldrRo* payload starts with a u64 PID placeholder:
    //   struct { u64 pid_placeholder; u64 args[...]; } in = {0, ...};
    // The kernel fills the header PID slot; the payload placeholder stays 0
    // and the server skips it. Writing args at at+16 made RO read
    // source=nro_size and fail checkHeapRange with 0x80216.
    fs.write64(packet + BigInt(at + 16), 0n);
    for (let i = 0; i < values.length; i++)
        fs.write64(packet + BigInt(at + 24 + i * 8), BigInt(values[i]));
    const transport = await fs.sendIpcSync(handle, packet, 10000);
    const reply = fs.cmifReply(packet);
    return {packet, transport, reply};
}

async function openLdrRo(fs) {
    if (globalThis.__AUTOLOADER_LDRRO_HANDLE)
        return globalThis.__AUTOLOADER_LDRRO_HANDLE;
    // Match start-hen.cjs: open ldr:ro in the application's SM context.
    // The fs-exported SM is the RO-launch context; using it here installs the
    // bootstrap in the wrong Loader context for later game mounts.
    const handle = fs.openAppService("ldr:ro");
    if (!handle) throw new Error("app ldr:ro unavailable");
    const init = await ldrCommand(fs, handle, 4, [], [0xffff8001]);
    if (init.transport || init.reply.result)
        throw new Error("ldr:ro Initialize transport=0x" +
            init.transport.toString(16) + " result=0x" +
            Number(init.reply.result).toString(16));
    globalThis.__AUTOLOADER_LDRRO_HANDLE = handle;
    await fs.stage("LDRRO: initialized handle=0x" + handle.toString(16));
    return handle;
}

export async function readHenFiles(fs) {
    if (globalThis.__AUTOLOADER_HEN_FILES)
        return globalThis.__AUTOLOADER_HEN_FILES;
    const sd = await fs.openSdCard(fs.input.domainSession);
    try {
        return {
            bootstrap: fs.readFileAll(sd, BOOTSTRAP_PATH).bytes,
            hen: fs.readFileAll(sd, HEN_PATH).bytes,
            game: fs.readFileAll(sd, GAME_PATH).bytes
        };
    } finally {
        fs.closeHandle(sd);
    }
}

export async function mapBootstrap(fs, files) {
    const built = makeBootstrapNro(files.bootstrap, fs.sdkBase() + 0x137110n);
    const image = built.image;
    const sdkSource = await fs.sdkAllocate(NRO_SIZE + PAGE, PAGE);
    const heapSource = fs.allocPage(NRO_SIZE + PAGE);
    const sdkInfo = await fs.memoryInfo(sdkSource);
    const heapInfo = await fs.memoryInfo(heapSource);
    const suitable = info => info.rc === 0 && info.type === 5 &&
        info.permission === 3 && info.attributes === 0 &&
        info.ipc === 0 && info.device === 0;
    await fs.stage("HEN: sdk type=" + sdkInfo.type +
        " perm=" + sdkInfo.permission + " attr=" + sdkInfo.attributes +
        " ipc=" + sdkInfo.ipc + " dev=" + sdkInfo.device +
        " | heap type=" + heapInfo.type + " perm=" + heapInfo.permission +
        " attr=" + heapInfo.attributes + " ipc=" + heapInfo.ipc +
        " dev=" + heapInfo.device);
    const source = suitable(sdkInfo) ? sdkSource : heapSource;
    if (!suitable(sdkInfo) && !suitable(heapInfo))
        await fs.stage("HEN: no heap source passed the type check");
    for (let i = 0; i < PAGE; i += 4)
        fs.write32(source + BigInt(NRO_SIZE + i), 0n);
    for (let i = 0; i < image.length; i += 4) {
        const word = (image[i] | (image[i + 1] << 8) |
            (image[i + 2] << 16) | (image[i + 3] << 24)) >>> 0;
        fs.write32(source + BigInt(i), BigInt(word));
    }
    const bss = source + BigInt(NRO_SIZE);
    await fs.stage("HEN: nro source=0x" + source.toString(16) +
        " bss=0x" + bss.toString(16) + " size=0x" + NRO_SIZE.toString(16));
    const handle = await openLdrRo(fs);
    const mapped = await ldrCommand(fs, handle, 0,
        [source, NRO_SIZE, bss, PAGE], []);
    if (mapped.transport || mapped.reply.result)
        throw new Error("ldr:ro MapNro transport=0x" +
            mapped.transport.toString(16) + " result=0x" +
            Number(mapped.reply.result).toString(16));
    const destination = Number(fs.read64(mapped.packet +
        BigInt(mapped.reply.data)));
    await fs.stage("HEN: bootstrap mapped destination=0x" +
        destination.toString(16) + " hen=" + files.hen.length +
        " game=" + files.game.length);
    return {handle, destination, image: NRO_SIZE,
        adapterOffset: built.adapterOffset};
}

export async function runKaihen(fs) {
    await fs.stage("HEN: checking the SD kaiHEN layout");
    const files = await readHenFiles(fs);
    await fs.stage("HEN: bootstrap=" + files.bootstrap.length +
        " hen=" + files.hen.length + " game=" + files.game.length);
    const mapped = await mapBootstrap(fs, files);
    // The bootstrap entry is destination+0x80.  Execution needs the FS
    // process's pthread_create/trywait/join offsets; those are discovered in
    // the next stage rather than guessed.
    await fs.stage("HEN: mapped; execution needs the FS pthread offsets");
    return {mapped};
}

function writeString(fs, address, text) {
    for (let i = 0; i < text.length; i += 4) {
        const word = (text.charCodeAt(i) || 0) |
            ((text.charCodeAt(i + 1) || 0) << 8) |
            ((text.charCodeAt(i + 2) || 0) << 16) |
            ((text.charCodeAt(i + 3) || 0) << 24);
        fs.write32(address + BigInt(i), BigInt(word >>> 0));
    }
}

export async function buildBootstrapArgs(fs, mapped) {
    const notifier = fs.notifier;
    const notifierSession = fs.notifierSession();
    const gate = await fs.gate();
    const donor = fs.donor();
    const retained = fs.retained();
    const sm = fs.services.exportedSm;
    const shell = fs.services.shell;
    const monitor = fs.services.dmnt;
    if (!donor || !sm || !shell || !monitor || !notifier)
        throw new Error("missing FS/PM/notifier state for the bootstrap");
    // The bootstrap's fs_root_session is fsp-srv (IFileSystemProxy):
    // SdReader/SdWriter dispatch OpenSdCardFileSystem (18) and
    // NativePackage dispatches OpenFileSystemWithId (10) on it.  Switch 2
    // needs an initialized root clone (SetCurrentProcess + Control 2), not
    // the raw SM session and not the SD card's IFileSystem object.
    const fsRoot = await fs.openBootstrapRoot();
    const loaderRoot = await fs.services.loaderRoot();
    const fsProcess = fs.services.fsProc
        ? {handle: fs.services.fsProc}
        : await fs.services.exportHandle(0xffff8001);
    const serverCopy = await fs.services.serverCopy(gate.row.receive);
    if (!fsProcess || !fsProcess.handle || !serverCopy || !serverCopy.handle)
        throw new Error("could not export the FS/server handles");
    const args = fs.allocPage(0x1000);
    const w32 = (o, v) => fs.write32(args + BigInt(o), BigInt(v));
    const w64 = (o, v) => fs.write64(args + BigInt(o), BigInt(v));
    w32(0, retained.candidateHandle);
    w64(8, retained.dataOffset);
    w64(16, retained.dataEntryOffset + 0x20);
    w64(24, gate.row.address);
    w64(32, gate.row.vptr);
    w64(40, gate.targetDomain);
    w64(48, gate.row.metadata);
    w64(56, gate.row.request);
    for (let i = 0; i < 7; i++) w64(64 + i * 8, gate.waiters[i] || 0);
    // BootstrapInput.workers[7] are the FS API worker threads that the
    // native LoaderGate cancels while parking. They live in FS, and this
    // process only holds exported copies, so export each FS handle first.
    const workers = [];
    if (gate.fsWorkers && gate.fsWorkers.length === 7) {
        for (const worker of gate.fsWorkers) {
            const copy = await fs.services.exportHandle(worker.handle);
            if (!copy || !copy.handle)
                throw new Error("could not export FS API worker 0x" +
                    worker.handle.toString(16));
            workers.push(copy.handle);
        }
    } else {
        throw new Error("FS API worker group not found (" +
            (gate.fsWorkers ? gate.fsWorkers.length : 0) + "); ring=" +
            (gate.ringSizes || []).join(","));
    }
    await fs.stage("HEN: workers=" + workers.length +
        " fs=" + gate.fsWorkers.map(w => w.size.toString(16)).join("/"));
    for (let i = 0; i < 7; i++)
        w32(120 + i * 4, workers[i] || 0);
    w32(148, gate.row.receive);
    w32(152, gate.row.wait);
    w32(156, notifier.handle);
    w32(160, serverCopy.handle);
    w32(164, notifier.eventRead);
    w32(168, notifier.eventWrite);
    w64(176, gate.table);
    w64(184, gate.targetDomain);
    w64(192, gate.targetId);
    w64(200, donor.entry);
    w64(208, donor.object);
    w64(216, donor.metadata);
    w64(224, donor.vptr);
    w64(232, 0x040000000000003an);
    w32(240, shell);
    w32(244, monitor);
    w64(248, 0x040000000000003an);
    w32(256, 0x14);
    w32(260, 3);
    w64(264, fs.sdkBase() + 0x142180n);
    // pthread_trywait: the adapter appended after the bootstrap text.
    w64(272, BigInt(mapped.destination) + BigInt(0x80 + mapped.adapterOffset));
    w64(280, fs.sdkBase() + 0x142480n);
    w32(288, sm);
    w32(292, mapped.handle);
    w32(296, fsRoot);
    writeString(fs, args + 300n, "@Sdcard:/kaihen/bin/hen/exefs.nsp\0");
    w32(396, fsProcess.handle);
    w32(400, notifierSession);
    w32(404, loaderRoot);
    await fs.stage("HEN: args built gate=0x" +
        gate.row.address.toString(16) + " workers=" + workers.length +
        " donor=0x" + donor.object.toString(16));
    return {args, fsRoot, loaderRoot, fsProcess, serverCopy};
}

export async function startBootstrap(fs, mapped, built) {
    const threadOut = fs.allocPage(0x20);
    fs.write64(threadOut, 0n);
    const create = Number(fs.call_rop(fs.sdkBase() + 0x142180n,
        threadOut, 0n, BigInt(mapped.destination + 0x80), built.args)) >>> 0;
    const thread = Number(fs.read64(threadOut));
    await fs.stage("HEN: pthread_create result=0x" + create.toString(16) +
        " thread=0x" + thread.toString(16));
    if (create || !thread)
        throw new Error("pthread_create failed 0x" + create.toString(16));
    const resultOut = fs.allocPage(0x20);
    fs.write64(resultOut, 0n);
    const join = Number(fs.call_rop(fs.sdkBase() + 0x142480n,
        BigInt(thread), resultOut, 0n)) >>> 0;
    const operation = Number(fs.read32(built.args + 408n));
    const result = Number(fs.read32(built.args + 412n));
    const pid = fs.read64(built.args + 416n);
    const gateRestore = Number(fs.read32(built.args + 424n));
    const channelRestore = Number(fs.read32(built.args + 428n));
    await fs.stage("HEN: join=0x" + join.toString(16) +
        " op=" + operation + " result=0x" + result.toString(16) +
        " pid=" + pid.toString() + " gate=0x" +
        gateRestore.toString(16) + " channel=0x" +
        channelRestore.toString(16));
    if (join || result)
        throw new Error("bootstrap failed op=" + operation +
            " result=0x" + result.toString(16));
    // BootstrapResult.process_id is 64-bit; report it as a string so
    // JSON.stringify in the henboot command cannot throw on a BigInt.
    return {operation, result, pid: pid.toString()};
}

export async function henBoot(fs) {
    const files = await readHenFiles(fs);
    const mapped = await mapBootstrap(fs, files);
    const built = await buildBootstrapArgs(fs, mapped);
    return await startBootstrap(fs, mapped, built);
}

// Prepare stage: SD layout, cached HEN files, and the RO donor.  The heavy
// lifting lives in the FS module because it needs FS memory; this entry point
// keeps the three stages explicit at the orchestrator level.
export async function prepareKaihen(fs) {
    return await fs.prepareKaihen();
}

// Boot stage: launch the RO title, start it, release the acquisition game,
// open ro:dmnt, then install ldr:ro/HEN.  The primitives come from the FS
// facade; this module owns the order and the kaiHEN parts.
export async function bootKaihen(fs) {
    await fs.stage("KAIHEN BOOT: querying the acquisition process");
    const original = await fs.pmProcessId(0x0400000000000037n);
    await fs.stage("KAIHEN BOOT: acquisition pid=" + original);

    const pid = await fs.launchRo(2);
    await fs.stage("KAIHEN BOOT: RO pid=" + pid);

    await fs.pmCommand("start", pid);
    await fs.waitMs(2500);
    if (original) {
        await fs.pmCommand("terminate", original);
        await fs.waitMs(2500);
    }

    await fs.openRoDmnt();
    await fs.stage("KAIHEN BOOT: ro:dmnt is open");
    return await henBoot(fs);
}

export function createKaihen(fs) {
    return {
        apiVersion: 1,
        prepare: () => prepareKaihen(fs),
        install: () => henBoot(fs),
        boot: () => bootKaihen(fs),
        commands: () => ({
            hencheck: async () => {
                const sd = await fs.sdHandle();
                const parts = [];
                for (const path of ["/kaihen", "/kaihen/bin",
                    "/kaihen/bin/hen", "/kaihen/bin/game", "/kaihen/bin/ro"]) {
                    const list = fs.ipcListDirectory(sd, path, 3);
                    parts.push(path + "=" + list.entries.map(e =>
                        e.name + ":" + e.size).join("|"));
                }
                await fs.stage("HENCHECK: " + parts.join(" ; "));
                return "OK " + parts.join(" ; ");
            },
            ldrro: async () => {
                try {
                    const handle = await openLdrRo(fs);
                    return "OK handle=0x" + handle.toString(16);
                } catch (error) {
                    return "ERR " + (error && error.message ? error.message : error);
                }
            },
            henboot: async () => {
                if (globalThis.__AUTOLOADER_HEN_STARTED)
                    return "ERR henboot already attempted";
                globalThis.__AUTOLOADER_HEN_STARTED = true;
                try {
                    const result = await henBoot(fs);
                    return "OK " + JSON.stringify(result);
                } catch (error) {
                    return "ERR " + (error && error.message ? error.message : error);
                }
            }
        })
    };
}
