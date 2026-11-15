// Keep payload logs inside better-console when its public logger is available.
// The fallback uses the same row layout and colors for standalone loaders.
const LOGGER_KEY = "__CIVSWITCHFS_VISUAL_LOGGER_V2__";
const LOGGER_STATE_KEY = "__CIVSWITCHFS_VISUAL_LOG_STATE_V2__";
const LEGACY_LOGGER_KEY = "__CIVSWITCHFS_VISUAL_LOGGER__";
const LEGACY_STATE_KEY = "__CIVSWITCHFS_VISUAL_LOG_STATE__";
const BETTER_CONSOLE_FORWARDER = "__civSwitchBetterConsoleForwarder";
const LOG_LABEL = "CivSwitchFS logs";
const STATUS_KEY = "__CIVSWITCHFS_STATUS_BAR__";

export function installVisualLogPatch() {
    const api = globalThis.__CIVSWITCH_CORE_API__;
    installVisualLogPatchFor(api);
}

// The persisted bootstrap uses the same logger before the payload is injected,
// so the first exploit and payload messages share one visual surface.
export function installEarlyVisualLogPatch() {
    const api = {log: globalThis.log};
    installVisualLogPatchFor(api);
}

function installVisualLogPatchFor(api) {
    const document = globalThis.document;
    if (!api || typeof api.log !== "function" || !document?.body) return;

    const betterConsole = globalThis.civConsole;
    if (betterConsole && typeof betterConsole.log === "function") {
        removeLegacyOutput(document);
        const existingLogger = globalThis[LOGGER_KEY];
        if (typeof existingLogger === "function" &&
            existingLogger[BETTER_CONSOLE_FORWARDER]) {
            api.log = existingLogger;
            globalThis.log = existingLogger;
            return;
        }

        const consoleLog = betterConsole.log;
        const forwardLog = function (...args) {
            forwardPersistedLog(args);
            updateStatus(document, args[0]);
            return Reflect.apply(consoleLog, betterConsole, args);
        };
        forwardLog[BETTER_CONSOLE_FORWARDER] = true;
        globalThis[LOGGER_KEY] = forwardLog;
        globalThis.log = forwardLog;
        api.log = forwardLog;
        return;
    }

    const existingLogger = globalThis[LOGGER_KEY];
    if (typeof existingLogger === "function") {
        api.log = existingLogger;
        globalThis.log = existingLogger;
        return;
    }

    // If a payload using the former <pre> overlay already ran in this session,
    // restyle it in place so its persistent logger does not restore the black
    // panel on the next message.
    const legacyLogger = globalThis[LEGACY_LOGGER_KEY];
    if (typeof legacyLogger === "function") {
        const legacyState = globalThis[LEGACY_STATE_KEY];
        const legacyOutput = legacyState?.output ||
            document.querySelector('[aria-label="' + LOG_LABEL + '"]');
        if (legacyOutput) applyLegacyConsoleStyle(legacyOutput, document);
        const migratedLogger = function (...args) {
            forwardPersistedLog(args);
            const pending = Reflect.apply(legacyLogger, this, args);
            return Promise.resolve(pending).then(result => {
                const output = legacyState?.output ||
                    document.querySelector('[aria-label="' + LOG_LABEL + '"]');
                if (output) applyLegacyConsoleStyle(output, document);
                return result;
            });
        };
        globalThis[LOGGER_KEY] = migratedLogger;
        globalThis.log = migratedLogger;
        api.log = migratedLogger;
        return;
    }

    const state = globalThis[LOGGER_STATE_KEY] || {
        output: null,
        logQueue: Promise.resolve(),
        compact: false
    };
    globalThis[LOGGER_STATE_KEY] = state;
    let originalLog = api.log;

    function ensureOutput() {
        const nativeOutput = document.querySelector("pre");
        if (nativeOutput && nativeOutput !== state.output)
            nativeOutput.style.display = "none";

        if (!state.output || !state.output.isConnected) {
            state.output = document.createElement("div");
            state.output.setAttribute("aria-label", LOG_LABEL);
            state.output.setAttribute("tabindex", "0");
            state.output.setAttribute("role", "log");
            state.compact = applyConsoleStyle(state.output, document);
            document.body.appendChild(state.output);
        }
        return state.output;
    }

    const visualLog = function (...args) {
        const callThis = this;
        const callArgs = args.slice();
        const message = String(callArgs[0]);
        const timestamp = formatTimestamp(new Date());
        forwardPersistedLog(callArgs);

        const task = state.logQueue.then(async () => {
            // This surface is a live console, not a user-scrolled document:
            // always keep its newest row visible. The old isNearBottom gate
            // stopped following as soon as a burst of lines got ahead of the
            // scroll position, which hid the final rows on the console.
            const pendingLog = Reflect.apply(originalLog, callThis, callArgs);
            // The persisted bootstrap's first logger is lazy: its first call
            // replaces window.log with the underlying <pre> implementation.
            // Retain the visual wrapper after capturing that implementation.
            if (globalThis.log !== visualLog) {
                originalLog = globalThis.log;
                api.log = visualLog;
                globalThis.log = visualLog;
            }
            const logOutput = ensureOutput();
            const result = await pendingLog;

            addLogRows(logOutput, document, message, timestamp, state.compact);
            updateStatus(document, message);
            scrollToTail(logOutput);
            return result;
        });

        state.logQueue = task.catch(() => {});
        return task;
    };

    globalThis[LOGGER_KEY] = visualLog;
    globalThis.log = visualLog;
    api.log = visualLog;
}

function forwardPersistedLog(args) {
    const forwarder = globalThis.__CIVSWITCHFS_PERSIST_LOG_FORWARDER__;
    if (typeof forwarder !== "function") return;
    try {
        Reflect.apply(forwarder, globalThis, args);
    } catch (error) {}
}

// The game console clips the last rows of its log surface. Keep the newest
// two messages in a fixed strip so the current stage is always visible.
function ensureStatusBar(document) {
    let status = globalThis[STATUS_KEY];
    if (status && status.isConnected) return status;
    status = document.createElement("div");
    status.setAttribute("aria-label", "CivSwitchFS status");
    Object.assign(status.style, {
        position: "fixed",
        top: "0",
        left: "0",
        right: "0",
        zIndex: "2147483647",
        boxSizing: "border-box",
        padding: "5px 14px",
        background: "rgba(20, 22, 26, 0.96)",
        color: "#9bcaff",
        fontFamily: "Consolas, 'Liberation Mono', monospace",
        fontSize: "14px",
        lineHeight: "1.35",
        borderBottom: "1px solid #3a3f4b",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        pointerEvents: "none"
    });
    document.body.appendChild(status);
    globalThis[STATUS_KEY] = status;
    return status;
}

function updateStatus(document, message) {
    const lines = String(message).replace(/\r\n?/g, "\n").split("\n")
        .filter(line => line.length);
    const tail = lines.slice(-2).join("  |  ");
    ensureStatusBar(document).textContent = tail;
}

export async function clearVisualLog() {
    const status = globalThis[STATUS_KEY];
    if (status) status.textContent = "";
    const betterConsole = globalThis.civConsole;
    if (betterConsole && typeof betterConsole.clear === "function") {
        betterConsole.clear();
        return;
    }

    const state = globalThis[LOGGER_STATE_KEY] ||
        globalThis[LEGACY_STATE_KEY];
    if (!state) return;

    await state.logQueue.catch(() => {});
    const output = state.output ||
        globalThis.document?.querySelector('[aria-label="' + LOG_LABEL + '"]');
    if (output) output.textContent = "";
}

function removeLegacyOutput(document) {
    const state = globalThis[LEGACY_STATE_KEY];
    const output = state?.output ||
        document.querySelector('[aria-label="' + LOG_LABEL + '"]');
    if (output?.parentNode) output.parentNode.removeChild(output);
}

function formatTimestamp(date) {
    const twoDigits = value => String(value).padStart(2, "0");
    const threeDigits = value => String(value).padStart(3, "0");
    // The CFS/FS runtime may report UTC while the console UI uses the user's
    // system timezone.  The game-side loader records the console's offset
    // (minutes west of UTC) before evaluating this payload.
    const offset = Number(globalThis.__AUTOLOADER_TZ_OFFSET);
    if (Number.isFinite(offset) && offset !== 0) {
        const local = new Date(date.getTime() - offset * 60000);
        return twoDigits(local.getUTCHours()) + ":" +
            twoDigits(local.getUTCMinutes()) + ":" +
            twoDigits(local.getUTCSeconds()) + "." +
            threeDigits(local.getUTCMilliseconds());
    }
    return twoDigits(date.getHours()) + ":" +
        twoDigits(date.getMinutes()) + ":" +
        twoDigits(date.getSeconds()) + "." +
        threeDigits(date.getMilliseconds());
}

function applyConsoleStyle(output, document) {
    const viewportWidth = Number(document.documentElement?.clientWidth) ||
        Number(globalThis.innerWidth) || 0;
    const compact = viewportWidth > 0 && viewportWidth <= 700;

    Object.assign(output.style, {
        position: "fixed",
        top: "0",
        left: "0",
        right: "0",
        bottom: "0",
        zIndex: "2147483647",
        boxSizing: "border-box",
        margin: "0",
        padding: "40px 0 160px",
        overflowY: "auto",
        overflowX: "hidden",
        fontFamily: "Consolas, 'Liberation Mono', monospace",
        fontSize: compact ? "15px" : "18px",
        lineHeight: "1.5",
        background: "#282c34",
        color: "#f2f3f5",
        whiteSpace: "normal",
        overscrollBehavior: "contain"
    });
    return compact;
}

function applyLegacyConsoleStyle(output, document) {
    const viewportWidth = Number(document.documentElement?.clientWidth) ||
        Number(globalThis.innerWidth) || 0;
    const compact = viewportWidth > 0 && viewportWidth <= 700;
    const fontSize = compact ? "15px" : "18px";
    const timeFontSize = compact ? "12px" : "14px";
    const timeMargin = compact ? "12px" : "18px";

    Object.assign(output.style, {
        position: "fixed",
        top: "0",
        left: "0",
        right: "0",
        bottom: "0",
        zIndex: "2147483647",
        boxSizing: "border-box",
        margin: "0",
        padding: "40px 14px 160px",
        overflowY: "auto",
        overflowX: "hidden",
        fontFamily: "Consolas, 'Liberation Mono', monospace",
        fontSize,
        lineHeight: "1.5",
        background: "#282c34",
        color: "#e8ece8",
        whiteSpace: "pre-wrap",
        overflowWrap: "break-word",
        wordBreak: "break-word",
        overscrollBehavior: "contain"
    });

    const children = output.children || [];
    for (let index = 0; index < children.length; index++) {
        const child = children[index];
        if (child.tagName !== "SPAN") continue;
        Object.assign(child.style, {
            display: "inline-block",
            width: "13ch",
            marginRight: timeMargin,
            verticalAlign: "top",
            color: "#9bcaff",
            whiteSpace: "nowrap",
            fontSize: timeFontSize,
            lineHeight: "1.5",
            userSelect: "none"
        });
    }
}

function addLogRows(output, document, message, timestamp, compact) {
    const lines = message.replace(/\r\n?/g, "\n").split("\n");
    for (const line of lines) {
        const row = document.createElement("div");
        Object.assign(row.style, {
            display: "flex",
            alignItems: "center",
            boxSizing: "border-box",
            padding: compact ? "3px 10px" : "3px 14px",
            fontSize: compact ? "15px" : "18px",
            lineHeight: "1.5"
        });

        const stamp = document.createElement("span");
        stamp.textContent = timestamp;
        Object.assign(stamp.style, {
            color: "#9bcaff",
            flex: "0 0 13ch",
            whiteSpace: "nowrap",
            fontSize: compact ? "12px" : "14px",
            lineHeight: "1.5",
            userSelect: "none",
            marginRight: compact ? "12px" : "18px"
        });

        const content = document.createElement("span");
        content.textContent = line || "\u00a0";
        Object.assign(content.style, {
            minWidth: "0",
            color: "#e8ece8",
            whiteSpace: "pre-wrap",
            overflowWrap: "break-word",
            wordBreak: "break-word"
        });

        row.appendChild(stamp);
        row.appendChild(content);
        output.appendChild(row);
    }
}

/// Pins the log to its newest row. Setting scrollTop immediately can use the
/// previous layout height: on the console a log line appended in the same
/// frame then stays one or two rows below the visible area. Scroll once now
/// and again after the browser has committed the new row.
function scrollToTail(output) {
    const scroll = () => {
        output.scrollTop = output.scrollHeight;
    };
    scroll();
    if (typeof globalThis.requestAnimationFrame === "function") {
        globalThis.requestAnimationFrame(() => {
            scroll();
            globalThis.requestAnimationFrame(scroll);
        });
    } else {
        globalThis.setTimeout(scroll, 0);
    }
}

function isNearBottom(output) {
    if (!output) return true;
    const remaining = output.scrollHeight - output.clientHeight - output.scrollTop;
    const fontSize = Number.parseFloat(output.style.fontSize) || 16;
    return remaining <= Math.max(2, fontSize * 0.5);
}
