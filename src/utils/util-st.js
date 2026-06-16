import { expandMacros } from '../session.js';

export function getTagsForCharacter(char) {
    if (!char) return [];
    const ctx = SillyTavern.getContext();
    const avatar = char.avatar;
    if (!avatar) return [];
    
    const tagMap = ctx.tagMap || {};
    const tagIds = tagMap[avatar];
    if (!Array.isArray(tagIds)) return [];
    
    const allTags = ctx.tags || [];
    return tagIds.map(id => {
        const found = allTags.find(t => t.id === id);
        return found ? found.name : null;
    }).filter(Boolean);
}

export function getCharInfo() {
    const ctx = SillyTavern.getContext();
    const char = ctx.characters?.[ctx.characterId];
    if (!char) return null;
    
    const d = char.data || {};
    const ov = ctx.chatMetadata?.character_overrides || {};
    
    const get = (field, macro) => {
        if (ov[field]) return ov[field];
        if (macro) {
            try { const r = expandMacros(macro); if (r && r !== macro) return r; } catch(_) {}
        }
        return d[field] || char[field] || '';
    };

    const getCharNote = () => {
        if (ov.depth_prompt && ov.depth_prompt.prompt) return ov.depth_prompt.prompt;
        return d.extensions?.depth_prompt?.prompt || char.extensions?.depth_prompt?.prompt || '';
    };

    return {
        name: char.name || 'Unknown',
        description: get('description', '{{description}}'),
        personality: get('personality', '{{personality}}'),
        scenario: get('scenario', '{{scenario}}'),
        mes_example: get('mes_example', '{{mesExamples}}'),
        character_note: getCharNote(),
        creator_notes: get('creator_notes'),
        system_prompt: get('system_prompt'),
        post_history_instructions: get('post_history_instructions'),
    };
}

export function getUserPersona() {
    const ctx = SillyTavern.getContext();
    
    try {
        let expanded = '';
        if (typeof ctx.substituteParams === 'function') {
            expanded = ctx.substituteParams('{{persona}}');
        } else if (typeof window.substituteParams === 'function') {
            expanded = window.substituteParams('{{persona}}');
        }
        if (expanded && expanded !== '{{persona}}') return expanded;
    } catch (_) {}

    try {
        const pu = window.power_user || ctx.powerUserSettings || {};
        let personaId = window.user_avatar || ctx.user_avatar || ctx.userAvatar || ctx.personaId || ctx.activePersonaId || ctx.active_persona_id;
        if (!personaId && typeof document !== 'undefined') {
            const selected = document.querySelector('#user_avatar_block .avatar-container.selected, #persona_container .avatar-container.selected, .persona_selected');
            if (selected) personaId = selected.getAttribute('data-avatar-id') || selected.dataset?.avatarId;
        }
        if (typeof personaId === 'object' && personaId !== null) {
            personaId = personaId.avatarId || personaId.avatar_id || personaId.user_avatar || personaId.userAvatar || personaId.id;
        }

        if (personaId && pu.persona_descriptions) {
            const pd = pu.persona_descriptions[personaId];
            if (typeof pd === 'string') return pd;
            if (typeof pd === 'object' && pd.description) return pd.description;
        }
        if (typeof pu.persona_description === 'string' && pu.persona_description) return pu.persona_description;
    } catch (_) {}

    return ctx.persona || ctx.userPersona || ctx.user_persona || '';
}

export function getAuthorsNote() {
    const ctx = SillyTavern.getContext();
    return ctx.chatMetadata?.note_prompt || ctx.authorsNote || ctx.authors_note || '';
}