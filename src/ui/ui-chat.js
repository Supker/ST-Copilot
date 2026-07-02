import { I, EXT_DISPLAY, THEME_PRESETS, WIN_ID } from '../constants.js';
import { state } from '../state.js';
import { getSettings, saveSettings, getCurrentSession, saveSessionsToMetadata, addMessage, deleteMsg, truncateAfter, truncateFrom, expandMacros, getEffectiveSettings, getBindingKey, initChatBucket, isMessageStarred, toggleStarMessage } from '../session.js';
import { _dbgAdd } from '../utils/util-debug.js';
import { escHtml, autoResize, showCustomDialog, copyText } from '../utils/util-dom.js';
import { getCharInfo } from '../utils/util-st.js';
import { applyRegexIfEnabled } from '../integrations/integ-regex.js';

import { parseLBChangesFromText, stripLBChangesBlock } from '../features/feature-lorebook-engine.js';
import { renderProposalCard, appendLBHistoryEl } from '../features/feature-lorebook-ui.js';
import { parseCharChangesFromText, stripCharChangesBlock, parseCharCreationFromText, stripCharCreationBlock } from '../features/feature-character-engine.js';
import { renderCharProposalCard, renderCharCreationCard } from '../features/feature-character-ui.js';
import { normalizeCharNamesInBlock, applySearchReplaceToField } from '../utils/util-text.js';
import { parseChatChangesFromText, stripChatChangesBlock } from '../features/feature-chatedit-engine.js';
import { renderChatProposalCard } from '../features/feature-chatedit-ui.js';
import { stripMemoryBlock } from '../features/feature-memory.js';
import { parseToolCallsFromText } from '../features/feature-tools-engine.js';
import { postProcessToolCalls } from '../features/feature-tools-ui.js';
import { recordStat, SM } from '../features/feature-stats.js';
import { _processAttachmentsBeforeSend, _mergeContent, _renderAttachmentPreviews, _openImageLightbox, _openTextLightbox } from '../features/feature-attachments.js';

let apiMod = null;
import('../api.js').then(m => apiMod = m);
let uiWinMod = null;
import('./ui-window.js').then(m => uiWinMod = m);
let uiWdgMod = null;
import('./ui-widgets.js').then(m => uiWdgMod = m);
let uiSetMod = null;
import('./ui-settings.js').then(m => uiSetMod = m);
let featCharUiMod = null;
import('../features/feature-character-ui.js').then(m => featCharUiMod = m);

// ─── Text Render and Markdown ────────────────────────────────────────────────

export function renderMarkdown(text) {
    const codeBlocks = [];
    let out = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
        if (lang && lang.toLowerCase() === 'html') {
            const id = `scp-hb-${state.htmlBlockCounter++}`;
            state.htmlBlockRegistry.set(id, code.trim());
            return `\x00H${id}\x00`;
        }
        const i = codeBlocks.length;
        const escaped = code.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        codeBlocks.push(`<pre class="scp-code-block${lang ? ` lang-${lang}` : ''}"><code>${escaped}</code></pre>`);
        return `\x00B${i}\x00`;
    });

    out = out.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    out = out.replace(/`([^`\n]+)`/g, '<code class="scp-inline-code">$1</code>');

    const applyInline = (s) => {
        let res = s;
        res = res.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
        res = res.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        res = res.replace(/~~(.+?)~~/g, '<del>$1</del>');
        res = res.replace(/\*([^<>\*\n]+)\*/g, '<em>$1</em>');
        return res;
    };

    const lines = out.split('\n');

    const getULIndent = (l) => { const m = l.match(/^(\s*)[*\-+]\s+\S/); return m ? m[1].length : -1; };
    const getOLIndent = (l) => { const m = l.match(/^(\s*)\d+\.\s+\S/); return m ? m[1].length : -1; };
    const isListLine = (l) => getULIndent(l) >= 0 || getOLIndent(l) >= 0;

    const buildNestedList = (listLines) => {
        const stack = [];
        let r = '';
        const closeUntil = (targetIndent, targetType) => {
            while (stack.length) {
                const top = stack[stack.length - 1];
                if (top.indent > targetIndent || (top.indent === targetIndent && top.type !== targetType)) {
                    r += `</li></${top.type}>`;
                    stack.pop();
                } else {
                    break;
                }
            }
        };
        for (let line of listLines) {
            if (!line.trim()) continue;
            if (!isListLine(line)) {
                r += `<br>${applyInline(line.trim())}`;
                continue;
            }
            const ulI = getULIndent(line);
            const olI = getOLIndent(line);
            const indent = ulI >= 0 ? ulI : olI;
            const type = ulI >= 0 ? 'ul' : 'ol';
            const cls = `scp-list${type === 'ol' ? ' scp-list-ol' : ''}`;
            
            let content = type === 'ul'
                ? line.replace(/^\s*[*\-+]\s+/, '')
                : line.replace(/^\s*\d+\.\s+/, '');
            
            content = applyInline(content);
            closeUntil(indent, type);
            
            if (stack.length && stack[stack.length - 1].indent === indent && stack[stack.length - 1].type === type) {
                r += `</li><li>${content}`;
            } else {
                r += `<${type} class="${cls}"><li>${content}`;
                stack.push({ indent, type });
            }
        }
        while (stack.length) r += `</li></${stack.pop().type}>`;
        return r;
    };

    const segs = [];
    const pushBlock = (h) => segs.push({ t: 'block', h });
    const pushInline = (h) => segs.push({ t: 'inline', h });

    let listBuf = [];
    let tableRows = [];
    let bqLines = [];

    const flushList = () => {
        if (!listBuf.length) return;
        pushBlock(buildNestedList(listBuf));
        listBuf = [];
    };
    const flushTable = () => {
        if (!tableRows.length) return;
        pushBlock(`<div class="scp-table-wrap"><table class="scp-table"><tbody>${tableRows.join('')}</tbody></table></div>`);
        tableRows = [];
    };
    const flushBq = () => {
        if (!bqLines.length) return;
        pushBlock(`<blockquote class="scp-blockquote">${bqLines.join('<br>')}</blockquote>`);
        bqLines = [];
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimLine = line.trim();

        if (/^(---+|\*\*\*+|___+)$/.test(trimLine)) {
            flushList(); flushTable(); flushBq();
            pushBlock('<hr class="scp-hr">');
            continue;
        }

        const hm = line.match(/^(#{1,6})\s+(.+)/);
        if (hm) {
            flushList(); flushTable(); flushBq();
            pushBlock(`<span class="scp-h${hm[1].length}">${applyInline(hm[2])}</span>`);
            continue;
        }

        const bq = line.match(/^&gt;\s*(.*)/);
        if (bq) { flushList(); flushTable(); bqLines.push(applyInline(bq[1])); continue; }

        const tm = trimLine.match(/^\|(.*)\|$/);
        if (tm) {
            flushList(); flushBq();
            if (/^[|\s\-:]+$/.test(trimLine)) continue;
            const cells = tm[1].split('|').map(c => applyInline(c.trim()));
            const tag = tableRows.length === 0 ? 'th' : 'td';
            tableRows.push(`<tr>${cells.map(c => `<${tag}>${c}</${tag}>`).join('')}</tr>`);
            continue;
        }

        if (isListLine(line)) {
            flushTable(); flushBq();
            listBuf.push(line);
            continue;
        }

        if (listBuf.length > 0 && trimLine && /^\s+/.test(line)) {
            listBuf.push(line);
            continue;
        }

        if (!trimLine) {
            let nextNonEmpty = '';
            for (let j = i + 1; j < lines.length; j++) {
                if (lines[j].trim()) { nextNonEmpty = lines[j]; break; }
            }
            if (nextNonEmpty && isListLine(nextNonEmpty)) {
                listBuf.push('');
            } else {
                flushList(); flushTable(); flushBq();
                pushInline('');
            }
            continue;
        }

        flushList(); flushTable(); flushBq();
        pushInline(applyInline(line));
    }
    flushList(); flushTable(); flushBq();

    let result = '';
    for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        if (seg.t === 'inline' && i > 0 && segs[i - 1].t === 'inline') result += '<br>';
        result += seg.h;
    }
    out = result;

    out = out.replace(/\x00H(scp-hb-\d+)\x00/g, (_, id) => `<div class="scp-html-block-ph" data-hbid="${id}"></div>`);
    out = out.replace(/\x00B(\d+)\x00/g, (_, i) => codeBlocks[+i]);
    out = out.replace(/\x00TC_(\d+)\x00/g, (_, i) => `<div class="scp-tool-call-ph" data-tcid="${i}"></div>`);
    out = out.replace(/(<div class="scp-tool-call-ph"[^>]*><\/div>)(?:<br>|\s)*/g, '$1');

    return out;
}

export function prepareHtmlForIframe(code) {
    const cs = `<script>(function(){
function isTransparent(c){return !c||c==='transparent'||c==='rgba(0, 0, 0, 0)'||c==='rgba(0,0,0,0)';}
function hasVisualBg(el){
if(!el) return false;
var cs=window.getComputedStyle(el);
if(!isTransparent(cs.backgroundColor)) return true;
if(cs.backgroundImage&&cs.backgroundImage!=='none') return true;
return false;
}
function applyFallbackTheme(){
var b=document.body,d=document.documentElement;
var hasBg=false;
if(hasVisualBg(d)||hasVisualBg(b)) hasBg=true;
if(!hasBg){
    var styled=document.querySelectorAll('[style]');
    for(var i=0;i<styled.length;i++){if(hasVisualBg(styled[i])){hasBg=true;break;}}
}
if(!hasBg){
    var styleText='';
    var styleEls=document.querySelectorAll('style');
    for(var j=0;j<styleEls.length;j++) styleText+=styleEls[j].textContent;
    if(/(?:body|html|:root)\s*\{[^}]*background/i.test(styleText)) hasBg=true;
}
if(!hasBg){
    b.style.backgroundColor='#ffffff';
    b.style.color='#1a1a1a';
    window.parent.postMessage({type:'scp-iframe-bg',hasBg:false},'*');
} else {
    window.parent.postMessage({type:'scp-iframe-bg',hasBg:true},'*');
}
}
function sh(){var b=document.body,d=document.documentElement;var h=Math.max(b?b.scrollHeight:0,b?b.offsetHeight:0,d.scrollHeight,d.offsetHeight);window.parent.postMessage({type:'scp-iframe-h',h:h},'*');}
window.addEventListener('load',function(){
applyFallbackTheme();
sh();setTimeout(sh,150);setTimeout(sh,500);
if(window.ResizeObserver&&document.body){new ResizeObserver(sh).observe(document.body);}
else{var t;try{new MutationObserver(function(){clearTimeout(t);t=setTimeout(sh,80);}).observe(document.documentElement,{childList:true,subtree:true,attributes:true,characterData:true});}catch(e){}}
});
window.onerror=function(m){window.parent.postMessage({type:'scp-iframe-err',msg:String(m)},'*');return true;};
})();<\/script>`;
    const hasHtml = /<html[\s>]/i.test(code);
    if (hasHtml) {
        return /<\/body>/i.test(code) ? code.replace(/<\/body>/i, cs + '</body>') : code + cs;
    }
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}html,body{margin:0;padding:8px;font-family:system-ui,sans-serif;background:transparent}</style></head><body>${code}${cs}</body></html>`;
}

export function createHTMLBlockEl(code) {
    const wrap = document.createElement('div');
    wrap.className = 'scp-html-block';

    const toolbar = document.createElement('div');
    toolbar.className = 'scp-html-block-toolbar';
    const label = document.createElement('span');
    label.className = 'scp-html-block-label';
    label.textContent = 'HTML';
    const previewBtn = document.createElement('button');
    previewBtn.className = 'scp-html-block-btn active';
    previewBtn.textContent = 'Preview';
    const codeBtn = document.createElement('button');
    codeBtn.className = 'scp-html-block-btn';
    codeBtn.textContent = 'Code';
    const copyBtn = document.createElement('button');
    copyBtn.className = 'scp-html-block-btn';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', e => { e.stopPropagation(); copyText(code); });
    toolbar.append(label, previewBtn, codeBtn, copyBtn);

    const errorEl = document.createElement('div');
    errorEl.className = 'scp-html-block-error';
    errorEl.style.display = 'none';

    const iframe = document.createElement('iframe');
    iframe.className = 'scp-html-block-iframe';
    iframe.setAttribute('sandbox', 'allow-scripts allow-modals allow-forms allow-popups allow-pointer-lock allow-downloads');
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    iframe.srcdoc = prepareHtmlForIframe(code);

    const codePre = document.createElement('pre');
    codePre.className = 'scp-code-block scp-html-block-code';
    codePre.style.display = 'none';
    codePre.textContent = code;

    previewBtn.addEventListener('click', () => {
        iframe.style.display = '';
        codePre.style.display = 'none';
        previewBtn.classList.add('active');
        codeBtn.classList.remove('active');
    });
    codeBtn.addEventListener('click', () => {
        iframe.style.display = 'none';
        codePre.style.display = '';
        codeBtn.classList.add('active');
        previewBtn.classList.remove('active');
    });

    wrap.append(toolbar, errorEl, iframe, codePre);
    return wrap;
}

export function postProcessHTMLBlocks(el) {
    el.querySelectorAll('.scp-html-block-ph').forEach(ph => {
        const code = state.htmlBlockRegistry.get(ph.dataset.hbid);
        if (code !== undefined) ph.replaceWith(createHTMLBlockEl(code));
    });
}

export function getDisplayContent(rawText, settings) {
    let text = rawText;
    const trimLines = (settings.reasoningTrimStrings || '').split('\n').map(s => s.trim()).filter(Boolean);
    for (const ts of trimLines) text = text.split(ts).join('');
    
    const pats = [/<think>([\s\S]*?)<\/think>/i, /<thinking>([\s\S]*?)<\/thinking>/i];
    let reasoning = null;
    for (const p of pats) {
        const m = text.match(p);
        if (m) { reasoning = m[1].trim() || null; text = text.replace(m[0], '').trim(); break; }
    }
    return { reasoning, content: text };
}

export function extractToolCallPlaceholders(text, startIndex = 0) {
    let tcIndex = startIndex;
    let result = text;
    
    result = result.replace(/```tool_call\n?([\s\S]*?)```/gi, (match, inner) => {
        const blockTcs = parseToolCallsFromText(`\`\`\`tool_call\n${inner}\n\`\`\``);
        let phs = '';
        const count = Math.max(1, blockTcs.length);
        for (let i = 0; i < count; i++) {
            phs += `\x00TC_${tcIndex++}\x00`;
        }
        return phs;
    });
    
    result = result.replace(/```tool_call\n?([\s\S]*)$/gi, (match, inner) => {
        const blockTcs = parseToolCallsFromText(`\`\`\`tool_call\n${inner}\n\`\`\``);
        let phs = '';
        const count = Math.max(1, blockTcs.length);
        for (let i = 0; i < count; i++) {
            phs += `\x00TC_${tcIndex++}\x00`;
        }
        return phs;
    });
    
    return { text: result, nextIndex: tcIndex };
}

// ─── Rendering messages ──────────────────────────────────────────────────────

export function _renderMsgBodyContent(msgEl, msg) {
    const settings = getSettings();
    msgEl.querySelectorAll('.scp-tool-call-item').forEach(c => c.remove());

    const cleanContent = stripMemoryBlock(msg.content);
    let displayText = cleanContent;
    let reasoning = msg.reasoning !== undefined ? (msg.reasoning || null) : null;

    let tcIndex = 0;
    if (reasoning) {
        const resR = extractToolCallPlaceholders(reasoning, tcIndex);
        reasoning = resR.text;
        tcIndex = resR.nextIndex;
    }
    
    const resC = extractToolCallPlaceholders(displayText, tcIndex);
    displayText = resC.text;
    tcIndex = resC.nextIndex;

    if (msg.reasoning === undefined || msg.reasoning === null) {
        const d = getDisplayContent(displayText, settings);
        reasoning = d.reasoning;
        displayText = d.content;
        if (msg.reasoning === undefined) msg.reasoning = reasoning;
    }

    const body = msgEl.querySelector('.scp-msg-body');
    if (!body) return;

    msgEl.querySelectorAll('.scp-lb-proposal-card').forEach(c => c.remove());
    msgEl.querySelectorAll('.scp-char-proposal-card').forEach(c => c.remove());
    msgEl.querySelectorAll('.scp-char-creation-card').forEach(c => c.remove());
    msgEl.querySelectorAll('.scp-chat-proposal-card').forEach(c => c.remove());
    msgEl.querySelectorAll('.scp-msg-hist-wrap').forEach(c => c.remove());

    let rBlock = msgEl.querySelector('.scp-reasoning-block');
    if (reasoning) {
        if (!rBlock) {
            rBlock = document.createElement('details');
            rBlock.className = 'scp-reasoning-block';
            rBlock.innerHTML = `<summary class="scp-reasoning-summary">Reasoning</summary><div class="scp-reasoning-content"></div>`;
            body.insertBefore(rBlock, body.firstChild);
        }
        rBlock.style.display = '';
        rBlock.querySelector('.scp-reasoning-content').innerHTML = renderMarkdown(reasoning);
        postProcessHTMLBlocks(rBlock.querySelector('.scp-reasoning-content'));
    } else if (rBlock) {
        rBlock.remove();
    }

    const contentEl = msgEl.querySelector('.scp-msg-content');
    
    if (msg.attachments && msg.attachments.length > 0) {
        const attWrap = document.createElement('div');
        attWrap.className = 'scp-msg-attachments';
        msg.attachments.forEach(att => {
            const badge = document.createElement('div');
            badge.className = 'scp-msg-att-badge';
            if (att.isImage) {
                badge.innerHTML = `<img src="${att.dataUrl}"> <span>${escHtml(att.name)}</span>`;
                badge.onclick = () => _openImageLightbox(att);
            } else {
                badge.innerHTML = `<i class="fa-solid fa-file"></i> <span>${escHtml(att.name)}</span>`;
                badge.onclick = () => _openTextLightbox(att);
            }
            attWrap.appendChild(badge);
        });
        body.insertBefore(attWrap, body.firstChild);
    }

    if (contentEl) {
        const lbChanges = parseLBChangesFromText(msg.content);
        const charChanges = parseCharChangesFromText(msg.content);
        const charCreation = parseCharCreationFromText(msg.content);
        const chatChanges = parseChatChangesFromText(msg.content);
        const needsStrip = lbChanges?.length || charChanges?.length || charCreation || chatChanges?.length;

        if (needsStrip) {
            let stripped = displayText;
            if (lbChanges?.length) stripped = stripLBChangesBlock(stripped);
            if (charChanges?.length) stripped = stripCharChangesBlock(stripped);
            if (charCreation) stripped = stripCharCreationBlock(stripped);
            if (chatChanges?.length) stripped = stripChatChangesBlock(stripped);
            
            contentEl.innerHTML = renderMarkdown(getDisplayContent(stripped, settings).content);
            postProcessHTMLBlocks(contentEl);
            
            if (lbChanges?.length) renderProposalCard(lbChanges, msgEl);
            if (charChanges?.length) renderCharProposalCard(charChanges, msgEl);
            if (charCreation) renderCharCreationCard(charCreation, msgEl);
            if (chatChanges?.length) renderChatProposalCard(chatChanges, msgEl);
        } else {
            contentEl.innerHTML = renderMarkdown(getDisplayContent(displayText, settings).content);
            postProcessHTMLBlocks(contentEl);
        }
    }

    const currentSwipe = msg.swipes?.[msg.swipeIndex || 0];
    if (currentSwipe?.historyLines?.length) {
        const hw = document.createElement('div');
        hw.className = 'scp-msg-hist-wrap';
        
        const cEl = document.createElement('div');
        cEl.className = 'scp-msg-content scp-lb-history-content';
        cEl.style.cssText = 'margin-top:10px; padding:8px 12px; background:var(--scp-accent-bg); border:1px solid var(--scp-accent-dim); border-radius:6px;';
        
        import('../features/feature-lorebook-ui.js').then(m => m.renderLBHistoryContent({ appliedLines: currentSwipe.historyLines }, cEl));

        hw.appendChild(cEl);
        
        const swipeBar = body.querySelector('.scp-swipe-bar');
        if (swipeBar) body.insertBefore(hw, swipeBar);
        else body.appendChild(hw);
    }

    _updateMsgTokenCount(msgEl, msg.content, true);

    let liveTCs = msg.toolCalls || [];
    if (!liveTCs.length && tcIndex > 0) {
        liveTCs = parseToolCallsFromText((msg.reasoning || '') + '\n' + msg.content).map((tc, i) => ({
            id: `past_${i}`, name: tc.name, input: tc.input, status: 'done', result: 'Result hidden/expired'
        }));
    }
    if (liveTCs.length) {
        postProcessToolCalls(msgEl, liveTCs);
    }
}

export function _updateMsgTokenCount(msgEl, content, forceRecalc = false) {
    const el = msgEl.querySelector ? msgEl.querySelector('.scp-msg-token-count') : null;
    if (!el) return;
    if (!forceRecalc) {
        const cached = state.tokenCountCache.get(content);
        if (cached !== undefined) { el.textContent = `${cached}t`; return; }
    } else {
        el.textContent = '\u2026';
    }
    if (apiMod) {
        apiMod.estimateTokens(content).then(n => {
            state.tokenCountCache.set(content, n);
            if (el.isConnected) el.textContent = `${n}t`;
        });
    }
}

export function createMsgEl(msg, onCopy, onEdit, onDelete, onRegen) {
    const isUser = msg.role === 'user';
    const wrap = document.createElement('div');
    wrap.className = `scp-msg ${isUser ? 'scp-msg-user' : 'scp-msg-assistant'}`;
    wrap.dataset.id = msg.id;

    const avatarWrap = document.createElement('div');
    avatarWrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px;flex-shrink:0';

    const avatar = document.createElement('div');
    avatar.className = 'scp-msg-avatar';
    avatar.innerHTML = isUser ? I.user : I.bot;

    const tokenCountEl = document.createElement('div');
    tokenCountEl.className = 'scp-msg-token-count';
    tokenCountEl.textContent = '…';
    _updateMsgTokenCount({ querySelector: () => tokenCountEl, isConnected: true }, msg.content);

    avatarWrap.appendChild(avatar);
    avatarWrap.appendChild(tokenCountEl);

    const body = document.createElement('div');
    body.className = 'scp-msg-body';

    const content = document.createElement('div');
    content.className = 'scp-msg-content';
    body.appendChild(content);

    const meta = document.createElement('div');
    meta.className = 'scp-msg-meta';
    meta.textContent = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const actions = document.createElement('div');
    actions.className = 'scp-msg-actions';

    const makeBtn = (icon, label, cls, cb) => {
        const b = document.createElement('button');
        b.className = `scp-msg-btn${cls ? ' ' + cls : ''}`;
        b.innerHTML = icon; b.title = label;
        b.addEventListener('click', cb);
        return b;
    };

    actions.appendChild(makeBtn(I.copy, 'Copy', '', () => onCopy(msg)));
    actions.appendChild(makeBtn(I.edit, 'Edit', '', () => onEdit(wrap, msg)));
    actions.appendChild(makeBtn(I.refresh, 'Regen', '', () => onRegen(wrap, msg)));
    actions.appendChild(makeBtn(I.trash, 'Delete', 'scp-msg-btn-danger', () => onDelete(wrap, msg)));

    const isStarred = isMessageStarred(msg.id);
    const starBtn = makeBtn(isStarred ? I.starFill : I.star, isStarred ? 'Unstar' : 'Star message', `scp-msg-btn-star${isStarred ? ' starred' : ''}`, () => {
        const nowStarred = toggleStarMessage(msg.id);
        starBtn.innerHTML = nowStarred ? I.starFill : I.star;
        starBtn.title = nowStarred ? 'Unstar' : 'Star message';
        starBtn.classList.toggle('starred', nowStarred);
        wrap.classList.toggle('scp-msg-starred', nowStarred);
        if (document.getElementById('scp-fav-panel')?.style.display !== 'none' && uiWdgMod) {
            uiWdgMod.renderFavoritesPanel();
        }
    });
    actions.appendChild(starBtn);
    if (isStarred) wrap.classList.add('scp-msg-starred');

    if (!isUser) {
        const continueBtn = makeBtn(I.continueArrow, 'Continue response', 'scp-msg-btn-continue', () => {
            if (apiMod) apiMod.runContinue(getCurrentSession(), msg.id);
        });
        actions.appendChild(continueBtn);
    }

    body.appendChild(actions); body.appendChild(meta);

    if (!isUser) {
        const swipeBar = document.createElement('div');
        swipeBar.className = 'scp-swipe-bar';
        swipeBar.style.display = 'none';

        const prevBtn = document.createElement('button');
        prevBtn.className = 'scp-swipe-btn scp-swipe-prev';
        prevBtn.innerHTML = I.chevronLeft;
        prevBtn.title = 'Previous swipe';
        prevBtn.disabled = true;

        const counter = document.createElement('span');
        counter.className = 'scp-swipe-counter';

        const nextBtn = document.createElement('button');
        nextBtn.className = 'scp-swipe-btn scp-swipe-next';
        nextBtn.innerHTML = I.chevronRight;
        nextBtn.title = 'New swipe (regenerate)';

        prevBtn.addEventListener('click', async () => {
            if (prevBtn.disabled || state.generating) return;
            const session = getCurrentSession();
            if (!getSwipesForMsg(session, msg.id)) return;
            
            const bdy = wrap.querySelector('.scp-msg-body');
            if (bdy) {
                bdy.classList.remove('scp-swipe-anim-right', 'scp-swipe-anim-left');
                bdy.classList.add('scp-swipe-anim-out-right'); 
                await new Promise(r => setTimeout(r, 150));
            }
            
            if (navigateSwipe(session, msg.id, -1)) {
                if (bdy) {
                    bdy.classList.remove('scp-swipe-anim-out-right');
                    void bdy.offsetWidth;
                    bdy.classList.add('scp-swipe-anim-left'); 
                }
                _renderMsgBodyContent(wrap, session.messages.find(m => m.id === msg.id));
                updateSwipeBar(wrap, session, msg.id);
            }
        });

        nextBtn.addEventListener('click', async () => {
            if (nextBtn.disabled || state.generating) return;
            const session = getCurrentSession();
            const msgData = session.messages.find(m => m.id === msg.id);
            if (!msgData) return;
            
            if (msgData.swipeIndex !== undefined && msgData.swipeIndex < (msgData.swipes?.length || 1) - 1) {
                const bdy = wrap.querySelector('.scp-msg-body');
                if (bdy) {
                    bdy.classList.remove('scp-swipe-anim-right', 'scp-swipe-anim-left');
                    bdy.classList.add('scp-swipe-anim-out-left'); 
                    await new Promise(r => setTimeout(r, 150));
                }

                if (navigateSwipe(session, msg.id, 1)) {
                    if (bdy) {
                        bdy.classList.remove('scp-swipe-anim-out-left');
                        void bdy.offsetWidth;
                        bdy.classList.add('scp-swipe-anim-right'); 
                    }
                    _renderMsgBodyContent(wrap, session.messages.find(m => m.id === msg.id));
                    updateSwipeBar(wrap, session, msg.id);
                }
            } else {
                _dbgAdd('SWIPE_REGEN_TRIGGERED', { msgId: msg.id });
                _runSwipeRegen(session, msg.id, wrap);
            }
        });

        swipeBar.appendChild(prevBtn);
        swipeBar.appendChild(counter);
        swipeBar.appendChild(nextBtn);
        body.appendChild(swipeBar);
    }

    wrap.appendChild(avatarWrap); wrap.appendChild(body);
    _renderMsgBodyContent(wrap, msg);
    
    return wrap;
}

// ─── Swipes and Generation ──────────────────────────────────────────────────────

export function getLastAssistantMsgId(session) {
    for (let i = session.messages.length - 1; i >= 0; i--) {
        const m = session.messages[i];
        if (m.role === 'user') return null;
        if (m.role === 'assistant' && !m.isLBHistory && !m.isCharEditHistory && !m.isChatEditHistory) {
            return m.id;
        }
    }
    return null;
}

export function getSwipesForMsg(session, msgId) {
    const msg = session.messages.find(m => m.id === msgId);
    if (!msg) return null;
    if (!msg.swipes) msg.swipes = [{ content: msg.content, reasoning: msg.reasoning || null }];
    if (msg.swipeIndex === undefined) msg.swipeIndex = 0;
    return msg;
}

export function addSwipe(session, msgId, content, reasoning = null) {
    const msg = getSwipesForMsg(session, msgId);
    if (!msg) return;
    msg.swipes.push({ content, reasoning: reasoning || null });
    msg.swipeIndex = msg.swipes.length - 1;
    msg.content = content;
    msg.reasoning = reasoning || null;
    saveSessionsToMetadata();
}

export function navigateSwipe(session, msgId, dir) {
    const msg = getSwipesForMsg(session, msgId);
    if (!msg || msg.swipes.length < 2) return false;
    const newIdx = msg.swipeIndex + dir;
    if (newIdx < 0 || newIdx >= msg.swipes.length) return false;

    _dbgAdd('SWIPE_NAVIGATE', { msgId, dir, newIdx });

    msg.swipeIndex = newIdx;
    msg.content = msg.swipes[newIdx].content;
    msg.reasoning = msg.swipes[newIdx].reasoning || null;
    saveSessionsToMetadata();
    updateMsgCount(session);
    return true;
}

export function updateSwipeBar(msgEl, session, msgId) {
    const bar = msgEl.querySelector('.scp-swipe-bar');
    if (!bar) return;
    const msg = session.messages.find(m => m.id === msgId);
    if (!msg) return;
    if (!msg.swipes) {
        msg.swipes = [{ content: msg.content, reasoning: msg.reasoning || null }];
        msg.swipeIndex = 0;
    }
    const total = msg.swipes.length;
    const cur = (msg.swipeIndex ?? 0) + 1;
    const prevBtn = bar.querySelector('.scp-swipe-prev');
    const nextBtn = bar.querySelector('.scp-swipe-next');
    const counter = bar.querySelector('.scp-swipe-counter');
    if (prevBtn) prevBtn.disabled = cur <= 1 || state.generating;
    if (nextBtn) nextBtn.disabled = state.generating;
    if (counter) counter.innerHTML = `<span>${cur}</span>/${total}`;
    bar.style.display = '';
}

export async function _runSwipeRegen(session, msgId, wrapEl) {
    if (state.generating) return;
    const msgData = session.messages.find(m => m.id === msgId);
    if (!msgData) return;

    if (!msgData.swipes) {
        msgData.swipes = [{ content: msgData.content, reasoning: msgData.reasoning || null }];
        msgData.swipeIndex = 0;
    }

    state.generating = true;
    state.activeToolCalls = [];
    const settings = getEffectiveSettings();
    setGeneratingState(true);

    const body = wrapEl.querySelector('.scp-msg-body');
    if (body) {
        body.classList.remove('scp-swipe-anim-right', 'scp-swipe-anim-left');
        body.classList.add('scp-swipe-anim-out-left');
        await new Promise(r => setTimeout(r, 150));
    }

    const placeholderContent = '';
    msgData.swipes.push({ content: placeholderContent, reasoning: null });
    msgData.swipeIndex = msgData.swipes.length - 1;
    msgData.content = placeholderContent;
    msgData.reasoning = null;
    saveSessionsToMetadata();

    updateSwipeBar(wrapEl, session, msgId);

    let streamContentEl = wrapEl.querySelector('.scp-msg-content');
    if (streamContentEl) streamContentEl.innerHTML = '';
    const rBlock = wrapEl.querySelector('.scp-reasoning-block');
    if (rBlock) rBlock.style.display = 'none';
    
    wrapEl.querySelectorAll('.scp-lb-proposal-card').forEach(c => c.remove());
    wrapEl.querySelectorAll('.scp-msg-hist-wrap').forEach(c => c.remove());

    if (body) {
        body.classList.remove('scp-swipe-anim-out-left');
        void body.offsetWidth;
        body.classList.add('scp-swipe-anim-right');
    }

    let cursorEl = null;
    const cleanupCursor = () => { if (cursorEl?.parentNode) cursorEl.remove(); cursorEl = null; };

    const onChunk = (text, reasoning) => {
        if (!cursorEl) {
            cursorEl = document.createElement('span');
            cursorEl.className = 'scp-stream-cursor';
            const bar = document.getElementById('scp-thinking-bar');
            if (bar) bar.style.display = 'flex';
        }
        if (streamContentEl) {
            let procReasoning = reasoning || '';
            let procText = stripMemoryBlock(text);
            let tcIndex = 0;
            
            if (procReasoning) {
                const resR = extractToolCallPlaceholders(procReasoning, tcIndex);
                procReasoning = resR.text;
                tcIndex = resR.nextIndex;
            }
            const resC = extractToolCallPlaceholders(procText, tcIndex);
            procText = resC.text;

            const { content: disp } = getDisplayContent(procText, settings);
            streamContentEl.innerHTML = renderMarkdown(disp);
            if (procText) streamContentEl.appendChild(cursorEl);
            postProcessHTMLBlocks(streamContentEl);

            if (tcIndex > 0) {
                const liveTCs = parseToolCallsFromText((reasoning || '') + '\n' + text);
                const displayed = liveTCs.map((tc, i) => ({
                    id: `live_${i}`, name: tc.name, input: tc.input, status: 'done', result: undefined
                }));
                postProcessToolCalls(wrapEl, displayed);
            }
        }
        smartScrollToBottom();
    };

    try {
        const tempSession = { ...session, messages: session.messages.filter(m => m.id !== msgId) };
        if (!apiMod) throw new Error("API module not loaded");
        
        const builtMessages = await apiMod.assembleMessages(tempSession, settings, null);
        const fullPromptText = builtMessages.map(m => m.content).join('\n');
        const tokensIn = await apiMod.estimateTokens(fullPromptText);

        const result = await apiMod.callGenerate(tempSession, settings, null, onChunk);
        cleanupCursor();

        if (result === null) {
            msgData.swipes.pop();
            msgData.swipeIndex = msgData.swipes.length - 1;
            msgData.content = msgData.swipes[msgData.swipeIndex]?.content || '';
            msgData.reasoning = msgData.swipes[msgData.swipeIndex]?.reasoning || null;
            saveSessionsToMetadata();
            _renderMsgBodyContent(wrapEl, msgData);
            updateSwipeBar(wrapEl, session, msgId);
            return;
        }

        const { text: rawText, reasoning: fullReasoning } = result;
        const fullText = normalizeCharNamesInBlock(rawText);

        msgData.swipes[msgData.swipeIndex] = { content: fullText, reasoning: fullReasoning || null };
        msgData.content = fullText;
        msgData.reasoning = fullReasoning || null;
        saveSessionsToMetadata();

        _renderMsgBodyContent(wrapEl, msgData);
        updateSwipeBar(wrapEl, session, msgId);

        if (tokensIn > 0) recordStat(SM.tokIn, tokensIn);
        const tokensOut = await apiMod.estimateTokens(fullText);
        if (tokensOut > 0) recordStat(SM.tokOut, tokensOut);
        recordStat(SM.regen);
        updateMsgCount(session);
        if (uiWdgMod) uiWdgMod.playCompletionSound();

    } catch(err) {
        cleanupCursor();
        msgData.swipes.pop();
        msgData.swipeIndex = msgData.swipes.length - 1;
        msgData.content = msgData.swipes[msgData.swipeIndex]?.content || '';
        msgData.reasoning = msgData.swipes[msgData.swipeIndex]?.reasoning || null;
        saveSessionsToMetadata();
        _renderMsgBodyContent(wrapEl, msgData);
        updateSwipeBar(wrapEl, session, msgId);

        if (state.abortController?.signal?.aborted || err?.message === 'userStopped') {} 
        else { showGenerationError(err); }
    } finally {
        state.generating = false;
        setGeneratingState(false);
    }
}

export function _refreshSwipeBars(session) {
    const c = document.getElementById('scp-messages');
    if (!c) return;
    c.querySelectorAll('.scp-swipe-bar').forEach(bar => { bar.style.display = 'none'; });
    if (state.generating) return;
    const lastId = getLastAssistantMsgId(session);
    if (!lastId) return;
    const lastEl = c.querySelector(`.scp-msg[data-id="${lastId}"]`);
    if (!lastEl) return;
    const swipeBar = lastEl.querySelector('.scp-swipe-bar');
    if (!swipeBar) return;
    updateSwipeBar(lastEl, session, lastId);
    swipeBar.style.display = '';
}

export function _refreshContinueBtns() {
    const c = document.getElementById('scp-messages');
    if (!c) return;
    c.querySelectorAll('.scp-msg-last-assistant').forEach(el => el.classList.remove('scp-msg-last-assistant'));
    if (state.generating) return;
    const all = [...c.querySelectorAll('.scp-msg-assistant')];
    if (all.length) all[all.length - 1].classList.add('scp-msg-last-assistant');
}

// ─── Scroll ──────────────────────────────────────────────────────────────────

export function scrollToBottom() {
    const c = document.getElementById('scp-messages');
    if (!c) return;
    state.userScrolledUp = false;
    
    // Делаем несколько попыток скролла, если окно еще не отрендерилось (например, при загрузке страницы)
    const tryScroll = (attempts = 0) => {
        if (c.offsetHeight > 0) {
            c.scrollTop = c.scrollHeight;
        } else if (attempts < 5) {
            setTimeout(() => tryScroll(attempts + 1), 50);
        }
    };
    tryScroll();
}

export function saveScrollPosition() {
    const c = document.getElementById('scp-messages');
    // Сохраняем позицию ТОЛЬКО если окно сейчас открыто и отрендерено
    if (c && c.offsetHeight > 0) {
        state.savedScrollTop = c.scrollTop;
    }
}

export function restoreScrollPosition() {
    const c = document.getElementById('scp-messages');
    if (!c) return;
    
    const tryRestore = (attempts = 0) => {
        if (c.offsetHeight > 0) {
            if (state.userScrolledUp && state.savedScrollTop !== undefined) {
                c.scrollTop = state.savedScrollTop;
            } else {
                c.scrollTop = c.scrollHeight;
            }
        } else if (attempts < 5) {
            setTimeout(() => tryRestore(attempts + 1), 50);
        }
    };
    tryRestore();
}

export function smartScrollToBottom() {
    if (state.userScrolledUp) return;
    const c = document.getElementById('scp-messages');
    if (c) c.scrollTop = c.scrollHeight;
}

export function setupMessagesScrollTracking() {
    const c = document.getElementById('scp-messages');
    if (!c) return;
    c.addEventListener('scroll', () => {
        state.userScrolledUp = c.scrollHeight - c.scrollTop - c.clientHeight > 80;
    }, { passive: true });
}

// ─── Message List and Handlers ──────────────────────────────────────────

export function addHistoryToSwipe(msgId, newLines, charName = null) {
    if (!msgId) return false;
    const session = getCurrentSession();
    const msg = session.messages.find(m => m.id === msgId);
    if (!msg) return false;
    if (!msg.swipes) msg.swipes = [{ content: msg.content, reasoning: msg.reasoning }];
    const currentSwipe = msg.swipes[msg.swipeIndex || 0];
    if (!currentSwipe.historyLines) currentSwipe.historyLines = [];
    currentSwipe.historyLines.push(...newLines);
    if (charName && !currentSwipe._charName) currentSwipe._charName = charName;
    saveSessionsToMetadata();
    
    const msgEl = document.querySelector(`.scp-msg[data-id="${msgId}"]`);
    if (msgEl) {
        let body = msgEl.querySelector('.scp-msg-body');
        if (body) {
            let histWrap = body.querySelector('.scp-msg-hist-wrap');
            if (!histWrap) {
                histWrap = document.createElement('div');
                histWrap.className = 'scp-msg-hist-wrap';
                body.appendChild(histWrap);
            }
            const dummyMsg = { appliedLines: currentSwipe.historyLines };
            const contentEl = document.createElement('div');
            contentEl.className = 'scp-msg-content scp-lb-history-content';
            contentEl.style.marginTop = '10px';
            contentEl.style.padding = '8px 12px';
            contentEl.style.background = 'var(--scp-accent-bg)';
            contentEl.style.border = '1px solid var(--scp-accent-dim)';
            contentEl.style.borderRadius = '6px';
            
            import('../features/feature-lorebook-ui.js').then(m => {
                m.renderLBHistoryContent(dummyMsg, contentEl);
                histWrap.innerHTML = '';
                histWrap.appendChild(contentEl);
            });

            const swipeBar = body.querySelector('.scp-swipe-bar');
            if (swipeBar) body.insertBefore(histWrap, swipeBar);
            else body.appendChild(histWrap);
        }
    }
    return true;
}

export function handleCopy(msg) { copyText(msg.content); }

export function handleEdit(wrapEl, msg) {
    if (wrapEl.classList.contains('is-editing')) return;
    wrapEl.classList.add('is-editing');
    const { charId, chatId } = getBindingKey();
    const session = getCurrentSession();
    const contentEl = wrapEl.querySelector('.scp-msg-content');
    const original = msg.content;

    const ta = document.createElement('textarea');
    ta.className = 'scp-edit-ta';
    ta.value = original;

    const row = document.createElement('div');
    row.className = 'scp-edit-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'scp-edit-btn scp-edit-save';
    saveBtn.innerHTML = msg.role === 'user'
        ? `${I.check}<span>Save & Resend</span>`
        : `${I.check}<span>Save</span>`;

    const saveOnlyBtn = msg.role === 'user' ? document.createElement('button') : null;
    if (saveOnlyBtn) {
        saveOnlyBtn.className = 'scp-edit-btn scp-edit-cancel';
        saveOnlyBtn.innerHTML = `${I.check}<span>Save</span>`;
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'scp-edit-btn scp-edit-cancel';
    cancelBtn.innerHTML = `${I.x}<span>Cancel</span>`;

    row.appendChild(saveBtn);
    if (saveOnlyBtn) row.appendChild(saveOnlyBtn);
    row.appendChild(cancelBtn);
    contentEl.replaceWith(ta);
    wrapEl.querySelector('.scp-msg-actions').after(row);
    ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    autoResize(ta); ta.addEventListener('input', () => autoResize(ta));

    const restoreMessageDOM = (textToRender) => {
        const nc = document.createElement('div');
        nc.className = 'scp-msg-content';

        const lbChanges = parseLBChangesFromText(textToRender);
        const charChanges = parseCharChangesFromText(textToRender);
        const charCreation = parseCharCreationFromText(textToRender);
        const chatChanges = parseChatChangesFromText(textToRender);
        let stripped = textToRender;
        
        if (lbChanges?.length) { 
            stripped = stripLBChangesBlock(stripped); 
            renderProposalCard(lbChanges, wrapEl); 
        } else document.querySelector(`.scp-lb-proposal-card[data-for="${msg.id}"]`)?.remove();
        
        if (charChanges?.length) { 
            stripped = stripCharChangesBlock(stripped); 
            renderCharProposalCard(charChanges, wrapEl); 
        } else document.querySelectorAll(`.scp-char-proposal-card[data-for="${msg.id}"]`).forEach(c => c.remove());
        
        if (charCreation) { 
            stripped = stripCharCreationBlock(stripped); 
            renderCharCreationCard(charCreation, wrapEl); 
        } else document.querySelector(`.scp-char-creation-card[data-for="${msg.id}"]`)?.remove();

        if (chatChanges?.length) { 
            stripped = stripChatChangesBlock(stripped); 
            renderChatProposalCard(chatChanges, wrapEl); 
        } else document.querySelector(`.scp-chat-proposal-card[data-for="${msg.id}"]`)?.remove();
        
        let tcIndex = 0;
        const resR = extractToolCallPlaceholders(stripped, tcIndex);
        const displayString = getDisplayContent(resR.text, getSettings()).content;

        nc.innerHTML = renderMarkdown(displayString);
        postProcessHTMLBlocks(nc);
        ta.replaceWith(nc);
        row.remove();
        wrapEl.classList.remove('is-editing');
        if (msg.toolCalls?.length) postProcessToolCalls(wrapEl, msg.toolCalls);
    };

    cancelBtn.addEventListener('click', () => {
        restoreMessageDOM(original);
    });

    if (saveOnlyBtn) {
        saveOnlyBtn.addEventListener('click', () => {
            const rawText = ta.value.trim();
            if (!rawText) return;
            const newText = expandMacros(rawText);
            
            const msgObj = session.messages.find(m => m.id === msg.id);
            if (msgObj) { msgObj.content = newText; saveSessionsToMetadata(); }
            
            msg.content = newText;
            if (msg.swipes && msg.swipeIndex !== undefined) {
                msg.swipes[msg.swipeIndex] = { content: newText, reasoning: msg.reasoning || null };
                saveSessionsToMetadata();
            }
            recordStat(SM.edit);
            restoreMessageDOM(newText);
            _updateMsgTokenCount(wrapEl, newText, true);
        });
    }

    saveBtn.addEventListener('click', async () => {
        const rawText = ta.value.trim();
        if (!rawText) return;
        const newText = expandMacros(rawText);
        
        const msgObj = session.messages.find(m => m.id === msg.id);
        if (msgObj) { msgObj.content = newText; saveSessionsToMetadata(); }

        msg.content = newText;
        if (msg.swipes && msg.swipeIndex !== undefined) {
            msg.swipes[msg.swipeIndex] = { content: newText, reasoning: msg.reasoning || null };
            saveSessionsToMetadata();
        }
        recordStat(SM.edit);
        restoreMessageDOM(newText);
        _updateMsgTokenCount(wrapEl, newText, true);
        
        truncateAfter(session, msg.id);
        removeMsgElAfter(msg.id);
        if (msg.role === 'user' && apiMod) await apiMod.runGenerate(session, newText, false);
    });
}

export async function handleMessageRegen(wrapEl, msg) {
    if (state.generating) return;
    const session = getCurrentSession();
    const idx = session.messages.findIndex(m => m.id === msg.id);
    if (idx === -1) return;

    const isUser = msg.role === 'user';
    const actualMsgsAfter = session.messages.slice(idx + 1).filter(m => !m.isLBHistory && !m.isCharEditHistory && !m.isChatEditHistory);
    const msgsAfterCount = actualMsgsAfter.length;

    let needsConfirm = false;
    if (isUser) {
        if (msgsAfterCount > 1 || (msgsAfterCount === 1 && actualMsgsAfter[0].role !== 'assistant')) {
            needsConfirm = true;
        }
    } else {
        if (msgsAfterCount > 0) {
            needsConfirm = true;
        }
    }

    if (needsConfirm) {
        const ok = await showCustomDialog({
            type: 'confirm',
            title: 'Regenerate Message',
            message: 'Regenerating will delete all subsequent messages. Continue?'
        });
        if (!ok) return;
    }

    if (isUser) {
        truncateAfter(session, msg.id);
        removeMsgElAfter(msg.id);
        updateMsgCount(session);
        recordStat(SM.regen);
        if (apiMod) apiMod.runGenerate(session, null, false);
    } else {
        if (msgsAfterCount > 0) {
            truncateAfter(session, msg.id);
            removeMsgElAfter(msg.id);
            updateMsgCount(session);
        }
        recordStat(SM.regen);
        _runSwipeRegen(session, msg.id, wrapEl);
    }
}

export async function handleDelete(wrapEl, msg) {
    const isUser = msg.role === 'user';
    const confirmed = await showCustomDialog({
        type: 'confirm',
        title: 'Delete Message',
        message: isUser
            ? 'Delete this message and all subsequent messages?'
            : 'Delete this assistant message?',
    });
    if (!confirmed) return;
    const session = getCurrentSession();
    if (isUser) {
        truncateFrom(session, msg.id);
        removeMsgElAndBelow(msg.id);
    } else {
        deleteMsg(session, msg.id);
        removeMsgEl(msg.id);
    }
    updateMsgCount(session);
    if (!session.messages.length) renderSession(session);
}

export function renderSession(session) {
    clearSearchHighlights();
    state.searchMatches = [];
    state.searchIdx = -1;
    updateSearchCount();
    const c = document.getElementById('scp-messages');
    if (!c) return;
    c.innerHTML = '';
    if (!session.messages.length) {
        c.innerHTML = `
            <div class="scp-empty-state">
                <div class="scp-empty-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7" /><ellipse cx="12" cy="12" rx="11" ry="3" transform="rotate(-25 12 12)" /><circle cx="21.5" cy="7.5" r="1.5" fill="currentColor" stroke="none" /></svg>
                </div>
                <div class="scp-empty-title">New Session</div>
                <div class="scp-empty-sub">Ask anything about your roleplay — continuity checks, character analysis, writing feedback, worldbuilding, and more.</div>
            </div>`;
        updateMsgCount(session);
        return;
    }
    for (const msg of session.messages) {
        if (msg.isLBHistory || msg.isCharEditHistory || msg.isChatEditHistory) {
            appendLBHistoryEl(msg);
        } else {
            const el = createMsgEl(msg, handleCopy, handleEdit, handleDelete, handleMessageRegen);
            c.appendChild(el);
        }
    }
    updateMsgCount(session);
    _refreshContinueBtns();
    _refreshSwipeBars(session);
    requestAnimationFrame(() => scrollToBottom());
}

export function appendMsgEl(msg, isStreamInit = false) {
    const c = document.getElementById('scp-messages');
    if (!c) return;
    c.querySelector('.scp-empty-state')?.remove();

    const el = createMsgEl(msg, handleCopy, handleEdit, handleDelete, handleMessageRegen);
    c.appendChild(el);
    
    if (!isStreamInit) {
        const session = getCurrentSession();
        updateMsgCount(session);
        _refreshContinueBtns();
        _refreshSwipeBars(session);
        requestAnimationFrame(() => scrollToBottom());

        if (state.searchOpen && state.searchQuery.trim()) {
            const newMarks = _applyHighlightsInRoot(el);
            if (newMarks.length) {
                state.searchMatches.push(...newMarks);
                updateSearchCount();
            }
        }
    }
}

export function removeMsgEl(msgId) {
    const el = document.querySelector(`.scp-msg[data-id="${msgId}"]`);
    if (!el) return;
    document.querySelector(`.scp-lb-proposal-card[data-for="${msgId}"]`)?.remove();
    document.querySelectorAll(`.scp-char-proposal-card[data-for="${msgId}"]`).forEach(c => c.remove());
    document.querySelector(`.scp-char-creation-card[data-for="${msgId}"]`)?.remove();
    document.querySelector(`.scp-chat-proposal-card[data-for="${msgId}"]`)?.remove();
    el.remove();
    _refreshContinueBtns();
    _refreshSwipeBars(getCurrentSession());
}

export function removeMsgElAndBelow(msgId) {
    const c = document.getElementById('scp-messages'); if (!c) return;
    let found = false;
    for (const el of [...c.querySelectorAll('.scp-msg')]) {
        if (el.dataset.id === msgId) found = true;
        if (found) {
            document.querySelector(`.scp-lb-proposal-card[data-for="${el.dataset.id}"]`)?.remove();
            document.querySelectorAll(`.scp-char-proposal-card[data-for="${el.dataset.id}"]`).forEach(c => c.remove());
            document.querySelector(`.scp-char-creation-card[data-for="${el.dataset.id}"]`)?.remove();
            document.querySelector(`.scp-chat-proposal-card[data-for="${el.dataset.id}"]`)?.remove();
            el.remove();
        }
    }
    c.querySelectorAll('.scp-lb-proposal-card').forEach(card => { if (!card.previousElementSibling) card.remove(); });
    c.querySelectorAll('.scp-char-proposal-card').forEach(card => { if (!card.previousElementSibling) card.remove(); });
    c.querySelectorAll('.scp-char-creation-card').forEach(card => { if (!card.previousElementSibling) card.remove(); });
    c.querySelectorAll('.scp-chat-proposal-card').forEach(card => { if (!card.previousElementSibling) card.remove(); });
    _refreshContinueBtns();
    _refreshSwipeBars(getCurrentSession());
}

export function removeMsgElAfter(msgId) {
    const c = document.getElementById('scp-messages'); if (!c) return;
    let found = false;
    for (const el of [...c.querySelectorAll('.scp-msg')]) {
        if (found) {
            document.querySelector(`.scp-lb-proposal-card[data-for="${el.dataset.id}"]`)?.remove();
            document.querySelectorAll(`.scp-char-proposal-card[data-for="${el.dataset.id}"]`).forEach(card => card.remove());
            document.querySelector(`.scp-char-creation-card[data-for="${el.dataset.id}"]`)?.remove();
            document.querySelector(`.scp-chat-proposal-card[data-for="${el.dataset.id}"]`)?.remove();
            el.remove();
        }
        if (el.dataset.id === msgId) found = true;
    }
    _refreshContinueBtns();
    _refreshSwipeBars(getCurrentSession());
}

let _tokenCalcTid = null;
let _isTokenCalculating = false;
let _pendingTokenCalc = false;

export function updateMsgCount(session) {
    const el = document.getElementById('scp-msg-count');
    if (el && session) el.textContent = `${session.messages.length} msgs`;

    const tel = document.getElementById('scp-token-count');
    if (!tel || !session) return;

    clearTimeout(_tokenCalcTid);
    _tokenCalcTid = setTimeout(() => {
        if (_isTokenCalculating) { _pendingTokenCalc = true; return; }

        const runCalc = async () => {
            _isTokenCalculating = true;
            try {
                const settings = getEffectiveSettings();
                const currentInput = document.getElementById('scp-input')?.value || '';
                
                if (apiMod && apiMod.assembleMessages && apiMod.estimateTokens) {
                    try {
                        const tempSess = { ...session, messages: [...session.messages] };
                        if (currentInput.trim() || state.pendingAttachments?.length) {
                            tempSess.messages.push({ 
                                id: 'tmp', 
                                role: 'user', 
                                content: currentInput, 
                                timestamp: Date.now(),
                                attachments: state.pendingAttachments || []
                            });
                        }
                        const builtMsgs = await apiMod.assembleMessages(tempSess, settings, null);
                        const fullText = builtMsgs.map(m => m.content).join('\n');
                        const tokens = await apiMod.estimateTokens(fullText);
                        const node = document.getElementById('scp-token-count');
                        if (node) node.textContent = `~${tokens} tkns`;
                        return;
                    } catch (e) {
                        console.warn('ST-Copilot: Exact token calculation failed, falling back', e);
                    }
                }

                const ctx = SillyTavern.getContext();
                const incHidden = !!settings.includeHiddenMessages;

                let totalChars = (settings.systemPrompt || '').length;

                const depth = Math.max(0, parseInt(settings.contextDepth) || 0);
                const chat = ctx.chat || [];
                let chatSlice = [];
                try {
                    const sess = getCurrentSession();
                    const picked = sess?.pickedChatIndices;
                    if (picked && picked.length > 0) {
                        chatSlice = picked.filter(i => i >= 0 && i < chat.length).map(i => chat[i]);
                    } else if (depth > 0) {
                        chatSlice = chat.slice(-depth);
                    }
                } catch(_) {
                    if (depth > 0) chatSlice = chat.slice(-depth);
                }

                for (const m of chatSlice) {
                    if (!incHidden && (m.is_system || m.is_hidden || m.extra?.is_hidden || m.extra?.sc_ghosted)) continue;
                    totalChars += (m.mes || '').length;
                }

                const limit = Math.max(1, parseInt(settings.localHistoryLimit) || 50);
                for (const m of session.messages.slice(-limit)) {
                    totalChars += (m.content || '').length;
                }

                totalChars += currentInput.length;
                const count = Math.ceil(totalChars / 3.5);
                const node = document.getElementById('scp-token-count');
                if (node) node.textContent = `~${count} tkns`;
            } finally {
                _isTokenCalculating = false;
                if (_pendingTokenCalc) { _pendingTokenCalc = false; runCalc(); }
            }
        };
        runCalc();
    }, 400);
}

export function updateDepthSlidersMax() {
    const ctx = SillyTavern.getContext();
    const chat = ctx.chat || window.chat ||[];
    const maxVal = Math.max(1, chat.length);
    
    if (state.lastChatLen === -1) {
        state.lastChatLen = maxVal;
    }

    const s = getSettings();
    const sess = getCurrentSession();
    let settingsChanged = false;

    const globalDepth = parseInt(s.contextDepth) || 0;
    if (globalDepth >= state.lastChatLen && maxVal > state.lastChatLen) {
        s.contextDepth = maxVal;
        settingsChanged = true;
    }

    if (sess && sess.overrides && sess.overrides.contextDepth !== undefined) {
        const ovDepth = parseInt(sess.overrides.contextDepth) || 0;
        if (ovDepth >= state.lastChatLen && maxVal > state.lastChatLen) {
            sess.overrides.contextDepth = maxVal;
            settingsChanged = true;
        }
    }

    if (settingsChanged) {
        saveSettings();
    }

    state.lastChatLen = maxVal;
    const eff = getEffectiveSettings();

    const sliders =[
        { id: 'scp-depth-slider', valId: 'scp-depth-val', setting: s.contextDepth },
        { id: 'scp-sp-depth-slider', valId: 'scp-sp-depth-val', setting: s.contextDepth },
        { id: 'scp-sp-ov-depth-slider', valId: 'scp-sp-ov-depth-val', setting: eff.contextDepth }
    ];

    sliders.forEach(item => {
        const el = document.getElementById(item.id);
        if (el) {
            if (parseInt(el.max) !== maxVal) el.max = maxVal;
            const renderVal = Math.min(maxVal, parseInt(item.setting ?? 15));
            el.value = renderVal;
            const valEl = document.getElementById(item.valId);
            if (valEl) valEl.textContent = renderVal;
        }
    });
}

// ─── Chat search ───────────────────────────────────────────────────────────

export function openSearch() {
    _dbgAdd('SEARCH_TOGGLE', { state: 'open' });
    state.searchOpen = true;
    const bar = document.getElementById('scp-search-bar');
    if (bar) {
        bar.classList.add('scp-search-open');
        requestAnimationFrame(() => {
            const inp = document.getElementById('scp-search-input');
            if (inp) { inp.focus(); inp.select(); }
        });
    }
    document.getElementById('scp-search-btn')?.classList.add('active');
}

export function closeSearch() {
    _dbgAdd('SEARCH_TOGGLE', { state: 'close' });
    state.searchOpen = false;
    state.searchWholeWord = false;
    document.getElementById('scp-search-bar')?.classList.remove('scp-search-open');
    document.getElementById('scp-search-btn')?.classList.remove('active');
    document.getElementById('scp-search-word')?.classList.remove('active');
    clearSearchHighlights();
    state.searchMatches = [];
    state.searchIdx = -1;
    const inp = document.getElementById('scp-search-input');
    if (inp) inp.value = '';
    state.searchQuery = '';
    updateSearchCount();
}

export function clearSearchHighlights() {
    const marks = document.querySelectorAll('#scp-messages mark.scp-search-hl');
    if (!marks.length) return;
    const parents = new Set();
    marks.forEach(m => {
        const p = m.parentNode;
        if (!p) return;
        p.replaceChild(document.createTextNode(m.textContent), m);
        parents.add(p);
    });
    parents.forEach(p => p.normalize());
}

export function updateSearchCount() {
    const el = document.getElementById('scp-search-count');
    if (!el) return;
    el.textContent = (state.searchMatches.length && state.searchQuery)
        ? `${state.searchIdx + 1}/${state.searchMatches.length}`
        : '';
}

export function _applyHighlightsInRoot(root) {
    const lq = state.searchQuery.toLowerCase();
    let regex = null;
    if (state.searchWholeWord) {
        try { regex = new RegExp(`\\b${lq.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'); } catch(_) {}
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            const p = node.parentElement;
            if (!p) return NodeFilter.FILTER_REJECT;
            if (p.closest('.scp-msg-actions,.scp-msg-meta,.scp-msg-avatar,.scp-reasoning-summary,.scp-search-hl'))
                return NodeFilter.FILTER_REJECT;
            if (!p.closest('.scp-msg-body')) return NodeFilter.FILTER_REJECT;
            if (regex) {
                regex.lastIndex = 0;
                const hit = regex.test(node.nodeValue);
                regex.lastIndex = 0;
                return hit ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
            }
            return node.nodeValue.toLowerCase().includes(lq)
                ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
    });
    const textNodes = [];
    let n;
    while ((n = walker.nextNode())) textNodes.push(n);

    const newMarks = [];
    
    try {
        for (const node of textNodes) {
            const text = node.nodeValue;
            const frag = document.createDocumentFragment();
            let lastIndex = 0;

            if (regex) {
                regex.lastIndex = 0;
                let match;
                while ((match = regex.exec(text)) !== null) {
                    if (match.index > lastIndex) frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
                    const mark = document.createElement('mark');
                    mark.className = 'scp-search-hl';
                    mark.textContent = match[0];
                    frag.appendChild(mark);
                    newMarks.push(mark);
                    lastIndex = match.index + match[0].length;
                }
            } else {
                const lower = text.toLowerCase();
                let idx = lower.indexOf(lq, 0);
                if (idx === -1) continue;
                while (idx !== -1) {
                    if (idx > lastIndex) frag.appendChild(document.createTextNode(text.slice(lastIndex, idx)));
                    const mark = document.createElement('mark');
                    mark.className = 'scp-search-hl';
                    mark.textContent = text.slice(idx, idx + state.searchQuery.length);
                    frag.appendChild(mark);
                    newMarks.push(mark);
                    lastIndex = idx + state.searchQuery.length;
                    idx = lower.indexOf(lq, lastIndex);
                }
            }

            if (lastIndex === 0) continue;
            if (lastIndex < text.length) frag.appendChild(document.createTextNode(text.slice(lastIndex)));
            node.parentNode.replaceChild(frag, node);
        }
    } catch (e) {
        _dbgAdd('SEARCH_HIGHLIGHT_DOM_CORRUPTION', { error: e.message });
    }

    return newMarks;
}

export function performSearch() {
    clearSearchHighlights();
    state.searchMatches = [];
    state.searchIdx = -1;
    const q = state.searchQuery.trim();
    if (!q) { updateSearchCount(); return; }
    const container = document.getElementById('scp-messages');
    if (!container) return;
    state.searchMatches = _applyHighlightsInRoot(container);

    _dbgAdd('SEARCH_QUERY_EXECUTE', { query: state.searchQuery, wholeWord: state.searchWholeWord, matches: state.searchMatches.length });

    if (state.searchMatches.length) {
        state.searchIdx = 0;
        state.searchMatches[0].classList.add('scp-search-current');
        state.searchMatches[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    updateSearchCount();
}

export function navigateSearch(dir) {
    if (!state.searchMatches.length) return;
    state.searchMatches[state.searchIdx]?.classList.remove('scp-search-current');
    state.searchIdx = (state.searchIdx + dir + state.searchMatches.length) % state.searchMatches.length;
    const cur = state.searchMatches[state.searchIdx];
    cur.classList.add('scp-search-current');
    cur.scrollIntoView({ block: 'center', behavior: 'smooth' });
    updateSearchCount();
}

// ─── Chat Picker ───────────────────────────────────────────────

export function getPickedChatIndices() {
    try { return getCurrentSession().pickedChatIndices || []; } catch(_) { return []; }
}

export function setPickedChatIndices(indices) {
    try {
        const sess = getCurrentSession();
        sess.pickedChatIndices = [...indices].sort((a, b) => a - b);
        saveSessionsToMetadata();
        updatePickBtnState();
        updateMsgCount(sess);
    } catch(_) {}
}

export function updatePickBtnState() {
    const picked = getPickedChatIndices();
    const btn = document.getElementById('scp-pick-btn');
    const badge = document.getElementById('scp-pick-badge');
    const isActive = picked.length > 0;
    btn?.classList.toggle('active', isActive);
    if (badge) { badge.style.display = isActive ? '' : 'none'; badge.textContent = picked.length; }
    const depthSlider = document.getElementById('scp-depth-slider');
    const depthVal = document.getElementById('scp-depth-val');
    depthSlider?.classList.toggle('scp-slider-overridden', isActive);
    depthVal?.classList.toggle('scp-depth-val-overridden', isActive);
}

let _pickerLastIdx = -1;

export function openChatPicker() {
    const overlay = document.getElementById('scp-picker-overlay');
    if (!overlay) return;
    _dbgAdd('PICKER_OPEN');
    if (uiWinMod) uiWinMod.applyCustomTheme(getSettings().customTheme || THEME_PRESETS.default);
    _pickerLastIdx = -1;
    renderPickerMessages();
    overlay.style.display = 'flex';
    if (uiWinMod) uiWinMod.bringWindowToFront();
}

export function closeChatPicker() {
    _dbgAdd('PICKER_CLOSE');
    const overlay = document.getElementById('scp-picker-overlay');
    if (overlay) overlay.style.display = 'none';
}

export function renderPickerMessages() {
    const body = document.getElementById('scp-picker-body');
    if (!body) return;
    const ctx = SillyTavern.getContext();
    const msgs = ctx.chat || [];
    const pickedSet = new Set(getPickedChatIndices());
    const charInfo = getCharInfo();

    body.innerHTML = '';
    if (!msgs.length) {
        body.innerHTML = '<div style="padding:24px;text-align:center;color:var(--scp-text-muted)">No messages in current chat</div>';
        _updatePickerCountEl(0);
        return;
    }

    const frag = document.createDocumentFragment();
    msgs.forEach((msg, idx) => {
        const isUser = msg.is_user;
        const name = isUser ? (ctx.name1 || 'User') : (msg.name || charInfo?.name || 'Character');
        const isSelected = pickedSet.has(idx);
        const row = document.createElement('div');
        row.className = `scp-picker-row${isSelected ? ' selected' : ''}${isUser ? ' user' : ''}`;
        row.dataset.idx = idx;

        const cb = document.createElement('div');
        cb.className = `scp-picker-cb${isSelected ? ' checked' : ''}`;

        const meta = document.createElement('div');
        meta.className = 'scp-picker-meta';

        const idxEl = document.createElement('span');
        idxEl.className = 'scp-picker-idx';
        idxEl.textContent = `#${idx}`;

        const nameEl = document.createElement('span');
        nameEl.className = 'scp-picker-name';
        nameEl.textContent = name;

        meta.appendChild(idxEl);
        meta.appendChild(nameEl);

        const textEl = document.createElement('div');
        textEl.className = 'scp-picker-text';
        const raw = (msg.mes || '').replace(/<[^>]+>/g, '').trim();
        const s2 = getSettings();
        const firstLines = Math.max(1, parseInt(s2.pickerPreviewLines) || 1);
        const lastLines = Math.max(0, parseInt(s2.pickerPreviewLastLines) || 0);
        let preview = '';
        if (lastLines > 0) {
            const allLines = raw.split('\n');
            const head = allLines.slice(0, firstLines).join('\n');
            const tail = allLines.length > firstLines
                ? allLines.slice(-lastLines).join('\n')
                : '';
            preview = tail && tail !== head ? head + '\n…\n' + tail : head;
        } else {
            preview = raw.split('\n').slice(0, firstLines).join('\n');
            if (preview.length < raw.length) preview += ' …';
        }
        textEl.textContent = preview;

        const infoCol = document.createElement('div');
        infoCol.className = 'scp-picker-info-col';
        infoCol.appendChild(meta);
        infoCol.appendChild(textEl);

        row.appendChild(cb);
        row.appendChild(infoCol);

        row.addEventListener('click', e => {
            const curIdx = parseInt(row.dataset.idx);
            const curMsg = msgs[curIdx];

            if (e.ctrlKey || e.metaKey) {
                _dbgAdd('PICKER_SHORTCUT_TRIGGERED', { type: 'ctrl' });
                const targetState = !row.classList.contains('selected');
                body.querySelectorAll('.scp-picker-row').forEach(r => {
                    const ri = parseInt(r.dataset.idx);
                    const rm = msgs[ri];
                    if (rm && rm.is_user === curMsg.is_user && rm.name === curMsg.name) {
                        r.classList.toggle('selected', targetState);
                        r.querySelector('.scp-picker-cb')?.classList.toggle('checked', targetState);
                    }
                });
            } else if (e.altKey) {
                 _dbgAdd('PICKER_SHORTCUT_TRIGGERED', { type: 'alt' });
                const targetState = !row.classList.contains('selected');
                body.querySelectorAll('.scp-picker-row').forEach(r => {
                    const ri = parseInt(r.dataset.idx);
                    const rm = msgs[ri];
                    if (rm && !(rm.is_user === curMsg.is_user && rm.name === curMsg.name)) {
                        r.classList.toggle('selected', targetState);
                        r.querySelector('.scp-picker-cb')?.classList.toggle('checked', targetState);
                    }
                });
            } else if (e.shiftKey && _pickerLastIdx >= 0) {
                _dbgAdd('PICKER_SHORTCUT_TRIGGERED', { type: 'shift' });
                const lo = Math.min(_pickerLastIdx, curIdx);
                const hi = Math.max(_pickerLastIdx, curIdx);
                const targetState = !row.classList.contains('selected');
                body.querySelectorAll('.scp-picker-row').forEach(r => {
                    const ri = parseInt(r.dataset.idx);
                    if (ri >= lo && ri <= hi) {
                        r.classList.toggle('selected', targetState);
                        r.querySelector('.scp-picker-cb')?.classList.toggle('checked', targetState);
                    }
                });
            } else {
                const sel = row.classList.toggle('selected');
                _dbgAdd('PICKER_TOGGLE_SINGLE', { idx: curIdx, state: sel });
                cb.classList.toggle('checked', sel);
                _pickerLastIdx = curIdx;
            }
            _updatePickerCountEl();
        });

        frag.appendChild(row);
    });
    body.appendChild(frag);
    _updatePickerCountEl(pickedSet.size);
    const firstSel = body.querySelector('.scp-picker-row.selected');
    if (firstSel) setTimeout(() => firstSel.scrollIntoView({ block: 'center' }), 50);
}

export function _updatePickerCountEl(count) {
    const el = document.getElementById('scp-picker-count');
    if (!el) return;
    const n = count !== undefined ? count : document.querySelectorAll('#scp-picker-body .scp-picker-row.selected').length;
    el.textContent = `${n} selected`;
}

export function setupChatPickerListeners() {
    const overlay = document.getElementById('scp-picker-overlay');
    if (!overlay) return;

    let _mouseDownTarget = null;
    overlay.addEventListener('mousedown', e => { _mouseDownTarget = e.target; });
    overlay.addEventListener('click', e => { if (e.target === overlay && _mouseDownTarget === overlay) closeChatPicker(); });

    document.getElementById('scp-picker-close')?.addEventListener('click', closeChatPicker);

    document.getElementById('scp-picker-all')?.addEventListener('click', () => {
        document.querySelectorAll('#scp-picker-body .scp-picker-row').forEach(r => {
            r.classList.add('selected');
            r.querySelector('.scp-picker-cb')?.classList.add('checked');
        });
        _updatePickerCountEl();
    });

    document.getElementById('scp-picker-invert')?.addEventListener('click', () => {
        document.querySelectorAll('#scp-picker-body .scp-picker-row').forEach(r => {
            const s = r.classList.toggle('selected');
            r.querySelector('.scp-picker-cb')?.classList.toggle('checked', s);
        });
        _updatePickerCountEl();
    });

    document.getElementById('scp-picker-clear')?.addEventListener('click', () => {
        document.querySelectorAll('#scp-picker-body .scp-picker-row').forEach(r => {
            r.classList.remove('selected');
            r.querySelector('.scp-picker-cb')?.classList.remove('checked');
        });
        _updatePickerCountEl();
    });

    document.getElementById('scp-picker-apply')?.addEventListener('click', () => {
        const rows = document.querySelectorAll('#scp-picker-body .scp-picker-row');
        const indices = [];
        rows.forEach(r => { if (r.classList.contains('selected')) indices.push(parseInt(r.dataset.idx)); });
        _dbgAdd('PICKER_APPLY', { count: indices.length });
        setPickedChatIndices(indices);
        closeChatPicker();
    });
}

// ─── Generation state ─────────────────────────────────────────────────────

export function setGeneratingState(on) {
    const bar = document.getElementById('scp-thinking-bar'), sendBtn = document.getElementById('scp-send-btn'),
          input = document.getElementById('scp-input'), regenBtn = document.getElementById('scp-regen-btn');
    if (bar) {
        bar.style.display = on ? 'flex' : 'none';
        if (on) {
            const t = document.getElementById('scp-thinking-text');
            if (t) t.textContent = 'Thinking…';
        }
    }
    if (sendBtn) sendBtn.disabled = on;
    if (input) input.disabled = on;
    if (regenBtn) regenBtn.disabled = on;
    if (!on) {
        _refreshContinueBtns();
        _refreshSwipeBars(getCurrentSession());
    }
}

export function showGenerationError(err) {
    let errorSummary = err?.message || String(err);
    let fullError = '';

    if (err instanceof Error) {
        fullError = err.stack || err.message;
        if (err.cause) {
            fullError += '\n\n--- CAUSE ---\n' + (err.cause.stack || err.cause.message || JSON.stringify(err.cause, null, 2));
        }
    } else if (typeof err === 'object') {
        try {
            errorSummary = "API or Network Error";
            fullError = JSON.stringify(err, null, 2);
        } catch(e) {
            fullError = String(err);
        }
    } else {
        fullError = String(err);
    }

    if (window.last_api_error && errorSummary.includes('userStopped') === false) {
        fullError += '\n\n--- ST LAST API ERROR ---\n' + (typeof window.last_api_error === 'object' ? JSON.stringify(window.last_api_error, null, 2) : String(window.last_api_error));
    }

    showCustomDialog({
        type: 'alert',
        title: 'Generation Error',
        htmlMessage: `
            <div style="color:var(--scp-danger); margin-bottom: 10px; font-weight: 600; font-size: 14px; word-break: break-word; line-height: 1.4;">
                ${escHtml(errorSummary)}
            </div>
            <div style="font-size: 12px; margin-bottom: 8px; color: var(--scp-text-muted);">
                Please copy the technical details below and download Debug Log (from settings) to report the issue:
            </div>
            <textarea style="width:100%; height:160px; background:rgba(0,0,0,0.4); color:var(--scp-text-muted); border:1px solid rgba(255,255,255,0.15); padding:8px; border-radius:6px; font-family:var(--scp-font-mono, monospace); resize:vertical; font-size:11px; white-space:pre; word-wrap:normal; overflow-x:auto;" readonly onclick="this.select()">${escHtml(fullError)}</textarea>
        `
    });
}

// ─── Chat Events (SillyTavern) ──────────────────────────────────────────────

export async function onChatChanged() {
    if (state.generating) {
        state.abortController?.abort();
        state.generating = false;
        setGeneratingState(false);
    }
    state.lastChatLen = -1;
    
    // clean cache
    if (uiWdgMod) uiWdgMod.closeFavoritesPanel();
    
    const badge = document.getElementById('scp-char-badge');
    if (badge) {
        const ctx = SillyTavern.getContext(); const char = ctx.characters?.[ctx.characterId];
        if (char) { badge.textContent = char.name; badge.style.display = ''; }
        else { badge.style.display = 'none'; }
    }
    
    await initChatBucket();
    
    if (uiSetMod) {
        uiSetMod.autoLoadBoundProfile();
        uiSetMod.updateSessionOverrideIndicator();
    }
    if (featCharUiMod) {
        featCharUiMod.refreshAltGreetingsPickers();
    }
    if (uiWdgMod) {
        uiWdgMod.renderQuickPromptsBar();
    }
    
    updateDepthSlidersMax();
    updatePickBtnState();
}

export function toggleSearchWholeWord() {
    state.searchWholeWord = !state.searchWholeWord;
    document.getElementById('scp-search-word')?.classList.toggle('active', state.searchWholeWord);
    if (state.searchQuery.trim()) performSearch();
}

export function setupDepthClickEdit() {
    const valEl = document.getElementById('scp-depth-val'); if (!valEl) return;
    
    const newEl = valEl.cloneNode(true);
    valEl.replaceWith(newEl);
    
    newEl.addEventListener('click', () => {
        const cur = getSettings().contextDepth;
        const input = document.createElement('input');
        input.type = 'number'; input.className = 'scp-depth-input';
        input.value = cur; input.min = 0;
        
        newEl.replaceWith(input); 
        input.focus(); input.select();
        
        let isCommitted = false;
        const commit = () => {
            if (isCommitted || !input.parentNode) return;
            isCommitted = true;

            const val = Math.max(0, parseInt(input.value) || 0);
            getSettings().contextDepth = val; saveSettings();
            
            updateDepthSlidersMax();
            import('./ui-settings.js').then(m => m.syncOverlayUI('contextDepth', val));
            
            const span = document.createElement('span');
            span.className = 'scp-depth-val scp-depth-clickable'; span.id = 'scp-depth-val';
            span.title = 'Click to enter exact value'; span.textContent = val;
            
            input.parentNode.replaceChild(span, input);
            setupDepthClickEdit();
            
            const slider = document.getElementById('scp-depth-slider');
            if (slider) { slider.value = val; }
            updateMsgCount(getCurrentSession());
        };
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', e => { 
            if (e.key === 'Enter') { e.preventDefault(); commit(); } 
            if (e.key === 'Escape') { e.preventDefault(); commit(); } 
        });
    });
}

let _searchHotkeyHandler = null;

export function setupSearchHotkey() {
    if (_searchHotkeyHandler) document.removeEventListener('keydown', _searchHotkeyHandler, true);
    _searchHotkeyHandler = null;
    const s = getSettings();
    if (!s.enabled || !s.searchHotkeyEnabled || !s.searchHotkey) return;

    const parts = s.searchHotkey.toLowerCase().split('+').map(p => p.trim());
    const key = parts[parts.length - 1];
    const needAlt = parts.includes('alt');
    const needCtrl = parts.includes('ctrl') || parts.includes('control');
    const needShift = parts.includes('shift');
    const needMeta = parts.includes('meta') || parts.includes('cmd');

    _searchHotkeyHandler = e => {
        if (e.key.toLowerCase() !== key) return;
        if (needAlt !== e.altKey || needCtrl !== e.ctrlKey || needShift !== e.shiftKey || needMeta !== e.metaKey) return;
        
        if (!state.copilotActive) return;
        
        const win = document.getElementById('scp-window');
        if (!win || win.style.display === 'none') return;
        
        const overlays = ['scp-lb-overlay', 'scp-settings-overlay', 'scp-picker-overlay', 'scp-diff-modal', 'scp-changelog-modal'];
        for (const id of overlays) {
            const el = document.getElementById(id);
            if (el && el.style.display !== 'none' && el.style.display !== '') return;
        }
        if (document.querySelector('.scp-dialog-overlay.visible')) return;
        
        e.preventDefault();
        e.stopPropagation();
        if (state.searchOpen) { document.getElementById('scp-search-input')?.focus(); }
        else openSearch();
    };
    document.addEventListener('keydown', _searchHotkeyHandler, true);
}