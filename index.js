(function () {
    'use strict';

    const EXT_NAME = 'st_copilot';
    const EXT_DISPLAY = 'ST-Copilot';
    const WIN_ID = 'scp-window';
    const ICON_ID = 'scp-dock-icon';
    const MODAL_ID = 'scp-ctx-modal';
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
    `You are authorized to propose Lorebook updates ONLY when explicitly commanded by the user.\n` +
    `\n` +
    `When triggered, generate a markdown code block tagged exactly as \`lorebook-changes\`.\n` +
    `\n` +
    `Format requirment:\n` +
    `{{lorebook_output}}\n` +
    `You should write these changes at the very end of your message.`;

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
            label: 'Default Dark',
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
            label: 'Deep Dark',
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
        if (typeof ctx.saveWorldInfo === 'function') {
            await ctx.saveWorldInfo(name, payload);
        } else {
            const res = await fetch('/api/worldinfo/edit', {
                method: 'POST',
                headers: { ...ctx.getRequestHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, data: payload }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
        
        const rawPrompt = settings.lorebookManagePrompt || DEFAULT_LB_MANAGE_PROMPT;
        const prompt = rawPrompt
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
        
        // Попытка найти точную запись из тех, что недавно улетали в контекст (устраняет галлюцинации)
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

        return { bookName, data, origEntry };
    }

    async function applyLBChanges(changes) {
        const bookCache = {};
        for (const change of changes) {
            const { bookName, data, origEntry } = await resolveLBChangeTarget(change);
            if (!data || !bookName) continue;
            
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
                bookCache[bookName] = data;
            } else if (change.action === 'edit' && origEntry) {
                if (change.name !== undefined) origEntry.comment = change.name;
                if (change.triggers !== undefined) origEntry.key = change.triggers;
                if (change.content !== undefined) origEntry.content = change.content;
                bookCache[bookName] = data;
            } else if (change.action === 'delete' && origEntry) {
                delete data.entries[origEntry.uid];
                bookCache[bookName] = data;
            }
        }
        for (const [name, data] of Object.entries(bookCache)) await saveWorldInfoBook(name, data);

        try {
            const session = getCurrentSession();
            const icons = { add: '✚', edit: '✎', delete: '✕' };
            const newLines = changes.map(c => `${icons[c.action] || '·'} **${escHtml(c.name || `Entry #${c.uid || '?'}`)}** in \`${escHtml(c.worldName || '?')}\``);

            const lastMsg = session.messages[session.messages.length - 1];
            if (lastMsg && lastMsg.isLBHistory) {
                if (!lastMsg.appliedLines) lastMsg.appliedLines = [];
                lastMsg.appliedLines.push(...newLines);
                const total = lastMsg.appliedLines.length;
                lastMsg.content = `**Lorebook Updated** — ${total} change${total !== 1 ? 's' : ''} applied:\n${lastMsg.appliedLines.join('\n')}`;
                updateMessage(session, lastMsg.id, lastMsg.content);
                
                const msgEl = document.querySelector(`.scp-msg[data-id="${lastMsg.id}"] .scp-msg-content`);
                if (msgEl) msgEl.innerHTML = renderMarkdown(lastMsg.content);
            } else {
                const histText = `**Lorebook Updated** — ${changes.length} change${changes.length !== 1 ? 's' : ''} applied:\n${newLines.join('\n')}`;
                const histMsg = addMessage(session, 'assistant', histText, { isLBHistory: true, appliedLines: [...newLines] });
                appendLBHistoryEl(histMsg);
            }
        } catch (_) {}
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

    function appendLBHistoryEl(msg) {
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

        body.appendChild(content); body.appendChild(meta);
        wrap.appendChild(avatar); wrap.appendChild(body);
        c.appendChild(wrap);
        updateMsgCount(getCurrentSession());
        scrollToBottom();
    }

    // ─── Lorebook Manager UI ─────────────────────────────────────────────────────

    let _lbActiveBook = null;
    let _lbSearchQuery = '';
    let _lbEntryDetailEntry = null;
    let _lbEntryDetailBook = null;

    function buildLorebookManagerHTML() {
        return `
<div id="scp-lb-overlay" class="scp-lb-overlay" style="display:none">
    <div class="scp-lb-panel">
        <div class="scp-lb-header">
            <div class="scp-lb-header-left">
                <span class="scp-lb-title-icon">${I.book}</span>
                <span class="scp-lb-title">Lorebook Manager</span>
            </div>
            <div class="scp-lb-header-center">
                <div class="scp-lb-search-wrap">
                    ${I.search}
                    <input type="text" id="scp-lb-search" class="scp-lb-search" placeholder="Search entries by name, keys, content…">
                </div>
            </div>
            <div class="scp-lb-header-right">
                <label class="scp-lb-toggle-wrap" title="Auto-inject entries whose keywords appear in main chat or Copilot">
                    <span class="scp-lb-toggle-label">Auto-Keywords</span>
                    <div class="scp-lb-toggle" id="scp-lb-auto-kw-toggle"><div class="scp-lb-toggle-knob"></div></div>
                </label>
                <label class="scp-lb-toggle-wrap" title="Allow AI to propose lorebook changes via chat">
                    <span class="scp-lb-toggle-label">AI Edits</span>
                    <div class="scp-lb-toggle" id="scp-lb-ai-toggle"><div class="scp-lb-toggle-knob"></div></div>
                </label>
                <button class="scp-hbtn scp-hbtn-close" id="scp-lb-close">${I.x}</button>
            </div>
        </div>

        <div class="scp-lb-body">
            <div class="scp-lb-sidebar">
                <div class="scp-lb-sidebar-header">
                    <span class="scp-lb-sidebar-title">Lorebooks</span>
                    <button class="scp-tbtn" id="scp-lb-refresh" title="Refresh list">${I.refresh}</button>
                </div>
                <div class="scp-lb-book-list" id="scp-lb-book-list">
                    <div class="scp-lb-loading">Loading\u2026</div>
                </div>
                <div class="scp-lb-sidebar-legend">
                    <span class="scp-lb-legend-item"><span class="scp-lb-src-badge scp-lb-src-global">G</span> Global</span>
                    <span class="scp-lb-legend-item"><span class="scp-lb-src-badge scp-lb-src-character">C</span> Char</span>
                    <span class="scp-lb-legend-item"><span class="scp-lb-src-badge scp-lb-src-chat">Ch</span> Chat</span>
                </div>
            </div>

            <div class="scp-lb-main">
                <div class="scp-lb-main-toolbar">
                    <span class="scp-lb-entries-label" id="scp-lb-entries-label">Select a lorebook</span>
                    <div class="scp-lb-main-actions" id="scp-lb-main-actions" style="display:none">
                        <button class="scp-lb-bulk-btn" id="scp-lb-enable-all">Force All On</button>
                        <button class="scp-lb-bulk-btn" id="scp-lb-disable-all">Force All Off</button>
                        <button class="scp-lb-bulk-btn" id="scp-lb-reset-overrides">Reset All</button>
                        <button class="scp-lb-bulk-btn scp-lb-add-btn" id="scp-lb-add-entry">${I.plus} New Entry</button>
                    </div>
                </div>
                <div class="scp-lb-ctx-legend" id="scp-lb-ctx-legend" style="display:none">
                    <span class="scp-lb-ctx-legend-item"><span class="scp-lb-ind-demo scp-lb-ind-in-ctx"></span>In context</span>
                    <span class="scp-lb-ctx-legend-item"><span class="scp-lb-ind-demo forced-on"></span>Force On</span>
                    <span class="scp-lb-ctx-legend-item"><span class="scp-lb-ind-demo forced-off"></span>Force Off</span>
                    <span class="scp-lb-ctx-legend-item"><span class="scp-lb-ind-demo scp-lb-ind-demo-disabled"></span>Disabled</span>
                    <span class="scp-lb-ctx-legend-item"><span class="scp-lb-ind-demo"></span>Default</span>
                </div>
                <div class="scp-lb-entries-container">
                    <div class="scp-lb-entries" id="scp-lb-entries">
                        <div class="scp-lb-empty-state"><div class="scp-empty-icon">${I.book}</div><div>Select a lorebook to view its entries</div></div>
                    </div>
                    <div class="scp-lb-entry-detail" id="scp-lb-entry-detail" style="display:none">
                        <div class="scp-lb-detail-header">
                            <button class="scp-lb-back-btn" id="scp-lb-back">\u2190 Back</button>
                            <span class="scp-lb-detail-title" id="scp-lb-detail-title">Entry</span>
                            <div class="scp-lb-detail-actions">
                                <button class="scp-lb-detail-btn" id="scp-lb-detail-copy" title="Copy content">${I.copy}</button>
                                <button class="scp-lb-detail-btn scp-lb-detail-save-btn" id="scp-lb-detail-save" title="Save">${I.check} Save</button>
                                <button class="scp-lb-detail-btn scp-lb-detail-danger" id="scp-lb-detail-delete" title="Delete entry">${I.trash}</button>
                            </div>
                        </div>
                        <div class="scp-lb-detail-body">
                            <div class="scp-lb-detail-row">
                                <label class="scp-lb-detail-label">Name / Comment</label>
                                <input type="text" class="scp-lb-detail-input" id="scp-lb-detail-name" placeholder="Entry name">
                            </div>
                            <div class="scp-lb-detail-row">
                                <label class="scp-lb-detail-label">Trigger Keys <span class="scp-lb-label-hint">(comma-separated)</span></label>
                                <input type="text" class="scp-lb-detail-input" id="scp-lb-detail-triggers" placeholder="keyword1, keyword2, /regex/i">
                            </div>
                            <div class="scp-lb-detail-row scp-lb-detail-row-grow">
                                <label class="scp-lb-detail-label">Content</label>
                                <textarea class="scp-lb-detail-textarea" id="scp-lb-detail-content" placeholder="Entry content\u2026"></textarea>
                            </div>
                            <div class="scp-lb-detail-meta-row">
                                <div class="scp-lb-detail-meta-item">
                                    <span class="scp-lb-detail-label">Lorebook Status</span>
                                    <div class="scp-lb-detail-status" id="scp-lb-detail-lb-status" title="Click to toggle in lorebook">Enabled</div>
                                </div>
                                <div class="scp-lb-detail-meta-item">
                                    <span class="scp-lb-detail-label">Copilot Context Injection</span>
                                    <div style="display:flex;flex-direction:column;gap:4px">
                                        <div class="scp-lb-detail-injection">
                                            <button class="scp-lb-inj-btn" data-val="default" id="scp-lb-inj-default">Default</button>
                                            <button class="scp-lb-inj-btn" data-val="true" id="scp-lb-inj-force-on">Force On</button>
                                            <button class="scp-lb-inj-btn" data-val="false" id="scp-lb-inj-force-off">Force Off</button>
                                        </div>
                                        <span class="scp-lb-inj-hint" id="scp-lb-inj-hint"></span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="scp-lb-footer">
            <span class="scp-lb-footer-info" id="scp-lb-footer-info"></span>
            <span class="scp-lb-footer-ctx" id="scp-lb-footer-ctx"></span>
        </div>
    </div>
</div>

<div id="scp-diff-modal" class="scp-modal-overlay" style="display:none">
    <div class="scp-modal scp-diff-modal-box">
        <div class="scp-modal-header">
            <span class="scp-diff-modal-title">${I.edit} Diff View</span>
            <button class="scp-hbtn scp-hbtn-close" id="scp-diff-close">${I.x}</button>
        </div>
        <div class="scp-modal-tabs">
            <button class="scp-modal-tab active" data-diff-tab="split">Split</button>
            <button class="scp-modal-tab" data-diff-tab="unified">Unified</button>
        </div>
        <div class="scp-modal-body scp-diff-body" id="scp-diff-body"></div>
    </div>
</div>`;
    }
    
    function renderProposalCard(changes, msgEl) {
        if (!changes?.length) return;
        document.querySelector(`.scp-lb-proposal-card[data-for="${msgEl.dataset.id}"]`)?.remove();

        const editableChanges = changes.map(c => ({ ...c }));
        const itemStates = editableChanges.map(() => 'pending'); // 'pending'|'applied'|'rejected'
        const actionLabels = { add: '+ Add', edit: '✎ Edit', delete: '✕ Remove' };

        const card = document.createElement('div');
        card.className = 'scp-lb-proposal-card';
        card.dataset.for = msgEl.dataset.id;

        const stripAndSave = () => {
            const session = getCurrentSession();
            const msg = session.messages.find(m => m.id === card.dataset.for);
            if (msg) { msg.content = stripLBChangesBlock(msg.content); saveSettings(); }
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
        dismissBtn.addEventListener('click', () => { stripAndSave(); card.remove(); });

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
                <span class="scp-lb-proposal-name">${escHtml(c.name || c.originalName || `Entry #${c.uid || '?'}`)}</span>
                <span class="scp-lb-proposal-world">in ${escHtml(c.worldName || '?')}</span>`;

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
                    await applyLBChanges([editableChanges[ci]]);
                    itemStates[ci] = 'applied';
                    item.classList.add('scp-lb-item-applied');
                    itemBtns.querySelectorAll('button').forEach(b => { b.disabled = true; });
                    _wiCache = {};
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
                updateCountBadge();
                updateFooterBtns();
                checkAllResolved();
            });

            itemBtns.appendChild(applyItemBtn);
            itemBtns.appendChild(rejectItemBtn);
            itemHeader.appendChild(itemMeta);
            itemHeader.appendChild(itemBtns);
            item.appendChild(itemHeader);

            // Preview / triggers
            let previewEl = null, triggersEl = null;
            if (c.content) {
                previewEl = document.createElement('div');
                previewEl.className = 'scp-lb-proposal-preview';
                previewEl.textContent = c.content.slice(0, 120) + (c.content.length > 120 ? '…' : '');
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
                await applyLBChanges(pending);
                itemStates.forEach((s, i) => { if (s === 'pending') { itemStates[i] = 'applied'; itemEls[i].classList.add('scp-lb-item-applied'); itemEls[i].querySelectorAll('button').forEach(b => { b.disabled = true; }); } });
                _wiCache = {};
                updateCountBadge(); updateFooterBtns(); checkAllResolved();
            } catch (e) {
                toastr.error(`Failed: ${e.message}`, EXT_DISPLAY);
                applyAllBtn.disabled = false; applyAllBtn.textContent = 'Apply All';
            }
        });

        rejectAllBtn.addEventListener('click', () => {
            itemStates.forEach((s, i) => { if (s === 'pending') { itemStates[i] = 'rejected'; itemEls[i].classList.add('scp-lb-item-rejected'); itemEls[i].querySelectorAll('button').forEach(b => { b.disabled = true; }); } });
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
        await refreshLorebookList();
        if (_lbActiveBook) await renderEntryList(_lbActiveBook, _lbSearchQuery);
        // Background context refresh to update _lastActiveEntries for accurate indicators
        buildLorebookContextBlock(s).then(() => {
            if (_lbActiveBook) renderEntryList(_lbActiveBook, _lbSearchQuery);
        }).catch(() => {});
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
                ? `${activeEntryUids.size} entr${activeEntryUids.size !== 1 ? 'ies' : 'y'} active in last request`
                : '';
        }
    }

    function cycleEntryOverride(bookName, entry, rowEl) {
        const s = getSettings();
        if (!s.lorebookEntryOverrides) s.lorebookEntryOverrides = {};
        const key = `${bookName}_${entry.uid}`;
        const current = s.lorebookEntryOverrides[key];
        let next;
        if (current === undefined) next = true;
        else if (current === true) next = false;
        else { delete s.lorebookEntryOverrides[key]; next = undefined; }
        if (next !== undefined) s.lorebookEntryOverrides[key] = next;
        saveSettings();

        const ind = rowEl.querySelector('.scp-lb-entry-indicator');
        const btn = rowEl.querySelector('.scp-lb-entry-toggle-btn');
        const isConstant = !!entry.constant && !entry.disable;

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
            else if (isInCtx) hintEl.textContent = '✓ Was in last Copilot request context.';
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
        document.getElementById('scp-lb-overlay')?.addEventListener('click', e => {
            if (e.target === document.getElementById('scp-lb-overlay')) closeLorebookManager();
        });

        const diffModal = document.getElementById('scp-diff-modal');
        document.getElementById('scp-diff-close')?.addEventListener('click', () => { if (diffModal) diffModal.style.display = 'none'; });
        diffModal?.addEventListener('click', e => { if (e.target === diffModal) diffModal.style.display = 'none'; });
        document.getElementById('scp-lb-auto-kw-toggle')?.addEventListener('click', () => {
            const s = getSettings(); s.lorebookAutoKeyword = !s.lorebookAutoKeyword; saveSettings();
            document.getElementById('scp-lb-auto-kw-toggle').classList.toggle('active', s.lorebookAutoKeyword);
            updateLBFooterInfo();
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
        });
        document.getElementById('scp-lb-disable-all')?.addEventListener('click', () => {
            if (!_lbActiveBook || !_wiCache[_lbActiveBook]) return;
            const s = getSettings();
            Object.values(_wiCache[_lbActiveBook].entries).forEach(e => { s.lorebookEntryOverrides[`${_lbActiveBook}_${e.uid}`] = false; });
            saveSettings(); renderEntryList(_lbActiveBook, _lbSearchQuery);
        });
        document.getElementById('scp-lb-reset-overrides')?.addEventListener('click', async () => {
            if (!_lbActiveBook) return;
            const ok = await showCustomDialog({ type: 'confirm', title: 'Reset Overrides', message: `Reset all copilot injection overrides for "${_lbActiveBook}"?` });
            if (!ok) return;
            const s = getSettings();
            if (_wiCache[_lbActiveBook]) Object.values(_wiCache[_lbActiveBook].entries).forEach(e => { delete s.lorebookEntryOverrides[`${_lbActiveBook}_${e.uid}`]; });
            saveSettings(); renderEntryList(_lbActiveBook, _lbSearchQuery);
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
        };
        for (const [k, v] of Object.entries(defaults)) {
            if (s[k] === undefined) s[k] = v;
        }
        return s;
    }

    function saveSettings() {
        SillyTavern.getContext().saveSettingsDebounced();
    }

    // ─── Custom Dialog (replaces browser prompt/confirm/alert) ──────────────────

    function escHtml(str) {
        return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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
            overlay.addEventListener('click', e => { if (e.target === overlay) close(isPrompt ? null : false); });
            const keyHandler = e => {
                if (e.key === 'Enter') { e.preventDefault(); if (!okBtn.disabled) close(isPrompt ? input.value : true); }
                if (e.key === 'Escape') close(isPrompt ? null : false);
            };
            (input || overlay).addEventListener('keydown', keyHandler);
            requestAnimationFrame(() => overlay.classList.add('visible'));
        });
    }

    // ─── Session & Binding ──────────────────────────────────────────────────────

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

    function createSession(charId, chatId, name) {
        const bucket = getChatBucket(charId, chatId);
        const id = genId('sess');
        const sess = { id, name: name || `Session ${bucket.sessions.length + 1}`, created: Date.now(), messages: [] };
        bucket.sessions.push(sess);
        bucket.activeSessionId = id;
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
        if (bucket.sessions.find(s => s.id === sessionId)) { bucket.activeSessionId = sessionId; saveSettings(); }
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
        return {
            name: char.name || 'Unknown',
            description: char.description || '',
            personality: char.personality || '',
            scenario: char.scenario || '',
            mes_example: char.mes_example || '',
            system_prompt: char.system_prompt || '',
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
        return ctx.chatMetadata?.note_prompt || ctx.authorsNote || ctx.authors_note || '';
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
                .replace(/\{\{description\}\}/gi, char?.description || '')
                .replace(/\{\{personality\}\}/gi, char?.personality || '')
                .replace(/\{\{scenario\}\}/gi, char?.scenario || '');
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
        if (!ctx.chat || depth === 0) return [];
        return ctx.chat.slice(-depth).map(m => ({
            role: m.is_user ? 'user' : 'assistant',
            name: m.is_user ? (ctx.name1 || 'User') : (m.name || getCharInfo()?.name || 'Character'),
            content: typeof m.mes === 'string' ? m.mes : '',
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

        if (settings.includeCharacterCard && charInfo) {
            let block = `Name: ${charInfo.name}`;
            if (charInfo.description) block += `\nDescription:\n${charInfo.description}`;
            if (charInfo.personality) block += `\nPersonality:\n${charInfo.personality}`;
            if (charInfo.scenario) block += `\nScenario:\n${charInfo.scenario}`;
            if (charInfo.system_prompt) block += `\nCharacter System Note:\n${charInfo.system_prompt}`;
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

        const lbBlock = await buildLorebookContextBlock(settings);
        if (lbBlock) parts.push(lbBlock);

        const aiInstructions = buildLBAIInstructions(settings);
        if (aiInstructions) parts.push(aiInstructions);

        return parts.join('\n');
    }

    async function assembleMessages(session, settings, pendingUserText) {
        const messages = [{ role: 'system', content: await buildSystemContent(settings) }];
        const depth = Math.max(0, parseInt(settings.contextDepth) || 0);
        if (depth > 0) {
            const slice = getMainChatSlice(depth);
            if (slice.length) {
                const block = slice.map(m => `[${m.name}]: ${m.content}`).join('\n\n');
                messages.push({
                    role: 'user',
                    content: `<roleplay_context last_messages="${slice.length}">\n\n${block}\n\n</roleplay_context>`,
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
    };

    // ─── UI Construction ────────────────────────────────────────────────────────

    function buildWindowHTML() {
        return `
<div id="${WIN_ID}" class="scp-window" style="display:none">
    <div class="scp-rh scp-rh-n"></div><div class="scp-rh scp-rh-e"></div>
    <div class="scp-rh scp-rh-s"></div><div class="scp-rh scp-rh-w"></div>
    <div class="scp-rh scp-rh-ne"></div><div class="scp-rh scp-rh-se"></div>
    <div class="scp-rh scp-rh-sw"></div><div class="scp-rh scp-rh-nw"></div>

    <div class="scp-header" id="scp-drag-handle">
        <div class="scp-header-left">
            <span class="scp-logo">${I.bot}</span>
            <span class="scp-title">ST-Copilot</span>
            <span class="scp-char-badge" id="scp-char-badge"></span>
        </div>
        <div class="scp-header-right">
            <div class="scp-opacity-wrap">
                <button class="scp-hbtn" id="scp-opacity-btn" title="Window opacity">${I.opacity}</button>
                <div class="scp-opacity-pop" id="scp-opacity-pop">
                    <input type="range" id="scp-opacity-slider" min="20" max="100" value="95" class="scp-slider">
                    <span id="scp-opacity-val">95%</span>
                </div>
            </div>
            <button class="scp-hbtn" id="scp-ext-settings-btn" title="Extension Settings">${I.gear}</button>
            <button class="scp-hbtn" id="scp-min-btn" title="Minimize to icon">${I.minus}</button>
            <button class="scp-hbtn scp-hbtn-close" id="scp-close-btn" title="Hide">${I.x}</button>
        </div>
    </div>

    <div class="scp-toolbar">
        <div class="scp-sess-wrap">
            <div class="scp-sess-dropdown" id="scp-sess-dropdown">
                <button class="scp-sess-trigger" id="scp-sess-trigger">
                    <span class="scp-sess-trigger-name" id="scp-sess-name">Session</span>
                    ${I.chevron}
                </button>
                <div class="scp-sess-panel" id="scp-sess-panel">
                    <div class="scp-sess-list" id="scp-sess-list"></div>
                    <div class="scp-sess-footer">
                        <button class="scp-sess-new-btn" id="scp-new-sess-btn">
                            ${I.plus}<span>New Session</span>
                        </button>
                    </div>
                </div>
            </div>
            <button class="scp-tbtn" id="scp-rename-sess-btn" title="Rename session">${I.edit}</button>
            <button class="scp-tbtn scp-tbtn-danger" id="scp-del-sess-btn" title="Delete session">${I.trash}</button>
        </div>
        <div class="scp-toolbar-sep"></div>
        <label class="scp-depth-label" title="Main chat messages injected into each request">Ctx</label>
        <input type="range" id="scp-depth-slider" class="scp-slider scp-depth-slider" min="0" max="100" step="1" value="15">
        <span class="scp-depth-val scp-depth-clickable" id="scp-depth-val" title="Click to enter exact value">15</span>
        <div class="scp-toolbar-sep"></div>
        <button class="scp-tbtn" id="scp-lb-btn" title="Lorebook Manager">${I.book}</button>
    </div>

    <div class="scp-messages" id="scp-messages"></div>

    <div class="scp-thinking-bar" id="scp-thinking-bar" style="display:none">
        <div class="scp-dots"><span></span><span></span><span></span></div>
        <span id="scp-thinking-text">Thinking…</span>
        <button class="scp-stop-btn" id="scp-stop-btn" title="Abort">${I.stop}</button>
    </div>

    <div class="scp-actions-bar">
        <button class="scp-action-btn" id="scp-inspect-btn" title="View raw context payload">${I.search}<span>Context</span></button>
        <button class="scp-action-btn" id="scp-regen-btn" title="Regenerate last response">${I.refresh}<span>Regen</span></button>
        <div class="scp-flex-grow"></div>
        <span class="scp-token-count" id="scp-token-count" title="Estimated payload tokens"></span>
        <span class="scp-msg-count" id="scp-msg-count"></span>
    </div>

    <div class="scp-input-row">
        <textarea id="scp-input" class="scp-input" placeholder="Ask about the roleplay…" rows="1"></textarea>
        <button class="scp-send-btn" id="scp-send-btn" title="Send (Enter)">${I.send}</button>
    </div>
</div>

<div id="${ICON_ID}" class="scp-dock-icon" style="display:none" title="ST-Copilot — click to restore">
    ${I.bot}<span class="scp-dock-pulse"></span>
</div>

<div id="${MODAL_ID}" class="scp-modal-overlay" style="display:none">
    <div class="scp-modal">
        <div class="scp-modal-header">
            <span>${I.search} Raw Context Payload</span>
            <button class="scp-hbtn scp-hbtn-close" id="scp-modal-close">${I.x}</button>
        </div>
        <div class="scp-modal-tabs">
            <button class="scp-modal-tab active" data-tab="formatted">Formatted</button>
            <button class="scp-modal-tab" data-tab="json">JSON</button>
        </div>
        <div class="scp-modal-body">
            <pre id="scp-ctx-formatted" class="scp-ctx-pre"></pre>
            <pre id="scp-ctx-json" class="scp-ctx-pre" style="display:none"></pre>
        </div>
        <div class="scp-modal-footer">
            <button class="scp-action-btn" id="scp-ctx-copy-btn">${I.copy}<span>Copy</span></button>
        </div>
    </div>
</div>`;
    }

    // ─── DOM References ─────────────────────────────────────────────────────────

    let windowEl, iconEl, modalEl;

    function injectUI() {
        const root = document.createElement('div');
        root.innerHTML = buildWindowHTML() + buildLorebookManagerHTML();
        document.body.appendChild(root);
        windowEl = document.getElementById(WIN_ID);
        iconEl = document.getElementById(ICON_ID);
        modalEl = document.getElementById(MODAL_ID);
    }

    function $(id) { return document.getElementById(id); }

    // ─── Message Rendering ──────────────────────────────────────────────────────

    function renderMarkdown(text) {
        let out = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        const codeBlocks = [];
        out = out.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
            const i = codeBlocks.length;
            codeBlocks.push(`<pre class="scp-code-block${lang ? ` lang-${lang}` : ''}"><code>${code.trim()}</code></pre>`);
            return `\x00B${i}\x00`;
        });

        out = out.replace(/`([^`\n]+)`/g, '<code class="scp-inline-code">$1</code>');

        const lines = out.split('\n');
        const output =[];
        let listItems = [];
        let tableRows = [];
        let bqLines =[];

        const flushList = () => {
            if (!listItems.length) return;
            output.push(`<ul class="scp-list">${listItems.map(li => `<li>${li}</li>`).join('')}</ul>`);
            listItems =[];
        };
        const flushTable = () => {
            if (!tableRows.length) return;
            output.push(`<div class="scp-table-wrap"><table class="scp-table"><tbody>${tableRows.join('')}</tbody></table></div>`);
            tableRows =[];
        };
        const flushBq = () => {
            if (!bqLines.length) return;
            output.push(`<blockquote class="scp-blockquote">${bqLines.join('<br>')}</blockquote>`);
            bqLines =[];
        };

        for (const line of lines) {
            const trLine = line.trim();

            if (/^(---+|\*\*\*+|___+)$/.test(trLine)) {
                flushList(); flushTable(); flushBq();
                output.push(`<hr class="scp-hr">`);
                continue;
            }

            const hm = line.match(/^(#{1,6})\s+(.+)/);
            if (hm) { flushList(); flushTable(); flushBq(); output.push(`<span class="scp-h${hm[1].length}">${hm[2]}</span>`); continue; }

            const bq = line.match(/^&gt;\s*(.*)/);
            if (bq) { flushList(); flushTable(); bqLines.push(bq[1]); continue; }

            const lm = line.match(/^[*\-+]\s+(.+)/);
            if (lm && !/^(---+|\*\*\*+|___+)$/.test(trLine)) { flushTable(); flushBq(); listItems.push(lm[1]); continue; }

            const tm = line.match(/^\|(.*)\|$/);
            if (tm) {
                flushList(); flushBq();
                if (/^[|\s\-:]+$/.test(trLine)) continue;
                const cells = tm[1].split('|').map(c => c.trim());
                const tag = tableRows.length === 0 ? 'th' : 'td';
                tableRows.push(`<tr>${cells.map(c => `<${tag}>${c}</${tag}>`).join('')}</tr>`);
                continue;
            }

            flushList(); flushTable(); flushBq();
            output.push(line);
        }
        flushList(); flushTable(); flushBq();

        out = output.join('\n');
        out = out.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
        out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        out = out.replace(/~~(.+?)~~/g, '<del>$1</del>');
        out = out.replace(/\*(\S(?:[^*\n]*?\S)?)\*/g, '<em>$1</em>');

        out = out.replace(/(<(?:ul|pre)\b[^>]*>[\s\S]*?<\/(?:ul|pre)>)|\n/g,
            (m, block) => block || '<br>');
        
        out = out.replace(/(?:<br>\s*)*(<hr class="scp-hr">)(?:\s*<br>)*/g, '$1');
        out = out.replace(/(?:<br>\s*)*(<div class="scp-table-wrap">|<\/div>|<blockquote class="scp-blockquote">|<\/blockquote>)(?:\s*<br>)*/g, '$1');

        out = out.replace(/\x00B(\d+)\x00/g, (_, i) => codeBlocks[+i]);

        return out;
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
                }
                renderProposalCard(changes, el);
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
                const settings = getSettings();
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

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'scp-edit-btn scp-edit-cancel';
        cancelBtn.innerHTML = `${I.x}<span>Cancel</span>`;

        row.appendChild(saveBtn); row.appendChild(cancelBtn);
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
            ta.replaceWith(nc); 
            row.remove(); 
            wrapEl.classList.remove('is-editing');
        };

        cancelBtn.addEventListener('click', () => {
            restoreMessageDOM(original);
        });

        saveBtn.addEventListener('click', async () => {
            const rawText = ta.value.trim();
            if (!rawText) return;
            const newText = expandMacros(rawText);
            updateMessage(session, msg.id, newText);
            msg.content = newText;
            
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

    // ─── Generation Flow ────────────────────────────────────────────────────────

    let _generating = false;

    async function runGenerate(session, userText, addUserMsg = true) {
        if (_generating) return;
        _generating = true;
        const settings = getSettings();
        setGeneratingState(true);
        let userMsg = null;
        try {
            if (addUserMsg && userText) { 
                userMsg = addMessage(session, 'user', userText); 
                appendMsgEl(userMsg); 
            }
            const result = await callGenerate(session, settings, userText);
            if (result === null) return;
            appendMsgEl(addMessage(session, 'assistant', result));
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
        runGenerate(sess, userMsg.content, false);
    }

    // ─── Context Inspector ──────────────────────────────────────────────────────

    async function openInspector() {
        const sess = getCurrentSession(); const settings = getSettings();
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
        let active = false, ox = 0, oy = 0, sl = 0, st = 0;
        const onStart = e => {
            if (e.target.closest('.scp-hbtn,.scp-tbtn,select,input,button,.scp-opacity-wrap,.scp-rh,.scp-sess-dropdown,.scp-sess-wrap')) return;
            active = true;
            const r = target.getBoundingClientRect();
            const c = getEvCoords(e);
            ox = c.x; oy = c.y; sl = r.left; st = r.top;
            document.addEventListener('mousemove', onMove, { passive: false });
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('mouseup', onUp);
            document.addEventListener('touchend', onUp);
            if (e.type === 'mousedown') e.preventDefault();
        };
        const onMove = e => { 
            if (!active) return; 
            if (e.cancelable) e.preventDefault();
            const c = getEvCoords(e);
            target.style.left = `${Math.max(0, sl + (c.x - ox))}px`; 
            target.style.top = `${Math.max(0, st + (c.y - oy))}px`; 
            target.style.right = 'auto'; target.style.bottom = 'auto'; 
        };
        const onUp = () => { 
            active = false; 
            document.removeEventListener('mousemove', onMove); 
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('mouseup', onUp); 
            document.removeEventListener('touchend', onUp);
            saveWindowState(); 
        };
        handle.addEventListener('mousedown', onStart);
        handle.addEventListener('touchstart', onStart, { passive: false });
    }

    function makeResizable(target) {
        target.querySelectorAll('.scp-rh').forEach(h => {
            const onStart = e => {
                if (e.cancelable) e.preventDefault(); 
                e.stopPropagation();
                const dir = [...h.classList].find(c => /^scp-rh-\w/.test(c))?.replace('scp-rh-', '') || '';
                const cStart = getEvCoords(e);
                const sx = cStart.x, sy = cStart.y, r = target.getBoundingClientRect();
                const sw = r.width, sh = r.height, sl = r.left, st = r.top, MIN_W = 320, MIN_H = 300;
                
                const onMove = me => {
                    if (me.cancelable) me.preventDefault();
                    const cMove = getEvCoords(me);
                    const dx = cMove.x - sx, dy = cMove.y - sy;
                    if (dir.includes('e')) target.style.width = `${Math.max(MIN_W, sw + dx)}px`;
                    if (dir.includes('s')) target.style.height = `${Math.max(MIN_H, sh + dy)}px`;
                    if (dir.includes('w')) { const nw = Math.max(MIN_W, sw - dx); target.style.width = `${nw}px`; target.style.left = `${sl + (sw - nw)}px`; target.style.right = 'auto'; }
                    if (dir.includes('n')) { const nh = Math.max(MIN_H, sh - dy); target.style.height = `${nh}px`; target.style.top = `${st + (sh - nh)}px`; }
                };
                const onUp = () => { 
                    document.removeEventListener('mousemove', onMove); 
                    document.removeEventListener('touchmove', onMove);
                    document.removeEventListener('mouseup', onUp); 
                    document.removeEventListener('touchend', onUp);
                    saveWindowState(); 
                };
                document.addEventListener('mousemove', onMove, { passive: false });
                document.addEventListener('touchmove', onMove, { passive: false });
                document.addEventListener('mouseup', onUp);
                document.addEventListener('touchend', onUp);
            };
            h.addEventListener('mousedown', onStart);
            h.addEventListener('touchstart', onStart, { passive: false });
        });
    }

    function makeIconDraggable(iconTarget) {
        let active = false, moved = false, ox = 0, oy = 0, sl = 0, st = 0;
        const onStart = e => {
            if (e.type === 'mousedown' && e.button !== 0) return;
            active = true; moved = false;
            const r = iconTarget.getBoundingClientRect();
            const c = getEvCoords(e);
            ox = c.x; oy = c.y; sl = r.left; st = r.top;
            
            document.addEventListener('mousemove', onMove, { passive: false }); 
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('mouseup', onUp);
            document.addEventListener('touchend', onUp);
            if (e.type === 'mousedown') e.preventDefault();
        };
        const onMove = e => {
            if (!active) return;
            const c = getEvCoords(e);
            const dx = c.x - ox; const dy = c.y - oy;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
            if (moved) {
                if (e.cancelable) e.preventDefault();
                iconTarget.style.left = `${Math.max(0, Math.min(sl + dx, window.innerWidth - 46))}px`;
                iconTarget.style.top = `${Math.max(0, Math.min(st + dy, window.innerHeight - 46))}px`;
                iconTarget.style.right = 'auto'; iconTarget.style.bottom = 'auto';
            }
        };
        const onUp = () => {
            active = false;
            document.removeEventListener('mousemove', onMove); 
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.removeEventListener('touchend', onUp);
            if (moved) {
                const s = getSettings();
                const r = iconTarget.getBoundingClientRect();
                s.iconX = r.left; s.iconY = r.top;
                saveSettings();
            } else {
                toggleVisibility(); 
            }
        };
        iconTarget.addEventListener('mousedown', onStart);
        iconTarget.addEventListener('touchstart', onStart, { passive: false });
    }

    // ─── Theme ──────────────────────────────────────────────────────────────────

    function applyCustomTheme(theme) {
        if (!theme) return;
        const targets = [windowEl, document.getElementById('scp-lb-overlay'), document.getElementById('scp-diff-modal')].filter(Boolean);
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

    function restoreWindowState() {
        const s = getSettings(); if (!windowEl) return;
        
        const w = s.windowW || 440;
        const h = s.windowH || 600;
        
        if (s.windowX !== null) {
            const maxLeft = Math.max(0, window.innerWidth - w);
            windowEl.style.left = `${Math.max(0, Math.min(s.windowX, maxLeft))}px`;

            const maxTop = Math.max(0, window.innerHeight - 100);
            windowEl.style.top = `${Math.max(0, Math.min(s.windowY, maxTop))}px`;
            
            windowEl.style.right = 'auto';
        }
        
        if (iconEl && s.iconX !== null && s.iconY !== null) {
            const maxIconLeft = Math.max(0, window.innerWidth - 46);
            const maxIconTop = Math.max(0, window.innerHeight - 46);
            iconEl.style.left = `${Math.max(0, Math.min(s.iconX, maxIconLeft))}px`;
            iconEl.style.top = `${Math.max(0, Math.min(s.iconY, maxIconTop))}px`;
            iconEl.style.right = 'auto';
            iconEl.style.bottom = 'auto';
        }
        
        windowEl.style.width = `${w}px`;
        windowEl.style.height = `${h}px`;
        windowEl.style.opacity = ((s.opacity || 95) / 100).toString();
        applyCustomTheme(s.customTheme || THEME_PRESETS.default);
    }

    // ─── Visibility ─────────────────────────────────────────────────────────────

    function minimize() { const s = getSettings(); s.minimized = true; windowEl.style.display = 'none'; iconEl.style.display = 'flex'; saveSettings(); }
    function restoreFromMinimize() { const s = getSettings(); s.minimized = false; windowEl.style.display = 'flex'; iconEl.style.display = s.floatingIconPersistent ? 'flex' : 'none'; saveSettings(); scrollToBottom(); }
    function hideWindow() { const s = getSettings(); s.windowVisible = false; s.minimized = false; windowEl.style.display = 'none'; iconEl.style.display = s.floatingIconPersistent ? 'flex' : 'none'; saveSettings(); }
    function showWindow() {
        const s = getSettings(); 
        if (!s.enabled) { toastr.warning('ST-Copilot is disabled.', EXT_DISPLAY); return; }
        s.windowVisible = true; s.minimized = false;
        windowEl.style.display = 'flex';
        iconEl.style.display = s.floatingIconPersistent ? 'flex' : 'none';
        saveSettings(); scrollToBottom();
    }
    function toggleVisibility() {
        const s = getSettings();
        if (!s.windowVisible || s.minimized) { showWindow(); return; }
        if (s.floatingIconPersistent) { hideWindow(); } else { minimize(); }
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
            item.innerHTML = `
                <span class="scp-sess-item-dot"></span>
                <span class="scp-sess-item-name">${escHtml(sess.name)}</span>
                <span class="scp-sess-item-count">${sess.messages.length}</span>`;
            item.addEventListener('click', () => {
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
                const span = document.createElement('span');
                span.className = 'scp-depth-val scp-depth-clickable'; span.id = 'scp-depth-val';
                span.title = 'Click to enter exact value'; span.textContent = val;
                input.replaceWith(span);
                setupDepthClickEdit();
                const slider = $('scp-depth-slider');
                if (slider) { slider.value = Math.min(100, val); }
                updateMsgCount(getCurrentSession());
            };
            input.addEventListener('blur', commit);
            input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') commit(); });
        });
    }

    // ─── Profile System ─────────────────────────────────────────────────────────

    function saveProfile(name) {
        const s = getSettings();
        s.profiles[name] = {
            systemPrompt: s.systemPrompt, includeSystemPrompt: s.includeSystemPrompt,
            includeAuthorsNote: s.includeAuthorsNote, includeCharacterCard: s.includeCharacterCard,
            includeUserPersonality: s.includeUserPersonality, contextDepth: s.contextDepth,
            localHistoryLimit: s.localHistoryLimit, customTheme: { ...s.customTheme },
            connectionSource: s.connectionSource, connectionProfileId: s.connectionProfileId,
            maxTokens: s.maxTokens,
        };
        s.activeProfile = name; saveSettings();
    }

    function loadProfile(name) {
        const s = getSettings(); const p = s.profiles[name]; if (!p) return;
        Object.assign(s, p); s.activeProfile = name;
        if (p.customTheme) applyCustomTheme(p.customTheme);
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
                localHistoryLimit: 50, customTheme: { ...THEME_PRESETS.default },
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

    function buildThemeEditor() {
        const container = $('scp-theme-section'); if (!container) return;
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
        `;
        container.appendChild(profileRow);

        const sel = profileRow.querySelector('#scp-theme-profile-select');
        for (const name of Object.keys(s.savedThemes)) {
            const opt = document.createElement('option');
            opt.value = name; opt.textContent = name;
            opt.selected = name === s.activeThemeProfile;
            sel.appendChild(opt);
        }

        sel.addEventListener('change', () => {
            const name = sel.value;
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

        // Preset pills
        const presetRow = document.createElement('div');
        presetRow.className = 'scp-theme-preset-row';
        presetRow.innerHTML = '<div class="scp-theme-preset-label">Base preset</div><div class="scp-theme-preset-btns" id="scp-theme-preset-btns"></div>';
        container.appendChild(presetRow);
        const btnsEl = presetRow.querySelector('#scp-theme-preset-btns');
        for (const [name, preset] of Object.entries(THEME_PRESETS)) {
            const btn = document.createElement('button');
            btn.className = 'scp-preset-pill'; btn.textContent = preset.label; btn.dataset.preset = name;
            btn.addEventListener('click', () => {
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
            const input = document.createElement('input'); input.type = 'text'; input.className = 'scp-theme-var-input';
            input.value = curVal; input.placeholder = def.hint; input.dataset.key = def.key;
            input.addEventListener('input', () => {
                const s2 = getSettings(); 
                if (!s2.customTheme) s2.customTheme = {};
                
                s2.customTheme[def.key] = input.value;
                
                saveSettings();
                applyCustomTheme(s2.customTheme);
                
                preview.style.background = input.value; 
                preview.style.display = input.value ? '' : 'none';
            });
            wrap.appendChild(preview); wrap.appendChild(input);
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
        const s = getSettings(); const currentVal = s.connectionProfileId || '';
        profSel.innerHTML = '<option value="">-- Select Profile --</option>';
        
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
        setI('scp-hotkey', 'hotkey');
        setI('scp-max-tokens', 'maxTokens');
        setI('scp-history-limit', 'localHistoryLimit');
        setI('scp-depth-slider', 'contextDepth');
        setI('scp-reasoning-trim', 'reasoningTrimStrings');
        
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
            el.addEventListener('change', () => { getSettings()[key] = el.checked; saveSettings(); if (cb) cb(); });
        };
        const bindInput = (id, key, toVal, cb) => {
            const el = $(id); if (!el) return;
            el.value = s[key] ?? '';
            el.addEventListener('input', () => { getSettings()[key] = toVal ? toVal(el.value) : el.value; saveSettings(); if (cb) cb(); });
        };
        const bindSelect = (id, key, cb) => {
            const el = $(id); if (!el) return;
            el.value = s[key] ?? '';
            el.addEventListener('change', () => { getSettings()[key] = el.value; saveSettings(); if (cb) cb(el.value); });
        };

        bindCheck('scp-enabled', 'enabled', () => {
            const ss = getSettings();
            const btn = $('scp-wand-btn');
            if (btn) btn.style.display = ss.enabled ? '' : 'none';
            if (!ss.enabled) hideWindow();
            setupHotkey();
        });
        bindCheck('scp-hotkey-enabled', 'hotkeyEnabled');
        bindCheck('scp-include-sysprompt', 'includeSystemPrompt', updCtx);
        bindCheck('scp-include-anote', 'includeAuthorsNote', updCtx);
        bindCheck('scp-include-charcard', 'includeCharacterCard', updCtx);
        bindCheck('scp-include-persona', 'includeUserPersonality', updCtx);
        bindCheck('scp-icon-persistent', 'floatingIconPersistent', () => {
            const ss = getSettings();
            if (ss.floatingIconPersistent) iconEl.style.display = 'flex';
            else if (!ss.windowVisible && !ss.minimized) iconEl.style.display = 'none';
        });

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
            profSel.addEventListener('change', () => { getSettings().connectionProfileId = profSel.value; saveSettings(); });
        }

        // Config profiles
        refreshProfilesDropdown();

        $('scp-profile-select')?.addEventListener('change', () => {
            const name = $('scp-profile-select').value;
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
                localHistoryLimit: 50, customTheme: { ...THEME_PRESETS.default },
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

    function openExtensionSettings() {
        const drawerButton = document.getElementById('extensions-settings-button');
        const extensionsBlock = document.getElementById('rm_extensions_block');

        const isDrawerOpen = extensionsBlock && !extensionsBlock.classList.contains('hidden') && 
                             getComputedStyle(extensionsBlock).display !== 'none';

        if (!isDrawerOpen && drawerButton) {
            const toggle = drawerButton.querySelector('.drawer-toggle') || drawerButton;
            toggle.click();
        }

        setTimeout(() => {
            const settingsBlock = document.querySelector('.st-copilot-settings .inline-drawer') || document.querySelector('.st-copilot-settings');
            
            if (settingsBlock) {
                settingsBlock.scrollIntoView({ behavior: 'smooth', block: 'center' });

                const content = settingsBlock.querySelector('.inline-drawer-content');
                const isClosed = content && getComputedStyle(content).display === 'none';

                if (isClosed) {
                    const header = settingsBlock.querySelector('.inline-drawer-header') || 
                                   settingsBlock.querySelector('.inline-drawer-toggle');
                    header?.click();
                }

                settingsBlock.style.transition = 'box-shadow 0.5s';
                settingsBlock.style.boxShadow = '0 0 15px var(--scp-accent)';
                setTimeout(() => { settingsBlock.style.boxShadow = ''; }, 1500);
            } else {
                toastr.info('Settings block not found in the drawer. Make sure the extension is loaded.', EXT_DISPLAY);
            }
        }, isDrawerOpen ? 10 : 50);
    }

    // ─── Window Event Listeners ─────────────────────────────────────────────────

    function attachWindowListeners() {
        makeDraggable($('scp-drag-handle'), windowEl);
        makeResizable(windowEl);

        window.addEventListener('resize', () => {
            if (!windowEl || windowEl.style.display === 'none') return;
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
        });

        $('scp-min-btn')?.addEventListener('click', minimize);
        $('scp-close-btn')?.addEventListener('click', hideWindow);
        $('scp-ext-settings-btn')?.addEventListener('click', openExtensionSettings);
        if (iconEl) makeIconDraggable(iconEl);

        // Opacity
        $('scp-opacity-btn')?.addEventListener('click', e => { e.stopPropagation(); $('scp-opacity-pop')?.classList.toggle('visible'); });
        document.addEventListener('click', e => {
            const pop = $('scp-opacity-pop');
            if (pop && !pop.contains(e.target) && e.target !== $('scp-opacity-btn')) pop.classList.remove('visible');
        });
        const opSlider = $('scp-opacity-slider');
        if (opSlider) {
            opSlider.value = getSettings().opacity || 95;
            $('scp-opacity-val').textContent = `${opSlider.value}%`;
            opSlider.addEventListener('input', () => {
                const v = parseInt(opSlider.value);
                $('scp-opacity-val').textContent = `${v}%`;
                windowEl.style.opacity = (v / 100).toString();
                getSettings().opacity = v; saveSettings();
            });
        }

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
        });

        $('scp-new-sess-btn')?.addEventListener('click', async () => {
            closeSessPanel();
            const { charId, chatId } = getBindingKey();
            const bucket = getChatBucket(charId, chatId);
            const defaultName = `Session ${bucket.sessions.length + 1}`;
            const name = await showCustomDialog({ type: 'prompt', title: 'New Session', message: 'Session name:', defaultValue: defaultName, placeholder: defaultName });
            if (name === null) return; // user cancelled — do NOT create
            createSession(charId, chatId, name.trim() || defaultName);
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
                getSettings().contextDepth = parseInt(depthSlider.value); 
                saveSettings();
                updateMsgCount(getCurrentSession());
            });
        }
        setupDepthClickEdit();

        // Actions
        $('scp-inspect-btn')?.addEventListener('click', openInspector);
        $('scp-regen-btn')?.addEventListener('click', handleRegen);
        $('scp-lb-btn')?.addEventListener('click', () => openLorebookManager());
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
        modalEl?.addEventListener('click', e => { if (e.target === modalEl) modalEl.style.display = 'none'; });
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
        updateCharBadge();
        refreshSessionDropdown();
        renderSession(getCurrentSession());
        autoLoadBoundProfile();
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
        getSettings(); injectUI();
        const ctx = SillyTavern.getContext();
        const container = document.getElementById('extensions_settings') || document.getElementById('extensions_settings2');
        if (container) {
            try {
                const html = await ctx.renderExtensionTemplateAsync(__extPath, 'settings');
                if (html) container.insertAdjacentHTML('beforeend', html);
            } catch (e) {}
        }
        restoreWindowState(); attachWindowListeners(); setupSettingsHandlers(); setupLorebookManagerListeners();
        const s = getSettings();
        if (s.windowVisible) {
            if (s.minimized) iconEl.style.display = 'flex';
            else windowEl.style.display = 'flex';
        }
        if (s.floatingIconPersistent) iconEl.style.display = 'flex';
        onChatChanged();
        if (ctx.eventSource && ctx.event_types) {
            ctx.eventSource.on(ctx.event_types.CHAT_CHANGED, onChatChanged);
            ctx.eventSource.on(ctx.event_types.CHARACTER_SELECTED, onChatChanged);
            ctx.eventSource.on(ctx.event_types.APP_READY, updateProfilesList);
        } else {
            try {
                const es = window.eventSource; const et = window.event_types;
                if (es && et) {
                    es.on(et.CHAT_CHANGED, onChatChanged);
                    es.on(et.CHARACTER_SELECTED, onChatChanged);
                    es.on(et.APP_READY, updateProfilesList);
                }
            } catch (_) {}
        }
        setupHotkey(); addWandButton();
        console.log(`[${EXT_DISPLAY}] Initialized.`);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else setTimeout(init, 0);
})();