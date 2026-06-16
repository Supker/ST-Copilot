import { EXT_DISPLAY, CHAR_EDIT_FORMAT_BLOCK, CHAR_CREATE_FORMAT_BLOCK, DEFAULT_CHAR_EDIT_DIRECTIVE } from '../constants.js';
import { getSettings, getCurrentSession } from '../session.js';
import { _dbgAdd } from '../utils/util-debug.js';
import { escHtml } from '../utils/util-dom.js';
import { _sanitizeProposedTags, applySearchReplaceToField, _repairJSON, _ensureWrapped } from '../utils/util-text.js';
import { getTagsForCharacter, getUserPersona, getAuthorsNote } from '../utils/util-st.js';
import { _getAspectEvolutiaCharFields, _getAspectEvolutiaPersonaFields } from '../integrations/integ-evolutia.js';

export function getEffectiveCharField(settings, k) {
    const ovKey = 'charField_' + k;
    if (settings[ovKey] !== undefined) return settings[ovKey];
    return !!(settings.charEditFields || {})[k];
}

export function buildCharacterContextBlock(settings) {
    const ctx = SillyTavern.getContext();
    const charId = ctx.characterId || 'unknown';
    const char = ctx.characters?.[charId];
    if (!char) return '';
    const d = char.data || {};
    const parts = [];

    const charTags = getTagsForCharacter(char);
    if (getEffectiveCharField(settings, 'tags') && charTags.length) {
        parts.push(`<tags>\n${charTags.join(', ')}\n</tags>`);
    }

    const sysPrompt = d.system_prompt || char.system_prompt;
    if (getEffectiveCharField(settings, 'system_prompt') && sysPrompt) {
        parts.push(`<character_system_prompt_override>\n${sysPrompt}\n</character_system_prompt_override>`);
    }
    const postHist = d.post_history_instructions || char.post_history_instructions;
    if (getEffectiveCharField(settings, 'post_history_instructions') && postHist) {
        parts.push(`<post_history_instructions>\n${postHist}\n</post_history_instructions>`);
    }

    const simple = {
        name: char.name,
        description: d.description || char.description,
        personality: d.personality || char.personality,
        scenario: d.scenario || char.scenario,
        first_mes: d.first_mes || char.first_mes,
        mes_example: d.mes_example || char.mes_example,
    };
    
    if (getSettings().useAspectEvolutia) {
        const aeFields = _getAspectEvolutiaCharFields();
        if (aeFields && aeFields.length) {
            delete simple.description;
            aeFields.forEach(f => {
                parts.push(`<evolutia_char_field name="${escHtml(f.name)}">\n${f.content}\n</evolutia_char_field>`);
            });
        }
    }

    for (const [key, val] of Object.entries(simple)) {
        if ((key === 'name' || getEffectiveCharField(settings, key)) && val) parts.push(`<${key}>\n${val}\n</${key}>`);
    }
    if (getEffectiveCharField(settings, 'alternate_greetings') && Array.isArray(d.alternate_greetings) && d.alternate_greetings.length) {
        const agMap = settings.altGreetingIndices || {};
        const indices = Array.isArray(agMap[charId]) ? agMap[charId] : d.alternate_greetings.map((_, i) => i);
        const filtered = indices.filter(i => i >= 0 && i < d.alternate_greetings.length);
        
        if (filtered.length) {
            const gs = filtered.map(i => `  <greeting id="${i+1}">\n${d.alternate_greetings[i]}\n  </greeting>`).join('\n');
            parts.push(`<alternate_greetings>\n${gs}\n</alternate_greetings>`);
        }
    }
    if (getEffectiveCharField(settings, 'authors_note')) {
        const an = getAuthorsNote();
        if (an) parts.push(`<authors_note>\n${an}\n</authors_note>`);
    }
    return parts.join('\n\n');
}

export function buildCharEditAIInstructions(settings) {
    if (!settings.charEditAIEnabled) return '';
    const baseFields = ['name', 'tags', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'authors_note', 'alternate_greetings', 'system_prompt', 'post_history_instructions'];
    const fieldsList = baseFields.filter(k => k === 'name' || getEffectiveCharField(settings, k));
    
    if (settings.includeUserPersonality && !fieldsList.includes('user_persona')) {
        fieldsList.push('user_persona');
    }
    const enabledFields = fieldsList.join(', ') || 'all fields';
    
    const aeCharFields = settings.useAspectEvolutia ? _getAspectEvolutiaCharFields() : null;
    const aeUserFields = settings.useAspectEvolutia && settings.includeUserPersonality ? _getAspectEvolutiaPersonaFields() : null;
    
    let evolutiaDocs = '';
    if (aeCharFields || aeUserFields) {
        evolutiaDocs = `\n\n<aspect_evolutia_integration>\nDynamic fields are currently managing descriptions. To edit them, target their specific virtual names.\n`;
        if (aeCharFields && aeCharFields.length) {
            evolutiaDocs += `Character Aspect Fields:\n` + aeCharFields.map(f => `- Field: "evolutia_char:${f.name}"`).join('\n') + `\n`;
        }
        if (aeUserFields && aeUserFields.length) {
            evolutiaDocs += `User Aspect Fields:\n` + aeUserFields.map(f => `- Field: "evolutia_user:${f.name}"`).join('\n') + `\n`;
        }
        evolutiaDocs += `Example: <replace field="evolutia_char:FieldName">...</replace>\n</aspect_evolutia_integration>`;
    }
    
    const base = (settings.charEditPrompt || DEFAULT_CHAR_EDIT_DIRECTIVE.trim())
        .replace('{{char_edit_fields}}', enabledFields)
        .replace('{{char_edit_format}}', CHAR_EDIT_FORMAT_BLOCK)
        .replace('{{char_create_format}}', CHAR_CREATE_FORMAT_BLOCK);
        
    return _ensureWrapped(`${base}${evolutiaDocs}`, 'character_management');
}

export function parseCharChangesFromText(text) {
    let raw = null;
    const strict = text.match(/```character-changes\s*([\s\S]*?)```/);
    if (strict) {
        raw = strict[1];
    } else {
        const open = text.match(/```character-changes\s*([\s\S]*?)(?=```|$)/);
        if (open) raw = open[1];
    }
    if (!raw) return null;
    const xml = _repairCharChangesXML(raw);
    const changes = [];
    let m;

    const replaceByField = {};
    const replaceRe = /<replace\s+field="([^"]+)"(?:\s+index="(\d+)")?>([\s\S]*?)<\/replace>/g;
    while ((m = replaceRe.exec(xml)) !== null) {
        const field = m[1];
        const index = m[2] ? parseInt(m[2]) : undefined;
        const content = m[3];
        const key = field + (index !== undefined ? `_${index}` : '');
        
        const diffRe = /<<<<<<< (?:SEARCH|ANCHOR)\r?\n([\s\S]*?)\r?\n=+\r?\n([\s\S]*?)\r?\n>>>>>>> REPLACE/g;
        let diffMatch;
        const patches = [];
        while ((diffMatch = diffRe.exec(content)) !== null) {
            let searchVal = diffMatch[1];
            let replaceVal = diffMatch[2];
            if (field === 'tags') {
                searchVal = _sanitizeProposedTags(searchVal);
                replaceVal = _sanitizeProposedTags(replaceVal);
            }
            patches.push({ search: searchVal, replace: replaceVal });
        }
        if (!patches.length) {
            const searchOnly = content.match(/<<<<<<< (?:SEARCH|ANCHOR)\r?\n([\s\S]*?)\r?\n=+/);
            if (searchOnly) {
                let searchVal = searchOnly[1];
                if (field === 'tags') searchVal = _sanitizeProposedTags(searchVal);
                patches.push({ search: searchVal, replace: '' });
            }
        }
        
        if (!patches.length) {
            let val = content.trim();
            if (field === 'tags') val = _sanitizeProposedTags(val);
            const item = { field, action: 'overwrite', value: val };
            if (index !== undefined) item.index = index;
            changes.push(item);
            continue;
        }
        
        if (!replaceByField[key]) {
            const item = { field, action: 'replace', patches };
            if (index !== undefined) item.index = index;
            replaceByField[key] = item;
        } else {
            replaceByField[key].patches.push(...patches);
        }
    }
    for (const item of Object.values(replaceByField)) changes.push(item);

    const overwriteRe = /<overwrite\s+field="([^"]+)"(?:\s+index="(\d+)")?>([\s\S]*?)<\/overwrite>/g;
    while ((m = overwriteRe.exec(xml)) !== null) {
        let val = m[3].trim();
        if (m[1] === 'tags') val = _sanitizeProposedTags(val);
        const item = { field: m[1], action: 'overwrite', value: val };
        if (m[2]) item.index = parseInt(m[2], 10);
        changes.push(item);
    }

    const appendRe = /<append\s+field="([^"]+)">([\s\S]*?)<\/append>/g;
    while ((m = appendRe.exec(xml)) !== null) {
        let val = m[2].trim();
        if (m[1] === 'tags') val = _sanitizeProposedTags(val);
        changes.push({ field: m[1], action: 'append', value: val });
    }

    const prependRe = /<prepend\s+field="([^"]+)"(?:\s+index="(\d+)")?>([\s\S]*?)<\/prepend>/g;
    while ((m = prependRe.exec(xml)) !== null) {
        let val = m[3].trim();
        if (m[1] === 'tags') val = _sanitizeProposedTags(val);
        const item = { field: m[1], action: 'prepend', value: val };
        if (m[2]) item.index = parseInt(m[2], 10);
        changes.push(item);
    }

    const appendTextRe = /<append_text\s+field="([^"]+)"(?:\s+index="(\d+)")?>([\s\S]*?)<\/append_text>/g;
    while ((m = appendTextRe.exec(xml)) !== null) {
        let val = m[3].trim();
        if (m[1] === 'tags') val = _sanitizeProposedTags(val);
        const item = { field: m[1], action: 'append_text', value: val };
        if (m[2]) item.index = parseInt(m[2], 10);
        changes.push(item);
    }

    return changes.length ? changes : null;
}

export function _repairCharChangesXML(raw) {
    let s = raw;
    const TAGS = ['replace', 'overwrite', 'append_text', 'append', 'prepend'];

    for (const tag of TAGS) {
        const openRe = new RegExp(`<${tag}(\\s[^>]*)?>`, 'g');
        const closeRe = new RegExp(`</${tag}>`, 'g');
        const parts = [];
        let lastIdx = 0;
        let openMatch;
        openRe.lastIndex = 0;
        const opens = [];
        while ((openMatch = openRe.exec(s)) !== null) opens.push(openMatch.index);

        if (opens.length === 0) continue;
        const closes = [];
        let cm;
        closeRe.lastIndex = 0;
        while ((cm = closeRe.exec(s)) !== null) closes.push(cm.index);

        if (opens.length <= closes.length) continue;

        const result = [];
        let cursor = 0;
        for (let i = 0; i < opens.length; i++) {
            const openStart = opens[i];
            const nextOpen = opens[i + 1] ?? Infinity;
            const closeAfterOpen = closes.find(ci => ci > openStart && ci < nextOpen);
            if (closeAfterOpen === undefined) {
                const insertAt = nextOpen === Infinity ? s.length : nextOpen;
                s = s.slice(0, insertAt) + `</${tag}>` + s.slice(insertAt);
                const shift = tag.length + 3;
                for (let j = i + 1; j < opens.length; j++) opens[j] += shift;
                for (let j = 0; j < closes.length; j++) { if (closes[j] >= insertAt) closes[j] += shift; }
                closes.push(insertAt);
                closes.sort((a, b) => a - b);
            }
        }
    }

    s = s.replace(/(<<<<<<< (?:SEARCH|ANCHOR)\r?\n[\s\S]*?)(?=<<<<<<< (?:SEARCH|ANCHOR)|$)/g, (m) => {
        if (!/=+\r?\n/.test(m) && !m.includes('=======')) return m + '\n=======\n>>>>>>> REPLACE\n';
        if (!m.includes('>>>>>>> REPLACE')) return m + '\n>>>>>>> REPLACE\n';
        return m;
    });

    return s;
}

export function stripCharChangesBlock(text) {
    return text
        .replace(/```character-changes[\s\S]*?```/g, '')
        .replace(/```character-changes[\s\S]*/g, '')
        .trim();
}

export function parseCharCreationFromText(text) {
    let raw = null;
    const strict = text.match(/```character-create\s*([\s\S]*?)```/);
    if (strict) {
        raw = strict[1].trim();
    } else {
        const open = text.match(/```character-create\s*([\s\S]*?)(?=```|$)/);
        if (open) raw = open[1].trim();
    }
    if (!raw) return null;
    try {
        const data = JSON.parse(raw);
        if (typeof data !== 'object' || Array.isArray(data)) return null;
        if (data.tags) {
            data.tags = _sanitizeProposedTags(Array.isArray(data.tags) ? JSON.stringify(data.tags) : String(data.tags));
        }
        return data;
    } catch (_) {}
    try {
        const data = JSON.parse(_repairJSON(raw));
        if (typeof data !== 'object' || Array.isArray(data)) return null;
        if (data.tags) {
            data.tags = _sanitizeProposedTags(Array.isArray(data.tags) ? JSON.stringify(data.tags) : String(data.tags));
        }
        return data;
    } catch (_) { return null; }
}

export function stripCharCreationBlock(text) {
    return text
        .replace(/```character-create[\s\S]*?```/g, '')
        .replace(/```character-create[\s\S]*/g, '')
        .trim();
}

export function getCharFieldValue(char, fieldId) {
    if (fieldId === 'user_persona') return getUserPersona();
    if (fieldId === 'tags') return getTagsForCharacter(char).join(', ');
    
    if (fieldId.startsWith('evolutia_char:')) {
        const aeName = fieldId.split('evolutia_char:')[1];
        const fields = _getAspectEvolutiaCharFields();
        const f = fields?.find(x => String(x.name).trim().toLowerCase() === String(aeName).trim().toLowerCase());
        return f ? f.content : '';
    }
    if (fieldId.startsWith('evolutia_user:')) {
        const aeName = fieldId.split('evolutia_user:')[1];
        const fields = _getAspectEvolutiaPersonaFields();
        const f = fields?.find(x => String(x.name).trim().toLowerCase() === String(aeName).trim().toLowerCase());
        return f ? f.content : '';
    }
    
    if (fieldId === 'name') return char.name || '';
    const d = char.data || {};
    if (fieldId === 'authors_note') return getAuthorsNote();
    if (fieldId === 'alternate_greetings') return d.alternate_greetings || [];
    if (fieldId === 'system_prompt') return d.system_prompt || char.system_prompt || '';
    if (fieldId === 'post_history_instructions') return d.post_history_instructions || char.post_history_instructions || '';
    return d[fieldId] || char[fieldId] || '';
}

export async function saveCharacterField(char, fieldId, newValue) {
    const ctx = SillyTavern.getContext();
    
    if (fieldId.startsWith('evolutia_char:')) {
        const aeName = fieldId.split('evolutia_char:')[1];
        const AE_KEY = 'st-description-swap-fields';
        if (!char.data.extensions) char.data.extensions = {};
        const state = char.data.extensions[AE_KEY];
        if (!state) throw new Error('Evolutia state missing');
        const activeId = state.activeAlterEgoId || 'base';
        const alterEgos = Array.isArray(state.alterEgos) ? state.alterEgos : [];
        const activeEgo = alterEgos.find(a => a.id === activeId) || alterEgos[0];
        const fields = Array.isArray(activeEgo?.fields) ? activeEgo.fields : (Array.isArray(state.fields) ? state.fields : []);
        
        const f = fields.find(x => {
            const rawName = String(x.name || '').trim().toLowerCase();
            const rawId = String(x.id || '').trim().toLowerCase();
            const searchTarget = String(aeName).trim().toLowerCase();
            return rawName === searchTarget || rawId === searchTarget;
        });
        if (!f) throw new Error(`Aspect field "${aeName}" not found`);
        
        f.content = newValue;
        
        const payload = {
            name: char.name,
            avatar: char.avatar,
            data: {
                extensions: {
                    [AE_KEY]: state
                }
            }
        };
        
        const res = await fetch('/api/characters/merge-attributes', {
            method: 'POST',
            headers: { ...ctx.getRequestHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!res.ok) {
            const errText = await res.text().catch(() => res.statusText);
            throw new Error(`HTTP ${res.status}: ${errText}`);
        }
        
        const es = ctx.eventSource || window.eventSource;
        const et = ctx.event_types || window.event_types;
        if (es && et?.CHARACTER_EDITED) {
            es.emit(et.CHARACTER_EDITED, { detail: { id: ctx.characterId, character: char } });
            es.emit(et.CHARACTER_EDITED, { id: ctx.characterId, character: char });
        }
        return;
    }

    if (fieldId.startsWith('evolutia_user:')) {
        const aeName = fieldId.split('evolutia_user:')[1];
        const pu = window.power_user || ctx.powerUserSettings || {};
        let personaId = window.user_avatar || ctx.user_avatar || ctx.userAvatar || ctx.personaId || ctx.activePersonaId || ctx.active_persona_id;
        if (!personaId && typeof document !== 'undefined') {
            const selected = document.querySelector('#user_avatar_block .avatar-container.selected, #persona_container .avatar-container.selected, .persona_selected');
            if (selected) personaId = selected.getAttribute('data-avatar-id') || selected.dataset?.avatarId;
        }
        if (typeof personaId === 'object' && personaId !== null) personaId = personaId.avatarId || personaId.avatar_id || personaId.user_avatar || personaId.userAvatar || personaId.id;
        
        const AE_KEY = 'st-description-swap-fields';
        const personaState = pu[AE_KEY]?.personaDynamicFields?.[personaId];
        if (!personaState) throw new Error('Evolutia persona state missing');
        const activeId = personaState.activeAlterEgoId || 'base';
        const alterEgos = Array.isArray(personaState.alterEgos) ? personaState.alterEgos : [];
        const activeEgo = alterEgos.find(a => a.id === activeId) || alterEgos[0];
        const fields = Array.isArray(activeEgo?.fields) ? activeEgo.fields : (Array.isArray(personaState.fields) ? personaState.fields : []);
        
        const f = fields.find(x => {
            const rawName = String(x.name || '').trim().toLowerCase();
            const rawId = String(x.id || '').trim().toLowerCase();
            const searchTarget = String(aeName).trim().toLowerCase();
            return rawName === searchTarget || rawId === searchTarget;
        });
        if (!f) throw new Error(`Aspect persona field "${aeName}" not found`);
        
        f.content = newValue;
        
        if (typeof ctx.saveSettingsDebounced === 'function') ctx.saveSettingsDebounced();
        else if (typeof window.saveSettingsDebounced === 'function') window.saveSettingsDebounced();
        return;
    }

    if (fieldId === 'name') {
        const trimmedName = (newValue || '').trim();
        if (!trimmedName) throw new Error('Character name cannot be empty');
        
        if (typeof ctx.executeSlashCommandsWithOptions === 'function') {
            const safeName = trimmedName.replace(/"/g, '\\"');
            await ctx.executeSlashCommandsWithOptions(`/rename-char silent=true chats=true "${safeName}"`);
            return;
        }

        const renameRes = await fetch('/api/characters/rename', {
            method: 'POST',
            headers: { ...ctx.getRequestHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ avatar_url: char.avatar, new_name: trimmedName }),
        });
        if (!renameRes.ok) {
            const errText = await renameRes.text().catch(() => renameRes.statusText);
            throw new Error(`Rename failed: HTTP ${renameRes.status}: ${errText}`);
        }
        char.name = trimmedName;
        if (char.data) char.data.name = trimmedName;
        if (typeof ctx.getCharacters === 'function') await ctx.getCharacters().catch(() => {});
        else if (typeof window.getCharacters === 'function') await window.getCharacters().catch(() => {});
        const es = ctx.eventSource || window.eventSource;
        const et = ctx.event_types || window.event_types;
        if (es && et?.CHARACTER_EDITED) {
            es.emit(et.CHARACTER_EDITED, { detail: { id: ctx.characterId, character: char } });
            es.emit(et.CHARACTER_EDITED, { id: ctx.characterId, character: char });
        }
        if (typeof window.PrintCharacterList === 'function') window.PrintCharacterList();
        return;
    }
    
    if (fieldId === 'user_persona') {
        const pu = window.power_user || ctx.powerUserSettings || {};
        
        let avatar = window.user_avatar || ctx.user_avatar || ctx.userAvatar || ctx.personaId || ctx.activePersonaId || ctx.active_persona_id;
        if (!avatar && typeof document !== 'undefined') {
            const selected = document.querySelector('#user_avatar_block .avatar-container.selected, #persona_container .avatar-container.selected, .persona_selected');
            if (selected) avatar = selected.getAttribute('data-avatar-id') || selected.dataset?.avatarId;
        }
        if (typeof avatar === 'object' && avatar !== null) {
            avatar = avatar.avatarId || avatar.avatar_id || avatar.user_avatar || avatar.userAvatar || avatar.id;
        }

        if (avatar) {
            try {
                const res = await fetch('/api/characters/merge-attributes', {
                    method: 'POST',
                    headers: { ...ctx.getRequestHeaders(), 'Content-Type': 'application/json' },
                    body: JSON.stringify({ avatar: avatar, data: { description: newValue }, is_persona: true })
                });
            } catch(e) { console.warn("Failed to merge persona API:", e); }
            
            if (pu.persona_descriptions && typeof pu.persona_descriptions === 'object') {
                if (typeof pu.persona_descriptions[avatar] === 'object') {
                    pu.persona_descriptions[avatar].description = newValue;
                } else {
                    pu.persona_descriptions[avatar] = newValue;
                }
            }
        } else {
            pu.persona_description = newValue;
        }
        
        if (typeof ctx.saveSettingsDebounced === 'function') ctx.saveSettingsDebounced();
        else if (typeof window.saveSettingsDebounced === 'function') window.saveSettingsDebounced();
        
        ['persona_description', 'user_persona_edit', 'user_persona_textarea', 'persona_description_textarea'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.value = newValue; el.dispatchEvent(new Event('input', {bubbles:true})); }
        });
        return;
    }

    if (fieldId === 'authors_note') {
        ctx.chatMetadata = ctx.chatMetadata || {};
        ctx.chatMetadata.note_prompt = newValue;
        if (typeof ctx.saveMetadata === 'function') ctx.saveMetadata();
        else saveSettings();
        
        ['note_prompt', 'note_textarea', 'chat_anote_textarea', 'anote_textarea', 'extension_floating_prompt'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.value = newValue; el.dispatchEvent(new Event('input', {bubbles:true})); }
        });
        return;
    }

    if (fieldId === 'tags') {
        const newTagsNames = typeof newValue === 'string' 
            ? newValue.split(',').map(t => t.trim()).filter(Boolean) 
            : (Array.isArray(newValue) ? newValue : []);
        
        const avatar = char.avatar;
        
        if (ctx.tagMap && ctx.tags) {
            const currentTagIds = ctx.tagMap[avatar] || [];
            const toUnlink = currentTagIds.filter(id => {
                const tagObj = ctx.tags.find(t => t.id === id);
                if (!tagObj) return false;
                return !newTagsNames.some(n => n.toLowerCase() === tagObj.name.toLowerCase());
            });

            if (toUnlink.length > 0) {
                ctx.tagMap[avatar] = currentTagIds.filter(id => !toUnlink.includes(id));
                if (typeof ctx.saveSettingsDebounced === 'function') ctx.saveSettingsDebounced();
                else if (typeof window.saveSettingsDebounced === 'function') window.saveSettingsDebounced();
            }
        }
        
        if (!char.data) char.data = {};
        char.data.tags = newTagsNames;
        char.tags = newTagsNames;
        
        const payload = {
            avatar_url: avatar,
            ch_name: char.name || 'Unknown',
            field: 'tags',
            value: newTagsNames
        };
        
        try {
            const res = await fetch('/api/characters/edit-attribute', {
                method: 'POST',
                headers: { ...ctx.getRequestHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) console.warn("[ST-Copilot] Tags edit-attribute failed:", res.status);
        } catch (e) { console.warn("[ST-Copilot] Failed to edit tags API:", e); }

        if (typeof ctx.importTags === 'function') {
            try {
                await ctx.importTags(char, { importSetting: 3 }); 
            } catch(e) { console.warn("[ST-Copilot] Failed to import tags via core context:", e); }
        }

        const es = ctx.eventSource || window.eventSource;
        const et = ctx.event_types || window.event_types;
        if (es && et?.CHARACTER_EDITED) {
            es.emit(et.CHARACTER_EDITED, { detail: { id: ctx.characterId, character: char } });
            es.emit(et.CHARACTER_EDITED, { id: ctx.characterId, character: char });
        }
        return;
    }
    
    if (!char.data) char.data = {};
    
    const payload = { 
        avatar_url: char.avatar, 
        ch_name: char.name || 'Unknown',
        field: fieldId,
        value: newValue 
    };

    if (fieldId === 'alternate_greetings') {
        char.data.alternate_greetings = newValue;
    } else {
        char.data[fieldId] = newValue;
        char[fieldId] = newValue;
    }
    
    const res = await fetch('/api/characters/edit-attribute', {
        method: 'POST',
        headers: { ...ctx.getRequestHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const domMap = {
        description: 'description_textarea',
        personality: 'personality_textarea',
        scenario: 'scenario_pole',
        first_mes: 'firstmessage_textarea',
        mes_example: 'mes_example_textarea',
        system_prompt: 'system_prompt_textarea',
        post_history_instructions: 'post_history_instructions_textarea',
    };

    if (domMap[fieldId]) {
        const el = document.getElementById(domMap[fieldId]);
        if (el) {
            el.value = newValue;
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }
    } else if (fieldId === 'alternate_greetings') {
        if (typeof window.printAlternateGreetings === 'function') {
            window.printAlternateGreetings();
        }
    }

    const es = ctx.eventSource || window.eventSource;
    const et = ctx.event_types || window.event_types;
    if (es && et?.CHARACTER_EDITED) {
        es.emit(et.CHARACTER_EDITED, { detail: { id: ctx.characterId, character: char } });
        es.emit(et.CHARACTER_EDITED, { id: ctx.characterId, character: char });
    }
}

export async function createCharacterAPI(data) {
    const ctx = SillyTavern.getContext();
    
    _dbgAdd('CHAR_CREATE_START', { data });

    const tagsString = Array.isArray(data.tags) 
        ? data.tags.join(', ') 
        : (typeof data.tags === 'string' ? data.tags : '');

    const formData = new FormData();
    formData.append('ch_name', data.name || 'New Character');
    formData.append('description', data.description || '');
    formData.append('personality', data.personality || '');
    formData.append('scenario', data.scenario || '');
    formData.append('first_mes', data.first_mes || '');
    formData.append('mes_example', data.mes_example || '');
    formData.append('tags', tagsString);

    const headers = ctx.getRequestHeaders();
    delete headers['Content-Type'];
    
    let res;
    try {
        res = await fetch('/api/characters/create', {
            method: 'POST',
            headers,
            body: formData,
            cache: 'no-cache',
        });
    } catch (err) {
        console.error('[ST-Copilot-Debug] Network error during character post:', err);
        _dbgAdd('CHAR_CREATE_NET_ERR', { error: err.message, stack: err.stack });
        throw err;
    }

    if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        console.error(`[ST-Copilot-Debug] API returned HTTP Error ${res.status}: ${errText}`);
        _dbgAdd('CHAR_CREATE_HTTP_ERR', { status: res.status, text: errText });
        throw new Error(`HTTP ${res.status}: ${errText}`);
    }

    const newAvatar = await res.text();
    _dbgAdd('CHAR_CREATE_SERVER_OK', { avatar: newAvatar });

    await new Promise(r => setTimeout(r, 400));

    try {
        if (typeof ctx.getCharacters === 'function') {
            await ctx.getCharacters();
        } else if (typeof window.getCharacters === 'function') {
            await window.getCharacters();
        }
    } catch(e) {
        console.warn('[ST-Copilot-Debug] Failed to reload list of characters:', e);
        _dbgAdd('CHAR_CREATE_RELOAD_ERR', { error: e.message });
    }

    const chars = ctx.characters || window.characters || [];
    
    const foundChar = chars.find(c => c.avatar === newAvatar);
    if (foundChar) {
        _dbgAdd('CHAR_CREATE_CACHE_FOUND', { name: foundChar.name, tags: foundChar.tags });

        if (typeof ctx.importTags === 'function') {
            try {
                const importResult = await ctx.importTags(foundChar, { importSetting: 3 });
                _dbgAdd('CHAR_CREATE_IMPORT_TAGS_DONE', { result: importResult });
            } catch (importErr) {
                console.error('[ST-Copilot-Debug] Exception inside importTags():', importErr);
                _dbgAdd('CHAR_CREATE_IMPORT_TAGS_FAIL', { error: importErr.message, stack: importErr.stack });
            }
        } else {
            _dbgAdd('CHAR_CREATE_IMPORT_TAGS_MISSING', { reason: 'ctx.importTags is not a function' });
        }
    } else {
        console.error(`[ST-Copilot-Debug] Character "${newAvatar}" is missing from ST cache!`);
        _dbgAdd('CHAR_CREATE_CACHE_MISSING', { avatar: newAvatar });
    }

    try {
        if (typeof window.PrintCharacterList === 'function') {
            window.PrintCharacterList();
        }
        const es = ctx.eventSource || window.eventSource;
        const et = ctx.event_types || window.event_types;
        if (es && et?.CHARACTERS_UPDATED) {
            es.emit(et.CHARACTERS_UPDATED);
        }
    } catch(e) {
        console.warn('[ST-Copilot-Debug] UI redraw error:', e);
    }

    return true;
}