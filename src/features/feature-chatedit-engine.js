import { EXT_DISPLAY, CHAT_EDIT_FORMAT_BLOCK, DEFAULT_CHAT_EDIT_DIRECTIVE } from '../constants.js';
import { getSettings, getCurrentSession, addMessage } from '../session.js';
import { applySearchReplaceToField, _repairJSON } from '../utils/util-text.js';
import { escHtml } from '../utils/util-dom.js';

export function buildChatEditAIInstructions(settings) {
    if (!settings.chatEditAIEnabled) return '';
    const ctx = SillyTavern.getContext();
    const stMsgs = ctx.chat || [];
    const chatDisplayName = ctx.chatMetadata?.name || (typeof window.chat_file_name === 'string' ? window.chat_file_name : '') || 'unknown';
    const depth = Math.max(0, parseInt(settings.contextDepth) || 0);
    let slice;
    try {
        const sess = getCurrentSession();
        const picked = sess.pickedChatIndices;
        if (picked && picked.length > 0) {
            slice = picked.filter(i => i >= 0 && i < stMsgs.length);
        } else {
            slice = depth > 0 ? stMsgs.slice(-depth).map((_, i) => stMsgs.length - depth + i) : [];
        }
    } catch(_) {
        slice = depth > 0 ? stMsgs.slice(-depth).map((_, i) => stMsgs.length - depth + i) : [];
    }
    const activeChatIds = slice.map(i => `#${i}`).join(', ') || 'none';
    const base = (settings.chatEditPrompt || DEFAULT_CHAT_EDIT_DIRECTIVE.trim())
        .replace('{{chat_edit_format}}', CHAT_EDIT_FORMAT_BLOCK)
        .replace('{{active_chat_ids}}', activeChatIds);
    const chatNameNote = `\nCurrent chat name: "${chatDisplayName}"`;
    return `<chat_messages_editing>\n${base}${chatNameNote}\n</chat_messages_editing>`;
}

export function parseChatChangesFromText(text) {
    let raw = null;
    const strict = text.match(/```chat-changes\s*([\s\S]*?)```/);
    if (strict) { raw = strict[1].trim(); }
    else {
        const open = text.match(/```chat-changes\s*([\s\S]*?)(?=```|$)/);
        if (open) raw = open[1].trim();
    }
    if (!raw) return null;
    try {
        const data = JSON.parse(raw);
        if (Array.isArray(data.changes)) return _sanitizeChatChanges(data.changes);
    } catch (_) {}
    try {
        const data = JSON.parse(_repairJSON(raw));
        if (Array.isArray(data.changes)) return _sanitizeChatChanges(data.changes);
    } catch (_) {}
    return null;
}

export function _sanitizeChatChanges(changes) {
    if (!Array.isArray(changes)) return null;
    const valid = [];
    for (const c of changes) {
        if (!c || typeof c !== 'object') continue;
        if (!['replace', 'overwrite', 'prepend', 'append', 'bulk_replace', 'regex', 'delete', 'add', 'hide', 'unhide', 'rename_chat'].includes(c.action)) continue;

        if (c.action === 'rename_chat') {
            if (!c.name?.trim()) continue;
            valid.push(c);
            continue;
        }

        if (c.msg_indices !== undefined) {
            if (typeof c.msg_indices === 'string') {
                c.msg_indices = c.msg_indices.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
            }
            if (!Array.isArray(c.msg_indices) || !c.msg_indices.length) delete c.msg_indices;
            else c.msg_indices = [...new Set(c.msg_indices)].sort((a, b) => a - b);
        }

        if (c.action === 'add') {
            if (!c.role) c.role = 'assistant';
            if (c.msg_index === undefined) c.msg_index = 99999;
        } else if (c.action === 'bulk_replace' || c.action === 'hide' || c.action === 'unhide') {
            if (c.action === 'bulk_replace' && (!Array.isArray(c.replacements) || (!Array.isArray(c.msg_range) && !Array.isArray(c.msg_indices)))) continue;
            if (c.action === 'bulk_replace') {
                c.replacements = c.replacements.map(r => {
                    if (typeof r === 'object') {
                        r.search = r.search || r.anchor;
                        if (r.search !== undefined) return r;
                    }
                    return null;
                }).filter(Boolean);
            }
        } else {
            if (c.msg_index === undefined && c.msg_id === undefined && c.msg_range === undefined && !c.msg_indices) continue;
        }
        if (c.action === 'replace' && Array.isArray(c.patches)) {
            c.patches = c.patches.map(p => {
                if (typeof p === 'object') {
                    p.search = p.search || p.anchor;
                    if (p.search !== undefined) return p;
                }
                return null;
            }).filter(Boolean);
        }
        valid.push(c);
    }
    return valid.length ? valid : null;
}

export function stripChatChangesBlock(text) {
    return text.replace(/```chat-changes[\s\S]*?```/g, '').replace(/```chat-changes[\s\S]*/g, '').trim();
}

export function reconstructChatChangesBlock(pendingChanges) {
    if (!pendingChanges.length) return '';
    return '```chat-changes\n{"changes": ' + JSON.stringify(pendingChanges, null, 2) + '}\n```';
}

export function _resolveStMsgByIndexOrId(change) {
    const ctx = SillyTavern.getContext();
    const msgs = ctx.chat || [];
    if (typeof change.msg_index === 'number') {
        if (change.msg_index >= 0 && change.msg_index < msgs.length) {
            return { idx: change.msg_index, msg: msgs[change.msg_index] };
        }
    }
    return null;
}

export async function _saveChatMessage(ctx, idx, msg) {
    try {
        if (typeof ctx.saveChat === 'function') await ctx.saveChat();
        else if (typeof window.saveChat === 'function') await window.saveChat();
        const es = ctx.eventSource || window.eventSource;
        const et = ctx.event_types || window.event_types;
        if (es && et?.MESSAGE_UPDATED) {
            es.emit(et.MESSAGE_UPDATED, idx);
        }
    } catch(e) { console.warn('[ChatEdit] Save error:', e); }
}

export async function _saveChatAfterDelete(ctx) {
    try {
        if (typeof ctx.saveChat === 'function') await ctx.saveChat();
        else if (typeof window.saveChat === 'function') await window.saveChat();
    } catch(e) {}
}

export function _refreshSTChatDOM(ctx) {
    try {
        const es = ctx.eventSource || window.eventSource;
        const et = ctx.event_types || window.event_types;
        if (es && et?.CHAT_CHANGED) es.emit(et.CHAT_CHANGED);
        if (typeof window.printMessages === 'function') window.printMessages();
        else if (typeof ctx.printMessages === 'function') ctx.printMessages();
    } catch(_) {}
}

export async function logChatEditHistory(changes, statusStr, afterMsgId = null) {
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
        
        const uiChatMod = await import('../ui/ui-chat.js');
        if (afterMsgId && uiChatMod.addHistoryToSwipe(afterMsgId, newLines)) return;

        const histText = `**System Notification** — Chat message edits:\n${newLines.join('\n')}`;
        const msg = addMessage(session, 'system', histText, { isChatEditHistory: true, isLBHistory: true, appliedLines: [...newLines] });
        
        const lbUiMod = await import('./feature-lorebook-ui.js');
        if (lbUiMod.appendLBHistoryEl) {
            lbUiMod.appendLBHistoryEl(msg);
        }
    } catch(_) {}
}

export async function applyChatChanges(changes, afterMsgId = null) {
    const ctx = SillyTavern.getContext();
    const msgs = ctx.chat;
    if (!msgs) { toastr.error('[ChatEdit] No active chat.', EXT_DISPLAY); return; }
    const successLog = [];

    for (const change of changes) {
        try {
            if (change.action === 'rename_chat') {
                const newName = change.name.trim();
                const ctx2 = SillyTavern.getContext();
                const oldFileName = window.chat_file_name;
                
                try {
                    if (typeof ctx2.executeSlashCommandsWithOptions === 'function') {
                        await ctx2.executeSlashCommandsWithOptions(`/renamechat ${newName}`);
                    }
                    
                    if (window.chat_file_name && window.chat_file_name !== oldFileName) {
                        const sess = getCurrentSession();
                        if (sess && sess.stChatId === oldFileName) {
                            sess.stChatId = window.chat_file_name;
                        }
                    }
                    
                    if (ctx2.chatMetadata) {
                        ctx2.chatMetadata.name = newName;
                    }
                    successLog.push(change);
                } catch(e) {
                    console.error('[ChatEdit] Error renaming chat', e);
                }
                continue;
            }
            if (change.action === 'hide' || change.action === 'unhide') {
                const cmd = change.action === 'hide' ? '/hide' : '/unhide';
                if (Array.isArray(change.msg_indices) && change.msg_indices.length) {
                    const valid = change.msg_indices.filter(i => i >= 0 && i < msgs.length);
                    if (typeof ctx.executeSlashCommandsWithOptions === 'function') {
                        for (const idx of valid) {
                            await ctx.executeSlashCommandsWithOptions(`${cmd} ${idx}-${idx}`);
                        }
                    }
                    successLog.push({ ...change, affectedCount: valid.length });
                } else {
                    let startIdx = 0, endIdx = msgs.length - 1;
                    if (Array.isArray(change.msg_range)) {
                        startIdx = change.msg_range[0]; endIdx = change.msg_range[1];
                    } else if (change.msg_index !== undefined) {
                        startIdx = change.msg_index; endIdx = change.msg_index;
                    }
                    if (typeof ctx.executeSlashCommandsWithOptions === 'function') {
                        await ctx.executeSlashCommandsWithOptions(`${cmd} ${startIdx}-${endIdx}`);
                    }
                    successLog.push({ ...change, affectedCount: endIdx - startIdx + 1 });
                }
                continue;
            }

            if (change.action === 'add') {
                const isSys = change.role === 'system';
                const isUser = change.role === 'user';
                const newMsg = {
                    name: isSys ? 'System' : (isUser ? (ctx.name1 || 'User') : (ctx.name2 || 'Character')),
                    is_user: isUser,
                    is_system: isSys,
                    send_date: Date.now(),
                    mes: change.content || '',
                    extra: {}
                };
                let insertIdx = msgs.length;
                if (typeof change.msg_index === 'number' && change.msg_index >= 0) {
                    insertIdx = Math.min(change.msg_index, msgs.length);
                }
                msgs.splice(insertIdx, 0, newMsg);
                await _saveChatAfterDelete(ctx);
                successLog.push(change);
                continue;
            }

            if (change.action === 'bulk_replace' || change.action === 'regex') {
                let targetIndices = [];
                if (Array.isArray(change.msg_indices) && change.msg_indices.length) {
                    targetIndices = change.msg_indices.filter(i => i >= 0 && i < msgs.length);
                } else {
                    let startIdx = 0, endIdx = msgs.length - 1;
                    if (Array.isArray(change.msg_range)) {
                        startIdx = change.msg_range[0]; endIdx = change.msg_range[1];
                    } else if (change.msg_index !== undefined) {
                        startIdx = change.msg_index; endIdx = change.msg_index;
                    }
                    for (let i = Math.max(0, startIdx); i <= Math.min(msgs.length - 1, endIdx); i++) targetIndices.push(i);
                }

                let affected = 0;
                for (const i of targetIndices) {
                    const msg = msgs[i];
                    let content = msg.mes || '';
                    let changed = false;

                    if (change.action === 'bulk_replace') {
                        for (const rp of (change.replacements || [])) {
                            if (!rp.search && !rp.anchor) continue;
                            const { result, matched } = applySearchReplaceToField(content, rp.search || rp.anchor, rp.replace || '');
                            if (matched) { content = result; changed = true; }
                        }
                    } else if (change.action === 'regex') {
                        try {
                            const m = (change.regex || '').match(/^\/([\s\S]+)\/([a-z]*)$/i);
                            const re = m ? new RegExp(m[1], m[2]) : new RegExp(change.regex, 'g');
                            if (re.test(content)) {
                                content = content.replace(re, change.replace || '');
                                changed = true;
                            }
                        } catch(e) { toastr.error(`[ChatEdit] Invalid regex: ${change.regex}`, EXT_DISPLAY); }
                    }

                    if (changed) {
                        msg.mes = content;
                        await _saveChatMessage(ctx, i, msg);
                        affected++;
                    }
                }
                successLog.push({ ...change, affectedCount: affected });
                continue;
            }

            if (Array.isArray(change.msg_indices) && change.msg_indices.length) {
                let allSuccess = true;
                const sortedIndices = [...change.msg_indices].sort((a, b) =>
                    change.action === 'delete' ? b - a : a - b
                );
                for (const idx of sortedIndices) {
                    if (idx < 0 || idx >= msgs.length) {
                        toastr.warning(`[ChatEdit] Message #${idx} not found`, EXT_DISPLAY, { timeOut: 6000 });
                        allSuccess = false; continue;
                    }
                    const msg = msgs[idx];
                    if (change.action === 'delete') {
                        msgs.splice(idx, 1);
                        await _saveChatAfterDelete(ctx);
                        continue;
                    }
                    let content = msg.mes || '';
                    if (change.action === 'overwrite') {
                        content = change.content || '';
                    } else if (change.action === 'prepend') {
                        content = (change.content || '') + content;
                    } else if (change.action === 'append') {
                        content = content + (change.content || '');
                    } else if (change.action === 'replace') {
                        let matched = true;
                        for (const patch of (change.patches || [])) {
                            const { result, matched: m } = applySearchReplaceToField(content, patch.search || patch.anchor || '', patch.replace || '');
                            if (!m) { toastr.warning(`[ChatEdit] ANCHOR not found in #${idx}: "${(patch.search || patch.anchor || '').slice(0, 60)}"`, EXT_DISPLAY, { timeOut: 8000 }); matched = false; break; }
                            content = result;
                        }
                        if (!matched) { allSuccess = false; continue; }
                    }
                    msg.mes = content;
                    await _saveChatMessage(ctx, idx, msg);
                }
                if (allSuccess) successLog.push(change);
                continue;
            }

            const resolved = _resolveStMsgByIndexOrId(change);
            if (!resolved) {
                toastr.warning(`[ChatEdit] Message not found: Index ${change.msg_index ?? change.msg_id}`, EXT_DISPLAY, { timeOut: 6000 });
                continue;
            }
            const { idx, msg } = resolved;

            if (change.action === 'delete') {
                msgs.splice(idx, 1);
                if (typeof ctx.deleteMessage === 'function') ctx.deleteMessage(idx);
                else await _saveChatAfterDelete(ctx);
                successLog.push(change);
                continue;
            }

            let content = msg.mes || '';
            if (change.action === 'overwrite') {
                content = change.content || '';
            } else if (change.action === 'prepend') {
                content = (change.content || '') + content;
            } else if (change.action === 'append') {
                content = content + (change.content || '');
            } else if (change.action === 'replace') {
                let allMatched = true;
                for (const patch of (change.patches || [])) {
                    const { result, matched } = applySearchReplaceToField(content, patch.search || patch.anchor || '', patch.replace || '');
                    if (!matched) {
                        toastr.warning(`[ChatEdit] ANCHOR not found in message ${change.msg_index ?? change.msg_id}: "${(patch.search || patch.anchor || '').slice(0, 60)}"`, EXT_DISPLAY, { timeOut: 8000 });
                        allMatched = false; break;
                    }
                    content = result;
                }
                if (!allMatched) continue;
            }
            msg.mes = content;
            await _saveChatMessage(ctx, idx, msg);
            successLog.push(change);
        } catch (e) {
            console.error(`[ST-Copilot-Debug] ChatEdit Failed:`, e);
            toastr.error(`[ChatEdit] Failed on change: ${e.message}`, EXT_DISPLAY, { timeOut: 10000 });
        }
    }

    if (successLog.length > 0) {
        setTimeout(() => _refreshSTChatDOM(ctx), 100);
        await logChatEditHistory(successLog, 'Applied', afterMsgId);
        toastr.success(`[ChatEdit] ${successLog.length} change(s) applied.`, EXT_DISPLAY);
    }
}