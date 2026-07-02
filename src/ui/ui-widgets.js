import { CHANGELOG, EXT_DISPLAY, I, DEFAULT_CHAR_EDIT_DIRECTIVE, DEFAULT_LB_MANAGE_PROMPT, DEFAULT_CHAT_EDIT_DIRECTIVE, QP_ICON_POOL } from '../constants.js';
import { getSettings, saveSettings, getCurrentSession, getBindingKey, isMessageStarred, toggleStarMessage, getStarredMessages } from '../session.js';
import { escHtml, showCustomDialog, copyText, autoResize } from '../utils/util-dom.js';
import { _dbgAdd } from '../utils/util-debug.js';
import { recordStat, SM } from '../features/feature-stats.js';
import { _processAttachmentsBeforeSend } from '../features/feature-attachments.js';
import { assembleMessages } from '../api.js';
import { state } from '../state.js';

// ─── Quick Prompts ───────────────────────────────────────────────────────────

export function renderQuickPromptsBar() {
    const bar = document.getElementById('scp-qp-bar');
    const toggleBtn = document.getElementById('scp-qp-toggle-btn');
    if (!bar) return;
    const s = getSettings();
    const prompts = s.quickPrompts || [];
    const visible = s.quickPromptsVisible && prompts.length > 0;

    bar.innerHTML = '';
    for (const qp of prompts) {
        const btn = document.createElement('button');
        btn.className = 'scp-qp-chip';
        const truncTitle = qp.text.length > 100 ? qp.text.slice(0, 100) + '…' : qp.text;
        btn.title = truncTitle;
        btn.innerHTML = `<span class="scp-qp-icon">${escHtml(qp.icon || '⚡')}</span><span class="scp-qp-label">${escHtml(qp.label || '')}</span>`;
        btn.addEventListener('click', () => {
            const input = document.getElementById('scp-input');
            if (!input) return;
            input.value = qp.text;
            autoResize(input);
            input.focus();
            recordStat(SM.qp);
        });
        bar.appendChild(btn);
    }

    if (visible) {
        bar.classList.add('scp-qp-bar--open');
    } else {
        bar.classList.remove('scp-qp-bar--open');
    }
    if (toggleBtn) toggleBtn.classList.toggle('active', s.quickPromptsVisible);
}

let _qpIconPickerEl = null;

export function showQPIconPicker(anchorEl, currentIcon, onSelect) {
    if (_qpIconPickerEl && _qpIconPickerEl.__anchor === anchorEl) { 
        _qpIconPickerEl.remove(); 
        _qpIconPickerEl = null; 
        return; 
    }
    if (_qpIconPickerEl) { _qpIconPickerEl.remove(); _qpIconPickerEl = null; }
    
    const pop = document.createElement('div');
    pop.className = 'scp-qp-icon-picker';
    pop.__anchor = anchorEl;

    for (const emoji of QP_ICON_POOL) {
        const btn = document.createElement('button');
        btn.className = `scp-qp-icon-option${emoji === currentIcon ? ' active' : ''}`;
        btn.textContent = emoji;
        btn.addEventListener('click', () => { onSelect(emoji); pop.remove(); _qpIconPickerEl = null; });
        pop.appendChild(btn);
    }
    document.body.appendChild(pop);
    _qpIconPickerEl = pop;
    const rect = anchorEl.getBoundingClientRect();
    pop.style.cssText = `position:fixed;z-index:2147483060;top:${rect.bottom + 4}px;left:${rect.left}px`;
    requestAnimationFrame(() => {
        const pr = pop.getBoundingClientRect();
        if (pr.right > window.innerWidth - 8) pop.style.left = `${window.innerWidth - pr.width - 8}px`;
        if (pr.bottom > window.innerHeight - 8) pop.style.top = `${rect.top - pr.height - 6}px`;
    });
    const onOut = e => {
        if (!pop.contains(e.target) && e.target !== anchorEl) {
            pop.remove(); _qpIconPickerEl = null;
            document.removeEventListener('mousedown', onOut, true);
        }
    };
    setTimeout(() => document.addEventListener('mousedown', onOut, true), 0);
}

// ─── Preset Dropdown ───────────────────────────────────────────

let _activePresetPanel = null;

export function openPresetDropdown(triggerEl, groups, onSelect, opts = {}) {
    const { placeholder = 'Search…', width = 320, emptyText = 'Nothing here' } = opts;

    if (_activePresetPanel) {
        _activePresetPanel.remove();
        _activePresetPanel = null;
        triggerEl.classList.remove('open');
        return;
    }

    triggerEl.classList.add('open');

    const panel = document.createElement('div');
    panel.className = 'scp-pdd-panel';
    panel.style.width = `${width}px`;
    _activePresetPanel = panel;

    const allItems = groups.flatMap(g => g.items);

    if (allItems.length > 6) {
        const sw = document.createElement('div');
        sw.className = 'scp-pdd-search-wrap';
        const si = document.createElement('input');
        si.type = 'text'; si.placeholder = placeholder;
        si.className = 'scp-pdd-search';
        si.addEventListener('input', () => renderContent(si.value.trim().toLowerCase()));
        sw.appendChild(si);
        panel.appendChild(sw);
        setTimeout(() => si.focus(), 60);
    }

    const listEl = document.createElement('div');
    listEl.className = 'scp-pdd-list';
    panel.appendChild(listEl);

    const renderContent = (q = '') => {
        listEl.innerHTML = '';
        let totalShown = 0;
        groups.forEach(group => {
            const filtered = q
                ? group.items.filter(it => it.name.toLowerCase().includes(q) || (it.preview || '').toLowerCase().includes(q))
                : group.items;
            if (!filtered.length) return;
            totalShown += filtered.length;
            if (group.label) {
                const hdr = document.createElement('div');
                hdr.className = 'scp-pdd-group-label';
                hdr.textContent = group.label;
                listEl.appendChild(hdr);
            }
            filtered.forEach(item => {
                const row = document.createElement('div');
                row.className = 'scp-pdd-item';
                const top = document.createElement('div');
                top.className = 'scp-pdd-item-top';
                const name = document.createElement('span');
                name.className = 'scp-pdd-item-name';
                name.textContent = item.name;
                top.appendChild(name);
                if (item.badge) {
                    const b = document.createElement('span');
                    b.className = `scp-pdd-badge scp-pdd-badge--${item.badge}`;
                    b.textContent = item.badge;
                    top.appendChild(b);
                }
                row.appendChild(top);
                if (item.preview) {
                    const prev = document.createElement('div');
                    prev.className = 'scp-pdd-item-preview';
                    prev.textContent = item.preview;
                    row.appendChild(prev);
                }
                row.addEventListener('click', () => {
                    onSelect(item.value, item.name, item);
                    closePresetPanel();
                });
                listEl.appendChild(row);
            });
        });
        if (!totalShown) {
            const empty = document.createElement('div');
            empty.className = 'scp-pdd-empty';
            empty.textContent = q ? 'No results' : emptyText;
            listEl.appendChild(empty);
        }
    };

    renderContent();
    document.body.appendChild(panel);

    const rect = triggerEl.getBoundingClientRect();
    panel.style.cssText += `;position:fixed;z-index:2147483060;top:${rect.bottom + 5}px;left:${rect.left}px;max-width:calc(100vw - 16px)`;
    requestAnimationFrame(() => {
        const pr = panel.getBoundingClientRect();
        if (pr.right > window.innerWidth - 8) panel.style.left = `${window.innerWidth - pr.width - 8}px`;
        if (pr.bottom > window.innerHeight - 8) panel.style.top = `${rect.top - pr.height - 5}px`;
    });

    setTimeout(() => {
        const onOut = e => {
            if (!panel.contains(e.target) && e.target !== triggerEl) {
                closePresetPanel();
                document.removeEventListener('mousedown', onOut, true);
            }
        };
        document.addEventListener('mousedown', onOut, true);
    }, 0);
}

export function closePresetPanel() {
    if (_activePresetPanel) { _activePresetPanel.remove(); _activePresetPanel = null; }
    document.querySelectorAll('.scp-pdd-trigger.open, .scp-preset-mgr-trigger.open')
        .forEach(el => el.classList.remove('open'));
}

export function buildPromptPresetManager(containerEl, getTextFn, setTextFn, dictKey = 'promptPresets') {
    if (!containerEl) return;
    containerEl.innerHTML = '';
    const s = getSettings();
    if (!s[dictKey]) s[dictKey] = {};

    let _activeName = '';
    let _activeSource = '';

    const bar = document.createElement('div');
    bar.className = 'scp-preset-mgr-bar';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'scp-preset-mgr-trigger';
    trigger.innerHTML = `<span class="scp-pmt-label">Select a preset…</span><svg class="scp-pmt-chevron" xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>`;

    const labelEl = trigger.querySelector('.scp-pmt-label');

    const setActive = (name, source) => {
        _activeName = name;
        _activeSource = source;
        labelEl.textContent = name || 'Select a preset…';
        trigger.classList.toggle('scp-pmt--has-value', !!name);
        updateBtnStates();
    };

    const buildGroups = () => {
        const groups = [];
        const profileItems = Object.keys(s.profiles || {})
            .filter(n => s.profiles[n].systemPrompt)
            .map(n => ({
                name: n,
                value: s.profiles[n].systemPrompt,
                preview: (s.profiles[n].systemPrompt || '').replace(/\s+/g, ' ').slice(0, 80),
                badge: 'profile',
                _source: 'profile',
            }));
        if (profileItems.length) groups.push({ label: 'From Profiles', items: profileItems });

        const customItems = Object.keys(s[dictKey])
            .map(n => ({
                name: n,
                value: s[dictKey][n],
                preview: (s[dictKey][n] || '').replace(/\s+/g, ' ').slice(0, 80),
                badge: 'custom',
                _source: 'custom',
            }));
        if (customItems.length) groups.push({ label: 'Custom Presets', items: customItems });
        return groups;
    };

    trigger.addEventListener('click', () => {
        const groups = buildGroups();
        openPresetDropdown(trigger, groups, (value, name, item) => {
            setTextFn(value);
            setActive(name, item._source || 'custom');
        }, { placeholder: 'Search presets…', width: 360, emptyText: 'No presets saved yet' });
    });

    const mkBtn = (icon, title, cls, cb) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `scp-preset-mgr-btn${cls ? ' ' + cls : ''}`;
        b.title = title;
        b.innerHTML = `<i class="fa-solid fa-${icon}"></i>`;
        b.addEventListener('click', cb);
        return b;
    };

    const saveBtn = mkBtn('floppy-disk', 'Save preset', '', async () => {
        if (_activeName && _activeSource === 'custom') {
            s[dictKey][_activeName] = getTextFn();
            saveSettings();
            toastr.success(`Saved preset "${escHtml(_activeName)}"`, EXT_DISPLAY);
        } else {
            const name = await showCustomDialog({ type: 'prompt', title: 'Save Prompt Preset', message: 'Preset name:', placeholder: 'My Preset' });
            if (!name?.trim()) return;
            s[dictKey][name.trim()] = getTextFn();
            saveSettings();
            setActive(name.trim(), 'custom');
            toastr.success(`Saved preset "${escHtml(name.trim())}"`, EXT_DISPLAY);
        }
    });

    const renameBtn = mkBtn('pen', 'Rename selected custom preset', '', async () => {
        if (!_activeName || _activeSource !== 'custom') { toastr.info('Select a custom preset first.', EXT_DISPLAY); return; }
        const newName = await showCustomDialog({ type: 'prompt', title: 'Rename Preset', message: 'New name:', defaultValue: _activeName });
        if (!newName?.trim() || newName.trim() === _activeName) return;
        s[dictKey][newName.trim()] = s[dictKey][_activeName];
        delete s[dictKey][_activeName];
        saveSettings();
        setActive(newName.trim(), 'custom');
    });

    const deleteBtn = mkBtn('trash', 'Delete selected custom preset', 'danger', async () => {
        if (!_activeName || _activeSource !== 'custom') { toastr.info('Only custom presets can be deleted.', EXT_DISPLAY); return; }
        const ok = await showCustomDialog({ type: 'confirm', title: 'Delete Preset', message: `Delete "${_activeName}"?` });
        if (!ok) return;
        delete s[dictKey][_activeName];
        saveSettings();
        setActive('', '');
    });

    const updateBtnStates = () => {
        const isCustom = !!_activeName && _activeSource === 'custom';
        renameBtn.disabled = !isCustom;
        deleteBtn.disabled = !isCustom;
        renameBtn.style.opacity = isCustom ? '1' : '0.35';
        deleteBtn.style.opacity = isCustom ? '1' : '0.35';
    };
    updateBtnStates();

    bar.appendChild(trigger);
    bar.appendChild(saveBtn);
    bar.appendChild(renameBtn);
    bar.appendChild(deleteBtn);
    containerEl.appendChild(bar);
}

export function buildQPSetManager(containerEl, onSetLoaded) {
    if (!containerEl) return;
    containerEl.innerHTML = '';
    const s = getSettings();
    if (!s.quickPromptSets) s.quickPromptSets = {};

    let _activeName = s.activeQuickPromptSet || '';

    const bar = document.createElement('div');
    bar.className = 'scp-preset-mgr-bar';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'scp-preset-mgr-trigger';
    const getLabel = name => {
        if (!name) return 'Select a set…';
        const count = (s.quickPromptSets[name] || []).length;
        return `${name}  (${count})`;
    };
    trigger.innerHTML = `<span class="scp-pmt-label">${escHtml(getLabel(_activeName))}</span><svg class="scp-pmt-chevron" xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>`;

    const labelEl = trigger.querySelector('.scp-pmt-label');

    const setActive = name => {
        _activeName = name;
        labelEl.textContent = getLabel(name);
        trigger.classList.toggle('scp-pmt--has-value', !!name);
        updateBtnStates();
    };

    const buildGroups = () => {
        const items = Object.keys(s.quickPromptSets).map(name => ({
            name,
            value: name,
            preview: `${(s.quickPromptSets[name] || []).length} prompts: ` +
                (s.quickPromptSets[name] || []).map(q => `${q.icon || '⚡'} ${q.label}`).join(', ').slice(0, 80),
            badge: name === s.activeQuickPromptSet ? 'active' : null,
        }));
        return [{ label: items.length ? 'Saved Sets' : null, items }];
    };

    trigger.addEventListener('click', () => {
        openPresetDropdown(trigger, buildGroups(), (value) => {
            if (!s.quickPromptSets[value]) return;
            s.quickPrompts = JSON.parse(JSON.stringify(s.quickPromptSets[value]));
            s.activeQuickPromptSet = value;
            saveSettings();
            setActive(value);
            renderQuickPromptsBar();
            if (onSetLoaded) onSetLoaded();
            toastr.success(`Loaded set "${escHtml(value)}"`, EXT_DISPLAY);
        }, { placeholder: 'Search sets…', width: 340, emptyText: 'No sets saved yet. Save one below.' });
    });

    const mkBtn = (icon, title, cls, cb) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `scp-preset-mgr-btn${cls ? ' ' + cls : ''}`;
        b.title = title;
        b.innerHTML = `<i class="fa-solid fa-${icon}"></i>`;
        b.addEventListener('click', cb);
        return b;
    };

    const saveBtn = mkBtn('floppy-disk', 'Save current prompts to active set (or new)', '', async () => {
        let name = _activeName;
        if (!name) {
            name = await showCustomDialog({ type: 'prompt', title: 'Save Prompt Set', message: 'Set name:', placeholder: 'My Set' });
            if (!name?.trim()) return;
            name = name.trim();
        }
        s.quickPromptSets[name] = JSON.parse(JSON.stringify(s.quickPrompts));
        s.activeQuickPromptSet = name;
        saveSettings();
        setActive(name);
        toastr.success(`Saved set "${escHtml(name)}"`, EXT_DISPLAY);
    });

    const saveAsBtn = mkBtn('plus', 'Save current prompts as a new set', '', async () => {
        const name = await showCustomDialog({ type: 'prompt', title: 'New Prompt Set', message: 'Set name:', placeholder: 'My New Set' });
        if (!name?.trim()) return;
        const n = name.trim();
        s.quickPromptSets[n] = JSON.parse(JSON.stringify(s.quickPrompts));
        s.activeQuickPromptSet = n;
        saveSettings();
        setActive(n);
        toastr.success(`Created set "${escHtml(n)}"`, EXT_DISPLAY);
    });

    const renameBtn = mkBtn('pen', 'Rename selected set', '', async () => {
        if (!_activeName) { toastr.info('Select a set first.', EXT_DISPLAY); return; }
        const newName = await showCustomDialog({ type: 'prompt', title: 'Rename Set', message: 'New name:', defaultValue: _activeName });
        if (!newName?.trim() || newName.trim() === _activeName) return;
        const n = newName.trim();
        s.quickPromptSets[n] = s.quickPromptSets[_activeName];
        delete s.quickPromptSets[_activeName];
        if (s.activeQuickPromptSet === _activeName) s.activeQuickPromptSet = n;
        saveSettings();
        setActive(n);
    });

    const deleteBtn = mkBtn('trash', 'Delete selected set', 'danger', async () => {
        if (!_activeName) { toastr.info('Select a set first.', EXT_DISPLAY); return; }
        const ok = await showCustomDialog({ type: 'confirm', title: 'Delete Set', message: `Delete set "${_activeName}"?` });
        if (!ok) return;
        delete s.quickPromptSets[_activeName];
        if (s.activeQuickPromptSet === _activeName) s.activeQuickPromptSet = '';
        saveSettings();
        setActive('');
    });

    const updateBtnStates = () => {
        const has = !!_activeName;
        renameBtn.disabled = !has; renameBtn.style.opacity = has ? '1' : '0.35';
        deleteBtn.disabled = !has; deleteBtn.style.opacity = has ? '1' : '0.35';
    };
    updateBtnStates();

    bar.appendChild(trigger);
    bar.appendChild(saveBtn);
    bar.appendChild(saveAsBtn);
    bar.appendChild(renameBtn);
    bar.appendChild(deleteBtn);
    containerEl.appendChild(bar);
}

// ─── Sounds ─────────────────────────────────────────────────────────────

export const _SOUND_PRESETS = {
    none:    { label: 'None' },
    chime:   { label: 'Chime' },
    bell:    { label: 'Bell' },
    soft:    { label: 'Soft Ping' },
    digital: { label: 'Digital Blip' },
    pop:     { label: 'Pop' },
};

export function _synthSound(type, volume = 80) {
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

export function playCompletionSound(force = false) {
    const s = getSettings();
    const soundType = s.completionSound || 'none';
    const vol = s.completionSoundVolume ?? 80;
    if (soundType === 'none') return;
    if (!force && s.completionSoundOnlyWhenUnfocused && document.hasFocus()) return;

    if (soundType.startsWith('custom_') && s.customSounds && s.customSounds[soundType]) {
        try {
            const audio = new Audio(s.customSounds[soundType].data);
            audio.volume = vol / 100;
            audio.play().catch(() => {});
        } catch (_) {}
        return;
    }

    if (soundType === 'custom' && s.completionSoundData) {
        try {
            const audio = new Audio(s.completionSoundData);
            audio.volume = vol / 100;
            audio.play().catch(() => {});
        } catch (_) {}
        return;
    }
    
    if (_SOUND_PRESETS[soundType] && soundType !== 'none') {
        _synthSound(soundType, vol);
    }
}

// ─── Changelog ───────────────────────────────────────────────────────────────

export function buildChangelogHTML() {
    const current = CHANGELOG[0];
    const past = CHANGELOG.slice(1);

    const notesHTML = current.notes
        .map(n => `<li>${n}</li>`)
        .join('');

    let historyHTML = '';
    if (past.length) {
        historyHTML = `<div class="scp-cl-history">` +
            past.map(entry => {
                const li = (entry.notes || []).map(n => `<li>${n}</li>`).join('');
                return `<details class="scp-cl-entry">
                    <summary class="scp-cl-entry-summary">
                        <span class="scp-cl-entry-ver">v${escHtml(entry.version)}</span>
                        <span style="flex:1;opacity:.5">${escHtml(entry.date || '')}</span>
                    </summary>
                    <div class="scp-cl-entry-body"><ul>${li}</ul></div>
                </details>`;
            }).join('') +
            `</div>`;
    }

    return `<div class="scp-cl-current">
        <div class="scp-cl-version-badge">✦ Version ${escHtml(current.version)} ${current.date ? '· ' + escHtml(current.date) : ''}</div>
        <div class="scp-cl-notes"><ul>${notesHTML}</ul></div>
    </div>${historyHTML}`;
}

export function openChangelog() {
    const modal = document.getElementById('scp-changelog-modal');
    if (!modal) return;
    const body = document.getElementById('scp-changelog-body');
    if (body) body.innerHTML = buildChangelogHTML();
    modal.style.display = 'flex';
    import('./ui-window.js').then(m => m.bringWindowToFront());
}

export function closeChangelog() {
    const modal = document.getElementById('scp-changelog-modal');
    if (modal) modal.style.display = 'none';
}

export function checkChangelogAutoShow() {
    const s = getSettings();
    const current = CHANGELOG[0];
    const currentVersion = current?.version || '';
    if (s.changelogAutoShow && current?.announce !== false && s.lastSeenVersion !== currentVersion) {
        s.lastSeenVersion = currentVersion;
        saveSettings();
        setTimeout(openChangelog, 800);
    } else if (s.lastSeenVersion !== currentVersion) {
        s.lastSeenVersion = currentVersion;
        saveSettings();
    }
}

export function setupChangelogListeners() {
    const modal = document.getElementById('scp-changelog-modal');
    if (!modal) return;
    document.getElementById('scp-changelog-close')?.addEventListener('click', closeChangelog);
    let _mdTarget = null;
    modal.addEventListener('mousedown', e => { _mdTarget = e.target; });
    modal.addEventListener('click', e => { if (e.target === modal && _mdTarget === modal) closeChangelog(); });
}

export function renderFavoritesPanel() {
    const listEl = document.getElementById('scp-fav-list');
    const emptyEl = document.getElementById('scp-fav-empty');
    if (!listEl) return;

    const starredIds = getStarredMessages();
    const session = getCurrentSession();
    const starred = session.messages.filter(m => starredIds.includes(m.id));

    listEl.querySelectorAll('.scp-fav-item').forEach(el => el.remove());

    if (!starred.length) {
        if (emptyEl) emptyEl.style.display = '';
        return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    const frag = document.createDocumentFragment();
    starred.forEach(msg => {
        const item = document.createElement('div');
        item.className = 'scp-fav-item';
        item.dataset.msgId = msg.id;

        const raw = msg.content.replace(/```[\s\S]*?```/g, '[code]').replace(/<[^>]+>/g, '').trim();
        const preview = raw.length > 140 ? raw.slice(0, 140) + '…' : raw;
        const roleLabel = msg.role === 'user' ? 'User' : 'Copilot';
        const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        item.innerHTML = `
            <span class="scp-fav-item-icon">${I.starFill}</span>
            <div class="scp-fav-item-body">
                <div class="scp-fav-item-meta">
                    <span class="scp-fav-item-role">${escHtml(roleLabel)}</span>
                    <span>${escHtml(time)}</span>
                </div>
                <div class="scp-fav-item-text">${escHtml(preview)}</div>
            </div>
            <button class="scp-fav-item-remove" title="Remove from starred">✕</button>`;

        item.addEventListener('click', e => {
            if (e.target.classList.contains('scp-fav-item-remove')) return;
            closeFavoritesPanel();
            const msgEl = document.querySelector(`.scp-msg[data-id="${msg.id}"]`);
            if (!msgEl) return;
            msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            requestAnimationFrame(() => {
                msgEl.classList.remove('scp-msg-flash');
                void msgEl.offsetWidth;
                msgEl.classList.add('scp-msg-flash');
                msgEl.addEventListener('animationend', () => msgEl.classList.remove('scp-msg-flash'), { once: true });
            });
        });

        item.querySelector('.scp-fav-item-remove').addEventListener('click', e => {
            e.stopPropagation();
            toggleStarMessage(msg.id);
            const msgEl = document.querySelector(`.scp-msg[data-id="${msg.id}"]`);
            if (msgEl) {
                msgEl.classList.remove('scp-msg-starred');
                const btn = msgEl.querySelector('.scp-msg-btn-star');
                if (btn) { btn.classList.remove('starred'); btn.title = 'Star message'; }
            }
            renderFavoritesPanel();
        });

        frag.appendChild(item);
    });
    listEl.appendChild(frag);
}

export function openFavoritesPanel() {
    const panel = document.getElementById('scp-fav-panel');
    const btn = document.getElementById('scp-fav-btn');
    if (!panel) return;
    renderFavoritesPanel();
    panel.style.display = 'flex';
    btn?.classList.add('active');
}

export function closeFavoritesPanel() {
    const panel = document.getElementById('scp-fav-panel');
    const btn = document.getElementById('scp-fav-btn');
    if (panel) panel.style.display = 'none';
    btn?.classList.remove('active');
}

// ─── Context Inspector ──────────────────────────────────────────────────────

export function _highlightContextText(raw) {
    const masterRe = /(```[\s\S]*?(?:```|$))|(`[^`\n]*`)|(<\/?([\w:{}_-]+)[^>]*>|<!--[\s\S]*?-->)|(\{\{[^}\n]+\}\})/gi;
    
    let m;
    masterRe.lastIndex = 0;
    let tempEvents = [];
    while ((m = masterRe.exec(raw)) !== null) {
        if (m[1] !== undefined) tempEvents.push({ start: m.index, end: masterRe.lastIndex, type: 'code_block', match: m[1] });
        else if (m[2] !== undefined) tempEvents.push({ start: m.index, end: masterRe.lastIndex, type: 'inline_code', match: m[2] });
        else if (m[3] !== undefined) tempEvents.push({ start: m.index, end: masterRe.lastIndex, type: 'tag', match: m[3], tagName: m[4] });
        else if (m[5] !== undefined) tempEvents.push({ start: m.index, end: masterRe.lastIndex, type: 'macro', match: m[5] });
    }

    const openStacks = {};
    const validTags = new Set();

    for (let i = 0; i < tempEvents.length; i++) {
        const ev = tempEvents[i];
        if (ev.type === 'tag') {
            const match = ev.match;
            if (match.startsWith('<!--') || match.endsWith('/>')) {
                validTags.add(ev.start);
            } else {
                const isClose = match.startsWith('</');
                const tagName = ev.tagName;
                if (!tagName) continue;

                if (isClose) {
                    if (openStacks[tagName] && openStacks[tagName].length > 0) {
                        const openEvIndex = openStacks[tagName].pop();
                        validTags.add(tempEvents[openEvIndex].start);
                        validTags.add(ev.start);
                    }
                } else {
                    if (!openStacks[tagName]) openStacks[tagName] = [];
                    openStacks[tagName].push(i);
                }
            }
        }
    }

    const events = [];
    for (const ev of tempEvents) {
        if (ev.type === 'tag' && !validTags.has(ev.start)) continue;
        events.push([ev.start, ev.end, ev.type, ev.match, ev.tagName]);
    }

    let html = '', last = 0;
    const KNOWN = new Set(['system_prompt','character_information','characters','character','lorebook_context','st_system_prompt','persistent_memory','summary_context','lorebook_management','character_management','chat_messages_editing','roleplay_context','entity_definitions','persona_configuration','operational_guidelines','{{user}}_persona', 'tool_calls_system', 'memory_system']);
    let currentDepth = 0;
    let emittedAnchors = new Set();

    for (const [start, end, type, match, tagName] of events) {
        if (start < last) continue;
        html += escHtml(raw.slice(last, start));
        
        if (type === 'tag') {
            const isClose = match.startsWith('</');
            const isSelfClose = match.endsWith('/>');
            const isComment = match.startsWith('<!--');

            let applyDepth;
            if (isComment || isSelfClose) {
                applyDepth = currentDepth;
            } else if (isClose) {
                currentDepth = Math.max(0, currentDepth - 1);
                applyDepth = currentDepth;
            } else {
                applyDepth = currentDepth;
                currentDepth++;
            }

            if (!isClose && !isComment && !isSelfClose && tagName) {
                if (KNOWN.has(tagName) || tagName.endsWith('_persona')) {
                    if (!emittedAnchors.has(tagName)) {
                        emittedAnchors.add(tagName);
                        html += `<span id="scp-ctx-sec-${tagName}" class="scp-ctx-anchor"></span>`;
                    }
                }
            }
            
            const depthClass = Math.min(applyDepth, 5);
            html += `<span class="scp-ctx-hl-tag scp-ctx-hl-tag-d${depthClass}">${escHtml(match)}</span>`;
        } else if (type === 'macro') {
            html += `<span class="scp-ctx-hl-macro">${escHtml(match)}</span>`;
        } else if (type === 'code_block' || type === 'inline_code') {
            html += escHtml(match);
        }
        last = end;
    }
    html += escHtml(raw.slice(last));
    return html;
}

export function _buildContextInspectorHTML(messages) {
    const SECTION_LABELS = {
        'system_prompt': 'System Prompt', 
        'persistent_memory': 'Persistent Memory',
        'lorebook_context': 'Lorebook', 
        'characters': 'Characters',
        '{{user}}_persona': 'User Persona',
        'memory_system': 'Memory Management',
        'lorebook_management': 'Lorebook Management',
        'character_management': 'Character Management',
        'chat_messages_editing': 'Chat Management',
        'tool_calls_system': 'Tool Calls'
    };
    const KNOWN_SECS = new Set(Object.keys(SECTION_LABELS));
    const ALIASES = {
        'character_information': 'characters',
        'character': 'characters'
    };
    const DISPLAY_ORDER = [
        'system_prompt',
        'persistent_memory',
        'lorebook_context',
        'characters',
        '{{user}}_persona',
        'memory_system',
        'lorebook_management',
        'character_management',
        'chat_messages_editing',
        'tool_calls_system'
    ];

    let navHtml = '', bodyHtml = '';
    let seenSections = new Set();
    
    messages.forEach((msg, idx) => {
        let raw = Array.isArray(msg.content)
            ? msg.content.map(p => p.type === 'text' ? p.text : '[Image]').join('\n')
            : (msg.content || '');

        let displayRole = msg.role;
        if (msg.role === 'user' && raw.includes('"type": "system_notification"')) {
            displayRole = 'system';
        }

        const LABELS = { system:'■ SYSTEM', user:'▶ USER', assistant:'◀ ASSISTANT' };
        const label = (LABELS[displayRole] || displayRole) + (idx > 0 ? ` #${idx}` : '');
        const blockId = `scp-ctx-b${idx}`;

        navHtml += `<button class="scp-ctx-nav-btn scp-ctx-nav-${displayRole}" data-t="${blockId}">${escHtml(label)}</button>`;

        if (msg.role === 'system') {
            const tagRe = /<([\w:{}_-]+)[^>]*>/g;
            let tm;
            tagRe.lastIndex = 0;
            let foundMain = [];
            let foundModules = [];

            while ((tm = tagRe.exec(raw)) !== null) {
                let rawTag = tm[1];
                let tag = ALIASES[rawTag] ? ALIASES[rawTag] : rawTag;
                
                const isUserPersona = tag === '{{user}}_persona' || tag.endsWith('_persona');
                const key = isUserPersona ? '{{user}}_persona' : tag;

                if ((KNOWN_SECS.has(key) || isUserPersona) && !seenSections.has(key)) {
                    seenSections.add(key);
                    const secLabel = SECTION_LABELS[key] || (isUserPersona ? 'User Persona' : key);
                    const secId = `scp-ctx-sec-${rawTag}`;
                    
                    if (['memory_system','lorebook_management','character_management','chat_messages_editing', 'tool_calls_system'].includes(key)) {
                        foundModules.push({ key, id: secId, label: secLabel });
                    } else {
                        foundMain.push({ key, id: secId, label: secLabel });
                    }
                }
            }

            const sortFn = (a, b) => {
                let idxA = DISPLAY_ORDER.indexOf(a.key);
                let idxB = DISPLAY_ORDER.indexOf(b.key);
                if (idxA === -1) idxA = 999;
                if (idxB === -1) idxB = 999;
                return idxA - idxB;
            };

            foundMain.sort(sortFn);
            foundModules.sort(sortFn);

            foundMain.forEach(item => {
                navHtml += `<button class="scp-ctx-nav-btn scp-ctx-nav-sub" data-t="${item.id}">&nbsp;&nbsp;◦ ${escHtml(item.label)}</button>`;
            });

            let moduleNavs = '';
            foundModules.forEach(item => {
                moduleNavs += `<button class="scp-ctx-nav-btn scp-ctx-nav-sub" data-t="${item.id}">&nbsp;&nbsp;◦ ${escHtml(item.label)}</button>`;
            });

            if (moduleNavs) {
                 navHtml += `<details class="scp-ctx-nav-details" open><summary class="scp-ctx-nav-btn" style="color:var(--scp-text)">▼ Modules</summary>${moduleNavs}</details>`;
            }
        }

        const highlighted = _highlightContextText(raw);
        bodyHtml += `<div class="scp-ctx-block" id="${blockId}">`;
        bodyHtml += `<div class="scp-ctx-block-header scp-ctx-role-${displayRole}">${escHtml(label)}</div>`;
        bodyHtml += `<div class="scp-ctx-block-sep"></div>`;
        bodyHtml += `<div class="scp-ctx-block-body"><pre class="scp-ctx-pre">${highlighted}</pre></div>`;
        bodyHtml += `</div>`;
    });

    const styleHtml = `<style>
        .scp-ctx-hl-tag-d0 { color: #eff6ff !important; }
        .scp-ctx-hl-tag-d1 { color: #bfdbfe !important; }
        .scp-ctx-hl-tag-d2 { color: #93c5fd !important; }
        .scp-ctx-hl-tag-d3 { color: rgb(106, 165, 236) !important; }
        .scp-ctx-hl-tag-d4 { color: rgb(100, 158, 253) !important; }
        .scp-ctx-hl-tag-d5 { color: rgb(74, 120, 221) !important; }
    </style>`;

    return `<div class="scp-ctx-inspector">${styleHtml}<nav class="scp-ctx-nav">${navHtml}</nav><div class="scp-ctx-body" id="scp-ctx-body">${bodyHtml}</div></div>`;
}

export let _lastInspectorMessages = [];

export async function openInspector() {
    const sess = getCurrentSession();
    const { getEffectiveSettings } = await import('../session.js');
    const settings = getEffectiveSettings();
    const inputEl = document.getElementById('scp-input');
    const pendingText = inputEl ? inputEl.value.trim() : '';
    const processedAtts = await _processAttachmentsBeforeSend(state.pendingAttachments, true);
    
    const messages = await assembleMessages(sess, settings, pendingText, processedAtts);
    _lastInspectorMessages = messages;

    const fmtEl = document.getElementById('scp-ctx-formatted');
    const jsonEl = document.getElementById('scp-ctx-json');
    const modalEl = document.getElementById('scp-ctx-modal');
    
    const modal = modalEl.querySelector('.scp-modal');
    if (modal) {
        modal.style.height = '75vh';
    }
    
    const modalBody = modalEl.querySelector('.scp-modal-body');
    if (modalBody) {
        modalBody.style.padding = '0';
        modalBody.style.overflow = 'hidden';
        modalBody.style.display = 'flex';
        modalBody.style.flexDirection = 'column';
        modalBody.style.height = '100%';
    }

    if (fmtEl) {
        fmtEl.style.height = '100%';
        fmtEl.style.flex = '1';
        fmtEl.style.overflow = 'hidden';
        fmtEl.style.padding = '0';
        fmtEl.innerHTML = _buildContextInspectorHTML(messages);
        
        fmtEl.querySelectorAll('.scp-ctx-nav-btn[data-t]').forEach(btn => {
            btn.addEventListener('click', () => {
                const t = document.getElementById(btn.dataset.t);
                const bodyContainer = document.getElementById('scp-ctx-body');
                if (t && bodyContainer) {
                    const topPos = t.offsetTop;
                    bodyContainer.scrollTo({ top: topPos, behavior: 'smooth' });
                }
            });
        });
    }
    if (jsonEl) jsonEl.textContent = JSON.stringify(messages, null, 2);
    modalEl.style.display = 'flex';
    import('./ui-window.js').then(m => m.bringWindowToFront());
    
    setTimeout(() => {
        const isJsonActive = document.querySelector('.scp-modal-tab.active')?.dataset.tab === 'json';
        const targetEl = isJsonActive ? jsonEl : document.getElementById('scp-ctx-body');
        if (targetEl) {
            const prevBehavior = targetEl.style.scrollBehavior;
            targetEl.style.scrollBehavior = 'auto';
            targetEl.scrollTop = targetEl.scrollHeight;
            targetEl.style.scrollBehavior = prevBehavior;
        }
    }, 0);
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
    testBtn.addEventListener('click', () => playCompletionSound(true));
    
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
            if (file.size > 5 * 1024 * 1024) { toastr.warning('Audio file too large (>5MB).', EXT_DISPLAY); return; }
            
            const { _fileToDataUrl } = await import('../utils/util-dom.js');
            const dataUrl = await _fileToDataUrl(file).catch(() => null);
            if (!dataUrl) { toastr.error('Failed to load audio', EXT_DISPLAY); return; }
            
            const s2 = getSettings();
            const id = 'snd_' + Date.now();
            s2.customSounds[id] = { name: file.name, data: dataUrl };
            s2.completionSound = id;
            saveSettings();
            
            const allContainers = [document.getElementById('scp-sound-settings'), document.getElementById('scp-sp-sound-settings')].filter(Boolean);
            allContainers.forEach(c => buildSoundSettingsUI(c));
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