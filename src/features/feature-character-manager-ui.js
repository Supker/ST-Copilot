import { EXT_DISPLAY, I, THEME_PRESETS } from '../constants.js';
import { getSettings, saveSettings } from '../session.js';
import { applyCustomTheme, bringWindowToFront } from '../ui/ui-window.js';
import { getUserPersona } from '../utils/util-st.js';
import {
    getActiveCharacterEntities, getCharFieldValue, saveCharacterField,
    getEffectiveCharField, getCharFieldOverride, setCharFieldOverride,
    isCharacterExcluded, setCharacterExcluded,
} from './feature-character-engine.js';

const FIELD_GROUPS = [
    { title: 'Identity', fields: [
        { key: 'name', label: 'Name' },
        { key: 'tags', label: 'Tags' },
        { key: 'description', label: 'Description', multiline: true },
        { key: 'personality', label: 'Personality', multiline: true },
    ]},
    { title: 'Scene', fields: [
        { key: 'scenario', label: 'Scenario', multiline: true },
        { key: 'first_mes', label: 'First Message', multiline: true },
        { key: 'mes_example', label: 'Example Dialogue', multiline: true },
    ]},
    { title: 'Advanced', fields: [
        { key: 'system_prompt', label: 'Main Prompt Override', multiline: true },
        { key: 'post_history_instructions', label: 'Post-History Instructions', multiline: true },
    ]},
];

const OV_FIELDS = [
    { key: 'tags', label: 'Tags' }, { key: 'description', label: 'Description' },
    { key: 'personality', label: 'Personality' }, { key: 'scenario', label: 'Scenario' },
    { key: 'first_mes', label: 'First Message' }, { key: 'mes_example', label: 'Example Dialogue' },
    { key: 'authors_note', label: "Author's Note" }, { key: 'system_prompt', label: 'Main Prompt Override' },
    { key: 'post_history_instructions', label: 'Post-History Instructions' },
    { key: 'alternate_greetings', label: 'Alternate Greetings' },
];

// ─── Module State ─────────────────────────────────────────────────────────────

let _selectedEntityId = null;
let _lastActiveTab = 'info';
let _lastScrollTop = 0;
let _currentIsDirty = false;
let _currentSaveFn = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _showUnsavedDialog(onSave, onDiscard) {
    const overlay = document.createElement('div');
    overlay.className = 'scp-dialog-overlay';
    overlay.style.zIndex = '2147483055';
    overlay.innerHTML = `
        <div class="scp-dialog-box">
            <div class="scp-dialog-title">Unsaved Changes</div>
            <div class="scp-dialog-msg">You have unsaved changes to character fields. What would you like to do?</div>
            <div class="scp-dialog-btns">
                <button class="scp-dialog-btn scp-dialog-cancel" id="_uc_cancel">Cancel</button>
                <button class="scp-dialog-btn scp-dialog-cancel" id="_uc_discard" style="color:var(--scp-danger,#ff5c5c)">Discard</button>
                <button class="scp-dialog-btn scp-dialog-ok" id="_uc_save">Save &amp; Exit</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('visible'));
    const close = () => { overlay.classList.remove('visible'); setTimeout(() => overlay.remove(), 150); };
    let _md = null;
    overlay.addEventListener('mousedown', e => { _md = e.target; });
    overlay.addEventListener('click', e => { if (e.target === overlay && _md === overlay) close(); });
    overlay.querySelector('#_uc_cancel').addEventListener('click', () => close());
    overlay.querySelector('#_uc_discard').addEventListener('click', () => { close(); onDiscard(); });
    overlay.querySelector('#_uc_save').addEventListener('click', async () => { close(); await onSave(); });
}

function _getPersonaEntity() {
    const ctx = SillyTavern.getContext();
    let avatar = window.user_avatar || ctx.user_avatar || ctx.userAvatar || ctx.personaId || ctx.activePersonaId || ctx.active_persona_id;
    if (!avatar && typeof document !== 'undefined') {
        const selected = document.querySelector('#user_avatar_block .avatar-container.selected, #persona_container .avatar-container.selected, .persona_selected');
        if (selected) avatar = selected.getAttribute('data-avatar-id') || selected.dataset?.avatarId;
    }
    if (typeof avatar === 'object' && avatar !== null) {
        avatar = avatar.avatarId || avatar.avatar_id || avatar.user_avatar || avatar.userAvatar || avatar.id;
    }
    return { id: '__persona__', name: ctx.name1 || 'User', avatar: avatar || '', isPersona: true };
}

function _avatarUrl(entity) {
    const ctx = SillyTavern.getContext();
    try {
        if (entity.isPersona) {
            if (typeof ctx.getThumbnailUrl === 'function') return ctx.getThumbnailUrl('persona', entity.avatar);
            return `/User Avatars/${entity.avatar}`;
        }
        if (typeof ctx.getThumbnailUrl === 'function') return ctx.getThumbnailUrl('avatar', entity.avatar);
        return `/characters/${entity.avatar}`;
    } catch (_) { return ''; }
}

async function _calcTotalTokens(entity) {
    const apiMod = await import('../api.js');
    let text = '';
    if (entity.isPersona) {
        text = getUserPersona();
    } else {
        const fields = ['description', 'personality', 'scenario', 'first_mes', 'mes_example', 'system_prompt', 'post_history_instructions'];
        text = fields.map(f => String(getCharFieldValue(entity.char, f) || '')).join('\n');
    }
    return apiMod.estimateTokens(text);
}

// ─── List ─────────────────────────────────────────────────────────────────────

function _buildCharListRow(entity, s) {
    const row = document.createElement('div');
    row.className = 'scp-char-row';
    row.dataset.id = entity.id;

    const avatarImg = document.createElement('img');
    avatarImg.className = 'scp-char-row-avatar';
    avatarImg.src = _avatarUrl(entity);
    avatarImg.onerror = () => { avatarImg.style.visibility = 'hidden'; };

    const name = document.createElement('span');
    name.className = 'scp-char-row-name';
    name.textContent = entity.name;

    row.appendChild(avatarImg);
    row.appendChild(name);

    if (entity.isPersona) {
        const lock = document.createElement('span');
        lock.className = 'scp-char-row-lock';
        lock.innerHTML = I.lock;
        lock.title = 'Adding Persona to context is managed in global settings.';
        row.appendChild(lock);
    } else {
        const cb = document.createElement('div');
        cb.className = `scp-char-row-cb${isCharacterExcluded(s, entity.id) ? '' : ' checked'}`;
        cb.title = 'Include this character in AI context';
        cb.addEventListener('click', e => {
            e.stopPropagation();
            const wasIncluded = cb.classList.contains('checked');
            setCharacterExcluded(getSettings(), entity.id, wasIncluded);
            saveSettings();
            cb.classList.toggle('checked', !wasIncluded);
        });
        row.appendChild(cb);
    }

    row.addEventListener('click', () => _selectEntity(entity));
    return row;
}

function _selectEntity(entity) {
    if (_selectedEntityId === entity.id) return;

    const doSelect = () => {
        _lastScrollTop = 0;
        _selectedEntityId = entity.id;
        document.querySelectorAll('#scp-char-list .scp-char-row').forEach(r => r.classList.toggle('selected', r.dataset.id === entity.id));
        _renderCharDetail(entity);
    };

    if (_currentIsDirty && _currentSaveFn) {
        _showUnsavedDialog(
            async () => {
                const ok = await _currentSaveFn();
                if (ok !== false) doSelect();
            },
            () => doSelect()
        );
    } else {
        doSelect();
    }
}

function _renderCharList() {
    const listEl = document.getElementById('scp-char-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    const s = getSettings();
    const personaEntity = _getPersonaEntity();
    const charEntities = getActiveCharacterEntities();

    const frag = document.createDocumentFragment();
    frag.appendChild(_buildCharListRow(personaEntity, s));
    charEntities.forEach(ent => frag.appendChild(_buildCharListRow(ent, s)));
    listEl.appendChild(frag);

    if (!charEntities.length) {
        const empty = document.createElement('div');
        empty.className = 'scp-char-list-empty';
        empty.textContent = 'No characters found in this chat.';
        listEl.appendChild(empty);
    }

    // Restore last selected entity or default to persona
    const allEntities = [personaEntity, ...charEntities];
    const lastEntity = _selectedEntityId ? allEntities.find(e => e.id === _selectedEntityId) : null;
    _selectEntity(lastEntity || personaEntity);
}

// ─── Banner ───────────────────────────────────────────────────────────────────

function _buildBanner(entity) {
    const banner = document.createElement('div');
    banner.className = 'scp-char-banner';
    banner.style.setProperty('--scp-char-banner-img', `url("${_avatarUrl(entity)}")`);

    const avatar = document.createElement('img');
    avatar.className = 'scp-char-banner-avatar';
    avatar.src = _avatarUrl(entity);
    avatar.onerror = () => { avatar.style.visibility = 'hidden'; };

    const info = document.createElement('div');
    info.className = 'scp-char-banner-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'scp-char-banner-name';
    nameEl.textContent = entity.name;
    const tokenEl = document.createElement('div');
    tokenEl.className = 'scp-char-banner-tokens';
    tokenEl.textContent = '~… tkns total';
    info.appendChild(nameEl);
    info.appendChild(tokenEl);

    banner.appendChild(avatar);
    banner.appendChild(info);

    _calcTotalTokens(entity).then(n => { if (tokenEl.isConnected) tokenEl.textContent = `~${n} tkns total`; });

    return banner;
}

// ─── Field Row ────────────────────────────────────────────────────────────────

function _buildFieldRow(fieldDef, getValueFn, onDirtyFn) {
    const row = document.createElement('div');
    row.className = 'scp-char-field-row';

    const labelRow = document.createElement('div');
    labelRow.className = 'scp-char-field-label-row';
    const label = document.createElement('span');
    label.className = 'scp-char-field-label';
    label.textContent = fieldDef.label;
    const tokenSpan = document.createElement('span');
    tokenSpan.className = 'scp-char-field-tokens';
    labelRow.appendChild(label);
    labelRow.appendChild(tokenSpan);
    row.appendChild(labelRow);

    const initialVal = String(getValueFn() || '');
    const input = document.createElement(fieldDef.multiline ? 'textarea' : 'input');
    if (fieldDef.multiline) { input.rows = 5; input.className = 'scp-char-field-textarea'; }
    else { input.type = 'text'; input.className = 'scp-char-field-input'; }
    input.value = initialVal;
    row.appendChild(input);

    const triggerExactCalc = async (text) => {
        try {
            const apiMod = await import('../api.js');
            const n = await apiMod.estimateTokens(text);
            if (tokenSpan.isConnected) tokenSpan.textContent = `[~${n} tkns]`;
        } catch (e) {
            if (tokenSpan.isConnected) tokenSpan.textContent = `[Error]`;
        }
    };

    triggerExactCalc(initialVal);

    let debounceId = null;
    input.addEventListener('input', () => {
        tokenSpan.textContent = `[...]`;
        if (onDirtyFn) onDirtyFn(input.value, initialVal);
        clearTimeout(debounceId);
        debounceId = setTimeout(() => triggerExactCalc(input.value), 600);
    });

    return row;
}

// ─── Current Info Tab ─────────────────────────────────────────────────────────

function _buildCurrentInfoTab(entity, saveBtn, revertBtn) {
    const pane = document.createElement('div');
    pane.className = 'scp-char-pane scp-char-pane-info';

    const groups = entity.isPersona
        ? [{ title: 'Identity', fields: [{ key: 'user_persona', label: 'Persona Description', multiline: true }] }]
        : FIELD_GROUPS;
    const charRef = entity.isPersona ? null : entity.char;
    const dirty = {};

    const updateBtns = () => {
        const has = Object.keys(dirty).length > 0;
        saveBtn.disabled = !has;
        revertBtn.disabled = !has;
        saveBtn.style.opacity = has ? '1' : '0.4';
        revertBtn.style.opacity = has ? '1' : '0.4';
        _currentIsDirty = has;
    };

    groups.forEach(group => {
        const section = document.createElement('div');
        section.className = 'scp-char-section';
        const h = document.createElement('div');
        h.className = 'scp-char-section-title';
        h.textContent = group.title;
        section.appendChild(h);
        group.fields.forEach(f => {
            section.appendChild(_buildFieldRow(f, () => getCharFieldValue(charRef, f.key), (val, initialVal) => {
                if (val === initialVal) {
                    delete dirty[f.key];
                } else {
                    dirty[f.key] = val;
                }
                updateBtns();
            }));
        });
        pane.appendChild(section);
    });

    // Expose save function at module level for close dialog
    _currentSaveFn = async () => {
        if (!Object.keys(dirty).length) return true;
        const origLabel = saveBtn.innerHTML;
        saveBtn.disabled = true;
        saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>Saving…</span>`;
        try {
            for (const [key, val] of Object.entries(dirty)) {
                await saveCharacterField(charRef, key, val);
                delete dirty[key];
            }
            _currentIsDirty = false;
            toastr.success('Saved.', EXT_DISPLAY);
            _renderCharDetail(entity);
            return true;
        } catch (e) {
            toastr.error(`Failed: ${e.message}`, EXT_DISPLAY);
            saveBtn.innerHTML = origLabel;
            updateBtns();
            return false;
        }
    };

    saveBtn.addEventListener('click', async () => {
        if (saveBtn.disabled) return;
        await _currentSaveFn();
    });

    revertBtn.addEventListener('click', () => {
        for (const key of Object.keys(dirty)) delete dirty[key];
        _currentIsDirty = false;
        _renderCharDetail(entity);
    });

    return pane;
}

// ─── Overrides Tab ────────────────────────────────────────────────────────────

function _buildOverrideRow(entity, fieldDef) {
    const row = document.createElement('div');
    row.className = 'scp-char-ov-row';

    const label = document.createElement('label');
    label.className = 'scp-sp-check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    const span = document.createElement('span');
    span.textContent = fieldDef.label;
    label.appendChild(cb);
    label.appendChild(span);

    const resetBtn = document.createElement('button');
    resetBtn.className = 'scp-sp-ov-clear';
    resetBtn.title = 'Clear override';
    resetBtn.textContent = '↺';

    const refresh = () => {
        const s = getSettings();
        let ov = getCharFieldOverride(s, entity.id, fieldDef.key);
        const globalDefault = getEffectiveCharField(s, fieldDef.key);
        
        if (ov !== undefined && ov === globalDefault) {
            setCharFieldOverride(s, entity.id, fieldDef.key, undefined);
            saveSettings();
            ov = undefined;
        }
        
        const hasOv = ov !== undefined;
        cb.checked = hasOv ? ov : globalDefault;
        row.classList.toggle('scp-char-ov-row-active', hasOv);
        resetBtn.disabled = !hasOv;
        resetBtn.classList.toggle('active', hasOv);
    };
    refresh();
    
    row._refreshOverride = refresh;

    cb.addEventListener('change', () => {
        const s = getSettings();
        const globalDefault = getEffectiveCharField(s, fieldDef.key);
        if (cb.checked === globalDefault) {
            setCharFieldOverride(s, entity.id, fieldDef.key, undefined);
        } else {
            setCharFieldOverride(s, entity.id, fieldDef.key, cb.checked);
        }
        saveSettings();
        refresh();
    });

    resetBtn.addEventListener('click', () => {
        setCharFieldOverride(getSettings(), entity.id, fieldDef.key, undefined);
        saveSettings();
        refresh();
    });

    row.appendChild(label);
    row.appendChild(resetBtn);
    return row;
}

function _buildOverridesTab(entity) {
    const pane = document.createElement('div');
    pane.className = 'scp-char-pane scp-char-pane-overrides';

    const hint = document.createElement('div');
    hint.className = 'scp-char-ov-hint';
    hint.textContent = `Override which fields of ${entity.name} are sent to AI context. Unchecked falls back to global settings.`;
    pane.appendChild(hint);

    OV_FIELDS.forEach(f => pane.appendChild(_buildOverrideRow(entity, f)));
    return pane;
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function _renderCharDetail(entity) {
    const main = document.getElementById('scp-char-main');
    if (!main) return;
    main.innerHTML = '';

    // Reset dirty state for new entity render
    _currentIsDirty = false;
    _currentSaveFn = null;

    const banner = _buildBanner(entity);
    main.appendChild(banner);

    // Action buttons in banner top-right
    const bannerActions = document.createElement('div');
    bannerActions.className = 'scp-char-banner-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'scp-action-btn scp-char-banner-save-btn';
    saveBtn.innerHTML = `${I.check}<span>Save</span>`;
    saveBtn.disabled = true;
    saveBtn.style.opacity = '0.4';

    const revertBtn = document.createElement('button');
    revertBtn.className = 'scp-action-btn';
    revertBtn.innerHTML = `${I.x}<span>Revert</span>`;
    revertBtn.disabled = true;
    revertBtn.style.opacity = '0.4';

    bannerActions.appendChild(saveBtn);
    bannerActions.appendChild(revertBtn);
    banner.appendChild(bannerActions);

    const tabs = document.createElement('div');
    tabs.className = 'scp-char-tabs';
    const tabInfo = document.createElement('button');
    tabInfo.className = 'scp-char-tab active';
    tabInfo.textContent = 'Current Info';
    const tabOv = document.createElement('button');
    tabOv.className = 'scp-char-tab';
    tabOv.textContent = 'Overrides';
    tabOv.disabled = entity.isPersona;
    tabs.appendChild(tabInfo);
    tabs.appendChild(tabOv);
    main.appendChild(tabs);

    const paneInfo = _buildCurrentInfoTab(entity, saveBtn, revertBtn);
    const paneOv = entity.isPersona ? null : _buildOverridesTab(entity);
    main.appendChild(paneInfo);
    if (paneOv) { paneOv.style.display = 'none'; main.appendChild(paneOv); }

    const showInfoTab = () => {
        tabInfo.classList.add('active'); tabOv.classList.remove('active');
        paneInfo.style.display = ''; if (paneOv) paneOv.style.display = 'none';
        bannerActions.style.display = 'flex';
        _lastActiveTab = 'info';
    };
    const showOvTab = () => {
        if (entity.isPersona) return;
        tabOv.classList.add('active'); tabInfo.classList.remove('active');
        paneInfo.style.display = 'none'; paneOv.style.display = '';
        bannerActions.style.display = 'none';
        _lastActiveTab = 'overrides';
    };

    tabInfo.addEventListener('click', showInfoTab);
    tabOv.addEventListener('click', showOvTab);

    // Restore last active tab
    if (_lastActiveTab === 'overrides' && !entity.isPersona) {
        showOvTab();
    }

    // Restore scroll position after layout
    requestAnimationFrame(() => { main.scrollTop = _lastScrollTop; });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function openCharacterManager() {
    const overlay = document.getElementById('scp-char-overlay');
    if (!overlay) return;

    // Move panel inside copilot window for inline display
    const win = document.getElementById('scp-window');
    if (win && overlay.parentElement !== win) {
        win.appendChild(overlay);
    }

    applyCustomTheme(getSettings().customTheme || THEME_PRESETS.default);
    _renderCharList();
    overlay.style.display = 'flex';
    bringWindowToFront();
}

export async function closeCharacterManager() {
    const overlay = document.getElementById('scp-char-overlay');
    if (!overlay) return;

    // Save scroll position before close
    const mainEl = document.getElementById('scp-char-main');
    if (mainEl) _lastScrollTop = mainEl.scrollTop;

    if (_currentIsDirty && _currentSaveFn) {
        _showUnsavedDialog(
            async () => {
                const ok = await _currentSaveFn();
                if (ok !== false) {
                    _currentIsDirty = false; _currentSaveFn = null;
                    overlay.style.display = 'none';
                }
            },
            () => {
                _currentIsDirty = false; _currentSaveFn = null;
                overlay.style.display = 'none';
            }
        );
        return;
    }

    _currentIsDirty = false;
    _currentSaveFn = null;
    overlay.style.display = 'none';
}

export function setupCharacterManagerListeners() {
    const overlay = document.getElementById('scp-char-overlay');
    if (!overlay) return;
    let _mouseDownTarget = null;
    overlay.addEventListener('mousedown', e => { _mouseDownTarget = e.target; });
    overlay.addEventListener('click', e => { if (e.target === overlay && _mouseDownTarget === overlay) closeCharacterManager(); });
    document.getElementById('scp-char-close')?.addEventListener('click', () => closeCharacterManager());
}