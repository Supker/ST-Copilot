import { 
    EXT_NAME, 
    EXT_DISPLAY, 
    DEFAULT_SYSTEM_PROMPT, 
    DEFAULT_MEMORY_PROMPT, 
    DEFAULT_LB_MANAGE_PROMPT, 
    THEME_PRESETS 
} from './constants.js';
import { _dbgAdd, _dbgDiffSettings } from './utils/util-debug.js';

// ─── Settings ───────────────────────────────────────────────────────────────
export function getSettings() {
    const { extensionSettings } = SillyTavern.getContext();
    if (!extensionSettings[EXT_NAME]) extensionSettings[EXT_NAME] = {};
    const s = extensionSettings[EXT_NAME];
    const defaults = {
        enabled: true,
        performanceMode: false,
        windowVisible: false,
        minimized: false,
        windowX: null, windowY: null,
        iconX: null, iconY: null,
        windowW: 440, windowH: 600,
        opacity: 95,
        hotkey: 'Alt+Shift+C',
        hotkeyEnabled: true,
        searchHotkey: 'Ctrl+F',
        searchHotkeyEnabled: true,
        contextDepth: 15,
        localHistoryLimit: 50,
        connectionSource: 'default',
        connectionProfileId: '',
        customUrl: 'http://localhost:5000/v1',
        customKey: '',
        customModel: '',
        maxTokens: 8048,
        includeSystemPrompt: false,
        includeAuthorsNote: true,
        includeCharacterCard: true,
        includeUserPersonality: true,
        includeAlternateSwipes: false,
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        memoryManagePrompt: DEFAULT_MEMORY_PROMPT,
        profiles: {},
        activeProfile: '',
        profileBindings: {},
        customTheme: { ...THEME_PRESETS.default },
        savedThemes: {},
        activeThemeProfile: '',
        sessions: {},
        lorebookEnabled: true,
        lorebookAutoKeyword: true,
        lorebookSelectedBooks: [],
        lorebookEntryOverrides: {},
        lorebookAIManageEnabled: true,
        lorebookManagePrompt: DEFAULT_LB_MANAGE_PROMPT,
        lorebookSTScanDepth: 5,
        lorebookCopilotScanDepth: 6,
        floatingIconPersistent: false,
        reasoningTrimStrings: '',
        ghostModeOpacity: 15,
        ghostModeHotkey: 'Alt+Shift+G',
        ghostModeHotkeyEnabled: true,
        quickPromptsVisible: false,
        quickPrompts: [
            { id: 'qp_d1', label: 'Analyze', icon: '🔍', text: 'Analyze the current scene and character motivations in detail.' },
            { id: 'qp_d2', label: 'Ideas', icon: '💡', text: 'Give me 3 creative plot twist ideas for the current scene.' },
            { id: 'qp_d3', label: 'Summary', icon: '📋', text: 'Summarize everything that has happened in the roleplay so far.' },
            { id: 'qp_d4', label: 'Feelings', icon: '💭', text: 'What is {{char}} likely feeling right now and why?' },
            { id: 'qp_d5', label: 'Next?', icon: '🎯', text: 'What are the most interesting directions the story could go next?' },
        ],
        quickPromptSets: {},
        activeQuickPromptSet: '',
        promptPresets: {},
        stats: { g:{}, c:{}, ch:{} },
        changelogAutoShow: true,
        lastSeenVersion: '',
        starredMessages: {},
        forceStreaming: 'auto',
        applyRegexToContext: true,
        charEditAIEnabled: true,
        charEditPrompt: '',
        charEditFields: {
            tags: true, description: true, personality: true,
            scenario: true, first_mes: true, mes_example: true,
            alternate_greetings: false, authors_note: true,
        },
        completionSound: 'none',
        completionSoundVolume: 80,
        completionSoundOnlyWhenUnfocused: false,
        wobbleWindow: false,
        altGreetingIndices: [],
        chatEditAIEnabled: true,
        chatEditPrompt: '',
        lorebookExcludedBooks: [],
        windowBgUrl: '',
        windowBgDim: 50,
        windowBgType: 'none',
        pickerPreviewLines: 1,
        pickerPreviewLastLines: 0,
        imageAnalysisMode: 'direct',
        attachedFiles: [],
        memoryEnabled: true,
        memoryInject: true,
        memoryScope: 'global',
        memoryTag: 'memory-update',
        memoryNotify: true,
        memories: {},
        toolsEnabled: true,
        toolsThinking: false,
        toolsMaxRounds: 5,
        toolsEnabled_search_chat: true,
        toolsEnabled_search_lorebook: true,
        toolsEnabled_ask_user: true,
        toolsEnabled_get_char_info: true,
        toolsEnabled_get_chat_stats: true,
        toolsEnabled_get_recent_messages: true,
        includeSummaryception: true,
        useAspectEvolutia: true,
        autoExpandMacros: false,
        includeHiddenMessages: false,
    };
    for (const [k, v] of Object.entries(defaults)) {
        if (s[k] === undefined) s[k] = v;
    }
    return s;
}

export function saveSettings() {
    SillyTavern.getContext().saveSettingsDebounced();
    _dbgDiffSettings();
}

// ─── ST Context Helpers ─────────────────────────────────────────────────────
export function getBindingKey() {
    const ctx = SillyTavern.getContext();
    let charId = 'global';
    if (ctx.characterId !== undefined && ctx.characterId !== null) {
        charId = String(ctx.characterId);
    } else if (typeof window.this_chid !== 'undefined' && window.this_chid !== null) {
        charId = String(window.this_chid);
    }

    let chatId = 'default';
    try {
        if (typeof window.chat_file_name === 'string' && window.chat_file_name) {
            chatId = String(window.chat_file_name);
        } else if (typeof ctx.getCurrentChatId === 'function') {
            const r = ctx.getCurrentChatId(); if (r) chatId = String(r);
        }
        
        if (chatId === 'default' || !chatId) {
            if (ctx.chatId) chatId = String(ctx.chatId);
            else if (typeof window.chat_id !== 'undefined' && window.chat_id !== null) chatId = String(window.chat_id);
        }
    } catch (_) {}
    
    return { charId, chatId };
}

// ─── Session Override System ─────────────────────────────────────────────────
export function getSessionOverrides() {
    try { return getActiveSession(false)?.overrides || {}; } catch(_) { return {}; }
}

export function getEffectiveSettings() {
    return { ...getSettings(), ...getSessionOverrides() };
}

export function setSessionOverride(key, value) {
    try {
        const sess = getCurrentSession();
        if (!sess) return;
        if (!sess.overrides) sess.overrides = {};
        if (value === undefined || value === null) delete sess.overrides[key];
        else sess.overrides[key] = value;
        saveSessionsToMetadata();
        import('./ui/ui-settings.js').then(m => m.updateSessionOverrideIndicator());
    } catch(_) {}
}

export function clearAllSessionOverrides() {
    try {
        const sess = getCurrentSession();
        if (!sess) return;
        sess.overrides = {};
        saveSessionsToMetadata();
        import('./ui/ui-settings.js').then(m => m.updateSessionOverrideIndicator());
    } catch(_) {}
}

export function hasSessionOverrides() {
    try { const o = getActiveSession(false)?.overrides; return !!(o && Object.keys(o).length > 0); }
    catch(_) { return false; }
}

// ─── Storage Subsystem ─────────────────────────────
let _inMemoryBucket = { activeSessionId: null, sessions: [] };
let _currentFileId = null;
let _bucketDirty = false;
let _commitTimer = null;

export async function saveSessionFile(file_id, payload) {
    const ctx = SillyTavern.getContext();
    try {
        const jsonStr = JSON.stringify(payload);
        const b64 = btoa(unescape(encodeURIComponent(jsonStr)));
        const res = await fetch('/api/files/upload', {
            method: 'POST',
            headers: { ...ctx.getRequestHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: file_id, data: b64 })
        });
        return res.ok;
    } catch (e) {
        _dbgAdd('STORAGE_WRITE_FAILED', { file_id, error: e.message });
        console.error(`[${EXT_DISPLAY}] saveSessionFile error:`, e);
        return false;
    }
}

export async function loadSessionFile(file_id) {
    try {
        const res = await fetch(`/user/files/${file_id}`);
        if (!res.ok) return null;
        return await res.json();
    } catch (e) {
        console.error(`[${EXT_DISPLAY}] loadSessionFile error:`, e);
        return null;
    }
}

export async function initChatBucket() {
    const ctx = SillyTavern.getContext();
    if (!ctx.chatMetadata) ctx.chatMetadata = {};
    const { charId, chatId } = getBindingKey();
    const s = getSettings();
    
    let meta = ctx.chatMetadata.st_copilot;
    const safeChatId = chatId.replace(/[^a-zA-Z0-9_-]/g, '_');
    
    let v0Data = null;
    if (s.sessions && s.sessions[charId]) {
        if (s.sessions[charId][chatId] && s.sessions[charId][chatId].sessions?.length > 0) {
            v0Data = { ...s.sessions[charId][chatId] };
            delete s.sessions[charId][chatId];
        } else if (s.sessions[charId]['unified'] && s.sessions[charId]['unified'].sessions?.length > 0) {
            v0Data = { ...s.sessions[charId]['unified'] };
            delete s.sessions[charId]['unified'];
        }
        if (v0Data) saveSettings();
    }

    if (!meta && v0Data) {
        _dbgAdd('LEGACY_MIGRATION_STARTED');
        meta = { activeSessionId: v0Data.activeSessionId, sessions: v0Data.sessions };
    }

    if (!meta) {
        _inMemoryBucket = { activeSessionId: null, sessions: [] };
        _currentFileId = `copilot_sess_${safeChatId}_${Date.now()}.json`;
        ctx.chatMetadata.st_copilot = { file_id: _currentFileId };
        if (typeof ctx.saveMetadata === 'function') ctx.saveMetadata();
        await commitBucketChanges(true);
        return;
    }

    if (meta.file_id) {
        _currentFileId = meta.file_id;
        const payload = await loadSessionFile(meta.file_id);
        if (payload && payload.bucket) {
            _inMemoryBucket = payload.bucket;
        } else {
            _inMemoryBucket = { activeSessionId: null, sessions: [] };
            await commitBucketChanges(true);
        }
    } else if (meta.sessions) { 
        _inMemoryBucket = { activeSessionId: meta.activeSessionId, sessions: meta.sessions };
        _currentFileId = `copilot_sess_${safeChatId}_${Date.now()}.json`;
        ctx.chatMetadata.st_copilot = { file_id: _currentFileId };
        delete meta.sessions;
        delete meta.activeSessionId; 
        if (typeof ctx.saveMetadata === 'function') ctx.saveMetadata();
        await commitBucketChanges(true);
    } else {
        _inMemoryBucket = { activeSessionId: null, sessions: [] };
        _currentFileId = `copilot_sess_${safeChatId}_${Date.now()}.json`;
        ctx.chatMetadata.st_copilot = { file_id: _currentFileId };
        if (typeof ctx.saveMetadata === 'function') ctx.saveMetadata();
        await commitBucketChanges(true);
    }
}

export async function commitBucketChanges(force = false) {
    _bucketDirty = true;
    
    const doCommit = async () => {
        if (!_bucketDirty) return;
        const ctx = SillyTavern.getContext();
        const { chatId } = getBindingKey();
        
        if (!ctx.chatMetadata) ctx.chatMetadata = {};
        if (!ctx.chatMetadata.st_copilot && _currentFileId) {
            ctx.chatMetadata.st_copilot = { file_id: _currentFileId };
        }
        
        let file_id = ctx.chatMetadata?.st_copilot?.file_id || _currentFileId;
        
        if (!file_id) {
            const safeChatId = chatId.replace(/[^a-zA-Z0-9_-]/g, '_');
            file_id = `copilot_sess_${safeChatId}_${Date.now()}.json`;
            _currentFileId = file_id;
            ctx.chatMetadata.st_copilot = { file_id };
        }
        
        if (ctx.chatMetadata.st_copilot?.file_id !== file_id) {
            ctx.chatMetadata.st_copilot = { file_id };
        }
        
        if (typeof ctx.saveMetadata === 'function') ctx.saveMetadata();
        
        const payload = {
            _version: 2,
            chat_id_reference: chatId,
            updated_at: Date.now(),
            bucket: _inMemoryBucket
        };
        
        const success = await saveSessionFile(file_id, payload);
        if (success) _bucketDirty = false;
        else _dbgAdd('STORAGE_WRITE_FAILED', { file_id, reason: 'saveSessionFile returned false' });
    };

    if (force) {
        await doCommit();
    } else {
        clearTimeout(_commitTimer);
        _commitTimer = setTimeout(doCommit, 1000);
    }
}

export function saveSessionsToMetadata() {
    commitBucketChanges();
}

export function getChatBucket() {
    return _inMemoryBucket;
}

// ─── Session Helpers ─────────────────────────────────────────────────────────

export function genId(prefix) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

export function createSession(name, isTemporary = false, recordStats = true) {
    const bucket = getChatBucket();
    const id = genId('sess');
    const sess = { id, name: name || `Session ${bucket.sessions.length + 1}`, created: Date.now(), messages: [], isTemporary };
    
    if (recordStats) {
        const prev = bucket.sessions.find(s => s.id === bucket.activeSessionId);
        if (prev && prev.isTemporary) {
            bucket.sessions = bucket.sessions.filter(s => s.id !== prev.id);
        }
    }

    bucket.sessions.push(sess);
    bucket.activeSessionId = id;
    
    if (recordStats) {
        import('./features/feature-stats.js').then(m => m.recordStat(m.SM.sess));
    }
    saveSessionsToMetadata();
    _dbgAdd('SESSION_CREATED', { id: sess.id, name: sess.name, isTemporary });
    return sess;
}

export function getActiveSession(autoCreate = true) {
    const bucket = getChatBucket();
    if (!bucket.sessions.length || !bucket.activeSessionId) {
        return autoCreate ? createSession(undefined, false, false) : null;
    }
    const sess = bucket.sessions.find(s => s.id === bucket.activeSessionId);
    if (sess) return sess;
    return autoCreate ? createSession(undefined, false, false) : null;
}

export function setActiveSession(sessionId) {
    const bucket = getChatBucket();
    if (!bucket.sessions.find(s => s.id === sessionId)) return;
    const prev = bucket.sessions.find(s => s.id === bucket.activeSessionId);
    if (prev && prev.isTemporary && prev.id !== sessionId) {
        bucket.sessions = bucket.sessions.filter(s => s.id !== prev.id);
    }
    bucket.activeSessionId = sessionId;
    saveSessionsToMetadata();
    _dbgAdd('SESSION_SWITCHED', { id: sessionId });
}

export function deleteCurrentSession() {
    const bucket = getChatBucket();
    if (!bucket.sessions.length) return createSession();
    const deletedId = bucket.activeSessionId;
    bucket.sessions = bucket.sessions.filter(s => s.id !== bucket.activeSessionId);
    bucket.activeSessionId = bucket.sessions.length ? bucket.sessions[bucket.sessions.length - 1].id : null;
    saveSessionsToMetadata();
    _dbgAdd('SESSION_DELETED', { id: deletedId });
    return getActiveSession(true);
}

export function getCurrentSession() {
    return getActiveSession(true);
}

export function addMessage(session, role, content, extra = {}) {
    const msg = { id: genId('msg'), role, content, timestamp: Date.now(), ...extra };
    session.messages.push(msg); 
    if (session.messages.length > 400) session.messages = session.messages.slice(-400);
    saveSessionsToMetadata(); 
    return msg;
}

export function insertMessageAfter(session, afterMsgId, role, content, extra = {}) {
    const msg = { id: genId('msg'), role, content, timestamp: Date.now(), ...extra };
    const idx = afterMsgId ? session.messages.findIndex(m => m.id === afterMsgId) : -1;
    if (idx !== -1) session.messages.splice(idx + 1, 0, msg);
    else session.messages.push(msg);
    if (session.messages.length > 400) session.messages = session.messages.slice(-400);
    saveSessionsToMetadata();
    return msg;
}

export function updateMessage(session, msgId, newContent) {
    const msg = session.messages.find(m => m.id === msgId);
    if (msg) { msg.content = newContent; saveSessionsToMetadata(); }
}

export function truncateAfter(session, msgId) {
    const idx = session.messages.findIndex(m => m.id === msgId);
    if (idx !== -1) { session.messages.splice(idx + 1); saveSessionsToMetadata(); }
}

export function deleteMsg(session, msgId) {
    const idx = session.messages.findIndex(m => m.id === msgId);
    if (idx !== -1) { session.messages.splice(idx, 1); saveSessionsToMetadata(); }
}

export function truncateFrom(session, msgId) {
    const idx = session.messages.findIndex(m => m.id === msgId);
    if (idx !== -1) { session.messages.splice(idx); saveSessionsToMetadata(); }
}

// ─── Macro Expansion Helper ────────────────────────────────────────────────

export function expandMacros(text) {
    if (!text) return text;
    try {
        const ctx = SillyTavern.getContext();
        if (typeof ctx.substituteParams === 'function') {
            return ctx.substituteParams(text);
        }
        if (typeof window.substituteParams === 'function') {
            return window.substituteParams(text, ctx.name1, ctx.name2);
        }
    } catch (e) {
        console.warn(`[${EXT_DISPLAY}] Macro expansion error:`, e);
    }
    try {
        const ctx = SillyTavern.getContext();
        const char = ctx.characters?.[ctx.characterId];
        const d = char?.data || {};
        const now = new Date();
        return text
            .replace(/\{\{user\}\}/gi, ctx.name1 || 'User')
            .replace(/\{\{char\}\}/gi, char?.name || ctx.name2 || 'Character')
            .replace(/\{\{time\}\}/gi, now.toLocaleTimeString())
            .replace(/\{\{date\}\}/gi, now.toLocaleDateString())
            .replace(/\{\{isodate\}\}/gi, now.toISOString().split('T')[0])
            .replace(/\{\{isotime\}\}/gi, now.toTimeString().slice(0, 5))
            .replace(/\{\{lastMessage\}\}/gi, () => {
                const msgs = ctx.chat;
                return msgs?.[msgs.length - 1]?.mes || '';
            })
            .replace(/\{\{lastUserMessage\}\}/gi, () => {
                const msgs = ctx.chat;
                if (!msgs) return '';
                for (let i = msgs.length - 1; i >= 0; i--) {
                    if (msgs[i].is_user) return msgs[i].mes || '';
                }
                return '';
            })
            .replace(/\{\{lastCharMessage\}\}/gi, () => {
                const msgs = ctx.chat;
                if (!msgs) return '';
                for (let i = msgs.length - 1; i >= 0; i--) {
                    if (!msgs[i].is_user) return msgs[i].mes || '';
                }
                return '';
            })
            .replace(/\{\{description\}\}/gi, d.description || char?.description || '')
            .replace(/\{\{personality\}\}/gi, d.personality || char?.personality || '')
            .replace(/\{\{scenario\}\}/gi, d.scenario || char?.scenario || '');
    } catch (_) {
        return text;
    }
}

import { showCustomDialog, escHtml } from './utils/util-dom.js';

export function exportCurrentSession() {
    try {
        const sess = getCurrentSession();
        const { charId, chatId } = getBindingKey();
        const ctx = SillyTavern.getContext();
        const charName = ctx.characters?.[ctx.characterId]?.name || 'unknown';
        const exportData = {
            version: 1,
            exported: new Date().toISOString(),
            charName,
            session: JSON.parse(JSON.stringify(sess)),
        };
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const safeName = sess.name.replace(/[^a-z0-9]/gi, '_').slice(0, 40) || 'session';
        a.download = `st-copilot-session-${safeName}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toastr.success('Session exported.', EXT_DISPLAY);
    } catch (e) {
        toastr.error(`Export failed: ${e.message}`, EXT_DISPLAY);
    }
}

export function importSession(onSuccessCallback) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json';
    inp.onchange = async () => {
        const file = inp.files?.[0]; if (!file) return;
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            if (!data.session || !data.session.id || !Array.isArray(data.session.messages)) {
                toastr.error('Invalid session file.', EXT_DISPLAY); return;
            }
            const ok = await showCustomDialog({
                type: 'confirm',
                title: 'Import Session',
                message: `Import session "${data.session.name || 'unnamed'}"${data.charName ? ` (from ${data.charName})` : ''}? It will be added to the current chat metadata.`,
            });
            if (!ok) return;
            const bucket = getChatBucket();
            const imported = { ...data.session, id: genId('sess'), name: `${data.session.name || 'Imported'} (imported)` };
            imported.isTemporary = false;
            bucket.sessions.push(imported);
            bucket.activeSessionId = imported.id;
            saveSessionsToMetadata();
            toastr.success(`Session "${escHtml(imported.name)}" imported.`, EXT_DISPLAY);
            if (onSuccessCallback) onSuccessCallback();
        } catch (e) {
            toastr.error(`Import failed: ${e.message}`, EXT_DISPLAY);
        }
    };
    inp.click();
}

export function showSessionDialog({ defaultName = '' } = {}) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'scp-dialog-overlay';
        overlay.innerHTML = `
            <div class="scp-dialog-box">
                <div class="scp-dialog-title">New Session</div>
                <div class="scp-dialog-msg">Session name:</div>
                <input type="text" class="scp-dialog-input" value="${escHtml(defaultName)}" placeholder="${escHtml(defaultName)}">
                <label class="scp-sess-tmp-label">
                    <div class="scp-lb-toggle" id="scp-sess-tmp-toggle"><div class="scp-lb-toggle-knob"></div></div>
                    <span>Temporary — auto-delete when switching</span>
                </label>
                <div class="scp-dialog-btns">
                    <button class="scp-dialog-btn scp-dialog-cancel">Cancel</button>
                    <button class="scp-dialog-btn scp-dialog-ok">Create</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        let isTemporary = false;
        const toggle = overlay.querySelector('#scp-sess-tmp-toggle');
        toggle.addEventListener('click', () => {
            isTemporary = !isTemporary;
            toggle.classList.toggle('active', isTemporary);
        });
        const input = overlay.querySelector('.scp-dialog-input');
        const okBtn = overlay.querySelector('.scp-dialog-ok');
        const cancelBtn = overlay.querySelector('.scp-dialog-cancel');
        const close = val => { overlay.classList.remove('visible'); setTimeout(() => overlay.remove(), 150); resolve(val); };
        input.focus(); input.select();
        okBtn.addEventListener('click', () => close({ name: input.value, isTemporary }));
        cancelBtn.addEventListener('click', () => close(null));
        overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); close({ name: input.value, isTemporary }); }
            if (e.key === 'Escape') close(null);
        });
        requestAnimationFrame(() => overlay.classList.add('visible'));
    });
}

export function getSessionFavKey() {
    const { charId, chatId } = getBindingKey();
    return `${charId} ${chatId}`;
}

export function getStarredMessages() {
    const s = getSettings();
    const key = getSessionFavKey();
    if (!s.starredMessages[key]) s.starredMessages[key] = [];
    return s.starredMessages[key];
}

export function isMessageStarred(msgId) {
    return getStarredMessages().includes(msgId);
}

export function toggleStarMessage(msgId) {
    const s = getSettings();
    const key = getSessionFavKey();
    if (!s.starredMessages[key]) s.starredMessages[key] = [];
    const arr = s.starredMessages[key];
    const idx = arr.indexOf(msgId);
    if (idx >= 0) arr.splice(idx, 1);
    else arr.push(msgId);
    saveSettings();
    return idx < 0; // true = now starred
}