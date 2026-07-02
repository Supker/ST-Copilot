import { THEME_PRESETS, THEME_VAR_DEFS, THEME_CSS_MAP, EXT_DISPLAY, DEFAULT_SYSTEM_PROMPT, DEFAULT_CHAR_EDIT_DIRECTIVE, DEFAULT_LB_MANAGE_PROMPT, DEFAULT_CHAT_EDIT_DIRECTIVE, TOOL_DEFINITIONS, DEFAULT_TOOLS_PROMPT, DEFAULT_MEMORY_PROMPT, I } from '../constants.js';
import { state } from '../state.js';
import { getSettings, saveSettings, getEffectiveSettings, setSessionOverride, clearAllSessionOverrides, getBindingKey, hasSessionOverrides, saveSessionsToMetadata, getCurrentSession, getSessionOverrides, getChatBucket, initChatBucket } from '../session.js';
import { showCustomDialog, escHtml } from '../utils/util-dom.js';
import { applyCustomTheme, bringWindowToFront } from './ui-window.js';
import { showColorPicker } from '../utils/util-colorpicker.js';
import { _dbgAdd } from '../utils/util-debug.js';

// ─── Settings Registry ────────────────────────────────────────────────────────
//
// FIELDS:
//   key             — key in the settings object
//   stId            — element id in the ST-drawer (null if none)
//   spId            — element id in the overlay (null if none)
//   type            — 'checkbox' | 'input' | 'textarea' | 'select' | 'slider'
//   toVal           — transforms el.value before saving (optional)
//   fromSetting     — s => val, how to read from settings for display (optional)
//   stValId/spValId — ID of the display span for sliders
//   valFmt          — v => string, formatting for slider values
//   onChange        — (val) => void, side effect after saving
//   updCtx          — update token counter
//   profileKey      — include in configuration profiles

const _SETTINGS_DEF = [
    // ── General ──────────────────────────────────────────────────────────────
    { key: 'enabled', stId: 'scp-enabled', spId: 'scp-sp-enabled', type: 'checkbox',
      onChange: val => {
          const btn = document.getElementById('scp-wand-btn');
          if (btn) btn.style.display = val ? '' : 'none';
          if (!val) import('./ui-window.js').then(m => m.hideWindow());
          import('./ui-window.js').then(m => {
              m.updateIconVisibility(document.getElementById('scp-dock-icon'));
              m.setupHotkey();
          });
      }
    },
    { key: 'hotkeyEnabled',        stId: 'scp-hotkey-enabled',        spId: 'scp-sp-hotkey-enabled',        type: 'checkbox' },
    { key: 'hotkey',               stId: 'scp-hotkey',                spId: 'scp-sp-hotkey',                type: 'input',
      onChange: () => import('./ui-window.js').then(m => m.setupHotkey()) },
    { key: 'searchHotkeyEnabled',  stId: 'scp-search-hotkey-enabled', spId: 'scp-sp-search-hotkey-enabled', type: 'checkbox',
      onChange: () => import('./ui-chat.js').then(m => m.setupSearchHotkey()) },
    { key: 'searchHotkey',         stId: 'scp-search-hotkey',         spId: 'scp-sp-search-hotkey',         type: 'input',
      onChange: () => import('./ui-chat.js').then(m => m.setupSearchHotkey()) },
    { key: 'floatingIconPersistent', stId: 'scp-icon-persistent', spId: 'scp-sp-icon-persistent', type: 'checkbox',
      onChange: () => import('./ui-window.js').then(m => m.updateIconVisibility(document.getElementById('scp-dock-icon'))) },
    { key: 'wobbleWindow',   stId: 'scp-wobble-window',  spId: 'scp-sp-wobble-window', type: 'checkbox', fromSetting: s => s.wobbleWindow !== false },
    { key: 'performanceMode', stId: 'scp-perf-mode', spId: 'scp-sp-perf-mode', type: 'checkbox',
      onChange: () => import('./ui-window.js').then(m => m.applyCustomTheme(getSettings().customTheme || THEME_PRESETS.default)) },
    { key: 'ghostModeHotkeyEnabled', stId: 'scp-ghost-hotkey-enabled', spId: 'scp-sp-ghost-hotkey-enabled', type: 'checkbox',
      onChange: () => import('./ui-window.js').then(m => m.setupGhostHotkey()) },
    { key: 'ghostModeHotkey', stId: 'scp-ghost-hotkey', spId: 'scp-sp-ghost-hotkey', type: 'input',
      onChange: () => import('./ui-window.js').then(m => m.setupGhostHotkey()) },
    { key: 'changelogAutoShow',    stId: null, spId: 'scp-sp-changelog-auto', type: 'checkbox' },
    { key: 'includeSummaryception', stId: 'scp-include-summaryception', spId: 'scp-sp-include-summaryception', type: 'checkbox', fromSetting: s => s.includeSummaryception !== false },
    { key: 'useAspectEvolutia',    stId: 'scp-use-aspect-evolutia',    spId: 'scp-sp-use-aspect-evolutia',    type: 'checkbox', fromSetting: s => s.useAspectEvolutia !== false },
    { key: 'autoExpandMacros',     stId: 'scp-auto-expand-macros',     spId: 'scp-sp-auto-expand-macros',     type: 'checkbox' },
    { key: 'includeHiddenMessages', stId: 'scp-include-hidden-msgs',   spId: 'scp-sp-include-hidden-msgs',    type: 'checkbox', updCtx: true },
    { key: 'completionSoundOnlyWhenUnfocused', stId: 'scp-sound-unfocused', spId: 'scp-sp-sound-unfocused',  type: 'checkbox' },

    // ── Sliders ───────────────────────────────────────────────────────────────
    { key: 'opacity', stId: 'scp-opacity-slider', spId: 'scp-sp-opacity-slider', type: 'slider', toVal: Number,
      stValId: 'scp-opacity-val', spValId: 'scp-sp-opacity-val', valFmt: v => `${v}%`,
      onChange: val => { const w = document.getElementById('scp-window'); if (w && !state.ghostModeActive) w.style.opacity = (val / 100).toString(); } },
    { key: 'ghostModeOpacity', stId: 'scp-ghost-opacity', spId: 'scp-sp-ghost-opacity', type: 'slider', toVal: Number,
      stValId: 'scp-ghost-opacity-val', spValId: 'scp-sp-ghost-opacity-val', valFmt: v => `${v}%`,
      onChange: val => { const w = document.getElementById('scp-window'); if (w && state.ghostModeActive) w.style.opacity = (val / 100).toString(); } },

    // ── Connection ────────────────────────────────────────────────────────────
    { key: 'connectionSource',  stId: 'scp-conn-source',  spId: 'scp-sp-conn-source',  type: 'select', profileKey: true, onChange: _applyConnectionSourceVisibility },
    { key: 'connectionProfileId', stId: 'scp-conn-profile', spId: 'scp-sp-conn-profile', type: 'select', profileKey: true },
    { key: 'customUrl',   stId: 'scp-custom-url',   spId: 'scp-sp-custom-url',   type: 'input', profileKey: true },
    { key: 'customKey',   stId: 'scp-custom-key',   spId: 'scp-sp-custom-key',   type: 'input', profileKey: true },
    { key: 'customModel', stId: 'scp-custom-model', spId: 'scp-sp-custom-model', type: 'input', profileKey: true },
    { key: 'maxTokens',   stId: 'scp-max-tokens',   spId: 'scp-sp-max-tokens',   type: 'input', toVal: Number, profileKey: true },

    // ── Context ───────────────────────────────────────────────────────────────
    { key: 'contextDepth', stId: 'scp-depth-slider', spId: 'scp-sp-depth-slider', type: 'slider', toVal: Number,
      stValId: 'scp-depth-val', spValId: 'scp-sp-depth-val', updCtx: true, profileKey: true },
    { key: 'localHistoryLimit',   stId: 'scp-history-limit',    spId: 'scp-sp-history-limit',    type: 'input',    toVal: Number, updCtx: true, profileKey: true },
    { key: 'includeSystemPrompt', stId: 'scp-include-sysprompt', spId: 'scp-sp-include-sysprompt', type: 'checkbox', updCtx: true, profileKey: true },
    { key: 'includeUserPersonality', stId: 'scp-include-persona', spId: 'scp-sp-include-persona', type: 'checkbox', updCtx: true, profileKey: true },
    { key: 'includeAlternateSwipes', stId: 'scp-include-alt-swipes', spId: 'scp-sp-include-alt-swipes', type: 'checkbox', updCtx: true, profileKey: true },
    { key: 'applyRegexToContext', stId: 'scp-apply-regex', spId: 'scp-sp-apply-regex', type: 'checkbox', updCtx: true, profileKey: true },
    { key: 'reasoningTrimStrings', stId: 'scp-reasoning-trim', spId: 'scp-sp-reasoning-trim', type: 'textarea', profileKey: true },

    // ── Prompts ───────────────────────────────────────────────────────────────
    { key: 'systemPrompt', stId: 'scp-sysprompt', spId: 'scp-sp-sysprompt', type: 'textarea', updCtx: true, profileKey: true,
      fromSetting: s => s.systemPrompt || DEFAULT_SYSTEM_PROMPT },

    // ── Character Edit ────────────────────────────────────────────────────────
    { key: 'charEditAIEnabled', stId: 'scp-char-edit-enabled', spId: 'scp-sp-char-edit-enabled', type: 'checkbox', updCtx: true, profileKey: true },
    { key: 'charEditPrompt', stId: 'scp-char-edit-prompt', spId: 'scp-sp-char-edit-prompt', type: 'textarea', updCtx: true, profileKey: true,
      fromSetting: s => s.charEditPrompt || DEFAULT_CHAR_EDIT_DIRECTIVE.trim(),
      toVal: v => v.trim() === DEFAULT_CHAR_EDIT_DIRECTIVE.trim() ? '' : v },

    // ── Lorebook ──────────────────────────────────────────────────────────────
    { key: 'lorebookAIManageEnabled', stId: 'scp-lb-ai-enabled-st', spId: 'scp-sp-lb-ai-enabled', type: 'checkbox', profileKey: true },
    { key: 'lorebookAutoKeyword', stId: 'scp-lb-auto-kw-st', spId: 'scp-sp-lb-auto-kw', type: 'checkbox', profileKey: true,
      onChange: () => {
          const s = getSettings();
          import('../features/feature-lorebook-engine.js').then(async m => {
              await m.buildLorebookContextBlock(s);
              import('../features/feature-lorebook-ui.js').then(ui => {
                  ui.updateLBFooterInfo();
                  if (state.lbActiveBook) ui.renderEntryList(state.lbActiveBook, state.lbSearchQuery);
              });
          });
      }
    },
    { key: 'lorebookManagePrompt', stId: 'scp-lb-manage-prompt', spId: 'scp-sp-lb-manage-prompt', type: 'textarea', profileKey: true,
      fromSetting: s => s.lorebookManagePrompt || DEFAULT_LB_MANAGE_PROMPT },
    { key: 'lorebookSTScanDepth',     stId: 'scp-lb-st-scan-depth',      spId: 'scp-sp-lb-st-scan-depth',      type: 'input', toVal: Number, profileKey: true },
    { key: 'lorebookCopilotScanDepth', stId: 'scp-lb-copilot-scan-depth', spId: 'scp-sp-lb-copilot-scan-depth', type: 'input', toVal: Number, profileKey: true },

    // ── Chat Edit ─────────────────────────────────────────────────────────────
    { key: 'chatEditAIEnabled', stId: 'scp-chat-edit-enabled-st', spId: 'scp-sp-chat-edit-enabled', type: 'checkbox', updCtx: true, profileKey: true },
    { key: 'chatEditPrompt', stId: 'scp-chat-edit-prompt-st', spId: 'scp-sp-chat-edit-prompt', type: 'textarea', updCtx: true, profileKey: true,
      fromSetting: s => s.chatEditPrompt || DEFAULT_CHAT_EDIT_DIRECTIVE.trim(),
      toVal: v => v.trim() === DEFAULT_CHAT_EDIT_DIRECTIVE.trim() ? '' : v },

    // ── Memory ────────────────────────────────────────────────────────────────
    { key: 'memoryEnabled',      stId: 'scp-memory-enabled', spId: 'scp-sp-memory-enabled', type: 'checkbox', updCtx: true },
    { key: 'memoryInject',       stId: 'scp-memory-inject',  spId: 'scp-sp-memory-inject',  type: 'checkbox', updCtx: true },
    { key: 'memoryNotify',       stId: null,                 spId: 'scp-sp-memory-notify',  type: 'checkbox' },
    { key: 'memoryManagePrompt', stId: 'scp-memory-prompt',  spId: 'scp-sp-memory-prompt',  type: 'textarea', updCtx: true,
      fromSetting: s => s.memoryManagePrompt || DEFAULT_MEMORY_PROMPT },

    // ── Tools ─────────────────────────────────────────────────────────────────
    { key: 'toolsEnabled', stId: 'scp-tools-enabled', spId: 'scp-sp-tools-enabled', type: 'checkbox', updCtx: true },

    // ── Misc ──────────────────────────────────────────────────────────────────
    { key: 'pickerPreviewLines',     stId: 'scp-picker-lines',      spId: 'scp-sp-picker-lines',      type: 'input', toVal: v => parseInt(v) || 1 },
    { key: 'pickerPreviewLastLines', stId: 'scp-picker-last-lines', spId: 'scp-sp-picker-last-lines', type: 'input', toVal: v => parseInt(v) || 0 },
    { key: 'imageAnalysisMode',      stId: 'scp-image-mode',        spId: 'scp-sp-image-mode',        type: 'select' },
];

// charEditFields
const _CE_FIELDS_DEF = [
    { fk: 'tags',                      stId: 'scp-ce-tags',           spId: 'scp-sp-ce-tags',           ovId: 'scp-sp-ov-ce-tags' },
    { fk: 'description',               stId: 'scp-ce-description',    spId: 'scp-sp-ce-description',    ovId: 'scp-sp-ov-ce-description' },
    { fk: 'personality',               stId: 'scp-ce-personality',    spId: 'scp-sp-ce-personality',    ovId: 'scp-sp-ov-ce-personality' },
    { fk: 'scenario',                  stId: 'scp-ce-scenario',       spId: 'scp-sp-ce-scenario',       ovId: 'scp-sp-ov-ce-scenario' },
    { fk: 'first_mes',                 stId: 'scp-ce-first-mes',      spId: 'scp-sp-ce-first-mes',      ovId: 'scp-sp-ov-ce-first-mes' },
    { fk: 'mes_example',               stId: 'scp-ce-mes-example',    spId: 'scp-sp-ce-mes-example',    ovId: 'scp-sp-ov-ce-mes-example' },
    { fk: 'authors_note',              stId: 'scp-ce-authors-note',   spId: 'scp-sp-ce-authors-note',   ovId: 'scp-sp-ov-ce-authors-note' },
    { fk: 'system_prompt',             stId: 'scp-ce-system-prompt',  spId: 'scp-sp-ce-system-prompt',  ovId: 'scp-sp-ov-ce-system-prompt' },
    { fk: 'post_history_instructions', stId: 'scp-ce-post-history',   spId: 'scp-sp-ce-post-history',   ovId: 'scp-sp-ov-ce-post-history' },
    { fk: 'alternate_greetings',       stId: 'scp-ce-alt-greetings',  spId: 'scp-sp-ce-alt-greetings',  ovId: 'scp-sp-ov-ce-alt-greetings', altGreetingPicker: true },
];

// Mapping override keys to elements (for the override reset button)
const _OV_EL_MAP = {
    contextDepth: ['scp-sp-ov-depth-slider', 'scp-sp-ov-depth-val'],
    maxTokens: ['scp-sp-ov-max-tokens'],           localHistoryLimit: ['scp-sp-ov-history-limit'],
    reasoningTrimStrings: ['scp-sp-ov-reasoning-trim'], systemPrompt: ['scp-sp-ov-sysprompt'],
    connectionSource: ['scp-sp-ov-conn-source'],   customUrl: ['scp-sp-ov-custom-url'],
    customKey: ['scp-sp-ov-custom-key'],           customModel: ['scp-sp-ov-custom-model'],
    connectionProfileId: ['scp-sp-ov-conn-profile'],
    includeSystemPrompt: ['scp-sp-ov-include-sysprompt'], includeUserPersonality: ['scp-sp-ov-include-persona'],
    includeAlternateSwipes: ['scp-sp-ov-include-alt-swipes'], applyRegexToContext: ['scp-sp-ov-apply-regex'],
    charEditAIEnabled: ['scp-sp-ov-char-edit-enabled'], charEditPrompt: ['scp-sp-ov-char-edit-prompt'],
    lorebookAIManageEnabled: ['scp-sp-ov-lb-ai-enabled'], lorebookManagePrompt: ['scp-sp-ov-lb-manage-prompt'],
    lorebookAutoKeyword: ['scp-sp-ov-lb-auto-kw'], chatEditAIEnabled: ['scp-sp-ov-chat-edit-enabled'],
    chatEditPrompt: ['scp-sp-ov-chat-edit-prompt'],
    charField_tags: ['scp-sp-ov-ce-tags'],                 charField_description: ['scp-sp-ov-ce-description'],
    charField_personality: ['scp-sp-ov-ce-personality'],   charField_scenario: ['scp-sp-ov-ce-scenario'],
    charField_first_mes: ['scp-sp-ov-ce-first-mes'],       charField_mes_example: ['scp-sp-ov-ce-mes-example'],
    charField_authors_note: ['scp-sp-ov-ce-authors-note'], charField_system_prompt: ['scp-sp-ov-ce-system-prompt'],
    charField_post_history_instructions: ['scp-sp-ov-ce-post-history'],
    charField_alternate_greetings: ['scp-sp-ov-ce-alt-greetings'],
    forceStreaming: [],
};

// Profile keys
const _PROFILE_KEYS = [
    ..._SETTINGS_DEF.filter(d => d.profileKey).map(d => d.key),
    'includeAuthorsNote', 'includeCharacterCard'
];

// ─── Configuration Profiles ───────────────────────────────────────────────────

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
    for (const k of _PROFILE_KEYS) { if (JSON.stringify(s[k]) !== _profileSnapshot[k]) return true; }
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
    const dot = '<span class="scp-save-dirty-dot"></span>';
    ['scp-profile-save', 'scp-sp-profile-save'].forEach(id => {
        const btn = document.getElementById(id); if (!btn) return;
        btn.querySelectorAll('.scp-save-dirty-dot').forEach(d => d.remove());
        if (state.configDirty) btn.insertAdjacentHTML('beforeend', dot);
    });
    document.querySelectorAll('#scp-theme-save').forEach(btn => {
        btn.querySelectorAll('.scp-save-dirty-dot').forEach(d => d.remove());
        if (state.themeDirty) btn.insertAdjacentHTML('beforeend', dot);
    });
}

export function saveProfile(name) {
    const s = getSettings(); const p = {};
    for (const k of _PROFILE_KEYS) p[k] = s[k];
    p.charEditFields = JSON.parse(JSON.stringify(s.charEditFields || {}));
    s.profiles[name] = p; s.activeProfile = name; saveSettings();
}

export function loadProfile(name) {
    const s = getSettings(); const p = s.profiles[name]; if (!p) return;
    for (const k of _PROFILE_KEYS) { if (p[k] !== undefined) s[k] = p[k]; }
    if (p.charEditFields) s.charEditFields = JSON.parse(JSON.stringify(p.charEditFields));
    s.activeProfile = name; saveSettings();
    if (typeof updateSettingsUI === 'function') updateSettingsUI();
    _takeProfileSnapshot(); state.configDirty = false; _updateDirtyDots();
    _pruneMatchingOverrides();
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
    if (!Object.keys(s.profiles).length) {
        s.profiles['Default'] = { systemPrompt: DEFAULT_SYSTEM_PROMPT, includeSystemPrompt: true, includeAuthorsNote: true, includeCharacterCard: true, includeUserPersonality: true, contextDepth: 15, localHistoryLimit: 50, connectionSource: 'default', connectionProfileId: '', maxTokens: 8200, applyRegexToContext: true };
        s.activeProfile = 'Default'; saveSettings();
    }
    sel.innerHTML = ''; let hasActive = false;
    for (const name of Object.keys(s.profiles)) {
        const opt = document.createElement('option'); opt.value = name; opt.textContent = name;
        if (name === s.activeProfile) { opt.selected = true; hasActive = true; }
        sel.appendChild(opt);
    }
    if (!hasActive && Object.keys(s.profiles).length > 0) { loadProfile(Object.keys(s.profiles)[0]); sel.value = Object.keys(s.profiles)[0]; }
    updateBindingSection();
}

export function updateBindingSection() {
    const sel = document.getElementById('scp-profile-select');
    const section = document.getElementById('scp-binding-section');
    if (!section) return;
    section.style.display = sel?.value ? '' : 'none'; if (!sel?.value) return;
    const s = getSettings(); const { charId, chatId } = getBindingKey();
    document.getElementById('scp-bind-char')?.classList.toggle('active', s.profileBindings[`char_${charId}`] === sel.value);
    document.getElementById('scp-bind-chat')?.classList.toggle('active', s.profileBindings[`chat_${charId}_${chatId}`] === sel.value);
}

export function autoLoadBoundProfile() {
    const s = getSettings(); const { charId, chatId } = getBindingKey();
    const name = s.profileBindings[`chat_${charId}_${chatId}`] || s.profileBindings[`char_${charId}`];
    if (name && s.profiles[name]) { loadProfile(name); const sel = document.getElementById('scp-profile-select'); if (sel) sel.value = name; }
    else if (name && !s.profiles[name]) _dbgAdd('PROFILE_LOAD_BINDING_MISSING', { name });
}

export async function updateProfilesList() {
    const profSel = document.getElementById('scp-conn-profile'); if (!profSel) return;
    const ctx = SillyTavern.getContext(); const s = getSettings(); let currentVal = s.connectionProfileId || '';
    const service = ctx.ConnectionManagerRequestService;
    let profiles = service?.getSupportedProfiles?.() ?? ctx.extensionSettings?.connectionManager?.profiles ?? [];
    if (currentVal && !profiles.some(p => p.id === currentVal)) {
        _dbgAdd('PROFILE_GHOST_CLEANUP', { removedId: currentVal });
        s.connectionProfileId = ''; saveSettings(); currentVal = '';
    }
    if (service?.handleDropdown) { service.handleDropdown(profSel); if (currentVal && Array.from(profSel.options).some(o => o.value === currentVal)) profSel.value = currentVal; return; }
    profSel.innerHTML = '<option value="">-- Select Profile --</option>';
    profiles.forEach(p => { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; profSel.appendChild(o); });
    if (Array.from(profSel.options).some(o => o.value === currentVal)) profSel.value = currentVal;
}

export async function updateSPConnProfileList() {
    const selIds = ['scp-sp-conn-profile', 'scp-sp-ov-conn-profile'];
    const s = getSettings(); const eff = getEffectiveSettings();
    const ctx = SillyTavern.getContext(); const service = ctx.ConnectionManagerRequestService;
    let profiles = service?.getSupportedProfiles?.() ?? ctx.extensionSettings?.connectionManager?.profiles ?? [];
    selIds.forEach(sid => {
        const sel = document.getElementById(sid); if (!sel) return;
        const isOv = sid === 'scp-sp-ov-conn-profile';
        let targetVal = isOv ? (eff.connectionProfileId || '') : (s.connectionProfileId || '');
        if (targetVal && !profiles.some(p => p.id === targetVal)) {
            if (isOv) setSessionOverride('connectionProfileId', undefined); else { s.connectionProfileId = ''; saveSettings(); }
            targetVal = '';
        }
        sel.innerHTML = '<option value="">-- Select Profile --</option>';
        profiles.forEach(p => { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; sel.appendChild(o); });
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
    section.style.display = sel?.value ? '' : 'none'; if (!sel?.value) return;
    const s = getSettings(); const { charId, chatId } = getBindingKey();
    document.getElementById('scp-sp-bind-char')?.classList.toggle('active', s.profileBindings[`char_${charId}`] === sel.value);
    document.getElementById('scp-sp-bind-chat')?.classList.toggle('active', s.profileBindings[`chat_${charId}_${chatId}`] === sel.value);
}

// ─── Theme Editor ─────────────────────────────────────────────────────────────

const _COLOR_KEYS = new Set(['bg','text','textMuted','accent','accentDim','accentBg','headerBg','toolbarBg','msgUserBg','msgAiBg','inputBg','codeBg','danger','success']);

export function isThemeDirty() {
    const s = getSettings(); const current = s.customTheme || {};
    if (s.activeThemeProfile && s.savedThemes[s.activeThemeProfile]) {
        const saved = s.savedThemes[s.activeThemeProfile];
        return THEME_VAR_DEFS.some(def => (current[def.key] || '') !== (saved[def.key] || ''));
    }
    for (const preset of Object.values(THEME_PRESETS)) {
        if (THEME_VAR_DEFS.every(def => (current[def.key] || '') === (preset[def.key] || ''))) return false;
    }
    return true;
}

export function buildThemeEditor(containerOverride) {
    const container = containerOverride || document.getElementById('scp-theme-section'); if (!container) return;
    container.innerHTML = '';
    const s = getSettings();
    if (!s.savedThemes || !Object.keys(s.savedThemes).length) {
        s.savedThemes = { 'Default': { ...THEME_PRESETS.default } }; s.activeThemeProfile = 'Default';
        s.customTheme = { ...s.savedThemes['Default'] }; saveSettings();
    }
    const profileRow = document.createElement('div'); profileRow.className = 'scp-profile-bar'; profileRow.style.marginBottom = '12px';
    profileRow.innerHTML = `
        <select id="scp-theme-profile-select"></select>
        <button class="scp-profile-icon-btn" id="scp-theme-save" title="Save current theme"><i class="fa-solid fa-floppy-disk"></i></button>
        <button class="scp-profile-icon-btn" id="scp-theme-create" title="Create new theme"><i class="fa-solid fa-plus"></i></button>
        <button class="scp-profile-icon-btn" id="scp-theme-duplicate" title="Duplicate theme"><i class="fa-solid fa-copy"></i></button>
        <button class="scp-profile-icon-btn" id="scp-theme-rename" title="Rename theme"><i class="fa-solid fa-pen"></i></button>
        <button class="scp-profile-icon-btn danger" id="scp-theme-delete" title="Delete theme"><i class="fa-solid fa-trash"></i></button>
        <button class="scp-profile-icon-btn" id="scp-theme-export" title="Export theme"><i class="fa-solid fa-file-export"></i></button>
        <button class="scp-profile-icon-btn" id="scp-theme-import" title="Import theme"><i class="fa-solid fa-file-import"></i></button>`;
    container.appendChild(profileRow);
    const sel = profileRow.querySelector('#scp-theme-profile-select');
    const optGrpDefault = document.createElement('optgroup'); optGrpDefault.label = 'Default Presets';
    for (const [key, preset] of Object.entries(THEME_PRESETS)) {
        const opt = document.createElement('option'); opt.value = `__preset__${key}`; opt.textContent = preset.label; optGrpDefault.appendChild(opt);
    }
    sel.appendChild(optGrpDefault);
    const userKeys = Object.keys(s.savedThemes);
    if (userKeys.length) {
        const optGrpCustom = document.createElement('optgroup'); optGrpCustom.label = 'Custom Themes';
        for (const name of userKeys) {
            const opt = document.createElement('option'); opt.value = name; opt.textContent = name;
            if (name === s.activeThemeProfile) opt.selected = true;
            optGrpCustom.appendChild(opt);
        }
        sel.appendChild(optGrpCustom);
    }
    if (!s.activeThemeProfile || !s.savedThemes[s.activeThemeProfile]) {
        const matchKey = Object.keys(THEME_PRESETS).find(k => THEME_VAR_DEFS.every(d => (s.customTheme?.[d.key] || '') === (THEME_PRESETS[k][d.key] || '')));
        if (matchKey) sel.value = `__preset__${matchKey}`;
    }
    sel.addEventListener('change', async () => {
        const name = sel.value;
        if (isThemeDirty()) {
            const ok = await showCustomDialog({ type: 'confirm', title: 'Unsaved Changes', message: 'You have unsaved changes. Switch anyway?' });
            if (!ok) { sel.value = s.activeThemeProfile ? s.activeThemeProfile : sel.value; return; }
        }
        const s2 = getSettings();
        if (name.startsWith('__preset__')) {
            s2.customTheme = { ...THEME_PRESETS[name.replace('__preset__', '')] }; s2.activeThemeProfile = '';
        } else if (s2.savedThemes[name]) {
            s2.customTheme = { ...s2.savedThemes[name] }; s2.activeThemeProfile = name;
        }
        saveSettings(); applyCustomTheme(s2.customTheme); buildThemeEditor(containerOverride);
    });
    profileRow.querySelector('#scp-theme-save').addEventListener('click', async () => {
        const val = sel.value;
        if (val.startsWith('__preset__')) {
            const name = await showCustomDialog({ type: 'prompt', title: 'Save as Custom Theme', message: 'Name for your custom theme:', placeholder: 'My Theme' });
            if (!name?.trim()) return;
            const s2 = getSettings(); s2.savedThemes[name.trim()] = { ...s2.customTheme }; s2.activeThemeProfile = name.trim(); saveSettings(); buildThemeEditor(containerOverride); toastr.success(`Theme "${name.trim()}" saved`, EXT_DISPLAY); _clearDirty('theme');
        } else if (val) {
            const s2 = getSettings(); s2.savedThemes[val] = { ...s2.customTheme }; saveSettings(); toastr.success(`Theme "${val}" updated`, EXT_DISPLAY); _clearDirty('theme');
        }
    });
    profileRow.querySelector('#scp-theme-create').addEventListener('click', async () => {
        const name = await showCustomDialog({ type: 'prompt', title: 'New Theme', message: 'Enter name for new theme:', placeholder: 'My New Theme' });
        if (!name?.trim()) return;
        const s2 = getSettings(); s2.savedThemes[name.trim()] = { ...s2.customTheme }; s2.activeThemeProfile = name.trim(); saveSettings(); buildThemeEditor(containerOverride); toastr.success(`Created theme "${name.trim()}"`, EXT_DISPLAY);
    });
    profileRow.querySelector('#scp-theme-duplicate').addEventListener('click', async () => {
        const val = sel.value; if (!val) return;
        const baseTheme = val.startsWith('__preset__') ? THEME_PRESETS[val.replace('__preset__', '')] : s.savedThemes[val]; if (!baseTheme) return;
        const defaultName = (val.startsWith('__preset__') ? THEME_PRESETS[val.replace('__preset__', '')].label : val) + ' (Copy)';
        const name = await showCustomDialog({ type: 'prompt', title: 'Duplicate Theme', message: 'Name for the duplicated theme:', defaultValue: defaultName });
        if (!name?.trim()) return;
        const s2 = getSettings(); s2.savedThemes[name.trim()] = JSON.parse(JSON.stringify(baseTheme)); s2.activeThemeProfile = name.trim(); s2.customTheme = { ...s2.savedThemes[name.trim()] };
        saveSettings(); applyCustomTheme(s2.customTheme); buildThemeEditor(containerOverride); toastr.success(`Theme duplicated as "${name.trim()}"`, EXT_DISPLAY);
    });
    profileRow.querySelector('#scp-theme-rename').addEventListener('click', async () => {
        const val = sel.value; if (!val || val.startsWith('__preset__')) { toastr.info('Select a custom theme to rename.', EXT_DISPLAY); return; }
        const newName = await showCustomDialog({ type: 'prompt', title: 'Rename Theme', message: 'Enter new name:', defaultValue: val });
        if (!newName?.trim() || newName.trim() === val) return;
        const s2 = getSettings(); s2.savedThemes[newName.trim()] = s2.savedThemes[val]; delete s2.savedThemes[val]; s2.activeThemeProfile = newName.trim(); saveSettings(); buildThemeEditor(containerOverride); toastr.success('Theme renamed.', EXT_DISPLAY);
    });
    profileRow.querySelector('#scp-theme-delete').addEventListener('click', async () => {
        const val = sel.value; if (!val || val.startsWith('__preset__')) { toastr.info('Select a custom theme to delete.', EXT_DISPLAY); return; }
        const ok = await showCustomDialog({ type: 'confirm', title: 'Delete Theme', message: `Delete "${val}"?` }); if (!ok) return;
        const s2 = getSettings(); delete s2.savedThemes[val]; s2.activeThemeProfile = Object.keys(s2.savedThemes)[0] || '';
        s2.customTheme = s2.activeThemeProfile ? { ...s2.savedThemes[s2.activeThemeProfile] } : { ...THEME_PRESETS.default };
        saveSettings(); applyCustomTheme(s2.customTheme); buildThemeEditor(containerOverride); toastr.success('Deleted.', EXT_DISPLAY);
    });
    profileRow.querySelector('#scp-theme-export').addEventListener('click', () => {
        const s2 = getSettings(); const val = sel.value;
        const rawName = val.startsWith('__preset__') ? val.replace('__preset__', '') : (val || 'custom');
        const blob = new Blob([JSON.stringify({ name: rawName, version: 1, theme: s2.customTheme }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `st-copilot-theme-${rawName.replace(/[^a-z0-9]/gi, '_')}.json`; a.click(); URL.revokeObjectURL(a.href);
    });
    profileRow.querySelector('#scp-theme-import').addEventListener('click', () => {
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json';
        inp.onchange = async () => {
            const file = inp.files?.[0]; if (!file) return;
            try {
                const data = JSON.parse(await file.text()); const imported = data.theme || data;
                if (typeof imported !== 'object' || Array.isArray(imported)) throw new Error('Invalid format');
                const themeName = (data.name && typeof data.name === 'string') ? data.name : file.name.replace(/\.json$/i, '');
                const s2 = getSettings(); s2.savedThemes[themeName] = { ...THEME_PRESETS.default, ...imported }; s2.activeThemeProfile = themeName; s2.customTheme = { ...s2.savedThemes[themeName] };
                saveSettings(); applyCustomTheme(s2.customTheme); buildThemeEditor(containerOverride); toastr.success(`Theme "${escHtml(themeName)}" imported.`, EXT_DISPLAY);
            } catch (e) { toastr.error('Invalid theme file.', EXT_DISPLAY); }
        };
        inp.click();
    });
    const grid = document.createElement('div'); grid.className = 'scp-theme-var-grid';
    const windowEl = document.getElementById('scp-window');
    for (const def of THEME_VAR_DEFS) {
        const item = document.createElement('div'); item.className = 'scp-theme-var-item';
        const label = document.createElement('div'); label.className = 'scp-theme-var-label'; label.textContent = def.label;
        const wrap = document.createElement('div'); wrap.className = 'scp-theme-var-wrap';
        const isColorKey = _COLOR_KEYS.has(def.key); const isFontKey = def.key === 'font' || def.key === 'fontSize';
        const preview = document.createElement('div'); preview.className = 'scp-theme-var-preview';
        let curVal = s.customTheme?.[def.key] ?? '';
        if (def.key === 'fontSize' && /^\d+$/.test(curVal)) curVal += 'px';
        if (isColorKey) { preview.style.background = curVal; preview.style.display = curVal ? '' : 'none'; preview.classList.add('scp-color-clickable'); }
        else { preview.style.display = 'none'; }
        const input = document.createElement('input'); input.type = 'text'; input.className = 'scp-theme-var-input'; input.value = curVal; input.placeholder = def.hint; input.dataset.key = def.key;
        const cssVar = THEME_CSS_MAP[def.key];
        const getDefaultVal = () => {
            const ss = getSettings();
            if (ss.activeThemeProfile && ss.savedThemes?.[ss.activeThemeProfile]) return ss.savedThemes[ss.activeThemeProfile][def.key] ?? '';
            const selEl = container.querySelector('#scp-theme-profile-select'); const selVal = selEl?.value || '';
            if (selVal.startsWith('__preset__')) return (THEME_PRESETS[selVal.replace('__preset__', '')] || THEME_PRESETS.default)[def.key] ?? '';
            return THEME_PRESETS.default[def.key] ?? '';
        };
        const resetBtn = document.createElement('button'); resetBtn.className = 'scp-theme-var-reset'; resetBtn.title = 'Reset to profile default'; resetBtn.textContent = '↺';
        const updateResetState = val => { resetBtn.disabled = !val || val === getDefaultVal(); };
        updateResetState(curVal);
        let _fontDebounce = null;
        const applyVal = val => {
            const s2 = getSettings(); if (!s2.customTheme) s2.customTheme = {};
            s2.customTheme[def.key] = val; saveSettings(); _markDirty('theme');
            document.querySelectorAll(`input.scp-theme-var-input[data-key="${def.key}"]`).forEach(inp => { if (inp.value !== val) inp.value = val; });
            if (isColorKey) {
                if (cssVar) [windowEl, document.getElementById('scp-lb-overlay'), document.getElementById('scp-diff-modal')].filter(Boolean).forEach(t => t.style.setProperty(cssVar, val));
                preview.style.background = val; preview.style.display = val ? '' : 'none';
            } else if (isFontKey) {
                clearTimeout(_fontDebounce);
                _fontDebounce = setTimeout(() => {
                    let fVal = val.trim(); if (def.key === 'fontSize' && /^\d+$/.test(fVal)) fVal += 'px';
                    const targets = [windowEl, document.getElementById('scp-lb-overlay'), document.getElementById('scp-diff-modal'), document.getElementById('scp-settings-overlay'), document.getElementById('scp-picker-overlay')].filter(Boolean);
                    targets.forEach(t => { if (fVal) { t.style.setProperty(cssVar, fVal); if (def.key === 'fontSize') t.style.fontSize = fVal; } else { t.style.removeProperty(cssVar); if (def.key === 'fontSize') t.style.fontSize = ''; } });
                }, 600);
            } else {
                if (cssVar) [windowEl, document.getElementById('scp-lb-overlay'), document.getElementById('scp-diff-modal')].filter(Boolean).forEach(t => t.style.setProperty(cssVar, val));
            }
            updateResetState(val);
        };
        input.addEventListener('input', () => applyVal(input.value));
        resetBtn.addEventListener('click', () => applyVal(getDefaultVal() || ''));
        if (isColorKey) preview.addEventListener('click', () => showColorPicker(preview, input.value || '#7c6dfa', val => applyVal(val)));
        wrap.appendChild(preview); wrap.appendChild(input); wrap.appendChild(resetBtn);
        item.appendChild(label); item.appendChild(wrap); grid.appendChild(item);
    }
    container.appendChild(grid);
}

// ─── Settings Engine ──────────────────────────────────────────────────────────

function _applyConnectionSourceVisibility(val) {
    [['scp-profile-group', 'scp-custom-profile-group'],
     ['scp-sp-global-profile-group', 'scp-sp-custom-profile-group']].forEach(([pId, cId]) => {
        const pEl = document.getElementById(pId); const cEl = document.getElementById(cId);
        if (pEl) pEl.style.display = val === 'profile' ? '' : 'none';
        if (cEl) cEl.style.display = val === 'custom' ? '' : 'none';
    });
    if (val === 'profile') updateSPConnProfileList();
}

function _pruneMatchingOverrides() {
    const s = getSettings(); const bucket = getChatBucket(); let changed = false;
    
    if (bucket && bucket.sessions) {
        bucket.sessions.forEach(sess => {
            if (!sess.overrides) return;
            for (const key of Object.keys(sess.overrides)) {
                const globalVal = key.startsWith('charField_') ? (s.charEditFields || {})[key.replace('charField_', '')] !== false : s[key];
                const isEqual = typeof globalVal === 'boolean' ? sess.overrides[key] === globalVal : String(sess.overrides[key]) === String(globalVal);
                if (isEqual) { delete sess.overrides[key]; changed = true; }
            }
        });
        if (changed) { saveSessionsToMetadata(); updateSessionOverrideIndicator(); }
    }

    let charChanged = false;
    if (s.charMgrFieldOverrides) {
        for (const charId of Object.keys(s.charMgrFieldOverrides)) {
            const ovs = s.charMgrFieldOverrides[charId];
            for (const key of Object.keys(ovs)) {
                const globalVal = (s.charEditFields || {})[key] !== false;
                if (ovs[key] === globalVal) {
                    delete ovs[key];
                    charChanged = true;
                }
            }
            if (Object.keys(ovs).length === 0) {
                delete s.charMgrFieldOverrides[charId];
            }
        }
    }
    if (charChanged) saveSettings();
    
    document.querySelectorAll('.scp-char-ov-row').forEach(row => {
        if (typeof row._refreshOverride === 'function') row._refreshOverride();
    });
}

function _readFromSettings(def) {
    const s = getSettings();
    return def.fromSetting ? def.fromSetting(s) : s[def.key];
}

function _writeToEl(el, def, val) {
    if (!el) return;
    if (def.type === 'checkbox') el.checked = !!val;
    else el.value = val ?? '';
}

function _bindSetting(def) {
    const stEl = def.stId ? document.getElementById(def.stId) : null;
    const spEl = def.spId ? document.getElementById(def.spId) : null;
    if (!stEl && !spEl) return;

    const apply = raw => {
        const val = def.toVal ? def.toVal(raw) : raw;
        getSettings()[def.key] = val; saveSettings();
        _markDirty('config'); _pruneMatchingOverrides();
        if (def.onChange) def.onChange(val, getSettings());
        if (def.updCtx) import('./ui-chat.js').then(m => m.updateMsgCount(getCurrentSession()));
    };

    if (def.type === 'slider') {
        const setDisplayVal = (valId, v) => { const el = document.getElementById(valId); if (el) el.textContent = def.valFmt ? def.valFmt(v) : String(v); };
        stEl?.addEventListener('input', () => setDisplayVal(def.stValId, stEl.value));
        spEl?.addEventListener('input', () => setDisplayVal(def.spValId, spEl.value));
        stEl?.addEventListener('change', () => {
            const v = def.toVal ? def.toVal(stEl.value) : stEl.value;
            _writeToEl(spEl, def, v); setDisplayVal(def.stValId, v); setDisplayVal(def.spValId, v); apply(stEl.value);
        });
        spEl?.addEventListener('change', () => {
            const v = def.toVal ? def.toVal(spEl.value) : spEl.value;
            _writeToEl(stEl, def, v); setDisplayVal(def.stValId, v); setDisplayVal(def.spValId, v); apply(spEl.value);
        });
    } else {
        const ev = (def.type === 'input' || def.type === 'textarea') ? 'input' : 'change';
        stEl?.addEventListener(ev, () => { const raw = def.type === 'checkbox' ? stEl.checked : stEl.value; _writeToEl(spEl, def, raw); apply(raw); });
        spEl?.addEventListener(ev, () => { const raw = def.type === 'checkbox' ? spEl.checked : spEl.value; _writeToEl(stEl, def, raw); apply(raw); });
    }
}

function _bindCeField(ceDef) {
    const stEl = document.getElementById(ceDef.stId);
    const spEl = document.getElementById(ceDef.spId);
    const apply = val => {
        const s = getSettings(); if (!s.charEditFields) s.charEditFields = {};
        s.charEditFields[ceDef.fk] = val; saveSettings(); _markDirty('config'); _pruneMatchingOverrides();
        import('./ui-chat.js').then(m => m.updateMsgCount(getCurrentSession()));
        if (ceDef.altGreetingPicker) {
            ['scp-ce-alt-greetings-picker', 'scp-sp-ce-alt-greetings-picker'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = val ? '' : 'none'; });
            import('../features/feature-character-ui.js').then(m => m.refreshAltGreetingsPickers());
        }
    };
    stEl?.addEventListener('change', () => { if (spEl) spEl.checked = stEl.checked; apply(stEl.checked); });
    spEl?.addEventListener('change', () => { if (stEl) stEl.checked = spEl.checked; apply(spEl.checked); });
}

function _bindAllSettings() {
    _SETTINGS_DEF.forEach(_bindSetting);
    _CE_FIELDS_DEF.forEach(_bindCeField);
}

function _syncOvToGlobal(key, newVal) {
    const s = getSettings();
    const globalVal = key.startsWith('charField_') ? (s.charEditFields || {})[key.replace('charField_', '')] !== false : s[key];
    const isDefault = (newVal === undefined || newVal === null) ? true
        : (typeof globalVal === 'boolean' ? newVal === globalVal : String(newVal) === String(globalVal));
    setSessionOverride(key, isDefault ? undefined : newVal);
    updateSPOverrideIndicators();
    import('./ui-chat.js').then(m => m.updateMsgCount(getCurrentSession()));
}

function _resetOvElToEffective(key) {
    const eff = getEffectiveSettings();
    (_OV_EL_MAP[key] || []).forEach(id => {
        const el = document.getElementById(id); if (!el) return;
        if (id.endsWith('-depth-val') || (id.endsWith('-val') && !id.endsWith('slider'))) {
            el.textContent = eff.contextDepth ?? 15; return;
        }
        if (el.type === 'checkbox') {
            el.checked = key.startsWith('charField_') ? (getSettings().charEditFields || {})[key.replace('charField_', '')] !== false : !!eff[key];
        } else if (el.type === 'range') {
            el.value = eff[key] ?? 15;
        } else {
            el.value = eff[key] ?? '';
        }
    });
    if (key === 'connectionSource') {
        const val = eff.connectionSource ?? 'default';
        const pg = document.getElementById('scp-sp-ov-profile-group'); const cg = document.getElementById('scp-sp-ov-custom-profile-group');
        if (pg) pg.style.display = val === 'profile' ? '' : 'none';
        if (cg) cg.style.display = val === 'custom' ? '' : 'none';
    }
    if (key === 'forceStreaming') {
        const val = eff.forceStreaming === true ? 'on' : (eff.forceStreaming === false ? 'auto' : (eff.forceStreaming || 'auto'));
        document.querySelectorAll('.scp-ov-stream-btn').forEach(b => {
            const active = b.dataset.stream === val; b.classList.toggle('active', active);
            b.style.color = active ? 'var(--scp-accent)' : ''; b.style.borderColor = active ? 'var(--scp-accent-dim)' : ''; b.style.background = active ? 'var(--scp-accent-bg)' : '';
        });
    }
}

// ─── UI Sync ──────────────────────────────────────────────────────────────────

export function syncOverlayUI(key, val) {
    const def = _SETTINGS_DEF.find(d => d.key === key);
    if (def?.spId) {
        _writeToEl(document.getElementById(def.spId), def, val);
        if (def.type === 'slider' && def.spValId) { const el = document.getElementById(def.spValId); if (el) el.textContent = def.valFmt ? def.valFmt(val) : String(val ?? ''); }
    }
    if (key === 'forceStreaming') {
        const sv = val === true ? 'on' : (val === false ? 'auto' : (val || 'auto'));
        document.querySelectorAll('.scp-stream-btn:not(.scp-ov-stream-btn)').forEach(b => b.classList.toggle('active', b.dataset.stream === sv));
        if (!('forceStreaming' in getSessionOverrides())) document.querySelectorAll('.scp-ov-stream-btn').forEach(b => b.classList.toggle('active', b.dataset.stream === sv));
        return;
    }
    if (key === 'connectionSource') { _applyConnectionSourceVisibility(val); return; }
    if (key === 'contextDepth') { const dv = document.getElementById('scp-sp-depth-val'); if (dv) dv.textContent = val ?? 15; }
    if (key in getSessionOverrides()) return;
    if (key.startsWith('charField_')) {
        const ceDef = _CE_FIELDS_DEF.find(d => d.fk === key.replace('charField_', ''));
        if (ceDef) { const el = document.getElementById(ceDef.ovId); if (el) el.checked = !!val; }
        return;
    }
    if (_OV_EL_MAP[key]) _resetOvElToEffective(key);
}

export function updateSettingsUI() {
    const s = getSettings();
    for (const def of _SETTINGS_DEF) {
        const val = _readFromSettings(def);
        if (def.stId) _writeToEl(document.getElementById(def.stId), def, val);
        if (def.spId) _writeToEl(document.getElementById(def.spId), def, val);
        if (def.type === 'slider') {
            const fmt = def.valFmt ? def.valFmt(val) : String(val ?? '');
            [def.stValId, def.spValId].forEach(id => { if (!id) return; const el = document.getElementById(id); if (el) el.textContent = fmt; });
        }
    }
    for (const ceDef of _CE_FIELDS_DEF) {
        const val = (s.charEditFields || {})[ceDef.fk] !== false;
        if (ceDef.stId) { const el = document.getElementById(ceDef.stId); if (el) el.checked = val; }
        if (ceDef.spId) { const el = document.getElementById(ceDef.spId); if (el) el.checked = val; }
    }
    const fsVal = s.forceStreaming === true ? 'on' : (s.forceStreaming === false ? 'auto' : (s.forceStreaming || 'auto'));
    document.querySelectorAll('#scp-st-stream-auto, #scp-st-stream-on, #scp-st-stream-off').forEach(b => {
        const active = b.dataset.stream === fsVal; b.classList.toggle('active', active);
        b.style.color = active ? 'var(--SmartThemeQuoteColor,#a99bfb)' : ''; b.style.borderColor = active ? 'rgba(124,109,250,0.5)' : ''; b.style.background = active ? 'rgba(124,109,250,0.12)' : '';
    });
    _applyConnectionSourceVisibility(s.connectionSource ?? 'default');
    const agPicker = document.getElementById('scp-ce-alt-greetings-picker');
    if (agPicker) agPicker.style.display = s.charEditFields?.alternate_greetings ? '' : 'none';
    refreshProfilesDropdown(); buildThemeEditor();
    import('./ui-window.js').then(m => m._setupBgUpload('scp-bg-upload-btn', 'scp-bg-url', () => _syncBgToOverlay()));
    import('./ui-widgets.js').then(m => m.buildSoundSettingsUI(document.getElementById('scp-sound-settings')));
    import('../features/feature-character-ui.js').then(m => m.refreshAltGreetingsPickers());
}

export function syncSPFromSettings() {
    const s = getSettings(); const ov = getSessionOverrides(); const eff = getEffectiveSettings();
    import('./ui-chat.js').then(m => { if (m.updateDepthSlidersMax) m.updateDepthSlidersMax(); });

    for (const def of _SETTINGS_DEF) {
        if (!def.spId) continue;
        const val = _readFromSettings(def);
        _writeToEl(document.getElementById(def.spId), def, val);
        if (def.type === 'slider' && def.spValId) { const el = document.getElementById(def.spValId); if (el) el.textContent = def.valFmt ? def.valFmt(val) : String(val ?? ''); }
    }
    for (const ceDef of _CE_FIELDS_DEF) {
        const val = (s.charEditFields || {})[ceDef.fk] !== false;
        const el = document.getElementById(ceDef.spId); if (el) el.checked = val;
    }

    const streamVal = s.forceStreaming === true ? 'on' : (s.forceStreaming === false ? 'auto' : (s.forceStreaming || 'auto'));
    document.querySelectorAll('.scp-stream-btn:not(.scp-ov-stream-btn)').forEach(b => { b.classList.toggle('active', b.dataset.stream === streamVal); b.style.color = ''; b.style.borderColor = ''; b.style.background = ''; });
    _applyConnectionSourceVisibility(s.connectionSource ?? 'default');
    refreshSPProfilesDropdown(); updateSPConnProfileList();

    // ── Session Override UI ──
    const g  = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
    const gC = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };

    const ovDs = document.getElementById('scp-sp-ov-depth-slider'); const ovDv = document.getElementById('scp-sp-ov-depth-val');
    if (ovDs) ovDs.value = eff.contextDepth ?? 15; if (ovDv) ovDv.textContent = eff.contextDepth ?? 15;

    g('scp-sp-ov-conn-source', eff.connectionSource ?? 'default');
    const ovPg = document.getElementById('scp-sp-ov-profile-group'); const ovCus = document.getElementById('scp-sp-ov-custom-profile-group');
    if (ovPg) ovPg.style.display = eff.connectionSource === 'profile' ? '' : 'none';
    if (ovCus) ovCus.style.display = eff.connectionSource === 'custom' ? '' : 'none';
    g('scp-sp-ov-conn-profile', eff.connectionProfileId ?? '');

    const ovi = (id, key) => { const el = document.getElementById(id); if (el) el.value = key in ov ? (ov[key] ?? '') : ''; };
    ovi('scp-sp-ov-custom-url', 'customUrl'); ovi('scp-sp-ov-custom-key', 'customKey'); ovi('scp-sp-ov-custom-model', 'customModel');
    ovi('scp-sp-ov-max-tokens', 'maxTokens'); ovi('scp-sp-ov-history-limit', 'localHistoryLimit');
    ovi('scp-sp-ov-reasoning-trim', 'reasoningTrimStrings'); ovi('scp-sp-ov-sysprompt', 'systemPrompt');
    ovi('scp-sp-ov-char-edit-prompt', 'charEditPrompt'); ovi('scp-sp-ov-lb-manage-prompt', 'lorebookManagePrompt'); ovi('scp-sp-ov-chat-edit-prompt', 'chatEditPrompt');

    gC('scp-sp-ov-include-sysprompt', eff.includeSystemPrompt); gC('scp-sp-ov-include-persona', eff.includeUserPersonality);
    gC('scp-sp-ov-include-alt-swipes', eff.includeAlternateSwipes); gC('scp-sp-ov-apply-regex', eff.applyRegexToContext);
    gC('scp-sp-ov-char-edit-enabled',  'charEditAIEnabled'        in ov ? ov.charEditAIEnabled        : s.charEditAIEnabled);
    gC('scp-sp-ov-lb-ai-enabled',      'lorebookAIManageEnabled'  in ov ? ov.lorebookAIManageEnabled  : s.lorebookAIManageEnabled);
    gC('scp-sp-ov-chat-edit-enabled',  'chatEditAIEnabled'        in ov ? ov.chatEditAIEnabled        : s.chatEditAIEnabled);
    gC('scp-sp-ov-lb-auto-kw',         'lorebookAutoKeyword'      in ov ? ov.lorebookAutoKeyword      : s.lorebookAutoKeyword);

    const ovStreamVal = eff.forceStreaming === true ? 'on' : (eff.forceStreaming === false ? 'auto' : (eff.forceStreaming || 'auto'));
    document.querySelectorAll('.scp-ov-stream-btn').forEach(b => {
        const active = b.dataset.stream === ovStreamVal; b.classList.toggle('active', active);
        b.style.color = active ? 'var(--scp-accent)' : ''; b.style.borderColor = active ? 'var(--scp-accent-dim)' : ''; b.style.background = active ? 'var(--scp-accent-bg)' : '';
    });
    for (const ceDef of _CE_FIELDS_DEF) {
        const ovKey = 'charField_' + ceDef.fk;
        const val = ovKey in ov ? !!ov[ovKey] : (s.charEditFields || {})[ceDef.fk] !== false;
        const el = document.getElementById(ceDef.ovId); if (el) el.checked = val;
    }
    const altGrOvEl = document.getElementById('scp-sp-ov-ce-alt-greetings');
    if (altGrOvEl) {
        const picker = document.getElementById('scp-sp-ov-ce-alt-greetings-picker');
        if (picker) picker.style.display = altGrOvEl.checked ? '' : 'none';
        import('../features/feature-character-ui.js').then(m => m.refreshAltGreetingsPickers());
    }
    updateSPOverrideIndicators();
    buildThemeEditor(document.getElementById('scp-sp-theme-section'));
    buildBackgroundSettingsUI(document.getElementById('scp-sp-bg-settings'));
    import('./ui-window.js').then(m => m._setupBgUpload('scp-sp-bg-upload-btn', 'scp-sp-bg-url', () => _syncBgToOverlay()));
    import('../features/feature-memory.js').then(m => m.updateMemoryDot());
}

export function updateSPOverrideIndicators() {
    const ov = getSessionOverrides();
    document.querySelectorAll('.scp-sp-ov-label[data-ovkey]').forEach(l => l.classList.toggle('has-override', l.dataset.ovkey in ov));
    document.querySelectorAll('.scp-sp-ov-clear[data-ovkey]').forEach(btn => {
        const active = btn.dataset.ovkey in ov; btn.classList.toggle('active', active); btn.disabled = !active;
    });
}

export function updateSessionOverrideIndicator() {
    const has = hasSessionOverrides();
    const dot = document.getElementById('scp-sp-override-dot'); if (dot) dot.style.display = has ? '' : 'none';
    const gearDot = document.getElementById('scp-gear-ov-dot'); if (gearDot) gearDot.style.display = has ? '' : 'none';
    document.getElementById('scp-ext-settings-btn')?.classList.toggle('scp-has-overrides', has);
    updateSPOverrideIndicators();
    const info = document.getElementById('scp-sp-footer-info');
    if (info) { const count = Object.keys(getSessionOverrides()).length; info.textContent = count ? `${count} session override${count !== 1 ? 's' : ''} active` : ''; }
    const ov = getSessionOverrides(); const hasDepthOv = 'contextDepth' in ov;
    document.getElementById('scp-depth-slider')?.classList.toggle('scp-slider-overridden', hasDepthOv);
    document.getElementById('scp-depth-val')?.classList.toggle('scp-depth-val-overridden', hasDepthOv);
}

// ─── Panel Open/Close ─────────────────────────────────────────────────────────

export function openSettingsPanel() {
    const overlay = document.getElementById('scp-settings-overlay'); if (!overlay) return;
    import('./ui-window.js').then(m => m.applyCustomTheme(getSettings().customTheme || THEME_PRESETS.default));
    syncSPFromSettings(); buildThemeEditor(document.getElementById('scp-sp-theme-section')); _updateDirtyDots();
    import('./ui-widgets.js').then(mod => {
        mod.buildSoundSettingsUI(document.getElementById('scp-sp-sound-settings'));
        buildQPSettingsUI(document.getElementById('scp-sp-qp-container'));
        mod.buildQPSetManager(document.getElementById('scp-sp-qp-set-manager'), () => buildQPSettingsUI(document.getElementById('scp-sp-qp-container')));
        const mkPresetMgr = (containerId, getTextId, dictKey) => mod.buildPromptPresetManager(
            document.getElementById(containerId),
            () => document.getElementById(getTextId)?.value || '',
            text => { const ta = document.getElementById(getTextId); if (ta) { ta.value = text; ta.dispatchEvent(new Event('input', { bubbles: true })); } },
            dictKey
        );
        mkPresetMgr('scp-sp-prompt-preset-manager',      'scp-sp-ov-sysprompt',       undefined);
        mkPresetMgr('scp-sp-ov-char-preset-manager',     'scp-sp-ov-char-edit-prompt', 'charEditPromptPresets');
        mkPresetMgr('scp-sp-ov-lb-preset-manager',       'scp-sp-ov-lb-manage-prompt', 'lbEditPromptPresets');
        mkPresetMgr('scp-sp-ov-chat-preset-manager',     'scp-sp-ov-chat-edit-prompt', 'chatEditPromptPresets');
    }).catch(() => {});
    import('../features/feature-character-ui.js').then(m => m.refreshAltGreetingsPickers());
    overlay.style.display = 'flex'; updateSessionOverrideIndicator();
    bringWindowToFront();
    import('../features/feature-memory.js').then(m => m.updateMemoryDot());
    overlay.querySelectorAll('.scp-sp-tab').forEach(t => t.classList.toggle('active', t.dataset.sptab === 'global'));
    overlay.querySelectorAll('.scp-sp-tab-pane').forEach(p => { p.style.display = p.id === 'scp-sp-pane-global' ? '' : 'none'; });
}

export function closeSettingsPanel() {
    const overlay = document.getElementById('scp-settings-overlay'); if (overlay) overlay.style.display = 'none';
}

// ─── Background Sync Helper ───────────────────────────────────────────────────

export function _syncBgToOverlay() {
    const s = getSettings(); const bgId = s.windowBg || 'none';
    ['scp-sp-bg-type', 'scp-bg-type'].forEach(id => { const el = document.getElementById(id); if (el) el.value = bgId; });
    const dim = s.windowBgDim ?? 50;
    ['scp-sp-bg-dim', 'scp-bg-dim'].forEach(id => { const el = document.getElementById(id); if (el) el.value = dim; });
    ['scp-sp-bg-dim-val', 'scp-bg-dim-val'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = `${dim}%`; });
}

// ─── Main Setup Functions ─────────────────────────────────────────────────────

export function setupSettingsHandlers() {
    _bindAllSettings();

    // ── forceStreaming button group ──
    document.querySelectorAll('#scp-st-stream-auto, #scp-st-stream-on, #scp-st-stream-off').forEach(btn => {
        btn.addEventListener('click', () => {
            const val = btn.dataset.stream; getSettings().forceStreaming = val; saveSettings();
            syncOverlayUI('forceStreaming', val); _markDirty('config');
        });
    });

    // ── Reset buttons ──
    const _resetPrompt = async (key, defaultVal, stId, spId, label) => {
        const ok = await showCustomDialog({ type: 'confirm', title: `Reset ${label}`, message: `Reset to default?` }); if (!ok) return;
        getSettings()[key] = defaultVal === '' ? '' : undefined; if (defaultVal !== '') getSettings()[key] = defaultVal;
        saveSettings(); _markDirty('config');
        const displayVal = defaultVal || (key === 'charEditPrompt' ? DEFAULT_CHAR_EDIT_DIRECTIVE.trim() : key === 'chatEditPrompt' ? DEFAULT_CHAT_EDIT_DIRECTIVE.trim() : key === 'lorebookManagePrompt' ? DEFAULT_LB_MANAGE_PROMPT : key === 'memoryManagePrompt' ? DEFAULT_MEMORY_PROMPT : DEFAULT_SYSTEM_PROMPT);
        [stId, spId].forEach(id => { const el = document.getElementById(id); if (el) el.value = displayVal; });
        import('./ui-chat.js').then(m => m.updateMsgCount(getCurrentSession()));
        toastr.success(`${label} reset.`, EXT_DISPLAY);
    };
    document.getElementById('scp-reset-prompt')?.addEventListener('click', () => _resetPrompt('systemPrompt', DEFAULT_SYSTEM_PROMPT, 'scp-sysprompt', 'scp-sp-sysprompt', 'System Prompt'));
    document.getElementById('scp-reset-char-edit-prompt')?.addEventListener('click', async () => {
        const ok = await showCustomDialog({ type: 'confirm', title: 'Reset Char Edit Prompt', message: 'Reset to built-in default?' }); if (!ok) return;
        getSettings().charEditPrompt = ''; saveSettings(); _markDirty('config');
        ['scp-char-edit-prompt', 'scp-sp-char-edit-prompt'].forEach(id => { const el = document.getElementById(id); if (el) el.value = DEFAULT_CHAR_EDIT_DIRECTIVE.trim(); });
        import('./ui-chat.js').then(m => m.updateMsgCount(getCurrentSession())); toastr.success('Char edit prompt reset.', EXT_DISPLAY);
    });
    document.getElementById('scp-reset-lb-prompt')?.addEventListener('click', async () => {
        const ok = await showCustomDialog({ type: 'confirm', title: 'Reset Lorebook Prompt', message: 'Reset to default?' }); if (!ok) return;
        getSettings().lorebookManagePrompt = DEFAULT_LB_MANAGE_PROMPT; saveSettings();
        ['scp-lb-manage-prompt', 'scp-sp-lb-manage-prompt'].forEach(id => { const el = document.getElementById(id); if (el) el.value = DEFAULT_LB_MANAGE_PROMPT; });
        toastr.success('Lorebook prompt reset.', EXT_DISPLAY);
    });
    document.getElementById('scp-reset-memory-prompt')?.addEventListener('click', async () => {
        const ok = await showCustomDialog({ type: 'confirm', title: 'Reset Prompt', message: 'Reset memory prompt to default?' }); if (!ok) return;
        getSettings().memoryManagePrompt = DEFAULT_MEMORY_PROMPT; saveSettings();
        ['scp-memory-prompt', 'scp-sp-memory-prompt'].forEach(id => { const el = document.getElementById(id); if (el) el.value = DEFAULT_MEMORY_PROMPT; });
        import('./ui-chat.js').then(m => m.updateMsgCount(getCurrentSession())); toastr.success('Prompt reset.', EXT_DISPLAY);
    });

    // ── Profile management (ST drawer) ──
    document.getElementById('scp-profile-select')?.addEventListener('change', async () => {
        const sel = document.getElementById('scp-profile-select'); const name = sel.value;
        if (isConfigProfileDirty()) {
            const ok = await showCustomDialog({ type: 'confirm', title: 'Unsaved Configuration', message: 'You have unsaved changes. Switch anyway?' });
            if (!ok) { sel.value = getSettings().activeProfile || ''; return; }
        }
        if (name) loadProfile(name); updateBindingSection();
    });
    document.getElementById('scp-profile-save')?.addEventListener('click', async () => {
        const sel = document.getElementById('scp-profile-select'); let name = sel?.value;
        if (!name) { name = await showCustomDialog({ type: 'prompt', title: 'Save Configuration', message: 'Enter a name for this configuration:', placeholder: 'My Config' }); if (!name?.trim()) return; name = name.trim(); }
        saveProfile(name); refreshProfilesDropdown(); if (sel) sel.value = name;
        updateBindingSection(); toastr.success(`Saved "${name}"`, EXT_DISPLAY); _clearDirty('config');
    });
    document.getElementById('scp-profile-create-new')?.addEventListener('click', async () => {
        const name = await showCustomDialog({ type: 'prompt', title: 'New Configuration', message: 'Enter a name for the new default profile:', placeholder: 'New Config' }); if (!name?.trim()) return;
        const n = name.trim(); const s = getSettings();
        s.profiles[n] = { systemPrompt: DEFAULT_SYSTEM_PROMPT, includeSystemPrompt: true, includeAuthorsNote: true, includeCharacterCard: true, includeUserPersonality: true, contextDepth: 15, localHistoryLimit: 50, connectionSource: 'default', connectionProfileId: '', maxTokens: 8200 };
        saveSettings(); refreshProfilesDropdown(); loadProfile(n);
        const sel = document.getElementById('scp-profile-select'); if (sel) sel.value = n;
        updateBindingSection(); toastr.success(`Created "${n}"`, EXT_DISPLAY);
    });
    document.getElementById('scp-profile-duplicate')?.addEventListener('click', async () => {
        const sel = document.getElementById('scp-profile-select'); if (!sel?.value) return toastr.info('No configuration selected.', EXT_DISPLAY);
        const newName = await showCustomDialog({ type: 'prompt', title: 'Duplicate Configuration', message: 'Name for the new profile:', defaultValue: sel.value + ' (Copy)' }); if (!newName?.trim()) return;
        const n = newName.trim(); const s = getSettings(); const p = s.profiles[sel.value]; if (!p) return;
        s.profiles[n] = JSON.parse(JSON.stringify(p)); saveSettings(); refreshProfilesDropdown(); refreshSPProfilesDropdown(); loadProfile(n);
        const newSel = document.getElementById('scp-profile-select'); if (newSel) newSel.value = n;
        updateBindingSection(); toastr.success(`Duplicated as "${n}"`, EXT_DISPLAY);
    });
    document.getElementById('scp-profile-rename')?.addEventListener('click', async () => {
        const sel = document.getElementById('scp-profile-select'); if (!sel?.value) return toastr.info('No configuration selected.', EXT_DISPLAY);
        const newName = await showCustomDialog({ type: 'prompt', title: 'Rename Configuration', message: 'New name:', defaultValue: sel.value }); if (!newName?.trim() || newName.trim() === sel.value) return;
        const s = getSettings(); const p = s.profiles[sel.value]; if (!p) return;
        s.profiles[newName.trim()] = p; delete s.profiles[sel.value];
        if (s.activeProfile === sel.value) s.activeProfile = newName.trim();
        for (const k in s.profileBindings) { if (s.profileBindings[k] === sel.value) s.profileBindings[k] = newName.trim(); }
        saveSettings(); refreshProfilesDropdown();
        const newSel = document.getElementById('scp-profile-select'); if (newSel) newSel.value = newName.trim();
        updateBindingSection(); toastr.success('Renamed.', EXT_DISPLAY);
    });
    document.getElementById('scp-profile-delete')?.addEventListener('click', async () => {
        const sel = document.getElementById('scp-profile-select'); if (!sel?.value) return;
        const s = getSettings(); if (Object.keys(s.profiles).length <= 1) { toastr.warning('Cannot delete the last remaining configuration profile.', EXT_DISPLAY); return; }
        const ok = await showCustomDialog({ type: 'confirm', title: 'Delete Configuration', message: `Delete "${sel.value}"?` }); if (!ok) return;
        deleteProfile(sel.value); refreshProfilesDropdown(); updateBindingSection(); toastr.success('Deleted.', EXT_DISPLAY);
    });
    document.getElementById('scp-bind-char')?.addEventListener('click', () => {
        const sel = document.getElementById('scp-profile-select'); if (!sel?.value) return;
        const s = getSettings(); const { charId } = getBindingKey(); const key = `char_${charId}`;
        if (s.profileBindings[key] === sel.value) delete s.profileBindings[key]; else s.profileBindings[key] = sel.value;
        _dbgAdd(s.profileBindings[key] ? 'PROFILE_BIND' : 'PROFILE_UNBIND', { target: 'char', profile: sel.value }); saveSettings(); updateBindingSection();
    });
    document.getElementById('scp-bind-chat')?.addEventListener('click', () => {
        const sel = document.getElementById('scp-profile-select'); if (!sel?.value) return;
        const s = getSettings(); const { charId, chatId } = getBindingKey(); const key = `chat_${charId}_${chatId}`;
        if (s.profileBindings[key] === sel.value) delete s.profileBindings[key]; else s.profileBindings[key] = sel.value;
        _dbgAdd(s.profileBindings[key] ? 'PROFILE_BIND' : 'PROFILE_UNBIND', { target: 'chat', profile: sel.value }); saveSettings(); updateBindingSection();
    });

    // ── Misc buttons ──
    document.getElementById('scp-open-window')?.addEventListener('click', () => import('./ui-window.js').then(m => m.showWindow()));
    document.getElementById('scp-download-debug')?.addEventListener('click', () => import('../utils/util-debug.js').then(m => m.dbgDownload()));
    document.getElementById('scp-open-memory-settings')?.addEventListener('click', () => { openSettingsPanel(); setTimeout(() => document.querySelector('[data-sptab="memory"]')?.click(), 80); });
    document.getElementById('scp-open-tools-settings')?.addEventListener('click', () => { openSettingsPanel(); setTimeout(() => document.querySelector('[data-sptab="tools"]')?.click(), 80); });
    document.getElementById('scp-clear-sessions')?.addEventListener('click', async () => {
        const ok = await showCustomDialog({ type: 'confirm', title: 'Clear All Sessions', message: 'Delete ALL Copilot sessions? This cannot be undone.', delayConfirm: 3 }); if (!ok) return;
        const { charId, chatId } = getBindingKey();
        _dbgAdd('SESSION_CLEAR_REQUESTED', { source: 'st-drawer', charId, chatId });
        getSettings().sessions = {}; saveSettings();
        try {
            await initChatBucket({ forceReset: true });
            _dbgAdd('SESSION_CLEAR_DONE', { source: 'st-drawer', charId, chatId });
        } catch (e) {
            _dbgAdd('SESSION_CLEAR_FAILED', { source: 'st-drawer', charId, chatId, error: e?.message || String(e), stack: e?.stack });
            toastr.error(`Failed to clear sessions: ${e.message}`, EXT_DISPLAY);
            return;
        }
        import('./ui-chat.js').then(m => m.onChatChanged());
        toastr.success('Sessions cleared.', EXT_DISPLAY);
    });

    // ── Background (ST) ──
    buildBackgroundSettingsUI(document.getElementById('scp-bg-settings'));
    import('./ui-window.js').then(m => m._setupBgUpload('scp-bg-upload-btn', 'scp-bg-url', () => _syncBgToOverlay()));

    refreshProfilesDropdown();
}

export function setupSettingsPanelListeners() {
    const overlay = document.getElementById('scp-settings-overlay'); if (!overlay) return;

    document.getElementById('scp-sp-close')?.addEventListener('click', () => closeSettingsPanel());
    let _spMD = null;
    overlay.addEventListener('mousedown', e => { _spMD = e.target; });
    overlay.addEventListener('click', e => { if (e.target === overlay && _spMD === overlay) closeSettingsPanel(); });

    // ── Tab switching ──
    overlay.querySelectorAll('.scp-sp-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            overlay.querySelectorAll('.scp-sp-tab').forEach(t => t.classList.remove('active')); tab.classList.add('active');
            const pane = tab.dataset.sptab;
            overlay.querySelectorAll('.scp-sp-tab-pane').forEach(p => { p.style.display = p.id === `scp-sp-pane-${pane}` ? '' : 'none'; });
            if (pane === 'stats') import('../features/feature-stats.js').then(m => { const c = document.getElementById('scp-sp-stats-container'); if (c) m.renderStatsPane(c); });
            if (pane === 'memory') import('../features/feature-memory.js').then(m => m.setupMemorySettingsUI());
            if (pane === 'tools') import('../features/feature-tools-ui.js').then(m => m.setupToolsSettingsUI());
        });
    });

    // ── SP forceStreaming ──
    document.querySelectorAll('.scp-stream-btn:not(.scp-ov-stream-btn)').forEach(btn => {
        btn.addEventListener('click', () => {
            const val = btn.dataset.stream; getSettings().forceStreaming = val; saveSettings();
            syncOverlayUI('forceStreaming', val); _markDirty('config');
        });
    });

    // ── SP Profile management ──
    document.getElementById('scp-sp-profile-select')?.addEventListener('change', async () => {
        const sel = document.getElementById('scp-sp-profile-select'); if (!sel?.value) return;
        if (isConfigProfileDirty()) {
            const ok = await showCustomDialog({ type: 'confirm', title: 'Unsaved Configuration', message: 'Unsaved changes. Switch anyway?' });
            if (!ok) { sel.value = getSettings().activeProfile || ''; return; }
        }
        loadProfile(sel.value); syncSPFromSettings(); updateSettingsUI(); updateSPBindingSection();
    });
    document.getElementById('scp-sp-profile-save')?.addEventListener('click', async () => {
        const sel = document.getElementById('scp-sp-profile-select'); let name = sel?.value;
        if (!name) { name = await showCustomDialog({ type: 'prompt', title: 'Save Configuration', message: 'Profile name:', placeholder: 'My Config' }); if (!name?.trim()) return; name = name.trim(); }
        saveProfile(name); refreshSPProfilesDropdown(); refreshProfilesDropdown(); if (sel) sel.value = name;
        updateSPBindingSection(); toastr.success(`Saved "${name}"`, EXT_DISPLAY); _clearDirty('config');
    });
    document.getElementById('scp-sp-profile-create')?.addEventListener('click', async () => {
        const name = await showCustomDialog({ type: 'prompt', title: 'New Configuration', message: 'Name:', placeholder: 'New Config' }); if (!name?.trim()) return;
        const n = name.trim(); const s = getSettings();
        s.profiles[n] = { systemPrompt: DEFAULT_SYSTEM_PROMPT, includeSystemPrompt: true, includeAuthorsNote: true, includeCharacterCard: true, includeUserPersonality: true, contextDepth: 15, localHistoryLimit: 50, connectionSource: 'default', connectionProfileId: '', maxTokens: 8200, applyRegexToContext: true };
        saveSettings(); refreshSPProfilesDropdown(); refreshProfilesDropdown(); loadProfile(n); syncSPFromSettings(); updateSettingsUI();
        const sel = document.getElementById('scp-sp-profile-select'); if (sel) sel.value = n;
        updateSPBindingSection(); toastr.success(`Created "${n}"`, EXT_DISPLAY);
    });
    document.getElementById('scp-sp-profile-duplicate')?.addEventListener('click', async () => {
        const sel = document.getElementById('scp-sp-profile-select'); if (!sel?.value) return toastr.info('No configuration selected.', EXT_DISPLAY);
        const newName = await showCustomDialog({ type: 'prompt', title: 'Duplicate Configuration', message: 'Name for the new profile:', defaultValue: sel.value + ' (Copy)' }); if (!newName?.trim()) return;
        const n = newName.trim(); const s = getSettings(); const p = s.profiles[sel.value]; if (!p) return;
        s.profiles[n] = JSON.parse(JSON.stringify(p)); saveSettings(); refreshSPProfilesDropdown(); refreshProfilesDropdown(); loadProfile(n); syncSPFromSettings(); updateSettingsUI();
        const newSel = document.getElementById('scp-sp-profile-select'); if (newSel) newSel.value = n;
        updateSPBindingSection(); toastr.success(`Duplicated as "${n}"`, EXT_DISPLAY);
    });
    document.getElementById('scp-sp-profile-rename')?.addEventListener('click', async () => {
        const sel = document.getElementById('scp-sp-profile-select'); if (!sel?.value) return;
        const newName = await showCustomDialog({ type: 'prompt', title: 'Rename', message: 'New name:', defaultValue: sel.value }); if (!newName?.trim() || newName.trim() === sel.value) return;
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
        const s = getSettings(); if (Object.keys(s.profiles).length <= 1) { toastr.warning('Cannot delete the last profile.', EXT_DISPLAY); return; }
        const ok = await showCustomDialog({ type: 'confirm', title: 'Delete Profile', message: `Delete "${sel.value}"?` }); if (!ok) return;
        deleteProfile(sel.value); refreshSPProfilesDropdown(); refreshProfilesDropdown(); updateSPBindingSection(); toastr.success('Deleted.', EXT_DISPLAY);
    });
    document.getElementById('scp-sp-bind-char')?.addEventListener('click', () => {
        const sel = document.getElementById('scp-sp-profile-select'); if (!sel?.value) return;
        const s = getSettings(); const { charId } = getBindingKey(); const key = `char_${charId}`;
        if (s.profileBindings[key] === sel.value) delete s.profileBindings[key]; else s.profileBindings[key] = sel.value;
        saveSettings(); updateSPBindingSection(); document.getElementById('scp-sp-bind-char')?.classList.toggle('active', s.profileBindings[key] === sel.value);
    });
    document.getElementById('scp-sp-bind-chat')?.addEventListener('click', () => {
        const sel = document.getElementById('scp-sp-profile-select'); if (!sel?.value) return;
        const s = getSettings(); const { charId, chatId } = getBindingKey(); const key = `chat_${charId}_${chatId}`;
        if (s.profileBindings[key] === sel.value) delete s.profileBindings[key]; else s.profileBindings[key] = sel.value;
        saveSettings(); updateSPBindingSection(); document.getElementById('scp-sp-bind-chat')?.classList.toggle('active', s.profileBindings[key] === sel.value);
    });

    // ── SP conn profile ──
    document.getElementById('scp-sp-conn-profile')?.addEventListener('change', e => {
        getSettings().connectionProfileId = e.target.value; saveSettings(); syncOverlayUI('connectionProfileId', e.target.value); _markDirty('config');
    });

    // ── SP Reset buttons ──
    document.getElementById('scp-sp-reset-prompt')?.addEventListener('click', async () => {
        const ok = await showCustomDialog({ type: 'confirm', title: 'Reset System Prompt', message: 'Reset to default?' }); if (!ok) return;
        getSettings().systemPrompt = DEFAULT_SYSTEM_PROMPT; saveSettings();
        ['scp-sp-sysprompt', 'scp-sysprompt'].forEach(id => { const el = document.getElementById(id); if (el) el.value = DEFAULT_SYSTEM_PROMPT; });
        import('./ui-chat.js').then(m => m.updateMsgCount(getCurrentSession())); toastr.success('System prompt reset.', EXT_DISPLAY);
    });
    document.getElementById('scp-sp-reset-lb-prompt')?.addEventListener('click', async () => {
        const ok = await showCustomDialog({ type: 'confirm', title: 'Reset LB Prompt', message: 'Reset to default?' }); if (!ok) return;
        getSettings().lorebookManagePrompt = DEFAULT_LB_MANAGE_PROMPT; saveSettings();
        ['scp-sp-lb-manage-prompt', 'scp-lb-manage-prompt'].forEach(id => { const el = document.getElementById(id); if (el) el.value = DEFAULT_LB_MANAGE_PROMPT; });
        toastr.success('Lorebook prompt reset.', EXT_DISPLAY);
    });
    document.getElementById('scp-sp-reset-char-edit-prompt')?.addEventListener('click', async () => {
        const ok = await showCustomDialog({ type: 'confirm', title: 'Reset Char Edit Prompt', message: 'Reset to built-in default?' }); if (!ok) return;
        getSettings().charEditPrompt = ''; saveSettings(); _markDirty('config');
        ['scp-sp-char-edit-prompt', 'scp-char-edit-prompt'].forEach(id => { const el = document.getElementById(id); if (el) el.value = DEFAULT_CHAR_EDIT_DIRECTIVE.trim(); });
        import('./ui-chat.js').then(m => m.updateMsgCount(getCurrentSession())); toastr.success('Char edit prompt reset.', EXT_DISPLAY);
    });
    document.getElementById('scp-sp-reset-chat-edit-prompt')?.addEventListener('click', async () => {
        const ok = await showCustomDialog({ type: 'confirm', title: 'Reset Chat Edit Prompt', message: 'Reset to default?' }); if (!ok) return;
        getSettings().chatEditPrompt = ''; saveSettings(); _markDirty('config');
        ['scp-sp-chat-edit-prompt', 'scp-chat-edit-prompt-st'].forEach(id => { const el = document.getElementById(id); if (el) el.value = DEFAULT_CHAT_EDIT_DIRECTIVE.trim(); });
        import('./ui-chat.js').then(m => m.updateMsgCount(getCurrentSession())); toastr.success('Chat edit prompt reset.', EXT_DISPLAY);
    });
    document.getElementById('scp-sp-reset-memory-prompt')?.addEventListener('click', async () => {
        const ok = await showCustomDialog({ type: 'confirm', title: 'Reset Prompt', message: 'Reset memory prompt to default?' }); if (!ok) return;
        getSettings().memoryManagePrompt = DEFAULT_MEMORY_PROMPT; saveSettings();
        ['scp-sp-memory-prompt', 'scp-memory-prompt'].forEach(id => { const el = document.getElementById(id); if (el) el.value = DEFAULT_MEMORY_PROMPT; });
        toastr.success('Prompt reset.', EXT_DISPLAY);
    });
    document.getElementById('scp-sp-tools-reset')?.addEventListener('click', async () => {
        const ok = await showCustomDialog({ type: 'confirm', title: 'Reset Prompt', message: 'Reset tools prompt to default?' }); if (!ok) return;
        getSettings().toolsSystemPrompt = DEFAULT_TOOLS_PROMPT; saveSettings();
        const ta = document.getElementById('scp-sp-tools-prompt'); if (ta) ta.value = DEFAULT_TOOLS_PROMPT;
        toastr.success('Tools prompt reset.', EXT_DISPLAY);
    });

    // ── Misc SP ──
    document.getElementById('scp-sp-open-changelog')?.addEventListener('click', () => { closeSettingsPanel(); import('./ui-widgets.js').then(m => m.openChangelog()); });
    document.getElementById('scp-sp-download-debug')?.addEventListener('click', () => import('../utils/util-debug.js').then(m => m.dbgDownload()));
    document.getElementById('scp-sp-clear-sessions')?.addEventListener('click', async () => {
        const ok = await showCustomDialog({ type: 'confirm', title: 'Clear All Sessions', message: 'Delete ALL Copilot sessions? This cannot be undone.', delayConfirm: 3 }); if (!ok) return;
        const { charId, chatId } = getBindingKey();
        _dbgAdd('SESSION_CLEAR_REQUESTED', { source: 'settings-overlay', charId, chatId });
        getSettings().sessions = {}; saveSettings();
        try {
            await initChatBucket({ forceReset: true });
            _dbgAdd('SESSION_CLEAR_DONE', { source: 'settings-overlay', charId, chatId });
            import('./ui-chat.js').then(m => m.onChatChanged());
            toastr.success('Sessions cleared.', EXT_DISPLAY);
        } catch (e) {
            _dbgAdd('SESSION_CLEAR_FAILED', { source: 'settings-overlay', charId, chatId, error: e?.message || String(e), stack: e?.stack });
            toastr.error(`Failed to clear sessions: ${e.message}`, EXT_DISPLAY);
        }
    });
    document.getElementById('scp-sp-reset-all-overrides')?.addEventListener('click', async () => {
        if (!hasSessionOverrides()) { toastr.info('No session overrides active.', EXT_DISPLAY); return; }
        const ok = await showCustomDialog({ type: 'confirm', title: 'Reset Session Overrides', message: 'Clear all session overrides for this session?' }); if (!ok) return;
        clearAllSessionOverrides(); syncSPFromSettings();
        import('./ui-chat.js').then(m => m.updateMsgCount(getCurrentSession())); toastr.success('Session overrides cleared.', EXT_DISPLAY);
    });

    // ── Session Override bindings ──
    const bindOv = (id, key, isCheckbox = false, toVal = null) => {
        const el = document.getElementById(id); if (!el) return;
        el.addEventListener(isCheckbox ? 'change' : 'input', () => {
            const raw = isCheckbox ? el.checked : el.value;
            _syncOvToGlobal(key, (raw === '' || raw === undefined) ? undefined : (toVal ? toVal(raw) : raw));
        });
    };
    const bindOvSel = (id, key) => { const el = document.getElementById(id); if (!el) return; el.addEventListener('change', () => _syncOvToGlobal(key, el.value || undefined)); };

    const ovDs = document.getElementById('scp-sp-ov-depth-slider'); const ovDv = document.getElementById('scp-sp-ov-depth-val');
    if (ovDs) { ovDs.addEventListener('input', () => { if (ovDv) ovDv.textContent = ovDs.value; }); ovDs.addEventListener('change', () => _syncOvToGlobal('contextDepth', parseInt(ovDs.value))); }

    document.getElementById('scp-sp-ov-conn-source')?.addEventListener('change', e => {
        _syncOvToGlobal('connectionSource', e.target.value);
        const pg = document.getElementById('scp-sp-ov-profile-group'); const cg = document.getElementById('scp-sp-ov-custom-profile-group');
        if (pg) pg.style.display = e.target.value === 'profile' ? '' : 'none';
        if (cg) cg.style.display = e.target.value === 'custom' ? '' : 'none';
        if (e.target.value === 'profile') updateSPConnProfileList();
    });
    bindOv('scp-sp-ov-custom-url', 'customUrl'); bindOv('scp-sp-ov-custom-key', 'customKey'); bindOv('scp-sp-ov-custom-model', 'customModel');
    bindOvSel('scp-sp-ov-conn-profile', 'connectionProfileId');
    bindOv('scp-sp-ov-max-tokens', 'maxTokens', false, Number); bindOv('scp-sp-ov-history-limit', 'localHistoryLimit', false, Number);
    bindOv('scp-sp-ov-reasoning-trim', 'reasoningTrimStrings'); bindOv('scp-sp-ov-char-edit-prompt', 'charEditPrompt');
    bindOv('scp-sp-ov-lb-manage-prompt', 'lorebookManagePrompt'); bindOv('scp-sp-ov-chat-edit-prompt', 'chatEditPrompt');
    document.getElementById('scp-sp-ov-sysprompt')?.addEventListener('input', e => _syncOvToGlobal('systemPrompt', e.target.value || undefined));
    bindOv('scp-sp-ov-include-sysprompt',  'includeSystemPrompt',     true);
    bindOv('scp-sp-ov-include-persona',    'includeUserPersonality',   true);
    bindOv('scp-sp-ov-include-alt-swipes', 'includeAlternateSwipes',   true);
    bindOv('scp-sp-ov-apply-regex',        'applyRegexToContext',      true);
    bindOv('scp-sp-ov-char-edit-enabled',  'charEditAIEnabled',        true);
    bindOv('scp-sp-ov-lb-ai-enabled',      'lorebookAIManageEnabled',  true);
    bindOv('scp-sp-ov-chat-edit-enabled',  'chatEditAIEnabled',        true);
    bindOv('scp-sp-ov-lb-auto-kw',         'lorebookAutoKeyword',      true);

    // Override streaming buttons
    document.querySelectorAll('.scp-ov-stream-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const val = btn.dataset.stream; _syncOvToGlobal('forceStreaming', val);
            document.querySelectorAll('.scp-ov-stream-btn').forEach(b => {
                const active = b.dataset.stream === val; b.classList.toggle('active', active);
                b.style.color = active ? 'var(--scp-accent)' : ''; b.style.borderColor = active ? 'var(--scp-accent-dim)' : ''; b.style.background = active ? 'var(--scp-accent-bg)' : '';
            });
        });
    });

    // CE override fields
    _CE_FIELDS_DEF.forEach(ceDef => {
        bindOv(ceDef.ovId, 'charField_' + ceDef.fk, true);
        if (ceDef.altGreetingPicker) {
            document.getElementById(ceDef.ovId)?.addEventListener('change', e => {
                const picker = document.getElementById('scp-sp-ov-ce-alt-greetings-picker');
                if (picker) picker.style.display = e.target.checked ? '' : 'none';
                import('../features/feature-character-ui.js').then(m => m.refreshAltGreetingsPickers());
            });
        }
    });

    // Override clear buttons
    document.querySelectorAll('.scp-sp-ov-clear[data-ovkey]').forEach(btn => {
        btn.addEventListener('click', () => {
            setSessionOverride(btn.dataset.ovkey, undefined);
            _resetOvElToEffective(btn.dataset.ovkey);
            updateSPOverrideIndicators();
            import('./ui-chat.js').then(m => m.updateMsgCount(getCurrentSession()));
        });
    });

    // ── SP background ──
    import('./ui-window.js').then(m => m._setupBgUpload('scp-sp-bg-upload-btn', 'scp-sp-bg-url', () => _syncBgToOverlay()));
}

// ─── Background Settings UI ───────────────────────────────────────────────────

export function buildBackgroundSettingsUI(container) {
    if (!container) return;
    container.innerHTML = '';
    const s = getSettings(); if (!s.customBackgrounds) s.customBackgrounds = {};
    const isSP = container.id === 'scp-sp-bg-settings';

    const mkRow = () => { const d = document.createElement('div'); d.className = isSP ? 'scp-sp-field' : ''; return d; };
    const mkLbl = text => { const l = document.createElement(isSP ? 'label' : 'b'); l.className = isSP ? 'scp-sp-label' : ''; if (!isSP) l.style.cssText = 'font-size:11px;color:#888;display:block;margin-bottom:4px'; l.textContent = text; return l; };
    const mkBtn = (icon, label, cls, cb) => { const b = document.createElement('button'); b.className = isSP ? `scp-action-btn${cls ? ' '+cls : ''}` : 'menu_button interactable'; b.innerHTML = `<i class="fa-solid fa-${icon}"></i><span>${label}</span>`; if (!isSP) b.style.flex = '1'; b.addEventListener('click', cb); return b; };

    const typeRow = mkRow(); const typeLbl = mkLbl('Background Type');
    const typeWrap = document.createElement('div'); typeWrap.style.cssText = 'display:flex;gap:6px;align-items:center';
    const typeSel = document.createElement('select'); typeSel.className = isSP ? 'scp-sp-select text_pole' : 'text_pole'; typeSel.style.flex = '1';

    const renderDropdown = () => {
        typeSel.innerHTML = '<option value="none">None</option>';
        if (Object.keys(s.customBackgrounds).length) {
            const grp = document.createElement('optgroup'); grp.label = 'Custom Backgrounds';
            for (const [key, bg] of Object.entries(s.customBackgrounds)) { const o = document.createElement('option'); o.value = key; o.textContent = bg.name; grp.appendChild(o); }
            typeSel.appendChild(grp);
        }
        typeSel.value = s.windowBg || 'none';
    };
    renderDropdown();
    typeWrap.appendChild(typeSel); typeRow.appendChild(typeLbl); typeRow.appendChild(typeWrap); container.appendChild(typeRow);

    const actWrap = document.createElement('div'); actWrap.style.cssText = isSP ? 'display:flex;gap:6px;margin-top:6px' : 'display:flex;gap:6px;margin-top:6px;align-items:center';
    const rebuildAll = () => { [document.getElementById('scp-bg-settings'), document.getElementById('scp-sp-bg-settings')].filter(Boolean).forEach(c => buildBackgroundSettingsUI(c)); import('./ui-window.js').then(m => m.applyWindowBackground()); };

    actWrap.appendChild(mkBtn('upload', 'Upload', '', () => {
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*,video/mp4,video/webm';
        inp.onchange = async () => {
            const file = inp.files?.[0]; if (!file) return;
            if (file.size > 25 * 1024 * 1024) { toastr.warning('File too large (>25MB).', EXT_DISPLAY); return; }
            const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(null); r.readAsDataURL(file); });
            if (!dataUrl) return;
            const s2 = getSettings(); const id = 'bg_' + Date.now();
            s2.customBackgrounds[id] = { name: file.name, dataUrl, isVideo: file.type.startsWith('video/'), fit: 'cover' }; s2.windowBg = id; saveSettings(); rebuildAll();
        };
        inp.click();
    }));
    actWrap.appendChild(mkBtn('link', 'URL', '', async () => {
        const url = await showCustomDialog({ type: 'prompt', title: 'Add Background', message: 'Enter direct URL to image or video:', placeholder: 'https://...' });
        if (url?.trim()) {
            const s2 = getSettings(); const id = 'bg_' + Date.now();
            s2.customBackgrounds[id] = { name: 'URL Background', dataUrl: url.trim(), isVideo: url.endsWith('.mp4') || url.endsWith('.webm'), fit: 'cover' }; s2.windowBg = id; saveSettings(); rebuildAll();
        }
    }));
    actWrap.appendChild(mkBtn('pen', 'Rename', '', async () => {
        const val = typeSel.value; if (val === 'none') return;
        const newName = await showCustomDialog({ type: 'prompt', title: 'Rename Background', message: 'New name:', defaultValue: s.customBackgrounds[val]?.name });
        if (newName?.trim()) { s.customBackgrounds[val].name = newName.trim(); saveSettings(); rebuildAll(); }
    }));
    actWrap.appendChild(mkBtn('trash', 'Delete', isSP ? 'scp-sp-danger-btn' : '', async () => {
        const val = typeSel.value; if (val === 'none') return;
        const ok = await showCustomDialog({ type: 'confirm', title: 'Delete Background', message: 'Delete this background?' }); if (!ok) return;
        const s2 = getSettings(); delete s2.customBackgrounds[val]; s2.windowBg = 'none'; saveSettings(); rebuildAll();
    }));
    container.appendChild(actWrap);

    const extraWrap = document.createElement('div'); extraWrap.style.marginTop = '12px';
    const fitRow = mkRow(); const fitLbl = mkLbl('Image/Video Fit');
    const fitSel = document.createElement('select'); fitSel.className = isSP ? 'scp-sp-select text_pole' : 'text_pole'; fitSel.id = isSP ? 'scp-sp-fit-sel' : 'scp-fit-sel';
    ['cover','contain','fill','center'].forEach(f => { const o = document.createElement('option'); o.value = f; o.textContent = f; fitSel.appendChild(o); });
    fitSel.value = s.customBackgrounds[s.windowBg]?.fit || 'cover';
    fitSel.addEventListener('change', () => { if (s.windowBg !== 'none' && s.customBackgrounds[s.windowBg]) { s.customBackgrounds[s.windowBg].fit = fitSel.value; saveSettings(); import('./ui-window.js').then(m => m.applyWindowBackground()); } });
    fitRow.appendChild(fitLbl); fitRow.appendChild(fitSel); extraWrap.appendChild(fitRow);

    const dimRow = mkRow(); dimRow.style.marginTop = '8px'; const dimLbl = mkLbl('Darkness Overlay');
    const dimFlex = document.createElement('div'); dimFlex.className = isSP ? 'scp-sp-row' : ''; if (!isSP) dimFlex.style.cssText = 'display:flex;align-items:center;gap:10px';
    const dimSlider = document.createElement('input'); dimSlider.type = 'range'; dimSlider.min = '0'; dimSlider.max = '100'; dimSlider.className = isSP ? 'scp-slider' : 'neo-range-slider'; dimSlider.style.flex = '1'; dimSlider.value = s.windowBgDim ?? 50;
    const dimVal = document.createElement('span'); dimVal.style.cssText = isSP ? 'min-width:32px;text-align:right;font-size:11px;color:var(--scp-accent)' : 'font-size:12px;min-width:34px;text-align:right;color:var(--SmartThemeQuoteColor,#a99bfb)'; dimVal.textContent = `${dimSlider.value}%`;
    dimSlider.addEventListener('input', () => { dimVal.textContent = `${dimSlider.value}%`; });
    dimSlider.addEventListener('change', () => { getSettings().windowBgDim = parseInt(dimSlider.value); saveSettings(); import('./ui-window.js').then(m => m.applyWindowBackground()); _syncBgToOverlay(); });
    dimFlex.appendChild(dimSlider); dimFlex.appendChild(dimVal); dimRow.appendChild(dimLbl); dimRow.appendChild(dimFlex); extraWrap.appendChild(dimRow);
    container.appendChild(extraWrap);

    const updateVis = () => { const isNone = typeSel.value === 'none'; extraWrap.style.display = isNone ? 'none' : 'block'; };
    updateVis();
    typeSel.addEventListener('change', () => { getSettings().windowBg = typeSel.value; saveSettings(); updateVis(); rebuildAll(); });
}

// ─── Quick Prompts Settings UI ────────────────────────────────────────────────

export function buildQPSettingsUI(container) {
    if (!container) return;
    container.innerHTML = '';
    const list = document.createElement('div'); list.className = 'scp-qp-settings-list';

    const renderList = () => {
        list.innerHTML = '';
        const prompts = getSettings().quickPrompts || [];
        if (!prompts.length) { list.innerHTML = `<div style="font-size:11px;color:var(--scp-text-muted);text-align:center;padding:10px 0">No quick prompts yet. Add one below.</div>`; }
        prompts.forEach((qp, idx) => {
            const row = document.createElement('div'); row.className = 'scp-qp-settings-row';
            const iconBtn = document.createElement('button'); iconBtn.className = 'scp-qp-settings-icon-btn'; iconBtn.textContent = qp.icon || '⚡'; iconBtn.title = 'Change icon';
            import('./ui-widgets.js').then(mod => {
                iconBtn.addEventListener('click', e => { e.stopPropagation(); mod.showQPIconPicker(iconBtn, qp.icon || '⚡', emoji => { getSettings().quickPrompts[idx].icon = emoji; saveSettings(); iconBtn.textContent = emoji; mod.renderQuickPromptsBar(); }); });
            });
            const labelInput = document.createElement('input'); labelInput.type = 'text'; labelInput.className = 'scp-qp-settings-label-input scp-sp-input'; labelInput.placeholder = 'Label'; labelInput.value = qp.label || '';
            labelInput.addEventListener('input', () => { getSettings().quickPrompts[idx].label = labelInput.value; saveSettings(); import('./ui-widgets.js').then(m => m.renderQuickPromptsBar()); });
            const moveUpBtn = document.createElement('button'); moveUpBtn.className = 'scp-qp-settings-move'; moveUpBtn.textContent = '↑'; moveUpBtn.title = 'Move up'; moveUpBtn.disabled = idx === 0;
            moveUpBtn.addEventListener('click', () => { if (idx === 0) return; const arr = getSettings().quickPrompts; [arr[idx-1], arr[idx]] = [arr[idx], arr[idx-1]]; saveSettings(); renderList(); import('./ui-widgets.js').then(m => m.renderQuickPromptsBar()); });
            const moveDnBtn = document.createElement('button'); moveDnBtn.className = 'scp-qp-settings-move'; moveDnBtn.textContent = '↓'; moveDnBtn.title = 'Move down'; moveDnBtn.disabled = idx === prompts.length - 1;
            moveDnBtn.addEventListener('click', () => { const arr = getSettings().quickPrompts; if (idx >= arr.length - 1) return; [arr[idx], arr[idx+1]] = [arr[idx+1], arr[idx]]; saveSettings(); renderList(); import('./ui-widgets.js').then(m => m.renderQuickPromptsBar()); });
            const delBtn = document.createElement('button'); delBtn.className = 'scp-qp-settings-del'; delBtn.innerHTML = I.trash; delBtn.title = 'Delete';
            delBtn.addEventListener('click', async () => { const ok = await showCustomDialog({ type: 'confirm', title: 'Delete Prompt', message: `Delete "${qp.label || 'this prompt'}"?` }); if (!ok) return; getSettings().quickPrompts.splice(idx, 1); saveSettings(); renderList(); import('./ui-widgets.js').then(m => m.renderQuickPromptsBar()); });
            const textArea = document.createElement('textarea'); textArea.className = 'scp-qp-settings-text scp-sp-textarea'; textArea.placeholder = 'Prompt text… (supports {{user}}, {{char}} macros)'; textArea.rows = 2; textArea.value = qp.text || '';
            textArea.addEventListener('input', () => { getSettings().quickPrompts[idx].text = textArea.value; saveSettings(); });
            const controls = document.createElement('div'); controls.className = 'scp-qp-settings-controls'; controls.appendChild(moveUpBtn); controls.appendChild(moveDnBtn); controls.appendChild(delBtn);
            const top = document.createElement('div'); top.className = 'scp-qp-settings-row-top'; top.appendChild(iconBtn); top.appendChild(labelInput); top.appendChild(controls);
            row.appendChild(top); row.appendChild(textArea); list.appendChild(row);
        });
    };
    renderList();

    const addBtn = document.createElement('button'); addBtn.className = 'scp-action-btn'; addBtn.style.marginTop = '8px'; addBtn.innerHTML = `${I.plus}<span>Add Prompt</span>`;
    addBtn.addEventListener('click', async () => {
        const label = await showCustomDialog({ type: 'prompt', title: 'New Quick Prompt', message: 'Label for this prompt:', placeholder: 'My Prompt' }); if (label === null) return;
        getSettings().quickPrompts.push({ id: 'qp_'+Date.now(), label: label.trim() || 'Prompt', icon: '⚡', text: '' }); saveSettings(); renderList(); import('./ui-widgets.js').then(m => m.renderQuickPromptsBar());
    });
    container.appendChild(list); container.appendChild(addBtn);
}