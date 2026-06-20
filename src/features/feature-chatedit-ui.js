import { EXT_DISPLAY, I } from '../constants.js';
import { getSettings, saveSettings, getCurrentSession, addMessage, saveSessionsToMetadata } from '../session.js';
import { escHtml } from '../utils/util-dom.js';
import { applySearchReplaceToField } from '../utils/util-text.js';
import { openTextDiffModal } from '../utils/util-diff.js';
import { stripChatChangesBlock, reconstructChatChangesBlock, _resolveStMsgByIndexOrId } from './feature-chatedit-engine.js';
import { bringWindowToFront } from '../ui/ui-window.js';

import { addHistoryToSwipe, _renderMsgBodyContent } from '../ui/ui-chat.js';
import { appendLBHistoryEl } from './feature-lorebook-ui.js';

export function logChatEditHistory(changes, statusStr, afterMsgId = null) {
    if (!changes?.length) return;
    try {
        const session = getCurrentSession();
        const icon = statusStr === 'Applied' ? '✓' : (statusStr === 'Rejected' ? '✕' : '·');
        const actionText = statusStr === 'Applied' ? 'ACCEPTED' : (statusStr === 'Rejected' ? 'REJECTED' : 'DISMISSED');
        
        const newLines = changes.map(c => {
            let target = `\`#${escHtml(c.msg_index ?? c.msg_id ?? '?')}\``;
            if (c.msg_range && Array.isArray(c.msg_range)) target = `[${c.msg_range[0]}–${c.msg_range[1]}]`;
            if (Array.isArray(c.msg_indices) && c.msg_indices.length) target = `[${c.msg_indices.join(', ')}]`;
            let extras = c.affectedCount !== undefined ? ` (${c.affectedCount} affected)` : '';
            return `${icon} **${actionText}**: \`${escHtml(c.action)}\` on message ${target}${extras}`;
        });
        
        if (afterMsgId && addHistoryToSwipe(afterMsgId, newLines)) return;

        const histText = `**System Notification** — Chat message edits:\n${newLines.join('\n')}`;
        const msg = addMessage(session, 'system', histText, { isChatEditHistory: true, isLBHistory: true, appliedLines: [...newLines] });
        appendLBHistoryEl(msg);
    } catch(_) {}
}

export function renderChatProposalCard(changes, msgEl) {
    if (!changes?.length) return;
    document.querySelector(`.scp-chat-proposal-card[data-for="${msgEl.dataset.id}"]`)?.remove();

    const ctx = SillyTavern.getContext();
    const stMsgs = ctx.chat || [];
    const editableChanges = changes.map(c => JSON.parse(JSON.stringify(c)));
    const itemStates = editableChanges.map(() => 'pending');

    const ACTION_LABELS = { 
        add: '<i class="fa-solid fa-square-plus" style="margin-right: 4px;"></i> Add', 
        replace: '<i class="fa-solid fa-pen-to-square" style="margin-right: 4px;"></i> Replace', 
        overwrite: '<i class="fa-solid fa-rotate" style="margin-right: 4px;"></i> Overwrite', 
        prepend: '<i class="fa-solid fa-arrow-up" style="margin-right: 4px;"></i> Prepend', 
        append: '<i class="fa-solid fa-arrow-down" style="margin-right: 4px;"></i> Append', 
        bulk_replace: '<i class="fa-solid fa-list-check" style="margin-right: 4px;"></i> Bulk', 
        regex: '<i class="fa-solid fa-terminal" style="margin-right: 4px;"></i> Regex', 
        delete: '<i class="fa-solid fa-trash" style="margin-right: 4px;"></i> Delete', 
        hide: '<i class="fa-solid fa-eye-slash" style="margin-right: 4px;"></i> Hide', 
        unhide: '<i class="fa-solid fa-eye" style="margin-right: 4px;"></i> Unhide',
        rename_chat: '<i class="fa-solid fa-tag" style="margin-right: 4px;"></i> Rename Chat' 
    };
    
    const card = document.createElement('div');
    card.className = 'scp-lb-proposal-card scp-chat-proposal-card';
    card.dataset.for = msgEl.dataset.id;
    card.style.margin = '8px 0 0 0';

    const stripAndSave = () => {
        const session = getCurrentSession();
        const msg = session.messages.find(m => m.id === card.dataset.for);
        if (msg) { 
            msg.content = stripChatChangesBlock(msg.content); 
            if (msg.swipes) msg.swipes[msg.swipeIndex || 0].content = msg.content;
            saveSessionsToMetadata(); 
        }
    };

    const persistState = () => {};
    const getPending = () => itemStates.filter(s => s === 'pending').length;
    const checkAllResolved = () => { 
        if (getPending() === 0) { 
            stripAndSave(); 
            card.remove(); 
            const msg = getCurrentSession().messages.find(m => m.id === msgEl.dataset.id);
            if (msg) _renderMsgBodyContent(msgEl, msg);
        } 
    };

    const validateChatChange = (change) => {
        const stMsgs = SillyTavern.getContext().chat || [];
        if (change.action === 'rename_chat') {
            return { valid: !!(change.name && change.name.trim()), reason: 'Chat name cannot be empty' };
        }
        if (change.action === 'add') {
            if (!['user', 'assistant', 'system'].includes(change.role)) return { valid: false, reason: 'Invalid role' };
            if (change.msg_index < 0 || change.msg_index > stMsgs.length + 1) return { valid: false, reason: 'Index out of bounds' };
            return { valid: true };
        }
        let startIdx, endIdx;
        if (['bulk_replace', 'regex', 'hide', 'unhide'].includes(change.action)) {
            if (Array.isArray(change.msg_indices) && change.msg_indices.length) {
                const invalid = change.msg_indices.filter(i => i < 0 || i >= stMsgs.length);
                if (invalid.length) return { valid: false, reason: `Indices out of bounds: ${invalid.join(', ')}` };
                if (change.action === 'hide' || change.action === 'unhide') return { valid: true };
                if (change.action === 'bulk_replace') {
                    let anyMatch = false;
                    for (const i of change.msg_indices) {
                        let content = stMsgs[i].mes || '', thisMsgMatch = true;
                        for (const rp of (change.replacements || [])) {
                            if (!rp.search && !rp.anchor) continue;
                            const { matched } = applySearchReplaceToField(content, rp.search || rp.anchor, rp.replace || '');
                            if (!matched) { thisMsgMatch = false; break; }
                        }
                        if (thisMsgMatch && change.replacements?.length > 0) anyMatch = true;
                    }
                    if (!anyMatch) return { valid: false, reason: 'Anchors not found in the specified messages' };
                } else if (change.action === 'regex') {
                    try {
                        const m = (change.regex || '').match(/^\/([\s\S]+)\/([a-z]*)$/i);
                        const re = m ? new RegExp(m[1], m[2]) : new RegExp(change.regex, 'g');
                        const anyMatch = change.msg_indices.some(i => re.test(stMsgs[i].mes || ''));
                        if (!anyMatch) return { valid: false, reason: 'Regex matched nothing in the specified messages' };
                    } catch(e) { return { valid: false, reason: 'Invalid regex syntax' }; }
                }
                return { valid: true };
            }
            if (Array.isArray(change.msg_range)) {
                startIdx = change.msg_range[0]; endIdx = change.msg_range[1];
            } else if (change.msg_index !== undefined) {
                startIdx = change.msg_index; endIdx = change.msg_index;
            } else return { valid: false, reason: 'Target index or range not specified' };
            
            if (startIdx < 0 || endIdx >= stMsgs.length || startIdx > endIdx) return { valid: false, reason: `Range [${startIdx}-${endIdx}] is out of bounds` };

            if (change.action === 'hide' || change.action === 'unhide') return { valid: true };
            
            let anyMatch = false;
            if (change.action === 'bulk_replace') {
                for (let i = startIdx; i <= endIdx; i++) {
                    let content = stMsgs[i].mes || '';
                    let thisMsgMatch = true;
                    for (const rp of (change.replacements || [])) {
                        if (!rp.search && !rp.anchor) continue;
                        const { matched } = applySearchReplaceToField(content, rp.search || rp.anchor, rp.replace || '');
                        if (!matched) { thisMsgMatch = false; break; }
                    }
                    if (thisMsgMatch && change.replacements?.length > 0) anyMatch = true;
                }
                if (!anyMatch) return { valid: false, reason: 'Anchors not found in the specified range' };
            } else if (change.action === 'regex') {
                try {
                    const m = (change.regex || '').match(/^\/([\s\S]+)\/([a-z]*)$/i);
                    const re = m ? new RegExp(m[1], m[2]) : new RegExp(change.regex, 'g');
                    for (let i = startIdx; i <= endIdx; i++) {
                        if (re.test(stMsgs[i].mes || '')) { anyMatch = true; break; }
                    }
                    if (!anyMatch) return { valid: false, reason: 'Regex matched nothing in the specified range' };
                } catch(e) { return { valid: false, reason: 'Invalid regex syntax' }; }
            }
            return { valid: true };
        } else {
            if (Array.isArray(change.msg_indices) && change.msg_indices.length) {
                const invalid = change.msg_indices.filter(i => i < 0 || i >= stMsgs.length);
                if (invalid.length) return { valid: false, reason: `Indices out of bounds: ${invalid.join(', ')}` };
                if (change.action === 'replace') {
                    for (const idx of change.msg_indices) {
                        let content = stMsgs[idx].mes || '';
                        for (const patch of (change.patches || [])) {
                            const { matched } = applySearchReplaceToField(content, patch.search || patch.anchor || '', patch.replace || '');
                            if (!matched) return { valid: false, reason: `ANCHOR not found in #${idx}: "${(patch.search || patch.anchor || '').slice(0, 40)}..."` };
                        }
                    }
                }
                return { valid: true };
            }
            const resolved = _resolveStMsgByIndexOrId(change);
            if (!resolved) return { valid: false, reason: `Message not found (Index: ${change.msg_index ?? change.msg_id})` };

            if (change.action === 'replace') {
                let content = resolved.msg.mes || '';
                for (const patch of (change.patches || [])) {
                    const { matched } = applySearchReplaceToField(content, patch.search || patch.anchor || '', patch.replace || '');
                    if (!matched) return { valid: false, reason: `ANCHOR not found: "${(patch.search || patch.anchor || '').slice(0, 40)}..."` };
                }
            }
            return { valid: true };
        }
    };

    const getChatChangeResult = (change, content) => {
        if (change.action === 'overwrite') return change.content || '';
        if (change.action === 'replace') {
            let c = content;
            for (const p of (change.patches || [])) {
                const { result } = applySearchReplaceToField(c, p.search || p.anchor || '', p.replace || '');
                c = result;
            }
            return c;
        }
        if (change.action === 'bulk_replace') {
            let c = content;
            for (const p of (change.replacements || [])) {
                const { result } = applySearchReplaceToField(c, p.search || p.anchor || '', p.replace || '');
                c = result;
            }
            return c;
        }
        if (change.action === 'regex') {
            let c = content;
            try {
                const m = (change.regex || '').match(/^\/([\s\S]+)\/([a-z]*)$/i);
                const re = m ? new RegExp(m[1], m[2]) : new RegExp(change.regex, 'g');
                c = c.replace(re, change.replace || '');
            } catch(e) {}
            return c;
        }
        return content;
    };

    const header = document.createElement('div');
    header.className = 'scp-lb-proposal-header';
    const headerLeft = document.createElement('div');
    headerLeft.style.cssText = 'display:flex;align-items:center;gap:8px;flex:1;min-width:0';
    const countBadge = document.createElement('span');
    countBadge.className = 'scp-lb-proposal-count';
    countBadge.textContent = `${editableChanges.length} pending`;
    headerLeft.innerHTML = `<span class="scp-lb-proposal-icon" style="color:var(--scp-accent);display:flex">${I.chatEdit}</span><span class="scp-lb-proposal-title">Proposed Chat Edits</span>`;
    headerLeft.appendChild(countBadge);
    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'scp-lb-proposal-dismiss'; dismissBtn.innerHTML = I.x; dismissBtn.title = 'Dismiss all';
    dismissBtn.addEventListener('click', () => {
        const pending = editableChanges.filter((_, i) => itemStates[i] === 'pending');
        if (pending.length > 0) logChatEditHistory(pending, 'Dismissed', card.dataset.for);
        itemStates.forEach((s, i) => { if (s === 'pending') itemStates[i] = 'dismissed'; });
        stripAndSave(); card.remove();
    });
    header.appendChild(headerLeft); header.appendChild(dismissBtn);

    const list = document.createElement('div');
    list.className = 'scp-lb-proposal-list';

    const itemEls = editableChanges.map((c, ci) => {
        const item = document.createElement('div');
        const actionCls = c.action === 'delete' ? 'scp-lb-proposal-delete' : (c.action === 'overwrite' || c.action === 'bulk_replace' || c.action === 'regex' ? 'scp-lb-proposal-edit' : 'scp-lb-proposal-add');
        item.className = `scp-lb-proposal-item ${actionCls}`;

        const hdr = document.createElement('div');
        hdr.className = 'scp-lb-proposal-item-header';

        const meta = document.createElement('div');
        meta.style.cssText = 'display:flex;align-items:center;gap:8px;flex:1;flex-wrap:wrap;min-width:0';
        
        const targetDescEl = document.createElement('span');
        targetDescEl.className = 'scp-lb-proposal-name scp-lb-pn-target';
        
        const updateTargetDesc = () => {
            const change = editableChanges[ci];
            let targetDesc = '';
            if (change.action === 'rename_chat') {
                targetDesc = `Current chat`;
            } else if (change.action === 'add') {
                targetDesc = `Insert at #${change.msg_index} (${change.role})`;
            } else if (Array.isArray(change.msg_indices) && change.msg_indices.length) {
                targetDesc = `msgs [${change.msg_indices.join(', ')}]`;
            } else if (['bulk_replace', 'regex', 'hide', 'unhide'].includes(change.action)) {
                if (change.msg_range) targetDesc = `msgs [${change.msg_range[0]}–${change.msg_range[1]}]`;
                else targetDesc = `msg #${change.msg_index}`;
            } else {
                const resolved = _resolveStMsgByIndexOrId(change);
                targetDesc = resolved ? `#${resolved.idx} ${stMsgs[resolved.idx]?.is_user ? '(user)' : '(assistant)'}` : `Index ${change.msg_index ?? change.msg_id}`;
            }
            targetDescEl.textContent = targetDesc;
        };
        updateTargetDesc();

        const actionBadge = document.createElement('span');
        actionBadge.className = 'scp-lb-proposal-action';
        actionBadge.innerHTML = ACTION_LABELS[c.action] || c.action;
        
        meta.appendChild(actionBadge);
        meta.appendChild(targetDescEl);
        
        const warnEl = document.createElement('div');
        warnEl.style.cssText = 'font-size:10px;color:var(--scp-danger);margin-top:4px;width:100%;display:none;cursor:pointer;';
        warnEl.title = 'Click to open the edit panel and fix manually';
        meta.appendChild(warnEl);

        const btns = document.createElement('div');
        btns.className = 'scp-lb-proposal-item-btns';

        if (['replace', 'overwrite', 'bulk_replace', 'regex'].includes(c.action)) {
            const diffBtn = document.createElement('button');
            diffBtn.className = 'scp-lb-proposal-diff-btn'; diffBtn.title = 'View diff'; diffBtn.innerHTML = I.diff;
            diffBtn.addEventListener('click', e => {
                e.stopPropagation();
                const ctx = SillyTavern.getContext();
                const stMsgs = ctx.chat || [];
                const change = editableChanges[ci];
                let targetIdxList = [];
                if (Array.isArray(change.msg_indices) && change.msg_indices.length) {
                    targetIdxList = change.msg_indices.filter(i => stMsgs[i]);
                } else {
                    let startIdx = change.msg_index !== undefined ? change.msg_index : (change.msg_range ? change.msg_range[0] : null);
                    let endIdx = change.msg_index !== undefined ? change.msg_index : (change.msg_range ? change.msg_range[1] : null);
                    if (startIdx === null || endIdx === null) { toastr.warning('Message index not specified.', EXT_DISPLAY); return; }
                    for (let i = Math.max(0, startIdx); i <= Math.min(stMsgs.length - 1, endIdx); i++) { if (stMsgs[i]) targetIdxList.push(i); }
                }

                if (!targetIdxList.length) { toastr.warning(`Message(s) not found — chat may have changed since this proposal was generated.`, EXT_DISPLAY, { timeOut: 7000 }); return; }
                
                let origCombined = [];
                let newCombined = [];
                let changesFound = 0;
                
                for (const i of targetIdxList) {
                    const origText = stMsgs[i].mes || '';
                    const newText = getChatChangeResult(change, origText);
                    
                    if (origText !== newText || targetIdxList.length === 1) {
                        const prefix = targetIdxList.length > 1 ? `[Message #${i}]\n` : '';
                        origCombined.push(prefix + origText);
                        newCombined.push(prefix + newText);
                        changesFound++;
                    }
                }

                if (changesFound === 0) {
                    toastr.info('No changes would be made to these messages.', EXT_DISPLAY);
                    return;
                }

                const finalOrig = origCombined.join('\n\n' + '—'.repeat(30) + '\n\n');
                const finalNew = newCombined.join('\n\n' + '—'.repeat(30) + '\n\n');
                const title = targetIdxList.length === 1
                    ? `Diff: ${stMsgs[targetIdxList[0]]?.is_user ? 'User' : 'Copilot/Char'} Message #${targetIdxList[0]}`
                    : `Diff: Messages [${targetIdxList.join(', ')}]`;

                openTextDiffModal(title, finalOrig, finalNew);
            });
            btns.appendChild(diffBtn);
        }

        let editToggleBtn = null;
        let editPanel = null;
        if (c.action !== 'delete') {
            editToggleBtn = document.createElement('button');
            editToggleBtn.className = 'scp-lb-proposal-edit-toggle'; editToggleBtn.title = 'Edit before applying'; editToggleBtn.textContent = '✎';
            btns.appendChild(editToggleBtn);
        }

        const applyBtn = document.createElement('button');
        applyBtn.className = 'scp-lb-proposal-item-apply'; applyBtn.title = 'Apply'; applyBtn.textContent = '✓';
        
        const refreshValidation = () => {
            const { valid, reason } = validateChatChange(editableChanges[ci]);
            if (!valid) {
                applyBtn.disabled = true; applyBtn.title = reason;
                item.style.borderLeftColor = 'var(--scp-danger)';
                warnEl.textContent = `⚠ ${reason}`; warnEl.style.display = 'block';
            } else {
                applyBtn.disabled = false; applyBtn.title = 'Apply';
                item.style.borderLeftColor = ''; 
                warnEl.style.display = 'none';
            }
        };

        import('./feature-chatedit-engine.js').then(module => {
            applyBtn.addEventListener('click', async e => {
                e.stopPropagation();
                if (itemStates[ci] !== 'pending' || applyBtn.disabled) return;
                
                applyBtn.disabled = true; 
                applyBtn.textContent = '…';
                
                itemStates[ci] = 'applied';
                item.classList.add('scp-lb-item-applied');
                btns.querySelectorAll('button').forEach(b => { b.disabled = true; });
                persistState(); 
                countBadge.textContent = `${getPending()} pending`; 
                updateFooterBtns(); 
                syncBlockToMessage(); 

                try {
                    await module.applyChatChanges([editableChanges[ci]], card.dataset.for);
                    checkAllResolved();
                } catch(err) {
                    itemStates[ci] = 'pending';
                    item.classList.remove('scp-lb-item-applied');
                    btns.querySelectorAll('button').forEach(b => { b.disabled = false; });
                    persistState(); 
                    countBadge.textContent = `${getPending()} pending`; 
                    updateFooterBtns(); 
                    syncBlockToMessage(); 

                    toastr.error(`Failed: ${err.message}`, EXT_DISPLAY);
                    applyBtn.disabled = false; 
                    applyBtn.textContent = '✓';
                }
            });
        });
        const rejectBtn = document.createElement('button');
        rejectBtn.className = 'scp-lb-proposal-item-reject'; rejectBtn.title = 'Reject'; rejectBtn.textContent = '✕';
        rejectBtn.addEventListener('click', e => {
            e.stopPropagation();
            if (itemStates[ci] !== 'pending') return;
            itemStates[ci] = 'rejected';
            item.classList.add('scp-lb-item-rejected');
            btns.querySelectorAll('button').forEach(b => { b.disabled = true; });
            logChatEditHistory([editableChanges[ci]], 'Rejected', card.dataset.for);
            persistState(); countBadge.textContent = `${getPending()} pending`; updateFooterBtns(); syncBlockToMessage(); checkAllResolved();
        });
        btns.appendChild(applyBtn); btns.appendChild(rejectBtn);
        hdr.appendChild(meta); hdr.appendChild(btns);
        item.appendChild(hdr);

        const buildPreview = () => {
            const change = editableChanges[ci];
            if (change.action === 'rename_chat') return `New Name: ${change.name || ''}`;
            if (change.action === 'hide') return 'Exclude message(s) from AI prompt context.';
            if (change.action === 'unhide') return 'Include message(s) back into AI context.';
            if (change.action === 'replace' && change.patches?.length) {
                const target = Array.isArray(change.msg_indices) && change.msg_indices.length
                    ? ` (msgs ${change.msg_indices.join(', ')})` : '';
                return change.patches.map((p, pi) => `Patch ${pi+1}${target}: "${(p.search||p.anchor||'').slice(0,60)}" → "${(p.replace||'').slice(0,60)}"`).join('\n');
            }
            if (change.action === 'bulk_replace' && change.replacements?.length) {
                return change.replacements.map(r => `"${(r.search||r.anchor||'').slice(0,40)}" → "${(r.replace||'').slice(0,40)}"`).join('\n');
            }
            if (change.action === 'regex') {
                return `Regex: ${change.regex}\nReplace: ${change.replace || ''}`;
            }
            return change.content || '';
        };
        let _expanded = false;
        const previewEl = document.createElement('div');
        previewEl.className = 'scp-lb-proposal-preview';
        previewEl.style.whiteSpace = 'pre-wrap';
        const refreshPreview = () => {
            const raw = buildPreview();
            previewEl.textContent = (!_expanded && raw.length > 140) ? raw.slice(0, 140) + '…' : raw;
        };
        refreshPreview();
        previewEl.style.cursor = 'pointer';
        previewEl.addEventListener('click', e => { e.stopPropagation(); _expanded = !_expanded; refreshPreview(); });
        item.appendChild(previewEl);

        if (c.action !== 'delete') {
            editPanel = document.createElement('div');
            editPanel.className = 'scp-lb-proposal-edit-panel';
            editPanel.style.display = 'none';

            const mkRow = (labelHtml, el) => {
                const row = document.createElement('div'); row.className = 'scp-lb-pe-row';
                const lbl = document.createElement('label'); lbl.className = 'scp-lb-pe-label'; lbl.innerHTML = labelHtml;
                row.appendChild(lbl); row.appendChild(el); return row;
            };

            const rebuildEditPanel = () => {
                editPanel.innerHTML = '';
                const change = editableChanges[ci];
                
                if (change.action === 'rename_chat') {
                    const nameTa = document.createElement('input');
                    nameTa.type = 'text'; nameTa.className = 'scp-lb-pe-input';
                    nameTa.value = change.name || '';
                    nameTa.addEventListener('input', () => { change.name = nameTa.value; refreshPreview(); });
                    editPanel.appendChild(mkRow('New Name', nameTa));
                    return;
                }
                
                if (Array.isArray(change.msg_indices) && change.msg_indices.length) {
                    const idxInp = document.createElement('input');
                    idxInp.type = 'text'; idxInp.className = 'scp-lb-pe-input';
                    idxInp.value = change.msg_indices.join(', ');
                    idxInp.placeholder = 'e.g. 12, 17, 19';
                    idxInp.addEventListener('input', () => {
                        change.msg_indices = idxInp.value.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
                        refreshPreview(); refreshValidation(); updateTargetDesc();
                    });
                    editPanel.appendChild(mkRow('Message Indices (comma-separated)', idxInp));
                } else if (change.msg_range) {
                    const rangeRow = document.createElement('div');
                    rangeRow.style.cssText = 'display:flex;gap:8px;';
                    const sInp = document.createElement('input'); sInp.type='number'; sInp.className='scp-lb-pe-input'; sInp.value=change.msg_range[0];
                    const eInp = document.createElement('input'); eInp.type='number'; eInp.className='scp-lb-pe-input'; eInp.value=change.msg_range[1];
                    sInp.addEventListener('input', () => { change.msg_range[0] = parseInt(sInp.value)||0; refreshPreview(); refreshValidation(); updateTargetDesc(); });
                    eInp.addEventListener('input', () => { change.msg_range[1] = parseInt(eInp.value)||0; refreshPreview(); refreshValidation(); updateTargetDesc(); });
                    rangeRow.append(sInp, eInp);
                    editPanel.appendChild(mkRow('Msg Range (Start - End)', rangeRow));
                } else if (change.msg_index !== undefined || change.msg_id !== undefined) {
                    const idxInp = document.createElement('input'); idxInp.type='number'; idxInp.className='scp-lb-pe-input'; idxInp.value=change.msg_index ?? change.msg_id;
                    idxInp.addEventListener('input', () => { change.msg_index = parseInt(idxInp.value)||0; refreshPreview(); refreshValidation(); updateTargetDesc(); });
                    editPanel.appendChild(mkRow('Message Index', idxInp));
                }

                if (['hide', 'unhide'].includes(change.action)) {
                    return;
                }
                if (change.action === 'add') {
                    const roleSel = document.createElement('select');
                    roleSel.className = 'scp-lb-pe-input';
                    ['user', 'assistant', 'system'].forEach(r => {
                        const opt = document.createElement('option'); opt.value = r; opt.textContent = r;
                        roleSel.appendChild(opt);
                    });
                    roleSel.value = change.role || 'assistant';
                    roleSel.addEventListener('change', () => { change.role = roleSel.value; refreshValidation(); updateTargetDesc(); });
                    editPanel.appendChild(mkRow('Role', roleSel));

                    const valueTa = document.createElement('textarea');
                    valueTa.className = 'scp-lb-pe-textarea'; 
                    valueTa.rows = 4; 
                    valueTa.placeholder = 'Type the message content here...';
                    valueTa.value = change.content || '';
                    valueTa.addEventListener('input', () => { 
                        change.content = valueTa.value; 
                        refreshPreview(); 
                        refreshValidation(); 
                    });
                    editPanel.appendChild(mkRow('Content', valueTa));
                } else if (change.action === 'replace') {
                    (change.patches || []).forEach((patch, pi) => {
                        const pHdr = document.createElement('div');
                        pHdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:4px';
                        pHdr.innerHTML = `<span style="font-size:10px;font-weight:700;color:var(--scp-accent);text-transform:uppercase;letter-spacing:.04em">Patch ${pi+1}</span>`;
                        if (change.patches.length > 1) {
                            const delP = document.createElement('button');
                            delP.style.cssText = 'background:none;border:none;color:var(--scp-danger);cursor:pointer;font-size:11px;padding:0;font-family:var(--scp-font)';
                            delP.textContent = '✕ Remove';
                            delP.addEventListener('click', () => { change.patches.splice(pi, 1); rebuildEditPanel(); refreshPreview(); refreshValidation(); });
                            pHdr.appendChild(delP);
                        }
                        editPanel.appendChild(pHdr);
                        const searchTa = document.createElement('textarea');
                        searchTa.className = 'scp-lb-pe-textarea'; searchTa.rows = 2; searchTa.value = patch.search || patch.anchor || '';
                        searchTa.addEventListener('input', () => { change.patches[pi].search = searchTa.value; refreshPreview(); refreshValidation(); });
                        const replaceTa = document.createElement('textarea');
                        replaceTa.className = 'scp-lb-pe-textarea'; replaceTa.rows = 3; replaceTa.value = patch.replace || '';
                        replaceTa.addEventListener('input', () => { change.patches[pi].replace = replaceTa.value; refreshPreview(); refreshValidation(); });
                        editPanel.appendChild(mkRow('Anchor', searchTa));
                        editPanel.appendChild(mkRow('Replace', replaceTa));
                    });
                    const addPatchBtn = document.createElement('button');
                    addPatchBtn.className = 'scp-action-btn'; addPatchBtn.style.marginTop = '8px';
                    addPatchBtn.innerHTML = `${I.plus}<span>Add Patch</span>`;
                    addPatchBtn.addEventListener('click', () => { change.patches.push({ search: '', replace: '' }); rebuildEditPanel(); });
                    editPanel.appendChild(addPatchBtn);
                } else if (change.action === 'bulk_replace') {
                    (change.replacements || []).forEach((rp, ri) => {
                        const searchTa = document.createElement('textarea');
                        searchTa.className = 'scp-lb-pe-textarea'; searchTa.rows = 1; searchTa.value = rp.search || rp.anchor || '';
                        searchTa.addEventListener('input', () => { change.replacements[ri].search = searchTa.value; refreshPreview(); refreshValidation(); });
                        const replaceTa = document.createElement('textarea');
                        replaceTa.className = 'scp-lb-pe-textarea'; replaceTa.rows = 1; replaceTa.value = rp.replace || '';
                        replaceTa.addEventListener('input', () => { change.replacements[ri].replace = replaceTa.value; refreshPreview(); refreshValidation(); });
                        editPanel.appendChild(mkRow(`Replace pair ${ri+1} — Anchor`, searchTa));
                        editPanel.appendChild(mkRow('Replace', replaceTa));
                    });
                } else if (change.action === 'regex') {
                    const regTa = document.createElement('textarea');
                    regTa.className = 'scp-lb-pe-textarea'; regTa.rows = 1; regTa.value = change.regex || '';
                    regTa.addEventListener('input', () => { change.regex = regTa.value; refreshPreview(); refreshValidation(); });
                    editPanel.appendChild(mkRow('Regex Pattern', regTa));
                    
                    const replTa = document.createElement('textarea');
                    replTa.className = 'scp-lb-pe-textarea'; replTa.rows = 2; replTa.value = change.replace || '';
                    replTa.addEventListener('input', () => { change.replace = replTa.value; refreshPreview(); refreshValidation(); });
                    editPanel.appendChild(mkRow('Replace', replTa));
                } else {
                    const valueTa = document.createElement('textarea');
                    valueTa.className = 'scp-lb-pe-textarea'; valueTa.rows = 5; valueTa.value = change.content || '';
                    valueTa.addEventListener('input', () => { change.content = valueTa.value; refreshPreview(); refreshValidation(); });
                    editPanel.appendChild(mkRow('Content', valueTa));
                }
            };
            rebuildEditPanel();
            item.appendChild(editPanel);

            if (editToggleBtn) {
                const toggleEditPanel = (e) => {
                    e.stopPropagation();
                    const isOpen = editPanel.style.display !== 'none';
                    editPanel.style.display = isOpen ? 'none' : 'flex';
                    previewEl.style.display = isOpen ? '' : 'none';
                    editToggleBtn.classList.toggle('active', !isOpen);
                    if (!isOpen) rebuildEditPanel();
                };
                editToggleBtn.addEventListener('click', toggleEditPanel);
                
                warnEl.addEventListener('click', (e) => {
                    if (editPanel.style.display === 'none') toggleEditPanel(e);
                });
            }
        }

        refreshValidation();

        list.appendChild(item);
        return item;
    });

    itemEls.forEach((el, i) => {
        if (itemStates[i] === 'applied') {
            el.classList.add('scp-lb-item-applied');
            el.querySelectorAll('button').forEach(b => { b.disabled = true; });
        } else if (itemStates[i] === 'rejected') {
            el.classList.add('scp-lb-item-rejected');
            el.querySelectorAll('button').forEach(b => { b.disabled = true; });
        }
    });

    const syncBlockToMessage = () => {
        const session = getCurrentSession();
        const msg = session.messages.find(m => m.id === card.dataset.for);
        if (!msg) return;
        const pending = editableChanges.filter((_, i) => itemStates[i] === 'pending');
        const stripped = stripChatChangesBlock(msg.content);
        if (pending.length === 0) {
            msg.content = stripped;
        } else {
            msg.content = stripped + '\n\n' + reconstructChatChangesBlock(pending);
        }
        if (msg.swipes) msg.swipes[msg.swipeIndex || 0].content = msg.content;
        saveSessionsToMetadata();
    };

    const footer = document.createElement('div');
    footer.className = 'scp-lb-proposal-footer';
    const applyAllBtn = document.createElement('button');
    applyAllBtn.className = 'scp-lb-proposal-apply'; applyAllBtn.textContent = 'Apply All';
    const rejectAllBtn = document.createElement('button');
    rejectAllBtn.className = 'scp-lb-proposal-reject'; rejectAllBtn.textContent = 'Reject All';

    const updateFooterBtns = () => {
        const p = getPending();
        applyAllBtn.style.display = p > 0 ? '' : 'none';
        rejectAllBtn.style.display = p > 0 ? '' : 'none';
    };
    updateFooterBtns();

    import('./feature-chatedit-engine.js').then(module => {
        applyAllBtn.addEventListener('click', async () => {
            const pendingIndices = [];
            editableChanges.forEach((_, i) => { if (itemStates[i] === 'pending') pendingIndices.push(i); });
            const pending = pendingIndices.map(i => editableChanges[i]);
            if (!pending.length) return;
            applyAllBtn.disabled = true; applyAllBtn.textContent = 'Applying…';
            
            pendingIndices.forEach(i => {
                itemStates[i] = 'applied';
                itemEls[i]?.classList.add('scp-lb-item-applied');
                itemEls[i]?.querySelectorAll('button').forEach(b => { b.disabled = true; });
            });
            persistState(); 
            countBadge.textContent = `${getPending()} pending`; 
            updateFooterBtns(); 
            syncBlockToMessage(); 

            try {
                await module.applyChatChanges(pending, card.dataset.for);
                checkAllResolved();
            } catch(e) {
                pendingIndices.forEach(i => {
                    itemStates[i] = 'pending';
                    itemEls[i]?.classList.remove('scp-lb-item-applied');
                    itemEls[i]?.querySelectorAll('button').forEach(b => { b.disabled = false; });
                });
                persistState(); 
                countBadge.textContent = `${getPending()} pending`; 
                updateFooterBtns(); 
                syncBlockToMessage(); 
                
                toastr.error(`Failed: ${e.message}`, EXT_DISPLAY);
                applyAllBtn.disabled = false; 
                applyAllBtn.textContent = 'Apply All';
            }
        });
    });

    rejectAllBtn.addEventListener('click', () => {
        const pending = editableChanges.filter((_, i) => itemStates[i] === 'pending');
        itemStates.forEach((s, i) => { if (s === 'pending') { itemStates[i] = 'rejected'; itemEls[i]?.classList.add('scp-lb-item-rejected'); itemEls[i]?.querySelectorAll('button').forEach(b => { b.disabled = true; }); } });
        logChatEditHistory(pending, 'Rejected', card.dataset.for);
        persistState(); countBadge.textContent = `${getPending()} pending`; updateFooterBtns(); syncBlockToMessage(); checkAllResolved();
    });

    footer.appendChild(applyAllBtn); footer.appendChild(rejectAllBtn);
    card.appendChild(header); card.appendChild(list); card.appendChild(footer);
    const body = msgEl.querySelector('.scp-msg-body');
    if (body) body.insertBefore(card, body.querySelector('.scp-swipe-bar'));
    else msgEl.after(card);
    bringWindowToFront();
}