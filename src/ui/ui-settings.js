import { THEME_PRESETS, THEME_VAR_DEFS, THEME_CSS_MAP, EXT_DISPLAY, DEFAULT_SYSTEM_PROMPT, DEFAULT_CHAR_EDIT_DIRECTIVE, DEFAULT_LB_MANAGE_PROMPT, DEFAULT_CHAT_EDIT_DIRECTIVE, TOOL_DEFINITIONS, DEFAULT_TOOLS_PROMPT, DEFAULT_MEMORY_PROMPT, I } from '../constants.js';
import { state } from '../state.js';
import { getSettings, saveSettings, getEffectiveSettings, setSessionOverride, clearAllSessionOverrides, getBindingKey, hasSessionOverrides, saveSessionsToMetadata, getCurrentSession, getSessionOverrides, getChatBucket } from '../session.js';
import { showCustomDialog, escHtml } from '../utils/util-dom.js';
import { showColorPicker } from '../utils/util-colorpicker.js';
import { _dbgAdd } from '../utils/util-debug.js';

// ─── Sounds ───────────────────────────────────────────────────────────────────

export const _SOUND_PRESETS = {
    none:    { label: 'None' },
    chime:   { label: 'Chime' },
    bell:    { label: 'Bell' },
    soft:    { label: 'Soft Ping' },
    digital: { label: 'Digital Blip' },
    pop:     { label: 'Pop' },
};

function _synthSound(type, volume = 80) {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const masterGain = ctx.createGain();
        masterGain.gain.value = Math.max(0, Math.min(1, volume / 100));
        masterGain.connect(ctx.destination);
        const now = ctx.currentTime;

        if (type === 'chime') {
            [523.25, 659.25, 783.99].forEach((freq, i) => {
                const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
                const og = ctx.createGain();
                o.connect(og); og.connect(masterGain);
                og.gain.setValueAtTime(0, now + i * 0.12);
                og.gain.linearRampToValueAtTime(0.18, now + i * 0.12 + 0.02);
                og.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.5);
                o.start(now + i * 0.12); o.stop(now + i * 0.12 + 0.5);
            });
        } else if (type === 'bell') {
            const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 880;
            const og = ctx.createGain();
            o.connect(og); og.connect(masterGain);
            og.gain.setValueAtTime(0.25, now);
            og.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
            o.start(now); o.stop(now + 1.2);
        } else if (type === 'soft') {
            const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 660;
            const og = ctx.createGain();
            o.connect(og); og.connect(masterGain);
            og.gain.setValueAtTime(0, now);
            og.gain.linearRampToValueAtTime(0.15, now + 0.05);
            og.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
            o.start(now); o.stop(now + 0.4);
        } else if (type === 'digital') {
            [440, 880].forEach((freq, i) => {
                const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = freq;
                const og = ctx.createGain();
                o.connect(og); og.connect(masterGain);
                og.gain.setValueAtTime(0.08, now + i * 0.07);
                og.gain.exponentialRampToValueAtTime(0.001, now + i * 0.07 + 0.12);
                o.start(now + i * 0.07); o.stop(now + i * 0.07 + 0.12);
            });
        } else if (type === 'pop') {
            const o = ctx.createOscillator(); o.type = 'sine';
            o.frequency.setValueAtTime(600, now);
            o.frequency.exponentialRampToValueAtTime(200, now + 0.1);
            const og = ctx.createGain();
            o.connect(og); og.connect(masterGain);
            og.gain.setValueAtTime(0.22, now);
            og.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
            o.start(now); o.stop(now + 0.15);
        }
        setTimeout(() => ctx.close(), 2000);
    } catch (_) {}
}

// ─── Configuration Profiles ───────────────────────────────────────────────────

const _PROFILE_KEYS = [
    'systemPrompt', 'includeSystemPrompt', 'includeAuthorsNote', 
    'includeCharacterCard', 'includeUserPersonality', 'contextDepth', 
    'localHistoryLimit', 'connectionSource', 'connectionProfileId', 'maxTokens',
    'applyRegexToContext', 'reasoningTrimStrings', 'forceStreaming',
    'charEditAIEnabled', 'charEditPrompt', 'lorebookAIManageEnabled',
    'lorebookManagePrompt', 'lorebookAutoKeyword', 'lorebookSTScanDepth',
    'lorebookCopilotScanDepth', 'chatEditAIEnabled', 'chatEditPrompt', 'includeAlternateSwipes'
];

let _profileSnapshot = null;

export function _takeProfileSnapshot() {
    const s = getSettings();
    _profileSnapshot = {};
    for (const k of _PROFILE_KEYS) _profileSnapshot[k] = JSON.stringify(s[k]);
    _profileSnapshot._charEditFields = JSON.stringify(s.charEditFields || {});
}

export function isConfigProfileDirty() {
    if (!_profileSnapshot) return false;
    const s = getSettings();
    for (const k of _PROFILE_KEYS) {
        if (JSON.stringify(s[k]) !== _profileSnapshot[k]) return true;
    }
    if (JSON.stringify(s.charEditFields || {}) !== _profileSnapshot._charEditFields) return true;
    return false;
}

export function _markDirty(type) {
    if (type === 'config') state.configDirty = isConfigProfileDirty();
    if (type === 'theme') state.themeDirty = isThemeDirty();
    _updateDirtyDots();
}

export function _clearDirty(type) {
    if (type === 'config') { state.configDirty = false; _takeProfileSnapshot(); }
    if (type === 'theme') state.themeDirty = false;
    _updateDirtyDots();
}

export function _updateDirtyDots() {
    const configDot = '<span class="scp-save-dirty-dot"></span>';
    ['scp-profile-save', 'scp-sp-profile-save'].forEach(id => {
        const btn = document.getElementById(id); if (!btn) return;
        btn.querySelectorAll('.scp-save-dirty-dot').forEach(d => d.remove());
        if (state.configDirty) btn.insertAdjacentHTML('beforeend', configDot);
    });
    document.querySelectorAll('#scp-theme-save').forEach(btn => {
        btn.querySelectorAll('.scp-save-dirty-dot').forEach(d => d.remove());
        if (state.themeDirty) btn.insertAdjacentHTML('beforeend', configDot);
    });
}

export function saveProfile(name) {
    const s = getSettings();
    const p = {};
    for (const k of _PROFILE_KEYS) p[k] = s[k];
    p.charEditFields = JSON.parse(JSON.stringify(s.charEditFields || {}));
    s.profiles[name] = p;
    s.activeProfile = name; 
    saveSettings();
}

export function loadProfile(name) {
    const s = getSettings(); const p = s.profiles[name]; if (!p) return;
    for (const k of _PROFILE_KEYS) {
        if (p[k] !== undefined) s[k] = p[k];
    }
    if (p.charEditFields) s.charEditFields = JSON.parse(JSON.stringify(p.charEditFields));
    s.activeProfile = name;
    saveSettings();
    if (typeof updateSettingsUI === 'function') updateSettingsUI();
    _takeProfileSnapshot();
    state.configDirty = false;
    _updateDirtyDots();
}

export function deleteProfile(name) {
    const s = getSettings(); delete s.profiles[name];
    if (s.activeProfile === name) s.activeProfile = '';
    for (const k in s.profileBindings) { if (s.profileBindings[k] === name) delete s.profileBindings[k]; }
    saveSettings();
}

export function refreshProfilesDropdown() {
    const sel = document.getElementById('scp-profile-select'); if (!sel) return;
    const s = getSettings();

    if (Object.keys(s.profiles).length === 0) {
        s.profiles['Default'] = {
            systemPrompt: DEFAULT_SYSTEM_PROMPT, includeSystemPrompt: true,
            includeAuthorsNote: true, includeCharacterCard: true,
            includeUserPersonality: true, contextDepth: 15,
            localHistoryLimit: 50,
            connectionSource: 'default', connectionProfileId: '',
            maxTokens: 8200,
            applyRegexToContext: true,
        };
        s.activeProfile = 'Default';
        saveSettings();
    }

    sel.innerHTML = '';
    let hasActive = false;

    for (const name of Object.keys(s.profiles)) {
        const opt = document.createElement('option');
        opt.value = name; opt.textContent = name;
        if (name === s.activeProfile) {
            opt.selected = true;
            hasActive = true;
        }
        sel.appendChild(opt);
    }

    if (!hasActive && Object.keys(s.profiles).length > 0) {
        const first = Object.keys(s.profiles)[0];
        loadProfile(first);
        sel.value = first;
    }

    updateBindingSection();
}

export function updateBindingSection() {
    const sel = document.getElementById('scp-profile-select'); 
    const section = document.getElementById('scp-binding-section');
    if (!section) return;
    const hasProfile = sel?.value;
    section.style.display = hasProfile ? '' : 'none';
    if (!hasProfile) return;
    const s = getSettings(); const { charId, chatId } = getBindingKey();
    const charKey = `char_${charId}`; const chatKey = `chat_${charId}_${chatId}`;
    const charBtn = document.getElementById('scp-bind-char'); const chatBtn = document.getElementById('scp-bind-chat');
    if (charBtn) charBtn.classList.toggle('active', s.profileBindings[charKey] === sel.value);
    if (chatBtn) chatBtn.classList.toggle('active', s.profileBindings[chatKey] === sel.value);
}

export function autoLoadBoundProfile() {
    const s = getSettings(); const { charId, chatId } = getBindingKey();
    const name = s.profileBindings[`chat_${charId}_${chatId}`] || s.profileBindings[`char_${charId}`];
    if (name && s.profiles[name]) {
        loadProfile(name);
        const sel = document.getElementById('scp-profile-select'); if (sel) sel.value = name;
    } else if (name && !s.profiles[name]) {
        _dbgAdd('PROFILE_LOAD_BINDING_MISSING', { name });
    }
}

export async function updateProfilesList() {
    const profSel = document.getElementById('scp-conn-profile'); if (!profSel) return;
    const ctx = SillyTavern.getContext();
    const s = getSettings();
    let currentVal = s.connectionProfileId || '';

    const service = ctx.ConnectionManagerRequestService;
    
    let profiles = [];
    if (service && typeof service.getSupportedProfiles === 'function') {
        profiles = service.getSupportedProfiles();
    } else {
        profiles = ctx.extensionSettings?.connectionManager?.profiles || [];
    }

    if (currentVal && !profiles.some(p => p.id === currentVal)) {
        _dbgAdd('PROFILE_GHOST_CLEANUP', { removedId: currentVal });
        s.connectionProfileId = '';
        saveSettings();
        currentVal = '';
    }

    if (service && typeof service.handleDropdown === 'function') {
        service.handleDropdown(profSel);
        if (currentVal && Array.from(profSel.options).some(o => o.value === currentVal)) {
            profSel.value = currentVal;
        }
        return;
    }

    profSel.innerHTML = '<option value="">-- Select Profile --</option>';
    if (profiles && profiles.length > 0) {
        profiles.forEach(p => {
            const newOpt = document.createElement('option');
            newOpt.value = p.id;
            newOpt.textContent = p.name;
            profSel.appendChild(newOpt);
        });
    }
    if (Array.from(profSel.options).some(o => o.value === currentVal)) profSel.value = currentVal;
}

export async function updateSPConnProfileList() {
    const selIds = ['scp-sp-conn-profile', 'scp-sp-ov-conn-profile'];
    const s = getSettings();
    const eff = getEffectiveSettings();
    const ctx = SillyTavern.getContext();
    const service = ctx.ConnectionManagerRequestService;

    let profiles = [];
    if (service && typeof service.getSupportedProfiles === 'function') {
        profiles = service.getSupportedProfiles();
    } else {
        profiles = ctx.extensionSettings?.connectionManager?.profiles || [];
    }

    selIds.forEach(sid => {
        const sel = document.getElementById(sid); if (!sel) return;
        const isOverride = sid === 'scp-sp-ov-conn-profile';
        let targetVal = isOverride ? (eff.connectionProfileId || '') : (s.connectionProfileId || '');

        if (targetVal && !profiles.some(p => p.id === targetVal)) {
            if (isOverride) {
                setSessionOverride('connectionProfileId', undefined);
            } else {
                s.connectionProfileId = '';
                saveSettings();
            }
            targetVal = '';
        }

        if (service && typeof service.handleDropdown === 'function') {
            profiles = service.getSupportedProfiles();
        } else {
            profiles = ctx.extensionSettings?.connectionManager?.profiles || [];
        }
        sel.innerHTML = '<option value="">-- Select Profile --</option>';
        profiles.forEach(p => { 
            const o = document.createElement('option'); 
            o.value = p.id; 
            o.textContent = p.name; 
            sel.appendChild(o); 
        });
        if (Array.from(sel.options).some(o => o.value === targetVal)) sel.value = targetVal;
    });
}

export function refreshSPProfilesDropdown() {
    const sel = document.getElementById('scp-sp-profile-select'); if (!sel) return;
    const s = getSettings();
    if (!Object.keys(s.profiles).length) {
        s.profiles['Default'] = { systemPrompt: DEFAULT_SYSTEM_PROMPT, includeSystemPrompt: true, includeAuthorsNote: true, includeCharacterCard: true, includeUserPersonality: true, contextDepth: 15, localHistoryLimit: 50, connectionSource: 'default', connectionProfileId: '', maxTokens: 8200, applyRegexToContext: true };
        s.activeProfile = 'Default'; saveSettings();
    }
    sel.innerHTML = '';
    for (const name of Object.keys(s.profiles)) {
        const opt = document.createElement('option'); opt.value = name; opt.textContent = name;
        if (name === s.activeProfile) opt.selected = true;
        sel.appendChild(opt);
    }
    updateSPBindingSection();
}

export function updateSPBindingSection() {
    const sel = document.getElementById('scp-sp-profile-select');
    const section = document.getElementById('scp-sp-binding-section');
    if (!section) return;
    section.style.display = sel?.value ? '' : 'none';
    if (!sel?.value) return;
    const s = getSettings(); const { charId, chatId } = getBindingKey();
    document.getElementById('scp-sp-bind-char')?.classList.toggle('active', s.profileBindings[`char_${charId}`] === sel.value);
    document.getElementById('scp-sp-bind-chat')?.classList.toggle('active', s.profileBindings[`chat_${charId}_${chatId}`] === sel.value);
}

// ─── Theme Editor ────────────────────────────────────────────────────────────

const _COLOR_KEYS = new Set(['bg', 'text', 'textMuted', 'accent', 'accentDim', 'accentBg', 'headerBg', 'toolbarBg', 'msgUserBg', 'msgAiBg', 'inputBg', 'codeBg', 'danger', 'success']);

export function isThemeDirty() {
    const s = getSettings();
    const current = s.customTheme || {};
    
    if (s.activeThemeProfile && s.savedThemes[s.activeThemeProfile]) {
        const saved = s.savedThemes[s.activeThemeProfile];
        return THEME_VAR_DEFS.some(def => (current[def.key] || '') !== (saved[def.key] || ''));
    }
    
    for (const preset of Object.values(THEME_PRESETS)) {
        const isMatch = THEME_VAR_DEFS.every(def => (current[def.key] || '') === (preset[def.key] || ''));
        if (isMatch) return false;
    }
    
    return true;
}

export function buildThemeEditor(containerOverride) {
    const container = containerOverride || document.getElementById('scp-theme-section'); if (!container) return;
    container.innerHTML = '';
    const s = getSettings();

    if (!s.savedThemes || Object.keys(s.savedThemes).length === 0) {
        s.savedThemes = { 'Default': { ...THEME_PRESETS.default } };
        s.activeThemeProfile = 'Default';
        s.customTheme = { ...s.savedThemes['Default'] };
        saveSettings();
    }

    const profileRow = document.createElement('div');
    profileRow.className = 'scp-profile-bar';
    profileRow.style.marginBottom = '12px';
    profileRow.innerHTML = `
        <select id="scp-theme-profile-select"></select>
        <button class="scp-profile-icon-btn" id="scp-theme-save" title="Save current theme parameters"><i class="fa-solid fa-floppy-disk"></i></button>
        <button class="scp-profile-icon-btn" id="scp-theme-create" title="Create new theme from preset"><i class="fa-solid fa-plus"></i></button>
        <button class="scp-profile-icon-btn" id="scp-theme-duplicate" title="Duplicate selected theme"><i class="fa-solid fa-copy"></i></button>
        <button class="scp-profile-icon-btn" id="scp-theme-rename" title="Rename selected theme"><i class="fa-solid fa-pen"></i></button>
        <button class="scp-profile-icon-btn danger" id="scp-theme-delete" title="Delete selected theme"><i class="fa-solid fa-trash"></i></button>
        <button class="scp-profile-icon-btn" id="scp-theme-export" title="Export theme to JSON file"><i class="fa-solid fa-file-export"></i></button>
        <button class="scp-profile-icon-btn" id="scp-theme-import" title="Import theme from JSON file"><i class="fa-solid fa-file-import"></i></button>
    `;
    container.appendChild(profileRow);

    const sel = profileRow.querySelector('#scp-theme-profile-select');

    const optGrpDefault = document.createElement('optgroup');
    optGrpDefault.label = 'Default Presets';
    for (const [key, preset] of Object.entries(THEME_PRESETS)) {
        const opt = document.createElement('option');
        opt.value = `__preset__${key}`;
        opt.textContent = preset.label;
        optGrpDefault.appendChild(opt);
    }
    sel.appendChild(optGrpDefault);

    const userThemeKeys = Object.keys(s.savedThemes);
    if (userThemeKeys.length) {
        const optGrpCustom = document.createElement('optgroup');
        optGrpCustom.label = 'Custom Themes';
        for (const name of userThemeKeys) {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            if (name === s.activeThemeProfile) opt.selected = true;
            optGrpCustom.appendChild(opt);
        }
        sel.appendChild(optGrpCustom);
    }

    if (!s.activeThemeProfile || !s.savedThemes[s.activeThemeProfile]) {
        const matchKey = Object.keys(THEME_PRESETS).find(k =>
            THEME_VAR_DEFS.every(d => (s.customTheme?.[d.key] || '') === (THEME_PRESETS[k][d.key] || ''))
        );
        if (matchKey) sel.value = `__preset__${matchKey}`;
    }

    sel.addEventListener('change', async () => {
        const name = sel.value;

        if (isThemeDirty()) {
            const ok = await showCustomDialog({
                type: 'confirm',
                title: 'Unsaved Changes',
                message: 'You have unsaved changes in your current theme. Are you sure you want to switch?'
            });
            if (!ok) {
                sel.value = s.activeThemeProfile ? s.activeThemeProfile : (Object.keys(THEME_PRESETS).find(k => `__preset__${k}` === sel.value) ? sel.value : '');
                return;
            }
        }

        if (name.startsWith('__preset__')) {
            const presetKey = name.replace('__preset__', '');
            const s2 = getSettings();
            s2.customTheme = { ...THEME_PRESETS[presetKey] };
            s2.activeThemeProfile = '';
            saveSettings(); applyCustomTheme(s2.customTheme); buildThemeEditor(containerOverride);
        } else if (name && getSettings().savedThemes[name]) {
            const s2 = getSettings();
            s2.customTheme = { ...s2.savedThemes[name] };
            s2.activeThemeProfile = name;
            saveSettings(); applyCustomTheme(s2.customTheme); buildThemeEditor(containerOverride);
        }
    });

    profileRow.querySelector('#scp-theme-save').addEventListener('click', async () => {
        const val = sel.value;
        if (val.startsWith('__preset__')) {
            const name = await showCustomDialog({ type: 'prompt', title: 'Save as Custom Theme', message: 'Name for your custom theme:', placeholder: 'My Theme' });
            if (!name?.trim()) return;
            const n = name.trim();
            const s2 = getSettings();
            s2.savedThemes[n] = { ...s2.customTheme };
            s2.activeThemeProfile = n;
            saveSettings(); buildThemeEditor(containerOverride); toastr.success(`Theme "${n}" saved`, EXT_DISPLAY);
            _clearDirty('theme');
        } else if (val) {
            const s2 = getSettings();
            s2.savedThemes[val] = { ...s2.customTheme };
            saveSettings(); toastr.success(`Theme "${val}" updated`, EXT_DISPLAY);
            _clearDirty('theme');
        }
    });

    profileRow.querySelector('#scp-theme-create').addEventListener('click', async () => {
        const name = await showCustomDialog({ type: 'prompt', title: 'New Theme', message: 'Enter name for new custom theme:', placeholder: 'My New Theme' });
        if (!name?.trim()) return;
        const n = name.trim();
        const s2 = getSettings();
        s2.savedThemes[n] = { ...s2.customTheme };
        s2.activeThemeProfile = n;
        saveSettings(); buildThemeEditor(containerOverride); toastr.success(`Created theme "${n}"`, EXT_DISPLAY);
    });

    profileRow.querySelector('#scp-theme-duplicate').addEventListener('click', async () => {
        const val = sel.value;
        if (!val) return;
        const baseTheme = val.startsWith('__preset__') ? THEME_PRESETS[val.replace('__preset__', '')] : s.savedThemes[val];
        if (!baseTheme) return;
        
        const defaultName = (val.startsWith('__preset__') ? THEME_PRESETS[val.replace('__preset__', '')].label : val) + ' (Copy)';
        const name = await showCustomDialog({ type: 'prompt', title: 'Duplicate Theme', message: 'Name for the duplicated theme:', defaultValue: defaultName });
        if (!name?.trim()) return;
        const n = name.trim();
        const s2 = getSettings();
        s2.savedThemes[n] = JSON.parse(JSON.stringify(baseTheme));
        s2.activeThemeProfile = n;
        s2.customTheme = { ...s2.savedThemes[n] };
        saveSettings(); buildThemeEditor(containerOverride); toastr.success(`Theme duplicated as "${n}"`, EXT_DISPLAY);
    });

    profileRow.querySelector('#scp-theme-rename').addEventListener('click', async () => {
        const val = sel.value;
        if (!val || val.startsWith('__preset__')) { toastr.info('Select a custom theme to rename.', EXT_DISPLAY); return; }
        const newName = await showCustomDialog({ type: 'prompt', title: 'Rename Theme', message: 'Enter new name:', defaultValue: val });
        if (!newName?.trim() || newName.trim() === val) return;
        const n = newName.trim();
        const s2 = getSettings();
        s2.savedThemes[n] = s2.savedThemes[val];
        delete s2.savedThemes[val];
        s2.activeThemeProfile = n;
        saveSettings(); buildThemeEditor(containerOverride); toastr.success('Theme renamed.', EXT_DISPLAY);
    });

    profileRow.querySelector('#scp-theme-delete').addEventListener('click', async () => {
        const val = sel.value;
        if (!val || val.startsWith('__preset__')) { toastr.info('Select a custom theme to delete.', EXT_DISPLAY); return; }
        const ok = await showCustomDialog({ type: 'confirm', title: 'Delete Theme', message: `Delete "${val}"?` });
        if (!ok) return;
        const s2 = getSettings();
        delete s2.savedThemes[val];
        s2.activeThemeProfile = Object.keys(s2.savedThemes)[0] || '';
        if (s2.activeThemeProfile) s2.customTheme = { ...s2.savedThemes[s2.activeThemeProfile] };
        else { s2.customTheme = { ...THEME_PRESETS.default }; }
        saveSettings(); applyCustomTheme(s2.customTheme); buildThemeEditor(containerOverride);
        toastr.success('Deleted.', EXT_DISPLAY);
    });

    profileRow.querySelector('#scp-theme-export').addEventListener('click', () => {
        const s2 = getSettings();
        const val = sel.value;
        const rawName = val.startsWith('__preset__') ? val.replace('__preset__', '') : (val || 'custom');
        const payload = JSON.stringify({ name: rawName, version: 1, theme: s2.customTheme }, null, 2);
        const blob = new Blob([payload], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `st-copilot-theme-${rawName.replace(/[^a-z0-9]/gi, '_')}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });

    profileRow.querySelector('#scp-theme-import').addEventListener('click', () => {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = '.json';
        inp.onchange = async () => {
            const file = inp.files?.[0]; if (!file) return;
            try {
                const text = await file.text();
                const data = JSON.parse(text);
                const imported = data.theme || data;
                if (typeof imported !== 'object' || Array.isArray(imported)) throw new Error('Invalid format');
                const themeName = (data.name && typeof data.name === 'string')
                    ? data.name
                    : file.name.replace(/\.json$/i, '');
                const s2 = getSettings();
                s2.savedThemes[themeName] = { ...THEME_PRESETS.default, ...imported };
                s2.activeThemeProfile = themeName;
                s2.customTheme = { ...s2.savedThemes[themeName] };
                saveSettings(); applyCustomTheme(s2.customTheme); buildThemeEditor(containerOverride);
                toastr.success(`Theme "${escHtml(themeName)}" imported.`, EXT_DISPLAY);
            } catch (e) {
                toastr.error('Invalid theme file.', EXT_DISPLAY);
            }
        };
        inp.click();
    });

    const grid = document.createElement('div'); grid.className = 'scp-theme-var-grid';
    const windowEl = document.getElementById('scp-window');

    for (const def of THEME_VAR_DEFS) {
        const item = document.createElement('div'); item.className = 'scp-theme-var-item';
        const label = document.createElement('div'); label.className = 'scp-theme-var-label'; label.textContent = def.label;
        const wrap = document.createElement('div'); wrap.className = 'scp-theme-var-wrap';
        const isColorKey = _COLOR_KEYS.has(def.key);
        const isFontKey = def.key === 'font' || def.key === 'fontSize';

        const preview = document.createElement('div'); preview.className = 'scp-theme-var-preview';
        
        let curVal = s.customTheme?.[def.key] ?? '';
        if (def.key === 'fontSize' && /^\d+$/.test(curVal)) {
            curVal += 'px';
        }

        if (isColorKey) {
            preview.style.background = curVal;
            preview.style.display = curVal ? '' : 'none';
            preview.classList.add('scp-color-clickable');
        } else {
            preview.style.display = 'none';
        }

        const input = document.createElement('input'); input.type = 'text'; input.className = 'scp-theme-var-input';
        input.value = curVal; input.placeholder = def.hint; input.dataset.key = def.key;
        const cssVar = THEME_CSS_MAP[def.key];
        const getDefaultVal = () => {
            const ss = getSettings();
            if (ss.activeThemeProfile && ss.savedThemes?.[ss.activeThemeProfile]) return ss.savedThemes[ss.activeThemeProfile][def.key] ?? '';
            const selEl = container.querySelector('#scp-theme-profile-select');
            const selVal = selEl?.value || '';
            if (selVal.startsWith('__preset__')) {
                const pk = selVal.replace('__preset__', '');
                return (THEME_PRESETS[pk] || THEME_PRESETS.default)[def.key] ?? '';
            }
            return THEME_PRESETS.default[def.key] ?? '';
        };
        const resetBtn = document.createElement('button');
        resetBtn.className = 'scp-theme-var-reset'; resetBtn.title = 'Reset to profile default'; resetBtn.textContent = '↺';
        const updateResetState = val => { resetBtn.disabled = !val || val === getDefaultVal(); };
        updateResetState(curVal);

        let _fontDebounce = null;
        const applyVal = val => {
            const s2 = getSettings();
            if (!s2.customTheme) s2.customTheme = {};
            s2.customTheme[def.key] = val;
            saveSettings();
            _markDirty('theme');
            
            document.querySelectorAll(`input.scp-theme-var-input[data-key="${def.key}"]`).forEach(inp => {
                if (inp.value !== val) inp.value = val;
            });

            if (isColorKey) {
                if (cssVar) [windowEl, document.getElementById('scp-lb-overlay'), document.getElementById('scp-diff-modal')]
                    .filter(Boolean).forEach(t => t.style.setProperty(cssVar, val));
                preview.style.background = val;
                preview.style.display = val ? '' : 'none';
            } else if (isFontKey) {
                clearTimeout(_fontDebounce);
                _fontDebounce = setTimeout(() => {
                    let fVal = val.trim();
                    if (def.key === 'fontSize' && /^\d+$/.test(fVal)) fVal += 'px';
                    
                    const targets = [windowEl, document.getElementById('scp-lb-overlay'),
                        document.getElementById('scp-diff-modal'), document.getElementById('scp-settings-overlay'),
                        document.getElementById('scp-picker-overlay')].filter(Boolean);
                    targets.forEach(t => {
                        if (fVal) {
                            t.style.setProperty(cssVar, fVal);
                            if (def.key === 'fontSize') t.style.fontSize = fVal;
                        } else {
                            t.style.removeProperty(cssVar);
                            if (def.key === 'fontSize') t.style.fontSize = '';
                        }
                    });
                }, 600);
            } else {
                if (cssVar) [windowEl, document.getElementById('scp-lb-overlay'), document.getElementById('scp-diff-modal')]
                    .filter(Boolean).forEach(t => t.style.setProperty(cssVar, val));
            }
            updateResetState(val);
        };
        input.addEventListener('input', () => applyVal(input.value));
        resetBtn.addEventListener('click', () => {
            const dv = getDefaultVal();
            applyVal(isFontKey ? (dv || '') : (dv || ''));
        });
        if (isColorKey) {
            preview.addEventListener('click', () => showColorPicker(preview, input.value || '#7c6dfa', val => applyVal(val)));
        }
        wrap.appendChild(preview); wrap.appendChild(input); wrap.appendChild(resetBtn);
        item.appendChild(label); item.appendChild(wrap); grid.appendChild(item);
    }
    container.appendChild(grid);
}

// ─── Main Settings Handlers ───────────────────────────────────────────

export function _syncBgToOverlay() {
    const s = getSettings();
    const bgType = s.windowBgType || 'none';
    ['scp-sp-bg-type','scp-bg-type'].forEach(id => { const el = document.getElementById(id); if (el) el.value = bgType; });
    ['scp-sp-bg-url','scp-bg-url'].forEach(id => { const el = document.getElementById(id); if (el) el.value = s.windowBgUrl || ''; });
    ['scp-sp-bg-dim','scp-bg-dim'].forEach(id => { const el = document.getElementById(id); if (el) el.value = s.windowBgDim ?? 50; });
    ['scp-sp-bg-dim-val','scp-bg-dim-val'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = `${s.windowBgDim ?? 50}%`; });
    [['scp-sp-bg-url-group','scp-bg-url-group'],['scp-sp-bg-dim-group','scp-bg-dim-group']].forEach(([a,b]) => {
        [a,b].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = bgType !== 'none' ? '' : 'none'; });
    });
}

export function syncOverlayUI(key, val) {
    const gIdMap = {
        connectionSource: 'scp-sp-conn-source',
        connectionProfileId: 'scp-sp-conn-profile',
        customUrl: 'scp-sp-custom-url',
        customKey: 'scp-sp-custom-key',
        customModel: 'scp-sp-custom-model',
        includeSystemPrompt: 'scp-sp-include-sysprompt',
        includeUserPersonality: 'scp-sp-include-persona',
        applyRegexToContext: 'scp-sp-apply-regex',
        contextDepth: 'scp-sp-depth-slider',
        wobbleWindow: 'scp-sp-wobble-window',
        performanceMode: 'scp-sp-perf-mode',
        includeSummaryception: 'scp-sp-include-summaryception',
        useAspectEvolutia: 'scp-sp-use-aspect-evolutia',
    };
    const gId = gIdMap[key];
    if (gId) {
        const gEl = document.getElementById(gId);
        if (gEl) {
            if (gEl.type === 'checkbox') gEl.checked = !!val;
            else gEl.value = val ?? '';
        }
        if (key === 'connectionSource') {
            const gPg = document.getElementById('scp-sp-global-profile-group');
            if (gPg) gPg.style.display = val === 'profile' ? '' : 'none';
            const cPg = document.getElementById('scp-sp-custom-profile-group');
            if (cPg) cPg.style.display = val === 'custom' ? '' : 'none';
        }
        if (key === 'contextDepth') {
            const gDv = document.getElementById('scp-sp-depth-val');
            if (gDv) gDv.textContent = val ?? 15;
        }
    }

    if (key === 'forceStreaming') {
        const streamVal = val === true ? 'on' : (val === false ? 'auto' : (val || 'auto'));
        
        document.querySelectorAll('.scp-stream-btn:not(.scp-ov-stream-btn)').forEach(b => {
            b.classList.toggle('active', b.dataset.stream === streamVal);
        });

        const ov = getSessionOverrides();
        if (!('forceStreaming' in ov)) {
            document.querySelectorAll('.scp-ov-stream-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.stream === streamVal);
            });
        }
        return;
    }

    const ov = getSessionOverrides();
    if (key in ov) return;

    const eff = getEffectiveSettings();
    const ovIdMap = {
        connectionSource: 'scp-sp-ov-conn-source',
        connectionProfileId: 'scp-sp-ov-conn-profile',
        customUrl: 'scp-sp-ov-custom-url',
        customKey: 'scp-sp-ov-custom-key',
        customModel: 'scp-sp-ov-custom-model',
        includeSystemPrompt: 'scp-sp-ov-include-sysprompt',
        includeUserPersonality: 'scp-sp-ov-include-persona',
        includeAlternateSwipes: 'scp-sp-ov-include-alt-swipes',
        applyRegexToContext: 'scp-sp-ov-apply-regex',
        contextDepth: 'scp-sp-ov-depth-slider',
        charField_tags: 'scp-sp-ov-ce-tags',
        charField_description: 'scp-sp-ov-ce-description',
        charField_personality: 'scp-sp-ov-ce-personality',
        charField_scenario: 'scp-sp-ov-ce-scenario',
        charField_first_mes: 'scp-sp-ov-ce-first-mes',
        charField_mes_example: 'scp-sp-ov-ce-mes-example',
        charField_authors_note: 'scp-sp-ov-ce-authors-note',
        charField_alternate_greetings: 'scp-sp-ov-ce-alt-greetings',
    };

    const ovId = ovIdMap[key];
    if (ovId) {
        const ovEl = document.getElementById(ovId);
        if (ovEl) {
            if (ovEl.type === 'checkbox') {
                if (key.startsWith('charField_')) {
                    const fKey = key.replace('charField_', '');
                    ovEl.checked = !!(getSettings().charEditFields || {})[fKey];
                } else {
                    ovEl.checked = !!eff[key];
                }
            }
            else ovEl.value = eff[key] ?? '';
        }
        if (key === 'connectionSource') {
            const pg = document.getElementById('scp-sp-ov-profile-group');
            if (pg) pg.style.display = eff.connectionSource === 'profile' ? '' : 'none';
            const cg = document.getElementById('scp-sp-ov-custom-profile-group');
            if (cg) cg.style.display = eff.connectionSource === 'custom' ? '' : 'none';
        }
        if (key === 'contextDepth') {
            const dv = document.getElementById('scp-sp-ov-depth-val');
            if (dv) dv.textContent = eff.contextDepth ?? 15;
        }
        
        if (key === 'charField_alternate_greetings') {
            const picker = document.getElementById('scp-sp-ov-ce-alt-greetings-picker');
            if (picker) {
                picker.style.display = ovEl && ovEl.checked ? '' : 'none';
                import('../features/feature-character-ui.js').then(m => m.refreshAltGreetingsPickers());
            }
        }
    }
}

export function updateSettingsUI() {
    const s = getSettings();
    const setC = (id, key) => { const el = document.getElementById(id); if (el) el.checked = !!s[key]; };
    const setI = (id, key) => { const el = document.getElementById(id); if (el) el.value = s[key] ?? ''; };
    
    setC('scp-enabled', 'enabled');
    setC('scp-hotkey-enabled', 'hotkeyEnabled');
    setC('scp-search-hotkey-enabled', 'searchHotkeyEnabled');
    setI('scp-search-hotkey', 'searchHotkey');
    setC('scp-include-sysprompt', 'includeSystemPrompt');
    setC('scp-include-persona', 'includeUserPersonality');
    setC('scp-apply-regex', 'applyRegexToContext');
    setC('scp-icon-persistent', 'floatingIconPersistent');
    setC('scp-ghost-hotkey-enabled', 'ghostModeHotkeyEnabled');
    setI('scp-hotkey', 'hotkey');
    setI('scp-max-tokens', 'maxTokens');
    setI('scp-history-limit', 'localHistoryLimit');
    setI('scp-depth-slider', 'contextDepth');
    setI('scp-reasoning-trim', 'reasoningTrimStrings');
    setI('scp-ghost-hotkey', 'ghostModeHotkey');
    
    // Wobble Drag Setup
    const wobbleEl = document.getElementById('scp-wobble-window'); 
    if (wobbleEl) wobbleEl.checked = s.wobbleWindow !== false;
    const wobbleSpEl = document.getElementById('scp-sp-wobble-window');
    if (wobbleSpEl) wobbleSpEl.checked = s.wobbleWindow !== false;

    setC('scp-perf-mode', 'performanceMode');
    setC('scp-char-edit-enabled', 'charEditAIEnabled');
    setC('scp-memory-enabled', 'memoryEnabled');
    const memPromptEl = document.getElementById('scp-memory-prompt');
    if (memPromptEl) {
        memPromptEl.value = s.memoryManagePrompt || DEFAULT_MEMORY_PROMPT;
    }
    setC('scp-memory-inject', 'memoryInject');
    setC('scp-tools-enabled', 'toolsEnabled');
    setC('scp-include-summaryception', 'includeSummaryception');
    setC('scp-use-aspect-evolutia', 'useAspectEvolutia');
    setC('scp-auto-expand-macros', 'autoExpandMacros');
    setC('scp-include-hidden-msgs', 'includeHiddenMessages');

    const fsVal = s.forceStreaming === true ? 'on' : (s.forceStreaming === false ? 'auto' : (s.forceStreaming || 'auto'));
    document.querySelectorAll('#scp-st-stream-auto, #scp-st-stream-on, #scp-st-stream-off').forEach(b => {
        const active = b.dataset.stream === fsVal;
        b.classList.toggle('active', active);
        b.style.color = active ? 'var(--SmartThemeQuoteColor,#a99bfb)' : '';
        b.style.borderColor = active ? 'rgba(124,109,250,0.5)' : '';
        b.style.background = active ? 'rgba(124,109,250,0.12)' : '';
    });
    const cePromptEl = document.getElementById('scp-char-edit-prompt');
    if (cePromptEl) cePromptEl.value = s.charEditPrompt || DEFAULT_CHAR_EDIT_DIRECTIVE.trim();

    const ceFields = s.charEditFields || {};
    const setCe = (id, k) => { const el = document.getElementById(id); if (el) el.checked = ceFields[k] !== false; };
    setCe('scp-ce-tags', 'tags');
    setCe('scp-ce-description', 'description');
    setCe('scp-ce-personality', 'personality');
    setCe('scp-ce-scenario', 'scenario');
    setCe('scp-ce-first-mes', 'first_mes');
    setCe('scp-ce-mes-example', 'mes_example');
    setCe('scp-ce-authors-note', 'authors_note');
    const agEl = document.getElementById('scp-ce-alt-greetings'); if (agEl) agEl.checked = !!ceFields.alternate_greetings;

    const opSlider = document.getElementById('scp-opacity-slider');
    const opVal = document.getElementById('scp-opacity-val');
    if (opSlider) opSlider.value = s.opacity ?? 95;
    if (opVal) opVal.textContent = `${s.opacity ?? 95}%`;

    const ghOp = document.getElementById('scp-ghost-opacity');
    const ghOpVal = document.getElementById('scp-ghost-opacity-val');
    if (ghOp) ghOp.value = s.ghostModeOpacity ?? 15;
    if (ghOpVal) ghOpVal.textContent = `${s.ghostModeOpacity ?? 15}%`;
    
    const dv = document.getElementById('scp-depth-val');
    if (dv) dv.textContent = s.contextDepth ?? 15;
    
    const cs = document.getElementById('scp-conn-source');
    if (cs) {
        cs.value = s.connectionSource ?? 'default';
        const gGroup = document.getElementById('scp-profile-group');
        if (gGroup) gGroup.style.display = cs.value === 'profile' ? '' : 'none';
        const cGroup = document.getElementById('scp-custom-profile-group');
        if (cGroup) cGroup.style.display = cs.value === 'custom' ? '' : 'none';
    }
    
    setI('scp-custom-url', 'customUrl');
    setI('scp-custom-key', 'customKey');
    setI('scp-custom-model', 'customModel');
    
    const spEl = document.getElementById('scp-sysprompt');
    if (spEl) spEl.value = s.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    
    const profSel = document.getElementById('scp-conn-profile');
    if (profSel) profSel.value = s.connectionProfileId ?? '';

    const wand = document.getElementById('scp-wand-btn');
    if (wand) wand.style.display = s.enabled ? '' : 'none';
    
    import('./ui-window.js').then(m => {
        m._setupBgUpload('scp-bg-upload-btn', 'scp-bg-url', () => _syncBgToOverlay());
    });

    const pickerLinesEl = document.getElementById('scp-picker-lines');
    if (pickerLinesEl) pickerLinesEl.value = s.pickerPreviewLines ?? 1;
    const pickerLastEl = document.getElementById('scp-picker-last-lines');
    if (pickerLastEl) pickerLastEl.value = s.pickerPreviewLastLines ?? 0;

    const imageModeEl = document.getElementById('scp-image-mode');
    if (imageModeEl) imageModeEl.value = s.imageAnalysisMode || 'direct';

    const soundUnfocusedEl = document.getElementById('scp-sound-unfocused');
    if (soundUnfocusedEl) soundUnfocusedEl.checked = !!s.completionSoundOnlyWhenUnfocused;

    buildThemeEditor();
    
    import('./ui-widgets.js').then(m => m.buildSoundSettingsUI(document.getElementById('scp-sound-settings')));
    import('../features/feature-character-ui.js').then(m => m.refreshAltGreetingsPickers());

    const lbPromptEl3 = document.getElementById('scp-lb-manage-prompt');
    if (lbPromptEl3) lbPromptEl3.value = s.lorebookManagePrompt || DEFAULT_LB_MANAGE_PROMPT;
    setI('scp-lb-st-scan-depth', 'lorebookSTScanDepth');
    setI('scp-lb-copilot-scan-depth', 'lorebookCopilotScanDepth');
    const lbAiStEl2 = document.getElementById('scp-lb-ai-enabled-st');
    if (lbAiStEl2) lbAiStEl2.checked = !!s.lorebookAIManageEnabled;
    const lbKwStEl2 = document.getElementById('scp-lb-auto-kw-st');
    if (lbKwStEl2) lbKwStEl2.checked = !!s.lorebookAutoKeyword;

    const chatEditEnabledStEl = document.getElementById('scp-chat-edit-enabled-st');
    if (chatEditEnabledStEl) chatEditEnabledStEl.checked = !!s.chatEditAIEnabled;
    const chatEditPromptStEl = document.getElementById('scp-chat-edit-prompt-st');
    if (chatEditPromptStEl) chatEditPromptStEl.value = s.chatEditPrompt || DEFAULT_CHAT_EDIT_DIRECTIVE.trim();
}

export function syncSPFromSettings() {
    const s = getSettings();
    const ov = getSessionOverrides();
    const eff = getEffectiveSettings();

    import('./ui-chat.js').then(m => {
        if (m.updateDepthSlidersMax) m.updateDepthSlidersMax();
    });

    const g = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
    const gC = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };

    // Global tab
    gC('scp-sp-search-hotkey-enabled', s.searchHotkeyEnabled);
    g('scp-sp-search-hotkey', s.searchHotkey);
    gC('scp-sp-enabled', s.enabled);
    gC('scp-sp-perf-mode', s.performanceMode);
    gC('scp-sp-hotkey-enabled', s.hotkeyEnabled);
    g('scp-sp-hotkey', s.hotkey);
    gC('scp-sp-icon-persistent', s.floatingIconPersistent);
    gC('scp-sp-wobble-window', s.wobbleWindow !== false);
    gC('scp-sp-changelog-auto', s.changelogAutoShow);

    const spOpSlider = document.getElementById('scp-sp-opacity-slider');
    const spOpVal = document.getElementById('scp-sp-opacity-val');
    if (spOpSlider) spOpSlider.value = s.opacity ?? 95;
    if (spOpVal) spOpVal.textContent = `${s.opacity ?? 95}%`;

    const spGhOp = document.getElementById('scp-sp-ghost-opacity');
    const spGhOpVal = document.getElementById('scp-sp-ghost-opacity-val');
    if (spGhOp) spGhOp.value = s.ghostModeOpacity ?? 15;
    if (spGhOpVal) spGhOpVal.textContent = `${s.ghostModeOpacity ?? 15}%`;
    gC('scp-sp-ghost-hotkey-enabled', s.ghostModeHotkeyEnabled);
    g('scp-sp-ghost-hotkey', s.ghostModeHotkey);
    
    // Force Streaming global
    gC('scp-sp-force-streaming', s.forceStreaming);
    const streamVal = s.forceStreaming === true ? 'on' : (s.forceStreaming === false ? 'auto' : (s.forceStreaming || 'auto'));
    document.querySelectorAll('.scp-stream-btn:not(.scp-ov-stream-btn)').forEach(b => {
        const active = b.dataset.stream === streamVal;
        b.classList.toggle('active', active);
        b.style.color = '';
        b.style.borderColor = '';
        b.style.background = '';
    });
    
    g('scp-sp-conn-source', s.connectionSource ?? 'default');
    const gCp = document.getElementById('scp-sp-global-profile-group');
    if (gCp) gCp.style.display = s.connectionSource === 'profile' ? '' : 'none';
    const gCus = document.getElementById('scp-sp-custom-profile-group');
    if (gCus) gCus.style.display = s.connectionSource === 'custom' ? '' : 'none';
    
    g('scp-sp-custom-url', s.customUrl);
    g('scp-sp-custom-key', s.customKey);
    g('scp-sp-custom-model', s.customModel);

    g('scp-sp-max-tokens', s.maxTokens);
    g('scp-sp-history-limit', s.localHistoryLimit);
    
    const spDs = document.getElementById('scp-sp-depth-slider');
    const spDv = document.getElementById('scp-sp-depth-val');
    if (spDs) spDs.value = s.contextDepth ?? 15;
    if (spDv) spDv.textContent = s.contextDepth ?? 15;
    
    gC('scp-sp-include-sysprompt', s.includeSystemPrompt);
    gC('scp-sp-include-persona', s.includeUserPersonality);
    gC('scp-sp-apply-regex', s.applyRegexToContext);
    g('scp-sp-reasoning-trim', s.reasoningTrimStrings);
    g('scp-sp-sysprompt', s.systemPrompt || DEFAULT_SYSTEM_PROMPT);
    g('scp-sp-lb-manage-prompt', s.lorebookManagePrompt || DEFAULT_LB_MANAGE_PROMPT);
    g('scp-sp-lb-st-scan-depth', s.lorebookSTScanDepth);
    g('scp-sp-lb-copilot-scan-depth', s.lorebookCopilotScanDepth);
    gC('scp-sp-lb-ai-enabled', s.lorebookAIManageEnabled);
    gC('scp-sp-lb-auto-kw', s.lorebookAutoKeyword);

    gC('scp-sp-char-edit-enabled', s.charEditAIEnabled);
    g('scp-sp-char-edit-prompt', s.charEditPrompt || DEFAULT_CHAR_EDIT_DIRECTIVE.trim());
    const ceFields = s.charEditFields || {};
    gC('scp-sp-ce-tags', ceFields.tags !== false);
    gC('scp-sp-ce-description', ceFields.description !== false);
    gC('scp-sp-ce-personality', ceFields.personality !== false);
    gC('scp-sp-ce-scenario', ceFields.scenario !== false);
    gC('scp-sp-ce-first-mes', ceFields.first_mes !== false);
    gC('scp-sp-ce-mes-example', ceFields.mes_example !== false);
    gC('scp-sp-ce-authors-note', ceFields.authors_note !== false);
    gC('scp-sp-ce-alt-greetings', !!ceFields.alternate_greetings);

    gC('scp-sp-chat-edit-enabled', s.chatEditAIEnabled);
    g('scp-sp-chat-edit-prompt', s.chatEditPrompt || DEFAULT_CHAT_EDIT_DIRECTIVE.trim());

    refreshSPProfilesDropdown();
    updateSPConnProfileList();

    // ── Session tab ──
    const ovDs = document.getElementById('scp-sp-ov-depth-slider');
    const ovDv = document.getElementById('scp-sp-ov-depth-val');
    if (ovDs) ovDs.value = eff.contextDepth ?? 15;
    if (ovDv) ovDv.textContent = eff.contextDepth ?? 15;

    g('scp-sp-ov-conn-source', eff.connectionSource ?? 'default');
    const ovPg = document.getElementById('scp-sp-ov-profile-group');
    if (ovPg) ovPg.style.display = eff.connectionSource === 'profile' ? '' : 'none';
    const ovCus = document.getElementById('scp-sp-ov-custom-profile-group');
    if (ovCus) ovCus.style.display = eff.connectionSource === 'custom' ? '' : 'none';
    
    g('scp-sp-ov-conn-profile', eff.connectionProfileId ?? '');

    const ovi = (id, key) => { const el = document.getElementById(id); if (el) el.value = key in ov ? (ov[key] ?? '') : ''; };
    ovi('scp-sp-ov-custom-url', 'customUrl');
    ovi('scp-sp-ov-custom-key', 'customKey');
    ovi('scp-sp-ov-custom-model', 'customModel');
    ovi('scp-sp-ov-max-tokens', 'maxTokens');
    ovi('scp-sp-ov-history-limit', 'localHistoryLimit');
    ovi('scp-sp-ov-reasoning-trim', 'reasoningTrimStrings');
    ovi('scp-sp-ov-sysprompt', 'systemPrompt');
    
    // AI Prompts overrides
    ovi('scp-sp-ov-char-edit-prompt', 'charEditPrompt');
    ovi('scp-sp-ov-lb-manage-prompt', 'lorebookManagePrompt');
    ovi('scp-sp-ov-chat-edit-prompt', 'chatEditPrompt');

    gC('scp-sp-ov-include-sysprompt', eff.includeSystemPrompt);
    gC('scp-sp-ov-include-persona', eff.includeUserPersonality);
    gC('scp-sp-ov-include-alt-swipes', eff.includeAlternateSwipes);
    gC('scp-sp-ov-apply-regex', eff.applyRegexToContext);

    // Sync streaming override buttons
    const ovStreamVal = eff.forceStreaming === true ? 'on' : (eff.forceStreaming === false ? 'auto' : (eff.forceStreaming || 'auto'));
    document.querySelectorAll('.scp-ov-stream-btn').forEach(b => {
        const active = b.dataset.stream === ovStreamVal;
        b.classList.toggle('active', active);
        b.style.color = active ? 'var(--scp-accent)' : '';
        b.style.borderColor = active ? 'var(--scp-accent-dim)' : '';
        b.style.background = active ? 'var(--scp-accent-bg)' : '';
    });

    const ovCe = (id, k) => {
        const el = document.getElementById(id);
        if (el) el.checked = k in ov ? !!ov[k] : !!(s.charEditFields || {})[k.replace('charField_', '')];
    };
    ovCe('scp-sp-ov-ce-tags', 'charField_tags');
    ovCe('scp-sp-ov-ce-description', 'charField_description');
    ovCe('scp-sp-ov-ce-personality', 'charField_personality');
    ovCe('scp-sp-ov-ce-scenario', 'charField_scenario');
    ovCe('scp-sp-ov-ce-first-mes', 'charField_first_mes');
    ovCe('scp-sp-ov-ce-mes-example', 'charField_mes_example');
    ovCe('scp-sp-ov-ce-authors-note', 'charField_authors_note');
    ovCe('scp-sp-ov-ce-alt-greetings', 'charField_alternate_greetings');

    const ovC = (id, key) => {
        const el = document.getElementById(id);
        if (el) el.checked = key in ov ? !!ov[key] : !!eff[key];
    };
    ovC('scp-sp-ov-char-edit-enabled', 'charEditAIEnabled');
    ovC('scp-sp-ov-lb-ai-enabled', 'lorebookAIManageEnabled');
    ovC('scp-sp-ov-chat-edit-enabled', 'chatEditAIEnabled');
    ovC('scp-sp-ov-lb-auto-kw', 'lorebookAutoKeyword');

    const altGreetingsOvEl = document.getElementById('scp-sp-ov-ce-alt-greetings');
    if (altGreetingsOvEl) {
        const picker = document.getElementById('scp-sp-ov-ce-alt-greetings-picker');
        if (picker) {
            picker.style.display = altGreetingsOvEl.checked ? '' : 'none';
            import('../features/feature-character-ui.js').then(m => m.refreshAltGreetingsPickers());
        }
    }

    updateSPOverrideIndicators();

    const spSoundUnf = document.getElementById('scp-sp-sound-unfocused');
    if (spSoundUnf) spSoundUnf.checked = !!s.completionSoundOnlyWhenUnfocused;
    
    // Background UI
    import('./ui-window.js').then(m => {
        m._setupBgUpload('scp-sp-bg-upload-btn', 'scp-sp-bg-url', () => _syncBgToOverlay());
    });
    buildBackgroundSettingsUI(document.getElementById('scp-sp-bg-settings'));
    
    const spPl = document.getElementById('scp-sp-picker-lines');
    if (spPl) spPl.value = s.pickerPreviewLines ?? 1;
    const spPll = document.getElementById('scp-sp-picker-last-lines');
    if (spPll) spPll.value = s.pickerPreviewLastLines ?? 0;
    const spIm = document.getElementById('scp-sp-image-mode');
    if (spIm) spIm.value = s.imageAnalysisMode || 'direct';

    // Memory sync
    const setC2 = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
    const setV2 = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
    setC2('scp-sp-memory-enabled', s.memoryEnabled);
    setC2('scp-sp-memory-inject', s.memoryInject);
    setC2('scp-sp-memory-notify', s.memoryNotify);
    setV2('scp-sp-memory-scope', s.memoryScope || 'global');
    setV2('scp-sp-memory-tag', s.memoryTag || 'memory-update');

    // Tools sync
    setC2('scp-sp-tools-enabled', s.toolsEnabled);
    setC2('scp-sp-tools-thinking', s.toolsThinking);
    setV2('scp-sp-tools-max-rounds', s.toolsMaxRounds ?? 5);
    for (const t of TOOL_DEFINITIONS) {
        const el = document.getElementById(`scp-sp-tool-${t.id}`);
        if (el) el.checked = s[t.settingKey] !== false;
    }

    setC2('scp-sp-include-summaryception', s.includeSummaryception !== false);
    setC2('scp-sp-use-aspect-evolutia', s.useAspectEvolutia !== false);
    setC2('scp-sp-auto-expand-macros', !!s.autoExpandMacros);
    setC2('scp-sp-include-hidden-msgs', !!s.includeHiddenMessages);

    import('../features/feature-memory.js').then(m => m.updateMemoryDot());
}

export function updateSPOverrideIndicators() {
    const ov = getSessionOverrides();
    document.querySelectorAll('.scp-sp-ov-label[data-ovkey]').forEach(label => {
        label.classList.toggle('has-override', label.dataset.ovkey in ov);
    });
    document.querySelectorAll('.scp-sp-ov-clear[data-ovkey]').forEach(btn => {
        const active = btn.dataset.ovkey in ov;
        btn.classList.toggle('active', active);
        btn.disabled = !active;
    });
}

export function updateSessionOverrideIndicator() {
    const has = hasSessionOverrides();
    const dot = document.getElementById('scp-sp-override-dot');
    if (dot) dot.style.display = has ? '' : 'none';
    const gearDot = document.getElementById('scp-gear-ov-dot');
    if (gearDot) gearDot.style.display = has ? '' : 'none';
    const btn = document.getElementById('scp-ext-settings-btn');
    if (btn) btn.classList.toggle('scp-has-overrides', has);
    updateSPOverrideIndicators();
    const info = document.getElementById('scp-sp-footer-info');
    if (info) {
        const ov = getSessionOverrides();
        const count = Object.keys(ov).length;
        info.textContent = count ? `${count} session override${count !== 1 ? 's' : ''} active` : '';
    }
    const ov = getSessionOverrides();
    const depthSlider = document.getElementById('scp-depth-slider');
    const depthVal = document.getElementById('scp-depth-val');
    const hasDepthOv = 'contextDepth' in ov;
    if (depthSlider) depthSlider.classList.toggle('scp-slider-overridden', hasDepthOv);
    if (depthVal) depthVal.classList.toggle('scp-depth-val-overridden', hasDepthOv);
}

export function openSettingsPanel() {
    const overlay = document.getElementById('scp-settings-overlay');
    if (!overlay) return;
    
    import('./ui-window.js').then(m => m.applyCustomTheme(getSettings().customTheme || THEME_PRESETS.default));
    
    syncSPFromSettings();
    buildThemeEditor(document.getElementById('scp-sp-theme-section'));
    _updateDirtyDots();
    
    import('./ui-widgets.js').then(mod => {
        mod.buildSoundSettingsUI(document.getElementById('scp-sp-sound-settings'));
    }).catch(()=>{});

    buildQPSettingsUI(document.getElementById('scp-sp-qp-container'));
    
    import('../features/feature-character-ui.js').then(m => m.refreshAltGreetingsPickers());
    
    import('./ui-widgets.js').then(mod => {
        mod.buildQPSetManager(document.getElementById('scp-sp-qp-set-manager'), () => {
            buildQPSettingsUI(document.getElementById('scp-sp-qp-container'));
        });

        mod.buildPromptPresetManager(
            document.getElementById('scp-sp-prompt-preset-manager'),
            () => document.getElementById('scp-sp-ov-sysprompt')?.value || '',
            (text) => {
                const ta = document.getElementById('scp-sp-ov-sysprompt');
                if (!ta) return;
                ta.value = text;
                ta.dispatchEvent(new Event('input', { bubbles: true }));
            }
        );
        mod.buildPromptPresetManager(document.getElementById('scp-sp-ov-char-preset-manager'), 
            () => document.getElementById('scp-sp-ov-char-edit-prompt')?.value || '', 
            (text) => { const ta = document.getElementById('scp-sp-ov-char-edit-prompt'); if(ta) { ta.value = text; ta.dispatchEvent(new Event('input', {bubbles:true})); } }, 
            'charEditPromptPresets');

        mod.buildPromptPresetManager(document.getElementById('scp-sp-ov-lb-preset-manager'), 
            () => document.getElementById('scp-sp-ov-lb-manage-prompt')?.value || '', 
            (text) => { const ta = document.getElementById('scp-sp-ov-lb-manage-prompt'); if(ta) { ta.value = text; ta.dispatchEvent(new Event('input', {bubbles:true})); } }, 
            'lbEditPromptPresets');

        mod.buildPromptPresetManager(document.getElementById('scp-sp-ov-chat-preset-manager'), 
            () => document.getElementById('scp-sp-ov-chat-edit-prompt')?.value || '', 
            (text) => { const ta = document.getElementById('scp-sp-ov-chat-edit-prompt'); if(ta) { ta.value = text; ta.dispatchEvent(new Event('input', {bubbles:true})); } }, 
            'chatEditPromptPresets');
    });

    overlay.style.display = 'flex';
    updateSessionOverrideIndicator();
    
    import('../features/feature-memory.js').then(m => m.updateMemoryDot());
    
    overlay.querySelectorAll('.scp-sp-tab').forEach(t => t.classList.toggle('active', t.dataset.sptab === 'global'));
    overlay.querySelectorAll('.scp-sp-tab-pane').forEach(p => { p.style.display = p.id === 'scp-sp-pane-global' ? '' : 'none'; });
}

export function closeSettingsPanel() {
    const overlay = document.getElementById('scp-settings-overlay');
    if (overlay) overlay.style.display = 'none';
}

export function setupSettingsHandlers() {
    const s = getSettings();

    const updCtx = () => import('./ui-chat.js').then(m => m.updateMsgCount(getCurrentSession()));

    const bindCheck = (id, key, cb) => {
        const el = document.getElementById(id); if (!el) return;
        el.checked = !!s[key];
        el.addEventListener('change', () => { 
            getSettings()[key] = el.checked; saveSettings(); 
            syncOverlayUI(key, el.checked);
            _markDirty('config');
            if (cb) cb(); 
        });
    };
    const bindInput = (id, key, toVal, cb) => {
        const el = document.getElementById(id); if (!el) return;
        el.value = s[key] ?? '';
        el.addEventListener('input', () => { 
            const v = toVal ? toVal(el.value) : el.value;
            getSettings()[key] = v; saveSettings(); 
            syncOverlayUI(key, v);
            _markDirty('config');
            if (cb) cb(); 
        });
    };
    const bindSelect = (id, key, cb) => {
        const el = document.getElementById(id); if (!el) return;
        el.value = s[key] ?? '';
        el.addEventListener('change', () => { 
            getSettings()[key] = el.value; saveSettings(); 
            syncOverlayUI(key, el.value);
            _markDirty('config');
            if (cb) cb(el.value); 
        });
    };

    const incAltSwipes = document.getElementById('scp-include-alt-swipes');
    if (incAltSwipes) incAltSwipes.checked = !!s.includeAlternateSwipes;

    bindCheck('scp-enabled', 'enabled', () => {
        const ss = getSettings();
        const btn = document.getElementById('scp-wand-btn');
        if (btn) btn.style.display = ss.enabled ? '' : 'none';
        if (!ss.enabled) import('./ui-window.js').then(m => m.hideWindow());
        import('./ui-window.js').then(m => m.updateIconVisibility(document.getElementById('scp-dock-icon')));
        import('./ui-chat.js').then(m => { if(m.setupHotkey) m.setupHotkey(); });
    });
    
    bindCheck('scp-hotkey-enabled', 'hotkeyEnabled');
    bindCheck('scp-include-sysprompt', 'includeSystemPrompt', updCtx);
    bindCheck('scp-include-persona', 'includeUserPersonality', updCtx);
    bindCheck('scp-include-alt-swipes', 'includeAlternateSwipes', updCtx);
    bindCheck('scp-apply-regex', 'applyRegexToContext');
    
    ['scp-st-stream-auto', 'scp-st-stream-on', 'scp-st-stream-off'].forEach(id => {
        const btn = document.getElementById(id); if (!btn) return;
        btn.addEventListener('click', () => {
            const val = btn.dataset.stream;
            getSettings().forceStreaming = val; 
            saveSettings();
            syncOverlayUI('forceStreaming', val);
            _markDirty('config');
        });
    });
    
    bindCheck('scp-icon-persistent', 'floatingIconPersistent', () => {
        import('./ui-window.js').then(m => m.updateIconVisibility(document.getElementById('scp-dock-icon')));
    });

    bindCheck('scp-wobble-window', 'wobbleWindow');

    bindCheck('scp-perf-mode', 'performanceMode', () => {
        import('./ui-window.js').then(m => m.applyCustomTheme(getSettings().customTheme || THEME_PRESETS.default));
    });
    bindCheck('scp-include-summaryception', 'includeSummaryception');
    bindCheck('scp-use-aspect-evolutia', 'useAspectEvolutia');
    bindCheck('scp-auto-expand-macros', 'autoExpandMacros');
    bindCheck('scp-include-hidden-msgs', 'includeHiddenMessages', updCtx);

    const opSlider = document.getElementById('scp-opacity-slider');
    const opVal = document.getElementById('scp-opacity-val');
    if (opSlider) {
        opSlider.value = s.opacity ?? 95;
        if (opVal) opVal.textContent = `${opSlider.value}%`;
        opSlider.addEventListener('input', () => { if (opVal) opVal.textContent = `${opSlider.value}%`; });
        opSlider.addEventListener('change', () => {
            const v = parseInt(opSlider.value);
            getSettings().opacity = v; saveSettings();
            const win = document.getElementById('scp-window');
            if (!state.ghostModeActive && win) win.style.opacity = (v / 100).toString();
            const spOpSlider = document.getElementById('scp-sp-opacity-slider');
            const spOpVal = document.getElementById('scp-sp-opacity-val');
            if (spOpSlider) spOpSlider.value = v;
            if (spOpVal) spOpVal.textContent = `${v}%`;
        });
    }

    const ghOp = document.getElementById('scp-ghost-opacity');
    const ghOpVal = document.getElementById('scp-ghost-opacity-val');
    if (ghOp) {
        ghOp.value = s.ghostModeOpacity ?? 15;
        if (ghOpVal) ghOpVal.textContent = `${ghOp.value}%`;
        ghOp.addEventListener('input', () => { if (ghOpVal) ghOpVal.textContent = `${ghOp.value}%`; });
        ghOp.addEventListener('change', () => {
            const v = parseInt(ghOp.value);
            getSettings().ghostModeOpacity = v; saveSettings();
            const win = document.getElementById('scp-window');
            if (state.ghostModeActive && win) win.style.opacity = (v / 100).toString();
            const spGhOp = document.getElementById('scp-sp-ghost-opacity');
            const spGhOpVal = document.getElementById('scp-sp-ghost-opacity-val');
            if (spGhOp) spGhOp.value = v;
            if (spGhOpVal) spGhOpVal.textContent = `${v}%`;
        });
    }

    bindCheck('scp-ghost-hotkey-enabled', 'ghostModeHotkeyEnabled', () => {
        import('./ui-window.js').then(m => m.setupGhostHotkey());
    });
    bindInput('scp-ghost-hotkey', 'ghostModeHotkey', null, () => {
        import('./ui-window.js').then(m => m.setupGhostHotkey());
    });
    bindCheck('scp-search-hotkey-enabled', 'searchHotkeyEnabled', () => {
        import('./ui-chat.js').then(m => m.setupSearchHotkey());
    });
    bindInput('scp-search-hotkey', 'searchHotkey', null, () => {
        import('./ui-chat.js').then(m => m.setupSearchHotkey());
    });
    
    const reasoningTrimEl = document.getElementById('scp-reasoning-trim');
    if (reasoningTrimEl) {
        reasoningTrimEl.value = getSettings().reasoningTrimStrings || '';
        reasoningTrimEl.addEventListener('input', () => { getSettings().reasoningTrimStrings = reasoningTrimEl.value; saveSettings(); });
    }
    
    bindInput('scp-hotkey', 'hotkey', null, () => {
        import('./ui-chat.js').then(m => { if(m.setupHotkey) m.setupHotkey(); });
    });
    bindInput('scp-max-tokens', 'maxTokens', Number);
    bindInput('scp-history-limit', 'localHistoryLimit', Number, updCtx);
    bindSelect('scp-conn-source', 'connectionSource', v => {
        const g = document.getElementById('scp-profile-group');
        if (g) g.style.display = v === 'profile' ? '' : 'none';
        const c = document.getElementById('scp-custom-profile-group');
        if (c) c.style.display = v === 'custom' ? '' : 'none';
    });

    bindInput('scp-custom-url', 'customUrl');
    bindInput('scp-custom-key', 'customKey');
    bindInput('scp-custom-model', 'customModel');

    if (document.getElementById('scp-profile-group')) {
        document.getElementById('scp-profile-group').style.display = s.connectionSource === 'profile' ? '' : 'none';
    }

    const spEl = document.getElementById('scp-sysprompt');
    if (spEl) {
        spEl.value = s.systemPrompt || DEFAULT_SYSTEM_PROMPT;
        spEl.addEventListener('input', () => { getSettings().systemPrompt = spEl.value; saveSettings(); updCtx(); });
    }

    bindCheck('scp-char-edit-enabled', 'charEditAIEnabled', updCtx);
    
    const charEditPromptEl = document.getElementById('scp-char-edit-prompt');
    if (charEditPromptEl) {
        charEditPromptEl.value = s.charEditPrompt || DEFAULT_CHAR_EDIT_DIRECTIVE.trim();
        charEditPromptEl.addEventListener('input', () => {
            const val = charEditPromptEl.value;
            getSettings().charEditPrompt = (val.trim() === DEFAULT_CHAR_EDIT_DIRECTIVE.trim()) ? '' : val;
            saveSettings();
            _markDirty('config');
        });
    }
    
    const bGCharFieldST = (id, fieldKey) => {
        const el = document.getElementById(id); if (!el) return;
        const ceF = getSettings().charEditFields || {};
        el.checked = ceF[fieldKey] !== false;
        el.addEventListener('change', () => {
            const s = getSettings();
            if (!s.charEditFields) s.charEditFields = {};
            s.charEditFields[fieldKey] = el.checked;
            saveSettings(); 
            updCtx();
            const ovEl = document.getElementById(`scp-sp-ce-${fieldKey.replace(/_/g, '-')}`);
            if (ovEl) ovEl.checked = el.checked;
            _markDirty('config');
        });
        syncOverlayUI('charField_' + fieldKey, el.checked);
    };
    bGCharFieldST('scp-ce-tags', 'tags');
    bGCharFieldST('scp-ce-description', 'description');
    bGCharFieldST('scp-ce-personality', 'personality');
    bGCharFieldST('scp-ce-scenario', 'scenario');
    bGCharFieldST('scp-ce-first-mes', 'first_mes');
    bGCharFieldST('scp-ce-mes-example', 'mes_example');
    bGCharFieldST('scp-ce-authors-note', 'authors_note');
    bGCharFieldST('scp-ce-alt-greetings', 'alternate_greetings');
    
    document.getElementById('scp-ce-alt-greetings')?.addEventListener('change', () => {
        const picker = document.getElementById('scp-ce-alt-greetings-picker');
        if (picker) { 
            picker.style.display = getSettings().charEditFields?.alternate_greetings ? '' : 'none'; 
            import('../features/feature-character-ui.js').then(m => m.refreshAltGreetingsPickers()); 
        }
    });

    document.getElementById('scp-reset-char-edit-prompt')?.addEventListener('click', async () => {
        const ok = await showCustomDialog({ type: 'confirm', title: 'Reset Char Edit Prompt', message: 'Reset to built-in default prompt?' });
        if (!ok) return;
        getSettings().charEditPrompt = '';
        saveSettings();
        _markDirty('config');
        const el = document.getElementById('scp-char-edit-prompt');
        if (el) el.value = DEFAULT_CHAR_EDIT_DIRECTIVE.trim();
        const ovEl = document.getElementById('scp-sp-char-edit-prompt');
        if (ovEl) ovEl.value = DEFAULT_CHAR_EDIT_DIRECTIVE.trim();
        toastr.success('Char edit prompt reset.', EXT_DISPLAY);
    });

    document.getElementById('scp-reset-prompt')?.addEventListener('click', async () => {
        const ok = await showCustomDialog({ type: 'confirm', title: 'Reset System Prompt', message: 'Reset to default? Your current prompt will be lost.' });
        if (!ok) return;
        getSettings().systemPrompt = DEFAULT_SYSTEM_PROMPT;
        if (spEl) spEl.value = DEFAULT_SYSTEM_PROMPT;
        saveSettings(); updCtx(); toastr.success('System prompt reset.', EXT_DISPLAY);
    });

    const profSel = document.getElementById('scp-conn-profile');
    if (profSel) {
        profSel.addEventListener('change', () => { 
            getSettings().connectionProfileId = profSel.value; 
            saveSettings(); 
            syncOverlayUI('connectionProfileId', profSel.value);
        });
    }

    refreshProfilesDropdown();

    document.getElementById('scp-profile-select')?.addEventListener('change', async () => {
        const sel = document.getElementById('scp-profile-select');
        const name = sel.value;
        if (isConfigProfileDirty()) {
            const ok = await showCustomDialog({ 
                type: 'confirm', 
                title: 'Unsaved Configuration', 
                message: 'You have unsaved changes in your current configuration profile. Are you sure you want to switch?' 
            });
            if (!ok) {
                sel.value = getSettings().activeProfile || '';
                return;
            }
        }
        if (name) loadProfile(name);
        updateBindingSection();
    });

    document.getElementById('scp-profile-save')?.addEventListener('click', async () => {
        const sel = document.getElementById('scp-profile-select');
        let name = sel?.value;
        if (!name) {
            name = await showCustomDialog({ type: 'prompt', title: 'Save Configuration', message: 'Enter a name for this configuration:', placeholder: 'My Config' });
            if (!name?.trim()) return;
            name = name.trim();
        }
        saveProfile(name); refreshProfilesDropdown();
        if (sel) sel.value = name;
        updateBindingSection(); toastr.success(`Saved "${name}"`, EXT_DISPLAY);
        _clearDirty('config');
    });

    document.getElementById('scp-profile-create-new')?.addEventListener('click', async () => {
        const name = await showCustomDialog({ type: 'prompt', title: 'New Configuration', message: 'Enter a name for the new default profile:', placeholder: 'New Config' });
        if (!name?.trim()) return;
        const n = name.trim();
        const s2 = getSettings();
        s2.profiles[n] = {
            systemPrompt: DEFAULT_SYSTEM_PROMPT, includeSystemPrompt: true,
            includeAuthorsNote: true, includeCharacterCard: true,
            includeUserPersonality: true, contextDepth: 15,
            localHistoryLimit: 50,
            connectionSource: 'default', connectionProfileId: '',
            maxTokens: 8200,
        };
        saveSettings(); refreshProfilesDropdown();
        loadProfile(n);
        const sel = document.getElementById('scp-profile-select'); if (sel) sel.value = n;
        updateBindingSection(); toastr.success(`Created "${n}"`, EXT_DISPLAY);
    });

    document.getElementById('scp-profile-duplicate')?.addEventListener('click', async () => {
        const sel = document.getElementById('scp-profile-select');
        if (!sel?.value) return toastr.info('No configuration selected.', EXT_DISPLAY);
        const defaultName = sel.value + ' (Copy)';
        const newName = await showCustomDialog({ type: 'prompt', title: 'Duplicate Configuration', message: 'Name for the new profile:', defaultValue: defaultName });
        if (!newName?.trim()) return;
        const n = newName.trim();
        const s2 = getSettings();
        const p = s2.profiles[sel.value];
        if (!p) return;
        s2.profiles[n] = JSON.parse(JSON.stringify(p));
        saveSettings(); refreshProfilesDropdown();
        refreshSPProfilesDropdown();
        loadProfile(n);
        const newSel = document.getElementById('scp-profile-select'); if (newSel) newSel.value = n;
        updateBindingSection(); toastr.success(`Duplicated as "${n}"`, EXT_DISPLAY);
    });

    document.getElementById('scp-profile-rename')?.addEventListener('click', async () => {
        const sel = document.getElementById('scp-profile-select');
        if (!sel?.value) return toastr.info('No configuration selected.', EXT_DISPLAY);
        const newName = await showCustomDialog({ type: 'prompt', title: 'Rename Configuration', message: 'New name:', defaultValue: sel.value });
        if (!newName?.trim() || newName.trim() === sel.value) return;
        const s2 = getSettings(); const p = s2.profiles[sel.value]; if (!p) return;
        s2.profiles[newName.trim()] = p; delete s2.profiles[sel.value];
        if (s2.activeProfile === sel.value) s2.activeProfile = newName.trim();
        for (const k in s2.profileBindings) { if (s2.profileBindings[k] === sel.value) s2.profileBindings[k] = newName.trim(); }
        saveSettings(); refreshProfilesDropdown();
        const newSel = document.getElementById('scp-profile-select'); if (newSel) newSel.value = newName.trim();
        updateBindingSection(); toastr.success('Renamed.', EXT_DISPLAY);
    });

    document.getElementById('scp-profile-delete')?.addEventListener('click', async () => {
        const sel = document.getElementById('scp-profile-select'); if (!sel?.value) return;
        const s2 = getSettings();
        if (Object.keys(s2.profiles).length <= 1) {
            toastr.warning('Cannot delete the last remaining configuration profile.', EXT_DISPLAY);
            return;
        }
        const ok = await showCustomDialog({ type: 'confirm', title: 'Delete Configuration', message: `Delete "${sel.value}"?` });
        if (!ok) return;
        deleteProfile(sel.value); refreshProfilesDropdown(); updateBindingSection();
        toastr.success('Deleted.', EXT_DISPLAY);
    });

    document.getElementById('scp-bind-char')?.addEventListener('click', () => {
        const sel = document.getElementById('scp-profile-select'); if (!sel?.value) return;
        const s2 = getSettings(); const { charId } = getBindingKey(); const key = `char_${charId}`;
        if (s2.profileBindings[key] === sel.value) delete s2.profileBindings[key];
        else s2.profileBindings[key] = sel.value;
        _dbgAdd(s2.profileBindings[key] ? 'PROFILE_BIND' : 'PROFILE_UNBIND', { target: 'char', profile: sel.value });
        saveSettings(); updateBindingSection();
    });

    document.getElementById('scp-bind-chat')?.addEventListener('click', () => {
        const sel = document.getElementById('scp-profile-select'); if (!sel?.value) return;
        const s2 = getSettings(); const { charId, chatId } = getBindingKey(); const key = `chat_${charId}_${chatId}`;
        if (s2.profileBindings[key] === sel.value) delete s2.profileBindings[key];
        else s2.profileBindings[key] = sel.value;
        _dbgAdd(s2.profileBindings[key] ? 'PROFILE_BIND' : 'PROFILE_UNBIND', { target: 'chat', profile: sel.value });
        saveSettings(); updateBindingSection();
    });

    document.getElementById('scp-open-window')?.addEventListener('click', () => import('./ui-window.js').then(m => m.showWindow()));
    document.getElementById('scp-download-debug')?.addEventListener('click', () => import('../utils/util-debug.js').then(m => m.dbgDownload()));

    // ST drawer: Memory
    const memEnabledStEl = document.getElementById('scp-memory-enabled');
    if (memEnabledStEl) {
        memEnabledStEl.checked = !!getSettings().memoryEnabled;
        memEnabledStEl.addEventListener('change', () => {
            getSettings().memoryEnabled = memEnabledStEl.checked; saveSettings();
            const ovEl = document.getElementById('scp-sp-memory-enabled'); if (ovEl) ovEl.checked = memEnabledStEl.checked;
        });
    }
    const memInjectStEl = document.getElementById('scp-memory-inject');
    if (memInjectStEl) {
        memInjectStEl.checked = !!getSettings().memoryInject;
        memInjectStEl.addEventListener('change', () => {
            getSettings().memoryInject = memInjectStEl.checked; saveSettings();
            const ovEl = document.getElementById('scp-sp-memory-inject'); if (ovEl) ovEl.checked = memInjectStEl.checked;
        });
    }
    document.getElementById('scp-open-memory-settings')?.addEventListener('click', () => {
        openSettingsPanel();
        setTimeout(() => { document.querySelector('[data-sptab="memory"]')?.click(); }, 80);
    });

    const memPromptEl = document.getElementById('scp-memory-prompt');
    if (memPromptEl) {
        memPromptEl.addEventListener('input', () => {
            getSettings().memoryManagePrompt = memPromptEl.value;
            saveSettings();
            const spEl = document.getElementById('scp-sp-memory-prompt');
            if (spEl) spEl.value = memPromptEl.value;
        });
    }
    document.getElementById('scp-reset-memory-prompt')?.addEventListener('click', async () => {
        const ok = await showCustomDialog({ type: 'confirm', title: 'Reset Prompt', message: 'Reset memory prompt to default?' });
        if (!ok) return;
        getSettings().memoryManagePrompt = DEFAULT_MEMORY_PROMPT;
        saveSettings();
        if (memPromptEl) memPromptEl.value = DEFAULT_MEMORY_PROMPT;
        const spEl = document.getElementById('scp-sp-memory-prompt');
        if (spEl) spEl.value = DEFAULT_MEMORY_PROMPT;
        toastr.success('Prompt reset.', EXT_DISPLAY);
    });

    // ST drawer: Tools
    const toolsEnabledStEl = document.getElementById('scp-tools-enabled');
    if (toolsEnabledStEl) {
        toolsEnabledStEl.checked = !!getSettings().toolsEnabled;
        toolsEnabledStEl.addEventListener('change', () => {
            getSettings().toolsEnabled = toolsEnabledStEl.checked; saveSettings();
            const ovEl = document.getElementById('scp-sp-tools-enabled'); if (ovEl) ovEl.checked = toolsEnabledStEl.checked;
        });
    }
    document.getElementById('scp-open-tools-settings')?.addEventListener('click', () => {
        openSettingsPanel();
        setTimeout(() => { document.querySelector('[data-sptab="tools"]')?.click(); }, 80);
    });
    
    const handleClearAllSessions = async () => {
        const ok = await showCustomDialog({ 
            type: 'confirm', 
            title: 'Clear All Sessions', 
            message: 'Delete ALL Copilot sessions from global storage AND clear sessions for the CURRENT chat? (Cannot clear other inactive chats). This cannot be undone.',
            delayConfirm: 3
        });
        if (!ok) return;
        getSettings().sessions = {}; saveSettings(); 
        const ctx = SillyTavern.getContext();
        if (ctx.chatMetadata) delete ctx.chatMetadata.st_copilot;
        await initChatBucket();
        import('./ui-chat.js').then(m => m.onChatChanged());
        toastr.success('Sessions cleared.', EXT_DISPLAY);
    };
    document.getElementById('scp-clear-sessions')?.addEventListener('click', handleClearAllSessions);

    // LB and Auto-Keywords toggles (ST drawer)
    const lbAiStEl = document.getElementById('scp-lb-ai-enabled-st');
    if (lbAiStEl) {
        lbAiStEl.checked = !!getSettings().lorebookAIManageEnabled;
        lbAiStEl.addEventListener('change', () => {
            getSettings().lorebookAIManageEnabled = lbAiStEl.checked; saveSettings();
            const spEl2 = document.getElementById('scp-sp-lb-ai-enabled');
            if (spEl2) spEl2.checked = lbAiStEl.checked;
        });
    }
    const lbKwStEl = document.getElementById('scp-lb-auto-kw-st');
    if (lbKwStEl) {
        lbKwStEl.checked = !!getSettings().lorebookAutoKeyword;
        lbKwStEl.addEventListener('change', async () => {
            const s2 = getSettings(); s2.lorebookAutoKeyword = lbKwStEl.checked; saveSettings();
            import('../features/feature-lorebook-engine.js').then(async m => {
                await m.buildLorebookContextBlock(s2);
                import('../features/feature-lorebook-ui.js').then(async ui => {
                    ui.updateLBFooterInfo();
                    if (state.lbActiveBook) await ui.renderEntryList(state.lbActiveBook, state.lbSearchQuery);
                });
            });
            updCtx();
            const spEl2 = document.getElementById('scp-sp-lb-auto-kw');
            if (spEl2) spEl2.checked = lbKwStEl.checked;
        });
    }

    bindInput('scp-lb-st-scan-depth', 'lorebookSTScanDepth', Number);
    bindInput('scp-lb-copilot-scan-depth', 'lorebookCopilotScanDepth', Number);

    const lbPromptEl = document.getElementById('scp-lb-manage-prompt');
    if (lbPromptEl) {
        lbPromptEl.value = s.lorebookManagePrompt || DEFAULT_LB_MANAGE_PROMPT;
        lbPromptEl.addEventListener('input', () => { getSettings().lorebookManagePrompt = lbPromptEl.value; saveSettings(); });
    }
    document.getElementById('scp-reset-lb-prompt')?.addEventListener('click', async () => {
        const ok = await showCustomDialog({ type: 'confirm', title: 'Reset Lorebook Prompt', message: 'Reset to default?' });
        if (!ok) return;
        getSettings().lorebookManagePrompt = DEFAULT_LB_MANAGE_PROMPT;
        const el = document.getElementById('scp-lb-manage-prompt'); if (el) el.value = DEFAULT_LB_MANAGE_PROMPT;
        saveSettings(); toastr.success('Lorebook prompt reset.', EXT_DISPLAY);
    });

    // Chat Edit handlers (ST drawer)
    const chatEditEnabledStEl = document.getElementById('scp-chat-edit-enabled-st');
    if (chatEditEnabledStEl) {
        chatEditEnabledStEl.checked = !!getSettings().chatEditAIEnabled;
        chatEditEnabledStEl.addEventListener('change', () => {
            getSettings().chatEditAIEnabled = chatEditEnabledStEl.checked; saveSettings();
            const spEl2 = document.getElementById('scp-sp-chat-edit-enabled');
            if (spEl2) spEl2.checked = chatEditEnabledStEl.checked;
            updCtx();
        });
    }
    const chatEditPromptStEl = document.getElementById('scp-chat-edit-prompt-st');
    if (chatEditPromptStEl) {
        chatEditPromptStEl.value = getSettings().chatEditPrompt || DEFAULT_CHAT_EDIT_DIRECTIVE.trim();
        chatEditPromptStEl.addEventListener('input', () => {
            const val = chatEditPromptStEl.value;
            getSettings().chatEditPrompt = (val.trim() === DEFAULT_CHAT_EDIT_DIRECTIVE.trim()) ? '' : val;
            saveSettings();
            _markDirty('config');
            const spEl2 = document.getElementById('scp-sp-chat-edit-prompt');
            if (spEl2) spEl2.value = chatEditPromptStEl.value;
        });
    }
    document.getElementById('scp-reset-chat-edit-prompt-st')?.addEventListener('click', async () => {
        const ok = await showCustomDialog({ type: 'confirm', title: 'Reset Chat Edit Prompt', message: 'Reset to default?' });
        if (!ok) return;
        getSettings().chatEditPrompt = ''; saveSettings(); _markDirty('config');
        if (chatEditPromptStEl) chatEditPromptStEl.value = DEFAULT_CHAT_EDIT_DIRECTIVE.trim();
        const spEl2 = document.getElementById('scp-sp-chat-edit-prompt');
        if (spEl2) spEl2.value = DEFAULT_CHAT_EDIT_DIRECTIVE.trim();
        toastr.success('Chat edit prompt reset.', EXT_DISPLAY);
    });

    // Sound unfocused (ST)
    const soundUnfocusedEl = document.getElementById('scp-sound-unfocused');
    if (soundUnfocusedEl) {
        soundUnfocusedEl.checked = !!getSettings().completionSoundOnlyWhenUnfocused;
        soundUnfocusedEl.addEventListener('change', () => {
            getSettings().completionSoundOnlyWhenUnfocused = soundUnfocusedEl.checked;
            saveSettings();
            const spEl = document.getElementById('scp-sp-sound-unfocused');
            if (spEl) spEl.checked = soundUnfocusedEl.checked;
        });
    }

    // Background (ST)
    const _bindBg = (typeId, urlId, urlGrpId, dimId, dimGrpId, dimValId) => {
        const typeEl = document.getElementById(typeId);
        const urlEl = document.getElementById(urlId);
        const urlGrp = document.getElementById(urlGrpId);
        const dimEl = document.getElementById(dimId);
        const dimGrp = document.getElementById(dimGrpId);
        const dimValEl = document.getElementById(dimValId);
        const s2 = getSettings();
        if (typeEl) {
            typeEl.value = s2.windowBgType || 'none';
            typeEl.addEventListener('change', () => {
                getSettings().windowBgType = typeEl.value;
                saveSettings();
                if (urlGrp) urlGrp.style.display = typeEl.value !== 'none' ? '' : 'none';
                if (dimGrp) dimGrp.style.display = typeEl.value !== 'none' ? '' : 'none';
                import('./ui-window.js').then(m => m.applyWindowBackground());
                _syncBgToOverlay();
            });
        }
        if (urlEl) {
            urlEl.value = s2.windowBgUrl || '';
            urlEl.addEventListener('input', () => {
                getSettings().windowBgUrl = urlEl.value;
                saveSettings();
                import('./ui-window.js').then(m => m.applyWindowBackground());
                _syncBgToOverlay();
            });
        }
        if (dimEl) {
            dimEl.value = s2.windowBgDim ?? 50;
            if (dimValEl) dimValEl.textContent = `${dimEl.value}%`;
            dimEl.addEventListener('input', () => {
                if (dimValEl) dimValEl.textContent = `${dimEl.value}%`;
            });
            dimEl.addEventListener('change', () => {
                getSettings().windowBgDim = parseInt(dimEl.value);
                saveSettings();
                import('./ui-window.js').then(m => m.applyWindowBackground());
                _syncBgToOverlay();
            });
        }
    };
    _bindBg('scp-bg-type','scp-bg-url','scp-bg-url-group','scp-bg-dim','scp-bg-dim-group','scp-bg-dim-val');

    bindInput('scp-picker-lines', 'pickerPreviewLines', Number);
    bindInput('scp-picker-last-lines', 'pickerPreviewLastLines', Number);

    bindSelect('scp-image-mode', 'imageAnalysisMode', () => {
        const spEl = document.getElementById('scp-sp-image-mode');
        if (spEl) spEl.value = getSettings().imageAnalysisMode;
    });

    import('./ui-window.js').then(m => m._setupBgUpload('scp-bg-upload-btn', 'scp-bg-url', () => _syncBgToOverlay()));
}

export function setupSettingsPanelListeners() {
    const overlay = document.getElementById('scp-settings-overlay');
    if (!overlay) return;

    document.getElementById('scp-sp-close')?.addEventListener('click', () => closeSettingsPanel());
    let _spMouseDown = null;
    overlay.addEventListener('mousedown', e => { _spMouseDown = e.target; });
    overlay.addEventListener('click', e => { if (e.target === overlay && _spMouseDown === overlay) closeSettingsPanel(); });

    overlay.querySelectorAll('.scp-sp-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            overlay.querySelectorAll('.scp-sp-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const pane = tab.dataset.sptab;
            overlay.querySelectorAll('.scp-sp-tab-pane').forEach(p => {
                p.style.display = p.id === `scp-sp-pane-${pane}` ? '' : 'none';
            });
            if (pane === 'stats') {
                import('../features/feature-stats.js').then(module => {
                    const statsContainer = document.getElementById('scp-sp-stats-container');
                    if (statsContainer) module.renderStatsPane(statsContainer);
                });
            }
            if (pane === 'memory') {
                import('../features/feature-memory.js').then(module => module.setupMemorySettingsUI());
            }
            if (pane === 'tools') {
                import('../features/feature-tools-ui.js').then(module => module.setupToolsSettingsUI());
            }
        });
    });

    const saveGlobal = (key, val, cb) => {
        getSettings()[key] = val; saveSettings();
        state.configDirty = true; _updateDirtyDots();
        const stEl = document.getElementById({
            enabled:'scp-enabled', hotkeyEnabled:'scp-hotkey-enabled', hotkey:'scp-hotkey',
            searchHotkeyEnabled:'scp-search-hotkey-enabled', searchHotkey:'scp-search-hotkey',
            floatingIconPersistent:'scp-icon-persistent', connectionSource:'scp-conn-source',
            maxTokens:'scp-max-tokens', localHistoryLimit:'scp-history-limit',
            contextDepth:'scp-depth-slider', includeSystemPrompt:'scp-include-sysprompt',
            includeAuthorsNote:'scp-include-anote', includeCharacterCard:'scp-include-charcard',
            includeUserPersonality:'scp-include-persona', reasoningTrimStrings:'scp-reasoning-trim',
            systemPrompt:'scp-sysprompt', lorebookManagePrompt:'scp-lb-manage-prompt',
            lorebookSTScanDepth:'scp-lb-st-scan-depth', lorebookCopilotScanDepth:'scp-lb-copilot-scan-depth',
            connectionProfileId:'scp-conn-profile',
            customUrl: 'scp-custom-url', customKey: 'scp-custom-key', customModel: 'scp-custom-model',
            opacity:'scp-opacity-slider', ghostModeOpacity:'scp-ghost-opacity',
            ghostModeHotkeyEnabled:'scp-ghost-hotkey-enabled', ghostModeHotkey:'scp-ghost-hotkey',
            applyRegexToContext:'scp-apply-regex',
            charEditAIEnabled: 'scp-char-edit-enabled',
            charEditPrompt: 'scp-char-edit-prompt',
            lorebookAIManageEnabled: 'scp-lb-ai-enabled-st',
            lorebookAutoKeyword: 'scp-lb-auto-kw-st',
            wobbleWindow: 'scp-wobble-window', performanceMode: 'scp-perf-mode',
            includeSummaryception: 'scp-include-summaryception',
            useAspectEvolutia: 'scp-use-aspect-evolutia',
            includeHiddenMessages: 'scp-include-hidden-msgs',
            autoExpandMacros: 'scp-auto-expand-macros',
            includeAlternateSwipes: 'scp-include-alt-swipes',
        }[key]);
        if (stEl) {
            if (stEl.type === 'checkbox') stEl.checked = !!val;
            else if (key === 'charEditPrompt') stEl.value = val || DEFAULT_CHAR_EDIT_DIRECTIVE.trim();
            else stEl.value = val ?? '';
            
            if (key === 'connectionSource') {
                const stGroup = document.getElementById('scp-profile-group');
                if (stGroup) stGroup.style.display = val === 'profile' ? '' : 'none';
                const cGroup = document.getElementById('scp-custom-profile-group');
                if (cGroup) cGroup.style.display = val === 'custom' ? '' : 'none';
            }
        }

        syncOverlayUI(key, val);
        _pruneMatchingOverrides();

        if (cb) cb(val);
        import('./ui-chat.js').then(m => m.updateMsgCount(getCurrentSession()));
    };

    function _pruneMatchingOverrides() {
        const s = getSettings();
        const bucket = getChatBucket();
        let changed = false;
        bucket.sessions.forEach(sess => {
            if (!sess.overrides) return;
            for (const key of Object.keys(sess.overrides)) {
                let globalVal = s[key];
                if (key.startsWith('charField_')) {
                    const fKey = key.replace('charField_', '');
                    globalVal = (s.charEditFields || {})[fKey] !== false;
                }
                
                const sessVal = sess.overrides[key];
                const isEqual = typeof globalVal === 'boolean' 
                    ? sessVal === globalVal 
                    : String(sessVal) === String(globalVal);

                if (isEqual) {
                    delete sess.overrides[key];
                    changed = true;
                }
            }
        });
        if (changed) {
            saveSessionsToMetadata();
            updateSessionOverrideIndicator();
        }
    }

    const bGCheck = (spId, key, cb) => {
        const el = document.getElementById(spId); if (!el) return;
        el.addEventListener('change', () => saveGlobal(key, el.checked, cb));
    };
    const bGInput = (spId, key, toVal, cb) => {
        const el = document.getElementById(spId); if (!el) return;
        el.addEventListener('input', () => saveGlobal(key, toVal ? toVal(el.value) : el.value, cb));
    };
    const bGSelect = (spId, key, cb) => {
        const el = document.getElementById(spId); if (!el) return;
        el.addEventListener('change', () => saveGlobal(key, el.value, cb));
    };

    bGCheck('scp-sp-enabled', 'enabled', () => {
        const ss = getSettings();
        const btn = document.getElementById('scp-wand-btn');
        if (btn) btn.style.display = ss.enabled ? '' : 'none';
        if (!ss.enabled) import('./ui-window.js').then(m => m.hideWindow());
        import('./ui-window.js').then(m => m.updateIconVisibility(document.getElementById('scp-dock-icon')));
    });
    
    bGCheck('scp-sp-perf-mode', 'performanceMode', () => {
        import('./ui-window.js').then(m => m.applyCustomTheme(getSettings().customTheme || THEME_PRESETS.default));
    });
    
    bGCheck('scp-sp-hotkey-enabled', 'hotkeyEnabled');
    bGInput('scp-sp-hotkey', 'hotkey');

    bGCheck('scp-sp-search-hotkey-enabled', 'searchHotkeyEnabled', () => {
        import('./ui-chat.js').then(m => m.setupSearchHotkey());
    });
    bGInput('scp-sp-search-hotkey', 'searchHotkey', null, () => {
        import('./ui-chat.js').then(m => m.setupSearchHotkey());
    });
    
    bGCheck('scp-sp-icon-persistent', 'floatingIconPersistent', () => {
        import('./ui-window.js').then(m => m.updateIconVisibility(document.getElementById('scp-dock-icon')));
    });

    // Wobble Window (Settings Overlay)
    bGCheck('scp-sp-wobble-window', 'wobbleWindow');
    
    bGCheck('scp-sp-changelog-auto', 'changelogAutoShow');
    document.getElementById('scp-sp-open-changelog')?.addEventListener('click', () => { 
        closeSettingsPanel(); 
        import('./ui-widgets.js').then(m => m.openChangelog()); 
    });

    const spOpSlider = document.getElementById('scp-sp-opacity-slider');
    const spOpVal = document.getElementById('scp-sp-opacity-val');
    if (spOpSlider) {
        spOpSlider.addEventListener('input', () => { if (spOpVal) spOpVal.textContent = `${spOpSlider.value}%`; });
        spOpSlider.addEventListener('change', () => {
            const v = parseInt(spOpSlider.value);
            saveGlobal('opacity', v, () => {
                const win = document.getElementById('scp-window');
                if (!state.ghostModeActive && win) win.style.opacity = (v / 100).toString();
            });
        });
    }

    bGCheck('scp-sp-ghost-hotkey-enabled', 'ghostModeHotkeyEnabled', () => {
        import('./ui-window.js').then(m => m.setupGhostHotkey());
    });
    bGInput('scp-sp-ghost-hotkey', 'ghostModeHotkey', null, () => {
        import('./ui-window.js').then(m => m.setupGhostHotkey());
    });

    document.querySelectorAll('.scp-stream-btn:not(.scp-ov-stream-btn)').forEach(btn => {
        btn.addEventListener('click', () => {
            const val = btn.dataset.stream;
            saveGlobal('forceStreaming', val, null);
        });
    });

    const spGhOp = document.getElementById('scp-sp-ghost-opacity');
    const spGhOpVal = document.getElementById('scp-sp-ghost-opacity-val');
    if (spGhOp) {
        spGhOp.addEventListener('input', () => { if (spGhOpVal) spGhOpVal.textContent = `${spGhOp.value}%`; });
        spGhOp.addEventListener('change', () => {
            const v = parseInt(spGhOp.value);
            saveGlobal('ghostModeOpacity', v, () => {
                const win = document.getElementById('scp-window');
                if (state.ghostModeActive && win) win.style.opacity = (v / 100).toString();
            });
        });
    }

    bGSelect('scp-sp-conn-source', 'connectionSource', v => {
        const gCp = document.getElementById('scp-sp-global-profile-group');
        if (gCp) gCp.style.display = v === 'profile' ? '' : 'none';
        const cPg = document.getElementById('scp-sp-custom-profile-group');
        if (cPg) cPg.style.display = v === 'custom' ? '' : 'none';
        if (v === 'profile') updateSPConnProfileList();
    });
    bGInput('scp-sp-custom-url', 'customUrl');
    bGInput('scp-sp-custom-key', 'customKey');
    bGInput('scp-sp-custom-model', 'customModel');

    document.getElementById('scp-sp-conn-profile')?.addEventListener('change', e => saveGlobal('connectionProfileId', e.target.value));

    bGInput('scp-sp-max-tokens', 'maxTokens', Number);
    bGInput('scp-sp-history-limit', 'localHistoryLimit', Number);

    const spDs = document.getElementById('scp-sp-depth-slider');
    const spDv = document.getElementById('scp-sp-depth-val');
    if (spDs) {
        spDs.addEventListener('input', () => { if (spDv) spDv.textContent = spDs.value; });
        spDs.addEventListener('change', () => {
            saveGlobal('contextDepth', parseInt(spDs.value));
            const stSlider = document.getElementById('scp-depth-slider');
            const stVal = document.getElementById('scp-depth-val');
            if (stSlider) stSlider.value = spDs.value;
            if (stVal) stVal.textContent = spDs.value;
        });
    }

    bGCheck('scp-sp-include-sysprompt', 'includeSystemPrompt');
    bGCheck('scp-sp-include-persona', 'includeUserPersonality');
    bGCheck('scp-sp-apply-regex', 'applyRegexToContext');
    bGInput('scp-sp-reasoning-trim', 'reasoningTrimStrings');
    bGCheck('scp-sp-include-summaryception', 'includeSummaryception');
    bGCheck('scp-sp-use-aspect-evolutia', 'useAspectEvolutia');
    bGCheck('scp-sp-auto-expand-macros', 'autoExpandMacros');
    bGCheck('scp-sp-include-hidden-msgs', 'includeHiddenMessages');
    bGCheck('scp-sp-include-alt-swipes', 'includeAlternateSwipes');

    const spPrompt = document.getElementById('scp-sp-sysprompt');
    if (spPrompt) spPrompt.addEventListener('input', () => saveGlobal('systemPrompt', spPrompt.value));
    document.getElementById('scp-sp-reset-prompt')?.addEventListener('click', async () => {
        const ok = await showCustomDialog({ type: 'confirm', title: 'Reset System Prompt', message: 'Reset to default? Your current prompt will be lost.' });
        if (!ok) return;
        getSettings().systemPrompt = DEFAULT_SYSTEM_PROMPT;
        saveSettings();
        if (spPrompt) spPrompt.value = DEFAULT_SYSTEM_PROMPT;
        const stPrompt = document.getElementById('scp-sysprompt');
        if (stPrompt) stPrompt.value = DEFAULT_SYSTEM_PROMPT;
        import('./ui-chat.js').then(m => m.updateMsgCount(getCurrentSession()));
        toastr.success('System prompt reset.', EXT_DISPLAY);
    });

    bGInput('scp-sp-lb-manage-prompt', 'lorebookManagePrompt');
    document.getElementById('scp-sp-reset-lb-prompt')?.addEventListener('click', async () => {
        const ok = await showCustomDialog({ type: 'confirm', title: 'Reset LB Prompt', message: 'Reset to default?' });
        if (!ok) return;
        getSettings().lorebookManagePrompt = DEFAULT_LB_MANAGE_PROMPT;
        saveSettings();
        const el = document.getElementById('scp-sp-lb-manage-prompt'); if (el) el.value = DEFAULT_LB_MANAGE_PROMPT;
        const stEl = document.getElementById('scp-lb-manage-prompt'); if (stEl) stEl.value = DEFAULT_LB_MANAGE_PROMPT;
        toastr.success('Lorebook prompt reset.', EXT_DISPLAY);
    });
    bGInput('scp-sp-lb-st-scan-depth', 'lorebookSTScanDepth', Number);
    bGInput('scp-sp-lb-copilot-scan-depth', 'lorebookCopilotScanDepth', Number);

    document.getElementById('scp-sp-lb-ai-enabled')?.addEventListener('change', e => {
        saveGlobal('lorebookAIManageEnabled', e.target.checked);
        const stEl = document.getElementById('scp-lb-ai-enabled-st');
        if (stEl) stEl.checked = e.target.checked;
    });
    document.getElementById('scp-sp-lb-auto-kw')?.addEventListener('change', async e => {
        saveGlobal('lorebookAutoKeyword', e.target.checked);
        const s2 = getSettings();
        import('../features/feature-lorebook-engine.js').then(async m => {
            await m.buildLorebookContextBlock(s2);
            import('../features/feature-lorebook-ui.js').then(async ui => {
                ui.updateLBFooterInfo();
                if (state.lbActiveBook) await ui.renderEntryList(state.lbActiveBook, state.lbSearchQuery);
            });
        });
        const stEl = document.getElementById('scp-lb-auto-kw-st');
        if (stEl) stEl.checked = e.target.checked;
    });

    const bGCharField = (id, fieldKey) => {
        const el = document.getElementById(id); if (!el) return;
        el.addEventListener('change', () => {
            const s = getSettings();
            if (!s.charEditFields) s.charEditFields = {};
            s.charEditFields[fieldKey] = el.checked;
            saveSettings(); 
            import('./ui-chat.js').then(m => m.updateMsgCount(getCurrentSession()));
            const stIdMap = {
                tags: 'scp-ce-tags',
                description: 'scp-ce-description', personality: 'scp-ce-personality',
                scenario: 'scp-ce-scenario', first_mes: 'scp-ce-first-mes',
                mes_example: 'scp-ce-mes-example', authors_note: 'scp-ce-authors-note',
                alternate_greetings: 'scp-ce-alt-greetings',
            };
            const stEl = document.getElementById(stIdMap[fieldKey]);
            if (stEl) stEl.checked = el.checked;
            
            syncOverlayUI('charField_' + fieldKey, el.checked);
            _markDirty('config');
        });
    };
    bGCheck('scp-sp-char-edit-enabled', 'charEditAIEnabled');
    bGCharField('scp-sp-ce-tags', 'tags');
    bGCharField('scp-sp-ce-description', 'description');
    bGCharField('scp-sp-ce-personality', 'personality');
    bGCharField('scp-sp-ce-scenario', 'scenario');
    bGCharField('scp-sp-ce-first-mes', 'first_mes');
    bGCharField('scp-sp-ce-mes-example', 'mes_example');
    bGCharField('scp-sp-ce-authors-note', 'authors_note');
    bGCharField('scp-sp-ce-alt-greetings', 'alternate_greetings');
    document.getElementById('scp-sp-ce-alt-greetings')?.addEventListener('change', () => {
        const picker = document.getElementById('scp-sp-ce-alt-greetings-picker');
        if (picker) { 
            picker.style.display = getSettings().charEditFields?.alternate_greetings ? '' : 'none'; 
            import('../features/feature-character-ui.js').then(m => m.refreshAltGreetingsPickers()); 
        }
    });
    document.getElementById('scp-sp-char-edit-prompt')?.addEventListener('input', e => {
        const val = e.target.value;
        getSettings().charEditPrompt = (val.trim() === DEFAULT_CHAR_EDIT_DIRECTIVE.trim()) ? '' : val;
        saveSettings();
        _markDirty('config');
    });
    document.getElementById('scp-sp-reset-char-edit-prompt')?.addEventListener('click', async () => {
        const ok = await showCustomDialog({ type: 'confirm', title: 'Reset Char Edit Prompt', message: 'Reset to built-in default prompt?' });
        if (!ok) return;
        getSettings().charEditPrompt = '';
        saveSettings();
        _markDirty('config');
        const el = document.getElementById('scp-sp-char-edit-prompt');
        if (el) el.value = DEFAULT_CHAR_EDIT_DIRECTIVE.trim();
        toastr.success('Char edit prompt reset to default.', EXT_DISPLAY);
    });
    bGCheck('scp-sp-chat-edit-enabled', 'chatEditAIEnabled', () => {
        const stEl = document.getElementById('scp-chat-edit-enabled-st');
        if (stEl) stEl.checked = getSettings().chatEditAIEnabled;
    });
    bGCheck('scp-sp-memory-enabled', 'memoryEnabled', () => {
        const stEl = document.getElementById('scp-memory-enabled');
        if (stEl) stEl.checked = getSettings().memoryEnabled;
    });
    bGCheck('scp-sp-memory-inject', 'memoryInject', () => {
        const stEl = document.getElementById('scp-memory-inject');
        if (stEl) stEl.checked = getSettings().memoryInject;
    });
    bGCheck('scp-sp-memory-notify', 'memoryNotify');
    document.getElementById('scp-sp-chat-edit-prompt')?.addEventListener('input', e => {
        const val = e.target.value;
        getSettings().chatEditPrompt = (val.trim() === DEFAULT_CHAT_EDIT_DIRECTIVE.trim()) ? '' : val;
        saveSettings();
        _markDirty('config');
        const stEl = document.getElementById('scp-chat-edit-prompt-st');
        if (stEl) stEl.value = val;
    });
    document.getElementById('scp-sp-reset-chat-edit-prompt')?.addEventListener('click', async () => {
        const ok = await showCustomDialog({ type: 'confirm', title: 'Reset Chat Edit Prompt', message: 'Reset to default?' });
        if (!ok) return;
        getSettings().chatEditPrompt = ''; saveSettings(); _markDirty('config');
        const spEl = document.getElementById('scp-sp-chat-edit-prompt');
        if (spEl) spEl.value = DEFAULT_CHAT_EDIT_DIRECTIVE.trim();
        const stEl = document.getElementById('scp-chat-edit-prompt-st');
        if (stEl) stEl.value = DEFAULT_CHAT_EDIT_DIRECTIVE.trim();
        toastr.success('Chat edit prompt reset.', EXT_DISPLAY);
    });

    // Profile buttons
    document.getElementById('scp-sp-profile-select')?.addEventListener('change', async () => {
        const sel = document.getElementById('scp-sp-profile-select'); if (!sel?.value) return;
        if (isConfigProfileDirty()) {
            const ok = await showCustomDialog({ type: 'confirm', title: 'Unsaved Configuration', message: 'Unsaved changes in current profile. Switch anyway?' });
            if (!ok) { sel.value = getSettings().activeProfile || ''; return; }
        }
        loadProfile(sel.value);
        syncSPFromSettings();
        updateSettingsUI();
        updateSPBindingSection();
    });
    document.getElementById('scp-sp-profile-save')?.addEventListener('click', async () => {
        const sel = document.getElementById('scp-sp-profile-select');
        let name = sel?.value;
        if (!name) {
            name = await showCustomDialog({ type: 'prompt', title: 'Save Configuration', message: 'Profile name:', placeholder: 'My Config' });
            if (!name?.trim()) return;
            name = name.trim();
        }
        saveProfile(name); refreshSPProfilesDropdown(); refreshProfilesDropdown();
        if (sel) sel.value = name;
        updateSPBindingSection(); toastr.success(`Saved "${name}"`, EXT_DISPLAY);
        _clearDirty('config');
    });
    document.getElementById('scp-sp-profile-create')?.addEventListener('click', async () => {
        const name = await showCustomDialog({ type: 'prompt', title: 'New Configuration', message: 'Name:', placeholder: 'New Config' });
        if (!name?.trim()) return;
        const n = name.trim(); const s = getSettings();
        s.profiles[n] = { systemPrompt: DEFAULT_SYSTEM_PROMPT, includeSystemPrompt: true, includeAuthorsNote: true, includeCharacterCard: true, includeUserPersonality: true, contextDepth: 15, localHistoryLimit: 50, connectionSource: 'default', connectionProfileId: '', maxTokens: 8200, applyRegexToContext: true };
        saveSettings(); refreshSPProfilesDropdown(); refreshProfilesDropdown();
        loadProfile(n); syncSPFromSettings(); updateSettingsUI();
        const sel = document.getElementById('scp-sp-profile-select'); if (sel) sel.value = n;
        updateSPBindingSection(); toastr.success(`Created "${n}"`, EXT_DISPLAY);
    });
    document.getElementById('scp-sp-profile-duplicate')?.addEventListener('click', async () => {
        const sel = document.getElementById('scp-sp-profile-select');
        if (!sel?.value) return toastr.info('No configuration selected.', EXT_DISPLAY);
        const defaultName = sel.value + ' (Copy)';
        const newName = await showCustomDialog({ type: 'prompt', title: 'Duplicate Configuration', message: 'Name for the new profile:', defaultValue: defaultName });
        if (!newName?.trim()) return;
        const n = newName.trim();
        const s2 = getSettings();
        const p = s2.profiles[sel.value];
        if (!p) return;
        s2.profiles[n] = JSON.parse(JSON.stringify(p));
        saveSettings(); refreshSPProfilesDropdown(); refreshProfilesDropdown();
        loadProfile(n); syncSPFromSettings(); updateSettingsUI();
        const newSel = document.getElementById('scp-sp-profile-select'); if (newSel) newSel.value = n;
        updateSPBindingSection(); toastr.success(`Duplicated as "${n}"`, EXT_DISPLAY);
    });
    document.getElementById('scp-sp-profile-rename')?.addEventListener('click', async () => {
        const sel = document.getElementById('scp-sp-profile-select'); if (!sel?.value) return;
        const newName = await showCustomDialog({ type: 'prompt', title: 'Rename', message: 'New name:', defaultValue: sel.value });
        if (!newName?.trim() || newName.trim() === sel.value) return;
        const s = getSettings(); const p = s.profiles[sel.value]; if (!p) return;
        s.profiles[newName.trim()] = p; delete s.profiles[sel.value];
        if (s.activeProfile === sel.value) s.activeProfile = newName.trim();
        for (const k in s.profileBindings) { if (s.profileBindings[k] === sel.value) s.profileBindings[k] = newName.trim(); }
        saveSettings(); refreshSPProfilesDropdown(); refreshProfilesDropdown();
        const newSel = document.getElementById('scp-sp-profile-select'); if (newSel) newSel.value = newName.trim();
        updateSPBindingSection(); toastr.success('Renamed.', EXT_DISPLAY);
    });
    document.getElementById('scp-sp-profile-delete')?.addEventListener('click', async () => {
        const sel = document.getElementById('scp-sp-profile-select'); if (!sel?.value) return;
        const s = getSettings();
        if (Object.keys(s.profiles).length <= 1) { toastr.warning('Cannot delete the last profile.', EXT_DISPLAY); return; }
        const ok = await showCustomDialog({ type: 'confirm', title: 'Delete Profile', message: `Delete "${sel.value}"?` });
        if (!ok) return;
        deleteProfile(sel.value); refreshSPProfilesDropdown(); refreshProfilesDropdown();
        updateSPBindingSection(); toastr.success('Deleted.', EXT_DISPLAY);
    });
    document.getElementById('scp-sp-bind-char')?.addEventListener('click', () => {
        const sel = document.getElementById('scp-sp-profile-select'); if (!sel?.value) return;
        const s = getSettings(); const { charId } = getBindingKey(); const key = `char_${charId}`;
        if (s.profileBindings[key] === sel.value) delete s.profileBindings[key];
        else s.profileBindings[key] = sel.value;
        saveSettings(); updateSPBindingSection(); document.getElementById('scp-sp-bind-char')?.classList.toggle('active', s.profileBindings[key] === sel.value);
    });
    document.getElementById('scp-sp-bind-chat')?.addEventListener('click', () => {
        const sel = document.getElementById('scp-sp-profile-select'); if (!sel?.value) return;
        const s = getSettings(); const { charId, chatId } = getBindingKey(); const key = `chat_${charId}_${chatId}`;
        if (s.profileBindings[key] === sel.value) delete s.profileBindings[key];
        else s.profileBindings[key] = sel.value;
        saveSettings(); updateSPBindingSection(); document.getElementById('scp-sp-bind-chat')?.classList.toggle('active', s.profileBindings[key] === sel.value);
    });

    // Sessions and Downloads
    document.getElementById('scp-sp-download-debug')?.addEventListener('click', () => {
        import('../utils/util-debug.js').then(m => m.dbgDownload());
    });
    
    document.getElementById('scp-sp-clear-sessions')?.addEventListener('click', async () => {
        const ok = await showCustomDialog({ 
            type: 'confirm', 
            title: 'Clear All Sessions', 
            message: 'Delete ALL Copilot sessions from global storage AND clear sessions for the CURRENT chat? (Cannot clear other inactive chats). This cannot be undone.',
            delayConfirm: 3
        });
        if (!ok) return;
        getSettings().sessions = {}; saveSettings(); 
        const ctx = SillyTavern.getContext();
        if (ctx.chatMetadata) delete ctx.chatMetadata.st_copilot;
        initChatBucket().then(() => {
            import('./ui-chat.js').then(m => m.onChatChanged());
            toastr.success('Sessions cleared.', EXT_DISPLAY);
        });
    });

    // Sound unfocused (overlay)
    const spSoundUnfocusedEl = document.getElementById('scp-sp-sound-unfocused');
    if (spSoundUnfocusedEl) {
        spSoundUnfocusedEl.checked = !!getSettings().completionSoundOnlyWhenUnfocused;
        spSoundUnfocusedEl.addEventListener('change', () => {
            getSettings().completionSoundOnlyWhenUnfocused = spSoundUnfocusedEl.checked;
            saveSettings();
            const stEl = document.getElementById('scp-sound-unfocused');
            if (stEl) stEl.checked = spSoundUnfocusedEl.checked;
        });
    }

    // Background (overlay)
    const spBgType = document.getElementById('scp-sp-bg-type');
    const spBgUrl = document.getElementById('scp-sp-bg-url');
    const spBgUrlGrp = document.getElementById('scp-sp-bg-url-group');
    const spBgDim = document.getElementById('scp-sp-bg-dim');
    const spBgDimGrp = document.getElementById('scp-sp-bg-dim-group');
    const spBgDimVal = document.getElementById('scp-sp-bg-dim-val');
    if (spBgType) {
        spBgType.value = getSettings().windowBgType || 'none';
        spBgType.addEventListener('change', () => {
            getSettings().windowBgType = spBgType.value;
            saveSettings();
            if (spBgUrlGrp) spBgUrlGrp.style.display = spBgType.value !== 'none' ? '' : 'none';
            if (spBgDimGrp) spBgDimGrp.style.display = spBgType.value !== 'none' ? '' : 'none';
            import('./ui-window.js').then(m => m.applyWindowBackground());
            _syncBgToOverlay();
        });
    }
    if (spBgUrl) {
        spBgUrl.value = getSettings().windowBgUrl || '';
        spBgUrl.addEventListener('input', () => {
            getSettings().windowBgUrl = spBgUrl.value;
            saveSettings();
            import('./ui-window.js').then(m => m.applyWindowBackground());
            _syncBgToOverlay();
        });
    }
    if (spBgDim) {
        spBgDim.value = getSettings().windowBgDim ?? 50;
        if (spBgDimVal) spBgDimVal.textContent = `${spBgDim.value}%`;
        spBgDim.addEventListener('input', () => {
            if (spBgDimVal) spBgDimVal.textContent = `${spBgDim.value}%`;
        });
        spBgDim.addEventListener('change', () => {
            getSettings().windowBgDim = parseInt(spBgDim.value);
            saveSettings();
            import('./ui-window.js').then(m => m.applyWindowBackground());
            _syncBgToOverlay();
        });
    }

    // Picker lines (overlay)
    const spPickerLines = document.getElementById('scp-sp-picker-lines');
    if (spPickerLines) {
        spPickerLines.value = getSettings().pickerPreviewLines ?? 1;
        spPickerLines.addEventListener('input', () => {
            getSettings().pickerPreviewLines = parseInt(spPickerLines.value) || 1;
            saveSettings();
            const stEl = document.getElementById('scp-picker-lines');
            if (stEl) stEl.value = spPickerLines.value;
        });
    }
    const spPickerLast = document.getElementById('scp-sp-picker-last-lines');
    if (spPickerLast) {
        spPickerLast.value = getSettings().pickerPreviewLastLines ?? 0;
        spPickerLast.addEventListener('input', () => {
            getSettings().pickerPreviewLastLines = parseInt(spPickerLast.value) || 0;
            saveSettings();
            const stEl = document.getElementById('scp-picker-last-lines');
            if (stEl) stEl.value = spPickerLast.value;
        });
    }

    // Image mode (overlay)
    const spImgMode = document.getElementById('scp-sp-image-mode');
    if (spImgMode) {
        spImgMode.value = getSettings().imageAnalysisMode || 'direct';
        spImgMode.addEventListener('change', () => {
            getSettings().imageAnalysisMode = spImgMode.value;
            saveSettings();
            const stEl = document.getElementById('scp-image-mode');
            if (stEl) stEl.value = spImgMode.value;
        });
    }

    // ── SESSION OVERRIDES ──
    function syncOvClear(key, newVal) {
        let globalVal = getSettings()[key];
        if (key.startsWith('charField_')) {
            const fKey = key.replace('charField_', '');
            globalVal = (getSettings().charEditFields || {})[fKey] !== false;
        }

        const isDefault = (newVal === undefined || newVal === null || newVal === '')
            ? true
            : (typeof globalVal === 'boolean'
                ? newVal === globalVal
                : String(newVal) === String(globalVal));
        
        if (isDefault) setSessionOverride(key, undefined);
        else setSessionOverride(key, newVal);
        
        updateSPOverrideIndicators();
        import('./ui-chat.js').then(m => m.updateMsgCount(getCurrentSession()));
    }

    const bindOvCheck = (spId, key) => {
        const el = document.getElementById(spId); if (!el) return;
        el.addEventListener('change', () => syncOvClear(key, el.checked));
    };
    const bindOvInput = (spId, key, toVal) => {
        const el = document.getElementById(spId); if (!el) return;
        el.addEventListener('input', () => {
            const raw = el.value === '' ? undefined : (toVal ? toVal(el.value) : el.value);
            syncOvClear(key, raw);
        });
    };

    const ovDs = document.getElementById('scp-sp-ov-depth-slider');
    const ovDv = document.getElementById('scp-sp-ov-depth-val');
    if (ovDs) {
        ovDs.addEventListener('input', () => { if (ovDv) ovDv.textContent = ovDs.value; });
        ovDs.addEventListener('change', () => syncOvClear('contextDepth', parseInt(ovDs.value)));
    }

    document.getElementById('scp-sp-ov-conn-source')?.addEventListener('change', e => {
        syncOvClear('connectionSource', e.target.value);
        const pg = document.getElementById('scp-sp-ov-profile-group');
        if (pg) pg.style.display = e.target.value === 'profile' ? '' : 'none';
        const cg = document.getElementById('scp-sp-ov-custom-profile-group');
        if (cg) cg.style.display = e.target.value === 'custom' ? '' : 'none';
        if (e.target.value === 'profile') updateSPConnProfileList();
    });
    bindOvInput('scp-sp-ov-custom-url', 'customUrl');
    bindOvInput('scp-sp-ov-custom-key', 'customKey');
    bindOvInput('scp-sp-ov-custom-model', 'customModel');
    document.getElementById('scp-sp-ov-conn-profile')?.addEventListener('change', e => {
        syncOvClear('connectionProfileId', e.target.value);
    });

    bindOvInput('scp-sp-ov-max-tokens', 'maxTokens', Number);
    bindOvInput('scp-sp-ov-history-limit', 'localHistoryLimit', Number);
    bindOvInput('scp-sp-ov-reasoning-trim', 'reasoningTrimStrings');
    bindOvInput('scp-sp-ov-char-edit-prompt', 'charEditPrompt');
    bindOvInput('scp-sp-ov-lb-manage-prompt', 'lorebookManagePrompt');
    bindOvInput('scp-sp-ov-chat-edit-prompt', 'chatEditPrompt');

    const ovPrompt = document.getElementById('scp-sp-ov-sysprompt');
    if (ovPrompt) ovPrompt.addEventListener('input', () => syncOvClear('systemPrompt', ovPrompt.value || undefined));

    bindOvCheck('scp-sp-ov-include-sysprompt', 'includeSystemPrompt');
    bindOvCheck('scp-sp-ov-include-persona', 'includeUserPersonality');
    bindOvCheck('scp-sp-ov-include-alt-swipes', 'includeAlternateSwipes');
    bindOvCheck('scp-sp-ov-apply-regex', 'applyRegexToContext');
    bindOvCheck('scp-sp-ov-char-edit-enabled', 'charEditAIEnabled');
    bindOvCheck('scp-sp-ov-lb-ai-enabled', 'lorebookAIManageEnabled');
    bindOvCheck('scp-sp-ov-chat-edit-enabled', 'chatEditAIEnabled');
    bindOvCheck('scp-sp-ov-ce-alt-greetings', 'charField_alternate_greetings');
    bindOvCheck('scp-sp-ov-lb-auto-kw', 'lorebookAutoKeyword');
    document.getElementById('scp-sp-ov-ce-alt-greetings')?.addEventListener('change', (e) => {
        const picker = document.getElementById('scp-sp-ov-ce-alt-greetings-picker');
        if (picker) { 
            picker.style.display = e.target.checked ? '' : 'none'; 
            import('../features/feature-character-ui.js').then(m => m.refreshAltGreetingsPickers()); 
        }
    });

    document.querySelectorAll('.scp-ov-stream-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const val = btn.dataset.stream;
            syncOvClear('forceStreaming', val);
            document.querySelectorAll('.scp-ov-stream-btn').forEach(b => {
                const active = b.dataset.stream === val;
                b.classList.toggle('active', active);
                b.style.color = active ? 'var(--scp-accent)' : '';
                b.style.borderColor = active ? 'var(--scp-accent-dim)' : '';
                b.style.background = active ? 'var(--scp-accent-bg)' : '';
            });
        });
    });
    
    bindOvCheck('scp-sp-ov-ce-tags', 'charField_tags');
    bindOvCheck('scp-sp-ov-ce-description', 'charField_description');
    bindOvCheck('scp-sp-ov-ce-personality', 'charField_personality');
    bindOvCheck('scp-sp-ov-ce-scenario', 'charField_scenario');
    bindOvCheck('scp-sp-ov-ce-first-mes', 'charField_first_mes');
    bindOvCheck('scp-sp-ov-ce-mes-example', 'charField_mes_example');
    bindOvCheck('scp-sp-ov-ce-authors-note', 'charField_authors_note');
    bindOvCheck('scp-sp-ov-ce-alt-greetings', 'charField_alternate_greetings');

    document.querySelectorAll('.scp-sp-ov-clear[data-ovkey]').forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.dataset.ovkey;
            setSessionOverride(key, undefined);
            const eff = getEffectiveSettings();
            const ov = getSessionOverrides();
            const elMap = {
                contextDepth: ['scp-sp-ov-depth-slider', 'scp-sp-ov-depth-val'],
                maxTokens: ['scp-sp-ov-max-tokens'],
                localHistoryLimit: ['scp-sp-ov-history-limit'],
                reasoningTrimStrings: ['scp-sp-ov-reasoning-trim'],
                systemPrompt: ['scp-sp-ov-sysprompt'],
                connectionSource: ['scp-sp-ov-conn-source'],
                customUrl: ['scp-sp-ov-custom-url'],
                customKey: ['scp-sp-ov-custom-key'],
                customModel: ['scp-sp-ov-custom-model'],
                connectionProfileId: ['scp-sp-ov-conn-profile'],
                includeSystemPrompt: ['scp-sp-ov-include-sysprompt'],
                includeUserPersonality: ['scp-sp-ov-include-persona'],
                includeAlternateSwipes: ['scp-sp-ov-include-alt-swipes'],
                applyRegexToContext: ['scp-sp-ov-apply-regex'],
                charField_tags: ['scp-sp-ov-ce-tags'],
                charField_description: ['scp-sp-ov-ce-description'],
                charField_personality: ['scp-sp-ov-ce-personality'],
                charField_scenario: ['scp-sp-ov-ce-scenario'],
                charField_first_mes: ['scp-sp-ov-ce-first-mes'],
                charField_mes_example: ['scp-sp-ov-ce-mes-example'],
                charField_authors_note: ['scp-sp-ov-ce-authors-note'],
                charField_alternate_greetings: ['scp-sp-ov-ce-alt-greetings'],
                charEditAIEnabled: ['scp-sp-ov-char-edit-enabled'],
                charEditPrompt: ['scp-sp-ov-char-edit-prompt'],
                lorebookAIManageEnabled: ['scp-sp-ov-lb-ai-enabled'],
                lorebookManagePrompt: ['scp-sp-ov-lb-manage-prompt'],
                lorebookAutoKeyword: ['scp-sp-ov-lb-auto-kw'],
                chatEditAIEnabled: ['scp-sp-ov-chat-edit-enabled'],
                chatEditPrompt: ['scp-sp-ov-chat-edit-prompt'],
            };
            (elMap[key] || []).forEach(id => {
                const el = document.getElementById(id); if (!el) return;
                if (id.includes('depth-val')) { el.textContent = eff.contextDepth ?? 15; return; }
                
                if (el.type === 'checkbox') {
                    if (key.startsWith('charField_')) {
                        const fKey = key.replace('charField_', '');
                        el.checked = (getSettings().charEditFields || {})[fKey] !== false;
                    } else {
                        el.checked = !!eff[key];
                    }
                }
                else if (el.type === 'range') el.value = eff[key] ?? 15;
                else if (id === 'scp-sp-ov-conn-source') {
                    el.value = eff.connectionSource ?? 'default';
                    const pg = document.getElementById('scp-sp-ov-profile-group');
                    if (pg) pg.style.display = el.value === 'profile' ? '' : 'none';
                    const cg = document.getElementById('scp-sp-ov-custom-profile-group');
                    if (cg) cg.style.display = el.value === 'custom' ? '' : 'none';
                }
                else if (id === 'scp-sp-ov-conn-profile') {
                    el.value = eff.connectionProfileId ?? '';
                }
                else el.value = (key in ov ? ov[key] : '') ?? '';
            });
            if (key === 'forceStreaming') {
                const streamVal = eff.forceStreaming === true ? 'on' : (eff.forceStreaming === false ? 'auto' : (eff.forceStreaming || 'auto'));
                document.querySelectorAll('.scp-ov-stream-btn').forEach(b => {
                    const active = b.dataset.stream === streamVal;
                    b.classList.toggle('active', active);
                    b.style.color = active ? 'var(--scp-accent)' : '';
                    b.style.borderColor = active ? 'var(--scp-accent-dim)' : '';
                    b.style.background = active ? 'var(--scp-accent-bg)' : '';
                });
            }
            updateSPOverrideIndicators();
            import('./ui-chat.js').then(m => m.updateMsgCount(getCurrentSession()));
        });
    });

    document.getElementById('scp-sp-reset-all-overrides')?.addEventListener('click', async () => {
        if (!hasSessionOverrides()) { toastr.info('No session overrides active.', EXT_DISPLAY); return; }
        const ok = await showCustomDialog({ type: 'confirm', title: 'Reset Session Overrides', message: 'Clear all session overrides for this session?' });
        if (!ok) return;
        clearAllSessionOverrides();
        syncSPFromSettings();
        import('./ui-chat.js').then(m => m.updateMsgCount(getCurrentSession()));
        toastr.success('Session overrides cleared.', EXT_DISPLAY);
    });

    document.getElementById('scp-sp-reset-memory-prompt')?.addEventListener('click', async () => {
        const ok = await showCustomDialog({ type: 'confirm', title: 'Reset Prompt', message: 'Reset memory prompt to default?' });
        if (!ok) return;
        getSettings().memoryManagePrompt = DEFAULT_MEMORY_PROMPT;
        saveSettings();
        const memPromptEl = document.getElementById('scp-memory-prompt');
        if (memPromptEl) memPromptEl.value = DEFAULT_MEMORY_PROMPT;
        const spEl = document.getElementById('scp-sp-memory-prompt');
        if (spEl) spEl.value = DEFAULT_MEMORY_PROMPT;
        toastr.success('Prompt reset.', EXT_DISPLAY);
    });

    document.getElementById('scp-sp-tools-reset')?.addEventListener('click', async () => {
        const ok = await showCustomDialog({ type: 'confirm', title: 'Reset Prompt', message: 'Reset tools prompt to default?' });
        if (!ok) return;
        getSettings().toolsSystemPrompt = DEFAULT_TOOLS_PROMPT; 
        saveSettings();
        const ta = document.getElementById('scp-sp-tools-prompt');
        if (ta) ta.value = DEFAULT_TOOLS_PROMPT;
        toastr.success('Tools prompt reset.', EXT_DISPLAY);
    });

    import('./ui-window.js').then(m => {
        m._setupBgUpload('scp-sp-bg-upload-btn', 'scp-sp-bg-url', () => _syncBgToOverlay());
    });
    buildBackgroundSettingsUI(document.getElementById('scp-bg-settings'));
}

export function buildBackgroundSettingsUI(container) {
    if (!container) return;
    container.innerHTML = '';
    const s = getSettings();
    if (!s.customBackgrounds) s.customBackgrounds = {};

    const isSP = container.id === 'scp-sp-bg-settings';

    // TYPE SELECTOR
    const typeRow = document.createElement('div');
    typeRow.className = isSP ? 'scp-sp-field' : '';
    
    const typeLbl = document.createElement(isSP ? 'label' : 'b');
    typeLbl.className = isSP ? 'scp-sp-label' : '';
    if (!isSP) typeLbl.style.cssText = 'font-size:11px;color:#888;display:block;margin-bottom:4px';
    typeLbl.textContent = 'Background Type';
    
    const typeWrap = document.createElement('div');
    typeWrap.style.cssText = 'display:flex;gap:6px;align-items:center';
    
    const typeSel = document.createElement('select');
    typeSel.className = isSP ? 'scp-sp-select text_pole' : 'text_pole';
    typeSel.style.flex = '1';
    
    const renderDropdown = () => {
        typeSel.innerHTML = '<option value="none">None</option>';
        if (Object.keys(s.customBackgrounds).length > 0) {
            const groupCustom = document.createElement('optgroup');
            groupCustom.label = 'Custom Backgrounds';
            for (const [key, bg] of Object.entries(s.customBackgrounds)) {
                const opt = document.createElement('option');
                opt.value = key; opt.textContent = bg.name;
                groupCustom.appendChild(opt);
            }
            typeSel.appendChild(groupCustom);
        }
        typeSel.value = s.windowBg || 'none';
    };
    renderDropdown();
    typeWrap.appendChild(typeSel);
    typeRow.appendChild(typeLbl); typeRow.appendChild(typeWrap);
    container.appendChild(typeRow);

    // ACTIONS
    const customActionsWrap = document.createElement('div');
    customActionsWrap.style.cssText = isSP ? 'display:flex;gap:6px;margin-top:6px' : 'display:flex;gap:6px;margin-top:6px;align-items:center';
    
    const uploadBtn = document.createElement('button');
    uploadBtn.className = isSP ? 'scp-action-btn' : 'menu_button interactable';
    uploadBtn.innerHTML = `<i class="fa-solid fa-upload"></i><span>Upload</span>`;
    if (!isSP) uploadBtn.style.flex = '1';

    uploadBtn.addEventListener('click', () => {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'image/*,video/mp4,video/webm';
        inp.onchange = async () => {
            const file = inp.files?.[0]; if (!file) return;
            if (file.size > 25 * 1024 * 1024) { toastr.warning('File too large (>25MB).', EXT_DISPLAY); return; }
            
            const isVideo = file.type.startsWith('video/');
            const dataUrl = await new Promise((res, rej) => {
                const r = new FileReader();
                r.onload = () => res(r.result);
                r.onerror = () => rej(null);
                r.readAsDataURL(file);
            });
            if (!dataUrl) return;
            
            const s2 = getSettings();
            const id = 'bg_' + Date.now();
            s2.customBackgrounds[id] = { name: file.name, dataUrl, isVideo, fit: 'cover' };
            s2.windowBg = id;
            saveSettings();
            
            const allContainers = [document.getElementById('scp-bg-settings'), document.getElementById('scp-sp-bg-settings')].filter(Boolean);
            allContainers.forEach(c => buildBackgroundSettingsUI(c));
            import('./ui-window.js').then(m => m.applyWindowBackground());
        };
        inp.click();
    });

    const urlBtn = document.createElement('button');
    urlBtn.className = isSP ? 'scp-action-btn' : 'menu_button interactable';
    urlBtn.innerHTML = `<i class="fa-solid fa-link"></i><span>URL</span>`;
    if (!isSP) urlBtn.style.flex = '1';

    urlBtn.addEventListener('click', async () => {
        const url = await showCustomDialog({ type: 'prompt', title: 'Add Background', message: 'Enter direct URL to image or video:', placeholder: 'https://...' });
        if (url && url.trim()) {
            const s2 = getSettings();
            const id = 'bg_' + Date.now();
            const isVideo = url.endsWith('.mp4') || url.endsWith('.webm');
            s2.customBackgrounds[id] = { name: 'URL Background', dataUrl: url.trim(), isVideo, fit: 'cover' };
            s2.windowBg = id;
            saveSettings();
            const allContainers = [document.getElementById('scp-bg-settings'), document.getElementById('scp-sp-bg-settings')].filter(Boolean);
            allContainers.forEach(c => buildBackgroundSettingsUI(c));
            import('./ui-window.js').then(m => m.applyWindowBackground());
        }
    });

    const renameBtn = document.createElement('button');
    renameBtn.className = isSP ? 'scp-action-btn' : 'menu_button interactable';
    renameBtn.innerHTML = `<i class="fa-solid fa-pen"></i><span>Rename</span>`;
    if (!isSP) renameBtn.style.flex = '1';

    renameBtn.addEventListener('click', async () => {
        const val = typeSel.value;
        if (val === 'none') return;
        const bg = s.customBackgrounds[val];
        const newName = await showCustomDialog({ type: 'prompt', title: 'Rename Background', message: 'New name:', defaultValue: bg.name });
        if (newName && newName.trim()) {
            s.customBackgrounds[val].name = newName.trim();
            saveSettings();
            const allContainers = [document.getElementById('scp-bg-settings'), document.getElementById('scp-sp-bg-settings')].filter(Boolean);
            allContainers.forEach(c => buildBackgroundSettingsUI(c));
        }
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = isSP ? 'scp-action-btn scp-sp-danger-btn' : 'menu_button interactable';
    deleteBtn.innerHTML = `<i class="fa-solid fa-trash"></i><span>Delete</span>`;
    if (!isSP) deleteBtn.style.flex = '1';

    deleteBtn.addEventListener('click', async () => {
        const val = typeSel.value;
        if (val === 'none') return;
        const ok = await showCustomDialog({ type: 'confirm', title: 'Delete Background', message: 'Delete this background?' });
        if (!ok) return;
        const s2 = getSettings();
        delete s2.customBackgrounds[val];
        s2.windowBg = 'none';
        saveSettings();
        const allContainers = [document.getElementById('scp-bg-settings'), document.getElementById('scp-sp-bg-settings')].filter(Boolean);
        allContainers.forEach(c => buildBackgroundSettingsUI(c));
        import('./ui-window.js').then(m => m.applyWindowBackground());
    });
    
    customActionsWrap.appendChild(uploadBtn);
    customActionsWrap.appendChild(urlBtn);
    customActionsWrap.appendChild(renameBtn);
    customActionsWrap.appendChild(deleteBtn);
    container.appendChild(customActionsWrap);

    // EXTRA SETTINGS
    const extraWrap = document.createElement('div');
    extraWrap.style.cssText = 'margin-top:12px';

    const fitRow = document.createElement('div');
    fitRow.className = isSP ? 'scp-sp-field' : '';
    const fitLbl = document.createElement('label');
    fitLbl.className = isSP ? 'scp-sp-label' : '';
    if (!isSP) fitLbl.style.cssText = 'font-size:11px;color:#888;display:block;margin-bottom:4px';
    fitLbl.textContent = 'Image/Video Fit';
    const fitSel = document.createElement('select');
    fitSel.className = isSP ? 'scp-sp-select text_pole' : 'text_pole';
    ['cover', 'contain', 'fill', 'center'].forEach(f => {
        const opt = document.createElement('option'); opt.value = f; opt.textContent = f; fitSel.appendChild(opt);
    });
    
    const currentBgData = s.customBackgrounds[s.windowBg];
    fitSel.value = currentBgData?.fit || 'cover';
    
    fitSel.addEventListener('change', () => {
        if (s.windowBg !== 'none' && s.customBackgrounds[s.windowBg]) {
            s.customBackgrounds[s.windowBg].fit = fitSel.value;
            saveSettings();
            const allContainers = [document.getElementById('scp-bg-settings'), document.getElementById('scp-sp-bg-settings')].filter(Boolean);
            allContainers.forEach(c => { const s = c.querySelector('select[id$="fit-sel"]'); if(s) s.value = fitSel.value; });
            import('./ui-window.js').then(m => m.applyWindowBackground());
        }
    });
    fitSel.id = isSP ? 'scp-sp-fit-sel' : 'scp-fit-sel';
    fitRow.appendChild(fitLbl); fitRow.appendChild(fitSel);
    extraWrap.appendChild(fitRow);

    const dimRow = document.createElement('div');
    dimRow.className = isSP ? 'scp-sp-field' : '';
    dimRow.style.marginTop = '8px';
    const dimLbl = document.createElement('label');
    dimLbl.className = isSP ? 'scp-sp-label' : '';
    if (!isSP) dimLbl.style.cssText = 'font-size:11px;color:#888;display:block;margin-bottom:4px';
    dimLbl.textContent = 'Darkness Overlay';
    const dimFlex = document.createElement('div');
    dimFlex.className = isSP ? 'scp-sp-row' : '';
    if (!isSP) dimFlex.style.cssText = 'display:flex;align-items:center;gap:10px';
    
    const dimSlider = document.createElement('input');
    dimSlider.type = 'range'; dimSlider.min = '0'; dimSlider.max = '100';
    dimSlider.className = isSP ? 'scp-slider' : 'neo-range-slider';
    dimSlider.style.flex = '1'; dimSlider.value = s.windowBgDim ?? 50;
    
    const dimVal = document.createElement('span');
    dimVal.style.cssText = isSP ? 'min-width:32px;text-align:right;font-size:11px;color:var(--scp-accent)' : 'font-size:12px;min-width:34px;text-align:right;color:var(--SmartThemeQuoteColor,#a99bfb)';
    dimVal.textContent = `${dimSlider.value}%`;

    dimSlider.addEventListener('input', () => { dimVal.textContent = `${dimSlider.value}%`; });
    dimSlider.addEventListener('change', () => {
        getSettings().windowBgDim = parseInt(dimSlider.value); saveSettings();
        const allContainers = [document.getElementById('scp-bg-settings'), document.getElementById('scp-sp-bg-settings')].filter(Boolean);
        allContainers.forEach(c => { const s = c.querySelector('input[type="range"]'); if(s && s !== dimSlider) { s.value = dimSlider.value; s.nextElementSibling.textContent = `${dimSlider.value}%`; } });
        import('./ui-window.js').then(m => m.applyWindowBackground());
    });

    dimFlex.appendChild(dimSlider); dimFlex.appendChild(dimVal);
    dimRow.appendChild(dimLbl); dimRow.appendChild(dimFlex);
    extraWrap.appendChild(dimRow);

    container.appendChild(extraWrap);

    const updateVisibility = () => {
        const isNone = typeSel.value === 'none';
        renameBtn.style.display = isNone ? 'none' : '';
        deleteBtn.style.display = isNone ? 'none' : '';
        extraWrap.style.display = isNone ? 'none' : 'block';
    };
    updateVisibility();

    typeSel.addEventListener('change', () => {
        getSettings().windowBg = typeSel.value;
        saveSettings();
        updateVisibility();
        const allContainers = [document.getElementById('scp-bg-settings'), document.getElementById('scp-sp-bg-settings')].filter(Boolean);
        allContainers.forEach(c => buildBackgroundSettingsUI(c));
        import('./ui-window.js').then(m => m.applyWindowBackground());
    });
}

export function buildSoundSettingsUI(container) {
    if (!container) return;
    container.innerHTML = '';
    const s = getSettings();
    if (!s.customSounds) s.customSounds = {};

    if (s.completionSoundData && !s.customSounds['custom_legacy']) {
        s.customSounds['custom_legacy'] = {
            name: s.completionSoundFileName || 'Legacy Custom Sound',
            data: s.completionSoundData
        };
        if (s.completionSound === 'custom') {
            s.completionSound = 'custom_legacy';
        }
        delete s.completionSoundData;
        delete s.completionSoundFileName;
        saveSettings();
    }

    const isSP = container.id === 'scp-sp-sound-settings';

    const typeRow = document.createElement('div');
    typeRow.className = isSP ? 'scp-sp-field' : '';
    if (!isSP) typeRow.style.marginTop = '10px';
    
    const typeLbl = document.createElement(isSP ? 'label' : 'b');
    typeLbl.className = isSP ? 'scp-sp-label' : '';
    if (!isSP) typeLbl.style.fontSize = '12px';
    typeLbl.textContent = 'Completion Sound';
    
    const typeWrap = document.createElement('div');
    typeWrap.style.cssText = 'display:flex;gap:6px;align-items:center';
    if (!isSP) typeWrap.style.marginTop = '6px';
    
    const typeSel = document.createElement('select');
    typeSel.className = isSP ? 'scp-sp-select text_pole' : 'text_pole';
    typeSel.style.flex = '1';
    
    const renderDropdown = () => {
        typeSel.innerHTML = '';
        
        const groupPreset = document.createElement('optgroup');
        groupPreset.label = 'Presets';
        for (const [key, preset] of Object.entries(_SOUND_PRESETS)) {
            const opt = document.createElement('option');
            opt.value = key; opt.textContent = preset.label;
            groupPreset.appendChild(opt);
        }
        typeSel.appendChild(groupPreset);
        
        if (Object.keys(s.customSounds).length > 0) {
            const groupCustom = document.createElement('optgroup');
            groupCustom.label = 'Custom Sounds';
            for (const [key, snd] of Object.entries(s.customSounds)) {
                const opt = document.createElement('option');
                opt.value = key; opt.textContent = snd.name;
                groupCustom.appendChild(opt);
            }
            typeSel.appendChild(groupCustom);
        }
        
        typeSel.value = s.completionSound || 'none';
        if (!typeSel.value) {
            typeSel.value = 'none';
            s.completionSound = 'none';
            saveSettings();
        }
    };
    renderDropdown();

    const testBtn = document.createElement('button');
    testBtn.className = isSP ? 'scp-action-btn' : 'menu_button interactable';
    testBtn.innerHTML = `<i class="fa-solid fa-play"></i><span>Test</span>`;
    if (!isSP) testBtn.style.flex = '0 0 auto';
    testBtn.addEventListener('click', () => playCompletionSound());
    
    typeWrap.appendChild(typeSel);
    typeWrap.appendChild(testBtn);
    typeRow.appendChild(typeLbl);
    typeRow.appendChild(typeWrap);
    container.appendChild(typeRow);

    const customActionsWrap = document.createElement('div');
    customActionsWrap.style.cssText = isSP ? 'display:flex;gap:6px;margin-top:6px' : 'display:flex;gap:6px;margin-top:6px;align-items:center';
    
    const uploadBtn = document.createElement('button');
    uploadBtn.className = isSP ? 'scp-action-btn' : 'menu_button interactable';
    uploadBtn.innerHTML = `<i class="fa-solid fa-upload"></i><span>Upload Custom</span>`;
    if (!isSP) uploadBtn.style.flex = '1';

    uploadBtn.addEventListener('click', () => {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'audio/*';
        inp.onchange = async () => {
            const file = inp.files?.[0]; if (!file) return;
            if (file.size > 5 * 1024 * 1024) { toastr.warning('File too large (>5MB).', EXT_DISPLAY); return; }
            
            const dataUrl = await new Promise((res, rej) => {
                const r = new FileReader();
                r.onload = () => res(r.result);
                r.onerror = () => rej(null);
                r.readAsDataURL(file);
            });
            if (!dataUrl) return;
            
            const s2 = getSettings();
            const id = 'custom_' + Date.now();
            s2.customSounds[id] = { name: file.name, data: dataUrl };
            s2.completionSound = id;
            saveSettings();
            
            const otherContainers = [document.getElementById('scp-sound-settings'), document.getElementById('scp-sp-sound-settings')].filter(c => c && c !== container);
            otherContainers.forEach(c => buildSoundSettingsUI(c));
            renderDropdown();
            updateCustomActions();
        };
        inp.click();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = isSP ? 'scp-action-btn scp-sp-danger-btn' : 'menu_button interactable';
    deleteBtn.innerHTML = `<i class="fa-solid fa-trash"></i><span>Delete</span>`;
    if (!isSP) deleteBtn.style.flex = '1';

    deleteBtn.addEventListener('click', async () => {
        const val = typeSel.value;
        if (val.startsWith('custom_')) {
            const ok = await showCustomDialog({ type: 'confirm', title: 'Delete Sound', message: 'Delete this custom sound?' });
            if (!ok) return;
            const s2 = getSettings();
            delete s2.customSounds[val];
            s2.completionSound = 'none';
            saveSettings();
            renderDropdown();
            updateCustomActions();
            
            const otherContainers = [document.getElementById('scp-sound-settings'), document.getElementById('scp-sp-sound-settings')].filter(c => c && c !== container);
            otherContainers.forEach(c => buildSoundSettingsUI(c));
        }
    });
    
    customActionsWrap.appendChild(uploadBtn);
    customActionsWrap.appendChild(deleteBtn);
    container.appendChild(customActionsWrap);

    const updateCustomActions = () => {
        deleteBtn.style.display = typeSel.value.startsWith('custom_') ? '' : 'none';
    };
    updateCustomActions();

    typeSel.addEventListener('change', () => {
        getSettings().completionSound = typeSel.value;
        saveSettings();
        updateCustomActions();
        const otherContainers = [document.getElementById('scp-sound-settings'), document.getElementById('scp-sp-sound-settings')].filter(c => c && c !== container);
        otherContainers.forEach(c => buildSoundSettingsUI(c));
    });

    const volRow = document.createElement('div');
    volRow.className = isSP ? 'scp-sp-field' : '';
    volRow.style.marginTop = isSP ? '6px' : '10px';

    const volLbl = document.createElement(isSP ? 'label' : 'b');
    volLbl.className = isSP ? 'scp-sp-label' : '';
    if (!isSP) volLbl.style.fontSize = '12px';
    volLbl.textContent = 'Volume';

    const volWrap = document.createElement('div');
    volWrap.className = isSP ? 'scp-sp-row' : '';
    if (!isSP) {
        volWrap.style.display = 'flex';
        volWrap.style.alignItems = 'center';
        volWrap.style.gap = '10px';
        volWrap.style.marginTop = '6px';
    }

    const volSlider = document.createElement('input');
    volSlider.type = 'range'; 
    volSlider.className = isSP ? 'scp-slider scp-sp-vol-slider' : 'neo-range-slider scp-sp-vol-slider';
    volSlider.style.flex = '1'; volSlider.min = '0'; volSlider.max = '100';
    volSlider.value = s.completionSoundVolume ?? 80;

    const volVal = document.createElement('span');
    volVal.className = 'scp-sp-vol-val';
    volVal.style.cssText = isSP 
        ? 'min-width:32px;text-align:right;font-size:11px;color:var(--scp-accent)' 
        : 'min-width:34px;text-align:right;font-size:12px;color:var(--SmartThemeQuoteColor,#a99bfb)';
    volVal.textContent = `${volSlider.value}%`;
    
    volSlider.addEventListener('input', () => { volVal.textContent = `${volSlider.value}%`; });
    volSlider.addEventListener('change', () => { 
        getSettings().completionSoundVolume = parseInt(volSlider.value); 
        saveSettings(); 
        const otherContainers2 = [document.getElementById('scp-sound-settings'), document.getElementById('scp-sp-sound-settings')].filter(c => c && c !== container);
        otherContainers2.forEach(c => buildSoundSettingsUI(c));
    });
    
    volWrap.appendChild(volSlider); volWrap.appendChild(volVal);
    volRow.appendChild(volLbl); volRow.appendChild(volWrap);
    container.appendChild(volRow);
}

export function buildQPSettingsUI(container) {
    if (!container) return;
    container.innerHTML = '';
    const list = document.createElement('div');
    list.className = 'scp-qp-settings-list';

    const renderList = () => {
        list.innerHTML = '';
        const curPrompts = getSettings().quickPrompts || [];
        if (!curPrompts.length) {
            list.innerHTML = `<div style="font-size:11px;color:var(--scp-text-muted);text-align:center;padding:10px 0">No quick prompts yet. Add one below.</div>`;
        }
        curPrompts.forEach((qp, idx) => {
            const row = document.createElement('div');
            row.className = 'scp-qp-settings-row';

            const iconBtn = document.createElement('button');
            iconBtn.className = 'scp-qp-settings-icon-btn';
            iconBtn.textContent = qp.icon || '⚡';
            iconBtn.title = 'Change icon';
            
            import('./ui-widgets.js').then(mod => {
                iconBtn.addEventListener('click', e => {
                    e.stopPropagation();
                    mod.showQPIconPicker(iconBtn, qp.icon || '⚡', emoji => {
                        getSettings().quickPrompts[idx].icon = emoji;
                        saveSettings(); iconBtn.textContent = emoji; mod.renderQuickPromptsBar();
                    });
                });
            });

            const labelInput = document.createElement('input');
            labelInput.type = 'text'; labelInput.className = 'scp-qp-settings-label-input scp-sp-input';
            labelInput.placeholder = 'Label'; labelInput.value = qp.label || '';
            labelInput.addEventListener('input', () => {
                getSettings().quickPrompts[idx].label = labelInput.value;
                saveSettings(); import('./ui-widgets.js').then(m => m.renderQuickPromptsBar());
            });

            const moveUpBtn = document.createElement('button');
            moveUpBtn.className = 'scp-qp-settings-move'; moveUpBtn.textContent = '↑';
            moveUpBtn.title = 'Move up'; moveUpBtn.disabled = idx === 0;
            moveUpBtn.addEventListener('click', () => {
                if (idx === 0) return;
                const arr = getSettings().quickPrompts;
                [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
                saveSettings(); renderList(); import('./ui-widgets.js').then(m => m.renderQuickPromptsBar());
            });

            const moveDnBtn = document.createElement('button');
            moveDnBtn.className = 'scp-qp-settings-move'; moveDnBtn.textContent = '↓';
            moveDnBtn.title = 'Move down'; moveDnBtn.disabled = idx === curPrompts.length - 1;
            moveDnBtn.addEventListener('click', () => {
                const arr = getSettings().quickPrompts;
                if (idx >= arr.length - 1) return;
                [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
                saveSettings(); renderList(); import('./ui-widgets.js').then(m => m.renderQuickPromptsBar());
            });

            const delBtn = document.createElement('button');
            delBtn.className = 'scp-qp-settings-del'; delBtn.innerHTML = I.trash; delBtn.title = 'Delete';
            delBtn.addEventListener('click', async () => {
                const ok = await showCustomDialog({ type: 'confirm', title: 'Delete Prompt', message: `Delete "${qp.label || 'this prompt'}"?` });
                if (!ok) return;
                getSettings().quickPrompts.splice(idx, 1);
                saveSettings(); renderList(); import('./ui-widgets.js').then(m => m.renderQuickPromptsBar());
            });

            const textArea = document.createElement('textarea');
            textArea.className = 'scp-qp-settings-text scp-sp-textarea';
            textArea.placeholder = 'Prompt text… (supports {{user}}, {{char}} macros)';
            textArea.rows = 2; textArea.value = qp.text || '';
            textArea.addEventListener('input', () => { getSettings().quickPrompts[idx].text = textArea.value; saveSettings(); });

            const controls = document.createElement('div');
            controls.className = 'scp-qp-settings-controls';
            controls.appendChild(moveUpBtn); controls.appendChild(moveDnBtn); controls.appendChild(delBtn);

            const top = document.createElement('div');
            top.className = 'scp-qp-settings-row-top';
            top.appendChild(iconBtn); top.appendChild(labelInput); top.appendChild(controls);

            row.appendChild(top); row.appendChild(textArea);
            list.appendChild(row);
        });
    };

    renderList();

    const addBtn = document.createElement('button');
    addBtn.className = 'scp-action-btn'; addBtn.style.marginTop = '8px';
    addBtn.innerHTML = `${I.plus}<span>Add Prompt</span>`;
    addBtn.addEventListener('click', async () => {
        const label = await showCustomDialog({ type: 'prompt', title: 'New Quick Prompt', message: 'Label for this prompt:', placeholder: 'My Prompt' });
        if (label === null) return;
        getSettings().quickPrompts.push({ id: 'qp_'+Date.now(), label: label.trim() || 'Prompt', icon: '⚡', text: '' });
        saveSettings(); renderList(); import('./ui-widgets.js').then(m => m.renderQuickPromptsBar());
    });

    container.appendChild(list); container.appendChild(addBtn);
}