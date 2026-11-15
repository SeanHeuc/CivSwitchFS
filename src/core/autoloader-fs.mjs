// Autoloader relay: runs inside CivSwitchFS's elevated window, after the
// fsp-srv identity is promoted and before CFS returns.  The first step is a
// real SD-card check; the kaiHEN native stage will be ported here next.
import coreRuntime, {waitMs} from "./runtime.mjs";
import {emitFastStage} from "./log-stage.mjs";

const DEV_MODE = () => globalThis.__AUTOLOADER_DEV__ === true;
const PROD_PREFIXES = [
    "BUILD:", "KAIHEN PREP:", "DONOR: captured", "DONOR: /main source",
    "EVENT: qualified", "HANDOFF:",
    "LOOP: mount", "LOOP: exchange", "LOOP: swapped", "LOOP: reply",
    "SMGET:", "ROCMD:", "FSREAD:", "FSPATCH:", "FSRESTORE:",
    "HEN:", "ERROR:"
];
const stage = message => {
    const text = String(message);
    if (!DEV_MODE()) {
        const bare = text.startsWith("AUTOLOADER: ")
            ? text.slice("AUTOLOADER: ".length) : text;
        if (!PROD_PREFIXES.some(prefix => bare.startsWith(prefix)))
            return Promise.resolve();
    }
    return emitFastStage(text.startsWith("AUTOLOADER:") ? text : "AUTOLOADER: " + text);
};
const BUILD_UTC = "utc_time_holder";

const {
    allocPage,
    borrowThreadScheduling,
    buildRawFrame,
    call_rop,
    GADGET_MEMCPY,
    closeRawThread,
    launchRawWorker,
    waitRawThread,
    cloneObject,
    closeHandle,
    IPC_SEND_DISPATCHER,
    ipcCommit,
    ipcCreateDirectory,
    ipcCreateFile,
    ipcFreeSpace,
    ipcGetEntryType,
    ipcListDirectory,
    ipcOpenFile,
    ipcSimpleCmd,
    cmifReply,
    prepPacket,
    read8,
    read32,
    read64,
    readDomainObjects,
    sendDomainCmd,
    sendDomainCmdB,
    sendIPC,
    write32,
    write64,
    writeDirtyData,
    writeStr,
    writeXDesc
} = coreRuntime;

const OPEN_SD_CARD_FILESYSTEM = 18;

// Civ7 / 23.0.1 FS layout: the promoted root vtable points into the FS
// module; these constants come from civ7-fs-kaihen targets/civ7.
const CIV7_SDK_FROM_ROOT_VPTR = 0xf38be0;
const CIV7_SM_SERVICE_OFFSET = 4768;

// Genuine RO policy captured from this console (23.0.1 JP) and the native
// RO helper payload.  Both hashes match the reference manifest; the payload
// is used unmodified.
const RO_POLICY_HEX = "4d45544100000000000000002700313f00000000000000000004005c00500000726f00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000040040000b000000080000000c003000040e50b4a3c97e015126418805bbbb90482112506b19f2373756e2e123046a54957a334c65869ab5fc45b3ca79ab37775b8b2c9fb05bdb80e325aca3ef4a277dcc3fd405841bad9c430beb1d0b3095ae27ebc0721be9672c82261914011540c609cf7a279657ee7a4692298f6bda934bbd7121e42297686e65dcdd5f39201f8486a9962a80c75a782dad9522d4bf4d8b52a2f25a1ebf40c902c9423c2030b73af839ecdb22d76973b4bdf121da6921a0fa96dd0c2f3520b4539fb4f06dc111af2834a3400778c975b5917ed4bc12a2940033137ae093948db579e03fdee96e2e6af441d35d5bf3cfe8c333a14861288bfc6cecb1f494251d12ffe2b881d63e55e2a1c381dd8c424532723c4361f67dc70fc580d085a6c6040a486ff695599bc861b2998b46736772f20248fe91a7de88a702fd13550627107a741efc419518523a453ef19e254017c0cd669d75f88b7b1e9b17d5815541288c22146b9177c8252876d9680b62c119021a8c2817fdb88508770fabd1c2df2460658d494aa434883bde21217e07eb79cd68657a33230b2f388ebf804d15c7f85281385caaedbb96cf645952a72ddfec9cdd006c2cbc7f93c7b3a3f02beec039a7059a988c7f5cfb98407ed43b3d0f1ca527e1e22fd20a8587da7efe37fab85429fa7c388c01db322e0c04829c600c3031d5a0c95c0e088ef6545e2186b2c4e0418ebfa23f402deb568acbb9228efb9a6d017333d9c78bf67ffe466dbd28e9b68433acb51225a98dbf0de6d56e667155650eacfd1f35c29ec7eae9c9c8e18f8d61822938af2d8481abaf000588a1a91f09a289a6beac9ba8ea597e9e046282d3d2dad6b6e116c6302d4428a34d14be6b098e78583563d0b5c63b5230926f097c4e0381ce40ea02d1969265f7b69a9cbe42302e1ed76fb3e8f0a32b0aec4a3ad628c99620e199ef4822ab6bec49bbd4f2b9b1dbdd3c155fbe1f5ef4e6c6544afffb3a14a3a8f9a872aa7322117c9de710126829220ae75dc5f0c507e2cf25bf625e2e93c5222a61236c149903548b2f767d3b8434e2e64adcf29b1658f57db58db9b63d4e453b0317d4143494440020000000000000900000037000000000000043700000000000004400300002c0000007003000029000000a0030000200000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000856c64723a726f83726f3a3186726f3a646d6e7406666174616c3a75067365743a7379730373706c3a00000000000000b7733f3fcfffff1fefff7f200f06e0470f00009f2f0000a0ff3fd800ff7f00024143493000000000000000000000000037000000000000040000000000000000400000001c0000006000000029000000900000002000000000000000000000000100000000000000000000001c000000000000001c0000000000000000000000856c64723a726f86726f3a646d6e7483726f3a3106666174616c3a750373706c3a067365743a73797300000000000000b7733f3fcfffff1fefff7f200f06e0470f00009f2f0000a0ff3fd800ff7f0000";
const RO_PAYLOAD_HEX = "4e534f300000000000000000780000001001000000000000241100000001000034120000002000005100000004000000851200000030000010000000000000005079c3e206edae3e0f993c616e0770cc7e7e0e627154712fa814db7385982b10241100005100000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000007665841a1e9211b06414776eb09ba57663fc5cf66ea9d811b5f4c69b07c10d99b28f4926891b3ca64ef61bb5b2e36707b3520de7f96450bc22f41788f7f25bfed25a28bbca829b38d41997bac02a15ed1c8d7565358f8f161cdf79af2fc50e356d61696e000000000000000000000000030000140020000000000000ff0307d11f2003d5a0010110fd7b16a9fc6f17a9fa6718a9f85f19a9f6571aa9f44f1ba9f3030094e843029116017eb2200100b41f2003d53400011000109e52405fa072f4030094e00314aae903009460ffffb5f30301aae8031faa74d03bd58902088b084100911f0104f13f7d00a981ffff54080000d0e003132a001d40fd28008052880a00b9800200fdde03009460000035880a40b9a8000034004099524073a772dc030094fdffff17f4031f2af5031f2afbe301911c0000d09c3301911d0000d0bd030191f7030291f9830191fa230191ffff08a9ffff07a9f30700f9d5060034b4070034e8031f2af8031f2aeb430291290080526b0140b9ea03092aab000034090700112b5b38b8485b38b8f803092ae9031f2a28008052eb0316aacafe0737e8031faae97a68b8c9000034295b38b8090700110a0900114a5b38b8f803092a080500911f1100f1e1feff5458050034e8031faa69d03bd52a01088b084100911f0104f15f7d00a981ffff5403109e52e0830191e103182ae2031f2a435fa072ad0300943f4038eba2faff54487b61b8a00300b429c09e521f0009eb01faff541f090071c3f9ff5418090051e05a78b82a000014e3e30191e003132a41008052e2031caaf6000094f503002ae09300b9b4f8ff3563037eb2e003132a21008052e2031daaee000094f403002ae09700b9bdffff1700109e52405fa07285030094b7ffff171f050071c8010054e9430291207968b89003009420f6ffb5e8031faae96a68b849040034081100911f4100f181ffff54e003012a74030094a8ffff1769d03bd518090051290140b9e05a78b83f090071810000546c030094ff5a38b89fffff17f83f00b978d03bd50a0340b989008052480108320920a0721f01096ba1010054080740b90802f8378b00805249010832f0031f2a0b20a0723f010b6b490080526002005428000014e16a28b88bffff17080740b9f0031f2aff7f01a94900805222000014090b40b96c0080522b791f123f010072a90080528901891a7f09007101030054105b69b8290500118b0080520b20a0725f010b6be10100540b4b298bea031f2a290d00116eb140296b0140b98dfd5cd38f6d18538c110253ae0d60b36b810faaeb0f00f9cb910caaeb0b00f907000014ea031f2aff7f01a904000014f0031f2aff7f01a92a008052eb3f40f908250012f3031f2a3d01080bf04700b9eb1b00f92b0d00117c0d1e126a020037bf0301712802005488130011fb03132abf03086bc3010054085b7cb869ca88526928a9721f01096ba100005488031f32330080521b5b68b805000014f3031f2afb031f2a02000014fb03132ae04300b9e0830291e1031f2a021880524b03009408068052c0ff8f12e89f00b922030094e0ff8f12e11700f923030094e11300f925030094e94740b9ec031c2a1304003428008052e849aa727f03086b810300546903003588190011bf03086b03030054c9698ad2084b2c8bf30740f94946aaf2fc031f2a1d0000d0bd030191e9a9c8f209abe8f2e95300f9e91340f9080940f9e9830ba9e99180d249d6bcf2294ac7f289aff3f2080109cae85700f9e9a342a9e95b00f9e86700f91c0000143f010071e803931af30740f91f05007121020054a8030c4b094b2c8be34740b908751e53e61f41a921410091e4830291e573029102410051e0031b2a6e000094e94740b9fc03002a1d0000d0bd030191050000143cc09e521d0000d0bd03019169000034e003092ac8020094e8031faa0903088b084100911f0104f13f7d00a981ffff54e89f40b90900b0521c2b00b90a8d0011081d0011497d02336aca88521f2100716ae8a972090700b9290080520a2300b9090b00b903010054087d035309c30091ea8302914b8540f8080500f12b8500f8a1ffff54f84340b9e0031faae1031f2ae3031faae203182ab202009428c09e52fbe301911c0000d09c3301911f0008ebc1daff54e003182a9f020094e83f40b9ff5a28b8d1feff17fe57bea9f44f01a9f30303aae8031faa74d03bd58902088b084100911f0104f13f7d00a981ffff54080000d0810a00b995320091001940fd800200fd4800403928010034e9031faa4a040091a86a293848696938880000343f1d00f12905009163ffff5488008052881600b97e02009460000034e803002a11000014880240b91f490071a1010054880640b9e90701321f01096b21010054880a40b91f810071c1000054881240b9680200b928010034e0031f2a0400001408008012e0031f2a680200b9f44f41a9fe57c2a8c0035fd6a00240b9fcffff17ff4303d1080880525f800071fd7b07a9fc6f08a9fa6709a9f85f0aa9f6570ba9f44f0ca9a80000b9e301005414028052fa0307aaf80306aaf449aa72f70305aafb03022a88061f32f30304aafc03032af50301aaf903002a1f00086b800100547a0100b436809a52e003162af44f4ca9f6574ba9f85f4aa9fa6749a9fc6f48a9fd7b47a9ff430391c0035fd6e0031c2a59020094f60300aafd0301aa40028052e1031c2ae2031faa5d020094c88200aa7d0600a9680a00f996fdffb5fc0f00b9600000b4f603002ae8ffff17a80240f9fc0301aa680000b41f011deb41fcff5400e4006ffd0f40b9a20640f9e0030191ff3300f9e1031d2ae00302ad4e020094f60300aa3f03146b600e00f941030054e00742ad090d8052e86340b980018052e1031d2ae2031faa600601ad682200f9e90200b93a020094612600f9a0018052e1031d2ae2031faa35020094612a00f9e0031d2a010082528e010094602e00f9c0ff8f12010082528a010094603200f9beffff17a80240f9080400b4f60300b56802805236809a52e849aa723f03086bcc03005428028052e849aa723f03086bc00b005448028052e849aa723f03086b8017005468028052e849aa723f03086b41f5ff54a28640a936809a522800022a1f2d40f2a1f4ff54a80e40f91f0540f141f4ff54e00f40b90300825223020094f603002a9dffff17df0200f128809a52d612881a99ffff1788028052e849aa723f03086b400d0054c8028052e849aa723f03086b00190054a8028052e849aa723f03086ba1f1ff540880e0d29f0308eb21f1ff54b88a40a936809a524800182a1f2d40f2a1f0ff540880a092e99766b24800088b1f0109eb03f0ff54e85340b91f0d0071a1efff54e85740b968efff35e85b40b936809a52091900513f090031c3eeff54a30e40f9691800d13f0900b143eeff54490018abe2edff54ea2f44a96a010a8b3f010aeb68edff54e00f40b9e10318aa680e00f9ee010094e803002a681200f9e0f8ff3500e4006fe10f40b9e0430091e20318aaff1b00f9e08300add1010094e08740adf603002ae83340b9601600f9682a00f9080b8052608601ade80200b955ffff17b80a40f9080702d11f0102b103eaff54b90640f9342f40928802188b1f0540f168e9ff54c0ff8f120100825213010094600e00f9c0e8ffb4e10f40b922cf749203008252f50300aac0010094e803002a681200f920f4ff35e8031faaa902148b6ae200912b6968384b692838080500911f01186b83ffff54e10f40b922cf7492e00315aa0300825214e30011b1010094e803002af603002a68e202a9f40200b92cffff17b8a240a9090a80527f03017136809a52e90200b9c3e4ff541f4100f181e4ff540807409248e4ffb519277e923fc33ff1c8e3ff54e863413936809a5288e31736e85740b948e3ff35e82744a90a4300912801088b5f0108eb88e2ff54c0ff8f1201008252dc00009400e2ffb4e10f40b902cf749203008252f70300aa602600f989010094e803002a681200f940edff3500e4006fe0430091e10317aaff1b00f9e08300ad7b010094e8a74429f60300aa2a8108aa6a1600f9d6100034e10f40b902cf7492e00317aa0300825278010094e803002a1f000071682200f9d602801af3feff17b7e240a936809a520803172a1f2d40f2c1ddff54a80e40f91f0540f161ddff54e85340b91f15007101ddff54e85b40b91f0d0071a1dcff54e85740b968dcff35e82744a9ea0640912801088b5f0108eba8dbff5400e4006ff40f40b9e0430091e20318aaff1b00f9e103142ae08300ad49010094000100b5e82340b9c8000035e82741a90a0740912801088b5f0108eb690700541f0000f128809a521610881acafeff1736809a5218d9ffb4b70a40f9ff021aeba8d8ff54e80250d1080500d11f0150b123d8ff54b90640f9e80219aba2d7ff54e92b44a94901098b1f0109eb28d7ff54e85340b936809a52081500511f090031a3d6ff54e85740b968d6ff353a2f4092c0ff8f12e8021a0b14fd3f118132749277000094600e00f940d5ffb4e10f40b922cf749283327492f50300aa24010094e803002a681200f9a0e0ff35e8031faaa9021a8b2a6968380a6b283808050091ff0208eb81ffff54e10f40b922cf749283327492e00315aa17010094f603002a771a00f918000014e003142ae10318aae20317aa0300825211010094f603002ae803002a680e00f960d1ff35e00f40b9e10318aa02008252a30080520c010094e803002a681200f940010034e00f40b9e10318aae20317aa0300825202010094762240b9e803002a681600f97afeff17f6031f2a78feff173f0d007136809a5221efff5408efff35eb031f2ae9031faa2c008052e802198baa8200916c1a00f90c6969384d6969389f010d6ba1000054290500913f4100f141ffff54070000143f3d00f1290500912b0080527f1a00f981feff54020000146b00003636809a5261ffff17ea031faaa9c200912b696ab80b692ab84a1100915f4100f181ffff546a0080924a1100914b01088b2b7b0bd55f3100f183ffff549f3b03d56a0080924a1100914b01088b2b750bd55f3100f183ffff549f3b03d5df3f03d5ea031faa2b0080526b1e00f90c696a382d696a389f010d6b60000054eb031faa7f1e00f94a0500915f4100f101ffff547f0100f128809a5216019f1a3bffff17ff8302d1f44f09a9f403002af30301aa80018052e103142ae2031faafd7b04a9fc6f05a9fa6706a9f85f07a9f65708a997000094f60300aaf70301aaa0018052e103142ae2031faa91000094fa0300aaf80301aa40008052e103142ae2031faa8b000094fb0300aaf50301aa60008052e103142ae2031faa85000094fc0300aae10700f980008052e103142ae2031faa7f000094fd0300aaf90301aaa0008052e103142ae2031faa79000094e80300aae0031faab60800b59a0800b57b0800b55c0800b53d0800b5080800b5ff0200f1080082521603178b1701979aff0216eb22070054e80740f9fc0319aaf8031f2a3a001c8bdbff8f121901158b00e4006f9f021b6be0430091ff1b00f9e08300ad81000054e10317aa6900009404000014e103142ae20317aa5f000094e80300aae0031faaa80400b5e80f40f9680400b4e90b40f92801088b1f0117ebc9030054ff0219ebea02138b820000545f0115ebe90319aa08020054ff021aeb820000545f011cebe9031aaa68010054e92340b9090100355f0108ebc80000545f0116ebe00317aae90308aa8901005402000014e90308aa1ffb0371e0031faae80000543f0116eb18070011f70309aa03faff5402000014e0031faaf44f49a9f65748a9f85f47a9fa6746a9fc6f45a9fd7b44a9ff830291c0035fd6e10300aae10300d4e003002ae103012ac0035fd6210400d4c0035fd6c10200d4c0035fd6610100d4c0035fd6e30302aae20301aae10300aa010300d4e003002ae103012ac0035fd6e40303aae30302aae20301aae10300aa610800d4e003002ae103012ac0035fd6e103002a210800d4e003002ae103012ac0035fd6e103002a810400d4e003002ac0035fd6e103002aa10400d4e003002ac0035fd6c10300d4c0035fd6e30302aae203012ae103002a210500d4e003002ac0035fd6e30302aae203012ac10e00d4e003002ae103012ac0035fd6e20301aac10000d4e003002ae103012ac0035fd6810e00d4c0035fd6a10e00d4c0035fd6e10e00d4c0035fd6010f00d4c0035fd6610e00d4c0035fd6e30300aa820000b461140038420400f1c1ffff54c0035fd64d4f44301c0000001010000010100000000000000000000000000000000000000000000000000000000000000000000012000000050000001000000000000080726f3a646d6e7400736d3a00726f3a31004e5332524f4558450100000000000000";

function readU64(bytes, offset) {
    let value = 0;
    for (let i = 7; i >= 0; i--)
        value = value * 256 + Number(bytes[offset + i] || 0);
    return value;
}

function readU32(bytes, offset) {
    return (Number(bytes[offset] || 0) |
        (Number(bytes[offset + 1] || 0) << 8) |
        (Number(bytes[offset + 2] || 0) << 16) |
        (Number(bytes[offset + 3] || 0) << 24)) >>> 0;
}

async function probeNotifier(input) {
    const layout = input.domainLayout || {};
    if (!layout.table) {
        await stage("NOTIFIER: no domain table");
        return null;
    }
    try {
        let notifierRoot = input.domainSession.rootObj;
        const packet = allocPage(0x2000);
        const reply = sendDomainCmd(input.domainSession.handle,
            notifierRoot, 510, packet, null, 0);
        await stage("NOTIFIER: open ok=" + reply.ok +
            " transport=0x" + Number(reply.transport || 0).toString(16) +
            " result=0x" + Number(reply.result || 0).toString(16) +
            " objects=" + reply.objCount);
        if (!reply.ok || reply.transport !== 0 || reply.result !== 0 ||
            reply.objCount !== 1)
            return null;
        const ids = readDomainObjects(packet, reply.objCount, 0);
        if (!ids.length || !ids[0]) {
            await stage("NOTIFIER: no domain object id");
            return null;
        }
        const id = ids[0];
        if (id > 0x4000) {
            await stage("NOTIFIER: invalid id " + id);
            return null;
        }
        const entryAddress = Number(layout.table) + (id - 1) * 0x30;
        const entry = await input.readFsMemory(entryAddress, 0x30,
            "autoloader notifier domain entry");
        const domain = readU64(entry, 0x18);
        const object = readU64(entry, 0x20);
        const metadata = readU64(entry, 0x28);
        const header = await input.readFsMemory(object, 0x18,
            "autoloader notifier object");
        const vptr = readU64(header, 0);
        const backend = readU64(header, 8);
        const back = await input.readFsMemory(backend, 0x48,
            "autoloader notifier backend");
        const handle = readU32(back, 0x24);
        const write = readU32(back, 0x28);
        await stage("NOTIFIER: id=" + id +
            " entry=0x" + entryAddress.toString(16) +
            " domain=0x" + domain.toString(16) +
            " object=0x" + object.toString(16) +
            " metadata=0x" + metadata.toString(16) +
            " vptr=0x" + vptr.toString(16) +
            " backend=0x" + backend.toString(16) +
            " handle=0x" + handle.toString(16));
        return {id, entryAddress, domain, object, metadata, vptr, backend,
            handle, write};
    } catch (error) {
        await stage("NOTIFIER: failed: " +
            (error && error.message ? error.message : error));
        return null;
    }
}

const RO_TITLE = 0x0400000000000037n;

function openCodeFilesystem(input) {
    const packet = allocPage(0x2000);
    const reply = sendDomainCmd(input.domainSession.handle,
        input.domainSession.rootObj, 0, packet, function () {
            write8(packet + 0x30n, 1n);       /* attributes */
            write8(packet + 0x31n, 3n);       /* storage: content */
            write64(packet + 0x38n, RO_TITLE);
        }, 16);
    if (!reply.ok || reply.transport !== 0 || reply.result !== 0 ||
        reply.objCount !== 1)
        throw new Error("OpenCodeFileSystem failed: transport=" +
            Number(reply.transport || 0).toString(16) + " result=" +
            Number(reply.result || 0).toString(16) + " objects=" +
            reply.objCount);
    const objects = readDomainObjects(packet, reply.objCount, 0);
    if (!objects.length || !objects[0])
        throw new Error("OpenCodeFileSystem returned no object");
    const handle = cloneObject(input.domainSession.handle, objects[0]);
    if (!handle) throw new Error("Could not clone CodeFS object");
    return handle;
}

function simpleCmd(handle, command) {
    const packet = allocPage(0x2000);
    prepPacket(packet, 4, 8, [[16, 0x49434653], [24, command]]);
    sendIPC(handle, packet);
    return {packet, reply: cmifReply(packet)};
}

function ipcDeleteFile(fs, path) {
    const pathBuf = allocPage(0x1000);
    writeStr(pathBuf, path);
    const packet = allocPage(0x2000);
    prepPacket(packet, (4 | (1 << 16)) >>> 0, 8, []);
    writeXDesc(packet, 8, pathBuf, path.length + 1);
    write32(packet + 0x10n, 0x49434653n);
    write32(packet + 0x18n, 1n);
    sendIPC(fs, packet);
    return cmifReply(packet).result;
}

function ipcFileWrite(file, offset, part) {
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

function ipcFileRead(file, offset, size) {
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

function readFileAll(fs, path) {
    const file = ipcOpenFile(fs, path, 1);
    if (!file) throw new Error("OpenFile " + path + " failed");
    try {
        const cmd = simpleCmd(file, 4);
        if (cmd.reply.result) throw new Error("GetSize " + path + " result=0x" +
            Number(cmd.reply.result).toString(16));
        const size = Number(read64(cmd.packet + BigInt(cmd.reply.data)));
        const bytes = [];
        for (let off = 0; off < size; off += 0x8000) {
            const part = ipcFileRead(file, off, Math.min(0x8000, size - off));
            for (const b of part) bytes.push(b);
        }
        return {size, bytes};
    } finally {
        closeHandle(file);
    }
}

function writeFileAll(fs, path, bytes, options = {}) {
    if (ipcGetEntryType(fs, path).error === 0) {
        const existing = readFileAll(fs, path);
        if (existing.size !== bytes.length && options.replace !== true)
            throw new Error("existing " + path + " size " + existing.size +
                " differs from " + bytes.length);
        const removed = ipcDeleteFile(fs, path);
        if (removed !== 0) throw new Error("DeleteFile " + path + " failed: 0x" +
            removed.toString(16));
        const commit = ipcCommit(fs);
        if (commit !== 0) throw new Error("Commit after delete failed: 0x" +
            commit.toString(16));
    }
    const created = ipcCreateFile(fs, path, bytes.length);
    if (created !== 0) throw new Error("CreateFile " + path + " failed: 0x" +
        created.toString(16));
    const file = ipcOpenFile(fs, path, 3);
    if (!file) throw new Error("OpenFile(write) " + path + " failed");
    try {
        for (let off = 0; off < bytes.length; off += 0x8000) {
            const part = bytes.slice(off, off + 0x8000);
            const result = ipcFileWrite(file, off, part);
            if (result !== 0) throw new Error("Write " + path + " @" + off +
                " failed: 0x" + result.toString(16));
        }
    } finally {
        closeHandle(file);
    }
    const commit = ipcCommit(fs);
    if (commit !== 0) throw new Error("Commit " + path + " failed: 0x" +
        commit.toString(16));
    const back = readFileAll(fs, path);
    if (back.size !== bytes.length) throw new Error("readback size mismatch");
    for (let i = 0; i < bytes.length; i++)
        if (back.bytes[i] !== bytes[i])
            throw new Error("readback differs at " + i);
}

function pmShellPacket(handle, cmd, inputBytes) {
    const packet = allocPage(0x2000);
    const words = inputBytes.length ? 12 + Math.ceil(inputBytes.length / 4) : 8;
    prepPacket(packet, 4, words, [[16, 0x49434653], [24, cmd]]);
    for (let i = 0; i < inputBytes.length; i++)
        write8(packet + 0x20n + BigInt(i), BigInt(inputBytes[i]));
    const transport = Number(sendIPC(handle, packet)) >>> 0;
    const reply = cmifReply(packet);
    const data = [];
    for (let i = 0; i < 0x20; i++)
        data.push(Number(read8(packet + BigInt(reply.data + i))));
    return {transport, result: reply.result, moves: reply.moves,
        copies: reply.copies, data: bytesToHex(data)};
}

async function readRingInfo(limit = 8) {
    const sdk = sdkBase();
    const manager = Number(read64(sdk + 0xb22280n));
    const sentinel = manager + 0xf8;
    let node = Number(read64(BigInt(sentinel)));
    const nodes = [];
    for (let i = 0; node && node !== sentinel && i < limit; i++) {
        const state = Number(read8(BigInt(node + 0x40)));
        const size = Number(read64(BigInt(node + 0x58)));
        const argument = Number(read64(BigInt(node + 0x60)));
        const entry = Number(read64(BigInt(node + 0x68)));
        const handle = Number(read32(BigInt(node + 0x1b0))) >>> 0;
        const id = Number(read64(BigInt(node + 0x1b8))) >>> 0;
        nodes.push({node, state, size, argument, entry, handle, id});
        node = Number(read64(BigInt(node)));
    }
    return {manager, sentinel, nodes};
}

async function readSlotChunk(input, index) {
    const layout = input.domainLayout || {};
    const manager = Number(layout.manager || 0);
    const rootVptr = Number(layout.rootVptr || 0);
    if (!manager || !rootVptr) throw new Error("missing domain layout");
    const holderVptr = rootVptr - 0x7d78;
    const slots = manager + 0xd48 + index * 0x1000;
    const bytes = await input.readFsMemory(slots, 0x1000,
        "slot chunk " + index);
    const rows = [];
    for (let i = 0; i + 0x88 <= bytes.length; i += 0x88) {
        if (readU64(bytes, i) !== holderVptr) continue;
        rows.push({address: slots + i, domain: readU64(bytes, i + 0x70),
            parent: readU64(bytes, i + 0x28), wait: readU32(bytes, i + 0x30),
            tag: readU64(bytes, i + 0x38), state: readU32(bytes, i + 0x40),
            receiveResult: readU32(bytes, i + 0x44), receive: readU32(bytes, i + 0x48),
            request: readU64(bytes, i + 0x60), capacity: readU64(bytes, i + 0x68),
            metadata: readU64(bytes, i + 0x78)});
    }
    return {slots, rows};
}

function u32Array(value) {
    value = Number(value) >>> 0;
    return [value & 0xff, (value >>> 8) & 0xff,
        (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function u64Array(value) {
    let v = BigInt(value);
    const bytes = [];
    for (let i = 0; i < 8; i++) { bytes.push(Number(v & 0xffn)); v >>= 8n; }
    return bytes;
}

// svcCancelSynchronization; the FS SDK keeps it 8 bytes after svcWaitSynchronization.
function cancelThread(handle) {
    return Number(call_rop(sdkBase() + 0x168c0cn, BigInt(handle))) >>> 0;
}

function cu8(address) {
    return Number(read8(BigInt(address))) & 0xff;
}

function cu32(address) {
    return Number(read32(BigInt(address))) >>> 0;
}

function cu64(address) {
    return Number(read64(BigInt(address)));
}

function cw32(address, value) {
    write32(BigInt(address), BigInt(value >>> 0));
}

function cw64(address, value) {
    write64(BigInt(address), BigInt(value));
}

function readCoreBytes(address, length) {
    const bytes = [];
    for (let i = 0; i < length; i++) bytes.push(cu8(address + i));
    return bytes;
}

function parseRowBytes(bytes) {
    return {parent: readU64(bytes, 0x28), wait: readU32(bytes, 0x30),
        state: readU32(bytes, 0x40), receive: readU32(bytes, 0x48),
        request: readU64(bytes, 0x60), capacity: readU64(bytes, 0x68)};
}

function nativeScheduling() {
    if (!globalThis.__NATIVE_SCHED) {
        const scheduling = borrowThreadScheduling();
        if (!scheduling) throw new Error("no native thread scheduling");
        globalThis.__NATIVE_SCHED = scheduling;
    }
    return globalThis.__NATIVE_SCHED;
}

function runNativeCall(fn, args) {
    const scheduling = nativeScheduling();
    const frame = buildRawFrame([{fn, args}]);
    const worker = launchRawWorker(frame.frame, scheduling);
    if (worker.rc !== 0) throw new Error("native worker failed 0x" +
        worker.rc.toString(16));
    let exited = 0xea01;
    for (let i = 0; i < 200; i++) {
        exited = waitRawThread(worker.handle, 50000000n);
        if (exited === 0) break;
    }
    closeRawThread(worker.handle);
    if (exited !== 0) throw new Error("native worker did not exit 0x" +
        Number(exited).toString(16));
}

function nativeCopy(address, length) {
    const dst = Number(allocPage(length + 0x1000));
    runNativeCall(GADGET_MEMCPY, [BigInt(dst), BigInt(address),
        BigInt(length), 0n]);
    return readCoreBytes(dst, length);
}

function nativeWrite(address, bytes) {
    const src = Number(allocPage(bytes.length + 0x1000));
    for (let i = 0; i < bytes.length; i++)
        write8(BigInt(src + i), BigInt(bytes[i]));
    runNativeCall(GADGET_MEMCPY, [BigInt(address), BigInt(src),
        BigInt(bytes.length), 0n]);
}

function signalEvent(handle) {
    return Number(call_rop(sdkBase() + 0x168bacn, BigInt(handle))) >>> 0;
}

function clearEvent(handle) {
    return Number(call_rop(sdkBase() + 0x168bb4n, BigInt(handle))) >>> 0;
}

function waitEventZero(handle) {
    return Number(waitRawThread(handle, 1n)) >>> 0;
}

async function readGateInfo(input) {
    const layout = input.domainLayout || {};
    const manager = Number(layout.manager || 0);
    const table = Number(layout.table || 0);
    const rootVptr = Number(layout.rootVptr || 0);
    if (!manager || !table || !rootVptr) throw new Error("missing domain layout");
    const holderVptr = rootVptr - 0x7d78;
    const target = await findLoaderRoot(input);
    const targetDomain = readU64(target.entryBytes, 0x18);
    const slots = manager + 0xd48;
    const bytes = await input.readFsMemory(slots, 0x1000, "gate chunk 0");
    let row = null;
    for (let i = 0; i + 0x88 <= bytes.length; i += 0x88) {
        if (readU64(bytes, i) !== holderVptr) continue;
        if (readU64(bytes, i + 0x70) !== targetDomain) continue;
        row = {address: slots + i, vptr: readU64(bytes, i),
            domain: targetDomain,
            parent: readU64(bytes, i + 0x28), wait: readU32(bytes, i + 0x30),
            tag: readU64(bytes, i + 0x38), state: readU32(bytes, i + 0x40),
            receiveResult: readU32(bytes, i + 0x44), receive: readU32(bytes, i + 0x48),
            request: readU64(bytes, i + 0x60), capacity: readU64(bytes, i + 0x68),
            metadata: readU64(bytes, i + 0x78)};
        break;
    }
    if (!row) throw new Error("loader row not found in chunk 0");
    const waiters = [];
    for (let i = 0; i < 7; i++) waiters.push(manager + 0x410 + i * 0x110);
    const ring = await readRingInfo(64);
    const groups = new Map();
    for (const node of ring.nodes) {
        if (node.state !== 3) continue;
        const key = node.entry + ":" + node.size;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(node);
    }
    let pool = null;
    for (const group of groups.values()) {
        if (group.length >= 2 && group.every(n => n.size === 0xc8000) &&
            group.some(n => n.argument === 0)) pool = group;
    }
    if (!pool) {
        for (const group of groups.values()) {
            if (group.length >= 2 && group.every(n => n.size === 0xc8000))
                pool = group;
        }
    }
    if (!pool) throw new Error("ipc worker pool not found");
    pool.sort((a, b) => a.argument - b.argument);
    // kaiHEN's LoaderGate cancels the seven FS API worker threads to rebuild
    // the kernel wait array. Those threads belong to the FS process, so they
    // must be read from FS memory (layout.captureStart + 0x500000 + 0x830),
    // not from this process's own thread ring. Their kernel handles are FS
    // handles and have to be exported before the bootstrap can cancel them.
    const sdkFs = Number(layout.captureStart || 0) + 0x500000;
    let fsWorkers = null;
    if (sdkFs > 0x500000) {
        const sentinel = sdkFs + 0x830;
        const head = await input.readFsMemory(sentinel, 8, "fs thread ring head");
        let at = readU64(head, 0);
        const nodes = [];
        const seen = new Set();
        for (let i = 0; at && at !== sentinel && i < 64 && !seen.has(at); i++) {
            seen.add(at);
            const b = await input.readFsMemory(at, 0x1c0, "fs thread node " + i);
            nodes.push({address: at, state: b[0x40], size: readU64(b, 0x58),
                argument: readU64(b, 0x60), entry: readU64(b, 0x68),
                handle: readU32(b, 0x1b0), id: readU64(b, 0x1b8)});
            at = readU64(b, 0);
        }
        const byEntry = new Map();
        for (const node of nodes) {
            if (node.state !== 3 || node.size !== 0xc000 || node.argument !== 0)
                continue;
            const key = String(node.entry);
            if (!byEntry.has(key)) byEntry.set(key, []);
            byEntry.get(key).push(node);
        }
        for (const group of byEntry.values())
            if (group.length === 7) fsWorkers = group;
    }
    return {row, manager, table, rootVptr, targetDomain, waiters, pool,
        fsWorkers, ringSizes: ring.nodes.map(n => n.state + ":" +
            n.size.toString(16) + ":" + n.argument + ":" + n.entry.toString(16)),
        targetEntry: target.entry, targetObject: readU64(target.entryBytes, 0x20),
        targetId: Math.floor((target.entry - table) / 0x30) + 1};
}

async function findGateOwner(input, gate) {
    const ring = await readRingInfo(64);
    const targets = new Set([gate.row.parent, gate.row.address,
        gate.manager, gate.manager + 0x410]);
    for (let i = 0; i < 7; i++) targets.add(gate.waiters[i]);
    const hits = [];
    for (const node of ring.nodes) {
        if (node.state !== 3 && node.state !== 4) continue;
        for (let off = 0x40; off < 0x1c0; off += 8) {
            const value = cu64(node.node + off);
            if (value && targets.has(value))
                hits.push({node, offset: off, value});
        }
    }
    return hits;
}

async function gatePark(input) {
    const gate = await readGateInfo(input);
    const row = gate.row;
    if (row.state !== 1 || !gate.waiters.includes(row.parent))
        throw new Error("row is not idle on a known waiter");
    if (row.wait !== row.receive || row.tag !== 1 || row.capacity !== 0x100)
        throw new Error("row shape differs");
    const owners = await findGateOwner(input, gate);
    const owner = owners.length ? owners[0].node : gate.pool[0];
    await stage("PARK: row=0x" + row.address.toString(16) +
        " parent=0x" + row.parent.toString(16) +
        " owners=" + owners.map(o => "0x" + o.node.handle.toString(16) +
            "@0x" + o.offset.toString(16)).join(","));
    const originalWait = row.wait;
    await stage("PARK: writing park=0x" + owner.handle.toString(16));
    await input.writeFsMemoryUnverified(row.address + 0x30,
        u32Array(owner.handle), "gate park");
    await stage("PARK: written; cancelling owner");
    cancelThread(owner.handle);
    await stage("PARK: cancelled; polling");
    let armed = false;
    for (let i = 0; i < 100; i++) {
        const b = await input.readFsMemory(row.address, 0x88, "gate park poll");
        if (readU32(b, 0x40) === 1 &&
            gate.waiters.includes(readU64(b, 0x28))) { armed = true; break; }
        await waitMs(10);
    }
    if (!armed) {
        try {
            await input.writeFsMemoryUnverified(row.address + 0x30,
                u32Array(originalWait), "gate park rollback");
            cancelThread(owner.handle);
            await waitMs(10);
        } catch (error) { /* best effort */ }
        throw new Error("gate did not re-arm");
    }
    globalThis.__GATE = {gate, originalWait, ownerHandle: owner.handle};
    return gate;
}

async function gateUnpark(input) {
    const state = globalThis.__GATE;
    if (!state) return {parked: false};
    const {gate, originalWait} = state;
    await input.writeFsMemoryUnverified(gate.row.address + 0x30,
        u32Array(originalWait), "gate unpark");
    if (state.ownerHandle) cancelThread(state.ownerHandle);
    delete globalThis.__GATE;
    return {parked: false, wait: originalWait};
}

async function gateStep(input, maxIterations = 80) {
    const state = globalThis.__GATE;
    if (!state) throw new Error("gate is not parked");
    const gate = state.gate, row = gate.row;
    const original = cu32(row.request);
    state.originalHeader = original;
    cw32(row.request, 0xffffffff);
    for (let i = 0; i < maxIterations; i++) {
        const b = await input.readFsMemory(row.address, 0x88, "gate row");
        const st = readU32(b, 0x40), parent = readU64(b, 0x28);
        const header = cu32(row.request);
        if (header !== 0xffffffff && st === 1 &&
            gate.waiters.includes(parent)) {
            return {hex: bytesToHex(readCoreBytes(row.request, 0x100)),
                state: st, parent};
        }
        const selected = cu64(parent + 0x10);
        if (!selected) {
            cw64(parent + 0x10, row.address);
            cancelThread(gate.pool[0].handle);
        }
        await waitMs(10);
    }
    throw new Error("gate step timeout");
}

function parseDomainRequest(hex) {
    const bytes = [];
    for (let i = 0; i + 1 < hex.length; i += 2)
        bytes.push(parseInt(hex.substring(i, i + 2), 16));
    const first = readU32(bytes, 0);
    const second = readU32(bytes, 4);
    let at = 8;
    if (second >>> 31) {
        const special = readU32(bytes, at);
        at += 4 + (special & 1 ? 8 : 0);
        at += 4 * (((special >>> 1) & 15) + ((special >>> 5) & 15));
    }
    at += ((first >>> 16) & 15) * 8;
    at += (((first >>> 20) & 15) + ((first >>> 24) & 15) +
        ((first >>> 28) & 15)) * 12;
    at = (at + 15) & ~15;
    if (at + 16 > bytes.length) return {kind: "short"};
    const type = first & 0xffff;
    if (type === 5 || type === 7)
        return {kind: "control", command: readU32(bytes, at + 8)};
    if (type !== 4 && type !== 6) return {kind: "type" + type};
    const object = readU32(bytes, at + 4);
    if (bytes[at] === 2)
        return {kind: "close", object, command: -1};
    if (bytes[at] !== 1 ||
        bytesToHex(bytes.slice(at + 16, at + 20)) !== "53464349")
        return {kind: "malformed", object, command: -1};
    const length = readU32(bytes, at + 2) & 0xffff;
    const end = Math.min(bytes.length, at + 16 + length);
    const input = bytes.slice(at + 32, end);
    return {kind: "request", object,
        command: readU32(bytes, at + 24), input,
        inputHex: bytesToHex(input)};
}

async function readGateRow(input, row, label) {
    const b = await input.readFsMemory(row.address, 0x88, label);
    return {parent: readU64(b, 0x28), wait: readU32(b, 0x30),
        state: readU32(b, 0x40), receiveResult: readU32(b, 0x44),
        receive: readU32(b, 0x48)};
}

async function readEpoch(input, parent, label) {
    return readU64(await input.readFsMemory(parent + 0x18, 8, label), 0);
}

// Port of the reference Gate.restore for a parked Loader session that uses a
// shared notifier event: restore the real wait word, signal the writable
// event, wait for the old kernel wait snapshot to retire, then clear through
// the read copy.  The reference never clears the writable handle.
async function restoreGate(input, gate, event, row, originalWait) {
    const waiters = gate.waiters;
    const session = await readGateRow(input, row, "gate restore session");
    if (session.state !== 1 || !waiters.includes(session.parent))
        throw new Error("cannot restore an unsettled gate session");
    if (session.wait !== event.handle)
        throw new Error("gate wait word is not the parked handle");
    await input.compareWriteFsMemory(row.address + 0x30,
        u32Array(event.handle), u32Array(originalWait),
        "gate wait restore");
    const epoch = await readEpoch(input, session.parent,
        "gate restore epoch");
    const signaled = signalEvent(event.write);
    if (signaled)
        throw new Error("gate restore signal failed 0x" +
            signaled.toString(16));
    let retired = false;
    for (let i = 0; i < 30; i++) {
        const current = await readGateRow(input, row, "gate restore poll");
        let changed = false;
        try {
            changed = await readEpoch(input, session.parent,
                "gate restore epoch poll") !== epoch;
        } catch (error) { /* parent may have retired */ }
        if (changed || current.state === 2 || current.state === 3 ||
            current.parent !== session.parent) {
            retired = true;
            break;
        }
        await waitMs(10);
    }
    if (!retired)
        throw new Error("gate event wake did not retire the old wait snapshot");
    const cleared = clearEvent(event.read);
    if (cleared)
        throw new Error("gate restore clear failed 0x" +
            cleared.toString(16));
    const after = await readGateRow(input, row, "gate handoff verify");
    if (after.wait !== after.receive || after.state !== 1 ||
        !waiters.includes(after.parent))
        throw new Error("gate handoff differs: wait=0x" +
            after.wait.toString(16) + " receive=0x" +
            after.receive.toString(16) + " state=" + after.state +
            " parent=0x" + after.parent.toString(16));
    await stage("HANDOFF: wait=0x" + after.wait.toString(16) +
        " receive=0x" + after.receive.toString(16) +
        " state=" + after.state + " parent=0x" +
        after.parent.toString(16) + " epochRetired=true");
    return after;
}

async function domainEntries(input, domain) {
    const table = Number(input.domainLayout.table);
    const chunk = 0x3000;
    const total = 0x4000 * 0x30;
    const rows = [];
    for (let base = 0; base < total; base += chunk) {
        const bytes = await input.readFsMemory(table + base, chunk,
            "domain table " + base.toString(16));
        for (let off = 0; off + 0x30 <= bytes.length; off += 0x30) {
            if (readU64(bytes, off + 0x18) !== domain) continue;
            const object = readU64(bytes, off + 0x20);
            if (!object) continue;
            rows.push({entry: table + base + off, object,
                metadata: readU64(bytes, off + 0x28)});
        }
    }
    return rows;
}

function domainEntriesCore(domain) {
    const sentinel = domain + 0x20;
    let at = cu64(sentinel);
    const rows = [];
    for (let i = 0; at && at !== sentinel && i < 128; i++) {
        if (cu64(at + 0x18) !== domain)
            throw new Error("domain list owner changed");
        rows.push({entry: at, object: cu64(at + 0x20), metadata: cu64(at + 0x28)});
        at = cu64(at);
    }
    return rows;
}

function domainEntriesNative(domain) {
    const sentinel = domain + 0x20;
    const head = nativeCopy(sentinel, 8);
    let at = readU64(head, 0);
    const rows = [];
    for (let i = 0; at && at !== sentinel && i < 128; i++) {
        const b = nativeCopy(at, 0x30);
        if (readU64(b, 0x18) !== domain)
            throw new Error("domain list owner changed");
        rows.push({entry: at, object: readU64(b, 0x20), metadata: readU64(b, 0x28)});
        at = readU64(b, 0);
    }
    return rows;
}

function convertToDomain(handle) {
    const packet = allocPage(0x2000);
    prepPacket(packet, 5, 8, []);
    write32(packet + 0x10n, 0x49434653n);
    write32(packet + 0x18n, 0n);
    sendIPC(handle, packet);
    const reply = cmifReply(packet);
    if (reply.result) throw new Error("ConvertToDomain result=0x" +
        Number(reply.result).toString(16));
    return Number(read32(packet + BigInt(reply.data)));
}

function roReturnCode(value) {
    const code = [0xd503245f,
        (0x52800000 | ((value & 0xffff) << 5)) >>> 0,
        (0x72a00000 | ((value >>> 16) << 5)) >>> 0,
        0xd65f03c0];
    const bytes = [];
    for (const word of code)
        bytes.push(word & 0xff, (word >>> 8) & 0xff,
            (word >>> 16) & 0xff, (word >>> 24) & 0xff);
    const words = [];
    for (let i = 0; i < 16; i += 8) {
        let value64 = 0n;
        for (let j = 7; j >= 0; j--)
            value64 = (value64 << 8n) | BigInt(bytes[i + j]);
        words.push(value64);
    }
    return words;
}

async function memoryInfo(address) {
    try {
        const info = allocPage(0x40);
        const page = allocPage(0x10);
        for (let i = 0n; i < 0x40n; i += 8n) write64(info + i, 0n);
        const rc = Number(call_rop(sdkBase() + 0x168b0cn,
            info, page, BigInt(address))) >>> 0;
        return {rc, address: read64(info, 0),
            size: read64(info, 8), type: Number(read32(info + 0x10n)),
            attributes: Number(read32(info + 0x14n)),
            permission: Number(read32(info + 0x18n)),
            ipc: Number(read32(info + 0x1cn)),
            device: Number(read32(info + 0x20n))};
    } catch (error) {
        return {rc: 0xffffffff, error: error.message};
    }
}

async function sendIpcSync(handle, packet, timeoutMs = 5000) {
    const scheduling = borrowThreadScheduling();
    if (!scheduling) throw new Error("no thread scheduling");
    const frame = buildRawFrame([{fn: BigInt(sdkBase()) + 0x168c54n,
        args: [packet, 0x1000n, BigInt(handle)]}]);
    const worker = launchRawWorker(frame.frame, scheduling);
    if (worker.rc !== 0) throw new Error("IPC worker create failed 0x" +
        worker.rc.toString(16));
    const deadline = Date.now() + timeoutMs;
    let exit = 0xea01;
    while (Date.now() < deadline) {
        exit = Number(waitRawThread(worker.handle, 1n)) >>> 0;
        if (exit === 0) break;
        await waitMs(10);
    }
    const transport = Number(read64(frame.frame + 0x800n)) >>> 0;
    closeRawThread(worker.handle);
    if (exit !== 0)
        throw new Error("IPC timeout handle=0x" + Number(handle).toString(16) +
            " transport=0x" + transport.toString(16));
    return transport;
}

async function runRoCommandSync(input, cmd, values, timeoutMs = 5000) {
    const worker = startRoCommand(input, cmd, values);
    const deadline = Date.now() + timeoutMs;
    let exit = 0xea01;
    while (Date.now() < deadline) {
        exit = Number(waitRawThread(worker, 1n)) >>> 0;
        if (exit === 0) break;
        await waitMs(10);
    }
    const state = globalThis.__RO_WORKER;
    if (exit !== 0 || !state) {
        if (state) {
            closeRawThread(state.worker.handle);
            delete globalThis.__RO_WORKER;
        }
        throw new Error("RO command 0x" + cmd.toString(16) +
            " timed out exit=0x" + exit.toString(16));
    }
    const result = Number(read32(state.packet + 0x28n)) >>> 0;
    const out = [];
    for (let i = 0; i < 13; i++)
        out.push(read64(state.packet + 0x30n + BigInt(i * 8)));
    closeRawThread(state.worker.handle);
    delete globalThis.__RO_WORKER;
    return {result, values: out};
}

function startRoCommand(input, cmd, values) {
    const service = globalThis.__AUTOLOADER_RO_SERVICE;
    const proc = globalThis.__AUTOLOADER_FS_PROC;
    if (!service) throw new Error("no ro service; run smget ro:dmnt");
    if (!proc) throw new Error("no fs process handle; run exportfs");
    if (globalThis.__RO_WORKER) throw new Error("ro worker already active");
    const raw = 8 + values.length * 2;
    const packet = allocPage(0x2000);
    prepPacket(packet, 4, 0x80000000 | raw, []);
    write32(packet + 8n, 3n);
    write64(packet + 12n, 0n);
    write32(packet + 20n, BigInt(proc));
    write32(packet + 0x20n, 0x49434653n);
    write32(packet + 0x28n, BigInt(cmd));
    for (let i = 0; i < 8; i++)
        write64(packet + 0x30n + BigInt(i * 8), 0n);
    for (let i = 0; i < values.length; i++)
        write64(packet + 0x30n + BigInt(i * 8), BigInt(values[i]));
    const scheduling = borrowThreadScheduling();
    if (!scheduling) throw new Error("no thread scheduling");
    const frame = buildRawFrame([{fn: BigInt(sdkBase()) + 0x168c54n,
        args: [packet, 0x1000n, BigInt(service)]}]);
    const worker = launchRawWorker(frame.frame, scheduling);
    if (worker.rc !== 0) throw new Error("worker create failed 0x" +
        worker.rc.toString(16));
    globalThis.__RO_WORKER = {packet, worker, cmd, frame, values};
    return worker.handle;
}

async function captureDonor(input) {
    if (globalThis.__AUTOLOADER_DONOR) return globalThis.__AUTOLOADER_DONOR;
    const root = convertToDomain(input.savedHandle);
    const entry = Number(input.domainLayout.table) + (root - 1) * 0x30;
    const bytes = await input.readFsMemory(entry, 0x30, "donor capture");
    const object = readU64(bytes, 0x20);
    const vptr = readU64(await input.readFsMemory(object, 8, "donor vptr"), 0);
    const donor = {root, entry, domain: readU64(bytes, 0x18),
        object, metadata: readU64(bytes, 0x28), vptr};
    globalThis.__AUTOLOADER_DONOR = donor;
    await stage("DONOR: captured root=" + root + " entry=0x" +
        entry.toString(16) + " object=0x" + donor.object.toString(16) +
        " metadata=0x" + donor.metadata.toString(16));
    return donor;
}

async function launchRo(input) {
    const shell = globalThis.__AUTOLOADER_PM_SHELL;
    if (!shell) throw new Error("no pm:shell handle");
    const gate = await gatePark(input);
    const state = globalThis.__GATE;
    const row = gate.row;
    const originalWait = state.originalWait;
    await stage("LAUNCH: parked row=0x" + row.address.toString(16) +
        " wait=0x" + originalWait.toString(16));
    const packet = allocPage(0x2000);
    prepPacket(packet, 4, 14, [[16, 0x49434653], [24, 0]]);
    write32(packet + 0x20n, 0x10n);
    write64(packet + 0x28n, RO_TITLE);
    write8(packet + 0x30n, 3n);
    const donor = await captureDonor(input);
    const scheduling = borrowThreadScheduling();
    if (!scheduling) throw new Error("no thread scheduling available");
    const frame = buildRawFrame([{fn: IPC_SEND_DISPATCHER,
        args: [BigInt(shell), packet, 0x1000n, 0n]}]);
    const worker = launchRawWorker(frame.frame, scheduling);
    if (worker.rc !== 0) throw new Error("worker create failed 0x" +
        worker.rc.toString(16));
    await stage("LAUNCH: worker=0x" + worker.handle.toString(16) +
        " priority=" + scheduling.priority + " core=" + scheduling.core);
    let swapped = false;
    try {
        // Native gate: retained FS IPC stalls while the PM worker is in
        // flight, so every session/request access runs through a raw thread
        // memcpy instead.  The byte buffers live in the V8 heap and are read
        // with the core primitive.
        for (let attempt = 0; attempt < 400 && !swapped; attempt++) {
            const rowNow = parseRowBytes(nativeCopy(row.address, 0x88));
            if (rowNow.state !== 1) { await waitMs(20); continue; }
            if (attempt === 0)
                nativeWrite(rowNow.request, [0xff, 0xff, 0xff, 0xff]);
            nativeWrite(rowNow.parent + 0x10, u64Array(row.address));
            cancelThread(gate.pool[0].handle);
            await waitMs(30);
            const header = readU32(nativeCopy(rowNow.request, 4), 0);
            if (header === 0xffffffff) continue;
            const req = nativeCopy(rowNow.request, 0x100);
            const parsed = parseDomainRequest(bytesToHex(req));
            await stage("LAUNCH: step " + attempt + " object=0x" +
                (parsed.object || 0).toString(16) + " cmd=" + parsed.command);
            if (!(parsed.kind === "request" && parsed.object === gate.targetId &&
                parsed.command === 0 && parsed.input && parsed.input[0] === 1 &&
                parsed.input[1] === 3 &&
                readU64(parsed.input, 8) === Number(RO_TITLE))) continue;
            let added = null;
            for (let i = 0; i < 8 && !added; i++) {
                if (i) await waitMs(100);
                const rows = domainEntriesCore(gate.targetDomain);
                added = rows.find(r => r.object !== gate.targetObject &&
                    r.metadata === donor.metadata) || null;
            }
            if (!added) throw new Error("mounted filesystem not found");
            nativeWrite(added.entry + 0x20, u64Array(donor.object));
            nativeWrite(donor.entry + 0x20, u64Array(added.object));
            swapped = true;
            await stage("LAUNCH: swapped after " + attempt + " steps code=0x" +
                added.object.toString(16) + " donor=0x" +
                donor.object.toString(16));
        }
    } finally {
        try {
            if (state.originalHeader !== undefined) {
                const header = readU32(nativeCopy(row.request, 4), 0);
                if (header === 0xffffffff)
                    nativeWrite(row.request, u32Array(state.originalHeader));
            }
            nativeWrite(row.address + 0x30, u32Array(originalWait));
            cancelThread(gate.pool[0].handle);
        } catch (error) {
            await stage("LAUNCH: restore failed: " + error.message);
        }
        delete globalThis.__GATE;
        await waitMs(20);
    }
    if (!swapped) throw new Error("launch did not reach the CodeFS mount");
    let exited = 0xea01;
    for (let i = 0; i < 400; i++) {
        exited = waitRawThread(worker.handle, 100000000n);
        if (exited === 0) break;
        await waitMs(25);
    }
    closeRawThread(worker.handle);
    const magic = bytesToHex([cu8(packet + 0x10n), cu8(packet + 0x11n),
        cu8(packet + 0x12n), cu8(packet + 0x13n)]);
    const result = cu32(packet + 0x18n);
    const pid = cu64(packet + 0x20n);
    await stage("LAUNCH: reply magic=" + magic + " result=0x" +
        result.toString(16) + " pid=" + pid + " exited=0x" +
        Number(exited).toString(16));
    return {swapped, result, pid, magic, exited};
}

function findSvcStub(imm) {
    // The SDK stub table is ordered by SVC number.  Signal/clear sit near
    // 0x168bac/0x168bb4, so wait-synchronization (0x18) is a little earlier.
    const start = 0x168000;
    const base = Number(sdkBase()) + start;
    const bytes = readCoreBytes(base, 0x2000);
    const word = (0xd4000001 + (imm << 5)) >>> 0;
    const pattern = [word & 0xff, (word >>> 8) & 0xff,
        (word >>> 16) & 0xff, (word >>> 24) & 0xff,
        0xc0, 0x03, 0x5f, 0xd6];
    for (let i = 0; i + 8 <= bytes.length; i++) {
        let match = true;
        for (let j = 0; j < 8; j++) {
            if (bytes[i + j] !== pattern[j]) { match = false; break; }
        }
        if (match) return start + i;
    }
    throw new Error("svc stub not found: 0x" + imm.toString(16));
}

function createEventPair() {
    const stub = findSvcStub(0x45);
    const out = allocPage(0x20);
    write64(out, 0n);
    write64(out + 8n, 0n);
    const rc = Number(call_rop(sdkBase() + BigInt(stub), out, out + 8n)) >>> 0;
    if (rc) throw new Error("CreateEvent result=0x" + rc.toString(16));
    return {stub, write: Number(read32(out)) >>> 0,
        read: Number(read32(out + 8n)) >>> 0};
}

async function gateParkEvent(input, event) {
    const gate = await readGateInfo(input);
    const row = gate.row;
    if (row.state !== 1 || !gate.waiters.includes(row.parent))
        throw new Error("row is not idle on a known waiter");
    if (row.wait !== row.receive || row.tag !== 1 || row.capacity !== 0x100)
        throw new Error("row shape differs");
    if (!event || !event.handle || !event.write)
        throw new Error("event handles unavailable");
    const originalWait = row.wait;
    await stage("EVENT: row=0x" + row.address.toString(16) +
        " park=0x" + event.handle.toString(16) +
        " write=0x" + event.write.toString(16));
    const parkBefore = await input.readFsMemory(row.address, 0x88,
        "event park snapshot");
    if (readU32(parkBefore, 0x30) !== row.wait)
        throw new Error("park wait word changed before parking");
    await input.compareWriteFsMemory(row.address + 0x30,
        u32Array(row.wait), u32Array(event.handle), "event park");
    cancelThread(gate.pool[0].handle);
    let armed = false;
    for (let i = 0; i < 100; i++) {
        const b = await input.readFsMemory(row.address, 0x88, "event park poll");
        if (readU32(b, 0x40) === 1 &&
            readU32(b, 0x30) === event.handle &&
            gate.waiters.includes(readU64(b, 0x28))) { armed = true; break; }
        await waitMs(10);
    }
    if (!armed) {
        try {
            await input.compareWriteFsMemory(row.address + 0x30,
                u32Array(event.handle), u32Array(originalWait),
                "event park rollback");
            cancelThread(gate.pool[0].handle);
        } catch (error) { /* best effort */ }
        throw new Error("event park did not re-arm");
    }
    globalThis.__GATE = {gate, originalWait, eventPark: true};
    return gate;
}

async function launchEvent(input) {
    const shell = globalThis.__AUTOLOADER_PM_SHELL;
    if (!shell) throw new Error("no pm:shell handle");
    const notifier = globalThis.__AUTOLOADER_CTX.notifier;
    if (!notifier.eventWrite || !notifier.eventRead)
        throw new Error("no qualified event copies");
    const event = {handle: notifier.handle, read: notifier.eventRead,
        write: notifier.eventWrite};
    await stage("EVENT: park=0x" + event.handle.toString(16) +
        " write=0x" + event.write.toString(16));
    const gate = await gateParkEvent(input, event);
    const state = globalThis.__GATE;
    const row = gate.row;
    const originalWait = state.originalWait;
    await stage("EVENT: parked row=0x" + row.address.toString(16));
    const packet = allocPage(0x2000);
    prepPacket(packet, 4, 14, [[16, 0x49434653], [24, 0]]);
    write32(packet + 0x20n, 0x10n);
    write64(packet + 0x28n, RO_TITLE);
    write8(packet + 0x30n, 3n);
    const donor = await captureDonor(input);
    const scheduling = borrowThreadScheduling();
    if (!scheduling) throw new Error("no thread scheduling available");
    const frame = buildRawFrame([{fn: IPC_SEND_DISPATCHER,
        args: [BigInt(shell), packet, 0x1000n, 0n]}]);
    const worker = launchRawWorker(frame.frame, scheduling);
    if (worker.rc !== 0) throw new Error("worker create failed 0x" +
        worker.rc.toString(16));
    await stage("EVENT: worker=0x" + worker.handle.toString(16));
    let swapped = false;
    try {
        for (let step = 0; step < 40 && !swapped; step++) {
            const workerExit = waitRawThread(worker.handle, 0);
            if (workerExit === 0) {
                await stage("EVENT: worker exited result=0x" +
                    cu32(packet + 0x18n).toString(16) + " pid=" +
                    cu64(packet + 0x20n));
                break;
            }
            const rowBefore = await input.readFsMemory(row.address, 0x88,
                "event row");
            await stage("EVENT: wake " + step +
                " state=" + readU32(rowBefore, 0x40) +
                " rr=" + readU32(rowBefore, 0x44) +
                " wait=0x" + readU32(rowBefore, 0x30).toString(16) +
                " parent=0x" + readU64(rowBefore, 0x28).toString(16));
            // Let FS process exactly one queued loader message.
            await stage("EVENT: wake " + step + " a");
            const clear1 = clearEvent(event.write);
            const signal1 = signalEvent(event.write);
            if (step === 0)
                await stage("EVENT: clear1=0x" + clear1.toString(16) +
                    " signal1=0x" + signal1.toString(16));
            call_rop(sdkBase() + 0x137100n, 100000000n);
            const clear2 = clearEvent(event.write);
            if (step === 0)
                await stage("EVENT: clear2=0x" + clear2.toString(16));
            call_rop(sdkBase() + 0x137100n, 100000000n);
            await stage("EVENT: wake " + step + " b");
            await waitMs(20);
            const rows = await domainEntries(input, gate.targetDomain);
            await stage("EVENT: wake " + step + " rows=" + rows.length);
            const added = rows.find(r => r.object !== gate.targetObject &&
                r.metadata === donor.metadata);
            if (!added) continue;
            const codeHead = await input.readFsMemory(added.object, 8, "code vptr");
            const donorHead = await input.readFsMemory(donor.object, 8, "donor vptr");
            if (readU64(codeHead, 0) !== readU64(donorHead, 0))
                throw new Error("filesystem adapter type differs");
            await input.writeFsMemoryUnverified(added.entry + 0x20,
                u64Array(donor.object), "swap code");
            await input.writeFsMemoryUnverified(donor.entry + 0x20,
                u64Array(added.object), "swap donor");
            swapped = true;
            await stage("EVENT: swapped after " + step + " wakes code=0x" +
                added.object.toString(16) + " donor=0x" +
                donor.object.toString(16));
        }
    } finally {
        try {
            await restoreGate(input, gate, event, row, originalWait);
        } finally {
            delete globalThis.__GATE;
            await waitMs(20);
        }
    }
    if (!swapped) throw new Error("event launch did not reach the CodeFS mount");
    let exited = 0xea01;
    for (let i = 0; i < 400; i++) {
        exited = waitRawThread(worker.handle, 100000000n);
        if (exited === 0) break;
        await waitMs(25);
    }
    closeRawThread(worker.handle);
    const magic = bytesToHex([cu8(packet + 0x10n), cu8(packet + 0x11n),
        cu8(packet + 0x12n), cu8(packet + 0x13n)]);
    const result = cu32(packet + 0x18n);
    const pid = cu64(packet + 0x20n);
    await stage("EVENT: reply magic=" + magic + " result=0x" +
        result.toString(16) + " pid=" + pid + " exited=0x" +
        Number(exited).toString(16));
    return {swapped, result, pid, magic, exited};
}

// Manual, one-request-at-a-time gate loop.  This mirrors the proven
// launchEvent path in the original CivSwitchFS engine: release exactly one
// queued filesystem message, sleep natively, re-park, scan, repeat.  It is
// exposed as the `launchloop` bridge command so the host can watch every
// wake and see the exact step where the console stops responding.
async function launchLoop(input, wantedMount = 2) {
    const shell = globalThis.__AUTOLOADER_PM_SHELL;
    if (!shell) throw new Error("no pm:shell handle");
    const notifier = globalThis.__AUTOLOADER_CTX.notifier;
    if (!notifier.eventWrite || !notifier.eventRead)
        throw new Error("no qualified event copies");
    const event = {handle: notifier.handle, read: notifier.eventRead,
        write: notifier.eventWrite};
    const gate = await gateParkEvent(input, event);
    const row = gate.row;
    const originalWait = globalThis.__GATE.originalWait;
    const packet = allocPage(0x2000);
    prepPacket(packet, 4, 14, [[16, 0x49434653], [24, 0]]);
    write32(packet + 0x20n, 0x10n);
    write64(packet + 0x28n, RO_TITLE);
    write8(packet + 0x30n, 3n);
    const donor = await captureDonor(input);
    const scheduling = borrowThreadScheduling();
    if (!scheduling) throw new Error("no thread scheduling available");
    const frame = buildRawFrame([{fn: IPC_SEND_DISPATCHER,
        args: [BigInt(shell), packet, 0x1000n, 0n]}]);
    const worker = launchRawWorker(frame.frame, scheduling);
    if (worker.rc !== 0) throw new Error("worker create failed 0x" +
        worker.rc.toString(16));
    globalThis.__LAUNCH = {gate, event, row, originalWait, donor, worker, packet};
    await stage("LOOP: parked row=0x" + row.address.toString(16) +
        " donor=0x" + donor.object.toString(16) +
        " worker=0x" + worker.handle.toString(16));
    let swapped = false;
    let mounts = 0;
    let codeMount = null;
    let beforeRows = null;
    try {
        for (let step = 0; step < 40 && !swapped; step++) {
            const workerExit = waitRawThread(worker.handle, 1n);
            if (workerExit === 0) {
                await stage("LOOP: worker exited result=0x" +
                    cu32(packet + 0x18n).toString(16) + " pid=" +
                    cu64(packet + 0x20n));
                break;
            }
            const rowBefore = await input.readFsMemory(row.address, 0x88,
                "loop row");
            await stage("LOOP: wake " + step +
                " state=" + readU32(rowBefore, 0x40) +
                " rr=" + readU32(rowBefore, 0x44) +
                " wait=0x" + readU32(rowBefore, 0x30).toString(16) +
                " parent=0x" + readU64(rowBefore, 0x28).toString(16));
            const reqHex = bytesToHex(await input.readFsMemory(
                row.request, 0x100, "loop request"));
            const req = parseDomainRequest(reqHex);
            const targetMount = req.kind === "request" &&
                req.object === gate.targetId && req.command === 0 &&
                req.input && req.input[0] === 1 && req.input[1] === 3 &&
                readU64(req.input, 8) === Number(RO_TITLE);
            if (req.kind === "request" || req.kind === "close")
                await stage("LOOP: req " + req.kind + " id=0x" +
                    Number(req.object).toString(16) + " cmd=" +
                    req.command + " target=" + targetMount +
                    (req.inputHex ? " in=" + req.inputHex.slice(0, 32) : ""));
            else
                await stage("LOOP: req " + req.kind);
            if (targetMount) {
                mounts++;
                beforeRows = await domainEntries(input, gate.targetDomain);
                await stage("LOOP: mount " + mounts + " before=" +
                    beforeRows.map(r => "0x" + r.object.toString(16) +
                        "@0x" + r.entry.toString(16) + "/m0x" +
                        r.metadata.toString(16)).join(","));
            }
            clearEvent(event.write);
            signalEvent(event.write);
            call_rop(sdkBase() + 0x137100n, 100000000n);
            clearEvent(event.write);
            call_rop(sdkBase() + 0x137100n, 100000000n);
            if (!targetMount) continue;
            const rows = await domainEntries(input, gate.targetDomain);
            const addedRows = rows.filter(a => !beforeRows.some(b =>
                b.entry === a.entry && b.object === a.object));
            await stage("LOOP: mount " + mounts + " after=" +
                rows.map(r => "0x" + r.object.toString(16) +
                    "@0x" + r.entry.toString(16) + "/m0x" +
                    r.metadata.toString(16)).join(",") + " added=" +
                addedRows.length + " " + addedRows.map(r =>
                    "0x" + r.object.toString(16) + "@0x" +
                    r.entry.toString(16)).join(",") +
                " donor=0x" + donor.object.toString(16) +
                " target=0x" + gate.targetObject.toString(16) +
                (codeMount ? " saved=0x" + codeMount.object.toString(16) +
                    "@0x" + codeMount.entry.toString(16) : ""));
            if (mounts !== wantedMount) {
                if (addedRows.length) codeMount = addedRows[0];
                continue;
            }
            const donorNow = await input.readFsMemory(donor.entry, 0x30,
                "donor refresh");
            donor.object = readU64(donorNow, 0x20);
            donor.metadata = readU64(donorNow, 0x28);
            await stage("LOOP: donor live object=0x" +
                donor.object.toString(16) + " metadata=0x" +
                donor.metadata.toString(16));
            let added = addedRows.find(r => r.metadata === donor.metadata &&
                r.object !== donor.object && r.object !== gate.targetObject) ||
                rows.find(r => r.metadata === donor.metadata &&
                    r.object !== donor.object &&
                    r.object !== gate.targetObject) ||
                (codeMount && rows.find(r => r.entry === codeMount.entry &&
                    r.metadata === donor.metadata &&
                    r.object !== donor.object)) ||
                addedRows[0];
            if (!added) {
                await stage("LOOP: mount " + mounts + " has no filesystem row");
                continue;
            }
            await stage("LOOP: exchange code=0x" +
                added.object.toString(16) + " entry=0x" +
                added.entry.toString(16) + " mount=" + mounts);
            const codeHead = await input.readFsMemory(added.object, 8, "code vptr");
            const donorHead = await input.readFsMemory(donor.object, 8, "donor vptr");
            if (readU64(codeHead, 0) !== readU64(donorHead, 0))
                throw new Error("filesystem adapter type differs");
            await input.writeFsMemoryUnverified(added.entry + 0x20,
                u64Array(donor.object), "swap code");
            await input.writeFsMemoryUnverified(donor.entry + 0x20,
                u64Array(added.object), "swap donor");
            swapped = true;
            await stage("LOOP: swapped after " + step + " wakes code=0x" +
                added.object.toString(16) + " donor=0x" +
                donor.object.toString(16));
        }
    } finally {
        try {
            await restoreGate(input, gate, event, row, originalWait);
        } finally {
            delete globalThis.__GATE;
            delete globalThis.__LAUNCH;
            await waitMs(20);
        }
    }
    if (!swapped) throw new Error("event launch did not reach the CodeFS mount");
    let exited = 0xea01;
    for (let i = 0; i < 400; i++) {
        exited = waitRawThread(worker.handle, 100000000n);
        if (exited === 0) break;
        await waitMs(25);
    }
    closeRawThread(worker.handle);
    const magic = bytesToHex([cu8(packet + 0x10n), cu8(packet + 0x11n),
        cu8(packet + 0x12n), cu8(packet + 0x13n)]);
    const result = cu32(packet + 0x18n);
    const pid = cu64(packet + 0x20n);
    await stage("LOOP: reply magic=" + magic + " result=0x" +
        result.toString(16) + " pid=" + pid + " exited=0x" +
        Number(exited).toString(16));
    globalThis.__AUTOLOADER_RESULT = {result, pid, magic, complete: true};
    return "OK result=0x" + result.toString(16) + " pid=" + pid +
        " magic=" + magic;
}

async function launchStart(input) {
    const shell = globalThis.__AUTOLOADER_PM_SHELL;
    if (!shell) throw new Error("no pm:shell handle");
    const notifier = globalThis.__AUTOLOADER_CTX.notifier;
    if (!notifier.eventWrite || !notifier.eventRead)
        throw new Error("no qualified event copies");
    const event = {handle: notifier.handle, read: notifier.eventRead,
        write: notifier.eventWrite};
    const gate = await gateParkEvent(input, event);
    const row = gate.row;
    const originalWait = globalThis.__GATE.originalWait;
    const packet = allocPage(0x2000);
    prepPacket(packet, 4, 14, [[16, 0x49434653], [24, 0]]);
    write32(packet + 0x20n, 0x10n);
    write64(packet + 0x28n, RO_TITLE);
    write8(packet + 0x30n, 3n);
    const donor = await captureDonor(input);
    const scheduling = borrowThreadScheduling();
    if (!scheduling) throw new Error("no thread scheduling available");
    const frame = buildRawFrame([{fn: IPC_SEND_DISPATCHER,
        args: [BigInt(shell), packet, 0x1000n, 0n]}]);
    const worker = launchRawWorker(frame.frame, scheduling);
    if (worker.rc !== 0) throw new Error("worker create failed 0x" +
        worker.rc.toString(16));
    globalThis.__LAUNCH = {gate, event, row, originalWait, donor, worker, packet};
    clearEvent(event.write);
    const sig = signalEvent(event.write);
    await stage("START: parked row=0x" + row.address.toString(16) +
        " donor=0x" + donor.object.toString(16) +
        " worker=0x" + worker.handle.toString(16) +
        " signal=0x" + sig.toString(16));
    return "OK started worker=0x" + worker.handle.toString(16) +
        " signal=0x" + sig.toString(16);
}

async function launchFinish(input) {
    const L = globalThis.__LAUNCH;
    if (!L) throw new Error("no launch in progress");
    clearEvent(L.event.write);
    const launchMagic = cu32(L.packet + 0x10n);
    const launchResult = cu32(L.packet + 0x18n);
    const launchPid = cu64(L.packet + 0x20n);
    await stage("FINISH: cleared magic=0x" + launchMagic.toString(16) +
        " pmResult=0x" + launchResult.toString(16) +
        " pmPid=" + launchPid);
    if (launchMagic === 0x4F434653 && launchResult) {
        try {
            await input.writeFsMemoryUnverified(L.row.address + 0x30,
                u32Array(L.originalWait), "gate restore");
            signalEvent(L.event.write);
            clearEvent(L.event.write);
        } catch (error) { /* best effort */ }
        delete globalThis.__LAUNCH;
        delete globalThis.__GATE;
        globalThis.__AUTOLOADER_RESULT = {error: "PM launch failed",
            result: launchResult};
        throw new Error("PM launch failed 0x" + launchResult.toString(16));
    }
    const rows = await domainEntries(input, L.gate.targetDomain);
    await stage("FINISH: rows=" + rows.length + " " + rows.map(r =>
        "0x" + r.object.toString(16)).join(","));
    const added = rows.find(r => r.object !== L.gate.targetObject &&
        r.metadata === L.donor.metadata);
    if (!added) {
        await stage("FINISH: CodeFS entry not found; gate kept for retry");
        throw new Error("CodeFS entry not found; send launchfinish again");
    }
    const codeHead = await input.readFsMemory(added.object, 8, "code vptr");
    const donorHead = await input.readFsMemory(L.donor.object, 8, "donor vptr");
    if (readU64(codeHead, 0) !== readU64(donorHead, 0))
        throw new Error("filesystem adapter type differs");
    await input.writeFsMemoryUnverified(added.entry + 0x20,
        u64Array(L.donor.object), "swap code");
    await input.writeFsMemoryUnverified(L.donor.entry + 0x20,
        u64Array(added.object), "swap donor");
    await input.writeFsMemoryUnverified(L.row.address + 0x30,
        u32Array(L.originalWait), "gate restore");
    signalEvent(L.event.write);
    clearEvent(L.event.write);
    delete globalThis.__LAUNCH;
    delete globalThis.__GATE;
    await stage("FINISH: swapped code=0x" + added.object.toString(16) +
        " donor=0x" + L.donor.object.toString(16));
    let exited = 0xea01;
    for (let i = 0; i < 400; i++) {
        exited = waitRawThread(L.worker.handle, 100000000n);
        if (exited === 0) break;
        await waitMs(25);
    }
    closeRawThread(L.worker.handle);
    const magic = bytesToHex([cu8(L.packet + 0x10n), cu8(L.packet + 0x11n),
        cu8(L.packet + 0x12n), cu8(L.packet + 0x13n)]);
    const result = cu32(L.packet + 0x18n);
    const pid = cu64(L.packet + 0x20n);
    await stage("FINISH: reply magic=" + magic + " result=0x" +
        result.toString(16) + " pid=" + pid);
    globalThis.__AUTOLOADER_RESULT = {result, pid, magic, complete: true};
    return "OK result=0x" + result.toString(16) + " pid=" + pid +
        " magic=" + magic;
}

async function stageDonor(input) {
    const save = input.savedHandle;
    if (!save) throw new Error("no mounted save handle");
    const policy = parseHex(RO_POLICY_HEX);
    let payload = parseHex(RO_PAYLOAD_HEX);
    let payloadSource = "embedded proof";
    try {
        const sd = await openSdCard(input.domainSession);
        try {
            for (const path of ["/kaihen/bin/ro/main", "/kaihen/ro/main"]) {
                try {
                    const full = readFileAll(sd, path);
                    if (full.bytes.length > 0x1000) {
                        payload = full.bytes;
                        payloadSource = "sdcard " + path;
                        break;
                    }
                } catch (error) { /* try the next path */ }
            }
        } finally { closeHandle(sd); }
    } catch (error) {
        await stage("DONOR: SD RO frontend unavailable: " + error.message);
    }
    await stage("DONOR: /main source=" + payloadSource +
        " size=" + payload.length);
    await stage("DONOR: policy=" + policy.length + " payload=" + payload.length);
    const before = ipcListDirectory(save, "/", 3);
    await stage("DONOR: save entries=" + before.entries.length +
        " error=" + before.error);
    writeFileAll(save, "/main.npdm", policy, {replace: true});
    await stage("DONOR: verified /main.npdm");
    writeFileAll(save, "/main", payload, {replace: true});
    await stage("DONOR: verified /main");
    const after = ipcListDirectory(save, "/", 3);
    for (const entry of after.entries)
        if (entry.name === "main" || entry.name === "main.npdm")
            await stage("DONOR: /" + entry.name + " size=" + entry.size);
    return "OK policy=" + policy.length + " payload=" + payload.length;
}

function readFileBytes(handle, offset, size) {
    const packet = allocPage(0x2000);
    const out = allocPage(size + 0x1000);
    prepPacket(packet, (4 | (1 << 24)) >>> 0, 0x0E, []);
    write32(packet + 8n, BigInt(size));
    write32(packet + 12n, BigInt(Number(out & 0xFFFFFFFFn)));
    write32(packet + 16n, BigInt(((1 |
        (Number((out >> 36n) & 7n) << 2) |
        (Number((out >> 32n) & 15n) << 28)) >>> 0)));
    write32(packet + 0x20n, 0x49434653n);
    write32(packet + 0x28n, 0n);
    write64(packet + 0x30n, 0n);
    write64(packet + 0x38n, BigInt(offset));
    write64(packet + 0x40n, BigInt(size));
    const transport = Number(sendIPC(handle, packet)) >>> 0;
    if (transport) throw new Error("IFile read transport=0x" +
        transport.toString(16));
    const reply = cmifReply(packet);
    if (reply.result) throw new Error("IFile read result=0x" +
        Number(reply.result).toString(16));
    const count = Number(read64(packet + BigInt(reply.data)));
    if (count > size) throw new Error("IFile read count too large");
    const bytes = [];
    for (let i = 0; i < count; i++) bytes.push(Number(read8(out + BigInt(i))));
    return bytes;
}

async function findLoaderRoot(input) {
    const layout = input.domainLayout || {};
    const table = Number(layout.table || 0);
    const rootVptr = Number(layout.rootVptr || 0);
    const ownId = Number(input.domainSession.rootObj);
    if (!table || !rootVptr || !ownId) throw new Error("missing domain layout");
    const ownEntry = table + (ownId - 1) * 0x30;
    const ownEntryBytes = await input.readFsMemory(ownEntry, 0x30,
        "loader-root own entry");
    const ownObject = readU64(ownEntryBytes, 0x20);
    const ownHeader = await input.readFsMemory(ownObject, 0x40,
        "loader-root own object");
    const ownVptr = readU64(ownHeader, 0);
    const targetVptr = ownVptr + 0x1ea0;
    await stage("LOADER: own=0x" + ownObject.toString(16) +
        " ownVptr=0x" + ownVptr.toString(16) +
        " targetVptr=0x" + targetVptr.toString(16));
    let found = 0;
    const chunk = 0x3000;
    const total = 0x4000 * 0x30;
    for (let base = 0; base < total && !found; base += chunk) {
        const bytes = await input.readFsMemory(table + base, chunk,
            "loader-root table " + base.toString(16));
        for (let off = 0; off + 0x30 <= bytes.length; off += 0x30) {
            const object = readU64(bytes, off + 0x20);
            if (!object || object === ownObject) continue;
            if (object < 0x100000000 || object > 0x8000000000) continue;
            let header;
            try {
                header = await input.readFsMemory(object, 0x40,
                    "loader-root candidate 0x" + object.toString(16));
            } catch (error) { continue; }
            if (readU64(header, 0) !== targetVptr) continue;
            const pid = readU64(header, 0x30);
            const refs = readU64(header, 0x38);
            const expectedPid = Number(
                (input.identityObjects && input.identityObjects[0] &&
                 input.identityObjects[0].pid) || 0);
            if (refs !== 1) continue;
            if (pid !== 1 && (!expectedPid || pid !== expectedPid)) continue;
            if (readU64(header, 8) !== readU64(ownHeader, 8)) continue;
            const entry = table + base + off;
            found = {entry, object, header, entryBytes: bytes.slice(off, off + 0x30)};
            break;
        }
    }
    if (!found) throw new Error("Loader root entry not found");
    await stage("LOADER: target entry=0x" + found.entry.toString(16) +
        " object=0x" + found.object.toString(16) +
        " metaDiff=0x" + (readU64(found.entryBytes, 0x28) -
            readU64(ownEntryBytes, 0x28)).toString(16));
    return found;
}

async function cloneLoaderRoot(input) {
    const target = await findLoaderRoot(input);
    const table = Number(input.domainLayout.table);
    const ownId = Number(input.domainSession.rootObj);
    const ownEntry = table + (ownId - 1) * 0x30;
    const ownBytes = await input.readFsMemory(ownEntry, 0x30,
        "loader-root borrow own");
    const ownPair = ownBytes.slice(0x20, 0x30);
    const targetPair = target.entryBytes.slice(0x20, 0x30);
    if (!ownPair.some(Boolean) || !targetPair.some(Boolean))
        throw new Error("invalid domain object pair");
    let handle = 0;
    await input.compareWriteFsMemory(ownEntry + 0x20, ownPair, targetPair,
        "loader-root borrow");
    try {
        handle = cloneObject(input.domainSession.handle, ownId);
        if (!handle) throw new Error("CloneCurrentObject returned no handle");
        await stage("LOADER: cloned handle=0x" + handle.toString(16));
        try {
            const after = await input.readFsMemory(target.object, 0x40,
                "loader-root target refs");
            await stage("LOADER: target refs=0x" + readU64(after, 0x38).toString(16));
        } catch (error) {
            await stage("LOADER: refs read failed: " +
                (error && error.message ? error.message : error));
        }
        return handle;
    } finally {
        try {
            await input.compareWriteFsMemory(ownEntry + 0x20, targetPair, ownPair,
                "loader-root restore");
            await stage("LOADER: own entry restored");
        } catch (error) {
            await stage("LOADER: RESTORE FAILED: " +
                (error && error.message ? error.message : error));
        }
    }
}

function sdkBase() {
    const global = BigInt(globalThis.sdk_base || 0);
    if (global) return global;
    return BigInt(IPC_SEND_DISPATCHER) - 0x14ba90n;
}

function getTls() {
    const value = call_rop(sdkBase() + 0x13F320n);
    return BigInt(value === undefined ? 0 : value);
}

// NS2 rejects descriptor-bearing frames sent from a heap/user buffer with
// 0xF601 (SessionClosed).  The frame must live in the thread's TLS IPC
// buffer, sent with svc #0x21.  Copy in, send, copy the reply out, restore.
function tlsSendPacket(handle, packet, end) {
    const tls = getTls();
    if (!tls || tls < 0x10000n || tls > 0x8000000000n)
        throw new Error("invalid TLS pointer 0x" + tls.toString(16));
    const saved = [];
    for (let i = 0; i < 0x100; i++)
        saved.push(Number(read8(tls + BigInt(i))));
    try {
        for (let i = 0; i < 0x100; i++)
            write8(tls + BigInt(i), i < end ? read8(packet + BigInt(i)) : 0n);
        const transport = Number(call_rop(sdkBase() + 0x13F330n,
            BigInt(handle), tls, 0x100n)) >>> 0;
        for (let i = 0; i < 0x100; i++)
            write8(packet + BigInt(i), read8(tls + BigInt(i)));
        return transport;
    } finally {
        for (let i = 0; i < 0x100; i++)
            write8(tls + BigInt(i), BigInt(saved[i]));
    }
}

function tlsDiagnostic() {
    const tls = getTls();
    if (!tls || tls < 0x10000n || tls > 0x8000000000n ||
        (tls & 0xFFFn) !== 0n)
        throw new Error("implausible TLS pointer 0x" + tls.toString(16));
    const bytes = [];
    for (let i = 0; i < 0x40; i++) bytes.push(Number(read8(tls + BigInt(i))));
    return {tls, bytes: bytesToHex(bytes)};
}

async function readSdkBytes(input, offset, size) {
    return input.readFsMemory(Number(sdkBase()) + offset, size,
        "sdk " + offset.toString(16));
}

async function scanSdk(input, offset, length, patternHex) {
    const pattern = [];
    for (let i = 0; i < patternHex.length; i += 2)
        pattern.push(parseInt(patternHex.slice(i, i + 2), 16));
    const hits = [];
    const chunk = 0x10000;
    for (let base = 0; base < length && hits.length < 16; base += chunk) {
        const size = Math.min(chunk, length - base);
        let bytes;
        try {
            bytes = await readSdkBytes(input, offset + base, size);
        } catch (error) {
            break;
        }
        for (let i = 0; i + pattern.length <= bytes.length && hits.length < 16; i++) {
            let match = true;
            for (let j = 0; j < pattern.length; j++) {
                if (Number(bytes[i + j] || 0) !== pattern[j]) { match = false; break; }
            }
            if (!match) continue;
            const context = [];
            for (let j = 0; j < 16 && i + j < bytes.length; j++)
                context.push(Number(bytes[i + j] || 0));
            hits.push({offset: offset + base + i,
                address: Number(sdkBase()) + offset + base + i,
                hex: bytesToHex(context)});
        }
    }
    return hits;
}

function codeFsProbeTls(loaderHandle, word1, version) {
    const packet = allocPage(0x2000);
    const infoSize = 0x1a4;
    const output = allocPage(infoSize + 0x1000);
    prepPacket(packet, (4 | (1 << 24)) >>> 0, word1, []);
    write32(packet + 8n, BigInt(infoSize));
    write32(packet + 12n, BigInt(Number(output & 0xFFFFFFFFn)));
    write32(packet + 16n, BigInt(((1 |
        (Number((output >> 36n) & 7n) << 2) |
        (Number((output >> 32n) & 15n) << 28)) >>> 0)));
    write32(packet + 0x20n, 0x49434653n);
    write32(packet + 0x24n, BigInt(version));
    write32(packet + 0x28n, 0n);             // OpenCodeFileSystem
    write8(packet + 0x30n, 1n);
    write8(packet + 0x31n, 3n);
    write64(packet + 0x38n, RO_TITLE);
    const transport = tlsSendPacket(loaderHandle, packet, 0x40);
    const reply = cmifReply(packet);
    const magic = Number(read32(packet + BigInt(reply.at))) >>> 0;
    const bytes = [];
    for (let i = 0; i < 0x60; i++) bytes.push(Number(read8(packet + BigInt(i))));
    return {tls: getTls(), transport, magic, result: reply.result,
        moves: reply.moves, copies: reply.copies, bytes: bytesToHex(bytes)};
}

function openCodeFileSystemWithLoader(loaderHandle) {
    const packet = allocPage(0x2000);
    const infoSize = 0x1a4;
    const output = allocPage(infoSize + 0x1000);
    // HIPC type 4 with one B (receive) descriptor, matching ipcStorageRead.
    prepPacket(packet, (4 | (1 << 24)) >>> 0, 0x0C, []);
    write32(packet + 8n, BigInt(infoSize));
    write32(packet + 12n, BigInt(Number(output & 0xFFFFFFFFn)));
    write32(packet + 16n, BigInt(((1 |
        (Number((output >> 36n) & 7n) << 2) |
        (Number((output >> 32n) & 15n) << 28)) >>> 0)));
    write32(packet + 0x20n, 0x49434653n);
    write32(packet + 0x24n, 1n);             // CMIF version
    write32(packet + 0x28n, 0n);
    write8(packet + 0x30n, 1n);      // attributes: meta
    write8(packet + 0x31n, 3n);      // storage: content
    write64(packet + 0x38n, RO_TITLE);
    const transport = tlsSendPacket(loaderHandle, packet, 0x40);
    const reply = cmifReply(packet);
    globalThis.__AUTOLOADER_LAST_CODEFS = {transport, reply};
    if (transport) throw new Error("loader OpenCodeFileSystem transport=0x" +
        transport.toString(16));
    const magic = Number(read32(packet + BigInt(reply.at))) >>> 0;
    if (magic !== 0x4F434653)
        throw new Error("loader OpenCodeFileSystem no SFCO (magic=0x" +
            magic.toString(16) + ")");
    if (reply.result) throw new Error("loader OpenCodeFileSystem result=0x" +
        Number(reply.result).toString(16));
    if (!reply.moves.length) throw new Error("loader OpenCodeFileSystem returned no handle");
    return reply.moves[0];
}

async function openCodeFsInDomain(input, target) {
    const table = Number(input.domainLayout.table);
    const objectId = Math.floor((target.entry - table) / 0x30) + 1;
    const packet = allocPage(0x2000);
    const out = allocPage(0x2000);
    const reply = sendDomainCmdB(input.domainSession.handle, objectId, 0,
        packet, out, 0x1a4, function (buf, base) {
            write8(buf + BigInt(base), 1n);
            write8(buf + BigInt(base + 1), 3n);
            write64(buf + BigInt(base + 8), RO_TITLE);
        }, 16);
    await stage("LOADER: direct id=" + objectId + " ok=" + reply.ok +
        " transport=0x" + Number(reply.transport).toString(16) +
        " result=0x" + Number(reply.result).toString(16) +
        " objects=" + reply.objCount);
    if (!reply.ok || reply.result || !reply.objCount)
        throw new Error("direct OpenCodeFileSystem transport=0x" +
            Number(reply.transport).toString(16) + " result=0x" +
            Number(reply.result).toString(16) + " objects=" + reply.objCount);
    const objects = readDomainObjects(packet, reply.objCount, 0);
    if (!objects.length || !objects[0])
        throw new Error("direct OpenCodeFileSystem returned no object");
    const handle = cloneObject(input.domainSession.handle, objects[0]);
    if (!handle) throw new Error("direct CodeFS clone failed");
    await stage("LOADER: direct fs handle=0x" + handle.toString(16));
    return handle;
}

function openCodeFsOnLoaderDomain(loaderHandle) {
    const packet = allocPage(0x2000);
    const out = allocPage(0x2000);
    const reply = sendDomainCmdB(loaderHandle, 1, 0, packet, out, 0x1a4,
        function (buf, base) {
            write8(buf + BigInt(base), 1n);
            write8(buf + BigInt(base + 1), 3n);
            write64(buf + BigInt(base + 8), RO_TITLE);
        }, 16);
    if (!reply.ok || reply.result || !reply.objCount)
        throw new Error("loader-domain OpenCodeFileSystem transport=0x" +
            Number(reply.transport).toString(16) + " result=0x" +
            Number(reply.result).toString(16) + " objects=" + reply.objCount);
    const objects = readDomainObjects(packet, reply.objCount, 0);
    if (!objects.length || !objects[0])
        throw new Error("loader-domain OpenCodeFileSystem returned no object");
    return objects[0];
}

function probeLoaderSession(handle) {    const packet = allocPage(0x2000);
    prepPacket(packet, 4, 0x0C, []);
    write32(packet + 0x10n, 0x49434653n);
    write32(packet + 0x18n, 1n);   // fsp-ldr IsArchivedProgram
    write64(packet + 0x20n, 0n);
    const transport = Number(sendIPC(handle, packet)) >>> 0;
    const reply = cmifReply(packet);
    const magic = Number(read32(packet + BigInt(reply.at))) >>> 0;
    const bytes = [];
    for (let i = 0; i < 0x60; i++) bytes.push(Number(read8(packet + BigInt(i))));
    return {transport, magic, result: reply.result,
        moves: reply.moves, copies: reply.copies,
        bytes: bytesToHex(bytes)};
}

function codeInfo(input) {
    const loader = globalThis.__AUTOLOADER_LOADER;
    let fs = globalThis.__AUTOLOADER_CODEFS;
    const owned = !fs;
    if (!fs) {
        if (!loader) throw new Error("no loader handle; run loader first");
        fs = openCodeFileSystemWithLoader(loader);
    }
    try {
        const file = ipcOpenFile(fs, "/main.npdm", 1);
        if (!file) throw new Error("open /main.npdm failed");
        try {
            const cmd = simpleCmd(file, 4);
            if (cmd.reply.result) throw new Error("main.npdm size result=0x" +
                Number(cmd.reply.result).toString(16));
            const size = Number(read64(cmd.packet + BigInt(cmd.reply.data)));
            const bytes = readFileBytes(file, 0, Math.min(size, 32));
            return {title: RO_TITLE.toString(16), size,
                head: bytesToHex(bytes)};
        } finally {
            closeHandle(file);
        }
    } finally {
        if (owned) closeHandle(fs);
    }
}

function u32Bytes(value) {
    return [value & 0xff, (value >>> 8) & 0xff,
        (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

async function exportSmHandle(input, notifier, targetHandle) {
    if (!notifier || !targetHandle) {
        await stage("EXPORT: notifier or SM handle missing");
        return null;
    }
    const field = notifier.backend + 0x24;
    const before = u32Bytes(notifier.handle);
    const after = u32Bytes(targetHandle);
    let handle = 0;
    try {
        handle = cloneObject(input.domainSession.handle, notifier.id);
        if (!handle) throw new Error("could not clone notifier object");
        await input.compareWriteFsMemory(field, before, after,
            "autoloader SM handle swap");
        const reply = ipcSimpleCmd(handle, 0);
        await stage("EXPORT: GetEventHandle result=0x" +
            Number(reply.result || 0).toString(16) +
            " copies=" + (reply.copies || []).length +
            " moves=" + (reply.moves || []).length);
        const copy = (reply.copies && reply.copies[0]) ||
            (reply.moves && reply.moves[0]);
        if (!copy) throw new Error("GetEventHandle returned no copied handle");
        await stage("EXPORT: FS SM handle=0x" + targetHandle.toString(16) +
            " exported=0x" + Number(copy).toString(16));
        return {handle: Number(copy), notifierHandle: handle,
            field, original: notifier.handle};
    } finally {
        try {
            await input.compareWriteFsMemory(field, after, before,
                "autoloader SM handle restore");
            await stage("EXPORT: notifier handle field restored");
        } catch (error) {
            await stage("EXPORT: RESTORE FAILED: " +
                (error && error.message ? error.message : error));
        }
        if (handle) closeHandle(handle);
    }
}

async function probeFsSm(input) {
    const layout = input.domainLayout || {};
    const rootVptr = Number(layout.rootVptr || 0);
    const captureStart = Number(layout.captureStart || 0);
    const sdkFromCapture = captureStart ? captureStart + 0x500000 : 0;
    const sdkFromRoot = rootVptr ? rootVptr + CIV7_SDK_FROM_ROOT_VPTR : 0;
    await stage("FS SM: capture=0x" + captureStart.toString(16) +
        " sdkCapture=0x" + sdkFromCapture.toString(16) +
        " sdkRoot=0x" + sdkFromRoot.toString(16));
    if (!sdkFromCapture || !Number.isSafeInteger(sdkFromCapture) ||
        sdkFromCapture % 0x1000 !== 0) {
        await stage("FS SM: no valid capture-derived SDK base");
        return null;
    }
    const sdk = sdkFromCapture;
    if (sdkFromRoot && sdkFromRoot !== sdkFromCapture) {
        await stage("FS SM: root-derived base differs by 0x" +
            Math.abs(sdkFromRoot - sdkFromCapture).toString(16) +
            "; using capture-derived base");
    }
    const address = sdk + CIV7_SM_SERVICE_OFFSET;
    // Keep the first run read-only at the layout level. The previous attempt
    // read a candidate that was not proven mapped and wedged the console.
    // Enable this after the capture/root bases are confirmed on hardware.
    const ENABLE_FS_SM_READ = true;
    if (!ENABLE_FS_SM_READ) {
        await stage("FS SM: layout only; read deferred");
        return {sdk, address};
    }
    try {
        const bytes = await input.readFsMemory(address - 4, 16,
            "autoloader FS SM candidate");
        const handle = (Number(bytes[4]) | (Number(bytes[5]) << 8) |
            (Number(bytes[6]) << 16) | (Number(bytes[7]) << 24)) >>> 0;
        const guard = Number(bytes[8]) | (Number(bytes[9]) << 8) |
            (Number(bytes[10]) << 16) | (Number(bytes[11]) << 24);
        const flags = Number(bytes[12]) | (Number(bytes[13]) << 8);
        await stage("FS SM: sdk=0x" + sdk.toString(16) +
            " addr=0x" + address.toString(16) +
            " handle=0x" + handle.toString(16) +
            " guard=0x" + (guard >>> 0).toString(16) +
            " flags=0x" + flags.toString(16));
        return {sdk, address, handle, guard, flags};
    } catch (error) {
        await stage("FS SM: read failed: " +
            (error && error.message ? error.message : error));
        return null;
    }
}

async function openSdCard(domainSession) {
    const packet = allocPage(0x2000);
    const reply = sendDomainCmd(domainSession.handle, domainSession.rootObj,
        OPEN_SD_CARD_FILESYSTEM, packet, null, 0);
    if (!reply.ok || reply.transport !== 0 || reply.result !== 0 ||
        reply.objCount !== 1)
        throw new Error("OpenSdCardFileSystem failed: transport=" +
            Number(reply.transport || 0).toString(16) + " result=" +
            Number(reply.result || 0).toString(16) +
            " objects=" + reply.objCount);
    const objects = readDomainObjects(packet, reply.objCount, 0);
    if (objects.length !== 1 || !objects[0])
        throw new Error("OpenSdCardFileSystem returned no filesystem object");
    const handle = cloneObject(domainSession.handle, objects[0]);
    if (!handle) throw new Error("Could not clone the SD filesystem object");
    return handle;
}

function ensureDir(sd, path) {
    if (ipcGetEntryType(sd, path).error === 0) return;
    const result = ipcCreateDirectory(sd, path);
    if (result !== 0) throw new Error("CreateDirectory " + path +
        " failed: 0x" + Number(result).toString(16));
}

function writeMarker(sd, path, text) {
    const bytes = text.length;
    if (ipcGetEntryType(sd, path).error !== 0) {
        const created = ipcCreateFile(sd, path, bytes);
        if (created !== 0) throw new Error("CreateFile " + path +
            " failed: 0x" + Number(created).toString(16));
    }
    const data = allocPage(0x1000), packet = allocPage(0x2000);
    writeStr(data, text);
    if (!writeDirtyData(sd, path, bytes, data, packet))
        throw new Error("WriteFile " + path + " failed");
    const commit = ipcCommit(sd);
    if (commit !== 0) throw new Error("Commit SD failed: 0x" +
        Number(commit).toString(16));
}

function hexByte(value) {
    return (value < 16 ? "0" : "") + value.toString(16);
}

function bytesToHex(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i++) out += hexByte(Number(bytes[i]));
    return out;
}

function parseHex(text) {
    if (!/^[0-9a-fA-F]*$/.test(text) || text.length % 2) return null;
    const out = [];
    for (let i = 0; i < text.length; i += 2)
        out.push(parseInt(text.slice(i, i + 2), 16));
    return out;
}

async function bridgeCommand(line, input, fsSm, notifier, extraCommands = {}) {
    const space = line.indexOf(" ");
    const verb = (space < 0 ? line : line.slice(0, space)).trim();
    const rest = space < 0 ? "" : line.slice(space + 1).trim();
    if (verb === "ping") return "pong";
    if (verb === "dev") {
        globalThis.__AUTOLOADER_DEV__ = rest.trim() === "on";
        return "OK dev=" + (globalThis.__AUTOLOADER_DEV__ ? "on" : "off");
    }
    if (!DEV_MODE()) return "ERR dev mode off; send dev on";
    if (typeof extraCommands[verb] === "function")
        return await extraCommands[verb](input, rest);
    if (verb === "read") {
        const parts = rest.split(/\s+/);
        const address = parseInt(parts[0], 16);
        const length = parseInt(parts[1] || "16", 16);
        if (!Number.isSafeInteger(address) || !Number.isInteger(length) ||
            length <= 0 || length > 0x400)
            return "ERR bad read arguments";
        return bytesToHex(readCoreBytes(address, length));
    }
    if (verb === "write") {
        const parts = rest.split(/\s+/);
        const address = parseInt(parts[0], 16);
        const bytes = parseHex(parts[1] || "");
        if (!Number.isSafeInteger(address) || !bytes || !bytes.length ||
            bytes.length > 0x400)
            return "ERR bad write arguments";
        await input.writeFsMemoryUnverified(address, bytes,
            "bridge write 0x" + address.toString(16));
        return "OK";
    }
    if (verb === "export") {
        const handle = parseInt(rest, 16);
        if (!Number.isSafeInteger(handle) || !notifier)
            return "ERR bad export arguments or no notifier";
        const result = await exportSmHandle(input, notifier, handle);
        if (!result || !result.handle) return "ERR export failed";
        globalThis.__AUTOLOADER_EXPORTED_SM = result.handle;
        return "OK exported=0x" + Number(result.handle).toString(16);
    }
    if (verb === "eval") {
        try {
            const value = await eval(rest);
            return "OK " + String(value);
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "pmshell" || verb === "pmdmnt") {
        try {
            const parts = rest.trim().split(/\s+/).filter(Boolean);
            const cmd = parseInt(parts[0], 10);
            const inputBytes = parts[1] ? parseHex(parts[1]) : [];
            if (!Number.isInteger(cmd) || cmd < 0 || !inputBytes)
                return "ERR bad command arguments";
            const handle = verb === "pmshell"
                ? globalThis.__AUTOLOADER_PM_SHELL
                : globalThis.__AUTOLOADER_PM_DMNT;
            if (!handle) return "ERR no " + verb + " handle";
            const reply = pmShellPacket(handle, cmd, inputBytes);
            await stage(verb.toUpperCase() + ": cmd=" + cmd +
                " transport=0x" + reply.transport.toString(16) +
                " result=0x" + Number(reply.result).toString(16) +
                " data=" + reply.data);
            return "OK t=0x" + reply.transport.toString(16) +
                " r=0x" + Number(reply.result).toString(16) +
                " d=" + reply.data;
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "smget") {
        try {
            const name = rest.trim();
            if (!/^[a-z0-9:-]{1,8}$/.test(name))
                return "ERR bad service name";
            if (globalThis.__SM_WORKER) return "ERR sm worker already active";
            const sm = globalThis.__AUTOLOADER_EXPORTED_SM;
            if (!sm) return "ERR no exported SM";
            const packet = allocPage(0x1000);
            for (let i = 0n; i < 0x100n; i += 8n) write64(packet + i, 0n);
            write32(packet, 0x11n);
            write32(packet + 4n, 2n);
            for (let i = 0; i < name.length; i++)
                write8(packet + 8n + BigInt(i), BigInt(name.charCodeAt(i)));
            const scheduling = borrowThreadScheduling();
            if (!scheduling) return "ERR no thread scheduling";
            const frame = buildRawFrame([{fn: IPC_SEND_DISPATCHER,
                args: [BigInt(sm), packet, 0x1000n, 0n]}]);
            const worker = launchRawWorker(frame.frame, scheduling);
            if (worker.rc !== 0) return "ERR worker create failed 0x" +
                worker.rc.toString(16);
            globalThis.__SM_WORKER = {packet, worker, name};
            await stage("SMGET: " + name + " worker=0x" +
                worker.handle.toString(16));
            return "OK worker=0x" + worker.handle.toString(16);
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "smstate") {
        try {
            const state = globalThis.__SM_WORKER;
            if (!state) return "ERR no sm worker";
            const exit = waitRawThread(state.worker.handle, 1n);
            if (exit !== 0) return "PENDING exit=0x" +
                Number(exit).toString(16);
            const first = cu32(state.packet);
            const second = cu32(state.packet + 4n);
            let at = 8;
            const copies = [], moves = [];
            if (second >>> 31) {
                const special = cu32(state.packet + BigInt(at)); at += 4;
                if (special & 1) at += 8;
                const nc = (special >>> 1) & 15;
                const nm = (special >>> 5) & 15;
                for (let i = 0; i < nc; i++) { copies.push(cu32(state.packet + BigInt(at))); at += 4; }
                for (let i = 0; i < nm; i++) { moves.push(cu32(state.packet + BigInt(at))); at += 4; }
            }
            const result = cu32(state.packet + BigInt(at));
            const handle = moves[0] || copies[0] || 0;
            if (handle) globalThis.__AUTOLOADER_RO_SERVICE = handle;
            await stage("SMGET: " + state.name + " result=0x" +
                result.toString(16) + " handle=0x" + handle.toString(16));
            closeRawThread(state.worker.handle);
            delete globalThis.__SM_WORKER;
            return "DONE result=0x" + result.toString(16) +
                " handle=0x" + handle.toString(16);
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "notifieraddr") {
        try {
            const notifier = globalThis.__AUTOLOADER_CTX &&
                globalThis.__AUTOLOADER_CTX.notifier;
            if (!notifier) return "ERR no notifier";
            const head = await input.readFsMemory(notifier.object, 8,
                "notifier vptr");
            const vptr = readU64(head, 0);
            const targetBytes = await input.readFsMemory(Number(vptr) + 0x20, 8,
                "notifier target");
            const target = readU64(targetBytes, 0);
            globalThis.__AUTOLOADER_NOTIFIER_TARGET = target;
            await stage("NOTIFIERADDR: object=0x" +
                notifier.object.toString(16) + " vptr=0x" +
                vptr.toString(16) + " target=0x" + target.toString(16));
            return "OK vptr=0x" + vptr.toString(16) +
                " target=0x" + target.toString(16);
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "fsinfo") {
        const pid = globalThis.__AUTOLOADER_FS_PID || 0;
        const target = globalThis.__AUTOLOADER_NOTIFIER_TARGET || 0n;
        return "OK pid=" + pid + " target=0x" + target.toString(16);
    }
    if (verb === "fsread") {
        try {
            const pid = globalThis.__AUTOLOADER_FS_PID;
            const target = globalThis.__AUTOLOADER_NOTIFIER_TARGET;
            if (!pid) return "ERR no fs pid; run rocmd 524f0010 then rostate";
            if (!target) return "ERR no target; run notifieraddr";
            const length = parseInt(rest.trim() || "10", 16);
            if (!Number.isInteger(length) || length <= 0 || length > 0x100)
                return "ERR bad length";
            const handle = startRoCommand(input, 0x524f0011,
                [pid, target, length, 0]);
            await stage("FSREAD: pid=" + pid + " target=0x" +
                target.toString(16) + " len=0x" + length.toString(16) +
                " worker=0x" + handle.toString(16));
            return "OK worker=0x" + handle.toString(16);
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "fspatch" || verb === "fsrestore") {
        try {
            const pid = globalThis.__AUTOLOADER_FS_PID;
            const target = globalThis.__AUTOLOADER_NOTIFIER_TARGET;
            if (!pid) return "ERR no fs pid; run rocmd 524f0010 then rostate";
            if (!target) return "ERR no target; run notifieraddr";
            const nonce = parseInt(rest.trim() || "1fe", 16);
            if (!Number.isInteger(nonce) || nonce < 0 || nonce > 0xffffffff)
                return "ERR bad nonce";
            let original = [0xd10083ffd503237fn, 0x910043fda9017bfdn];
            const captured = globalThis.__AUTOLOADER_FS_CODE;
            if (captured && captured.length >= 16) {
                original = [];
                for (let i = 0; i < 16; i += 8) {
                    let word = 0n;
                    for (let j = 7; j >= 0; j--)
                        word = (word << 8n) | BigInt(captured[i + j]);
                    original.push(word);
                }
            }
            const code = roReturnCode(nonce);
            const expected = verb === "fspatch" ? original : code;
            const replacement = verb === "fspatch" ? code : original;
            const handle = startRoCommand(input, 0x524f0014,
                [pid, target, 16, 0, ...expected, ...replacement]);
            await stage((verb === "fspatch" ? "FSPATCH" : "FSRESTORE") +
                ": pid=" + pid + " target=0x" + target.toString(16) +
                " nonce=0x" + nonce.toString(16) + " worker=0x" +
                handle.toString(16));
            return "OK worker=0x" + handle.toString(16);
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "rocmd") {
        try {
            const parts = rest.trim().split(/\s+/).filter(Boolean);
            const cmd = parseInt(parts[0], 16);
            if (!Number.isInteger(cmd)) return "ERR bad command";
            const service = globalThis.__AUTOLOADER_RO_SERVICE;
            const proc = globalThis.__AUTOLOADER_FS_PROC;
            if (!service) return "ERR no ro service; run smget ro:dmnt";
            if (!proc) return "ERR no fs process handle";
            if (globalThis.__RO_WORKER) return "ERR ro worker already active";
            const count = Math.min(parts.length - 1, 12);
            const values = [];
            for (let i = 0; i < count; i++) {
                try {
                    values.push(BigInt("0x" + parts[i + 1]));
                } catch (error) {
                    return "ERR bad value " + parts[i + 1];
                }
            }
            const raw = 8 + count * 2;
            const packet = allocPage(0x2000);
            prepPacket(packet, 4, 0x80000000 | raw, []);
            write32(packet + 8n, 3n);
            write64(packet + 12n, 0n);
            write32(packet + 20n, BigInt(proc));
            write32(packet + 0x20n, 0x49434653n);
            write32(packet + 0x28n, BigInt(cmd));
            for (let i = 0; i < 8; i++)
                write64(packet + 0x30n + BigInt(i * 8), 0n);
            for (let i = 0; i < count; i++)
                write64(packet + 0x30n + BigInt(i * 8),
                    BigInt(values[i]));
            const scheduling = borrowThreadScheduling();
            if (!scheduling) return "ERR no thread scheduling";
            // The reference Client uses the SDK send wrapper with
            // (buffer, size, handle), not the heap-buffer dispatcher.
            const frame = buildRawFrame([{fn: BigInt(sdkBase()) + 0x168c54n,
                args: [packet, 0x1000n, BigInt(service)]}]);
            const worker = launchRawWorker(frame.frame, scheduling);
            if (worker.rc !== 0) return "ERR worker create failed 0x" +
                worker.rc.toString(16);
            globalThis.__RO_WORKER = {packet, worker, cmd, frame, values};
            await stage("ROCMD: cmd=0x" + cmd.toString(16) +
                " worker=0x" + worker.handle.toString(16));
            return "OK worker=0x" + worker.handle.toString(16);
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "rostate") {
        try {
            const state = globalThis.__RO_WORKER;
            if (!state) return "ERR no ro worker";
            const exit = waitRawThread(state.worker.handle, 1n);
            if (exit !== 0) return "PENDING exit=0x" +
                Number(exit).toString(16);
            const transport = Number(read64(state.frame.frame + 0x800n));
            const magic = cu32(state.packet + 0x20n);
            const result = cu32(state.packet + 0x28n);
            const values = [];
            for (let i = 0; i < 10; i++)
                values.push(read64(state.packet + 0x30n + BigInt(i * 8)));
            let data = "";
            if (state.cmd === 0x524f0011) {
                const length = Math.min(Number(state.values[2]) || 0, 0x100);
                const bytes = [];
                for (let i = 0; i < length; i++)
                    bytes.push(Number(cu8(state.packet + 0x68n + BigInt(i))));
                data = " data=" + bytesToHex(bytes);
                if (length >= 16)
                    globalThis.__AUTOLOADER_FS_CODE = bytes.slice(0, 16);
            }
            if (state.cmd === 0x524f0010 && values.length &&
                Number(values[0]) > 0 && Number(values[0]) < 0x10000) {
                globalThis.__AUTOLOADER_FS_PID = Number(values[0]);
                data += " fsPid=" + globalThis.__AUTOLOADER_FS_PID;
            }
            await stage("ROCMD: cmd=0x" + state.cmd.toString(16) +
                " transport=0x" + transport.toString(16) +
                " magic=0x" + magic.toString(16) +
                " result=0x" + result.toString(16) +
                " values=" + values.map(v => v.toString(16)).join(",") +
                data);
            closeRawThread(state.worker.handle);
            delete globalThis.__RO_WORKER;
            return "DONE transport=0x" + transport.toString(16) +
                " magic=0x" + magic.toString(16) +
                " result=0x" + result.toString(16) + data;
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "pmstart" || verb === "pmterm") {
        try {
            const pid = parseInt(rest, 10);
            if (!Number.isInteger(pid) || pid <= 0 || pid > 0xffffffff)
                return "ERR bad pid";
            const handle = verb === "pmstart"
                ? globalThis.__AUTOLOADER_PM_DMNT
                : globalThis.__AUTOLOADER_PM_SHELL;
            if (!handle) return "ERR no " + verb + " handle";
            if (globalThis.__PM_WORKER) return "ERR pm worker already active";
            const packet = allocPage(0x2000);
            prepPacket(packet, 4, 14, [[16, 0x49434653], [24, 1]]);
            write64(packet + 0x20n, BigInt(pid));
            const scheduling = borrowThreadScheduling();
            if (!scheduling) return "ERR no thread scheduling";
            const frame = buildRawFrame([{fn: IPC_SEND_DISPATCHER,
                args: [BigInt(handle), packet, 0x1000n, 0n]}]);
            const worker = launchRawWorker(frame.frame, scheduling);
            if (worker.rc !== 0) return "ERR worker create failed 0x" +
                worker.rc.toString(16);
            globalThis.__PM_WORKER = {packet, worker, pid, verb};
            await stage("PMWORK: " + verb + " pid=" + pid +
                " worker=0x" + worker.handle.toString(16));
            return "OK worker=0x" + worker.handle.toString(16) +
                " pid=" + pid;
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "pmstate") {
        try {
            const state = globalThis.__PM_WORKER;
            if (!state) return "ERR no pm worker";
            const exit = waitRawThread(state.worker.handle, 1n);
            if (exit !== 0)
                return "PENDING exit=0x" + Number(exit).toString(16) +
                    " pid=" + state.pid;
            const reply = cmifReply(state.packet);
            const result = Number(reply.result) >>> 0;
            await stage("PMWORK: " + state.verb + " pid=" + state.pid +
                " result=0x" + result.toString(16) +
                " magic=0x" + Number(read32(state.packet +
                    BigInt(reply.at))).toString(16));
            closeRawThread(state.worker.handle);
            delete globalThis.__PM_WORKER;
            return "DONE result=0x" + result.toString(16) +
                " pid=" + state.pid;
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "pmcancel") {
        const state = globalThis.__PM_WORKER;
        if (!state) return "OK no pm worker";
        cancelThread(state.worker.handle);
        closeRawThread(state.worker.handle);
        delete globalThis.__PM_WORKER;
        await stage("PMWORK: cancelled");
        return "OK cancelled";
    }
    if (verb === "ringinfo") {
        try {
            const info = await readRingInfo();
            await stage("RING: manager=0x" + info.manager.toString(16) +
                " sentinel=0x" + info.sentinel.toString(16) +
                " nodes=" + info.nodes.length);
            for (const node of info.nodes)
                await stage("RING: node=0x" + node.node.toString(16) +
                    " state=" + node.state +
                    " size=0x" + node.size.toString(16) +
                    " arg=0x" + node.argument.toString(16) +
                    " entry=0x" + node.entry.toString(16) +
                    " handle=0x" + node.handle.toString(16) +
                    " id=0x" + node.id.toString(16));
            return "OK manager=0x" + info.manager.toString(16) +
                " nodes=" + info.nodes.length;
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "slotinfo") {
        try {
            const index = parseInt(rest.trim() || "0", 10);
            if (!Number.isInteger(index) || index < 0 || index > 15)
                return "ERR bad slot chunk";
            const info = await readSlotChunk(input, index);
            await stage("SLOT: chunk=" + index + " base=0x" +
                info.slots.toString(16) + " rows=" + info.rows.length);
            for (const row of info.rows)
                await stage("SLOT: row 0x" + row.address.toString(16) +
                    " domain=0x" + row.domain.toString(16) +
                    " parent=0x" + row.parent.toString(16) +
                    " wait=0x" + row.wait.toString(16) +
                    " recv=0x" + row.receive.toString(16) +
                    " state=" + row.state +
                    " request=0x" + row.request.toString(16) +
                    " cap=0x" + row.capacity.toString(16));
            return "OK chunk=" + index + " rows=" + info.rows.length;
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "codecore") {
        try {
            const parts = rest.trim().split(/\s+/).filter(Boolean);
            const offset = parseInt(parts[0], 16);
            const length = parseInt(parts[1] || "40", 16);
            if (!Number.isInteger(offset) || !Number.isInteger(length) ||
                length <= 0 || length > 0x100)
                return "ERR bad codecore arguments";
            const bytes = [];
            for (let i = 0; i < length; i++)
                bytes.push(Number(read8(BigInt(Number(sdkBase()) + offset + i))));
            return "OK " + bytesToHex(bytes);
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "corepeek") {
        try {
            const parts = rest.trim().split(/\s+/).filter(Boolean);
            const address = parseInt(parts[0], 16);
            const length = parseInt(parts[1] || "40", 16);
            if (!Number.isSafeInteger(address) || !Number.isInteger(length) ||
                length <= 0 || length > 0x100)
                return "ERR bad corepeek arguments";
            return "OK " + bytesToHex(readCoreBytes(address, length));
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "newevent") {
        try {
            const notifier = globalThis.__AUTOLOADER_CTX.notifier;
            if (!notifier || !notifier.eventWrite)
                return "ERR no exported event write";
            const sig = signalEvent(notifier.eventWrite);
            const clr = clearEvent(notifier.eventWrite);
            await stage("EVENTTEST: write=0x" +
                notifier.eventWrite.toString(16) +
                " sig=0x" + sig.toString(16) +
                " clear=0x" + clr.toString(16));
            return "OK sig=0x" + sig.toString(16) +
                " clear=0x" + clr.toString(16) +
                " write=0x" + notifier.eventWrite.toString(16);
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "domainlistcore") {
        try {
            const info = await readGateInfo(input);
            const rows = domainEntriesCore(info.targetDomain);
            return "OK rows=" + rows.length + " " + rows.map(r =>
                "0x" + r.object.toString(16) + "/m0x" +
                r.metadata.toString(16)).join(",");
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "domainlistnative") {
        try {
            const info = await readGateInfo(input);
            const rows = domainEntriesNative(info.targetDomain);
            return "OK rows=" + rows.length + " " + rows.map(r =>
                "0x" + r.object.toString(16) + "/m0x" +
                r.metadata.toString(16)).join(",");
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "domainscan") {
        try {
            const info = await readGateInfo(input);
            const rows = await domainEntries(input, info.targetDomain);
            await stage("DOMAIN: target=0x" + info.targetDomain.toString(16) +
                " rows=" + rows.length + " " + rows.map(r =>
                    "0x" + r.object.toString(16) + "/m0x" +
                    r.metadata.toString(16)).join(","));
            return "OK rows=" + rows.length;
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "reqpeek") {
        try {
            const info = await readGateInfo(input);
            const bytes = await input.readFsMemory(info.row.request, 0x100,
                "gate request peek");
            return "OK " + bytesToHex(bytes);
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "mountdump") {
        try {
            const info = await readGateInfo(input);
            const rows = await domainEntries(input, info.targetDomain);
            const donor = await captureDonor(input);
            const text = rows.map(r => {
                const id = Math.floor((r.entry - Number(input.domainLayout.table)) / 0x30) + 1;
                return "#" + id + " obj=0x" + r.object.toString(16) +
                    " entry=0x" + r.entry.toString(16) +
                    " meta=0x" + r.metadata.toString(16);
            }).join(" | ");
            await stage("MOUNTDUMP: target=0x" +
                info.targetDomain.toString(16) + " targetObj=0x" +
                info.targetObject.toString(16) + " donor=0x" +
                donor.object.toString(16) + " donorMeta=0x" +
                donor.metadata.toString(16) + " rows=" + rows.length +
                " " + text);
            return "OK rows=" + rows.length + " " + text;
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "launch" || verb === "launchstart") {
        try {
            return await launchStart(input);
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "launchloop" || verb === "eventlaunch") {
        try {
            const parts = rest.trim().split(/\s+/).filter(Boolean);
            const wanted = parts.length ? parseInt(parts[0], 10) : 2;
            if (!Number.isInteger(wanted) || wanted < 0 || wanted > 3)
                return "ERR mount must be 0..3";
            return await launchLoop(input, wanted);
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "launchstate") {
        try {
            const L = globalThis.__LAUNCH;
            if (!L) return "ERR no launch";
            const info = await readGateInfo(input);
            const magic = cu32(L.packet + 0x10n);
            const result = cu32(L.packet + 0x18n);
            const pid = cu64(L.packet + 0x20n);
            await stage("STATE: magic=0x" + magic.toString(16) +
                " result=0x" + result.toString(16) +
                " pid=" + pid +
                " rowState=" + info.row.state +
                " wait=0x" + info.row.wait.toString(16));
            return "OK magic=0x" + magic.toString(16) +
                " result=0x" + result.toString(16) +
                " pid=" + pid + " state=" + info.row.state;
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "launchrows") {
        try {
            const L = globalThis.__LAUNCH;
            if (!L) return "ERR no launch";
            const rows = await domainEntries(input, L.gate.targetDomain);
            await stage("ROWS: n=" + rows.length + " " + rows.map(r =>
                "0x" + r.object.toString(16) + "/0x" +
                r.metadata.toString(16)).join(","));
            return "OK rows=" + rows.length;
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "abort") {
        const L = globalThis.__LAUNCH;
        if (!L) return "OK no launch";
        try { clearEvent(L.event.write); } catch (error) {}
        try {
            await input.writeFsMemoryUnverified(L.row.address + 0x30,
                u32Array(L.originalWait), "gate abort restore");
        } catch (error) {}
        try { signalEvent(L.event.write); clearEvent(L.event.write); }
        catch (error) {}
        try { closeRawThread(L.worker.handle); } catch (error) {}
        delete globalThis.__LAUNCH;
        delete globalThis.__GATE;
        await stage("ABORT: gate restored");
        return "OK aborted";
    }
    if (verb === "launchfinish") {
        try {
            return await launchFinish(input);
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "gatepark") {
        try {
            const gate = await gatePark(input);
            await stage("GATE: parked row=0x" + gate.row.address.toString(16) +
                " wait=0x" + gate.row.wait.toString(16) +
                " park=0x" + gate.pool[0].handle.toString(16) +
                " pool=" + gate.pool.map(t => "0x" + t.handle.toString(16)).join(","));
            return "OK row=0x" + gate.row.address.toString(16) +
                " park=0x" + gate.pool[0].handle.toString(16) +
                " pool=" + gate.pool.length;
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "gateunpark") {
        try {
            const result = await gateUnpark(input);
            return "OK parked=" + result.parked;
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "gatestep") {
        try {
            const result = await gateStep(input);
            return "OK len=" + result.hex.length + " hex=" + result.hex;
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "gateinfo") {
        try {
            const info = await readGateInfo(input);
            await stage("GATE: row=0x" + info.row.address.toString(16) +
                " domain=0x" + info.targetDomain.toString(16) +
                " parent=0x" + info.row.parent.toString(16) +
                " wait=0x" + info.row.wait.toString(16) +
                " state=" + info.row.state +
                " request=0x" + info.row.request.toString(16) +
                " pool=" + info.pool.map(t => "0x" + t.handle.toString(16)).join(","));
            return "OK row=0x" + info.row.address.toString(16) +
                " pool=" + info.pool.length;
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "waiterowner") {
        try {
            const info = await readGateInfo(input);
            const owners = await findGateOwner(input, info);
            await stage("OWNER: row=0x" + info.row.address.toString(16) +
                " parent=0x" + info.row.parent.toString(16) +
                " hits=" + owners.length);
            for (const hit of owners)
                await stage("OWNER: handle=0x" + hit.node.handle.toString(16) +
                    " node=0x" + hit.node.node.toString(16) +
                    " off=0x" + hit.offset.toString(16) +
                    " value=0x" + hit.value.toString(16));
            return "OK hits=" + owners.length + " " + owners.map(o =>
                "0x" + o.node.handle.toString(16)).join(",");
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "saveinfo") {
        try {
            const save = input.savedHandle;
            if (!save) return "ERR no savedHandle";
            const list = ipcListDirectory(save, "/", 3);
            const names = list.entries.slice(0, 20).map(e =>
                e.name + ":" + e.type + ":" + e.size);
            await stage("SAVE: error=" + list.error + " entries=" +
                list.entries.length + " free=" + ipcFreeSpace(save, "/").bytes);
            return "OK entries=" + list.entries.length + " " + names.join(" ");
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "donorclean") {
        try {
            const save = input.savedHandle;
            if (!save) return "ERR no savedHandle";
            for (const path of ["/main.npdm", "/main"]) {
                if (ipcGetEntryType(save, path).error === 0) {
                    const removed = ipcDeleteFile(save, path);
                    await stage("DONOR: delete " + path + " result=0x" +
                        Number(removed).toString(16));
                }
            }
            const commit = ipcCommit(save);
            return "OK commit=0x" + Number(commit).toString(16);
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "donor") {
        try {
            return await stageDonor(input);
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "loader") {
        try {
            const handle = await cloneLoaderRoot(input);
            globalThis.__AUTOLOADER_LOADER = handle;
            return "OK loader=0x" + Number(handle).toString(16);
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "code") {
        try {
            const args = rest.trim().split(/\s+/).filter(Boolean).map(s => parseInt(s, 16));
            const offset = Number.isInteger(args[0]) ? args[0] : 0;
            const size = Number.isInteger(args[1]) && args[1] > 0 && args[1] <= 0x400 ? args[1] : 0x40;
            const bytes = await readSdkBytes(input, offset, size);
            const out = [];
            for (let i = 0; i < bytes.length; i++) out.push(Number(bytes[i] || 0));
            return "OK sdk=0x" + sdkBase().toString(16) + " off=0x" + offset.toString(16) +
                " hex=" + bytesToHex(out);
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "scan") {
        try {
            const args = rest.trim().split(/\s+/).filter(Boolean);
            const offset = args[0] ? parseInt(args[0], 16) : 0;
            const length = args[1] ? parseInt(args[1], 16) : 0x600000;
            const pattern = args[2] || "40d03bd5c0035fd6";
            const hits = await scanSdk(input, offset, length, pattern);
            return "OK sdk=0x" + sdkBase().toString(16) + " hits=" + hits.length +
                " " + hits.map(h => "0x" + h.offset.toString(16) + ":" + h.hex).join(" ");
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "tlsptr") {
        try {
            const arg = rest.trim();
            const offset = arg ? parseInt(arg, 16) : 0x13F320;
            await stage("TLS: getTls call off=0x" + offset.toString(16));
            const value = BigInt(call_rop(BigInt(sdkBase()) + BigInt(offset)));
            await stage("TLS: getTls returned 0x" + value.toString(16));
            return "OK offset=0x" + offset.toString(16) +
                " value=0x" + value.toString(16);
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "tls") {
        try {
            const diag = tlsDiagnostic();
            return "OK tls=0x" + diag.tls.toString(16) + " head=" + diag.bytes;
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "tlscode") {
        try {
            const args = rest.trim().split(/\s+/).filter(Boolean).map(Number);
            const word1 = Number.isInteger(args[0]) ? args[0] : 12;
            const version = Number.isInteger(args[1]) ? args[1] : 1;
            if (!globalThis.__AUTOLOADER_LOADER)
                globalThis.__AUTOLOADER_LOADER = await cloneLoaderRoot(input);
            const probe = codeFsProbeTls(globalThis.__AUTOLOADER_LOADER,
                word1, version);
            return "OK tls=0x" + probe.tls.toString(16) +
                " w1=" + word1 + " v=" + version +
                " transport=0x" + probe.transport.toString(16) +
                " magic=0x" + probe.magic.toString(16) +
                " result=0x" + Number(probe.result).toString(16) +
                " moves=" + probe.moves.length +
                " copies=" + probe.copies.length +
                " bytes=" + probe.bytes;
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "ldrprobe") {
        try {
            if (!globalThis.__AUTOLOADER_LOADER)
                globalThis.__AUTOLOADER_LOADER = await cloneLoaderRoot(input);
            const handle = globalThis.__AUTOLOADER_LOADER;
            const probe = probeLoaderSession(handle);
            return "OK handle=0x" + Number(handle).toString(16) +
                " transport=0x" + probe.transport.toString(16) +
                " magic=0x" + probe.magic.toString(16) +
                " result=0x" + Number(probe.result).toString(16) +
                " moves=" + probe.moves.length +
                " copies=" + probe.copies.length +
                " bytes=" + probe.bytes;
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "ldrdirect") {
        try {
            const target = await findLoaderRoot(input);
            const fs = await openCodeFsInDomain(input, target);
            globalThis.__AUTOLOADER_CODEFS = fs;
            return "OK direct fs=0x" + Number(fs).toString(16);
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "ldrdomain") {
        try {
            if (!globalThis.__AUTOLOADER_LOADER)
                globalThis.__AUTOLOADER_LOADER = await cloneLoaderRoot(input);
            const id = openCodeFsOnLoaderDomain(globalThis.__AUTOLOADER_LOADER);
            return "OK object=" + id;
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "codeinfo") {
        try {
            const info = codeInfo(input);
            return "OK title=" + info.title + " npdmSize=" + info.size +
                " head=" + info.head;
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "sdls") {
        try {
            const sd = globalThis.__AUTOLOADER_SD ||
                await openSdCard(input.domainSession);
            const path = rest.trim() || "/";
            const list = ipcListDirectory(sd, path, 3);
            const text = list.entries.map(e =>
                e.name + (e.type === 2 ? "/" : "") + ":" + e.size).join(",");
            await stage("SDLS: " + path + " error=" + list.error +
                " entries=" + list.entries.length + " " + text);
            return "OK error=" + list.error + " entries=" +
                list.entries.length + " " + text;
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }



    if (verb === "exportfs") {
        try {
            if (globalThis.__AUTOLOADER_FS_PROC)
                return "OK fsProc=0x" +
                    globalThis.__AUTOLOADER_FS_PROC.toString(16);
            const result = await exportSmHandle(input, notifier, 0xffff8001);
            if (!result || !result.handle) return "ERR export failed";
            globalThis.__AUTOLOADER_FS_PROC = result.handle;
            await stage("EXPORTFS: fs KProcess handle=0x" +
                result.handle.toString(16));
            return "OK fsProc=0x" + result.handle.toString(16);
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "roinfo") {
        try {
            const sm = globalThis.__AUTOLOADER_EXPORTED_SM;
            const proc = globalThis.__AUTOLOADER_FS_PROC;
            if (!sm) return "ERR no exported SM";
            if (!proc) return "ERR no fs process handle; run exportfs";
            let svc = 0, name = "";
            for (const candidate of ["ro:1", "ro:dmnt", "ro:2", "ro:dmn2"]) {
                svc = openSmService(sm, candidate);
                if (svc) { name = candidate; break; }
            }
            if (!svc) return "ERR ro service open failed";
            const p = allocPage(0x2000);
            prepPacket(p, 4, 0x8000000C, []);
            write32(p + 8n, 2n);
            write32(p + 12n, BigInt(proc));
            write32(p + 0x10n, 0x49434653n);
            write32(p + 0x18n, 0x524f0010n);
            write64(p + 0x20n, 0n);
            write64(p + 0x28n, 0n);
            write64(p + 0x30n, 0n);
            write64(p + 0x38n, 0n);
            const t = Number(sendIPC(svc, p)) >>> 0;
            const magic = cu32(p + 0x20n);
            const result = cu32(p + 0x28n);
            const pid = cu64(p + 0x30n);
            const program = cu64(p + 0x38n);
            await stage("ROINFO: svc=" + name + " t=0x" + t.toString(16) +
                " magic=0x" + magic.toString(16) +
                " result=0x" + result.toString(16) +
                " pid=" + pid + " program=0x" + program.toString(16));
            closeHandle(svc);
            return "OK svc=" + name + " magic=0x" + magic.toString(16) +
                " result=0x" + result.toString(16) +
                " pid=" + pid + " program=0x" + program.toString(16);
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }

    if (verb === "closehandle") {
        const handle = parseInt(rest, 16);
        if (!Number.isInteger(handle) || handle <= 0)
            return "ERR bad handle";
        const result = closeHandle(handle);
        return "OK result=0x" + Number(result).toString(16);
    }
    if (verb === "waitzero") {
        const handle = parseInt(rest, 16);
        if (!Number.isInteger(handle) || handle <= 0)
            return "ERR bad handle";
        const result = waitRawThread(handle, 1n);
        return "OK result=0x" + Number(result).toString(16);
    }
    if (verb === "eventsignal") {
        const handle = parseInt(rest, 16);
        if (!Number.isInteger(handle) || handle <= 0)
            return "ERR bad handle";
        const result = signalEvent(handle);
        return "OK result=0x" + Number(result).toString(16);
    }
    if (verb === "eventclear") {
        const handle = parseInt(rest, 16);
        if (!Number.isInteger(handle) || handle <= 0)
            return "ERR bad handle";
        const result = clearEvent(handle);
        return "OK result=0x" + Number(result).toString(16);
    }



    if (verb === "sysinfo") {
        try {
            const types = [[6, "memTotal"], [7, "memUsed"],
                [16, "sysTotal"], [17, "sysUsed"],
                [24, "freeThreads"], [36, "asSize"]];
            const out = allocPage(8);
            const values = [];
            for (const [type, name] of types) {
                write64(out, 0n);
                call_rop(sdkBase() + 0x168ca4n, out, BigInt(type),
                    0xffff8001n, 0n);
                values.push(name + "=" + read64(out).toString());
            }
            await stage("SYSINFO: " + values.join(" "));
            return "OK " + values.join(" ");
        } catch (error) {
            return "ERR " + (error && error.message ? error.message : error);
        }
    }
    if (verb === "quit") return null;
    if (verb === "info")
        return "fsSm=0x" + (fsSm ? fsSm.handle.toString(16) : "?") +
            " notifier=" + (notifier ? notifier.id : "?");
    return "ERR unknown command";
}

function openSmService(handle, name) {
    try {
        const packet = allocPage(0x2000);
        prepPacket(packet, 0x11, 2, []);
        for (let i = 0; i < name.length && i < 8; i++)
            write8(packet + 8n + BigInt(i), BigInt(name.charCodeAt(i)));
        const transport = Number(sendIPC(handle, packet)) >>> 0;
        if (transport) throw new Error("transport=0x" + transport.toString(16));
        const special = Number(read32(packet + 8n)) >>> 0;
        const copies = (special >>> 1) & 15;
        const moves = (special >>> 5) & 15;
        const at = 12;
        const handles = [];
        for (let i = 0; i < copies + moves; i++)
            handles.push(Number(read32(packet + BigInt(at + i * 4))) >>> 0);
        const result = Number(read32(packet + BigInt(at + (copies + moves) * 4))) >>> 0;
        if (result || !moves) throw new Error("result=0x" + result.toString(16) +
            " copies=" + copies + " moves=" + moves);
        return handles[copies] || 0;
    } catch (error) {
        stage("SM: " + name + " failed: " +
            (error && error.message ? error.message : error));
        return 0;
    }
}

async function runBridge(input, fsSm, notifier, extraCommands = {}) {
    globalThis.__AUTOLOADER_CTX = {input, fsSm, notifier, core: coreRuntime};
    const peerText = globalThis.__AUTOLOADER_PEER_IP;
    if (!peerText) {
        await stage("BRIDGE: no peer IP; bridge disabled");
        return;
    }
    const octets = peerText.split(".").map(Number);
    if (octets.length !== 4 || octets.some(x => !Number.isInteger(x)))
        return;
    const peer = BigInt(octets[0]) | (BigInt(octets[1]) << 8n) |
        (BigInt(octets[2]) << 16n) | (BigInt(octets[3]) << 24n);
    const port = 9028;
    const htons = value => ((value & 0xff) << 8) | (value >> 8);

    const fd = socket(AF_INET, SOCK_DGRAM, 0);
    if (fd === -1n) {
        await stage("BRIDGE: socket failed");
        return;
    }
    const addr = malloc(16);
    for (let i = 0; i < 16; i++) write8(addr + BigInt(i), 0n);
    write8(addr, 16n); write8(addr + 1n, 2n);
    write16(addr + 2n, BigInt(htons(port)));
    write32(addr + 4n, 0n);
    if (bind(fd, addr, 16) === -1n) {
        await stage("BRIDGE: bind :9028 failed");
        close(fd);
        return;
    }
    for (let i = 0; i < 16; i++) write8(addr + BigInt(i), 0n);
    write8(addr, 16n); write8(addr + 1n, 2n);
    write16(addr + 2n, BigInt(htons(port)));
    write32(addr + 4n, peer);
    if (connect(fd, addr, 16) !== 0n) {
        await stage("BRIDGE: connect failed");
        close(fd);
        return;
    }
    const tx = malloc(512);
    const txText = text => {
        for (let i = 0; i < text.length; i++)
            write8(tx + BigInt(i), BigInt(text.charCodeAt(i)));
        send(fd, tx, text.length, 0);
    };
    txText("R");
    await stage("BRIDGE: ready on :9028");

    const buf = malloc(2048);
    for (;;) {
        const n = Number(recv(fd, buf, 2048, 0));
        if (n <= 0) continue;
        let text = "";
        for (let i = 0; i < n; i++) text += String.fromCharCode(Number(read8(buf + BigInt(i))));
        const p = text.indexOf(":");
        if (text[0] !== "C" || p < 2) continue;
        const seq = text.slice(1, p);
        const command = text.slice(p + 1);
        let result;
        try {
            result = await bridgeCommand(command, input, fsSm, notifier, extraCommands);
        } catch (error) {
            result = "ERR " + (error && error.message ? error.message : error);
        }
        if (result === null) {
            txText("B" + seq + ":BYE");
            await stage("BRIDGE: quit");
            break;
        }
        txText("B" + seq + ":" + result);
    }
    close(fd);
    await stage("BRIDGE: closed");
}

export async function setupFs(input) {
  try {
    await stage("AUTOLOADER: checking the SD card through promoted FS");
    const fsSm = await probeFsSm(input);
    const notifier = await probeNotifier(input);
    if (fsSm && notifier) {
        const exported = await exportSmHandle(input, notifier, fsSm.handle);
        if (exported && exported.handle) {
            globalThis.__AUTOLOADER_EXPORTED_SM = exported.handle;
            const fsProc = await exportSmHandle(input, notifier, 0xffff8001);
            if (fsProc && fsProc.handle)
                globalThis.__AUTOLOADER_FS_PROC = fsProc.handle;
            const shell = openSmService(exported.handle, "pm:shell");
            const dmnt = openSmService(exported.handle, "pm:dmnt");
            const ldr = openSmService(exported.handle, "fsp-ldr");
            globalThis.__AUTOLOADER_PM_SHELL = shell;
            globalThis.__AUTOLOADER_PM_DMNT = dmnt;
            globalThis.__AUTOLOADER_LDR = ldr;
            await stage("AUTO SM: shell=0x" + shell.toString(16) +
                " dmnt=0x" + dmnt.toString(16) +
                " ldr=0x" + ldr.toString(16));
        }
        if (notifier.handle) {
            const ev = await exportSmHandle(input, notifier, notifier.handle);
            if (ev && ev.handle) {
                notifier.eventRead = ev.handle;
                await stage("NOTIFIER: event read copy=0x" +
                    ev.handle.toString(16));
            }
        }
        if (notifier.write) {
            const ev = await exportSmHandle(input, notifier, notifier.write);
            if (ev && ev.handle) {
                notifier.eventWrite = ev.handle;
                await stage("NOTIFIER: event write copy=0x" +
                    ev.handle.toString(16));
            }
        }
        if (notifier.eventRead && notifier.eventWrite) {
            try {
                clearEvent(notifier.eventRead);
                waitEventZero(notifier.eventRead);
                signalEvent(notifier.eventWrite);
                waitEventZero(notifier.eventRead);
                clearEvent(notifier.eventRead);
                waitEventZero(notifier.eventRead);
            } catch (error) {
                await stage("ERROR: EVENT qualification failed: " +
                    (error && error.message ? error.message : error));
            }
        }
    }
    return {fsSm, notifier};
  } catch (error) {
    await stage("ERROR: " + (error && error.message ? error.message : error));
    throw error;
  }
}

export async function prepareKaihen(input) {
  try {
    const sd = await openSdCard(input.domainSession);
    let keepSd = false;
    try {
        const required = [
            ["/hbmenu.nro", "hbmenu.nro"],
            ["/kaihen/bootstrap.bin", "kaihen/bootstrap.bin"],
            ["/kaihen/bin/hen/main", "kaihen/bin/hen/main"],
            ["/kaihen/bin/game/main", "kaihen/bin/game/main"]
        ];
        const missing = [];
        for (const [path, label] of required) {
            if (ipcGetEntryType(sd, path).error !== 0) missing.push(label);
        }
        if (missing.length)
            throw new Error("SD card is missing " + missing.join(", ") +
                "; copy packages/sdcard/contents to the card root and insert it again");
        await stage("KAIHEN PREP: required SD files are present");

        globalThis.__AUTOLOADER_HEN_FILES = {
            bootstrap: readFileAll(sd, "/kaihen/bootstrap.bin").bytes,
            hen: readFileAll(sd, "/kaihen/bin/hen/main").bytes,
            game: readFileAll(sd, "/kaihen/bin/game/main").bytes
        };
        globalThis.__AUTOLOADER_SD = sd;
        keepSd = true;
        await stage("KAIHEN PREP: cached bootstrap=" +
            globalThis.__AUTOLOADER_HEN_FILES.bootstrap.length +
            " hen=" + globalThis.__AUTOLOADER_HEN_FILES.hen.length +
            " game=" + globalThis.__AUTOLOADER_HEN_FILES.game.length);
    } finally {
        if (!keepSd) closeHandle(sd);
    }

    await stage("KAIHEN PREP: SD check complete; staging the RO donor");
    await stageDonor(input);
    await captureDonor(input);
    await stage("DONOR: captured; kaiHEN preparation ready");
    return {sdChecked: true};
  } catch (error) {
    await stage("ERROR: " + (error && error.message ? error.message : error));
    throw error;
  }
}

export async function runFs(input) {
    const ctx = await setupFs(input);
    // The kaiHEN boot stage runs before the bridge, but launchLoop and the
    // gate helpers read this context.  Set it here and let runBridge refresh
    // the same values when the bridge starts.
    globalThis.__AUTOLOADER_CTX = {input, fsSm: ctx.fsSm,
        notifier: ctx.notifier, core: coreRuntime};
    return createFsSession(input, ctx);
}

export async function runFsBridge(input, ctx, extraCommands = {}) {
    await runBridge(input, ctx.fsSm, ctx.notifier, extraCommands);
}

// The kaiHEN module receives a narrow facade instead of the whole FS module.
export function createFsSession(input, ctx) {
    const cache = {};
    return {
        apiVersion: 1,
        input, ctx, stage, cache,
        sdHandle: async () => {
            if (globalThis.__AUTOLOADER_SD) return globalThis.__AUTOLOADER_SD;
            if (!cache.sd) cache.sd = await openSdCard(input.domainSession);
            return cache.sd;
        },
        // HEN retains an owned notifier session (fsp-srv cmd 510 moved
        // handle), not the notifier's domain object id.  Keeping the clone
        // open keeps the FS-local parking event alive after the bootstrap
        // exits; HEN receives a copy of this handle.
        notifierSession: () => {
            if (!cache.notifierSession) {
                const id = ctx.notifier && ctx.notifier.id;
                if (!id) throw new Error("no FS notifier object id");
                cache.notifierSession =
                    cloneObject(input.domainSession.handle, id);
                if (!cache.notifierSession)
                    throw new Error("could not clone the FS notifier session");
            }
            return cache.notifierSession;
        },
        // The kaiHEN bootstrap dispatches ordinary CMIF commands on a raw
        // Handle, so it needs a plain fsp-srv session.  A session opened from
        // SM has no SD-card permission on Switch 2: OpenSdCardFileSystem
        // returns FS 2304 even after SetCurrentProcess.  Cloning the root
        // object of the promotion domain keeps that domain's permission and
        // gives exactly the plain session the bootstrap (and HEN) expects.
        // The reference start-hen.cjs opens ldr:ro through the application's
        // own SM session, not through fs's exported SM. The app-side loader
        // handle is the context that later receives the game's mount.
        openAppService: name => {
            const out = allocPage(0x10);
            write64(out, 0n);
            const nameBuf = allocPage(0x10);
            writeStr(nameBuf, name);
            const init = Number(call_rop(sdkBase() + 0x14c960n)) >>> 0;
            const rc = Number(call_rop(sdkBase() + 0x14cab0n, out, nameBuf)) >>> 0;
            call_rop(sdkBase() + 0x14c990n);
            const handle = Number(read32(out)) >>> 0;
            if (init || rc || !handle) {
                stage("LDRRO: app SM " + name + " init=0x" + init.toString(16) +
                    " rc=0x" + rc.toString(16) + " handle=0x" + handle.toString(16));
                return 0;
            }
            stage("LDRRO: app SM " + name + " handle=0x" + handle.toString(16));
            return handle;
        },
        openBootstrapRoot: async () => {
            if (cache.bootstrapRoot) return cache.bootstrapRoot;
            const session = input.domainSession;
            if (!session)
                throw new Error("no fsp-srv domain session for the bootstrap root");
            const root = cloneObject(session.handle, session.rootObj);
            if (!root)
                throw new Error("could not clone the fsp-srv root for the bootstrap");
            await stage("HEN: root session clone handle=0x" + root.toString(16));
            cache.bootstrapRoot = root;
            return root;
        },
        memoryInfo,
        sdkAllocate: async (bytes, alignment = 0x1000) => {
            const out = allocPage(0x20);
            write64(out, 0n);
            const rc = Number(call_rop(sdkBase() + 0x512f40n, out,
                BigInt(alignment), BigInt(bytes))) >>> 0;
            if (rc) throw new Error("sdk allocate failed 0x" +
                rc.toString(16));
            const address = read64(out);
            if (!address) throw new Error("sdk allocate returned null");
            return address;
        },
        get notifier() { return ctx.notifier; },
        gate: () => readGateInfo(input),
        donor: () => globalThis.__AUTOLOADER_DONOR,
        retained: () => ({candidateHandle: Number(input.candidateHandle),
            dataOffset: 0x4000, dataEntryOffset: 0x90}),
        services: {
            get exportedSm() { return globalThis.__AUTOLOADER_EXPORTED_SM; },
            get shell() { return globalThis.__AUTOLOADER_PM_SHELL; },
            get dmnt() { return globalThis.__AUTOLOADER_PM_DMNT; },
            get ldr() { return globalThis.__AUTOLOADER_LDR; },
            get fsProc() { return globalThis.__AUTOLOADER_FS_PROC; },
            open: name => openSmService(
                globalThis.__AUTOLOADER_EXPORTED_SM, name),
            exportHandle: target => exportSmHandle(input, ctx.notifier, target),
            loaderRoot: async () => {
                if (!cache.loaderRoot)
                    cache.loaderRoot = await cloneLoaderRoot(input);
                return cache.loaderRoot;
            },
            serverCopy: async receive => {
                if (cache.serverReceive !== receive) {
                    cache.serverCopy = await exportSmHandle(input,
                        ctx.notifier, receive);
                    cache.serverReceive = receive;
                }
                return cache.serverCopy;
            }
        },
        prepareKaihen: () => prepareKaihen(input),
        // Narrow primitives for the kaiHEN boot module.  The sequence itself
        // lives in autoloader-kaihen.mjs; this module only exposes what it
        // owns (PM sessions, the gate launch and the exported SM).
        pmProcessId: async title => {
            const dmnt = globalThis.__AUTOLOADER_PM_DMNT;
            if (!dmnt) throw new Error("no pm:dmnt session");
            const bytes = [];
            let v = BigInt(title);
            for (let i = 0; i < 8; i++) { bytes.push(Number(v & 0xffn)); v >>= 8n; }
            const reply = pmShellPacket(dmnt, 2, bytes);
            if (reply.transport || reply.result)
                throw new Error("pmdmnt GetProcessId transport=0x" +
                    reply.transport.toString(16) + " result=0x" +
                    Number(reply.result).toString(16));
            const data = parseHex(reply.data);
            return readU64(data, 0);
        },
        pmCommand: (verb, pid) => {
            const handle = verb === "start"
                ? globalThis.__AUTOLOADER_PM_DMNT
                : globalThis.__AUTOLOADER_PM_SHELL;
            if (!handle) throw new Error("no pm:" + verb + " session");
            const bytes = [];
            let v = BigInt(pid);
            for (let i = 0; i < 8; i++) { bytes.push(Number(v & 0xffn)); v >>= 8n; }
            const reply = pmShellPacket(handle, 1, bytes);
            if (reply.transport || reply.result)
                throw new Error("pm " + verb + " transport=0x" +
                    reply.transport.toString(16) + " result=0x" +
                    Number(reply.result).toString(16));
            return true;
        },
        launchRo: async mount => {
            const loop = await launchLoop(input, mount === undefined ? 2 : mount);
            const pid = Number(globalThis.__AUTOLOADER_RESULT &&
                globalThis.__AUTOLOADER_RESULT.pid) || 0;
            if (!pid) throw new Error("launchloop returned no pid: " + loop);
            return pid;
        },
        openRoDmnt: () => {
            const ro = openSmService(globalThis.__AUTOLOADER_EXPORTED_SM, "ro:dmnt");
            if (!ro) throw new Error("ro:dmnt unavailable after the RO launch");
            globalThis.__AUTOLOADER_RO_SERVICE = ro;
            return ro;
        },
        waitMs,
        keepAlive: extraCommands => runFsBridge(input, ctx, extraCommands),        keepAlive: extraCommands => runFsBridge(input, ctx, extraCommands),
        allocPage, prepPacket, sendIPC, cmifReply,
        read32, read64, write32, write64, closeHandle,
        openSdCard, ipcListDirectory, ipcGetEntryType, ipcFreeSpace,
        readFileAll, readFileBytes, ensureDir, writeMarker,
        exportSmHandle, openSmService, startRoCommand, runRoCommandSync,
        sendIpcSync,
        readGateInfo, probeLoaderSession, findLoaderRoot, cloneLoaderRoot,
        bytesToHex, parseHex, sdkBase, call_rop,
        borrowThreadScheduling, buildRawFrame, launchRawWorker,
        waitRawThread, closeRawThread, IPC_SEND_DISPATCHER
    };
}
