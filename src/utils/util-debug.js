import { EXT_DISPLAY } from '../constants.js';
import { DBG_STATE, DBG_SKIP } from '../state.js';
import { getSettings, getCurrentSession, hasSessionOverrides } from '../session.js';
import { extVersion } from '../index.js';

export function _dbgStrip(s) {
    const r = {};
    for (const [k, v] of Object.entries(s)) { if (!DBG_SKIP.has(k)) r[k] = v; }
    return r;
}

export function _dbgAdd(type, payload) {
    DBG_STATE.log.push({ ts: Date.now(), type, payload });
    if (DBG_STATE.log.length > DBG_STATE.MAX) DBG_STATE.log.splice(0, DBG_STATE.log.length - DBG_STATE.MAX);
}

export function _dbgSnapshotSettings() {
    try {
        const s = _dbgStrip(getSettings());
        DBG_STATE.snapshot = JSON.parse(JSON.stringify(s));
        _dbgAdd('SETTINGS_SNAPSHOT', s);
    } catch(_) {}
}

export function _dbgDiffSettings() {
    if (!DBG_STATE.snapshot) return;
    try {
        const cur = _dbgStrip(getSettings());
        const diff = {};
        const keys = new Set([...Object.keys(cur), ...Object.keys(DBG_STATE.snapshot)]);
        for (const k of keys) {
            if (JSON.stringify(cur[k]) !== JSON.stringify(DBG_STATE.snapshot[k])) {
                diff[k] = { prev: DBG_STATE.snapshot[k], now: cur[k] };
            }
        }
        if (Object.keys(diff).length) {
            _dbgAdd('SETTINGS_CHANGED', diff);
            DBG_STATE.snapshot = JSON.parse(JSON.stringify(cur));
        }
    } catch(_) {}
}

export function _dbgSetupGlobalErrorHandlers() {
    const origErr = console.error;
    console.error = function(...a) {
        origErr.apply(console, a);
        try {
            _dbgAdd('CONSOLE_ERROR', a.map(x =>
                x instanceof Error ? (x.stack || x.message) :
                (typeof x === 'object' ? JSON.stringify(x) : String(x))
            ).join(' '));
        } catch(_) {}
    };
    window.addEventListener('error', e => {
        _dbgAdd('WINDOW_ERROR', { msg: e.message, src: e.filename, line: e.lineno, col: e.colno, stack: e.error?.stack });
    });
    window.addEventListener('unhandledrejection', e => {
        _dbgAdd('UNHANDLED_REJECTION', { msg: String(e.reason), stack: e.reason?.stack });
    });

    if (typeof toastr !== 'undefined') {
        const origToastrError = toastr.error;
        toastr.error = function(message, title, options) {
            try { _dbgAdd('UI_ERROR_POPUP', { title: title || 'Error', message: String(message) }); } catch(_) {}
            return origToastrError.apply(toastr, [message, title, options]);
        };

        const origToastrWarning = toastr.warning;
        toastr.warning = function(message, title, options) {
            try { _dbgAdd('UI_WARNING_POPUP', { title: title || 'Warning', message: String(message) }); } catch(_) {}
            return origToastrWarning.apply(toastr, [message, title, options]);
        };
    }
}

export function dbgDownload() {
    const ctx = SillyTavern.getContext();
    
    let activeId = ctx.extensionSettings?.connectionManager?.selectedProfile;
    if (!activeId) {
        const domSelect = document.getElementById('connection_profiles');
        if (domSelect && domSelect.value) {
            activeId = domSelect.value;
        }
    }

    let profiles = [];
    if (ctx.ConnectionManagerRequestService && typeof ctx.ConnectionManagerRequestService.getSupportedProfiles === 'function') {
        profiles = ctx.ConnectionManagerRequestService.getSupportedProfiles();
    } else {
        profiles = ctx.extensionSettings?.connectionManager?.profiles || [];
    }

    let activeProfileName = 'default';
    let activeProfileData = null;
    if (activeId && activeId !== 'default' && activeId !== 'gui') {
        const found = profiles.find(p => p.id === activeId);
        activeProfileName = found ? found.name : activeId;
        if (found) {
            activeProfileData = JSON.parse(JSON.stringify(found));
            if (activeProfileData['secret-id']) activeProfileData['secret-id'] = '***REDACTED***';
        }
    }

    let sessionMsgs = 0;
    try { sessionMsgs = getCurrentSession()?.messages?.length || 0; } catch(_) {}

    const disabledExts = ctx.extensionSettings?.disabledExtensions || [];
    const allExts = Object.keys(ctx.extensionSettings || {}).filter(k => k !== 'disabledExtensions' && typeof ctx.extensionSettings[k] === 'object');
    const enabledExtensions = allExts.filter(ext => !disabledExts.includes(ext));

    const stEnv = {
        stVersion: document.getElementById('st_version')?.textContent?.trim() || document.querySelector('.drawer-version')?.textContent?.trim() || window.system_version || 'unknown',
        userAgent: navigator.userAgent,
        mainApi: ctx.api_server || document.getElementById('main_api')?.value || 'unknown',
        stMaxContext: ctx.chatCompletionSettings?.openai_max_context || ctx.textCompletionSettings?.max_context || window.token_max || 'unknown',
        stStreamingEnabled: ctx.textCompletionSettings?.streaming || ctx.chatCompletionSettings?.stream_openai || false,
        enabledExtensions: enabledExtensions,
        characterId: ctx.characterId,
        chatId: ctx.chatId,
        stChatLength: ctx.chat?.length || 0,
        copilotSessionMsgs: sessionMsgs,
        hasActiveSessionOverrides: hasSessionOverrides(),
        activeConnectionProfile: activeProfileName,
        activeConnectionProfileData: activeProfileData,
        connectionProfiles: profiles.map(p => ({
            id: p.id,
            name: p.name,
            type: p.type || p.api || 'unknown',
        }))
    };

    const lines = [
        '=== ST-Copilot Debug Log ===',
        `Version: ${extVersion} | Session Start: ${DBG_STATE.sessionStart} | Downloaded: ${new Date().toISOString()}`,
        `Entries: ${DBG_STATE.log.length} / ${DBG_STATE.MAX} max`,
        '='.repeat(70),
        '=== SillyTavern Global Environment ===',
        JSON.stringify(stEnv, null, 2),
        '='.repeat(70), ''
    ];
    for (const e of DBG_STATE.log) {
        const d = new Date(e.ts);
        const t = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}.${String(d.getMilliseconds()).padStart(3,'0')}`;
        lines.push(`[${t}] ── ${e.type}`);
        lines.push(typeof e.payload === 'string' ? e.payload : JSON.stringify(e.payload, null, 2));
        lines.push('');
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `st-copilot-debug-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toastr.success('Debug log downloaded.', EXT_DISPLAY);
}