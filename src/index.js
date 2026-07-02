import { EXT_NAME, EXT_DISPLAY, CHANGELOG, I, WIN_ID, ICON_ID, MODAL_ID, ICON_STORAGE_KEY } from './constants.js';
import { state } from './state.js';
import { getSettings, saveSettings, initChatBucket, getChatBucket, setActiveSession, deleteCurrentSession, getCurrentSession, exportCurrentSession, importSession, showSessionDialog } from './session.js';
import { _dbgSetupGlobalErrorHandlers, _dbgAdd, dbgDownload, _dbgSnapshotSettings } from './utils/util-debug.js';
import { showCustomDialog, escHtml, autoResize, copyText } from './utils/util-dom.js';
import { setupExternalWIChangeListener } from './features/feature-lorebook-engine.js';

import { restoreWindowState, applyCustomTheme, applyWindowBackground, hideWindow, showWindow, minimize, toggleVisibility, makeDraggable, makeResizable, makeIconDraggable, updateIconVisibility, toggleGhostMode, setupGhostHotkey, setupHotkey, bringWindowToFront } from './ui/ui-window.js';
import { setupSettingsPanelListeners, setupSettingsHandlers, updateSettingsUI, updateProfilesList, updateSPConnProfileList, _takeProfileSnapshot, openSettingsPanel, syncOverlayUI } from './ui/ui-settings.js';
import { setupLorebookManagerListeners, openLorebookManager } from './features/feature-lorebook-ui.js';
import { setupCharacterManagerListeners, openCharacterManager } from './features/feature-character-manager-ui.js';
import { updateMemoryDot } from './features/feature-memory.js';
import { setupChatPickerListeners, onChatChanged, updateDepthSlidersMax, renderSession, openSearch, navigateSearch, performSearch, closeSearch, openChatPicker, toggleSearchWholeWord, setupDepthClickEdit, updateMsgCount, setupSearchHotkey, setupMessagesScrollTracking } from './ui/ui-chat.js';
import { checkChangelogAutoShow, setupChangelogListeners, openChangelog, openFavoritesPanel, closeFavoritesPanel, openInspector, renderQuickPromptsBar } from './ui/ui-widgets.js';
import { _setupAttachButton } from './features/feature-attachments.js';

import * as apiMod from './api.js';

export let ST_WorldInfo = null;
export let ST_Utils = null;
export let extVersion = '?';
export let __extPath = 'third-party/ST-Copilot';

if (document.currentScript && document.currentScript.src) {
    const match = new URL(document.currentScript.src).pathname.match(/\/scripts\/extensions\/(.+)\/[^\/]+\.js$/);
    if (match) __extPath = match[1];
} else {
    for (let s of document.getElementsByTagName('script')) {
        if (s.src && s.src.includes('index.js') && s.src.toLowerCase().includes('copilot')) {
            const match = new URL(s.src).pathname.match(/\/scripts\/extensions\/(.+)\/[^\/]+\.js$/);
            if (match) { __extPath = match[1]; break; }
        }
    }
}

async function loadManifestVersion() {
    try {
        const res = await fetch(`/scripts/extensions/${__extPath}/manifest.json`);
        if (res.ok) {
            const manifest = await res.json();
            extVersion = manifest.version || CHANGELOG[0]?.version || '?';
        } else {
            extVersion = CHANGELOG[0]?.version || '?';
        }
    } catch (_) {
        extVersion = CHANGELOG[0]?.version || '?';
    }
}

async function injectUI() {
    const ctx = SillyTavern.getContext();
    const parseTemplate = (html) => {
        if (!html) return '';
        return html.replace(/\$\{I\.([a-zA-Z0-9_]+)\}/g, (_, iconName) => I[iconName] || '');
    };
    const loadAndInject = async (templateName) => {
        const html = await ctx.renderExtensionTemplateAsync(__extPath, templateName);
        if (html) {
            const wrapper = document.createElement('div');
            wrapper.innerHTML = parseTemplate(html);
            while (wrapper.firstChild) document.body.appendChild(wrapper.firstChild);
        } else {
            console.error(`[${EXT_DISPLAY}] Couldn't load HTML: ${templateName}.html`);
        }
    };
    const templates = ['window', 'lorebook_manager', 'character_manager', 'settings_overlay', 'chat_picker'];
    await Promise.all(templates.map(loadAndInject));

    const iconEl = document.getElementById(ICON_ID);
    if (iconEl && iconEl.parentElement !== document.body) {
        document.body.appendChild(iconEl);
    }
}

export function refreshSessionDropdown() {
    const bucket = getChatBucket();
    const nameEl = document.getElementById('scp-sess-name'); 
    const listEl = document.getElementById('scp-sess-list');
    if (!nameEl || !listEl) return;
    const activeSess = bucket.sessions.find(s => s.id === bucket.activeSessionId);
    nameEl.textContent = activeSess?.name || 'No Sessions';
    listEl.innerHTML = '';
    
    if (!bucket.sessions.length) {
        listEl.innerHTML = `<div class="scp-sess-empty-label">No sessions — create one below</div>`;
    } else {
        for (const sess of bucket.sessions) {
            const item = document.createElement('div');
            item.className = `scp-sess-item${sess.id === bucket.activeSessionId ? ' active' : ''}`;
            item.dataset.id = sess.id;

            const dot = document.createElement('span'); dot.className = 'scp-sess-item-dot';
            const nameSpan = document.createElement('span'); nameSpan.className = 'scp-sess-item-name'; nameSpan.textContent = sess.name;
            const count = document.createElement('span'); count.className = 'scp-sess-item-count'; count.textContent = sess.messages.length;

            item.appendChild(dot); item.appendChild(nameSpan); item.appendChild(count);
            if (sess.isTemporary) {
                const badge = document.createElement('span'); badge.className = 'scp-sess-tmp-badge';
                badge.title = 'Temporary session — will be deleted on switch'; badge.textContent = 'tmp';
                item.appendChild(badge);
            }
            
            if (sess.id === bucket.activeSessionId) {
                const tmpBtn = document.createElement('button');
                tmpBtn.className = `scp-sess-tmp-btn${sess.isTemporary ? ' active' : ''}`;
                tmpBtn.title = sess.isTemporary ? 'Make permanent' : 'Make temporary';
                tmpBtn.innerHTML = '⏱';
                tmpBtn.addEventListener('click', e => {
                    e.stopPropagation();
                    sess.isTemporary = !sess.isTemporary;
                    import('./session.js').then(m => m.saveSessionsToMetadata());
                    refreshSessionDropdown();
                });
                item.appendChild(tmpBtn);
            }

            item.addEventListener('click', async () => {
                const actSess = bucket.sessions.find(s => s.id === bucket.activeSessionId);
                if (actSess && actSess.isTemporary && actSess.id !== sess.id) {
                    const ok = await showCustomDialog({
                        type: 'confirm',
                        title: 'Delete Temporary Session?',
                        message: 'Your current session is temporary. Switching will permanently delete it. Continue?'
                    });
                    if (!ok) return;
                }

                setActiveSession(sess.id);
                refreshSessionDropdown(); 
                renderSession(getCurrentSession()); 
                document.getElementById('scp-sess-panel')?.classList.remove('open');
                document.getElementById('scp-sess-trigger')?.classList.remove('open');
            });
            listEl.appendChild(item);
        }
    }
}

function addWandButton() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu || document.getElementById('scp-wand-btn')) return;
    const btn = document.createElement('div');
    btn.id = 'scp-wand-btn';
    btn.classList.add('list-group-item', 'flex-container', 'flexGap5');
    btn.innerHTML = `<div class="fa-solid fa-robot extensionsMenuExtensionButton"></div><span>${EXT_DISPLAY}</span>`;
    btn.style.display = getSettings().enabled ? '' : 'none';
    btn.addEventListener('click', () => toggleVisibility());
    menu.appendChild(btn);
}

function attachWindowListeners() {
    const windowEl = document.getElementById(WIN_ID);
    const iconEl = document.getElementById(ICON_ID);
    const modalEl = document.getElementById(MODAL_ID);

    if (windowEl) {
        makeDraggable(document.getElementById('scp-drag-handle'), windowEl);
        makeResizable(windowEl);
    }
    
    document.addEventListener('pointerdown', e => {
        const win = document.getElementById(WIN_ID);
        if (!win || win.style.display === 'none') {
            state.copilotActive = false;
            return;
        }
        const clickedInside = win.contains(e.target) || 
                              e.target.closest('.scp-dialog-overlay') ||
                              document.getElementById('scp-settings-overlay')?.contains(e.target) ||
                              document.getElementById('scp-lb-overlay')?.contains(e.target) ||
                              document.getElementById('scp-char-overlay')?.contains(e.target) ||
                              document.getElementById('scp-picker-overlay')?.contains(e.target) ||
                              document.getElementById('scp-diff-modal')?.contains(e.target);
        state.copilotActive = !!clickedInside;
    }, true);

    window.addEventListener('resize', () => {
        if (windowEl && windowEl.style.display !== 'none') {
            try {
                const saved = localStorage.getItem('scp-win-pos');
                if (saved) {
                    const { x, y } = JSON.parse(saved);
                    if (x != null) {
                        const r = windowEl.getBoundingClientRect();
                        const maxLeft = Math.max(0, window.innerWidth - r.width);
                        const maxTop = Math.max(0, window.innerHeight - r.height);
                        windowEl.style.left = `${Math.max(0, Math.min(x, maxLeft))}px`;
                        windowEl.style.top = `${Math.max(0, Math.min(y, maxTop))}px`;
                    }
                }
            } catch(e) {}
        }
        if (iconEl && iconEl.style.display !== 'none') {
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const iconSize = 46;
            const savedIconPos = localStorage.getItem(ICON_STORAGE_KEY);
            if (savedIconPos) {
                try {
                    const pos = JSON.parse(savedIconPos);
                    const left = parseFloat(pos.left);
                    const top = parseFloat(pos.top);
                    if (!isNaN(left) && !isNaN(top)) {
                        let newLeft = Math.max(0, Math.min(left, vw - iconSize));
                        let newTop = Math.max(0, Math.min(top, vh - iconSize));
                        iconEl.style.left = `${newLeft}px`;
                        iconEl.style.top = `${newTop}px`;
                    }
                } catch(e) {}
            }
        }
    });

    document.getElementById('scp-min-btn')?.addEventListener('click', () => minimize());
    document.getElementById('scp-close-btn')?.addEventListener('click', () => hideWindow());
    document.getElementById('scp-ext-settings-btn')?.addEventListener('click', () => openSettingsPanel());
    if (iconEl) makeIconDraggable(iconEl);

    document.getElementById('scp-ghost-btn')?.addEventListener('click', () => toggleGhostMode());

    // Session dropdown
    document.getElementById('scp-sess-trigger')?.addEventListener('click', e => {
        e.stopPropagation();
        if (state.generating) { toastr.warning('Please wait for generation to finish.', EXT_DISPLAY); return; }
        const panel = document.getElementById('scp-sess-panel'); const trigger = document.getElementById('scp-sess-trigger');
        const isOpen = panel.classList.contains('open');
        panel.classList.toggle('open', !isOpen); trigger.classList.toggle('open', !isOpen);
        if (!isOpen) refreshSessionDropdown();
    });
    document.addEventListener('click', e => {
        const dd = document.getElementById('scp-sess-dropdown');
        if (dd && !dd.contains(e.target)) {
            document.getElementById('scp-sess-panel')?.classList.remove('open');
            document.getElementById('scp-sess-trigger')?.classList.remove('open');
        }
        const menuDd = document.getElementById('scp-menu-dropdown');
        if (menuDd && !menuDd.contains(e.target)) {
            document.getElementById('scp-menu-panel')?.classList.remove('open');
            document.getElementById('scp-menu-trigger')?.classList.remove('active');
        }
        if (!e.target.closest('.scp-lb-proposal-world-dd')) {
            document.querySelectorAll('.scp-lb-proposal-world-panel.open').forEach(p => {
                p.classList.remove('open'); p.previousElementSibling?.classList.remove('open');
            });
        }
    });

    document.getElementById('scp-new-sess-btn')?.addEventListener('click', async () => {
        const bucket = getChatBucket();
        const activeSess = bucket.sessions.find(s => s.id === bucket.activeSessionId);
        if (activeSess && activeSess.isTemporary) {
            const ok = await showCustomDialog({
                type: 'confirm',
                title: 'Delete Temporary Session?',
                message: 'Your current session is temporary. Creating a new one will permanently delete it. Continue?'
            });
            if (!ok) return;
        }

        const defaultName = `Session ${bucket.sessions.length + 1}`;
        const result = await showSessionDialog({ defaultName });
        if (result === null) return;
        
        import('./session.js').then(m => {
            m.createSession(result.name.trim() || defaultName, result.isTemporary);
            refreshSessionDropdown(); 
            renderSession(getCurrentSession());
            document.getElementById('scp-sess-panel')?.classList.remove('open');
            document.getElementById('scp-sess-trigger')?.classList.remove('open');
        });
    });

    document.getElementById('scp-rename-sess-btn')?.addEventListener('click', async () => {
        const sess = getCurrentSession();
        const oldName = sess.name;
        const newName = await showCustomDialog({ type: 'prompt', title: 'Rename Session', message: 'New session name:', defaultValue: sess.name });
        if (!newName?.trim() || newName.trim() === oldName) return;
        sess.name = newName.trim(); 
        import('./session.js').then(m => m.saveSessionsToMetadata());
        refreshSessionDropdown();
        _dbgAdd('SESSION_RENAMED', { id: sess.id, oldName, newName: sess.name });
    });

    document.getElementById('scp-del-sess-btn')?.addEventListener('click', async () => {
        const bucket = getChatBucket();
        if (!bucket.sessions.length) return;
        const ok = await showCustomDialog({ type: 'confirm', title: 'Delete Session', message: 'Delete this session and all its messages? This cannot be undone.' });
        if (!ok) return;
        const newSess = deleteCurrentSession();
        refreshSessionDropdown(); renderSession(newSess);
    });

    document.getElementById('scp-export-sess-btn')?.addEventListener('click', () => { 
        document.getElementById('scp-sess-panel')?.classList.remove('open');
        document.getElementById('scp-sess-trigger')?.classList.remove('open');
        exportCurrentSession(); 
    });
    
    document.getElementById('scp-import-sess-btn')?.addEventListener('click', () => { 
        document.getElementById('scp-sess-panel')?.classList.remove('open');
        document.getElementById('scp-sess-trigger')?.classList.remove('open');
        importSession(() => {
            refreshSessionDropdown();
            renderSession(getCurrentSession());
        }); 
    });

    _setupAttachButton();

    // Toolbar actions
    document.getElementById('scp-regen-btn')?.addEventListener('click', () => {
        const sess = getCurrentSession();
        if (!sess.messages.length || state.generating) return;
        let lastUserIdx = -1;
        for (let i = sess.messages.length - 1; i >= 0; i--) { if (sess.messages[i].role === 'user') { lastUserIdx = i; break; } }
        if (lastUserIdx === -1) return;
        const userMsg = sess.messages[lastUserIdx];
        import('./session.js').then(m => m.truncateAfter(sess, userMsg.id));
        import('./ui/ui-chat.js').then(m => m.removeMsgElAfter(userMsg.id));
        apiMod.runGenerate(sess, userMsg.content, false);
    });

    document.getElementById('scp-menu-trigger')?.addEventListener('click', e => {
        e.stopPropagation();
        const panel = document.getElementById('scp-menu-panel');
        const trigger = document.getElementById('scp-menu-trigger');
        const isOpen = panel.classList.contains('open');
        panel.classList.toggle('open', !isOpen);
        trigger.classList.toggle('active', !isOpen);
    });
    document.getElementById('scp-menu-lb-item')?.addEventListener('click', () => {
        document.getElementById('scp-menu-panel')?.classList.remove('open');
        document.getElementById('scp-menu-trigger')?.classList.remove('active');
        openLorebookManager();
    });
    document.getElementById('scp-menu-char-item')?.addEventListener('click', () => {
        document.getElementById('scp-menu-panel')?.classList.remove('open');
        document.getElementById('scp-menu-trigger')?.classList.remove('active');
        openCharacterManager();
    });

    document.getElementById('scp-search-btn')?.addEventListener('click', () => { state.searchOpen ? closeSearch() : openSearch(); });
    document.getElementById('scp-pick-btn')?.addEventListener('click', () => openChatPicker());

    document.getElementById('scp-fav-btn')?.addEventListener('click', () => {
        const panel = document.getElementById('scp-fav-panel');
        if (panel?.style.display === 'none' || !panel?.style.display) openFavoritesPanel();
        else closeFavoritesPanel();
    });
    document.getElementById('scp-fav-close')?.addEventListener('click', () => closeFavoritesPanel());

    document.getElementById('scp-qp-toggle-btn')?.addEventListener('click', () => {
        const s = getSettings(); s.quickPromptsVisible = !s.quickPromptsVisible; saveSettings();
        import('./ui/ui-widgets.js').then(m => m.renderQuickPromptsBar());
    });

    document.getElementById('scp-inspect-btn')?.addEventListener('click', () => openInspector());

    const qpBar = document.getElementById('scp-qp-bar');
    if (qpBar) {
        qpBar.addEventListener('wheel', e => {
            if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
            e.preventDefault();
            const delta = e.deltaMode === 1 ? e.deltaY * 20 : e.deltaMode === 2 ? e.deltaY * 200 : e.deltaY;
            qpBar.scrollLeft += delta;
        }, { passive: false });
    }
    
    document.getElementById('scp-search-close')?.addEventListener('click', () => closeSearch());
    document.getElementById('scp-search-prev')?.addEventListener('click', () => navigateSearch(-1));
    document.getElementById('scp-search-next')?.addEventListener('click', () => navigateSearch(1));
    document.getElementById('scp-search-word')?.addEventListener('click', () => toggleSearchWholeWord());

    const searchInputEl = document.getElementById('scp-search-input');
    if (searchInputEl) {
        searchInputEl.addEventListener('input', () => {
            state.searchQuery = searchInputEl.value;
            clearTimeout(state.searchDebounceId);
            state.searchDebounceId = setTimeout(performSearch, 220);
        });
        searchInputEl.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); navigateSearch(e.shiftKey ? -1 : 1); }
            if (e.key === 'Escape') { e.stopPropagation(); closeSearch(); }
        });
    }

    document.getElementById('scp-stop-btn')?.addEventListener('click', () => {
        state.abortController?.abort();
        const { stopGeneration } = SillyTavern.getContext();
        if (typeof stopGeneration === 'function') stopGeneration();
    });

    const inputEl = document.getElementById('scp-input');
    if (inputEl) {
        inputEl.addEventListener('input', () => { 
            autoResize(inputEl); 
            updateMsgCount(getCurrentSession());
        });
        inputEl.addEventListener('keydown', e => { 
            if (e.key === 'Enter' && !e.shiftKey) { 
                const isMobile = window.innerWidth <= 900 || ('ontouchstart' in window);
                if (!isMobile) {
                    e.preventDefault(); 
                    document.getElementById('scp-send-btn')?.click(); 
                }
            } 
        });
    }
    document.getElementById('scp-send-btn')?.addEventListener('click', async () => {
        const rawText = inputEl?.value.trim();
        if (!rawText && !state.pendingAttachments.length || state.generating) return;
        
        const { expandMacros, getEffectiveSettings } = await import('./session.js');
        const _s = getEffectiveSettings();
        const text = _s.autoExpandMacros ? expandMacros(rawText || '') : (rawText || '');
        if (inputEl) { inputEl.value = ''; autoResize(inputEl); }
        
        import('./features/feature-attachments.js').then(async m => {
            const processedAtts = await m._processAttachmentsBeforeSend(state.pendingAttachments, false);
            state.pendingAttachments = [];
            m._renderAttachmentPreviews();
            apiMod.runGenerate(getCurrentSession(), text, true, processedAtts).catch(console.error);
        });
    });

    // Modals
    document.getElementById('scp-modal-close')?.addEventListener('click', () => { if (modalEl) modalEl.style.display = 'none'; });
    let _modalMouseDown = null;
    modalEl?.addEventListener('mousedown', e => { _modalMouseDown = e.target; });
    modalEl?.addEventListener('click', e => { if (e.target === modalEl && _modalMouseDown === modalEl) modalEl.style.display = 'none'; });
    
    // Diff Modal
    const diffModal = document.getElementById('scp-diff-modal');
    document.getElementById('scp-diff-close')?.addEventListener('click', () => { if (diffModal) diffModal.style.display = 'none'; });
    let _diffMouseDown = null;
    diffModal?.addEventListener('mousedown', e => { _diffMouseDown = e.target; });
    diffModal?.addEventListener('click', e => { if (e.target === diffModal && _diffMouseDown === diffModal) diffModal.style.display = 'none'; });

    document.querySelectorAll('.scp-modal-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.scp-modal-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            const isFormatted = tab.dataset.tab === 'formatted';
            const isJson = tab.dataset.tab === 'json';
            
            const fmtEl = document.getElementById('scp-ctx-formatted');
            const jsonEl = document.getElementById('scp-ctx-json');
            
            if (fmtEl) fmtEl.style.display = isFormatted ? '' : 'none';
            if (jsonEl) jsonEl.style.display = isJson ? '' : 'none';
            
            setTimeout(() => {
                const targetEl = isJson ? jsonEl : document.getElementById('scp-ctx-body');
                if (targetEl) {
                    const prevBehavior = targetEl.style.scrollBehavior;
                    targetEl.style.scrollBehavior = 'auto';
                    targetEl.scrollTop = targetEl.scrollHeight;
                    targetEl.style.scrollBehavior = prevBehavior;
                }
            }, 0);
        });
    });
    
    document.getElementById('scp-ctx-copy-btn')?.addEventListener('click', () => {
        const activeTab = document.querySelector('.scp-modal-tab.active');
        if (activeTab?.dataset.tab === 'json') {
            copyText(document.getElementById('scp-ctx-json')?.textContent || '');
        } else {
            import('./ui/ui-widgets.js').then(m => copyText(apiMod.formatPayloadAsText(m._lastInspectorMessages || [])));
        }
    });

    const depthSlider = document.getElementById('scp-depth-slider');
    if (depthSlider) {
        depthSlider.value = getSettings().contextDepth;
        const dv = document.getElementById('scp-depth-val');
        if(dv) dv.textContent = depthSlider.value;
        
        depthSlider.addEventListener('input', () => {
            const dv = document.getElementById('scp-depth-val');
            if(dv) dv.textContent = depthSlider.value;
        });
        
        depthSlider.addEventListener('change', () => {
            const val = parseInt(depthSlider.value);
            getSettings().contextDepth = val; 
            saveSettings();
            syncOverlayUI('contextDepth', val);
            updateMsgCount(getCurrentSession());
        });
    }
    setupDepthClickEdit();
}

async function init() {
    _dbgSetupGlobalErrorHandlers();
    
    try { ST_WorldInfo = await import('/scripts/world-info.js'); } catch(e) { console.warn('ST-Copilot: Could not import world-info.js'); }
    try { ST_Utils = await import('/scripts/utils.js'); } catch(e) { console.warn('ST-Copilot: Could not import utils.js'); }
    
    await loadManifestVersion();
    
    getSettings();
    _dbgSnapshotSettings();
    await injectUI();
    
    const ctx = SillyTavern.getContext();
    const container = document.getElementById('extensions_settings') || document.getElementById('extensions_settings2');
    if (container) {
        try {
            const html = await ctx.renderExtensionTemplateAsync(__extPath, 'settings');
            if (html) container.insertAdjacentHTML('beforeend', html);
        } catch (e) {}
    }
    
    restoreWindowState(document.getElementById(WIN_ID), document.getElementById(ICON_ID)); 
    attachWindowListeners(); 
    setupSettingsHandlers(); 
    updateSettingsUI(); 
    setupSettingsPanelListeners(); 
    setupLorebookManagerListeners(); 
    setupCharacterManagerListeners();
    setupExternalWIChangeListener();
    setupChatPickerListeners(); 
    setupChangelogListeners();
    setupSearchHotkey();
    setupGhostHotkey();
    setupHotkey();
    setupMessagesScrollTracking();
    
    const s = getSettings();
    const windowEl = document.getElementById(WIN_ID);
    
    if (s.windowVisible && !s.minimized && windowEl) {
        windowEl.style.display = 'flex';
        state.copilotActive = true;
    } else if (windowEl) {
        windowEl.style.display = 'none';
        state.copilotActive = false;
    }
    
    updateIconVisibility(document.getElementById(ICON_ID));
    bringWindowToFront();
    
    await onChatChanged();
    refreshSessionDropdown();
    
    const es = ctx.eventSource || window.eventSource;
    const et = ctx.event_types || window.event_types || {};

    if (es) {
        es.on(et.CHAT_CHANGED || 'chat_changed', async () => {
            await onChatChanged();
            refreshSessionDropdown();
            renderSession(getCurrentSession());
        });
        es.on(et.CHARACTER_SELECTED || 'character_selected', async () => {
            await onChatChanged();
            refreshSessionDropdown();
            renderSession(getCurrentSession());
        });
        es.on(et.APP_READY || 'app_ready', () => {
            updateProfilesList();
            updateSPConnProfileList();
        });

        const cmEvents = [
            et.CONNECTION_PROFILE_CREATED || 'connection_profile_created',
            et.CONNECTION_PROFILE_UPDATED || 'connection_profile_updated',
            et.CONNECTION_PROFILE_DELETED || 'connection_profile_deleted',
            et.CONNECTION_PROFILE_LOADED || 'connection_profile_loaded'
        ];
        cmEvents.forEach(evt => {
            es.on(evt, () => {
                updateProfilesList();
                updateSPConnProfileList();
            });
        });
        
        const dynEvents =[
            et.MESSAGE_RECEIVED || 'message_received',
            et.MESSAGE_SENT || 'message_sent',
            et.MESSAGE_DELETED || 'message_deleted',
            et.MESSAGE_UPDATED || 'message_updated',
            et.MESSAGE_SWIPED || 'message_swiped'
        ];
        
        dynEvents.forEach(e => { 
            if (e) es.on(e, updateDepthSlidersMax); 
        });
    }
    
    addWandButton();
    checkChangelogAutoShow();
    _takeProfileSnapshot();
    updateMemoryDot();

    window.addEventListener('message', e => {
        if (!e.data || typeof e.data !== 'object') return;
        if (e.data.type === 'scp-iframe-h') {
            document.querySelectorAll('.scp-html-block-iframe').forEach(f => {
                try { if (f.contentWindow === e.source) f.style.height = `${Math.max(40, Math.min(1200, e.data.h + 16))}px`; } catch(_) {}
            });
        } else if (e.data.type === 'scp-iframe-bg') {
            document.querySelectorAll('.scp-html-block-iframe').forEach(f => {
                try { if (f.contentWindow === e.source) f.style.background = e.data.hasBg ? 'transparent' : '#ffffff'; } catch(_) {}
            });
        } else if (e.data.type === 'scp-iframe-err') {
            document.querySelectorAll('.scp-html-block-iframe').forEach(f => {
                try {
                    if (f.contentWindow === e.source) {
                        const errEl = f.closest('.scp-html-block')?.querySelector('.scp-html-block-error');
                        if (errEl) { errEl.textContent = `⚠ ${e.data.msg}`; errEl.style.display = ''; }
                    }
                } catch(_) {}
            });
        }
    });

    const preventSpinBug = e => { if (e.target && e.target.tagName === 'INPUT' && e.target.type === 'number') e.stopPropagation(); };
    [
        windowEl, 
        document.getElementById('scp-settings-overlay'), 
        document.getElementById('scp-lb-overlay'), 
        document.getElementById('scp-char-overlay'),
        document.getElementById('scp-picker-overlay')
    ].filter(Boolean).forEach(el => {
        el.addEventListener('mousedown', preventSpinBug);
        el.addEventListener('pointerdown', preventSpinBug);
    });

    console.log(`[${EXT_DISPLAY}] Initialized.`);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    setTimeout(init, 0);
}