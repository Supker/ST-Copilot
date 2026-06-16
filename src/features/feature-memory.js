import { EXT_DISPLAY, DEFAULT_MEMORY_PROMPT, MEMORY_FORMAT_BLOCK } from '../constants.js';
import { getSettings, saveSettings, getCurrentSession, getBindingKey } from '../session.js';
import { _dbgAdd } from '../utils/util-debug.js';
import { escHtml, showCustomDialog } from '../utils/util-dom.js';
import { _ensureWrapped } from '../utils/util-text.js';

export function genMemoryId() { 
    return 'mem_' + Date.now() + '_' + Math.random().toString(36).slice(2,6); 
}

export function getMemories() {
    const s = getSettings();
    if (!s.memories || typeof s.memories !== 'object') s.memories = {};
    return s.memories;
}

export function getVisibleMemories() {
    const { charId, chatId } = getBindingKey();
    const sessionId = getCurrentSession()?.id;
    const all = Object.values(getMemories());
    
    const debugDump = {
        currentContext: { charId, chatId, sessionId },
        totalStored: all.length,
        itemsProcessed: []
    };
    
    return all.filter(m => {
        if (m.disabled) return false;
        if (m.scope === 'global') return true;
        if (m.scope === 'character') return m.charId === charId;
        if (m.scope === 'chat') return m.charId === charId && m.chatId === chatId;
        if (m.scope === 'session') return m.charId === charId && m.chatId === chatId && m.sessionId === sessionId;
        return m.charId === charId; // fallback
    });
}

export function addMemory(key, value, scope = 'character') {
    const { charId, chatId } = getBindingKey();
    const ctx = SillyTavern.getContext();
    const charName = ctx.characters?.[charId]?.name || charId || 'Unknown Character';
    const chatName = chatId || 'Unknown Chat';
    const sessionObj = getCurrentSession();
    const sessionId = sessionObj?.id;
    const sessionName = sessionObj?.name || sessionId || 'Unknown Session';
    
    const id = genMemoryId();
    getMemories()[id] = {
        id, key: key.trim(), value: value.trim(),
        createdAt: Date.now(),
        scope: ['global', 'character', 'chat', 'session'].includes(scope) ? scope : 'character',
        charId, charName,
        chatId, chatName,
        sessionId, sessionName,
        disabled: false
    };
    saveSettings();
    updateMemoryDot();
    return id;
}

export function updateMemory(id, key, value) {
    const mem = getMemories()[id];
    if (!mem) return;
    mem.key = key.trim();
    mem.value = value.trim();
    mem.updatedAt = Date.now();
    saveSettings();
}

export function deleteMemory(id) {
    _dbgAdd('MEM_DELETE', { id });
    delete getMemories()[id];
    saveSettings();
    updateMemoryDot();
}

export function clearAllMemories() {
    _dbgAdd('MEM_CLEAR_ALL');
    getSettings().memories = {};
    saveSettings();
    updateMemoryDot();
}

export function updateMemoryDot() {
    const has = Object.keys(getMemories()).length > 0;
    document.getElementById('scp-sp-memory-dot')?.style.setProperty('display', has ? '' : 'none');
}

export function buildMemoryContextBlock(settings) {
    const s = settings || getSettings();
    if (!s.memoryEnabled || !s.memoryInject) return '';
    const mems = getVisibleMemories();
    if (!mems.length) return '';
    
    const lines = mems.map(m => `- [${m.scope.toUpperCase()}][${m.key}]: ${m.value}`).join('\n');
    return `\n\n<persistent_memory>\nThese are facts about the user that you should remember and reference when relevant:\n${lines}\n</persistent_memory>`;
}

export function buildMemoryAIInstructions(settings) {
    const s = settings || getSettings();
    if (!s.memoryEnabled) return '';
    const rawPrompt = s.memoryManagePrompt || DEFAULT_MEMORY_PROMPT;
    
    const mems = getVisibleMemories();
    let memsText = 'None';
    if (mems.length > 0) {
        const grouped = {};
        for (const m of mems) {
            if (!grouped[m.scope]) grouped[m.scope] = [];
            grouped[m.scope].push(`"${m.key}"`);
        }
        memsText = Object.entries(grouped)
            .map(([scope, keys]) => `- ${scope.toUpperCase()}: "${keys.join('", ')}`)
            .join('\n');
    }
    
    const finalPrompt = rawPrompt
        .replace('{{memory_format}}', MEMORY_FORMAT_BLOCK)
        .replace('{{current_memories}}', memsText);
        
    return '\n\n' + _ensureWrapped(finalPrompt, 'memory_system');
}

export function parseMemoryBlockFromText(text) {
    const re = new RegExp('```memory-update\\s*([\\s\\S]*?)```', 'i');
    const m = text.match(re);
    if (!m) return null;
    try { return JSON.parse(m[1].trim()); } catch(_) {}
    try { const fixed = m[1].trim().replace(/,\s*]/g, ']').replace(/,\s*}/g, '}'); return JSON.parse(fixed); } 
    catch(_) { 
        _dbgAdd('MEM_AI_UPDATE_BLOCK_FAILED', { raw: m[1] });
        return null; 
    }
}

export function stripMemoryBlock(text) {
    return text.replace(/```memory-update[\s\S]*?```/gi, '').trim();
}

export function processMemoryUpdates(text, msgId) {
    const s = getSettings();
    if (!s.memoryEnabled) return;
    const changes = parseMemoryBlockFromText(text);
    if (!changes?.length) return;
    const applied = [];
    for (const ch of changes) {
        if (ch.action === 'add' && ch.key && ch.value) {
            const targetScope = ['global', 'character', 'chat', 'session'].includes(ch.scope) ? ch.scope : 'character';
            const mem = getVisibleMemories().find(m => m.scope === targetScope && m.key === ch.key);
            
            if (mem) {
                const newVal = mem.value + '\n' + ch.value;
                updateMemory(mem.id, ch.key, newVal);
                applied.push({ action: 'update', key: ch.key, value: newVal });
            } else {
                addMemory(ch.key, ch.value, ch.scope);
                applied.push({ action: 'add', key: ch.key, value: ch.value });
            }
        } else if ((ch.action === 'edit' || ch.action === 'update') && ch.scope && ch.key && ch.value) {
            const mem = getVisibleMemories().find(m => m.scope === ch.scope && m.key === ch.key);
            if (mem) {
                updateMemory(mem.id, ch.key, ch.value);
                applied.push({ action: 'update', key: ch.key, value: ch.value });
            }
        } else if (ch.action === 'delete' && ch.scope && ch.key) {
            const mem = getVisibleMemories().find(m => m.scope === ch.scope && m.key === ch.key);
            if (mem) { applied.push({ action: 'delete', key: mem.key }); deleteMemory(mem.id); }
        } else {
            if (ch.action && !['add', 'edit', 'update', 'delete'].includes(ch.action)) {
                _dbgAdd('MEM_AI_ACTION_UNKNOWN', { action: ch.action });
            } else if (ch.scope && !['global', 'character', 'chat', 'session'].includes(ch.scope)) {
                _dbgAdd('MEM_SCOPE_INVALID', { scope: ch.scope });
            }
        }
    }
    if (applied.length) {
        if (s.memoryNotify) showMemoryToast(applied);
        if (document.getElementById('scp-sp-pane-memory')?.style.display !== 'none') renderMemoryList();
    }
}

export function showMemoryToast(applied) {
    const existing = document.querySelector('.scp-memory-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'scp-memory-toast';
    const icons = { add: '✦', update: '✎', delete: '✕' };
    const lines = applied.slice(0, 3).map(a => `${icons[a.action] || '·'} ${escHtml(a.key)}: ${escHtml((a.value || '(deleted)').slice(0, 60))}`).join("\n");
    const linesHtml = lines.split("\n").join("<br>");
    toast.innerHTML = `<span class="scp-memory-toast-icon"><i class="fa-solid fa-brain"></i></span><div class="scp-memory-toast-body"><div class="scp-memory-toast-title">Memory Updated (${applied.length})</div><div class="scp-memory-toast-text">${linesHtml}</div></div>`;
    document.body.appendChild(toast);
    toast.style.cursor = 'pointer';
    toast.addEventListener('click', () => {
        _dbgAdd('MEM_TOAST_DISMISS', { reason: 'click' });
        toast.remove();
    });
    setTimeout(() => {
        toast.style.animation = 'scp-toast-out 0.25s ease forwards';
        setTimeout(() => {
            _dbgAdd('MEM_TOAST_DISMISS', { reason: 'timeout' });
            toast.remove();
        }, 260);
    }, 12000);
}

export function renderMemoryList() {
    const listEl = document.getElementById('scp-sp-memory-list');
    const emptyEl = document.getElementById('scp-sp-memory-empty');
    if (!listEl) return;
    
    const allMems = Object.values(getMemories()).sort((a,b) => (b.createdAt||0) - (a.createdAt||0));
    listEl.innerHTML = '';
    
    if (!allMems.length) {
        if (emptyEl) emptyEl.style.display = '';
        return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    const tree = { global: [], characters: {} };

    allMems.forEach(m => {
        if (m.scope === 'global' || !m.scope) {
            tree.global.push(m);
        } else {
            const charId = m.charId || 'unknown';
            if (!tree.characters[charId]) {
                tree.characters[charId] = { name: m.charName || charId, memories: [], chats: {} };
            }
            const charNode = tree.characters[charId];

            if (m.scope === 'character') {
                charNode.memories.push(m);
            } else {
                const chatId = m.chatId || 'unknown';
                if (!charNode.chats[chatId]) {
                    charNode.chats[chatId] = { name: m.chatName || chatId, memories: [], sessions: {} };
                }
                const chatNode = charNode.chats[chatId];

                if (m.scope === 'chat') {
                    chatNode.memories.push(m);
                } else if (m.scope === 'session') {
                    const sessionId = m.sessionId || 'unknown';
                    if (!chatNode.sessions[sessionId]) {
                        chatNode.sessions[sessionId] = { name: m.sessionName || sessionId, memories: [] };
                    }
                    chatNode.sessions[sessionId].memories.push(m);
                }
            }
        }
    });

    const createMemEl = (mem) => {
        const item = document.createElement('div');
        item.className = 'scp-memory-item';
        if (mem.disabled) item.style.opacity = '0.5';
        item.dataset.id = mem.id;
        
        const isNew = (Date.now() - (mem.createdAt || 0)) < 5000;
        if (isNew) {
            const dot = document.createElement('div');
            dot.className = 'scp-memory-new-badge';
            item.appendChild(dot);
        }

        const timeStr = mem.updatedAt
            ? `Updated ${new Date(mem.updatedAt).toLocaleString()}`
            : `Added ${new Date(mem.createdAt || 0).toLocaleString()}`;

        item.innerHTML += `
            <div class="scp-memory-item-body">
                <div class="scp-memory-item-key">${escHtml(mem.key)}</div>
                <div class="scp-memory-item-val-ph"></div>
                <div class="scp-memory-item-meta">${escHtml(timeStr)}</div>
            </div>
            <div class="scp-memory-item-actions">
                <button class="scp-memory-item-toggle" title="${mem.disabled ? 'Enable Memory' : 'Disable Memory'}">
                    <i class="fa-solid ${mem.disabled ? 'fa-toggle-off' : 'fa-toggle-on'}"></i>
                </button>
                <button class="scp-memory-item-edit" title="Edit"><i class="fa-solid fa-pen"></i></button>
                <button class="scp-memory-item-del" title="Delete"><i class="fa-solid fa-trash"></i></button>
            </div>
        `;
        const valEl = document.createElement('div');
        valEl.className = 'scp-memory-item-val';
        const isLong = mem.value.length > 120;
        valEl.textContent = isLong ? mem.value.slice(0, 120) + '…' : mem.value;
        if (isLong) {
            valEl.style.cursor = 'pointer';
            valEl.title = 'Click to expand';
            let expanded = false;
            valEl.addEventListener('click', e => {
                e.stopPropagation();
                expanded = !expanded;
                valEl.textContent = expanded ? mem.value : mem.value.slice(0, 120) + '…';
                valEl.title = expanded ? 'Click to collapse' : 'Click to expand';
            });
        }
        item.querySelector('.scp-memory-item-val-ph').replaceWith(valEl);
        
        item.querySelector('.scp-memory-item-toggle').addEventListener('click', e => {
            e.stopPropagation();
            mem.disabled = !mem.disabled;
            _dbgAdd('MEM_TOGGLE_DISABLE', { id: mem.id, disabled: mem.disabled });
            saveSettings();
            renderMemoryList();
        });

        item.querySelector('.scp-memory-item-edit').addEventListener('click', async e => {
            e.stopPropagation();
            await editMemoryDialog(mem.id);
        });
        
        item.querySelector('.scp-memory-item-del').addEventListener('click', async e => {
            e.stopPropagation();
            const ok = await showCustomDialog({ type: 'confirm', title: 'Delete Memory', message: `Delete memory "${mem.key}"?` });
            if (!ok) return;
            deleteMemory(mem.id);
            renderMemoryList();
        });
        return item;
    };

    const buildDetails = (title, icon, contentEls, open = false) => {
        if (!contentEls || contentEls.length === 0) return null;
        const det = document.createElement('details');
        det.className = 'scp-mem-tree-details';
        if (open) det.open = true;
        const sum = document.createElement('summary');
        sum.className = 'scp-mem-tree-summary';
        sum.innerHTML = `<i class="fa-solid fa-${icon}"></i> ${escHtml(title)}`;
        const content = document.createElement('div');
        content.className = 'scp-mem-tree-content';
        contentEls.forEach(el => content.appendChild(el));
        det.appendChild(sum);
        det.appendChild(content);
        return det;
    };

    if (tree.global.length > 0) {
        const globDet = buildDetails('Global', 'globe', tree.global.map(createMemEl), true);
        if (globDet) listEl.appendChild(globDet);
    }

    const charKeys = Object.keys(tree.characters);
    if (charKeys.length > 0) {
        const charContent = [];
        
        charKeys.forEach(charId => {
            const cNode = tree.characters[charId];
            const nodeContent = [];
            
            cNode.memories.forEach(m => nodeContent.push(createMemEl(m)));
            
            const chatKeys = Object.keys(cNode.chats);
            if (chatKeys.length > 0) {
                const chatsWrapper = [];
                chatKeys.forEach(chatId => {
                    const chatNode = cNode.chats[chatId];
                    const chatContent = [];
                    chatNode.memories.forEach(m => chatContent.push(createMemEl(m)));
                    
                    const sessKeys = Object.keys(chatNode.sessions);
                    if (sessKeys.length > 0) {
                        const sessWrapper = [];
                        sessKeys.forEach(sessId => {
                            const sNode = chatNode.sessions[sessId];
                            const sEls = sNode.memories.map(createMemEl);
                            const sDet = buildDetails(sNode.name, 'bolt', sEls);
                            if (sDet) sessWrapper.push(sDet);
                        });
                        if (sessWrapper.length > 0) {
                            const sMainDet = buildDetails('Sessions', 'layer-group', sessWrapper);
                            if (sMainDet) chatContent.push(sMainDet);
                        }
                    }
                    
                    const cDet = buildDetails(chatNode.name, 'comments', chatContent);
                    if (cDet) chatsWrapper.push(cDet);
                });
                
                if (chatsWrapper.length > 0) {
                    const cMainDet = buildDetails('Chats', 'folder', chatsWrapper);
                    if (cMainDet) nodeContent.push(cMainDet);
                }
            }
            
            const charDet = buildDetails(cNode.name, 'user', nodeContent, true);
            if (charDet) charContent.push(charDet);
        });
        
        const charsMainDet = buildDetails('Characters', 'users', charContent, true);
        if (charsMainDet) listEl.appendChild(charsMainDet);
    }
}

export async function editMemoryDialog(id) {
    const mem = id ? getMemories()[id] : null;
    const isNew = !id;
    const result = await new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'scp-dialog-overlay';
        
        const scopeOptions = [
            {val: 'global', text: 'Global (All chats)'},
            {val: 'character', text: 'Character (All chats with this character)'},
            {val: 'chat', text: 'Chat (Only this specific chat)'},
            {val: 'session', text: 'Session (Only this Copilot session)'}
        ];
        const currentScope = mem?.scope || 'character';

        const scopeHtml = scopeOptions.map(o => `<option value="${o.val}" ${currentScope === o.val ? 'selected' : ''}>${o.text}</option>`).join('');

        overlay.innerHTML = `<div class="scp-dialog-box">
<div class="scp-dialog-title">${isNew ? 'Add Memory' : 'Edit Memory'}</div>
<div class="scp-dialog-msg">Category / Key:</div>
<input type="text" class="scp-dialog-input" id="scp-mem-key-inp" placeholder="e.g. Preferences, About Me, Profession..." value="${escHtml(mem?.key || '')}">
<div class="scp-dialog-msg" style="margin-top:4px">Value:</div>
<textarea class="scp-dialog-input" id="scp-mem-val-inp" rows="3" placeholder="What to remember..." style="height:auto;resize:vertical;margin-bottom:10px;">${escHtml(mem?.value || '')}</textarea>
<div class="scp-dialog-msg" style="margin-top:4px">Scope:</div>
<select class="scp-dialog-input" id="scp-mem-scope-inp" style="margin-bottom:20px;">
${scopeHtml}
</select>
<div class="scp-dialog-btns">
<button class="scp-dialog-btn scp-dialog-cancel">Cancel</button>
<button class="scp-dialog-btn scp-dialog-ok">${isNew ? 'Add' : 'Save'}</button>
</div></div>`;
        document.body.appendChild(overlay);
        const keyInp = overlay.querySelector('#scp-mem-key-inp');
        const valInp = overlay.querySelector('#scp-mem-val-inp');
        const scopeInp = overlay.querySelector('#scp-mem-scope-inp');
        const okBtn = overlay.querySelector('.scp-dialog-ok');
        const cancelBtn = overlay.querySelector('.scp-dialog-cancel');
        const close = val => { overlay.classList.remove('visible'); setTimeout(() => overlay.remove(), 150); resolve(val); };
        keyInp.focus();
        okBtn.addEventListener('click', () => close({ key: keyInp.value, value: valInp.value, scope: scopeInp.value }));
        cancelBtn.addEventListener('click', () => close(null));
        overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
        keyInp.addEventListener('keydown', e => { if (e.key === 'Tab') { e.preventDefault(); valInp.focus(); } });
        requestAnimationFrame(() => overlay.classList.add('visible'));
    });
    
    if (!result?.key?.trim() || !result?.value?.trim()) return;

    _dbgAdd(isNew ? 'MEM_CREATE_MANUAL' : 'MEM_EDIT_MANUAL', { key: result.key, scope: result.scope });
    
    if (isNew) { addMemory(result.key, result.value, result.scope); }
    else { 
        const m = getMemories()[id];
        updateMemory(id, result.key, result.value);
        m.scope = result.scope; 
        const { charId, chatId } = getBindingKey();
        const ctx = SillyTavern.getContext();
        m.charId = charId;
        m.charName = ctx.characters?.[charId]?.name || charId;
        m.chatId = chatId;
        m.chatName = chatId;
        m.sessionId = getCurrentSession()?.id;
        m.sessionName = getCurrentSession()?.name;
        saveSettings();
    }
    renderMemoryList();
}

export function setupMemorySettingsUI() {
    const s = getSettings();
    
    const bindCheck = (id, key) => {
        const el = document.getElementById(id); if (!el) return;
        const newEl = el.cloneNode(true); 
        el.parentNode.replaceChild(newEl, el);
        newEl.checked = !!s[key];
        newEl.addEventListener('change', () => {
            getSettings()[key] = newEl.checked;
            saveSettings();
            
            const stMap = {
                'memoryEnabled': 'scp-memory-enabled',
                'memoryInject': 'scp-memory-inject'
            };
            if (stMap[key]) {
                const stEl = document.getElementById(stMap[key]);
                if (stEl) stEl.checked = newEl.checked;
            }
        });
    };
    
    bindCheck('scp-sp-memory-enabled', 'memoryEnabled');
    bindCheck('scp-sp-memory-inject', 'memoryInject');
    bindCheck('scp-sp-memory-notify', 'memoryNotify');

    const promptEl = document.getElementById('scp-sp-memory-prompt');
    if (promptEl) {
        promptEl.value = s.memoryManagePrompt || DEFAULT_MEMORY_PROMPT;
        const newPromptEl = promptEl.cloneNode(true);
        promptEl.parentNode.replaceChild(newPromptEl, promptEl);
        newPromptEl.addEventListener('input', () => {
            getSettings().memoryManagePrompt = newPromptEl.value;
            saveSettings();
            const stEl = document.getElementById('scp-memory-prompt');
            if (stEl) stEl.value = newPromptEl.value;
        });
    }

    const resetBtn = document.getElementById('scp-sp-reset-memory-prompt');
    if (resetBtn) {
        const newResetBtn = resetBtn.cloneNode(true);
        resetBtn.parentNode.replaceChild(newResetBtn, resetBtn);
        newResetBtn.addEventListener('click', async () => {
            const ok = await showCustomDialog({ type: 'confirm', title: 'Reset Prompt', message: 'Reset memory prompt to default?' });
            if (!ok) return;
            getSettings().memoryManagePrompt = DEFAULT_MEMORY_PROMPT;
            saveSettings();
            const el = document.getElementById('scp-sp-memory-prompt'); if (el) el.value = DEFAULT_MEMORY_PROMPT;
            const stEl = document.getElementById('scp-memory-prompt'); if (stEl) stEl.value = DEFAULT_MEMORY_PROMPT;
            toastr.success('Prompt reset.', EXT_DISPLAY);
        });
    }

    const addBtn = document.getElementById('scp-sp-memory-add-btn');
    if (addBtn) {
        const newAddBtn = addBtn.cloneNode(true);
        addBtn.parentNode.replaceChild(newAddBtn, addBtn);
        newAddBtn.addEventListener('click', async () => {
            await editMemoryDialog(null);
        });
    }
    
    const clearBtn = document.getElementById('scp-sp-memory-clear-all');
    if (clearBtn) {
        const newClearBtn = clearBtn.cloneNode(true);
        clearBtn.parentNode.replaceChild(newClearBtn, clearBtn);
        newClearBtn.addEventListener('click', async () => {
            const count = Object.keys(getMemories()).length;
            if (!count) { toastr.info('No memories to clear.', EXT_DISPLAY); return; }
            const ok = await showCustomDialog({ type: 'confirm', title: 'Clear All Memories', message: `Delete all ${count} stored memories? This cannot be undone.`, delayConfirm: 2 });
            if (!ok) return;
            clearAllMemories();
            renderMemoryList();
            toastr.success('All memories cleared.', EXT_DISPLAY);
        });
    }

    renderMemoryList();
    updateMemoryDot();
}