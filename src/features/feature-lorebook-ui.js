import { EXT_DISPLAY, I, THEME_PRESETS, EMBEDDED_BOOK_KEY } from '../constants.js';
import { state } from '../state.js';
import { getSettings, saveSettings, getCurrentSession, addMessage, deleteMsg, saveSessionsToMetadata } from '../session.js';
import { _dbgAdd } from '../utils/util-debug.js';
import { escHtml, showCustomDialog, copyText } from '../utils/util-dom.js';
import { fetchWorldInfoBook, saveWorldInfoBook, wiEntriesToArray, getDisplayName, getActiveLorebookNames, getEntryOverrideKey, buildLorebookContextBlock, stripLBChangesBlock, resolveLBChangeTarget, bindNewLorebookToCharacter, wiCache, lastActiveEntries } from './feature-lorebook-engine.js';
import { applySearchReplaceToField } from '../utils/util-text.js';
import { openTextDiffModal } from '../utils/util-diff.js';

import { applyCustomTheme, bringWindowToFront } from '../ui/ui-window.js';
import { updateMsgCount, scrollToBottom, _renderMsgBodyContent, addHistoryToSwipe } from '../ui/ui-chat.js';
import { recordStat, SM } from './feature-stats.js';

export function reconstructLBChangesBlock(pendingChanges) {
    if (!pendingChanges.length) return '';
    return '```lorebook-changes\n{"changes": ' + JSON.stringify(pendingChanges, null, 2) + '}\n```';
}

export function openDiffModal(change, originalEntry) {
    const originalContent = originalEntry?.content || '';
    let newContent = change.content || '';
    
    if (change.action === 'patch' && originalEntry) {
        let current = originalContent;
        for (const patch of (change.patches || [])) {
            const { result } = applySearchReplaceToField(current, patch.search || patch.anchor || '', patch.replace || '');
            current = result;
        }
        newContent = current;
    } else if (change.action === 'prepend' && originalEntry) {
        newContent = (change.content || '') + originalContent;
    } else if (change.action === 'append' && originalEntry) {
        newContent = originalContent + (change.content || '');
    }
    
    const entryName = change.name || originalEntry?.comment || `Entry #${change.uid || '?'}`;
    const title = `Diff: "${entryName}" in ${change.worldName || '?'}`;
    openTextDiffModal(title, originalContent, newContent);
}

export function renderLBHistoryContent(msg, contentEl) {
    contentEl.innerHTML = '';
    const lines = msg.appliedLines || [];
    const accepted = lines.filter(l => l.includes('ACCEPTED')).length;
    const rejected = lines.filter(l => l.includes('REJECTED')).length;
    const dismissed = lines.filter(l => l.includes('DISMISSED')).length;

    const summaryParts = [];
    if (accepted) summaryParts.push(`${accepted} applied`);
    if (rejected) summaryParts.push(`${rejected} rejected`);
    if (dismissed) summaryParts.push(`${dismissed} dismissed`);
    const summaryStr = summaryParts.length ? summaryParts.join(', ') : `${lines.length} change${lines.length !== 1 ? 's' : ''}`;

    const summaryRow = document.createElement('div');
    summaryRow.style.cssText = 'font-size:12px;font-weight:600;color:var(--scp-text);margin-bottom:4px';
    summaryRow.textContent = `System Notification: ${summaryStr}`;
    contentEl.appendChild(summaryRow);

    if (lines.length) {
        const details = document.createElement('details');
        details.className = 'scp-hist-details';
        const summary = document.createElement('summary');
        summary.className = 'scp-hist-summary';
        summary.textContent = 'Show details';
        details.appendChild(summary);

        const detailsBody = document.createElement('div');
        detailsBody.className = 'scp-hist-body';
        for (const line of lines) {
            const stripped = line.replace(/\*\*/g, '').replace(/`/g, '');
            const isAccepted = stripped.includes('ACCEPTED');
            const isRejected = stripped.includes('REJECTED') && !stripped.includes('DISMISSED');
            const dot = document.createElement('div');
            dot.className = 'scp-hist-item';
            dot.style.cssText = `display:flex;align-items:baseline;gap:6px;padding:2px 0;font-size:11px;color:${isAccepted ? 'var(--scp-success)' : isRejected ? 'var(--scp-danger)' : 'var(--scp-text-muted)'}`;
            const marker = document.createElement('span');
            marker.style.cssText = `width:5px;height:5px;border-radius:50%;background:currentColor;flex-shrink:0;margin-top:5px;display:inline-block`;
            const text = document.createElement('span');
            const m2 = stripped.match(/(?:ACCEPTED|REJECTED|DISMISSED[^:]*): (.+)/);
            text.textContent = m2 ? m2[1] : stripped;
            dot.appendChild(marker);
            dot.appendChild(text);
            detailsBody.appendChild(dot);
        }
        details.appendChild(detailsBody);
        contentEl.appendChild(details);
    }
}

export function appendLBHistoryEl(msg, afterMsgId = null) {
    const c = document.getElementById('scp-messages');
    if (!c) return;
    c.querySelector('.scp-empty-state')?.remove();

    const wrap = document.createElement('div');
    wrap.className = 'scp-msg scp-msg-lb-history';
    wrap.dataset.id = msg.id;

    const avatar = document.createElement('div');
    avatar.className = 'scp-msg-avatar scp-msg-avatar-lb';
    
    if (msg.isCharEditHistory) {
        avatar.innerHTML = '<i class="fa-solid fa-user-pen" style="font-size:14px; padding-left:1px;"></i>';
    } else if (msg.isChatEditHistory) {
        avatar.innerHTML = '<i class="fa-solid fa-comments" style="font-size:14px; padding-left:1px;"></i>';
    } else {
        avatar.innerHTML = I.book;
    }

    const body = document.createElement('div');
    body.className = 'scp-msg-body';

    const contentEl = document.createElement('div');
    contentEl.className = 'scp-msg-content scp-lb-history-content';
    renderLBHistoryContent(msg, contentEl);

    const meta = document.createElement('div');
    meta.className = 'scp-msg-meta';
    meta.textContent = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const closeBtn = document.createElement('button');
    closeBtn.className = 'scp-msg-btn scp-lb-history-close';
    closeBtn.innerHTML = I.x;
    closeBtn.title = 'Dismiss notification';
    closeBtn.addEventListener('click', () => {
        const session = getCurrentSession();
        deleteMsg(session, msg.id);
        wrap.remove();
        updateMsgCount(session);
    });

    body.appendChild(contentEl);
    body.appendChild(closeBtn);
    body.appendChild(meta);
    wrap.appendChild(avatar); wrap.appendChild(body);
    
    const anchor = afterMsgId
        ? (c.querySelector(`.scp-lb-proposal-card[data-for="${afterMsgId}"]`) || c.querySelector(`.scp-msg[data-id="${afterMsgId}"]`))
        : null;
    if (anchor) anchor.after(wrap);
    else c.appendChild(wrap);
    updateMsgCount(getCurrentSession());
    if (!anchor) scrollToBottom();
}

export function logLBHistoryChanges(changes, statusStr, afterMsgId = null) {
    if (!changes || !changes.length) return;
    try {
        const session = getCurrentSession();
        const icons = { add: '✚', edit: '✎', patch: '✂', delete: '✕' };
        const statusIcon = statusStr === 'Accepted' ? '✓' : (statusStr === 'Rejected' ? '✕' : '·');
        const actionText = statusStr === 'Accepted' ? 'ACCEPTED' : (statusStr === 'Rejected' ? 'REJECTED' : 'DISMISSED (ignored)');

        const newLines = changes.map(c => {
            const act = (c.action || 'edit').toUpperCase();
            return `${statusIcon} **${actionText}**: ${icons[c.action] || '·'} ${act} "${escHtml(c.name || c.originalName || `Entry #${c.uid || '?'}`)}" in \`${escHtml(c.worldName || '?')}\``;
        });

        if (afterMsgId && addHistoryToSwipe(afterMsgId, newLines)) return;

        const histText = `**System Notification** — User interaction with proposed lorebook changes:\n${newLines.join('\n')}`;
        const histMsg = addMessage(session, 'system', histText, { isLBHistory: true, appliedLines: [...newLines] });
        appendLBHistoryEl(histMsg);
    } catch (_) {}
}

export async function applyLBChanges(changes, afterMsgId = null) {
    console.log(`[${EXT_DISPLAY}] applyLBChanges: processing ${changes.length} change(s)`, JSON.parse(JSON.stringify(changes)));
    const bookCache = {};
    const successfulChanges =[];

    for (const change of changes) {
        let { bookName, data, origEntry } = await resolveLBChangeTarget(change);

        if (change.worldName && change.action !== 'delete') {
            const activeBooks = getActiveLorebookNames();
            
            if (!activeBooks.includes(change.worldName)) {
                await bindNewLorebookToCharacter(change.worldName);
                
                const resolved = await resolveLBChangeTarget(change);
                bookName = resolved.bookName;
                data = resolved.data;
                origEntry = resolved.origEntry;
            }
        }

        if (!data) {
            const msg = `Lorebook not found: "${change.worldName || '(empty)'}" — is it active in this chat?`;
            toastr.error(`[LB] ${msg}`, EXT_DISPLAY, { timeOut: 10000 });
            console.error(`[${EXT_DISPLAY}] applyLBChanges: ${msg}`, change);
            continue;
        }
        if (!bookName) {
            toastr.error(`[LB] Could not resolve book name for change: "${change.name || change.uid || '?'}"`, EXT_DISPLAY, { timeOut: 10000 });
            continue;
        }

        if (change.action === 'add' && data) {
            const exists = Object.values(data.entries).find(e => e.comment && e.comment.toLowerCase() === (change.name || '').toLowerCase());
            if (exists) {
                _dbgAdd('LB_ADD_CONVERTED_TO_EDIT', { bookName, change, originalUid: exists.uid });
                change.action = 'edit';
                change.uid = exists.uid;
                origEntry = exists;
            }
        }

        if (change.action === 'add') {
            const uids = Object.keys(data.entries).map(Number);
            const newUid = uids.length ? Math.max(...uids) + 1 : 1;
            const isOutlet = !!(change.outlet || change.outlet_name);
            const outletName = (change.outlet_name || '').trim();
            const addTriggers = isOutlet ? [] : (Array.isArray(change.triggers) ? change.triggers : []);
            const autoConstant = !isOutlet && (addTriggers.length === 0) && change.constant !== false;
            data.entries[newUid] = {
                uid: newUid,
                key: addTriggers,
                keysecondary: [],
                content: change.content || '',
                comment: change.name || '',
                disable: false,
                selective: false,
                constant: !isOutlet && (change.constant === true || autoConstant),
                position: isOutlet ? 7 : (change.position ?? 0),
                displayIndex: newUid,
                automation_id: outletName,
                outletName: outletName,
                group: change.group || (isOutlet ? outletName : ''),
                role: null,
                extensions: {
                    outlet_name: outletName
                }
            };
            bookCache[bookName] = data;
            wiCache[bookName] = data;
            successfulChanges.push(change);
        } else if (change.action === 'edit') {
            if (!origEntry) {
                toastr.error(`[LB] Entry not found for edit: "${change.name || change.uid || '?'}" in "${bookName}"`, EXT_DISPLAY, { timeOut: 10000 });
                continue;
            }
            if (change.name !== undefined) origEntry.comment = change.name;
            if (change.triggers !== null && change.triggers !== undefined) {
                origEntry.key = change.triggers;
                if (change.triggers.length === 0 && origEntry.key.length === 0 && change.constant !== false) origEntry.constant = true;
            }
            if (change.content !== undefined) origEntry.content = change.content;
            if (change.constant !== undefined) origEntry.constant = !!change.constant;
            if (change.outlet !== undefined || change.outlet_name !== undefined) {
                const oName = (change.outlet_name || '').trim();
                if (!origEntry.extensions) origEntry.extensions = {};
                if (change.outlet || oName) {
                    origEntry.position = 7;
                    origEntry.automation_id = oName;
                    origEntry.outletName = oName;
                    origEntry.group = oName;
                    origEntry.constant = false;
                    origEntry.extensions.outlet_name = oName;
                } else {
                    origEntry.position = change.position ?? 0;
                    origEntry.automation_id = '';
                    origEntry.outletName = '';
                    origEntry.group = '';
                    origEntry.extensions.outlet_name = '';
                }
            }
            bookCache[bookName] = data;
            wiCache[bookName] = data;
            successfulChanges.push(change);
        } else if (change.action === 'patch') {
            if (!origEntry) {
                toastr.error(`[LB] Entry not found for patch: "${change.name || change.uid || '?'}" in "${bookName}"`, EXT_DISPLAY, { timeOut: 10000 });
                continue;
            }
            let current = origEntry.content || '';
            let allMatched = true;
            for (const patch of (change.patches || [])) {
                const { result, matched } = applySearchReplaceToField(current, patch.search || '', patch.replace || '');
                if (!matched) {
                    toastr.warning(`[LB] SEARCH not found in "${origEntry.comment}": "${(patch.search || '').slice(0, 60)}"`, EXT_DISPLAY, { timeOut: 8000 });
                    allMatched = false;
                    break;
                }
                current = result;
            }
            if (!allMatched) continue;
            origEntry.content = current;
            if (change.name !== undefined) origEntry.comment = change.name;
            if (change.triggers !== null && change.triggers !== undefined) {
                origEntry.key = change.triggers;
                if (change.triggers.length === 0 && change.constant !== false) origEntry.constant = true;
            }
            if (change.constant !== undefined) origEntry.constant = !!change.constant;
            bookCache[bookName] = data;
            wiCache[bookName] = data;
            successfulChanges.push(change);
        } else if (change.action === 'prepend' || change.action === 'append') {
            if (!origEntry) continue;
            let current = origEntry.content || '';
            origEntry.content = change.action === 'prepend' ? (change.content || '') + current : current + (change.content || '');
            if (change.name !== undefined) origEntry.comment = change.name;
            if (change.triggers !== null && change.triggers !== undefined) {
                origEntry.key = change.triggers;
                if (change.triggers.length === 0 && change.constant !== false) origEntry.constant = true;
            }
            if (change.constant !== undefined) origEntry.constant = !!change.constant;
            bookCache[bookName] = data;
            wiCache[bookName] = data;
            successfulChanges.push(change);
        } else if (change.action === 'delete') {
            if (!origEntry) continue;
            delete data.entries[origEntry.uid];
            bookCache[bookName] = data;
            wiCache[bookName] = data;
            successfulChanges.push(change);
        }
    }

    if (changes.length > 0 && !Object.keys(bookCache).length) {
        toastr.warning('[LB] No changes were applied — see browser console (F12) for details', EXT_DISPLAY, { timeOut: 10000 });
        return;
    }

    for (const [name, data] of Object.entries(bookCache)) {
        try {
            await saveWorldInfoBook(name, data);
        } catch (e) {
            toastr.error(`[LB] Save failed for "${name}": ${e.message}`, EXT_DISPLAY, { timeOut: 12000 });
        }
    }

    if (successfulChanges.length > 0) {
        recordStat(SM.lb, successfulChanges.length);
        logLBHistoryChanges(successfulChanges, 'Accepted', afterMsgId);
    }
}

export function renderProposalCard(changes, msgEl) {
    if (!changes?.length) return;
    _dbgAdd('LB_PROPOSAL_CARD_RENDER', { msgId: msgEl.dataset.id, changesCount: changes.length });

    document.querySelector(`.scp-lb-proposal-card[data-for="${msgEl.dataset.id}"]`)?.remove();

    const editableChanges = changes.map(c => ({ ...c }));
    const itemStates = editableChanges.map(() => 'pending');
    const actionLabels = { add: '+ Add', edit: '✎ Edit', patch: '✂ Patch', prepend: '⬆ Prepend', append: '⬇ Append', delete: '✕ Remove' };

    const card = document.createElement('div');
    card.className = 'scp-lb-proposal-card';
    card.dataset.for = msgEl.dataset.id;
    card.style.margin = '8px 0 0 0';

    const syncBlockToMessage = () => {
        const session = getCurrentSession();
        const msg = session.messages.find(m => m.id === card.dataset.for);
        if (!msg) return;
        const pending = editableChanges.filter((_, i) => itemStates[i] === 'pending');
        const stripped = stripLBChangesBlock(msg.content);
        if (pending.length === 0) {
            msg.content = stripped;
        } else {
            msg.content = stripped + '\n\n' + reconstructLBChangesBlock(pending);
        }
        if (msg.swipes) msg.swipes[msg.swipeIndex || 0].content = msg.content;
        saveSessionsToMetadata();
    };

    const getPendingCount = () => itemStates.filter(s => s === 'pending').length;
    const getAppliedCount = () => itemStates.filter(s => s === 'applied').length;
    const checkAllResolved = () => { if (getPendingCount() === 0) { syncBlockToMessage(); card.remove(); } };

    const header = document.createElement('div');
    header.className = 'scp-lb-proposal-header';
    const headerLeft = document.createElement('div');
    headerLeft.style.cssText = 'display:flex;align-items:center;gap:8px;flex:1;min-width:0';
    headerLeft.innerHTML = `<span class="scp-lb-proposal-icon">${I.book}</span><span class="scp-lb-proposal-title">Proposed Lorebook Changes</span>`;

    const countBadge = document.createElement('span');
    countBadge.className = 'scp-lb-proposal-count';
    countBadge.textContent = `${editableChanges.length} pending`;
    headerLeft.appendChild(countBadge);

    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'scp-lb-proposal-dismiss';
    dismissBtn.innerHTML = I.x; dismissBtn.title = 'Dismiss';
    dismissBtn.addEventListener('click', () => {
        const dismissedChanges = editableChanges.filter((_, i) => itemStates[i] === 'pending');
        _dbgAdd('LB_PROPOSAL_ACTION', { action: 'dismissed', msgId: card.dataset.for, dismissedCount: dismissedChanges.length });
        if (dismissedChanges.length > 0) logLBHistoryChanges(dismissedChanges, 'Dismissed', card.dataset.for);
        itemStates.forEach((s, i) => { if (s === 'pending') itemStates[i] = 'dismissed'; });
        syncBlockToMessage(); card.remove();
    });

    header.appendChild(headerLeft); header.appendChild(dismissBtn);

    const list = document.createElement('div');
    list.className = 'scp-lb-proposal-list';
    const itemEls = [];

    editableChanges.forEach((c, ci) => {
        const item = document.createElement('div');
        item.className = `scp-lb-proposal-item scp-lb-proposal-${c.action || 'edit'}`;

        const itemHeader = document.createElement('div');
        itemHeader.className = 'scp-lb-proposal-item-header';

        const itemMeta = document.createElement('div');
        itemMeta.style.cssText = 'display:flex;align-items:center;gap:8px;flex:1;min-width:0;flex-wrap:wrap';
        itemMeta.innerHTML = `<span class="scp-lb-proposal-action">${escHtml(actionLabels[c.action] || c.action || '?')}</span><span class="scp-lb-proposal-name scp-lb-pn-target">${escHtml(c.name || c.originalName || `Entry #${c.uid || '?'}`)}</span>${c.constant ? '<span class="scp-lb-src-badge scp-lb-src-global" style="font-size:9px;padding:1px 5px" title="Constant entry">★</span>' : ''}`;

        const warnEl = document.createElement('div');
        warnEl.style.cssText = 'font-size:10px;color:var(--scp-danger);margin-top:4px;width:100%;display:none;cursor:pointer;';
        warnEl.title = 'Click to open the edit panel and fix manually';
        itemMeta.appendChild(warnEl);

        const _activeBooks = getActiveLorebookNames();
        const _currentBook = editableChanges[ci].worldName || '';

        const worldDd = document.createElement('div');
        worldDd.className = 'scp-lb-proposal-world-dd';

        const worldTrigger = document.createElement('button');
        worldTrigger.className = 'scp-lb-proposal-world-trigger';
        worldTrigger.type = 'button';

        const worldTriggerText = document.createElement('span');
        worldTriggerText.className = 'scp-lb-proposal-world-trigger-text';
        worldTriggerText.textContent = `in ${getDisplayName(_currentBook) || '?'}`;

        const worldChevronEl = document.createElement('span');
        worldChevronEl.className = 'scp-lb-proposal-world-chevron';
        worldChevronEl.innerHTML = I.chevron;

        worldTrigger.appendChild(worldTriggerText);
        worldTrigger.appendChild(worldChevronEl);

        const worldPanel = document.createElement('div');
        worldPanel.className = 'scp-lb-proposal-world-panel';

        let _selectedBook = _currentBook;

        const buildWorldPanelItems = (items) => {
            worldPanel.innerHTML = '';
            if (!items.length) {
                const empty = document.createElement('div');
                empty.className = 'scp-lb-proposal-world-empty';
                empty.textContent = 'No active lorebooks';
                worldPanel.appendChild(empty);
            }
            items.forEach(name => {
                const item2 = document.createElement('div');
                item2.className = `scp-lb-proposal-world-item${name === _selectedBook ? ' active' : ''}`;
                item2.dataset.value = name;
                item2.innerHTML = `<span class="scp-lb-proposal-world-item-dot"></span><span>${getDisplayName(name)}</span>`;
                item2.addEventListener('click', () => selectBook(name));
                worldPanel.appendChild(item2);
            });
            if (c.action === 'add') {
                const sep = document.createElement('div'); sep.className = 'scp-lb-proposal-world-sep';
                worldPanel.appendChild(sep);
                const newItem = document.createElement('div');
                newItem.className = 'scp-lb-proposal-world-item scp-lb-proposal-world-new';
                newItem.innerHTML = `<span>${I.plus}</span><span>Create new lorebook…</span>`;
                newItem.addEventListener('click', async () => {
                    worldPanel.classList.remove('open'); worldTrigger.classList.remove('open');
                    const name = await showCustomDialog({ type: 'prompt', title: 'New Lorebook Name', message: 'Enter name for the new lorebook:', placeholder: 'My Lorebook' });
                    if (name?.trim()) {
                        const n = name.trim();
                        if (!_activeBooks.includes(n)) _activeBooks.push(n);
                        buildWorldPanelItems(_activeBooks);
                        selectBook(n);
                    }
                });
                worldPanel.appendChild(newItem);
            }
        };

        const _validateBookEntry = async (bookName) => {
            worldTrigger.classList.add('loading');
            const checkChange = { ...editableChanges[ci], worldName: bookName };
            if (bookName !== editableChanges[ci].worldName) delete checkChange.uid;
            
            const resolved = await resolveLBChangeTarget(checkChange, true);
            worldTrigger.classList.remove('loading');

            const found = !!resolved.origEntry;
            if (found) {
                const orig = resolved.origEntry;
                const n = orig.comment || `Entry #${orig.uid}`;
                editableChanges[ci].originalName = n;
                if (!editableChanges[ci].name) editableChanges[ci].name = n;
                
                const nameEl = item.querySelector('.scp-lb-pn-target');
                if (nameEl) nameEl.textContent = n;

                const nameInput = item.querySelector('.scp-lb-name-input');
                if (nameInput && !nameInput.value) nameInput.value = n;

                if (editableChanges[ci].triggers === null) {
                    const origKeys = orig.key || [];
                    editableChanges[ci].triggers = [...origKeys];
                    const tEl = item.querySelector('.scp-lb-proposal-triggers');
                    if (tEl) tEl.textContent = origKeys.length ? `Keys: ${origKeys.join(', ')}` : 'Keys: none';
                    const tInput = item.querySelector('.scp-lb-trig-input');
                    if (tInput && !tInput.value) { tInput.value = origKeys.join(', '); tInput.placeholder = ''; }
                }
            }

            if (found && resolved.bookName && resolved.bookName !== bookName) {
                editableChanges[ci].worldName = resolved.bookName;
                _selectedBook = resolved.bookName;
                worldPanel.querySelectorAll('.scp-lb-proposal-world-item').forEach(el => el.classList.toggle('active', el.dataset.value === resolved.bookName));
                worldTriggerText.textContent = `in ${getDisplayName(resolved.bookName)}`;
                toastr.info(`Entry found in "<b>${escHtml(getDisplayName(resolved.bookName))}</b>" instead — lorebook switched automatically.`, EXT_DISPLAY, { escapeHtml: false });
            } else {
                worldTriggerText.textContent = found ? `in ${getDisplayName(bookName)}` : `in ${getDisplayName(bookName)} ⚠`;
            }

            let isValid = found;
            let reason = found ? '' : 'Entry not found in selected lorebook';
            if (found && editableChanges[ci].action === 'patch') {
                const orig = resolved.origEntry;
                let current = orig?.content || '';
                for (const patch of (editableChanges[ci].patches || [])) {
                    const { result, matched } = applySearchReplaceToField(current, patch.search || patch.anchor || '', patch.replace || '');
                    if (!matched) { isValid = false; reason = `ANCHOR not found: "${(patch.search || patch.anchor || '').slice(0, 40)}..."`; break; }
                    current = result;
                }
            }

            if (!isValid) {
                applyItemBtn.disabled = true; applyItemBtn.title = reason;
                item.style.borderLeftColor = 'var(--scp-danger)';
                warnEl.textContent = `⚠ ${reason}`; warnEl.style.display = 'block';
            } else {
                applyItemBtn.disabled = false; applyItemBtn.title = 'Apply this change';
                item.style.borderLeftColor = ''; warnEl.style.display = 'none';
            }
            worldTrigger.classList.toggle('warn', !found);
        };

        const selectBook = async (name) => {
            _selectedBook = name;
            editableChanges[ci].worldName = name;
            worldTriggerText.textContent = `in ${getDisplayName(name)}`;
            worldTrigger.classList.remove('warn');
            worldPanel.querySelectorAll('.scp-lb-proposal-world-item').forEach(el => el.classList.toggle('active', el.dataset.value === name));
            worldPanel.classList.remove('open'); worldTrigger.classList.remove('open');
            if (c.action !== 'add') await _validateBookEntry(name);
        };

        worldTrigger.addEventListener('click', e => {
            e.stopPropagation();
            const isOpen = worldPanel.classList.contains('open');
            document.querySelectorAll('.scp-lb-proposal-world-panel.open').forEach(p => { p.classList.remove('open'); p.previousElementSibling?.classList.remove('open'); });
            if (!isOpen) {
                const rect = worldTrigger.getBoundingClientRect();
                worldPanel.style.top = `${rect.bottom + 4}px`; worldPanel.style.left = `${rect.left}px`;
                worldPanel.classList.add('open'); worldTrigger.classList.add('open');
            }
        });

        const _allBooks = [..._activeBooks];
        if (_currentBook && !_activeBooks.includes(_currentBook)) _allBooks.unshift(_currentBook);
        buildWorldPanelItems(_allBooks);
        worldDd.appendChild(worldTrigger); worldDd.appendChild(worldPanel);

        const itemBtns = document.createElement('div');
        itemBtns.className = 'scp-lb-proposal-item-btns';

        let editToggleBtn = null;
        if (c.action !== 'delete') {
            editToggleBtn = document.createElement('button');
            editToggleBtn.className = 'scp-lb-proposal-edit-toggle';
            editToggleBtn.title = 'Edit before applying'; editToggleBtn.textContent = '✎';
            itemBtns.appendChild(editToggleBtn);
        }

        if (['edit', 'patch', 'prepend', 'append'].includes(c.action)) {
            const diffBtn = document.createElement('button');
            diffBtn.className = 'scp-lb-proposal-diff-btn';
            diffBtn.title = 'View diff'; diffBtn.innerHTML = I.diff;
            diffBtn.addEventListener('click', async e => {
                e.stopPropagation();
                const change = editableChanges[ci];
                const { origEntry } = await resolveLBChangeTarget(change);
                if (!origEntry) { toastr.warning('Could not find original entry to compare against.', EXT_DISPLAY); return; }
                openDiffModal(change, origEntry);
            });
            itemBtns.appendChild(diffBtn);
        }

        const closeEditPanel = () => {
            const editPanel = item.querySelector('.scp-lb-proposal-edit-panel');
            if (editPanel && editPanel.style.display !== 'none') {
                editPanel.style.display = 'none';
                if (previewEl) previewEl.style.display = '';
                if (triggersEl) triggersEl.style.display = '';
                if (editToggleBtn) editToggleBtn.classList.remove('active');
            }
        };

        const applyItemBtn = document.createElement('button');
        applyItemBtn.className = 'scp-lb-proposal-item-apply';
        applyItemBtn.title = 'Apply this change'; applyItemBtn.textContent = '✓';
        applyItemBtn.addEventListener('click', async e => {
            e.stopPropagation();
            if (itemStates[ci] !== 'pending') return;
            closeEditPanel();
            applyItemBtn.disabled = true; applyItemBtn.textContent = '…';
            try {
                await applyLBChanges([editableChanges[ci]], card.dataset.for);
                itemStates[ci] = 'applied'; item.classList.add('scp-lb-item-applied');
                itemBtns.querySelectorAll('button').forEach(b => { b.disabled = true; });
                updateCountBadge(); updateFooterBtns(); syncBlockToMessage(); checkAllResolved();
                toastr.success('[LB] Change applied.', EXT_DISPLAY);
            } catch (err) {
                toastr.error(`Failed: ${err.message}`, EXT_DISPLAY);
                applyItemBtn.disabled = false; applyItemBtn.textContent = '✓';
            }
        });

        const rejectItemBtn = document.createElement('button');
        rejectItemBtn.className = 'scp-lb-proposal-item-reject';
        rejectItemBtn.title = 'Reject this change'; rejectItemBtn.textContent = '✕';
        rejectItemBtn.addEventListener('click', e => {
            e.stopPropagation();
            if (itemStates[ci] !== 'pending') return;
            closeEditPanel(); itemStates[ci] = 'rejected';
            item.classList.add('scp-lb-item-rejected');
            itemBtns.querySelectorAll('button').forEach(b => { b.disabled = true; });
            logLBHistoryChanges([editableChanges[ci]], 'Rejected', card.dataset.for);
            updateCountBadge(); updateFooterBtns(); syncBlockToMessage(); checkAllResolved();
        });

        itemBtns.appendChild(applyItemBtn); itemBtns.appendChild(rejectItemBtn);
        itemHeader.appendChild(itemMeta); itemHeader.appendChild(itemBtns);
        item.appendChild(itemHeader); item.appendChild(worldDd);

        let previewEl = null, triggersEl = null;
        if (c.content) {
            previewEl = document.createElement('div');
            previewEl.className = 'scp-lb-proposal-preview';
            const isLong = c.content.length > 120;
            previewEl.textContent = isLong ? c.content.slice(0, 120) + '…' : c.content;
            if (isLong) {
                let _expanded = false;
                previewEl.title = 'Click to expand'; previewEl.style.cursor = 'pointer';
                previewEl.addEventListener('click', e => {
                    e.stopPropagation();
                    if (window.getSelection()?.toString()) return;
                    _expanded = !_expanded;
                    previewEl.textContent = _expanded ? c.content : c.content.slice(0, 120) + '…';
                    previewEl.style.whiteSpace = _expanded ? 'pre-wrap' : '';
                });
            }
            item.appendChild(previewEl);
        }
        if (c.triggers !== null && c.triggers?.length) {
            triggersEl = document.createElement('div'); triggersEl.className = 'scp-lb-proposal-triggers';
            triggersEl.textContent = 'Keys: ' + c.triggers.join(', '); item.appendChild(triggersEl);
        } else if (c.triggers === null) {
            triggersEl = document.createElement('div'); triggersEl.className = 'scp-lb-proposal-triggers';
            triggersEl.style.opacity = '0.5'; triggersEl.textContent = 'Keys: keep original'; item.appendChild(triggersEl);
        }

        if (c.action !== 'delete') {
            const editPanel = document.createElement('div');
            editPanel.className = 'scp-lb-proposal-edit-panel';
            editPanel.style.display = 'none';

            const mkRow = (labelHtml, el) => {
                const row = document.createElement('div'); row.className = 'scp-lb-pe-row';
                const lbl = document.createElement('label'); lbl.className = 'scp-lb-pe-label'; lbl.innerHTML = labelHtml;
                row.appendChild(lbl); row.appendChild(el); return row;
            };

            const nameInput = document.createElement('input');
            nameInput.type = 'text'; nameInput.className = 'scp-lb-pe-input scp-lb-name-input';
            nameInput.value = c.name || '';
            nameInput.addEventListener('input', () => { editableChanges[ci].name = nameInput.value; });
            editPanel.appendChild(mkRow('Name', nameInput));

            const trigInput = document.createElement('input');
            trigInput.type = 'text'; trigInput.className = 'scp-lb-pe-input scp-lb-trig-input';
            trigInput.value = Array.isArray(c.triggers) ? c.triggers.join(', ') : '';
            trigInput.addEventListener('input', () => {
                const val = trigInput.value.trim();
                editableChanges[ci].triggers = val === '' ? [] : val.split(',').map(t => t.trim()).filter(Boolean);
            });
            editPanel.appendChild(mkRow('Keys', trigInput));

            if (c.action === 'patch') {
                const rebuildPatches = () => {
                    const existing = editPanel.querySelector('.scp-lb-patches-wrap');
                    if (existing) existing.remove();
                    const patchWrap = document.createElement('div');
                    patchWrap.className = 'scp-lb-patches-wrap';
                    patchWrap.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-top:4px';
                    (editableChanges[ci].patches || []).forEach((patch, pi) => {
                        const searchTa = document.createElement('textarea');
                        searchTa.className = 'scp-lb-pe-textarea'; searchTa.rows = 2; searchTa.value = patch.search || '';
                        searchTa.addEventListener('input', () => { editableChanges[ci].patches[pi].search = searchTa.value; });
                        const replaceTa = document.createElement('textarea');
                        replaceTa.className = 'scp-lb-pe-textarea'; replaceTa.rows = 3; replaceTa.value = patch.replace || '';
                        replaceTa.addEventListener('input', () => { editableChanges[ci].patches[pi].replace = replaceTa.value; });
                        patchWrap.appendChild(mkRow('Anchor (range)', searchTa));
                        patchWrap.appendChild(mkRow('Replace', replaceTa));
                    });
                    editPanel.appendChild(patchWrap);
                };
                rebuildPatches();
            } else {
                const contentTa = document.createElement('textarea');
                contentTa.className = 'scp-lb-pe-textarea'; contentTa.value = c.content || '';
                contentTa.addEventListener('input', () => { editableChanges[ci].content = contentTa.value; });
                editPanel.appendChild(mkRow('Content', contentTa));
            }

            const constWrap = document.createElement('label');
            constWrap.className = 'scp-sp-check'; constWrap.style.marginTop = '6px';
            const constCb = document.createElement('input');
            constCb.type = 'checkbox'; constCb.checked = !!c.constant;
            constCb.addEventListener('change', () => { editableChanges[ci].constant = constCb.checked; });
            constWrap.appendChild(constCb); constWrap.appendChild(Object.assign(document.createElement('span'), { textContent: 'Constant (always inject)' }));
            
            const outletWrap = document.createElement('label');
            outletWrap.className = 'scp-sp-check'; outletWrap.style.marginTop = '6px';
            const outletCb = document.createElement('input');
            outletCb.type = 'checkbox'; outletCb.checked = !!c.outlet;
            outletWrap.appendChild(outletCb); outletWrap.appendChild(Object.assign(document.createElement('span'), { textContent: 'Outlet Entry' }));

            const outletNameRow = document.createElement('div');
            outletNameRow.className = 'scp-lb-pe-row';
            outletNameRow.style.display = c.outlet ? 'flex' : 'none';
            const oNameInp = document.createElement('input');
            oNameInp.type = 'text'; oNameInp.className = 'scp-lb-pe-input';
            oNameInp.value = c.outlet_name || '';
            oNameInp.placeholder = 'Outlet macro name...';
            oNameInp.addEventListener('input', () => { editableChanges[ci].outlet_name = oNameInp.value; });
            outletNameRow.innerHTML = '<label class="scp-lb-pe-label">Outlet Name</label>';
            outletNameRow.appendChild(oNameInp);

            outletCb.addEventListener('change', () => { 
                editableChanges[ci].outlet = outletCb.checked; 
                outletNameRow.style.display = outletCb.checked ? 'flex' : 'none';
            });

            editPanel.appendChild(constWrap);
            editPanel.appendChild(outletWrap);
            editPanel.appendChild(outletNameRow);

            item.appendChild(editPanel);

            if (editToggleBtn) {
                const toggleEditPanel = (e) => {
                    e.stopPropagation();
                    const isOpen = editPanel.style.display !== 'none';
                    editPanel.style.display = isOpen ? 'none' : 'flex';
                    if (previewEl) previewEl.style.display = isOpen ? '' : 'none';
                    if (triggersEl) triggersEl.style.display = isOpen ? '' : 'none';
                    editToggleBtn.classList.toggle('active', !isOpen);
                };
                editToggleBtn.addEventListener('click', toggleEditPanel);
                warnEl.addEventListener('click', (e) => { if (editPanel.style.display === 'none') toggleEditPanel(e); });
            }
        }

        list.appendChild(item);
        itemEls.push(item);
        if (c.action !== 'add' && itemStates[ci] === 'pending') _validateBookEntry(_selectedBook).catch(() => {});
    });

    const footer = document.createElement('div');
    footer.className = 'scp-lb-proposal-footer';
    const applyAllBtn = document.createElement('button');
    applyAllBtn.className = 'scp-lb-proposal-apply'; applyAllBtn.textContent = 'Apply All';
    const rejectAllBtn = document.createElement('button');
    rejectAllBtn.className = 'scp-lb-proposal-reject'; rejectAllBtn.textContent = 'Reject All';

    const updateCountBadge = () => { countBadge.textContent = getPendingCount() > 0 ? `${getPendingCount()} pending` : `${getAppliedCount()} applied`; };
    const updateFooterBtns = () => {
        applyAllBtn.style.display = getPendingCount() > 0 ? '' : 'none';
        rejectAllBtn.style.display = getPendingCount() > 0 ? '' : 'none';
    };

    applyAllBtn.addEventListener('click', async () => {
        const pending = editableChanges.filter((_, i) => itemStates[i] === 'pending');
        if (!pending.length) return;
        applyAllBtn.disabled = true; applyAllBtn.textContent = 'Applying…';
        try {
            await applyLBChanges(pending, card.dataset.for);
            itemStates.forEach((s, i) => { if (s === 'pending') { itemStates[i] = 'applied'; itemEls[i].classList.add('scp-lb-item-applied'); itemEls[i].querySelectorAll('button').forEach(b => { b.disabled = true; }); } });
            updateCountBadge(); updateFooterBtns(); checkAllResolved();
            toastr.success(`[LB] ${pending.length} changes applied.`, EXT_DISPLAY);
        } catch (e) {
            toastr.error(`Failed: ${e.message}`, EXT_DISPLAY);
            applyAllBtn.disabled = false; applyAllBtn.textContent = 'Apply All';
        }
    });

    rejectAllBtn.addEventListener('click', () => {
        const rejectedChanges = [];
        itemStates.forEach((s, i) => {
            if (s === 'pending') {
                itemStates[i] = 'rejected'; itemEls[i].classList.add('scp-lb-item-rejected');
                itemEls[i].querySelectorAll('button').forEach(b => { b.disabled = true; });
                rejectedChanges.push(editableChanges[i]);
            }
        });
        if (rejectedChanges.length > 0) logLBHistoryChanges(rejectedChanges, 'Rejected', card.dataset.for);
        updateCountBadge(); updateFooterBtns(); checkAllResolved();
    });

    footer.appendChild(applyAllBtn); footer.appendChild(rejectAllBtn);
    card.appendChild(header); card.appendChild(list); card.appendChild(footer);
    const body = msgEl.querySelector('.scp-msg-body');
    if (body) body.insertBefore(card, body.querySelector('.scp-swipe-bar'));
    else msgEl.after(card);
    bringWindowToFront();
}

export async function openLorebookManager() {
    const overlay = document.getElementById('scp-lb-overlay');
    if (!overlay) return;
    _dbgAdd('LB_UI_OPEN');
    applyCustomTheme(getSettings().customTheme || THEME_PRESETS.default);
    overlay.style.display = 'flex';
    bringWindowToFront();
    const s = getSettings();
    if (document.getElementById('scp-lb-search')) document.getElementById('scp-lb-search').value = state.lbSearchQuery;
    
    // wiCache clear logic
    Object.keys(wiCache).forEach(k => delete wiCache[k]);
    
    await buildLorebookContextBlock(s).catch(() => {});
    await refreshLorebookList().catch(e => console.error(`[${EXT_DISPLAY}] LB list:`, e));
    if (state.lbActiveBook) await renderEntryList(state.lbActiveBook, state.lbSearchQuery).catch(() => {});
}

export function closeLorebookManager() {
    document.getElementById('scp-lb-overlay').style.display = 'none';
    _dbgAdd('LB_UI_CLOSE');
}

export function _applyLBBookCheckState(item, name, s) {
    const isSelected = s.lorebookSelectedBooks.includes(name);
    const isExcluded = (s.lorebookExcludedBooks || []).includes(name);
    const check = item.querySelector('.scp-lb-book-check');
    if (!check) return;
    check.classList.remove('checked', 'excluded');
    if (isSelected) check.classList.add('checked');
    else if (isExcluded) check.classList.add('excluded');
    check.title = isSelected ? 'Selected: all entries included — click to exclude' : isExcluded ? 'Excluded: all entries blocked — click to reset' : 'Default — click to include all';
    item.classList.toggle('selected', isSelected);
    item.classList.toggle('lb-excluded', isExcluded);
    const isForced = isSelected || isExcluded;
    if (item.classList.contains('lb-book-open')) {
        const entriesEl = document.getElementById('scp-lb-entries');
        if (entriesEl) entriesEl.classList.toggle('lb-entries-dimmed', isForced);
    }
}

export async function refreshLorebookList() {
    const listEl = document.getElementById('scp-lb-book-list');
    if (!listEl) return;
    const ctx = SillyTavern.getContext();
    if (typeof ctx.updateWorldInfoList === 'function') ctx.updateWorldInfoList().catch(() => {});
    const activeNamesArray = getActiveLorebookNames();
    const s = getSettings();
    listEl.innerHTML = '';
    
    if (!activeNamesArray.length) {
        listEl.innerHTML = '<div class="scp-lb-loading">No active lorebooks found.<br><small style="opacity:.5">Link one to the character or select globally.</small></div>';
        return;
    }
    
    await Promise.all(activeNamesArray.map(name => fetchWorldInfoBook(name)));
    
    const { ST_WorldInfo, ST_Utils } = await import('../index.js');
    
    // (G)
    const globalBooks = ST_WorldInfo?.selected_world_info || (ctx.worldInfoSettings?.globalSelect || []);
        
    // (Ch)
    const chatMetadata = window.chat_metadata || ctx.chatMetadata || {};
    const chatBook = chatMetadata.world_info || null;

    // (P)
    const pu = window.power_user || ctx.powerUserSettings || {};
    let personaBook = pu.persona_description_lorebook || null;
    if (!personaBook) {
        let personaId = window.user_avatar || ctx.user_avatar || ctx.userAvatar || ctx.personaId || ctx.activePersonaId || ctx.active_persona_id;
        if (typeof personaId === 'object' && personaId !== null) personaId = personaId.avatarId || personaId.id;
        if (personaId && pu.persona_descriptions?.[personaId]?.lorebook) {
            personaBook = pu.persona_descriptions[personaId].lorebook;
        }
    }

    //(C) - Primary + Additional
    const charBooks = new Set();
    const chars = window.characters || ctx.characters || [];
    
    chars.forEach((char, idx) => {
        if (!char) return;
        
        if (char.data?.extensions?.world) {
            charBooks.add(char.data.extensions.world);
        }
        
        if (ST_WorldInfo?.world_info?.charLore && Array.isArray(ST_WorldInfo.world_info.charLore)) {
            let fileName = char.avatar ? char.avatar.replace(/\.[^/.]+$/, '') : null;
            if (ST_Utils && typeof ST_Utils.getCharaFilename === 'function') {
                fileName = ST_Utils.getCharaFilename(idx);
            }
            
            const charLore = ST_WorldInfo.world_info.charLore.find(e => e.name === fileName);
            if (charLore && Array.isArray(charLore.extraBooks)) {
                charLore.extraBooks.forEach(b => charBooks.add(b));
            }
        }
    });

    const getSourceInfo = (name) => {
        if (name === EMBEDDED_BOOK_KEY) return { cls: 'scp-lb-src-character', label: 'C', title: 'Embedded Character Lorebook' };
        
        if (name === chatBook) return { cls: 'scp-lb-src-chat', label: 'Ch', title: 'Chat Lorebook' };
        if (name === personaBook) return { cls: 'scp-lb-src-persona', label: 'P', title: 'Persona Lorebook' };
        if (charBooks.has(name)) return { cls: 'scp-lb-src-character', label: 'C', title: 'Character Lorebook (Primary or Additional)' };
        if (globalBooks.includes(name)) return { cls: 'scp-lb-src-global', label: 'G', title: 'Global Lorebook' };

        return { cls: 'scp-lb-src-global', label: 'G', title: 'Global Lorebook' };
    };

    const frag = document.createDocumentFragment();
    for (const name of activeNamesArray) {
        const displayName = getDisplayName(name);
        const isSelected = s.lorebookSelectedBooks.includes(name);
        const isExcluded = (s.lorebookExcludedBooks || []).includes(name);
        const item = document.createElement('div');
        item.className = `scp-lb-book-item${isSelected ? ' selected' : ''}${isExcluded ? ' lb-excluded' : ''}${state.lbActiveBook === name ? ' lb-book-open' : ''}`;
        item.dataset.name = name;
        
        const cached = wiCache[name];
        const entryCount = cached ? Object.keys(cached.entries || {}).length : '…';
        
        const srcInfo = getSourceInfo(name);
        const checkState = isSelected ? 'checked' : isExcluded ? 'excluded' : '';
        
        item.innerHTML = `
            <div class="scp-lb-book-check${checkState ? ' ' + checkState : ''}" data-book="${escHtml(name)}"></div>
            <div class="scp-lb-book-info">
                <span class="scp-lb-book-name">${escHtml(displayName)}</span>
                <span class="scp-lb-book-meta">${entryCount} entries</span>
            </div>
            <span class="scp-lb-src-badge ${srcInfo.cls}" title="${srcInfo.title}" style="margin-left: auto;">${srcInfo.label}</span>`;
            
        item.querySelector('.scp-lb-book-check').addEventListener('click', e => { e.stopPropagation(); toggleLorebookSelection(name); });
        item.addEventListener('click', () => viewLorebookEntries(name));
        frag.appendChild(item);
    }
    
    listEl.appendChild(frag);
    updateLBFooterInfo();
}

export async function toggleLorebookSelection(name) {
    const s = getSettings();
    const isSelected = s.lorebookSelectedBooks.includes(name);
    const isExcluded = (s.lorebookExcludedBooks || []).includes(name);

    if (!isSelected && !isExcluded) {
        s.lorebookSelectedBooks.push(name);
        s.lorebookExcludedBooks = (s.lorebookExcludedBooks || []).filter(b => b !== name);
    } else if (isSelected) {
        s.lorebookSelectedBooks = s.lorebookSelectedBooks.filter(b => b !== name);
        if (!s.lorebookExcludedBooks) s.lorebookExcludedBooks = [];
        s.lorebookExcludedBooks.push(name);
    } else {
        s.lorebookExcludedBooks = s.lorebookExcludedBooks.filter(b => b !== name);
    }
    saveSettings();
    await buildLorebookContextBlock(s);
    const item = document.querySelector(`.scp-lb-book-item[data-name="${CSS.escape(name)}"]`);
    if (item) _applyLBBookCheckState(item, name, s);
    updateLBFooterInfo();
    updateMsgCount(getCurrentSession());
    if (state.lbActiveBook) renderEntryList(state.lbActiveBook, state.lbSearchQuery);
}

export async function viewLorebookEntries(name) {
    state.lbActiveBook = name;
    document.querySelectorAll('.scp-lb-book-item').forEach(el => el.classList.toggle('lb-book-open', el.dataset.name === name));
    document.getElementById('scp-lb-main-actions').style.display = '';
    document.getElementById('scp-lb-ctx-legend').style.display = '';
    document.getElementById('scp-lb-entry-detail').style.display = 'none';
    document.getElementById('scp-lb-entries').style.display = '';
    const s = getSettings();
    const isForced = s.lorebookSelectedBooks.includes(name) || (s.lorebookExcludedBooks || []).includes(name);
    const entriesEl = document.getElementById('scp-lb-entries');
    if (entriesEl) entriesEl.classList.toggle('lb-entries-dimmed', isForced);
    await renderEntryList(name, state.lbSearchQuery);
}

export async function renderEntryList(bookName, search = '') {
    const container = document.getElementById('scp-lb-entries');
    if (!container) return;
    const data = await fetchWorldInfoBook(bookName);
    if (!data) { container.innerHTML = '<div class="scp-lb-empty-state">Failed to load lorebook</div>'; return; }

    const entries = wiEntriesToArray(data);
    const s = getSettings();
    const overrides = s.lorebookEntryOverrides || {};
    const isBookSelected = (s.lorebookSelectedBooks || []).includes(bookName);
    const activeEntryUids = new Set(
        lastActiveEntries.filter(e => e.bookName === bookName).map(e => e.uid)
    );
    const lowerSearch = search.toLowerCase();
    const filtered = search ? entries.filter(e => {
        return (e.comment || '').toLowerCase().includes(lowerSearch)
            || (e.content || '').toLowerCase().includes(lowerSearch)
            || (e.key || []).join(' ').toLowerCase().includes(lowerSearch);
    }) : entries;

    const label = document.getElementById('scp-lb-entries-label');
    if (label) label.textContent = `${getDisplayName(bookName)} — ${filtered.length}${filtered.length !== entries.length ? ` of ${entries.length}` : ''} entr${filtered.length !== 1 ? 'ies' : 'y'}`;

    const frag = document.createDocumentFragment();
    for (const entry of filtered) {
        const overKey = getEntryOverrideKey(bookName, entry);
        const override = overrides[overKey];
        const isDisabled = !!entry.disable;
        const isInCtx = activeEntryUids.has(entry.uid);
        const row = document.createElement('div');
        row.className = `scp-lb-entry-row${isDisabled ? ' lb-disabled' : ''}${isInCtx ? ' lb-in-ctx' : ''}`;
        row.dataset.uid = entry.uid;

        let indClass = '', btnText = '~';
        if (override === true) { indClass = 'forced-on'; btnText = '✓'; }
        else if (override === false) { indClass = 'forced-off'; btnText = '✕'; }
        else if (entry.constant && !entry.disable) { indClass = 'forced-on'; btnText = '✓'; }
        else if (isInCtx) { indClass = 'scp-lb-ind-in-ctx'; }

        row.innerHTML = `
            <div class="scp-lb-entry-indicator ${indClass}"></div>
            <div class="scp-lb-entry-info">
                <span class="scp-lb-entry-name">${escHtml(entry.comment || `#${entry.uid}`)}${isInCtx ? ' <span class="scp-lb-in-ctx-badge">in context</span>' : ''}</span>
                <span class="scp-lb-entry-keys">${entry.key?.slice(0, 5).map(k => escHtml(k)).join(' · ') || '—'}</span>
            </div>
            <div class="scp-lb-entry-actions">
                <button class="scp-lb-entry-toggle-btn ${indClass}">${btnText}</button>
                <button class="scp-lb-entry-view-btn">${I.edit}</button>
            </div>`;
        row.querySelector('.scp-lb-entry-toggle-btn').addEventListener('click', e => { e.stopPropagation(); cycleEntryOverride(bookName, entry, row); });
        row.querySelector('.scp-lb-entry-view-btn').addEventListener('click', e => { e.stopPropagation(); showEntryDetail(entry, bookName); });
        row.addEventListener('click', () => showEntryDetail(entry, bookName));
        frag.appendChild(row);
    }
    container.innerHTML = '';
    container.appendChild(frag);
}

export function cycleEntryOverride(bookName, entry, rowEl) {
    const s = getSettings();
    if (!s.lorebookEntryOverrides) s.lorebookEntryOverrides = {};
    const key = getEntryOverrideKey(bookName, entry);
    const current = s.lorebookEntryOverrides[key];
    const isConstantEntry = !!entry.constant && !entry.disable;
    let next;
    if (current === undefined) next = isConstantEntry ? false : true;
    else if (current === true) next = false;
    else { delete s.lorebookEntryOverrides[key]; next = undefined; }
    if (next !== undefined) s.lorebookEntryOverrides[key] = next;

    saveSettings();

    const ind = rowEl.querySelector('.scp-lb-entry-indicator');
    const btn = rowEl.querySelector('.scp-lb-entry-toggle-btn');
    if (next === true) {
        ind.className = 'scp-lb-entry-indicator forced-on';
        btn.textContent = '✓'; btn.className = 'scp-lb-entry-toggle-btn forced-on';
        rowEl.classList.remove('lb-in-ctx');
    } else if (next === false) {
        ind.className = 'scp-lb-entry-indicator forced-off';
        btn.textContent = '✕'; btn.className = 'scp-lb-entry-toggle-btn forced-off';
        rowEl.classList.remove('lb-in-ctx');
    } else {
        const isInCtx = lastActiveEntries.some(e => e.bookName === bookName && e.uid === entry.uid);
        ind.className = `scp-lb-entry-indicator${isConstantEntry ? ' forced-on' : (isInCtx ? ' scp-lb-ind-in-ctx' : '')}`;
        btn.textContent = isConstantEntry ? '✓' : '~'; 
        btn.className = `scp-lb-entry-toggle-btn${isConstantEntry ? ' forced-on' : ''}`;
        rowEl.classList.toggle('lb-in-ctx', isInCtx);
    }
    updateMsgCount(getCurrentSession());
}

export function showEntryDetail(entry, bookName) {
    state.lbEntryDetailEntry = entry;
    state.lbEntryDetailBook = bookName;
    document.getElementById('scp-lb-entry-detail').style.display = 'flex';
    document.getElementById('scp-lb-entries').style.display = 'none';

    document.getElementById('scp-lb-detail-title').textContent = entry.comment || `Entry #${entry.uid}`;
    document.getElementById('scp-lb-detail-name').value = entry.comment || '';
    document.getElementById('scp-lb-detail-triggers').value = (entry.key || []).join(', ');
    document.getElementById('scp-lb-detail-content').value = entry.content || '';

    const lbStatus = document.getElementById('scp-lb-detail-lb-status');
    if (lbStatus) {
        const updateStatus = () => {
            lbStatus.textContent = entry.disable ? 'Disabled' : 'Enabled';
            lbStatus.className = `scp-lb-detail-status ${entry.disable ? 'status-disabled' : 'status-enabled'}`;
        };
        updateStatus();
        lbStatus.onclick = async () => {
            entry.disable = !entry.disable;
            updateStatus();
            const data = await fetchWorldInfoBook(bookName);
            if (data?.entries[entry.uid] !== undefined) {
                data.entries[entry.uid].disable = entry.disable;
                await saveWorldInfoBook(bookName, data);
                toastr.success('Status updated', EXT_DISPLAY);
                renderEntryList(bookName, state.lbSearchQuery);
            }
        };
    }

    const s = getSettings();
    const override = (s.lorebookEntryOverrides || {})[getEntryOverrideKey(bookName, entry)];
    ['scp-lb-inj-default', 'scp-lb-inj-force-on', 'scp-lb-inj-force-off'].forEach(id => document.getElementById(id)?.classList.remove('active'));
    if (override === true) document.getElementById('scp-lb-inj-force-on')?.classList.add('active');
    else if (override === false) document.getElementById('scp-lb-inj-force-off')?.classList.add('active');
    else document.getElementById('scp-lb-inj-default')?.classList.add('active');
}

export async function saveEntryDetail() {
    if (!state.lbEntryDetailEntry || !state.lbEntryDetailBook) return;
    if (state.lbEntryDetailBook === EMBEDDED_BOOK_KEY) { toastr.warning('Cannot save embedded character book entries.', EXT_DISPLAY); return; }
    const data = await fetchWorldInfoBook(state.lbEntryDetailBook);
    if (!data) return;
    const entry = data.entries[state.lbEntryDetailEntry.uid];
    entry.comment = document.getElementById('scp-lb-detail-name')?.value || '';
    entry.key = (document.getElementById('scp-lb-detail-triggers')?.value || '').split(',').map(t => t.trim()).filter(Boolean);
    entry.content = document.getElementById('scp-lb-detail-content')?.value || '';
    Object.assign(state.lbEntryDetailEntry, entry);
    await saveWorldInfoBook(state.lbEntryDetailBook, data);

    toastr.success('Entry saved', EXT_DISPLAY);
    document.getElementById('scp-lb-detail-title').textContent = entry.comment || `Entry #${entry.uid}`;
    renderEntryList(state.lbEntryDetailBook, state.lbSearchQuery);
    updateMsgCount(getCurrentSession());
}

export async function deleteEntryDetail() {
    if (!state.lbEntryDetailEntry || !state.lbEntryDetailBook) return;
    const ok = await showCustomDialog({ type: 'confirm', title: 'Delete Entry', message: `Delete "${state.lbEntryDetailEntry.comment || 'this entry'}"?` });
    if (!ok) return;
    const data = await fetchWorldInfoBook(state.lbEntryDetailBook);
    if (!data) return;
    delete data.entries[state.lbEntryDetailEntry.uid];
    await saveWorldInfoBook(state.lbEntryDetailBook, data);

    toastr.success('Entry deleted', EXT_DISPLAY);
    document.getElementById('scp-lb-entry-detail').style.display = 'none';
    document.getElementById('scp-lb-entries').style.display = '';
    renderEntryList(state.lbEntryDetailBook, state.lbSearchQuery);
    updateMsgCount(getCurrentSession());
}

export async function addNewEntry() {
    if (!state.lbActiveBook) { toastr.warning('Select a lorebook first', EXT_DISPLAY); return; }
    if (state.lbActiveBook === EMBEDDED_BOOK_KEY) { toastr.warning('Cannot add entries to embedded character books.', EXT_DISPLAY); return; }
    const name = await showCustomDialog({ type: 'prompt', title: 'New Entry', message: 'Entry name:', placeholder: 'New Entry' });
    if (name === null) return;
    const data = await fetchWorldInfoBook(state.lbActiveBook);
    if (!data) return;
    const uids = Object.keys(data.entries).map(Number);
    const newUid = uids.length ? Math.max(...uids) + 1 : 1;
    const newEntry = {
        uid: newUid, key: [], keysecondary: [], content: '',
        comment: name.trim() || 'New Entry', disable: false, group: '',
        selective: false, constant: false, position: 0, depth: 4, displayIndex: newUid
    };

    data.entries[newUid] = newEntry;
    await saveWorldInfoBook(state.lbActiveBook, data);
    toastr.success('Entry created', EXT_DISPLAY);
    await renderEntryList(state.lbActiveBook, state.lbSearchQuery);
    showEntryDetail(newEntry, state.lbActiveBook);
    updateMsgCount(getCurrentSession());
}

export function updateLBFooterInfo() {
    const el = document.getElementById('scp-lb-footer-info');
    if (!el) return;
    
    const activeNames = getActiveLorebookNames() || [];
    const s = getSettings();
    
    const count = (s.lorebookSelectedBooks || []).filter(b => activeNames.includes(b)).length;
    const excCount = (s.lorebookExcludedBooks || []).filter(b => activeNames.includes(b)).length;
    
    const kwOn = s.lorebookAutoKeyword;
    const parts = [];
    if (count) parts.push(`${count} book${count !== 1 ? 's' : ''} selected`);
    if (excCount) parts.push(`${excCount} excluded`);
    if (kwOn) parts.push('Auto-keywords ON');
    el.textContent = parts.join(' · ');
}

export function setupLorebookManagerListeners() {
    document.getElementById('scp-lb-close')?.addEventListener('click', closeLorebookManager);
    
    document.getElementById('scp-lb-refresh')?.addEventListener('click', async () => {
        Object.keys(wiCache).forEach(k => delete wiCache[k]);
        await refreshLorebookList();
        if (state.lbActiveBook) await renderEntryList(state.lbActiveBook, state.lbSearchQuery);
    });

    let _lbSearchTid = null;
    document.getElementById('scp-lb-search')?.addEventListener('input', e => {
        state.lbSearchQuery = e.target.value;
        clearTimeout(_lbSearchTid);
        _lbSearchTid = setTimeout(() => { if (state.lbActiveBook) renderEntryList(state.lbActiveBook, state.lbSearchQuery); }, 200);
    });

    document.getElementById('scp-lb-enable-all')?.addEventListener('click', () => {
        if (!state.lbActiveBook || !wiCache[state.lbActiveBook]) return;
        const s = getSettings();
        Object.values(wiCache[state.lbActiveBook].entries).forEach(e => { s.lorebookEntryOverrides[getEntryOverrideKey(state.lbActiveBook, e)] = true; });
        saveSettings(); renderEntryList(state.lbActiveBook, state.lbSearchQuery);
        import('../ui/ui-chat.js').then(m => m.updateMsgCount(getCurrentSession()));
    });
    
    document.getElementById('scp-lb-disable-all')?.addEventListener('click', () => {
        if (!state.lbActiveBook || !wiCache[state.lbActiveBook]) return;
        const s = getSettings();
        Object.values(wiCache[state.lbActiveBook].entries).forEach(e => { s.lorebookEntryOverrides[getEntryOverrideKey(state.lbActiveBook, e)] = false; });
        saveSettings(); renderEntryList(state.lbActiveBook, state.lbSearchQuery);
        import('../ui/ui-chat.js').then(m => m.updateMsgCount(getCurrentSession()));
    });
    
    document.getElementById('scp-lb-reset-overrides')?.addEventListener('click', async () => {
        if (!state.lbActiveBook) return;
        const ok = await showCustomDialog({ type: 'confirm', title: 'Reset Overrides', message: `Reset all copilot injection overrides for "${state.lbActiveBook}"?` });
        if (!ok) return;
        const s = getSettings();
        if (wiCache[state.lbActiveBook]) Object.values(wiCache[state.lbActiveBook].entries).forEach(e => { delete s.lorebookEntryOverrides[getEntryOverrideKey(state.lbActiveBook, e)]; });
        saveSettings(); renderEntryList(state.lbActiveBook, state.lbSearchQuery);
        import('../ui/ui-chat.js').then(m => m.updateMsgCount(getCurrentSession()));
    });

    document.getElementById('scp-lb-add-entry')?.addEventListener('click', addNewEntry);
    
    document.getElementById('scp-lb-back')?.addEventListener('click', async () => {
        document.getElementById('scp-lb-entry-detail').style.display = 'none';
        document.getElementById('scp-lb-entries').style.display = '';
        await buildLorebookContextBlock(getSettings());
        if (state.lbActiveBook) await renderEntryList(state.lbActiveBook, state.lbSearchQuery);
    });
    
    document.getElementById('scp-lb-detail-save')?.addEventListener('click', saveEntryDetail);
    document.getElementById('scp-lb-detail-delete')?.addEventListener('click', deleteEntryDetail);
    
    document.getElementById('scp-lb-detail-copy')?.addEventListener('click', () => {
        const c = document.getElementById('scp-lb-detail-content')?.value; if (c) copyText(c);
    });
    
    ['scp-lb-inj-default', 'scp-lb-inj-force-on', 'scp-lb-inj-force-off'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', () => {
            if (!state.lbEntryDetailEntry || !state.lbEntryDetailBook) return;
            const val = document.getElementById(id)?.dataset.val;
            const s = getSettings();
            if (!s.lorebookEntryOverrides) s.lorebookEntryOverrides = {};
            const key = getEntryOverrideKey(state.lbEntryDetailBook, state.lbEntryDetailEntry);
            if (val === 'default') delete s.lorebookEntryOverrides[key];
            else s.lorebookEntryOverrides[key] = val === 'true';
            
            saveSettings();
            ['scp-lb-inj-default', 'scp-lb-inj-force-on', 'scp-lb-inj-force-off'].forEach(bid => document.getElementById(bid)?.classList.remove('active'));
            document.getElementById(id)?.classList.add('active');
            showEntryDetail(state.lbEntryDetailEntry, state.lbEntryDetailBook);
            import('../ui/ui-chat.js').then(m => m.updateMsgCount(getCurrentSession()));
        });
    });

    const ctx = SillyTavern.getContext();
    const es = ctx.eventSource || window.eventSource;
    const et = ctx.event_types || window.event_types || {};
    es?.on?.(et.WORLDINFO_UPDATED || 'worldinfo_updated', (name) => {
        const overlay = document.getElementById('scp-lb-overlay');
        if (!overlay || overlay.style.display === 'none') return;
        refreshLorebookList();
        if (state.lbActiveBook && name === state.lbActiveBook) {
            renderEntryList(state.lbActiveBook, state.lbSearchQuery);
        }
    });
}