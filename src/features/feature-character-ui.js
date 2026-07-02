import { EXT_DISPLAY, I } from '../constants.js';
import { getSettings, saveSettings, getCurrentSession, addMessage, saveSessionsToMetadata } from '../session.js';
import { escHtml } from '../utils/util-dom.js';
import { bringWindowToFront } from '../ui/ui-window.js';
import { applySearchReplaceToField } from '../utils/util-text.js';
import { getCharFieldValue, saveCharacterField, stripCharCreationBlock, stripCharChangesBlock, createCharacterAPI, groupChangesByCharacter } from './feature-character-engine.js';
import { openTextDiffModal } from '../utils/util-diff.js';

import { addHistoryToSwipe, _renderMsgBodyContent } from '../ui/ui-chat.js';
import { appendLBHistoryEl } from './feature-lorebook-ui.js';

export function buildAltGreetingsPicker(container, isOverride = false) {
    if (!container) return;
    container.innerHTML = '';
    
    const s = getSettings();
    if (!s.charEditFields) s.charEditFields = {};
    if (Array.isArray(s.altGreetingIndices)) s.altGreetingIndices = {};
    if (!s.altGreetingIndices) s.altGreetingIndices = {};
    
    const ctx = SillyTavern.getContext();
    const char = ctx.characters?.[ctx.characterId];
    const charId = char?.avatar || 'unknown';
    const greetings = char?.data?.alternate_greetings || [];

    let isEnabled = false;
    if (isOverride) {
        const sess = getCurrentSession();
        if (sess && sess.overrides && sess.overrides.charField_alternate_greetings !== undefined) {
            isEnabled = sess.overrides.charField_alternate_greetings;
        } else {
            isEnabled = !!s.charEditFields.alternate_greetings;
        }
    } else {
        isEnabled = !!s.charEditFields.alternate_greetings;
    }

    if (!isEnabled) { container.style.display = 'none'; return; }

    if (!greetings.length) {
        container.innerHTML = '<div style="font-size:11px;color:var(--scp-text-muted);font-style:italic;padding:4px">No alternate greetings found for current character.</div>';
        container.style.display = '';
        return;
    }

    let targetArray = [];
    if (isOverride) {
        const sess = getCurrentSession();
        if (sess?.overrides?.altGreetingIndices && sess.overrides.altGreetingIndices[charId]) {
            targetArray = sess.overrides.altGreetingIndices[charId];
        } else {
            targetArray = s.altGreetingIndices[charId] || [];
        }
    } else {
        targetArray = s.altGreetingIndices[charId] || [];
    }

    const label = document.createElement('div');
    label.style.cssText = 'font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--scp-text-muted,#72728a);margin-bottom:5px';
    label.textContent = 'Which greetings to include:';
    container.appendChild(label);

    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:3px;max-height:120px;overflow-y:auto;padding:4px;background:rgba(0,0,0,.15);border-radius:6px;border:1px solid rgba(255,255,255,.06)';

    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.style.cssText = 'font-size:10px;cursor:pointer;background:none;border:1px solid rgba(255,255,255,.1);border-radius:4px;color:var(--scp-text-muted,#888);padding:2px 8px;align-self:flex-start;margin-bottom:3px;font-family:inherit';
    allBtn.textContent = targetArray.length === greetings.length ? 'Deselect All' : 'Select All';
    
    allBtn.addEventListener('click', () => {
        const isAll = targetArray.length === greetings.length;
        const newArray = isAll ? [] : greetings.map((_, i) => i);
        if (isOverride) {
            const sess = getCurrentSession();
            if (!sess.overrides) sess.overrides = {};
            if (!sess.overrides.altGreetingIndices) sess.overrides.altGreetingIndices = {};
            sess.overrides.altGreetingIndices[charId] = newArray;
        } else {
            getSettings().altGreetingIndices[charId] = newArray;
        }
        saveSettings(); buildAltGreetingsPicker(container, isOverride);
    });
    wrap.appendChild(allBtn);

    greetings.forEach((greeting, idx) => {
        const isSelected = targetArray.includes(idx);
        const row = document.createElement('label');
        row.style.cssText = 'display:flex;align-items:flex-start;gap:6px;cursor:pointer;padding:3px 4px;border-radius:4px;transition:background .12s';
        
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = isSelected; cb.style.cssText = 'flex-shrink:0;margin-top:2px;accent-color:var(--scp-accent,#7c6dfa)';
        cb.addEventListener('change', () => {
            let currentArr = [...targetArray];
            if (cb.checked) { if (!currentArr.includes(idx)) currentArr.push(idx); }
            else currentArr = currentArr.filter(i => i !== idx);
            currentArr.sort((a, b) => a - b);
            
            if (isOverride) {
                const sess = getCurrentSession();
                if (!sess.overrides) sess.overrides = {};
                if (!sess.overrides.altGreetingIndices) sess.overrides.altGreetingIndices = {};
                sess.overrides.altGreetingIndices[charId] = currentArr;
            } else {
                getSettings().altGreetingIndices[charId] = currentArr;
            }
            
            saveSettings();
            allBtn.textContent = currentArr.length === greetings.length ? 'Deselect All' : 'Select All';
            targetArray = currentArr;
        });

        const text = document.createElement('span');
        text.style.cssText = 'font-size:11px;color:var(--scp-text,#e2e2e6);line-height:1.4;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical';
        text.textContent = `#${idx + 1}: ${(greeting || '').slice(0, 80)}${greeting?.length > 80 ? '…' : ''}`;

        row.appendChild(cb); row.appendChild(text); wrap.appendChild(row);
    });
    container.appendChild(wrap); container.style.display = '';
}

export function refreshAltGreetingsPickers() {
    buildAltGreetingsPicker(document.getElementById('scp-ce-alt-greetings-picker'), false);
    buildAltGreetingsPicker(document.getElementById('scp-sp-ce-alt-greetings-picker'), false);
    buildAltGreetingsPicker(document.getElementById('scp-sp-ov-ce-alt-greetings-picker'), true);
}

export async function applyCharChanges(changes, char, afterMsgId = null) {
    if (!char) { toastr.error('[CharEdit] No active character.', EXT_DISPLAY); return; }
    const successLog = [];

    for (const change of changes) {
        const { field, action } = change;
        if (!field) continue;
        try {
            if (field === 'alternate_greetings') {
                const greetings = [...(char.data?.alternate_greetings || [])];
                if (action === 'append') {
                    greetings.push(change.value || '');
                    await saveCharacterField(char, 'alternate_greetings', greetings);
                    successLog.push(change);
                } else {
                    const idx = (change.index || 1) - 1;
                    if (idx < 0 || idx >= greetings.length) { toastr.warning(`[CharEdit] Greeting index ${change.index} out of range.`, EXT_DISPLAY); continue; }

                    if (action === 'overwrite') {
                        greetings[idx] = change.value || '';
                    } else if (action === 'prepend') {
                        greetings[idx] = (change.value || '') + (greetings[idx] ? '\n\n' + greetings[idx] : '');
                    } else if (action === 'append_text') {
                        greetings[idx] = (greetings[idx] ? greetings[idx] + '\n\n' : '') + (change.value || '');
                    } else if (action === 'replace') {
                        let current = greetings[idx];
                        let allMatched = true;
                        for (const patch of (change.patches || [])) {
                            const { result, matched } = applySearchReplaceToField(current, patch.search || '', patch.replace || '');
                            if (!matched) { toastr.warning(`[CharEdit] SEARCH not found in greeting #${change.index}.`, EXT_DISPLAY); allMatched = false; break; }
                            current = result;
                        }
                        if (!allMatched) continue;
                        greetings[idx] = current;
                    }

                    await saveCharacterField(char, 'alternate_greetings', greetings);
                    successLog.push(change);
                }
            } else if (action === 'overwrite') {
                await saveCharacterField(char, field, change.value || '');
                successLog.push(change);
            } else if (action === 'prepend') {
                const current = String(getCharFieldValue(char, field));
                await saveCharacterField(char, field, change.value + (current ? '\n\n' + current : ''));
                successLog.push(change);
            } else if (action === 'append_text') {
                const current = String(getCharFieldValue(char, field));
                await saveCharacterField(char, field, (current ? current + '\n\n' : '') + change.value);
                successLog.push(change);
            } else if (action === 'replace') {
                let current = String(getCharFieldValue(char, field));
                let allMatched = true;
                for (const patch of (change.patches || [])) {
                    const { result, matched } = applySearchReplaceToField(current, patch.search || '', patch.replace || '');
                    if (!matched) { toastr.warning(`[CharEdit] SEARCH not found in field "${field}": "${(patch.search || '').slice(0, 60)}…"`, EXT_DISPLAY, { timeOut: 8000 }); allMatched = false; break; }
                    current = result;
                }
                if (!allMatched) continue;
                await saveCharacterField(char, field, current);
                successLog.push(change);
            }
        } catch (e) {
            console.error(`[ST-Copilot-Debug] Failed on char field "${field}":`, e);
            toastr.error(`[CharEdit] Failed on "${field}": ${e.message}`, EXT_DISPLAY, { timeOut: 10000 });
        }
    }

    if (successLog.length > 0) {
        logCharEditHistory(successLog, 'Applied', afterMsgId, char.name);
        toastr.success(`[CharEdit] ${successLog.length} change(s) applied to ${char.name}.`, EXT_DISPLAY);
    }
}

export function logCharEditHistory(changes, statusStr, afterMsgId = null, charName = null) {
    if (!changes?.length) return;
    try {
        const getFieldLabel = (f) => {
            const LBLS = { name:'Name', tags:'Tags', description:'Description', personality:'Personality', scenario:'Scenario', first_mes:'First Message', mes_example:'Example Dialogue', authors_note:"Author's Note", user_persona:"User Persona", alternate_greetings:'Alternate Greetings', system_prompt:'Main Prompt Override', post_history_instructions:'Post-History Instructions' };
            if (LBLS[f]) return LBLS[f];
            if (f && f.startsWith('evolutia_char:')) return `Aspect (Char): ${f.split('evolutia_char:')[1]}`;
            if (f && f.startsWith('evolutia_user:')) return `Aspect (User): ${f.split('evolutia_user:')[1]}`;
            return f || '?';
        };
        const session = getCurrentSession();
        const icon = statusStr === 'Applied' ? '✓' : (statusStr === 'Rejected' ? '✕' : '·');
        const actionText = statusStr === 'Applied' ? 'ACCEPTED' : (statusStr === 'Rejected' ? 'REJECTED' : 'DISMISSED (ignored)');

        const newLines = changes.map(c => {
            const patches = c.patches ? ` (${c.patches.length} patch${c.patches.length !== 1 ? 'es' : ''})` : '';
            return `${icon} **${actionText}**: \`${escHtml(getFieldLabel(c.field))}\` — ${escHtml(c.action || '?')}${c.index ? ` #${c.index}` : ''}${patches}`;
        });

        if (afterMsgId && addHistoryToSwipe(afterMsgId, newLines, charName)) return;

        const histText = `**System Notification** — Character card edits${charName ? ` for **${escHtml(charName)}**` : ''}:\n${newLines.join('\n')}`;
        const msg = addMessage(session, 'system', histText, { isCharEditHistory: true, isLBHistory: true, appliedLines: [...newLines], _charName: charName || null });
        appendLBHistoryEl(msg);
    } catch (_) {}
}

export function logCharCreationHistory(creationData, statusStr, afterMsgId = null) {
    try {
        const session = getCurrentSession();
        const icon = statusStr === 'Applied' ? '✓' : (statusStr === 'Rejected' ? '✕' : '·');
        const actionText = statusStr === 'Applied' ? 'ACCEPTED' : (statusStr === 'Rejected' ? 'REJECTED' : 'DISMISSED (ignored)');
        const newLines = [`${icon} **${actionText}**: Character Creation Proposal for "${escHtml(creationData.name_suggestion || 'New Character')}"`];
        
        if (afterMsgId && addHistoryToSwipe(afterMsgId, newLines)) return;

        const histText = `**System Notification** — Character card edits:\n${newLines.join('\n')}`;
        const msg = addMessage(session, 'system', histText, { isCharEditHistory: true, isLBHistory: true, appliedLines: [...newLines] });
        appendLBHistoryEl(msg);
    } catch (_) {}
}

export function reconstructCharChangesBlock(pendingChanges) {
    if (!pendingChanges.length) return '';
    let xml = '```character-changes\n';
    for (const c of pendingChanges) {
        if (c.action === 'replace') {
            xml += `<replace field="${c.field}"${c.index ? ` index="${c.index}"` : ''}>\n`;
            for (const p of c.patches) {
                xml += `<<<<<<< SEARCH\n${p.search}\n=======\n${p.replace}\n>>>>>>> REPLACE\n`;
            }
            xml += `</replace>\n`;
        } else if (c.action === 'overwrite') {
            xml += `<overwrite field="${c.field}"${c.index ? ` index="${c.index}"` : ''}>${c.value}</overwrite>\n`;
        } else if (c.action === 'append') {
            xml += `<append field="${c.field}">${c.value}</append>\n`;
        } else if (c.action === 'prepend') {
            xml += `<prepend field="${c.field}"${c.index ? ` index="${c.index}"` : ''}>${c.value}</prepend>\n`;
        } else if (c.action === 'append_text') {
            xml += `<append_text field="${c.field}"${c.index ? ` index="${c.index}"` : ''}>${c.value}</append_text>\n`;
        }
    }
    xml += '```';
    return xml;
}

export function renderCharCreationCard(creationData, msgEl) {
    document.querySelector(`.scp-char-creation-card[data-for="${msgEl.dataset.id}"]`)?.remove();

    const editableData = {
        name: creationData.name_suggestion || '',
        description: creationData.description || '',
        personality: creationData.personality || '',
        scenario: creationData.scenario || '',
        first_mes: creationData.first_mes || '',
        mes_example: creationData.mes_example || '',
        tags: Array.isArray(creationData.tags) ? creationData.tags.join(', ') : (creationData.tags || ''),
    };

    const FIELDS = [
        { key: 'name',        label: 'Name',            multiline: false },
        { key: 'tags',        label: 'Tags',             multiline: false, hint: 'comma-separated' },
        { key: 'description', label: 'Description',      multiline: true, rows: 4 },
        { key: 'personality', label: 'Personality',      multiline: true, rows: 3 },
        { key: 'scenario',    label: 'Scenario',         multiline: true, rows: 3 },
        { key: 'first_mes',   label: 'First Message',    multiline: true, rows: 3 },
        { key: 'mes_example', label: 'Example Dialogue', multiline: true, rows: 3 },
    ];

    const card = document.createElement('div');
    card.className = 'scp-lb-proposal-card scp-char-creation-card';
    card.dataset.for = msgEl.dataset.id;

    const stripAndRemove = () => {
        const session = getCurrentSession();
        const msg = session.messages.find(m => m.id === card.dataset.for);
        if (msg) { 
            msg.content = stripCharCreationBlock(msg.content); 
            if (msg.swipes) msg.swipes[msg.swipeIndex || 0].content = msg.content;
            saveSessionsToMetadata(); 
        }
        card.remove();
    };

    const header = document.createElement('div');
    header.className = 'scp-lb-proposal-header';
    const headerLeft = document.createElement('div');
    headerLeft.style.cssText = 'display:flex;align-items:center;gap:8px;flex:1;min-width:0';
    headerLeft.innerHTML = `<span class="scp-lb-proposal-icon" style="color:var(--scp-success);display:flex"><i class="fa-solid fa-user-plus"></i></span><span class="scp-lb-proposal-title">New Character Proposal</span>`;
    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'scp-lb-proposal-dismiss'; dismissBtn.innerHTML = I.x; dismissBtn.title = 'Dismiss';
    dismissBtn.addEventListener('click', () => {
        logCharCreationHistory(editableData, 'Dismissed', card.dataset.for);
        stripAndRemove();
    });
    header.appendChild(headerLeft); header.appendChild(dismissBtn);
    card.appendChild(header);

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:11px;color:var(--scp-text-muted);padding:6px 2px 4px;font-style:italic';
    hint.textContent = 'Review and edit the proposed character. Name is required.';
    card.appendChild(hint);

    const fieldsWrap = document.createElement('div');
    fieldsWrap.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-top:4px';
    const inputs = {};
    for (const f of FIELDS) {
        const row = document.createElement('div');
        row.className = 'scp-lb-pe-row';
        const lbl = document.createElement('label');
        lbl.className = 'scp-lb-pe-label';
        lbl.textContent = f.label + (f.key === 'name' ? ' *' : '');
        let inp;
        if (f.multiline) {
            inp = document.createElement('textarea');
            inp.rows = f.rows || 3;
            inp.className = 'scp-lb-pe-textarea';
            inp.style.minHeight = `${(f.rows || 3) * 20}px`;
        } else {
            inp = document.createElement('input');
            inp.type = 'text';
            inp.className = 'scp-lb-pe-input';
        }
        inp.value = editableData[f.key];
        inp.addEventListener('input', () => { editableData[f.key] = inp.value; });
        inputs[f.key] = inp;
        row.appendChild(lbl); row.appendChild(inp);
        fieldsWrap.appendChild(row);
    }
    card.appendChild(fieldsWrap);

    const footer = document.createElement('div');
    footer.className = 'scp-lb-proposal-footer';
    footer.style.marginTop = '10px';

    const createBtn = document.createElement('button');
    createBtn.className = 'scp-lb-proposal-apply';
    createBtn.innerHTML = '<i class="fa-solid fa-user-plus"></i> Create Character';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'scp-lb-proposal-reject';
    cancelBtn.textContent = 'Cancel';

    createBtn.addEventListener('click', async () => {
        if (!editableData.name?.trim()) {
            toastr.warning('Character name is required.', EXT_DISPLAY);
            inputs.name.focus();
            return;
        }
        createBtn.disabled = true;
        createBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating…';
        const session = getCurrentSession();
        const msgForStrip = session.messages.find(m => m.id === card.dataset.for);
        if (msgForStrip) { 
            msgForStrip.content = stripCharCreationBlock(msgForStrip.content); 
            if (msgForStrip.swipes) msgForStrip.swipes[msgForStrip.swipeIndex || 0].content = msgForStrip.content;
            saveSessionsToMetadata(); 
        }
        try {
            await createCharacterAPI(editableData);
            logCharCreationHistory(editableData, 'Applied', card.dataset.for);
            toastr.success(`Character "${escHtml(editableData.name)}" created!`, EXT_DISPLAY);
            card.remove();
        } catch (e) {
            console.error('[ST-Copilot-Debug] Character creation UI error:', e);
            toastr.error(`Failed: ${e.message}`, EXT_DISPLAY, { timeOut: 10000 });
            createBtn.disabled = false;
            createBtn.innerHTML = '<i class="fa-solid fa-user-plus"></i> Create Character';
        }
    });
    cancelBtn.addEventListener('click', () => {
        logCharCreationHistory(editableData, 'Rejected', card.dataset.for);
        stripAndRemove();
    });

    footer.appendChild(createBtn); footer.appendChild(cancelBtn);
    card.appendChild(footer);
    card.style.margin = '8px 0 0 0';
    const bodyEl = msgEl.querySelector('.scp-msg-body');
    if (bodyEl) bodyEl.insertBefore(card, bodyEl.querySelector('.scp-swipe-bar'));
    else msgEl.after(card);
    bringWindowToFront();
}

function _syncAllCardsToMessage(msgId) {
    const session = getCurrentSession();
    const msg = session.messages.find(m => m.id === msgId);
    if (!msg) return;
    const cards = document.querySelectorAll(`.scp-char-proposal-card[data-for="${msgId}"]`);
    const pendingAll = [];
    cards.forEach(c => {
        const ec = c._editableChanges || [];
        const states = c._itemStates || [];
        ec.forEach((change, i) => { if (states[i] === 'pending') pendingAll.push(change); });
    });
    const stripped = stripCharChangesBlock(msg.content);
    msg.content = pendingAll.length ? stripped + '\n\n' + reconstructCharChangesBlock(pendingAll) : stripped;
    if (msg.swipes) msg.swipes[msg.swipeIndex || 0].content = msg.content;
    saveSessionsToMetadata();
}

function _buildCharProposalCardForCharacter(changes, msgEl, char) {
    const msgId = msgEl.dataset.id;
    const editableChanges = changes.map(c => JSON.parse(JSON.stringify(c)));
    editableChanges.forEach(c => { c.char = char.name; });
    const itemStates = editableChanges.map(() => 'pending');

    const getFieldLabel = (f) => {
        const LBLS = { name:'Name', tags:'Tags', description:'Description', personality:'Personality', scenario:'Scenario', first_mes:'First Message', mes_example:'Example Dialogue', authors_note:"Author's Note", user_persona:"User Persona", alternate_greetings:'Alternate Greetings', system_prompt:'Main Prompt Override', post_history_instructions:'Post-History Instructions' };
        if (LBLS[f]) return LBLS[f];
        if (f && f.startsWith('evolutia_char:')) return `Aspect (Char): ${f.split('evolutia_char:')[1]}`;
        if (f && f.startsWith('evolutia_user:')) return `Aspect (User): ${f.split('evolutia_user:')[1]}`;
        return f || '?';
    };

    const card = document.createElement('div');
    card.className = 'scp-lb-proposal-card scp-char-proposal-card';
    card.dataset.for = msgId;
    card.style.margin = '8px 0 0 0';
    card._editableChanges = editableChanges;
    card._itemStates = itemStates;

    const getPending = () => itemStates.filter(s => s === 'pending').length;
    const checkAllResolved = () => {
        if (getPending() > 0) return;
        card.remove();
        const remaining = document.querySelectorAll(`.scp-char-proposal-card[data-for="${msgId}"]`);
        if (!remaining.length) {
            const msg = getCurrentSession().messages.find(m => m.id === msgId);
            if (msg) _renderMsgBodyContent(msgEl, msg);
        }
    };

    const validateReplaceChange = (change) => {
        let current;
        if (change.field === 'alternate_greetings') {
            const idx = (change.index || 1) - 1;
            current = (char.data?.alternate_greetings || [])[idx] || '';
        } else {
            current = String(getCharFieldValue(char, change.field));
        }
        for (const patch of (change.patches || [])) {
            const { matched, result } = applySearchReplaceToField(current, patch.search || '', patch.replace || '');
            if (!matched) return { valid: false, reason: `SEARCH not found: "${(patch.search || '').slice(0, 50)}"` };
            current = result;
        }
        return { valid: true };
    };

    const getAppliedResult = (change) => {
        if (change.action === 'overwrite') return change.value || '';
        let current;
        if (change.field === 'alternate_greetings') {
            const idx = (change.index || 1) - 1;
            current = (char.data?.alternate_greetings || [])[idx] || '';
        } else {
            current = String(getCharFieldValue(char, change.field));
        }
        for (const patch of (change.patches || [])) {
            const { result } = applySearchReplaceToField(current, patch.search || patch.anchor || '', patch.replace || '');
            current = result;
        }
        return current;
    };

    const header = document.createElement('div');
    header.className = 'scp-lb-proposal-header';
    const headerLeft = document.createElement('div');
    headerLeft.style.cssText = 'display:flex;align-items:center;gap:8px;flex:1;min-width:0';
    const countBadge = document.createElement('span');
    countBadge.className = 'scp-lb-proposal-count';
    countBadge.textContent = `${editableChanges.length} pending`;
    headerLeft.innerHTML = `<span class="scp-lb-proposal-icon" style="color:var(--scp-accent);display:flex"><i class="fa-solid fa-user-pen"></i></span><span class="scp-lb-proposal-title">Proposed Edits: ${escHtml(char.name)}</span>`;
    headerLeft.appendChild(countBadge);
    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'scp-lb-proposal-dismiss'; dismissBtn.innerHTML = I.x; dismissBtn.title = 'Dismiss';
    dismissBtn.addEventListener('click', () => {
        const pending = editableChanges.filter((_, i) => itemStates[i] === 'pending');
        if (pending.length > 0) logCharEditHistory(pending, 'Dismissed', msgId, char.name);
        itemStates.forEach((s, i) => { if (s === 'pending') itemStates[i] = 'dismissed'; });
        _syncAllCardsToMessage(msgId);
        card.remove();
    });
    header.appendChild(headerLeft); header.appendChild(dismissBtn);

    const list = document.createElement('div');
    list.className = 'scp-lb-proposal-list';

    const itemEls = editableChanges.map((c, ci) => {
        const item = document.createElement('div');
        item.className = `scp-lb-proposal-item ${c.action === 'append' ? 'scp-lb-proposal-add' : 'scp-lb-proposal-edit'}`;

        const hdr = document.createElement('div');
        hdr.className = 'scp-lb-proposal-item-header';

        const meta = document.createElement('div');
        meta.style.cssText = 'display:flex;align-items:center;gap:8px;flex:1;flex-wrap:wrap;min-width:0';
        const patchCount = c.patches?.length > 1 ? ` (${c.patches.length})` : '';
        const actionLabel = c.action === 'append' ? '+ Append'
            : c.action === 'overwrite' ? '↺ Overwrite'
            : c.action === 'prepend' ? '⬆ Prepend'
            : c.action === 'append_text' ? '⬇ Append'
            : `✎ Replace${patchCount}`;
        meta.innerHTML = `<span class="scp-lb-proposal-action">${escHtml(actionLabel)}</span><span class="scp-lb-proposal-name">${escHtml(getFieldLabel(c.field))}${c.index?` #${c.index}`:''}</span>`;

        const btns = document.createElement('div');
        btns.className = 'scp-lb-proposal-item-btns';

        if (c.action === 'replace' || c.action === 'overwrite') {
            const diffBtn = document.createElement('button');
            diffBtn.className = 'scp-lb-proposal-diff-btn'; diffBtn.title = 'View diff'; diffBtn.innerHTML = I.diff;
            diffBtn.addEventListener('click', e => {
                e.stopPropagation();
                const change = editableChanges[ci];
                let original;
                if (change.field === 'alternate_greetings') {
                    const idx = (change.index || 1) - 1;
                    original = (char.data?.alternate_greetings || [])[idx] || '';
                } else {
                    original = String(getCharFieldValue(char, change.field));
                }
                const result = getAppliedResult(change);
                const title = `Diff: ${getFieldLabel(c.field)}${c.index?` #${c.index}`:''} (${char.name})`;
                openTextDiffModal(title, original, result);
            });
            btns.appendChild(diffBtn);
        }

        const editToggleBtn = document.createElement('button');
        editToggleBtn.className = 'scp-lb-proposal-edit-toggle'; editToggleBtn.title = 'Edit before applying'; editToggleBtn.textContent = '✎';
        btns.appendChild(editToggleBtn);

        const applyBtn = document.createElement('button');
        applyBtn.className = 'scp-lb-proposal-item-apply'; applyBtn.title = 'Apply'; applyBtn.textContent = '✓';

        if (c.action === 'replace') {
            const { valid, reason } = validateReplaceChange(editableChanges[ci]);
            if (!valid) {
                applyBtn.disabled = true;
                applyBtn.title = reason || 'Cannot apply';
                item.style.borderLeftColor = 'var(--scp-danger)';
                const warn = document.createElement('div');
                warn.style.cssText = 'font-size:10px;color:var(--scp-danger);margin-top:4px';
                warn.textContent = `\u26A0 ${reason || 'SEARCH text not found — this edit may be outdated.'}`;
                meta.appendChild(warn);
            }
        }

        applyBtn.addEventListener('click', async e => {
            e.stopPropagation();
            if (itemStates[ci] !== 'pending' || applyBtn.disabled) return;
            applyBtn.disabled = true; applyBtn.textContent = '\u2026';

            const isNameField = editableChanges[ci].field === 'name';
            if (isNameField) { itemStates[ci] = 'applied'; _syncAllCardsToMessage(msgId); }

            try {
                await applyCharChanges([editableChanges[ci]], char, msgId);
                if (!isNameField) { itemStates[ci] = 'applied'; _syncAllCardsToMessage(msgId); }

                item.classList.add('scp-lb-item-applied');
                btns.querySelectorAll('button').forEach(b => { b.disabled = true; });
                countBadge.textContent = `${getPending()} pending`; updateFooter();
                checkAllResolved();
            } catch (err) {
                toastr.error(`Failed: ${err.message}`, EXT_DISPLAY);
                applyBtn.disabled = false; applyBtn.textContent = '\u2713';
                if (isNameField) { itemStates[ci] = 'pending'; _syncAllCardsToMessage(msgId); }
            }
        });

        const rejectBtn = document.createElement('button');
        rejectBtn.className = 'scp-lb-proposal-item-reject'; rejectBtn.title = 'Reject'; rejectBtn.textContent = '\u2715';
        rejectBtn.addEventListener('click', e => {
            e.stopPropagation();
            if (itemStates[ci] !== 'pending') return;
            itemStates[ci] = 'rejected';
            item.classList.add('scp-lb-item-rejected');
            btns.querySelectorAll('button').forEach(b => { b.disabled = true; });
            logCharEditHistory([editableChanges[ci]], 'Rejected', msgId, char.name);
            countBadge.textContent = `${getPending()} pending`; updateFooter();
            _syncAllCardsToMessage(msgId);
            checkAllResolved();
        });

        btns.appendChild(applyBtn); btns.appendChild(rejectBtn);
        hdr.appendChild(meta); hdr.appendChild(btns);
        item.appendChild(hdr);

        const buildPreviewText = () => {
            const change = editableChanges[ci];
            if (change.action === 'replace' && change.patches?.length) {
                return change.patches.map((p, pi) => {
                    const s = (p.search || '').replace(/\n/g, '\u21B5').slice(0, 80);
                    const r = (p.replace || '').replace(/\n/g, '\u21B5').slice(0, 80);
                    return `Patch ${pi+1}: "${s}" \u2192 "${r}"`;
                }).join('\n');
            }
            return change.value || '';
        };

        const previewEl = document.createElement('div');
        previewEl.className = 'scp-lb-proposal-preview';
        previewEl.style.whiteSpace = 'pre-wrap';
        let _expanded = false;
        const refreshPreview = () => {
            const raw = buildPreviewText();
            previewEl.textContent = (!_expanded && raw.length > 140) ? raw.slice(0, 140) + '\u2026' : raw;
        };
        refreshPreview();
        previewEl.style.cursor = 'pointer';
        previewEl.title = 'Click to expand/collapse';
        previewEl.addEventListener('click', e => {
            if (window.getSelection()?.toString().length > 0) return;
            e.stopPropagation();
            _expanded = !_expanded;
            refreshPreview();
        });
        item.appendChild(previewEl);

        const editPanel = document.createElement('div');
        editPanel.className = 'scp-lb-proposal-edit-panel';
        editPanel.style.display = 'none';

        const mkRow = (labelHtml, el) => {
            const row = document.createElement('div');
            row.className = 'scp-lb-pe-row';
            const lbl = document.createElement('label');
            lbl.className = 'scp-lb-pe-label'; lbl.innerHTML = labelHtml;
            row.appendChild(lbl); row.appendChild(el); return row;
        };

        const rebuildEditPanel = () => {
            editPanel.innerHTML = '';
            const change = editableChanges[ci];
            if (change.action === 'replace') {
                (change.patches || []).forEach((patch, pi) => {
                    const pHdr = document.createElement('div');
                    pHdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:4px';
                    pHdr.innerHTML = `<span style="font-size:10px;font-weight:700;color:var(--scp-accent);text-transform:uppercase;letter-spacing:.04em">Patch ${pi+1}</span>`;
                    if (change.patches.length > 1) {
                        const delP = document.createElement('button');
                        delP.style.cssText = 'background:none;border:none;color:var(--scp-danger);cursor:pointer;font-size:11px;padding:0;font-family:var(--scp-font)';
                        delP.textContent = '\u2715 Remove';
                        delP.addEventListener('click', () => {
                            change.patches.splice(pi, 1);
                            rebuildEditPanel();
                            const { valid } = validateReplaceChange(change); applyBtn.disabled = !valid;
                            refreshPreview();
                        });
                        pHdr.appendChild(delP);
                    }
                    editPanel.appendChild(pHdr);

                    const searchTa = document.createElement('textarea');
                    searchTa.className = 'scp-lb-pe-textarea'; searchTa.rows = 2; searchTa.value = patch.search || '';
                    searchTa.placeholder = 'first unique words || last unique words';
                    searchTa.addEventListener('input', () => { editableChanges[ci].patches[pi].search = searchTa.value; });
                    editPanel.appendChild(mkRow('Anchor', searchTa));

                    const replaceTa = document.createElement('textarea');
                    replaceTa.className = 'scp-lb-pe-textarea'; replaceTa.rows = 3; replaceTa.value = patch.replace || '';
                    replaceTa.addEventListener('input', () => { change.patches[pi].replace = replaceTa.value; refreshPreview(); });
                    editPanel.appendChild(mkRow('Replace', replaceTa));

                    if (pi < change.patches.length - 1) {
                        const sep = document.createElement('div');
                        sep.style.cssText = 'height:1px;background:rgba(255,255,255,.07);margin:8px 0';
                        editPanel.appendChild(sep);
                    }
                });

                const addPatchBtn = document.createElement('button');
                addPatchBtn.className = 'scp-action-btn'; addPatchBtn.style.marginTop = '8px';
                addPatchBtn.innerHTML = `${I.plus}<span>Add Patch</span>`;
                addPatchBtn.addEventListener('click', () => { change.patches.push({ search: '', replace: '' }); rebuildEditPanel(); });
                editPanel.appendChild(addPatchBtn);
            } else {
                const valueTa = document.createElement('textarea');
                valueTa.className = 'scp-lb-pe-textarea'; valueTa.rows = 5; valueTa.value = change.value || '';
                valueTa.addEventListener('input', () => { change.value = valueTa.value; refreshPreview(); });
                editPanel.appendChild(mkRow('Value', valueTa));
            }
        };
        rebuildEditPanel();
        item.appendChild(editPanel);

        editToggleBtn.addEventListener('click', e => {
            e.stopPropagation();
            const isOpen = editPanel.style.display !== 'none';
            editPanel.style.display = isOpen ? 'none' : 'flex';
            previewEl.style.display = isOpen ? '' : 'none';
            editToggleBtn.classList.toggle('active', !isOpen);
            if (!isOpen) rebuildEditPanel();
        });

        list.appendChild(item);
        return item;
    });

    const footer = document.createElement('div');
    footer.className = 'scp-lb-proposal-footer';
    const applyAllBtn = document.createElement('button');
    applyAllBtn.className = 'scp-lb-proposal-apply'; applyAllBtn.textContent = 'Apply All';
    const rejectAllBtn = document.createElement('button');
    rejectAllBtn.className = 'scp-lb-proposal-reject'; rejectAllBtn.textContent = 'Reject All';

    function updateFooter() {
        const p = getPending();
        applyAllBtn.style.display = p > 0 ? '' : 'none';
        rejectAllBtn.style.display = p > 0 ? '' : 'none';
    }
    updateFooter();

    applyAllBtn.addEventListener('click', async () => {
        const pendingIndices = [];
        editableChanges.forEach((_, i) => { if (itemStates[i] === 'pending') pendingIndices.push(i); });
        const pending = pendingIndices.map(i => editableChanges[i]);
        if (!pending.length) return;
        applyAllBtn.disabled = true; applyAllBtn.textContent = 'Applying\u2026';

        const hasNameField = pending.some(c => c.field === 'name');
        if (hasNameField) { pendingIndices.forEach(i => { itemStates[i] = 'applied'; }); _syncAllCardsToMessage(msgId); }

        try {
            await applyCharChanges(pending, char, msgId);
            if (!hasNameField) { pendingIndices.forEach(i => { itemStates[i] = 'applied'; }); _syncAllCardsToMessage(msgId); }
            pendingIndices.forEach(i => {
                if (itemEls[i]) { itemEls[i].classList.add('scp-lb-item-applied'); itemEls[i].querySelectorAll('button').forEach(b => { b.disabled = true; }); }
            });
            countBadge.textContent = `${getPending()} pending`; updateFooter();
            checkAllResolved();
        } catch (e) {
            toastr.error(`Failed: ${e.message}`, EXT_DISPLAY);
            applyAllBtn.disabled = false; applyAllBtn.textContent = 'Apply All';
            if (hasNameField) { pendingIndices.forEach(i => { itemStates[i] = 'pending'; }); _syncAllCardsToMessage(msgId); }
        }
    });
    rejectAllBtn.addEventListener('click', () => {
        const pending = editableChanges.filter((_, i) => itemStates[i] === 'pending');
        itemStates.forEach((s, i) => { if (s === 'pending') { itemStates[i] = 'rejected'; itemEls[i]?.classList.add('scp-lb-item-rejected'); itemEls[i]?.querySelectorAll('button').forEach(b => { b.disabled = true; }); } });
        logCharEditHistory(pending, 'Rejected', msgId, char.name);
        countBadge.textContent = `${getPending()} pending`; updateFooter();
        _syncAllCardsToMessage(msgId);
        checkAllResolved();
    });

    footer.appendChild(applyAllBtn); footer.appendChild(rejectAllBtn);
    card.appendChild(header); card.appendChild(list); card.appendChild(footer);
    return card;
}

export function renderCharProposalCard(changes, msgEl) {
    if (!changes?.length) return;
    const msgId = msgEl.dataset.id;
    document.querySelectorAll(`.scp-char-proposal-card[data-for="${msgId}"]`).forEach(c => c.remove());

    const groups = groupChangesByCharacter(changes);
    if (!groups.length) return;

    const body = msgEl.querySelector('.scp-msg-body');
    const swipeBar = body?.querySelector('.scp-swipe-bar');

    groups.forEach(({ char, changes: charChanges }) => {
        const card = _buildCharProposalCardForCharacter(charChanges, msgEl, char);
        if (body) body.insertBefore(card, swipeBar);
        else msgEl.after(card);
    });
    bringWindowToFront();
}