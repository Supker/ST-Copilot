import { EXT_DISPLAY, EMBEDDED_BOOK_KEY, DEFAULT_LB_MANAGE_PROMPT, LB_FORMAT_BLOCK } from '../constants.js';
import { getSettings, getCurrentSession, saveSettings, expandMacros } from '../session.js';
import { _dbgAdd } from '../utils/util-debug.js';
import { ST_WorldInfo, ST_Utils } from '../index.js';
import { _repairJSON } from '../utils/util-text.js';

export const wiCache = {};
export const wiPromises = {}; 
export let lastActiveEntries = [];

let _wiExternalListenerBound = false;
export function setupExternalWIChangeListener() {
    if (_wiExternalListenerBound) return;
    _wiExternalListenerBound = true;
    const ctx = SillyTavern.getContext();
    const es = ctx.eventSource || window.eventSource;
    const et = ctx.event_types || window.event_types || {};
    if (!es) return;
    es.on(et.WORLDINFO_UPDATED || 'worldinfo_updated', (name) => {
        if (name) delete wiCache[name];
    });
    es.on(et.WORLDINFO_SETTINGS_UPDATED || 'worldinfo_settings_updated', () => {
        for (const key of Object.keys(wiCache)) delete wiCache[key];
    });
}

export async function fetchWorldInfoBook(name) {
    if (name === EMBEDDED_BOOK_KEY) return getEmbeddedCharBook();
    
    if (wiCache[name] && Date.now() - (wiCache[name]._ts || 0) < 30000) return wiCache[name];
    if (wiPromises[name]) return wiPromises[name];

    const ctx = SillyTavern.getContext();
    
    wiPromises[name] = (async () => {
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
            wiCache[name] = data;
            return data;
        } catch (e) {
            _dbgAdd('LB_LOAD_FILE_FAILED', { bookName: name, error: e.message });
            console.error(`[${EXT_DISPLAY}] WI load failed for "${name}":`, e);
            return null;
        } finally {
            delete wiPromises[name];
        }
    })();

    return wiPromises[name];
}

export function getEmbeddedCharBook() {
    const ctx = SillyTavern.getContext();
    const char = ctx.characters?.[ctx.characterId];
    const book = char?.data?.character_book;
    if (!book?.entries?.length) return null;
    
    const data = { entries: {}, _embedded: true, _ts: Date.now() };

    (book.entries || []).forEach((e, idx) => {
        const uid = e.id ?? idx;
        const keys = Array.isArray(e.keys) ? e.keys : (e.key || []);
        const outlet = e.automation_id || e.automationId || e.extensions?.outlet_name || e.outletName || e.outlet_name || e.outlet || '';
        const isOutlet = Boolean(outlet); 
        const isForceConstant = e.selective === false; 

        data.entries[uid] = {
            uid,
            key: keys,
            keysecondary: [],
            content: e.content || '',
            comment: e.name || '',
            disable: false,
            selective: true,
            constant: !isOutlet && (e.constant === true || isForceConstant),
            position: isOutlet ? 7 : (e.position ?? 0),
            displayIndex: uid,
            automation_id: outlet,
            outletName: outlet,
            outlet: e.outlet || e.outlet_name || e.outletName || '',
            group: e.group || (isOutlet ? outlet : ''),
            role: null,
            extensions: { outlet_name: outlet },
            order: e.order ?? 100,
            probability: e.probability ?? 100,
            groupWeight: e.groupWeight ?? 100,
            depth: 4,
            useProbability: true,
            addMemo: true,
            groupOverride: false,
            sticky: 0,
            cooldown: 0,
            delay: 0,
            excludeRecursion: false,
            preventRecursion: false,
            delayUntilRecursion: false,
            ignoreBudget: false,
            vectorized: false,
            scanDepth: null,
            caseSensitive: null,
            matchWholeWords: null,
            useGroupScoring: null,
            matchPersonaDescription: false,
            matchCharacterDescription: false,
            matchCharacterPersonality: false,
            matchCharacterDepthPrompt: false,
            matchScenario: false,
            matchCreatorNotes: false
        };
    });

    return data;
}

export async function saveWorldInfoBook(name, data) {
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
        _dbgAdd('LB_SAVE_FILE_FAILED', { bookName: name, error: e.message });
        console.error(`[${EXT_DISPLAY}] saveWorldInfoBook failed for "${name}":`, e);
        throw e;
    }
    delete wiCache[name];
    
    try {
        if (typeof ctx.reloadWorldInfoEditor === 'function') {
            ctx.reloadWorldInfoEditor(name, true);
        }
    } catch (_) {}
}

export function getDisplayName(name) {
    if (name === EMBEDDED_BOOK_KEY) {
        const ctx = SillyTavern.getContext();
        const char = ctx.characters?.[ctx.characterId];
        return `[${char?.name || 'Character'} Book]`;
    }
    return name;
}

export function getActiveLorebookNames() {
    const ctx = SillyTavern.getContext();
    const names = new Set();

    const globalBooks = ST_WorldInfo?.selected_world_info || window.selected_world_info ||[];
    if (Array.isArray(globalBooks)) {
        globalBooks.forEach(n => n && names.add(n));
    }

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

    const wiKey = ST_WorldInfo?.METADATA_KEY || window.WI_METADATA_KEY || 'world_info';
    const chatWorldName = ctx.chatMetadata?.[wiKey];
    if (chatWorldName && typeof chatWorldName === 'string') names.add(chatWorldName);

    const personaWorldName = ctx.powerUserSettings?.persona_description_lorebook;
    if (personaWorldName && typeof personaWorldName === 'string') names.add(personaWorldName);

    return [...names].filter(Boolean);
}

export function getBookSourceType(name) {
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

export function wiEntriesToArray(data) {
    if (!data?.entries) return [];
    return Object.values(data.entries).sort((a, b) => (a.displayIndex ?? a.uid) - (b.displayIndex ?? b.uid));
}

export function keywordMatchEntry(keys, text) {
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

export function getKeywordTriggeredEntries(allBooksData, text1, text2) {
    const scanText = [text1, text2].filter(Boolean).join('\n');
    const results = {};
    for (const [bookName, data] of Object.entries(allBooksData)) {
        const entries = wiEntriesToArray(data);
        const matched = entries.filter(e => !e.disable && (keywordMatchEntry(e.key, scanText) || keywordMatchEntry(e.keysecondary, scanText)));
        if (matched.length) results[bookName] = matched;
    }
    return results;
}

export function getEntryOverrideKey(bookName, entry) {
    let entryName = String(entry.comment || entry.name || '').trim();
    if (!entryName && entry.key && entry.key.length) {
        entryName = entry.key.join('_').slice(0, 40);
    }
    entryName = String(entryName).replace(/[\r\n]+/g, ' ').trim();
    return entryName ? `${bookName}_${entryName}` : `${bookName}_${entry.uid}`;
}

export async function buildLorebookContextBlock(settings) {
    lastActiveEntries = [];
    const selectedBooks = settings.lorebookSelectedBooks || [];
    const excludedBooks = new Set(settings.lorebookExcludedBooks || []);
    const overrides = settings.lorebookEntryOverrides || {};
    const loadedBooks = {};
    const _activeNamesSet = new Set(getActiveLorebookNames());

    if (!_activeNamesSet.size) return '';

    await Promise.all([..._activeNamesSet].map(async name => {
        if (excludedBooks.has(name)) return;
        const data = await fetchWorldInfoBook(name);
        if (data) loadedBooks[name] = data;
    }));

    if (!Object.keys(loadedBooks).length) return '';

    let keywordEntries = {};
    if (settings.lorebookAutoKeyword) {
        const ctx = SillyTavern.getContext();
        const msgs = ctx.chat || [];
        let lastUser = '', lastChar = '';

        try {
            const session = getCurrentSession();
            const picked = session.pickedChatIndices;
            if (picked && picked.length > 0) {
                const pickedMsgs = picked.filter(i => i >= 0 && i < msgs.length).map(i => msgs[i]);
                lastUser = pickedMsgs.filter(m => m.is_user).map(m => m.mes).join('\n');
                lastChar = pickedMsgs.filter(m => !m.is_user).map(m => m.mes).join('\n');
            } else {
                const stDepth = Math.max(1, settings.lorebookSTScanDepth ?? 5);
                const recentMsgs = msgs.slice(-stDepth);
                lastUser = recentMsgs.filter(m => m.is_user).map(m => m.mes).join('\n');
                lastChar = recentMsgs.filter(m => !m.is_user).map(m => m.mes).join('\n');
            }
        } catch (_) {
            const stDepth = Math.max(1, settings.lorebookSTScanDepth ?? 5);
            const recentMsgs = msgs.slice(-stDepth);
            lastUser = recentMsgs.filter(m => m.is_user).map(m => m.mes).join('\n');
            lastChar = recentMsgs.filter(m => !m.is_user).map(m => m.mes).join('\n');
        }

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

        keywordEntries = getKeywordTriggeredEntries(loadedBooks, lastUser + '\n' + lastChar, copilotScanText);
    }

    const toInject = {};
    const outletLines = [];
    let overridesChanged = false;

    for (const [bookName, data] of Object.entries(loadedBooks)) {
        for (const entry of wiEntriesToArray(data)) {
            if (!entry.content) continue;

            const oldKey = `${bookName}_${entry.uid}`;
            const newKey = getEntryOverrideKey(bookName, entry);

            if (oldKey !== newKey && overrides[oldKey] !== undefined) {
                overrides[newKey] = overrides[oldKey];
                delete overrides[oldKey];
                overridesChanged = true;
            }

            const override = overrides[newKey];
            if (override === false) continue;

            const isConstant = !!entry.constant && !entry.disable;
            const manualInclude = selectedBooks.includes(bookName);
            const keywordInclude = keywordEntries[bookName]?.some(e => e.uid === entry.uid);

            if (override === true || isConstant || manualInclude || keywordInclude) {
                const outletField = (entry.outlet || entry.outlet_name || entry.outletName || entry.automation_id || entry.automationId || '').trim();
                const isOutletPos = String(entry.position).toLowerCase() === 'outlet' || String(entry.position) === '7';
                const finalOutletName = outletField || (isOutletPos ? (entry.group || '').trim() : '');
                const isOutlet = isOutletPos || finalOutletName !== '';

                if (isOutlet) {
                    if (!entry.disable) {
                        outletLines.push(`### ${entry.comment || `Entry #${entry.uid}`} (uid: ${entry.uid}, book: "${getDisplayName(bookName)}") [outlet name: ${finalOutletName}]\n${entry.content}`);
                        lastActiveEntries.push({
                            bookName,
                            displayName: getDisplayName(bookName),
                            entryName: entry.comment || `#${entry.uid}`,
                            uid: entry.uid,
                        });
                    }
                    continue;
                }

                if (!toInject[bookName]) toInject[bookName] = [];
                toInject[bookName].push(entry);
            }
        }
    }

    if (overridesChanged) saveSettings();

    if (!Object.keys(toInject).length && !outletLines.length) return '';

    let block = '\n\n<lorebook_context>\n';
    for (const [bookName, entries] of Object.entries(toInject)) {
        let hasValidEntries = false;
        let bookBlock = `## ${getDisplayName(bookName)}\n`;

        for (const e of entries) {
            hasValidEntries = true;
            bookBlock += `### ${e.comment || `Entry #${e.uid}`} (uid: ${e.uid})`;
            if (e.key?.length) bookBlock += ` [keys: ${e.key.slice(0, 5).join(', ')}]`;
            bookBlock += `\n${e.content}\n\n`;

            lastActiveEntries.push({
                bookName,
                displayName: getDisplayName(bookName),
                entryName: e.comment || `#${e.uid}`,
                uid: e.uid,
            });
        }
        if (hasValidEntries) block += bookBlock;
    }

    if (outletLines.length) {
        block += `## Outlet Entries (injected only where an outlet::<name> macro is manually placed elsewhere, not directly)\n${outletLines.join('\n\n')}\n\n`;
    }

    if (block === '\n\n<lorebook_context>\n') return '';

    block += '</lorebook_context>';
    return block;
}

export function buildLBAIInstructions(settings) {
    if (!settings.lorebookAIManageEnabled) return '';
    const excludedBooks = new Set(settings.lorebookExcludedBooks || []);
    const activeBooks =[...new Set(lastActiveEntries.map(e => e.displayName || e.bookName))].filter(b => !excludedBooks.has(b));
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
        
    return `<lorebook_management>\n${prompt}\n</lorebook_management>`;
}

export function _parseLBDiffPatch(str) {
    const m = str.match(/<<<<<<< (?:SEARCH|ANCHOR)\r?\n([\s\S]*?)\r?\n=+\r?\n([\s\S]*?)\r?\n>>>>>>> REPLACE/);
    return m ? { search: m[1], replace: m[2] } : null;
}

export function _sanitizeLBChanges(changes) {
    if (!Array.isArray(changes)) return null;
    const valid = [];
    for (const c of changes) {
        if (!c || typeof c !== 'object') continue;
        if (!['add', 'edit', 'patch', 'prepend', 'append', 'delete'].includes(c.action)) continue;
        if (!c.worldName && !c.name && c.uid == null) continue;
        if (c.triggers === 'original' || c.triggers === 'keep' || c.triggers === undefined || c.triggers === null) {
            c.triggers = null;
        } else if (!Array.isArray(c.triggers)) {
            c.triggers = String(c.triggers).split(',').map(s => s.trim()).filter(Boolean);
        }
        if (c.constant !== undefined) c.constant = !!c.constant;
        if (c.action === 'patch' && Array.isArray(c.patches)) {
            c.patches = c.patches.map(p => {
                if (typeof p === 'string') return _parseLBDiffPatch(p);
                if (p && typeof p === 'object') {
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

export function parseLBChangesFromText(text) {
    let raw = null;
    const strict = text.match(/```lorebook-changes\s*([\s\S]*?)```/);
    if (strict) {
        raw = strict[1].trim();
    } else {
        const open = text.match(/```lorebook-changes\s*([\s\S]*?)(?=```|$)/);
        if (open) raw = open[1].trim();
    }
    if (!raw) return null;
    try {
        const data = JSON.parse(raw);
        if (Array.isArray(data.changes)) return _sanitizeLBChanges(data.changes);
    } catch (_) {}
    try {
        const repaired = _repairJSON(raw);
        const data = JSON.parse(repaired);
        if (Array.isArray(data.changes)) return _sanitizeLBChanges(data.changes);
    } catch (_) {}
    try {
        const lines = raw.split('\n');
        const fixed = lines.map(line => {
            return line.replace(/("(?:content|name|comment|search|replace|triggers)":\s*)"((?:[^"\\]|\\.)*)"/, (match, prefix, val) => {
                const escaped = val.replace(/(?<!\\)"/g, '\\"');
                return `${prefix}"${escaped}"`;
            });
        }).join('\n');
        const data = JSON.parse(fixed);
        if (Array.isArray(data.changes)) return _sanitizeLBChanges(data.changes);
    } catch (_) {}

    if (raw) _dbgAdd('LB_PROPOSAL_PARSING_FAILED', { rawText: raw.slice(0, 300) + (raw.length > 300 ? '...' : '') });
    return null;
}

export function stripLBChangesBlock(text) {
    return text
        .replace(/```lorebook-changes[\s\S]*?```/g, '')
        .replace(/```lorebook-changes[\s\S]*/g, '')
        .trim();
}

export async function bindNewLorebookToCharacter(bookName) {
    try {
        const ctx = SillyTavern.getContext();

        const allBooks = window.world_names || ST_WorldInfo?.world_names || [];
        const isNew = !allBooks.includes(bookName);

        if (isNew) {
            console.log('[ST-Copilot-Debug] Lorebook is new. Requesting ST to create...');
            if (typeof ST_WorldInfo?.createNewWorldInfo === 'function') {
                await ST_WorldInfo.createNewWorldInfo(bookName);
            } else if (typeof window.createNewWorldInfo === 'function') {
                await window.createNewWorldInfo(bookName);
            } else {
                const payload = { entries: {}, extensions: {} };
                await fetch('/api/worldinfo/edit', {
                    method: 'POST',
                    headers: { ...ctx.getRequestHeaders(), 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: bookName, data: payload }),
                });
                if (typeof ctx.updateWorldInfoList === 'function') await ctx.updateWorldInfoList();
                else if (typeof window.loadWorldInfoList === 'function') await window.loadWorldInfoList();
            }
            toastr.success(`Lorebook "${bookName}" created successfully.`, EXT_DISPLAY);
        }

        delete wiCache[bookName];

        const charId = ctx.characterId;
        if (charId === undefined || charId === null) return;

        let fileName = ctx.characters?.[charId]?.avatar;
        if (ST_Utils && typeof ST_Utils.getCharaFilename === 'function') {
            fileName = ST_Utils.getCharaFilename(charId);
        } else if (typeof window.getCharaFilename === 'function') {
            fileName = window.getCharaFilename(charId);
        }
        if (!fileName) return;

        let wiSettings = window.world_info || ST_WorldInfo?.world_info;
        if (!wiSettings) return;

        if (!Array.isArray(wiSettings.charLore)) wiSettings.charLore = [];

        const charLoreList = wiSettings.charLore;
        let extraCharLore = charLoreList.find(e => e.name === fileName);
        if (!extraCharLore) {
            extraCharLore = { name: fileName, extraBooks: [] };
            charLoreList.push(extraCharLore);
        }
        if (!Array.isArray(extraCharLore.extraBooks)) extraCharLore.extraBooks = [];

        if (!extraCharLore.extraBooks.includes(bookName)) {
            extraCharLore.extraBooks.push(bookName);
            console.log(`[ST-Copilot-Debug] Added "${bookName}" to extraBooks.`);

            if (typeof ST_WorldInfo?.saveWorldInfoSettings === 'function') ST_WorldInfo.saveWorldInfoSettings();
            else if (typeof window.saveWorldInfoSettings === 'function') window.saveWorldInfoSettings();

            if (typeof window.saveSettingsDebounced === 'function') window.saveSettingsDebounced();
            else if (typeof saveSettingsDebounced === 'function') saveSettingsDebounced();

            if (typeof ST_WorldInfo?.printWorldInfoCharacters === 'function') ST_WorldInfo.printWorldInfoCharacters();
            else if (typeof window.printWorldInfoCharacters === 'function') window.printWorldInfoCharacters();
        }
    } catch (e) {
        _dbgAdd('LB_AUTO_BIND_NEW_BOOK_FAILED', { bookName, error: e.message });
        console.error(`[ST-Copilot-Debug] Exception in bindNewLorebookToCharacter:`, e);
    }
}

export async function resolveLBChangeTarget(change, strictBook = false) {
    let bookName = change.worldName || '';
    let targetUid = change.uid;

    const fuzzyWorld = bookName.toLowerCase();
    const fuzzyName = (change.originalName || change.name || '').toLowerCase();
    
    if (fuzzyName && !strictBook) {
        const activeMatch = lastActiveEntries.find(le => {
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
    if (!data && bookName && !strictBook) {
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
            if (!fuzzyName) return false;
            const cStr = (en.comment || `Entry #${en.uid}`).trim().toLowerCase();
            if (cStr === fuzzyName) return true;
            return cStr.includes(fuzzyName) || fuzzyName.includes(cStr);
        });
    }

    if (!origEntry && /^\d+$/.test(fuzzyName) && data && data.entries[fuzzyName]) {
        origEntry = data.entries[fuzzyName];
    }

    if (!origEntry && fuzzyName && !strictBook) {
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
            change, resolvedBookName: bookName, activeBooks: getActiveLorebookNames(), cacheKeys: Object.keys(wiCache)
        });
    } else if (!origEntry && change.action !== 'add') {
        console.warn(`[${EXT_DISPLAY}] resolveLBChangeTarget: entry not found`, {
            fuzzyName, fuzzyWorld, targetUid,
            entries: Object.values(data.entries || {}).map(e => ({ uid: e.uid, comment: e.comment, key: e.key?.slice(0, 3) }))
        });
    }
    return { bookName, data, origEntry };
}

export async function expandOutletsAsync(text, depth = 0) {
    if (!text || typeof text !== 'string' || !text.includes('{{outlet::') || depth > 3) return text;

    const outletRegex = /\{\{outlet::(.*?)\}\}/gi;
    const matches = [...new Set([...text.matchAll(outletRegex)].map(m => m[1]))];
    
    if (!matches.length) return text;

    const activeNames = getActiveLorebookNames();
    
    if (!activeNames.includes(EMBEDDED_BOOK_KEY)) {
        activeNames.push(EMBEDDED_BOOK_KEY);
    }

    const loadedBooks = [];
    for (const name of activeNames) {
        const data = await fetchWorldInfoBook(name);
        if (data) loadedBooks.push(data);
    }

    let result = text;
    for (const name of matches) {
        const searchName = name.trim();
        const matchedEntries = [];

        for (const book of loadedBooks) {
            const entries = Object.values(book.entries || {});
            for (const e of entries) {
                const outletField = (e.outlet || e.outlet_name || e.outletName || e.automation_id || e.automationId || '').trim();
                const isOutletPos = String(e.position) === '7' || String(e.position).toLowerCase() === 'outlet';
                const finalOutletName = outletField || (isOutletPos ? (e.group || '').trim() : '');
                
                if (!e.disable && finalOutletName === searchName) {
                    matchedEntries.push(e);
                }
            }
        }

        const replacementText = matchedEntries.map(e => expandMacros(e.content || '')).join('\n');
        
        const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\{\\{outlet::${escapedName}\\}\\}`, 'g');
        
        result = result.replace(regex, replacementText);
    }

    if (result.includes('{{outlet::')) {
        result = await expandOutletsAsync(result, depth + 1);
    }

    return result;
}