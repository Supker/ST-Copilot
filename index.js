(function () {
    'use strict';

    const EXT_NAME = 'st_copilot';
    const EXT_DISPLAY = 'ST-Copilot';
    const WIN_ID = 'scp-window';
    const ICON_ID = 'scp-dock-icon';
    const MODAL_ID = 'scp-ctx-modal';
    const ICON_STORAGE_KEY = 'scp-icon-position';
    let ST_WorldInfo = null;
    let ST_Utils = null;

    let __extPath = 'third-party/ST-Copilot';
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

    const DEFAULT_SYSTEM_PROMPT =
    `<system_prompt>\n` +
    `<system_role>\n` +
    `You are "ST-Copilot", an advanced meta-assistant and creative co-writer integrated directly into the SillyTavern frontend. Your purpose is to assist the human user in managing, analyzing, and expanding their current roleplay session. \n` +
    `</system_role>\n` +
    `\n` +
    `<entity_definitions>\n` +
    `To perform your duties perfectly, you must understand the entities involved in this session:\n` +
    `- {{user}}: The character/avatar actively controlled by the human user in the roleplay.\n` +
    `- {{char}}: The primary AI character, persona, or setting of the current roleplay.\n` +
    `- ST-Copilot (You): The Out-Of-Character (OOC) analytical engine and brainstormer. \n` +
    `CRITICAL DIRECTIVE: You are ST-Copilot. You are STRICTLY NOT {{char}}. You must never generate roleplay responses, dialogue, or actions on behalf of {{char}} or {{user}}. You exist outside the narrative.\n` +
    `</entity_definitions>\n` +
    `\n` +
    `<persona_configuration>\n` +
    `You are a professional, friendly, and highly capable creative co-writer.\n` +
    `- Tone: Conversational, insightful, collaborative, and encouraging. Act as a friendly "Dungeon Master\'s assistant."\n` +
    `- Focus: Creative brainstorming, plot twists, lore tracking, and resolving writer\'s block.\n` +
    `- Task: Provide balanced, well-thought-out suggestions that elevate the story\'s quality. You are the ultimate sounding board for the user\'s ideas, offering constructive feedback and multiple narrative options to keep the story flowing naturally.\n` +
    `</persona_configuration>\n` +
    `\n` +
    `<operational_guidelines>\n` +
    `When the user asks you a question or requests assistance, adhere to the following principles:\n` +
    `1. Contextual Brilliance: Draw upon the provided chat history and {{char}}\'s traits to give highly relevant, lore-accurate answers.\n` +
    `2. Creative Brainstorming: Offer imaginative plot twists, analyze character motivations, suggest possible scenarios, or help resolve writer\'s block. Leave room for the user\'s imagination—do not force a single narrative path.\n` +
    `3. Formatting: Use markdown (bullet points, bold text, etc.) to make your insights readable and engaging.\n` +
    `</operational_guidelines>\n` +
    `\n` +
    `Your ultimate goal is to enhance the user\'s roleplay experience by providing deep OOC insights, tracking lore, and answering questions based on your specific persona configuration.\n` +
    `</system_prompt>\n`;

    const DEFAULT_LB_MANAGE_PROMPT = 
    `<context>\n` +
    `A Lorebook (or World Info) is a dynamic memory system used in roleplay to store and seamlessly retrieve facts about the world, characters, locations, items, and lore. When specific keywords (\`triggers\`) are mentioned in the chat, the system secretly injects the corresponding \`content\` into the AI's prompt.\n` +
    `</context>\n\n` +
    `<system_mechanics>\n` +
    `After you generate a proposal, a background script extracts your \`lorebook-changes\` block for the user's UI. Once the user makes a decision, the system AUTOMATICALLY DELETES the code block from your message history to save context tokens. \n` +
    `If you look at the chat history and notice your previous \`lorebook-changes\` blocks are missing, understand that this is intentional system behavior. You successfully delivered them. Do NOT re-generate, repeat, or fix missing blocks from past messages.\n` +
    `</system_mechanics>\n\n` +
    `<guidelines>\n` +
    `1. Authorization Role: You are authorized to PROPOSE Lorebook updates ONLY when explicitly commanded by the user. You do not apply changes directly; the user makes the final decision.\n` +
    `2. Cognitive Processing & Explanation: Before generating the proposal block, you MUST explain your reasoning in your regular conversational response. Briefly describe what entry you are proposing to add, edit, or delete, and why. \n` +
    `3. Conversational Flow: Since your code blocks will be deleted later, do not end your conversational text with phrases like "Here is the code block below:". Treat the code block as a detached technical appendix.\n` +
    `4. Semantic Restrictions: ALWAYS use language indicating a suggestion (e.g., "I propose adding...", "I suggest editing..."). NEVER state that changes have been "applied", "saved", or "made", as you only generate drafts.\n` +
    `5. Semantic Density of Entries: Write \`content\` that is concise, factual, and information-dense. Avoid fluff to minimize token consumption.\n` +
    `6. Objective & Timeless Content (CRITICAL): Entries (characters, locations, items, lore, etc.) MUST NOT be tied to the current story progression, plot developments, or recent chat events. Write them as objective, standalone encyclopedic descriptions that exist entirely independently of the ongoing narrative. \n` +
    `7. Trigger Optimization: Choose \`triggers\` carefully. Use specific nouns, names, or unique phrases. Avoid overly generic words.\n` +
    `8. Target Definition and Naming Conventions (CRITICAL):\n` +
    `   - Currently active lorebooks: {{active_lorebooks}}\n` +
    `   - Modifying Existing: If your target lorebook exists in the active list above, you MUST apply absolute strict string matching. Do not alter spelling, spacing, capitalization, or punctuation.\n` +
    `   - Creating New: If the context requires a categorization not present in the active list, you are authorized to draft a NEW lorebook. Assign it a concise, logical name.\n` +
    `</guidelines>\n\n` +
    `<output_formatting>\n` +
    `When proposing changes, generate a markdown code block tagged exactly as \`lorebook-changes\`.\n` +
    `This block MUST be placed at the very end of your message, after all conversational text.\n\n` +
    `Format requirement (Strictly adhere to this JSON structure):\n` +
    `{{lorebook_output}}\n` +
    `</output_formatting>`;

    const LB_FORMAT_BLOCK =
    '```lorebook-changes\n' +
    '{"changes":[\n' +
    '  {"action":"add","worldName":"BookName","name":"EntryName","triggers":["keyword"],"content":"Entry content"},\n' +
    '  {"action":"edit","worldName":"BookName","uid":123,"name":"NewName","triggers":["kw"],"content":"New content"},\n' +
    '  {"action":"delete","worldName":"BookName","uid":123,"name":"EntryName"}\n' +
    ']}\n' +
    '```';

        
    // ─── Theme Presets ──────────────────────────────────────────────────────────

    const THEME_PRESETS = {
        default: {
            label: 'Dark Sky',
            bg: 'rgba(0,0,0,0.85)', blur: 'blur(14px)',
            text: '#e2e2e6', textMuted: 'rgb(176,176,176)',
            accent: 'rgb(191,191,191)', accentDim: 'rgba(209,209,209,0.4)',
            accentBg: 'rgba(112,112,112,0.08)',
            headerBg: 'rgba(255,255,255,0.04)', toolbarBg: 'rgba(0,0,0,0.25)',
            msgUserBg: 'rgba(214,214,214,0.1)', msgAiBg: 'rgba(214,214,214,0.03)',
            inputBg: 'rgba(0,0,0,0.30)', codeBg: 'rgba(0,0,0,0.35)',
            radius: '10px', danger: '#ff5c5c', success: '#4caf7d',
            shadow: '0 24px 64px rgba(0,0,0,0.6), 0 4px 16px rgba(0,0,0,0.4)',
            border: '2px solid rgba(255,255,255,0.09)', font: '',
        },
        blue: {
            label: 'Light Blue',
            bg: 'rgba(18,18,22,0.94)', blur: 'blur(14px)',
            text: '#e2e2e6', textMuted: '#72728a',
            accent: '#7c6dfa', accentDim: 'rgba(124,109,250,0.45)',
            accentBg: 'rgba(124,109,250,0.12)',
            headerBg: 'rgba(255,255,255,0.04)', toolbarBg: 'rgba(0,0,0,0.25)',
            msgUserBg: 'rgba(124,109,250,0.10)', msgAiBg: 'rgba(255,255,255,0.03)',
            inputBg: 'rgba(0,0,0,0.30)', codeBg: 'rgba(0,0,0,0.35)',
            radius: '10px', danger: '#ff5c5c', success: '#4caf7d',
            shadow: '0 24px 64px rgba(0,0,0,0.6), 0 4px 16px rgba(0,0,0,0.4)',
            border: '1px solid rgba(255,255,255,0.09)', font: '',
        },
        deep: {
            label: 'Deep Blue',
            bg: 'rgba(10,10,12,0.97)', blur: 'blur(0px)',
            text: '#c8c8d0', textMuted: '#505060',
            accent: '#8b7cf8', accentDim: 'rgba(139,124,248,0.4)',
            accentBg: 'rgba(139,124,248,0.08)',
            headerBg: 'rgba(0,0,0,0.5)', toolbarBg: 'rgba(0,0,0,0.4)',
            msgUserBg: 'rgba(139,124,248,0.07)', msgAiBg: 'rgba(255,255,255,0.02)',
            inputBg: 'rgba(0,0,0,0.5)', codeBg: 'rgba(0,0,0,0.6)',
            radius: '10px', danger: '#ff5c5c', success: '#4caf7d',
            shadow: '0 24px 64px rgba(0,0,0,0.8), 0 4px 16px rgba(0,0,0,0.6)',
            border: '1px solid rgba(255,255,255,0.06)', font: '',
        },
        glass: {
            label: 'Glass',
            bg: 'rgba(40,40,55,0.55)', blur: 'blur(22px) saturate(1.6)',
            text: '#f0efff', textMuted: '#9898b8',
            accent: '#a78bfa', accentDim: 'rgba(167,139,250,0.5)',
            accentBg: 'rgba(167,139,250,0.14)',
            headerBg: 'rgba(255,255,255,0.07)', toolbarBg: 'rgba(255,255,255,0.05)',
            msgUserBg: 'rgba(167,139,250,0.10)', msgAiBg: 'rgba(255,255,255,0.05)',
            inputBg: 'rgba(0,0,0,0.25)', codeBg: 'rgba(0,0,0,0.30)',
            radius: '12px', danger: '#ff5c5c', success: '#4caf7d',
            shadow: '0 20px 60px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.1) inset',
            border: '1px solid rgba(255,255,255,0.18)', font: '',
        },
        hacker: {
            label: 'Hacker',
            bg: 'rgba(6,14,6,0.97)', blur: 'blur(0px)',
            text: '#88ee88', textMuted: '#3a6640',
            accent: '#00ff88', accentDim: 'rgba(0,255,136,0.45)',
            accentBg: 'rgba(0,255,136,0.08)',
            headerBg: 'rgba(0,255,136,0.06)', toolbarBg: 'rgba(0,0,0,0.6)',
            msgUserBg: 'rgba(0,255,136,0.05)', msgAiBg: 'rgba(0,0,0,0.4)',
            inputBg: 'rgba(0,0,0,0.55)', codeBg: 'rgba(0,0,0,0.7)',
            radius: '4px', danger: '#ff4444', success: '#00ff88',
            shadow: '0 0 30px rgba(0,255,136,0.08), 0 16px 48px rgba(0,0,0,0.8)',
            border: '1px solid #00c77044', font: "'Consolas','Courier New',monospace",
        },
        native: {
            label: 'Native ST',
            bg: 'var(--SmartThemeBlurTrans, rgba(20,20,24,0.92))', blur: 'var(--smartThemeBlur, blur(12px))',
            text: 'var(--SmartThemeBodyColorText, #e2e2e6)', textMuted: 'var(--SmartThemeBodyColorTextMuted, #72728a)',
            accent: 'var(--smartThemeMenuColorText, #7c6dfa)', accentDim: 'var(--white30a, rgba(255,255,255,0.3))',
            accentBg: 'var(--white10a, rgba(255,255,255,0.08))',
            headerBg: 'var(--black30a, rgba(0,0,0,0.3))', toolbarBg: 'var(--black50a, rgba(0,0,0,0.25))',
            msgUserBg: 'var(--black30a, rgba(0,0,0,0.18))', msgAiBg: 'rgba(255,255,255,0.025)',
            inputBg: 'var(--black50a, rgba(0,0,0,0.3))', codeBg: 'var(--black50a, rgba(0,0,0,0.35))',
            radius: '10px', danger: '#ff5c5c', success: '#4caf7d',
            shadow: '0 24px 64px rgba(0,0,0,0.6), 0 4px 16px rgba(0,0,0,0.4)',
            border: 'var(--smartThemeBorder, 1px solid rgba(255,255,255,0.09))', font: '',
        },
    };

    const THEME_VAR_DEFS = [
        { key: 'bg',         label: 'Background',    hint: 'rgba(r,g,b,a)' },
        { key: 'blur',       label: 'Blur',          hint: 'blur(14px)' },
        { key: 'border',     label: 'Border',        hint: '1px solid rgba(...)' },
        { key: 'text',       label: 'Text',          hint: '#hex or rgba' },
        { key: 'textMuted',  label: 'Muted Text',    hint: '#hex or rgba' },
        { key: 'accent',     label: 'Accent',        hint: '#hex or rgba' },
        { key: 'accentDim',  label: 'Accent Dim',    hint: 'rgba(r,g,b,a)' },
        { key: 'accentBg',   label: 'Accent BG',     hint: 'rgba(r,g,b,a)' },
        { key: 'headerBg',   label: 'Header BG',     hint: 'rgba(r,g,b,a)' },
        { key: 'toolbarBg',  label: 'Toolbar BG',    hint: 'rgba(r,g,b,a)' },
        { key: 'msgUserBg',  label: 'User Msg BG',   hint: 'rgba(r,g,b,a)' },
        { key: 'msgAiBg',    label: 'AI Msg BG',     hint: 'rgba(r,g,b,a)' },
        { key: 'inputBg',    label: 'Input BG',      hint: 'rgba(r,g,b,a)' },
        { key: 'codeBg',     label: 'Code BG',       hint: 'rgba(r,g,b,a)' },
        { key: 'radius',     label: 'Corner Radius', hint: '10px' },
        { key: 'shadow',     label: 'Shadow',        hint: 'CSS box-shadow' },
        { key: 'danger',     label: 'Danger Color',  hint: '#ff5c5c' },
        { key: 'success',    label: 'Success Color', hint: '#4caf7d' },
        { key: 'font',       label: 'Font Family',   hint: "system-ui, sans-serif" },
    ];

    const THEME_CSS_MAP = {
        bg: '--scp-bg', blur: '--scp-blur', border: '--scp-border',
        text: '--scp-text', textMuted: '--scp-text-muted',
        accent: '--scp-accent', accentDim: '--scp-accent-dim', accentBg: '--scp-accent-bg',
        headerBg: '--scp-header-bg', toolbarBg: '--scp-toolbar-bg',
        msgUserBg: '--scp-msg-user-bg', msgAiBg: '--scp-msg-ai-bg',
        inputBg: '--scp-input-bg', codeBg: '--scp-code-bg',
        radius: '--scp-radius', shadow: '--scp-shadow',
        danger: '--scp-danger', success: '--scp-success', font: '--scp-font',
    };

    // ─── Lorebook (World Info) Module ─────────────────────────────────────────────

    let _wiCache = {};
    let _wiPromises = {}; 
    const EMBEDDED_BOOK_KEY = '__char_embedded__';
    let _lastActiveEntries = [];

    async function fetchWorldInfoBook(name) {
        if (name === EMBEDDED_BOOK_KEY) return getEmbeddedCharBook();
        
        if (_wiCache[name] && Date.now() - (_wiCache[name]._ts || 0) < 30000) return _wiCache[name];
        if (_wiPromises[name]) return _wiPromises[name];

        const ctx = SillyTavern.getContext();
        
        _wiPromises[name] = (async () => {
            try {
                let data = null;
                if (typeof ctx.loadWorldInfo === 'function') {
                    data = await ctx.loadWorldInfo(name);
                } else {
                    const res = await fetch('/api/worldinfo/get', {
                        method: 'POST',
                        headers: { ...ctx.getRequestHeaders(), 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name }),
                    });
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    data = await res.json();
                }
                if (!data) return null;
                data._ts = Date.now();
                _wiCache[name] = data;
                return data;
            } catch (e) {
                console.error(`[${EXT_DISPLAY}] WI load failed for "${name}":`, e);
                return null;
            } finally {
                delete _wiPromises[name];
            }
        })();

        return _wiPromises[name];
    }

    function getEmbeddedCharBook() {
        const ctx = SillyTavern.getContext();
        const char = ctx.characters?.[ctx.characterId];
        const book = char?.data?.character_book;
        if (!book?.entries?.length) return null;
        const data = { entries: {}, _embedded: true, _ts: Date.now() };
        (book.entries || []).forEach((e, idx) => {
            const uid = e.id ?? idx;
            data.entries[uid] = {
                uid,
                key: Array.isArray(e.keys) ? e.keys : (e.key || []),
                keysecondary: e.secondary_keys || e.keysecondary || [],
                content: e.content || '',
                comment: e.name || e.comment || '',
                disable: e.enabled === false,
                constant: !!e.constant,
                selective: !!e.selective,
                position: e.position ?? 0,
                displayIndex: uid,
            };
        });
        return data;
    }

    async function saveWorldInfoBook(name, data) {
        if (data._embedded) { toastr.warning('Cannot save embedded character books directly.', EXT_DISPLAY); return; }
        const ctx = SillyTavern.getContext();
        const payload = { ...data };
        delete payload._ts;
        try {
            if (typeof ctx.saveWorldInfo === 'function') {
                await ctx.saveWorldInfo(name, payload);
            } else {
                const res = await fetch('/api/worldinfo/edit', {
                    method: 'POST',
                    headers: { ...ctx.getRequestHeaders(), 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, data: payload }),
                });
                if (!res.ok) {
                    const errText = await res.text().catch(() => res.statusText);
                    throw new Error(`HTTP ${res.status}: ${errText}`);
                }
            }
        } catch (e) {
            console.error(`[${EXT_DISPLAY}] saveWorldInfoBook failed for "${name}":`, e);
            throw e;
        }
        delete _wiCache[name];
        
        try {
            if (typeof ctx.reloadWorldInfoEditor === 'function') {
                ctx.reloadWorldInfoEditor(name, true);
            }
        } catch (_) {}
    }


    function getDisplayName(name) {
        if (name === EMBEDDED_BOOK_KEY) {
            const ctx = SillyTavern.getContext();
            const char = ctx.characters?.[ctx.characterId];
            return `[${char?.name || 'Character'} Book]`;
        }
        return name;
    }

    function getActiveLorebookNames() {
        const ctx = SillyTavern.getContext();
        const names = new Set();

        // 1. GLOBAL
        const globalBooks = ST_WorldInfo?.selected_world_info || window.selected_world_info ||[];
        if (Array.isArray(globalBooks)) {
            globalBooks.forEach(n => n && names.add(n));
        }

        // 2. CHARACTER
        const charId = ctx.characterId;
        const character = ctx.characters?.[charId];
        if (character) {
            const baseWorldName = character.data?.extensions?.world || character.world;
            if (baseWorldName && typeof baseWorldName === 'string') names.add(baseWorldName);

            let fileName = character.avatar;
            if (ST_Utils && typeof ST_Utils.getCharaFilename === 'function') {
                fileName = ST_Utils.getCharaFilename(charId);
            }
            const charLoreList = ST_WorldInfo?.world_info?.charLore || window.world_info?.charLore;
            if (fileName && Array.isArray(charLoreList)) {
                const extraCharLore = charLoreList.find(e => e.name === fileName);
                if (extraCharLore && Array.isArray(extraCharLore.extraBooks)) {
                    extraCharLore.extraBooks.forEach(book => book && names.add(book));
                }
            }
        }

        // 3. CHAT
        const wiKey = ST_WorldInfo?.METADATA_KEY || window.WI_METADATA_KEY || 'world_info';
        const chatWorldName = ctx.chatMetadata?.[wiKey];
        if (chatWorldName && typeof chatWorldName === 'string') names.add(chatWorldName);

        // 4. PERSONA
        const personaWorldName = ctx.powerUserSettings?.persona_description_lorebook;
        if (personaWorldName && typeof personaWorldName === 'string') names.add(personaWorldName);

        return [...names].filter(Boolean);
    }


    function getBookSourceType(name) {
        if (name === EMBEDDED_BOOK_KEY) return 'embedded';
        const ctx = SillyTavern.getContext();
        
        const globalBooks = ST_WorldInfo?.selected_world_info || window.selected_world_info || [];
        if (Array.isArray(globalBooks) && globalBooks.includes(name)) {
            return 'global';
        }

        const charId = ctx.characterId;
        const character = ctx.characters?.[charId];
        if (character) {
            const baseWorldName = character.data?.extensions?.world || character.world;
            if (baseWorldName === name) return 'character';

            let fileName = character.avatar;
            if (ST_Utils && typeof ST_Utils.getCharaFilename === 'function') {
                fileName = ST_Utils.getCharaFilename(charId);
            }
            const charLoreList = ST_WorldInfo?.world_info?.charLore || window.world_info?.charLore;
            if (fileName && Array.isArray(charLoreList)) {
                const extraCharLore = charLoreList.find(e => e.name === fileName);
                if (extraCharLore?.extraBooks?.includes(name)) return 'character';
            }
        }

        const wiKey = ST_WorldInfo?.METADATA_KEY || window.WI_METADATA_KEY || 'world_info';
        if (ctx.chatMetadata?.[wiKey] === name) return 'chat';
        
        if (ctx.powerUserSettings?.persona_description_lorebook === name) return 'chat';

        return 'manual';
    }

    function wiEntriesToArray(data) {
        if (!data?.entries) return [];
        return Object.values(data.entries).sort((a, b) => (a.displayIndex ?? a.uid) - (b.displayIndex ?? b.uid));
    }

    function keywordMatchEntry(keys, text) {
        if (!keys?.length || !text) return false;
        const lower = text.toLowerCase();
        return keys.some(k => {
            if (!k) return false;
            try {
                const m = k.match(/^\/(.+)\/([gimsuy]*)$/);
                if (m) return new RegExp(m[1], m[2]).test(text);
            } catch (_) {}
            return lower.includes(k.toLowerCase());
        });
    }

    function getKeywordTriggeredEntries(allBooksData, text1, text2) {
        const scanText = [text1, text2].filter(Boolean).join('\n');
        const results = {};
        for (const [bookName, data] of Object.entries(allBooksData)) {
            const entries = wiEntriesToArray(data);
            const matched = entries.filter(e => !e.disable && (keywordMatchEntry(e.key, scanText) || keywordMatchEntry(e.keysecondary, scanText)));
            if (matched.length) results[bookName] = matched;
        }
        return results;
    }

    async function buildLorebookContextBlock(settings) {
        _lastActiveEntries = [];
        const selectedBooks = settings.lorebookSelectedBooks || [];
        const overrides = settings.lorebookEntryOverrides || {};
        if (!selectedBooks.length && !settings.lorebookAutoKeyword) return '';

        const loadedBooks = {};
        
        await Promise.all(selectedBooks.map(async name => {
            const data = await fetchWorldInfoBook(name);
            if (data) loadedBooks[name] = data;
        }));


        let keywordEntries = {};
        if (settings.lorebookAutoKeyword) {
            const ctx = SillyTavern.getContext();
            const msgs = ctx.chat;
            const stDepth = Math.max(1, settings.lorebookSTScanDepth ?? 5);
            const recentMsgs = msgs ? msgs.slice(-stDepth) : [];
            const lastUser = recentMsgs.filter(m => m.is_user).map(m => m.mes).join('\n');
            const lastChar = recentMsgs.filter(m => !m.is_user).map(m => m.mes).join('\n');

            let copilotScanText = '';
            try {
                const session = getCurrentSession();
                const copilotDepth = settings.lorebookCopilotScanDepth ?? 6;
                copilotScanText = session.messages
                    .filter(m => !m.isLBHistory)
                    .slice(-copilotDepth)
                    .map(m => m.content)
                    .join('\n');
            } catch (_) {}
            
            try {
                const session = getCurrentSession();
                copilotScanText = session.messages
                    .filter(m => !m.isLBHistory)
                    .slice(-6)
                    .map(m => m.content)
                    .join('\n');
            } catch (_) {}

            const activeNames = getActiveLorebookNames();
            await Promise.all(activeNames.map(async name => {
                if (!loadedBooks[name]) {
                    const data = await fetchWorldInfoBook(name);
                    if (data) loadedBooks[name] = data;
                }
            }));
            keywordEntries = getKeywordTriggeredEntries(loadedBooks, lastUser + '\n' + lastChar, copilotScanText);
        }

        const toInject = {};
        for (const[bookName, data] of Object.entries(loadedBooks)) {
            for (const entry of wiEntriesToArray(data)) {
                if (!entry.content) continue;
                const overKey = `${bookName}_${entry.uid}`;
                const override = overrides[overKey];
                
                if (override === false) continue;
                
                const isConstant = !!entry.constant && !entry.disable;
                const manualInclude = selectedBooks.includes(bookName);
                const keywordInclude = keywordEntries[bookName]?.some(e => e.uid === entry.uid);
                
                if (override === true || isConstant || manualInclude || keywordInclude) {
                    if (!toInject[bookName]) toInject[bookName] = [];
                    toInject[bookName].push(entry);
                }
            }
        }

        if (!Object.keys(toInject).length) return '';

        let block = '\n\n<lorebook_context>\n';
        for (const[bookName, entries] of Object.entries(toInject)) {
            block += `## ${getDisplayName(bookName)}\n`;
            for (const e of entries) {
                block += `### ${e.comment || `Entry #${e.uid}`} (uid: ${e.uid})`;
                if (e.key?.length) block += ` [keys: ${e.key.slice(0, 5).join(', ')}]`;
                block += `\n${e.content}\n\n`;
                _lastActiveEntries.push({
                    bookName,
                    displayName: getDisplayName(bookName),
                    entryName: e.comment || `#${e.uid}`,
                    uid: e.uid,
                });
            }
        }
        block += '</lorebook_context>';
        return block;
    }

    function buildLBAIInstructions(settings) {
        if (!settings.lorebookAIManageEnabled) return '';
        
        const activeBooks =[...new Set(_lastActiveEntries.map(e => e.displayName || e.bookName))];
        const activeBooksStr = activeBooks.length > 0 ? activeBooks.map(b => `"${b}"`).join(', ') : 'None';
        
        let rawPrompt = settings.lorebookManagePrompt || DEFAULT_LB_MANAGE_PROMPT;
        
        if (!rawPrompt.includes('{{active_lorebooks}}')) {
            if (rawPrompt.includes('Format requirment:')) {
                rawPrompt = rawPrompt.replace('Format requirment:', `Active lorebooks: {{active_lorebooks}}\n\nFormat requirment:`);
            } else {
                rawPrompt = `Active lorebooks: {{active_lorebooks}}\n\n` + rawPrompt;
            }
        }

        const prompt = rawPrompt
            .replace('{{active_lorebooks}}', activeBooksStr)
            .replace('{{lorebook_output}}', LB_FORMAT_BLOCK);
            
        return `\n\n<lorebook_management>\n${prompt}\n</lorebook_management>`;
    }

    function parseLBChangesFromText(text) {
        const match = text.match(/```lorebook-changes\s*([\s\S]*?)```/);
        if (!match) return null;
        try {
            const data = JSON.parse(match[1].trim());
            return Array.isArray(data.changes) ? data.changes : null;
        } catch (_) { return null; }
    }

    function stripLBChangesBlock(text) {
        return text.replace(/```lorebook-changes[\s\S]*?```/g, '').trim();
    }

    async function resolveLBChangeTarget(change) {
        let bookName = change.worldName || '';
        let targetUid = change.uid;

        const fuzzyWorld = bookName.toLowerCase();
        const fuzzyName = (change.originalName || change.name || '').toLowerCase();
        
        if (fuzzyName) {
            const activeMatch = _lastActiveEntries.find(le => {
                const wMatch = !fuzzyWorld || le.displayName.toLowerCase() === fuzzyWorld || le.bookName.toLowerCase() === fuzzyWorld;
                const nMatch = le.entryName.toLowerCase() === fuzzyName || le.entryName.toLowerCase().includes(fuzzyName) || fuzzyName.includes(le.entryName.toLowerCase());
                return wMatch && nMatch;
            });
            if (activeMatch) {
                if (targetUid == null) targetUid = activeMatch.uid;
                bookName = activeMatch.bookName;
            }
        }

        if (bookName === getDisplayName(EMBEDDED_BOOK_KEY)) bookName = EMBEDDED_BOOK_KEY;

        let data = await fetchWorldInfoBook(bookName);
        if (!data && bookName) {
            const allActive = getActiveLorebookNames();
            const match = allActive.find(n => n.toLowerCase() === fuzzyWorld || n.toLowerCase().includes(fuzzyWorld) || fuzzyWorld.includes(n.toLowerCase()));
            if (match) {
                bookName = match;
                data = await fetchWorldInfoBook(bookName);
            }
        }

        let origEntry = null;
        if (data && data.entries) {
            origEntry = Object.values(data.entries).find(en => {
                if (targetUid != null && String(en.uid) === String(targetUid)) return true;
                const cStr = (en.comment || `Entry #${en.uid}`).trim().toLowerCase();
                return (fuzzyName && cStr === fuzzyName) || (fuzzyName && cStr.includes(fuzzyName)) || (fuzzyName && fuzzyName.includes(cStr));
            });
        }

        if (!origEntry && fuzzyName) {
            for (const name of getActiveLorebookNames()) {
                if (name === bookName) continue;
                const bd = await fetchWorldInfoBook(name);
                if (!bd) continue;
                origEntry = Object.values(bd.entries).find(en => {
                    const c = (en.comment || `Entry #${en.uid}`).trim().toLowerCase();
                    return c === fuzzyName || c.includes(fuzzyName) || fuzzyName.includes(c);
                });
                if (origEntry) { bookName = name; data = bd; break; }
            }
        }

        if (!data) {
            console.warn(`[${EXT_DISPLAY}] resolveLBChangeTarget: no book data found`, {
                change, resolvedBookName: bookName, activeBooks: getActiveLorebookNames(), cacheKeys: Object.keys(_wiCache)
            });
        } else if (!origEntry && change.action !== 'add') {
            console.warn(`[${EXT_DISPLAY}] resolveLBChangeTarget: entry not found`, {
                fuzzyName, fuzzyWorld, targetUid,
                entries: Object.values(data.entries || {}).map(e => ({ uid: e.uid, comment: e.comment, key: e.key?.slice(0, 3) }))
            });
        }
        return { bookName, data, origEntry };
    }

    function logLBHistoryChanges(changes, statusStr, afterMsgId = null) {
        if (!changes || !changes.length) return;
        try {
            const session = getCurrentSession();
            const icons = { add: '✚', edit: '✎', delete: '✕' };
            const statusIcon = statusStr === 'Accepted' ? '✓' : (statusStr === 'Rejected' ? '✕' : '·');

            const actionText = statusStr === 'Accepted' ? 'ACCEPTED' :
                               (statusStr === 'Rejected' ? 'REJECTED' : 'DISMISSED (ignored)');

            const newLines = changes.map(c => {
                const act = (c.action || 'edit').toUpperCase();
                return `${statusIcon} **${actionText}**: ${icons[c.action] || '·'} ${act} "${escHtml(c.name || `Entry #${c.uid || '?'}`)}" in \`${escHtml(c.worldName || '?')}\``;
            });

            const lastMsg = session.messages[session.messages.length - 1];
            if (lastMsg && lastMsg.isLBHistory) {
                if (!lastMsg.appliedLines) lastMsg.appliedLines =[];
                lastMsg.appliedLines.push(...newLines);
                lastMsg.content = `**System Notification** — User interaction with proposed lorebook changes:\n${lastMsg.appliedLines.join('\n')}`;
                
                if (lastMsg.role !== 'system') lastMsg.role = 'system';
                
                updateMessage(session, lastMsg.id, lastMsg.content);

                const msgEl = document.querySelector(`.scp-msg[data-id="${lastMsg.id}"] .scp-msg-content`);
                if (msgEl) msgEl.innerHTML = renderMarkdown(lastMsg.content);
            } else {
                const histText = `**System Notification** — User interaction with proposed lorebook changes:\n${newLines.join('\n')}`;
                
                const histMsg = afterMsgId
                    ? insertMessageAfter(session, afterMsgId, 'system', histText, { isLBHistory: true, appliedLines: [...newLines] })
                    : addMessage(session, 'system', histText, { isLBHistory: true, appliedLines: [...newLines] });
                appendLBHistoryEl(histMsg, afterMsgId);
            }
        } catch (_) {}
    }

    async function applyLBChanges(changes, afterMsgId = null) {
        console.log(`[${EXT_DISPLAY}] applyLBChanges: processing ${changes.length} change(s)`, JSON.parse(JSON.stringify(changes)));
        const bookCache = {};
        const successfulChanges =[];

        for (const change of changes) {
            const { bookName, data, origEntry } = await resolveLBChangeTarget(change);
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

            if (change.action === 'add') {
                const uids = Object.keys(data.entries).map(Number);
                const newUid = uids.length ? Math.max(...uids) + 1 : 1;
                data.entries[newUid] = {
                    uid: newUid, key: change.triggers || [], keysecondary:[],
                    content: change.content || '', comment: change.name || '',
                    disable: false, group: '', selective: false, constant: false,
                    position: 0, depth: 4, displayIndex: newUid,
                    prevent_recursion: false, delayUntilRecursion: false,
                    scan_depth: null, match_whole_words: null, use_group_scoring: false,
                    case_sensitive: null, automation_id: '', role: null,
                    vectorized: false, sticky: null, cooldown: null, delay: null,
                };
                console.log(`[${EXT_DISPLAY}] applyLBChanges: ADD uid=${newUid} in "${bookName}"`);
                bookCache[bookName] = data;
                successfulChanges.push(change);
            } else if (change.action === 'edit') {
                if (!origEntry) {
                    const msg = `Entry not found for edit: "${change.name || change.uid || '?'}" in "${bookName}"`;
                    toastr.error(`[LB] ${msg}`, EXT_DISPLAY, { timeOut: 10000 });
                    console.error(`[${EXT_DISPLAY}] applyLBChanges: ${msg}. Available:`, Object.values(data.entries || {}).map(e => ({ uid: e.uid, comment: e.comment })));
                    continue;
                }
                if (change.name !== undefined) origEntry.comment = change.name;
                if (change.triggers !== undefined) origEntry.key = change.triggers;
                if (change.content !== undefined) origEntry.content = change.content;
                console.log(`[${EXT_DISPLAY}] applyLBChanges: EDIT uid=${origEntry.uid} in "${bookName}"`);
                bookCache[bookName] = data;
                successfulChanges.push(change);
            } else if (change.action === 'delete') {
                if (!origEntry) {
                    toastr.warning(`[LB] Entry not found for delete: "${change.name || change.uid || '?'}" in "${bookName}"`, EXT_DISPLAY, { timeOut: 8000 });
                    continue;
                }
                delete data.entries[origEntry.uid];
                console.log(`[${EXT_DISPLAY}] applyLBChanges: DELETE uid=${origEntry.uid} in "${bookName}"`);
                bookCache[bookName] = data;
                successfulChanges.push(change);
            } else {
                toastr.warning(`[LB] Unknown action: "${change.action}"`, EXT_DISPLAY, { timeOut: 6000 });
            }
        }

        if (changes.length > 0 && !Object.keys(bookCache).length) {
            toastr.warning('[LB] No changes were applied — see browser console (F12) for details', EXT_DISPLAY, { timeOut: 10000 });
            return;
        }

        for (const [name, data] of Object.entries(bookCache)) {
            try {
                await saveWorldInfoBook(name, data);
                console.log(`[${EXT_DISPLAY}] applyLBChanges: saved "${name}" OK`);
            } catch (e) {
                toastr.error(`[LB] Save failed for "${name}": ${e.message}`, EXT_DISPLAY, { timeOut: 12000 });
                console.error(`[${EXT_DISPLAY}] applyLBChanges: save error for "${name}":`, e);
            }
        }

        if (successfulChanges.length > 0) {
            recordStat(_SM.lb, successfulChanges.length);
            logLBHistoryChanges(successfulChanges, 'Accepted', afterMsgId);
        }
    }

    // ─── Diff Engine ─────────────────────────────────────────────────────────────

    function computeLCS(a, b) {
        const m = a.length, n = b.length;
        if (m === 0 || n === 0) return[];
        const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
        for (let i = 1; i <= m; i++)
            for (let j = 1; j <= n; j++)
                dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);
        const result =[];
        let i = m, j = n;
        while (i > 0 && j > 0) {
            if (a[i-1] === b[j-1]) { result.unshift([i-1, j-1]); i--; j--; }
            else if (dp[i-1][j] > dp[i][j-1]) i--;
            else j--;
        }
        return result;
    }

    function computeLineDiff(original, modified) {
        const a = original ? original.replace(/\r\n/g, '\n').split('\n') : [];
        const b = modified ? modified.replace(/\r\n/g, '\n').split('\n') : [];
        const lcs = computeLCS(a, b);
        const result =[];
        let ai = 0, bi = 0, li = 0;
        while (ai < a.length || bi < b.length) {
            if (li < lcs.length) {
                while (ai < lcs[li][0]) result.push({ type: 'removed', text: a[ai++] });
                while (bi < lcs[li][1]) result.push({ type: 'added', text: b[bi++] });
                result.push({ type: 'unchanged', text: a[ai++] });
                bi++; li++;
            } else {
                while (ai < a.length) result.push({ type: 'removed', text: a[ai++] });
                while (bi < b.length) result.push({ type: 'added', text: b[bi++] });
            }
        }
        return result;
    }

    function highlightInlineDiff(oldLine, newLine) {
        const tokenize = s => s.match(/[\w]+|[^\w\s]+|\s+/g) || [];
        const a = tokenize(oldLine);
        const b = tokenize(newLine);
        const lcs = computeLCS(a, b);
        let ai = 0, bi = 0, li = 0;
        let oldHtml = '', newHtml = '';
        
        const wrapSegment = (text, type) => {
            if (!text) return '';
            return `<span class="scp-diff-word-${type}">${escHtml(text)}</span>`;
        };

        while (ai < a.length || bi < b.length) {
            if (li < lcs.length) {
                let r = '', ad = '';
                while (ai < lcs[li][0]) r += a[ai++];
                while (bi < lcs[li][1]) ad += b[bi++];
                
                oldHtml += wrapSegment(r, 'rem');
                newHtml += wrapSegment(ad, 'add');
                
                const match = escHtml(a[ai]);
                oldHtml += match; newHtml += match;
                ai++; bi++; li++;
            } else {
                let r = '', ad = '';
                while (ai < a.length) r += a[ai++];
                while (bi < b.length) ad += b[bi++];
                
                oldHtml += wrapSegment(r, 'rem');
                newHtml += wrapSegment(ad, 'add');
            }
        }
        return { oldHtml, newHtml };
    }

    function processDiffLinesForInline(diffLines) {
        const result =[];
        let i = 0;
        while (i < diffLines.length) {
            if (diffLines[i].type === 'removed') {
                let remStart = i;
                while (i < diffLines.length && diffLines[i].type === 'removed') i++;
                let remEnd = i;
                
                let addStart = i;
                while (i < diffLines.length && diffLines[i].type === 'added') i++;
                let addEnd = i;
                
                const remLines = diffLines.slice(remStart, remEnd);
                const addLines = diffLines.slice(addStart, addEnd);
                
                let maxLen = Math.max(remLines.length, addLines.length);
                for (let j = 0; j < maxLen; j++) {
                    if (j < remLines.length && j < addLines.length) {
                        const { oldHtml, newHtml } = highlightInlineDiff(remLines[j].text, addLines[j].text);
                        result.push({ type: 'removed', html: oldHtml });
                        result.push({ type: 'added', html: newHtml });
                    } else if (j < remLines.length) {
                        result.push({ type: 'removed', html: escHtml(remLines[j].text) });
                    } else {
                        result.push({ type: 'added', html: escHtml(addLines[j].text) });
                    }
                }
            } else if (diffLines[i].type === 'added') {
                result.push({ type: 'added', html: escHtml(diffLines[i].text) });
                i++;
            } else {
                result.push({ type: 'unchanged', html: escHtml(diffLines[i].text) });
                i++;
            }
        }
        return result;
    }


    function renderDiffUnified(diffLines) {
        if (!diffLines.length) return '<div style="padding:20px;color:var(--scp-text-muted);text-align:center">No changes to display</div>';
        const processed = processDiffLinesForInline(diffLines);
        return `<div class="scp-diff-unified">${processed.map(l => {
            const cls = l.type === 'added' ? 'scp-diff-add' : l.type === 'removed' ? 'scp-diff-rem' : 'scp-diff-ctx';
            const pfx = l.type === 'added' ? '+' : l.type === 'removed' ? '-' : ' ';
            return `<div class="${cls}"><span class="scp-diff-pfx">${pfx}</span>${l.html}</div>`;
        }).join('')}</div>`;
    }

    function renderDiffSplit(original, modified) {
        const a = original ? original.replace(/\r\n/g, '\n').split('\n') : [];
        const b = modified ? modified.replace(/\r\n/g, '\n').split('\n') : [];
        const lcs = computeLCS(a, b);
        const rows =[];
        let ai = 0, bi = 0, li = 0;
        
        const processMismatch = (startA, endA, startB, endB) => {
            const remLines = [], addLines =[];
            let currAi = startA, currBi = startB;
            while (currAi < endA) remLines.push(a[currAi++]);
            while (currBi < endB) addLines.push(b[currBi++]);
            
            const maxLen = Math.max(remLines.length, addLines.length);
            for (let j = 0; j < maxLen; j++) {
                let htmlA = '', htmlB = '', clsA = '', clsB = '';
                if (j < remLines.length && j < addLines.length) {
                    const { oldHtml, newHtml } = highlightInlineDiff(remLines[j], addLines[j]);
                    htmlA = oldHtml; htmlB = newHtml;
                    clsA = 'scp-diff-rem'; clsB = 'scp-diff-add';
                } else if (j < remLines.length) {
                    htmlA = escHtml(remLines[j]); clsA = 'scp-diff-rem';
                } else if (j < addLines.length) {
                    htmlB = escHtml(addLines[j]); clsB = 'scp-diff-add';
                }
                rows.push(`<tr><td class="${clsA}">${htmlA}</td><td class="${clsB}">${htmlB}</td></tr>`);
            }
        };

        while (ai < a.length || bi < b.length) {
            if (li < lcs.length) {
                processMismatch(ai, lcs[li][0], bi, lcs[li][1]);
                ai = lcs[li][0]; bi = lcs[li][1];
                rows.push(`<tr class="scp-diff-ctx"><td>${escHtml(a[ai++])}</td><td>${escHtml(b[bi++])}</td></tr>`);
                li++;
            } else {
                processMismatch(ai, a.length, bi, b.length);
                ai = a.length; bi = b.length;
            }
        }
        return `<table class="scp-diff-split-table"><thead><tr><th>Original</th><th>Modified</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
    }

    function openDiffModal(change, originalEntry) {
        const modal = document.getElementById('scp-diff-modal');
        if (!modal) return;
        const originalContent = originalEntry?.content || '';
        const newContent = change.content || '';
        const diffLines = computeLineDiff(originalContent, newContent);

        const entryName = change.name || originalEntry?.comment || `Entry #${change.uid || '?'}`;
        const titleEl = modal.querySelector('.scp-diff-modal-title');
        if (titleEl) titleEl.textContent = `Diff: "${entryName}" in ${change.worldName || '?'}`;

        const body = document.getElementById('scp-diff-body');
        
        if (body) body.innerHTML = renderDiffSplit(originalContent, newContent);

        modal.querySelectorAll('[data-diff-tab]').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.diffTab === 'split');
            tab.onclick = () => {
                modal.querySelectorAll('[data-diff-tab]').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                if (body) body.innerHTML = tab.dataset.diffTab === 'split'
                    ? renderDiffSplit(originalContent, newContent)
                    : renderDiffUnified(diffLines);
            };
        });
        modal.style.display = 'flex';
    }

    function appendLBHistoryEl(msg, afterMsgId = null) {
        const c = document.getElementById('scp-messages');
        if (!c) return;
        c.querySelector('.scp-empty-state')?.remove();

        const wrap = document.createElement('div');
        wrap.className = 'scp-msg scp-msg-lb-history';
        wrap.dataset.id = msg.id;

        const avatar = document.createElement('div');
        avatar.className = 'scp-msg-avatar scp-msg-avatar-lb';
        avatar.innerHTML = I.book;

        const body = document.createElement('div');
        body.className = 'scp-msg-body';

        const content = document.createElement('div');
        content.className = 'scp-msg-content scp-lb-history-content';
        content.innerHTML = renderMarkdown(msg.content);

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

        body.appendChild(content);
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

    // ─── Lorebook Manager UI ─────────────────────────────────────────────────────

    let _lbActiveBook = null;
    let _lbSearchQuery = '';
    let _lbEntryDetailEntry = null;
    let _lbEntryDetailBook = null;
    
    function renderProposalCard(changes, msgEl) {
        if (!changes?.length) return;
        document.querySelector(`.scp-lb-proposal-card[data-for="${msgEl.dataset.id}"]`)?.remove();

        const editableChanges = changes.map(c => ({ ...c }));
        const _initSess = getCurrentSession();
        const _initMsg = _initSess.messages.find(m => m.id === msgEl.dataset.id);
        const _savedStates = _initMsg?.lbChangesState || {};
        const itemStates = editableChanges.map((_, i) => _savedStates[i] || 'pending');
        const actionLabels = { add: '+ Add', edit: '✎ Edit', delete: '✕ Remove' };

        const card = document.createElement('div');
        card.className = 'scp-lb-proposal-card';
        card.dataset.for = msgEl.dataset.id;

        const stripAndSave = () => {
            const session = getCurrentSession();
            const msg = session.messages.find(m => m.id === card.dataset.for);
            if (msg) { msg.content = stripLBChangesBlock(msg.content); saveSettings(); }
        };

        const persistState = () => {
            const sess = getCurrentSession();
            const msg = sess.messages.find(m => m.id === card.dataset.for);
            if (msg) {
                msg.lbChangesState = Object.fromEntries(
                    itemStates.map((s, i) => [i, s]).filter(([, s]) => s !== 'pending')
                );
                saveSettings();
            }
        };

        const getPendingCount = () => itemStates.filter(s => s === 'pending').length;
        const getAppliedCount = () => itemStates.filter(s => s === 'applied').length;

        const checkAllResolved = () => {
            if (getPendingCount() > 0) return;
            stripAndSave();
            card.remove(); 
        };

        // ── Header ──
        const header = document.createElement('div');
        header.className = 'scp-lb-proposal-header';

        const headerLeft = document.createElement('div');
        headerLeft.style.cssText = 'display:flex;align-items:center;gap:8px;flex:1;min-width:0';
        headerLeft.innerHTML = `<span class="scp-lb-proposal-icon">${I.book}</span>
            <span class="scp-lb-proposal-title">Proposed Lorebook Changes</span>`;

        const countBadge = document.createElement('span');
        countBadge.className = 'scp-lb-proposal-count';
        countBadge.textContent = `${editableChanges.length} pending`;
        headerLeft.appendChild(countBadge);

        const dismissBtn = document.createElement('button');
        dismissBtn.className = 'scp-lb-proposal-dismiss';
        dismissBtn.innerHTML = I.x; dismissBtn.title = 'Dismiss';
        dismissBtn.addEventListener('click', () => {
            const dismissedChanges = editableChanges.filter((_, i) => itemStates[i] === 'pending');
            if (dismissedChanges.length > 0) {
                logLBHistoryChanges(dismissedChanges, 'Dismissed', card.dataset.for);
            }
            stripAndSave(); card.remove();
        });

        header.appendChild(headerLeft); header.appendChild(dismissBtn);

        // ── Item list ──
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
            itemMeta.innerHTML = `
                <span class="scp-lb-proposal-action">${escHtml(actionLabels[c.action] || c.action || '?')}</span>
                <span class="scp-lb-proposal-name">${escHtml(c.name || c.originalName || `Entry #${c.uid || '?'}`)}</span>`;

            // ── Inline lorebook dropdown (replaces static "in BookName" span) ──
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

            // Track current value separately for "new" lorebook entries
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

                    const dot = document.createElement('span');
                    dot.className = 'scp-lb-proposal-world-item-dot';
                    const label = document.createElement('span');
                    label.textContent = getDisplayName(name);

                    item2.appendChild(dot);
                    item2.appendChild(label);
                    item2.addEventListener('click', () => selectBook(name));
                    worldPanel.appendChild(item2);
                });

                if (c.action === 'add') {
                    const sep = document.createElement('div');
                    sep.className = 'scp-lb-proposal-world-sep';
                    worldPanel.appendChild(sep);

                    const newItem = document.createElement('div');
                    newItem.className = 'scp-lb-proposal-world-item scp-lb-proposal-world-new';
                    newItem.innerHTML = `<span>${I.plus}</span><span>Create new lorebook…</span>`;
                    newItem.addEventListener('click', async () => {
                        closeWorldPanel();
                        const name = await showCustomDialog({ type: 'prompt', title: 'New Lorebook Name', message: 'Enter name for the new lorebook:', placeholder: 'My Lorebook' });
                        if (name?.trim()) {
                            const n = name.trim();
                            _activeBooks.push(n);
                            buildWorldPanelItems(_activeBooks);
                            selectBook(n);
                        }
                    });
                    worldPanel.appendChild(newItem);
                }
            };

            const closeWorldPanel = () => {
                worldPanel.classList.remove('open');
                worldTrigger.classList.remove('open');
            };

            const openWorldPanel = () => {
                // Position panel relative to trigger using fixed coords
                const rect = worldTrigger.getBoundingClientRect();
                worldPanel.style.top = `${rect.bottom + 4}px`;
                worldPanel.style.left = `${rect.left}px`;
                worldPanel.classList.add('open');
                worldTrigger.classList.add('open');
            };

            const _validateBookEntry = async (bookName) => {
                worldTrigger.classList.add('loading');
                // Use the exact same resolution as applyLBChanges to guarantee consistency
                const resolved = await resolveLBChangeTarget({ ...editableChanges[ci], worldName: bookName });
                worldTrigger.classList.remove('loading');

                const found = !!resolved.origEntry;

                // Fallback may have resolved the entry in a different book — sync the UI
                if (found && resolved.bookName && resolved.bookName !== bookName) {
                    editableChanges[ci].worldName = resolved.bookName;
                    _selectedBook = resolved.bookName;
                    worldPanel.querySelectorAll('.scp-lb-proposal-world-item').forEach(el => {
                        el.classList.toggle('active', el.dataset.value === resolved.bookName);
                    });
                    worldTriggerText.textContent = `in ${getDisplayName(resolved.bookName)}`;
                    toastr.info(
                        `Entry found in "<b>${escHtml(getDisplayName(resolved.bookName))}</b>" instead of "<b>${escHtml(getDisplayName(bookName))}</b>" — lorebook switched automatically.`,
                        EXT_DISPLAY,
                        { timeOut: 6000, escapeHtml: false }
                    );
                } else {
                    worldTriggerText.textContent = found
                        ? `in ${getDisplayName(bookName)}`
                        : `in ${getDisplayName(bookName)} ⚠`;
                }

                worldTrigger.classList.toggle('warn', !found);
                applyItemBtn.disabled = !found;
                applyItemBtn.title = found ? 'Apply this change' : 'Entry not found in selected lorebook';
            };

            const selectBook = async (name) => {
                _selectedBook = name;
                editableChanges[ci].worldName = name;
                worldTriggerText.textContent = `in ${getDisplayName(name)}`;
                worldTrigger.classList.remove('warn');
                // Update active state in panel
                worldPanel.querySelectorAll('.scp-lb-proposal-world-item').forEach(el => {
                    el.classList.toggle('active', el.dataset.value === name);
                });
                closeWorldPanel();
                if (c.action === 'edit' || c.action === 'delete') await _validateBookEntry(name);
            };

            worldTrigger.addEventListener('click', e => {
                e.stopPropagation();
                const isOpen = worldPanel.classList.contains('open');
                // Close all other world panels
                document.querySelectorAll('.scp-lb-proposal-world-panel.open').forEach(p => {
                    p.classList.remove('open');
                    p.previousElementSibling?.classList.remove('open');
                });
                if (!isOpen) openWorldPanel();
            });

            // If AI-proposed book isn't active, add it to the list
            const _allBooks = [..._activeBooks];
            if (_currentBook && !_activeBooks.includes(_currentBook)) _allBooks.unshift(_currentBook);

            buildWorldPanelItems(_allBooks);

            worldDd.appendChild(worldTrigger);
            worldDd.appendChild(worldPanel);
            // worldDd is appended after itemHeader — see below

            const itemBtns = document.createElement('div');
            itemBtns.className = 'scp-lb-proposal-item-btns';

            // Edit toggle
            let editToggleBtn = null;
            if (c.action !== 'delete') {
                editToggleBtn = document.createElement('button');
                editToggleBtn.className = 'scp-lb-proposal-edit-toggle';
                editToggleBtn.title = 'Edit before applying'; editToggleBtn.textContent = '✎';
                itemBtns.appendChild(editToggleBtn);
            }

            // Diff btn
            if (c.action === 'edit' && c.content) {
                const diffBtn = document.createElement('button');
                diffBtn.className = 'scp-lb-proposal-diff-btn';
                diffBtn.title = 'View diff'; diffBtn.textContent = '⬚';
                diffBtn.addEventListener('click', async e => {
                    e.stopPropagation();
                    const change = editableChanges[ci];
                    const { origEntry, bookName } = await resolveLBChangeTarget(change);

                    if (!origEntry) {
                        console.warn(`[${EXT_DISPLAY}] Diff: Original entry not found for "${change.name}" in "${change.worldName}"`);
                        toastr.warning('Could not find original entry to compare against.', EXT_DISPLAY);
                    }

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

            // Per-item Apply btn
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
                    itemStates[ci] = 'applied';
                    item.classList.add('scp-lb-item-applied');
                    itemBtns.querySelectorAll('button').forEach(b => { b.disabled = true; });
                    _wiCache = {};
                    persistState();
                    updateCountBadge();
                    updateFooterBtns();
                    checkAllResolved();
                } catch (err) {
                    toastr.error(`Failed: ${err.message}`, EXT_DISPLAY);
                    applyItemBtn.disabled = false; applyItemBtn.textContent = '✓';
                }
            });

            // Per-item Reject btn
            const rejectItemBtn = document.createElement('button');
            rejectItemBtn.className = 'scp-lb-proposal-item-reject';
            rejectItemBtn.title = 'Reject this change'; rejectItemBtn.textContent = '✕';
            rejectItemBtn.addEventListener('click', e => {
                e.stopPropagation();
                if (itemStates[ci] !== 'pending') return;
                closeEditPanel();
                itemStates[ci] = 'rejected';
                item.classList.add('scp-lb-item-rejected');
                itemBtns.querySelectorAll('button').forEach(b => { b.disabled = true; });

                logLBHistoryChanges([editableChanges[ci]], 'Rejected', card.dataset.for);

                persistState();
                updateCountBadge();
                updateFooterBtns();
                checkAllResolved();
            });

            itemBtns.appendChild(applyItemBtn);
            itemBtns.appendChild(rejectItemBtn);
            itemHeader.appendChild(itemMeta);
            itemHeader.appendChild(itemBtns);
            item.appendChild(itemHeader);
            item.appendChild(worldDd);

            // Preview / triggers
            let previewEl = null, triggersEl = null;
            if (c.content) {
                previewEl = document.createElement('div');
                previewEl.className = 'scp-lb-proposal-preview';
                const isLong = c.content.length > 120;
                previewEl.textContent = isLong ? c.content.slice(0, 120) + '…' : c.content;
                if (isLong) {
                    let _expanded = false;
                    previewEl.title = 'Click to expand';
                    previewEl.style.cursor = 'pointer';
                    previewEl.addEventListener('click', e => {
                        e.stopPropagation();
                        if (window.getSelection()?.toString()) return;
                        _expanded = !_expanded;
                        previewEl.textContent = _expanded ? c.content : c.content.slice(0, 120) + '…';
                        previewEl.style.whiteSpace = _expanded ? 'pre-wrap' : '';
                        previewEl.style.fontStyle = _expanded ? 'normal' : '';
                        previewEl.title = _expanded ? 'Click to collapse' : 'Click to expand';
                    });
                }
                item.appendChild(previewEl);
            }
            if (c.triggers?.length) {
                triggersEl = document.createElement('div');
                triggersEl.className = 'scp-lb-proposal-triggers';
                triggersEl.textContent = 'Keys: ' + c.triggers.join(', ');
                item.appendChild(triggersEl);
            }

            // Inline edit panel
            if (c.action !== 'delete') {
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

                const nameInput = document.createElement('input');
                nameInput.type = 'text'; nameInput.className = 'scp-lb-pe-input';
                nameInput.value = c.name || '';
                nameInput.addEventListener('input', () => { editableChanges[ci].name = nameInput.value; });
                editPanel.appendChild(mkRow('Name', nameInput));

                const trigInput = document.createElement('input');
                trigInput.type = 'text'; trigInput.className = 'scp-lb-pe-input';
                trigInput.value = (c.triggers || []).join(', ');
                trigInput.addEventListener('input', () => {
                    editableChanges[ci].triggers = trigInput.value.split(',').map(t => t.trim()).filter(Boolean);
                });
                editPanel.appendChild(mkRow('Keys <span style="opacity:.6;text-transform:none;letter-spacing:0">(comma-separated)</span>', trigInput));

                const contentTa = document.createElement('textarea');
                contentTa.className = 'scp-lb-pe-textarea';
                contentTa.value = c.content || '';
                contentTa.addEventListener('input', () => { editableChanges[ci].content = contentTa.value; });
                editPanel.appendChild(mkRow('Content', contentTa));

                item.appendChild(editPanel);

                if (editToggleBtn) {
                    editToggleBtn.addEventListener('click', e => {
                        e.stopPropagation();
                        const isOpen = editPanel.style.display !== 'none';
                        editPanel.style.display = isOpen ? 'none' : 'flex';
                        if (previewEl) previewEl.style.display = isOpen ? '' : 'none';
                        if (triggersEl) triggersEl.style.display = isOpen ? '' : 'none';
                        editToggleBtn.classList.toggle('active', !isOpen);
                    });
                }
            }

            list.appendChild(item);
            itemEls.push(item);

            // Run initial validation immediately for edit/delete so Apply is never incorrectly enabled
            if ((c.action === 'edit' || c.action === 'delete') && itemStates[ci] === 'pending') {
                _validateBookEntry(_selectedBook).catch(() => {});
            }
        });

        // Restore persisted visual states
        itemEls.forEach((el, i) => {
            if (itemStates[i] === 'applied') {
                el.classList.add('scp-lb-item-applied');
                el.querySelectorAll('button').forEach(b => { b.disabled = true; });
            } else if (itemStates[i] === 'rejected') {
                el.classList.add('scp-lb-item-rejected');
                el.querySelectorAll('button').forEach(b => { b.disabled = true; });
            }
        });

        // ── Footer ──
        const footer = document.createElement('div');
        footer.className = 'scp-lb-proposal-footer';

        const applyAllBtn = document.createElement('button');
        applyAllBtn.className = 'scp-lb-proposal-apply'; applyAllBtn.textContent = 'Apply All';

        const rejectAllBtn = document.createElement('button');
        rejectAllBtn.className = 'scp-lb-proposal-reject'; rejectAllBtn.textContent = 'Reject All';

        const updateCountBadge = () => {
            const p = getPendingCount();
            countBadge.textContent = p > 0 ? `${p} pending` : `${getAppliedCount()} applied`;
        };

        const updateFooterBtns = () => {
            const p = getPendingCount();
            applyAllBtn.style.display = p > 0 ? '' : 'none';
            rejectAllBtn.style.display = p > 0 ? '' : 'none';
        };

        applyAllBtn.addEventListener('click', async () => {
            const pending = editableChanges.filter((_, i) => itemStates[i] === 'pending');
            if (!pending.length) return;
            applyAllBtn.disabled = true; applyAllBtn.textContent = 'Applying…';
            try {
                await applyLBChanges(pending, card.dataset.for);
                itemStates.forEach((s, i) => { if (s === 'pending') { itemStates[i] = 'applied'; itemEls[i].classList.add('scp-lb-item-applied'); itemEls[i].querySelectorAll('button').forEach(b => { b.disabled = true; }); } });
                _wiCache = {};
                persistState();
                updateCountBadge(); updateFooterBtns(); checkAllResolved();
            } catch (e) {
                toastr.error(`Failed: ${e.message}`, EXT_DISPLAY);
                applyAllBtn.disabled = false; applyAllBtn.textContent = 'Apply All';
            }
        });

        rejectAllBtn.addEventListener('click', () => {
            const rejectedChanges =[];
            itemStates.forEach((s, i) => {
                if (s === 'pending') {
                    itemStates[i] = 'rejected';
                    itemEls[i].classList.add('scp-lb-item-rejected');
                    itemEls[i].querySelectorAll('button').forEach(b => { b.disabled = true; });
                    rejectedChanges.push(editableChanges[i]);
                }
            });
            if (rejectedChanges.length > 0) {
                logLBHistoryChanges(rejectedChanges, 'Rejected', card.dataset.for);
            }
            persistState();
            updateCountBadge(); updateFooterBtns(); checkAllResolved();
        });

        footer.appendChild(applyAllBtn); footer.appendChild(rejectAllBtn);
        card.appendChild(header); card.appendChild(list); card.appendChild(footer);
        msgEl.after(card);
    }

    async function openLorebookManager() {
        const overlay = document.getElementById('scp-lb-overlay');
        if (!overlay) return;
        applyCustomTheme(getSettings().customTheme || THEME_PRESETS.default);
        overlay.style.display = 'flex';
        const s = getSettings();
        document.getElementById('scp-lb-auto-kw-toggle')?.classList.toggle('active', !!s.lorebookAutoKeyword);
        document.getElementById('scp-lb-ai-toggle')?.classList.toggle('active', !!s.lorebookAIManageEnabled);
        if (document.getElementById('scp-lb-search')) document.getElementById('scp-lb-search').value = _lbSearchQuery;
        _wiCache = {};
        await buildLorebookContextBlock(s).catch(() => {});
        await refreshLorebookList().catch(e => console.error(`[${EXT_DISPLAY}] LB list:`, e));
        if (_lbActiveBook) await renderEntryList(_lbActiveBook, _lbSearchQuery).catch(() => {});
    }

    function closeLorebookManager() {
        document.getElementById('scp-lb-overlay').style.display = 'none';
    }

    async function refreshLorebookList() {
        const listEl = document.getElementById('scp-lb-book-list');
        if (!listEl) return;

        const ctx = SillyTavern.getContext();
        if (typeof ctx.updateWorldInfoList === 'function') {
            ctx.updateWorldInfoList().catch(() => {});
        }

        const activeNamesArray = getActiveLorebookNames();
        const s = getSettings();
        const selected = new Set(s.lorebookSelectedBooks || []);

        listEl.innerHTML = '';
        if (!activeNamesArray.length) {
            listEl.innerHTML = '<div class="scp-lb-loading">No active lorebooks found.<br><small style="opacity:.5">Link one to the character or select globally.</small></div>';
            return;
        }

        await Promise.all(activeNamesArray.map(name => fetchWorldInfoBook(name)));

        const frag = document.createDocumentFragment();
        for (const name of activeNamesArray) {
            const displayName = getDisplayName(name);
            const isSelected = selected.has(name);
            const isActive = true;
            
            const item = document.createElement('div');
            item.className = `scp-lb-book-item${isSelected ? ' selected' : ''}${_lbActiveBook === name ? ' lb-book-open' : ''}`;
            item.dataset.name = name;
            
            const cached = _wiCache[name];
            const entryCount = cached ? Object.keys(cached.entries || {}).length : '…';
            const isEmbedded = name === EMBEDDED_BOOK_KEY;
            const srcType = getBookSourceType(name);
            const srcLabel = { global: 'G', character: 'C', chat: 'Ch', embedded: '✦', manual: '' }[srcType] || '';
            const srcClass = `scp-lb-src-${srcType}`;
            
            item.innerHTML = `
                <div class="scp-lb-book-check${isSelected ? ' checked' : ''}" data-book="${escHtml(name)}" title="${isSelected ? 'Deselect from context' : 'Select for context injection'}"></div>
                <div class="scp-lb-book-info">
                    <span class="scp-lb-book-name">${escHtml(displayName)}${isEmbedded ? ' <span class="scp-lb-embedded-badge">embedded</span>' : ''}</span>
                    <span class="scp-lb-book-meta">${entryCount} entries${isActive ? ' · Active' : ''}</span>
                </div>
                ${srcLabel ? `<span class="scp-lb-src-badge ${srcClass}" title="Source: ${srcType}">${srcLabel}</span>` : ''}
                ${isActive ? '<span class="scp-lb-book-active-dot" title="Currently active in this chat"></span>' : ''}`;
                
            item.querySelector('.scp-lb-book-check').addEventListener('click', e => { e.stopPropagation(); toggleLorebookSelection(name); });
            item.addEventListener('click', () => viewLorebookEntries(name));
            frag.appendChild(item);
        }
        listEl.appendChild(frag);
        updateLBFooterInfo();
    }

    async function toggleLorebookSelection(name) {
        const s = getSettings();
        const idx = s.lorebookSelectedBooks.indexOf(name);
        const isAdding = idx < 0;
        if (isAdding) s.lorebookSelectedBooks.push(name);
        else s.lorebookSelectedBooks.splice(idx, 1);
        saveSettings();

        await buildLorebookContextBlock(s);

        const item = document.querySelector(`.scp-lb-book-item[data-name="${CSS.escape(name)}"]`);
        if (item) {
            const isSel = s.lorebookSelectedBooks.includes(name);
            item.classList.toggle('selected', isSel);
            item.querySelector('.scp-lb-book-check')?.classList.toggle('checked', isSel);
        }
        updateLBFooterInfo();
        updateMsgCount(getCurrentSession());
        if (_lbActiveBook) renderEntryList(_lbActiveBook, _lbSearchQuery);
    }

    async function viewLorebookEntries(name) {
        _lbActiveBook = name;
        document.querySelectorAll('.scp-lb-book-item').forEach(el => el.classList.toggle('lb-book-open', el.dataset.name === name));
        document.getElementById('scp-lb-main-actions').style.display = '';
        document.getElementById('scp-lb-ctx-legend').style.display = '';
        document.getElementById('scp-lb-entry-detail').style.display = 'none';
        document.getElementById('scp-lb-entries').style.display = '';
        await renderEntryList(name, _lbSearchQuery);
    }

    async function renderEntryList(bookName, search = '') {
        const container = document.getElementById('scp-lb-entries');
        if (!container) return;
        const data = await fetchWorldInfoBook(bookName);
        if (!data) { container.innerHTML = '<div class="scp-lb-empty-state">Failed to load lorebook</div>'; return; }

        const entries = wiEntriesToArray(data);
        const s = getSettings();
        const overrides = s.lorebookEntryOverrides || {};
        const isBookSelected = (s.lorebookSelectedBooks || []).includes(bookName);
        const activeEntryUids = new Set(
            _lastActiveEntries.filter(e => e.bookName === bookName).map(e => e.uid)
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
            const overKey = `${bookName}_${entry.uid}`;
            const override = overrides[overKey];
            const isDisabled = !!entry.disable;
            const isInCtx = activeEntryUids.has(entry.uid);
            const row = document.createElement('div');
            row.className = `scp-lb-entry-row${isDisabled ? ' lb-disabled' : ''}${isInCtx ? ' lb-in-ctx' : ''}`;
            row.dataset.uid = entry.uid;

            let indClass = '', indTitle = '', btnText = '~';
            if (override === true) { indClass = 'forced-on'; indTitle = 'Force included in Copilot context'; btnText = '✓'; }
            else if (override === false) { indClass = 'forced-off'; indTitle = 'Force excluded from Copilot context'; btnText = '✕'; }
            else if (entry.constant && !entry.disable) { indClass = 'forced-on'; indTitle = 'Constant entry (Always included)'; btnText = '✓'; }
            else if (isInCtx) { indClass = 'scp-lb-ind-in-ctx'; indTitle = 'Currently injected in last Copilot request'; }
            else { indTitle = isDisabled ? 'Disabled in lorebook' : isBookSelected ? 'Will be included (book selected)' : 'Book not selected — no injection'; }

            row.innerHTML = `
                <div class="scp-lb-entry-indicator ${indClass}" title="${indTitle}"></div>
                <div class="scp-lb-entry-info">
                    <span class="scp-lb-entry-name">${escHtml(entry.comment || `#${entry.uid}`)}${isInCtx ? ' <span class="scp-lb-in-ctx-badge">in context</span>' : ''}</span>
                    <span class="scp-lb-entry-keys">${entry.key?.slice(0, 5).map(k => escHtml(k)).join(' · ') || '—'}</span>
                </div>
                <div class="scp-lb-entry-actions">
                    <button class="scp-lb-entry-toggle-btn ${indClass}" title="Cycle: Default → Force On → Force Off">${btnText}</button>
                    <button class="scp-lb-entry-view-btn" title="View / Edit">${I.edit}</button>
                </div>`;
            row.querySelector('.scp-lb-entry-toggle-btn').addEventListener('click', e => { e.stopPropagation(); cycleEntryOverride(bookName, entry, row); });
            row.querySelector('.scp-lb-entry-view-btn').addEventListener('click', e => { e.stopPropagation(); showEntryDetail(entry, bookName); });
            row.addEventListener('click', () => showEntryDetail(entry, bookName));
            frag.appendChild(row);
        }
        container.innerHTML = '';
        container.appendChild(frag);

        // Update footer ctx info
        const ctxEl = document.getElementById('scp-lb-footer-ctx');
        if (ctxEl) {
            ctxEl.textContent = activeEntryUids.size
                ? `${activeEntryUids.size} entr${activeEntryUids.size !== 1 ? 'ies' : 'y'} in context`
                : '';
        }
    }

    function cycleEntryOverride(bookName, entry, rowEl) {
        const s = getSettings();
        if (!s.lorebookEntryOverrides) s.lorebookEntryOverrides = {};
        const key = `${bookName}_${entry.uid}`;
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
        const isConstant = isConstantEntry;

        if (next === true) {
            ind.className = 'scp-lb-entry-indicator forced-on';
            btn.textContent = '✓'; btn.className = 'scp-lb-entry-toggle-btn forced-on';
            rowEl.classList.remove('lb-in-ctx');
        } else if (next === false) {
            ind.className = 'scp-lb-entry-indicator forced-off';
            btn.textContent = '✕'; btn.className = 'scp-lb-entry-toggle-btn forced-off';
            rowEl.classList.remove('lb-in-ctx');
        } else {
            const isInCtx = _lastActiveEntries.some(e => e.bookName === bookName && e.uid === entry.uid);
            ind.className = `scp-lb-entry-indicator${isConstant ? ' forced-on' : (isInCtx ? ' scp-lb-ind-in-ctx' : '')}`;
            btn.textContent = isConstant ? '✓' : '~'; 
            btn.className = `scp-lb-entry-toggle-btn${isConstant ? ' forced-on' : ''}`;
            rowEl.classList.toggle('lb-in-ctx', isInCtx);
        }

        updateMsgCount(getCurrentSession());
    }

    function showEntryDetail(entry, bookName) {
        _lbEntryDetailEntry = entry;
        _lbEntryDetailBook = bookName;
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
                    renderEntryList(bookName, _lbSearchQuery);
                }
            };
        }

        const s = getSettings();
        const override = (s.lorebookEntryOverrides || {})[`${bookName}_${entry.uid}`];
        ['scp-lb-inj-default', 'scp-lb-inj-force-on', 'scp-lb-inj-force-off'].forEach(id => document.getElementById(id)?.classList.remove('active'));
        if (override === true) document.getElementById('scp-lb-inj-force-on')?.classList.add('active');
        else if (override === false) document.getElementById('scp-lb-inj-force-off')?.classList.add('active');
        else document.getElementById('scp-lb-inj-default')?.classList.add('active');

        const hintEl = document.getElementById('scp-lb-inj-hint');
        if (hintEl) {
            const isBookSel = (s.lorebookSelectedBooks ||[]).includes(bookName);
            const isInCtx = _lastActiveEntries.some(e => e.bookName === bookName && e.uid === entry.uid);
            if (override === true) hintEl.textContent = 'Always injected into Copilot context.';
            else if (override === false) hintEl.textContent = 'Never injected — excluded regardless of book selection.';
            else if (entry.constant && !entry.disable) hintEl.textContent = 'Constant entry. Automatically injected unless Forced Off.';
            else if (isInCtx) hintEl.textContent = '✓ In Copilot request context.';
            else if (isBookSel) hintEl.textContent = 'Included because this book is selected. Disable the entry or use Force Off to exclude.';
            else if (entry.disable) hintEl.textContent = 'Entry is disabled in lorebook. Enable it or use Force On to override.';
            else hintEl.textContent = 'Book not selected. Check the book checkbox in the sidebar, or use Force On.';
        }
    }

    async function saveEntryDetail() {
        if (!_lbEntryDetailEntry || !_lbEntryDetailBook) return;
        if (_lbEntryDetailBook === EMBEDDED_BOOK_KEY) { toastr.warning('Cannot save embedded character book entries. Edit the character card in ST.', EXT_DISPLAY); return; }
        const data = await fetchWorldInfoBook(_lbEntryDetailBook);
        if (!data) { toastr.error('Failed to load book', EXT_DISPLAY); return; }
        const entry = data.entries[_lbEntryDetailEntry.uid];
        if (!entry) { toastr.error('Entry not found', EXT_DISPLAY); return; }
        entry.comment = document.getElementById('scp-lb-detail-name')?.value || '';
        entry.key = (document.getElementById('scp-lb-detail-triggers')?.value || '').split(',').map(t => t.trim()).filter(Boolean);
        entry.content = document.getElementById('scp-lb-detail-content')?.value || '';
        Object.assign(_lbEntryDetailEntry, entry);
        await saveWorldInfoBook(_lbEntryDetailBook, data);
        toastr.success('Entry saved', EXT_DISPLAY);
        document.getElementById('scp-lb-detail-title').textContent = entry.comment || `Entry #${entry.uid}`;
        renderEntryList(_lbEntryDetailBook, _lbSearchQuery);
        updateMsgCount(getCurrentSession());
    }

    async function deleteEntryDetail() {
        if (!_lbEntryDetailEntry || !_lbEntryDetailBook) return;
        const ok = await showCustomDialog({ type: 'confirm', title: 'Delete Entry', message: `Delete "${_lbEntryDetailEntry.comment || 'this entry'}"? This cannot be undone.` });
        if (!ok) return;
        const data = await fetchWorldInfoBook(_lbEntryDetailBook);
        if (!data) return;
        delete data.entries[_lbEntryDetailEntry.uid];
        await saveWorldInfoBook(_lbEntryDetailBook, data);
        toastr.success('Entry deleted', EXT_DISPLAY);
        document.getElementById('scp-lb-entry-detail').style.display = 'none';
        document.getElementById('scp-lb-entries').style.display = '';
        renderEntryList(_lbEntryDetailBook, _lbSearchQuery);
        updateMsgCount(getCurrentSession());
    }

    async function addNewEntry() {
        if (!_lbActiveBook) { toastr.warning('Select a lorebook first', EXT_DISPLAY); return; }
        if (_lbActiveBook === EMBEDDED_BOOK_KEY) { toastr.warning('Cannot add entries to embedded character books directly. Edit the character card.', EXT_DISPLAY); return; }
        const name = await showCustomDialog({ type: 'prompt', title: 'New Entry', message: 'Entry name:', placeholder: 'New Entry' });
        if (name === null) return;
        const data = await fetchWorldInfoBook(_lbActiveBook);
        if (!data) { toastr.error('Failed to load book', EXT_DISPLAY); return; }
        const uids = Object.keys(data.entries).map(Number);
        const newUid = uids.length ? Math.max(...uids) + 1 : 1;
        const newEntry = {
            uid: newUid, key: [], keysecondary: [], content: '',
            comment: name.trim() || 'New Entry', disable: false, group: '',
            selective: false, constant: false, position: 0, depth: 4,
            displayIndex: newUid, prevent_recursion: false,
            delayUntilRecursion: false, scan_depth: null,
            match_whole_words: null, use_group_scoring: false,
            case_sensitive: null, automation_id: '', role: null,
            vectorized: false, sticky: null, cooldown: null, delay: null,
        };
        data.entries[newUid] = newEntry;
        await saveWorldInfoBook(_lbActiveBook, data);
        toastr.success('Entry created', EXT_DISPLAY);
        await renderEntryList(_lbActiveBook, _lbSearchQuery);
        showEntryDetail(newEntry, _lbActiveBook);
    }

    function updateLBFooterInfo() {
        const el = document.getElementById('scp-lb-footer-info');
        if (!el) return;
        const s = getSettings();
        const count = (s.lorebookSelectedBooks || []).length;
        const kwOn = s.lorebookAutoKeyword;
        const parts = [];
        if (count) parts.push(`${count} book${count !== 1 ? 's' : ''} selected`);
        if (kwOn) parts.push('Auto-keywords ON');
        if (!count && !kwOn) parts.push('☑ Check books in sidebar to inject entries into Copilot context');
        el.textContent = parts.join(' · ');
    }

    function setupLorebookManagerListeners() {
        document.getElementById('scp-lb-close')?.addEventListener('click', closeLorebookManager);
        const lbOverlay = document.getElementById('scp-lb-overlay');
        if (lbOverlay) {
            let _lbOverlayTouchStart = null;
            let _lbMouseDownTarget = null;
            lbOverlay.addEventListener('mousedown', e => { _lbMouseDownTarget = e.target; });
            lbOverlay.addEventListener('touchstart', e => {
                if (e.target === lbOverlay) _lbOverlayTouchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            }, { passive: true });
            lbOverlay.addEventListener('touchend', e => {
                if (e.target === lbOverlay && _lbOverlayTouchStart) {
                    const dx = Math.abs(e.changedTouches[0].clientX - _lbOverlayTouchStart.x);
                    const dy = Math.abs(e.changedTouches[0].clientY - _lbOverlayTouchStart.y);
                    if (dx < 8 && dy < 8) closeLorebookManager();
                }
                _lbOverlayTouchStart = null;
            }, { passive: true });
            lbOverlay.addEventListener('click', e => {
                if (e.target === lbOverlay && _lbMouseDownTarget === lbOverlay) closeLorebookManager();
                _lbMouseDownTarget = null;
            });
        }

        const diffModal = document.getElementById('scp-diff-modal');
        document.getElementById('scp-diff-close')?.addEventListener('click', () => { if (diffModal) diffModal.style.display = 'none'; });
        let _diffMouseDown = null;
        diffModal?.addEventListener('mousedown', e => { _diffMouseDown = e.target; });
        diffModal?.addEventListener('click', e => { if (e.target === diffModal && _diffMouseDown === diffModal) diffModal.style.display = 'none'; });
        document.getElementById('scp-lb-auto-kw-toggle')?.addEventListener('click', async () => {
            const s = getSettings(); 
            s.lorebookAutoKeyword = !s.lorebookAutoKeyword; 
            saveSettings();
            document.getElementById('scp-lb-auto-kw-toggle').classList.toggle('active', s.lorebookAutoKeyword);
            updateLBFooterInfo();
            
            await buildLorebookContextBlock(s);
            
            if (_lbActiveBook) {
                await renderEntryList(_lbActiveBook, _lbSearchQuery);
            }
            
            updateMsgCount(getCurrentSession());
        });
        document.getElementById('scp-lb-ai-toggle')?.addEventListener('click', () => {
            const s = getSettings(); s.lorebookAIManageEnabled = !s.lorebookAIManageEnabled; saveSettings();
            document.getElementById('scp-lb-ai-toggle').classList.toggle('active', s.lorebookAIManageEnabled);
        });
        document.getElementById('scp-lb-refresh')?.addEventListener('click', async () => {
            _wiCache = {};
            await refreshLorebookList();
            if (_lbActiveBook) await renderEntryList(_lbActiveBook, _lbSearchQuery);
        });

        let _lbSearchTid = null;
        document.getElementById('scp-lb-search')?.addEventListener('input', e => {
            _lbSearchQuery = e.target.value;
            clearTimeout(_lbSearchTid);
            _lbSearchTid = setTimeout(() => { if (_lbActiveBook) renderEntryList(_lbActiveBook, _lbSearchQuery); }, 200);
        });

        document.getElementById('scp-lb-enable-all')?.addEventListener('click', () => {
            if (!_lbActiveBook || !_wiCache[_lbActiveBook]) return;
            const s = getSettings();
            Object.values(_wiCache[_lbActiveBook].entries).forEach(e => { s.lorebookEntryOverrides[`${_lbActiveBook}_${e.uid}`] = true; });
            saveSettings(); renderEntryList(_lbActiveBook, _lbSearchQuery);
            updateMsgCount(getCurrentSession());
        });
        document.getElementById('scp-lb-disable-all')?.addEventListener('click', () => {
            if (!_lbActiveBook || !_wiCache[_lbActiveBook]) return;
            const s = getSettings();
            Object.values(_wiCache[_lbActiveBook].entries).forEach(e => { s.lorebookEntryOverrides[`${_lbActiveBook}_${e.uid}`] = false; });
            saveSettings(); renderEntryList(_lbActiveBook, _lbSearchQuery);
            updateMsgCount(getCurrentSession());
        });
        document.getElementById('scp-lb-reset-overrides')?.addEventListener('click', async () => {
            if (!_lbActiveBook) return;
            const ok = await showCustomDialog({ type: 'confirm', title: 'Reset Overrides', message: `Reset all copilot injection overrides for "${_lbActiveBook}"?` });
            if (!ok) return;
            const s = getSettings();
            if (_wiCache[_lbActiveBook]) Object.values(_wiCache[_lbActiveBook].entries).forEach(e => { delete s.lorebookEntryOverrides[`${_lbActiveBook}_${e.uid}`]; });
            saveSettings(); renderEntryList(_lbActiveBook, _lbSearchQuery);
            updateMsgCount(getCurrentSession());
        });
        document.getElementById('scp-lb-add-entry')?.addEventListener('click', addNewEntry);
        document.getElementById('scp-lb-back')?.addEventListener('click', async () => {
            document.getElementById('scp-lb-entry-detail').style.display = 'none';
            document.getElementById('scp-lb-entries').style.display = '';
            
            await buildLorebookContextBlock(getSettings());
            if (_lbActiveBook) await renderEntryList(_lbActiveBook, _lbSearchQuery);
        });
        document.getElementById('scp-lb-detail-save')?.addEventListener('click', saveEntryDetail);
        document.getElementById('scp-lb-detail-delete')?.addEventListener('click', deleteEntryDetail);
        document.getElementById('scp-lb-detail-copy')?.addEventListener('click', () => {
            const c = document.getElementById('scp-lb-detail-content')?.value; if (c) copyText(c);
        });
        ['scp-lb-inj-default', 'scp-lb-inj-force-on', 'scp-lb-inj-force-off'].forEach(id => {
            document.getElementById(id)?.addEventListener('click', () => {
                if (!_lbEntryDetailEntry || !_lbEntryDetailBook) return;
                const val = document.getElementById(id)?.dataset.val;
                const s = getSettings();
                if (!s.lorebookEntryOverrides) s.lorebookEntryOverrides = {};
                const key = `${_lbEntryDetailBook}_${_lbEntryDetailEntry.uid}`;
                if (val === 'default') delete s.lorebookEntryOverrides[key];
                else s.lorebookEntryOverrides[key] = val === 'true';
                saveSettings();
                ['scp-lb-inj-default', 'scp-lb-inj-force-on', 'scp-lb-inj-force-off'].forEach(bid => document.getElementById(bid)?.classList.remove('active'));
                document.getElementById(id)?.classList.add('active');
                // Re-show detail to refresh hint
                showEntryDetail(_lbEntryDetailEntry, _lbEntryDetailBook);
                updateMsgCount(getCurrentSession());
            });
        });
    }

    // ─── Settings ───────────────────────────────────────────────────────────────


    function getSettings() {
        const { extensionSettings } = SillyTavern.getContext();
        if (!extensionSettings[EXT_NAME]) extensionSettings[EXT_NAME] = {};
        const s = extensionSettings[EXT_NAME];
        const defaults = {
            enabled: true,
            windowVisible: false,
            minimized: false,
            windowX: null, windowY: null,
            iconX: null, iconY: null,
            windowW: 440, windowH: 600,
            opacity: 95,
            hotkey: 'Alt+Shift+C',
            hotkeyEnabled: true,
            contextDepth: 15,
            localHistoryLimit: 50,
            connectionSource: 'default',
            connectionProfileId: '',
            maxTokens: 6048,
            includeSystemPrompt: false,
            includeAuthorsNote: true,
            includeCharacterCard: true,
            includeUserPersonality: true,
            systemPrompt: DEFAULT_SYSTEM_PROMPT,
            profiles: {},
            activeProfile: '',
            profileBindings: {},
            customTheme: { ...THEME_PRESETS.default },
            savedThemes: {},
            activeThemeProfile: '',
            sessions: {},
            lorebookEnabled: true,
            lorebookAutoKeyword: true,
            lorebookSelectedBooks: [],
            lorebookEntryOverrides: {},
            lorebookAIManageEnabled: true,
            lorebookManagePrompt: DEFAULT_LB_MANAGE_PROMPT,
            lorebookSTScanDepth: 5,
            lorebookCopilotScanDepth: 6,
            floatingIconPersistent: false,
            reasoningTrimStrings: '',
            ghostModeOpacity: 15,
            ghostModeHotkey: 'Alt+Shift+G',
            ghostModeHotkeyEnabled: true,
            quickPromptsVisible: false,
            quickPrompts: [
                { id: 'qp_d1', label: 'Analyze', icon: '🔍', text: 'Analyze the current scene and character motivations in detail.' },
                { id: 'qp_d2', label: 'Ideas', icon: '💡', text: 'Give me 3 creative plot twist ideas for the current scene.' },
                { id: 'qp_d3', label: 'Summary', icon: '📋', text: 'Summarize everything that has happened in the roleplay so far.' },
                { id: 'qp_d4', label: 'Feelings', icon: '💭', text: 'What is {{char}} likely feeling right now and why?' },
                { id: 'qp_d5', label: 'Next?', icon: '🎯', text: 'What are the most interesting directions the story could go next?' },
            ],
            stats: { g:{}, c:{}, ch:{} },
        };
        for (const [k, v] of Object.entries(defaults)) {
            if (s[k] === undefined) s[k] = v;
        }
        return s;
    }

    function saveSettings() {
        SillyTavern.getContext().saveSettingsDebounced();
    }

    // ─── Statistics Engine ───────────────────────────────────────────────────────

    // Metric index map
    const _SM = { msg:0, regen:1, sess:2, tokIn:3, tokOut:4, qp:5, lb:6, edit:7 };
    const _STAT_N = 8;
    const _STAT_META = [
        { key:'msg',   label:'Messages',    icon:'💬', color:'#7c6dfa' },
        { key:'regen', label:'Regens',      icon:'🔄', color:'#4caf7d' },
        { key:'sess',  label:'Sessions',    icon:'📂', color:'#ffb432' },
        { key:'tokIn', label:'Tokens In',   icon:'📥', color:'#5bc0eb' },
        { key:'tokOut',label:'Tokens Out',  icon:'📤', color:'#f06292' },
        { key:'qp',    label:'QPrompts',    icon:'⚡', color:'#ff8a65' },
        { key:'lb',    label:'LB Changes',  icon:'📖', color:'#ab47bc' },
        { key:'edit',  label:'Edits',       icon:'✏️', color:'#78909c' },
    ];

    function _ensureStats() {
        const s = getSettings();
        if (!s.stats) s.stats = { g:{}, c:{}, ch:{} };
        if (!s.stats.g) s.stats.g = {};
        if (!s.stats.c) s.stats.c = {};
        if (!s.stats.ch) s.stats.ch = {};
        return s.stats;
    }

    function _statDateKey() {
        const d = new Date();
        return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    }

    function _toDateKey(d) {
        return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    }

    function recordStat(metricIdx, value = 1) {
        try {
            if (metricIdx < 0 || metricIdx >= _STAT_N || !value) return;
            const st = _ensureStats();
            const dk = _statDateKey();
            const { charId, chatId } = getBindingKey();
            const chk = `${charId}\x1f${chatId}`;
            const inc = obj => {
                if (!obj[dk]) obj[dk] = [0,0,0,0,0,0,0,0];
                obj[dk][metricIdx] = (obj[dk][metricIdx] || 0) + value;
            };
            inc(st.g);
            if (!st.c[charId]) st.c[charId] = {};
            inc(st.c[charId]);
            if (!st.ch[chk]) st.ch[chk] = {};
            inc(st.ch[chk]);
            saveSettings();
        } catch(_) {}
    }

    function _statGetObj(scope) {
        const st = _ensureStats();
        const { charId, chatId } = getBindingKey();
        if (scope === 'g') return st.g;
        if (scope === 'ch') return st.ch[`${charId}\x1f${chatId}`] || {};
        return st.c[charId] || {};
    }

    function getStatBuckets(scope, period) {
        const obj = _statGetObj(scope);
        const now = new Date();
        const EMPTY = () => new Array(_STAT_N).fill(0);
        const results = [];

        if (period === 'day') {
            for (let i = 29; i >= 0; i--) {
                const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
                const v = obj[_toDateKey(d)];
                const vals = v ? v.slice() : EMPTY();
                while (vals.length < _STAT_N) vals.push(0);
                const lbl = i === 0 ? 'Today' : `${d.getMonth()+1}/${d.getDate()}`;
                results.push({ label: lbl, vals });
            }
        } else if (period === 'week') {
            for (let w = 11; w >= 0; w--) {
                const wEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - w * 7);
                const wStart = new Date(wEnd.getFullYear(), wEnd.getMonth(), wEnd.getDate() - 6);
                const agg = EMPTY();
                for (let d = 0; d <= 6; d++) {
                    const day = new Date(wStart.getFullYear(), wStart.getMonth(), wStart.getDate() + d);
                    const v = obj[_toDateKey(day)];
                    if (v) v.forEach((n, i) => { if (i < _STAT_N) agg[i] += (n || 0); });
                }
                results.push({ label: w === 0 ? 'This wk' : `${wStart.getMonth()+1}/${wStart.getDate()}`, vals: agg });
            }
        } else if (period === 'month') {
            for (let m = 11; m >= 0; m--) {
                const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
                const y = d.getFullYear(), mo = d.getMonth();
                const agg = EMPTY();
                const days = new Date(y, mo + 1, 0).getDate();
                for (let day = 1; day <= days; day++) {
                    const key = `${y}${String(mo+1).padStart(2,'0')}${String(day).padStart(2,'0')}`;
                    const v = obj[key];
                    if (v) v.forEach((n, i) => { if (i < _STAT_N) agg[i] += (n || 0); });
                }
                results.push({ label: d.toLocaleString('default', { month: 'short', year: m > 0 ? '2-digit' : undefined }), vals: agg });
            }
        } else {
            const allKeys = Object.keys(obj);
            const yearsSet = new Set(allKeys.map(k => k.slice(0,4)));
            yearsSet.add(String(now.getFullYear()));
            const years = [...yearsSet].sort();
            for (const y of years) {
                const agg = EMPTY();
                allKeys.forEach(k => {
                    if (k.startsWith(y)) {
                        const v = obj[k];
                        if (v) v.forEach((n, i) => { if (i < _STAT_N) agg[i] += (n || 0); });
                    }
                });
                results.push({ label: y, vals: agg });
            }
            if (!results.length) results.push({ label: String(now.getFullYear()), vals: EMPTY() });
        }
        return results;
    }

    function getStatTotals(scope) {
        const obj = _statGetObj(scope);
        const totals = new Array(_STAT_N).fill(0);
        Object.values(obj).forEach(v => {
            if (Array.isArray(v)) v.forEach((n, i) => { if (i < _STAT_N) totals[i] += (n || 0); });
        });
        return totals;
    }

    function _fmtNum(n) {
        if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
        return String(n);
    }

    let _statsState = { scope: 'g', period: 'day', metric: 0 };

    function renderStatsPane(container) {
        if (!container) return;
        container.innerHTML = '';

        const s = _statsState;

        const controls = document.createElement('div');
        controls.className = 'scp-stats-controls';

        const mkPillRow = (label, items, stateKey, onSelect) => {
            const row = document.createElement('div');
            row.className = 'scp-stats-pill-row';
            const lbl = document.createElement('span');
            lbl.className = 'scp-stats-pill-label';
            lbl.textContent = label;
            row.appendChild(lbl);
            items.forEach(([val, txt]) => {
                const btn = document.createElement('button');
                btn.className = `scp-stats-pill${s[stateKey] === val ? ' active' : ''}`;
                btn.textContent = txt;
                btn.dataset[stateKey] = val;
                btn.addEventListener('click', () => {
                    if (_statsState[stateKey] === val) return;
                    _statsState[stateKey] = val;
                    container.querySelectorAll(`[data-${stateKey}]`).forEach(b => b.classList.toggle('active', b.dataset[stateKey] === val));
                    onSelect(val);
                });
                row.appendChild(btn);
            });
            return row;
        };

        controls.appendChild(mkPillRow('Scope',
            [['g','Global'],['c','Character'],['ch','Chat']],
            'scope',
            () => { refreshStatCards(container); refreshStatsChart(container); }
        ));
        controls.appendChild(mkPillRow('Period',
            [['day','30 Days'],['week','12 Weeks'],['month','12 Mo'],['year','All Years']],
            'period',
            () => refreshStatsChart(container)
        ));
        container.appendChild(controls);

        const cardsWrap = document.createElement('div');
        cardsWrap.className = 'scp-stats-cards';
        cardsWrap.id = 'scp-stats-cards';
        container.appendChild(cardsWrap);

        const chartWrap = document.createElement('div');
        chartWrap.className = 'scp-stats-chart-wrap';
        chartWrap.id = 'scp-stats-chart-wrap';
        container.appendChild(chartWrap);

        const danger = document.createElement('div');
        danger.className = 'scp-sp-group scp-stats-danger';
        danger.innerHTML = `<div class="scp-sp-group-title" style="color:var(--scp-danger)"><i class="fa-solid fa-triangle-exclamation"></i> Danger Zone</div>`;
        const resetBtn = document.createElement('button');
        resetBtn.className = 'scp-action-btn scp-sp-danger-btn';
        resetBtn.innerHTML = '<i class="fa-solid fa-trash"></i><span>Reset Statistics</span>';
        resetBtn.addEventListener('click', async () => {
            const ok = await showCustomDialog({ type:'confirm', title:'Reset Statistics', message:'Delete ALL collected statistics permanently? This cannot be undone.', delayConfirm:3 });
            if (!ok) return;
            getSettings().stats = { g:{}, c:{}, ch:{} };
            saveSettings();
            renderStatsPane(container);
            toastr.success('Statistics cleared.', EXT_DISPLAY);
        });
        danger.appendChild(resetBtn);
        container.appendChild(danger);

        refreshStatCards(container);
        refreshStatsChart(container);
    }

    function refreshStatCards(container) {
        const wrap = container.querySelector('#scp-stats-cards');
        if (!wrap) return;
        const totals = getStatTotals(_statsState.scope);
        wrap.innerHTML = '';
        _STAT_META.forEach((meta, idx) => {
            const card = document.createElement('div');
            card.className = `scp-stats-card${_statsState.metric === idx ? ' active' : ''}`;
            card.style.setProperty('--scp-stat-color', meta.color);
            card.innerHTML = `<span class="scp-stats-card-icon">${meta.icon}</span><span class="scp-stats-card-val">${_fmtNum(totals[idx])}</span><span class="scp-stats-card-label">${meta.label}</span>`;
            card.addEventListener('click', () => {
                _statsState.metric = idx;
                container.querySelectorAll('.scp-stats-card').forEach((c, i) => c.classList.toggle('active', i === idx));
                refreshStatsChart(container);
            });
            wrap.appendChild(card);
        });
    }

    function refreshStatsChart(container) {
        const wrap = container.querySelector('#scp-stats-chart-wrap');
        if (!wrap) return;
        const buckets = getStatBuckets(_statsState.scope, _statsState.period);
        renderSVGChart(wrap, buckets, _statsState.metric, _STAT_META[_statsState.metric]);
    }

    function renderSVGChart(container, buckets, metricIdx, meta) {
        const W = 580, H = 170, PL = 38, PR = 12, PT = 14, PB = 30;
        const cW = W - PL - PR, cH = H - PT - PB;
        const vals = buckets.map(b => b.vals[metricIdx] || 0);
        const maxVal = Math.max(...vals, 1);

        const px = i => PL + (buckets.length < 2 ? cW / 2 : i / (buckets.length - 1) * cW);
        const py = v => PT + cH - (v / maxVal) * cH;

        const points = buckets.map((_, i) => [px(i), py(vals[i])]);
        const linePath = points.map((p, i) => `${i===0?'M':'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
        const areaPath = linePath + ` L${points[points.length-1][0].toFixed(1)},${(PT+cH).toFixed(1)} L${PL},${(PT+cH).toFixed(1)} Z`;

        const yTicks = [0, 0.5, 1].map(f => ({ y: py(maxVal*f), lbl: _fmtNum(Math.round(maxVal*f)) }));
        const xStep = Math.max(1, Math.ceil(buckets.length / 9));
        const gradId = `scpsg${metricIdx}`;

        const xLabels = buckets.map((b, i) => {
            if (i % xStep !== 0 && i !== buckets.length - 1) return '';
            return `<text x="${px(i).toFixed(1)}" y="${H-3}" text-anchor="middle" class="scp-stats-axis-label">${escHtml(b.label)}</text>`;
        }).join('');

        const dots = points.map((p, i) => vals[i] > 0
            ? `<circle class="scp-stats-dot" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="${meta.color}" data-i="${i}"/>`
            : '').join('');

        const hoverCols = buckets.map((b, i) => {
            const colW = cW / Math.max(buckets.length, 1);
            const x = px(i) - colW / 2;
            return `<rect class="scp-stats-hcol" x="${x.toFixed(1)}" y="${PT}" width="${colW.toFixed(1)}" height="${cH}" fill="transparent" data-i="${i}" data-v="${vals[i]}" data-l="${escHtml(b.label)}"/>`;
        }).join('');

        container.innerHTML = `
<div class="scp-stats-chart-inner">
  <svg class="scp-stats-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
    <defs>
      <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${meta.color}" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="${meta.color}" stop-opacity="0.01"/>
      </linearGradient>
    </defs>
    ${yTicks.map(t => `<line x1="${PL}" y1="${t.y.toFixed(1)}" x2="${W-PR}" y2="${t.y.toFixed(1)}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/><text x="${PL-4}" y="${(t.y+4).toFixed(1)}" text-anchor="end" class="scp-stats-axis-label">${t.lbl}</text>`).join('')}
    <path d="${areaPath}" fill="url(#${gradId})"/>
    <path d="${linePath}" fill="none" stroke="${meta.color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    ${dots}
    ${xLabels}
    ${hoverCols}
  </svg>
  <div class="scp-stats-tooltip" id="scp-stats-tt" style="display:none"></div>
</div>`;

        const svgEl = container.querySelector('.scp-stats-svg');
        const tt = container.querySelector('#scp-stats-tt');
        if (!svgEl || !tt) return;

        let _lastI = -1;
        svgEl.addEventListener('pointermove', e => {
            const r = svgEl.getBoundingClientRect();
            const svgX = (e.clientX - r.left) / r.width * W;
            const relX = svgX - PL;
            const rawIdx = relX / cW * (buckets.length - 1);
            const idx = Math.max(0, Math.min(buckets.length - 1, Math.round(rawIdx)));
            if (idx === _lastI) return;
            _lastI = idx;
            const val = vals[idx];
            tt.style.display = '';
            tt.innerHTML = `<span class="scp-stats-tt-label">${escHtml(buckets[idx].label)}</span><span class="scp-stats-tt-val" style="color:${meta.color}">${_fmtNum(val)}</span>`;
            const dotPxX = px(idx) / W * r.width;
            const dotPxY = py(val) / H * r.height;
            const ttW = 90;
            let left = dotPxX - ttW / 2;
            left = Math.max(0, Math.min(left, r.width - ttW));
            tt.style.left = `${left}px`;
            tt.style.top = `${Math.max(0, dotPxY - 42)}px`;
            svgEl.querySelectorAll('.scp-stats-dot').forEach((d, i) => d.setAttribute('r', i === idx ? '4.5' : '3'));
        });
        svgEl.addEventListener('pointerleave', () => {
            tt.style.display = 'none';
            _lastI = -1;
            svgEl.querySelectorAll('.scp-stats-dot').forEach(d => d.setAttribute('r', '3'));
        });

        if ('ontouchstart' in window || window.innerWidth <= 900) {
            requestAnimationFrame(() => {
                const inner = container.querySelector('.scp-stats-chart-inner');
                if (inner) inner.scrollLeft = inner.scrollWidth;
            });
        }
    }

    // ─── Session Override System ─────────────────────────────────────────────────

    const SESSION_OVERRIDE_KEYS = [
        'contextDepth','localHistoryLimit','maxTokens',
        'connectionSource','connectionProfileId','systemPrompt',
        'includeSystemPrompt','includeAuthorsNote',
        'includeCharacterCard','includeUserPersonality','reasoningTrimStrings',
    ];

    function getSessionOverrides() {
        try { return getCurrentSession()?.overrides || {}; } catch(_) { return {}; }
    }

    function getEffectiveSettings() {
        return { ...getSettings(), ...getSessionOverrides() };
    }

    function setSessionOverride(key, value) {
        try {
            const sess = getCurrentSession();
            if (!sess) return;
            if (!sess.overrides) sess.overrides = {};
            if (value === undefined || value === null) delete sess.overrides[key];
            else sess.overrides[key] = value;
            saveSettings();
            updateSessionOverrideIndicator();
        } catch(_) {}
    }

    function clearAllSessionOverrides() {
        try {
            const sess = getCurrentSession();
            if (!sess) return;
            sess.overrides = {};
            saveSettings();
            updateSessionOverrideIndicator();
        } catch(_) {}
    }

    function hasSessionOverrides() {
        try { const o = getCurrentSession()?.overrides; return !!(o && Object.keys(o).length > 0); }
        catch(_) { return false; }
    }

    function updateSessionOverrideIndicator() {
        const has = hasSessionOverrides();
        const dot = document.getElementById('scp-sp-override-dot');
        if (dot) dot.style.display = has ? '' : 'none';
        const gearDot = document.getElementById('scp-gear-ov-dot');
        if (gearDot) gearDot.style.display = has ? '' : 'none';
        const btn = document.getElementById('scp-ext-settings-btn');
        if (btn) btn.classList.toggle('scp-has-overrides', has);
        updateSPOverrideIndicators();
        const info = document.getElementById('scp-sp-footer-info');
        if (info) {
            const ov = getSessionOverrides();
            const count = Object.keys(ov).length;
            info.textContent = count ? `${count} session override${count !== 1 ? 's' : ''} active` : '';
        }
        // Dim the main depth slider when session override is active for contextDepth
        const ov = getSessionOverrides();
        const depthSlider = document.getElementById('scp-depth-slider');
        const depthVal = document.getElementById('scp-depth-val');
        const hasDepthOv = 'contextDepth' in ov;
        if (depthSlider) depthSlider.classList.toggle('scp-slider-overridden', hasDepthOv);
        if (depthVal) depthVal.classList.toggle('scp-depth-val-overridden', hasDepthOv);
    }

    function updateSPOverrideIndicators() {
        const ov = getSessionOverrides();
        document.querySelectorAll('.scp-sp-ov-label[data-ovkey]').forEach(label => {
            label.classList.toggle('has-override', label.dataset.ovkey in ov);
        });
        document.querySelectorAll('.scp-sp-ov-clear[data-ovkey]').forEach(btn => {
            const active = btn.dataset.ovkey in ov;
            btn.classList.toggle('active', active);
            btn.disabled = !active;
        });
    }

    // ─── Custom Dialog (replaces browser prompt/confirm/alert) ──────────────────

    function escHtml(str) {
        return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    // ─── Color Picker ────────────────────────────────────────────────────────────

    const _COLOR_KEYS = new Set(['bg','text','textMuted','accent','accentDim','accentBg','headerBg','toolbarBg','msgUserBg','msgAiBg','inputBg','codeBg','danger','success']);

    function _parseRgba(str) {
        if (!str) return null;
        const m = str.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/);
        if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
        const h = str.match(/^#([0-9a-f]{3,8})$/i);
        if (h) {
            let hex = h[1];
            if (hex.length === 3) hex = hex.split('').map(c => c+c).join('');
            if (hex.length < 6) return null;
            return { r: parseInt(hex.slice(0,2),16), g: parseInt(hex.slice(2,4),16), b: parseInt(hex.slice(4,6),16), a: hex.length === 8 ? parseInt(hex.slice(6,8),16)/255 : 1 };
        }
        return null;
    }

    function _rgbToHex(r, g, b) {
        return '#' + [r,g,b].map(v => Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,'0')).join('');
    }

    function _toRgbaStr(r, g, b, a) {
        const ri = Math.round(Math.max(0,Math.min(255,r)));
        const gi = Math.round(Math.max(0,Math.min(255,g)));
        const bi = Math.round(Math.max(0,Math.min(255,b)));
        const ai = Math.round(Math.max(0,Math.min(1,a))*100)/100;
        return ai >= 1 ? `rgb(${ri},${gi},${bi})` : `rgba(${ri},${gi},${bi},${ai})`;
    }

    let _activeColorPop = null;

    function showColorPicker(anchorEl, initialVal, onChange) {
        if (_activeColorPop) { _activeColorPop.remove(); _activeColorPop = null; }
        const parsed = _parseRgba(initialVal);
        const hexVal = parsed ? _rgbToHex(parsed.r, parsed.g, parsed.b) : '#7c6dfa';
        const alphaVal = parsed ? Math.round(parsed.a * 100) : 100;

        // Temporarily hide settings overlay so user can see the copilot window
        const settingsOverlay = anchorEl.closest('#scp-settings-overlay');
        if (settingsOverlay) {
            settingsOverlay.style.opacity = '0';
            settingsOverlay.style.pointerEvents = 'none';
        }

        const pop = document.createElement('div');
        pop.className = 'scp-color-pop';
        pop.innerHTML = `
            <div class="scp-color-pop-row">
                <input type="color" class="scp-color-pop-wheel" value="${hexVal}">
                <div class="scp-color-pop-alpha-col">
                    <span class="scp-color-pop-alpha-label">Alpha</span>
                    <input type="range" class="scp-slider scp-color-pop-alpha" min="0" max="100" value="${alphaVal}">
                    <span class="scp-color-pop-alpha-val">${alphaVal}%</span>
                </div>
            </div>
            <input type="text" class="scp-color-pop-text text_pole" value="${escHtml(initialVal)}">
        `;
        document.body.appendChild(pop);
        _activeColorPop = pop;

        const rect = anchorEl.getBoundingClientRect();
        pop.style.cssText += `position:fixed;z-index:999999;left:${rect.left}px;top:${rect.bottom + 6}px`;
        requestAnimationFrame(() => {
            const pr = pop.getBoundingClientRect();
            if (pr.right > window.innerWidth - 8) pop.style.left = `${window.innerWidth - pr.width - 8}px`;
            if (pr.bottom > window.innerHeight - 8) pop.style.top = `${rect.top - pr.height - 6}px`;
        });

        const wheel = pop.querySelector('.scp-color-pop-wheel');
        const alpha = pop.querySelector('.scp-color-pop-alpha');
        const alphaValEl = pop.querySelector('.scp-color-pop-alpha-val');
        const textEl = pop.querySelector('.scp-color-pop-text');

        let _emitPending = false;
        const buildVal = () => {
            const hex = wheel.value;
            const a = parseInt(alpha.value) / 100;
            return _toRgbaStr(parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16), a);
        };
        const emit = () => {
            if (_emitPending) return;
            _emitPending = true;
            requestAnimationFrame(() => {
                _emitPending = false;
                const val = buildVal();
                textEl.value = val;
                onChange(val);
            });
        };

        wheel.addEventListener('input', emit);
        alpha.addEventListener('input', () => { alphaValEl.textContent = `${alpha.value}%`; emit(); });
        textEl.addEventListener('input', () => {
            const p = _parseRgba(textEl.value);
            if (p) {
                wheel.value = _rgbToHex(p.r, p.g, p.b);
                alpha.value = Math.round(p.a * 100);
                alphaValEl.textContent = `${alpha.value}%`;
                onChange(textEl.value);
            }
        });

        const onOutside = e => {
            if (!pop.contains(e.target) && e.target !== anchorEl) {
                pop.remove(); _activeColorPop = null;
                if (settingsOverlay) {
                    settingsOverlay.style.opacity = '';
                    settingsOverlay.style.pointerEvents = '';
                }
                document.removeEventListener('mousedown', onOutside, true);
            }
        };
        setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);
    }

    function showCustomDialog({ type = 'alert', title = '', message = '', defaultValue = '', placeholder = '', delayConfirm = 0 }) {
        return new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.className = 'scp-dialog-overlay';
            const isPrompt = type === 'prompt';
            const isConfirm = type === 'confirm';
            overlay.innerHTML = `
                <div class="scp-dialog-box">
                    ${title ? `<div class="scp-dialog-title">${escHtml(title)}</div>` : ''}
                    ${message ? `<div class="scp-dialog-msg">${escHtml(message)}</div>` : ''}
                    ${isPrompt ? `<input type="text" class="scp-dialog-input" value="${escHtml(defaultValue)}" placeholder="${escHtml(placeholder)}">` : ''}
                    <div class="scp-dialog-btns">
                        ${(isPrompt || isConfirm) ? `<button class="scp-dialog-btn scp-dialog-cancel">Cancel</button>` : ''}
                        <button class="scp-dialog-btn scp-dialog-ok${isConfirm ? ' danger' : ''}">${isConfirm ? 'Confirm' : 'OK'}</button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);
            const input = overlay.querySelector('.scp-dialog-input');
            const okBtn = overlay.querySelector('.scp-dialog-ok');
            const cancelBtn = overlay.querySelector('.scp-dialog-cancel');
            
            let timerIntv = null;
            let currentDelay = delayConfirm;
            const origOkText = okBtn.textContent;

            const close = val => { 
                if (timerIntv) clearInterval(timerIntv);
                overlay.classList.remove('visible'); 
                setTimeout(() => overlay.remove(), 150); 
                resolve(val); 
            };

            if (isConfirm && currentDelay > 0) {
                okBtn.disabled = true;
                okBtn.style.opacity = '0.5';
                okBtn.style.cursor = 'not-allowed';
                okBtn.textContent = `${origOkText} (${currentDelay})`;
                timerIntv = setInterval(() => {
                    currentDelay--;
                    if (currentDelay <= 0) {
                        clearInterval(timerIntv);
                        timerIntv = null;
                        okBtn.disabled = false;
                        okBtn.style.opacity = '1';
                        okBtn.style.cursor = '';
                        okBtn.textContent = origOkText;
                        if (!input) okBtn.focus();
                    } else {
                        okBtn.textContent = `${origOkText} (${currentDelay})`;
                    }
                }, 1000);
            }

            if (input) { input.focus(); input.select(); } else if (currentDelay <= 0) { setTimeout(() => okBtn.focus(), 50); }
            
            okBtn.addEventListener('click', () => { if (!okBtn.disabled) close(isPrompt ? input.value : true); });
            cancelBtn?.addEventListener('click', () => close(isPrompt ? null : false));
            let _dlgMouseDownTarget = null;
            overlay.addEventListener('mousedown', e => { _dlgMouseDownTarget = e.target; });
            overlay.addEventListener('click', e => { if (e.target === overlay && _dlgMouseDownTarget === overlay) close(isPrompt ? null : false); });
            const keyHandler = e => {
                if (e.key === 'Enter') { e.preventDefault(); if (!okBtn.disabled) close(isPrompt ? input.value : true); }
                if (e.key === 'Escape') close(isPrompt ? null : false);
            };
            (input || overlay).addEventListener('keydown', keyHandler);
            requestAnimationFrame(() => overlay.classList.add('visible'));
        });
    }

    // ─── Session Dialog (with temporary toggle) ──────────────────────────────────

    function showSessionDialog({ defaultName = '' } = {}) {
        return new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.className = 'scp-dialog-overlay';
            overlay.innerHTML = `
                <div class="scp-dialog-box">
                    <div class="scp-dialog-title">New Session</div>
                    <div class="scp-dialog-msg">Session name:</div>
                    <input type="text" class="scp-dialog-input" value="${escHtml(defaultName)}" placeholder="${escHtml(defaultName)}">
                    <label class="scp-sess-tmp-label">
                        <div class="scp-lb-toggle" id="scp-sess-tmp-toggle"><div class="scp-lb-toggle-knob"></div></div>
                        <span>Temporary — auto-delete when switching</span>
                    </label>
                    <div class="scp-dialog-btns">
                        <button class="scp-dialog-btn scp-dialog-cancel">Cancel</button>
                        <button class="scp-dialog-btn scp-dialog-ok">Create</button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);
            let isTemporary = false;
            const toggle = overlay.querySelector('#scp-sess-tmp-toggle');
            toggle.addEventListener('click', () => {
                isTemporary = !isTemporary;
                toggle.classList.toggle('active', isTemporary);
            });
            const input = overlay.querySelector('.scp-dialog-input');
            const okBtn = overlay.querySelector('.scp-dialog-ok');
            const cancelBtn = overlay.querySelector('.scp-dialog-cancel');
            const close = val => { overlay.classList.remove('visible'); setTimeout(() => overlay.remove(), 150); resolve(val); };
            input.focus(); input.select();
            okBtn.addEventListener('click', () => close({ name: input.value, isTemporary }));
            cancelBtn.addEventListener('click', () => close(null));
            overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
            input.addEventListener('keydown', e => {
                if (e.key === 'Enter') { e.preventDefault(); close({ name: input.value, isTemporary }); }
                if (e.key === 'Escape') close(null);
            });
            requestAnimationFrame(() => overlay.classList.add('visible'));
        });
    }


    function getBindingKey() {
        const ctx = SillyTavern.getContext();
        const charId = String(ctx.characterId ?? 'global');
        let chatId = 'default';
        try {
            if (typeof ctx.getCurrentChatId === 'function') {
                const r = ctx.getCurrentChatId(); if (r) chatId = String(r);
            } else if (ctx.chatId) { chatId = String(ctx.chatId);
            } else if (ctx.chat?.length) {
                const first = ctx.chat[0];
                chatId = first.send_date ? String(first.send_date) : `len_${ctx.chat.length}`;
            }
        } catch (_) {}
        return { charId, chatId };
    }

    function getChatBucket(charId, chatId) {
        const s = getSettings();
        if (!s.sessions[charId]) s.sessions[charId] = {};
        if (!s.sessions[charId][chatId]) s.sessions[charId][chatId] = { activeSessionId: null, sessions: [] };
        return s.sessions[charId][chatId];
    }

    function genId(prefix) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

    function createSession(charId, chatId, name, isTemporary = false) {
        const bucket = getChatBucket(charId, chatId);
        const id = genId('sess');
        const sess = { id, name: name || `Session ${bucket.sessions.length + 1}`, created: Date.now(), messages: [], isTemporary };
        
        const prev = bucket.sessions.find(s => s.id === bucket.activeSessionId);
        if (prev && prev.isTemporary) {
            bucket.sessions = bucket.sessions.filter(s => s.id !== prev.id);
        }

        bucket.sessions.push(sess);
        bucket.activeSessionId = id;
        recordStat(_SM.sess);
        saveSettings();
        return sess;
    }

    function getActiveSession(charId, chatId) {
        const bucket = getChatBucket(charId, chatId);
        if (!bucket.sessions.length || !bucket.activeSessionId) return createSession(charId, chatId);
        return bucket.sessions.find(s => s.id === bucket.activeSessionId) || createSession(charId, chatId);
    }

    function setActiveSession(charId, chatId, sessionId) {
        const bucket = getChatBucket(charId, chatId);
        if (!bucket.sessions.find(s => s.id === sessionId)) return;
        const prev = bucket.sessions.find(s => s.id === bucket.activeSessionId);
        if (prev && prev.isTemporary && prev.id !== sessionId) {
            bucket.sessions = bucket.sessions.filter(s => s.id !== prev.id);
        }
        bucket.activeSessionId = sessionId;
        saveSettings();
    }

    function deleteCurrentSession(charId, chatId) {
        const bucket = getChatBucket(charId, chatId);
        if (!bucket.sessions.length) return createSession(charId, chatId);
        bucket.sessions = bucket.sessions.filter(s => s.id !== bucket.activeSessionId);
        bucket.activeSessionId = bucket.sessions.length ? bucket.sessions[bucket.sessions.length - 1].id : null;
        saveSettings();
        return getActiveSession(charId, chatId);
    }

    function addMessage(session, role, content, extra = {}) {
        const msg = { id: genId('msg'), role, content, timestamp: Date.now(), ...extra };
        session.messages.push(msg); saveSettings(); return msg;
    }
    function insertMessageAfter(session, afterMsgId, role, content, extra = {}) {
        const msg = { id: genId('msg'), role, content, timestamp: Date.now(), ...extra };
        const idx = afterMsgId ? session.messages.findIndex(m => m.id === afterMsgId) : -1;
        if (idx !== -1) session.messages.splice(idx + 1, 0, msg);
        else session.messages.push(msg);
        saveSettings();
        return msg;
    }
    function updateMessage(session, msgId, newContent) {
        const msg = session.messages.find(m => m.id === msgId);
        if (msg) { msg.content = newContent; saveSettings(); }
    }
    function truncateAfter(session, msgId) {
        const idx = session.messages.findIndex(m => m.id === msgId);
        if (idx !== -1) { session.messages.splice(idx + 1); saveSettings(); }
    }
    function deleteMsg(session, msgId) {
        const idx = session.messages.findIndex(m => m.id === msgId);
        if (idx !== -1) { session.messages.splice(idx, 1); saveSettings(); }
    }
    function truncateFrom(session, msgId) {
        const idx = session.messages.findIndex(m => m.id === msgId);
        if (idx !== -1) { session.messages.splice(idx); saveSettings(); }
    }

    // ─── ST Context Helpers ─────────────────────────────────────────────────────

    function getCharInfo() {
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
        };
    }

    function getUserPersona() {
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
            const pu = window.power_user;
            if (pu) {
                if (typeof pu.persona_description === 'string' && pu.persona_description) return pu.persona_description;
                if (pu.personas && pu.persona && pu.personas[pu.persona]?.description) return pu.personas[pu.persona].description;
                if (typeof pu.persona === 'string' && pu.persona.length > 30 && !pu.persona.endsWith('.json')) return pu.persona;
            }
        } catch (_) {}

        return ctx.persona || ctx.userPersona || ctx.user_persona || '';
    }

    function getAuthorsNote() {
        const ctx = SillyTavern.getContext();
        return ctx.chatMetadata
        ?.note_prompt || ctx.authorsNote || ctx.authors_note || '';
    }

    let _lastChatLen = -1; 

    function updateDepthSlidersMax() {
        const ctx = SillyTavern.getContext();
        const chat = ctx.chat || window.chat ||[];
        const maxVal = Math.max(1, chat.length);
        
        if (_lastChatLen === -1) {
            _lastChatLen = maxVal;
        }

        const s = getSettings();
        const sess = getCurrentSession();
        let settingsChanged = false;

        const globalDepth = parseInt(s.contextDepth) || 0;
        if (globalDepth >= _lastChatLen && maxVal > _lastChatLen) {
            s.contextDepth = maxVal;
            settingsChanged = true;
        }

        if (sess && sess.overrides && sess.overrides.contextDepth !== undefined) {
            const ovDepth = parseInt(sess.overrides.contextDepth) || 0;
            if (ovDepth >= _lastChatLen && maxVal > _lastChatLen) {
                sess.overrides.contextDepth = maxVal;
                settingsChanged = true;
            }
        }

        if (settingsChanged) {
            saveSettings();
        }

        _lastChatLen = maxVal;
        
        const eff = getEffectiveSettings();

        const sliders =[
            { id: 'scp-depth-slider', valId: 'scp-depth-val', setting: s.contextDepth },
            { id: 'scp-sp-depth-slider', valId: 'scp-sp-depth-val', setting: s.contextDepth },
            { id: 'scp-sp-ov-depth-slider', valId: 'scp-sp-ov-depth-val', setting: eff.contextDepth }
        ];

        sliders.forEach(item => {
            const el = document.getElementById(item.id);
            if (el) {
                if (parseInt(el.max) !== maxVal) {
                    el.max = maxVal;
                }
                
                const renderVal = Math.min(maxVal, parseInt(item.setting ?? 15));
                el.value = renderVal;
                
                const valEl = document.getElementById(item.valId);
                if (valEl) {
                    valEl.textContent = renderVal;
                }
            }
        });
    }

    // ─── Macro Expansion ────────────────────────────────────────────────────────

    function expandMacros(text) {
        if (!text) return text;
        try {
            const ctx = SillyTavern.getContext();
            // Primary: use ST's own substituteParams (available in context on newer ST)
            if (typeof ctx.substituteParams === 'function') {
                return ctx.substituteParams(text);
            }
            // Fallback: window-level export (older ST versions)
            if (typeof window.substituteParams === 'function') {
                return window.substituteParams(text, ctx.name1, ctx.name2);
            }
        } catch (e) {
            console.warn(`[${EXT_DISPLAY}] Macro expansion error:`, e);
        }
        // Manual fallback for the most common macros
        try {
            const ctx = SillyTavern.getContext();
            const char = ctx.characters?.[ctx.characterId];
            const d = char?.data || {};
            const now = new Date();
            return text
                .replace(/\{\{user\}\}/gi, ctx.name1 || 'User')
                .replace(/\{\{char\}\}/gi, char?.name || ctx.name2 || 'Character')
                .replace(/\{\{time\}\}/gi, now.toLocaleTimeString())
                .replace(/\{\{date\}\}/gi, now.toLocaleDateString())
                .replace(/\{\{isodate\}\}/gi, now.toISOString().split('T')[0])
                .replace(/\{\{isotime\}\}/gi, now.toTimeString().slice(0, 5))
                .replace(/\{\{lastMessage\}\}/gi, () => {
                    const msgs = ctx.chat;
                    return msgs?.[msgs.length - 1]?.mes || '';
                })
                .replace(/\{\{lastUserMessage\}\}/gi, () => {
                    const msgs = ctx.chat;
                    if (!msgs) return '';
                    for (let i = msgs.length - 1; i >= 0; i--) {
                        if (msgs[i].is_user) return msgs[i].mes || '';
                    }
                    return '';
                })
                .replace(/\{\{lastCharMessage\}\}/gi, () => {
                    const msgs = ctx.chat;
                    if (!msgs) return '';
                    for (let i = msgs.length - 1; i >= 0; i--) {
                        if (!msgs[i].is_user) return msgs[i].mes || '';
                    }
                    return '';
                })
                .replace(/\{\{description\}\}/gi, d.description || char?.description || '')
                .replace(/\{\{personality\}\}/gi, d.personality || char?.personality || '')
                .replace(/\{\{scenario\}\}/gi, d.scenario || char?.scenario || '');
        } catch (_) {
            return text;
        }
    }

    function getSystemPromptText() {
        const ctx = SillyTavern.getContext();
        return ctx.systemPrompt || ctx.system_prompt || '';
    }

    function getMainChatSlice(depth) {
        const ctx = SillyTavern.getContext();
        if (!ctx.chat) return [];
        try {
            const sess = getCurrentSession();
            const picked = sess.pickedChatIndices;
            if (picked && picked.length > 0) {
                const charInfo = getCharInfo();
                return picked
                    .filter(i => i >= 0 && i < ctx.chat.length)
                    .map(i => {
                        const m = ctx.chat[i];
                        return {
                            role: m.is_user ? 'user' : 'assistant',
                            name: m.is_user ? (ctx.name1 || 'User') : (m.name || charInfo?.name || 'Character'),
                            content: typeof m.mes === 'string' ? m.mes : '',
                            chatIndex: i,
                        };
                    })
                    .filter(Boolean);
            }
        } catch(_) {}
        if (depth === 0) return [];
        const total = ctx.chat.length;
        return ctx.chat.slice(-depth).map((m, i) => ({
            role: m.is_user ? 'user' : 'assistant',
            name: m.is_user ? (ctx.name1 || 'User') : (m.name || getCharInfo()?.name || 'Character'),
            content: typeof m.mes === 'string' ? m.mes : '',
            chatIndex: total - depth + i,
        }));
    }

    // ─── Payload Assembly ───────────────────────────────────────────────────────

    async function buildSystemContent(settings) {
        const parts = [settings.systemPrompt || DEFAULT_SYSTEM_PROMPT];
        const charInfo = getCharInfo();

        if (settings.includeSystemPrompt) {
            const sp = getSystemPromptText();
            if (sp) parts.push(`\n\n<st_system_prompt>\n${sp}\n</st_system_prompt>`);
        }

        const lbBlock = await buildLorebookContextBlock(settings);
        if (lbBlock) parts.push(lbBlock);

        if (settings.includeCharacterCard && charInfo) {
            let block = `Name: ${charInfo.name}`;
            if (charInfo.description) block += `\nDescription:\n${charInfo.description}`;
            if (charInfo.personality) block += `\nPersonality:\n${charInfo.personality}`;
            if (charInfo.scenario) block += `\nScenario:\n${charInfo.scenario}`;
            
            if (charInfo.character_note) block += `\nCharacter's Note:\n${charInfo.character_note}`;
            
            if (charInfo.mes_example) block += `\nExamples of dialogue:\n${charInfo.mes_example}`;
            parts.push(`\n\n<character_information>\n${block}\n</character_information>`);
        }

        if (settings.includeUserPersonality) {
            const p = getUserPersona();
            if (p) parts.push(`\n\n<{{user}}_persona>\n${p}\n</{{user}}_persona>`);
        }

        if (settings.includeAuthorsNote) {
            const an = getAuthorsNote();
            if (an) parts.push(`\n\n<author_notes>\n${an}\n</author_notes>`);
        }

        const aiInstructions = buildLBAIInstructions(settings);
        if (aiInstructions) parts.push(aiInstructions);

        return parts.join('\n');
    }

    async function assembleMessages(session, settings, pendingUserText) {
        const messages = [{ role: 'system', content: await buildSystemContent(settings) }];
        const depth = Math.max(0, parseInt(settings.contextDepth) || 0);
        const hasPicked = !!(session.pickedChatIndices && session.pickedChatIndices.length > 0);
        if (depth > 0 || hasPicked) {
            const slice = getMainChatSlice(depth);
            if (slice.length) {
                const block = hasPicked
                    ? slice.map(m => `[msg #${m.chatIndex + 1}][${m.name}]: ${m.content}`).join('\n\n')
                    : slice.map(m => `[${m.name}]: ${m.content}`).join('\n\n');
                const ctxAttr = hasPicked ? `picked_messages="${slice.length}"` : `last_messages="${slice.length}"`;
                messages.push({
                    role: 'user',
                    content: `<roleplay_context ${ctxAttr}>\n\n${block}\n\n</roleplay_context>`,
                });
                messages.push({ role: 'assistant', content: 'Understood. I have reviewed the current roleplay context. How can I help?' });
            }
        }
        const limit = Math.max(1, parseInt(settings.localHistoryLimit) || 50);
        for (const m of session.messages.slice(-limit)) messages.push({ role: m.role, content: m.content });
        if (pendingUserText) messages.push({ role: 'user', content: pendingUserText });
        return messages;
    }

    function formatPayloadAsText(messages) {
        return messages.map(m => {
            const label = m.role === 'system' ? '■ SYSTEM' : m.role === 'user' ? '▶ USER' : '◀ ASSISTANT';
            return `${label}\n${'─'.repeat(50)}\n${m.content}`;
        }).join('\n\n');
    }

    // ─── Connection Profile Helper ──────────────────────────────────────────────

    async function withConnectionProfile(profileName, fn) {
        if (!profileName) return fn();

        const ctx = SillyTavern.getContext();
        if (typeof ctx.executeSlashCommandsWithOptions !== 'function') return fn();

        let prevProfileName = '';
        try {
            const currentResult = await ctx.executeSlashCommandsWithOptions('/profile');
            prevProfileName = currentResult?.pipe?.trim() || '';
        } catch (e) {
            console.warn(`[${EXT_DISPLAY}] Could not get current profile:`, e);
        }

        if (prevProfileName === profileName) return fn();

        await ctx.executeSlashCommandsWithOptions(`/profile "${profileName}"`);
        await new Promise(r => setTimeout(r, 450));

        try {
            return await fn();
        } finally {
            if (prevProfileName && prevProfileName !== profileName) {
                await ctx.executeSlashCommandsWithOptions(`/profile "${prevProfileName}"`);
            }
        }
    }

    // ─── API Generation ─────────────────────────────────────────────────────────

    let _abortController = null;

    const _htmlBlockRegistry = new Map();
    let _htmlBlockCounter = 0;

    async function doCallGenerate(session, settings, pendingText) {
        if (_abortController) _abortController.abort();
        _abortController = new AbortController();
        const signal = _abortController.signal;
        const messages = await assembleMessages(session, settings, pendingText);
        const ctx = SillyTavern.getContext();
        try {
            if (typeof ctx.generateRaw === 'function') {
                const options = {
                    prompt: messages,
                    bypassAll: true,
                    signal: signal
                };
                if (settings.maxTokens) options.responseLength = parseInt(settings.maxTokens) || 2048;

                const result = await ctx.generateRaw(options);
                if (typeof result === 'string') return result.trim();
                const r = result;
                const msg = r?.choices?.[0]?.message;
                const reasoning = msg?.reasoning || msg?.reasoning_content || null;
                const content = (msg?.content || r?.choices?.[0]?.text || r?.message?.content || r?.content || '').trim();
                if (reasoning) return `<think>${reasoning}</think>\n${content}`;
                return content;
            }
            const res = await fetch('/api/backends/chat-completions/generate', {
                method: 'POST',
                headers: { ...ctx.getRequestHeaders(), 'Content-Type': 'application/json' },
                signal,
                body: JSON.stringify({ messages, max_tokens: parseInt(settings.maxTokens) || 2048, stream: false }),
            });
            if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text().catch(() => res.statusText)}`);
            const data = await res.json();
            return (data.choices?.[0]?.message?.content || data.output || '').trim();
        } catch (err) {
            if (err.name === 'AbortError') return null;
            throw err;
        } finally { _abortController = null; }
    }

    async function callGenerate(session, settings, pendingText) {
        if (settings.connectionSource === 'profile' && settings.connectionProfileId) {
            // connectionProfileId now stores the profile *name* for use with /profile slash cmd
            return withConnectionProfile(settings.connectionProfileId, () => doCallGenerate(session, settings, pendingText));
        }
        return doCallGenerate(session, settings, pendingText);
    }

    // ─── SVG Icons ──────────────────────────────────────────────────────────────

    const I = {
        copy: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
        edit: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
        trash: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
        send: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`,
        search: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
        refresh: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.51"/></svg>`,
        minus: `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
        x: `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
        plus: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
        bot: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><circle cx="8.5" cy="16" r="1" fill="currentColor"/><circle cx="15.5" cy="16" r="1" fill="currentColor"/></svg>`,
        user: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
        stop: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>`,
        book: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,
        opacity: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 0 20z" fill="currentColor"/></svg>`,
        check: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
        chevron: `<svg class="scp-sess-chevron" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>`,
        gear: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
        ghost: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 10h.01M15 10h.01M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z"/></svg>`,
        lightning: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
        pick: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="9" y1="10" x2="9" y2="10" stroke-width="3" stroke-linecap="round"/><line x1="12" y1="10" x2="12" y2="10" stroke-width="3" stroke-linecap="round"/><line x1="15" y1="10" x2="15" y2="10" stroke-width="3" stroke-linecap="round"/></svg>`,
    };

    // ─── Quick Prompts ───────────────────────────────────────────────────────────

    const QP_ICON_POOL = [
        '🔍','💡','📋','✨','🎭','📖','🗺️','⚔️','🧠','💬',
        '🎯','🔮','📝','🌍','❓','🎨','💭','🔥','⚡','🎲',
        '👁️','🧩','📚','🗣️','💫','🌟','🎬','🧪','🏆','🎵',
        '🌙','☀️','🌊','🍃','💎','🛡️','🗡️','🏰','🐉','🦋',
        '🎪','🌀','🔑','💀','🌹','🍷','🎩','🧿','🔔','⭐',
        '🐺','🦊','🐦','🌸','🍄','🔴','🟣','🔵','🟡','🟢',
    ];

    function renderQuickPromptsBar() {
        const bar = document.getElementById('scp-qp-bar');
        const toggleBtn = document.getElementById('scp-qp-toggle-btn');
        if (!bar) return;
        const s = getSettings();
        const prompts = s.quickPrompts || [];
        const visible = s.quickPromptsVisible && prompts.length > 0;

        bar.innerHTML = '';
        for (const qp of prompts) {
            const btn = document.createElement('button');
            btn.className = 'scp-qp-chip';
            const truncTitle = qp.text.length > 100 ? qp.text.slice(0, 100) + '…' : qp.text;
            btn.title = truncTitle;
            btn.innerHTML = `<span class="scp-qp-icon">${escHtml(qp.icon || '⚡')}</span><span class="scp-qp-label">${escHtml(qp.label || '')}</span>`;
            btn.addEventListener('click', () => {
                const input = document.getElementById('scp-input');
                if (!input) return;
                input.value = qp.text;
                autoResize(input);
                input.focus();
                recordStat(_SM.qp);
            });
            bar.appendChild(btn);
        }

        // Use CSS class for smooth animated show/hide
        if (visible) {
            bar.classList.add('scp-qp-bar--open');
        } else {
            bar.classList.remove('scp-qp-bar--open');
        }
        if (toggleBtn) toggleBtn.classList.toggle('active', s.quickPromptsVisible);
    }

    let _qpIconPickerEl = null;

    function showQPIconPicker(anchorEl, currentIcon, onSelect) {
        if (_qpIconPickerEl) { _qpIconPickerEl.remove(); _qpIconPickerEl = null; }
        const pop = document.createElement('div');
        pop.className = 'scp-qp-icon-picker';
        for (const emoji of QP_ICON_POOL) {
            const btn = document.createElement('button');
            btn.className = `scp-qp-icon-option${emoji === currentIcon ? ' active' : ''}`;
            btn.textContent = emoji;
            btn.addEventListener('click', () => { onSelect(emoji); pop.remove(); _qpIconPickerEl = null; });
            pop.appendChild(btn);
        }
        document.body.appendChild(pop);
        _qpIconPickerEl = pop;
        const rect = anchorEl.getBoundingClientRect();
        pop.style.cssText = `position:fixed;z-index:999999;top:${rect.bottom + 4}px;left:${rect.left}px`;
        requestAnimationFrame(() => {
            const pr = pop.getBoundingClientRect();
            if (pr.right > window.innerWidth - 8) pop.style.left = `${window.innerWidth - pr.width - 8}px`;
            if (pr.bottom > window.innerHeight - 8) pop.style.top = `${rect.top - pr.height - 6}px`;
        });
        const onOut = e => {
            if (!pop.contains(e.target) && e.target !== anchorEl) {
                pop.remove(); _qpIconPickerEl = null;
                document.removeEventListener('mousedown', onOut, true);
            }
        };
        setTimeout(() => document.addEventListener('mousedown', onOut, true), 0);
    }

    function buildQPSettingsUI(container) {
        if (!container) return;
        container.innerHTML = '';

        const list = document.createElement('div');
        list.className = 'scp-qp-settings-list';

        const renderList = () => {
            list.innerHTML = '';
            const curPrompts = getSettings().quickPrompts || [];
            if (!curPrompts.length) {
                list.innerHTML = `<div style="font-size:11px;color:var(--scp-text-muted);text-align:center;padding:10px 0">No quick prompts yet. Add one below.</div>`;
            }
            curPrompts.forEach((qp, idx) => {
                const row = document.createElement('div');
                row.className = 'scp-qp-settings-row';

                const iconBtn = document.createElement('button');
                iconBtn.className = 'scp-qp-settings-icon-btn';
                iconBtn.textContent = qp.icon || '⚡';
                iconBtn.title = 'Change icon';
                iconBtn.addEventListener('click', e => {
                    e.stopPropagation();
                    showQPIconPicker(iconBtn, qp.icon || '⚡', emoji => {
                        getSettings().quickPrompts[idx].icon = emoji;
                        saveSettings(); iconBtn.textContent = emoji; renderQuickPromptsBar();
                    });
                });

                const labelInput = document.createElement('input');
                labelInput.type = 'text'; labelInput.className = 'scp-qp-settings-label-input scp-sp-input';
                labelInput.placeholder = 'Label'; labelInput.value = qp.label || '';
                labelInput.addEventListener('input', () => {
                    getSettings().quickPrompts[idx].label = labelInput.value;
                    saveSettings(); renderQuickPromptsBar();
                });

                const moveUpBtn = document.createElement('button');
                moveUpBtn.className = 'scp-qp-settings-move'; moveUpBtn.textContent = '↑';
                moveUpBtn.title = 'Move up'; moveUpBtn.disabled = idx === 0;
                moveUpBtn.addEventListener('click', () => {
                    if (idx === 0) return;
                    const arr = getSettings().quickPrompts;
                    [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
                    saveSettings(); renderList(); renderQuickPromptsBar();
                });

                const moveDnBtn = document.createElement('button');
                moveDnBtn.className = 'scp-qp-settings-move'; moveDnBtn.textContent = '↓';
                moveDnBtn.title = 'Move down'; moveDnBtn.disabled = idx === curPrompts.length - 1;
                moveDnBtn.addEventListener('click', () => {
                    const arr = getSettings().quickPrompts;
                    if (idx >= arr.length - 1) return;
                    [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
                    saveSettings(); renderList(); renderQuickPromptsBar();
                });

                const delBtn = document.createElement('button');
                delBtn.className = 'scp-qp-settings-del'; delBtn.innerHTML = I.trash; delBtn.title = 'Delete';
                delBtn.addEventListener('click', async () => {
                    const ok = await showCustomDialog({ type: 'confirm', title: 'Delete Prompt', message: `Delete "${qp.label || 'this prompt'}"?` });
                    if (!ok) return;
                    getSettings().quickPrompts.splice(idx, 1);
                    saveSettings(); renderList(); renderQuickPromptsBar();
                });

                const textArea = document.createElement('textarea');
                textArea.className = 'scp-qp-settings-text scp-sp-textarea';
                textArea.placeholder = 'Prompt text… (supports {{user}}, {{char}} macros)';
                textArea.rows = 2; textArea.value = qp.text || '';
                textArea.addEventListener('input', () => { getSettings().quickPrompts[idx].text = textArea.value; saveSettings(); });

                const controls = document.createElement('div');
                controls.className = 'scp-qp-settings-controls';
                controls.appendChild(moveUpBtn); controls.appendChild(moveDnBtn); controls.appendChild(delBtn);

                const top = document.createElement('div');
                top.className = 'scp-qp-settings-row-top';
                top.appendChild(iconBtn); top.appendChild(labelInput); top.appendChild(controls);

                row.appendChild(top); row.appendChild(textArea);
                list.appendChild(row);
            });
        };

        renderList();

        const addBtn = document.createElement('button');
        addBtn.className = 'scp-action-btn'; addBtn.style.marginTop = '8px';
        addBtn.innerHTML = `${I.plus}<span>Add Prompt</span>`;
        addBtn.addEventListener('click', async () => {
            const label = await showCustomDialog({ type: 'prompt', title: 'New Quick Prompt', message: 'Label for this prompt:', placeholder: 'My Prompt' });
            if (label === null) return;
            getSettings().quickPrompts.push({ id: genId('qp'), label: label.trim() || 'Prompt', icon: '⚡', text: '' });
            saveSettings(); renderList(); renderQuickPromptsBar();
        });

        container.appendChild(list); container.appendChild(addBtn);
    }

    // ─── Chat Message Picker ──────────────────────────────────────────────────────

    let _pickerLastIdx = -1;

    function getPickedChatIndices() {
        try { return getCurrentSession().pickedChatIndices || []; } catch(_) { return []; }
    }

    function setPickedChatIndices(indices) {
        try {
            const sess = getCurrentSession();
            sess.pickedChatIndices = [...indices].sort((a, b) => a - b);
            saveSettings();
            updatePickBtnState();
            updateMsgCount(sess);
        } catch(_) {}
    }

    function updatePickBtnState() {
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

    function openChatPicker() {
        const overlay = document.getElementById('scp-picker-overlay');
        if (!overlay) return;
        applyCustomTheme(getSettings().customTheme || THEME_PRESETS.default);
        _pickerLastIdx = -1;
        renderPickerMessages();
        overlay.style.display = 'flex';
    }

    function closeChatPicker() {
        const overlay = document.getElementById('scp-picker-overlay');
        if (overlay) overlay.style.display = 'none';
    }

    function renderPickerMessages() {
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
            idxEl.textContent = `#${idx + 1}`;

            const nameEl = document.createElement('span');
            nameEl.className = 'scp-picker-name';
            nameEl.textContent = name;

            meta.appendChild(idxEl);
            meta.appendChild(nameEl);

            const textEl = document.createElement('div');
            textEl.className = 'scp-picker-text';
            const raw = (msg.mes || '').replace(/<[^>]+>/g, '').trim();
            textEl.textContent = raw.length > 150 ? raw.slice(0, 150) + '…' : raw;

            const infoCol = document.createElement('div');
            infoCol.className = 'scp-picker-info-col';
            infoCol.appendChild(meta);
            infoCol.appendChild(textEl);

            row.appendChild(cb);
            row.appendChild(infoCol);

            row.addEventListener('click', e => {
                const curIdx = parseInt(row.dataset.idx);
                if (e.shiftKey && _pickerLastIdx >= 0) {
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

    function _updatePickerCountEl(count) {
        const el = document.getElementById('scp-picker-count');
        if (!el) return;
        const n = count !== undefined ? count : document.querySelectorAll('#scp-picker-body .scp-picker-row.selected').length;
        el.textContent = `${n} selected`;
    }

    function setupChatPickerListeners() {
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
            setPickedChatIndices(indices);
            closeChatPicker();
        });
    }

    // ─── DOM References ─────────────────────────────────────────────────────────

    let windowEl, iconEl, modalEl;

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
                console.error(`[${EXT_DISPLAY}] Не удалось загрузить HTML: ${templateName}.html`);
            }
        };

        await loadAndInject('window');
        await loadAndInject('lorebook_manager');
        await loadAndInject('settings_overlay');
        await loadAndInject('chat_picker');

        windowEl = document.getElementById(WIN_ID);
        iconEl = document.getElementById(ICON_ID);
        modalEl = document.getElementById(MODAL_ID);

        // Ensure dock icon is a direct child of body so display:none on windowEl doesn't cascade to it
        if (iconEl && iconEl.parentElement !== document.body) {
            document.body.appendChild(iconEl);
        }
    }

    function $(id) { return document.getElementById(id); }

    // ─── Message Rendering ──────────────────────────────────────────────────────

    function renderMarkdown(text) {
        const codeBlocks = [];
        let out = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
            if (lang && lang.toLowerCase() === 'html') {
                const id = `scp-hb-${_htmlBlockCounter++}`;
                _htmlBlockRegistry.set(id, code.trim());
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

        return out;
    }

    function prepareHtmlForIframe(code) {
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
    // 1. computed styles on html + body
    if(hasVisualBg(d)||hasVisualBg(b)) hasBg=true;
    // 2. any element with inline style containing background
    if(!hasBg){
        var styled=document.querySelectorAll('[style]');
        for(var i=0;i<styled.length;i++){if(hasVisualBg(styled[i])){hasBg=true;break;}}
    }
    // 3. <style> tags with body/html/root background rules
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

    function createHTMLBlockEl(code) {
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

    function postProcessHTMLBlocks(el) {
        el.querySelectorAll('.scp-html-block-ph').forEach(ph => {
            const code = _htmlBlockRegistry.get(ph.dataset.hbid);
            if (code !== undefined) ph.replaceWith(createHTMLBlockEl(code));
        });
    }

    function getDisplayContent(rawText, settings) {
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

    function createMsgEl(msg, onCopy, onEdit, onDelete, onRegen) {
        const isUser = msg.role === 'user';
        const wrap = document.createElement('div');
        wrap.className = `scp-msg ${isUser ? 'scp-msg-user' : 'scp-msg-assistant'}`;
        wrap.dataset.id = msg.id;

        const avatar = document.createElement('div');
        avatar.className = 'scp-msg-avatar';
        avatar.innerHTML = isUser ? I.user : I.bot;

        const body = document.createElement('div');
        body.className = 'scp-msg-body';

        let reasoning = null;
        let displayText = msg.content;
        if (!isUser) {
            const d = getDisplayContent(msg.content, getSettings());
            reasoning = d.reasoning;
            displayText = d.content;
        }

        if (reasoning !== null) {
            const rBlock = document.createElement('details');
            rBlock.className = 'scp-reasoning-block';
            const summary = document.createElement('summary');
            summary.className = 'scp-reasoning-summary';
            summary.textContent = 'Reasoning';
            const rc = document.createElement('div');
            rc.className = 'scp-reasoning-content';
            rc.innerHTML = renderMarkdown(reasoning);
            rBlock.appendChild(summary);
            rBlock.appendChild(rc);
            body.appendChild(rBlock);
        }

        const content = document.createElement('div');
        content.className = 'scp-msg-content';
        content.innerHTML = renderMarkdown(displayText);
        postProcessHTMLBlocks(content);

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

        body.appendChild(content); body.appendChild(actions); body.appendChild(meta);
        wrap.appendChild(avatar); wrap.appendChild(body);
        return wrap;
    }

    function scrollToBottom() { const c = $('scp-messages'); if (c) c.scrollTop = c.scrollHeight; }

    function renderSession(session) {
        clearSearchHighlights();
        _searchMatches = [];
        _searchIdx = -1;
        updateSearchCount();
        const c = $('scp-messages');
        if (!c) return;
        c.innerHTML = '';
        if (!session.messages.length) {
            c.innerHTML = `
                <div class="scp-empty-state">
                    <div class="scp-empty-icon">
                        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><circle cx="8.5" cy="16" r="1" fill="currentColor"/><circle cx="15.5" cy="16" r="1" fill="currentColor"/></svg>
                    </div>
                    <div class="scp-empty-title">New Session</div>
                    <div class="scp-empty-sub">Ask anything about your roleplay — continuity checks, character analysis, writing feedback, worldbuilding, and more.</div>
                </div>`;
            updateMsgCount(session);
            return;
        }
        for (const msg of session.messages) {
            if (msg.isLBHistory) {
                appendLBHistoryEl(msg);
            } else {
                const el = createMsgEl(msg, handleCopy, handleEdit, handleDelete, handleMessageRegen);
                c.appendChild(el);
                if (msg.role === 'assistant') {
                    const changes = parseLBChangesFromText(msg.content);
                    if (changes?.length) {
                        const contentEl = el.querySelector('.scp-msg-content');
                        if (contentEl) {
                            const { content } = getDisplayContent(stripLBChangesBlock(msg.content), getSettings());
                            contentEl.innerHTML = renderMarkdown(content);
                            postProcessHTMLBlocks(contentEl);
                        }
                        renderProposalCard(changes, el);
                    }
                }
            }
        }
        updateMsgCount(session);
        scrollToBottom();
    }

    function appendMsgEl(msg) {
        const c = $('scp-messages');
        if (!c) return;
        c.querySelector('.scp-empty-state')?.remove();

        // Remove stale proposal card if this assistant message is being replaced
        if (msg.role === 'assistant') {
            document.querySelectorAll('.scp-lb-proposal-card').forEach(card => {
                const prevSib = card.previousElementSibling;
                if (!prevSib || !prevSib.dataset.id) card.remove();
            });
        }

        const el = createMsgEl(msg, handleCopy, handleEdit, handleDelete, handleMessageRegen);
        c.appendChild(el);
        updateMsgCount(getCurrentSession());
        scrollToBottom();

        if (msg.role === 'assistant') {
            const changes = parseLBChangesFromText(msg.content);
            if (changes?.length) {
                const contentEl = el.querySelector('.scp-msg-content');
                if (contentEl) {
                    const { content } = getDisplayContent(stripLBChangesBlock(msg.content), getSettings());
                    contentEl.innerHTML = renderMarkdown(content);
                    postProcessHTMLBlocks(contentEl);
                }
                renderProposalCard(changes, el);
            }
        }

        if (_searchOpen && _searchQuery.trim()) {
            const newMarks = _applyHighlightsInRoot(el);
            if (newMarks.length) {
                _searchMatches.push(...newMarks);
                updateSearchCount();
            }
        }
    }

    function removeMsgEl(msgId) {
        const el = document.querySelector(`.scp-msg[data-id="${msgId}"]`);
        if (!el) return;
        document.querySelector(`.scp-lb-proposal-card[data-for="${msgId}"]`)?.remove();
        el.remove();
    }

    function removeMsgElAndBelow(msgId) {
        const c = $('scp-messages'); if (!c) return;
        let found = false;
        for (const el of [...c.querySelectorAll('.scp-msg')]) {
            if (el.dataset.id === msgId) found = true;
            if (found) {
                document.querySelector(`.scp-lb-proposal-card[data-for="${el.dataset.id}"]`)?.remove();
                el.remove();
            }
        }
        c.querySelectorAll('.scp-lb-proposal-card').forEach(card => {
            if (!card.previousElementSibling) card.remove();
        });
    }

    function removeMsgElAfter(msgId) {
        const c = $('scp-messages'); if (!c) return;
        let found = false;
        for (const el of [...c.querySelectorAll('.scp-msg')]) {
            if (found) {
                document.querySelector(`.scp-lb-proposal-card[data-for="${el.dataset.id}"]`)?.remove();
                el.remove();
            }
            if (el.dataset.id === msgId) found = true;
        }
    }

    let _tokenCalcTid = null;

    async function estimateTokens(text) {
        if (!text) return 0;
        const ctx = SillyTavern.getContext();
        try {
            if (typeof ctx.getTokenCount === 'function') return ctx.getTokenCount(text);
            if (typeof window.getTokenCount === 'function') return window.getTokenCount(text);
        } catch (_) {}
        try {
            const res = await fetch('/api/tokencount', {
                method: 'POST',
                headers: { ...ctx.getRequestHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ text })
            });
            if (res.ok) {
                const data = await res.json();
                if (typeof data.length === 'number') return data.length;
                if (typeof data.count === 'number') return data.count;
                if (typeof data === 'number') return data;
            }
        } catch (_) {}
        return Math.ceil(text.length / 3.5);
    }

    function updateMsgCount(session) {
        const el = $('scp-msg-count');
        if (el && session) el.textContent = `${session.messages.length} msgs`;
        
        const tel = $('scp-token-count');
        if (tel && session) {
            clearTimeout(_tokenCalcTid);
            tel.textContent = '... tkns';
            _tokenCalcTid = setTimeout(async () => {
                const settings = getEffectiveSettings();
                const messages = await assembleMessages(session, settings, null);
                const fullText = messages.map(m => m.content).join('\n');
                const count = await estimateTokens(fullText);
                if (tel) tel.textContent = `~${count} tkns`;
            }, 600);
        }
    }

    function getCurrentSession() {
        const { charId, chatId } = getBindingKey();
        return getActiveSession(charId, chatId);
    }

    // ─── Clipboard Helper ────────────────────────────────────────────────────────

    function fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;width:1px;height:1px;';
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        try { document.execCommand('copy'); toastr.success('Copied', EXT_DISPLAY); }
        catch (e) { toastr.error('Copy failed', EXT_DISPLAY); }
        ta.remove();
    }

    function copyText(text) {
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text)
                .then(() => toastr.success('Copied', EXT_DISPLAY))
                .catch(() => fallbackCopy(text));
        } else { fallbackCopy(text); }
    }

    // ─── Message Interaction Handlers ───────────────────────────────────────────

    function handleCopy(msg) { copyText(msg.content); }

    function handleEdit(wrapEl, msg) {
        if (wrapEl.classList.contains('is-editing')) return;
        wrapEl.classList.add('is-editing');
        const { charId, chatId } = getBindingKey();
        const session = getActiveSession(charId, chatId);
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
            let displayString = textToRender;

            if (msg.role === 'assistant') {
                const changes = parseLBChangesFromText(textToRender);
                if (changes?.length) {
                    displayString = stripLBChangesBlock(textToRender);
                    renderProposalCard(changes, wrapEl);
                } else {
                    document.querySelector(`.scp-lb-proposal-card[data-for="${msg.id}"]`)?.remove();
                }
                const d = getDisplayContent(displayString, getSettings());
                displayString = d.content;
            }

            nc.innerHTML = renderMarkdown(displayString);
            postProcessHTMLBlocks(nc);
            ta.replaceWith(nc); 
            row.remove(); 
            wrapEl.classList.remove('is-editing');
        };

        cancelBtn.addEventListener('click', () => {
            restoreMessageDOM(original);
        });

        if (saveOnlyBtn) {
            saveOnlyBtn.addEventListener('click', () => {
                const rawText = ta.value.trim();
                if (!rawText) return;
                const newText = expandMacros(rawText);
                updateMessage(session, msg.id, newText);
                msg.content = newText;
                recordStat(_SM.edit);
                restoreMessageDOM(newText);
            });
        }

        saveBtn.addEventListener('click', async () => {
            const rawText = ta.value.trim();
            if (!rawText) return;
            const newText = expandMacros(rawText);
            updateMessage(session, msg.id, newText);
            msg.content = newText;
            recordStat(_SM.edit);
            restoreMessageDOM(newText);
            
            truncateAfter(session, msg.id);
            removeMsgElAfter(msg.id);
            if (msg.role === 'user') await runGenerate(session, newText, false);
        });
    }

    async function handleMessageRegen(wrapEl, msg) {
        if (_generating) return;
        const { charId, chatId } = getBindingKey();
        const session = getActiveSession(charId, chatId);
        const idx = session.messages.findIndex(m => m.id === msg.id);
        if (idx === -1) return;

        const isUser = msg.role === 'user';
        
        const actualMsgsAfter = session.messages.slice(idx + 1).filter(m => !m.isLBHistory);
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
        } else {
            truncateFrom(session, msg.id);
            removeMsgElAndBelow(msg.id);
        }
        
        updateMsgCount(session);
        recordStat(_SM.regen);
        runGenerate(session, null, false);
    }

    async function handleDelete(wrapEl, msg) {
        const isUser = msg.role === 'user';
        const confirmed = await showCustomDialog({
            type: 'confirm',
            title: 'Delete Message',
            message: isUser
                ? 'Delete this message and all subsequent messages?'
                : 'Delete this assistant message?',
        });
        if (!confirmed) return;
        const { charId, chatId } = getBindingKey();
        const session = getActiveSession(charId, chatId);
        if (isUser) {
            truncateFrom(session, msg.id);
            removeMsgElAndBelow(msg.id);
        } else {
            deleteMsg(session, msg.id);
            removeMsgEl(msg.id);
        }
        updateMsgCount(session);
        // Show empty state if no messages left
        if (!session.messages.length) renderSession(session);
    }

    // ─── Chat Search ─────────────────────────────────────────────────────────────

    let _searchQuery = '';
    let _searchMatches = [];
    let _searchIdx = -1;
    let _searchDebounceId = null;
    let _searchOpen = false;
    let _searchWholeWord = false;

    function openSearch() {
        _searchOpen = true;
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

    function closeSearch() {
        _searchOpen = false;
        _searchWholeWord = false;
        document.getElementById('scp-search-bar')?.classList.remove('scp-search-open');
        document.getElementById('scp-search-btn')?.classList.remove('active');
        document.getElementById('scp-search-word')?.classList.remove('active');
        clearSearchHighlights();
        _searchMatches = [];
        _searchIdx = -1;
        const inp = document.getElementById('scp-search-input');
        if (inp) inp.value = '';
        _searchQuery = '';
        updateSearchCount();
    }

    function clearSearchHighlights() {
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

    function updateSearchCount() {
        const el = document.getElementById('scp-search-count');
        if (!el) return;
        el.textContent = (_searchMatches.length && _searchQuery)
            ? `${_searchIdx + 1}/${_searchMatches.length}`
            : '';
    }

    function _applyHighlightsInRoot(root) {
        const lq = _searchQuery.toLowerCase();
        let regex = null;
        if (_searchWholeWord) {
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
                    mark.textContent = text.slice(idx, idx + _searchQuery.length);
                    frag.appendChild(mark);
                    newMarks.push(mark);
                    lastIndex = idx + _searchQuery.length;
                    idx = lower.indexOf(lq, lastIndex);
                }
            }

            if (lastIndex === 0) continue;
            if (lastIndex < text.length) frag.appendChild(document.createTextNode(text.slice(lastIndex)));
            node.parentNode.replaceChild(frag, node);
        }
        return newMarks;
    }

    function performSearch() {
        clearSearchHighlights();
        _searchMatches = [];
        _searchIdx = -1;
        const q = _searchQuery.trim();
        if (!q) { updateSearchCount(); return; }
        const container = document.getElementById('scp-messages');
        if (!container) return;
        _searchMatches = _applyHighlightsInRoot(container);
        if (_searchMatches.length) {
            _searchIdx = 0;
            _searchMatches[0].classList.add('scp-search-current');
            _searchMatches[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        updateSearchCount();
    }

    function navigateSearch(dir) {
        if (!_searchMatches.length) return;
        _searchMatches[_searchIdx]?.classList.remove('scp-search-current');
        _searchIdx = (_searchIdx + dir + _searchMatches.length) % _searchMatches.length;
        const cur = _searchMatches[_searchIdx];
        cur.classList.add('scp-search-current');
        cur.scrollIntoView({ block: 'center', behavior: 'smooth' });
        updateSearchCount();
    }

    // ─── Generation Flow ────────────────────────────────────────────────────────


    let _generating = false;

    async function runGenerate(session, userText, addUserMsg = true) {
        if (_generating) return;
        _generating = true;
        const settings = getEffectiveSettings();
        setGeneratingState(true);
        let userMsg = null;
        try {
            if (addUserMsg && userText) { 
                userMsg = addMessage(session, 'user', userText); 
                appendMsgEl(userMsg);
                recordStat(_SM.msg);
            }
            const fullMessages = await assembleMessages(session, settings, userText);
            const fullPromptText = fullMessages.map(m => m.content).join('\n');
            const result = await callGenerate(session, settings, userText);
            if (result === null) return;
            appendMsgEl(addMessage(session, 'assistant', result));
            estimateTokens(fullPromptText).then(n => { if (n > 0) recordStat(_SM.tokIn, n); });
            if (result) recordStat(_SM.tokOut, Math.ceil(result.length / 3.5));
        } catch (err) {
            console.error(`[${EXT_DISPLAY}]`, err);
            toastr.error(`Generation failed: ${err.message}`, EXT_DISPLAY);
        } finally { 
            _generating = false; 
            setGeneratingState(false); 
        }
    }

    function setGeneratingState(on) {
        const bar = $('scp-thinking-bar'), sendBtn = $('scp-send-btn'),
              input = $('scp-input'), regenBtn = $('scp-regen-btn');
        if (bar) bar.style.display = on ? 'flex' : 'none';
        if (sendBtn) sendBtn.disabled = on;
        if (input) input.disabled = on;
        if (regenBtn) regenBtn.disabled = on;
    }

    function handleSend() {
        const input = $('scp-input'); if (!input) return;
        const rawText = input.value.trim();
        if (!rawText || _generating) return;
        const text = expandMacros(rawText);  // expand {{user}}, {{char}}, etc.
        input.value = ''; autoResize(input);
        runGenerate(getCurrentSession(), text, true);
    }

    function handleRegen() {
        if (_generating) return;
        const sess = getCurrentSession(); if (!sess.messages.length) return;
        let lastUserIdx = -1;
        for (let i = sess.messages.length - 1; i >= 0; i--) {
            if (sess.messages[i].role === 'user') { lastUserIdx = i; break; }
        }
        if (lastUserIdx === -1) return;
        const userMsg = sess.messages[lastUserIdx];
        truncateAfter(sess, userMsg.id); removeMsgElAfter(userMsg.id);
        recordStat(_SM.regen);
        runGenerate(sess, userMsg.content, false);
    }

    // ─── Context Inspector ──────────────────────────────────────────────────────

    async function openInspector() {
        const sess = getCurrentSession(); const settings = getEffectiveSettings();
        const messages = await assembleMessages(sess, settings, null);
        const fmtEl = $('scp-ctx-formatted'); const jsonEl = $('scp-ctx-json');
        if (fmtEl) fmtEl.textContent = formatPayloadAsText(messages);
        if (jsonEl) jsonEl.textContent = JSON.stringify(messages, null, 2);
        modalEl.style.display = 'flex';
    }

    // ─── Drag & Resize ──────────────────────────────────────────────────────────

    function getEvCoords(e) {
        if (e.touches && e.touches.length > 0) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        return { x: e.clientX, y: e.clientY };
    }

    function makeDraggable(handle, target) {
        // ... Оставляем старый код для окна (windowEl) ...
        let active = false, ox = 0, oy = 0, sl = 0, st = 0;
        let _rafId = null, _px = 0, _py = 0;

        const flush = () => {
            target.style.left = `${Math.max(0, _px)}px`;
            target.style.top = `${Math.max(0, _py)}px`;
            target.style.right = 'auto'; target.style.bottom = 'auto';
            _rafId = null;
        };

        handle.addEventListener('pointerdown', e => {
            if (e.target.closest('.scp-hbtn,.scp-tbtn,select,input,button,.scp-opacity-wrap,.scp-rh,.scp-sess-dropdown,.scp-sess-wrap')) return;
            active = true;
            const r = target.getBoundingClientRect();
            ox = e.clientX; oy = e.clientY; sl = r.left; st = r.top;
            handle.setPointerCapture(e.pointerId);
            target.classList.add('scp-dragging');
            e.preventDefault();
        });

        handle.addEventListener('pointermove', e => {
            if (!active) return;
            _px = sl + (e.clientX - ox); _py = st + (e.clientY - oy);
            if (!_rafId) _rafId = requestAnimationFrame(flush);
        });

        const onEnd = () => {
            if (!active) return;
            active = false;
            if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; flush(); }
            target.classList.remove('scp-dragging');
            saveWindowState();
        };

        handle.addEventListener('pointerup', onEnd);
        handle.addEventListener('pointercancel', onEnd);
        handle.style.touchAction = 'none';
    }

    function makeResizable(target) {
        // ... Оставляем код для resize окна ...
        const MIN_W = 320, MIN_H = 300;
        target.querySelectorAll('.scp-rh').forEach(h => {
            const dir = [...h.classList].find(c => /^scp-rh-\w/.test(c))?.replace('scp-rh-', '') || '';
            let active = false, sw, sh, sl, st, sx, sy, _rafId = null, _s = {};

            const flush = () => {
                if (_s.w !== undefined) target.style.width = `${_s.w}px`;
                if (_s.h !== undefined) target.style.height = `${_s.h}px`;
                if (_s.l !== undefined) { target.style.left = `${_s.l}px`; target.style.right = 'auto'; }
                if (_s.t !== undefined) target.style.top = `${_s.t}px`;
                _rafId = null;
            };

            h.addEventListener('pointerdown', e => {
                e.preventDefault(); e.stopPropagation();
                active = true; _s = {};
                const r = target.getBoundingClientRect();
                sx = e.clientX; sy = e.clientY; sw = r.width; sh = r.height; sl = r.left; st = r.top;
                h.setPointerCapture(e.pointerId);
                target.classList.add('scp-resizing');
            });

            h.addEventListener('pointermove', e => {
                if (!active) return;
                const dx = e.clientX - sx, dy = e.clientY - sy;
                _s = {};
                if (dir.includes('e')) _s.w = Math.max(MIN_W, sw + dx);
                if (dir.includes('s')) _s.h = Math.max(MIN_H, sh + dy);
                if (dir.includes('w')) { const nw = Math.max(MIN_W, sw - dx); _s.w = nw; _s.l = sl + (sw - nw); }
                if (dir.includes('n')) { const nh = Math.max(MIN_H, sh - dy); _s.h = nh; _s.t = st + (sh - nh); }
                if (!_rafId) _rafId = requestAnimationFrame(flush);
            });

            h.addEventListener('pointerup', e => {
                if (!active) return;
                active = false;
                if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; flush(); }
                target.classList.remove('scp-resizing');
                saveWindowState();
            });

            h.addEventListener('pointercancel', () => {
                active = false;
                if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
                target.classList.remove('scp-resizing');
            });

            h.style.touchAction = 'none';
        });
    }

    function makeIconDraggable(iconTarget) {
        let dragging = false;
        let offsetX = 0, offsetY = 0;

        iconTarget.addEventListener('pointerdown', e => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            dragging = false;
            const r = iconTarget.getBoundingClientRect();
            offsetX = e.clientX - r.left;
            offsetY = e.clientY - r.top;
            iconTarget.setPointerCapture(e.pointerId);
            e.preventDefault();
        });

        iconTarget.addEventListener('pointermove', e => {
            if (!iconTarget.hasPointerCapture(e.pointerId)) return;
            const r = iconTarget.getBoundingClientRect();
            const dx = e.clientX - r.left - offsetX;
            const dy = e.clientY - r.top - offsetY;
            
            if (!dragging && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
                dragging = true;
                iconTarget.classList.add('scp-icon-dragging');
            }

            if (dragging) {
                const viewportWidth = window.visualViewport ? window.visualViewport.width : window.innerWidth;
                const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
                
                const x = Math.max(0, Math.min(viewportWidth - 46, e.clientX - offsetX)); // 46 = ширина иконки
                const y = Math.max(0, Math.min(viewportHeight - 46, e.clientY - offsetY));
                
                iconTarget.style.left = `${x}px`;
                iconTarget.style.top = `${y}px`;
                iconTarget.style.bottom = 'auto';
                iconTarget.style.right = 'auto';
            }
        });

        iconTarget.addEventListener('pointerup', e => {
            if (iconTarget.hasPointerCapture(e.pointerId)) {
                iconTarget.releasePointerCapture(e.pointerId);
            }
            iconTarget.classList.remove('scp-icon-dragging');
            
            if (dragging) {
                localStorage.setItem(ICON_STORAGE_KEY, JSON.stringify({
                    left: iconTarget.style.left,
                    top: iconTarget.style.top,
                }));
                dragging = false;
            } else {
                toggleVisibility();
            }
        });

        iconTarget.addEventListener('pointercancel', e => {
            if (iconTarget.hasPointerCapture(e.pointerId)) {
                iconTarget.releasePointerCapture(e.pointerId);
            }
            dragging = false;
            iconTarget.classList.remove('scp-icon-dragging');
        });

        iconTarget.style.touchAction = 'none';
    }

    // ─── Theme ──────────────────────────────────────────────────────────────────

    function applyCustomTheme(theme) {
        if (!theme) return;
        const targets = [windowEl, iconEl, document.getElementById('scp-lb-overlay'), document.getElementById('scp-diff-modal'), document.getElementById('scp-settings-overlay'), document.getElementById('scp-picker-overlay')].filter(Boolean);
        for (const [key, cssVar] of Object.entries(THEME_CSS_MAP)) {
            if (theme[key] !== undefined && theme[key] !== '') {
                targets.forEach(t => t.style.setProperty(cssVar, theme[key]));
            }
        }
        if (theme.font) targets.forEach(t => t.style.setProperty('--scp-font', theme.font));
    }

    // ─── Window State ───────────────────────────────────────────────────────────

    function saveWindowState() {
        const s = getSettings(); if (!windowEl) return;
        const r = windowEl.getBoundingClientRect();
        s.windowX = r.left; s.windowY = r.top; s.windowW = r.width; s.windowH = r.height;
        saveSettings();
    }

    function _getViewportSize() {
        const vv = window.visualViewport;
        return {
            w: vv ? vv.width : window.innerWidth,
            h: vv ? vv.height : window.innerHeight,
        };
    }

    function restoreWindowState() {
        const s = getSettings(); if (!windowEl) return;
        const isMobile = window.innerWidth <= 900 || ('ontouchstart' in window && window.innerWidth <= 1366);
        
        const w = s.windowW || 440;
        const h = s.windowH || 600;
        
        if (s.windowX !== null) {
            const maxLeft = Math.max(0, window.innerWidth - (isMobile ? window.innerWidth * 0.94 : w));
            windowEl.style.left = `${Math.max(0, Math.min(s.windowX, maxLeft))}px`;
            const maxTop = Math.max(0, window.innerHeight - 100);
            windowEl.style.top = `${Math.max(0, Math.min(s.windowY ?? 80, maxTop))}px`;
            windowEl.style.right = 'auto';
        } else if (isMobile) {
            windowEl.style.left = '3vw';
            windowEl.style.top = '8vh';
            windowEl.style.right = 'auto';
        }
        
        if (iconEl) {
            const savedIconPos = localStorage.getItem(ICON_STORAGE_KEY);
            let posValid = false;
            const vw = window.visualViewport ? window.visualViewport.width : window.innerWidth;
            const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
            const iconSize = 46;

            if (savedIconPos) {
                try {
                    const pos = JSON.parse(savedIconPos);
                    const left = parseFloat(pos.left);
                    const top = parseFloat(pos.top);
                    if (!isNaN(left) && !isNaN(top) && left >= 0 && top >= 0 && left + iconSize <= vw && top + iconSize <= vh) {
                        iconEl.style.left = `${left}px`;
                        iconEl.style.top = `${top}px`;
                        iconEl.style.bottom = 'auto';
                        iconEl.style.right = 'auto';
                        posValid = true;
                    }
                } catch {
                    localStorage.removeItem(ICON_STORAGE_KEY);
                }
            }
            
            if (!posValid) {
                // Явно вычисляем и задаём стартовую позицию через JS (left/top)
                // чтобы избежать багов с позиционированием через right/bottom в мобильном Safari/Chrome
                const defaultRight = isMobile ? 16 : 20;
                const defaultBottom = isMobile ? 120 : 80;
                iconEl.style.left = `${Math.max(0, vw - iconSize - defaultRight)}px`;
                iconEl.style.top = `${Math.max(0, vh - iconSize - defaultBottom)}px`;
                iconEl.style.bottom = 'auto';
                iconEl.style.right = 'auto';
            }
        }
        
        if (isMobile) {
            windowEl.style.width = `${Math.min(w, Math.floor(window.innerWidth * 0.94), 560)}px`;
            windowEl.style.height = `${Math.min(h, Math.floor(window.innerHeight * 0.82), 700)}px`;
        } else {
            windowEl.style.width = `${w}px`;
            windowEl.style.height = `${h}px`;
        }
        windowEl.style.opacity = ((s.opacity || 95) / 100).toString();
        applyCustomTheme(s.customTheme || THEME_PRESETS.default);
    }

    // ─── Visibility ─────────────────────────────────────────────────────────────

    function updateIconVisibility() {
        if (!iconEl) return;
        const s = getSettings();
        
        if (!s.enabled) {
            iconEl.style.setProperty('display', 'none', 'important');
            return;
        }
        
        const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
        
        // Показываем если: закрыто, свернуто, persistent ИЛИ это мобилка
        if (!s.windowVisible || s.minimized || s.floatingIconPersistent || isTouchDevice) {
            iconEl.style.setProperty('display', 'flex', 'important');
        } else {
            iconEl.style.setProperty('display', 'none', 'important');
        }
    }

    function minimize() { 
        setGhostMode(false); 
        const s = getSettings(); 
        s.minimized = true; 
        windowEl.style.display = 'none'; 
        saveSettings(); 
        updateIconVisibility();
    }
    
    function restoreFromMinimize() { 
        const s = getSettings(); 
        s.minimized = false; 
        windowEl.style.display = 'flex'; 
        saveSettings(); 
        updateIconVisibility();
        scrollToBottom(); 
    }
    
    function hideWindow() { 
        setGhostMode(false); 
        const s = getSettings(); 
        s.windowVisible = false; 
        s.minimized = false; 
        windowEl.style.display = 'none'; 
        saveSettings(); 
        updateIconVisibility();
    }
    
    function showWindow() {
        const s = getSettings(); 
        if (!s.enabled) { toastr.warning('ST-Copilot is disabled.', EXT_DISPLAY); return; }
        s.windowVisible = true; 
        s.minimized = false;
        windowEl.style.display = 'flex';
        saveSettings(); 
        updateIconVisibility();
        scrollToBottom();
    }
    
    function toggleVisibility() {
        const s = getSettings();
        if (!s.windowVisible || s.minimized) { showWindow(); return; }
        if (s.floatingIconPersistent) { hideWindow(); } else { minimize(); }
    }

    // ─── Ghost Mode ──────────────────────────────────────────────────────────────

    let _ghostModeActive = false;
    let _ghostHotkeyHandler = null;

    function setGhostMode(enabled) {
        _ghostModeActive = enabled;
        if (!windowEl) return;
        const s = getSettings();
        const ghostBtn = document.getElementById('scp-ghost-btn');

        if (enabled) {
            const opacity = Math.max(15, Math.min(50, s.ghostModeOpacity ?? 15)) / 100;
            windowEl.classList.add('scp-ghost-mode');
            windowEl.style.opacity = opacity.toString();
            ghostBtn?.classList.add('active');
        } else {
            windowEl.classList.remove('scp-ghost-mode');
            windowEl.style.opacity = ((s.opacity ?? 95) / 100).toString();
            ghostBtn?.classList.remove('active');
        }
    }

    function toggleGhostMode() {
        if (!windowEl || windowEl.style.display === 'none') return;
        setGhostMode(!_ghostModeActive);
    }

    function setupGhostHotkey() {
        if (_ghostHotkeyHandler) document.removeEventListener('keydown', _ghostHotkeyHandler);
        _ghostHotkeyHandler = null;
        const s = getSettings();
        if (!s.ghostModeHotkeyEnabled || !s.ghostModeHotkey) return;
        const parts = s.ghostModeHotkey.toLowerCase().split('+').map(p => p.trim());
        const key = parts[parts.length - 1];
        const needAlt = parts.includes('alt');
        const needCtrl = parts.includes('ctrl') || parts.includes('control');
        const needShift = parts.includes('shift');
        const needMeta = parts.includes('meta') || parts.includes('cmd');
        _ghostHotkeyHandler = e => {
            if (e.key.toLowerCase() !== key) return;
            if (needAlt !== e.altKey || needCtrl !== e.ctrlKey || needShift !== e.shiftKey || needMeta !== e.metaKey) return;
            e.preventDefault();
            toggleGhostMode();
        };
        document.addEventListener('keydown', _ghostHotkeyHandler);
    }

    // ─── Hotkey ─────────────────────────────────────────────────────────────────

    let _hotkeyHandler = null;

    function setupHotkey() {
        if (_hotkeyHandler) document.removeEventListener('keydown', _hotkeyHandler);
        const s = getSettings();
        if (!s.enabled || !s.hotkeyEnabled || !s.hotkey) return;
        const parts = s.hotkey.toLowerCase().split('+').map(p => p.trim());
        const key = parts[parts.length - 1];
        const needAlt = parts.includes('alt'), needCtrl = parts.includes('ctrl') || parts.includes('control');
        const needShift = parts.includes('shift'), needMeta = parts.includes('meta') || parts.includes('cmd');
        _hotkeyHandler = e => {
            if (e.key.toLowerCase() !== key) return;
            if (needAlt !== e.altKey || needCtrl !== e.ctrlKey || needShift !== e.shiftKey || needMeta !== e.metaKey) return;
            const active = document.activeElement;
            if (active && active !== $('scp-input') && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) return;
            e.preventDefault(); toggleVisibility();
        };
        document.addEventListener('keydown', _hotkeyHandler);
    }

    // ─── Session Dropdown ────────────────────────────────────────────────────────

    function closeSessPanel() {
        $('scp-sess-panel')?.classList.remove('open');
        $('scp-sess-trigger')?.classList.remove('open');
    }

    function refreshSessionDropdown() {
        const { charId, chatId } = getBindingKey();
        const bucket = getChatBucket(charId, chatId);
        const nameEl = $('scp-sess-name'); const listEl = $('scp-sess-list');
        if (!nameEl || !listEl) return;
        const activeSess = bucket.sessions.find(s => s.id === bucket.activeSessionId);
        nameEl.textContent = activeSess?.name || 'No Sessions';
        listEl.innerHTML = '';
        if (!bucket.sessions.length) {
            listEl.innerHTML = `<div class="scp-sess-empty-label">No sessions — create one below</div>`;
            return;
        }
        for (const sess of bucket.sessions) {
            const item = document.createElement('div');
            item.className = `scp-sess-item${sess.id === bucket.activeSessionId ? ' active' : ''}`;
            item.dataset.id = sess.id;

            const dot = document.createElement('span');
            dot.className = 'scp-sess-item-dot';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'scp-sess-item-name';
            nameSpan.textContent = sess.name;

            const count = document.createElement('span');
            count.className = 'scp-sess-item-count';
            count.textContent = sess.messages.length;

            item.appendChild(dot);
            item.appendChild(nameSpan);
            item.appendChild(count);

            if (sess.isTemporary) {
                const badge = document.createElement('span');
                badge.className = 'scp-sess-tmp-badge';
                badge.title = 'Temporary session — will be deleted on switch';
                badge.textContent = 'tmp';
                item.appendChild(badge);
            }

            // Toggle tmp/permanent button (only for active session)
            if (sess.id === bucket.activeSessionId) {
                const tmpBtn = document.createElement('button');
                tmpBtn.className = `scp-sess-tmp-btn${sess.isTemporary ? ' active' : ''}`;
                tmpBtn.title = sess.isTemporary ? 'Make permanent' : 'Make temporary';
                tmpBtn.innerHTML = '⏱';
                tmpBtn.addEventListener('click', e => {
                    e.stopPropagation();
                    sess.isTemporary = !sess.isTemporary;
                    saveSettings();
                    refreshSessionDropdown();
                });
                item.appendChild(tmpBtn);
            }

            item.addEventListener('click', async () => {
                const activeSess = bucket.sessions.find(s => s.id === bucket.activeSessionId);
                if (activeSess && activeSess.isTemporary && activeSess.id !== sess.id) {
                    const ok = await showCustomDialog({
                        type: 'confirm',
                        title: 'Delete Temporary Session?',
                        message: 'Your current session is temporary. Switching will permanently delete it. Continue?'
                    });
                    if (!ok) return;
                }
                setActiveSession(charId, chatId, sess.id);
                refreshSessionDropdown(); renderSession(getCurrentSession()); closeSessPanel();
            });
            listEl.appendChild(item);
        }
    }

    // ─── Depth Slider Click-to-Type ──────────────────────────────────────────────

    function setupDepthClickEdit() {
        const valEl = $('scp-depth-val'); if (!valEl) return;
        valEl.addEventListener('click', () => {
            const cur = getSettings().contextDepth;
            const input = document.createElement('input');
            input.type = 'number'; input.className = 'scp-depth-input';
            input.value = cur; input.min = 0;
            const el = $('scp-depth-val');
            if (!el) return;
            el.replaceWith(input); input.focus(); input.select();
            const commit = () => {
                const val = Math.max(0, parseInt(input.value) || 0);
                getSettings().contextDepth = val; saveSettings();
                
                updateDepthSlidersMax();
                syncOverlayUI('contextDepth', val);
                
                const span = document.createElement('span');
                span.className = 'scp-depth-val scp-depth-clickable'; span.id = 'scp-depth-val';
                span.title = 'Click to enter exact value'; span.textContent = val;
                input.replaceWith(span);
                setupDepthClickEdit();
                const slider = $('scp-depth-slider');
                if (slider) { slider.value = val; }
                updateMsgCount(getCurrentSession());
            };
            input.addEventListener('blur', commit);
            input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') commit(); });
        });
    }

    // ─── Profile System ─────────────────────────────────────────────────────────

    function isConfigProfileDirty() {
        const s = getSettings();
        if (!s.activeProfile || !s.profiles[s.activeProfile]) return false;
        
        const p = s.profiles[s.activeProfile];
        const keys = [
            'systemPrompt', 'includeSystemPrompt', 'includeAuthorsNote', 
            'includeCharacterCard', 'includeUserPersonality', 'contextDepth', 
            'localHistoryLimit', 'connectionSource', 'connectionProfileId', 'maxTokens'
        ];
        
        for (const k of keys) {
            if (String(s[k] || '') !== String(p[k] || '')) return true;
        }
        
        return false;
    }

    function saveProfile(name) {
        const s = getSettings();
        s.profiles[name] = {
            systemPrompt: s.systemPrompt, includeSystemPrompt: s.includeSystemPrompt,
            includeAuthorsNote: s.includeAuthorsNote, includeCharacterCard: s.includeCharacterCard,
            includeUserPersonality: s.includeUserPersonality, contextDepth: s.contextDepth,
            localHistoryLimit: s.localHistoryLimit,
            connectionSource: s.connectionSource, connectionProfileId: s.connectionProfileId,
            maxTokens: s.maxTokens,
        };
        s.activeProfile = name; saveSettings();
    }

    function loadProfile(name) {
        const s = getSettings(); const p = s.profiles[name]; if (!p) return;
        
        const profileData = { ...p };
        delete profileData.customTheme;
        
        Object.assign(s, profileData); s.activeProfile = name;
        saveSettings();
        if (typeof updateSettingsUI === 'function') updateSettingsUI();
    }

    function deleteProfile(name) {
        const s = getSettings(); delete s.profiles[name];
        if (s.activeProfile === name) s.activeProfile = '';
        for (const k in s.profileBindings) { if (s.profileBindings[k] === name) delete s.profileBindings[k]; }
        saveSettings();
    }

    function refreshProfilesDropdown() {
        const sel = $('scp-profile-select'); if (!sel) return;
        const s = getSettings();

        if (Object.keys(s.profiles).length === 0) {
            s.profiles['Default'] = {
                systemPrompt: DEFAULT_SYSTEM_PROMPT, includeSystemPrompt: true,
                includeAuthorsNote: true, includeCharacterCard: true,
                includeUserPersonality: true, contextDepth: 15,
                localHistoryLimit: 50,
                connectionSource: 'default', connectionProfileId: '',
                maxTokens: 2048,
            };
            s.activeProfile = 'Default';
            saveSettings();
        }

        sel.innerHTML = '';
        let hasActive = false;

        for (const name of Object.keys(s.profiles)) {
            const opt = document.createElement('option');
            opt.value = name; opt.textContent = name;
            if (name === s.activeProfile) {
                opt.selected = true;
                hasActive = true;
            }
            sel.appendChild(opt);
        }

        if (!hasActive && Object.keys(s.profiles).length > 0) {
            const first = Object.keys(s.profiles)[0];
            loadProfile(first);
            sel.value = first;
        }

        updateBindingSection();
    }
    function updateBindingSection() {
        const sel = $('scp-profile-select'); const section = $('scp-binding-section');
        if (!section) return;
        const hasProfile = sel?.value;
        section.style.display = hasProfile ? '' : 'none';
        if (!hasProfile) return;
        const s = getSettings(); const { charId, chatId } = getBindingKey();
        const charKey = `char_${charId}`; const chatKey = `chat_${charId}_${chatId}`;
        const charBtn = $('scp-bind-char'); const chatBtn = $('scp-bind-chat');
        if (charBtn) charBtn.classList.toggle('active', s.profileBindings[charKey] === sel.value);
        if (chatBtn) chatBtn.classList.toggle('active', s.profileBindings[chatKey] === sel.value);
    }

    function autoLoadBoundProfile() {
        const s = getSettings(); const { charId, chatId } = getBindingKey();
        const name = s.profileBindings[`chat_${charId}_${chatId}`] || s.profileBindings[`char_${charId}`];
        if (name && s.profiles[name]) {
            loadProfile(name);
            const sel = $('scp-profile-select'); if (sel) sel.value = name;
        }
    }

    // ─── Theme Editor ────────────────────────────────────────────────────────────

    function isThemeDirty() {
        const s = getSettings();
        const current = s.customTheme || {};
        
        if (s.activeThemeProfile && s.savedThemes[s.activeThemeProfile]) {
            const saved = s.savedThemes[s.activeThemeProfile];
            return THEME_VAR_DEFS.some(def => (current[def.key] || '') !== (saved[def.key] || ''));
        }
        
        for (const preset of Object.values(THEME_PRESETS)) {
            const isMatch = THEME_VAR_DEFS.every(def => (current[def.key] || '') === (preset[def.key] || ''));
            if (isMatch) return false;
        }
        
        return true;
    }

    function buildThemeEditor(containerOverride) {
        const container = containerOverride || $('scp-theme-section'); if (!container) return;
        container.innerHTML = '';
        const s = getSettings();

        if (!s.savedThemes || Object.keys(s.savedThemes).length === 0) {
            s.savedThemes = { 'Default': { ...THEME_PRESETS.default } };
            s.activeThemeProfile = 'Default';
            s.customTheme = { ...s.savedThemes['Default'] };
            saveSettings();
        }

        const profileRow = document.createElement('div');
        profileRow.className = 'scp-profile-bar';
        profileRow.style.marginBottom = '12px';
        profileRow.innerHTML = `
            <select id="scp-theme-profile-select"></select>
            <button class="scp-profile-icon-btn" id="scp-theme-save" title="Save current theme parameters"><i class="fa-solid fa-floppy-disk"></i></button>
            <button class="scp-profile-icon-btn" id="scp-theme-create" title="Create new theme from preset"><i class="fa-solid fa-plus"></i></button>
            <button class="scp-profile-icon-btn" id="scp-theme-rename" title="Rename selected theme"><i class="fa-solid fa-pen"></i></button>
            <button class="scp-profile-icon-btn danger" id="scp-theme-delete" title="Delete selected theme"><i class="fa-solid fa-trash"></i></button>
            <button class="scp-profile-icon-btn" id="scp-theme-export" title="Export theme to JSON file"><i class="fa-solid fa-file-export"></i></button>
            <button class="scp-profile-icon-btn" id="scp-theme-import" title="Import theme from JSON file"><i class="fa-solid fa-file-import"></i></button>
        `;
        container.appendChild(profileRow);

        const sel = profileRow.querySelector('#scp-theme-profile-select');
        for (const name of Object.keys(s.savedThemes)) {
            const opt = document.createElement('option');
            opt.value = name; opt.textContent = name;
            opt.selected = name === s.activeThemeProfile;
            sel.appendChild(opt);
        }

        sel.addEventListener('change', async () => {
            const name = sel.value;
            
            if (isThemeDirty()) {
                const ok = await showCustomDialog({ 
                    type: 'confirm', 
                    title: 'Unsaved Changes', 
                    message: 'You have unsaved changes in your current theme. Are you sure you want to switch?' 
                });
                if (!ok) {
                    sel.value = s.activeThemeProfile || '';
                    return;
                }
            }

            if (name && s.savedThemes[name]) {
                s.customTheme = { ...s.savedThemes[name] };
                s.activeThemeProfile = name;
                saveSettings(); applyCustomTheme(s.customTheme); buildThemeEditor();
            }
        });

        profileRow.querySelector('#scp-theme-save').addEventListener('click', () => {
            const name = sel.value;
            if (!name) return;
            s.savedThemes[name] = { ...s.customTheme };
            saveSettings(); toastr.success(`Theme "${name}" updated`, EXT_DISPLAY);
        });

        profileRow.querySelector('#scp-theme-create').addEventListener('click', async () => {
            const name = await showCustomDialog({ type: 'prompt', title: 'New Theme', message: 'Enter name for new theme:', placeholder: 'My New Theme' });
            if (!name?.trim()) return;
            const n = name.trim();
            s.savedThemes[n] = { ...s.customTheme };
            s.activeThemeProfile = n;
            saveSettings(); buildThemeEditor(); toastr.success(`Created theme "${n}"`, EXT_DISPLAY);
        });

        profileRow.querySelector('#scp-theme-rename').addEventListener('click', async () => {
            const val = sel.value; if (!val) return;
            const newName = await showCustomDialog({ type: 'prompt', title: 'Rename Theme', message: 'Enter new name:', defaultValue: val });
            if (!newName?.trim() || newName.trim() === val) return;
            const n = newName.trim();
            s.savedThemes[n] = s.savedThemes[val];
            delete s.savedThemes[val];
            s.activeThemeProfile = n;
            saveSettings(); buildThemeEditor(); toastr.success('Theme renamed.', EXT_DISPLAY);
        });

        profileRow.querySelector('#scp-theme-delete').addEventListener('click', async () => {
            const val = sel.value; if (!val) return;
            if (Object.keys(s.savedThemes).length <= 1) {
                toastr.warning('Cannot delete the last remaining theme.', EXT_DISPLAY);
                return;
            }
            const ok = await showCustomDialog({ type: 'confirm', title: 'Delete Theme', message: `Delete "${val}"?` });
            if (!ok) return;
            delete s.savedThemes[val];
            s.activeThemeProfile = Object.keys(s.savedThemes)[0];
            s.customTheme = { ...s.savedThemes[s.activeThemeProfile] };
            saveSettings(); applyCustomTheme(s.customTheme); buildThemeEditor();
            toastr.success('Deleted.', EXT_DISPLAY);
        });

        profileRow.querySelector('#scp-theme-export').addEventListener('click', () => {
            const s2 = getSettings();
            const name = sel.value || 'custom';
            const payload = JSON.stringify({ name, version: 1, theme: s2.customTheme }, null, 2);
            const blob = new Blob([payload], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `st-copilot-theme-${name.replace(/[^a-z0-9]/gi, '_')}.json`;
            a.click();
            URL.revokeObjectURL(url);
        });

        profileRow.querySelector('#scp-theme-import').addEventListener('click', () => {
            const inp = document.createElement('input');
            inp.type = 'file'; inp.accept = '.json';
            inp.onchange = async () => {
                const file = inp.files?.[0]; if (!file) return;
                try {
                    const text = await file.text();
                    const data = JSON.parse(text);
                    const imported = data.theme || data;
                    if (typeof imported !== 'object' || Array.isArray(imported)) throw new Error('Invalid format');
                    const themeName = (data.name && typeof data.name === 'string')
                        ? data.name
                        : file.name.replace(/\.json$/i, '');
                    const s2 = getSettings();
                    s2.savedThemes[themeName] = { ...THEME_PRESETS.default, ...imported };
                    s2.activeThemeProfile = themeName;
                    s2.customTheme = { ...s2.savedThemes[themeName] };
                    saveSettings(); applyCustomTheme(s2.customTheme); buildThemeEditor(containerOverride);
                    toastr.success(`Theme "${escHtml(themeName)}" imported.`, EXT_DISPLAY);
                } catch (e) {
                    toastr.error('Invalid theme file.', EXT_DISPLAY);
                }
            };
            inp.click();
        });

        // Preset pills
        const presetRow = document.createElement('div');
        presetRow.className = 'scp-theme-preset-row';
        presetRow.innerHTML = '<div class="scp-theme-preset-label">Base preset</div><div class="scp-theme-preset-btns" id="scp-theme-preset-btns"></div>';
        container.appendChild(presetRow);
        const btnsEl = presetRow.querySelector('#scp-theme-preset-btns');
        for (const [name, preset] of Object.entries(THEME_PRESETS)) {
            const btn = document.createElement('button');
            btn.className = 'scp-preset-pill'; btn.textContent = preset.label; btn.dataset.preset = name;
            
            btn.addEventListener('click', async () => {
                if (isThemeDirty()) {
                    const ok = await showCustomDialog({ 
                        type: 'confirm', 
                        title: 'Unsaved Changes', 
                        message: 'You have unsaved changes in your current theme. Are you sure you want to switch and lose them?' 
                    });
                    if (!ok) return;
                }

                const s2 = getSettings();
                s2.customTheme = { ...THEME_PRESETS[name] };
                s2.activeThemeProfile = '';
                saveSettings(); applyCustomTheme(s2.customTheme); buildThemeEditor();
            });
            
            btnsEl.appendChild(btn);
        }

        // Variable grid
        const grid = document.createElement('div'); grid.className = 'scp-theme-var-grid';
        for (const def of THEME_VAR_DEFS) {
            const item = document.createElement('div'); item.className = 'scp-theme-var-item';
            const label = document.createElement('div'); label.className = 'scp-theme-var-label'; label.textContent = def.label;
            const wrap = document.createElement('div'); wrap.className = 'scp-theme-var-wrap';
            const preview = document.createElement('div'); preview.className = 'scp-theme-var-preview';
            const curVal = s.customTheme?.[def.key] ?? '';
            preview.style.background = curVal; preview.style.display = curVal ? '' : 'none';
            const isColorKey = _COLOR_KEYS.has(def.key);
            if (isColorKey) preview.classList.add('scp-color-clickable');
            const input = document.createElement('input'); input.type = 'text'; input.className = 'scp-theme-var-input';
            input.value = curVal; input.placeholder = def.hint; input.dataset.key = def.key;
            const cssVar = THEME_CSS_MAP[def.key];
            const getDefaultVal = () => {
                const ss = getSettings();
                if (ss.activeThemeProfile && ss.savedThemes?.[ss.activeThemeProfile]) return ss.savedThemes[ss.activeThemeProfile][def.key] ?? '';
                return THEME_PRESETS.default[def.key] ?? '';
            };
            const resetBtn = document.createElement('button');
            resetBtn.className = 'scp-theme-var-reset'; resetBtn.title = 'Reset to profile default'; resetBtn.textContent = '↺';
            const updateResetState = val => { resetBtn.disabled = !val || val === getDefaultVal(); };
            updateResetState(curVal);
            const applyVal = val => {
                const s2 = getSettings();
                if (!s2.customTheme) s2.customTheme = {};
                s2.customTheme[def.key] = val;
                saveSettings();
                if (cssVar) [windowEl, document.getElementById('scp-lb-overlay'), document.getElementById('scp-diff-modal')]
                    .filter(Boolean).forEach(t => t.style.setProperty(cssVar, val));
                preview.style.background = val;
                preview.style.display = val ? '' : 'none';
                if (input.value !== val) input.value = val;
                updateResetState(val);
            };
            input.addEventListener('input', () => applyVal(input.value));
            resetBtn.addEventListener('click', () => { const dv = getDefaultVal(); if (dv) applyVal(dv); });
            if (isColorKey) {
                preview.addEventListener('click', () => showColorPicker(preview, input.value || '#7c6dfa', val => applyVal(val)));
            }
            wrap.appendChild(preview); wrap.appendChild(input); wrap.appendChild(resetBtn);
            item.appendChild(label); item.appendChild(wrap); grid.appendChild(item);
        }
        container.appendChild(grid);
    }

    // ─── char Badge ─────────────────────────────────────────────────────────────

    function updateCharBadge() {
        const badge = $('scp-char-badge'); if (!badge) return;
        const ctx = SillyTavern.getContext(); const char = ctx.characters?.[ctx.characterId];
        if (char) { badge.textContent = char.name; badge.style.display = ''; }
        else { badge.style.display = 'none'; }
    }

    async function updateProfilesList() {
        const profSel = $('scp-conn-profile'); if (!profSel) return;
        const ctx = SillyTavern.getContext();
        let profiles =[];
        try {
            if (typeof ctx.executeSlashCommandsWithOptions === 'function') {
                const result = await ctx.executeSlashCommandsWithOptions('/profile-list');
                if (result && result.pipe) profiles = JSON.parse(result.pipe);
            }
        } catch (e) {
            console.warn(`[${EXT_DISPLAY}] Failed to fetch profiles via slash command`, e);
        }

        const s = getSettings(); 
        const currentVal = s.connectionProfileId || '';
        profSel.innerHTML = '<option value="">-- Select Profile --</option>';

        if (profiles && profiles.length > 0) {
            profiles.forEach(p => {
                const newOpt = document.createElement('option');
                newOpt.value = p;
                newOpt.textContent = p;
                profSel.appendChild(newOpt);
            });
        } else {
            const nativeSel = document.getElementById('connection_profile');
            if (nativeSel?.options) {
                for (const opt of Array.from(nativeSel.options)) {
                    if (opt.value && opt.value !== 'default' && opt.value !== 'gui') {
                        const newOpt = document.createElement('option');
                        const profileName = opt.textContent.trim();
                        newOpt.value = profileName;
                        newOpt.textContent = profileName;
                        profSel.appendChild(newOpt);
                    }
                }
            }
        }
        if (Array.from(profSel.options).some(o => o.value === currentVal)) profSel.value = currentVal;
    }

    // ─── Auto-resize textarea ───────────────────────────────────────────────────

    function autoResize(el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 180)}px`; }

    // ─── Settings Panel Handlers ─────────────────────────────────────────────────

    function syncOverlayUI(key, val) {
        const gIdMap = {
            connectionSource: 'scp-sp-conn-source',
            connectionProfileId: 'scp-sp-conn-profile',
            includeSystemPrompt: 'scp-sp-include-sysprompt',
            includeAuthorsNote: 'scp-sp-include-anote',
            includeCharacterCard: 'scp-sp-include-charcard',
            includeUserPersonality: 'scp-sp-include-persona',
            contextDepth: 'scp-sp-depth-slider'
        };
        const gId = gIdMap[key];
        if (gId) {
            const gEl = document.getElementById(gId);
            if (gEl) {
                if (gEl.type === 'checkbox') gEl.checked = !!val;
                else gEl.value = val ?? '';
            }
            if (key === 'connectionSource') {
                const gPg = document.getElementById('scp-sp-global-profile-group');
                if (gPg) gPg.style.display = val === 'profile' ? '' : 'none';
            }
            if (key === 'contextDepth') {
                const gDv = document.getElementById('scp-sp-depth-val');
                if (gDv) gDv.textContent = val ?? 15;
            }
        }

        const ov = getSessionOverrides();
        if (key in ov) return;

        const eff = getEffectiveSettings();
        const ovIdMap = {
            connectionSource: 'scp-sp-ov-conn-source',
            connectionProfileId: 'scp-sp-ov-conn-profile',
            includeSystemPrompt: 'scp-sp-ov-include-sysprompt',
            includeAuthorsNote: 'scp-sp-ov-include-anote',
            includeCharacterCard: 'scp-sp-ov-include-charcard',
            includeUserPersonality: 'scp-sp-ov-include-persona',
            contextDepth: 'scp-sp-ov-depth-slider'
        };

        const ovId = ovIdMap[key];
        if (ovId) {
            const ovEl = document.getElementById(ovId);
            if (ovEl) {
                if (ovEl.type === 'checkbox') ovEl.checked = !!eff[key];
                else ovEl.value = eff[key] ?? '';
            }
            if (key === 'connectionSource') {
                const pg = document.getElementById('scp-sp-ov-profile-group');
                if (pg) pg.style.display = eff.connectionSource === 'profile' ? '' : 'none';
            }
            if (key === 'contextDepth') {
                const dv = document.getElementById('scp-sp-ov-depth-val');
                if (dv) dv.textContent = eff.contextDepth ?? 15;
            }
        }
    }
    
    function updateSettingsUI() {
        const s = getSettings();
        const setC = (id, k) => { const el = $(id); if (el) el.checked = !!s[k]; };
        const setI = (id, k) => { const el = $(id); if (el) el.value = s[k] ?? ''; };
        
        setC('scp-enabled', 'enabled');
        setC('scp-hotkey-enabled', 'hotkeyEnabled');
        setC('scp-include-sysprompt', 'includeSystemPrompt');
        setC('scp-include-anote', 'includeAuthorsNote');
        setC('scp-include-charcard', 'includeCharacterCard');
        setC('scp-include-persona', 'includeUserPersonality');
        setC('scp-icon-persistent', 'floatingIconPersistent');
        setC('scp-ghost-hotkey-enabled', 'ghostModeHotkeyEnabled');
        setI('scp-hotkey', 'hotkey');
        setI('scp-max-tokens', 'maxTokens');
        setI('scp-history-limit', 'localHistoryLimit');
        setI('scp-depth-slider', 'contextDepth');
        setI('scp-reasoning-trim', 'reasoningTrimStrings');
        setI('scp-ghost-hotkey', 'ghostModeHotkey');

        const opSlider = $('scp-opacity-slider');
        const opVal = $('scp-opacity-val');
        if (opSlider) opSlider.value = s.opacity ?? 95;
        if (opVal) opVal.textContent = `${s.opacity ?? 95}%`;

        const ghOp = $('scp-ghost-opacity');
        const ghOpVal = $('scp-ghost-opacity-val');
        if (ghOp) ghOp.value = s.ghostModeOpacity ?? 15;
        if (ghOpVal) ghOpVal.textContent = `${s.ghostModeOpacity ?? 15}%`;
        
        const dv = $('scp-depth-val');
        if (dv) dv.textContent = s.contextDepth ?? 15;
        
        const cs = $('scp-conn-source');
        if (cs) {
            cs.value = s.connectionSource ?? 'default';
            const g = $('scp-profile-group');
            if (g) g.style.display = cs.value === 'profile' ? '' : 'none';
        }
        
        const spEl = $('scp-sysprompt');
        if (spEl) spEl.value = s.systemPrompt || DEFAULT_SYSTEM_PROMPT;
        
        const profSel = $('scp-conn-profile');
        if (profSel) profSel.value = s.connectionProfileId ?? '';

        const wand = $('scp-wand-btn');
        if (wand) wand.style.display = s.enabled ? '' : 'none';

        if (typeof buildThemeEditor === 'function') buildThemeEditor();

        const lbPromptEl3 = $('scp-lb-manage-prompt');
        if (lbPromptEl3) lbPromptEl3.value = s.lorebookManagePrompt || DEFAULT_LB_MANAGE_PROMPT;
        setI('scp-lb-st-scan-depth', 'lorebookSTScanDepth');
        setI('scp-lb-copilot-scan-depth', 'lorebookCopilotScanDepth');
    }

    function setupSettingsHandlers() {
        const s = getSettings();

        const updCtx = () => updateMsgCount(getCurrentSession());

        const bindCheck = (id, key, cb) => {
            const el = $(id); if (!el) return;
            el.checked = !!s[key];
            el.addEventListener('change', () => { 
                getSettings()[key] = el.checked; saveSettings(); 
                syncOverlayUI(key, el.checked);
                if (cb) cb(); 
            });
        };
        const bindInput = (id, key, toVal, cb) => {
            const el = $(id); if (!el) return;
            el.value = s[key] ?? '';
            el.addEventListener('input', () => { 
                const v = toVal ? toVal(el.value) : el.value;
                getSettings()[key] = v; saveSettings(); 
                syncOverlayUI(key, v);
                if (cb) cb(); 
            });
        };
        const bindSelect = (id, key, cb) => {
            const el = $(id); if (!el) return;
            el.value = s[key] ?? '';
            el.addEventListener('change', () => { 
                getSettings()[key] = el.value; saveSettings(); 
                syncOverlayUI(key, el.value);
                if (cb) cb(el.value); 
            });
        };

        bindCheck('scp-enabled', 'enabled', () => {
            const ss = getSettings();
            const btn = $('scp-wand-btn');
            if (btn) btn.style.display = ss.enabled ? '' : 'none';
            if (!ss.enabled) hideWindow();
            updateIconVisibility();
            setupHotkey();
        });
        
        bindCheck('scp-hotkey-enabled', 'hotkeyEnabled');
        bindCheck('scp-include-sysprompt', 'includeSystemPrompt', updCtx);
        bindCheck('scp-include-anote', 'includeAuthorsNote', updCtx);
        bindCheck('scp-include-charcard', 'includeCharacterCard', updCtx);
        bindCheck('scp-include-persona', 'includeUserPersonality', updCtx);
        
        bindCheck('scp-icon-persistent', 'floatingIconPersistent', updateIconVisibility);

        // Opacity slider (ST drawer)
        const opSlider = $('scp-opacity-slider');
        const opVal = $('scp-opacity-val');
        if (opSlider) {
            opSlider.value = s.opacity ?? 95;
            if (opVal) opVal.textContent = `${opSlider.value}%`;
            opSlider.addEventListener('input', () => { if (opVal) opVal.textContent = `${opSlider.value}%`; });
            opSlider.addEventListener('change', () => {
                const v = parseInt(opSlider.value);
                getSettings().opacity = v; saveSettings();
                if (!_ghostModeActive && windowEl) windowEl.style.opacity = (v / 100).toString();
                const spOpSlider = document.getElementById('scp-sp-opacity-slider');
                const spOpVal = document.getElementById('scp-sp-opacity-val');
                if (spOpSlider) spOpSlider.value = v;
                if (spOpVal) spOpVal.textContent = `${v}%`;
            });
        }

        // Ghost mode (ST drawer)
        const ghOp = $('scp-ghost-opacity');
        const ghOpVal = $('scp-ghost-opacity-val');
        if (ghOp) {
            ghOp.value = s.ghostModeOpacity ?? 15;
            if (ghOpVal) ghOpVal.textContent = `${ghOp.value}%`;
            ghOp.addEventListener('input', () => { if (ghOpVal) ghOpVal.textContent = `${ghOp.value}%`; });
            ghOp.addEventListener('change', () => {
                const v = parseInt(ghOp.value);
                getSettings().ghostModeOpacity = v; saveSettings();
                if (_ghostModeActive && windowEl) windowEl.style.opacity = (v / 100).toString();
                const spGhOp = document.getElementById('scp-sp-ghost-opacity');
                const spGhOpVal = document.getElementById('scp-sp-ghost-opacity-val');
                if (spGhOp) spGhOp.value = v;
                if (spGhOpVal) spGhOpVal.textContent = `${v}%`;
            });
        }
        bindCheck('scp-ghost-hotkey-enabled', 'ghostModeHotkeyEnabled', setupGhostHotkey);
        bindInput('scp-ghost-hotkey', 'ghostModeHotkey', null, setupGhostHotkey);

        const reasoningTrimEl = $('scp-reasoning-trim');
        if (reasoningTrimEl) {
            reasoningTrimEl.value = getSettings().reasoningTrimStrings || '';
            reasoningTrimEl.addEventListener('input', () => { getSettings().reasoningTrimStrings = reasoningTrimEl.value; saveSettings(); });
        }
        bindInput('scp-hotkey', 'hotkey');
        bindInput('scp-max-tokens', 'maxTokens', Number);
        bindInput('scp-history-limit', 'localHistoryLimit', Number, updCtx);
        bindSelect('scp-conn-source', 'connectionSource', v => {
            const g = $('scp-profile-group');
            if (g) g.style.display = v === 'profile' ? '' : 'none';
        });

        if ($('scp-profile-group')) {
            $('scp-profile-group').style.display = s.connectionSource === 'profile' ? '' : 'none';
        }

        const spEl = $('scp-sysprompt');
        if (spEl) {
            spEl.value = s.systemPrompt || DEFAULT_SYSTEM_PROMPT;
            spEl.addEventListener('input', () => { getSettings().systemPrompt = spEl.value; saveSettings(); updCtx(); });
        }

        $('scp-reset-prompt')?.addEventListener('click', async () => {
            const ok = await showCustomDialog({ type: 'confirm', title: 'Reset System Prompt', message: 'Reset to default? Your current prompt will be lost.' });
            if (!ok) return;
            getSettings().systemPrompt = DEFAULT_SYSTEM_PROMPT;
            if (spEl) spEl.value = DEFAULT_SYSTEM_PROMPT;
            saveSettings(); updCtx(); toastr.success('System prompt reset.', EXT_DISPLAY);
        });

        $('scp-hotkey')?.addEventListener('change', setupHotkey);
        $('scp-hotkey-enabled')?.addEventListener('change', setupHotkey);

        const profSel = $('scp-conn-profile');
        if (profSel) {
            profSel.addEventListener('mouseenter', updateProfilesList);
            profSel.addEventListener('focus', updateProfilesList);
            profSel.addEventListener('change', () => { 
                getSettings().connectionProfileId = profSel.value; 
                saveSettings(); 
                syncOverlayUI('connectionProfileId', profSel.value);
            });
        }

        // Config profiles
        refreshProfilesDropdown();

        $('scp-profile-select')?.addEventListener('change', async () => {
            const sel = $('scp-profile-select');
            const name = sel.value;
            
            if (isConfigProfileDirty()) {
                const ok = await showCustomDialog({ 
                    type: 'confirm', 
                    title: 'Unsaved Configuration', 
                    message: 'You have unsaved changes in your current configuration profile. Are you sure you want to switch?' 
                });
                if (!ok) {
                    sel.value = getSettings().activeProfile || '';
                    return;
                }
            }
            
            if (name) loadProfile(name);
            updateBindingSection();
        });

        $('scp-profile-save')?.addEventListener('click', async () => {
            const sel = $('scp-profile-select');
            let name = sel?.value;
            if (!name) {
                name = await showCustomDialog({ type: 'prompt', title: 'Save Configuration', message: 'Enter a name for this configuration:', placeholder: 'My Config' });
                if (!name?.trim()) return;
                name = name.trim();
            }
            saveProfile(name); refreshProfilesDropdown();
            if (sel) sel.value = name;
            updateBindingSection(); toastr.success(`Saved "${name}"`, EXT_DISPLAY);
        });

        $('scp-profile-create-new')?.addEventListener('click', async () => {
            const name = await showCustomDialog({ type: 'prompt', title: 'New Configuration', message: 'Enter a name for the new default profile:', placeholder: 'New Config' });
            if (!name?.trim()) return;
            const n = name.trim();
            const s2 = getSettings();
            s2.profiles[n] = {
                systemPrompt: DEFAULT_SYSTEM_PROMPT, includeSystemPrompt: true,
                includeAuthorsNote: true, includeCharacterCard: true,
                includeUserPersonality: true, contextDepth: 15,
                localHistoryLimit: 50,
                connectionSource: 'default', connectionProfileId: '',
                maxTokens: 2048,
            };
            saveSettings(); refreshProfilesDropdown();
            loadProfile(n);
            const sel = $('scp-profile-select'); if (sel) sel.value = n;
            updateBindingSection(); toastr.success(`Created "${n}"`, EXT_DISPLAY);
        });

        $('scp-profile-rename')?.addEventListener('click', async () => {
            const sel = $('scp-profile-select');
            if (!sel?.value) return toastr.info('No configuration selected.', EXT_DISPLAY);
            const newName = await showCustomDialog({ type: 'prompt', title: 'Rename Configuration', message: 'New name:', defaultValue: sel.value });
            if (!newName?.trim() || newName.trim() === sel.value) return;
            const s2 = getSettings(); const p = s2.profiles[sel.value]; if (!p) return;
            s2.profiles[newName.trim()] = p; delete s2.profiles[sel.value];
            if (s2.activeProfile === sel.value) s2.activeProfile = newName.trim();
            for (const k in s2.profileBindings) { if (s2.profileBindings[k] === sel.value) s2.profileBindings[k] = newName.trim(); }
            saveSettings(); refreshProfilesDropdown();
            const newSel = $('scp-profile-select'); if (newSel) newSel.value = newName.trim();
            updateBindingSection(); toastr.success('Renamed.', EXT_DISPLAY);
        });

        $('scp-profile-delete')?.addEventListener('click', async () => {
            const sel = $('scp-profile-select'); if (!sel?.value) return;
            const s2 = getSettings();
            if (Object.keys(s2.profiles).length <= 1) {
                toastr.warning('Cannot delete the last remaining configuration profile.', EXT_DISPLAY);
                return;
            }
            const ok = await showCustomDialog({ type: 'confirm', title: 'Delete Configuration', message: `Delete "${sel.value}"?` });
            if (!ok) return;
            deleteProfile(sel.value); refreshProfilesDropdown(); updateBindingSection();
            toastr.success('Deleted.', EXT_DISPLAY);
        });

        $('scp-bind-char')?.addEventListener('click', () => {
            const sel = $('scp-profile-select'); if (!sel?.value) return;
            const s2 = getSettings(); const { charId } = getBindingKey(); const key = `char_${charId}`;
            if (s2.profileBindings[key] === sel.value) delete s2.profileBindings[key];
            else s2.profileBindings[key] = sel.value;
            saveSettings(); updateBindingSection();
        });

        $('scp-bind-chat')?.addEventListener('click', () => {
            const sel = $('scp-profile-select'); if (!sel?.value) return;
            const s2 = getSettings(); const { charId, chatId } = getBindingKey(); const key = `chat_${charId}_${chatId}`;
            if (s2.profileBindings[key] === sel.value) delete s2.profileBindings[key];
            else s2.profileBindings[key] = sel.value;
            saveSettings(); updateBindingSection();
        });

        $('scp-open-window')?.addEventListener('click', showWindow);
        $('scp-clear-sessions')?.addEventListener('click', async () => {
            const ok = await showCustomDialog({ 
                type: 'confirm', 
                title: 'Clear All Sessions', 
                message: 'Delete ALL Copilot sessions for all characters and chats? This cannot be undone.',
                delayConfirm: 3
            });
            if (!ok) return;
            getSettings().sessions = {}; saveSettings(); onChatChanged();
            toastr.success('All sessions cleared.', EXT_DISPLAY);
        });

        updateProfilesList();
        buildThemeEditor();

        bindInput('scp-lb-st-scan-depth', 'lorebookSTScanDepth', Number);
        bindInput('scp-lb-copilot-scan-depth', 'lorebookCopilotScanDepth', Number);

        const lbPromptEl = $('scp-lb-manage-prompt');
        if (lbPromptEl) {
            lbPromptEl.value = s.lorebookManagePrompt || DEFAULT_LB_MANAGE_PROMPT;
            lbPromptEl.addEventListener('input', () => { getSettings().lorebookManagePrompt = lbPromptEl.value; saveSettings(); });
        }
        $('scp-reset-lb-prompt')?.addEventListener('click', async () => {
            const ok = await showCustomDialog({ type: 'confirm', title: 'Reset Lorebook Prompt', message: 'Reset to default?' });
            if (!ok) return;
            getSettings().lorebookManagePrompt = DEFAULT_LB_MANAGE_PROMPT;
            const el = $('scp-lb-manage-prompt'); if (el) el.value = DEFAULT_LB_MANAGE_PROMPT;
            saveSettings(); toastr.success('Lorebook prompt reset.', EXT_DISPLAY);
        });
    }

    function openSettingsPanel() {
        const overlay = document.getElementById('scp-settings-overlay');
        if (!overlay) return;
        applyCustomTheme(getSettings().customTheme || THEME_PRESETS.default);
        syncSPFromSettings();
        buildThemeEditor(document.getElementById('scp-sp-theme-section'));
        buildQPSettingsUI(document.getElementById('scp-sp-qp-container'));
        overlay.style.display = 'flex';
        updateSessionOverrideIndicator();
        // Reset to global tab on open
        overlay.querySelectorAll('.scp-sp-tab').forEach(t => t.classList.toggle('active', t.dataset.sptab === 'global'));
        overlay.querySelectorAll('.scp-sp-tab-pane').forEach(p => { p.style.display = p.id === 'scp-sp-pane-global' ? '' : 'none'; });
    }

    function closeSettingsPanel() {
        const overlay = document.getElementById('scp-settings-overlay');
        if (overlay) overlay.style.display = 'none';
    }

    function syncSPFromSettings() {
        const s = getSettings();
        const ov = getSessionOverrides();
        const eff = getEffectiveSettings();

        updateDepthSlidersMax();

        const g = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
        const gC = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };

        // Global tab
        gC('scp-sp-enabled', s.enabled);
        gC('scp-sp-hotkey-enabled', s.hotkeyEnabled);
        g('scp-sp-hotkey', s.hotkey);
        gC('scp-sp-icon-persistent', s.floatingIconPersistent);

        const spOpSlider = document.getElementById('scp-sp-opacity-slider');
        const spOpVal = document.getElementById('scp-sp-opacity-val');
        if (spOpSlider) spOpSlider.value = s.opacity ?? 95;
        if (spOpVal) spOpVal.textContent = `${s.opacity ?? 95}%`;

        const spGhOp = document.getElementById('scp-sp-ghost-opacity');
        const spGhOpVal = document.getElementById('scp-sp-ghost-opacity-val');
        if (spGhOp) spGhOp.value = s.ghostModeOpacity ?? 15;
        if (spGhOpVal) spGhOpVal.textContent = `${s.ghostModeOpacity ?? 15}%`;
        gC('scp-sp-ghost-hotkey-enabled', s.ghostModeHotkeyEnabled);
        g('scp-sp-ghost-hotkey', s.ghostModeHotkey);
        g('scp-sp-conn-source', s.connectionSource ?? 'default');
        const gCp = document.getElementById('scp-sp-global-profile-group');
        if (gCp) gCp.style.display = s.connectionSource === 'profile' ? '' : 'none';
        g('scp-sp-max-tokens', s.maxTokens);
        g('scp-sp-history-limit', s.localHistoryLimit);
        const spDs = document.getElementById('scp-sp-depth-slider');
        const spDv = document.getElementById('scp-sp-depth-val');
        if (spDs) spDs.value = s.contextDepth ?? 15;
        if (spDv) spDv.textContent = s.contextDepth ?? 15;
        gC('scp-sp-include-sysprompt', s.includeSystemPrompt);
        gC('scp-sp-include-anote', s.includeAuthorsNote);
        gC('scp-sp-include-charcard', s.includeCharacterCard);
        gC('scp-sp-include-persona', s.includeUserPersonality);
        g('scp-sp-reasoning-trim', s.reasoningTrimStrings);
        g('scp-sp-sysprompt', s.systemPrompt || DEFAULT_SYSTEM_PROMPT);
        g('scp-sp-lb-manage-prompt', s.lorebookManagePrompt || DEFAULT_LB_MANAGE_PROMPT);
        g('scp-sp-lb-st-scan-depth', s.lorebookSTScanDepth);
        g('scp-sp-lb-copilot-scan-depth', s.lorebookCopilotScanDepth);

        refreshSPProfilesDropdown();
        updateSPConnProfileList();

        // Session tab — show effective values, highlight overridden keys
        const ovDs = document.getElementById('scp-sp-ov-depth-slider');
        const ovDv = document.getElementById('scp-sp-ov-depth-val');
        if (ovDs) ovDs.value = eff.contextDepth ?? 15;
        if (ovDv) ovDv.textContent = eff.contextDepth ?? 15;

        g('scp-sp-ov-conn-source', eff.connectionSource ?? 'default');
        const ovPg = document.getElementById('scp-sp-ov-profile-group');
        if (ovPg) ovPg.style.display = eff.connectionSource === 'profile' ? '' : 'none';
        
        g('scp-sp-ov-conn-profile', eff.connectionProfileId ?? '');

        const ovi = (id, key) => { const el = document.getElementById(id); if (el) el.value = key in ov ? ov[key] ?? '' : ''; };
        ovi('scp-sp-ov-max-tokens', 'maxTokens');
        ovi('scp-sp-ov-history-limit', 'localHistoryLimit');
        ovi('scp-sp-ov-reasoning-trim', 'reasoningTrimStrings');
        ovi('scp-sp-ov-sysprompt', 'systemPrompt');

        gC('scp-sp-ov-include-sysprompt', eff.includeSystemPrompt);
        gC('scp-sp-ov-include-anote', eff.includeAuthorsNote);
        gC('scp-sp-ov-include-charcard', eff.includeCharacterCard);
        gC('scp-sp-ov-include-persona', eff.includeUserPersonality);

        updateSPOverrideIndicators();
    }

    async function updateSPConnProfileList() {
        const selIds =['scp-sp-conn-profile', 'scp-sp-ov-conn-profile'];
        const s = getSettings();
        const eff = getEffectiveSettings();
        const ctx = SillyTavern.getContext();
        let profiles = [];
        try {
            if (typeof ctx.executeSlashCommandsWithOptions === 'function') {
                const result = await ctx.executeSlashCommandsWithOptions('/profile-list');
                if (result?.pipe) profiles = JSON.parse(result.pipe);
            }
        } catch (_) {}
        if (!profiles.length) {
            const nativeSel = document.getElementById('connection_profile');
            if (nativeSel?.options) {
                for (const opt of Array.from(nativeSel.options)) {
                    if (opt.value && opt.value !== 'default' && opt.value !== 'gui') profiles.push(opt.textContent.trim());
                }
            }
        }
        selIds.forEach(sid => {
            const sel = document.getElementById(sid); if (!sel) return;
            const isOverride = sid === 'scp-sp-ov-conn-profile';
            const targetVal = isOverride ? (eff.connectionProfileId || '') : (s.connectionProfileId || '');
            sel.innerHTML = '<option value="">-- Select Profile --</option>';
            profiles.forEach(p => { const o = document.createElement('option'); o.value = p; o.textContent = p; sel.appendChild(o); });
            if (Array.from(sel.options).some(o => o.value === targetVal)) sel.value = targetVal;
        });
    }

    function refreshSPProfilesDropdown() {
        const sel = document.getElementById('scp-sp-profile-select'); if (!sel) return;
        const s = getSettings();
        if (!Object.keys(s.profiles).length) {
            s.profiles['Default'] = { systemPrompt: DEFAULT_SYSTEM_PROMPT, includeSystemPrompt: true, includeAuthorsNote: true, includeCharacterCard: true, includeUserPersonality: true, contextDepth: 15, localHistoryLimit: 50, connectionSource: 'default', connectionProfileId: '', maxTokens: 2048 };
            s.activeProfile = 'Default'; saveSettings();
        }
        sel.innerHTML = '';
        for (const name of Object.keys(s.profiles)) {
            const opt = document.createElement('option'); opt.value = name; opt.textContent = name;
            if (name === s.activeProfile) opt.selected = true;
            sel.appendChild(opt);
        }
        updateSPBindingSection();
    }

    function updateSPBindingSection() {
        const sel = document.getElementById('scp-sp-profile-select');
        const section = document.getElementById('scp-sp-binding-section');
        if (!section) return;
        section.style.display = sel?.value ? '' : 'none';
        if (!sel?.value) return;
        const s = getSettings(); const { charId, chatId } = getBindingKey();
        document.getElementById('scp-sp-bind-char')?.classList.toggle('active', s.profileBindings[`char_${charId}`] === sel.value);
        document.getElementById('scp-sp-bind-chat')?.classList.toggle('active', s.profileBindings[`chat_${charId}_${chatId}`] === sel.value);
    }

    function openExtensionSettings() { openSettingsPanel(); }

    // ─── Settings Panel Listeners ────────────────────────────────────────────────

    function setupSettingsPanelListeners() {
        const overlay = document.getElementById('scp-settings-overlay');
        if (!overlay) return;

        // Close
        document.getElementById('scp-sp-close')?.addEventListener('click', closeSettingsPanel);
        let _spMouseDown = null;
        overlay.addEventListener('mousedown', e => { _spMouseDown = e.target; });
        overlay.addEventListener('click', e => { if (e.target === overlay && _spMouseDown === overlay) closeSettingsPanel(); });

        // Tab switching
        overlay.querySelectorAll('.scp-sp-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                overlay.querySelectorAll('.scp-sp-tab').forEach(t => t.classList.remove('active'));
                overlay.querySelectorAll('.scp-sp-tab-pane').forEach(p => { p.style.display = 'none'; });
                tab.classList.add('active');
                const pane = document.getElementById(`scp-sp-pane-${tab.dataset.sptab}`);
                if (pane) pane.style.display = '';
                if (tab.dataset.sptab === 'stats') {
                    renderStatsPane(document.getElementById('scp-sp-stats-container'));
                }
            });
        });

        // ── GLOBAL SETTINGS ──

        const saveGlobal = (key, val, cb) => {
            getSettings()[key] = val; saveSettings();
            // Sync to ST drawer if open
            const stEl = document.getElementById({
                enabled:'scp-enabled', hotkeyEnabled:'scp-hotkey-enabled', hotkey:'scp-hotkey',
                floatingIconPersistent:'scp-icon-persistent', connectionSource:'scp-conn-source',
                maxTokens:'scp-max-tokens', localHistoryLimit:'scp-history-limit',
                contextDepth:'scp-depth-slider', includeSystemPrompt:'scp-include-sysprompt',
                includeAuthorsNote:'scp-include-anote', includeCharacterCard:'scp-include-charcard',
                includeUserPersonality:'scp-include-persona', reasoningTrimStrings:'scp-reasoning-trim',
                systemPrompt:'scp-sysprompt', lorebookManagePrompt:'scp-lb-manage-prompt',
                lorebookSTScanDepth:'scp-lb-st-scan-depth', lorebookCopilotScanDepth:'scp-lb-copilot-scan-depth',
                connectionProfileId:'scp-conn-profile',
                opacity:'scp-opacity-slider', ghostModeOpacity:'scp-ghost-opacity',
                ghostModeHotkeyEnabled:'scp-ghost-hotkey-enabled', ghostModeHotkey:'scp-ghost-hotkey',
            }[key]);
            if (stEl) {
                if (stEl.type === 'checkbox') stEl.checked = !!val;
                else stEl.value = val ?? '';
                
                if (key === 'connectionSource') {
                    const stGroup = document.getElementById('scp-profile-group');
                    if (stGroup) stGroup.style.display = val === 'profile' ? '' : 'none';
                }
            }

            syncOverlayUI(key, val);

            if (cb) cb(val);
        };

        const bGCheck = (spId, key, cb) => {
            const el = document.getElementById(spId); if (!el) return;
            el.addEventListener('change', () => saveGlobal(key, el.checked, cb));
        };
        const bGInput = (spId, key, toVal, cb) => {
            const el = document.getElementById(spId); if (!el) return;
            el.addEventListener('input', () => saveGlobal(key, toVal ? toVal(el.value) : el.value, cb));
        };
        const bGSelect = (spId, key, cb) => {
            const el = document.getElementById(spId); if (!el) return;
            el.addEventListener('change', () => saveGlobal(key, el.value, cb));
        };

        bGCheck('scp-sp-enabled', 'enabled', () => {
            const ss = getSettings();
            const btn = document.getElementById('scp-wand-btn');
            if (btn) btn.style.display = ss.enabled ? '' : 'none';
            if (!ss.enabled) hideWindow();
            updateIconVisibility();
            setupHotkey();
        });
        
        bGCheck('scp-sp-hotkey-enabled', 'hotkeyEnabled', setupHotkey);
        bGInput('scp-sp-hotkey', 'hotkey', null, setupHotkey);
        
        bGCheck('scp-sp-icon-persistent', 'floatingIconPersistent', updateIconVisibility);

        // Window opacity (moved from header)
        const spOpSlider = document.getElementById('scp-sp-opacity-slider');
        const spOpVal = document.getElementById('scp-sp-opacity-val');
        if (spOpSlider) {
            spOpSlider.addEventListener('input', () => { if (spOpVal) spOpVal.textContent = `${spOpSlider.value}%`; });
            spOpSlider.addEventListener('change', () => {
                const v = parseInt(spOpSlider.value);
                saveGlobal('opacity', v, () => {
                    if (!_ghostModeActive && windowEl) windowEl.style.opacity = (v / 100).toString();
                });
            });
        }

        // Ghost mode settings
        bGCheck('scp-sp-ghost-hotkey-enabled', 'ghostModeHotkeyEnabled', setupGhostHotkey);
        bGInput('scp-sp-ghost-hotkey', 'ghostModeHotkey', null, setupGhostHotkey);

        const spGhOp = document.getElementById('scp-sp-ghost-opacity');
        const spGhOpVal = document.getElementById('scp-sp-ghost-opacity-val');
        if (spGhOp) {
            spGhOp.addEventListener('input', () => { if (spGhOpVal) spGhOpVal.textContent = `${spGhOp.value}%`; });
            spGhOp.addEventListener('change', () => {
                const v = parseInt(spGhOp.value);
                saveGlobal('ghostModeOpacity', v, () => {
                    if (_ghostModeActive && windowEl) windowEl.style.opacity = (v / 100).toString();
                });
            });
        }

        bGSelect('scp-sp-conn-source', 'connectionSource', v => {
            const gCp = document.getElementById('scp-sp-global-profile-group');
            if (gCp) gCp.style.display = v === 'profile' ? '' : 'none';
            if (v === 'profile') updateSPConnProfileList();
        });
        document.getElementById('scp-sp-conn-profile')?.addEventListener('mouseenter', updateSPConnProfileList);
        document.getElementById('scp-sp-conn-profile')?.addEventListener('change', e => saveGlobal('connectionProfileId', e.target.value));

        bGInput('scp-sp-max-tokens', 'maxTokens', Number);
        bGInput('scp-sp-history-limit', 'localHistoryLimit', Number, () => updateMsgCount(getCurrentSession()));

        const spDs = document.getElementById('scp-sp-depth-slider');
        const spDv = document.getElementById('scp-sp-depth-val');
        if (spDs) {
            spDs.addEventListener('input', () => { if (spDv) spDv.textContent = spDs.value; });
            spDs.addEventListener('change', () => {
                saveGlobal('contextDepth', parseInt(spDs.value), () => updateMsgCount(getCurrentSession()));
                const stSlider = document.getElementById('scp-depth-slider');
                const stVal = document.getElementById('scp-depth-val');
                if (stSlider) stSlider.value = spDs.value;
                if (stVal) stVal.textContent = spDs.value;
            });
        }

        bGCheck('scp-sp-include-sysprompt', 'includeSystemPrompt', () => updateMsgCount(getCurrentSession()));
        bGCheck('scp-sp-include-anote', 'includeAuthorsNote', () => updateMsgCount(getCurrentSession()));
        bGCheck('scp-sp-include-charcard', 'includeCharacterCard', () => updateMsgCount(getCurrentSession()));
        bGCheck('scp-sp-include-persona', 'includeUserPersonality', () => updateMsgCount(getCurrentSession()));
        bGInput('scp-sp-reasoning-trim', 'reasoningTrimStrings');

        document.getElementById('scp-sp-conn-source')?.addEventListener('change', e => {
            const v = e.target.value;
            saveGlobal('connectionSource', v, null);
            const gCp = document.getElementById('scp-sp-global-profile-group');
            if (gCp) gCp.style.display = v === 'profile' ? '' : 'none';
            if (v === 'profile') updateSPConnProfileList();
        });
        document.getElementById('scp-sp-conn-profile')?.addEventListener('mouseenter', updateSPConnProfileList);
        document.getElementById('scp-sp-conn-profile')?.addEventListener('change', e => saveGlobal('connectionProfileId', e.target.value, null));

        const spPrompt = document.getElementById('scp-sp-sysprompt');
        if (spPrompt) spPrompt.addEventListener('input', () => saveGlobal('systemPrompt', spPrompt.value, () => updateMsgCount(getCurrentSession())));
        document.getElementById('scp-sp-reset-prompt')?.addEventListener('click', async () => {
            const ok = await showCustomDialog({ type: 'confirm', title: 'Reset System Prompt', message: 'Reset to default?' });
            if (!ok) return;
            getSettings().systemPrompt = DEFAULT_SYSTEM_PROMPT;
            saveSettings();
            if (spPrompt) spPrompt.value = DEFAULT_SYSTEM_PROMPT;
            const stPrompt = document.getElementById('scp-sysprompt');
            if (stPrompt) stPrompt.value = DEFAULT_SYSTEM_PROMPT;
            updateMsgCount(getCurrentSession());
            toastr.success('System prompt reset.', EXT_DISPLAY);
        });

        bGInput('scp-sp-lb-manage-prompt', 'lorebookManagePrompt');
        document.getElementById('scp-sp-reset-lb-prompt')?.addEventListener('click', async () => {
            const ok = await showCustomDialog({ type: 'confirm', title: 'Reset LB Prompt', message: 'Reset to default?' });
            if (!ok) return;
            getSettings().lorebookManagePrompt = DEFAULT_LB_MANAGE_PROMPT;
            saveSettings();
            const el = document.getElementById('scp-sp-lb-manage-prompt'); if (el) el.value = DEFAULT_LB_MANAGE_PROMPT;
            const stEl = document.getElementById('scp-lb-manage-prompt'); if (stEl) stEl.value = DEFAULT_LB_MANAGE_PROMPT;
            toastr.success('Lorebook prompt reset.', EXT_DISPLAY);
        });
        bGInput('scp-sp-lb-st-scan-depth', 'lorebookSTScanDepth', Number);
        bGInput('scp-sp-lb-copilot-scan-depth', 'lorebookCopilotScanDepth', Number);

        // Config profiles
        document.getElementById('scp-sp-profile-select')?.addEventListener('change', async () => {
            const sel = document.getElementById('scp-sp-profile-select'); if (!sel?.value) return;
            if (isConfigProfileDirty()) {
                const ok = await showCustomDialog({ type: 'confirm', title: 'Unsaved Configuration', message: 'Unsaved changes in current profile. Switch anyway?' });
                if (!ok) { sel.value = getSettings().activeProfile || ''; return; }
            }
            loadProfile(sel.value);
            syncSPFromSettings();
            updateSettingsUI();
            updateSPBindingSection();
        });
        document.getElementById('scp-sp-profile-save')?.addEventListener('click', async () => {
            const sel = document.getElementById('scp-sp-profile-select');
            let name = sel?.value;
            if (!name) {
                name = await showCustomDialog({ type: 'prompt', title: 'Save Configuration', message: 'Profile name:', placeholder: 'My Config' });
                if (!name?.trim()) return;
                name = name.trim();
            }
            saveProfile(name); refreshSPProfilesDropdown(); refreshProfilesDropdown();
            if (sel) sel.value = name;
            updateSPBindingSection(); toastr.success(`Saved "${name}"`, EXT_DISPLAY);
        });
        document.getElementById('scp-sp-profile-create')?.addEventListener('click', async () => {
            const name = await showCustomDialog({ type: 'prompt', title: 'New Configuration', message: 'Name:', placeholder: 'New Config' });
            if (!name?.trim()) return;
            const n = name.trim(); const s = getSettings();
            s.profiles[n] = { systemPrompt: DEFAULT_SYSTEM_PROMPT, includeSystemPrompt: true, includeAuthorsNote: true, includeCharacterCard: true, includeUserPersonality: true, contextDepth: 15, localHistoryLimit: 50, connectionSource: 'default', connectionProfileId: '', maxTokens: 2048 };
            saveSettings(); refreshSPProfilesDropdown(); refreshProfilesDropdown();
            loadProfile(n); syncSPFromSettings(); updateSettingsUI();
            const sel = document.getElementById('scp-sp-profile-select'); if (sel) sel.value = n;
            updateSPBindingSection(); toastr.success(`Created "${n}"`, EXT_DISPLAY);
        });
        document.getElementById('scp-sp-profile-rename')?.addEventListener('click', async () => {
            const sel = document.getElementById('scp-sp-profile-select'); if (!sel?.value) return;
            const newName = await showCustomDialog({ type: 'prompt', title: 'Rename', message: 'New name:', defaultValue: sel.value });
            if (!newName?.trim() || newName.trim() === sel.value) return;
            const s = getSettings(); const p = s.profiles[sel.value]; if (!p) return;
            s.profiles[newName.trim()] = p; delete s.profiles[sel.value];
            if (s.activeProfile === sel.value) s.activeProfile = newName.trim();
            for (const k in s.profileBindings) { if (s.profileBindings[k] === sel.value) s.profileBindings[k] = newName.trim(); }
            saveSettings(); refreshSPProfilesDropdown(); refreshProfilesDropdown();
            const newSel = document.getElementById('scp-sp-profile-select'); if (newSel) newSel.value = newName.trim();
            updateSPBindingSection(); toastr.success('Renamed.', EXT_DISPLAY);
        });
        document.getElementById('scp-sp-profile-delete')?.addEventListener('click', async () => {
            const sel = document.getElementById('scp-sp-profile-select'); if (!sel?.value) return;
            const s = getSettings();
            if (Object.keys(s.profiles).length <= 1) { toastr.warning('Cannot delete the last profile.', EXT_DISPLAY); return; }
            const ok = await showCustomDialog({ type: 'confirm', title: 'Delete Profile', message: `Delete "${sel.value}"?` });
            if (!ok) return;
            deleteProfile(sel.value); refreshSPProfilesDropdown(); refreshProfilesDropdown();
            updateSPBindingSection(); toastr.success('Deleted.', EXT_DISPLAY);
        });
        document.getElementById('scp-sp-bind-char')?.addEventListener('click', () => {
            const sel = document.getElementById('scp-sp-profile-select'); if (!sel?.value) return;
            const s = getSettings(); const { charId } = getBindingKey(); const key = `char_${charId}`;
            if (s.profileBindings[key] === sel.value) delete s.profileBindings[key];
            else s.profileBindings[key] = sel.value;
            saveSettings(); updateSPBindingSection(); updateBindingSection();
        });
        document.getElementById('scp-sp-bind-chat')?.addEventListener('click', () => {
            const sel = document.getElementById('scp-sp-profile-select'); if (!sel?.value) return;
            const s = getSettings(); const { charId, chatId } = getBindingKey(); const key = `chat_${charId}_${chatId}`;
            if (s.profileBindings[key] === sel.value) delete s.profileBindings[key];
            else s.profileBindings[key] = sel.value;
            saveSettings(); updateSPBindingSection(); updateBindingSection();
        });

        document.getElementById('scp-sp-clear-sessions')?.addEventListener('click', async () => {
            const ok = await showCustomDialog({ type: 'confirm', title: 'Clear All Sessions', message: 'Delete ALL Copilot sessions for all characters? This cannot be undone.', delayConfirm: 3 });
            if (!ok) return;
            getSettings().sessions = {}; saveSettings(); onChatChanged();
            toastr.success('All sessions cleared.', EXT_DISPLAY);
        });

        // ── SESSION OVERRIDES ──

        // Auto-clear override if new value === global value
        const syncOvClear = (key, newVal) => {
            const globalVal = getSettings()[key];
            const isDefault = (newVal === undefined || newVal === null || newVal === '')
                ? true
                : (typeof globalVal === 'boolean'
                    ? newVal === globalVal
                    : String(newVal) === String(globalVal));
            if (isDefault) setSessionOverride(key, undefined);
            else setSessionOverride(key, newVal);
            updateSPOverrideIndicators();
            updateMsgCount(getCurrentSession());
        };

        const bindOvCheck = (spId, key) => {
            const el = document.getElementById(spId); if (!el) return;
            el.addEventListener('change', () => syncOvClear(key, el.checked));
        };
        const bindOvInput = (spId, key, toVal) => {
            const el = document.getElementById(spId); if (!el) return;
            el.addEventListener('input', () => {
                const raw = el.value === '' ? undefined : (toVal ? toVal(el.value) : el.value);
                syncOvClear(key, raw);
            });
        };

        const ovDs = document.getElementById('scp-sp-ov-depth-slider');
        const ovDv = document.getElementById('scp-sp-ov-depth-val');
        if (ovDs) {
            ovDs.addEventListener('input', () => { if (ovDv) ovDv.textContent = ovDs.value; });
            ovDs.addEventListener('change', () => syncOvClear('contextDepth', parseInt(ovDs.value)));
        }

        document.getElementById('scp-sp-ov-conn-source')?.addEventListener('change', e => {
            syncOvClear('connectionSource', e.target.value);
            const pg = document.getElementById('scp-sp-ov-profile-group');
            if (pg) pg.style.display = e.target.value === 'profile' ? '' : 'none';
            if (e.target.value === 'profile') updateSPConnProfileList();
        });
        document.getElementById('scp-sp-ov-conn-profile')?.addEventListener('mouseenter', updateSPConnProfileList);
        document.getElementById('scp-sp-ov-conn-profile')?.addEventListener('change', e => {
            syncOvClear('connectionProfileId', e.target.value);
        });

        bindOvInput('scp-sp-ov-max-tokens', 'maxTokens', Number);
        bindOvInput('scp-sp-ov-history-limit', 'localHistoryLimit', Number);
        bindOvInput('scp-sp-ov-reasoning-trim', 'reasoningTrimStrings');

        const ovPrompt = document.getElementById('scp-sp-ov-sysprompt');
        if (ovPrompt) ovPrompt.addEventListener('input', () => syncOvClear('systemPrompt', ovPrompt.value || undefined));

        bindOvCheck('scp-sp-ov-include-sysprompt', 'includeSystemPrompt');
        bindOvCheck('scp-sp-ov-include-anote', 'includeAuthorsNote');
        bindOvCheck('scp-sp-ov-include-charcard', 'includeCharacterCard');
        bindOvCheck('scp-sp-ov-include-persona', 'includeUserPersonality');

        // Clear individual override buttons
        overlay.querySelectorAll('.scp-sp-ov-clear[data-ovkey]').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.dataset.ovkey;
                setSessionOverride(key, undefined);
                // Re-sync that specific field from effective settings
                const eff = getEffectiveSettings();
                const ov = getSessionOverrides();
                const elMap = {
                    contextDepth: ['scp-sp-ov-depth-slider', 'scp-sp-ov-depth-val'],
                    maxTokens: ['scp-sp-ov-max-tokens'],
                    localHistoryLimit: ['scp-sp-ov-history-limit'],
                    reasoningTrimStrings: ['scp-sp-ov-reasoning-trim'],
                    systemPrompt: ['scp-sp-ov-sysprompt'],
                    connectionSource: ['scp-sp-ov-conn-source'],
                    connectionProfileId: ['scp-sp-ov-conn-profile'],
                    includeSystemPrompt: ['scp-sp-ov-include-sysprompt'],
                    includeAuthorsNote: ['scp-sp-ov-include-anote'],
                    includeCharacterCard: ['scp-sp-ov-include-charcard'],
                    includeUserPersonality: ['scp-sp-ov-include-persona'],
                };
                (elMap[key] || []).forEach(id => {
                    const el = document.getElementById(id); if (!el) return;
                    if (id.includes('depth-val')) { el.textContent = eff.contextDepth ?? 15; return; }
                    if (el.type === 'checkbox') el.checked = !!eff[key];
                    else if (el.type === 'range') el.value = eff[key] ?? 15;
                    else if (id === 'scp-sp-ov-conn-source') {
                        el.value = eff.connectionSource ?? 'default';
                        const pg = document.getElementById('scp-sp-ov-profile-group');
                        if (pg) pg.style.display = el.value === 'profile' ? '' : 'none';
                    }
                    else if (id === 'scp-sp-ov-conn-profile') {
                        el.value = eff.connectionProfileId ?? '';
                    }
                    else el.value = (key in ov ? ov[key] : '') ?? '';
                });
                updateSPOverrideIndicators();
                updateMsgCount(getCurrentSession());
            });
        });

        document.getElementById('scp-sp-reset-all-overrides')?.addEventListener('click', async () => {
            if (!hasSessionOverrides()) { toastr.info('No session overrides active.', EXT_DISPLAY); return; }
            const ok = await showCustomDialog({ type: 'confirm', title: 'Reset Session Overrides', message: 'Clear all session overrides for this session?' });
            if (!ok) return;
            clearAllSessionOverrides();
            syncSPFromSettings();
            updateMsgCount(getCurrentSession());
            toastr.success('Session overrides cleared.', EXT_DISPLAY);
        });
    }

    // ─── Window Event Listeners ─────────────────────────────────────────────────

    function attachWindowListeners() {
        makeDraggable($('scp-drag-handle'), windowEl);
        makeResizable(windowEl);

        window.addEventListener('resize', () => {
            if (windowEl && windowEl.style.display !== 'none') {
                const r = windowEl.getBoundingClientRect();
                let changed = false;
                let newX = r.left, newY = r.top;
                
                if (r.right > window.innerWidth) { newX = Math.max(0, window.innerWidth - r.width); changed = true; }
                if (r.bottom > window.innerHeight && r.top > 50) { newY = Math.max(0, window.innerHeight - r.height); changed = true; }
                
                if (changed) {
                    windowEl.style.left = `${newX}px`; windowEl.style.top = `${newY}px`;
                    const s = getSettings();
                    s.windowX = newX; s.windowY = newY;
                    saveSettings();
                }
            }
            
            if (iconEl && iconEl.style.display !== 'none') {
                const vw = window.visualViewport ? window.visualViewport.width : window.innerWidth;
                const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
                const iconSize = 46;
                let curLeft = parseFloat(iconEl.style.left);
                let curTop = parseFloat(iconEl.style.top);
                
                if (!isNaN(curLeft) && !isNaN(curTop)) {
                    let newLeft = Math.max(0, Math.min(curLeft, vw - iconSize));
                    let newTop = Math.max(0, Math.min(curTop, vh - iconSize));
                    
                    if (newLeft !== curLeft || newTop !== curTop) {
                        iconEl.style.left = `${newLeft}px`;
                        iconEl.style.top = `${newTop}px`;
                        localStorage.setItem(ICON_STORAGE_KEY, JSON.stringify({ left: `${newLeft}px`, top: `${newTop}px` }));
                    }
                }
            }
        });

        $('scp-min-btn')?.addEventListener('click', minimize);
        $('scp-close-btn')?.addEventListener('click', hideWindow);
        $('scp-ext-settings-btn')?.addEventListener('click', openExtensionSettings);
        if (iconEl) makeIconDraggable(iconEl);

        // Ghost mode
        $('scp-ghost-btn')?.addEventListener('click', toggleGhostMode);


        // Session dropdown
        $('scp-sess-trigger')?.addEventListener('click', e => {
            e.stopPropagation();
            const panel = $('scp-sess-panel'); const trigger = $('scp-sess-trigger');
            const isOpen = panel.classList.contains('open');
            panel.classList.toggle('open', !isOpen); trigger.classList.toggle('open', !isOpen);
            if (!isOpen) refreshSessionDropdown();
        });
        document.addEventListener('click', e => {
            const dd = $('scp-sess-dropdown');
            if (dd && !dd.contains(e.target)) closeSessPanel();
            if (!e.target.closest('.scp-lb-proposal-world-dd')) {
                document.querySelectorAll('.scp-lb-proposal-world-panel.open').forEach(p => {
                    p.classList.remove('open');
                    p.previousElementSibling?.classList.remove('open');
                });
            }
        });
        $('scp-new-sess-btn')?.addEventListener('click', async () => {
            closeSessPanel();
            const { charId, chatId } = getBindingKey();
            const bucket = getChatBucket(charId, chatId);

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
            createSession(charId, chatId, result.name.trim() || defaultName, result.isTemporary);
            refreshSessionDropdown(); renderSession(getCurrentSession());
        });

        $('scp-rename-sess-btn')?.addEventListener('click', async () => {
            const sess = getCurrentSession();
            const newName = await showCustomDialog({ type: 'prompt', title: 'Rename Session', message: 'New session name:', defaultValue: sess.name });
            if (!newName?.trim()) return;
            sess.name = newName.trim(); saveSettings(); refreshSessionDropdown();
        });

        $('scp-del-sess-btn')?.addEventListener('click', async () => {
            const { charId, chatId } = getBindingKey();
            const bucket = getChatBucket(charId, chatId);
            if (!bucket.sessions.length) return;
            const ok = await showCustomDialog({ type: 'confirm', title: 'Delete Session', message: 'Delete this session and all its messages? This cannot be undone.' });
            if (!ok) return;
            const newSess = deleteCurrentSession(charId, chatId);
            refreshSessionDropdown(); renderSession(newSess);
        });

        // Depth slider
        const depthSlider = $('scp-depth-slider');
        if (depthSlider) {
            depthSlider.value = getSettings().contextDepth;
            $('scp-depth-val').textContent = depthSlider.value;
            
            depthSlider.addEventListener('input', () => {
                $('scp-depth-val').textContent = depthSlider.value;
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

        // Actions
        $('scp-inspect-btn')?.addEventListener('click', openInspector);
        $('scp-regen-btn')?.addEventListener('click', handleRegen);
        const lbBtn = $('scp-lb-btn');
        if (lbBtn) {
            let _lbTouchPending = false;
            lbBtn.addEventListener('touchend', e => {
                e.preventDefault();
                _lbTouchPending = true;
                openLorebookManager();
                setTimeout(() => { _lbTouchPending = false; }, 400);
            }, { passive: false });
            lbBtn.addEventListener('click', () => { if (!_lbTouchPending) openLorebookManager(); });
        }

        // Search
        $('scp-search-btn')?.addEventListener('click', () => { _searchOpen ? closeSearch() : openSearch(); });

        // Chat Message Picker
        $('scp-pick-btn')?.addEventListener('click', openChatPicker);

        // Quick Prompts toggle
        $('scp-qp-toggle-btn')?.addEventListener('click', () => {
            const s = getSettings();
            s.quickPromptsVisible = !s.quickPromptsVisible;
            saveSettings(); renderQuickPromptsBar();
        });

        // Desktop horizontal scroll for QP bar (wheel → scrollLeft)
        const qpBar = $('scp-qp-bar');
        if (qpBar) {
            qpBar.addEventListener('wheel', e => {
                if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return; // already horizontal native scroll
                e.preventDefault();
                // Normalize: deltaMode 0=px, 1=line(~20px), 2=page
                const delta = e.deltaMode === 1 ? e.deltaY * 20 : e.deltaMode === 2 ? e.deltaY * 200 : e.deltaY;
                qpBar.scrollLeft += delta;
            }, { passive: false });
        }
        $('scp-search-close')?.addEventListener('click', closeSearch);
        $('scp-search-prev')?.addEventListener('click', () => navigateSearch(-1));
        $('scp-search-next')?.addEventListener('click', () => navigateSearch(1));
        $('scp-search-word')?.addEventListener('click', () => {
            _searchWholeWord = !_searchWholeWord;
            $('scp-search-word')?.classList.toggle('active', _searchWholeWord);
            if (_searchQuery.trim()) performSearch();
        });

        const searchInputEl = $('scp-search-input');
        if (searchInputEl) {
            searchInputEl.addEventListener('input', () => {
                _searchQuery = searchInputEl.value;
                clearTimeout(_searchDebounceId);
                _searchDebounceId = setTimeout(performSearch, 220);
            });
            searchInputEl.addEventListener('keydown', e => {
                if (e.key === 'Enter') { e.preventDefault(); navigateSearch(e.shiftKey ? -1 : 1); }
                if (e.key === 'Escape') { e.stopPropagation(); closeSearch(); }
            });
        }

        // Ctrl+F / Cmd+F opens search;
        document.addEventListener('keydown', e => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                const win = document.getElementById(WIN_ID);
                if (!win || win.style.display === 'none') return;
                const active = document.activeElement;
                if (active && !win.contains(active) && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) return;
                e.preventDefault();
                e.stopPropagation();
                if (_searchOpen) { document.getElementById('scp-search-input')?.focus(); }
                else openSearch();
            }
        }, true);
        $('scp-stop-btn')?.addEventListener('click', () => {
            _abortController?.abort();
            const { stopGeneration } = SillyTavern.getContext();
            if (typeof stopGeneration === 'function') stopGeneration();
        });

        // Input
        const inputEl = $('scp-input');
        if (inputEl) {
            inputEl.addEventListener('input', () => autoResize(inputEl));
            inputEl.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } });
        }
        $('scp-send-btn')?.addEventListener('click', handleSend);

        // Modal
        $('scp-modal-close')?.addEventListener('click', () => { modalEl.style.display = 'none'; });
        let _modalMouseDown = null;
        modalEl?.addEventListener('mousedown', e => { _modalMouseDown = e.target; });
        modalEl?.addEventListener('click', e => { if (e.target === modalEl && _modalMouseDown === modalEl) modalEl.style.display = 'none'; });
        document.querySelectorAll('.scp-modal-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.scp-modal-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                $('scp-ctx-formatted').style.display = tab.dataset.tab === 'formatted' ? '' : 'none';
                $('scp-ctx-json').style.display = tab.dataset.tab === 'json' ? '' : 'none';
            });
        });
        $('scp-ctx-copy-btn')?.addEventListener('click', () => {
            const activeTab = document.querySelector('.scp-modal-tab.active');
            const text = activeTab?.dataset.tab === 'json'
                ? $('scp-ctx-json')?.textContent || ''
                : $('scp-ctx-formatted')?.textContent || '';
            copyText(text);
        });
    }

    // ─── Chat Change ─────────────────────────────────────────────────────────────

    function onChatChanged() {
        _lastChatLen = -1;
        updateCharBadge();
        refreshSessionDropdown();
        renderSession(getCurrentSession());
        autoLoadBoundProfile();
        updateSessionOverrideIndicator();
        updateDepthSlidersMax();
        renderQuickPromptsBar();
        updatePickBtnState();
    }

    // ─── Wand Button ─────────────────────────────────────────────────────────────

    function addWandButton() {
        const menu = document.getElementById('extensionsMenu');
        if (!menu || document.getElementById('scp-wand-btn')) return;
        const btn = document.createElement('div');
        btn.id = 'scp-wand-btn';
        btn.classList.add('list-group-item', 'flex-container', 'flexGap5');
        btn.innerHTML = `<div class="fa-solid fa-robot extensionsMenuExtensionButton"></div><span>${EXT_DISPLAY}</span>`;
        btn.style.display = getSettings().enabled ? '' : 'none';
        btn.addEventListener('click', toggleVisibility);
        menu.appendChild(btn);
    }

    // ─── Init ────────────────────────────────────────────────────────────────────

    async function init() {
        try { ST_WorldInfo = await import('/scripts/world-info.js'); } catch(e) { console.warn('ST-Copilot: Could not import world-info.js'); }
        try { ST_Utils = await import('/scripts/utils.js'); } catch(e) { console.warn('ST-Copilot: Could not import utils.js'); }
        getSettings(); await injectUI();
        const ctx = SillyTavern.getContext();
        const container = document.getElementById('extensions_settings') || document.getElementById('extensions_settings2');
        if (container) {
            try {
                const html = await ctx.renderExtensionTemplateAsync(__extPath, 'settings');
                if (html) container.insertAdjacentHTML('beforeend', html);
            } catch (e) {}
        }
        restoreWindowState(); attachWindowListeners(); setupSettingsHandlers(); setupLorebookManagerListeners(); setupSettingsPanelListeners(); setupChatPickerListeners();
        
        const s = getSettings();
        
        if (s.windowVisible && !s.minimized) {
            windowEl.style.display = 'flex';
        } else {
            windowEl.style.display = 'none';
        }
        
        updateIconVisibility();
        
        onChatChanged();
        const es = ctx.eventSource || window.eventSource;
        const et = ctx.event_types || window.event_types || {};

        if (es) {
            es.on(et.CHAT_CHANGED || 'chat_changed', onChatChanged);
            es.on(et.CHARACTER_SELECTED || 'character_selected', onChatChanged);
            es.on(et.APP_READY || 'app_ready', updateProfilesList);
            
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
        
        setupHotkey(); setupGhostHotkey(); addWandButton();

        window.addEventListener('message', e => {
            if (!e.data || typeof e.data !== 'object') return;
            if (e.data.type === 'scp-iframe-h') {
                document.querySelectorAll('.scp-html-block-iframe').forEach(f => {
                    try {
                        if (f.contentWindow === e.source) {
                            f.style.height = `${Math.max(40, Math.min(1200, e.data.h + 16))}px`;
                        }
                    } catch(_) {}
                });
            } else if (e.data.type === 'scp-iframe-bg') {
                document.querySelectorAll('.scp-html-block-iframe').forEach(f => {
                    try {
                        if (f.contentWindow === e.source) {
                            f.style.background = e.data.hasBg ? 'transparent' : '#ffffff';
                        }
                    } catch(_) {}
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

        console.log(`[${EXT_DISPLAY}] Initialized.`);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else setTimeout(init, 0);
})();