import { DEFAULT_TOOLS_PROMPT, TOOL_CALL_FORMAT_BLOCK, TOOL_DEFINITIONS } from '../constants.js';
import { getSettings } from '../session.js';
import { _ensureWrapped } from '../utils/util-text.js';
import { getCharInfo, getTagsForCharacter } from '../utils/util-st.js';
import { fetchWorldInfoBook, getDisplayName, getActiveLorebookNames, wiEntriesToArray } from './feature-lorebook-engine.js';

export function getEnabledTools() {
    const s = getSettings();
    if (!s.toolsEnabled) return [];
    return TOOL_DEFINITIONS.filter(t => s[t.settingKey] !== false);
}

export function buildAnthropicToolsPayload() {
    return getEnabledTools().map(t => ({
        name: t.name,
        description: t.label + ': ' + t.description,
        input_schema: t.schema,
    }));
}

export async function executeTool(toolName, toolInput) {
    const ctx = SillyTavern.getContext();
    switch (toolName) {
        case 'search_chat': {
            const msgs = ctx.chat || [];
            const query = toolInput.query || '';
            const role = toolInput.role || 'all';
            const fromIdx = toolInput.from_index ?? 0;
            const toIdx = toolInput.to_index ?? msgs.length - 1;
            const maxResults = Math.min(toolInput.max_results ?? 10, 50);
            const includeContent = toolInput.include_content !== false;
            let isRegex = false, re = null;
            const regexMatch = query.match(/^\/(.+)\/([gimsuy]*)$/);
            if (regexMatch) {
                try { re = new RegExp(regexMatch[1], regexMatch[2]); isRegex = true; } catch(_) {}
            }
            const results = [];
            const lq = query.toLowerCase();
            for (let i = Math.max(0, fromIdx); i <= Math.min(msgs.length - 1, toIdx); i++) {
                const m = msgs[i];
                if (role === 'user' && !m.is_user) continue;
                if (role === 'assistant' && m.is_user) continue;
                const text = m.mes || '';
                let matched = false;
                if (isRegex && re) { re.lastIndex = 0; matched = re.test(text); }
                else {
                    matched = text.toLowerCase().includes(lq);
                    if (!matched) {
                        const tokens = lq.split(/\s+/).filter(Boolean);
                        if (tokens.length > 1) matched = tokens.every(t => text.toLowerCase().includes(t));
                    }
                }
                if (matched) {
                    const entry = { index: i, role: m.is_user ? 'user' : 'assistant', name: m.name || (m.is_user ? (ctx.name1 || 'User') : (ctx.name2 || 'Character')) };
                    if (includeContent) entry.content = text.length > 500 ? text.slice(0, 500) + '...[truncated]' : text;
                    results.push(entry);
                    if (results.length >= maxResults) break;
                }
            }
            return { found: results.length, results, note: `Use 'index' values in chat-changes proposals. Total messages searched: ${Math.min(msgs.length - 1, toIdx) - Math.max(0, fromIdx) + 1}` };
        }
        case 'search_lorebook_entry': {
            const activeBooks = getActiveLorebookNames();
            const query = (toolInput.query || '').toLowerCase();
            const targetBook = toolInput.book_name;
            const searchIn = toolInput.search_in || 'all';
            const onlyConstant = !!toolInput.only_constant;
            const onlyOutlet = !!toolInput.only_outlet;
            const results = [];
            for (const bookName of activeBooks) {
                if (targetBook && !bookName.toLowerCase().includes(targetBook.toLowerCase())) continue;
                const data = await fetchWorldInfoBook(bookName).catch(() => null);
                if (!data) continue;
                for (const entry of wiEntriesToArray(data)) {
                    const outletField = (entry.outlet || entry.outlet_name || entry.outletName || entry.automation_id || entry.automationId || '').trim();
                    const isOutletPos = String(entry.position) === '5' || String(entry.position).toLowerCase() === 'outlet';
                    const isEntryOutlet = isOutletPos || outletField !== '';
                    if (onlyConstant && !entry.constant) continue;
                    if (onlyOutlet && !isEntryOutlet) continue;
                    let matched = false;
                    const name = (entry.comment || '').toLowerCase();
                    const keys = (entry.key || []).join(' ').toLowerCase();
                    const text = (entry.content || '').toLowerCase();
                    if (searchIn === 'all') matched = name.includes(query) || keys.includes(query) || text.includes(query);
                    else if (searchIn === 'name') matched = name.includes(query);
                    else if (searchIn === 'keys') matched = keys.includes(query);
                    else if (searchIn === 'content') matched = text.includes(query);
                    if (matched) results.push({
                        book: getDisplayName(bookName),
                        uid: entry.uid,
                        name: entry.comment || `Entry #${entry.uid}`,
                        keys: entry.key || [],
                        content_preview: (entry.content || '').slice(0, 200) + ((entry.content || '').length > 200 ? '...' : ''),
                        is_constant: !!entry.constant,
                        is_outlet: isEntryOutlet,
                        outlet_name: outletField || null,
                        disabled: !!entry.disable,
                    });
                    if (results.length >= 20) break;
                }
                if (results.length >= 20) break;
            }
            return { found: results.length, results };
        }
        case 'get_lorebooks': {
            const activeBooks = getActiveLorebookNames();
            const includeEntries = !!toolInput.include_entries;
            const specificBook = toolInput.book_name;
            if (!includeEntries) {
                return {
                    lorebooks: activeBooks.map(name => ({ name: getDisplayName(name), internal_name: name })),
                    total: activeBooks.length,
                };
            }
            const booksToProcess = specificBook
                ? activeBooks.filter(n => n === specificBook || getDisplayName(n) === specificBook)
                : activeBooks;
            const result = {};
            for (const name of booksToProcess) {
                const data = await fetchWorldInfoBook(name).catch(() => null);
                if (!data) { result[getDisplayName(name)] = []; continue; }
                result[getDisplayName(name)] = wiEntriesToArray(data).map(e => {
                    const outletField = (e.outlet || e.outlet_name || e.outletName || e.automation_id || e.automationId || '').trim();
                    const isOutletPos = String(e.position) === '5' || String(e.position).toLowerCase() === 'outlet';
                    return {
                        name: e.comment || `#${e.uid}`,
                        uid: e.uid,
                        is_constant: !!e.constant,
                        is_outlet: isOutletPos || outletField !== '',
                        outlet_name: outletField || null,
                        disabled: !!e.disable,
                    };
                });
            }
            return { lorebooks: result };
        }
        case 'ask_user': {
            return { __ask_user: true, question: toolInput.question, context: toolInput.context };
        }
        case 'get_char_info': {
            const charInfoFull = getCharInfo();
            if (!charInfoFull) return { error: 'No active character.' };
            const charCtx = ctx.characters?.[ctx.characterId];
            const requestedFields = toolInput.fields || ['description', 'personality', 'scenario'];
            const result = { name: charInfoFull.name };
            for (const f of requestedFields) {
                if (f === 'tags') result.tags = getTagsForCharacter(charCtx);
                else if (f === 'alternate_greetings') result.alternate_greetings = (charCtx?.data?.alternate_greetings || []);
                else result[f] = (charInfoFull[f] || charCtx?.data?.[f] || '');
            }
            return result;
        }
        case 'get_chat_stats': {
            const msgs = ctx.chat || [];
            const userMsgs = msgs.filter(m => m.is_user);
            const asMsgs = msgs.filter(m => !m.is_user);
            const totalChars = msgs.reduce((s, m) => s + (m.mes || '').length, 0);
            return {
                total_messages: msgs.length,
                user_messages: userMsgs.length,
                assistant_messages: asMsgs.length,
                approx_tokens: Math.ceil(totalChars / 3.5),
                first_message_index: 0,
                last_message_index: msgs.length - 1,
                char_name: ctx.name2 || 'Character',
                user_name: ctx.name1 || 'User',
            };
        }
        case 'get_recent_messages': {
            const msgs = ctx.chat || [];
            const count = Math.min(toolInput.count ?? 10, 50);
            const fromEnd = toolInput.from_end !== false;
            const role = toolInput.role || 'all';
            let filtered = msgs.map((m, i) => ({ ...m, _idx: i }));
            if (role === 'user') filtered = filtered.filter(m => m.is_user);
            if (role === 'assistant') filtered = filtered.filter(m => !m.is_user);
            if (fromEnd) filtered = filtered.slice(-count);
            else filtered = filtered.slice(0, count);
            return {
                messages: filtered.map(m => ({
                    index: m._idx,
                    role: m.is_user ? 'user' : 'assistant',
                    name: m.name || (m.is_user ? (ctx.name1 || 'User') : (ctx.name2 || 'Character')),
                    content: (m.mes || '').length > 600 ? m.mes.slice(0, 600) + '...[truncated]' : (m.mes || ''),
                })),
                note: 'Use "index" values in chat-changes proposals for precise targeting.',
            };
        }
        default: return { error: `Unknown tool: ${toolName}` };
    }
}

export function parseToolCallsFromText(text) {
    const results = [];
    const re = /```tool_call\n?([\s\S]*?)(?:```|$)/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
        const rawBlock = m[1].trim();
        if (!rawBlock) continue;

        let extracted = [];

        try {
            const parsed = JSON.parse(rawBlock);
            if (Array.isArray(parsed)) {
                extracted = parsed.filter(p => p && p.name).map(p => ({ name: p.name, input: p.input || {} }));
            } else if (parsed && parsed.name) {
                extracted.push({ name: parsed.name, input: parsed.input || {} });
            }
        } catch (_) {}

        if (!extracted.length) {
            try {
                const fixedRaw = '[' + rawBlock.replace(/}\s*{/g, '},{') + ']';
                const parsed = JSON.parse(fixedRaw);
                if (Array.isArray(parsed)) {
                    extracted = parsed.filter(p => p && p.name).map(p => ({ name: p.name, input: p.input || {} }));
                }
            } catch (_) {}
        }

        if (!extracted.length) {
            const lines = rawBlock.split('\n');
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const parsed = JSON.parse(line.trim());
                    if (parsed && parsed.name) {
                        extracted.push({ name: parsed.name, input: parsed.input || {} });
                    }
                } catch (_) {}
            }
        }

        if (!extracted.length) {
            const nameMatch = rawBlock.match(/"name"\s*:\s*"([^"]+)"/);
            if (nameMatch) {
                extracted.push({ name: nameMatch[1], input: {} });
            } else {
                extracted.push({ name: 'parsing...', input: {} });
            }
        }

        results.push(...extracted);
    }
    return results;
}

export function stripToolCallsFromText(text) {
    return text.replace(/```tool_call[\s\S]*?```/gi, '').trim();
}

export function buildToolCallsSystemBlock() {
    const tools = getEnabledTools();
    if (!tools.length) return '';
    const s = getSettings();
    
    const formatSchemaProps = (properties) => {
        if (!properties || Object.keys(properties).length === 0) return '{}';
        const lines = [];
        for (const [key, prop] of Object.entries(properties)) {
            lines.push(`"${key}": ${JSON.stringify(prop)}`);
        }
        return `{${lines.join(',\n    ')}}`;
    };

    const toolsList = tools.map(t =>
        `- **${t.name}**: ${t.description} | Params: ${formatSchemaProps(t.schema.properties)}`
    ).join("\n");
    
    let prompt = s.toolsSystemPrompt || DEFAULT_TOOLS_PROMPT;
    if (!prompt.includes('{{tools_list}}')) {
        prompt += '\n\nTools available:\n{{tools_list}}';
    }
    if (!prompt.includes('{{tool_call_format}}')) {
        prompt = prompt.replace('Format requirement:', 'Format requirement:\n{{tool_call_format}}');
    }
    
    const finalPrompt = prompt
        .replace('{{tools_list}}', toolsList)
        .replace('{{tool_call_format}}', TOOL_CALL_FORMAT_BLOCK);
        
    return '\n\n' + _ensureWrapped(finalPrompt, 'tool_calls_system');
}