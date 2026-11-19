// CivSwitchFS autoloader entry point.
//
// Modules are listed in one place.  The FS module owns the promotion,
// notifier/PM/FS handles, gate restore, and RO launch.  The kaiHEN module
// consumes its facade for SD/bootstrap/ldr:ro/HEN work.
import {runFs} from "./autoloader-fs.mjs";
import {createKaihen} from "./autoloader-kaihen.mjs";
import {emitFastStage} from "./log-stage.mjs";
import {storeRecordedSchedule} from "./timing-slot.mjs";

const BUILD_UTC = "2026-11-15T14:53:49Z";

const CONFIG = {
    modules: ["fs", "kaihen"],
    // One-click path: prepare and boot kaiHEN automatically.
    kaihenAuto: true,
    // Build-time manual override.  Set this to true (or define
    // globalThis.__CIVSWITCH_DEV__ before the payload) to only prepare
    // kaiHEN and keep the bridge alive.
    devMode: false
};

export async function run(input) {
    const dev = CONFIG.devMode || globalThis.__CIVSWITCH_DEV__ === true;
    if (dev) globalThis.__AUTOLOADER_DEV__ = true;
    await emitFastStage("AUTOLOADER: BUILD: " + BUILD_UTC);
    // Stage 1: CFS (FS elevation, gate and PM/FS handles).
    const fs = await runFs(input);
    // FS success is the milestone the timing record exists for: store the
    // winning schedule into the save so the next boot starts from it.
    // Best-effort; a failed record never affects this run.
    try {
        const winSchedule = globalThis.__AUTOLOADER_WIN_SCHEDULE;
        if (winSchedule) {
            const stored = await storeRecordedSchedule(winSchedule);
            await emitFastStage(stored
                ? "AUTOLOADER: TIMING: winning schedule recorded for the next boot"
                : "AUTOLOADER: TIMING: schedule record skipped (save not writable)");
        }
    } catch (ignored) {}
    const kaihen = createKaihen(fs);
    // Stage 2: prepare kaiHEN (SD layout, cached HEN files, RO donor).
    // A missing SD card or a missing kaiHEN file must not kill the FS bridge;
    // report it on screen and keep the session alive.
    let prepared = false;
    try {
        await kaihen.prepare();
        prepared = true;
    } catch (error) {
        await emitFastStage("AUTOLOADER: kaiHEN prepare failed: " +
            (error && error.message ? error.message : error));
    }
    if (prepared && CONFIG.modules.includes("kaihen") &&
        CONFIG.kaihenAuto && !dev) {
        try {
            await kaihen.boot();
            await emitFastStage("AUTOLOADER: HEN: boot sequence complete");
            await emitFastStage("AUTOLOADER: kaiHEN installation complete. You can close Civ7 now.");
        } catch (error) {
            await emitFastStage("AUTOLOADER: HEN: auto failed: " +
                (error && error.message ? error.message : error));
        }
    } else if (dev) {
        await emitFastStage("AUTOLOADER: dev mode; kaiHEN boot skipped");
    }
    // Keep the promoted session alive for the game/RO frontend.  In dev mode
    // the serial bridge exposes the FS and kaiHEN command registries.
    await fs.keepAlive(kaihen.commands());
    return fs;
}
