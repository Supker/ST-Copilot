(function () {
    'use strict';

    const EXT_NAME = 'st_copilot';
    const EXT_DISPLAY = 'ST-Copilot';
    const WIN_ID = 'scp-window';
    const ICON_ID = 'scp-dock-icon';
    const MODAL_ID = 'scp-ctx-modal';
    const ICON_STORAGE_KEY = 'scp-icon-position';
    
    // ─── Debug Logger ────────────────────────────────────────────────────────────
    const _DBG = { log: [], MAX: 3000, sessionStart: new Date().toISOString(), _snapshot: null, _diffTid: null };
    const _DBG_SKIP = new Set(['customTheme','savedThemes','sessions','starredMessages','stats','quickPromptSets','customSounds','completionSoundData','quickPrompts','profiles','promptPresets','altGreetingIndices','windowBgUrl','customBackgrounds','memories']);

    function _dbgStrip(s) {
        const r = {};
        for (const [k, v] of Object.entries(s)) { if (!_DBG_SKIP.has(k)) r[k] = v; }
        return r;
    }

    function _dbgAdd(type, payload) {
        _DBG.log.push({ ts: Date.now(), type, payload });
        if (_DBG.log.length > _DBG.MAX) _DBG.log.splice(0, _DBG.log.length - _DBG.MAX);
    }

    function _dbgSnapshotSettings() {
        try {
            const s = _dbgStrip(getSettings());
            _DBG._snapshot = JSON.parse(JSON.stringify(s));
            _dbgAdd('SETTINGS_SNAPSHOT', s);
        } catch(_) {}
    }

    function _dbgDiffSettings() {
        if (!_DBG._snapshot) return;
        try {
            const cur = _dbgStrip(getSettings());
            const diff = {};
            const keys = new Set([...Object.keys(cur), ...Object.keys(_DBG._snapshot)]);
            for (const k of keys) {
                if (JSON.stringify(cur[k]) !== JSON.stringify(_DBG._snapshot[k])) {
                    diff[k] = { prev: _DBG._snapshot[k], now: cur[k] };
                }
            }
            if (Object.keys(diff).length) {
                _dbgAdd('SETTINGS_CHANGED', diff);
                _DBG._snapshot = JSON.parse(JSON.stringify(cur));
            }
        } catch(_) {}
    }

    function _dbgSetupGlobalErrorHandlers() {
        const origErr = console.error;
        console.error = function(...a) {
            origErr.apply(console, a);
            try {
                _dbgAdd('CONSOLE_ERROR', a.map(x =>
                    x instanceof Error ? (x.stack || x.message) :
                    (typeof x === 'object' ? JSON.stringify(x) : String(x))
                ).join(' '));
            } catch(_) {}
        };
        window.addEventListener('error', e => {
            _dbgAdd('WINDOW_ERROR', { msg: e.message, src: e.filename, line: e.lineno, col: e.colno, stack: e.error?.stack });
        });
        window.addEventListener('unhandledrejection', e => {
            _dbgAdd('UNHANDLED_REJECTION', { msg: String(e.reason), stack: e.reason?.stack });
        });

        if (typeof toastr !== 'undefined') {
            const origToastrError = toastr.error;
            toastr.error = function(message, title, options) {
                try {
                    _dbgAdd('UI_ERROR_POPUP', { title: title || 'Error', message: String(message) });
                } catch(_) {}
                return origToastrError.apply(toastr, [message, title, options]);
            };

            const origToastrWarning = toastr.warning;
            toastr.warning = function(message, title, options) {
                try {
                    _dbgAdd('UI_WARNING_POPUP', { title: title || 'Warning', message: String(message) });
                } catch(_) {}
                return origToastrWarning.apply(toastr, [message, title, options]);
            };
        }
    }

    function dbgDownload() {
        const ctx = SillyTavern.getContext();
        
        let activeId = null;
        const nativeSel = document.getElementById('connection_profile');
        if (nativeSel && typeof nativeSel.value === 'string') {
            activeId = nativeSel.value;
        }

        let profiles = [];
        if (ctx.ConnectionManagerRequestService && typeof ctx.ConnectionManagerRequestService.getSupportedProfiles === 'function') {
            profiles = ctx.ConnectionManagerRequestService.getSupportedProfiles();
        } else {
            profiles = ctx.extensionSettings?.connectionManager?.profiles || [];
        }

        let activeProfileName = 'default';
        let activeProfileData = null;
        if (activeId && activeId !== 'default' && activeId !== 'gui') {
            const found = profiles.find(p => p.id === activeId);
            activeProfileName = found ? found.name : activeId;
            if (found) {
                activeProfileData = JSON.parse(JSON.stringify(found));
                if (activeProfileData['secret-id']) activeProfileData['secret-id'] = '***REDACTED***';
            }
        }

        let sessionMsgs = 0;
        try { sessionMsgs = getCurrentSession()?.messages?.length || 0; } catch(_) {}

        const stEnv = {
            stVersion: document.getElementById('st_version')?.textContent?.trim() || document.querySelector('.drawer-version')?.textContent?.trim() || window.system_version || 'unknown',
            userAgent: navigator.userAgent,
            mainApi: ctx.api_server || document.getElementById('main_api')?.value || 'unknown',
            stMaxContext: ctx.chatCompletionSettings?.openai_max_context || ctx.textCompletionSettings?.max_context || window.token_max || 'unknown',
            stStreamingEnabled: ctx.textCompletionSettings?.streaming || ctx.chatCompletionSettings?.stream_openai || false,
            disabledExtensions: ctx.extensionSettings?.disabledExtensions || [],
            characterId: ctx.characterId,
            chatId: ctx.chatId,
            stChatLength: ctx.chat?.length || 0,
            copilotSessionMsgs: sessionMsgs,
            hasActiveSessionOverrides: hasSessionOverrides(),
            activeConnectionProfile: activeProfileName,
            activeConnectionProfileData: activeProfileData,
            connectionProfiles: profiles.map(p => ({
                id: p.id,
                name: p.name,
                type: p.type || p.api || 'unknown',
            }))
        };

        const lines = [
            '=== ST-Copilot Debug Log ===',
            `Version: ${extVersion} | Session Start: ${_DBG.sessionStart} | Downloaded: ${new Date().toISOString()}`,
            `Entries: ${_DBG.log.length} / ${_DBG.MAX} max`,
            '='.repeat(70),
            '=== SillyTavern Global Environment ===',
            JSON.stringify(stEnv, null, 2),
            '='.repeat(70), ''
        ];
        for (const e of _DBG.log) {
            const d = new Date(e.ts);
            const t = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}.${String(d.getMilliseconds()).padStart(3,'0')}`;
            lines.push(`[${t}] ── ${e.type}`);
            lines.push(typeof e.payload === 'string' ? e.payload : JSON.stringify(e.payload, null, 2));
            lines.push('');
        }
        const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `st-copilot-debug-${Date.now()}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        toastr.success('Debug log downloaded.', EXT_DISPLAY);
    }

    let ST_WorldInfo = null;
    let ST_Utils = null;
    let extVersion = '?';

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

    const DEFAULT_SYSTEM_PROMPT = `<system_role>
Identify as "ST-Copilot", a meta-analytical engine and creative strategist for SillyTavern.
- Human: The person operating the interface. Direct your OOC insights to them.
- {{user}}: The in-universe player avatar.
- {{char}}: The AI persona/setting.
- ST-Copilot: You. An OOC observer. 
MANDATORY: You are NOT {{char}}. Never generate narrative dialogue or actions for {{char}} or {{user}}.
</system_role>

<persona_configuration>
You are a professional, friendly, and highly capable creative co-writer.
- Tone: Conversational, insightful, collaborative, and encouraging. Act as a friendly "Dungeon Master's assistant."
- Focus: Creative brainstorming, plot twists, lore tracking, and resolving writer's block.
- Task: Provide balanced, well-thought-out suggestions that elevate the story's quality. You are the ultimate sounding board for the user's ideas, offering constructive feedback and multiple narrative options to keep the story flowing naturally.
</persona_configuration>

<operational_guidelines>
When the user asks you a question or requests assistance, adhere to the following principles:
1. Contextual Brilliance: Draw upon the provided chat history and {{char}}'s traits to give highly relevant, lore-accurate answers.
2. Creative Brainstorming: Offer imaginative plot twists, analyze character motivations, suggest possible scenarios, or help resolve writer's block. Leave room for the user's imagination—do not force a single narrative path.
3. Formatting: Use markdown (bullet points, bold text, etc.) to make your insights readable and engaging.
</operational_guidelines>

Your ultimate goal is to enhance the user's roleplay experience by providing deep OOC insights, tracking lore, and answering questions based on your specific persona configuration.`;

    const DEFAULT_LB_MANAGE_PROMPT = `<context>
A Lorebook (or World Info) is a dynamic memory system used in roleplay to store and seamlessly retrieve facts about the world, characters, locations, items, and lore. When specific keywords (\`triggers\`) are mentioned in the chat, the system secretly injects the corresponding \`content\` into the AI's prompt.
</context>

<system_mechanics>
After you generate a proposal, a background script extracts your \`lorebook-changes\` block for the user's UI. Once the user makes a decision, the system AUTOMATICALLY DELETES the code block from your message history to save context tokens.
</system_mechanics>

<content_standards>
- Style: Token-dense, encyclopedic, objective.
- Anchor Rule: Content MUST start with "[Subject Name] is/was". No pronouns/articles at the start.
- Anti-Cliché: R Actively reject statistically overused LLM names (e.g., Elara, Kael, Lyra). Invent highly original, phonetically distinct names strictly grounded in the specific setting's culture.
</content_standards>

<modification_protocol>
- \`add\` / \`delete\`: entry from lorebook.
- \`prepend\` / \`append\`: Insert text EXACTLY BEFORE or AFTER existing entry content.
- \`edit\`: Total rewrite (<300 words entries only).
- \`patch\`: Default for entries. 
   - Triggers: Use specific nouns.
   - Boundary Syntax: "First 3 words || Last 3 words" (string-string match). 
     * BAD: "The ancient castle was built in 1240 by a grumpy dwarf."
     * GOOD: "The ancient castle || grumpy dwarf."
</modification_protocol>

<output_requirement>
MANDATORY: Proposals MUST be contained in a \`lorebook-changes\` block at the absolute end.
Active lorebooks (use sctrict-strict match): {{active_lorebooks}}

Explain reasoning to the Human briefly, then provide the block: 
{{lorebook_output}}
</output_requirement>`;

    const DEFAULT_CHAR_EDIT_DIRECTIVE = `<context>
SillyTavern utilizes Character Cards—complex JSON structures that define {{char}} cognitive profile, physical attributes, and behavioral heuristics. In this module you can also edit \`user_persona\` (if you have access)
</context>

<logic_constraints>
- Transient Memory: Previous \`character-edits\` blocks are purged post-execution. Do not reference them.
- Macro Imperative: ABSOLUTELY PROHIBITED from using raw names. Use \`{{char}}\` and \`{{user}}\` exclusively in JSON.
</logic_constraints>

<character_architecture>
To maximize semantic density and prevent AI hallucinations, you MUST adhere to this framework:

1. THE TAGS FIELD (\`tags\`):
   - The Semantic Index. Provide an array of universally recognized, highly common tags (e.g., "Fantasy", "Villain", "Tsundere", "Slow Burn", "NSFW/SFW").
   - Purpose: Immediate cognitive mapping and rapid differentiation. Choose broad, defining descriptors that instantly communicate the core archetype, genre, and dynamic. Strictly avoid hyper-specific, long, or obscure labels.

2. THE DESCRIPTION FIELD (\`description\`):
   - The Factual Summary Block. Use XML tags (e.g., \`<appearance>\`, \`<mind>\`, \`<background>\`) for dense, scannable facts.
   - Add texture to traits (e.g., "Loyal (would starve for them)", not just "Loyal").
   - *Setting Exception*: If creating a world/RPG system, the \`description\` MUST begin EXACTLY with \`"{{char}} is not a character, it's a setting."\` placed right before the first XML tag.

3. THE PERSONALITY FIELD (\`personality\`):
   - The Voice & Behavioral Anchor. Use the Interview format here.
   - Show, don't tell. Write a brief Q&A where a neutral interviewer asks questions and \`{{char}}\` answers. 
   - STRICT FORMATTING: All spoken dialogue MUST be enclosed in standard quotes (e.g., "I don't need your help."). All physical actions, body language, and narration MUST be enclosed in asterisks (e.g., *{{char}} crosses their arms and looks away*).
   - This must demonstrate \`{{char}}\`'s unique voice, verbal tics, deflections, and body language. Do NOT list flat traits here.

4. THE SCENARIO (\`scenario\`):
   - The Permanent Stage. Use ONLY for facts that are ALWAYS TRUE.
   - NEVER put temporary states or starting locations here. 

5. THE FIRST MESSAGE (\`first_mes\`):
   - The Template. Length: 200-500 words.
   - STRICTEST RULE: DO NOT CONTROL \`{{user}}\`. Write strictly from \`{{char}}\`'s 3rd-person perspective. 
   - \`{{char}}\` cannot know what \`{{user}}\` thinks, feels, or does. \`{{char}}\` can only react to \`{{user}}\`'s presence.
   - End with a "Hook" (an open question, a tense silence, an action) that invites \`{{user}}\` to respond.

6. EXAMPLE DIALOGUE (\`mes_example\`):
   - The Voice Coach. Drill speech patterns and emotional range.
   - FORMAT: Isolate examples with \`<START>\` on a new line. End the section with \`<START>\`.
   - STRICT FORMATTING: All spoken dialogue MUST be in quotes ("..."). All actions/body language MUST be in asterisks (*...*). Every example should combine speech with a physical action to demonstrate body language.
   - STRICTEST RULE: NO \`{{user}}\` PROMPTS/DIALOGUE. Do NOT write back-and-forth Q&A here. Make examples context-independent (2-4 sentences showing \`{{char}}\` speaking + acting). Show emotional range (e.g., angry, flustered, guarded)

</character_architecture>


<edit_syntax>
- \`overwrite\`: Full rewrite.
- \`prepend\` / \`append\`: Edge insertion.
- \`replace\`: Surgical patch. Use Boundary Anchor: "3-4 Start Words || 3-4 End Words". 
  * BAD: "The quick brown fox jumps over the lazy dog."
  * GOOD: "The quick brown || lazy dog."
</edit_syntax>

<the_macro_imperative>
CRITICAL FATAL ERROR PREVENTION: Hardcoding names destroys card portability. 
You are strictly forbidden from writing the raw name of the character or the user in the JSON block.
- Replace ANY character/setting name with EXACTLY: \`{{char}}\`
- Replace ANY user/player name with EXACTLY: \`{{user}}\`
- BAD: "Alex looks at John's sword." -> GOOD: "{{char}} looks at {{user}}'s sword."
This rule overrides everything else. Apply it to EVERY field, EVERY JSON value, EVERY time.
</the_macro_imperative>

<output_requirement>
MANDATORY: Append \`character-edits\` or \`character-creation\` block at the absolute end. 
Fields: {{char_edit_fields}}.

Character Edit Format: 
{{char_edit_format}}

Character creation Format:
{{char_create_format}}.
</output_requirement>`;

const DEFAULT_CHAT_EDIT_DIRECTIVE = `<context>
Read/Write access to chat indices (\`<msg index="N">\`).
</context>

<system_mechanics>
Generated \`chat-changes\` blocks are automatically executed and purged from the visible chat history when user makes decision. Missing past blocks are intentional. NEVER hallucinate or re-generate previous blocks.
</system_mechanics>

<operational_rules>
1. Target: Use \`msg_index\`, \`msg_range\`, or \`msg_indices\` from \`<roleplay_context>\`.
2. Operations:
   - \`add\` / \`delete\`: Insert at \`msg_index\`.
   - \`prepend\` / \`append\`: Insert exactly at the extreme start/end of a message.
   - \`hide\` / \`unhide\`: Toggle message visibility for AI.
   - \`overwrite\`: 100% message replacement.
   - \`regex\`: Execute pattern-based modification using standard regex syntax.
   - \`replace\`: Surgical patch (Anchor: "3-4 Start || 3-4 End").
     * GOOD: "The character looked || ever return home."
     * BAD: (Writing the entire sentence wastes tokens and breaks matching).
   - \`bulk_replace\`: Mass search-and-replace across a \`msg_range\`.
3. Guidelines: No narrative introduction of code.
</operational_rules>

<output_formatting>
{{chat_edit_format}}

Active chat message indices are shown in the \`<roleplay_context>\` block as: \`<msg index="N" role="user|assistant">\`
Currently visible messages: {{active_chat_ids}}
</output_formatting>`;

    const LB_FORMAT_BLOCK = `\`\`\`lorebook-changes
{"changes":[
  {"action":"add","worldName":"BookName","name":"EntryName","triggers":["keyword"],"content":"Entry content","constant":false},
  {"action":"delete","worldName":"BookName","uid":123,"name":"EntryName"}
  {"action":"prepend","worldName":"BookName","uid":123,"content":"Text to add at the start"},
  {"action":"append","worldName":"BookName","uid":123,"content":"Text to add at the end"},
  {"action":"edit","worldName":"BookName","uid":123,"name":"NewName","triggers":null | ["newKw"],"content":"New content","constant":false},
  {"action":"patch","worldName":"BookName","uid":123,"triggers":null | ["newKw"],"patches":[{"anchor":"first || last","replace":"replacement"}]},
]}
\`\`\`

Triggers field rules:
- Omit or set \`null\` to keep the original triggers unchanged (preferred for patches, appends and partial edits)
- Provide an array to set new triggers`;

    const CHAR_EDIT_FORMAT_BLOCK = `\`\`\`character-changes
<replace field="FIELD_NAME">
<<<<<<< ANCHOR
first || last
=======
replacement text
>>>>>>> REPLACE
</replace>
<overwrite field="FIELD_NAME">Complete replacement content for this field</overwrite>
<prepend field="FIELD_NAME">Text to insert at the very beginning of the field</prepend>
<append_text field="FIELD_NAME">Text to append at the very end of the field</append_text>

<!-- ALTERNATE GREETINGS OPERATIONS -->
<append field="alternate_greetings">New alternate greeting to add as a NEW entry</append>
<overwrite field="alternate_greetings" index="1">Complete rewrite of the EXISTING greeting with id="1"</overwrite>
<replace field="alternate_greetings" index="2">
<<<<<<< ANCHOR
first || last
=======
replacement text
>>>>>>> REPLACE
</replace>
\`\`\``;

    const CHAR_CREATE_FORMAT_BLOCK = `\`\`\`character-create
{
  "name_suggestion": "Character Name",
  "tags": "tag1, tag2",
  "description": "Full character description",
  "personality": "Personality summary",
  "scenario": "Scenario / setting",
  "first_mes": "Opening message",
  "mes_example": "<START>\\n{{user}}: Hi\\n{{char}}: Hello!"
}
\`\`\``;

    const CHAT_EDIT_FORMAT_BLOCK = `\`\`\`chat-changes
{"changes":[
  {"action":"prepend","msg_index":6,"content":"Text to add at the start. "},
  {"action":"append","msg_index":6,"content":" Text to add at the end."},
  {"action":"add","msg_index":7,"role":"assistant","content":"Brand new message text"},
  {"action":"delete","msg_index":12},
  {"action":"hide","msg_range":[8,10]},
  {"action":"unhide","msg_index":11},
  {"action":"bulk_replace","msg_range":[0,10],"replacements":[{"anchor":"old","replace":"new"}]},
  {"action":"regex","msg_index":13,"regex":"/(hello)/gi","replace":"hi $1"},
  {"action":"overwrite","msg_index":6,"content":"New text"},
  {"action":"replace","msg_index":5,"patches":[{"anchor":"first || last","replace":"new"}]},
]}
\`\`\``;

    const DEFAULT_MEMORY_PROMPT = `<memory_logic>
Purpose: ADMINISTRATIVE META-MEMORY. This is a non-diegetic (OOC) database for ST-Copilot to track the Human operator's technical requirements, cognitive patterns, and workflow constraints. 

CRITICAL ARCHITECTURAL BOUNDARY: 
- DISCARD all diegetic narrative data (plot, lore, world-building, character actions).
- EXCLUDE "What" is happening in the story.
- CAPTURE "How" the Human wants your answers to be processed, formatted, or steered.

Actions: \`add\`, \`update\`, \`delete\`.
Routing Scopes (Choose based on instruction longevity/reach):
- \`global\`: Persists EVERYWHERE. Use for core, permanent Human traits (e.g., IRL profession, absolute formatting rules, universal hard limits).
- \`character\`: Persists ONLY for current {{char}}. Use for technical OOC instructions tailored to this specific bot (e.g., "Human requires verbose prose for this bot", "Human wants to avoid romance with this bot").
- \`chat\`: Persists ONLY in this specific roleplay thread. Use for current storyline structural goals (e.g., "Human wants to shift genre to horror here", "Focus on pacing in this scene").
- \`session\`: Persists ONLY in this current Copilot brainstorm. Use for immediate, temporary directives (e.g., "Human is testing a prompt", "Keep next answers very short").
</memory_logic>

<output_requirement>
MANDATORY: Append a \`memory-update\` block at the absolute end IF AND ONLY IF new administrative/OOC metadata about the Human is detected. Do NOT comment on this process.

Every entry MUST start with the exact word "Human".

# Active memories:
{{current_memories}}

# Format: 
{{memory_format}}
</output_requirement>`;
    const MEMORY_FORMAT_BLOCK = `\`\`\`memory-update\n[\n  {"action":"add","scope":"global|character|chat|session","key":"CategoryName","value":"Fact to remember"},\n  {"action":"edit","scope":"exact_existing_scope","key":"exact_existing_key","value":"Updated fact"},\n  {"action":"delete","scope":"exact_existing_scope","key":"exact_existing_key"}\n]\n\`\`\``;

    const DEFAULT_TOOLS_PROMPT = `Imperative: NEVER hallucinate missing context. If chat history, specific lore, or data appears absent, DO NOT assume the chat hasn't started or the data doesn't exist. You MUST proactively use your tools to fetch, verify, and retrieve the actual state before answering.

Process: Output \`tool_call\` JSON block -> Receive result -> Finalize response to the Human. You may chain tools sequentially.

<available_tools>
{{tools_list}}
</available_tools>

<output_format>
{{tool_call_format}}.
</output_format>`;
    const TOOL_CALL_FORMAT_BLOCK = `\`\`\`tool_call\n{"name": "tool_name","input": {"parameter_name": "value"}}\n\`\`\``;

    // ─── Changelog Data ──────────────────────────────────────────────────────────
    const CHANGELOG = [
    {
        version: '2.8.0',
        date: '6/11/2026',
        announce: true,
        notes: [
            '<strong>Tools & Agency</strong> — Copilot can now independently gather information using the new Tools system.',
            '<strong>Persistent Memory</strong> — Introduced cross-session memory with Global, Character, Chat, and Session scoping.',
            '<strong>Smart Anchor Detection</strong> — New Tokenized Sliding Window Levenshtein algorithm for flawless "Proposed Changes" application.',
            '<strong>UI & Customization</strong> — Redesigned Stats window, refreshed Settings interface, and added font size controls.',
            '<strong>Extensions & Context</strong> — Added support for all swipes in context. Also for Summaryception, and Aspect:Evolutia extensions.',
            '<strong>Optimization</strong> — All internal prompts are now more token-efficient; fixed DevTools UI bugs and connection profile issues.'
        ],
    },
    {
        version: '2.7.2',
        date: '5/29/2026',
        announce: false,
        notes: [
            '<strong>Shortcuts Overlay</strong> — Introduced a dedicated "Shortcuts" configuration window in the settings panel.',
            '<strong>Context-Aware Search</strong> — Refined the search shortcut to trigger exclusively when the Copilot window is active.',
            '<strong>Character Factory Fixes</strong> — Resolved several bugs affecting character creation and metadata initialization.',
            '<strong>Asset Optimization</strong> — Overhauled background storage logic for better performance and reduced storage overhead.'
        ],
    },
    {
        version: '2.7.1',
        date: '5/28/2026',
        announce: false,
        notes: [
            '<strong>Character Tagging</strong> — Added the ability to modify the "tags" field for already existing characters.',
            '<strong>Low Performance Mode</strong> — Introduced a new toggle to optimize resource usage on lower-end hardware.',
            '<strong>Session Stability</strong> — Completely overhauled the session saving system to prevent spontaneous session loss and data corruption.',
            '<strong>General Optimization</strong> — Improved core logic for better performance and overall stability of ST-Copilot. Fixed AI Generation errors.'
        ],
    },
    {
        version: '2.7.0',
        date: '5/27/2026',
        announce: false,
        notes: [
            '<strong>Proposed Chat Edits</strong> — Bulk-modify, delete, or hide message ranges using natural language instructions.',
            '<strong>File Attachments & Vision</strong> — Support for text/image uploads with vision model integration and an internal previewer.',
            '<strong>Message Swiping</strong> — Regenerate Copilot responses and navigate through multiple swipe iterations.',
            '<strong>Multimedia Backgrounds</strong> — Custom image/video backgrounds (local or URL) with adjustable dimming.',
            '<strong>Character Creator</strong> — Added "tags" field support and optimized generation prompts for AI-assisted creation.',
            '<strong>Configuration Sync</strong> — AI settings are now linked to Configuration Profiles and Session Overrides.',
            '<strong>UX Enhancements</strong> — Added "Always Off" Lorebook state, sender-based group selection in context picker, and focus-aware notification sounds.',
            '<strong>UI & Maintenance</strong> — Improved "Save" button feedback, better theme support for lists, and optimized generation logic.'
        ],
    },
    {
        version: '2.5.1',
        date: '5/22/2026',
        announce: false,
        notes: [
            '<strong>Continue Message</strong> — Added a "Continue" button to extend the last Copilot generation.',
            '<strong>Debug Export</strong> — Introduced a downloadable debug log in settings for easier troubleshooting (refreshes on page load).',
            '<strong>Smooth Streaming</strong> — Fixed chat scrolling behavior, allowing users to scroll up during active message streaming.',
            '<strong>Bug Fixes</strong> — Potential fix for the "profile not found" error and minor stability improvements.'
        ],
    },
    {
        version: '2.5.0',
        date: '5/20/2026',
        announce: false,
        notes: [
            '<strong>Character Card Manager</strong> — You can now create new characters entirely from scratch or edit existing card fields directly within the extension.',
            '<strong>Massive Token Optimization</strong> — "Proposed Changes" now uses a smart search-and-replace method, reducing token consumption by over 80% (Huge thanks to Steel-skull for the PR!).',
            '<strong>Robust Parsing</strong> — The system now successfully finds and applies "proposed changes" blocks even if the AI makes formatting mistakes.',
            '<strong>Session Management</strong> — Added the ability to export and import sessions. Under-the-hood session saving has also been rewritten to be much more efficient.',
            '<strong>UI, Sounds & Polish</strong> — Added a generation-complete sound notification, soothing window wobble physics, smooth chart animations in Stats, and new Streaming modes (Auto, Force On, Force Off).',
            '<strong>Lorebook Updates</strong> — Added a "constant" parameter for proposed changes and moved toggles to the main Settings. ⚠️ <em>Important: Please reset your Lorebook AI Edit prompt to default!</em>',
            '<strong>Mobile & Fixes</strong> — The Enter key on mobile keyboards now correctly inserts line breaks instead of sending messages. Fixed mobile UI headers, resolved duplicate user message bugs, and redesigned system message outputs.'
        ],
    },    
    {
        version: '2.3.0',
        date: '5/10/2026',
        announce: false,
        notes: [
            '<strong>Stream Support</strong> — Added streaming support so you can see generations in real-time.',
            '<strong>Reasoning Blocks</strong> — Added support for displaying Reasoning blocks',
            '<strong>Regex Support</strong> — Clean up formatting and fluff from chat messages included in the context.',
            '<strong>Preset Customization</strong> — Modify QuickPrompts and SystemPrompts presets directly (SystemPrompts handled via session override).',
            '<strong>Favorite Messages</strong> — You can now mark specific messages as Favorites.',
            '<strong>In-app Changelog</strong> — Added a Changelog window to easily track new updates.',
            '<strong>Fixes & Polish</strong> — Synced chat context picker numbering with ST (0 to N), fixed Lorebook context persistence after disconnection, and improved the default Lorebook edit prompt.'
        ],
    },
    {
        version: '2.0.0',
        date: '5/03/2026',
        announce: false,
        notes: [
            '<strong>Messages Payload</strong> — Handpick specific messages from the chat history and feed them directly to the AI.',
            '<strong>Quick Prompts</strong> — Fully customizable prompt buttons with emoji icons.',
            '<strong>Ghost Mode</strong> — Copilot can now become semi-transparent and completely click-through.',
            '<strong>Expanded Context Awareness</strong> — Context now includes Character Note, Example of Dialogue, and respects settings overrides.',
            '<strong>Temporary Sessions</strong> — Create sessions that automatically delete themselves when you switch.',
            '<strong>Usage Stats</strong> — A new interactive Statistics window to track your metrics.',
            '<strong>UI & QoL Enhancements</strong> — Save edited messages without regenerating, mobile responsive improvements, HTML support, and clean connecting lines for lists.'
        ],
    },
    {
        version: '1.9.0',
        date: '4/28/2026',
        announce: false,
        notes: [
            '<strong>Integrated Settings Window</strong> — Dedicated settings UI for seamless adjustments.',
            '<strong>Session-Specific Configuration</strong> — Override global settings for individual sessions.',
            '<strong>Dynamic Context Scaling</strong> — The CTX slider dynamically adjusts its range based on chat length.',
            '<strong>Advanced In-Chat Search</strong> — Quickly locate specific information using (Ctrl + F).',
            '<strong>Theme Portability</strong> — Import and Export custom themes as JSON. Added the new "Dark Sky" preset.'
        ],
    },
    {
        version: '1.7.2',
        date: '4/27/2026',
        announce: false,
        notes: [
            '<strong>Comfortable Color Picker</strong> — Choose colors natively without leaving the app.',
            '<strong>Default Colors</strong> — Individually reset specific colors to the original theme defaults.',
            '<strong>Resizable edit window</strong> — You can now manually resize the "content" window in the Lorebook Manager.'
        ],
    },
    {
        version: '1.7.1',
        date: '4/26/2026',
        announce: false,
        notes: [
            '<strong>Expandable Entry Descriptions</strong> — Click to expand chat entry descriptions.',
            '<strong>Lorebook Dropdowns</strong> — Individual Lorebook selection dropdowns for each entry proposal.',
            '<strong>Data Protection</strong> — Added unsaved changes warnings when switching profiles.',
            '<strong>New Macro</strong> — Added support for {{active_lorebooks}}.'
        ],
    },
    {
        version: '1.7.0',
        date: '4/26/2026',
        announce: false,
        notes: [
            '<strong>AI Lorebook Management</strong> — Copilot AI now actively assists in world-building (AI-Edit).',
            '<strong>Interactive Proposals</strong> — AI generates Proposal Cards to review, edit, or reject changes via a Diff View modal.',
            '<strong>Lorebook Manager UI</strong> — Added manual overrides, Auto-Keywords, and Active Indicators.',
            '<strong>String Trimming</strong> — Automatically remove specific tags (like &lt;think&gt; blocks) from AI responses.',
            '<strong>Persistent Icon</strong> — Option to keep the floating dock icon visible at all times.'
        ],
    }
];

        
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
            border: '1px solid rgba(255,255,255,0.09)', font: '',
        },
        blue_ocean : {
            label: 'Blue Ocean',
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
        onyx_ivory: {
            label: 'Onyx & Ivory',
            bg: 'rgba(17,17,17,0.96)', blur: 'blur(16px)',
            text: '#f4ede4', textMuted: '#b8a898',
            accent: '#d4c4b0', accentDim: 'rgba(212,196,176,0.4)',
            accentBg: 'rgba(212,196,176,0.08)',
            headerBg: 'rgba(244,237,228,0.04)', toolbarBg: 'rgba(0,0,0,0.3)',
            msgUserBg: 'rgba(244,237,228,0.07)', msgAiBg: 'rgba(255,255,255,0.02)',
            inputBg: 'rgba(0,0,0,0.35)', codeBg: 'rgba(0,0,0,0.45)',
            radius: '10px', danger: '#e05c5c', success: '#6ab88a',
            shadow: '0 28px 70px rgba(0,0,0,0.7), 0 4px 18px rgba(0,0,0,0.5)',
            border: '1px solid rgba(244,237,228,0.1)', font: '',
        },
        violet_sun: {
            label: 'Violet & Sun',
            bg: 'rgba(20,8,42,0.97)', blur: 'blur(18px)',
            text: '#f0e8ff', textMuted: '#9a80c0',
            accent: '#ffd60a', accentDim: 'rgba(255,214,10,0.45)',
            accentBg: 'rgba(255,214,10,0.1)',
            headerBg: 'rgba(90,24,154,0.15)', toolbarBg: 'rgba(0,0,0,0.3)',
            msgUserBg: 'rgba(255,214,10,0.07)', msgAiBg: 'rgba(90,24,154,0.06)',
            inputBg: 'rgba(0,0,0,0.4)', codeBg: 'rgba(0,0,0,0.5)',
            radius: '10px', danger: '#ff5c5c', success: '#4caf7d',
            shadow: '0 24px 64px rgba(0,0,0,0.75), 0 0 40px rgba(90,24,154,0.15)',
            border: '1px solid rgba(90,24,154,0.3)', font: '',
        },
        forest_gold: {
            label: 'Forest & Gold',
            bg: 'rgba(2,16,10,0.97)', blur: 'blur(12px)',
            text: '#e8dfc8', textMuted: '#8a9e80',
            accent: '#d4a373', accentDim: 'rgba(212,163,115,0.45)',
            accentBg: 'rgba(212,163,115,0.1)',
            headerBg: 'rgba(212,163,115,0.06)', toolbarBg: 'rgba(0,0,0,0.35)',
            msgUserBg: 'rgba(212,163,115,0.08)', msgAiBg: 'rgba(255,255,255,0.02)',
            inputBg: 'rgba(0,0,0,0.4)', codeBg: 'rgba(0,0,0,0.5)',
            radius: '8px', danger: '#e05c5c', success: '#69a458',
            shadow: '0 24px 64px rgba(0,0,0,0.8), 0 0 30px rgba(2,48,32,0.4)',
            border: '1px solid rgba(212,163,115,0.15)', font: '',
        },
        crimson_cream: {
            label: 'Crimson & Cream',
            bg: 'rgba(28,4,4,0.97)', blur: 'blur(14px)',
            text: '#fff3e0', textMuted: '#c09070',
            accent: '#e85555', accentDim: 'rgba(214,40,40,0.45)',
            accentBg: 'rgba(214,40,40,0.1)',
            headerBg: 'rgba(214,40,40,0.07)', toolbarBg: 'rgba(0,0,0,0.32)',
            msgUserBg: 'rgba(214,40,40,0.08)', msgAiBg: 'rgba(255,243,224,0.02)',
            inputBg: 'rgba(0,0,0,0.38)', codeBg: 'rgba(0,0,0,0.48)',
            radius: '10px', danger: '#ff5c5c', success: '#6ab88a',
            shadow: '0 24px 64px rgba(0,0,0,0.75), 0 0 30px rgba(214,40,40,0.08)',
            border: '1px solid rgba(214,40,40,0.2)', font: '',
        },
        teal_midnight: {
            label: 'Teal & Midnight',
            bg: 'rgba(10,12,24,0.97)', blur: 'blur(16px)',
            text: '#d8f0ee', textMuted: '#5a8a88',
            accent: '#2ec4b6', accentDim: 'rgba(46,196,182,0.4)',
            accentBg: 'rgba(46,196,182,0.1)',
            headerBg: 'rgba(46,196,182,0.06)', toolbarBg: 'rgba(0,0,0,0.3)',
            msgUserBg: 'rgba(46,196,182,0.08)', msgAiBg: 'rgba(255,255,255,0.02)',
            inputBg: 'rgba(0,0,0,0.38)', codeBg: 'rgba(0,0,0,0.48)',
            radius: '10px', danger: '#ff5c5c', success: '#2ec4b6',
            shadow: '0 24px 64px rgba(0,0,0,0.75), 0 0 40px rgba(26,26,46,0.5)',
            border: '1px solid rgba(46,196,182,0.15)', font: '',
        },
        ember_sand: {
            label: 'Ember & Sand',
            bg: 'rgba(22,10,4,0.97)', blur: 'blur(14px)',
            text: '#f5ebe0', textMuted: '#b08060',
            accent: '#ff6f3c', accentDim: 'rgba(255,111,60,0.4)',
            accentBg: 'rgba(255,111,60,0.1)',
            headerBg: 'rgba(255,111,60,0.06)', toolbarBg: 'rgba(0,0,0,0.32)',
            msgUserBg: 'rgba(255,111,60,0.08)', msgAiBg: 'rgba(245,235,224,0.02)',
            inputBg: 'rgba(0,0,0,0.36)', codeBg: 'rgba(0,0,0,0.46)',
            radius: '10px', danger: '#ff5c5c', success: '#6ab88a',
            shadow: '0 24px 64px rgba(0,0,0,0.75), 0 0 30px rgba(255,111,60,0.06)',
            border: '1px solid rgba(255,111,60,0.18)', font: '',
        },
        sage_mist: {
            label: 'Sage & Mist',
            bg: 'rgba(10,18,14,0.96)', blur: 'blur(16px)',
            text: '#e7edeb', textMuted: '#7a9a88',
            accent: '#69a481', accentDim: 'rgba(105,164,129,0.4)',
            accentBg: 'rgba(105,164,129,0.1)',
            headerBg: 'rgba(105,164,129,0.05)', toolbarBg: 'rgba(0,0,0,0.28)',
            msgUserBg: 'rgba(105,164,129,0.08)', msgAiBg: 'rgba(231,237,235,0.02)',
            inputBg: 'rgba(0,0,0,0.32)', codeBg: 'rgba(0,0,0,0.42)',
            radius: '12px', danger: '#e05c5c', success: '#69a481',
            shadow: '0 24px 64px rgba(0,0,0,0.65), 0 0 30px rgba(10,18,14,0.4)',
            border: '1px solid rgba(105,164,129,0.15)', font: '',
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
        { key: 'danger',     label: 'Danger Color',  hint: '#ff5c5c' },
        { key: 'success',    label: 'Success Color', hint: '#4caf7d' },
        { key: 'blur',       label: 'Blur',          hint: 'blur(14px)' },
        { key: 'border',     label: 'Border',        hint: '1px solid rgba(...)' },
        { key: 'radius',     label: 'Corner Radius', hint: '10px' },
        { key: 'shadow',     label: 'Shadow',        hint: 'CSS box-shadow' },
        { key: 'font',       label: 'Font Family',   hint: "system-ui, sans-serif" },
        { key: 'fontSize',   label: 'Font Size',     hint: '13px' },
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
        fontSize: '--scp-font-size',
    };

    // ─── Lorebook (World Info) Module ─────────────────────────────────────────────

    let _wiCache = {};
    let _wiPromises = {}; 
    const EMBEDDED_BOOK_KEY = '__char_embedded__';
    let _lastActiveEntries = [];
    let _regexModule = false;
    let _copilotActive = false;

    async function loadRegexModule() {
        if (_regexModule !== false) return _regexModule;
        try {
            _regexModule = await import('/scripts/extensions/regex/engine.js');
        } catch (e) {
            _regexModule = null;
        }
        return _regexModule;
    }

    async function applyRegexIfEnabled(text, isUser, depth) {
        if (!getEffectiveSettings().applyRegexToContext) return text;
        try {
            const mod = await loadRegexModule();
            if (!mod?.getRegexedString) return text;
            const placement = isUser
                ? (mod.regex_placement?.USER_INPUT ?? 1)
                : (mod.regex_placement?.AI_OUTPUT ?? 2);
            const params = { isPrompt: true };
            if (typeof depth === 'number') params.depth = depth;
            const result = mod.getRegexedString(text, placement, params);
            const resolved = (result instanceof Promise) ? await result : result;
            return (typeof resolved === 'string') ? resolved : text;
        } catch (e) {
            return text;
        }
    }

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
                _dbgAdd('LB_LOAD_FILE_FAILED', { bookName: name, error: e.message });
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
            _dbgAdd('LB_SAVE_FILE_FAILED', { bookName: name, error: e.message });
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

    function getTagsForCharacter(char) {
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

    function getEntryOverrideKey(bookName, entry) {
        let entryName = (entry.comment || entry.name || '').trim();
        if (!entryName && entry.key && entry.key.length) {
            entryName = entry.key.join('_').slice(0, 40);
        }
        entryName = entryName.replace(/[\r\n]+/g, ' ').trim();
        return entryName ? `${bookName}_${entryName}` : `${bookName}_${entry.uid}`;
    }

    async function buildLorebookContextBlock(settings) {
        _lastActiveEntries = [];
        const selectedBooks = settings.lorebookSelectedBooks || [];
        const excludedBooks = new Set(settings.lorebookExcludedBooks || []);
        const overrides = settings.lorebookEntryOverrides || {};
        if (!selectedBooks.length && !settings.lorebookAutoKeyword && !excludedBooks.size) return '';
        const loadedBooks = {};
        const _activeNamesSet = new Set(getActiveLorebookNames());

        await Promise.all(selectedBooks.map(async name => {
            if (!_activeNamesSet.has(name) || excludedBooks.has(name)) return;
            const data = await fetchWorldInfoBook(name);
            if (data) loadedBooks[name] = data;
        }));


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

            const activeNames = getActiveLorebookNames();
            await Promise.all(activeNames.map(async name => {
                if (!loadedBooks[name] && !excludedBooks.has(name)) {
                    const data = await fetchWorldInfoBook(name);
                    if (data) loadedBooks[name] = data;
                }
            }));
            keywordEntries = getKeywordTriggeredEntries(loadedBooks, lastUser + '\n' + lastChar, copilotScanText);
        }

        const toInject = {};
        let overridesChanged = false;

        for (const[bookName, data] of Object.entries(loadedBooks)) {
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
                    if (!toInject[bookName]) toInject[bookName] = [];
                    toInject[bookName].push(entry);
                }
            }
        }

        if (overridesChanged) saveSettings();

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
        const excludedBooks = new Set(settings.lorebookExcludedBooks || []);
        const activeBooks =[...new Set(_lastActiveEntries.map(e => e.displayName || e.bookName))].filter(b => !excludedBooks.has(b));
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

    // ─── Character Card Editing Engine ───────────────────────────────────────────

    function getEffectiveCharField(settings, k) {
        const ovKey = 'charField_' + k;
        if (settings[ovKey] !== undefined) return settings[ovKey];
        return !!(settings.charEditFields || {})[k];
    }

    function buildAltGreetingsPicker(container, isOverride = false) {
        if (!container) return;
        container.innerHTML = '';
        
        const s = getSettings();
        if (!s.charEditFields) s.charEditFields = {};
        
        if (Array.isArray(s.altGreetingIndices)) s.altGreetingIndices = {};
        if (!s.altGreetingIndices) s.altGreetingIndices = {};
        
        const ctx = SillyTavern.getContext();
        const charId = ctx.characterId || 'unknown';
        const char = ctx.characters?.[charId];
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
            row.addEventListener('mouseenter', () => { row.style.background = 'rgba(255,255,255,.04)'; });
            row.addEventListener('mouseleave', () => { row.style.background = ''; });

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

    function refreshAltGreetingsPickers() {
        buildAltGreetingsPicker(document.getElementById('scp-ce-alt-greetings-picker'), false);
        buildAltGreetingsPicker(document.getElementById('scp-sp-ce-alt-greetings-picker'), false);
        buildAltGreetingsPicker(document.getElementById('scp-sp-ov-ce-alt-greetings-picker'), true);
    }

    function buildCharacterContextBlock(settings) {
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

        const simple = {
            description: d.description || char.description,
            personality: d.personality || char.personality,
            scenario: d.scenario || char.scenario,
            first_mes: d.first_mes || char.first_mes,
            mes_example: d.mes_example || char.mes_example,
        };

        // Aspect: Evolutia
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
            if (getEffectiveCharField(settings, key) && val) parts.push(`<${key}>\n${val}\n</${key}>`);
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

    function buildCharEditAIInstructions(settings) {
        if (!settings.charEditAIEnabled) return '';
        const baseFields = ['tags', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'authors_note', 'alternate_greetings'];
        const fieldsList = baseFields.filter(k => getEffectiveCharField(settings, k));
        
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

    function buildChatEditAIInstructions(settings) {
        if (!settings.chatEditAIEnabled) return '';
        const ctx = SillyTavern.getContext();
        const stMsgs = ctx.chat || [];
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
        return `<chat_messages_editing>\n${base}\n</chat_messages_editing>`;
    }

    function _sanitizeProposedTags(value) {
        if (typeof value !== 'string') return '';
        let cleaned = value.trim();
        
        try {
            const parsed = JSON.parse(cleaned);
            if (Array.isArray(parsed)) {
                return parsed.map(t => String(t).trim()).filter(Boolean).join(', ');
            }
            if (typeof parsed === 'string') {
                cleaned = parsed.trim();
            }
        } catch (_) {}

        cleaned = cleaned.replace(/^\[\s*|\]\s*$/g, '').trim();

        const quotedMatches = [...cleaned.matchAll(/["']([^"']+)["']/g)].map(m => m[1].trim());
        if (quotedMatches.length > 0) {
            return quotedMatches.filter(Boolean).join(', ');
        }

        return cleaned.split(',')
            .map(item => item.replace(/[\[\]"']/g, '').trim())
            .filter(Boolean)
            .join(', ');
    }

    function parseCharChangesFromText(text) {
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

    function _repairCharChangesXML(raw) {
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

    function stripCharChangesBlock(text) {
        return text
            .replace(/```character-changes[\s\S]*?```/g, '')
            .replace(/```character-changes[\s\S]*/g, '')
            .trim();
    }

    function parseCharCreationFromText(text) {
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

    function stripCharCreationBlock(text) {
        return text
            .replace(/```character-create[\s\S]*?```/g, '')
            .replace(/```character-create[\s\S]*/g, '')
            .trim();
    }

    function normalizeCharNamesInBlock(text) {
        const ctx = SillyTavern.getContext();
        const charName = ctx.characters?.[ctx.characterId]?.name;
        const userName = ctx.name1;
        return text.replace(/(```(?:character-changes|character-create)[\s\S]*?(?:```|$))/g, block => {
            let r = block;
            if (charName && charName.length > 2) {
                const charRe = new RegExp(`\\b${charName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
                r = r.replace(charRe, '{{char}}');
            }
            if (userName && userName.length > 2) {
                const userRe = new RegExp(`\\b${userName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
                r = r.replace(userRe, '{{user}}');
            }
            return r;
        });
    }

    function applySearchReplaceToField(fieldContent, searchText, replaceText) {
        if (!fieldContent) return { result: replaceText || '', matched: true };
        const src = fieldContent;
        const srch = searchText || '';
        const repl = replaceText || '';

        function levenshtein(a, b) {
            if (a === b) return 0;
            let l1 = a.length, l2 = b.length;
            if (l1 === 0) return l2;
            if (l2 === 0) return l1;
            let prev = new Int32Array(l2 + 1);
            let curr = new Int32Array(l2 + 1);
            for (let j = 0; j <= l2; j++) prev[j] = j;
            for (let i = 1; i <= l1; i++) {
                curr[0] = i;
                for (let j = 1; j <= l2; j++) {
                    let cost = (a.charAt(i - 1) === b.charAt(j - 1)) ? 0 : 1;
                    curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
                }
                let temp = prev; prev = curr; curr = temp;
            }
            return prev[l2];
        }

        function getTokenSimilarity(t1, t2) {
            if (t1 === t2) return 1.0;
            if (t1.length >= 3 && t2.length >= 3) {
                if (t1.startsWith(t2) || t2.startsWith(t1)) return 0.85;
            }
            const dist = levenshtein(t1, t2);
            return 1 - (dist / Math.max(t1.length, t2.length));
        }

        function getTokensWithOffsets(text) {
            const tokens = [];
            const re = /[a-zA-Z0-9\u00C0-\u00FF]+/g;
            let match;
            while ((match = re.exec(text)) !== null) {
                tokens.push({ text: match[0].toLowerCase(), start: match.index, end: re.lastIndex });
            }
            return tokens;
        }

        function findFuzzyRange(srcText, queryText, minScore = 0.72) {
            const srcTokens = getTokensWithOffsets(srcText);
            const queryTokens = queryText.toLowerCase().match(/[a-zA-Z0-9\u00C0-\u00FF]+/g) || [];
            if (!queryTokens.length || !srcTokens.length) return null;

            let bestScore = 0;
            let bestStartIdx = -1;
            let bestEndIdx = -1;

            const minWinSize = Math.max(1, queryTokens.length - 1);
            const maxWinSize = queryTokens.length + 1;

            for (let winSize = minWinSize; winSize <= maxWinSize; winSize++) {
                for (let i = 0; i <= srcTokens.length - winSize; i++) {
                    const windowTokens = srcTokens.slice(i, i + winSize);
                    let totalSim = 0;
                    const compareCount = Math.max(queryTokens.length, windowTokens.length);
                    for (let j = 0; j < compareCount; j++) {
                        const qT = queryTokens[j];
                        const wT = windowTokens[j]?.text;
                        if (qT && wT) totalSim += getTokenSimilarity(qT, wT);
                    }
                    const score = totalSim / compareCount;
                    if (score > bestScore) {
                        bestScore = score;
                        bestStartIdx = i;
                        bestEndIdx = i + winSize - 1;
                    }
                }
            }

            if (bestScore >= minScore) {
                return { start: srcTokens[bestStartIdx].start, end: srcTokens[bestEndIdx].end, score: bestScore };
            }
            return null;
        }
        // ─────────────────────────────────────────────────────────────

        let sepIdx = srch.indexOf(' || ');
        let sepLen = 4;
        if (sepIdx === -1) { sepIdx = srch.indexOf('||'); sepLen = 2; }
        if (sepIdx === -1) { sepIdx = srch.indexOf('...'); sepLen = 3; }

        if (sepIdx !== -1 && sepIdx > 0 && srch.length - sepIdx - sepLen > 0) {
            const startPart = srch.slice(0, sepIdx).trim();
            const endPart = srch.slice(sepIdx + sepLen).trim();
            
            if (startPart && endPart) {
                const startMatch = findFuzzyRange(src, startPart);
                if (startMatch) {
                    const remainingSrc = src.slice(startMatch.end);
                    const endMatch = findFuzzyRange(remainingSrc, endPart);
                    if (endMatch) {
                        const absoluteEnd = startMatch.end + endMatch.end;
                        return {
                            result: src.slice(0, startMatch.start) + repl + src.slice(absoluteEnd),
                            matched: true
                        };
                    }
                }
            }
        }

        if (srch.trim()) {
            const match = findFuzzyRange(src, srch);
            if (match) {
                return {
                    result: src.slice(0, match.start) + repl + src.slice(match.end),
                    matched: true
                };
            }
        }

        _dbgAdd('LB_PATCH_FUZZY_MATCH_FAILED', { search: srch, srcLength: src.length });
        return { result: src, matched: false };
    }

    function getCharFieldValue(char, fieldId) {
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
        
        const d = char.data || {};
        if (fieldId === 'authors_note') return getAuthorsNote();
        if (fieldId === 'alternate_greetings') return d.alternate_greetings || [];
        return d[fieldId] || char[fieldId] || '';
    }

    async function saveCharacterField(char, fieldId, newValue) {
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
            mes_example: 'mes_example_textarea'
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

    async function applyCharChanges(changes, afterMsgId = null) {
        const ctx = SillyTavern.getContext();
        const char = ctx.characters?.[ctx.characterId];
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
            logCharEditHistory(successLog, 'Applied', afterMsgId);
            toastr.success(`[CharEdit] ${successLog.length} change(s) applied.`, EXT_DISPLAY);
        }
    }

    function logCharEditHistory(changes, statusStr, afterMsgId = null) {
        if (!changes?.length) return;
        try {
            const getFieldLabel = (f) => {
                const LBLS = { tags:'Tags', description:'Description', personality:'Personality', scenario:'Scenario', first_mes:'First Message', mes_example:'Example Dialogue', authors_note:"Author's Note", user_persona:"User Persona", alternate_greetings:'Alternate Greetings' };
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

            if (afterMsgId && addHistoryToSwipe(afterMsgId, newLines)) return;

            const histText = `**System Notification** — Character card edits:\n${newLines.join('\n')}`;
            const msg = addMessage(session, 'system', histText, { isCharEditHistory: true, isLBHistory: true, appliedLines: [...newLines] });
            appendLBHistoryEl(msg);
        } catch (_) {}
    }

    function logCharCreationHistory(creationData, statusStr, afterMsgId = null) {
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

    function reconstructCharChangesBlock(pendingChanges) {
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

    async function createCharacterAPI(data) {
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

    function renderCharCreationCard(creationData, msgEl) {
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
    }

    function renderCharProposalCard(changes, msgEl) {
        if (!changes?.length) return;
        document.querySelector(`.scp-char-proposal-card[data-for="${msgEl.dataset.id}"]`)?.remove();

        const ctx = SillyTavern.getContext();
        const char = ctx.characters?.[ctx.characterId];
        const editableChanges = changes.map(c => JSON.parse(JSON.stringify(c)));
        const itemStates = editableChanges.map(() => 'pending');

        const getFieldLabel = (f) => {
            const LBLS = { description:'Description', personality:'Personality', scenario:'Scenario', first_mes:'First Message', mes_example:'Example Dialogue', authors_note:"Author's Note", user_persona:"User Persona", alternate_greetings:'Alternate Greetings' };
            if (LBLS[f]) return LBLS[f];
            if (f && f.startsWith('evolutia_char:')) return `Aspect (Char): ${f.split('evolutia_char:')[1]}`;
            if (f && f.startsWith('evolutia_user:')) return `Aspect (User): ${f.split('evolutia_user:')[1]}`;
            return f || '?';
        };

        const card = document.createElement('div');
        card.className = 'scp-lb-proposal-card scp-char-proposal-card';
        card.dataset.for = msgEl.dataset.id;
        card.style.margin = '8px 0 0 0';

        const syncBlockToMessage = () => {
            const session = getCurrentSession();
            const msg = session.messages.find(m => m.id === card.dataset.for);
            if (!msg) return;
            const pending = editableChanges.filter((_, i) => itemStates[i] === 'pending');
            const stripped = stripCharChangesBlock(msg.content);
            if (pending.length === 0) msg.content = stripped;
            else msg.content = stripped + '\n\n' + reconstructCharChangesBlock(pending);
            if (msg.swipes) msg.swipes[msg.swipeIndex || 0].content = msg.content;
            saveSessionsToMetadata();
        };

        const persistState = () => {};
        const getPending = () => itemStates.filter(s => s === 'pending').length;
        const checkAllResolved = () => {
            if (getPending() > 0) return;
            syncBlockToMessage();
            card.remove(); 
            const msg = getCurrentSession().messages.find(m => m.id === msgEl.dataset.id);
            if (msg) _renderMsgBodyContent(msgEl, msg);
        };

        const validateReplaceChange = (change) => {
            if (!char) return { valid: false, reason: 'No active character' };
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
            if (!char) return '';
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

        // Header
        const header = document.createElement('div');
        header.className = 'scp-lb-proposal-header';
        const headerLeft = document.createElement('div');
        headerLeft.style.cssText = 'display:flex;align-items:center;gap:8px;flex:1;min-width:0';
        const countBadge = document.createElement('span');
        countBadge.className = 'scp-lb-proposal-count';
        countBadge.textContent = `${editableChanges.length} pending`;
        headerLeft.innerHTML = `<span class="scp-lb-proposal-icon" style="color:var(--scp-accent);display:flex"><i class="fa-solid fa-user-pen"></i></span><span class="scp-lb-proposal-title">Proposed Character Edits</span>`;
        headerLeft.appendChild(countBadge);
        const dismissBtn = document.createElement('button');
        dismissBtn.className = 'scp-lb-proposal-dismiss'; dismissBtn.innerHTML = I.x; dismissBtn.title = 'Dismiss';
        dismissBtn.addEventListener('click', () => { 
            const pending = editableChanges.filter((_, i) => itemStates[i] === 'pending');
            if (pending.length > 0) logCharEditHistory(pending, 'Dismissed', card.dataset.for);
            itemStates.forEach((s, i) => { if (s === 'pending') itemStates[i] = 'dismissed'; });
            syncBlockToMessage(); 
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

            if ((c.action === 'replace' || c.action === 'overwrite') && char) {
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
                    const title = `Diff: ${getFieldLabel(c.field)}${c.index?` #${c.index}`:''}`;
                    openTextDiffModal(title, original, result);
                });
                btns.appendChild(diffBtn);
            }

            const editToggleBtn = document.createElement('button');
            editToggleBtn.className = 'scp-lb-proposal-edit-toggle'; editToggleBtn.title = 'Edit before applying'; editToggleBtn.textContent = '✎';
            btns.appendChild(editToggleBtn);

            const applyBtn = document.createElement('button');
            applyBtn.className = 'scp-lb-proposal-item-apply'; applyBtn.title = 'Apply'; applyBtn.textContent = '✓';

            if (c.action === 'replace' && char) {
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
                try {
                    await applyCharChanges([editableChanges[ci]], card.dataset.for);
                    itemStates[ci] = 'applied';
                    item.classList.add('scp-lb-item-applied');
                    btns.querySelectorAll('button').forEach(b => { b.disabled = true; });
                    persistState(); countBadge.textContent = `${getPending()} pending`; updateFooter(); 
                    syncBlockToMessage();
                    checkAllResolved();
                } catch (err) {
                    toastr.error(`Failed: ${err.message}`, EXT_DISPLAY);
                    applyBtn.disabled = false; applyBtn.textContent = '\u2713';
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
                logCharEditHistory([editableChanges[ci]], 'Rejected', card.dataset.for);
                persistState(); countBadge.textContent = `${getPending()} pending`; updateFooter(); 
                syncBlockToMessage();
                checkAllResolved();
            });

            btns.appendChild(applyBtn); btns.appendChild(rejectBtn);
            hdr.appendChild(meta); hdr.appendChild(btns);
            item.appendChild(hdr);

            // Preview (expandable)
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
                e.stopPropagation();
                _expanded = !_expanded;
                refreshPreview();
            });
            item.appendChild(previewEl);

            // Edit panel
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
                                if (char) { const { valid } = validateReplaceChange(change); applyBtn.disabled = !valid; }
                                refreshPreview();
                            });
                            pHdr.appendChild(delP);
                        }
                        editPanel.appendChild(pHdr);

                        const searchTa = document.createElement('textarea');
                        searchTa.className = 'scp-lb-pe-textarea'; searchTa.rows = 2; searchTa.value = patch.search || '';
                        searchTa.placeholder = 'first unique words || last unique words';
                        searchTa.addEventListener('input', () => { 
                            editableChanges[ci].patches[pi].search = searchTa.value; 
                            _validateBookEntry(_selectedBook).catch(()=>{}); 
                        });
                        editPanel.appendChild(mkRow('Anchor', searchTa));

                        const replaceTa = document.createElement('textarea');
                        replaceTa.className = 'scp-lb-pe-textarea'; replaceTa.rows = 3; replaceTa.value = patch.replace || '';
                        replaceTa.addEventListener('input', () => {
                            change.patches[pi].replace = replaceTa.value;
                            refreshPreview();
                        });
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
                    addPatchBtn.addEventListener('click', () => {
                        change.patches.push({ search: '', replace: '' });
                        rebuildEditPanel();
                    });
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

        itemEls.forEach((el, i) => {
            if (itemStates[i] === 'applied') {
                el.classList.add('scp-lb-item-applied');
                el.querySelectorAll('button').forEach(b => { b.disabled = true; });
            } else if (itemStates[i] === 'rejected') {
                el.classList.add('scp-lb-item-rejected');
                el.querySelectorAll('button').forEach(b => { b.disabled = true; });
            }
        });

        const footer = document.createElement('div');
        footer.className = 'scp-lb-proposal-footer';
        const applyAllBtn = document.createElement('button');
        applyAllBtn.className = 'scp-lb-proposal-apply'; applyAllBtn.textContent = 'Apply All';
        const rejectAllBtn = document.createElement('button');
        rejectAllBtn.className = 'scp-lb-proposal-reject'; rejectAllBtn.textContent = 'Reject All';

        const updateFooter = () => {
            const p = getPending();
            applyAllBtn.style.display = p > 0 ? '' : 'none';
            rejectAllBtn.style.display = p > 0 ? '' : 'none';
        };
        updateFooter();

        applyAllBtn.addEventListener('click', async () => {
            const pending = editableChanges.filter((_, i) => itemStates[i] === 'pending');
            if (!pending.length) return;
            applyAllBtn.disabled = true; applyAllBtn.textContent = 'Applying\u2026';
            try {
                await applyCharChanges(pending, card.dataset.for);
                itemStates.forEach((s, i) => { if (s === 'pending') { itemStates[i] = 'applied'; itemEls[i]?.classList.add('scp-lb-item-applied'); itemEls[i]?.querySelectorAll('button').forEach(b => { b.disabled = true; }); } });
                persistState(); countBadge.textContent = `${getPending()} pending`; updateFooter(); 
                syncBlockToMessage();
                checkAllResolved();
            } catch (e) {
                toastr.error(`Failed: ${e.message}`, EXT_DISPLAY);
                applyAllBtn.disabled = false; applyAllBtn.textContent = 'Apply All';
            }
        });
        rejectAllBtn.addEventListener('click', () => {
            const pending = editableChanges.filter((_, i) => itemStates[i] === 'pending');
            itemStates.forEach((s, i) => { if (s === 'pending') { itemStates[i] = 'rejected'; itemEls[i]?.classList.add('scp-lb-item-rejected'); itemEls[i]?.querySelectorAll('button').forEach(b => { b.disabled = true; }); } });
            logCharEditHistory(pending, 'Rejected', card.dataset.for);
            persistState(); countBadge.textContent = `${getPending()} pending`; updateFooter(); 
            syncBlockToMessage();
            checkAllResolved();
        });

        footer.appendChild(applyAllBtn); footer.appendChild(rejectAllBtn);
        card.appendChild(header); card.appendChild(list); card.appendChild(footer);
        const body = msgEl.querySelector('.scp-msg-body');
        if (body) body.insertBefore(card, body.querySelector('.scp-swipe-bar'));
        else msgEl.after(card);
    }

    // ─────────────────────────────────────────────────────────────────────────────

    function parseLBChangesFromText(text) {
        let raw = null;
        const strict = text.match(/```lorebook-changes\s*([\s\S]*?)```/);
        if (strict) {
            raw = strict[1].trim();
        } else {
            const open = text.match(/```lorebook-changes\s*([\s\S]*?)(?=```|$)/);
            if (open) raw = open[1].trim();
        }
        if (!raw) return null;
        // direct parse
        try {
            const data = JSON.parse(raw);
            if (Array.isArray(data.changes)) return _sanitizeLBChanges(data.changes);
        } catch (_) {}
        // repair common issues
        try {
            const repaired = _repairJSON(raw);
            const data = JSON.parse(repaired);
            if (Array.isArray(data.changes)) return _sanitizeLBChanges(data.changes);
        } catch (_) {}
        //aggressive unescaped-quotes fix
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

    function _parseLBDiffPatch(str) {
        const m = str.match(/<<<<<<< (?:SEARCH|ANCHOR)\r?\n([\s\S]*?)\r?\n=+\r?\n([\s\S]*?)\r?\n>>>>>>> REPLACE/);
        return m ? { search: m[1], replace: m[2] } : null;
    }

    function _sanitizeLBChanges(changes) {
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

    function _repairJSON(raw) {
        let s = raw;
        s = s.replace(/,\s*([\}\]])/g, '$1');
        try {
            s = s.replace(/"((?:[^"\\]|\\.)*)"/g, (match, inner) => {
                const fixed = inner.replace(/(?<!\\)"/g, '\\"');
                return `"${fixed}"`;
            });
        } catch (_) {}
        const opens = (s.match(/[\[{]/g) || []).length;
        const closes = (s.match(/[\]\}]/g) || []).length;
        if (opens > closes) {
            const stack = [];
            for (const ch of s) {
                if (ch === '{') stack.push('}');
                else if (ch === '[') stack.push(']');
                else if (ch === '}' || ch === ']') stack.pop();
            }
            s += stack.reverse().join('');
        }
        return s;
    }

    function stripLBChangesBlock(text) {
        return text
            .replace(/```lorebook-changes[\s\S]*?```/g, '')
            .replace(/```lorebook-changes[\s\S]*/g, '')
            .trim();
    }

    async function bindNewLorebookToCharacter(bookName) {
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
                toastr.success(`Lorebook "${escHtml(bookName)}" created successfully.`, EXT_DISPLAY);
            }

            delete _wiCache[bookName];

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

    async function resolveLBChangeTarget(change, strictBook = false) {
        let bookName = change.worldName || '';
        let targetUid = change.uid;

        const fuzzyWorld = bookName.toLowerCase();
        const fuzzyName = (change.originalName || change.name || '').toLowerCase();
        
        if (fuzzyName && !strictBook) {
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

    function addHistoryToSwipe(msgId, newLines) {
        if (!msgId) return false;
        const session = getCurrentSession();
        const msg = session.messages.find(m => m.id === msgId);
        if (!msg) return false;
        if (!msg.swipes) msg.swipes = [{ content: msg.content, reasoning: msg.reasoning }];
        const currentSwipe = msg.swipes[msg.swipeIndex || 0];
        if (!currentSwipe.historyLines) currentSwipe.historyLines = [];
        currentSwipe.historyLines.push(...newLines);
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
                
                renderLBHistoryContent(dummyMsg, contentEl);
                histWrap.innerHTML = '';
                histWrap.appendChild(contentEl);

                const swipeBar = body.querySelector('.scp-swipe-bar');
                if (swipeBar) body.insertBefore(histWrap, swipeBar);
                else body.appendChild(histWrap);
            }
        }
        return true;
    }

    function logLBHistoryChanges(changes, statusStr, afterMsgId = null) {
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

    async function applyLBChanges(changes, afterMsgId = null) {
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
                const addTriggers = Array.isArray(change.triggers) ? change.triggers : [];
                const autoConstant = (addTriggers.length === 0) && change.constant !== false;
                data.entries[newUid] = {
                    uid: newUid, key: addTriggers, keysecondary:[],
                    content: change.content || '', comment: change.name || '',
                    disable: false, group: '', selective: false,
                    constant: change.constant === true || autoConstant,
                    position: 0, depth: 4, displayIndex: newUid,
                    prevent_recursion: false, delayUntilRecursion: false,
                    scan_depth: null, match_whole_words: null, use_group_scoring: false,
                    case_sensitive: null, automation_id: '', role: null,
                    vectorized: false, sticky: null, cooldown: null, delay: null,
                };
                console.log(`[${EXT_DISPLAY}] applyLBChanges: ADD uid=${newUid} in "${bookName}" constant=${data.entries[newUid].constant}`);
                bookCache[bookName] = data;
                _wiCache[bookName] = data;
                successfulChanges.push(change);
            } else if (change.action === 'edit') {
                if (!origEntry) {
                    const msg = `Entry not found for edit: "${change.name || change.uid || '?'}" in "${bookName}"`;
                    toastr.error(`[LB] ${msg}`, EXT_DISPLAY, { timeOut: 10000 });
                    console.error(`[${EXT_DISPLAY}] applyLBChanges: ${msg}. Available:`, Object.values(data.entries || {}).map(e => ({ uid: e.uid, comment: e.comment })));
                    continue;
                }
                if (change.name !== undefined) origEntry.comment = change.name;
                if (change.triggers !== null && change.triggers !== undefined) {
                    origEntry.key = change.triggers;
                    if (change.triggers.length === 0 && origEntry.key.length === 0 && change.constant !== false) {
                        origEntry.constant = true;
                    }
                }
                if (change.content !== undefined) origEntry.content = change.content;
                if (change.constant !== undefined) origEntry.constant = !!change.constant;
                console.log(`[${EXT_DISPLAY}] applyLBChanges: EDIT uid=${origEntry.uid} in "${bookName}"`);
                bookCache[bookName] = data;
                _wiCache[bookName] = data;
                successfulChanges.push(change);
            } else if (change.action === 'patch') {
                if (!origEntry) {
                    const msg = `Entry not found for patch: "${change.name || change.uid || '?'}" in "${bookName}"`;
                    toastr.error(`[LB] ${msg}`, EXT_DISPLAY, { timeOut: 10000 });
                    _dbgAdd('LB_PATCH_ERROR_NOT_FOUND', { bookName, change });
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
                console.log(`[${EXT_DISPLAY}] applyLBChanges: PATCH uid=${origEntry.uid} in "${bookName}"`);
                bookCache[bookName] = data;
                _wiCache[bookName] = data;
                successfulChanges.push(change);
            } else if (change.action === 'prepend' || change.action === 'append') {
                if (!origEntry) {
                    toastr.error(`[LB] Entry not found for ${change.action}: "${change.name || change.uid || '?'}" in "${bookName}"`, EXT_DISPLAY, { timeOut: 10000 });
                    continue;
                }
                let current = origEntry.content || '';
                origEntry.content = change.action === 'prepend' ? (change.content || '') + current : current + (change.content || '');
                
                if (change.name !== undefined) origEntry.comment = change.name;
                if (change.triggers !== null && change.triggers !== undefined) {
                    origEntry.key = change.triggers;
                    if (change.triggers.length === 0 && change.constant !== false) origEntry.constant = true;
                }
                if (change.constant !== undefined) origEntry.constant = !!change.constant;
                console.log(`[${EXT_DISPLAY}] applyLBChanges: ${change.action.toUpperCase()} uid=${origEntry.uid} in "${bookName}"`);
                bookCache[bookName] = data;
                _wiCache[bookName] = data;
                successfulChanges.push(change);
            } else if (change.action === 'delete') {
                if (!origEntry) {
                    toastr.warning(`[LB] Entry not found for delete: "${change.name || change.uid || '?'}" in "${bookName}"`, EXT_DISPLAY, { timeOut: 8000 });
                    continue;
                }
                delete data.entries[origEntry.uid];
                console.log(`[${EXT_DISPLAY}] applyLBChanges: DELETE uid=${origEntry.uid} in "${bookName}"`);
                bookCache[bookName] = data;
                _wiCache[bookName] = data;
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

    function openTextDiffModal(title, originalText, newText) {
        _dbgAdd('LB_DIFF_MODAL_TOGGLE', { title });

        const modal = document.getElementById('scp-diff-modal');
        if (!modal) return;
        
        const diffLines = computeLineDiff(originalText, newText);
        const titleEl = modal.querySelector('.scp-diff-modal-title');
        if (titleEl) titleEl.textContent = title;

        const body = document.getElementById('scp-diff-body');
        if (body) body.innerHTML = renderDiffSplit(originalText, newText);

        modal.querySelectorAll('[data-diff-tab]').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.diffTab === 'split');
            tab.onclick = () => {
                modal.querySelectorAll('[data-diff-tab]').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                if (body) {
                    body.innerHTML = tab.dataset.diffTab === 'split' 
                        ? renderDiffSplit(originalText, newText) 
                        : renderDiffUnified(diffLines);
                }
            };
        });
        modal.style.display = 'flex';
    }

    function openDiffModal(change, originalEntry) {
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

    function renderLBHistoryContent(msg, contentEl) {
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

    function appendLBHistoryEl(msg, afterMsgId = null) {
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

    // ─── Chat Message Editing Engine ─────────────────────────────────────────────

    function parseChatChangesFromText(text) {
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

    function _sanitizeChatChanges(changes) {
        if (!Array.isArray(changes)) return null;
        const valid = [];
        for (const c of changes) {
            if (!c || typeof c !== 'object') continue;
            if (!['replace', 'overwrite', 'prepend', 'append', 'bulk_replace', 'regex', 'delete', 'add', 'hide', 'unhide'].includes(c.action)) continue;

            // normalize msg_indices
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
    
    function stripChatChangesBlock(text) {
        return text.replace(/```chat-changes[\s\S]*?```/g, '').replace(/```chat-changes[\s\S]*/g, '').trim();
    }

    function reconstructChatChangesBlock(pendingChanges) {
        if (!pendingChanges.length) return '';
        return '```chat-changes\n{"changes": ' + JSON.stringify(pendingChanges, null, 2) + '}\n```';
    }

    function reconstructLBChangesBlock(pendingChanges) {
        if (!pendingChanges.length) return '';
        return '```lorebook-changes\n{"changes": ' + JSON.stringify(pendingChanges, null, 2) + '}\n```';
    }

    function _resolveStMsgByIndexOrId(change) {
        const ctx = SillyTavern.getContext();
        const msgs = ctx.chat || [];
        if (typeof change.msg_index === 'number') {
            if (change.msg_index >= 0 && change.msg_index < msgs.length) {
                return { idx: change.msg_index, msg: msgs[change.msg_index] };
            }
        }
        return null;
    }

    async function applyChatChanges(changes, afterMsgId = null) {
        const ctx = SillyTavern.getContext();
        const msgs = ctx.chat;
        if (!msgs) { toastr.error('[ChatEdit] No active chat.', EXT_DISPLAY); return; }
        const successLog = [];

        for (const change of changes) {
            try {
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

                // msg_indices: apply same operation to each specified index
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
            _refreshSTChatDOM(ctx);
            logChatEditHistory(successLog, 'Applied', afterMsgId);
            toastr.success(`[ChatEdit] ${successLog.length} change(s) applied.`, EXT_DISPLAY);
        }
    }

    async function _saveChatMessage(ctx, idx, msg) {
        try {
            if (typeof ctx.saveChat === 'function') await ctx.saveChat();
            else if (typeof window.saveChat === 'function') await window.saveChat();
            const es = ctx.eventSource || window.eventSource;
            const et = ctx.event_types || window.event_types;
            if (es && et?.MESSAGE_UPDATED) es.emit(et.MESSAGE_UPDATED, { detail: { index: idx, message: msg } });
        } catch(e) { console.warn('[ChatEdit] Save error:', e); }
    }

    async function _saveChatAfterDelete(ctx) {
        try {
            if (typeof ctx.saveChat === 'function') await ctx.saveChat();
            else if (typeof window.saveChat === 'function') await window.saveChat();
        } catch(e) {}
    }

    function _refreshSTChatDOM(ctx) {
        try {
            const es = ctx.eventSource || window.eventSource;
            const et = ctx.event_types || window.event_types;
            if (es && et?.CHAT_CHANGED) es.emit(et.CHAT_CHANGED);
            if (typeof window.printMessages === 'function') window.printMessages();
            else if (typeof ctx.printMessages === 'function') ctx.printMessages();
        } catch(_) {}
    }

    function logChatEditHistory(changes, statusStr, afterMsgId = null) {
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
            
            if (afterMsgId && addHistoryToSwipe(afterMsgId, newLines)) return;

            const histText = `**System Notification** — Chat message edits:\n${newLines.join('\n')}`;
            const msg = addMessage(session, 'system', histText, { isChatEditHistory: true, isLBHistory: true, appliedLines: [...newLines] });
            appendLBHistoryEl(msg);
        } catch(_) {}
    }
    
    function renderChatProposalCard(changes, msgEl) {
        if (!changes?.length) return;
        document.querySelector(`.scp-chat-proposal-card[data-for="${msgEl.dataset.id}"]`)?.remove();

        const ctx = SillyTavern.getContext();
        const stMsgs = ctx.chat || [];
        const editableChanges = changes.map(c => JSON.parse(JSON.stringify(c)));
        const itemStates = editableChanges.map(() => 'pending');

        const ACTION_LABELS = { 
            add: '<i class="fa-solid fa-square-plus" style="margin-right: 4px;"></i> Add', 
            replace: '<i class="fa-solid fa-pen-to-square" style="margin-right: 4px;"></i> Replace', 
            overwrite: '<i class="fa-solid fa-rotate" style="margin-right: 4px;"></i> Overwrite', 
            prepend: '<i class="fa-solid fa-arrow-up" style="margin-right: 4px;"></i> Prepend', 
            append: '<i class="fa-solid fa-arrow-down" style="margin-right: 4px;"></i> Append', 
            bulk_replace: '<i class="fa-solid fa-list-check" style="margin-right: 4px;"></i> Bulk', 
            regex: '<i class="fa-solid fa-terminal" style="margin-right: 4px;"></i> Regex', 
            delete: '<i class="fa-solid fa-trash" style="margin-right: 4px;"></i> Delete', 
            hide: '<i class="fa-solid fa-eye-slash" style="margin-right: 4px;"></i> Hide', 
            unhide: '<i class="fa-solid fa-eye" style="margin-right: 4px;"></i> Unhide' 
        };
        
        const card = document.createElement('div');
        card.className = 'scp-lb-proposal-card scp-chat-proposal-card';
        card.dataset.for = msgEl.dataset.id;
        card.style.margin = '8px 0 0 0';

        const stripAndSave = () => {
            const session = getCurrentSession();
            const msg = session.messages.find(m => m.id === card.dataset.for);
            if (msg) { 
                msg.content = stripChatChangesBlock(msg.content); 
                if (msg.swipes) msg.swipes[msg.swipeIndex || 0].content = msg.content;
                saveSessionsToMetadata(); 
            }
        };

        const persistState = () => {};
        const getPending = () => itemStates.filter(s => s === 'pending').length;
        const checkAllResolved = () => { 
            if (getPending() === 0) { 
                stripAndSave(); 
                card.remove(); 
                const msg = getCurrentSession().messages.find(m => m.id === msgEl.dataset.id);
                if (msg) _renderMsgBodyContent(msgEl, msg);
            } 
        };

        const validateChatChange = (change) => {
            const stMsgs = SillyTavern.getContext().chat || [];
            if (change.action === 'add') {
                if (!['user', 'assistant', 'system'].includes(change.role)) return { valid: false, reason: 'Invalid role' };
                if (change.msg_index < 0 || change.msg_index > stMsgs.length + 1) return { valid: false, reason: 'Index out of bounds' };
                return { valid: true };
            }
            let startIdx, endIdx;
            if (['bulk_replace', 'regex', 'hide', 'unhide'].includes(change.action)) {
                if (Array.isArray(change.msg_indices) && change.msg_indices.length) {
                    const invalid = change.msg_indices.filter(i => i < 0 || i >= stMsgs.length);
                    if (invalid.length) return { valid: false, reason: `Indices out of bounds: ${invalid.join(', ')}` };
                    if (change.action === 'hide' || change.action === 'unhide') return { valid: true };
                    if (change.action === 'bulk_replace') {
                        let anyMatch = false;
                        for (const i of change.msg_indices) {
                            let content = stMsgs[i].mes || '', thisMsgMatch = true;
                            for (const rp of (change.replacements || [])) {
                                if (!rp.search && !rp.anchor) continue;
                                const { matched } = applySearchReplaceToField(content, rp.search || rp.anchor, rp.replace || '');
                                if (!matched) { thisMsgMatch = false; break; }
                            }
                            if (thisMsgMatch && change.replacements?.length > 0) anyMatch = true;
                        }
                        if (!anyMatch) return { valid: false, reason: 'Anchors not found in the specified messages' };
                    } else if (change.action === 'regex') {
                        try {
                            const m = (change.regex || '').match(/^\/([\s\S]+)\/([a-z]*)$/i);
                            const re = m ? new RegExp(m[1], m[2]) : new RegExp(change.regex, 'g');
                            const anyMatch = change.msg_indices.some(i => re.test(stMsgs[i].mes || ''));
                            if (!anyMatch) return { valid: false, reason: 'Regex matched nothing in the specified messages' };
                        } catch(e) { return { valid: false, reason: 'Invalid regex syntax' }; }
                    }
                    return { valid: true };
                }
                if (Array.isArray(change.msg_range)) {
                    startIdx = change.msg_range[0]; endIdx = change.msg_range[1];
                } else if (change.msg_index !== undefined) {
                    startIdx = change.msg_index; endIdx = change.msg_index;
                } else return { valid: false, reason: 'Target index or range not specified' };
                
                if (startIdx < 0 || endIdx >= stMsgs.length || startIdx > endIdx) return { valid: false, reason: `Range [${startIdx}-${endIdx}] is out of bounds` };

                if (change.action === 'hide' || change.action === 'unhide') return { valid: true };
                
                let anyMatch = false;
                if (change.action === 'bulk_replace') {
                    for (let i = startIdx; i <= endIdx; i++) {
                        let content = stMsgs[i].mes || '';
                        let thisMsgMatch = true;
                        for (const rp of (change.replacements || [])) {
                            if (!rp.search && !rp.anchor) continue;
                            const { matched } = applySearchReplaceToField(content, rp.search || rp.anchor, rp.replace || '');
                            if (!matched) { thisMsgMatch = false; break; }
                        }
                        if (thisMsgMatch && change.replacements?.length > 0) anyMatch = true;
                    }
                    if (!anyMatch) return { valid: false, reason: 'Anchors not found in the specified range' };
                } else if (change.action === 'regex') {
                    try {
                        const m = (change.regex || '').match(/^\/([\s\S]+)\/([a-z]*)$/i);
                        const re = m ? new RegExp(m[1], m[2]) : new RegExp(change.regex, 'g');
                        for (let i = startIdx; i <= endIdx; i++) {
                            if (re.test(stMsgs[i].mes || '')) { anyMatch = true; break; }
                        }
                        if (!anyMatch) return { valid: false, reason: 'Regex matched nothing in the specified range' };
                    } catch(e) { return { valid: false, reason: 'Invalid regex syntax' }; }
                }
                return { valid: true };
            } else {
                if (Array.isArray(change.msg_indices) && change.msg_indices.length) {
                    const invalid = change.msg_indices.filter(i => i < 0 || i >= stMsgs.length);
                    if (invalid.length) return { valid: false, reason: `Indices out of bounds: ${invalid.join(', ')}` };
                    if (change.action === 'replace') {
                        for (const idx of change.msg_indices) {
                            let content = stMsgs[idx].mes || '';
                            for (const patch of (change.patches || [])) {
                                const { matched } = applySearchReplaceToField(content, patch.search || patch.anchor || '', patch.replace || '');
                                if (!matched) return { valid: false, reason: `ANCHOR not found in #${idx}: "${(patch.search || patch.anchor || '').slice(0, 40)}..."` };
                            }
                        }
                    }
                    return { valid: true };
                }
                const resolved = _resolveStMsgByIndexOrId(change);
                if (!resolved) return { valid: false, reason: `Message not found (Index: ${change.msg_index ?? change.msg_id})` };

                if (change.action === 'replace') {
                    let content = resolved.msg.mes || '';
                    for (const patch of (change.patches || [])) {
                        const { matched } = applySearchReplaceToField(content, patch.search || patch.anchor || '', patch.replace || '');
                        if (!matched) return { valid: false, reason: `ANCHOR not found: "${(patch.search || patch.anchor || '').slice(0, 40)}..."` };
                    }
                }
                return { valid: true };
            }
        };

        const getChatChangeResult = (change, content) => {
            if (change.action === 'overwrite') return change.content || '';
            if (change.action === 'replace') {
                let c = content;
                for (const p of (change.patches || [])) {
                    const { result } = applySearchReplaceToField(c, p.search || p.anchor || '', p.replace || '');
                    c = result;
                }
                return c;
            }
            if (change.action === 'bulk_replace') {
                let c = content;
                for (const p of (change.replacements || [])) {
                    const { result } = applySearchReplaceToField(c, p.search || p.anchor || '', p.replace || '');
                    c = result;
                }
                return c;
            }
            if (change.action === 'regex') {
                let c = content;
                try {
                    const m = (change.regex || '').match(/^\/([\s\S]+)\/([a-z]*)$/i);
                    const re = m ? new RegExp(m[1], m[2]) : new RegExp(change.regex, 'g');
                    c = c.replace(re, change.replace || '');
                } catch(e) {}
                return c;
            }
            return content;
        };

        const header = document.createElement('div');
        header.className = 'scp-lb-proposal-header';
        const headerLeft = document.createElement('div');
        headerLeft.style.cssText = 'display:flex;align-items:center;gap:8px;flex:1;min-width:0';
        const countBadge = document.createElement('span');
        countBadge.className = 'scp-lb-proposal-count';
        countBadge.textContent = `${editableChanges.length} pending`;
        headerLeft.innerHTML = `<span class="scp-lb-proposal-icon" style="color:var(--scp-accent);display:flex">${I.chatEdit}</span><span class="scp-lb-proposal-title">Proposed Chat Edits</span>`;
        headerLeft.appendChild(countBadge);
        const dismissBtn = document.createElement('button');
        dismissBtn.className = 'scp-lb-proposal-dismiss'; dismissBtn.innerHTML = I.x; dismissBtn.title = 'Dismiss all';
        dismissBtn.addEventListener('click', () => {
            const pending = editableChanges.filter((_, i) => itemStates[i] === 'pending');
            if (pending.length > 0) logChatEditHistory(pending, 'Dismissed', card.dataset.for);
            itemStates.forEach((s, i) => { if (s === 'pending') itemStates[i] = 'dismissed'; });
            stripAndSave(); card.remove();
        });
        header.appendChild(headerLeft); header.appendChild(dismissBtn);

        const list = document.createElement('div');
        list.className = 'scp-lb-proposal-list';

        const itemEls = editableChanges.map((c, ci) => {
            const item = document.createElement('div');
            const actionCls = c.action === 'delete' ? 'scp-lb-proposal-delete' : (c.action === 'overwrite' || c.action === 'bulk_replace' || c.action === 'regex' ? 'scp-lb-proposal-edit' : 'scp-lb-proposal-add');
            item.className = `scp-lb-proposal-item ${actionCls}`;

            const hdr = document.createElement('div');
            hdr.className = 'scp-lb-proposal-item-header';

            const meta = document.createElement('div');
            meta.style.cssText = 'display:flex;align-items:center;gap:8px;flex:1;flex-wrap:wrap;min-width:0';
            
            const targetDescEl = document.createElement('span');
            targetDescEl.className = 'scp-lb-proposal-name scp-lb-pn-target';
            
            const updateTargetDesc = () => {
                const change = editableChanges[ci];
                let targetDesc = '';
                if (change.action === 'add') {
                    targetDesc = `Insert at #${change.msg_index} (${change.role})`;
                } else if (Array.isArray(change.msg_indices) && change.msg_indices.length) {
                    targetDesc = `msgs [${change.msg_indices.join(', ')}]`;
                } else if (['bulk_replace', 'regex', 'hide', 'unhide'].includes(change.action)) {
                    if (change.msg_range) targetDesc = `msgs [${change.msg_range[0]}–${change.msg_range[1]}]`;
                    else targetDesc = `msg #${change.msg_index}`;
                } else {
                    const resolved = _resolveStMsgByIndexOrId(change);
                    targetDesc = resolved ? `#${resolved.idx} ${stMsgs[resolved.idx]?.is_user ? '(user)' : '(assistant)'}` : `Index ${change.msg_index ?? change.msg_id}`;
                }
                targetDescEl.textContent = targetDesc;
            };
            updateTargetDesc();

            const actionBadge = document.createElement('span');
            actionBadge.className = 'scp-lb-proposal-action';
            actionBadge.innerHTML = ACTION_LABELS[c.action] || c.action;
            
            meta.appendChild(actionBadge);
            meta.appendChild(targetDescEl);
            
            const warnEl = document.createElement('div');
            warnEl.style.cssText = 'font-size:10px;color:var(--scp-danger);margin-top:4px;width:100%;display:none;cursor:pointer;';
            warnEl.title = 'Click to open the edit panel and fix manually';
            meta.appendChild(warnEl);

            const btns = document.createElement('div');
            btns.className = 'scp-lb-proposal-item-btns';

            if (['replace', 'overwrite', 'bulk_replace', 'regex'].includes(c.action)) {
                const diffBtn = document.createElement('button');
                diffBtn.className = 'scp-lb-proposal-diff-btn'; diffBtn.title = 'View diff'; diffBtn.innerHTML = I.diff;
                diffBtn.addEventListener('click', e => {
                    e.stopPropagation();
                    const ctx = SillyTavern.getContext();
                    const stMsgs = ctx.chat || [];
                    const change = editableChanges[ci];
                    let targetIdxList = [];
                    if (Array.isArray(change.msg_indices) && change.msg_indices.length) {
                        targetIdxList = change.msg_indices.filter(i => stMsgs[i]);
                    } else {
                        let startIdx = change.msg_index !== undefined ? change.msg_index : (change.msg_range ? change.msg_range[0] : null);
                        let endIdx = change.msg_index !== undefined ? change.msg_index : (change.msg_range ? change.msg_range[1] : null);
                        if (startIdx === null || endIdx === null) { toastr.warning('Message index not specified.', EXT_DISPLAY); return; }
                        for (let i = Math.max(0, startIdx); i <= Math.min(stMsgs.length - 1, endIdx); i++) { if (stMsgs[i]) targetIdxList.push(i); }
                    }

                    if (!targetIdxList.length) { toastr.warning(`Message(s) not found — chat may have changed since this proposal was generated.`, EXT_DISPLAY, { timeOut: 7000 }); return; }
                    
                    let origCombined = [];
                    let newCombined = [];
                    let changesFound = 0;
                    
                    for (const i of targetIdxList) {
                        const origText = stMsgs[i].mes || '';
                        const newText = getChatChangeResult(change, origText);
                        
                        if (origText !== newText || targetIdxList.length === 1) {
                            const prefix = targetIdxList.length > 1 ? `[Message #${i}]\n` : '';
                            origCombined.push(prefix + origText);
                            newCombined.push(prefix + newText);
                            changesFound++;
                        }
                    }

                    if (changesFound === 0) {
                        toastr.info('No changes would be made to these messages.', EXT_DISPLAY);
                        return;
                    }

                    const finalOrig = origCombined.join('\n\n' + '—'.repeat(30) + '\n\n');
                    const finalNew = newCombined.join('\n\n' + '—'.repeat(30) + '\n\n');
                    const title = targetIdxList.length === 1
                        ? `Diff: ${stMsgs[targetIdxList[0]]?.is_user ? 'User' : 'Copilot/Char'} Message #${targetIdxList[0]}`
                        : `Diff: Messages [${targetIdxList.join(', ')}]`;

                    openTextDiffModal(title, finalOrig, finalNew);
                });
                btns.appendChild(diffBtn);
            }

            let editToggleBtn = null;
            let editPanel = null;
            if (c.action !== 'delete') {
                editToggleBtn = document.createElement('button');
                editToggleBtn.className = 'scp-lb-proposal-edit-toggle'; editToggleBtn.title = 'Edit before applying'; editToggleBtn.textContent = '✎';
                btns.appendChild(editToggleBtn);
            }

            const applyBtn = document.createElement('button');
            applyBtn.className = 'scp-lb-proposal-item-apply'; applyBtn.title = 'Apply'; applyBtn.textContent = '✓';
            
            const refreshValidation = () => {
                const { valid, reason } = validateChatChange(editableChanges[ci]);
                if (!valid) {
                    applyBtn.disabled = true; applyBtn.title = reason;
                    item.style.borderLeftColor = 'var(--scp-danger)';
                    warnEl.textContent = `⚠ ${reason}`; warnEl.style.display = 'block';
                } else {
                    applyBtn.disabled = false; applyBtn.title = 'Apply';
                    item.style.borderLeftColor = ''; 
                    warnEl.style.display = 'none';
                }
            };

            applyBtn.addEventListener('click', async e => {
                e.stopPropagation();
                if (itemStates[ci] !== 'pending' || applyBtn.disabled) return;
                applyBtn.disabled = true; applyBtn.textContent = '…';
                try {
                    await applyChatChanges([editableChanges[ci]], card.dataset.for);
                    itemStates[ci] = 'applied';
                    item.classList.add('scp-lb-item-applied');
                    btns.querySelectorAll('button').forEach(b => { b.disabled = true; });
                    persistState(); countBadge.textContent = `${getPending()} pending`; updateFooterBtns(); syncBlockToMessage(); checkAllResolved();
                } catch(err) {
                    toastr.error(`Failed: ${err.message}`, EXT_DISPLAY);
                    applyBtn.disabled = false; applyBtn.textContent = '✓';
                }
            });

            const rejectBtn = document.createElement('button');
            rejectBtn.className = 'scp-lb-proposal-item-reject'; rejectBtn.title = 'Reject'; rejectBtn.textContent = '✕';
            rejectBtn.addEventListener('click', e => {
                e.stopPropagation();
                if (itemStates[ci] !== 'pending') return;
                itemStates[ci] = 'rejected';
                item.classList.add('scp-lb-item-rejected');
                btns.querySelectorAll('button').forEach(b => { b.disabled = true; });
                logChatEditHistory([editableChanges[ci]], 'Rejected', card.dataset.for);
                persistState(); countBadge.textContent = `${getPending()} pending`; updateFooterBtns(); syncBlockToMessage(); checkAllResolved();
            });
            btns.appendChild(applyBtn); btns.appendChild(rejectBtn);
            hdr.appendChild(meta); hdr.appendChild(btns);
            item.appendChild(hdr);

            const buildPreview = () => {
                const change = editableChanges[ci];
                if (change.action === 'hide') return 'Exclude message(s) from AI prompt context.';
                if (change.action === 'unhide') return 'Include message(s) back into AI context.';
                if (change.action === 'replace' && change.patches?.length) {
                    const target = Array.isArray(change.msg_indices) && change.msg_indices.length
                        ? ` (msgs ${change.msg_indices.join(', ')})` : '';
                    return change.patches.map((p, pi) => `Patch ${pi+1}${target}: "${(p.search||p.anchor||'').slice(0,60)}" → "${(p.replace||'').slice(0,60)}"`).join('\n');
                }
                if (change.action === 'bulk_replace' && change.replacements?.length) {
                    return change.replacements.map(r => `"${(r.search||r.anchor||'').slice(0,40)}" → "${(r.replace||'').slice(0,40)}"`).join('\n');
                }
                if (change.action === 'regex') {
                    return `Regex: ${change.regex}\nReplace: ${change.replace || ''}`;
                }
                return change.content || '';
            };
            let _expanded = false;
            const previewEl = document.createElement('div');
            previewEl.className = 'scp-lb-proposal-preview';
            previewEl.style.whiteSpace = 'pre-wrap';
            const refreshPreview = () => {
                const raw = buildPreview();
                previewEl.textContent = (!_expanded && raw.length > 140) ? raw.slice(0, 140) + '…' : raw;
            };
            refreshPreview();
            previewEl.style.cursor = 'pointer';
            previewEl.addEventListener('click', e => { e.stopPropagation(); _expanded = !_expanded; refreshPreview(); });
            item.appendChild(previewEl);

            if (c.action !== 'delete') {
                editPanel = document.createElement('div');
                editPanel.className = 'scp-lb-proposal-edit-panel';
                editPanel.style.display = 'none';

                const mkRow = (labelHtml, el) => {
                    const row = document.createElement('div'); row.className = 'scp-lb-pe-row';
                    const lbl = document.createElement('label'); lbl.className = 'scp-lb-pe-label'; lbl.innerHTML = labelHtml;
                    row.appendChild(lbl); row.appendChild(el); return row;
                };

                const rebuildEditPanel = () => {
                    editPanel.innerHTML = '';
                    const change = editableChanges[ci];
                    
                    if (Array.isArray(change.msg_indices) && change.msg_indices.length) {
                        const idxInp = document.createElement('input');
                        idxInp.type = 'text'; idxInp.className = 'scp-lb-pe-input';
                        idxInp.value = change.msg_indices.join(', ');
                        idxInp.placeholder = 'e.g. 12, 17, 19';
                        idxInp.addEventListener('input', () => {
                            change.msg_indices = idxInp.value.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
                            refreshPreview(); refreshValidation(); updateTargetDesc();
                        });
                        editPanel.appendChild(mkRow('Message Indices (comma-separated)', idxInp));
                    } else if (change.msg_range) {
                        const rangeRow = document.createElement('div');
                        rangeRow.style.cssText = 'display:flex;gap:8px;';
                        const sInp = document.createElement('input'); sInp.type='number'; sInp.className='scp-lb-pe-input'; sInp.value=change.msg_range[0];
                        const eInp = document.createElement('input'); eInp.type='number'; eInp.className='scp-lb-pe-input'; eInp.value=change.msg_range[1];
                        sInp.addEventListener('input', () => { change.msg_range[0] = parseInt(sInp.value)||0; refreshPreview(); refreshValidation(); updateTargetDesc(); });
                        eInp.addEventListener('input', () => { change.msg_range[1] = parseInt(eInp.value)||0; refreshPreview(); refreshValidation(); updateTargetDesc(); });
                        rangeRow.append(sInp, eInp);
                        editPanel.appendChild(mkRow('Msg Range (Start - End)', rangeRow));
                    } else if (change.msg_index !== undefined || change.msg_id !== undefined) {
                        const idxInp = document.createElement('input'); idxInp.type='number'; idxInp.className='scp-lb-pe-input'; idxInp.value=change.msg_index ?? change.msg_id;
                        idxInp.addEventListener('input', () => { change.msg_index = parseInt(idxInp.value)||0; refreshPreview(); refreshValidation(); updateTargetDesc(); });
                        editPanel.appendChild(mkRow('Message Index', idxInp));
                    }

                    if (['hide', 'unhide'].includes(change.action)) {
                        return;
                    }
                    if (change.action === 'add') {
                        const roleSel = document.createElement('select');
                        roleSel.className = 'scp-lb-pe-input';
                        ['user', 'assistant', 'system'].forEach(r => {
                            const opt = document.createElement('option'); opt.value = r; opt.textContent = r;
                            roleSel.appendChild(opt);
                        });
                        roleSel.value = change.role || 'assistant';
                        roleSel.addEventListener('change', () => { change.role = roleSel.value; refreshValidation(); updateTargetDesc(); });
                        editPanel.appendChild(mkRow('Role', roleSel));

                        const valueTa = document.createElement('textarea');
                        valueTa.className = 'scp-lb-pe-textarea'; 
                        valueTa.rows = 4; 
                        valueTa.placeholder = 'Type the message content here...';
                        valueTa.value = change.content || '';
                        valueTa.addEventListener('input', () => { 
                            change.content = valueTa.value; 
                            refreshPreview(); 
                            refreshValidation(); 
                        });
                        editPanel.appendChild(mkRow('Content', valueTa));
                    } else if (change.action === 'replace') {
                        (change.patches || []).forEach((patch, pi) => {
                            const pHdr = document.createElement('div');
                            pHdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:4px';
                            pHdr.innerHTML = `<span style="font-size:10px;font-weight:700;color:var(--scp-accent);text-transform:uppercase;letter-spacing:.04em">Patch ${pi+1}</span>`;
                            if (change.patches.length > 1) {
                                const delP = document.createElement('button');
                                delP.style.cssText = 'background:none;border:none;color:var(--scp-danger);cursor:pointer;font-size:11px;padding:0;font-family:var(--scp-font)';
                                delP.textContent = '✕ Remove';
                                delP.addEventListener('click', () => { change.patches.splice(pi, 1); rebuildEditPanel(); refreshPreview(); refreshValidation(); });
                                pHdr.appendChild(delP);
                            }
                            editPanel.appendChild(pHdr);
                            const searchTa = document.createElement('textarea');
                            searchTa.className = 'scp-lb-pe-textarea'; searchTa.rows = 2; searchTa.value = patch.search || patch.anchor || '';
                            searchTa.addEventListener('input', () => { change.patches[pi].search = searchTa.value; refreshPreview(); refreshValidation(); });
                            const replaceTa = document.createElement('textarea');
                            replaceTa.className = 'scp-lb-pe-textarea'; replaceTa.rows = 3; replaceTa.value = patch.replace || '';
                            replaceTa.addEventListener('input', () => { change.patches[pi].replace = replaceTa.value; refreshPreview(); refreshValidation(); });
                            editPanel.appendChild(mkRow('Anchor', searchTa));
                            editPanel.appendChild(mkRow('Replace', replaceTa));
                        });
                        const addPatchBtn = document.createElement('button');
                        addPatchBtn.className = 'scp-action-btn'; addPatchBtn.style.marginTop = '8px';
                        addPatchBtn.innerHTML = `${I.plus}<span>Add Patch</span>`;
                        addPatchBtn.addEventListener('click', () => { change.patches.push({ search: '', replace: '' }); rebuildEditPanel(); });
                        editPanel.appendChild(addPatchBtn);
                    } else if (change.action === 'bulk_replace') {
                        (change.replacements || []).forEach((rp, ri) => {
                            const searchTa = document.createElement('textarea');
                            searchTa.className = 'scp-lb-pe-textarea'; searchTa.rows = 1; searchTa.value = rp.search || rp.anchor || '';
                            searchTa.addEventListener('input', () => { change.replacements[ri].search = searchTa.value; refreshPreview(); refreshValidation(); });
                            const replaceTa = document.createElement('textarea');
                            replaceTa.className = 'scp-lb-pe-textarea'; replaceTa.rows = 1; replaceTa.value = rp.replace || '';
                            replaceTa.addEventListener('input', () => { change.replacements[ri].replace = replaceTa.value; refreshPreview(); refreshValidation(); });
                            editPanel.appendChild(mkRow(`Replace pair ${ri+1} — Anchor`, searchTa));
                            editPanel.appendChild(mkRow('Replace', replaceTa));
                        });
                    } else if (change.action === 'regex') {
                        const regTa = document.createElement('textarea');
                        regTa.className = 'scp-lb-pe-textarea'; regTa.rows = 1; regTa.value = change.regex || '';
                        regTa.addEventListener('input', () => { change.regex = regTa.value; refreshPreview(); refreshValidation(); });
                        editPanel.appendChild(mkRow('Regex Pattern', regTa));
                        
                        const replTa = document.createElement('textarea');
                        replTa.className = 'scp-lb-pe-textarea'; replTa.rows = 2; replTa.value = change.replace || '';
                        replTa.addEventListener('input', () => { change.replace = replTa.value; refreshPreview(); refreshValidation(); });
                        editPanel.appendChild(mkRow('Replace', replTa));
                    } else {
                        const valueTa = document.createElement('textarea');
                        valueTa.className = 'scp-lb-pe-textarea'; valueTa.rows = 5; valueTa.value = change.content || '';
                        valueTa.addEventListener('input', () => { change.content = valueTa.value; refreshPreview(); refreshValidation(); });
                        editPanel.appendChild(mkRow('Content', valueTa));
                    }
                };
                rebuildEditPanel();
                item.appendChild(editPanel);

                if (editToggleBtn) {
                    const toggleEditPanel = (e) => {
                        e.stopPropagation();
                        const isOpen = editPanel.style.display !== 'none';
                        editPanel.style.display = isOpen ? 'none' : 'flex';
                        previewEl.style.display = isOpen ? '' : 'none';
                        editToggleBtn.classList.toggle('active', !isOpen);
                        if (!isOpen) rebuildEditPanel();
                    };
                    editToggleBtn.addEventListener('click', toggleEditPanel);
                    
                    warnEl.addEventListener('click', (e) => {
                        if (editPanel.style.display === 'none') toggleEditPanel(e);
                    });
                }
            }

            refreshValidation();

            list.appendChild(item);
            return item;
        });

        itemEls.forEach((el, i) => {
            if (itemStates[i] === 'applied') {
                el.classList.add('scp-lb-item-applied');
                el.querySelectorAll('button').forEach(b => { b.disabled = true; });
            } else if (itemStates[i] === 'rejected') {
                el.classList.add('scp-lb-item-rejected');
                el.querySelectorAll('button').forEach(b => { b.disabled = true; });
            }
        });

        const syncBlockToMessage = () => {
            const session = getCurrentSession();
            const msg = session.messages.find(m => m.id === card.dataset.for);
            if (!msg) return;
            const pending = editableChanges.filter((_, i) => itemStates[i] === 'pending');
            const stripped = stripChatChangesBlock(msg.content);
            if (pending.length === 0) {
                msg.content = stripped;
            } else {
                msg.content = stripped + '\n\n' + reconstructChatChangesBlock(pending);
            }
            if (msg.swipes) msg.swipes[msg.swipeIndex || 0].content = msg.content;
            saveSessionsToMetadata();
        };

        const footer = document.createElement('div');
        footer.className = 'scp-lb-proposal-footer';
        const applyAllBtn = document.createElement('button');
        applyAllBtn.className = 'scp-lb-proposal-apply'; applyAllBtn.textContent = 'Apply All';
        const rejectAllBtn = document.createElement('button');
        rejectAllBtn.className = 'scp-lb-proposal-reject'; rejectAllBtn.textContent = 'Reject All';

        const updateFooterBtns = () => {
            const p = getPending();
            applyAllBtn.style.display = p > 0 ? '' : 'none';
            rejectAllBtn.style.display = p > 0 ? '' : 'none';
        };
        updateFooterBtns();

        applyAllBtn.addEventListener('click', async () => {
            const pending = editableChanges.filter((_, i) => itemStates[i] === 'pending');
            if (!pending.length) return;
            applyAllBtn.disabled = true; applyAllBtn.textContent = 'Applying…';
            try {
                await applyChatChanges(pending, card.dataset.for);
                itemStates.forEach((s, i) => { if (s === 'pending') { itemStates[i] = 'applied'; itemEls[i]?.classList.add('scp-lb-item-applied'); itemEls[i]?.querySelectorAll('button').forEach(b => { b.disabled = true; }); } });
                persistState(); countBadge.textContent = `${getPending()} pending`; updateFooterBtns(); syncBlockToMessage(); checkAllResolved();
            } catch(e) { toastr.error(`Failed: ${e.message}`, EXT_DISPLAY); applyAllBtn.disabled = false; applyAllBtn.textContent = 'Apply All'; }
        });
        rejectAllBtn.addEventListener('click', () => {
            const pending = editableChanges.filter((_, i) => itemStates[i] === 'pending');
            itemStates.forEach((s, i) => { if (s === 'pending') { itemStates[i] = 'rejected'; itemEls[i]?.classList.add('scp-lb-item-rejected'); itemEls[i]?.querySelectorAll('button').forEach(b => { b.disabled = true; }); } });
            logChatEditHistory(pending, 'Rejected', card.dataset.for);
            persistState(); countBadge.textContent = `${getPending()} pending`; updateFooterBtns(); syncBlockToMessage(); checkAllResolved();
        });

        footer.appendChild(applyAllBtn); footer.appendChild(rejectAllBtn);
        card.appendChild(header); card.appendChild(list); card.appendChild(footer);
        const body = msgEl.querySelector('.scp-msg-body');
        if (body) body.insertBefore(card, body.querySelector('.scp-swipe-bar'));
        else msgEl.after(card);
    }

    // ─── Memory System ───────────────────────────────────────────────────────────

    function genMemoryId() { return 'mem_' + Date.now() + '_' + Math.random().toString(36).slice(2,6); }

    function getMemories() {
        const s = getSettings();
        if (!s.memories || typeof s.memories !== 'object') s.memories = {};
        return s.memories;
    }

    function getVisibleMemories() {
        const { charId, chatId } = getBindingKey();
        const sessionId = getCurrentSession()?.id;
        const all = Object.values(getMemories());
        
        return all.filter(m => {
            if (m.disabled) return false;
            if (m.scope === 'global') return true;
            if (m.scope === 'character') return m.charId === charId;
            if (m.scope === 'chat') return m.charId === charId && m.chatId === chatId;
            if (m.scope === 'session') return m.charId === charId && m.chatId === chatId && m.sessionId === sessionId;
            return m.charId === charId; // fallback
        });
    }

    function addMemory(key, value, scope = 'character') {
        const { charId, chatId } = getBindingKey();
        const ctx = SillyTavern.getContext();
        const charName = ctx.characters?.[charId]?.name || charId || 'Unknown Character';
        const chatName = chatId || 'Unknown Chat';
        const sessionObj = getCurrentSession();
        const sessionId = sessionObj?.id;
        const sessionName = sessionObj?.name || sessionId || 'Unknown Session';
        
        const id = genMemoryId();
        getMemories()[id] = {
            id, key: key.trim(), value: value.trim(),
            createdAt: Date.now(),
            scope: ['global', 'character', 'chat', 'session'].includes(scope) ? scope : 'character',
            charId, charName,
            chatId, chatName,
            sessionId, sessionName,
            disabled: false
        };
        saveSettings();
        updateMemoryDot();
        return id;
    }

    function updateMemory(id, key, value) {
        const mem = getMemories()[id];
        if (!mem) return;
        mem.key = key.trim();
        mem.value = value.trim();
        mem.updatedAt = Date.now();
        saveSettings();
    }

    function deleteMemory(id) {
        _dbgAdd('MEM_DELETE', { id });
        
        delete getMemories()[id];
        saveSettings();
        updateMemoryDot();
    }

    function clearAllMemories() {
        _dbgAdd('MEM_CLEAR_ALL');

        getSettings().memories = {};
        saveSettings();
        updateMemoryDot();
    }

    function updateMemoryDot() {
        const has = Object.keys(getMemories()).length > 0;
        document.getElementById('scp-sp-memory-dot')?.style.setProperty('display', has ? '' : 'none');
    }

    function buildMemoryContextBlock() {
        const s = getSettings();
        if (!s.memoryEnabled || !s.memoryInject) return '';
        const mems = getVisibleMemories();
        if (!mems.length) return '';
        
        const lines = mems.map(m => `[${m.scope.toUpperCase()}][${m.key}]: ${m.value}`).join('\n');
            
        return `\n\n<persistent_memory>\nThese are facts about the user that you should remember and reference when relevant:\n${lines}\n</persistent_memory>`;
    }
    function _ensureWrapped(text, tag) {
        if (!text || !text.trim()) return '';
        let t = text.trim();
        const open = `<${tag}>`;
        const close = `</${tag}>`;
        
        t = t.replace(new RegExp(`^<${tag}>\\s*`, 'i'), '');
        t = t.replace(new RegExp(`\\s*</${tag}>$`, 'i'), '');
        
        return `${open}\n${t}\n${close}`;
    }

    function buildMemoryAIInstructions() {
        const s = getSettings();
        if (!s.memoryEnabled) return '';
        const rawPrompt = s.memoryManagePrompt || DEFAULT_MEMORY_PROMPT;
        
        const mems = getVisibleMemories();
        let memsText = 'None';
        if (mems.length > 0) {
            const grouped = {};
            for (const m of mems) {
                if (!grouped[m.scope]) grouped[m.scope] = [];
                grouped[m.scope].push(`"${m.key}"`);
            }
            memsText = Object.entries(grouped)
                .map(([scope, keys]) => `- ${scope.toUpperCase()}: "${keys.join('", ')}`)
                .join('\n');
        }
        
        const finalPrompt = rawPrompt
            .replace('{{memory_format}}', MEMORY_FORMAT_BLOCK)
            .replace('{{current_memories}}', memsText);
            
        return '\n\n' + _ensureWrapped(finalPrompt, 'memory_system');
    }

    function parseMemoryBlockFromText(text) {
        const re = new RegExp('```memory-update\\s*([\\s\\S]*?)```', 'i');
        const m = text.match(re);
        if (!m) return null;
        try { return JSON.parse(m[1].trim()); } catch(_) {}
        try { const fixed = m[1].trim().replace(/,\s*]/g, ']').replace(/,\s*}/g, '}'); return JSON.parse(fixed); } 
        catch(_) { 
            _dbgAdd('MEM_AI_UPDATE_BLOCK_FAILED', { raw: m[1] });
            return null; 
        }
    }

    function stripMemoryBlock(text) {
        return text.replace(/```memory-update[\s\S]*?```/gi, '').trim();
    }

    function processMemoryUpdates(text, msgId) {
        const s = getSettings();
        if (!s.memoryEnabled) return;
        const changes = parseMemoryBlockFromText(text);
        if (!changes?.length) return;
        const applied = [];
        for (const ch of changes) {
            if (ch.action === 'add' && ch.key && ch.value) {
                const targetScope = ['global', 'character', 'chat', 'session'].includes(ch.scope) ? ch.scope : 'character';
                const mem = getVisibleMemories().find(m => m.scope === targetScope && m.key === ch.key);
                
                if (mem) {
                    const newVal = mem.value + '\n' + ch.value;
                    updateMemory(mem.id, ch.key, newVal);
                    applied.push({ action: 'update', key: ch.key, value: newVal });
                } else {
                    addMemory(ch.key, ch.value, ch.scope);
                    applied.push({ action: 'add', key: ch.key, value: ch.value });
                }
            } else if ((ch.action === 'edit' || ch.action === 'update') && ch.scope && ch.key && ch.value) {
                const mem = getVisibleMemories().find(m => m.scope === ch.scope && m.key === ch.key);
                if (mem) {
                    updateMemory(mem.id, ch.key, ch.value);
                    applied.push({ action: 'update', key: ch.key, value: ch.value });
                }
            } else if (ch.action === 'delete' && ch.scope && ch.key) {
                const mem = getVisibleMemories().find(m => m.scope === ch.scope && m.key === ch.key);
                if (mem) { applied.push({ action: 'delete', key: mem.key }); deleteMemory(mem.id); }
            } else {
                if (ch.action && !['add', 'edit', 'update', 'delete'].includes(ch.action)) {
                    _dbgAdd('MEM_AI_ACTION_UNKNOWN', { action: ch.action });
                } else if (ch.scope && !['global', 'character', 'chat', 'session'].includes(ch.scope)) {
                    _dbgAdd('MEM_SCOPE_INVALID', { scope: ch.scope });
                }
            }
        }
        if (applied.length) {
            if (s.memoryNotify) showMemoryToast(applied);
            if (document.getElementById('scp-sp-pane-memory')?.style.display !== 'none') renderMemoryList();
        }
    }

    function showMemoryToast(applied) {
        const existing = document.querySelector('.scp-memory-toast');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.className = 'scp-memory-toast';
        const icons = { add: '✦', update: '✎', delete: '✕' };
        const lines = applied.slice(0, 3).map(a => `${icons[a.action] || '·'} ${escHtml(a.key)}: ${escHtml((a.value || '(deleted)').slice(0, 60))}`).join("\n");
        const linesHtml = lines.split("\n").join("<br>");
        toast.innerHTML = `<span class="scp-memory-toast-icon"><i class="fa-solid fa-brain"></i></span><div class="scp-memory-toast-body"><div class="scp-memory-toast-title">Memory Updated (${applied.length})</div><div class="scp-memory-toast-text">${linesHtml}</div></div>`;
        document.body.appendChild(toast);
        toast.style.cursor = 'pointer';
        toast.addEventListener('click', () => {
            _dbgAdd('MEM_TOAST_DISMISS', { reason: 'click' });
            toast.remove();
        });
        setTimeout(() => {
            toast.style.animation = 'scp-toast-out 0.25s ease forwards';
            setTimeout(() => {
                _dbgAdd('MEM_TOAST_DISMISS', { reason: 'timeout' });
                toast.remove();
            }, 260);
        }, 12000);
    }

    function renderMemoryList() {
        const listEl = document.getElementById('scp-sp-memory-list');
        const emptyEl = document.getElementById('scp-sp-memory-empty');
        if (!listEl) return;
        
        const allMems = Object.values(getMemories()).sort((a,b) => (b.createdAt||0) - (a.createdAt||0));
        listEl.innerHTML = '';
        
        if (!allMems.length) {
            if (emptyEl) emptyEl.style.display = '';
            return;
        }
        if (emptyEl) emptyEl.style.display = 'none';

        const tree = { global: [], characters: {} };

        allMems.forEach(m => {
            if (m.scope === 'global' || !m.scope) {
                tree.global.push(m);
            } else {
                const charId = m.charId || 'unknown';
                if (!tree.characters[charId]) {
                    tree.characters[charId] = { name: m.charName || charId, memories: [], chats: {} };
                }
                const charNode = tree.characters[charId];

                if (m.scope === 'character') {
                    charNode.memories.push(m);
                } else {
                    const chatId = m.chatId || 'unknown';
                    if (!charNode.chats[chatId]) {
                        charNode.chats[chatId] = { name: m.chatName || chatId, memories: [], sessions: {} };
                    }
                    const chatNode = charNode.chats[chatId];

                    if (m.scope === 'chat') {
                        chatNode.memories.push(m);
                    } else if (m.scope === 'session') {
                        const sessionId = m.sessionId || 'unknown';
                        if (!chatNode.sessions[sessionId]) {
                            chatNode.sessions[sessionId] = { name: m.sessionName || sessionId, memories: [] };
                        }
                        chatNode.sessions[sessionId].memories.push(m);
                    }
                }
            }
        });

        const createMemEl = (mem) => {
            const item = document.createElement('div');
            item.className = 'scp-memory-item';
            if (mem.disabled) item.style.opacity = '0.5';
            item.dataset.id = mem.id;
            
            const isNew = (Date.now() - (mem.createdAt || 0)) < 5000;
            if (isNew) {
                const dot = document.createElement('div');
                dot.className = 'scp-memory-new-badge';
                item.appendChild(dot);
            }

            const timeStr = mem.updatedAt
                ? `Updated ${new Date(mem.updatedAt).toLocaleString()}`
                : `Added ${new Date(mem.createdAt || 0).toLocaleString()}`;

            item.innerHTML += `
                <div class="scp-memory-item-body">
                    <div class="scp-memory-item-key">${escHtml(mem.key)}</div>
                    <div class="scp-memory-item-val-ph"></div>
                    <div class="scp-memory-item-meta">${escHtml(timeStr)}</div>
                </div>
                <div class="scp-memory-item-actions">
                    <button class="scp-memory-item-toggle" title="${mem.disabled ? 'Enable Memory' : 'Disable Memory'}">
                        <i class="fa-solid ${mem.disabled ? 'fa-toggle-off' : 'fa-toggle-on'}"></i>
                    </button>
                    <button class="scp-memory-item-edit" title="Edit"><i class="fa-solid fa-pen"></i></button>
                    <button class="scp-memory-item-del" title="Delete"><i class="fa-solid fa-trash"></i></button>
                </div>
            `;
            const valEl = document.createElement('div');
            valEl.className = 'scp-memory-item-val';
            const isLong = mem.value.length > 120;
            valEl.textContent = isLong ? mem.value.slice(0, 120) + '…' : mem.value;
            if (isLong) {
                valEl.style.cursor = 'pointer';
                valEl.title = 'Click to expand';
                let expanded = false;
                valEl.addEventListener('click', e => {
                    e.stopPropagation();
                    expanded = !expanded;
                    valEl.textContent = expanded ? mem.value : mem.value.slice(0, 120) + '…';
                    valEl.title = expanded ? 'Click to collapse' : 'Click to expand';
                });
            }
            item.querySelector('.scp-memory-item-val-ph').replaceWith(valEl);
            
            item.querySelector('.scp-memory-item-toggle').addEventListener('click', e => {
                e.stopPropagation();
                mem.disabled = !mem.disabled;

                _dbgAdd('MEM_TOGGLE_DISABLE', { id: mem.id, disabled: mem.disabled });

                saveSettings();
                renderMemoryList();
            });

            item.querySelector('.scp-memory-item-edit').addEventListener('click', async e => {
                e.stopPropagation();
                await editMemoryDialog(mem.id);
            });
            
            item.querySelector('.scp-memory-item-del').addEventListener('click', async e => {
                e.stopPropagation();
                const ok = await showCustomDialog({ type: 'confirm', title: 'Delete Memory', message: `Delete memory "${mem.key}"?` });
                if (!ok) return;
                deleteMemory(mem.id);
                renderMemoryList();
            });
            return item;
        };

        const buildDetails = (title, icon, contentEls, open = false) => {
            if (!contentEls || contentEls.length === 0) return null;
            const det = document.createElement('details');
            det.className = 'scp-mem-tree-details';
            if (open) det.open = true;
            const sum = document.createElement('summary');
            sum.className = 'scp-mem-tree-summary';
            sum.innerHTML = `<i class="fa-solid fa-${icon}"></i> ${escHtml(title)}`;
            const content = document.createElement('div');
            content.className = 'scp-mem-tree-content';
            contentEls.forEach(el => content.appendChild(el));
            det.appendChild(sum);
            det.appendChild(content);
            return det;
        };

        if (tree.global.length > 0) {
            const globDet = buildDetails('Global', 'globe', tree.global.map(createMemEl), true);
            if (globDet) listEl.appendChild(globDet);
        }

        const charKeys = Object.keys(tree.characters);
        if (charKeys.length > 0) {
            const charContent = [];
            
            charKeys.forEach(charId => {
                const cNode = tree.characters[charId];
                const nodeContent = [];
                
                cNode.memories.forEach(m => nodeContent.push(createMemEl(m)));
                
                const chatKeys = Object.keys(cNode.chats);
                if (chatKeys.length > 0) {
                    const chatsWrapper = [];
                    chatKeys.forEach(chatId => {
                        const chatNode = cNode.chats[chatId];
                        const chatContent = [];
                        chatNode.memories.forEach(m => chatContent.push(createMemEl(m)));
                        
                        const sessKeys = Object.keys(chatNode.sessions);
                        if (sessKeys.length > 0) {
                            const sessWrapper = [];
                            sessKeys.forEach(sessId => {
                                const sNode = chatNode.sessions[sessId];
                                const sEls = sNode.memories.map(createMemEl);
                                const sDet = buildDetails(sNode.name, 'bolt', sEls);
                                if (sDet) sessWrapper.push(sDet);
                            });
                            if (sessWrapper.length > 0) {
                                const sMainDet = buildDetails('Sessions', 'layer-group', sessWrapper);
                                if (sMainDet) chatContent.push(sMainDet);
                            }
                        }
                        
                        const cDet = buildDetails(chatNode.name, 'comments', chatContent);
                        if (cDet) chatsWrapper.push(cDet);
                    });
                    
                    if (chatsWrapper.length > 0) {
                        const cMainDet = buildDetails('Chats', 'folder', chatsWrapper);
                        if (cMainDet) nodeContent.push(cMainDet);
                    }
                }
                
                const charDet = buildDetails(cNode.name, 'user', nodeContent, true);
                if (charDet) charContent.push(charDet);
            });
            
            const charsMainDet = buildDetails('Characters', 'users', charContent, true);
            if (charsMainDet) listEl.appendChild(charsMainDet);
        }
    }

    async function editMemoryDialog(id) {
        const mem = id ? getMemories()[id] : null;
        const isNew = !id;
        const result = await new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.className = 'scp-dialog-overlay';
            
            const scopeOptions = [
                {val: 'global', text: 'Global (All chats)'},
                {val: 'character', text: 'Character (All chats with this character)'},
                {val: 'chat', text: 'Chat (Only this specific chat)'},
                {val: 'session', text: 'Session (Only this Copilot session)'}
            ];
            const currentScope = mem?.scope || 'character';

            const scopeHtml = scopeOptions.map(o => `<option value="${o.val}" ${currentScope === o.val ? 'selected' : ''}>${o.text}</option>`).join('');

            overlay.innerHTML = `<div class="scp-dialog-box">
<div class="scp-dialog-title">${isNew ? 'Add Memory' : 'Edit Memory'}</div>
<div class="scp-dialog-msg">Category / Key:</div>
<input type="text" class="scp-dialog-input" id="scp-mem-key-inp" placeholder="e.g. Preferences, About Me, Profession..." value="${escHtml(mem?.key || '')}">
<div class="scp-dialog-msg" style="margin-top:4px">Value:</div>
<textarea class="scp-dialog-input" id="scp-mem-val-inp" rows="3" placeholder="What to remember..." style="height:auto;resize:vertical;margin-bottom:10px;">${escHtml(mem?.value || '')}</textarea>
<div class="scp-dialog-msg" style="margin-top:4px">Scope:</div>
<select class="scp-dialog-input" id="scp-mem-scope-inp" style="margin-bottom:20px;">
    ${scopeHtml}
</select>
<div class="scp-dialog-btns">
  <button class="scp-dialog-btn scp-dialog-cancel">Cancel</button>
  <button class="scp-dialog-btn scp-dialog-ok">${isNew ? 'Add' : 'Save'}</button>
</div></div>`;
            document.body.appendChild(overlay);
            const keyInp = overlay.querySelector('#scp-mem-key-inp');
            const valInp = overlay.querySelector('#scp-mem-val-inp');
            const scopeInp = overlay.querySelector('#scp-mem-scope-inp');
            const okBtn = overlay.querySelector('.scp-dialog-ok');
            const cancelBtn = overlay.querySelector('.scp-dialog-cancel');
            const close = val => { overlay.classList.remove('visible'); setTimeout(() => overlay.remove(), 150); resolve(val); };
            keyInp.focus();
            okBtn.addEventListener('click', () => close({ key: keyInp.value, value: valInp.value, scope: scopeInp.value }));
            cancelBtn.addEventListener('click', () => close(null));
            overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
            keyInp.addEventListener('keydown', e => { if (e.key === 'Tab') { e.preventDefault(); valInp.focus(); } });
            requestAnimationFrame(() => overlay.classList.add('visible'));
        });
        
        if (!result?.key?.trim() || !result?.value?.trim()) return;

        _dbgAdd(isNew ? 'MEM_CREATE_MANUAL' : 'MEM_EDIT_MANUAL', { key: result.key, scope: result.scope });
        
        if (isNew) { addMemory(result.key, result.value, result.scope); }
        else { 
            const m = getMemories()[id];
            updateMemory(id, result.key, result.value);
            m.scope = result.scope; 
            const { charId, chatId } = getBindingKey();
            const ctx = SillyTavern.getContext();
            m.charId = charId;
            m.charName = ctx.characters?.[charId]?.name || charId;
            m.chatId = chatId;
            m.chatName = chatId;
            m.sessionId = getCurrentSession()?.id;
            m.sessionName = getCurrentSession()?.name;
            saveSettings();
        }
        renderMemoryList();
    }

    function setupMemorySettingsUI() {
        const s = getSettings();
        
        const bindCheck = (id, key) => {
            const el = document.getElementById(id); if (!el) return;
            const newEl = el.cloneNode(true); 
            el.parentNode.replaceChild(newEl, el);
            newEl.checked = !!s[key];
            newEl.addEventListener('change', () => {
                getSettings()[key] = newEl.checked;
                saveSettings();
            });
        };
        
        bindCheck('scp-sp-memory-enabled', 'memoryEnabled');
        bindCheck('scp-sp-memory-inject', 'memoryInject');
        bindCheck('scp-sp-memory-notify', 'memoryNotify');

        const promptEl = document.getElementById('scp-sp-memory-prompt');
        if (promptEl) {
            promptEl.value = s.memoryManagePrompt || DEFAULT_MEMORY_PROMPT;
            const newPromptEl = promptEl.cloneNode(true);
            promptEl.parentNode.replaceChild(newPromptEl, promptEl);
            newPromptEl.addEventListener('input', () => {
                getSettings().memoryManagePrompt = newPromptEl.value;
                saveSettings();
                const stEl = document.getElementById('scp-memory-prompt');
                if (stEl) stEl.value = newPromptEl.value;
            });
        }

        const resetBtn = document.getElementById('scp-sp-reset-memory-prompt');
        if (resetBtn) {
            const newResetBtn = resetBtn.cloneNode(true);
            resetBtn.parentNode.replaceChild(newResetBtn, resetBtn);
            newResetBtn.addEventListener('click', async () => {
                const ok = await showCustomDialog({ type: 'confirm', title: 'Reset Prompt', message: 'Reset memory prompt to default?' });
                if (!ok) return;
                getSettings().memoryManagePrompt = DEFAULT_MEMORY_PROMPT;
                saveSettings();
                const el = document.getElementById('scp-sp-memory-prompt'); if (el) el.value = DEFAULT_MEMORY_PROMPT;
                const stEl = document.getElementById('scp-memory-prompt'); if (stEl) stEl.value = DEFAULT_MEMORY_PROMPT;
                toastr.success('Prompt reset.', EXT_DISPLAY);
            });
        }

        const addBtn = document.getElementById('scp-sp-memory-add-btn');
        if (addBtn) {
            const newAddBtn = addBtn.cloneNode(true);
            addBtn.parentNode.replaceChild(newAddBtn, addBtn);
            newAddBtn.addEventListener('click', async () => {
                await editMemoryDialog(null);
            });
        }
        
        const clearBtn = document.getElementById('scp-sp-memory-clear-all');
        if (clearBtn) {
            const newClearBtn = clearBtn.cloneNode(true);
            clearBtn.parentNode.replaceChild(newClearBtn, clearBtn);
            newClearBtn.addEventListener('click', async () => {
                const count = Object.keys(getMemories()).length;
                if (!count) { toastr.info('No memories to clear.', EXT_DISPLAY); return; }
                const ok = await showCustomDialog({ type: 'confirm', title: 'Clear All Memories', message: `Delete all ${count} stored memories? This cannot be undone.`, delayConfirm: 2 });
                if (!ok) return;
                clearAllMemories();
                renderMemoryList();
                toastr.success('All memories cleared.', EXT_DISPLAY);
            });
        }

        renderMemoryList();
        updateMemoryDot();
    }

    // ─── Tool Calls Engine ───────────────────────────────────────────────────────

    const TOOL_DEFINITIONS = [
        {
            id: 'search_chat',
            name: 'search_chat',
            label: 'Search Chat History',
            icon: 'fa-comments',
            description: 'Search for messages in the main chat. Supports fuzzy matching and regex. Returns message indices for use in chat edits.',
            settingKey: 'toolsEnabled_search_chat',
            schema: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Text or regex to search for (prefix with / for regex, e.g. /hello.*/i)' },
                    role: { type: 'string', enum: ['all', 'user', 'assistant'], description: 'Which messages to search' },
                    from_index: { type: 'number', description: 'Start search from this message index (optional)' },
                    to_index: { type: 'number', description: 'End search at this message index (optional)' },
                    max_results: { type: 'number', description: 'Maximum number of results to return (default 10)' },
                    include_content: { type: 'boolean', description: 'Include full message content in results (default true)' },
                },
                required: ['query'],
            },
        },
        {
            id: 'search_lorebook',
            name: 'search_lorebook',
            label: 'Search Lorebook',
            icon: 'fa-book',
            description: 'Search for entries in active lorebooks by name, keyword, or content.',
            settingKey: 'toolsEnabled_search_lorebook',
            schema: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Text to search for in entry names, keys, and content' },
                    book_name: { type: 'string', description: 'Specific lorebook name to search (optional)' },
                    search_in: { type: 'string', enum: ['all', 'name', 'keys', 'content'], description: 'Where to search (default: all)' },
                },
                required: ['query'],
            },
        },
        {
            id: 'ask_user',
            name: 'ask_user',
            label: 'Ask User',
            icon: 'fa-circle-question',
            description: 'Pause generation and ask the user a question before continuing. Requires streaming to be enabled.',
            settingKey: 'toolsEnabled_ask_user',
            schema: {
                type: 'object',
                properties: {
                    question: { type: 'string', description: 'The question to ask the user' },
                    context: { type: 'string', description: 'Why you need this information (shown to user)' },
                },
                required: ['question'],
            },
        },
        {
            id: 'get_char_info',
            name: 'get_char_info',
            label: 'Get Character Info',
            icon: 'fa-user-pen',
            description: 'Retrieve detailed information about the current character card fields.',
            settingKey: 'toolsEnabled_get_char_info',
            schema: {
                type: 'object',
                properties: {
                    fields: { type: 'array', items: { type: 'string' }, description: 'Which fields to retrieve: description, personality, scenario, first_mes, mes_example, tags, authors_note, alternate_greetings' },
                },
                required: ['fields'],
            },
        },
        {
            id: 'get_chat_stats',
            name: 'get_chat_stats',
            label: 'Get Chat Statistics',
            icon: 'fa-chart-bar',
            description: 'Get statistics about the current chat: message count, approximate tokens, character/user distribution.',
            settingKey: 'toolsEnabled_get_chat_stats',
            schema: { type: 'object', properties: {} },
        },
        {
            id: 'get_recent_messages',
            name: 'get_recent_messages',
            label: 'Get Recent Messages',
            icon: 'fa-list',
            description: 'Retrieve recent messages with their indices. Useful when you need precise message numbers for edits.',
            settingKey: 'toolsEnabled_get_recent_messages',
            schema: {
                type: 'object',
                properties: {
                    count: { type: 'number', description: 'Number of recent messages to retrieve (default 10, max 50)' },
                    from_end: { type: 'boolean', description: 'If true, count from end of chat (default true)' },
                    role: { type: 'string', enum: ['all', 'user', 'assistant'], description: 'Filter by role (default all)' },
                },
            },
        },
    ];

    function getEnabledTools() {
        const s = getSettings();
        if (!s.toolsEnabled) return [];
        return TOOL_DEFINITIONS.filter(t => s[t.settingKey] !== false);
    }

    function buildAnthropicToolsPayload() {
        return getEnabledTools().map(t => ({
            name: t.name,
            description: t.label + ': ' + t.description,
            input_schema: t.schema,
        }));
    }

    // Execute a single tool call
    async function executeTool(toolName, toolInput) {
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
                            // Fuzzy: split into tokens
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
            case 'search_lorebook': {
                const activeBooks = getActiveLorebookNames();
                const query = (toolInput.query || '').toLowerCase();
                const targetBook = toolInput.book_name;
                const searchIn = toolInput.search_in || 'all';
                const results = [];
                for (const bookName of activeBooks) {
                    if (targetBook && !bookName.toLowerCase().includes(targetBook.toLowerCase())) continue;
                    const data = await fetchWorldInfoBook(bookName).catch(() => null);
                    if (!data) continue;
                    for (const entry of wiEntriesToArray(data)) {
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
                            constant: !!entry.constant,
                            disabled: !!entry.disable,
                        });
                        if (results.length >= 20) break;
                    }
                    if (results.length >= 20) break;
                }
                return { found: results.length, results };
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

    function createToolCallEl(tc) {
        const item = document.createElement('div');
        item.className = 'scp-tool-call-item scp-inline-tool-call';
        item.dataset.toolId = tc.id;
        const def = TOOL_DEFINITIONS.find(d => d.name === tc.name);
        const iconClass = def?.icon || 'fa-screwdriver-wrench';
        
        const isWarning = tc.status === 'warning';
        const statusClass = tc.status === 'running' ? 'running' : tc.status === 'error' ? 'error' : isWarning ? 'warning' : 'done';
        const statusLabel = tc.status === 'running' ? 'Running' : tc.status === 'error' ? 'Error' : isWarning ? 'Unavailable' : 'Done';
        const colorStyle = isWarning ? 'color: var(--scp-warning, #ffb432);' : '';

        const spinnerHtml = tc.status === 'running' ? '<span class="scp-tool-spin">⟳</span> ' : '';
        const iconHtml = tc.status === 'running'
            ? '<span class="scp-tool-spin" style="font-size:11px">⟳</span>'
            : `<i class="fa-solid ${iconClass}" style="font-size:11px"></i>`;

        item.innerHTML = `<div class="scp-tool-call-header">
  <div class="scp-tool-call-icon ${statusClass}" ${isWarning ? `style="${colorStyle}"` : ''}>${iconHtml}</div>
  <div class="scp-tool-call-name">${escHtml(def?.label || tc.name)}</div>
  <div class="scp-tool-call-status ${statusClass}" ${isWarning ? `style="${colorStyle}"` : ''}>${spinnerHtml}${escHtml(statusLabel)}</div>
  <div class="scp-tool-call-chevron">▶</div>
</div>
<div class="scp-tool-call-body">
  <div class="scp-tool-call-section-label">Input</div>
  <pre class="scp-tool-call-args">${escHtml(JSON.stringify(tc.input, null, 2))}</pre>
  ${tc.result !== undefined ? `<div class="scp-tool-call-section-label" style="margin-top:8px">Result</div><pre class="scp-tool-call-result${tc.status === 'error' ? ' error-result' : ''}" ${isWarning ? `style="${colorStyle}"` : ''}>${escHtml(typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result, null, 2))}</pre>` : ''}
</div>`;
        item.querySelector('.scp-tool-call-header').addEventListener('click', () => {
            const isOpen = !item.classList.contains('open');
            _dbgAdd('TOOL_CALL_HEADER_TOGGLE', { toolId: tc.id, open: isOpen });

            item.classList.toggle('open');
        });
        return item;
    }

    function postProcessToolCalls(containerEl, toolCalls) {
        if (!toolCalls || !toolCalls.length) return;
        containerEl.querySelectorAll('.scp-tool-call-ph').forEach((ph) => {
            const idx = parseInt(ph.dataset.tcid, 10);
            const tc = toolCalls[idx];
            if (tc) ph.replaceWith(createToolCallEl(tc));
        });

        const allTCs = [...containerEl.querySelectorAll('.scp-inline-tool-call')];
        allTCs.forEach(tc => tc.classList.remove('scp-tc-chain-start','scp-tc-chain-mid','scp-tc-chain-end'));
        
        let i = 0;
        while (i < allTCs.length) {
            let end = i;
            while (end + 1 < allTCs.length) {
                let sib = allTCs[end].nextSibling;
                while (sib && ((sib.nodeType === Node.TEXT_NODE && !sib.textContent.trim()) || sib.tagName === 'BR')) {
                    sib = sib.nextSibling;
                }
                if (sib === allTCs[end + 1]) end++; else break;
            }
            if (end > i) {
                for (let j = i; j <= end; j++) {
                    if (j === i) allTCs[j].classList.add('scp-tc-chain-start');
                    else if (j === end) allTCs[j].classList.add('scp-tc-chain-end');
                    else allTCs[j].classList.add('scp-tc-chain-mid');
                }
            } else {
                allTCs[i].classList.add('scp-tc-chain-start', 'scp-tc-chain-end');
            }
            i = end + 1;
        }
    }

    function setupToolsSettingsUI() {
        const s = getSettings();
        const listEl = document.getElementById('scp-sp-tools-list');
        if (!listEl) return;
        
        let promptWrap = document.getElementById('scp-sp-tools-prompt-wrap');
        
        const ta = document.getElementById('scp-sp-tools-prompt');
        if (ta) {
            ta.value = s.toolsSystemPrompt || DEFAULT_TOOLS_PROMPT;
            ta.addEventListener('input', () => { getSettings().toolsSystemPrompt = ta.value; saveSettings(); });
        }
        document.getElementById('scp-sp-tools-reset')?.addEventListener('click', () => {
            getSettings().toolsSystemPrompt = DEFAULT_TOOLS_PROMPT; saveSettings();
            if (ta) ta.value = DEFAULT_TOOLS_PROMPT;
        });

        const setC = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
        const setV = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
        setC('scp-sp-tools-enabled', s.toolsEnabled);
        setV('scp-sp-tools-max-rounds', s.toolsMaxRounds ?? 5);

        document.getElementById('scp-sp-tools-enabled')?.addEventListener('change', e => {
            getSettings().toolsEnabled = e.target.checked; saveSettings();
            const stEl = document.getElementById('scp-tools-enabled'); if (stEl) stEl.checked = e.target.checked;
        });
        document.getElementById('scp-sp-tools-max-rounds')?.addEventListener('input', e => {
            getSettings().toolsMaxRounds = parseInt(e.target.value) || 5; saveSettings();
        });

        const streamingOff = s.forceStreaming === 'off';

        listEl.innerHTML = '';
        for (const tool of TOOL_DEFINITIONS) {
            const row = document.createElement('div');
            row.className = 'scp-tool-toggle-row';
            const isEnabled = s[tool.settingKey] !== false;
            const isAskUser = tool.id === 'ask_user';
            const isDisabledByStream = isAskUser && streamingOff;
            const iconHtml = `<i class="fa-solid ${tool.icon}" style="width:13px;text-align:center;margin-right:4px;opacity:.7"></i>`;
            row.innerHTML = `<label class="scp-sp-check" style="flex:1${isDisabledByStream ? ';opacity:.45;pointer-events:none' : ''}"><input type="checkbox" id="scp-sp-tool-${tool.id}" ${isEnabled && !isDisabledByStream ? 'checked' : ''} ${isDisabledByStream ? 'disabled' : ''}><span class="scp-tool-toggle-name">${iconHtml}${escHtml(tool.label)}</span></label>`;
            const descEl = document.createElement('div');
            descEl.className = 'scp-tool-toggle-desc';
            descEl.style.cssText = 'font-size:10px;color:var(--scp-text-muted);margin-top:2px;padding-left:20px';
            descEl.textContent = isDisabledByStream ? '⚠ Unavailable — requires streaming to be enabled (not "Force Off")' : tool.description;
            if (isDisabledByStream) descEl.style.color = 'var(--scp-danger)';
            row.appendChild(descEl);
            if (!isDisabledByStream) {
                row.querySelector(`#scp-sp-tool-${tool.id}`)?.addEventListener('change', e => {
                    getSettings()[tool.settingKey] = e.target.checked; saveSettings();
                });
            }
            listEl.appendChild(row);
        }

        document.getElementById('scp-open-tools-settings')?.addEventListener('click', () => {
            openSettingsPanel();
            setTimeout(() => {
                const tab = document.querySelector('[data-sptab="tools"]');
                if (tab) tab.click();
            }, 80);
        });
    }

    // ─── Agentic Loop (Tool Calls) ────────────────────────────────────────────────

    let _activeToolCalls = [];
    let _askUserResolve = null;

    function _unusedAgenticStub() {}

   function parseToolCallsFromText(text) {
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

    function stripToolCallsFromText(text) {
        return text.replace(/```tool_call[\s\S]*?```/gi, '').trim();
    }

    function buildToolCallsSystemBlock() {
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

    async function executeAskUser(input, msgEl) {
        const question = input.question || 'Do you have any additional information?';
        const context = input.context || '';
        return new Promise(resolve => {
            _askUserResolve = resolve;
            const wrap = document.createElement('div');
            wrap.className = 'scp-tool-ask-wrap';
            if (context) {
                const ctx = document.createElement('div');
                ctx.style.cssText = 'font-size:10px;color:var(--scp-text-muted);margin-bottom:6px;font-style:italic';
                ctx.textContent = context;
                wrap.appendChild(ctx);
            }
            const q = document.createElement('div');
            q.className = 'scp-tool-ask-question';
            q.textContent = question;
            wrap.appendChild(q);
            const inp = document.createElement('textarea');
            inp.className = 'scp-tool-ask-input';
            inp.placeholder = 'Your answer…';
            inp.rows = 2;
            wrap.appendChild(inp);
            const btn = document.createElement('button');
            btn.className = 'scp-tool-ask-submit';
            btn.textContent = 'Submit Answer';
            btn.addEventListener('click', () => {
                const answer = inp.value.trim();
                if (!answer) return;

                _dbgAdd('ASK_USER_SUBMIT', { question, answer });

                wrap.remove();
                resolve(answer);
                _askUserResolve = null;
            });
            inp.addEventListener('keydown', e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); btn.click(); }
            });
            wrap.appendChild(btn);
            const body = msgEl?.querySelector('.scp-msg-body');
            if (body) body.appendChild(wrap);
            inp.focus();
        });
    }

    // ─── Lorebook Manager UI ─────────────────────────────────────────────────────

    let _lbActiveBook = null;
    let _lbSearchQuery = '';
    let _lbEntryDetailEntry = null;
    let _lbEntryDetailBook = null;
    
    function renderProposalCard(changes, msgEl) {
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

        const persistState = () => {};

        const getPendingCount = () => itemStates.filter(s => s === 'pending').length;
        const getAppliedCount = () => itemStates.filter(s => s === 'applied').length;

        const checkAllResolved = () => {
            if (getPendingCount() === 0) card.remove();
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

            _dbgAdd('LB_PROPOSAL_ACTION', { action: 'dismissed', msgId: card.dataset.for, dismissedCount: dismissedChanges.length });

            if (dismissedChanges.length > 0) {
                logLBHistoryChanges(dismissedChanges, 'Dismissed', card.dataset.for);
            }
            syncBlockToMessage(); card.remove();
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
                <span class="scp-lb-proposal-name scp-lb-pn-target">${escHtml(c.name || c.originalName || `Entry #${c.uid || '?'}`)}</span>${c.constant ? '<span class="scp-lb-src-badge scp-lb-src-global" style="font-size:9px;padding:1px 5px" title="Constant entry">★</span>' : ''}`;

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
                            if (!_activeBooks.includes(n)) {
                                _activeBooks.push(n);
                            }
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
                const rect = worldTrigger.getBoundingClientRect();
                worldPanel.style.top = `${rect.bottom + 4}px`;
                worldPanel.style.left = `${rect.left}px`;
                worldPanel.classList.add('open');
                worldTrigger.classList.add('open');
            };

            const _validateBookEntry = async (bookName) => {
                worldTrigger.classList.add('loading');
                const checkChange = { ...editableChanges[ci], worldName: bookName };
                if (bookName !== editableChanges[ci].worldName) {
                    delete checkChange.uid;
                }
                
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
                        if (tInput && !tInput.value) {
                            tInput.value = origKeys.join(', ');
                            tInput.placeholder = '';
                        }
                    }
                }

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

                let isValid = found;
                let reason = found ? '' : 'Entry not found in selected lorebook';

                if (found && editableChanges[ci].action === 'patch') {
                    const orig = resolved.origEntry;
                    let current = orig?.content || '';
                    for (const patch of (editableChanges[ci].patches || [])) {
                        const { result, matched } = applySearchReplaceToField(current, patch.search || patch.anchor || '', patch.replace || '');
                        if (!matched) {
                            isValid = false;
                            reason = `ANCHOR not found: "${(patch.search || patch.anchor || '').slice(0, 40)}..."`;
                            break;
                        }
                        current = result;
                    }
                }

                if (!isValid) {
                    applyItemBtn.disabled = true;
                    applyItemBtn.title = reason;
                    item.style.borderLeftColor = 'var(--scp-danger)';
                    warnEl.textContent = `⚠ ${reason}`;
                    warnEl.style.display = 'block';
                } else {
                    applyItemBtn.disabled = false;
                    applyItemBtn.title = 'Apply this change';
                    item.style.borderLeftColor = '';
                    warnEl.style.display = 'none';
                }

                worldTrigger.classList.toggle('warn', !found);
            };

            const selectBook = async (name) => {
                _dbgAdd('LB_PROPOSAL_WORLD_CHANGED', { from: _selectedBook, to: name });

                _selectedBook = name;
                editableChanges[ci].worldName = name;
                worldTriggerText.textContent = `in ${getDisplayName(name)}`;
                worldTrigger.classList.remove('warn');

                worldPanel.querySelectorAll('.scp-lb-proposal-world-item').forEach(el => {
                    el.classList.toggle('active', el.dataset.value === name);
                });
                closeWorldPanel();
                if (c.action !== 'add') await _validateBookEntry(name);
            };

            worldTrigger.addEventListener('click', e => {
                e.stopPropagation();
                const isOpen = worldPanel.classList.contains('open');
                document.querySelectorAll('.scp-lb-proposal-world-panel.open').forEach(p => {
                    p.classList.remove('open');
                    p.previousElementSibling?.classList.remove('open');
                });
                if (!isOpen) openWorldPanel();
            });

            const _allBooks = [..._activeBooks];
            if (_currentBook && !_activeBooks.includes(_currentBook)) _allBooks.unshift(_currentBook);

            buildWorldPanelItems(_allBooks);

            worldDd.appendChild(worldTrigger);
            worldDd.appendChild(worldPanel);

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

            // Diff btn - for edit AND patch actions
            if (['edit', 'patch', 'prepend', 'append'].includes(c.action)) {
                const diffBtn = document.createElement('button');
                diffBtn.className = 'scp-lb-proposal-diff-btn';
                diffBtn.title = 'View diff'; diffBtn.innerHTML = I.diff;
                diffBtn.addEventListener('click', async e => {
                    e.stopPropagation();
                    const change = editableChanges[ci];
                    const { origEntry } = await resolveLBChangeTarget(change);
                    if (!origEntry) {
                        toastr.warning('Could not find original entry to compare against.', EXT_DISPLAY);
                        return;
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

                _dbgAdd('LB_PROPOSAL_ACTION', { action: 'applied', msgId: card.dataset.for, change: editableChanges[ci] });

                try {
                    await applyLBChanges([editableChanges[ci]], card.dataset.for);
                    itemStates[ci] = 'applied';
                    item.classList.add('scp-lb-item-applied');
                    itemBtns.querySelectorAll('button').forEach(b => { b.disabled = true; });
                    _wiCache = {};
                    persistState(); updateCountBadge(); updateFooterBtns(); 
                    syncBlockToMessage()
                    checkAllResolved();
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
                closeEditPanel();
                itemStates[ci] = 'rejected';

                _dbgAdd('LB_PROPOSAL_ACTION', { action: 'rejected', msgId: card.dataset.for, change: editableChanges[ci] });

                item.classList.add('scp-lb-item-rejected');
                itemBtns.querySelectorAll('button').forEach(b => { b.disabled = true; });

                logLBHistoryChanges([editableChanges[ci]], 'Rejected', card.dataset.for);
                persistState(); updateCountBadge(); updateFooterBtns(); 
                syncBlockToMessage()
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
            if (c.triggers !== null && c.triggers?.length) {
                triggersEl = document.createElement('div');
                triggersEl.className = 'scp-lb-proposal-triggers';
                triggersEl.textContent = 'Keys: ' + c.triggers.join(', ');
                item.appendChild(triggersEl);
            } else if (c.triggers === null) {
                triggersEl = document.createElement('div');
                triggersEl.className = 'scp-lb-proposal-triggers';
                triggersEl.style.opacity = '0.5';
                triggersEl.textContent = 'Keys: keep original';
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
                nameInput.type = 'text'; nameInput.className = 'scp-lb-pe-input scp-lb-name-input';
                nameInput.value = c.name || '';
                nameInput.addEventListener('input', () => { editableChanges[ci].name = nameInput.value; });
                editPanel.appendChild(mkRow('Name', nameInput));

                const trigInput = document.createElement('input');
                trigInput.type = 'text'; trigInput.className = 'scp-lb-pe-input scp-lb-trig-input';
                trigInput.placeholder = 'Keywords (comma separated)';
                trigInput.value = Array.isArray(c.triggers) ? c.triggers.join(', ') : '';
                trigInput.addEventListener('input', () => {
                    const val = trigInput.value.trim();
                    editableChanges[ci].triggers = val === '' ? [] : val.split(',').map(t => t.trim()).filter(Boolean);
                });
                editPanel.appendChild(mkRow('Keys', trigInput));

                if (c.action === 'patch') {
                    // Patch mode
                    const rebuildPatches = () => {
                        const existing = editPanel.querySelector('.scp-lb-patches-wrap');
                        if (existing) existing.remove();
                        const patchWrap = document.createElement('div');
                        patchWrap.className = 'scp-lb-patches-wrap';
                        patchWrap.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-top:4px';
                        (editableChanges[ci].patches || []).forEach((patch, pi) => {
                            const pHdr = document.createElement('div');
                            pHdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:2px';
                            pHdr.innerHTML = `<span style="font-size:10px;font-weight:700;color:var(--scp-accent);text-transform:uppercase;letter-spacing:.04em">Patch ${pi+1}</span>`;
                            if ((editableChanges[ci].patches || []).length > 1) {
                                const delP = document.createElement('button');
                                delP.style.cssText = 'background:none;border:none;color:var(--scp-danger);cursor:pointer;font-size:11px;padding:0;font-family:var(--scp-font)';
                                delP.textContent = '✕ Remove';
                                delP.addEventListener('click', () => { editableChanges[ci].patches.splice(pi, 1); rebuildPatches(); });
                                pHdr.appendChild(delP);
                            }
                            const searchTa = document.createElement('textarea');
                            searchTa.className = 'scp-lb-pe-textarea'; searchTa.rows = 2; searchTa.value = patch.search || '';
                            searchTa.placeholder = 'first unique words || last unique words';
                            searchTa.addEventListener('input', () => { editableChanges[ci].patches[pi].search = searchTa.value; });
                            const replaceTa = document.createElement('textarea');
                            replaceTa.className = 'scp-lb-pe-textarea'; replaceTa.rows = 3; replaceTa.value = patch.replace || '';
                            replaceTa.placeholder = 'replacement text';
                            replaceTa.addEventListener('input', () => { editableChanges[ci].patches[pi].replace = replaceTa.value; });
                            patchWrap.appendChild(pHdr);
                            patchWrap.appendChild(mkRow('Anchor (range)', searchTa));
                            patchWrap.appendChild(mkRow('Replace', replaceTa));
                            if (pi < (editableChanges[ci].patches || []).length - 1) {
                                const sep = document.createElement('div');
                                sep.style.cssText = 'height:1px;background:rgba(255,255,255,.07);margin:4px 0';
                                patchWrap.appendChild(sep);
                            }
                        });
                        const addPBtn = document.createElement('button');
                        addPBtn.className = 'scp-action-btn'; addPBtn.style.marginTop = '4px';
                        addPBtn.innerHTML = `${I.plus}<span>Add Patch</span>`;
                        addPBtn.addEventListener('click', () => {
                            if (!editableChanges[ci].patches) editableChanges[ci].patches = [];
                            editableChanges[ci].patches.push({ search: '', replace: '' });
                            rebuildPatches();
                        });
                        patchWrap.appendChild(addPBtn);
                        editPanel.appendChild(patchWrap);
                    };
                    rebuildPatches();
                } else {
                    const contentTa = document.createElement('textarea');
                    contentTa.className = 'scp-lb-pe-textarea';
                    contentTa.value = c.content || '';
                    contentTa.addEventListener('input', () => { editableChanges[ci].content = contentTa.value; });
                    editPanel.appendChild(mkRow('Content', contentTa));
                }

                // Constant checkbox
                const constWrap = document.createElement('label');
                constWrap.className = 'scp-sp-check'; constWrap.style.marginTop = '6px';
                const constCb = document.createElement('input');
                constCb.type = 'checkbox'; constCb.checked = !!c.constant;
                constCb.addEventListener('change', () => { editableChanges[ci].constant = constCb.checked; });
                constWrap.appendChild(constCb);
                constWrap.appendChild(Object.assign(document.createElement('span'), { textContent: 'Constant (always inject)' }));
                editPanel.appendChild(constWrap);

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
                    warnEl.addEventListener('click', (e) => {
                        if (editPanel.style.display === 'none') toggleEditPanel(e);
                    });
                }
            }

            list.appendChild(item);
            itemEls.push(item);

            if (c.action !== 'add' && itemStates[ci] === 'pending') {
                _validateBookEntry(_selectedBook).catch(() => {});
            }
        });

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
                persistState(); updateCountBadge(); updateFooterBtns(); 
                checkAllResolved();
            } catch (e) {
                toastr.error(`Failed: ${e.message}`, EXT_DISPLAY);
                applyAllBtn.disabled = false; applyAllBtn.textContent = 'Apply All';
            }
        });

        rejectAllBtn.addEventListener('click', () => {
            const rejectedChanges = [];
            itemStates.forEach((s, i) => {
                if (s === 'pending') {
                    itemStates[i] = 'rejected';
                    itemEls[i].classList.add('scp-lb-item-rejected');
                    itemEls[i].querySelectorAll('button').forEach(b => { b.disabled = true; });
                    rejectedChanges.push(editableChanges[i]);
                }
            });
            if (rejectedChanges.length > 0) logLBHistoryChanges(rejectedChanges, 'Rejected', card.dataset.for);
            persistState(); updateCountBadge(); updateFooterBtns(); 
            checkAllResolved();
        });

        footer.appendChild(applyAllBtn); footer.appendChild(rejectAllBtn);
        card.appendChild(header); card.appendChild(list); card.appendChild(footer);
        const body = msgEl.querySelector('.scp-msg-body');
        if (body) body.insertBefore(card, body.querySelector('.scp-swipe-bar'));
        else msgEl.after(card);
    }

    async function openLorebookManager() {
        const overlay = document.getElementById('scp-lb-overlay');
        if (!overlay) return;
        _dbgAdd('LB_UI_OPEN');
        applyCustomTheme(getSettings().customTheme || THEME_PRESETS.default);
        overlay.style.display = 'flex';
        const s = getSettings();
        if (document.getElementById('scp-lb-search')) document.getElementById('scp-lb-search').value = _lbSearchQuery;
        _wiCache = {};
        await buildLorebookContextBlock(s).catch(() => {});
        await refreshLorebookList().catch(e => console.error(`[${EXT_DISPLAY}] LB list:`, e));
        if (_lbActiveBook) await renderEntryList(_lbActiveBook, _lbSearchQuery).catch(() => {});
    }

    function closeLorebookManager() {
        document.getElementById('scp-lb-overlay').style.display = 'none';
        _dbgAdd('LB_UI_CLOSE');
    }

    function _applyLBBookCheckState(item, name, s) {
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

    async function refreshLorebookList() {
        const listEl = document.getElementById('scp-lb-book-list');
        if (!listEl) return;

        const ctx = SillyTavern.getContext();
        if (typeof ctx.updateWorldInfoList === 'function') {
            ctx.updateWorldInfoList().catch(() => {});
        }

        const activeNamesArray = getActiveLorebookNames();
        const s = getSettings();

        listEl.innerHTML = '';
        if (!activeNamesArray.length) {
            listEl.innerHTML = '<div class="scp-lb-loading">No active lorebooks found.<br><small style="opacity:.5">Link one to the character or select globally.</small></div>';
            return;
        }

        await Promise.all(activeNamesArray.map(name => fetchWorldInfoBook(name)));

        const frag = document.createDocumentFragment();
        for (const name of activeNamesArray) {
            const displayName = getDisplayName(name);
            const isSelected = s.lorebookSelectedBooks.includes(name);
            const isExcluded = (s.lorebookExcludedBooks || []).includes(name);
            
            const item = document.createElement('div');
            item.className = `scp-lb-book-item${isSelected ? ' selected' : ''}${isExcluded ? ' lb-excluded' : ''}${_lbActiveBook === name ? ' lb-book-open' : ''}`;
            item.dataset.name = name;
            
            const cached = _wiCache[name];
            const entryCount = cached ? Object.keys(cached.entries || {}).length : '…';
            const isEmbedded = name === EMBEDDED_BOOK_KEY;
            const srcType = getBookSourceType(name);
            const srcLabel = { global: 'G', character: 'C', chat: 'Ch', embedded: '✦', manual: '' }[srcType] || '';
            const srcClass = `scp-lb-src-${srcType}`;
            
            const checkState = isSelected ? 'checked' : isExcluded ? 'excluded' : '';
            const checkTitle = isSelected ? 'Selected: all entries included — click to exclude' : isExcluded ? 'Excluded: all entries blocked — click to reset' : 'Default — click to include all';
            
            item.innerHTML = `
                <div class="scp-lb-book-check${checkState ? ' ' + checkState : ''}" data-book="${escHtml(name)}" title="${checkTitle}"></div>
                <div class="scp-lb-book-info">
                    <span class="scp-lb-book-name">${escHtml(displayName)}${isEmbedded ? ' <span class="scp-lb-embedded-badge">embedded</span>' : ''}</span>
                    <span class="scp-lb-book-meta">${entryCount} entries · Active</span>
                </div>
                ${srcLabel ? `<span class="scp-lb-src-badge ${srcClass}" title="Source: ${srcType}">${srcLabel}</span>` : ''}
                <span class="scp-lb-book-active-dot" title="Currently active in this chat"></span>`;
                
            item.querySelector('.scp-lb-book-check').addEventListener('click', e => { e.stopPropagation(); toggleLorebookSelection(name); });
            item.addEventListener('click', () => viewLorebookEntries(name));
            frag.appendChild(item);
        }
        listEl.appendChild(frag);
        updateLBFooterInfo();
    }

    async function toggleLorebookSelection(name) {
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
        _dbgAdd('LB_BOOK_TOGGLE_STATE', { bookName: name, isSelected: s.lorebookSelectedBooks.includes(name), isExcluded: (s.lorebookExcludedBooks || []).includes(name) });
        saveSettings();

        await buildLorebookContextBlock(s);

        const item = document.querySelector(`.scp-lb-book-item[data-name="${CSS.escape(name)}"]`);
        if (item) _applyLBBookCheckState(item, name, s);
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
        const s = getSettings();
        const isForced = s.lorebookSelectedBooks.includes(name) || (s.lorebookExcludedBooks || []).includes(name);
        const entriesEl = document.getElementById('scp-lb-entries');
        if (entriesEl) entriesEl.classList.toggle('lb-entries-dimmed', isForced);
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
            const overKey = getEntryOverrideKey(bookName, entry);
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
        const key = getEntryOverrideKey(bookName, entry);
        const current = s.lorebookEntryOverrides[key];
        const isConstantEntry = !!entry.constant && !entry.disable;
        let next;
        if (current === undefined) next = isConstantEntry ? false : true;
        else if (current === true) next = false;
        else { delete s.lorebookEntryOverrides[key]; next = undefined; }
        if (next !== undefined) s.lorebookEntryOverrides[key] = next;

        _dbgAdd('LB_ENTRY_CYCLE_OVERRIDE', { bookName, uid: entry.uid, nextState: next });

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
        const override = (s.lorebookEntryOverrides || {})[getEntryOverrideKey(bookName, entry)];
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

        _dbgAdd('LB_ENTRY_SAVE_MANUAL', { bookName: _lbEntryDetailBook, uid: _lbEntryDetailEntry.uid, nameLength: entry.comment.length, contentLength: entry.content.length });

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

        _dbgAdd('LB_ENTRY_DELETE', { bookName: _lbEntryDetailBook, uid: _lbEntryDetailEntry.uid });

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

        _dbgAdd('LB_ENTRY_ADD_NEW', { bookName: _lbActiveBook, newUid });

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
        const excCount = (s.lorebookExcludedBooks || []).length;
        const kwOn = s.lorebookAutoKeyword;
        const parts = [];
        if (count) parts.push(`${count} book${count !== 1 ? 's' : ''} selected`);
        if (excCount) parts.push(`${excCount} excluded`);
        if (kwOn) parts.push('Auto-keywords ON');
        if (!count && !excCount && !kwOn) parts.push('☑ Check books in sidebar to inject entries into Copilot context');
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
            Object.values(_wiCache[_lbActiveBook].entries).forEach(e => { s.lorebookEntryOverrides[getEntryOverrideKey(_lbActiveBook, e)] = true; });
            saveSettings(); renderEntryList(_lbActiveBook, _lbSearchQuery);
            updateMsgCount(getCurrentSession());
        });
        document.getElementById('scp-lb-disable-all')?.addEventListener('click', () => {
            if (!_lbActiveBook || !_wiCache[_lbActiveBook]) return;
            const s = getSettings();
            Object.values(_wiCache[_lbActiveBook].entries).forEach(e => { s.lorebookEntryOverrides[getEntryOverrideKey(_lbActiveBook, e)] = false; });
            saveSettings(); renderEntryList(_lbActiveBook, _lbSearchQuery);
            updateMsgCount(getCurrentSession());
        });
        document.getElementById('scp-lb-reset-overrides')?.addEventListener('click', async () => {
            if (!_lbActiveBook) return;
            const ok = await showCustomDialog({ type: 'confirm', title: 'Reset Overrides', message: `Reset all copilot injection overrides for "${_lbActiveBook}"?` });
            if (!ok) return;
            const s = getSettings();
            if (_wiCache[_lbActiveBook]) Object.values(_wiCache[_lbActiveBook].entries).forEach(e => { delete s.lorebookEntryOverrides[getEntryOverrideKey(_lbActiveBook, e)]; });
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
                const key = getEntryOverrideKey(_lbEntryDetailBook, _lbEntryDetailEntry);
                if (val === 'default') delete s.lorebookEntryOverrides[key];
                else s.lorebookEntryOverrides[key] = val === 'true';
                
                saveSettings();
                ['scp-lb-inj-default', 'scp-lb-inj-force-on', 'scp-lb-inj-force-off'].forEach(bid => document.getElementById(bid)?.classList.remove('active'));
                document.getElementById(id)?.classList.add('active');
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
            performanceMode: false,
            windowVisible: false,
            minimized: false,
            windowX: null, windowY: null,
            iconX: null, iconY: null,
            windowW: 440, windowH: 600,
            opacity: 95,
            hotkey: 'Alt+Shift+C',
            hotkeyEnabled: true,
            searchHotkey: 'Ctrl+F',
            searchHotkeyEnabled: true,
            contextDepth: 15,
            localHistoryLimit: 50,
            connectionSource: 'default',
            connectionProfileId: '',
            customUrl: 'http://localhost:5000/v1',
            customKey: '',
            customModel: '',
            maxTokens: 8048,
            includeSystemPrompt: false,
            includeAuthorsNote: true,
            includeCharacterCard: true,
            includeUserPersonality: true,
            includeAlternateSwipes: false,
            systemPrompt: DEFAULT_SYSTEM_PROMPT,
            memoryManagePrompt: DEFAULT_MEMORY_PROMPT,
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
            quickPromptSets: {},
            activeQuickPromptSet: '',
            promptPresets: {},
            stats: { g:{}, c:{}, ch:{} },
            changelogAutoShow: true,
            lastSeenVersion: '',
            starredMessages: {},
            forceStreaming: 'auto',
            applyRegexToContext: true,
            charEditAIEnabled: true,
            charEditPrompt: '',
            charEditFields: {
                tags: true,
                description: true,
                personality: true,
                scenario: true,
                first_mes: true,
                mes_example: true,
                alternate_greetings: false,
                authors_note: true,
            },
            completionSound: 'none',
            completionSoundVolume: 80,
            completionSoundOnlyWhenUnfocused: false,
            wobbleWindow: false,
            altGreetingIndices: [],
            chatEditAIEnabled: true,
            chatEditPrompt: '',
            lorebookExcludedBooks: [],
            windowBgUrl: '',
            windowBgDim: 50,
            windowBgType: 'none',
            pickerPreviewLines: 1,
            pickerPreviewLastLines: 0,
            imageAnalysisMode: 'direct',
            attachedFiles: [],
            memoryEnabled: true,
            memoryInject: true,
            memoryScope: 'global',
            memoryTag: 'memory-update',
            memoryNotify: true,
            memories: {},
            toolsEnabled: true,
            toolsThinking: false,
            toolsMaxRounds: 5,
            toolsEnabled_search_chat: true,
            toolsEnabled_search_lorebook: true,
            toolsEnabled_ask_user: true,
            toolsEnabled_get_char_info: true,
            toolsEnabled_get_chat_stats: true,
            toolsEnabled_get_recent_messages: true,
            includeSummaryception: true,
            useAspectEvolutia: true,
            autoExpandMacros: false,
            includeHiddenMessages: false,
        };
        for (const [k, v] of Object.entries(defaults)) {
            if (s[k] === undefined) s[k] = v;
        }
        return s;
    }

    function saveSettings() {
        SillyTavern.getContext().saveSettingsDebounced();
        _dbgDiffSettings();
    }

    // ─── Dirty State Tracking (item 1) ──────────────────────────────────────────

    let _configDirty = false;
    let _themeDirty = false;

    function _markDirty(type) {
        if (type === 'config') _configDirty = isConfigProfileDirty();
        if (type === 'theme') _themeDirty = isThemeDirty();
        _updateDirtyDots();
    }

    function _clearDirty(type) {
        if (type === 'config') { _configDirty = false; _takeProfileSnapshot(); }
        if (type === 'theme') _themeDirty = false;
        _updateDirtyDots();
    }

    function _updateDirtyDots() {
        const configDot = '<span class="scp-save-dirty-dot"></span>';
        ['scp-profile-save', 'scp-sp-profile-save'].forEach(id => {
            const btn = document.getElementById(id); if (!btn) return;
            btn.querySelectorAll('.scp-save-dirty-dot').forEach(d => d.remove());
            if (_configDirty) btn.insertAdjacentHTML('beforeend', configDot);
        });
        document.querySelectorAll('#scp-theme-save').forEach(btn => {
            btn.querySelectorAll('.scp-save-dirty-dot').forEach(d => d.remove());
            if (_themeDirty) btn.insertAdjacentHTML('beforeend', configDot);
        });
    }


    // Metric index map
    const _SM = { msg:0, regen:1, sess:2, tokIn:3, tokOut:4, qp:5, lb:6, edit:7 };
    const _STAT_N = 8;
    const _STAT_META = [
        { key:'msg',   label:'Messages',    color:'#7c6dfa', icon:'fa-message' },
        { key:'regen', label:'Regens',      color:'#4caf7d', icon:'fa-rotate-right' },
        { key:'sess',  label:'Sessions',    color:'#ffb432', icon:'fa-list' },
        { key:'tokIn', label:'Tokens In',   color:'#5bc0eb', icon:'fa-arrow-right-to-bracket' },
        { key:'tokOut',label:'Tokens Out',  color:'#f06292', icon:'fa-arrow-right-from-bracket' },
        { key:'qp',    label:'QPrompts',    color:'#ff8a65', icon:'fa-bolt' },
        { key:'lb',    label:'LB Changes',  color:'#ab47bc', icon:'fa-book-open' },
        { key:'edit',  label:'Edits',       color:'#78909c', icon:'fa-pen-to-square' },
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
            card.innerHTML = `<div style="display:flex; justify-content:space-between; width:100%; align-items:center;"><span class="scp-stats-card-val">${_fmtNum(totals[idx])}</span><i class="fa-solid ${meta.icon}" style="color:${meta.color}; opacity:0.4; font-size:16px;"></i></div><span class="scp-stats-card-label">${meta.label}</span>`;
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

        const buildLinePath = (pts) => pts.map((p, i) => `${i===0?'M':'L'}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');
        const buildAreaPath = (pts) => buildLinePath(pts) + ` L${pts[pts.length-1][0].toFixed(2)},${(PT+cH).toFixed(2)} L${PL},${(PT+cH).toFixed(2)} Z`;

        const yTicks = [0, 0.5, 1].map(f => ({ y: py(maxVal*f), lbl: _fmtNum(Math.round(maxVal*f)) }));
        const xStep = Math.max(1, Math.ceil(buckets.length / 9));
        const gradId = `scpsg${metricIdx}`;

        const xLabels = buckets.map((b, i) => {
            if (i % xStep !== 0 && i !== buckets.length - 1) return '';
            return `<text x="${px(i).toFixed(1)}" y="${H-3}" text-anchor="middle" class="scp-stats-axis-label">${escHtml(b.label)}</text>`;
        }).join('');

        const existing = container.querySelector('.scp-stats-chart-inner');
        let prevLine = existing?.querySelector('.scp-stats-line-path');
        let prevArea = existing?.querySelector('.scp-stats-area-path');

        if (!existing) {
            container.innerHTML = `
<div class="scp-stats-chart-inner">
  <svg class="scp-stats-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
    <defs></defs>
    <path class="scp-stats-area-path" d="" fill="none"/>
    <path class="scp-stats-line-path" d="" fill="none" stroke="${meta.color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <g class="scp-stats-xlabels"></g>
  </svg>
  <div class="scp-stats-tooltip" id="scp-stats-tt" style="display:none"></div>
</div>`;
            prevLine = container.querySelector('.scp-stats-line-path');
            prevArea = container.querySelector('.scp-stats-area-path');
        }

        const svgEl2 = container.querySelector('.scp-stats-svg');
        const defs = svgEl2?.querySelector('defs');
        if (defs) {
            defs.innerHTML = `<linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="${meta.color}" stop-opacity="0.22"/>
                <stop offset="100%" stop-color="${meta.color}" stop-opacity="0.01"/>
            </linearGradient>`;
            prevArea.setAttribute('fill', `url(#${gradId})`);
        }
        prevLine.style.stroke = meta.color;

        const parsePoints = (pathStr) => {
            const matches = pathStr.match(/[ML]([\d.]+),([\d.]+)/g) || [];
            return matches.map(m => { const [x, y] = m.slice(1).split(',').map(Number); return [x, y]; });
        };
        
        let oldPts = parsePoints(prevLine.getAttribute('d') || '');
        if (oldPts.length === 0) {
            oldPts = points.map(p => [p[0], PT + cH]);
        }
        
        const newPts = points;

        const oldDotEls = container.querySelectorAll('.scp-stats-dot');
        oldDotEls.forEach(d => d.remove());

        const dotGroup = container.querySelector('.scp-stats-xlabels');
        points.forEach((p, i) => {
            if (vals[i] <= 0) return;
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('class', 'scp-stats-dot');
            circle.setAttribute('cx', p[0].toFixed(2));
            const startY = oldPts[i] ? oldPts[i][1] : (PT + cH);
            circle.setAttribute('cy', startY.toString()); 
            circle.setAttribute('r', '3');
            circle.setAttribute('fill', meta.color);
            circle.setAttribute('data-i', i);
            circle.style.opacity = '0';
            if (dotGroup) svgEl2.insertBefore(circle, dotGroup);
            else svgEl2.appendChild(circle);
        });

        const DURATION = 480;
        const start = performance.now();
        const lerp = (a, b, t) => a + (b - a) * t;
        const ease = t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
        
        const dotEls = Array.from(container.querySelectorAll('.scp-stats-dot'));
        const animFrame = (now) => {
            const t = ease(Math.min(1, (now - start) / DURATION));
            const interpolated = newPts.map((np, i) => {
                const op = oldPts[i] || [np[0], PT + cH];
                return [lerp(op[0], np[0], t), lerp(op[1], np[1], t)];
            });
            
            prevLine.setAttribute('d', buildLinePath(interpolated));
            prevArea.setAttribute('d', buildAreaPath(interpolated));
            
            dotEls.forEach((d) => {
                const idx = parseInt(d.getAttribute('data-i') || '0');
                d.setAttribute('cy', interpolated[idx][1].toFixed(2));
                if (t > 0.8) d.style.opacity = (t - 0.8) * 5;
            });
            
            if (t < 1) requestAnimationFrame(animFrame);
            else dotEls.forEach(d => d.style.opacity = '1');
        };
        requestAnimationFrame(animFrame);

        const labelsEl = container.querySelector('.scp-stats-xlabels');
        if (labelsEl) labelsEl.innerHTML = xLabels;
        
        if (svgEl2) {
            svgEl2.querySelectorAll('line[x1]').forEach(l => l.remove());
            svgEl2.querySelectorAll('text.scp-stats-axis-label').forEach(t => t.remove());
            yTicks.forEach(({ y, lbl }) => {
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', PL); line.setAttribute('y1', y.toFixed(1));
                line.setAttribute('x2', W - PR); line.setAttribute('y2', y.toFixed(1));
                line.setAttribute('stroke', 'rgba(255,255,255,0.06)'); line.setAttribute('stroke-width', '1');
                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('x', PL - 4); text.setAttribute('y', (y + 4).toFixed(1));
                text.setAttribute('text-anchor', 'end'); text.setAttribute('class', 'scp-stats-axis-label');
                text.textContent = lbl;
                svgEl2.insertBefore(line, svgEl2.firstChild);
                svgEl2.insertBefore(text, svgEl2.firstChild);
            });
        }

        const tt = container.querySelector('#scp-stats-tt');
        if (!svgEl2 || !tt) return;

        let hlDot = svgEl2.querySelector('.scp-stats-hl-dot');
        if (!hlDot) {
            hlDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            hlDot.setAttribute('class', 'scp-stats-hl-dot');
            hlDot.setAttribute('r', '5');
            hlDot.setAttribute('stroke', 'var(--scp-bg)');
            hlDot.setAttribute('stroke-width', '2');
            hlDot.style.display = 'none';
            hlDot.style.pointerEvents = 'none';
            svgEl2.appendChild(hlDot);
        }

        let _lastI = -1;
        let _rafTt = null;
        
        svgEl2.addEventListener('pointermove', e => {
            if (_rafTt) return;
            _rafTt = requestAnimationFrame(() => {
                _rafTt = null;
                const r = svgEl2.getBoundingClientRect();
                const svgX = (e.clientX - r.left) / r.width * W;
                
                let closestIdx = 0;
                let minDist = Infinity;
                for (let i = 0; i < buckets.length; i++) {
                    const dist = Math.abs(px(i) - svgX);
                    if (dist < minDist) { minDist = dist; closestIdx = i; }
                }
                const idx = closestIdx;

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

                hlDot.setAttribute('cx', px(idx).toFixed(2));
                hlDot.setAttribute('cy', py(val).toFixed(2));
                hlDot.setAttribute('fill', meta.color);
                hlDot.style.display = '';
            });
        });
        
        svgEl2.addEventListener('pointerleave', () => {
            tt.style.display = 'none';
            if (hlDot) hlDot.style.display = 'none';
            _lastI = -1;
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
        'customUrl', 'customKey', 'customModel',
        'includeSystemPrompt','includeUserPersonality','reasoningTrimStrings',
        'applyRegexToContext','forceStreaming',
        'charEditAIEnabled', 'charEditPrompt', 'lorebookAIManageEnabled',
        'lorebookManagePrompt', 'chatEditAIEnabled', 'chatEditPrompt', 'altGreetingIndices',
        'lorebookAutoKeyword', 'includeAlternateSwipes'
    ];

    function getSessionOverrides() {
        try { return getActiveSession(false)?.overrides || {}; } catch(_) { return {}; }
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
            saveSessionsToMetadata();
            updateSessionOverrideIndicator();
        } catch(_) {}
    }

    function clearAllSessionOverrides() {
        try {
            const sess = getCurrentSession();
            if (!sess) return;
            sess.overrides = {};
            saveSessionsToMetadata();
            updateSessionOverrideIndicator();
        } catch(_) {}
    }

    function hasSessionOverrides() {
        try { const o = getActiveSession(false)?.overrides; return !!(o && Object.keys(o).length > 0); }
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

    // ─── Custom Dialog ───────────────────────────────────────────────────────────

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

    function showCustomDialog({ type = 'alert', title = '', message = '', htmlMessage = '', defaultValue = '', placeholder = '', delayConfirm = 0 }) {
        return new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.className = 'scp-dialog-overlay';
            const isPrompt = type === 'prompt';
            const isConfirm = type === 'confirm';
            overlay.innerHTML = `
                <div class="scp-dialog-box">
                    ${title ? `<div class="scp-dialog-title">${escHtml(title)}</div>` : ''}
                    ${message ? `<div class="scp-dialog-msg">${escHtml(message)}</div>` : (htmlMessage ? `<div class="scp-dialog-msg">${htmlMessage}</div>` : '')}
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
        let charId = 'global';
        if (ctx.characterId !== undefined && ctx.characterId !== null) {
            charId = String(ctx.characterId);
        } else if (typeof window.this_chid !== 'undefined' && window.this_chid !== null) {
            charId = String(window.this_chid);
        }

        let chatId = 'default';
        try {
            if (typeof window.chat_file_name === 'string' && window.chat_file_name) {
                chatId = String(window.chat_file_name);
            } else if (typeof ctx.getCurrentChatId === 'function') {
                const r = ctx.getCurrentChatId(); if (r) chatId = String(r);
            }
            
            if (chatId === 'default' || !chatId) {
                if (ctx.chatId) chatId = String(ctx.chatId);
                else if (typeof window.chat_id !== 'undefined' && window.chat_id !== null) chatId = String(window.chat_id);
            }
        } catch (_) {}
        
        return { charId, chatId };
    }

    // ─── Storage Subsystem ─────────────────────────────

    let _inMemoryBucket = { activeSessionId: null, sessions: [] };
    let _bucketDirty = false;
    let _commitTimer = null;

    async function saveSessionFile(file_id, payload) {
        const ctx = SillyTavern.getContext();
        try {
            const jsonStr = JSON.stringify(payload);
            const b64 = btoa(unescape(encodeURIComponent(jsonStr)));
            const res = await fetch('/api/files/upload', {
                method: 'POST',
                headers: { ...ctx.getRequestHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: file_id, data: b64 })
            });
            return res.ok;
        } catch (e) {
            _dbgAdd('STORAGE_WRITE_FAILED', { file_id, error: e.message });
            console.error(`[${EXT_DISPLAY}] saveSessionFile error:`, e);
            return false;
        }
    }

    async function loadSessionFile(file_id) {
        try {
            const res = await fetch(`/user/files/${file_id}`);
            if (!res.ok) return null;
            return await res.json();
        } catch (e) {
            console.error(`[${EXT_DISPLAY}] loadSessionFile error:`, e);
            return null;
        }
    }

    async function initChatBucket() {
        const ctx = SillyTavern.getContext();
        if (!ctx.chatMetadata) ctx.chatMetadata = {};
        const { charId, chatId } = getBindingKey();
        const s = getSettings();
        
        let meta = ctx.chatMetadata.st_copilot;
        const safeChatId = chatId.replace(/[^a-zA-Z0-9_-]/g, '_');
        
        let v0Data = null;
        if (s.sessions && s.sessions[charId]) {
            if (s.sessions[charId][chatId] && s.sessions[charId][chatId].sessions?.length > 0) {
                v0Data = { ...s.sessions[charId][chatId] };
                delete s.sessions[charId][chatId];
            } else if (s.sessions[charId]['unified'] && s.sessions[charId]['unified'].sessions?.length > 0) {
                v0Data = { ...s.sessions[charId]['unified'] };
                delete s.sessions[charId]['unified'];
            }
            if (v0Data) saveSettings();
        }

        if (!meta && v0Data) {
            _dbgAdd('LEGACY_MIGRATION_STARTED');

            meta = { activeSessionId: v0Data.activeSessionId, sessions: v0Data.sessions };
        }

        if (!meta) {
            _inMemoryBucket = { activeSessionId: null, sessions: [] };
            ctx.chatMetadata.st_copilot = { file_id: `copilot_sess_${safeChatId}_${Date.now()}.json` };
            if (typeof ctx.saveMetadata === 'function') ctx.saveMetadata();
            await commitBucketChanges(true);
            return;
        }

        if (meta.file_id) {
            const payload = await loadSessionFile(meta.file_id);
            if (payload && payload.bucket) {
                _inMemoryBucket = payload.bucket;
            } else {
                _inMemoryBucket = { activeSessionId: null, sessions: [] };
                await commitBucketChanges(true);
            }
        } else if (meta.sessions) { 
            _inMemoryBucket = { activeSessionId: meta.activeSessionId, sessions: meta.sessions };
            ctx.chatMetadata.st_copilot = { file_id: `copilot_sess_${safeChatId}_${Date.now()}.json` };
            delete meta.sessions;
            delete meta.activeSessionId; 
            if (typeof ctx.saveMetadata === 'function') ctx.saveMetadata();
            await commitBucketChanges(true);
        } else {
            _inMemoryBucket = { activeSessionId: null, sessions: [] };
            ctx.chatMetadata.st_copilot = { file_id: `copilot_sess_${safeChatId}_${Date.now()}.json` };
            if (typeof ctx.saveMetadata === 'function') ctx.saveMetadata();
            await commitBucketChanges(true);
        }
    }

    async function commitBucketChanges(force = false) {
        _bucketDirty = true;
        
        const doCommit = async () => {
            if (!_bucketDirty) return;
            const ctx = SillyTavern.getContext();
            const { chatId } = getBindingKey();
            let file_id = ctx.chatMetadata?.st_copilot?.file_id;
            
            if (!file_id) {
                const safeChatId = chatId.replace(/[^a-zA-Z0-9_-]/g, '_');
                file_id = `copilot_sess_${safeChatId}_${Date.now()}.json`;
                if (!ctx.chatMetadata) ctx.chatMetadata = {};
                ctx.chatMetadata.st_copilot = { file_id };
                if (typeof ctx.saveMetadata === 'function') ctx.saveMetadata();
            }
            
            const payload = {
                _version: 2,
                chat_id_reference: chatId,
                updated_at: Date.now(),
                bucket: _inMemoryBucket
            };
            
            const success = await saveSessionFile(file_id, payload);
            if (success) _bucketDirty = false;
            else _dbgAdd('STORAGE_WRITE_FAILED', { file_id, reason: 'saveSessionFile returned false' });
        };

        if (force) {
            await doCommit();
        } else {
            clearTimeout(_commitTimer);
            _commitTimer = setTimeout(doCommit, 1000);
        }
    }

    function saveSessionsToMetadata() {
        commitBucketChanges();
    }

    function getChatBucket() {
        return _inMemoryBucket;
    }

    function genId(prefix) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

    function createSession(name, isTemporary = false, recordStats = true) {
        const bucket = getChatBucket();
        const id = genId('sess');
        const sess = { id, name: name || `Session ${bucket.sessions.length + 1}`, created: Date.now(), messages: [], isTemporary };
        
        if (recordStats) {
            const prev = bucket.sessions.find(s => s.id === bucket.activeSessionId);
            if (prev && prev.isTemporary) {
                bucket.sessions = bucket.sessions.filter(s => s.id !== prev.id);
            }
        }

        bucket.sessions.push(sess);
        bucket.activeSessionId = id;
        if (recordStats) recordStat(_SM.sess);
        saveSessionsToMetadata();
        _dbgAdd('SESSION_CREATED', { id: sess.id, name: sess.name, isTemporary });
        return sess;
    }

    function getActiveSession(autoCreate = true) {
        const bucket = getChatBucket();
        if (!bucket.sessions.length || !bucket.activeSessionId) {
            return autoCreate ? createSession(undefined, false, false) : null;
        }
        const sess = bucket.sessions.find(s => s.id === bucket.activeSessionId);
        if (sess) return sess;
        return autoCreate ? createSession(undefined, false, false) : null;
    }

    function setActiveSession(sessionId) {
        const bucket = getChatBucket();
        if (!bucket.sessions.find(s => s.id === sessionId)) return;
        const prev = bucket.sessions.find(s => s.id === bucket.activeSessionId);
        if (prev && prev.isTemporary && prev.id !== sessionId) {
            bucket.sessions = bucket.sessions.filter(s => s.id !== prev.id);
        }
        bucket.activeSessionId = sessionId;
        saveSessionsToMetadata();
        _dbgAdd('SESSION_SWITCHED', { id: sessionId });
    }

    function deleteCurrentSession() {
        const bucket = getChatBucket();
        if (!bucket.sessions.length) return createSession();
        const deletedId = bucket.activeSessionId;
        bucket.sessions = bucket.sessions.filter(s => s.id !== bucket.activeSessionId);
        bucket.activeSessionId = bucket.sessions.length ? bucket.sessions[bucket.sessions.length - 1].id : null;
        saveSessionsToMetadata();
        _dbgAdd('SESSION_DELETED', { id: deletedId });
        return getActiveSession(true);
    }

    function getCurrentSession() {
        return getActiveSession(true);
    }

    function addMessage(session, role, content, extra = {}) {
        const msg = { id: genId('msg'), role, content, timestamp: Date.now(), ...extra };
        session.messages.push(msg); 
        if (session.messages.length > 400) session.messages = session.messages.slice(-400);
        saveSessionsToMetadata(); 
        return msg;
    }

    function insertMessageAfter(session, afterMsgId, role, content, extra = {}) {
        const msg = { id: genId('msg'), role, content, timestamp: Date.now(), ...extra };
        const idx = afterMsgId ? session.messages.findIndex(m => m.id === afterMsgId) : -1;
        if (idx !== -1) session.messages.splice(idx + 1, 0, msg);
        else session.messages.push(msg);
        if (session.messages.length > 400) session.messages = session.messages.slice(-400);
        saveSessionsToMetadata();
        return msg;
    }

    function updateMessage(session, msgId, newContent) {
        const msg = session.messages.find(m => m.id === msgId);
        if (msg) { msg.content = newContent; saveSessionsToMetadata(); }
    }

    function truncateAfter(session, msgId) {
        const idx = session.messages.findIndex(m => m.id === msgId);
        if (idx !== -1) { session.messages.splice(idx + 1); saveSessionsToMetadata(); }
    }

    function deleteMsg(session, msgId) {
        const idx = session.messages.findIndex(m => m.id === msgId);
        if (idx !== -1) { session.messages.splice(idx, 1); saveSessionsToMetadata(); }
    }

    function truncateFrom(session, msgId) {
        const idx = session.messages.findIndex(m => m.id === msgId);
        if (idx !== -1) { session.messages.splice(idx); saveSessionsToMetadata(); }
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
            if (typeof ctx.substituteParams === 'function') {
                return ctx.substituteParams(text);
            }
            if (typeof window.substituteParams === 'function') {
                return window.substituteParams(text, ctx.name1, ctx.name2);
            }
        } catch (e) {
            console.warn(`[${EXT_DISPLAY}] Macro expansion error:`, e);
        }
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
        
        const _incHidden = getEffectiveSettings().includeHiddenMessages;
        const extractData = (m, i) => ({
            role: m.is_user ? 'user' : 'assistant',
            name: m.is_user ? (ctx.name1 || 'User') : (m.name || getCharInfo()?.name || 'Character'),
            content: typeof m.mes === 'string' ? m.mes : '',
            chatIndex: i,
            is_hidden: (!_incHidden && (!!m.is_system || !!m.is_hidden || !!(m.extra && m.extra.is_hidden))) || !!(m.extra?.sc_ghosted)
        });

        try {
            const sess = getCurrentSession();
            const picked = sess.pickedChatIndices;
            if (picked && picked.length > 0) {
                return picked
                    .filter(i => i >= 0 && i < ctx.chat.length)
                    .map(i => extractData(ctx.chat[i], i));
            }
        } catch(_) {}
        
        if (depth === 0) return [];
        const total = ctx.chat.length;
        return ctx.chat.slice(-depth).map((m, i) => extractData(m, total - depth + i));
    }

    // ─── Payload Assembly ───────────────────────────────────────────────────────

    function _getSummaryceptionSummary() {
        try {
            const ctx = SillyTavern.getContext();
            if (ctx.extensionSettings?.summaryception?.enabled === false) return null;
            const store = ctx.chatMetadata?.summaryception;
            if (!store || !Array.isArray(store.layers)) return null;
            const snippets = [];
            for (let i = store.layers.length - 1; i >= 1; i--) {
                const layer = store.layers[i];
                if (layer && layer.length) snippets.push(...layer.map(sn => sn.text).filter(Boolean));
            }
            if (store.layers[0] && store.layers[0].length) {
                snippets.push(...store.layers[0].map(sn => sn.text).filter(Boolean));
            }
            if (!snippets.length) return null;
            const summaryText = snippets.join(' ');
            const template = ctx.extensionSettings?.summaryception?.injectionTemplate || '<summary>\n{{summary}}\n</summary>';
            return template.replace('{{summary}}', summaryText).trim();
        } catch(_) {}
        return null;
    }

    function _getAspectEvolutiaCharFields() {
        try {
            const ctx = SillyTavern.getContext();
            const char = ctx.characters?.[ctx.characterId];
            if (!char) return null;
            const AE_KEY = 'st-description-swap-fields';
            const state = char.data?.extensions?.[AE_KEY];
            if (!state || !state.swapEnabled) return null;
            const activeId = state.activeAlterEgoId || 'base';
            const alterEgos = Array.isArray(state.alterEgos) ? state.alterEgos : [];
            const activeEgo = alterEgos.find(a => a.id === activeId) || alterEgos[0];
            const fields = Array.isArray(activeEgo?.fields) ? activeEgo.fields : (Array.isArray(state.fields) ? state.fields : []);
            const enabled = fields.filter(f => f.enabled !== false && f.content?.trim());
            if (!enabled.length) return null;
            return enabled.map(f => ({ id: f.id, name: f.name || 'Field', content: f.content }));
        } catch(_) { return null; }
    }

    function _getAspectEvolutiaPersonaFields() {
        try {
            const ctx = SillyTavern.getContext();
            const pu = window.power_user || ctx.powerUserSettings || {};
            let personaId = window.user_avatar || ctx.user_avatar || ctx.userAvatar || ctx.personaId || ctx.activePersonaId || ctx.active_persona_id;
            if (!personaId && typeof document !== 'undefined') {
                const selected = document.querySelector('#user_avatar_block .avatar-container.selected, #persona_container .avatar-container.selected, .persona_selected');
                if (selected) personaId = selected.getAttribute('data-avatar-id') || selected.dataset?.avatarId;
            }
            if (typeof personaId === 'object' && personaId !== null) personaId = personaId.avatarId || personaId.avatar_id || personaId.user_avatar || personaId.userAvatar || personaId.id;
            if (!personaId) return null;

            const AE_KEY = 'st-description-swap-fields';
            const personaState = pu[AE_KEY]?.personaDynamicFields?.[personaId];
            if (!personaState || !personaState.swapEnabled) return null;
            
            const activeId = personaState.activeAlterEgoId || 'base';
            const alterEgos = Array.isArray(personaState.alterEgos) ? personaState.alterEgos : [];
            const activeEgo = alterEgos.find(a => a.id === activeId) || alterEgos[0];
            const fields = Array.isArray(activeEgo?.fields) ? activeEgo.fields : (Array.isArray(personaState.fields) ? personaState.fields : []);
            const enabled = fields.filter(f => f.enabled !== false && f.content?.trim());
            if (!enabled.length) return null;
            return enabled.map(f => ({ id: f.id, name: f.name || 'Field', content: f.content }));
        } catch(e) { return null; }
    }

    

    async function buildSystemContent(settings) {
        let sysPromptRaw = (typeof settings.systemPrompt === 'string' && settings.systemPrompt.trim()) ? settings.systemPrompt : DEFAULT_SYSTEM_PROMPT;
        const parts = [_ensureWrapped(sysPromptRaw, 'system_prompt')];
        const charInfo = getCharInfo();
        const ctx = SillyTavern.getContext();

        if (settings.includeSystemPrompt) {
            const sp = getSystemPromptText();
            if (sp) parts.push(`\n\n<st_system_prompt>\n${sp}\n</st_system_prompt>`);
        }

        if (ctx.groupId && ctx.groups) {
            const group = ctx.groups.find(g => g.id === ctx.groupId);
            if (group && Array.isArray(group.members)) {
                const memberNames = group.members.map(m => {
                    const c = ctx.characters.find(char => char.avatar === m);
                    return c ? c.name : m;
                }).filter(Boolean);
                if (memberNames.length > 0) {
                    parts.push(`\n<chat_group_members>\nThats chat with multiple characters. Current group members: ${memberNames.join(', ')}\n</chat_group_members>`);
                }
            }
        }

        const memoryBlock = buildMemoryContextBlock()
        if (memoryBlock) parts.push(memoryBlock);

        const lbBlock = await buildLorebookContextBlock(settings);
        if (lbBlock) parts.push(lbBlock);

        {
            const editXml = buildCharacterContextBlock(settings);
            let inner = `Name: ${charInfo ? charInfo.name : (ctx.name2 || 'Character')}\n`;
            if (editXml) inner += '\n' + editXml;
            parts.push(`\n\n<character_information>\n${inner}\n</character_information>`);
        }

        {
            const userName = ctx.name1 || 'User';
            let inner = `Name: ${userName}`;
            
            if (settings.includeUserPersonality) {
                let hasEvolutia = false;
                if (settings.useAspectEvolutia) {
                    const aeUserFields = _getAspectEvolutiaPersonaFields();
                    if (aeUserFields && aeUserFields.length) {
                        const aeContent = aeUserFields.map(f => `<evolutia_user_field name="${escHtml(f.name)}">\n${f.content}\n</evolutia_user_field>`).join('\n\n');
                        inner += `\n${aeContent}`;
                        hasEvolutia = true;
                    }
                }
                if (!hasEvolutia) {
                    const personaContent = getUserPersona();
                    if (personaContent) inner += `\n${personaContent}`;
                }
            }
            parts.push(`\n\n<{{user}}_persona>\n${inner}\n</{{user}}_persona>`);
        }

        const aiInstructions = buildLBAIInstructions(settings).trim();
        const charEditDirective = buildCharEditAIInstructions(settings).trim();
        const chatEditDirective = buildChatEditAIInstructions(settings).trim();
        const memoryAIInstr = buildMemoryAIInstructions().trim();
        const toolsBlock = buildToolCallsSystemBlock().trim();

        const modules = [memoryAIInstr, aiInstructions, charEditDirective, chatEditDirective, toolsBlock].filter(Boolean);
        if (modules.length > 0) {
            parts.push(`\n\n<modules>\n${modules.join('\n\n')}\n</modules>`);
        }

        return parts.join('\n');
    }

    function _buildAiContextForHistoryMsg(msg) {
        try {
            const lines = msg.swipes?.[msg.swipeIndex || 0]?.historyLines || msg.appliedLines || [];
            const entries = lines.map(line => {
                const plain = line.replace(/\*\*/g, '').replace(/`/g, '');
                const statusMatch = plain.match(/^[✓✕·]\s+(ACCEPTED|REJECTED|DISMISSED[^:]*)/);
                const status = statusMatch ? statusMatch[1] : 'UNKNOWN';
                const restMatch = plain.match(/(?:ACCEPTED|REJECTED|DISMISSED[^:]*): (.+)/);
                const detail = restMatch ? restMatch[1].trim() : plain;
                return { status, detail };
            });
            
            const ctg = msg.isCharEditHistory ? 'character_card_changes' : (msg.isChatEditHistory ? 'chat_messages_edits' : 'lorebook_changes');
            
            const obj = {
                type: 'system_notification',
                category: ctg,
                entries,
            };
            const jsonStr = JSON.stringify(obj, null, 2);
            return `${jsonStr}\n\n[System Note: Your generated \`${ctg}\` code block has been deleted to save tokens. This message indicates the user's actions and decisions regarding your proposed changes. You didn't miss anything and you wrote everything correctly in your message. You don't need to write this code block again]`;
        } catch (_) {
            return msg.content || '';
        }
    }

    async function assembleMessages(session, settings, pendingUserText, pendingAtts = null) {
        const messages = [{ role: 'system', content: await buildSystemContent(settings) }];
        const depth = Math.max(0, parseInt(settings.contextDepth) || 0);
        const hasPicked = !!(session.pickedChatIndices && session.pickedChatIndices.length > 0);
        
        if (depth > 0 || hasPicked) {
            const slice = getMainChatSlice(depth);
            if (slice.length) {
                const chatTotal = SillyTavern.getContext().chat?.length ?? 0;
                const processedSlice = await Promise.all(slice.map(async m => ({
                    ...m, content: await applyRegexIfEnabled(m.content, m.role === 'user', chatTotal - m.chatIndex - 1),
                })));
                const ctx = SillyTavern.getContext();
                const visibleSlice = processedSlice.filter(m => !m.is_hidden);

                if (settings.includeAlternateSwipes && visibleSlice.length > 0) {
                    let lastAstMsg = null;
                    for (let i = visibleSlice.length - 1; i >= 0; i--) {
                        if (visibleSlice[i].role === 'assistant') {
                            lastAstMsg = visibleSlice[i];
                            break;
                        }
                    }
                    if (lastAstMsg) {
                        const stChatMsg = ctx.chat[lastAstMsg.chatIndex];
                        if (stChatMsg && Array.isArray(stChatMsg.swipes) && stChatMsg.swipes.length > 1) {
                            let swipesXml = '<alternate_swipes>\n';
                            const activeSwipeId = stChatMsg.swipe_id ?? 0;
                            stChatMsg.swipes.forEach((sw, idx) => {
                                if (idx === activeSwipeId) return;
                                const text = typeof sw === 'string' ? sw : (sw.mes || '');
                                if (text) swipesXml += `<swipe index="${idx}">\n${text}\n</swipe>\n`;
                            });
                            swipesXml += '</alternate_swipes>\n';
                            lastAstMsg.content = swipesXml + lastAstMsg.content;
                        }
                    }
                }

                const block = visibleSlice.map(m => {
                    return `<msg index="${m.chatIndex}" role="${m.role === 'user' ? 'user' : 'assistant'}">\n${m.content}\n</msg>`;
                }).join('\n\n');
                
                let summaryText = '';
                if (settings.includeSummaryception !== false) {
                    const scSummary = _getSummaryceptionSummary();
                    if (scSummary) summaryText = `\n<summary_context>\n${scSummary}\n</summary_context>\n\n`;
                }

                const ctxAttr = hasPicked ? `picked_messages="${visibleSlice.length}"` : `last_messages="${visibleSlice.length}"`;
                messages.push({
                    role: 'user',
                    content: `<roleplay_context ${ctxAttr}>\n${summaryText}${block}\n\n</roleplay_context>`,
                });
                messages.push({ role: 'assistant', content: 'Understood. I have reviewed the current roleplay context. How can I help?' });
            }
        }
        const limit = Math.max(1, parseInt(settings.localHistoryLimit) || 50);
        for (const m of session.messages.slice(-limit)) {
            let content = m.content;
            
            const currentSwipe = m.swipes?.[m.swipeIndex || 0];
            const hasAttachedHistory = currentSwipe?.historyLines?.length > 0;

            if (m.isLBHistory || m.isCharEditHistory || m.isChatEditHistory) {
                content = _buildAiContextForHistoryMsg(m);
                messages.push({ role: 'user', content: _mergeContent(content, m.attachments) });
            } else {
                const finalContent = _mergeContent(content, m.attachments);
                let apiRole = m.role;
                if (apiRole === 'system') apiRole = 'user';
                
                messages.push({ role: apiRole, content: finalContent });

                if (hasAttachedHistory) {
                    let cat = 'system_action_results';
                    const firstLine = currentSwipe.historyLines[0] || '';
                    if (firstLine.includes('Character') || firstLine.includes('Tags') || firstLine.includes('Description') || firstLine.includes('Personality')) cat = 'character_card_changes';
                    else if (firstLine.includes('message')) cat = 'chat_messages_edits';
                    else cat = 'lorebook_changes';

                    const dummy = { appliedLines: currentSwipe.historyLines, isCharEditHistory: cat === 'character_card_changes', isChatEditHistory: cat === 'chat_messages_edits' };
                    const historyContext = _buildAiContextForHistoryMsg(dummy);
                    
                    messages.push({ role: 'user', content: historyContext });
                }
            }
        }
        if (pendingUserText !== null && pendingUserText !== undefined) {
            const finalContent = _mergeContent(pendingUserText, pendingAtts);
            if (finalContent || (Array.isArray(finalContent) && finalContent.length)) {
                messages.push({ role: 'user', content: finalContent });
            }
        }
        return messages;
    }

    function formatPayloadAsText(messages) {
        return messages.map(m => {
            const label = m.role === 'system' ? '■ SYSTEM' : m.role === 'user' ? '▶ USER' : '◀ ASSISTANT';
            let c = m.content;
            if (Array.isArray(c)) {
                c = c.map(part => {
                    if (part.type === 'text') return part.text;
                    if (part.type === 'image_url') return `[Image Base64 Attached]`;
                    return `[Unknown Block]`;
                }).join('\n');
            }
            return `${label}\n${'─'.repeat(50)}\n${c}`;
        }).join('\n\n');
    }

    // ─── API Generation ─────────────────────────────────────────────────────────

    let _abortController = null;

    const _htmlBlockRegistry = new Map();
    let _htmlBlockCounter = 0;

    async function callGenerate(session, settings, pendingText, onChunk) {
        const ctx = SillyTavern.getContext();
        const messages = await assembleMessages(session, settings, pendingText);
        const maxTokens = parseInt(settings.maxTokens) || 8200;

        const abort = new AbortController();
        _abortController = abort;

        const streamSetting = settings.forceStreaming;
        let useStream;

        if (streamSetting === 'on' || streamSetting === true) {
            useStream = true;
        } else if (streamSetting === 'off') {
            useStream = false;
        } else {
            useStream = !!(document.getElementById('stream_toggle')?.checked
                ?? ctx.chatCompletionSettings?.stream_openai
                ?? ctx.textCompletionSettings?.streaming
                ?? true);
        }

        // Couldnt get the reasoning block via "extractData: true" (maybe skill issue), so Im building my own extractor
        function deepExtract(obj) {
            if (!obj || typeof obj !== 'object') return { t: '', r: null };
            
            let r = null;
            
            // 1. SillyTavern extracted data & Ollama
            if (typeof obj.state?.reasoning === 'string' && obj.state.reasoning !== '') r = obj.state.reasoning;
            else if (typeof obj.reasoning === 'string' && obj.reasoning !== '') r = obj.reasoning;
            else if (typeof obj.reasoning_content === 'string' && obj.reasoning_content !== '') r = obj.reasoning_content;
            else if (typeof obj.thinking === 'string' && obj.thinking !== '') r = obj.thinking;

            // 2. OpenAI / DeepSeek / Custom (Nested)
            else if (typeof obj.original_response?.choices?.[0]?.message?.reasoning === 'string' && obj.original_response.choices[0].message.reasoning !== '') r = obj.original_response.choices[0].message.reasoning;
            else if (typeof obj.original_response?.choices?.[0]?.message?.reasoning_content === 'string' && obj.original_response.choices[0].message.reasoning_content !== '') r = obj.original_response.choices[0].message.reasoning_content;
            else if (typeof obj.choices?.[0]?.message?.reasoning === 'string' && obj.choices[0].message.reasoning !== '') r = obj.choices[0].message.reasoning;
            else if (typeof obj.choices?.[0]?.message?.reasoning_content === 'string' && obj.choices[0].message.reasoning_content !== '') r = obj.choices[0].message.reasoning_content;
            else if (typeof obj.choices?.[0]?.delta?.reasoning === 'string' && obj.choices[0].delta.reasoning !== '') r = obj.choices[0].delta.reasoning;
            else if (typeof obj.choices?.[0]?.delta?.reasoning_content === 'string' && obj.choices[0].delta.reasoning_content !== '') r = obj.choices[0].delta.reasoning_content;

            // 3. Google (Gemini) - Makersuite / VertexAI
            if (!r) {
                const getGeminiThoughts = (src) => {
                    if (Array.isArray(src?.responseContent?.parts)) return src.responseContent.parts;
                    if (Array.isArray(src?.candidates?.[0]?.content?.parts)) return src.candidates[0].content.parts;
                    return [];
                };
                const geminiParts = [...getGeminiThoughts(obj), ...getGeminiThoughts(obj.original_response)];
                const geminiThoughts = geminiParts.filter(p => p.thought || p.thought === null).map(p => p.text).filter(Boolean);
                if (geminiThoughts.length > 0) r = geminiThoughts.join('\n\n');
            }
            
            // 4. Claude (Anthropic)
            if (!r) {
                const getClaudeThoughts = (src) => Array.isArray(src?.content) ? src.content : [];
                const claudeParts = [...getClaudeThoughts(obj), ...getClaudeThoughts(obj.original_response)];
                const claudeThoughts = claudeParts.filter(p => p.type === 'thinking').map(p => p.thinking).filter(Boolean);
                if (claudeThoughts.length > 0) r = claudeThoughts.join('\n\n');
            }
                
            // 5. Mistral AI
            if (!r) {
                const getMistralContent = (src) => Array.isArray(src?.choices?.[0]?.message?.content) ? src.choices[0].message.content : [];
                const mistralParts = [...getMistralContent(obj), ...getMistralContent(obj.original_response)];
                let mistralThoughts = [];
                for (const part of mistralParts) {
                    if (Array.isArray(part.thinking)) mistralThoughts.push(...part.thinking.map(t => t.text).filter(Boolean));
                    else if (part.type === 'thinking' || part.thinking) mistralThoughts.push(typeof part.thinking === 'string' ? part.thinking : part.text);
                }
                if (mistralThoughts.length > 0) r = mistralThoughts.join('\n\n');
            }

            // Text content extraction
            let t = '';
            if (typeof obj.text === 'string' && obj.text !== '') t = obj.text;
            else if (typeof obj.content === 'string' && obj.content !== '') t = obj.content;
            else if (Array.isArray(obj.content)) {
                const textParts = obj.content.filter(p => p.type === 'text' || (p.text && !p.thought && p.type !== 'thinking')).map(p => p.text).filter(Boolean);
                if (textParts.length > 0) t = textParts.join('\n');
            }
            else if (Array.isArray(obj.responseContent?.parts)) {
                const textParts = obj.responseContent.parts.filter(p => !p.thought && p.thought !== null).map(p => p.text).filter(Boolean);
                if (textParts.length > 0) t = textParts.join('\n');
            }
            else if (typeof obj.message?.content === 'string' && obj.message.content !== '') t = obj.message.content;
            else if (typeof obj.original_response?.choices?.[0]?.message?.content === 'string' && obj.original_response.choices[0].message.content !== '') t = obj.original_response.choices[0].message.content;
            else if (typeof obj.choices?.[0]?.message?.content === 'string' && obj.choices[0].message.content !== '') t = obj.choices[0].message.content;
            else if (typeof obj.choices?.[0]?.delta?.content === 'string' && obj.choices[0].delta.content !== '') t = obj.choices[0].delta.content;
            else if (typeof obj.choices?.[0]?.text === 'string' && obj.choices[0].text !== '') t = obj.choices[0].text;
            else if (typeof obj.results?.[0]?.text === 'string' && obj.results[0].text !== '') t = obj.results[0].text;
            else if (Array.isArray(obj.original_response?.candidates?.[0]?.content?.parts)) {
                const textParts = obj.original_response.candidates[0].content.parts.filter(p => !p.thought && p.thought !== null).map(p => p.text).filter(Boolean);
                if (textParts.length > 0) t = textParts.join('\n');
            }
            else if (Array.isArray(obj.candidates?.[0]?.content?.parts)) {
                const textParts = obj.candidates[0].content.parts.filter(p => !p.thought && p.thought !== null).map(p => p.text).filter(Boolean);
                if (textParts.length > 0) t = textParts.join('\n');
            }

            return { t, r };
        }

        // ── CUSTOM ENDPOINT LOGIC ──
        if (settings.connectionSource === 'custom') {
            let text = '';
            let reasoning = null;
            let reasoningStartMs = null;
            let reasoningDone = false;

            try {
                const url = (settings.customUrl || 'http://localhost:5000/v1').replace(/\/+$/, '') + '/chat/completions';
                const payload = {
                    model: settings.customModel || 'gpt-3.5-turbo',
                    messages: messages,
                    max_tokens: maxTokens,
                    stream: useStream
                };
                const headers = { 'Content-Type': 'application/json' };
                if (settings.customKey) headers['Authorization'] = `Bearer ${settings.customKey}`;

                const res = await fetch(url, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(payload),
                    signal: abort.signal
                });

                if (!res.ok) {
                    const errText = await res.text().catch(() => res.statusText);
                    throw new Error(`Custom API Error ${res.status}: ${errText}`);
                }

                if (useStream) {
                    const reader = res.body.getReader();
                    const decoder = new TextDecoder("utf-8");
                    let buffer = "";

                    while (true) {
                        if (abort.signal.aborted) { _abortController = null; return null; }
                        const { done, value } = await reader.read();
                        if (done) break;
                        
                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop(); 

                        for (const line of lines) {
                            const l = line.trim();
                            if (!l || l.startsWith(':') || l === 'data: [DONE]') continue;
                            if (l.startsWith('data: ')) {
                                try {
                                    const data = JSON.parse(l.slice(6));
                                    const ext = deepExtract(data);
                                    if (ext.t) text += ext.t;
                                    if (ext.r) {
                                        if (reasoningStartMs === null) reasoningStartMs = performance.now();
                                        reasoning = (reasoning || '') + ext.r;
                                    }
                                    if (text && !reasoningDone && reasoning) {
                                        reasoningDone = true;
                                        data._finalReasoningMs = performance.now() - reasoningStartMs;
                                    }
                                    if (typeof onChunk === 'function') {
                                        const rMs = reasoningDone && data._finalReasoningMs ? data._finalReasoningMs : (reasoningStartMs !== null ? performance.now() - reasoningStartMs : null);
                                        onChunk(text, reasoning, rMs, reasoningDone);
                                    }
                                } catch (e) {}
                            }
                        }
                    }
                } else {
                    const data = await res.json();
                    const ext = deepExtract(data);
                    text = ext.t || '';
                    reasoning = ext.r;
                }
            } catch (e) {
                _abortController = null;
                if (abort.signal.aborted || e?.name === 'AbortError') return null;
                throw e;
            }

            _abortController = null;
            return { text: text.trim(), reasoning, isMaxTokens: false };
        }
        // ── END CUSTOM ENDPOINT LOGIC ──

        const service = ctx.ConnectionManagerRequestService;
        if (!service || typeof service.sendRequest !== 'function') {
            throw new Error('ConnectionManagerRequestService not available. Please ensure the Connection Manager extension is enabled in SillyTavern.');
        }

        let profiles = [];
        if (typeof service.getSupportedProfiles === 'function') {
            profiles = service.getSupportedProfiles();
        } else {
            profiles = ctx.extensionSettings?.connectionManager?.profiles || [];
        }

        let profileId = null;

        if (settings.connectionSource === 'profile') {
            if (settings.connectionProfileId) {
                const found = profiles.find(p =>
                    p.id === settings.connectionProfileId || p.name === settings.connectionProfileId
                );
                if (found) {
                    profileId = found.id;
                } else {
                    throw new Error(`Connection profile "${settings.connectionProfileId}" not found. Available: ${profiles.map(p => p.name).join(', ') || 'None'}`);
                }
            } else {
                throw new Error('No profile selected in ST-Copilot settings.');
            }
        } else {
            profileId = ctx.extensionSettings?.connectionManager?.selectedProfile;
            if (!profileId) {
                const domSelect = document.getElementById('connection_profiles');
                if (domSelect && domSelect.value) {
                    profileId = domSelect.value;
                }
            }
        }

        if (!profileId) {
            throw new Error('No active profile found. Please select a profile in the SillyTavern Connection Manager UI, or assign a specific profile in ST-Copilot settings.');
        }

        let asyncGeneratorFn;
        const origFetch = window.fetch;
        
        window.fetch = async function(...args) {
            let requestUrl = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
            if ((requestUrl.includes('/generate') || requestUrl.includes('/caption-image')) && args[1] && typeof args[1].body === 'string') {
                try {
                    let reqBody = JSON.parse(args[1].body);
                    let changed = false;
                    
                    if (reqBody.reasoning_effort === 'auto') { delete reqBody.reasoning_effort; changed = true; }
                    else if (reqBody.reasoning_effort === 'min') { reqBody.reasoning_effort = 'low'; changed = true; }
                    else if (reqBody.reasoning_effort === 'max') { reqBody.reasoning_effort = 'high'; changed = true; }

                    if (reqBody.reasoning && typeof reqBody.reasoning === 'object') {
                        if (reqBody.reasoning.effort === 'auto') { delete reqBody.reasoning.effort; changed = true; }
                        else if (reqBody.reasoning.effort === 'min') { reqBody.reasoning.effort = 'low'; changed = true; }
                        else if (reqBody.reasoning.effort === 'max') { reqBody.reasoning.effort = 'high'; changed = true; }
                    }

                    if (reqBody.custom_prompt_post_processing === '') { delete reqBody.custom_prompt_post_processing; changed = true; }
                    if (reqBody.request_image_resolution === '') { delete reqBody.request_image_resolution; changed = true; }
                    if (reqBody.request_image_aspect_ratio === '') { delete reqBody.request_image_aspect_ratio; changed = true; }
                    
                    if (changed) args[1].body = JSON.stringify(reqBody);
                } catch(_) {}
            }
            return origFetch.apply(this, args);
        };

        try {
            asyncGeneratorFn = await service.sendRequest(profileId, messages, maxTokens, {
                stream: useStream,
                signal: abort.signal,
                extractData: false,
                includePreset: true
            });
        } catch (e) {
            if (useStream && !abort.signal.aborted && e?.name !== 'AbortError' && e?.message !== 'userStopped') {
                console.warn(`[${EXT_DISPLAY}] Streaming failed, falling back to non-streaming:`, e);
                _dbgAdd('GEN_STREAM_FALLBACK', { error: e.message || String(e) });
                useStream = false;
                try {
                    asyncGeneratorFn = await service.sendRequest(profileId, messages, maxTokens, {
                        stream: false,
                        signal: abort.signal,
                        extractData: false,
                        includePreset: true
                    });
                } catch (err2) {
                    _abortController = null;
                    if (abort.signal.aborted || err2?.name === 'AbortError' || err2?.message === 'userStopped') return null;
                    throw err2;
                }
            } else {
                _abortController = null;
                if (abort.signal.aborted || e?.name === 'AbortError' || e?.message === 'userStopped') return null;
                throw e;
            }
        } finally {
            window.fetch = origFetch;
        }

        let text = '';
        let reasoning = null;
        let reasoningStartMs = null;
        let reasoningDone = false;

        const isGen = typeof asyncGeneratorFn === 'function' ||
            (asyncGeneratorFn != null && typeof asyncGeneratorFn[Symbol.asyncIterator] === 'function') ||
            (asyncGeneratorFn != null && typeof asyncGeneratorFn.next === 'function');

        let lastValue = null;

        if (!isGen) {
            const value = asyncGeneratorFn;
            if (typeof value === 'string') {
                text = value.trim();
            } else {
                const ext = deepExtract(value);
                text = ext.t.trim();
                reasoning = ext.r;
                lastValue = value;
            }
            
            const finishReason = lastValue?.finish_reason || lastValue?.state?.finish_reason || lastValue?.stop_reason;
            const isMaxTokens = finishReason === 'length' || finishReason === 'max_tokens' || finishReason === 'stop_limit';

            _abortController = null;
            return { text, reasoning, isMaxTokens };
        }

        const gen = typeof asyncGeneratorFn === 'function' ? asyncGeneratorFn() : asyncGeneratorFn;

        try {
            while (true) {
                if (abort.signal.aborted) { _abortController = null; return null; }
                const { value, done } = await gen.next();
                if (done) {
                    if (value) lastValue = value;
                    break;
                }
                lastValue = value;

                const ext = deepExtract(value);
                text = ext.t;
                const newReasoning = ext.r;

                if (newReasoning) {
                    if (reasoningStartMs === null) reasoningStartMs = performance.now();
                    reasoning = newReasoning;
                }
                if (text && !reasoningDone && reasoning) {
                    reasoningDone = true;
                    lastValue._finalReasoningMs = performance.now() - reasoningStartMs;
                }

                if (typeof onChunk === 'function') {
                    const reasoningMs = reasoningDone && lastValue?._finalReasoningMs 
                        ? lastValue._finalReasoningMs 
                        : (reasoningStartMs !== null ? performance.now() - reasoningStartMs : null);
                    onChunk(text, reasoning, reasoningMs, reasoningDone);
                }
            }
        } catch (e) {
            _abortController = null;
            if (abort.signal.aborted || e?.name === 'AbortError' || e?.message === 'userStopped') return null;
            throw e;
        }

        const finishReason = lastValue?.finish_reason || lastValue?.state?.finish_reason || lastValue?.stop_reason;
        const isMaxTokens = finishReason === 'length' || finishReason === 'max_tokens' || finishReason === 'stop_limit';

        _abortController = null;
        return { text: text.trim(), reasoning, isMaxTokens };
    }

    // ─── SVG Icons ──────────────────────────────────────────────────────────────

    const I = {
        diff: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg>`,
        copy: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
        edit: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
        trash: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
        send: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`,
        search: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
        refresh: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`,
        minus: `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
        x: `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
        plus: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
        bot: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7" /><ellipse cx="12" cy="12" rx="11" ry="3" transform="rotate(-25 12 12)" /><circle cx="21.5" cy="7.5" r="1.5" fill="currentColor" stroke="none" /></svg>`,
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
        star: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
        starFill: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
        continueArrow: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>`,
        chevronLeft: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>`,
        chevronRight: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>`,
        chatEdit: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4c0-1.1.9-2 2-2h8a2 2 0 0 1 2 2v5Z"/><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"/></svg>`,
        paperclip: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`,
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

        if (visible) {
            bar.classList.add('scp-qp-bar--open');
        } else {
            bar.classList.remove('scp-qp-bar--open');
        }
        if (toggleBtn) toggleBtn.classList.toggle('active', s.quickPromptsVisible);
    }

    let _qpIconPickerEl = null;

    function showQPIconPicker(anchorEl, currentIcon, onSelect) {
        if (_qpIconPickerEl && _qpIconPickerEl.__anchor === anchorEl) { 
            _qpIconPickerEl.remove(); 
            _qpIconPickerEl = null; 
            return; 
        }
        if (_qpIconPickerEl) { _qpIconPickerEl.remove(); _qpIconPickerEl = null; }
        
        const pop = document.createElement('div');
        pop.className = 'scp-qp-icon-picker';
        pop.__anchor = anchorEl;

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

    // ─── Preset Dropdown (beautiful floating panel) ───────────────────────────────

    let _activePresetPanel = null;

    function openPresetDropdown(triggerEl, groups, onSelect, opts = {}) {
        // groups: [{ label, items: [{ name, value, preview, badge }] }]
        const { placeholder = 'Search…', width = 320, emptyText = 'Nothing here' } = opts;

        if (_activePresetPanel) {
            _activePresetPanel.remove();
            _activePresetPanel = null;
            triggerEl.classList.remove('open');
            return; // toggle close
        }

        triggerEl.classList.add('open');

        const panel = document.createElement('div');
        panel.className = 'scp-pdd-panel';
        panel.style.width = `${width}px`;
        _activePresetPanel = panel;

        const allItems = groups.flatMap(g => g.items);

        if (allItems.length > 6) {
            const sw = document.createElement('div');
            sw.className = 'scp-pdd-search-wrap';
            const si = document.createElement('input');
            si.type = 'text'; si.placeholder = placeholder;
            si.className = 'scp-pdd-search';
            si.addEventListener('input', () => renderContent(si.value.trim().toLowerCase()));
            sw.appendChild(si);
            panel.appendChild(sw);
            setTimeout(() => si.focus(), 60);
        }

        const listEl = document.createElement('div');
        listEl.className = 'scp-pdd-list';
        panel.appendChild(listEl);

        const renderContent = (q = '') => {
            listEl.innerHTML = '';
            let totalShown = 0;
            groups.forEach(group => {
                const filtered = q
                    ? group.items.filter(it => it.name.toLowerCase().includes(q) || (it.preview || '').toLowerCase().includes(q))
                    : group.items;
                if (!filtered.length) return;
                totalShown += filtered.length;
                if (group.label) {
                    const hdr = document.createElement('div');
                    hdr.className = 'scp-pdd-group-label';
                    hdr.textContent = group.label;
                    listEl.appendChild(hdr);
                }
                filtered.forEach(item => {
                    const row = document.createElement('div');
                    row.className = 'scp-pdd-item';
                    const top = document.createElement('div');
                    top.className = 'scp-pdd-item-top';
                    const name = document.createElement('span');
                    name.className = 'scp-pdd-item-name';
                    name.textContent = item.name;
                    top.appendChild(name);
                    if (item.badge) {
                        const b = document.createElement('span');
                        b.className = `scp-pdd-badge scp-pdd-badge--${item.badge}`;
                        b.textContent = item.badge;
                        top.appendChild(b);
                    }
                    row.appendChild(top);
                    if (item.preview) {
                        const prev = document.createElement('div');
                        prev.className = 'scp-pdd-item-preview';
                        prev.textContent = item.preview;
                        row.appendChild(prev);
                    }
                    row.addEventListener('click', () => {
                        onSelect(item.value, item.name, item);
                        closePresetPanel();
                    });
                    listEl.appendChild(row);
                });
            });
            if (!totalShown) {
                const empty = document.createElement('div');
                empty.className = 'scp-pdd-empty';
                empty.textContent = q ? 'No results' : emptyText;
                listEl.appendChild(empty);
            }
        };

        renderContent();
        document.body.appendChild(panel);

        const rect = triggerEl.getBoundingClientRect();
        panel.style.cssText += `;position:fixed;z-index:999999;top:${rect.bottom + 5}px;left:${rect.left}px;max-width:calc(100vw - 16px)`;
        requestAnimationFrame(() => {
            const pr = panel.getBoundingClientRect();
            if (pr.right > window.innerWidth - 8) panel.style.left = `${window.innerWidth - pr.width - 8}px`;
            if (pr.bottom > window.innerHeight - 8) panel.style.top = `${rect.top - pr.height - 5}px`;
        });

        setTimeout(() => {
            const onOut = e => {
                if (!panel.contains(e.target) && e.target !== triggerEl) {
                    closePresetPanel();
                    document.removeEventListener('mousedown', onOut, true);
                }
            };
            document.addEventListener('mousedown', onOut, true);
        }, 0);
    }

    function closePresetPanel() {
        if (_activePresetPanel) { _activePresetPanel.remove(); _activePresetPanel = null; }
        document.querySelectorAll('.scp-pdd-trigger.open, .scp-preset-mgr-trigger.open')
            .forEach(el => el.classList.remove('open'));
    }

    // ─── Prompt Preset Manager ────────────────────────────────────────────────────

    function buildPromptPresetManager(containerEl, getTextFn, setTextFn, dictKey = 'promptPresets') {
        if (!containerEl) return;
        containerEl.innerHTML = '';
        const s = getSettings();
        if (!s[dictKey]) s[dictKey] = {};

        let _activeName = '';
        let _activeSource = '';

        const bar = document.createElement('div');
        bar.className = 'scp-preset-mgr-bar';

        // Trigger
        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'scp-preset-mgr-trigger';
        trigger.innerHTML = `<span class="scp-pmt-label">Select a preset…</span><svg class="scp-pmt-chevron" xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>`;

        const labelEl = trigger.querySelector('.scp-pmt-label');

        const setActive = (name, source) => {
            _activeName = name;
            _activeSource = source;
            labelEl.textContent = name || 'Select a preset…';
            trigger.classList.toggle('scp-pmt--has-value', !!name);
            updateBtnStates();
        };

        const buildGroups = () => {
            const groups = [];
            const profileItems = Object.keys(s.profiles || {})
                .filter(n => s.profiles[n].systemPrompt)
                .map(n => ({
                    name: n,
                    value: s.profiles[n].systemPrompt,
                    preview: (s.profiles[n].systemPrompt || '').replace(/\s+/g, ' ').slice(0, 80),
                    badge: 'profile',
                    _source: 'profile',
                }));
            if (profileItems.length) groups.push({ label: 'From Profiles', items: profileItems });

            const customItems = Object.keys(s[dictKey])
                .map(n => ({
                    name: n,
                    value: s[dictKey][n],
                    preview: (s[dictKey][n] || '').replace(/\s+/g, ' ').slice(0, 80),
                    badge: 'custom',
                    _source: 'custom',
                }));
            if (customItems.length) groups.push({ label: 'Custom Presets', items: customItems });
            return groups;
        };

        trigger.addEventListener('click', () => {
            const groups = buildGroups();
            openPresetDropdown(trigger, groups, (value, name, item) => {
                setTextFn(value);
                setActive(name, item._source || 'custom');
            }, { placeholder: 'Search presets…', width: 360, emptyText: 'No presets saved yet' });
        });

        // Action buttons
        const mkBtn = (icon, title, cls, cb) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = `scp-preset-mgr-btn${cls ? ' ' + cls : ''}`;
            b.title = title;
            b.innerHTML = `<i class="fa-solid fa-${icon}"></i>`;
            b.addEventListener('click', cb);
            return b;
        };

        const saveBtn = mkBtn('floppy-disk', 'Save preset', '', async () => {
            if (_activeName && _activeSource === 'custom') {
                s[dictKey][_activeName] = getTextFn();
                saveSettings();
                toastr.success(`Saved preset "${escHtml(_activeName)}"`, EXT_DISPLAY);
            } else {
                const name = await showCustomDialog({ type: 'prompt', title: 'Save Prompt Preset', message: 'Preset name:', placeholder: 'My Preset' });
                if (!name?.trim()) return;
                s[dictKey][name.trim()] = getTextFn();
                saveSettings();
                setActive(name.trim(), 'custom');
                toastr.success(`Saved preset "${escHtml(name.trim())}"`, EXT_DISPLAY);
            }
        });

        const renameBtn = mkBtn('pen', 'Rename selected custom preset', '', async () => {
            if (!_activeName || _activeSource !== 'custom') { toastr.info('Select a custom preset first.', EXT_DISPLAY); return; }
            const newName = await showCustomDialog({ type: 'prompt', title: 'Rename Preset', message: 'New name:', defaultValue: _activeName });
            if (!newName?.trim() || newName.trim() === _activeName) return;
            s[dictKey][newName.trim()] = s[dictKey][_activeName];
            delete s[dictKey][_activeName];
            saveSettings();
            setActive(newName.trim(), 'custom');
        });

        const deleteBtn = mkBtn('trash', 'Delete selected custom preset', 'danger', async () => {
            if (!_activeName || _activeSource !== 'custom') { toastr.info('Only custom presets can be deleted.', EXT_DISPLAY); return; }
            const ok = await showCustomDialog({ type: 'confirm', title: 'Delete Preset', message: `Delete "${_activeName}"?` });
            if (!ok) return;
            delete s[dictKey][_activeName];
            saveSettings();
            setActive('', '');
        });

        const updateBtnStates = () => {
            const isCustom = !!_activeName && _activeSource === 'custom';
            renameBtn.disabled = !isCustom;
            deleteBtn.disabled = !isCustom;
            renameBtn.style.opacity = isCustom ? '1' : '0.35';
            deleteBtn.style.opacity = isCustom ? '1' : '0.35';
        };
        updateBtnStates();

        bar.appendChild(trigger);
        bar.appendChild(saveBtn);
        bar.appendChild(renameBtn);
        bar.appendChild(deleteBtn);
        containerEl.appendChild(bar);
    }

    // ─── Quick Prompt Sets Manager ────────────────────────────────────────────────

    function buildQPSetManager(containerEl, onSetLoaded) {
        if (!containerEl) return;
        containerEl.innerHTML = '';
        const s = getSettings();
        if (!s.quickPromptSets) s.quickPromptSets = {};

        let _activeName = s.activeQuickPromptSet || '';

        const bar = document.createElement('div');
        bar.className = 'scp-preset-mgr-bar';

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'scp-preset-mgr-trigger';
        const getLabel = name => {
            if (!name) return 'Select a set…';
            const count = (s.quickPromptSets[name] || []).length;
            return `${name}  (${count})`;
        };
        trigger.innerHTML = `<span class="scp-pmt-label">${escHtml(getLabel(_activeName))}</span><svg class="scp-pmt-chevron" xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>`;

        const labelEl = trigger.querySelector('.scp-pmt-label');

        const setActive = name => {
            _activeName = name;
            labelEl.textContent = getLabel(name);
            trigger.classList.toggle('scp-pmt--has-value', !!name);
            updateBtnStates();
        };

        const buildGroups = () => {
            const items = Object.keys(s.quickPromptSets).map(name => ({
                name,
                value: name,
                preview: `${(s.quickPromptSets[name] || []).length} prompts: ` +
                    (s.quickPromptSets[name] || []).map(q => `${q.icon || '⚡'} ${q.label}`).join(', ').slice(0, 80),
                badge: name === s.activeQuickPromptSet ? 'active' : null,
            }));
            return [{ label: items.length ? 'Saved Sets' : null, items }];
        };

        trigger.addEventListener('click', () => {
            openPresetDropdown(trigger, buildGroups(), (value) => {
                if (!s.quickPromptSets[value]) return;
                s.quickPrompts = JSON.parse(JSON.stringify(s.quickPromptSets[value]));
                s.activeQuickPromptSet = value;
                saveSettings();
                setActive(value);
                renderQuickPromptsBar();
                if (onSetLoaded) onSetLoaded();
                toastr.success(`Loaded set "${escHtml(value)}"`, EXT_DISPLAY);
            }, { placeholder: 'Search sets…', width: 340, emptyText: 'No sets saved yet. Save one below.' });
        });

        const mkBtn = (icon, title, cls, cb) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = `scp-preset-mgr-btn${cls ? ' ' + cls : ''}`;
            b.title = title;
            b.innerHTML = `<i class="fa-solid fa-${icon}"></i>`;
            b.addEventListener('click', cb);
            return b;
        };

        const saveBtn = mkBtn('floppy-disk', 'Save current prompts to active set (or new)', '', async () => {
            let name = _activeName;
            if (!name) {
                name = await showCustomDialog({ type: 'prompt', title: 'Save Prompt Set', message: 'Set name:', placeholder: 'My Set' });
                if (!name?.trim()) return;
                name = name.trim();
            }
            s.quickPromptSets[name] = JSON.parse(JSON.stringify(s.quickPrompts));
            s.activeQuickPromptSet = name;
            saveSettings();
            setActive(name);
            toastr.success(`Saved set "${escHtml(name)}"`, EXT_DISPLAY);
        });

        const saveAsBtn = mkBtn('plus', 'Save current prompts as a new set', '', async () => {
            const name = await showCustomDialog({ type: 'prompt', title: 'New Prompt Set', message: 'Set name:', placeholder: 'My New Set' });
            if (!name?.trim()) return;
            const n = name.trim();
            s.quickPromptSets[n] = JSON.parse(JSON.stringify(s.quickPrompts));
            s.activeQuickPromptSet = n;
            saveSettings();
            setActive(n);
            toastr.success(`Created set "${escHtml(n)}"`, EXT_DISPLAY);
        });

        const renameBtn = mkBtn('pen', 'Rename selected set', '', async () => {
            if (!_activeName) { toastr.info('Select a set first.', EXT_DISPLAY); return; }
            const newName = await showCustomDialog({ type: 'prompt', title: 'Rename Set', message: 'New name:', defaultValue: _activeName });
            if (!newName?.trim() || newName.trim() === _activeName) return;
            const n = newName.trim();
            s.quickPromptSets[n] = s.quickPromptSets[_activeName];
            delete s.quickPromptSets[_activeName];
            if (s.activeQuickPromptSet === _activeName) s.activeQuickPromptSet = n;
            saveSettings();
            setActive(n);
        });

        const deleteBtn = mkBtn('trash', 'Delete selected set', 'danger', async () => {
            if (!_activeName) { toastr.info('Select a set first.', EXT_DISPLAY); return; }
            const ok = await showCustomDialog({ type: 'confirm', title: 'Delete Set', message: `Delete set "${_activeName}"?` });
            if (!ok) return;
            delete s.quickPromptSets[_activeName];
            if (s.activeQuickPromptSet === _activeName) s.activeQuickPromptSet = '';
            saveSettings();
            setActive('');
        });

        const updateBtnStates = () => {
            const has = !!_activeName;
            renameBtn.disabled = !has; renameBtn.style.opacity = has ? '1' : '0.35';
            deleteBtn.disabled = !has; deleteBtn.style.opacity = has ? '1' : '0.35';
        };
        updateBtnStates();

        bar.appendChild(trigger);
        bar.appendChild(saveBtn);
        bar.appendChild(saveAsBtn);
        bar.appendChild(renameBtn);
        bar.appendChild(deleteBtn);
        containerEl.appendChild(bar);
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
            saveSessionsToMetadata();
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

        _dbgAdd('PICKER_OPEN');

        applyCustomTheme(getSettings().customTheme || THEME_PRESETS.default);
        _pickerLastIdx = -1;
        renderPickerMessages();
        overlay.style.display = 'flex';
    }

    function closeChatPicker() {
        _dbgAdd('PICKER_CLOSE');

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

                    // Ctrl+click: toggle all messages by same sender
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

                    // Alt+click: toggle all messages NOT from this sender
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
            
            _dbgAdd('PICKER_APPLY', { count: indices.length });
            
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
                console.error(`[${EXT_DISPLAY}] Couldn't load HTML: ${templateName}.html`);
            }
        };

        const templates = ['window', 'lorebook_manager', 'settings_overlay', 'chat_picker'];
        await Promise.all(templates.map(loadAndInject));

        windowEl = document.getElementById(WIN_ID);
        iconEl = document.getElementById(ICON_ID);
        modalEl = document.getElementById(MODAL_ID);

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
        out = out.replace(/\x00TC_(\d+)\x00/g, (_, i) => `<div class="scp-tool-call-ph" data-tcid="${i}"></div>`);
        out = out.replace(/(<div class="scp-tool-call-ph"[^>]*><\/div>)(?:<br>|\s)*/g, '$1');

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
            if (document.getElementById('scp-fav-panel')?.style.display !== 'none') renderFavoritesPanel();
        });
        actions.appendChild(starBtn);
        if (isStarred) wrap.classList.add('scp-msg-starred');

        if (!isUser) {
            const continueBtn = makeBtn(I.continueArrow, 'Continue response', 'scp-msg-btn-continue', () => runContinue(getCurrentSession(), msg.id));
            actions.appendChild(continueBtn);
        }

        body.appendChild(actions); body.appendChild(meta);

        // Swipe bar
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
                if (prevBtn.disabled || _generating) return;
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
                if (nextBtn.disabled || _generating) return;
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

    async function _runSwipeRegen(session, msgId, wrapEl) {
        if (_generating) return;
        const msgData = session.messages.find(m => m.id === msgId);
        if (!msgData) return;

        if (!msgData.swipes) {
            msgData.swipes = [{ content: msgData.content, reasoning: msgData.reasoning || null }];
            msgData.swipeIndex = 0;
        }

        _generating = true;
        _activeToolCalls = [];
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
        let streamAccumText = '';
        let streamAccumReasoning = null;

        const cleanupCursor = () => { if (cursorEl?.parentNode) cursorEl.remove(); cursorEl = null; };

        const onChunk = (text, reasoning) => {
            streamAccumText = text;
            streamAccumReasoning = reasoning;
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
            const messagesForRegen = [];
            const tempSession = { ...session, messages: session.messages.filter(m => m.id !== msgId) };
            const builtMessages = await assembleMessages(tempSession, settings, null);
            const fullPromptText = builtMessages.map(m => m.content).join('\n');
            const tokensIn = await estimateTokens(fullPromptText);

            const result = await callGenerate(tempSession, settings, null, onChunk);
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

            if (tokensIn > 0) recordStat(_SM.tokIn, tokensIn);
            const tokensOut = await estimateTokens(fullText);
            if (tokensOut > 0) recordStat(_SM.tokOut, tokensOut);
            recordStat(_SM.regen);
            updateMsgCount(session);
            playCompletionSound();

        } catch(err) {
            cleanupCursor();
            msgData.swipes.pop();
            msgData.swipeIndex = msgData.swipes.length - 1;
            msgData.content = msgData.swipes[msgData.swipeIndex]?.content || '';
            msgData.reasoning = msgData.swipes[msgData.swipeIndex]?.reasoning || null;
            saveSessionsToMetadata();
            _renderMsgBodyContent(wrapEl, msgData);
            updateSwipeBar(wrapEl, session, msgId);

            if (_abortController?.signal?.aborted || err?.message === 'userStopped') {} 
            else { showGenerationError(err); }
        } finally {
            _generating = false;
            setGeneratingState(false);
        }
    }

    function _refreshSwipeBars(session) {
        const c = $('scp-messages');
        if (!c) return;
        c.querySelectorAll('.scp-swipe-bar').forEach(bar => { bar.style.display = 'none'; });
        if (_generating) return;
        const lastId = getLastAssistantMsgId(session);
        if (!lastId) return;
        const lastEl = c.querySelector(`.scp-msg[data-id="${lastId}"]`);
        if (!lastEl) return;
        const swipeBar = lastEl.querySelector('.scp-swipe-bar');
        if (!swipeBar) return;
        updateSwipeBar(lastEl, session, lastId);
        swipeBar.style.display = '';
    }

    let _userScrolledUp = false;

    function scrollToBottom() {
        const c = $('scp-messages');
        if (!c) return;
        _userScrolledUp = false;
        c.scrollTop = c.scrollHeight;
    }

    function smartScrollToBottom() {
        if (_userScrolledUp) return;
        const c = $('scp-messages');
        if (c) c.scrollTop = c.scrollHeight;
    }

    function setupMessagesScrollTracking() {
        const c = $('scp-messages');
        if (!c) return;
        c.addEventListener('scroll', () => {
            _userScrolledUp = c.scrollHeight - c.scrollTop - c.clientHeight > 80;
        }, { passive: true });
    }

    function _refreshContinueBtns() {
        const c = $('scp-messages');
        if (!c) return;
        c.querySelectorAll('.scp-msg-last-assistant').forEach(el => el.classList.remove('scp-msg-last-assistant'));
        if (_generating) return;
        const all = [...c.querySelectorAll('.scp-msg-assistant')];
        if (all.length) all[all.length - 1].classList.add('scp-msg-last-assistant');
    }

    // ─── Swipe Management ────────────────────────────────────────────────────────

    function getLastAssistantMsgId(session) {
        for (let i = session.messages.length - 1; i >= 0; i--) {
            const m = session.messages[i];
            if (m.role === 'user') return null;
            if (m.role === 'assistant' && !m.isLBHistory && !m.isCharEditHistory && !m.isChatEditHistory) {
                return m.id;
            }
        }
        return null;
    }

    function getSwipesForMsg(session, msgId) {
        const msg = session.messages.find(m => m.id === msgId);
        if (!msg) return null;
        if (!msg.swipes) msg.swipes = [{ content: msg.content, reasoning: msg.reasoning || null }];
        if (msg.swipeIndex === undefined) msg.swipeIndex = 0;
        return msg;
    }

    function addSwipe(session, msgId, content, reasoning = null) {
        const msg = getSwipesForMsg(session, msgId);
        if (!msg) return;
        msg.swipes.push({ content, reasoning: reasoning || null });
        msg.swipeIndex = msg.swipes.length - 1;
        msg.content = content;
        msg.reasoning = reasoning || null;
        saveSessionsToMetadata();
    }

    function navigateSwipe(session, msgId, dir) {
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

    function updateSwipeBar(msgEl, session, msgId) {
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
        if (prevBtn) prevBtn.disabled = cur <= 1 || _generating;
        if (nextBtn) nextBtn.disabled = _generating;
        if (counter) counter.innerHTML = `<span>${cur}</span>/${total}`;
        bar.style.display = '';
    }

    function extractToolCallPlaceholders(text, startIndex = 0) {
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

    function _renderMsgBodyContent(msgEl, msg) {
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
            renderLBHistoryContent({ appliedLines: currentSwipe.historyLines }, cEl);
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

    let _tokenCountCache = new Map();

    function _updateMsgTokenCount(msgEl, content, forceRecalc = false) {
        const el = msgEl.querySelector ? msgEl.querySelector('.scp-msg-token-count') : null;
        if (!el) return;
        if (!forceRecalc) {
            const cached = _tokenCountCache.get(content);
            if (cached !== undefined) { el.textContent = `${cached}t`; return; }
        } else {
            el.textContent = '\u2026';
        }
        estimateTokens(content).then(n => {
            _tokenCountCache.set(content, n);
            if (el.isConnected) el.textContent = `${n}t`;
        });
    }

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
                        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7" /><ellipse cx="12" cy="12" rx="11" ry="3" transform="rotate(-25 12 12)" /><circle cx="21.5" cy="7.5" r="1.5" fill="currentColor" stroke="none" /></svg>
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
            }
        }
        updateMsgCount(session);
        scrollToBottom();
        _refreshContinueBtns();
        _refreshSwipeBars(session);
    }

    function appendMsgEl(msg) {
        const c = $('scp-messages');
        if (!c) return;
        c.querySelector('.scp-empty-state')?.remove();

        const el = createMsgEl(msg, handleCopy, handleEdit, handleDelete, handleMessageRegen);
        c.appendChild(el);
        clearTimeout(_tokenCalcTid);
        const session = getCurrentSession();
        updateMsgCount(session);
        scrollToBottom();
        _refreshContinueBtns();
        _refreshSwipeBars(session);

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
        document.querySelector(`.scp-char-proposal-card[data-for="${msgId}"]`)?.remove();
        document.querySelector(`.scp-char-creation-card[data-for="${msgId}"]`)?.remove();
        document.querySelector(`.scp-chat-proposal-card[data-for="${msgId}"]`)?.remove();
        el.remove();
        _refreshContinueBtns();
        _refreshSwipeBars(getCurrentSession());
    }

    function removeMsgElAndBelow(msgId) {
        const c = $('scp-messages'); if (!c) return;
        let found = false;
        for (const el of [...c.querySelectorAll('.scp-msg')]) {
            if (el.dataset.id === msgId) found = true;
            if (found) {
                document.querySelector(`.scp-lb-proposal-card[data-for="${el.dataset.id}"]`)?.remove();
                document.querySelector(`.scp-char-proposal-card[data-for="${el.dataset.id}"]`)?.remove();
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

    function removeMsgElAfter(msgId) {
        const c = $('scp-messages'); if (!c) return;
        let found = false;
        for (const el of [...c.querySelectorAll('.scp-msg')]) {
            if (found) {
                document.querySelector(`.scp-lb-proposal-card[data-for="${el.dataset.id}"]`)?.remove();
                document.querySelector(`.scp-char-proposal-card[data-for="${el.dataset.id}"]`)?.remove();
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
    const _tokenCountPromises = new Map();

    async function estimateTokens(text) {
        if (!text) return 0;
        let str = text;
        if (Array.isArray(text)) {
            str = text.map(t => t.type === 'text' ? t.text : '').join('\n');
        }
        
        if (_tokenCountCache.has(str)) return _tokenCountCache.get(str);
        if (_tokenCountPromises.has(str)) return _tokenCountPromises.get(str);

        const promise = (async () => {
            const ctx = SillyTavern.getContext();
            
            try {
                if (typeof ctx.getTokenCountAsync === 'function') return await ctx.getTokenCountAsync(str);
                if (typeof window.getTokenCountAsync === 'function') return await window.getTokenCountAsync(str);
            } catch (_) {}
            
            await new Promise(resolve => setTimeout(resolve, 0));

            try {
                if (typeof ctx.getTokenCount === 'function') return ctx.getTokenCount(str);
                if (typeof window.getTokenCount === 'function') return window.getTokenCount(str);
            } catch (_) {}
            
            try {
                const res = await fetch('/api/tokencount', {
                    method: 'POST',
                    headers: { ...ctx.getRequestHeaders(), 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: str })
                });
                if (res.ok) {
                    const data = await res.json();
                    if (typeof data.length === 'number') return data.length;
                    if (typeof data.count === 'number') return data.count;
                    if (typeof data === 'number') return data;
                }
            } catch (_) {}
            
            return Math.ceil(str.length / 3.5);
        })();

        _tokenCountPromises.set(str, promise);
        try {
            const count = await promise;
            if (_tokenCountCache.size > 500) {
                const keysToDel = Array.from(_tokenCountCache.keys()).slice(0, 100);
                keysToDel.forEach(k => _tokenCountCache.delete(k));
            }
            _tokenCountCache.set(str, count);
            return count;
        } finally {
            _tokenCountPromises.delete(str);
        }
    }

    let _isTokenCalculating = false;
    let _pendingTokenCalc = false;

    function updateMsgCount(session) {
        const el = $('scp-msg-count');
        if (el && session) el.textContent = `${session.messages.length} msgs`;
        
        const tel = $('scp-token-count');
        if (tel && session) {
            clearTimeout(_tokenCalcTid);
            
            _tokenCalcTid = setTimeout(() => {
                if (_isTokenCalculating) {
                    _pendingTokenCalc = true;
                    return;
                }
                
                const runCalc = () => {
                    _isTokenCalculating = true;
                    try {
                        const settings = getEffectiveSettings();
                        const currentInput = document.getElementById('scp-input')?.value || '';
                        
                        let totalChars = (settings.systemPrompt || DEFAULT_SYSTEM_PROMPT).length;
                        const limit = Math.max(1, parseInt(settings.localHistoryLimit) || 50);
                        for (const m of session.messages.slice(-limit)) {
                            totalChars += (m.content || '').length;
                        }
                        const depth = Math.max(0, parseInt(settings.contextDepth) || 0);
                        const ctx = SillyTavern.getContext();
                        const chat = ctx.chat || [];
                        for (const m of chat.slice(-depth)) {
                            totalChars += (m.mes || '').length;
                        }
                        totalChars += currentInput.length;
                        
                        const count = Math.ceil(totalChars / 3.5);
                        const telNode = $('scp-token-count');
                        if (telNode) telNode.textContent = `~${count} tkns`;
                    } finally {
                        _isTokenCalculating = false;
                        if (_pendingTokenCalc) {
                            _pendingTokenCalc = false;
                            runCalc();
                        }
                    }
                };
                
                runCalc();
            }, 400);
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
            } else document.querySelector(`.scp-char-proposal-card[data-for="${msg.id}"]`)?.remove();
            
            if (charCreation) { 
                stripped = stripCharCreationBlock(stripped); 
                renderCharCreationCard(charCreation, wrapEl); 
            } else document.querySelector(`.scp-char-creation-card[data-for="${msg.id}"]`)?.remove();

            if (chatChanges?.length) { 
                stripped = stripChatChangesBlock(stripped); 
                renderChatProposalCard(chatChanges, wrapEl); 
            } else document.querySelector(`.scp-chat-proposal-card[data-for="${msg.id}"]`)?.remove();
            
            const tcRes = extractToolCallPlaceholders(stripped, 0);
            const displayString = getDisplayContent(tcRes.text, getSettings()).content;

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
                updateMessage(session, msg.id, newText);
                msg.content = newText;
                if (msg.swipes && msg.swipeIndex !== undefined) {
                    msg.swipes[msg.swipeIndex] = { content: newText, reasoning: msg.reasoning || null };
                    saveSessionsToMetadata();
                }
                recordStat(_SM.edit);
                restoreMessageDOM(newText);
                _updateMsgTokenCount(wrapEl, newText, true);
            });
        }

        saveBtn.addEventListener('click', async () => {
            const rawText = ta.value.trim();
            if (!rawText) return;
            const newText = expandMacros(rawText);
            updateMessage(session, msg.id, newText);
            msg.content = newText;
            if (msg.swipes && msg.swipeIndex !== undefined) {
                msg.swipes[msg.swipeIndex] = { content: newText, reasoning: msg.reasoning || null };
                saveSessionsToMetadata();
            }
            recordStat(_SM.edit);
            restoreMessageDOM(newText);
            _updateMsgTokenCount(wrapEl, newText, true);
            
            truncateAfter(session, msg.id);
            removeMsgElAfter(msg.id);
            if (msg.role === 'user') await runGenerate(session, newText, false);
        });
    }

    async function handleMessageRegen(wrapEl, msg) {
        if (_generating) return;
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
            recordStat(_SM.regen);
            runGenerate(session, null, false);
        } else {
            if (msgsAfterCount > 0) {
                truncateAfter(session, msg.id);
                removeMsgElAfter(msg.id);
                updateMsgCount(session);
            }
            recordStat(_SM.regen);
            _runSwipeRegen(session, msg.id, wrapEl);
        }
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
        _dbgAdd('SEARCH_TOGGLE', { state: 'open' });

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
        _dbgAdd('SEARCH_TOGGLE', { state: 'close' });

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
        } catch (e) {
            _dbgAdd('SEARCH_HIGHLIGHT_DOM_CORRUPTION', { error: e.message });
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

        _dbgAdd('SEARCH_QUERY_EXECUTE', { query: _searchQuery, wholeWord: _searchWholeWord, matches: _searchMatches.length });

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


    async function runGenerate(session, userText, addUserMsg = true, processedAtts = null) {
        if (_generating) return;
        _generating = true;
        _activeToolCalls = [];
        const settings = getEffectiveSettings();
        setGeneratingState(true);

        let streamMsgId = null;
        let streamMsgEl = null;
        let streamContentEl = null;
        let streamReasoningBlockEl = null;
        let streamReasoningSummaryEl = null;
        let streamReasoningContentEl = null;
        let cursorEl = null;
        let isStreaming = false;
        let streamAccumText = '';
        let streamAccumReasoning = null;

        const cleanupCursor = () => {
            if (cursorEl && cursorEl.parentNode) cursorEl.remove();
            cursorEl = null;
        };

        const onChunk = (text, reasoning, reasoningMs, reasoningDone) => {
            isStreaming = true;
            streamAccumText = text;
            streamAccumReasoning = reasoning;

            if (!streamMsgId) {
                const placeholder = { id: genId('msg'), role: 'assistant', content: '', reasoning: null, timestamp: Date.now() };
                session.messages.push(placeholder);
                streamMsgId = placeholder.id;

                const c = document.getElementById('scp-messages');
                c?.querySelector('.scp-empty-state')?.remove();
                streamMsgEl = createMsgEl(placeholder, handleCopy, handleEdit, handleDelete, handleMessageRegen);
                c?.appendChild(streamMsgEl);
                updateMsgCount(session);

                const body = streamMsgEl.querySelector('.scp-msg-body');
                streamContentEl = streamMsgEl.querySelector('.scp-msg-content');

                streamReasoningBlockEl = document.createElement('details');
                streamReasoningBlockEl.className = 'scp-reasoning-block';
                streamReasoningBlockEl.style.display = 'none';
                streamReasoningSummaryEl = document.createElement('summary');
                streamReasoningSummaryEl.className = 'scp-reasoning-summary';
                streamReasoningSummaryEl.textContent = 'Thinking…';
                streamReasoningContentEl = document.createElement('div');
                streamReasoningContentEl.className = 'scp-reasoning-content';
                streamReasoningBlockEl.appendChild(streamReasoningSummaryEl);
                streamReasoningBlockEl.appendChild(streamReasoningContentEl);
                if (body) body.insertBefore(streamReasoningBlockEl, streamContentEl);

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

                if (reasoning && streamReasoningBlockEl) {
                    streamReasoningBlockEl.style.display = '';
                    streamReasoningContentEl.innerHTML = renderMarkdown(procReasoning);
                    postProcessHTMLBlocks(streamReasoningContentEl);
                    const secs = reasoningMs ? (reasoningMs / 1000).toFixed(1) : null;
                    streamReasoningSummaryEl.textContent = reasoningDone
                        ? `Thought for ${secs}s`
                        : secs ? `Thinking for ${secs}s…` : 'Thinking…';
                }

                streamContentEl.innerHTML = renderMarkdown(procText);
                if (procText) streamContentEl.appendChild(cursorEl);
                postProcessHTMLBlocks(streamContentEl);

                if (_activeToolCalls.length || tcIndex > 0) {
                    const liveTCs = parseToolCallsFromText((reasoning || '') + '\n' + text);
                    const displayed = liveTCs.map((tc, i) => _activeToolCalls[i] || {
                        id: `live_${i}`, name: tc.name, input: tc.input, status: 'running', result: undefined
                    });
                    postProcessToolCalls(streamMsgEl, displayed);
                }
            }
            smartScrollToBottom();
        };

        try {
            if (addUserMsg && (userText || (processedAtts && processedAtts.length))) {
                const msgObj = addMessage(session, 'user', userText, { 
                    attachments: processedAtts || []
                });
                appendMsgEl(msgObj);
                recordStat(_SM.msg);
            }

            const fullMessages = await assembleMessages(session, settings, null);
            const fullPromptText = fullMessages.map(m => m.content).join('\n');
            const tokensIn = await estimateTokens(fullPromptText);

            _dbgAdd('GEN_START', {
                src: settings.connectionSource,
                profile: settings.connectionProfileId || null,
                maxTokens: settings.maxTokens,
                streaming: settings.forceStreaming,
                ctxDepth: settings.contextDepth,
                tokensIn
            });

            let result = await callGenerate(session, settings, null, onChunk);

            cleanupCursor();
            
            if (result && !result.text.trim() && !result.reasoning?.trim()) {
                toastr.warning('⚠ Generation failed: AI returned an empty response. Check API limits or Context Size. Also response may be blocked by the provider due to prohibition content.', EXT_DISPLAY, { timeOut: 10000 });
            }

            // ── Agentic tool call loop ──────────────────────────────────────
            if (result !== null && settings.toolsEnabled && getEnabledTools().length > 0) {
                const maxRounds = settings.toolsMaxRounds ?? 5;
                let roundText = result.text || '';
                let roundReasoning = result.reasoning;
                let extraHistory = [];

                let accumulatedText = roundText;
                let accumulatedReasoning = roundReasoning || null;

                const _updateLiveUI = (tempText = '', tempReasoning = null) => {
                    if (!streamMsgEl || !streamContentEl) return;
                    let combinedText = tempText ? accumulatedText + '\n\n' + tempText : accumulatedText;
                    let combinedReasoning = accumulatedReasoning || '';
                    if (tempReasoning) {
                        combinedReasoning = combinedReasoning ? combinedReasoning + '\n\n' + tempReasoning : tempReasoning;
                    }
                    
                    let procReasoning = combinedReasoning;
                    let procText = stripMemoryBlock(combinedText);
                    let tcIndex = 0;
                    
                    if (procReasoning) {
                        const resR = extractToolCallPlaceholders(procReasoning, tcIndex);
                        procReasoning = resR.text;
                        tcIndex = resR.nextIndex;
                    }
                    const resC = extractToolCallPlaceholders(procText, tcIndex);
                    procText = resC.text;

                    if (combinedReasoning && streamReasoningBlockEl) {
                        streamReasoningBlockEl.style.display = '';
                        streamReasoningContentEl.innerHTML = renderMarkdown(procReasoning);
                        postProcessHTMLBlocks(streamReasoningContentEl);
                    }
                    streamContentEl.innerHTML = renderMarkdown(procText);
                    postProcessHTMLBlocks(streamContentEl);

                    if (_activeToolCalls.length || tcIndex > 0) {
                        postProcessToolCalls(streamMsgEl, _activeToolCalls);
                    }
                    smartScrollToBottom();
                };

                for (let round = 0; round < maxRounds; round++) {
                    let tcs = parseToolCallsFromText(roundText);
                    if (!tcs.length) break;

                    const roundEntries = [];
                    for (const tc of tcs) {
                        const tcId = genId('tc');
                        const entry = { id: tcId, name: tc.name, input: tc.input, status: 'running', result: undefined };
                        _activeToolCalls.push(entry);
                        roundEntries.push(entry);
                        
                        _updateLiveUI();

                        try {
                            const res = await executeTool(tc.name, tc.input);
                            if (res?.__ask_user) {
                                if (!streamMsgEl) {
                                    entry.result = { warning: 'ask_user requires streaming to be enabled in order to function.' };
                                    entry.status = 'warning';
                                } else {
                                    entry.result = await executeAskUser(res, streamMsgEl);
                                    entry.status = 'done';
                                }
                            } else {
                                entry.result = res;
                                entry.status = 'done';
                            }
                        } catch (e) {
                            _dbgAdd('TOOL_EXECUTION_FAILED', { toolName: tc.name, error: e.message, stack: e.stack });
                            entry.result = { error: e.message };
                            entry.status = 'error';
                        }
                        
                        _updateLiveUI();
                    }

                    extraHistory.push({ role: 'assistant', content: stripMemoryBlock(roundText) });
                    const toolResultsText = roundEntries.map(e =>
                        `<tool_result name="${e.name}" status="${e.status}">\n${typeof e.result === 'string' ? e.result : JSON.stringify(e.result, null, 2)}\n</tool_result>`
                    ).join("\n");

                    extraHistory.push({ role: 'user', content: `<tool_results>\n${toolResultsText}\n</tool_results>\n\nCONTINUE your response using these results. Write exactly where you left off. Without any preliminaries.` });

                    const thinkingText = document.getElementById('scp-thinking-text');
                    if (thinkingText) thinkingText.textContent = `Round ${round + 2}/${maxRounds + 1}…`;
                    const bar = document.getElementById('scp-thinking-bar');
                    if (bar) bar.style.display = 'flex';

                    for (const eh of extraHistory) {
                        session.messages.push({ id: genId('tc_hist'), role: eh.role, content: eh.content, timestamp: Date.now(), _tcTemp: true });
                    }

                    isStreaming = false;
                    streamAccumText = '';
                    const cursor2 = document.createElement('span');
                    cursor2.className = 'scp-stream-cursor';
                    let newText2 = '';
                    
                    const tempSession = { 
                        ...session, 
                        messages: session.messages.filter(m => m.id !== streamMsgId) 
                    };

                    const nextResult = await callGenerate(tempSession, settings, null, (t, r) => {
                        newText2 = t;
                        _updateLiveUI(t, r);
                        if (streamContentEl) streamContentEl.appendChild(cursor2);
                    });

                    session.messages = session.messages.filter(m => !m._tcTemp);
                    cursor2.remove();

                    if (nextResult === null) break;

                    roundText = nextResult.text || '';
                    roundReasoning = nextResult.reasoning || null;
                    
                    if (!roundText.trim() && !roundReasoning?.trim()) {
                        toastr.warning(`⚠ Round ${round + 2} failed: AI returned an empty response.<br><br>This usually happens when the <b>Context Length limit</b> is exceeded due to massive tool outputs, or the response was blocked by the provider due to prohibition content.`, EXT_DISPLAY, { timeOut: 12000, escapeHtml: false });
                        break;
                    }
                    
                    accumulatedText += '\n\n' + roundText;
                    if (roundReasoning) {
                        accumulatedReasoning = accumulatedReasoning ? accumulatedReasoning + '\n\n' + roundReasoning : roundReasoning;
                    }
                    
                    result = { text: accumulatedText, reasoning: accumulatedReasoning };

                    if (round === maxRounds - 1) {
                        _dbgAdd('TOOL_LOOP_MAX_ROUNDS_REACHED', { maxRounds });
                    }
                }
            }
            // ────────────────────────────────────────────────────────────────

            if (result === null) {
                if (streamMsgId && isStreaming && streamAccumText) {
                    const msg = session.messages.find(m => m.id === streamMsgId);
                    if (msg) { msg.content = streamAccumText; msg.reasoning = streamAccumReasoning || null; saveSettings(); }
                    if (streamContentEl) { streamContentEl.innerHTML = renderMarkdown(streamAccumText); postProcessHTMLBlocks(streamContentEl); }
                    if (streamReasoningBlockEl) streamReasoningBlockEl.style.display = streamAccumReasoning ? '' : 'none';
                    if (streamReasoningBlockEl && streamAccumReasoning) {
                        streamReasoningContentEl.innerHTML = renderMarkdown(streamAccumReasoning);
                        streamReasoningSummaryEl.textContent = 'Reasoning';
                    }
                } else if (streamMsgId) {
                    const idx = session.messages.findIndex(m => m.id === streamMsgId);
                    if (idx >= 0 && !session.messages[idx].content) {
                        session.messages.splice(idx, 1);
                        streamMsgEl?.remove();
                        updateMsgCount(session);
                    }
                }
                return;
            }

            const { text: rawFullText, reasoning: fullReasoning } = result;
            const rawNormalized = normalizeCharNamesInBlock(rawFullText);
            processMemoryUpdates(rawNormalized, streamMsgId);
            const fullText = stripMemoryBlock(rawNormalized);

            if (streamMsgId) {
                const msg = session.messages.find(m => m.id === streamMsgId);
                if (msg) { 
                    msg.content = fullText; 
                    msg.reasoning = fullReasoning || null; 
                    msg.toolCalls = _activeToolCalls.length ? JSON.parse(JSON.stringify(_activeToolCalls)) : undefined; 
                }
                saveSettings();

                if (msg && streamMsgEl) {
                    _renderMsgBodyContent(streamMsgEl, msg);
                }

                if (msg) {
                    msg.swipes = [{ content: fullText, reasoning: fullReasoning || null }];
                    msg.swipeIndex = 0;
                    saveSessionsToMetadata();
                }
                if (streamMsgEl) _updateMsgTokenCount(streamMsgEl, fullText);
            } else {
                const newMsg = addMessage(session, 'assistant', fullText, { reasoning: fullReasoning || null, toolCalls: _activeToolCalls.length ? JSON.parse(JSON.stringify(_activeToolCalls)) : undefined });
                newMsg.swipes = [{ content: fullText, reasoning: fullReasoning || null }];
                newMsg.swipeIndex = 0;
                saveSessionsToMetadata();
                appendMsgEl(newMsg);
            }

            _refreshSwipeBars(session);
            _activeToolCalls = [];

            if (tokensIn > 0) recordStat(_SM.tokIn, tokensIn);
            const tokensOut = await estimateTokens(fullText);
            if (tokensOut > 0) recordStat(_SM.tokOut, tokensOut);

            playCompletionSound();
            _dbgAdd('GEN_DONE', { chars: fullText?.length || 0, hasReasoning: !!fullReasoning, tokensOut });

        } catch (err) {
            cleanupCursor();
            if (_abortController?.signal?.aborted || err?.message === 'userStopped') {
                _generating = false;
                setGeneratingState(false);
                return;
            }
            
            const inputEl = document.getElementById('scp-input');
            if (inputEl && inputEl.value.trim() === '' && userText) {
                inputEl.value = userText;
                autoResize(inputEl);
            }

            _dbgAdd('GEN_ERROR', { msg: err?.message || String(err), stack: err?.stack });
            console.error(`[${EXT_DISPLAY}] Generation failed:`, err);
            
            showGenerationError(err);
        } finally {
            _generating = false;
            setGeneratingState(false);
        }
    }

    // ─── Continue Generation ─────────────────────────────────────────────────────

    function _joinContinuation(existing, continuation) {
        if (!continuation) return existing;
        const trimmed = existing.trimEnd();
        const needsSpace = /[\w.,!?;:'")\]}>]$/.test(trimmed);
        return trimmed + (needsSpace ? ' ' : '') + continuation;
    }

    async function runContinue(session, targetMsgId) {
        _dbgAdd('CONTINUE_TRIGGERED', { targetMsgId });
        
        if (_generating) return;
        const targetMsg = session.messages.find(m => m.id === targetMsgId);
        if (!targetMsg || targetMsg.role !== 'assistant') return;

        _generating = true;
        _activeToolCalls = [];
        const settings = getEffectiveSettings();
        setGeneratingState(true);

        const CONTINUE_PROMPT = 'Continue your response exactly from where you left off. Do not repeat any previously written text.';

        let streamContentEl = null;
        let cursorEl = null;
        let isStreaming = false;
        let streamAccumContinuation = '';
        const originalContent = targetMsg.content;

        const targetEl = document.querySelector(`.scp-msg[data-id="${targetMsgId}"]`);
        if (targetEl) streamContentEl = targetEl.querySelector('.scp-msg-content');

        const cleanupCursor = () => {
            if (cursorEl && cursorEl.parentNode) cursorEl.remove();
            cursorEl = null;
        };

        const onChunk = (text) => {
            isStreaming = true;
            streamAccumContinuation = text;
            if (!cursorEl) {
                cursorEl = document.createElement('span');
                cursorEl.className = 'scp-stream-cursor';
                const bar = document.getElementById('scp-thinking-bar');
                if (bar) bar.style.display = 'flex';
            }
            const combined = _joinContinuation(originalContent, text);
            let tcIndex = 0;
            const resC = extractToolCallPlaceholders(combined, tcIndex);
            let procText = resC.text;

            const { content: disp } = getDisplayContent(procText, settings);
            if (streamContentEl) {
                streamContentEl.innerHTML = renderMarkdown(disp);
                streamContentEl.appendChild(cursorEl);
                postProcessHTMLBlocks(streamContentEl);

                if (resC.nextIndex > 0) {
                    const liveTCs = parseToolCallsFromText(combined);
                    const displayed = liveTCs.map((tc, i) => targetMsg.toolCalls?.[i] || {
                        id: `live_${i}`, name: tc.name, input: tc.input, status: 'done', result: undefined
                    });
                    postProcessToolCalls(targetEl, displayed);
                }
            }
            smartScrollToBottom();
        };

        const _applyFinalContinuation = (fullCombined) => {
            const lbChanges = parseLBChangesFromText(fullCombined);
            const charChanges = parseCharChangesFromText(fullCombined);
            const charCreation = parseCharCreationFromText(fullCombined);
            const chatChanges = parseChatChangesFromText(fullCombined);
            const needsStrip = lbChanges?.length || charChanges?.length || charCreation || chatChanges?.length;

            if (needsStrip) {
                let stripped = fullCombined;
                if (lbChanges?.length) stripped = stripLBChangesBlock(stripped);
                if (charChanges?.length) stripped = stripCharChangesBlock(stripped);
                if (charCreation) stripped = stripCharCreationBlock(stripped);
                if (chatChanges?.length) stripped = stripChatChangesBlock(stripped);
                const { content: disp } = getDisplayContent(stripped, settings);
                if (streamContentEl) { streamContentEl.innerHTML = renderMarkdown(disp); postProcessHTMLBlocks(streamContentEl); }
                const msgEl = document.querySelector(`.scp-msg[data-id="${targetMsgId}"]`);
                if (msgEl) {
                    if (lbChanges?.length) renderProposalCard(lbChanges, msgEl);
                    if (charChanges?.length) renderCharProposalCard(charChanges, msgEl);
                    if (charCreation) renderCharCreationCard(charCreation, msgEl);
                    if (chatChanges?.length) renderChatProposalCard(chatChanges, msgEl);
                }
            } else {
                const { content: disp } = getDisplayContent(fullCombined, settings);
                if (streamContentEl) { streamContentEl.innerHTML = renderMarkdown(disp); postProcessHTMLBlocks(streamContentEl); }
            }
        };

        try {
            const fullMessages = await assembleMessages(session, settings, CONTINUE_PROMPT);
            const fullPromptText = fullMessages.map(m => m.content).join('\n');
            
            const tokensIn = await estimateTokens(fullPromptText);

            _dbgAdd('CONTINUE_START', {
                src: settings.connectionSource,
                profile: settings.connectionProfileId || null,
                maxTokens: settings.maxTokens,
                streaming: settings.forceStreaming,
                ctxDepth: settings.contextDepth,
                tokensIn
            });

            const result = await callGenerate(session, settings, CONTINUE_PROMPT, onChunk);
            cleanupCursor();

            if (result === null) {
                if (isStreaming && streamAccumContinuation) {
                    const combined = _joinContinuation(originalContent, streamAccumContinuation);
                    targetMsg.content = combined;
                    if (targetMsg.swipes && targetMsg.swipeIndex !== undefined) {
                        targetMsg.swipes[targetMsg.swipeIndex] = { content: combined, reasoning: targetMsg.reasoning || null };
                    }
                    saveSessionsToMetadata();
                    _applyFinalContinuation(combined);
                    const targetMsgEl2 = document.querySelector(`.scp-msg[data-id="${targetMsgId}"]`);
                    if (targetMsgEl2) _updateMsgTokenCount(targetMsgEl2, combined);
                }
                return;
            }

            const { text: rawContinuation, isMaxTokens } = result;
            processMemoryUpdates(rawContinuation, targetMsgId);
            const continuation = stripMemoryBlock(rawContinuation);
            const combined = _joinContinuation(originalContent, continuation);
            
            if (isMaxTokens) {
                toastr.warning('Generation stopped: reached Max Response Tokens limit.', EXT_DISPLAY, { timeOut: 10000 });
            }

            targetMsg.content = combined;

            if (targetMsg.swipes && targetMsg.swipeIndex !== undefined) {
                targetMsg.swipes[targetMsg.swipeIndex] = { content: combined, reasoning: targetMsg.reasoning || null };
            }
            saveSessionsToMetadata();
            _applyFinalContinuation(combined);

            const targetMsgEl = document.querySelector(`.scp-msg[data-id="${targetMsgId}"]`);
            if (targetMsgEl) _updateMsgTokenCount(targetMsgEl, combined);

            if (tokensIn > 0) recordStat(_SM.tokIn, tokensIn);
            
            const tokensOut = await estimateTokens(continuation);
            if (tokensOut > 0) recordStat(_SM.tokOut, tokensOut);

            updateMsgCount(session);
            playCompletionSound();
            _dbgAdd('CONTINUE_DONE', { chars: continuation?.length || 0, tokensOut });

        } catch (err) {
            cleanupCursor();
            if (_abortController?.signal?.aborted || err?.message === 'userStopped') {
                _generating = false;
                setGeneratingState(false);
                return;
            }
            _dbgAdd('GEN_ERROR', { msg: err?.message || String(err), stack: err?.stack });
            console.error(`[${EXT_DISPLAY}] Continuation failed:`, err);

            showGenerationError(err);
        } finally {
            _generating = false;
            setGeneratingState(false);
        }
    }

    // ─── Completion Sound ────────────────────────────────────────────────────────

    const _SOUND_PRESETS = {
        none:    { label: 'None' },
        chime:   { label: 'Chime' },
        bell:    { label: 'Bell' },
        soft:    { label: 'Soft Ping' },
        digital: { label: 'Digital Blip' },
        pop:     { label: 'Pop' },
    };

    function _synthSound(type, volume = 80) {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const masterGain = ctx.createGain();
            masterGain.gain.value = Math.max(0, Math.min(1, volume / 100));
            masterGain.connect(ctx.destination);
            const now = ctx.currentTime;

            if (type === 'chime') {
                [523.25, 659.25, 783.99].forEach((freq, i) => {
                    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
                    const og = ctx.createGain();
                    o.connect(og); og.connect(masterGain);
                    og.gain.setValueAtTime(0, now + i * 0.12);
                    og.gain.linearRampToValueAtTime(0.18, now + i * 0.12 + 0.02);
                    og.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.5);
                    o.start(now + i * 0.12); o.stop(now + i * 0.12 + 0.5);
                });
            } else if (type === 'bell') {
                const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 880;
                const og = ctx.createGain();
                o.connect(og); og.connect(masterGain);
                og.gain.setValueAtTime(0.25, now);
                og.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
                o.start(now); o.stop(now + 1.2);
            } else if (type === 'soft') {
                const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 660;
                const og = ctx.createGain();
                o.connect(og); og.connect(masterGain);
                og.gain.setValueAtTime(0, now);
                og.gain.linearRampToValueAtTime(0.15, now + 0.05);
                og.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
                o.start(now); o.stop(now + 0.4);
            } else if (type === 'digital') {
                [440, 880].forEach((freq, i) => {
                    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = freq;
                    const og = ctx.createGain();
                    o.connect(og); og.connect(masterGain);
                    og.gain.setValueAtTime(0.08, now + i * 0.07);
                    og.gain.exponentialRampToValueAtTime(0.001, now + i * 0.07 + 0.12);
                    o.start(now + i * 0.07); o.stop(now + i * 0.07 + 0.12);
                });
            } else if (type === 'pop') {
                const o = ctx.createOscillator(); o.type = 'sine';
                o.frequency.setValueAtTime(600, now);
                o.frequency.exponentialRampToValueAtTime(200, now + 0.1);
                const og = ctx.createGain();
                o.connect(og); og.connect(masterGain);
                og.gain.setValueAtTime(0.22, now);
                og.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
                o.start(now); o.stop(now + 0.15);
            }
            setTimeout(() => ctx.close(), 2000);
        } catch (_) {}
    }

    function playCompletionSound() {
        const s = getSettings();
        const soundType = s.completionSound || 'none';
        const vol = s.completionSoundVolume ?? 80;
        if (soundType === 'none') return;
        if (s.completionSoundOnlyWhenUnfocused && document.hasFocus()) return;

        if (soundType.startsWith('custom_') && s.customSounds && s.customSounds[soundType]) {
            try {
                const audio = new Audio(s.customSounds[soundType].data);
                audio.volume = vol / 100;
                audio.play().catch(() => {});
            } catch (_) {}
            return;
        }

        if (soundType === 'custom' && s.completionSoundData) {
            try {
                const audio = new Audio(s.completionSoundData);
                audio.volume = vol / 100;
                audio.play().catch(() => {});
            } catch (_) {}
            return;
        }
        
        if (_SOUND_PRESETS[soundType] && soundType !== 'none') {
            _synthSound(soundType, vol);
        }
    }

    function buildSoundSettingsUI(container) {
        if (!container) return;
        container.innerHTML = '';
        const s = getSettings();
        if (!s.customSounds) s.customSounds = {};

        if (s.completionSoundData && !s.customSounds['custom_legacy']) {
            s.customSounds['custom_legacy'] = {
                name: s.completionSoundFileName || 'Legacy Custom Sound',
                data: s.completionSoundData
            };
            if (s.completionSound === 'custom') {
                s.completionSound = 'custom_legacy';
            }
            delete s.completionSoundData;
            delete s.completionSoundFileName;
            saveSettings();
        }

        const isSP = container.id === 'scp-sp-sound-settings';

        const typeRow = document.createElement('div');
        typeRow.className = isSP ? 'scp-sp-field' : '';
        if (!isSP) typeRow.style.marginTop = '10px';
        
        const typeLbl = document.createElement(isSP ? 'label' : 'b');
        typeLbl.className = isSP ? 'scp-sp-label' : '';
        if (!isSP) typeLbl.style.fontSize = '12px';
        typeLbl.textContent = 'Completion Sound';
        
        const typeWrap = document.createElement('div');
        typeWrap.style.cssText = 'display:flex;gap:6px;align-items:center';
        if (!isSP) typeWrap.style.marginTop = '6px';
        
        const typeSel = document.createElement('select');
        typeSel.className = isSP ? 'scp-sp-select text_pole' : 'text_pole';
        typeSel.style.flex = '1';
        
        const renderDropdown = () => {
            typeSel.innerHTML = '';
            
            const groupPreset = document.createElement('optgroup');
            groupPreset.label = 'Presets';
            for (const [key, preset] of Object.entries(_SOUND_PRESETS)) {
                const opt = document.createElement('option');
                opt.value = key; opt.textContent = preset.label;
                groupPreset.appendChild(opt);
            }
            typeSel.appendChild(groupPreset);
            
            if (Object.keys(s.customSounds).length > 0) {
                const groupCustom = document.createElement('optgroup');
                groupCustom.label = 'Custom Sounds';
                for (const [key, snd] of Object.entries(s.customSounds)) {
                    const opt = document.createElement('option');
                    opt.value = key; opt.textContent = snd.name;
                    groupCustom.appendChild(opt);
                }
                typeSel.appendChild(groupCustom);
            }
            
            typeSel.value = s.completionSound || 'none';
            if (!typeSel.value) {
                typeSel.value = 'none';
                s.completionSound = 'none';
                saveSettings();
            }
        };
        renderDropdown();

        const testBtn = document.createElement('button');
        testBtn.className = isSP ? 'scp-action-btn' : 'menu_button interactable';
        testBtn.innerHTML = `<i class="fa-solid fa-play"></i><span>Test</span>`;
        if (!isSP) testBtn.style.flex = '0 0 auto';
        testBtn.addEventListener('click', () => playCompletionSound());
        
        typeWrap.appendChild(typeSel);
        typeWrap.appendChild(testBtn);
        typeRow.appendChild(typeLbl);
        typeRow.appendChild(typeWrap);
        container.appendChild(typeRow);

        const customActionsWrap = document.createElement('div');
        customActionsWrap.style.cssText = isSP ? 'display:flex;gap:6px;margin-top:6px' : 'display:flex;gap:6px;margin-top:6px;align-items:center';
        
        const uploadBtn = document.createElement('button');
        uploadBtn.className = isSP ? 'scp-action-btn' : 'menu_button interactable';
        uploadBtn.innerHTML = `<i class="fa-solid fa-upload"></i><span>Upload Custom</span>`;
        if (!isSP) uploadBtn.style.flex = '1';

        uploadBtn.addEventListener('click', () => {
            const inp = document.createElement('input');
            inp.type = 'file'; inp.accept = 'image/*,video/mp4,video/webm';
            inp.onchange = async () => {
                const file = inp.files?.[0]; if (!file) return;
                if (file.size > 25 * 1024 * 1024) { toastr.warning('File too large (>25MB).', EXT_DISPLAY); return; }
                const isVideo = file.type.startsWith('video/');
                const url = await _uploadBackgroundToST(file).catch(() => null);
                if (!url) { toastr.error('Failed to upload background', EXT_DISPLAY); return; }
                
                const s2 = getSettings();
                const id = 'bg_' + Date.now();
                s2.customBackgrounds[id] = { name: file.name, dataUrl: url, isVideo, fit: 'cover' };
                s2.windowBg = id;
                saveSettings();
                
                const allContainers = [document.getElementById('scp-bg-settings'), document.getElementById('scp-sp-bg-settings')].filter(Boolean);
                allContainers.forEach(c => buildBackgroundSettingsUI(c));
                applyWindowBackground();
            };
            inp.click();
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.className = isSP ? 'scp-action-btn scp-sp-danger-btn' : 'menu_button interactable';
        deleteBtn.innerHTML = `<i class="fa-solid fa-trash"></i><span>Delete</span>`;
        if (!isSP) deleteBtn.style.flex = '1';

        deleteBtn.addEventListener('click', async () => {
            const val = typeSel.value;
            if (val.startsWith('custom_')) {
                const ok = await showCustomDialog({ type: 'confirm', title: 'Delete Sound', message: 'Delete this custom sound?' });
                if (!ok) return;
                const s2 = getSettings();
                delete s2.customSounds[val];
                s2.completionSound = 'none';
                saveSettings();
                renderDropdown();
                updateCustomActions();
                
                const otherContainers = [document.getElementById('scp-sound-settings'), document.getElementById('scp-sp-sound-settings')].filter(c => c && c !== container);
                otherContainers.forEach(c => buildSoundSettingsUI(c));
            }
        });
        
        customActionsWrap.appendChild(uploadBtn);
        customActionsWrap.appendChild(deleteBtn);
        container.appendChild(customActionsWrap);

        const updateCustomActions = () => {
            deleteBtn.style.display = typeSel.value.startsWith('custom_') ? '' : 'none';
        };
        updateCustomActions();

        typeSel.addEventListener('change', () => {
            getSettings().completionSound = typeSel.value;
            saveSettings();
            updateCustomActions();
            const otherContainers = [document.getElementById('scp-sound-settings'), document.getElementById('scp-sp-sound-settings')].filter(c => c && c !== container);
            otherContainers.forEach(c => buildSoundSettingsUI(c));
        });

        const volRow = document.createElement('div');
        volRow.className = isSP ? 'scp-sp-field' : '';
        volRow.style.marginTop = isSP ? '6px' : '10px';

        const volLbl = document.createElement(isSP ? 'label' : 'b');
        volLbl.className = isSP ? 'scp-sp-label' : '';
        if (!isSP) volLbl.style.fontSize = '12px';
        volLbl.textContent = 'Volume';

        const volWrap = document.createElement('div');
        volWrap.className = isSP ? 'scp-sp-row' : '';
        if (!isSP) {
            volWrap.style.display = 'flex';
            volWrap.style.alignItems = 'center';
            volWrap.style.gap = '10px';
            volWrap.style.marginTop = '6px';
        }

        const volSlider = document.createElement('input');
        volSlider.type = 'range'; 
        volSlider.className = isSP ? 'scp-slider scp-sp-vol-slider' : 'neo-range-slider scp-sp-vol-slider';
        volSlider.style.flex = '1'; volSlider.min = '0'; volSlider.max = '100';
        volSlider.value = s.completionSoundVolume ?? 80;

        const volVal = document.createElement('span');
        volVal.className = 'scp-sp-vol-val';
        volVal.style.cssText = isSP 
            ? 'min-width:32px;text-align:right;font-size:11px;color:var(--scp-accent)' 
            : 'min-width:34px;text-align:right;font-size:12px;color:var(--SmartThemeQuoteColor,#a99bfb)';
        volVal.textContent = `${volSlider.value}%`;
        
        volSlider.addEventListener('input', () => { volVal.textContent = `${volSlider.value}%`; });
        volSlider.addEventListener('change', () => { 
            getSettings().completionSoundVolume = parseInt(volSlider.value); 
            saveSettings(); 
            const otherContainers2 = [document.getElementById('scp-sound-settings'), document.getElementById('scp-sp-sound-settings')].filter(c => c && c !== container);
            otherContainers2.forEach(c => buildSoundSettingsUI(c));
        });
        
        volWrap.appendChild(volSlider); volWrap.appendChild(volVal);
        volRow.appendChild(volLbl); volRow.appendChild(volWrap);
        container.appendChild(volRow);
    }

    // ─── Session Import / Export ──────────────────────────────────────────────────

    function exportCurrentSession() {
        try {
            const sess = getCurrentSession();
            const { charId, chatId } = getBindingKey();
            const ctx = SillyTavern.getContext();
            const charName = ctx.characters?.[ctx.characterId]?.name || 'unknown';
            const exportData = {
                version: 1,
                exported: new Date().toISOString(),
                charName,
                session: JSON.parse(JSON.stringify(sess)),
            };
            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const safeName = sess.name.replace(/[^a-z0-9]/gi, '_').slice(0, 40) || 'session';
            a.download = `st-copilot-session-${safeName}.json`;
            a.click();
            URL.revokeObjectURL(url);
            toastr.success('Session exported.', EXT_DISPLAY);
        } catch (e) {
            toastr.error(`Export failed: ${e.message}`, EXT_DISPLAY);
        }
    }

    function importSession() {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = '.json';
        inp.onchange = async () => {
            const file = inp.files?.[0]; if (!file) return;
            try {
                const text = await file.text();
                const data = JSON.parse(text);
                if (!data.session || !data.session.id || !Array.isArray(data.session.messages)) {
                    toastr.error('Invalid session file.', EXT_DISPLAY); return;
                }
                const ok = await showCustomDialog({
                    type: 'confirm',
                    title: 'Import Session',
                    message: `Import session "${data.session.name || 'unnamed'}"${data.charName ? ` (from ${data.charName})` : ''}? It will be added to the current chat metadata.`,
                });
                if (!ok) return;
                const bucket = getChatBucket();
                const imported = { ...data.session, id: genId('sess'), name: `${data.session.name || 'Imported'} (imported)` };
                imported.isTemporary = false;
                bucket.sessions.push(imported);
                bucket.activeSessionId = imported.id;
                saveSessionsToMetadata();
                closeSessPanel();
                refreshSessionDropdown();
                renderSession(getCurrentSession());
                toastr.success(`Session "${escHtml(imported.name)}" imported.`, EXT_DISPLAY);
            } catch (e) {
                toastr.error(`Import failed: ${e.message}`, EXT_DISPLAY);
            }
        };
        inp.click();
    }

    function setGeneratingState(on) {
        const bar = $('scp-thinking-bar'), sendBtn = $('scp-send-btn'),
              input = $('scp-input'), regenBtn = $('scp-regen-btn');
        if (bar) {
            bar.style.display = on ? 'flex' : 'none';
            if (on) {
                const t = $('scp-thinking-text');
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

    function showGenerationError(err) {
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
                    Please copy the technical details below to report the issue:
                </div>
                <textarea style="width:100%; height:160px; background:rgba(0,0,0,0.4); color:var(--scp-text-muted); border:1px solid rgba(255,255,255,0.15); padding:8px; border-radius:6px; font-family:var(--scp-font-mono, monospace); resize:vertical; font-size:11px; white-space:pre; word-wrap:normal; overflow-x:auto;" readonly onclick="this.select()">${escHtml(fullError)}</textarea>
            `
        });
    }

    async function handleSend() {
        const input = $('scp-input'); if (!input) return;
        const rawText = input.value.trim();
        if (!rawText && !_pendingAttachments.length || _generating) return;
        const _s = getEffectiveSettings();
        const text = _s.autoExpandMacros ? expandMacros(rawText || '') : (rawText || '');
        input.value = ''; autoResize(input);
        
        const processedAtts = await _processAttachmentsBeforeSend(_pendingAttachments, false);
        _pendingAttachments = [];
        _renderAttachmentPreviews();
        updateMsgCount(getCurrentSession()); 
        
        runGenerate(getCurrentSession(), text, true, processedAtts).catch(err => {
            console.error(err);
        });
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

    let _lastInspectorMessages = [];

    function _highlightContextText(raw) {
        const events = [];
        const masterRe = /(```[\s\S]*?(?:```|$))|(`[^`\n]*`)|(<\/?[\w:{}_-][\w:{}_.\s"'/=-]*(?:\s[^>]*)?>|<!--[\s\S]*?-->)|(\{\{[^}\n]+\}\})/gi;
        
        let m;
        masterRe.lastIndex = 0;
        while ((m = masterRe.exec(raw)) !== null) {
            if (m[1] !== undefined) {
                events.push([m.index, masterRe.lastIndex, 'code_block', m[1]]);
            } else if (m[2] !== undefined) {
                events.push([m.index, masterRe.lastIndex, 'inline_code', m[2]]);
            } else if (m[3] !== undefined) {
                events.push([m.index, masterRe.lastIndex, 'tag', m[3]]);
            } else if (m[4] !== undefined) {
                events.push([m.index, masterRe.lastIndex, 'macro', m[4]]);
            }
        }

        let html = '', last = 0;
        const KNOWN = new Set(['system_prompt','character_information','lorebook_context','st_system_prompt','persistent_memory','summary_context','lorebook_management','character_management','chat_messages_editing','roleplay_context','entity_definitions','persona_configuration','operational_guidelines','{{user}}_persona', 'tool_calls_system', 'memory_system']);

        let currentDepth = 0;

        for (const [start, end, type, match] of events) {
            if (start < last) continue;
            html += escHtml(raw.slice(last, start));
            
            if (type === 'tag') {
                const isClose = match.startsWith('</');
                const isSelfClose = match.endsWith('/>');
                const isComment = match.startsWith('<!--');

                let applyDepth;
                if (isComment || isSelfClose) {
                    applyDepth = currentDepth;
                } else if (isClose) {
                    currentDepth = Math.max(0, currentDepth - 1);
                    applyDepth = currentDepth;
                } else {
                    applyDepth = currentDepth;
                    currentDepth++;
                }

                const openTag = match.match(/^<([\w:{}_-]+)>$/);
                if (openTag && KNOWN.has(openTag[1])) {
                    html += `<span id="scp-ctx-sec-${openTag[1]}" class="scp-ctx-anchor"></span>`;
                }
                
                const depthClass = Math.min(applyDepth, 5);
                html += `<span class="scp-ctx-hl-tag scp-ctx-hl-tag-d${depthClass}">${escHtml(match)}</span>`;
            } else if (type === 'macro') {
                html += `<span class="scp-ctx-hl-macro">${escHtml(match)}</span>`;
            } else if (type === 'code_block' || type === 'inline_code') {
                html += escHtml(match);
            }
            last = end;
        }
        html += escHtml(raw.slice(last));
        return html;
    }

    function _buildContextInspectorHTML(messages) {
        const SECTION_LABELS = {
            'system_prompt': 'System Prompt', 
            'persistent_memory': 'Persistent Memory',
            'lorebook_context': 'Lorebook', 
            'character_information': 'Character',
            '{{user}}_persona': 'User Persona',
            'memory_system': 'Memory Management',
            'lorebook_management': 'Lorebook Management',
            'character_management': 'Character Management',
            'chat_messages_editing': 'Chat Management',
            'tool_calls_system': 'Tool Calls'
        };
        const KNOWN_SECS = new Set(Object.keys(SECTION_LABELS));

        let navHtml = '', bodyHtml = '';
        let seenSections = new Set();
        
        messages.forEach((msg, idx) => {
            let raw = Array.isArray(msg.content)
                ? msg.content.map(p => p.type === 'text' ? p.text : '[Image]').join('\n')
                : (msg.content || '');

            let displayRole = msg.role;
            if (msg.role === 'user' && raw.includes('"type": "system_notification"')) {
                displayRole = 'system';
            }

            const LABELS = { system:'■ SYSTEM', user:'▶ USER', assistant:'◀ ASSISTANT' };
            const label = (LABELS[displayRole] || displayRole) + (idx > 0 ? ` #${idx}` : '');
            const blockId = `scp-ctx-b${idx}`;

            navHtml += `<button class="scp-ctx-nav-btn scp-ctx-nav-${displayRole}" data-t="${blockId}">${escHtml(label)}</button>`;

            if (msg.role === 'system') {
                const tagRe = /<([\w:{}_-]+)>/g;
                let tm;
                tagRe.lastIndex = 0;
                let moduleNavs = '';
                while ((tm = tagRe.exec(raw)) !== null) {
                    if (KNOWN_SECS.has(tm[1]) && !seenSections.has(tm[1])) {
                        seenSections.add(tm[1]);
                        const secLabel = SECTION_LABELS[tm[1]] || tm[1];
                        const secId = `scp-ctx-sec-${tm[1]}`;
                        
                        if (['memory_system','lorebook_management','character_management','chat_messages_editing', 'tool_calls_system'].includes(tm[1])) {
                            moduleNavs += `<button class="scp-ctx-nav-btn scp-ctx-nav-sub" data-t="${secId}">&nbsp;&nbsp;◦ ${escHtml(secLabel)}</button>`;
                        } else {
                            navHtml += `<button class="scp-ctx-nav-btn scp-ctx-nav-sub" data-t="${secId}">&nbsp;&nbsp;◦ ${escHtml(secLabel)}</button>`;
                        }
                    }
                }
                if (moduleNavs) {
                     navHtml += `<details class="scp-ctx-nav-details" open><summary class="scp-ctx-nav-btn" style="color:var(--scp-text)">▼ Modules</summary>${moduleNavs}</details>`;
                }
            }

            const highlighted = _highlightContextText(raw);
            bodyHtml += `<div class="scp-ctx-block" id="${blockId}">`;
            bodyHtml += `<div class="scp-ctx-block-header scp-ctx-role-${displayRole}">${escHtml(label)}</div>`;
            bodyHtml += `<div class="scp-ctx-block-sep"></div>`;
            bodyHtml += `<div class="scp-ctx-block-body"><pre class="scp-ctx-pre">${highlighted}</pre></div>`;
            bodyHtml += `</div>`;
        });

        const styleHtml = `<style>
            .scp-ctx-hl-tag-d0 { color: #eff6ff !important; }
            .scp-ctx-hl-tag-d1 { color: #bfdbfe !important; }
            .scp-ctx-hl-tag-d2 { color: #93c5fd !important; }
            .scp-ctx-hl-tag-d3 { color: rgb(106, 165, 236) !important; }
            .scp-ctx-hl-tag-d4 { color: rgb(100, 158, 253) !important; }
            .scp-ctx-hl-tag-d5 { color: rgb(74, 120, 221) !important; }
        </style>`;

        return `<div class="scp-ctx-inspector">${styleHtml}<nav class="scp-ctx-nav">${navHtml}</nav><div class="scp-ctx-body" id="scp-ctx-body">${bodyHtml}</div></div>`;
    }

    async function openInspector() {
        const sess = getCurrentSession();
        const settings = getEffectiveSettings();
        const inputEl = document.getElementById('scp-input');
        const pendingText = inputEl ? inputEl.value.trim() : '';
        const processedAtts = await _processAttachmentsBeforeSend(_pendingAttachments, true);
        const messages = await assembleMessages(sess, settings, pendingText, processedAtts);
        _lastInspectorMessages = messages;

        const fmtEl = $('scp-ctx-formatted');
        const jsonEl = $('scp-ctx-json');
        
        const modal = modalEl.querySelector('.scp-modal');
        if (modal) {
            modal.style.height = '75vh';
        }
        
        const modalBody = modalEl.querySelector('.scp-modal-body');
        if (modalBody) {
            modalBody.style.padding = '0';
            modalBody.style.overflow = 'hidden';
            modalBody.style.display = 'flex';
            modalBody.style.flexDirection = 'column';
            modalBody.style.height = '100%';
        }

        if (fmtEl) {
            fmtEl.style.height = '100%';
            fmtEl.style.flex = '1';
            fmtEl.style.overflow = 'hidden';
            fmtEl.style.padding = '0';
            fmtEl.innerHTML = _buildContextInspectorHTML(messages);
            
            fmtEl.querySelectorAll('.scp-ctx-nav-btn[data-t]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const t = document.getElementById(btn.dataset.t);
                    const bodyContainer = document.getElementById('scp-ctx-body');
                    if (t && bodyContainer) {
                        const topPos = t.offsetTop;
                        bodyContainer.scrollTo({ top: topPos, behavior: 'smooth' });
                    }
                });
            });
        }
        if (jsonEl) jsonEl.textContent = JSON.stringify(messages, null, 2);
        modalEl.style.display = 'flex';
        
        setTimeout(() => {
            const isJsonActive = document.querySelector('.scp-modal-tab.active')?.dataset.tab === 'json';
            const targetEl = isJsonActive ? jsonEl : document.getElementById('scp-ctx-body');
            if (targetEl) {
                const prevBehavior = targetEl.style.scrollBehavior;
                targetEl.style.scrollBehavior = 'auto';
                targetEl.scrollTop = targetEl.scrollHeight;
                targetEl.style.scrollBehavior = prevBehavior;
            }
        }, 0);
    }

    // ─── Drag & Resize ──────────────────────────────────────────────────────────

    function getEvCoords(e) {
        if (e.touches && e.touches.length > 0) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        return { x: e.clientX, y: e.clientY };
    }

    function makeDraggable(handle, target) {
        let active = false, ox = 0, oy = 0, sl = 0, st = 0;
        let _rafId = null;
        let _anchorX = 0, _anchorY = 0;

        let tx = 0, ty = 0;
        let cx = 0, cy = 0;
        let vx = 0, vy = 0;

        let rotX = 0, rotY = 0, rotZ = 0, skewX = 0, skewY = 0;
        let vRotX = 0, vRotY = 0, vRotZ = 0, vSkewX = 0, vSkewY = 0;

        let isWobbly = true;

        const tick = () => {
            if (!active && 
                Math.abs(vx) < 0.1 && Math.abs(vy) < 0.1 &&
                Math.abs(vRotX) < 0.1 && Math.abs(vRotY) < 0.1 && Math.abs(vRotZ) < 0.1 &&
                Math.abs(rotX) < 0.1 && Math.abs(rotY) < 0.1 && Math.abs(rotZ) < 0.1 &&
                Math.abs(tx - cx) < 0.5 && Math.abs(ty - cy) < 0.5) {
                
                target.style.transform = '';
                target.style.transformOrigin = '';
                target.style.left = `${Math.max(0, tx)}px`;
                target.style.top = `${Math.max(0, ty)}px`;
                _rafId = null;
                
                vx = vy = 0;
                rotX = rotY = rotZ = skewX = skewY = 0;
                vRotX = vRotY = vRotZ = vSkewX = vSkewY = 0;
                
                saveWindowState();
                return;
            }

            if (isWobbly) {
                const tension = 0.28;   
                const friction = 0.62;  
                const aTension = 0.18;  
                const aFriction = 0.72; 

                const dx = tx - cx;
                const dy = ty - cy;
                
                vx = (vx + dx * tension) * friction;
                vy = (vy + dy * tension) * friction;
                cx += vx;
                cy += vy;

                const targetRotY = dx * 0.12 + vx * 0.02; 
                const targetRotX = -(dy * 0.12 + vy * 0.02);
                const targetRotZ = (-dx * _anchorY + dy * _anchorX) * 0.05;
                const targetSkewX = -vx * 0.03;
                const targetSkewY = -vy * 0.03;

                vRotX = (vRotX + (targetRotX - rotX) * aTension) * aFriction;
                vRotY = (vRotY + (targetRotY - rotY) * aTension) * aFriction;
                vRotZ = (vRotZ + (targetRotZ - rotZ) * aTension) * aFriction;
                vSkewX = (vSkewX + (targetSkewX - skewX) * aTension) * aFriction;
                vSkewY = (vSkewY + (targetSkewY - skewY) * aTension) * aFriction;

                rotX += vRotX;
                rotY += vRotY;
                rotZ += vRotZ;
                skewX += vSkewX;
                skewY += vSkewY;

                const clamp = (val, max) => Math.max(-max, Math.min(max, val));
                const cRotX = clamp(rotX, 15);
                const cRotY = clamp(rotY, 15);
                const cRotZ = clamp(rotZ, 8);
                const cSkewX = clamp(skewX, 5);
                const cSkewY = clamp(skewY, 5);

                const speed = Math.sqrt(vx*vx + vy*vy);
                const scaleStr = Math.max(0.98, 1 - speed * 0.0004);

                target.style.left = `${cx}px`;
                target.style.top = `${cy}px`;
                
                target.style.transformOrigin = `${(_anchorX * 50 + 50)}% ${(_anchorY * 50 + 50)}%`;
                target.style.transform = `perspective(1200px) scale(${scaleStr}) rotateX(${cRotX}deg) rotateY(${cRotY}deg) rotateZ(${cRotZ}deg) skew(${cSkewX}deg, ${cSkewY}deg)`;
            } else {
                cx = tx; cy = ty;
                
                vx = vy = 0;
                rotX = rotY = rotZ = skewX = skewY = 0;
                vRotX = vRotY = vRotZ = vSkewX = vSkewY = 0;

                target.style.transform = '';
                target.style.left = `${Math.max(0, cx)}px`;
                target.style.top = `${Math.max(0, cy)}px`;
            }

            _rafId = requestAnimationFrame(tick);
        };

        handle.addEventListener('pointerdown', e => {
            if (e.target.closest('.scp-hbtn,.scp-tbtn,select,input,button,.scp-opacity-wrap,.scp-rh,.scp-sess-dropdown,.scp-sess-wrap')) return;
            
            isWobbly = getSettings().wobbleWindow !== false && !getSettings().performanceMode;

            if (_rafId && isWobbly) {
                sl = cx; 
                st = cy;
                const w = target.offsetWidth;
                const h = target.offsetHeight;
                _anchorX = (e.clientX - (sl + w/2)) / (w/2);
                _anchorY = (e.clientY - (st + h/2)) / (h/2);
            } else {
                const r = target.getBoundingClientRect();
                sl = r.left; 
                st = r.top;
                _anchorX = (e.clientX - (r.left + r.width/2)) / (r.width/2);
                _anchorY = (e.clientY - (r.top + r.height/2)) / (r.height/2);
                
                cx = sl; cy = st;
                vx = vy = 0;
                rotX = rotY = rotZ = skewX = skewY = 0;
                vRotX = vRotY = vRotZ = vSkewX = vSkewY = 0;
            }

            ox = e.clientX; oy = e.clientY; 
            tx = sl; ty = st;

            active = true;
            handle.setPointerCapture(e.pointerId);
            target.classList.add('scp-dragging');
            e.preventDefault();
            
            if (!_rafId) _rafId = requestAnimationFrame(tick);
        });

        handle.addEventListener('pointermove', e => {
            if (!active) return;
            tx = Math.max(0, sl + (e.clientX - ox));
            ty = Math.max(0, st + (e.clientY - oy));
        });

        const onEnd = () => {
            if (!active) return;
            active = false;
            target.classList.remove('scp-dragging');
            if (!isWobbly) {
                saveWindowState();
            }
        };

        handle.addEventListener('pointerup', onEnd);
        handle.addEventListener('pointercancel', onEnd);
        handle.style.touchAction = 'none';
    }

    function makeResizable(target) {
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
        let active = false;
        let offsetX = 0, offsetY = 0;
        let startX = 0, startY = 0;
        let _rafId = null;

        let tx = 0, ty = 0;
        let cx = 0, cy = 0;
        let vx = 0, vy = 0;

        let stretch = 0;
        let vStretch = 0;
        let angle = 0;

        const tick = () => {
            const isWobbly = getSettings().wobbleWindow !== false && !getSettings().performanceMode;

            if (!active && !dragging &&
                Math.abs(vx) < 0.05 && Math.abs(vy) < 0.05 &&
                Math.abs(tx - cx) < 0.5 && Math.abs(ty - cy) < 0.5 &&
                Math.abs(stretch) < 0.005 && Math.abs(vStretch) < 0.005) {
                
                iconTarget.style.transform = '';
                iconTarget.style.left = `${tx}px`;
                iconTarget.style.top = `${ty}px`;
                _rafId = null;
                vx = vy = stretch = vStretch = 0;
                
                localStorage.setItem(ICON_STORAGE_KEY, JSON.stringify({
                    left: iconTarget.style.left,
                    top: iconTarget.style.top,
                }));
                return;
            }

            if (isWobbly) {
                const tension = 0.28;   
                const friction = 0.62;  

                const dx = tx - cx;
                const dy = ty - cy;

                vx = (vx + dx * tension) * friction;
                vy = (vy + dy * tension) * friction;
                cx += vx;
                cy += vy;

                const speed = Math.sqrt(vx * vx + vy * vy);
                const targetStretch = Math.min(0.35, speed * 0.015);
                
                const sTension = 0.22;
                const sFriction = 0.68;
                const dStretch = targetStretch - stretch;
                vStretch = (vStretch + dStretch * sTension) * sFriction;
                stretch += vStretch;

                if (speed > 0.5) {
                    angle = Math.atan2(vy, vx) * (180 / Math.PI);
                }

                iconTarget.style.left = `${cx}px`;
                iconTarget.style.top = `${cy}px`;
                iconTarget.style.transform = `rotate(${angle}deg) scale(${1 + stretch}, ${1 - stretch}) rotate(${-angle}deg)`;
            } else {
                cx = tx; cy = ty;
                vx = vy = stretch = vStretch = 0;
                iconTarget.style.transform = '';
                iconTarget.style.left = `${tx}px`;
                iconTarget.style.top = `${ty}px`;
            }

            _rafId = requestAnimationFrame(tick);
        };

        iconTarget.addEventListener('pointerdown', e => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            
            dragging = false;
            active = true;
            
            const r = iconTarget.getBoundingClientRect();
            offsetX = e.clientX - r.left;
            offsetY = e.clientY - r.top;
            
            startX = r.left;
            startY = r.top;
            
            cx = r.left;
            cy = r.top;
            tx = cx;
            ty = cy;
            vx = vy = stretch = vStretch = 0;

            iconTarget.setPointerCapture(e.pointerId);
            e.preventDefault();
        });

        iconTarget.addEventListener('pointermove', e => {
            if (!iconTarget.hasPointerCapture(e.pointerId)) return;
            
            const rawX = e.clientX - offsetX;
            const rawY = e.clientY - offsetY;
            
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            
            tx = Math.max(0, Math.min(viewportWidth - 46, rawX));
            ty = Math.max(0, Math.min(viewportHeight - 46, rawY));
            
            const moveDist = Math.sqrt((tx - startX) * (tx - startX) + (ty - startY) * (ty - startY));
            if (!dragging && moveDist > 6) {
                dragging = true;
                iconTarget.classList.add('scp-icon-dragging');
            }

            if (!_rafId) _rafId = requestAnimationFrame(tick);
        });

        iconTarget.addEventListener('pointerup', e => {
            if (iconTarget.hasPointerCapture(e.pointerId)) {
                iconTarget.releasePointerCapture(e.pointerId);
            }
            active = false;
            iconTarget.classList.remove('scp-icon-dragging');
            
            if (dragging) {
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
            active = false;
            iconTarget.classList.remove('scp-icon-dragging');
        });

        iconTarget.style.touchAction = 'none';
    }

    // ─── Theme ──────────────────────────────────────────────────────────────────
    
    function buildBackgroundSettingsUI(container) {
        if (!container) return;
        container.innerHTML = '';
        const s = getSettings();
        if (!s.customBackgrounds) s.customBackgrounds = {};

        const isSP = container.id === 'scp-sp-bg-settings';

        // TYPE SELECTOR
        const typeRow = document.createElement('div');
        typeRow.className = isSP ? 'scp-sp-field' : '';
        
        const typeLbl = document.createElement(isSP ? 'label' : 'b');
        typeLbl.className = isSP ? 'scp-sp-label' : '';
        if (!isSP) typeLbl.style.cssText = 'font-size:11px;color:#888;display:block;margin-bottom:4px';
        typeLbl.textContent = 'Background Type';
        
        const typeWrap = document.createElement('div');
        typeWrap.style.cssText = 'display:flex;gap:6px;align-items:center';
        
        const typeSel = document.createElement('select');
        typeSel.className = isSP ? 'scp-sp-select text_pole' : 'text_pole';
        typeSel.style.flex = '1';
        
        const renderDropdown = () => {
            typeSel.innerHTML = '<option value="none">None</option>';
            if (Object.keys(s.customBackgrounds).length > 0) {
                const groupCustom = document.createElement('optgroup');
                groupCustom.label = 'Custom Backgrounds';
                for (const [key, bg] of Object.entries(s.customBackgrounds)) {
                    const opt = document.createElement('option');
                    opt.value = key; opt.textContent = bg.name;
                    groupCustom.appendChild(opt);
                }
                typeSel.appendChild(groupCustom);
            }
            typeSel.value = s.windowBg || 'none';
        };
        renderDropdown();
        typeWrap.appendChild(typeSel);
        typeRow.appendChild(typeLbl); typeRow.appendChild(typeWrap);
        container.appendChild(typeRow);

        // ACTIONS
        const customActionsWrap = document.createElement('div');
        customActionsWrap.style.cssText = isSP ? 'display:flex;gap:6px;margin-top:6px' : 'display:flex;gap:6px;margin-top:6px;align-items:center';
        
        const uploadBtn = document.createElement('button');
        uploadBtn.className = isSP ? 'scp-action-btn' : 'menu_button interactable';
        uploadBtn.innerHTML = `<i class="fa-solid fa-upload"></i><span>Upload</span>`;
        if (!isSP) uploadBtn.style.flex = '1';

        uploadBtn.addEventListener('click', () => {
            const inp = document.createElement('input');
            inp.type = 'file'; inp.accept = 'image/*,video/mp4,video/webm';
            inp.onchange = async () => {
                const file = inp.files?.[0]; if (!file) return;
                if (file.size > 25 * 1024 * 1024) { toastr.warning('File too large (>25MB).', EXT_DISPLAY); return; }
                const isVideo = file.type.startsWith('video/');
                const dataUrl = await _fileToDataUrl(file).catch(() => null);
                if (!dataUrl) return;
                
                const s2 = getSettings();
                const id = 'bg_' + Date.now();
                s2.customBackgrounds[id] = { name: file.name, dataUrl, isVideo, fit: 'cover' };
                s2.windowBg = id;
                saveSettings();
                
                const allContainers = [document.getElementById('scp-bg-settings'), document.getElementById('scp-sp-bg-settings')].filter(Boolean);
                allContainers.forEach(c => buildBackgroundSettingsUI(c));
                applyWindowBackground();
            };
            inp.click();
        });

        const urlBtn = document.createElement('button');
        urlBtn.className = isSP ? 'scp-action-btn' : 'menu_button interactable';
        urlBtn.innerHTML = `<i class="fa-solid fa-link"></i><span>URL</span>`;
        if (!isSP) urlBtn.style.flex = '1';

        urlBtn.addEventListener('click', async () => {
            const url = await showCustomDialog({ type: 'prompt', title: 'Add Background', message: 'Enter direct URL to image or video:', placeholder: 'https://...' });
            if (url && url.trim()) {
                const s2 = getSettings();
                const id = 'bg_' + Date.now();
                const isVideo = url.endsWith('.mp4') || url.endsWith('.webm');
                s2.customBackgrounds[id] = { name: 'URL Background', dataUrl: url.trim(), isVideo, fit: 'cover' };
                s2.windowBg = id;
                saveSettings();
                const allContainers = [document.getElementById('scp-bg-settings'), document.getElementById('scp-sp-bg-settings')].filter(Boolean);
                allContainers.forEach(c => buildBackgroundSettingsUI(c));
                applyWindowBackground();
            }
        });

        const renameBtn = document.createElement('button');
        renameBtn.className = isSP ? 'scp-action-btn' : 'menu_button interactable';
        renameBtn.innerHTML = `<i class="fa-solid fa-pen"></i><span>Rename</span>`;
        if (!isSP) renameBtn.style.flex = '1';

        renameBtn.addEventListener('click', async () => {
            const val = typeSel.value;
            if (val === 'none') return;
            const bg = s.customBackgrounds[val];
            const newName = await showCustomDialog({ type: 'prompt', title: 'Rename Background', message: 'New name:', defaultValue: bg.name });
            if (newName && newName.trim()) {
                s.customBackgrounds[val].name = newName.trim();
                saveSettings();
                const allContainers = [document.getElementById('scp-bg-settings'), document.getElementById('scp-sp-bg-settings')].filter(Boolean);
                allContainers.forEach(c => buildBackgroundSettingsUI(c));
            }
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.className = isSP ? 'scp-action-btn scp-sp-danger-btn' : 'menu_button interactable';
        deleteBtn.innerHTML = `<i class="fa-solid fa-trash"></i><span>Delete</span>`;
        if (!isSP) deleteBtn.style.flex = '1';

        deleteBtn.addEventListener('click', async () => {
            const val = typeSel.value;
            if (val === 'none') return;
            const ok = await showCustomDialog({ type: 'confirm', title: 'Delete Background', message: 'Delete this background?' });
            if (!ok) return;
            const s2 = getSettings();
            delete s2.customBackgrounds[val];
            s2.windowBg = 'none';
            saveSettings();
            const allContainers = [document.getElementById('scp-bg-settings'), document.getElementById('scp-sp-bg-settings')].filter(Boolean);
            allContainers.forEach(c => buildBackgroundSettingsUI(c));
            applyWindowBackground();
        });
        
        customActionsWrap.appendChild(uploadBtn);
        customActionsWrap.appendChild(urlBtn);
        customActionsWrap.appendChild(renameBtn);
        customActionsWrap.appendChild(deleteBtn);
        container.appendChild(customActionsWrap);

        // EXTRA SETTINGS
        const extraWrap = document.createElement('div');
        extraWrap.style.cssText = 'margin-top:12px';

        const fitRow = document.createElement('div');
        fitRow.className = isSP ? 'scp-sp-field' : '';
        const fitLbl = document.createElement('label');
        fitLbl.className = isSP ? 'scp-sp-label' : '';
        if (!isSP) fitLbl.style.cssText = 'font-size:11px;color:#888;display:block;margin-bottom:4px';
        fitLbl.textContent = 'Image/Video Fit';
        const fitSel = document.createElement('select');
        fitSel.className = isSP ? 'scp-sp-select text_pole' : 'text_pole';
        ['cover', 'contain', 'fill', 'center'].forEach(f => {
            const opt = document.createElement('option'); opt.value = f; opt.textContent = f; fitSel.appendChild(opt);
        });
        
        const currentBgData = s.customBackgrounds[s.windowBg];
        fitSel.value = currentBgData?.fit || 'cover';
        
        fitSel.addEventListener('change', () => {
            if (s.windowBg !== 'none' && s.customBackgrounds[s.windowBg]) {
                s.customBackgrounds[s.windowBg].fit = fitSel.value;
                saveSettings();
                const allContainers = [document.getElementById('scp-bg-settings'), document.getElementById('scp-sp-bg-settings')].filter(Boolean);
                allContainers.forEach(c => { const s = c.querySelector('select[id$="fit-sel"]'); if(s) s.value = fitSel.value; });
                applyWindowBackground();
            }
        });
        fitSel.id = isSP ? 'scp-sp-fit-sel' : 'scp-fit-sel';
        fitRow.appendChild(fitLbl); fitRow.appendChild(fitSel);
        extraWrap.appendChild(fitRow);

        const dimRow = document.createElement('div');
        dimRow.className = isSP ? 'scp-sp-field' : '';
        dimRow.style.marginTop = '8px';
        const dimLbl = document.createElement('label');
        dimLbl.className = isSP ? 'scp-sp-label' : '';
        if (!isSP) dimLbl.style.cssText = 'font-size:11px;color:#888;display:block;margin-bottom:4px';
        dimLbl.textContent = 'Darkness Overlay';
        const dimFlex = document.createElement('div');
        dimFlex.className = isSP ? 'scp-sp-row' : '';
        if (!isSP) dimFlex.style.cssText = 'display:flex;align-items:center;gap:10px';
        
        const dimSlider = document.createElement('input');
        dimSlider.type = 'range'; dimSlider.min = '0'; dimSlider.max = '100';
        dimSlider.className = isSP ? 'scp-slider' : 'neo-range-slider';
        dimSlider.style.flex = '1'; dimSlider.value = s.windowBgDim ?? 50;
        
        const dimVal = document.createElement('span');
        dimVal.style.cssText = isSP ? 'min-width:32px;text-align:right;font-size:11px;color:var(--scp-accent)' : 'font-size:12px;min-width:34px;text-align:right;color:var(--SmartThemeQuoteColor,#a99bfb)';
        dimVal.textContent = `${dimSlider.value}%`;

        dimSlider.addEventListener('input', () => { dimVal.textContent = `${dimSlider.value}%`; });
        dimSlider.addEventListener('change', () => {
            getSettings().windowBgDim = parseInt(dimSlider.value); saveSettings();
            const allContainers = [document.getElementById('scp-bg-settings'), document.getElementById('scp-sp-bg-settings')].filter(Boolean);
            allContainers.forEach(c => { const s = c.querySelector('input[type="range"]'); if(s && s !== dimSlider) { s.value = dimSlider.value; s.nextElementSibling.textContent = `${dimSlider.value}%`; } });
            applyWindowBackground();
        });

        dimFlex.appendChild(dimSlider); dimFlex.appendChild(dimVal);
        dimRow.appendChild(dimLbl); dimRow.appendChild(dimFlex);
        extraWrap.appendChild(dimRow);

        container.appendChild(extraWrap);

        const updateVisibility = () => {
            const isNone = typeSel.value === 'none';
            renameBtn.style.display = isNone ? 'none' : '';
            deleteBtn.style.display = isNone ? 'none' : '';
            extraWrap.style.display = isNone ? 'none' : 'block';
        };
        updateVisibility();

        typeSel.addEventListener('change', () => {
            getSettings().windowBg = typeSel.value;
            saveSettings();
            updateVisibility();
            const allContainers = [document.getElementById('scp-bg-settings'), document.getElementById('scp-sp-bg-settings')].filter(Boolean);
            allContainers.forEach(c => buildBackgroundSettingsUI(c));
            applyWindowBackground();
        });
    }

    function applyWindowBackground() {
        if (!windowEl) return;
        const s = getSettings();
        const bgId = s.windowBg || 'none';
        const dim = (s.windowBgDim ?? 50) / 100;

        windowEl.style.removeProperty('--scp-bg-image');
        windowEl.classList.remove('scp-has-bg');
        
        let mediaEl = document.getElementById('scp-bg-media');

        if (bgId === 'none' || !s.customBackgrounds || !s.customBackgrounds[bgId]) {
            if (mediaEl) mediaEl.remove();
            return;
        }

        const bg = s.customBackgrounds[bgId];
        const fit = bg.fit || 'cover';

        const isVideo = bg.isVideo;
        if (mediaEl) {
            const isVideoTag = mediaEl.tagName.toLowerCase() === 'video';
            if (isVideo !== isVideoTag) {
                mediaEl.remove();
                mediaEl = null;
            }
        }

        if (!mediaEl) {
            mediaEl = document.createElement(isVideo ? 'video' : 'img');
            mediaEl.id = 'scp-bg-media';
            if (isVideo) {
                mediaEl.autoplay = true; 
                mediaEl.loop = true; 
                mediaEl.muted = true; 
                mediaEl.playsInline = true;
            }
            windowEl.insertBefore(mediaEl, windowEl.firstChild);
        }

        mediaEl.className = `scp-bg-media bg-${fit}`;
        if (mediaEl.src !== bg.dataUrl) mediaEl.src = bg.dataUrl;
        
        windowEl.style.setProperty('--scp-bg-dim', dim);
        windowEl.classList.add('scp-has-bg');
    }

    function _setupAttachButton() {
        const btn = document.getElementById('scp-attach-btn');
        if (!btn) return;
        btn.addEventListener('click', () => {
            const inp = document.createElement('input');
            inp.type = 'file';
            inp.multiple = true;
            inp.accept = 'image/*,text/*,.pdf,.json,.txt,.md,.csv,.log,.js,.py,.html,.css';
            inp.onchange = () => { 
                if (inp.files?.length) {
                    const file = inp.files[0];

                    if (file.size > 25 * 1024 * 1024) _dbgAdd('ATTACHMENT_SIZE_EXCEEDED', { name: file.name, size: file.size });
                    
                    _addAttachments(Array.from(inp.files)); 
                }
            };
            inp.click();
        });
    }

    async function _uploadBackgroundToST(file) {
        const formData = new FormData();
        formData.append('avatar', file);
        const ctx = SillyTavern.getContext();
        const headers = ctx.getRequestHeaders();
        delete headers['Content-Type'];
        const res = await fetch('/api/backgrounds/upload', {
            method: 'POST',
            headers,
            body: formData
        });
        if (res.ok) {
            const text = await res.text();
            let filename = text;
            try { const j = JSON.parse(text); if (j.path) filename = j.path; } catch(e){}
            if (!filename.startsWith('/')) filename = `/backgrounds/${filename}`;
            return filename;
        }
        throw new Error('Background upload failed');
    }

    function _setupBgUpload(btnId, inputId) {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        btn.addEventListener('click', () => {
            const inp = document.createElement('input');
            inp.type = 'file';
            inp.accept = 'image/*,video/mp4,video/webm';
            inp.onchange = async () => {
                const file = inp.files[0];
                if (!file) return;
                if (file.size > 25 * 1024 * 1024) { toastr.warning('File is too large (>25MB). Use URL instead.', EXT_DISPLAY); return; }
                const url = await _uploadBackgroundToST(file).catch(() => null);
                if (url) {
                    getSettings().windowBgUrl = url;
                    saveSettings();
                    const urlInput = document.getElementById(inputId);
                    if (urlInput) urlInput.value = url;
                    applyWindowBackground();
                    _syncBgToOverlay();
                } else {
                    toastr.error('Failed to upload background.', EXT_DISPLAY);
                }
            };
            inp.click();
        });
    }

    function applyCustomTheme(theme) {
        if (!theme) return;
        const targets = [windowEl, iconEl, document.getElementById('scp-lb-overlay'), document.getElementById('scp-diff-modal'), document.getElementById('scp-settings-overlay'), document.getElementById('scp-picker-overlay')].filter(Boolean);
        const s = getSettings();
        
        for (const [key, cssVar] of Object.entries(THEME_CSS_MAP)) {
            if (key === 'font' || key === 'fontSize') continue;
            if (theme[key] !== undefined && theme[key] !== '') {
                let val = theme[key];
                
                if (s.performanceMode) {
                    if (key === 'blur') val = 'none';
                    if (key === 'shadow') val = '0 8px 24px rgba(0,0,0,0.85)';
                    if (key === 'bg' && val.includes('rgba')) {
                        val = val.replace(/,\s*0\.[0-8]\d*\)/, ', 0.96)');
                    }
                }

                targets.forEach(t => t.style.setProperty(cssVar, val));
            }
        }
        const fontVal = (theme.font || '').trim();
        targets.forEach(t => fontVal
            ? t.style.setProperty('--scp-font', fontVal)
            : t.style.removeProperty('--scp-font'));
            
        let fontSizeVal = (theme.fontSize || '').trim();
        if (/^\d+$/.test(fontSizeVal)) fontSizeVal += 'px';
        
        targets.forEach(t => {
            if (fontSizeVal) {
                t.style.setProperty('--scp-font-size', fontSizeVal);
                t.style.fontSize = fontSizeVal;
            } else {
                t.style.removeProperty('--scp-font-size');
                t.style.fontSize = '';
            }
        });
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
            const vw = window.innerWidth;
            const vh = window.innerHeight;
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
        applyWindowBackground();
    }

    // ─── Visibility ─────────────────────────────────────────────────────────────

    function updateIconVisibility() {
        if (!iconEl) return;
        const s = getSettings();
        
        if (!s.enabled) {
            iconEl.style.setProperty('display', 'none', 'important');
            return;
        }
        
        if (s.minimized || s.floatingIconPersistent) {
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
        _copilotActive = false;
        saveSettings(); 
        updateIconVisibility();
    }
    
    function restoreFromMinimize() { 
        const s = getSettings(); 
        s.minimized = false; 
        windowEl.style.display = 'flex'; 
        _copilotActive = true;
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
        _copilotActive = false;
        saveSettings(); 
        updateIconVisibility();
    }
    
    function showWindow() {
        const s = getSettings(); 
        if (!s.enabled) { toastr.warning('ST-Copilot is disabled.', EXT_DISPLAY); return; }
        s.windowVisible = true; 
        s.minimized = false;
        windowEl.style.display = 'flex';
        _copilotActive = true;
        _userScrolledUp = false;
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

    let _searchHotkeyHandler = null;

    function setupSearchHotkey() {
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
            
            if (!_copilotActive) return;
            
            const win = document.getElementById(WIN_ID);
            if (!win || win.style.display === 'none') return;
            
            const overlays = ['scp-lb-overlay', 'scp-settings-overlay', 'scp-picker-overlay', 'scp-diff-modal', 'scp-changelog-modal'];
            for (const id of overlays) {
                const el = document.getElementById(id);
                if (el && el.style.display !== 'none' && el.style.display !== '') return;
            }
            if (document.querySelector('.scp-dialog-overlay.visible')) return;
            
            e.preventDefault();
            e.stopPropagation();
            if (_searchOpen) { document.getElementById('scp-search-input')?.focus(); }
            else openSearch();
        };
        document.addEventListener('keydown', _searchHotkeyHandler, true);
    }

    // ─── Session Dropdown ────────────────────────────────────────────────────────

    function closeSessPanel() {
        $('scp-sess-panel')?.classList.remove('open');
        $('scp-sess-trigger')?.classList.remove('open');
    }

    async function refreshSessionDropdown() {
        const bucket = getChatBucket();
        const nameEl = $('scp-sess-name'); const listEl = $('scp-sess-list');
        if (!nameEl || !listEl) return;
        const activeSess = bucket.sessions.find(s => s.id === bucket.activeSessionId);
        nameEl.textContent = activeSess?.name || 'No Sessions';
        listEl.innerHTML = '';
        
        if (!bucket.sessions.length) {
            listEl.innerHTML = `<div class="scp-sess-empty-label">No sessions — create one below</div>`;
        } else {
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

                if (sess.id === bucket.activeSessionId) {
                    const tmpBtn = document.createElement('button');
                    tmpBtn.className = `scp-sess-tmp-btn${sess.isTemporary ? ' active' : ''}`;
                    tmpBtn.title = sess.isTemporary ? 'Make permanent' : 'Make temporary';
                    tmpBtn.innerHTML = '⏱';
                    tmpBtn.addEventListener('click', e => {
                        e.stopPropagation();
                        sess.isTemporary = !sess.isTemporary;
                        saveSessionsToMetadata();
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
                    setActiveSession(sess.id);
                    refreshSessionDropdown(); renderSession(getCurrentSession()); closeSessPanel();
                });
                listEl.appendChild(item);
            }
        }

        const s = getSettings();
        const orphanedSessions = [];
        const ctx2 = SillyTavern.getContext();
        const { charId, chatId } = getBindingKey();
        
        const currentCharName = ctx2.characters?.[ctx2.characterId]?.name;
        if (charId !== 'global' && currentCharName && s.sessions[charId]) {
            for (const chId in s.sessions[charId]) {
                const b = s.sessions[charId][chId];
                if (b && b.sessions && b.sessions.length > 0) {
                    const validSessions = b.sessions.filter(sess => sess.messages && sess.messages.length > 0);
                    if (validSessions.length > 0) {
                        orphanedSessions.push({ chId, sessions: validSessions, source: 'legacy' });
                    }
                }
            }
        }

        try {
            const res = await fetch('/api/images/list', {
                method: 'POST',
                headers: { ...ctx2.getRequestHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ directory: '' })
            }).catch(() => null);

            if (res && res.ok) {
                const data = await res.json();
                const files = Array.isArray(data) ? data : (data.files || []);
                const currentFileId = ctx2.chatMetadata?.st_copilot?.file_id;

                for (const f of files) {
                    const fname = typeof f === 'string' ? f : f.name;
                    if (fname && fname.startsWith('copilot_sess_') && fname.endsWith('.json') && fname !== currentFileId) {
                        const payload = await loadSessionFile(fname);
                        if (payload && payload.chat_id_reference === chatId && payload.bucket?.sessions?.length) {
                            orphanedSessions.push({ file_id: fname, sessions: payload.bucket.sessions, source: 'file' });
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('[ST-Copilot] Orphan file scan failed', e);
        }

        if (orphanedSessions.length > 0) {
            const totalOrphaned = orphanedSessions.reduce((acc, curr) => acc + curr.sessions.length, 0);
            const recoverBtn = document.createElement('button');
            recoverBtn.className = 'scp-action-btn scp-recover-btn';
            recoverBtn.style.marginTop = '12px';
            recoverBtn.style.width = '100%';
            recoverBtn.style.justifyContent = 'center';
            recoverBtn.style.backgroundColor = 'rgba(255, 180, 50, 0.1)';
            recoverBtn.style.color = '#ffb432';
            recoverBtn.style.border = '1px solid rgba(255, 180, 50, 0.3)';
            recoverBtn.innerHTML = `<i class="fa-solid fa-life-ring"></i><span>Recover ${totalOrphaned} lost session(s)</span>`;
            recoverBtn.title = "Click to migrate hidden/lost sessions into this chat's metadata.";
            
            recoverBtn.addEventListener('click', async () => {
                const ok = await showCustomDialog({
                    type: 'confirm',
                    title: 'Recover Sessions',
                    message: `Found ${totalOrphaned} session(s) belonging to this chat from storage. Move them permanently into THIS chat?`
                });
                if (!ok) return;
                
                for (const orphan of orphanedSessions) {
                    bucket.sessions.push(...orphan.sessions.map(sess => ({
                        ...sess, name: sess.name.endsWith('(Recovered)') ? sess.name : sess.name + ' (Recovered)'
                    })));
                    
                    if (orphan.source === 'legacy') {
                        delete s.sessions[charId][orphan.chId]; 
                    } else if (orphan.source === 'file') {
                        await saveSessionFile(orphan.file_id, {
                            _version: 2, chat_id_reference: chatId, updated_at: Date.now(),
                            bucket: { activeSessionId: null, sessions: [] }
                        });
                    }
                }
                
                if (orphanedSessions.some(o => o.source === 'legacy')) saveSettings();
                await commitBucketChanges(true);
                refreshSessionDropdown();
                toastr.success('Sessions successfully recovered and moved to chat metadata!', EXT_DISPLAY);
            });
            listEl.appendChild(recoverBtn);
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

    const _PROFILE_KEYS = [
        'systemPrompt', 'includeSystemPrompt', 'includeAuthorsNote', 
        'includeCharacterCard', 'includeUserPersonality', 'contextDepth', 
        'localHistoryLimit', 'connectionSource', 'connectionProfileId', 'maxTokens',
        'applyRegexToContext', 'reasoningTrimStrings', 'forceStreaming',
        'charEditAIEnabled', 'charEditPrompt', 'lorebookAIManageEnabled',
        'lorebookManagePrompt', 'lorebookAutoKeyword', 'lorebookSTScanDepth',
        'lorebookCopilotScanDepth', 'chatEditAIEnabled', 'chatEditPrompt', 'includeAlternateSwipes'
    ];

    let _profileSnapshot = null;

    function _takeProfileSnapshot() {
        const s = getSettings();
        _profileSnapshot = {};
        for (const k of _PROFILE_KEYS) _profileSnapshot[k] = JSON.stringify(s[k]);
        _profileSnapshot._charEditFields = JSON.stringify(s.charEditFields || {});
    }

    function isConfigProfileDirty() {
        if (!_profileSnapshot) return false;
        const s = getSettings();
        for (const k of _PROFILE_KEYS) {
            if (JSON.stringify(s[k]) !== _profileSnapshot[k]) return true;
        }
        if (JSON.stringify(s.charEditFields || {}) !== _profileSnapshot._charEditFields) return true;
        return false;
    }

    function saveProfile(name) {
        const s = getSettings();
        const p = {};
        for (const k of _PROFILE_KEYS) p[k] = s[k];
        p.charEditFields = JSON.parse(JSON.stringify(s.charEditFields || {}));
        s.profiles[name] = p;
        s.activeProfile = name; 
        saveSettings();
    }

    function loadProfile(name) {
        const s = getSettings(); const p = s.profiles[name]; if (!p) return;
        for (const k of _PROFILE_KEYS) {
            if (p[k] !== undefined) s[k] = p[k];
        }
        if (p.charEditFields) s.charEditFields = JSON.parse(JSON.stringify(p.charEditFields));
        s.activeProfile = name;
        saveSettings();
        if (typeof updateSettingsUI === 'function') updateSettingsUI();
        _takeProfileSnapshot();
        _configDirty = false;
        _updateDirtyDots();
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
                maxTokens: 8200,
                applyRegexToContext: true,
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
        } else if (name && !s.profiles[name]) {
            _dbgAdd('PROFILE_LOAD_BINDING_MISSING', { name });
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
            <button class="scp-profile-icon-btn" id="scp-theme-duplicate" title="Duplicate selected theme"><i class="fa-solid fa-copy"></i></button>
            <button class="scp-profile-icon-btn" id="scp-theme-rename" title="Rename selected theme"><i class="fa-solid fa-pen"></i></button>
            <button class="scp-profile-icon-btn danger" id="scp-theme-delete" title="Delete selected theme"><i class="fa-solid fa-trash"></i></button>
            <button class="scp-profile-icon-btn" id="scp-theme-export" title="Export theme to JSON file"><i class="fa-solid fa-file-export"></i></button>
            <button class="scp-profile-icon-btn" id="scp-theme-import" title="Import theme from JSON file"><i class="fa-solid fa-file-import"></i></button>
        `;
        container.appendChild(profileRow);

        const sel = profileRow.querySelector('#scp-theme-profile-select');

        const optGrpDefault = document.createElement('optgroup');
        optGrpDefault.label = 'Default Presets';
        for (const [key, preset] of Object.entries(THEME_PRESETS)) {
            const opt = document.createElement('option');
            opt.value = `__preset__${key}`;
            opt.textContent = preset.label;
            optGrpDefault.appendChild(opt);
        }
        sel.appendChild(optGrpDefault);

        const userThemeKeys = Object.keys(s.savedThemes);
        if (userThemeKeys.length) {
            const optGrpCustom = document.createElement('optgroup');
            optGrpCustom.label = 'Custom Themes';
            for (const name of userThemeKeys) {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name;
                if (name === s.activeThemeProfile) opt.selected = true;
                optGrpCustom.appendChild(opt);
            }
            sel.appendChild(optGrpCustom);
        }

        if (!s.activeThemeProfile || !s.savedThemes[s.activeThemeProfile]) {
            const matchKey = Object.keys(THEME_PRESETS).find(k =>
                THEME_VAR_DEFS.every(d => (s.customTheme?.[d.key] || '') === (THEME_PRESETS[k][d.key] || ''))
            );
            if (matchKey) sel.value = `__preset__${matchKey}`;
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
                    sel.value = s.activeThemeProfile ? s.activeThemeProfile : (Object.keys(THEME_PRESETS).find(k => `__preset__${k}` === sel.value) ? sel.value : '');
                    return;
                }
            }

            if (name.startsWith('__preset__')) {
                const presetKey = name.replace('__preset__', '');
                const s2 = getSettings();
                s2.customTheme = { ...THEME_PRESETS[presetKey] };
                s2.activeThemeProfile = '';
                saveSettings(); applyCustomTheme(s2.customTheme); buildThemeEditor(containerOverride);
            } else if (name && getSettings().savedThemes[name]) {
                const s2 = getSettings();
                s2.customTheme = { ...s2.savedThemes[name] };
                s2.activeThemeProfile = name;
                saveSettings(); applyCustomTheme(s2.customTheme); buildThemeEditor(containerOverride);
            }
        });

        profileRow.querySelector('#scp-theme-save').addEventListener('click', async () => {
            const val = sel.value;
            if (val.startsWith('__preset__')) {
                const name = await showCustomDialog({ type: 'prompt', title: 'Save as Custom Theme', message: 'Name for your custom theme:', placeholder: 'My Theme' });
                if (!name?.trim()) return;
                const n = name.trim();
                const s2 = getSettings();
                s2.savedThemes[n] = { ...s2.customTheme };
                s2.activeThemeProfile = n;
                saveSettings(); buildThemeEditor(containerOverride); toastr.success(`Theme "${n}" saved`, EXT_DISPLAY);
                _clearDirty('theme');
            } else if (val) {
                const s2 = getSettings();
                s2.savedThemes[val] = { ...s2.customTheme };
                saveSettings(); toastr.success(`Theme "${val}" updated`, EXT_DISPLAY);
                _clearDirty('theme');
            }
        });

        profileRow.querySelector('#scp-theme-create').addEventListener('click', async () => {
            const name = await showCustomDialog({ type: 'prompt', title: 'New Theme', message: 'Enter name for new custom theme:', placeholder: 'My New Theme' });
            if (!name?.trim()) return;
            const n = name.trim();
            const s2 = getSettings();
            s2.savedThemes[n] = { ...s2.customTheme };
            s2.activeThemeProfile = n;
            saveSettings(); buildThemeEditor(containerOverride); toastr.success(`Created theme "${n}"`, EXT_DISPLAY);
        });

        profileRow.querySelector('#scp-theme-duplicate').addEventListener('click', async () => {
            const val = sel.value;
            if (!val) return;
            const baseTheme = val.startsWith('__preset__') ? THEME_PRESETS[val.replace('__preset__', '')] : s.savedThemes[val];
            if (!baseTheme) return;
            
            const defaultName = (val.startsWith('__preset__') ? THEME_PRESETS[val.replace('__preset__', '')].label : val) + ' (Copy)';
            const name = await showCustomDialog({ type: 'prompt', title: 'Duplicate Theme', message: 'Name for the duplicated theme:', defaultValue: defaultName });
            if (!name?.trim()) return;
            const n = name.trim();
            const s2 = getSettings();
            s2.savedThemes[n] = JSON.parse(JSON.stringify(baseTheme));
            s2.activeThemeProfile = n;
            s2.customTheme = { ...s2.savedThemes[n] };
            saveSettings(); buildThemeEditor(containerOverride); toastr.success(`Theme duplicated as "${n}"`, EXT_DISPLAY);
        });

        profileRow.querySelector('#scp-theme-rename').addEventListener('click', async () => {
            const val = sel.value;
            if (!val || val.startsWith('__preset__')) { toastr.info('Select a custom theme to rename.', EXT_DISPLAY); return; }
            const newName = await showCustomDialog({ type: 'prompt', title: 'Rename Theme', message: 'Enter new name:', defaultValue: val });
            if (!newName?.trim() || newName.trim() === val) return;
            const n = newName.trim();
            const s2 = getSettings();
            s2.savedThemes[n] = s2.savedThemes[val];
            delete s2.savedThemes[val];
            s2.activeThemeProfile = n;
            saveSettings(); buildThemeEditor(containerOverride); toastr.success('Theme renamed.', EXT_DISPLAY);
        });

        profileRow.querySelector('#scp-theme-delete').addEventListener('click', async () => {
            const val = sel.value;
            if (!val || val.startsWith('__preset__')) { toastr.info('Select a custom theme to delete.', EXT_DISPLAY); return; }
            const ok = await showCustomDialog({ type: 'confirm', title: 'Delete Theme', message: `Delete "${val}"?` });
            if (!ok) return;
            const s2 = getSettings();
            delete s2.savedThemes[val];
            s2.activeThemeProfile = Object.keys(s2.savedThemes)[0] || '';
            if (s2.activeThemeProfile) s2.customTheme = { ...s2.savedThemes[s2.activeThemeProfile] };
            else { s2.customTheme = { ...THEME_PRESETS.default }; }
            saveSettings(); applyCustomTheme(s2.customTheme); buildThemeEditor(containerOverride);
            toastr.success('Deleted.', EXT_DISPLAY);
        });

        profileRow.querySelector('#scp-theme-export').addEventListener('click', () => {
            const s2 = getSettings();
            const val = sel.value;
            const rawName = val.startsWith('__preset__') ? val.replace('__preset__', '') : (val || 'custom');
            const payload = JSON.stringify({ name: rawName, version: 1, theme: s2.customTheme }, null, 2);
            const blob = new Blob([payload], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `st-copilot-theme-${rawName.replace(/[^a-z0-9]/gi, '_')}.json`;
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

        const grid = document.createElement('div'); grid.className = 'scp-theme-var-grid';
        for (const def of THEME_VAR_DEFS) {
            const item = document.createElement('div'); item.className = 'scp-theme-var-item';
            const label = document.createElement('div'); label.className = 'scp-theme-var-label'; label.textContent = def.label;
            const wrap = document.createElement('div'); wrap.className = 'scp-theme-var-wrap';
            const isColorKey = _COLOR_KEYS.has(def.key);
            const isFontKey = def.key === 'font' || def.key === 'fontSize';

            const preview = document.createElement('div'); preview.className = 'scp-theme-var-preview';
            
            let curVal = s.customTheme?.[def.key] ?? '';
            if (def.key === 'fontSize' && /^\d+$/.test(curVal)) {
                curVal += 'px';
            }

            if (isColorKey) {
                preview.style.background = curVal;
                preview.style.display = curVal ? '' : 'none';
                preview.classList.add('scp-color-clickable');
            } else {
                preview.style.display = 'none';
            }

            const input = document.createElement('input'); input.type = 'text'; input.className = 'scp-theme-var-input';
            input.value = curVal; input.placeholder = def.hint; input.dataset.key = def.key;
            const cssVar = THEME_CSS_MAP[def.key];
            const getDefaultVal = () => {
                const ss = getSettings();
                if (ss.activeThemeProfile && ss.savedThemes?.[ss.activeThemeProfile]) return ss.savedThemes[ss.activeThemeProfile][def.key] ?? '';
                const selEl = container.querySelector('#scp-theme-profile-select');
                const selVal = selEl?.value || '';
                if (selVal.startsWith('__preset__')) {
                    const pk = selVal.replace('__preset__', '');
                    return (THEME_PRESETS[pk] || THEME_PRESETS.default)[def.key] ?? '';
                }
                return THEME_PRESETS.default[def.key] ?? '';
            };
            const resetBtn = document.createElement('button');
            resetBtn.className = 'scp-theme-var-reset'; resetBtn.title = 'Reset to profile default'; resetBtn.textContent = '↺';
            const updateResetState = val => { resetBtn.disabled = !val || val === getDefaultVal(); };
            updateResetState(curVal);

            let _fontDebounce = null;
            const applyVal = val => {
                const s2 = getSettings();
                if (!s2.customTheme) s2.customTheme = {};
                s2.customTheme[def.key] = val;
                saveSettings();
                _markDirty('theme');
                
                document.querySelectorAll(`input.scp-theme-var-input[data-key="${def.key}"]`).forEach(inp => {
                    if (inp.value !== val) inp.value = val;
                });

                if (isColorKey) {
                    if (cssVar) [windowEl, document.getElementById('scp-lb-overlay'), document.getElementById('scp-diff-modal')]
                        .filter(Boolean).forEach(t => t.style.setProperty(cssVar, val));
                    preview.style.background = val;
                    preview.style.display = val ? '' : 'none';
                } else if (isFontKey) {
                    clearTimeout(_fontDebounce);
                    _fontDebounce = setTimeout(() => {
                        let fVal = val.trim();
                        if (def.key === 'fontSize' && /^\d+$/.test(fVal)) fVal += 'px';
                        
                        const targets = [windowEl, document.getElementById('scp-lb-overlay'),
                            document.getElementById('scp-diff-modal'), document.getElementById('scp-settings-overlay'),
                            document.getElementById('scp-picker-overlay')].filter(Boolean);
                        targets.forEach(t => {
                            if (fVal) {
                                t.style.setProperty(cssVar, fVal);
                                if (def.key === 'fontSize') t.style.fontSize = fVal;
                            } else {
                                t.style.removeProperty(cssVar);
                                if (def.key === 'fontSize') t.style.fontSize = '';
                            }
                        });
                    }, 600);
                } else {
                    if (cssVar) [windowEl, document.getElementById('scp-lb-overlay'), document.getElementById('scp-diff-modal')]
                        .filter(Boolean).forEach(t => t.style.setProperty(cssVar, val));
                }
                updateResetState(val);
            };
            input.addEventListener('input', () => applyVal(input.value));
            resetBtn.addEventListener('click', () => {
                const dv = getDefaultVal();
                applyVal(isFontKey ? (dv || '') : (dv || ''));
            });
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
        const s = getSettings();
        let currentVal = s.connectionProfileId || '';

        const service = ctx.ConnectionManagerRequestService;
        
        let profiles = [];
        if (service && typeof service.getSupportedProfiles === 'function') {
            profiles = service.getSupportedProfiles();
        } else {
            profiles = ctx.extensionSettings?.connectionManager?.profiles || [];
        }

        if (currentVal && !profiles.some(p => p.id === currentVal)) {
            _dbgAdd('PROFILE_GHOST_CLEANUP', { removedId: currentVal });
            s.connectionProfileId = '';
            saveSettings();
            currentVal = '';
        }

        if (service && typeof service.handleDropdown === 'function') {
            service.handleDropdown(profSel);
            if (currentVal && Array.from(profSel.options).some(o => o.value === currentVal)) {
                profSel.value = currentVal;
            }
            return;
        }

        profSel.innerHTML = '<option value="">-- Select Profile --</option>';
        if (profiles && profiles.length > 0) {
            profiles.forEach(p => {
                const newOpt = document.createElement('option');
                newOpt.value = p.id;
                newOpt.textContent = p.name;
                profSel.appendChild(newOpt);
            });
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
            customUrl: 'scp-sp-custom-url',
            customKey: 'scp-sp-custom-key',
            customModel: 'scp-sp-custom-model',
            includeSystemPrompt: 'scp-sp-include-sysprompt',
            includeUserPersonality: 'scp-sp-include-persona',
            applyRegexToContext: 'scp-sp-apply-regex',
            contextDepth: 'scp-sp-depth-slider',
            wobbleWindow: 'scp-sp-wobble-window',
            performanceMode: 'scp-sp-perf-mode',
            includeSummaryception: 'scp-sp-include-summaryception',
            useAspectEvolutia: 'scp-sp-use-aspect-evolutia',
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
                const cPg = document.getElementById('scp-sp-custom-profile-group');
                if (cPg) cPg.style.display = val === 'custom' ? '' : 'none';
            }
            if (key === 'contextDepth') {
                const gDv = document.getElementById('scp-sp-depth-val');
                if (gDv) gDv.textContent = val ?? 15;
            }
        }

        if (key === 'forceStreaming') {
            const streamVal = val === true ? 'on' : (val === false ? 'auto' : (val || 'auto'));
            
            document.querySelectorAll('.scp-stream-btn:not(.scp-ov-stream-btn)').forEach(b => {
                b.classList.toggle('active', b.dataset.stream === streamVal);
            });

            const ov = getSessionOverrides();
            if (!('forceStreaming' in ov)) {
                document.querySelectorAll('.scp-ov-stream-btn').forEach(b => {
                    b.classList.toggle('active', b.dataset.stream === streamVal);
                });
            }
            return;
        }

        const ov = getSessionOverrides();
        if (key in ov) return;

        const eff = getEffectiveSettings();
        const ovIdMap = {
            connectionSource: 'scp-sp-ov-conn-source',
            connectionProfileId: 'scp-sp-ov-conn-profile',
            customUrl: 'scp-sp-ov-custom-url',
            customKey: 'scp-sp-ov-custom-key',
            customModel: 'scp-sp-ov-custom-model',
            includeSystemPrompt: 'scp-sp-ov-include-sysprompt',
            includeUserPersonality: 'scp-sp-ov-include-persona',
            includeAlternateSwipes: 'scp-sp-ov-include-alt-swipes',
            applyRegexToContext: 'scp-sp-ov-apply-regex',
            contextDepth: 'scp-sp-ov-depth-slider',
            charField_tags: 'scp-sp-ov-ce-tags',
            charField_description: 'scp-sp-ov-ce-description',
            charField_personality: 'scp-sp-ov-ce-personality',
            charField_scenario: 'scp-sp-ov-ce-scenario',
            charField_first_mes: 'scp-sp-ov-ce-first-mes',
            charField_mes_example: 'scp-sp-ov-ce-mes-example',
            charField_authors_note: 'scp-sp-ov-ce-authors-note',
            charField_alternate_greetings: 'scp-sp-ov-ce-alt-greetings',
        };

        const ovId = ovIdMap[key];
        if (ovId) {
            const ovEl = document.getElementById(ovId);
            if (ovEl) {
                if (ovEl.type === 'checkbox') {
                    if (key.startsWith('charField_')) {
                        const fKey = key.replace('charField_', '');
                        ovEl.checked = !!(getSettings().charEditFields || {})[fKey];
                    } else {
                        ovEl.checked = !!eff[key];
                    }
                }
                else ovEl.value = eff[key] ?? '';
            }
            if (key === 'connectionSource') {
                const pg = document.getElementById('scp-sp-ov-profile-group');
                if (pg) pg.style.display = eff.connectionSource === 'profile' ? '' : 'none';
                const cg = document.getElementById('scp-sp-ov-custom-profile-group');
                if (cg) cg.style.display = eff.connectionSource === 'custom' ? '' : 'none';
            }
            if (key === 'contextDepth') {
                const dv = document.getElementById('scp-sp-ov-depth-val');
                if (dv) dv.textContent = eff.contextDepth ?? 15;
            }
            
            if (key === 'charField_alternate_greetings') {
                const picker = document.getElementById('scp-sp-ov-ce-alt-greetings-picker');
                if (picker) {
                    picker.style.display = ovEl && ovEl.checked ? '' : 'none';
                    refreshAltGreetingsPickers();
                }
            }
        }
    }
    
    function updateSettingsUI() {
        const s = getSettings();
        const setC = (id, key) => { const el = $(id); if (el) el.checked = !!s[key]; };
        const setI = (id, key) => { const el = $(id); if (el) el.value = s[key] ?? ''; };
        
        setC('scp-enabled', 'enabled');
        setC('scp-hotkey-enabled', 'hotkeyEnabled');
        setC('scp-search-hotkey-enabled', 'searchHotkeyEnabled');
        setI('scp-search-hotkey', 'searchHotkey');
        setC('scp-include-sysprompt', 'includeSystemPrompt');
        setC('scp-include-persona', 'includeUserPersonality');
        setC('scp-apply-regex', 'applyRegexToContext');
        setC('scp-icon-persistent', 'floatingIconPersistent');
        setC('scp-ghost-hotkey-enabled', 'ghostModeHotkeyEnabled');
        setI('scp-hotkey', 'hotkey');
        setI('scp-max-tokens', 'maxTokens');
        setI('scp-history-limit', 'localHistoryLimit');
        setI('scp-depth-slider', 'contextDepth');
        setI('scp-reasoning-trim', 'reasoningTrimStrings');
        setI('scp-ghost-hotkey', 'ghostModeHotkey');
        const wobbleEl = $('scp-wobble-window'); if (wobbleEl) wobbleEl.checked = s.wobbleWindow !== false;
        setC('scp-perf-mode', 'performanceMode');
        setC('scp-char-edit-enabled', 'charEditAIEnabled');
        setC('scp-memory-enabled', 'memoryEnabled');
        const memPromptEl = $('scp-memory-prompt');
        if (memPromptEl) {
            memPromptEl.value = s.memoryManagePrompt || DEFAULT_MEMORY_PROMPT;
        }
        setC('scp-memory-inject', 'memoryInject');
        setC('scp-tools-enabled', 'toolsEnabled');
        setC('scp-include-summaryception', 'includeSummaryception');
        setC('scp-use-aspect-evolutia', 'useAspectEvolutia');
        setC('scp-auto-expand-macros', 'autoExpandMacros');
        setC('scp-include-hidden-msgs', 'includeHiddenMessages');

        const fsVal = s.forceStreaming === true ? 'on' : (s.forceStreaming === false ? 'auto' : (s.forceStreaming || 'auto'));
        document.querySelectorAll('#scp-st-stream-auto, #scp-st-stream-on, #scp-st-stream-off').forEach(b => {
            const active = b.dataset.stream === fsVal;
            b.classList.toggle('active', active);
            b.style.color = active ? 'var(--SmartThemeQuoteColor,#a99bfb)' : '';
            b.style.borderColor = active ? 'rgba(124,109,250,0.5)' : '';
            b.style.background = active ? 'rgba(124,109,250,0.12)' : '';
        });
        const cePromptEl = $('scp-char-edit-prompt');
        if (cePromptEl) cePromptEl.value = s.charEditPrompt || DEFAULT_CHAR_EDIT_DIRECTIVE.trim();

        const ceFields = s.charEditFields || {};
        const setCe = (id, k) => { const el = $(id); if (el) el.checked = ceFields[k] !== false; };
        setCe('scp-ce-tags', 'tags');
        setCe('scp-ce-description', 'description');
        setCe('scp-ce-personality', 'personality');
        setCe('scp-ce-scenario', 'scenario');
        setCe('scp-ce-first-mes', 'first_mes');
        setCe('scp-ce-mes-example', 'mes_example');
        setCe('scp-ce-authors-note', 'authors_note');
        const agEl = $('scp-ce-alt-greetings'); if (agEl) agEl.checked = !!ceFields.alternate_greetings;

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
            const gGroup = $('scp-profile-group');
            if (gGroup) gGroup.style.display = cs.value === 'profile' ? '' : 'none';
            const cGroup = $('scp-custom-profile-group');
            if (cGroup) cGroup.style.display = cs.value === 'custom' ? '' : 'none';
        }
        
        setI('scp-custom-url', 'customUrl');
        setI('scp-custom-key', 'customKey');
        setI('scp-custom-model', 'customModel');
        
        const spEl = $('scp-sysprompt');
        if (spEl) spEl.value = s.systemPrompt || DEFAULT_SYSTEM_PROMPT;
        
        const profSel = $('scp-conn-profile');
        if (profSel) profSel.value = s.connectionProfileId ?? '';

        const wand = $('scp-wand-btn');
        if (wand) wand.style.display = s.enabled ? '' : 'none';
        buildBackgroundSettingsUI(document.getElementById('scp-bg-settings'));

        const pickerLinesEl = $('scp-picker-lines');
        if (pickerLinesEl) pickerLinesEl.value = s.pickerPreviewLines ?? 1;
        const pickerLastEl = $('scp-picker-last-lines');
        if (pickerLastEl) pickerLastEl.value = s.pickerPreviewLastLines ?? 0;

        const imageModeEl = $('scp-image-mode');
        if (imageModeEl) imageModeEl.value = s.imageAnalysisMode || 'direct';

        const soundUnfocusedEl = $('scp-sound-unfocused');
        if (soundUnfocusedEl) soundUnfocusedEl.checked = !!s.completionSoundOnlyWhenUnfocused;

        if (typeof buildThemeEditor === 'function') buildThemeEditor();
        buildSoundSettingsUI($('scp-sound-settings'));
        refreshAltGreetingsPickers();

        const lbPromptEl3 = $('scp-lb-manage-prompt');
        if (lbPromptEl3) lbPromptEl3.value = s.lorebookManagePrompt || DEFAULT_LB_MANAGE_PROMPT;
        setI('scp-lb-st-scan-depth', 'lorebookSTScanDepth');
        setI('scp-lb-copilot-scan-depth', 'lorebookCopilotScanDepth');
        const lbAiStEl2 = $('scp-lb-ai-enabled-st');
        if (lbAiStEl2) lbAiStEl2.checked = !!s.lorebookAIManageEnabled;
        const lbKwStEl2 = $('scp-lb-auto-kw-st');
        if (lbKwStEl2) lbKwStEl2.checked = !!s.lorebookAutoKeyword;

        const chatEditEnabledStEl = $('scp-chat-edit-enabled-st');
        if (chatEditEnabledStEl) chatEditEnabledStEl.checked = !!s.chatEditAIEnabled;
        const chatEditPromptStEl = $('scp-chat-edit-prompt-st');
        if (chatEditPromptStEl) chatEditPromptStEl.value = s.chatEditPrompt || DEFAULT_CHAT_EDIT_DIRECTIVE.trim();
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
                _markDirty('config');
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
                _markDirty('config');
                if (cb) cb(); 
            });
        };
        const bindSelect = (id, key, cb) => {
            const el = $(id); if (!el) return;
            el.value = s[key] ?? '';
            el.addEventListener('change', () => { 
                getSettings()[key] = el.value; saveSettings(); 
                syncOverlayUI(key, el.value);
                _markDirty('config');
                if (cb) cb(el.value); 
            });
        };

        const incAltSwipes = document.getElementById('scp-include-alt-swipes');
        if (incAltSwipes) incAltSwipes.checked = !!s.includeAlternateSwipes;

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
        bindCheck('scp-include-persona', 'includeUserPersonality', updCtx);
        bindCheck('scp-include-alt-swipes', 'includeAlternateSwipes', updCtx);
        bindCheck('scp-apply-regex', 'applyRegexToContext');
        
        const stUpdateStreamBtns = (val) => {
            document.querySelectorAll('#scp-st-stream-auto, #scp-st-stream-on, #scp-st-stream-off').forEach(b => {
                const active = b.dataset.stream === val;
                b.classList.toggle('active', active);
                b.style.color = active ? 'var(--SmartThemeQuoteColor,#a99bfb)' : '';
                b.style.borderColor = active ? 'rgba(124,109,250,0.5)' : '';
                b.style.background = active ? 'rgba(124,109,250,0.12)' : '';
            });
        };
        ['scp-st-stream-auto', 'scp-st-stream-on', 'scp-st-stream-off'].forEach(id => {
            const btn = $(id); if (!btn) return;
            btn.addEventListener('click', () => {
                const val = btn.dataset.stream;
                getSettings().forceStreaming = val; 
                saveSettings();
                syncOverlayUI('forceStreaming', val);
                _markDirty('config');
            });
        });
        
        bindCheck('scp-icon-persistent', 'floatingIconPersistent', updateIconVisibility);
        bindCheck('scp-wobble-window', 'wobbleWindow');
        bindCheck('scp-perf-mode', 'performanceMode', () => {
            applyCustomTheme(getSettings().customTheme || THEME_PRESETS.default);
        });
        bindCheck('scp-include-summaryception', 'includeSummaryception');
        bindCheck('scp-use-aspect-evolutia', 'useAspectEvolutia');
        bindCheck('scp-auto-expand-macros', 'autoExpandMacros');
        bindCheck('scp-include-hidden-msgs', 'includeHiddenMessages');

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
        bindCheck('scp-search-hotkey-enabled', 'searchHotkeyEnabled', setupSearchHotkey);
        bindInput('scp-search-hotkey', 'searchHotkey', null, setupSearchHotkey);
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
            const c = $('scp-custom-profile-group');
            if (c) c.style.display = v === 'custom' ? '' : 'none';
        });

        bindInput('scp-custom-url', 'customUrl');
        bindInput('scp-custom-key', 'customKey');
        bindInput('scp-custom-model', 'customModel');

        if ($('scp-profile-group')) {
            $('scp-profile-group').style.display = s.connectionSource === 'profile' ? '' : 'none';
        }

        const spEl = $('scp-sysprompt');
        if (spEl) {
            spEl.value = s.systemPrompt || DEFAULT_SYSTEM_PROMPT;
            spEl.addEventListener('input', () => { getSettings().systemPrompt = spEl.value; saveSettings(); updCtx(); });
        }

        bindCheck('scp-char-edit-enabled', 'charEditAIEnabled', updCtx);
        
        const charEditPromptEl = $('scp-char-edit-prompt');
        if (charEditPromptEl) {
            charEditPromptEl.value = s.charEditPrompt || DEFAULT_CHAR_EDIT_DIRECTIVE.trim();
            charEditPromptEl.addEventListener('input', () => {
                const val = charEditPromptEl.value;
                getSettings().charEditPrompt = (val.trim() === DEFAULT_CHAR_EDIT_DIRECTIVE.trim()) ? '' : val;
                saveSettings();
                _markDirty('config');
            });
        }
        
        const bGCharFieldST = (id, fieldKey) => {
            const el = $(id); if (!el) return;
            const ceF = getSettings().charEditFields || {};
            el.checked = ceF[fieldKey] !== false;
            el.addEventListener('change', () => {
                const s = getSettings();
                if (!s.charEditFields) s.charEditFields = {};
                s.charEditFields[fieldKey] = el.checked;
                saveSettings(); updateMsgCount(getCurrentSession());
                const ovEl = document.getElementById(`scp-sp-ce-${fieldKey.replace(/_/g, '-')}`);
                if (ovEl) ovEl.checked = el.checked;
                _markDirty('config');
            });
            syncOverlayUI('charField_' + fieldKey, el.checked);
        };
        bGCharFieldST('scp-ce-tags', 'tags');
        bGCharFieldST('scp-ce-description', 'description');
        bGCharFieldST('scp-ce-personality', 'personality');
        bGCharFieldST('scp-ce-scenario', 'scenario');
        bGCharFieldST('scp-ce-first-mes', 'first_mes');
        bGCharFieldST('scp-ce-mes-example', 'mes_example');
        bGCharFieldST('scp-ce-authors-note', 'authors_note');
        bGCharFieldST('scp-ce-alt-greetings', 'alternate_greetings');
        $('scp-ce-alt-greetings')?.addEventListener('change', () => {
            const picker = document.getElementById('scp-ce-alt-greetings-picker');
            if (picker) { picker.style.display = getSettings().charEditFields?.alternate_greetings ? '' : 'none'; refreshAltGreetingsPickers(); }
        });

        $('scp-reset-char-edit-prompt')?.addEventListener('click', async () => {
            const ok = await showCustomDialog({ type: 'confirm', title: 'Reset Char Edit Prompt', message: 'Reset to built-in default prompt?' });
            if (!ok) return;
            getSettings().charEditPrompt = '';
            saveSettings();
            _markDirty('config');
            const el = $('scp-char-edit-prompt');
            if (el) el.value = DEFAULT_CHAR_EDIT_DIRECTIVE.trim();
            const ovEl = $('scp-sp-char-edit-prompt');
            if (ovEl) ovEl.value = DEFAULT_CHAR_EDIT_DIRECTIVE.trim();
            toastr.success('Char edit prompt reset.', EXT_DISPLAY);
        });

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
            _clearDirty('config');
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
                maxTokens: 8200,
            };
            saveSettings(); refreshProfilesDropdown();
            loadProfile(n);
            const sel = $('scp-profile-select'); if (sel) sel.value = n;
            updateBindingSection(); toastr.success(`Created "${n}"`, EXT_DISPLAY);
        });

        $('scp-profile-duplicate')?.addEventListener('click', async () => {
            const sel = $('scp-profile-select');
            if (!sel?.value) return toastr.info('No configuration selected.', EXT_DISPLAY);
            const defaultName = sel.value + ' (Copy)';
            const newName = await showCustomDialog({ type: 'prompt', title: 'Duplicate Configuration', message: 'Name for the new profile:', defaultValue: defaultName });
            if (!newName?.trim()) return;
            const n = newName.trim();
            const s2 = getSettings();
            const p = s2.profiles[sel.value];
            if (!p) return;
            s2.profiles[n] = JSON.parse(JSON.stringify(p));
            saveSettings(); refreshProfilesDropdown(); refreshSPProfilesDropdown();
            loadProfile(n);
            const newSel = $('scp-profile-select'); if (newSel) newSel.value = n;
            updateBindingSection(); toastr.success(`Duplicated as "${n}"`, EXT_DISPLAY);
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
            
            _dbgAdd(s2.profileBindings[key] ? 'PROFILE_BIND' : 'PROFILE_UNBIND', { target: 'char', profile: sel.value });
            
            saveSettings(); updateBindingSection();
        });

        $('scp-bind-chat')?.addEventListener('click', () => {
            const sel = $('scp-profile-select'); if (!sel?.value) return;
            const s2 = getSettings(); const { charId, chatId } = getBindingKey(); const key = `chat_${charId}_${chatId}`;
            if (s2.profileBindings[key] === sel.value) delete s2.profileBindings[key];
            else s2.profileBindings[key] = sel.value;

            _dbgAdd(s2.profileBindings[key] ? 'PROFILE_BIND' : 'PROFILE_UNBIND', { target: 'chat', profile: sel.value });

            saveSettings(); updateBindingSection();
        });

        $('scp-open-window')?.addEventListener('click', showWindow);
        $('scp-download-debug')?.addEventListener('click', dbgDownload);

        // ST drawer: Memory
        const memEnabledStEl = $('scp-memory-enabled');
        if (memEnabledStEl) {
            memEnabledStEl.checked = !!getSettings().memoryEnabled;
            memEnabledStEl.addEventListener('change', () => {
                getSettings().memoryEnabled = memEnabledStEl.checked; saveSettings();
                const ovEl = document.getElementById('scp-sp-memory-enabled'); if (ovEl) ovEl.checked = memEnabledStEl.checked;
            });
        }
        const memInjectStEl = $('scp-memory-inject');
        if (memInjectStEl) {
            memInjectStEl.checked = !!getSettings().memoryInject;
            memInjectStEl.addEventListener('change', () => {
                getSettings().memoryInject = memInjectStEl.checked; saveSettings();
                const ovEl = document.getElementById('scp-sp-memory-inject'); if (ovEl) ovEl.checked = memInjectStEl.checked;
            });
        }
        $('scp-open-memory-settings')?.addEventListener('click', () => {
            openSettingsPanel();
            setTimeout(() => { document.querySelector('[data-sptab="memory"]')?.click(); }, 80);
        });

        const memPromptEl = $('scp-memory-prompt');
        if (memPromptEl) {
            memPromptEl.addEventListener('input', () => {
                getSettings().memoryManagePrompt = memPromptEl.value;
                saveSettings();
                const spEl = document.getElementById('scp-sp-memory-prompt');
                if (spEl) spEl.value = memPromptEl.value;
            });
        }
        $('scp-reset-memory-prompt')?.addEventListener('click', async () => {
            const ok = await showCustomDialog({ type: 'confirm', title: 'Reset Prompt', message: 'Reset memory prompt to default?' });
            if (!ok) return;
            getSettings().memoryManagePrompt = DEFAULT_MEMORY_PROMPT;
            saveSettings();
            if (memPromptEl) memPromptEl.value = DEFAULT_MEMORY_PROMPT;
            const spEl = document.getElementById('scp-sp-memory-prompt');
            if (spEl) spEl.value = DEFAULT_MEMORY_PROMPT;
            toastr.success('Prompt reset.', EXT_DISPLAY);
        });

        // ST drawer: Tools
        const toolsEnabledStEl = $('scp-tools-enabled');
        if (toolsEnabledStEl) {
            toolsEnabledStEl.checked = !!getSettings().toolsEnabled;
            toolsEnabledStEl.addEventListener('change', () => {
                getSettings().toolsEnabled = toolsEnabledStEl.checked; saveSettings();
                const ovEl = document.getElementById('scp-sp-tools-enabled'); if (ovEl) ovEl.checked = toolsEnabledStEl.checked;
            });
        }
        $('scp-open-tools-settings')?.addEventListener('click', () => {
            openSettingsPanel();
            setTimeout(() => { document.querySelector('[data-sptab="tools"]')?.click(); }, 80);
        });
        const handleClearAllSessions = async () => {
            const ok = await showCustomDialog({ 
                type: 'confirm', 
                title: 'Clear All Sessions', 
                message: 'Delete ALL Copilot sessions from global storage AND clear sessions for the CURRENT chat? (Cannot clear other inactive chats). This cannot be undone.',
                delayConfirm: 3
            });
            if (!ok) return;
            getSettings().sessions = {}; saveSettings(); 
            const ctx = SillyTavern.getContext();
            if (ctx.chatMetadata) delete ctx.chatMetadata.st_copilot;
            await initChatBucket();
            onChatChanged();
            toastr.success('Sessions cleared.', EXT_DISPLAY);
        };
        document.getElementById('scp-clear-sessions')?.addEventListener('click', handleClearAllSessions);

        updateProfilesList();
        buildThemeEditor();

        // LB and Auto-Keywords toggles (ST drawer)
        const lbAiStEl = $('scp-lb-ai-enabled-st');
        if (lbAiStEl) {
            lbAiStEl.checked = !!getSettings().lorebookAIManageEnabled;
            lbAiStEl.addEventListener('change', () => {
                getSettings().lorebookAIManageEnabled = lbAiStEl.checked; saveSettings();
                const spEl2 = document.getElementById('scp-sp-lb-ai-enabled');
                if (spEl2) spEl2.checked = lbAiStEl.checked;
            });
        }
        const lbKwStEl = $('scp-lb-auto-kw-st');
        if (lbKwStEl) {
            lbKwStEl.checked = !!getSettings().lorebookAutoKeyword;
            lbKwStEl.addEventListener('change', async () => {
                const s2 = getSettings(); s2.lorebookAutoKeyword = lbKwStEl.checked; saveSettings();
                await buildLorebookContextBlock(s2);
                updateLBFooterInfo();
                if (_lbActiveBook) await renderEntryList(_lbActiveBook, _lbSearchQuery);
                updateMsgCount(getCurrentSession());
                const spEl2 = document.getElementById('scp-sp-lb-auto-kw');
                if (spEl2) spEl2.checked = lbKwStEl.checked;
            });
        }

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

        // Chat Edit handlers (ST drawer)
        const chatEditEnabledStEl = $('scp-chat-edit-enabled-st');
        if (chatEditEnabledStEl) {
            chatEditEnabledStEl.checked = !!getSettings().chatEditAIEnabled;
            chatEditEnabledStEl.addEventListener('change', () => {
                getSettings().chatEditAIEnabled = chatEditEnabledStEl.checked; saveSettings();
                const spEl2 = document.getElementById('scp-sp-chat-edit-enabled');
                if (spEl2) spEl2.checked = chatEditEnabledStEl.checked;
                updateMsgCount(getCurrentSession());
            });
        }
        const chatEditPromptStEl = $('scp-chat-edit-prompt-st');
        if (chatEditPromptStEl) {
            chatEditPromptStEl.value = getSettings().chatEditPrompt || DEFAULT_CHAT_EDIT_DIRECTIVE.trim();
            chatEditPromptStEl.addEventListener('input', () => {
                const val = chatEditPromptStEl.value;
                getSettings().chatEditPrompt = (val.trim() === DEFAULT_CHAT_EDIT_DIRECTIVE.trim()) ? '' : val;
                saveSettings();
                _markDirty('config');
                const spEl2 = document.getElementById('scp-sp-chat-edit-prompt');
                if (spEl2) spEl2.value = chatEditPromptStEl.value;
            });
        }
        $('scp-reset-chat-edit-prompt-st')?.addEventListener('click', async () => {
            const ok = await showCustomDialog({ type: 'confirm', title: 'Reset Chat Edit Prompt', message: 'Reset to default?' });
            if (!ok) return;
            getSettings().chatEditPrompt = ''; saveSettings(); _markDirty('config');
            if (chatEditPromptStEl) chatEditPromptStEl.value = DEFAULT_CHAT_EDIT_DIRECTIVE.trim();
            const spEl2 = document.getElementById('scp-sp-chat-edit-prompt');
            if (spEl2) spEl2.value = DEFAULT_CHAT_EDIT_DIRECTIVE.trim();
            toastr.success('Chat edit prompt reset.', EXT_DISPLAY);
        });

        // Sound unfocused (ST)
        const soundUnfocusedEl = $('scp-sound-unfocused');
        if (soundUnfocusedEl) {
            soundUnfocusedEl.checked = !!getSettings().completionSoundOnlyWhenUnfocused;
            soundUnfocusedEl.addEventListener('change', () => {
                getSettings().completionSoundOnlyWhenUnfocused = soundUnfocusedEl.checked;
                saveSettings();
                const spEl = document.getElementById('scp-sp-sound-unfocused');
                if (spEl) spEl.checked = soundUnfocusedEl.checked;
            });
        }

        // Background (ST)
        const _bindBg = (typeId, urlId, urlGrpId, dimId, dimGrpId, dimValId) => {
            const typeEl = $(typeId);
            const urlEl = $(urlId);
            const urlGrp = $(urlGrpId);
            const dimEl = $(dimId);
            const dimGrp = $(dimGrpId);
            const dimValEl = $(dimValId);
            const s2 = getSettings();
            if (typeEl) {
                typeEl.value = s2.windowBgType || 'none';
                typeEl.addEventListener('change', () => {
                    getSettings().windowBgType = typeEl.value;
                    saveSettings();
                    if (urlGrp) urlGrp.style.display = typeEl.value !== 'none' ? '' : 'none';
                    if (dimGrp) dimGrp.style.display = typeEl.value !== 'none' ? '' : 'none';
                    applyWindowBackground();
                    _syncBgToOverlay();
                });
            }
            if (urlEl) {
                urlEl.value = s2.windowBgUrl || '';
                urlEl.addEventListener('input', () => {
                    getSettings().windowBgUrl = urlEl.value;
                    saveSettings();
                    applyWindowBackground();
                    _syncBgToOverlay();
                });
            }
            if (dimEl) {
                dimEl.value = s2.windowBgDim ?? 50;
                if (dimValEl) dimValEl.textContent = `${dimEl.value}%`;
                dimEl.addEventListener('input', () => {
                    if (dimValEl) dimValEl.textContent = `${dimEl.value}%`;
                });
                dimEl.addEventListener('change', () => {
                    getSettings().windowBgDim = parseInt(dimEl.value);
                    saveSettings();
                    applyWindowBackground();
                    _syncBgToOverlay();
                });
            }
        };
        _bindBg('scp-bg-type','scp-bg-url','scp-bg-url-group','scp-bg-dim','scp-bg-dim-group','scp-bg-dim-val');

        bindInput('scp-picker-lines', 'pickerPreviewLines', Number);
        bindInput('scp-picker-last-lines', 'pickerPreviewLastLines', Number);

        bindSelect('scp-image-mode', 'imageAnalysisMode', () => {
            const spEl = document.getElementById('scp-sp-image-mode');
            if (spEl) spEl.value = getSettings().imageAnalysisMode;
        });

        _setupBgUpload('scp-bg-upload-btn', 'scp-bg-url');
    }

    function _syncBgToOverlay() {
        const s = getSettings();
        const bgType = s.windowBgType || 'none';
        ['scp-sp-bg-type','scp-bg-type'].forEach(id => { const el = document.getElementById(id); if (el) el.value = bgType; });
        ['scp-sp-bg-url','scp-bg-url'].forEach(id => { const el = document.getElementById(id); if (el) el.value = s.windowBgUrl || ''; });
        ['scp-sp-bg-dim','scp-bg-dim'].forEach(id => { const el = document.getElementById(id); if (el) el.value = s.windowBgDim ?? 50; });
        ['scp-sp-bg-dim-val','scp-bg-dim-val'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = `${s.windowBgDim ?? 50}%`; });
        [['scp-sp-bg-url-group','scp-bg-url-group'],['scp-sp-bg-dim-group','scp-bg-dim-group']].forEach(([a,b]) => {
            [a,b].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = bgType !== 'none' ? '' : 'none'; });
        });
    }

    function openSettingsPanel() {
        const overlay = document.getElementById('scp-settings-overlay');
        if (!overlay) return;
        applyCustomTheme(getSettings().customTheme || THEME_PRESETS.default);
        syncSPFromSettings();
        buildThemeEditor(document.getElementById('scp-sp-theme-section'));
        _updateDirtyDots();
        buildSoundSettingsUI(document.getElementById('scp-sp-sound-settings'));
        buildQPSettingsUI(document.getElementById('scp-sp-qp-container'));
        refreshAltGreetingsPickers();
        buildQPSetManager(document.getElementById('scp-sp-qp-set-manager'), () => {
            buildQPSettingsUI(document.getElementById('scp-sp-qp-container'));
        });

        buildPromptPresetManager(
            document.getElementById('scp-sp-prompt-preset-manager'),
            () => document.getElementById('scp-sp-ov-sysprompt')?.value || '',
            (text) => {
                const ta = document.getElementById('scp-sp-ov-sysprompt');
                if (!ta) return;
                ta.value = text;
                ta.dispatchEvent(new Event('input', { bubbles: true }));
            }
        );
        buildPromptPresetManager(document.getElementById('scp-sp-ov-char-preset-manager'), 
            () => document.getElementById('scp-sp-ov-char-edit-prompt')?.value || '', 
            (text) => { const ta = document.getElementById('scp-sp-ov-char-edit-prompt'); if(ta) { ta.value = text; ta.dispatchEvent(new Event('input', {bubbles:true})); } }, 
            'charEditPromptPresets');

        buildPromptPresetManager(document.getElementById('scp-sp-ov-lb-preset-manager'), 
            () => document.getElementById('scp-sp-ov-lb-manage-prompt')?.value || '', 
            (text) => { const ta = document.getElementById('scp-sp-ov-lb-manage-prompt'); if(ta) { ta.value = text; ta.dispatchEvent(new Event('input', {bubbles:true})); } }, 
            'lbEditPromptPresets');

        buildPromptPresetManager(document.getElementById('scp-sp-ov-chat-preset-manager'), 
            () => document.getElementById('scp-sp-ov-chat-edit-prompt')?.value || '', 
            (text) => { const ta = document.getElementById('scp-sp-ov-chat-edit-prompt'); if(ta) { ta.value = text; ta.dispatchEvent(new Event('input', {bubbles:true})); } }, 
            'chatEditPromptPresets');

        overlay.style.display = 'flex';
        updateSessionOverrideIndicator();
        updateMemoryDot();
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
        gC('scp-sp-search-hotkey-enabled', s.searchHotkeyEnabled);
        g('scp-sp-search-hotkey', s.searchHotkey);
        gC('scp-sp-enabled', s.enabled);
        gC('scp-sp-perf-mode', s.performanceMode);
        gC('scp-sp-hotkey-enabled', s.hotkeyEnabled);
        g('scp-sp-hotkey', s.hotkey);
        gC('scp-sp-icon-persistent', s.floatingIconPersistent);
        gC('scp-sp-wobble-window', s.wobbleWindow !== false);
        gC('scp-sp-changelog-auto', s.changelogAutoShow);

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
        
        // Force Streaming global
        gC('scp-sp-force-streaming', s.forceStreaming);
        const streamVal = s.forceStreaming === true ? 'on' : (s.forceStreaming === false ? 'auto' : (s.forceStreaming || 'auto'));
        document.querySelectorAll('.scp-stream-btn:not(.scp-ov-stream-btn)').forEach(b => {
            const active = b.dataset.stream === streamVal;
            b.classList.toggle('active', active);
            b.style.color = '';
            b.style.borderColor = '';
            b.style.background = '';
        });
        
        g('scp-sp-conn-source', s.connectionSource ?? 'default');
        const gCp = document.getElementById('scp-sp-global-profile-group');
        if (gCp) gCp.style.display = s.connectionSource === 'profile' ? '' : 'none';
        const gCus = document.getElementById('scp-sp-custom-profile-group');
        if (gCus) gCus.style.display = s.connectionSource === 'custom' ? '' : 'none';
        
        g('scp-sp-custom-url', s.customUrl);
        g('scp-sp-custom-key', s.customKey);
        g('scp-sp-custom-model', s.customModel);

        g('scp-sp-max-tokens', s.maxTokens);
        g('scp-sp-history-limit', s.localHistoryLimit);
        
        const spDs = document.getElementById('scp-sp-depth-slider');
        const spDv = document.getElementById('scp-sp-depth-val');
        if (spDs) spDs.value = s.contextDepth ?? 15;
        if (spDv) spDv.textContent = s.contextDepth ?? 15;
        
        gC('scp-sp-include-sysprompt', s.includeSystemPrompt);
        gC('scp-sp-include-persona', s.includeUserPersonality);
        gC('scp-sp-apply-regex', s.applyRegexToContext);
        g('scp-sp-reasoning-trim', s.reasoningTrimStrings);
        g('scp-sp-sysprompt', s.systemPrompt || DEFAULT_SYSTEM_PROMPT);
        g('scp-sp-lb-manage-prompt', s.lorebookManagePrompt || DEFAULT_LB_MANAGE_PROMPT);
        g('scp-sp-lb-st-scan-depth', s.lorebookSTScanDepth);
        g('scp-sp-lb-copilot-scan-depth', s.lorebookCopilotScanDepth);
        gC('scp-sp-lb-ai-enabled', s.lorebookAIManageEnabled);
        gC('scp-sp-lb-auto-kw', s.lorebookAutoKeyword);

        gC('scp-sp-char-edit-enabled', s.charEditAIEnabled);
        g('scp-sp-char-edit-prompt', s.charEditPrompt || DEFAULT_CHAR_EDIT_DIRECTIVE.trim());
        const ceFields = s.charEditFields || {};
        gC('scp-sp-ce-tags', ceFields.tags !== false);
        gC('scp-sp-ce-description', ceFields.description !== false);
        gC('scp-sp-ce-personality', ceFields.personality !== false);
        gC('scp-sp-ce-scenario', ceFields.scenario !== false);
        gC('scp-sp-ce-first-mes', ceFields.first_mes !== false);
        gC('scp-sp-ce-mes-example', ceFields.mes_example !== false);
        gC('scp-sp-ce-authors-note', ceFields.authors_note !== false);
        gC('scp-sp-ce-alt-greetings', !!ceFields.alternate_greetings);

        gC('scp-sp-chat-edit-enabled', s.chatEditAIEnabled);
        g('scp-sp-chat-edit-prompt', s.chatEditPrompt || DEFAULT_CHAT_EDIT_DIRECTIVE.trim());

        refreshSPProfilesDropdown();
        updateSPConnProfileList();

        // ── Session tab ──
        const ovDs = document.getElementById('scp-sp-ov-depth-slider');
        const ovDv = document.getElementById('scp-sp-ov-depth-val');
        if (ovDs) ovDs.value = eff.contextDepth ?? 15;
        if (ovDv) ovDv.textContent = eff.contextDepth ?? 15;

        g('scp-sp-ov-conn-source', eff.connectionSource ?? 'default');
        const ovPg = document.getElementById('scp-sp-ov-profile-group');
        if (ovPg) ovPg.style.display = eff.connectionSource === 'profile' ? '' : 'none';
        const ovCus = document.getElementById('scp-sp-ov-custom-profile-group');
        if (ovCus) ovCus.style.display = eff.connectionSource === 'custom' ? '' : 'none';
        
        g('scp-sp-ov-conn-profile', eff.connectionProfileId ?? '');

        const ovi = (id, key) => { const el = document.getElementById(id); if (el) el.value = key in ov ? (ov[key] ?? '') : ''; };
        ovi('scp-sp-ov-custom-url', 'customUrl');
        ovi('scp-sp-ov-custom-key', 'customKey');
        ovi('scp-sp-ov-custom-model', 'customModel');
        ovi('scp-sp-ov-max-tokens', 'maxTokens');
        ovi('scp-sp-ov-history-limit', 'localHistoryLimit');
        ovi('scp-sp-ov-reasoning-trim', 'reasoningTrimStrings');
        ovi('scp-sp-ov-sysprompt', 'systemPrompt');
        
        // AI Prompts overrides
        ovi('scp-sp-ov-char-edit-prompt', 'charEditPrompt');
        ovi('scp-sp-ov-lb-manage-prompt', 'lorebookManagePrompt');
        ovi('scp-sp-ov-chat-edit-prompt', 'chatEditPrompt');

        gC('scp-sp-ov-include-sysprompt', eff.includeSystemPrompt);
        gC('scp-sp-ov-include-persona', eff.includeUserPersonality);
        gC('scp-sp-ov-apply-regex', eff.applyRegexToContext);

        // Sync streaming override buttons
        const ovStreamVal = eff.forceStreaming === true ? 'on' : (eff.forceStreaming === false ? 'auto' : (eff.forceStreaming || 'auto'));
        document.querySelectorAll('.scp-ov-stream-btn').forEach(b => {
            const active = b.dataset.stream === ovStreamVal;
            b.classList.toggle('active', active);
            b.style.color = active ? 'var(--scp-accent)' : '';
            b.style.borderColor = active ? 'var(--scp-accent-dim)' : '';
            b.style.background = active ? 'var(--scp-accent-bg)' : '';
        });

        const ovCe = (id, k) => {
            const el = document.getElementById(id);
            if (el) el.checked = k in ov ? !!ov[k] : !!(s.charEditFields || {})[k.replace('charField_', '')];
        };
        ovCe('scp-sp-ov-ce-tags', 'charField_tags');
        ovCe('scp-sp-ov-ce-description', 'charField_description');
        ovCe('scp-sp-ov-ce-personality', 'charField_personality');
        ovCe('scp-sp-ov-ce-scenario', 'charField_scenario');
        ovCe('scp-sp-ov-ce-first-mes', 'charField_first_mes');
        ovCe('scp-sp-ov-ce-mes-example', 'charField_mes_example');
        ovCe('scp-sp-ov-ce-authors-note', 'charField_authors_note');
        ovCe('scp-sp-ov-ce-alt-greetings', 'charField_alternate_greetings');

        // Main ai modules overrides toggles
        const ovC = (id, key) => {
            const el = document.getElementById(id);
            if (el) el.checked = key in ov ? !!ov[key] : !!eff[key];
        };
        ovC('scp-sp-ov-char-edit-enabled', 'charEditAIEnabled');
        ovC('scp-sp-ov-lb-ai-enabled', 'lorebookAIManageEnabled');
        ovC('scp-sp-ov-chat-edit-enabled', 'chatEditAIEnabled');
        ovC('scp-sp-ov-lb-auto-kw', 'lorebookAutoKeyword');

        const altGreetingsOvEl = document.getElementById('scp-sp-ov-ce-alt-greetings');
        if (altGreetingsOvEl) {
            const picker = document.getElementById('scp-sp-ov-ce-alt-greetings-picker');
            if (picker) {
                picker.style.display = altGreetingsOvEl.checked ? '' : 'none';
                refreshAltGreetingsPickers();
            }
        }

        updateSPOverrideIndicators();

        const spSoundUnf = document.getElementById('scp-sp-sound-unfocused');
        if (spSoundUnf) spSoundUnf.checked = !!s.completionSoundOnlyWhenUnfocused;
        
        buildBackgroundSettingsUI(document.getElementById('scp-sp-bg-settings'));
        
        const spPl = document.getElementById('scp-sp-picker-lines');
        if (spPl) spPl.value = s.pickerPreviewLines ?? 1;
        const spPll = document.getElementById('scp-sp-picker-last-lines');
        if (spPll) spPll.value = s.pickerPreviewLastLines ?? 0;
        const spIm = document.getElementById('scp-sp-image-mode');
        if (spIm) spIm.value = s.imageAnalysisMode || 'direct';

        // Memory sync
        const setC2 = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
        const setV2 = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
        setC2('scp-sp-memory-enabled', s.memoryEnabled);
        setC2('scp-sp-memory-inject', s.memoryInject);
        setC2('scp-sp-memory-notify', s.memoryNotify);
        setV2('scp-sp-memory-scope', s.memoryScope || 'global');
        setV2('scp-sp-memory-tag', s.memoryTag || 'memory-update');

        // Tools sync
        setC2('scp-sp-tools-enabled', s.toolsEnabled);
        setC2('scp-sp-tools-thinking', s.toolsThinking);
        setV2('scp-sp-tools-max-rounds', s.toolsMaxRounds ?? 5);
        for (const t of TOOL_DEFINITIONS) {
            const el = document.getElementById(`scp-sp-tool-${t.id}`);
            if (el) el.checked = s[t.settingKey] !== false;
        }

        // Third-party extension support sync
        setC2('scp-sp-include-summaryception', s.includeSummaryception !== false);
        setC2('scp-sp-use-aspect-evolutia', s.useAspectEvolutia !== false);
        setC2('scp-sp-auto-expand-macros', !!s.autoExpandMacros);
        setC2('scp-sp-include-hidden-msgs', !!s.includeHiddenMessages);

        updateMemoryDot();
    }

    async function updateSPConnProfileList() {
        const selIds = ['scp-sp-conn-profile', 'scp-sp-ov-conn-profile'];
        const s = getSettings();
        const eff = getEffectiveSettings();
        const ctx = SillyTavern.getContext();
        const service = ctx.ConnectionManagerRequestService;

        let profiles = [];
        if (service && typeof service.getSupportedProfiles === 'function') {
            profiles = service.getSupportedProfiles();
        } else {
            profiles = ctx.extensionSettings?.connectionManager?.profiles || [];
        }

        selIds.forEach(sid => {
            const sel = document.getElementById(sid); if (!sel) return;
            const isOverride = sid === 'scp-sp-ov-conn-profile';
            let targetVal = isOverride ? (eff.connectionProfileId || '') : (s.connectionProfileId || '');

            if (targetVal && !profiles.some(p => p.id === targetVal)) {
                if (isOverride) {
                    setSessionOverride('connectionProfileId', undefined);
                } else {
                    s.connectionProfileId = '';
                    saveSettings();
                }
                targetVal = '';
            }

            if (service && typeof service.handleDropdown === 'function') {
                profiles = service.getSupportedProfiles();
            } else {
                profiles = ctx.extensionSettings?.connectionManager?.profiles || [];
            }
            sel.innerHTML = '<option value="">-- Select Profile --</option>';
            profiles.forEach(p => { 
                const o = document.createElement('option'); 
                o.value = p.id; 
                o.textContent = p.name; 
                sel.appendChild(o); 
            });
            if (Array.from(sel.options).some(o => o.value === targetVal)) sel.value = targetVal;
        });
    }

    function refreshSPProfilesDropdown() {
        const sel = document.getElementById('scp-sp-profile-select'); if (!sel) return;
        const s = getSettings();
        if (!Object.keys(s.profiles).length) {
            s.profiles['Default'] = { systemPrompt: DEFAULT_SYSTEM_PROMPT, includeSystemPrompt: true, includeAuthorsNote: true, includeCharacterCard: true, includeUserPersonality: true, contextDepth: 15, localHistoryLimit: 50, connectionSource: 'default', connectionProfileId: '', maxTokens: 8200, applyRegexToContext: true };
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

        document.getElementById('scp-sp-close')?.addEventListener('click', closeSettingsPanel);
        let _spMouseDown = null;
        overlay.addEventListener('mousedown', e => { _spMouseDown = e.target; });
        overlay.addEventListener('click', e => { if (e.target === overlay && _spMouseDown === overlay) closeSettingsPanel(); });

        overlay.querySelectorAll('.scp-sp-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                overlay.querySelectorAll('.scp-sp-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const pane = tab.dataset.sptab;
                overlay.querySelectorAll('.scp-sp-tab-pane').forEach(p => {
                    p.style.display = p.id === `scp-sp-pane-${pane}` ? '' : 'none';
                });
                if (pane === 'stats') {
                    const statsContainer = document.getElementById('scp-sp-stats-container');
                    if (statsContainer) renderStatsPane(statsContainer);
                }
                if (pane === 'memory') {
                    setupMemorySettingsUI();
                }
                if (pane === 'tools') {
                    setupToolsSettingsUI();
                }
            });
        });

        // ── GLOBAL SETTINGS ──

        const saveGlobal = (key, val, cb) => {
            getSettings()[key] = val; saveSettings();
            _configDirty = true; _updateDirtyDots();
            const stEl = document.getElementById({
                enabled:'scp-enabled', hotkeyEnabled:'scp-hotkey-enabled', hotkey:'scp-hotkey',
                searchHotkeyEnabled:'scp-search-hotkey-enabled', searchHotkey:'scp-search-hotkey',
                floatingIconPersistent:'scp-icon-persistent', connectionSource:'scp-conn-source',
                maxTokens:'scp-max-tokens', localHistoryLimit:'scp-history-limit',
                contextDepth:'scp-depth-slider', includeSystemPrompt:'scp-include-sysprompt',
                includeAuthorsNote:'scp-include-anote', includeCharacterCard:'scp-include-charcard',
                includeUserPersonality:'scp-include-persona', reasoningTrimStrings:'scp-reasoning-trim',
                systemPrompt:'scp-sysprompt', lorebookManagePrompt:'scp-lb-manage-prompt',
                lorebookSTScanDepth:'scp-lb-st-scan-depth', lorebookCopilotScanDepth:'scp-lb-copilot-scan-depth',
                connectionProfileId:'scp-conn-profile',
                customUrl: 'scp-custom-url', customKey: 'scp-custom-key', customModel: 'scp-custom-model',
                opacity:'scp-opacity-slider', ghostModeOpacity:'scp-ghost-opacity',
                ghostModeHotkeyEnabled:'scp-ghost-hotkey-enabled', ghostModeHotkey:'scp-ghost-hotkey',
                applyRegexToContext:'scp-apply-regex',
                charEditAIEnabled: 'scp-char-edit-enabled',
                charEditPrompt: 'scp-char-edit-prompt',
                lorebookAIManageEnabled: 'scp-lb-ai-enabled-st',
                lorebookAutoKeyword: 'scp-lb-auto-kw-st',
                wobbleWindow: 'scp-wobble-window', performanceMode: 'scp-perf-mode',
                includeSummaryception: 'scp-include-summaryception',
                useAspectEvolutia: 'scp-use-aspect-evolutia',
            }[key]);
            if (stEl) {
                if (stEl.type === 'checkbox') stEl.checked = !!val;
                else if (key === 'charEditPrompt') stEl.value = val || DEFAULT_CHAR_EDIT_DIRECTIVE.trim();
                else stEl.value = val ?? '';
                
                if (key === 'connectionSource') {
                    const stGroup = document.getElementById('scp-profile-group');
                    if (stGroup) stGroup.style.display = val === 'profile' ? '' : 'none';
                    const cGroup = document.getElementById('scp-custom-profile-group');
                    if (cGroup) cGroup.style.display = val === 'custom' ? '' : 'none';
                }
            }

            syncOverlayUI(key, val);
            _pruneMatchingOverrides();

            if (cb) cb(val);
            updateMsgCount(getCurrentSession());
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
        
        bGCheck('scp-sp-perf-mode', 'performanceMode', () => {
            applyCustomTheme(getSettings().customTheme || THEME_PRESETS.default);
        });
        
        bGCheck('scp-sp-hotkey-enabled', 'hotkeyEnabled', setupHotkey);
        bGInput('scp-sp-hotkey', 'hotkey', null, setupHotkey);

        bGCheck('scp-sp-search-hotkey-enabled', 'searchHotkeyEnabled', setupSearchHotkey);
        bGInput('scp-sp-search-hotkey', 'searchHotkey', null, setupSearchHotkey);
        
        bGCheck('scp-sp-icon-persistent', 'floatingIconPersistent', updateIconVisibility);
        bGCheck('scp-sp-wobble-window', 'wobbleWindow');
        bGCheck('scp-sp-changelog-auto', 'changelogAutoShow');
        document.getElementById('scp-sp-open-changelog')?.addEventListener('click', () => { closeSettingsPanel(); openChangelog(); });

        // Window opacity
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

        // Streaming 3-state buttons
        const updateStreamBtns = (val) => {
            document.querySelectorAll('.scp-stream-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.stream === val);
                b.style.color = b.dataset.stream === val ? 'var(--scp-accent)' : '';
                b.style.borderColor = b.dataset.stream === val ? 'var(--scp-accent-dim)' : '';
                b.style.background = b.dataset.stream === val ? 'var(--scp-accent-bg)' : '';
            });
        };
        document.querySelectorAll('.scp-stream-btn:not(.scp-ov-stream-btn)').forEach(btn => {
            btn.addEventListener('click', () => {
                const val = btn.dataset.stream;
                saveGlobal('forceStreaming', val, null);
            });
        });

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
            const cPg = document.getElementById('scp-sp-custom-profile-group');
            if (cPg) cPg.style.display = v === 'custom' ? '' : 'none';
            if (v === 'profile') updateSPConnProfileList();
        });
        bGInput('scp-sp-custom-url', 'customUrl');
        bGInput('scp-sp-custom-key', 'customKey');
        bGInput('scp-sp-custom-model', 'customModel');

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
        bGCheck('scp-sp-include-persona', 'includeUserPersonality', () => updateMsgCount(getCurrentSession()));
        bGCheck('scp-sp-apply-regex', 'applyRegexToContext');
        bGInput('scp-sp-reasoning-trim', 'reasoningTrimStrings');
        bGCheck('scp-sp-include-summaryception', 'includeSummaryception');
        bGCheck('scp-sp-use-aspect-evolutia', 'useAspectEvolutia');
        bGCheck('scp-sp-auto-expand-macros', 'autoExpandMacros');
        bGCheck('scp-sp-include-hidden-msgs', 'includeHiddenMessages', () => updateMsgCount(getCurrentSession()));
        bGCheck('scp-sp-include-alt-swipes', 'includeAlternateSwipes', () => updateMsgCount(getCurrentSession()));

        document.getElementById('scp-sp-conn-source')?.addEventListener('change', e => {
            const v = e.target.value;
            saveGlobal('connectionSource', v, null);
            const gCp = document.getElementById('scp-sp-global-profile-group');
            if (gCp) gCp.style.display = v === 'profile' ? '' : 'none';
            if (v === 'profile') updateSPConnProfileList();
        });
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

        // LB and Auto-Keywords toggles (settings overlay)
        document.getElementById('scp-sp-lb-ai-enabled')?.addEventListener('change', e => {
            saveGlobal('lorebookAIManageEnabled', e.target.checked, null);
            const stEl = document.getElementById('scp-lb-ai-enabled-st');
            if (stEl) stEl.checked = e.target.checked;
        });
        document.getElementById('scp-sp-lb-auto-kw')?.addEventListener('change', async e => {
            saveGlobal('lorebookAutoKeyword', e.target.checked, null);
            const s2 = getSettings();
            await buildLorebookContextBlock(s2);
            updateLBFooterInfo();
            if (_lbActiveBook) await renderEntryList(_lbActiveBook, _lbSearchQuery);
            updateMsgCount(getCurrentSession());
            const stEl = document.getElementById('scp-lb-auto-kw-st');
            if (stEl) stEl.checked = e.target.checked;
        });

        // Character card AI edits
        const bGCharField = (id, fieldKey) => {
            const el = document.getElementById(id); if (!el) return;
            el.addEventListener('change', () => {
                const s = getSettings();
                if (!s.charEditFields) s.charEditFields = {};
                s.charEditFields[fieldKey] = el.checked;
                saveSettings(); updateMsgCount(getCurrentSession());
                const stIdMap = {
                    tags: 'scp-ce-tags',
                    description: 'scp-ce-description', personality: 'scp-ce-personality',
                    scenario: 'scp-ce-scenario', first_mes: 'scp-ce-first-mes',
                    mes_example: 'scp-ce-mes-example', authors_note: 'scp-ce-authors-note',
                    alternate_greetings: 'scp-ce-alt-greetings',
                };
                const stEl = document.getElementById(stIdMap[fieldKey]);
                if (stEl) stEl.checked = el.checked;
                
                syncOverlayUI('charField_' + fieldKey, el.checked);
                _markDirty('config');
            });
        };
        bGCheck('scp-sp-char-edit-enabled', 'charEditAIEnabled', () => updateMsgCount(getCurrentSession()));
        bGCharField('scp-sp-ce-tags', 'tags');
        bGCharField('scp-sp-ce-description', 'description');
        bGCharField('scp-sp-ce-personality', 'personality');
        bGCharField('scp-sp-ce-scenario', 'scenario');
        bGCharField('scp-sp-ce-first-mes', 'first_mes');
        bGCharField('scp-sp-ce-mes-example', 'mes_example');
        bGCharField('scp-sp-ce-authors-note', 'authors_note');
        bGCharField('scp-sp-ce-alt-greetings', 'alternate_greetings');
        document.getElementById('scp-sp-ce-alt-greetings')?.addEventListener('change', () => {
            const picker = document.getElementById('scp-sp-ce-alt-greetings-picker');
            if (picker) { picker.style.display = getSettings().charEditFields?.alternate_greetings ? '' : 'none'; refreshAltGreetingsPickers(); }
        });
        document.getElementById('scp-sp-char-edit-prompt')?.addEventListener('input', e => {
            const val = e.target.value;
            getSettings().charEditPrompt = (val.trim() === DEFAULT_CHAR_EDIT_DIRECTIVE.trim()) ? '' : val;
            saveSettings();
            _markDirty('config');
        });
        document.getElementById('scp-sp-reset-char-edit-prompt')?.addEventListener('click', async () => {
            const ok = await showCustomDialog({ type: 'confirm', title: 'Reset Char Edit Prompt', message: 'Reset to built-in default prompt?' });
            if (!ok) return;
            getSettings().charEditPrompt = '';
            saveSettings();
            _markDirty('config');
            const el = document.getElementById('scp-sp-char-edit-prompt');
            if (el) el.value = DEFAULT_CHAR_EDIT_DIRECTIVE.trim();
            toastr.success('Char edit prompt reset to default.', EXT_DISPLAY);
        });
        bGCheck('scp-sp-chat-edit-enabled', 'chatEditAIEnabled', () => {
            updateMsgCount(getCurrentSession());
            const stEl = document.getElementById('scp-chat-edit-enabled-st');
            if (stEl) stEl.checked = getSettings().chatEditAIEnabled;
        });
        document.getElementById('scp-sp-chat-edit-prompt')?.addEventListener('input', e => {
            const val = e.target.value;
            getSettings().chatEditPrompt = (val.trim() === DEFAULT_CHAT_EDIT_DIRECTIVE.trim()) ? '' : val;
            saveSettings();
            _markDirty('config');
            const stEl = document.getElementById('scp-chat-edit-prompt-st');
            if (stEl) stEl.value = val;
        });
        document.getElementById('scp-sp-reset-chat-edit-prompt')?.addEventListener('click', async () => {
            const ok = await showCustomDialog({ type: 'confirm', title: 'Reset Chat Edit Prompt', message: 'Reset to default?' });
            if (!ok) return;
            getSettings().chatEditPrompt = ''; saveSettings(); _markDirty('config');
            const spEl = document.getElementById('scp-sp-chat-edit-prompt');
            if (spEl) spEl.value = DEFAULT_CHAT_EDIT_DIRECTIVE.trim();
            const stEl = document.getElementById('scp-chat-edit-prompt-st');
            if (stEl) stEl.value = DEFAULT_CHAT_EDIT_DIRECTIVE.trim();
            toastr.success('Chat edit prompt reset.', EXT_DISPLAY);
        });

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
            _clearDirty('config');
        });
        document.getElementById('scp-sp-profile-create')?.addEventListener('click', async () => {
            const name = await showCustomDialog({ type: 'prompt', title: 'New Configuration', message: 'Name:', placeholder: 'New Config' });
            if (!name?.trim()) return;
            const n = name.trim(); const s = getSettings();
            s.profiles[n] = { systemPrompt: DEFAULT_SYSTEM_PROMPT, includeSystemPrompt: true, includeAuthorsNote: true, includeCharacterCard: true, includeUserPersonality: true, contextDepth: 15, localHistoryLimit: 50, connectionSource: 'default', connectionProfileId: '', maxTokens: 8200, applyRegexToContext: true };
            saveSettings(); refreshSPProfilesDropdown(); refreshProfilesDropdown();
            loadProfile(n); syncSPFromSettings(); updateSettingsUI();
            const sel = document.getElementById('scp-sp-profile-select'); if (sel) sel.value = n;
            updateSPBindingSection(); toastr.success(`Created "${n}"`, EXT_DISPLAY);
        });
        document.getElementById('scp-sp-profile-duplicate')?.addEventListener('click', async () => {
            const sel = document.getElementById('scp-sp-profile-select');
            if (!sel?.value) return toastr.info('No configuration selected.', EXT_DISPLAY);
            const defaultName = sel.value + ' (Copy)';
            const newName = await showCustomDialog({ type: 'prompt', title: 'Duplicate Configuration', message: 'Name for the new profile:', defaultValue: defaultName });
            if (!newName?.trim()) return;
            const n = newName.trim();
            const s2 = getSettings();
            const p = s2.profiles[sel.value];
            if (!p) return;
            s2.profiles[n] = JSON.parse(JSON.stringify(p));
            saveSettings(); refreshSPProfilesDropdown(); refreshProfilesDropdown();
            loadProfile(n); syncSPFromSettings(); updateSettingsUI();
            const newSel = document.getElementById('scp-sp-profile-select'); if (newSel) newSel.value = n;
            updateSPBindingSection(); toastr.success(`Duplicated as "${n}"`, EXT_DISPLAY);
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

        document.getElementById('scp-sp-download-debug')?.addEventListener('click', dbgDownload);
        const handleClearAllSessions = async () => {
            const ok = await showCustomDialog({ 
                type: 'confirm', 
                title: 'Clear All Sessions', 
                message: 'Delete ALL Copilot sessions from global storage AND clear sessions for the CURRENT chat? (Cannot clear other inactive chats). This cannot be undone.',
                delayConfirm: 3
            });
            if (!ok) return;
            getSettings().sessions = {}; saveSettings(); 
            const ctx = SillyTavern.getContext();
            if (ctx.chatMetadata) delete ctx.chatMetadata.st_copilot;
            await initChatBucket();
            onChatChanged();
            toastr.success('Sessions cleared.', EXT_DISPLAY);
        };
        document.getElementById('scp-sp-clear-sessions')?.addEventListener('click', handleClearAllSessions);

        // Sound unfocused (overlay)
        const spSoundUnfocusedEl = document.getElementById('scp-sp-sound-unfocused');
        if (spSoundUnfocusedEl) {
            spSoundUnfocusedEl.checked = !!getSettings().completionSoundOnlyWhenUnfocused;
            spSoundUnfocusedEl.addEventListener('change', () => {
                getSettings().completionSoundOnlyWhenUnfocused = spSoundUnfocusedEl.checked;
                saveSettings();
                const stEl = document.getElementById('scp-sound-unfocused');
                if (stEl) stEl.checked = spSoundUnfocusedEl.checked;
            });
        }

        // Background (overlay)
        const spBgType = document.getElementById('scp-sp-bg-type');
        const spBgUrl = document.getElementById('scp-sp-bg-url');
        const spBgUrlGrp = document.getElementById('scp-sp-bg-url-group');
        const spBgDim = document.getElementById('scp-sp-bg-dim');
        const spBgDimGrp = document.getElementById('scp-sp-bg-dim-group');
        const spBgDimVal = document.getElementById('scp-sp-bg-dim-val');
        if (spBgType) {
            spBgType.value = getSettings().windowBgType || 'none';
            spBgType.addEventListener('change', () => {
                getSettings().windowBgType = spBgType.value;
                saveSettings();
                if (spBgUrlGrp) spBgUrlGrp.style.display = spBgType.value !== 'none' ? '' : 'none';
                if (spBgDimGrp) spBgDimGrp.style.display = spBgType.value !== 'none' ? '' : 'none';
                applyWindowBackground();
                _syncBgToOverlay();
            });
        }
        if (spBgUrl) {
            spBgUrl.value = getSettings().windowBgUrl || '';
            spBgUrl.addEventListener('input', () => {
                getSettings().windowBgUrl = spBgUrl.value;
                saveSettings();
                applyWindowBackground();
                _syncBgToOverlay();
            });
        }
        if (spBgDim) {
            spBgDim.value = getSettings().windowBgDim ?? 50;
            if (spBgDimVal) spBgDimVal.textContent = `${spBgDim.value}%`;
            spBgDim.addEventListener('input', () => {
                if (spBgDimVal) spBgDimVal.textContent = `${spBgDim.value}%`;
            });
            spBgDim.addEventListener('change', () => {
                getSettings().windowBgDim = parseInt(spBgDim.value);
                saveSettings();
                applyWindowBackground();
                _syncBgToOverlay();
            });
        }

        // Picker lines (overlay)
        const spPickerLines = document.getElementById('scp-sp-picker-lines');
        if (spPickerLines) {
            spPickerLines.value = getSettings().pickerPreviewLines ?? 1;
            spPickerLines.addEventListener('input', () => {
                getSettings().pickerPreviewLines = parseInt(spPickerLines.value) || 1;
                saveSettings();
                const stEl = document.getElementById('scp-picker-lines');
                if (stEl) stEl.value = spPickerLines.value;
            });
        }
        const spPickerLast = document.getElementById('scp-sp-picker-last-lines');
        if (spPickerLast) {
            spPickerLast.value = getSettings().pickerPreviewLastLines ?? 0;
            spPickerLast.addEventListener('input', () => {
                getSettings().pickerPreviewLastLines = parseInt(spPickerLast.value) || 0;
                saveSettings();
                const stEl = document.getElementById('scp-picker-last-lines');
                if (stEl) stEl.value = spPickerLast.value;
            });
        }

        // Image mode (overlay)
        const spImgMode = document.getElementById('scp-sp-image-mode');
        if (spImgMode) {
            spImgMode.value = getSettings().imageAnalysisMode || 'direct';
            spImgMode.addEventListener('change', () => {
                getSettings().imageAnalysisMode = spImgMode.value;
                saveSettings();
                const stEl = document.getElementById('scp-image-mode');
                if (stEl) stEl.value = spImgMode.value;
            });
        }

        // ── SESSION OVERRIDES ──

        function syncOvClear(key, newVal) {
            let globalVal = getSettings()[key];
            if (key.startsWith('charField_')) {
                const fKey = key.replace('charField_', '');
                globalVal = (getSettings().charEditFields || {})[fKey] !== false;
            }

            const isDefault = (newVal === undefined || newVal === null || newVal === '')
                ? true
                : (typeof globalVal === 'boolean'
                    ? newVal === globalVal
                    : String(newVal) === String(globalVal));
            
            if (isDefault) setSessionOverride(key, undefined);
            else setSessionOverride(key, newVal);
            
            updateSPOverrideIndicators();
            updateMsgCount(getCurrentSession());
        }

        function _pruneMatchingOverrides() {
            const s = getSettings();
            const bucket = getChatBucket();
            let changed = false;
            bucket.sessions.forEach(sess => {
                if (!sess.overrides) return;
                for (const key of Object.keys(sess.overrides)) {
                    let globalVal = s[key];
                    if (key.startsWith('charField_')) {
                        const fKey = key.replace('charField_', '');
                        globalVal = (s.charEditFields || {})[fKey] !== false;
                    }
                    if (sess.overrides[key] === globalVal) {
                        delete sess.overrides[key];
                        changed = true;
                    }
                }
            });
            if (changed) {
                saveSessionsToMetadata();
                updateSessionOverrideIndicator();
            }
        }

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
            const cg = document.getElementById('scp-sp-ov-custom-profile-group');
            if (cg) cg.style.display = e.target.value === 'custom' ? '' : 'none';
            if (e.target.value === 'profile') updateSPConnProfileList();
        });
        bindOvInput('scp-sp-ov-custom-url', 'customUrl');
        bindOvInput('scp-sp-ov-custom-key', 'customKey');
        bindOvInput('scp-sp-ov-custom-model', 'customModel');
        document.getElementById('scp-sp-ov-conn-profile')?.addEventListener('change', e => {
            syncOvClear('connectionProfileId', e.target.value);
        });

        bindOvInput('scp-sp-ov-max-tokens', 'maxTokens', Number);
        bindOvInput('scp-sp-ov-history-limit', 'localHistoryLimit', Number);
        bindOvInput('scp-sp-ov-reasoning-trim', 'reasoningTrimStrings');
        bindOvInput('scp-sp-ov-char-edit-prompt', 'charEditPrompt');
        bindOvInput('scp-sp-ov-lb-manage-prompt', 'lorebookManagePrompt');
        bindOvInput('scp-sp-ov-chat-edit-prompt', 'chatEditPrompt');

        const ovPrompt = document.getElementById('scp-sp-ov-sysprompt');
        if (ovPrompt) ovPrompt.addEventListener('input', () => syncOvClear('systemPrompt', ovPrompt.value || undefined));

        bindOvCheck('scp-sp-ov-include-sysprompt', 'includeSystemPrompt');
        bindOvCheck('scp-sp-ov-include-persona', 'includeUserPersonality');
        bindOvCheck('scp-sp-ov-include-alt-swipes', 'includeAlternateSwipes');
        bindOvCheck('scp-sp-ov-apply-regex', 'applyRegexToContext');
        bindOvCheck('scp-sp-ov-char-edit-enabled', 'charEditAIEnabled');
        bindOvCheck('scp-sp-ov-lb-ai-enabled', 'lorebookAIManageEnabled');
        bindOvCheck('scp-sp-ov-chat-edit-enabled', 'chatEditAIEnabled');
        bindOvCheck('scp-sp-ov-ce-alt-greetings', 'charField_alternate_greetings');
        bindOvCheck('scp-sp-ov-lb-auto-kw', 'lorebookAutoKeyword');
        document.getElementById('scp-sp-ov-ce-alt-greetings')?.addEventListener('change', (e) => {
            const picker = document.getElementById('scp-sp-ov-ce-alt-greetings-picker');
            if (picker) { picker.style.display = e.target.checked ? '' : 'none'; refreshAltGreetingsPickers(); }
        });

        document.querySelectorAll('.scp-ov-stream-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const val = btn.dataset.stream;
                syncOvClear('forceStreaming', val);
                document.querySelectorAll('.scp-ov-stream-btn').forEach(b => {
                    const active = b.dataset.stream === val;
                    b.classList.toggle('active', active);
                    b.style.color = active ? 'var(--scp-accent)' : '';
                    b.style.borderColor = active ? 'var(--scp-accent-dim)' : '';
                    b.style.background = active ? 'var(--scp-accent-bg)' : '';
                });
            });
        });
        
        bindOvCheck('scp-sp-ov-ce-tags', 'charField_tags');
        bindOvCheck('scp-sp-ov-ce-description', 'charField_description');
        bindOvCheck('scp-sp-ov-ce-personality', 'charField_personality');
        bindOvCheck('scp-sp-ov-ce-scenario', 'charField_scenario');
        bindOvCheck('scp-sp-ov-ce-first-mes', 'charField_first_mes');
        bindOvCheck('scp-sp-ov-ce-mes-example', 'charField_mes_example');
        bindOvCheck('scp-sp-ov-ce-authors-note', 'charField_authors_note');
        bindOvCheck('scp-sp-ov-ce-alt-greetings', 'charField_alternate_greetings');

        overlay.querySelectorAll('.scp-sp-ov-clear[data-ovkey]').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.dataset.ovkey;
                setSessionOverride(key, undefined);
                const eff = getEffectiveSettings();
                const ov = getSessionOverrides();
                const elMap = {
                    contextDepth: ['scp-sp-ov-depth-slider', 'scp-sp-ov-depth-val'],
                    maxTokens: ['scp-sp-ov-max-tokens'],
                    localHistoryLimit: ['scp-sp-ov-history-limit'],
                    reasoningTrimStrings: ['scp-sp-ov-reasoning-trim'],
                    systemPrompt: ['scp-sp-ov-sysprompt'],
                    connectionSource: ['scp-sp-ov-conn-source'],
                    customUrl: ['scp-sp-ov-custom-url'],
                    customKey: ['scp-sp-ov-custom-key'],
                    customModel: ['scp-sp-ov-custom-model'],
                    connectionProfileId: ['scp-sp-ov-conn-profile'],
                    includeSystemPrompt: ['scp-sp-ov-include-sysprompt'],
                    includeUserPersonality: ['scp-sp-ov-include-persona'],
                    includeAlternateSwipes: ['scp-sp-ov-include-alt-swipes'],
                    applyRegexToContext: ['scp-sp-ov-apply-regex'],
                    charField_tags: ['scp-sp-ov-ce-tags'],
                    charField_description: ['scp-sp-ov-ce-description'],
                    charField_personality: ['scp-sp-ov-ce-personality'],
                    charField_scenario: ['scp-sp-ov-ce-scenario'],
                    charField_first_mes: ['scp-sp-ov-ce-first-mes'],
                    charField_mes_example: ['scp-sp-ov-ce-mes-example'],
                    charField_authors_note: ['scp-sp-ov-ce-authors-note'],
                    charField_alternate_greetings: ['scp-sp-ov-ce-alt-greetings'],
                    charEditAIEnabled: ['scp-sp-ov-char-edit-enabled'],
                    charEditPrompt: ['scp-sp-ov-char-edit-prompt'],
                    lorebookAIManageEnabled: ['scp-sp-ov-lb-ai-enabled'],
                    lorebookManagePrompt: ['scp-sp-ov-lb-manage-prompt'],
                    lorebookAutoKeyword: ['scp-sp-ov-lb-auto-kw'],
                    chatEditAIEnabled: ['scp-sp-ov-chat-edit-enabled'],
                    chatEditPrompt: ['scp-sp-ov-chat-edit-prompt'],
                };
                (elMap[key] || []).forEach(id => {
                    const el = document.getElementById(id); if (!el) return;
                    if (id.includes('depth-val')) { el.textContent = eff.contextDepth ?? 15; return; }
                    
                    if (el.type === 'checkbox') {
                        if (key.startsWith('charField_')) {
                            const fKey = key.replace('charField_', '');
                            el.checked = (getSettings().charEditFields || {})[fKey] !== false;
                        } else {
                            el.checked = !!eff[key];
                        }
                    }
                    else if (el.type === 'range') el.value = eff[key] ?? 15;
                    else if (id === 'scp-sp-ov-conn-source') {
                        el.value = eff.connectionSource ?? 'default';
                        const pg = document.getElementById('scp-sp-ov-profile-group');
                        if (pg) pg.style.display = el.value === 'profile' ? '' : 'none';
                        const cg = document.getElementById('scp-sp-ov-custom-profile-group');
                        if (cg) cg.style.display = el.value === 'custom' ? '' : 'none';
                    }
                    else if (id === 'scp-sp-ov-conn-profile') {
                        el.value = eff.connectionProfileId ?? '';
                    }
                    else el.value = (key in ov ? ov[key] : '') ?? '';
                });
                if (key === 'forceStreaming') {
                    const streamVal = eff.forceStreaming === true ? 'on' : (eff.forceStreaming === false ? 'auto' : (eff.forceStreaming || 'auto'));
                    document.querySelectorAll('.scp-ov-stream-btn').forEach(b => {
                        const active = b.dataset.stream === streamVal;
                        b.classList.toggle('active', active);
                        b.style.color = active ? 'var(--scp-accent)' : '';
                        b.style.borderColor = active ? 'var(--scp-accent-dim)' : '';
                        b.style.background = active ? 'var(--scp-accent-bg)' : '';
                    });
                }
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

        _setupBgUpload('scp-sp-bg-upload-btn', 'scp-sp-bg-url');
    }

    // ─── Window Event Listeners ─────────────────────────────────────────────────

    function attachWindowListeners() {
        makeDraggable($('scp-drag-handle'), windowEl);
        makeResizable(windowEl);
        setupMessagesScrollTracking();

        document.addEventListener('pointerdown', e => {
            const win = document.getElementById(WIN_ID);
            if (!win || win.style.display === 'none') {
                _copilotActive = false;
                return;
            }
            const clickedInside = win.contains(e.target) || 
                                  e.target.closest('.scp-dialog-overlay') ||
                                  document.getElementById('scp-settings-overlay')?.contains(e.target) ||
                                  document.getElementById('scp-lb-overlay')?.contains(e.target) ||
                                  document.getElementById('scp-picker-overlay')?.contains(e.target) ||
                                  document.getElementById('scp-diff-modal')?.contains(e.target);
            _copilotActive = !!clickedInside;
        }, true);

        window.addEventListener('resize', () => {
            if (windowEl && windowEl.style.display !== 'none') {
                const r = windowEl.getBoundingClientRect();
                const s = getSettings();
                
                if (s.windowX !== null && s.windowY !== null) {
                    const maxLeft = Math.max(0, window.innerWidth - r.width);
                    const maxTop = Math.max(0, window.innerHeight - r.height);
                    windowEl.style.left = `${Math.max(0, Math.min(s.windowX, maxLeft))}px`;
                    windowEl.style.top = `${Math.max(0, Math.min(s.windowY, maxTop))}px`;
                }
            }
            
            if (iconEl && iconEl.style.display !== 'none') {
                const vw = window.innerWidth;
                const vh = window.innerHeight;
                const iconSize = 46;
                const savedIconPos = localStorage.getItem(ICON_STORAGE_KEY);
                
                if (savedIconPos) {
                    try {
                        const pos = JSON.parse(savedIconPos);
                        const left = parseFloat(pos.left);
                        const top = parseFloat(pos.top);
                        
                        if (!isNaN(left) && !isNaN(top)) {
                            let newLeft = Math.max(0, Math.min(left, vw - iconSize));
                            let newTop = Math.max(0, Math.min(top, vh - iconSize));
                            iconEl.style.left = `${newLeft}px`;
                            iconEl.style.top = `${newTop}px`;
                        }
                    } catch(e) {}
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
            if (_generating) {
                toastr.warning('Please wait for generation to finish.', EXT_DISPLAY);
                return;
            }
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
            const bucket = getChatBucket();

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
            createSession(result.name.trim() || defaultName, result.isTemporary);
            refreshSessionDropdown(); renderSession(getCurrentSession());
        });

        $('scp-rename-sess-btn')?.addEventListener('click', async () => {
            const sess = getCurrentSession();
            const oldName = sess.name;
            const newName = await showCustomDialog({ type: 'prompt', title: 'Rename Session', message: 'New session name:', defaultValue: sess.name });
            if (!newName?.trim() || newName.trim() === oldName) return;
            sess.name = newName.trim(); saveSessionsToMetadata(); refreshSessionDropdown();
            _dbgAdd('SESSION_RENAMED', { id: sess.id, oldName, newName: sess.name });
        });

        $('scp-del-sess-btn')?.addEventListener('click', async () => {
            const bucket = getChatBucket();
            if (!bucket.sessions.length) return;
            const ok = await showCustomDialog({ type: 'confirm', title: 'Delete Session', message: 'Delete this session and all its messages? This cannot be undone.' });
            if (!ok) return;
            const newSess = deleteCurrentSession();
            refreshSessionDropdown(); renderSession(newSess);
        });

        $('scp-export-sess-btn')?.addEventListener('click', () => { closeSessPanel(); exportCurrentSession(); });
        $('scp-import-sess-btn')?.addEventListener('click', () => { closeSessPanel(); importSession(); });

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
        _setupAttachButton();

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

        // Favorites
        $('scp-fav-btn')?.addEventListener('click', () => {
            const panel = document.getElementById('scp-fav-panel');
            if (panel?.style.display === 'none' || !panel?.style.display) openFavoritesPanel();
            else closeFavoritesPanel();
        });
        $('scp-fav-close')?.addEventListener('click', closeFavoritesPanel);

        // Quick Prompts toggle
        $('scp-qp-toggle-btn')?.addEventListener('click', () => {
            const s = getSettings();
            s.quickPromptsVisible = !s.quickPromptsVisible;
            saveSettings(); renderQuickPromptsBar();
        });

        // Desktop horizontal scroll for QP bar
        const qpBar = $('scp-qp-bar');
        if (qpBar) {
            qpBar.addEventListener('wheel', e => {
                if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
                e.preventDefault();
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

        $('scp-stop-btn')?.addEventListener('click', () => {
            _abortController?.abort();
            const { stopGeneration } = SillyTavern.getContext();
            if (typeof stopGeneration === 'function') stopGeneration();
        });

        // Input
        const inputEl = $('scp-input');
        if (inputEl) {
            inputEl.addEventListener('input', () => {
                autoResize(inputEl);
                updateMsgCount(getCurrentSession());
            });
            inputEl.addEventListener('keydown', e => { 
                if (e.key === 'Enter' && !e.shiftKey) { 
                    const isMobile = window.innerWidth <= 900 || ('ontouchstart' in window);
                    if (!isMobile) {
                        e.preventDefault(); 
                        handleSend(); 
                    }
                } 
            });
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
                
                const isFormatted = tab.dataset.tab === 'formatted';
                const isJson = tab.dataset.tab === 'json';
                
                const fmtEl = $('scp-ctx-formatted');
                const jsonEl = $('scp-ctx-json');
                
                if (fmtEl) fmtEl.style.display = isFormatted ? '' : 'none';
                if (jsonEl) jsonEl.style.display = isJson ? '' : 'none';
                
                setTimeout(() => {
                    const targetEl = isJson ? jsonEl : document.getElementById('scp-ctx-body');
                    if (targetEl) {
                        const prevBehavior = targetEl.style.scrollBehavior;
                        targetEl.style.scrollBehavior = 'auto';
                        targetEl.scrollTop = targetEl.scrollHeight;
                        targetEl.style.scrollBehavior = prevBehavior;
                    }
                }, 0);
            });
        });
        $('scp-ctx-copy-btn')?.addEventListener('click', () => {
            const activeTab = document.querySelector('.scp-modal-tab.active');
            if (activeTab?.dataset.tab === 'json') {
                copyText($('scp-ctx-json')?.textContent || '');
            } else {
                copyText(formatPayloadAsText(_lastInspectorMessages));
            }
        });
    }

    // ─── Chat Change ─────────────────────────────────────────────────────────────

    async function onChatChanged() {
        if (_generating) {
            _abortController?.abort();
            _generating = false;
            setGeneratingState(false);
        }
        _lastChatLen = -1;
        _wiCache = {};
        closeFavoritesPanel();
        updateCharBadge();
        
        await initChatBucket();
        
        refreshSessionDropdown();
        renderSession(getCurrentSession());
        autoLoadBoundProfile();
        updateSessionOverrideIndicator();
        updateDepthSlidersMax();
        renderQuickPromptsBar();
        updatePickBtnState();
        refreshAltGreetingsPickers();
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

    // ─── Changelog ───────────────────────────────────────────────────────────────

    function buildChangelogHTML() {
        const current = CHANGELOG[0];
        const past = CHANGELOG.slice(1);

        const notesHTML = current.notes
            .map(n => `<li>${n}</li>`)
            .join('');

        let historyHTML = '';
        if (past.length) {
            historyHTML = `<div class="scp-cl-history">` +
                past.map(entry => {
                    const li = (entry.notes || []).map(n => `<li>${n}</li>`).join('');
                    return `<details class="scp-cl-entry">
                        <summary class="scp-cl-entry-summary">
                            <span class="scp-cl-entry-ver">v${escHtml(entry.version)}</span>
                            <span style="flex:1;opacity:.5">${escHtml(entry.date || '')}</span>
                        </summary>
                        <div class="scp-cl-entry-body"><ul>${li}</ul></div>
                    </details>`;
                }).join('') +
                `</div>`;
        }

        return `<div class="scp-cl-current">
            <div class="scp-cl-version-badge">✦ Version ${escHtml(current.version)} ${current.date ? '· ' + escHtml(current.date) : ''}</div>
            <div class="scp-cl-notes"><ul>${notesHTML}</ul></div>
        </div>${historyHTML}`;
    }

    function openChangelog() {
        const modal = document.getElementById('scp-changelog-modal');
        if (!modal) return;
        const body = document.getElementById('scp-changelog-body');
        if (body) body.innerHTML = buildChangelogHTML();
        modal.style.display = 'flex';
    }

    function closeChangelog() {
        const modal = document.getElementById('scp-changelog-modal');
        if (modal) modal.style.display = 'none';
    }

    function checkChangelogAutoShow() {
        const s = getSettings();
        const current = CHANGELOG[0];
        const currentVersion = current?.version || '';
        if (s.changelogAutoShow && current?.announce !== false && s.lastSeenVersion !== currentVersion) {
            s.lastSeenVersion = currentVersion;
            saveSettings();
            setTimeout(openChangelog, 800);
        } else if (s.lastSeenVersion !== currentVersion) {
            s.lastSeenVersion = currentVersion;
            saveSettings();
        }
    }

    function setupChangelogListeners() {
        const modal = document.getElementById('scp-changelog-modal');
        if (!modal) return;
        document.getElementById('scp-changelog-close')?.addEventListener('click', closeChangelog);
        let _mdTarget = null;
        modal.addEventListener('mousedown', e => { _mdTarget = e.target; });
        modal.addEventListener('click', e => { if (e.target === modal && _mdTarget === modal) closeChangelog(); });
    }

    // ─── Favorites ───────────────────────────────────────────────────────────────

    function getSessionFavKey() {
        const { charId, chatId } = getBindingKey();
        return `${charId}${chatId}`;
    }

    function getStarredMessages() {
        const s = getSettings();
        const key = getSessionFavKey();
        if (!s.starredMessages[key]) s.starredMessages[key] = [];
        return s.starredMessages[key];
    }

    function isMessageStarred(msgId) {
        return getStarredMessages().includes(msgId);
    }

    function toggleStarMessage(msgId) {
        const s = getSettings();
        const key = getSessionFavKey();
        if (!s.starredMessages[key]) s.starredMessages[key] = [];
        const arr = s.starredMessages[key];
        const idx = arr.indexOf(msgId);
        if (idx >= 0) arr.splice(idx, 1);
        else arr.push(msgId);
        saveSettings();
        return idx < 0; // true = now starred
    }

    function renderFavoritesPanel() {
        const listEl = document.getElementById('scp-fav-list');
        const emptyEl = document.getElementById('scp-fav-empty');
        if (!listEl) return;

        const starredIds = getStarredMessages();
        const session = getCurrentSession();
        const starred = session.messages.filter(m => starredIds.includes(m.id));

        listEl.querySelectorAll('.scp-fav-item').forEach(el => el.remove());

        if (!starred.length) {
            if (emptyEl) emptyEl.style.display = '';
            return;
        }
        if (emptyEl) emptyEl.style.display = 'none';

        const frag = document.createDocumentFragment();
        starred.forEach(msg => {
            const item = document.createElement('div');
            item.className = 'scp-fav-item';
            item.dataset.msgId = msg.id;

            const raw = msg.content.replace(/```[\s\S]*?```/g, '[code]').replace(/<[^>]+>/g, '').trim();
            const preview = raw.length > 140 ? raw.slice(0, 140) + '…' : raw;
            const roleLabel = msg.role === 'user' ? 'User' : 'Copilot';
            const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            item.innerHTML = `
                <span class="scp-fav-item-icon">${I.starFill}</span>
                <div class="scp-fav-item-body">
                    <div class="scp-fav-item-meta">
                        <span class="scp-fav-item-role">${escHtml(roleLabel)}</span>
                        <span>${escHtml(time)}</span>
                    </div>
                    <div class="scp-fav-item-text">${escHtml(preview)}</div>
                </div>
                <button class="scp-fav-item-remove" title="Remove from starred">✕</button>`;

            item.addEventListener('click', e => {
                if (e.target.classList.contains('scp-fav-item-remove')) return;
                closeFavoritesPanel();
                const msgEl = document.querySelector(`.scp-msg[data-id="${msg.id}"]`);
                if (!msgEl) return;
                msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                requestAnimationFrame(() => {
                    msgEl.classList.remove('scp-msg-flash');
                    void msgEl.offsetWidth;
                    msgEl.classList.add('scp-msg-flash');
                    msgEl.addEventListener('animationend', () => msgEl.classList.remove('scp-msg-flash'), { once: true });
                });
            });

            item.querySelector('.scp-fav-item-remove').addEventListener('click', e => {
                e.stopPropagation();
                toggleStarMessage(msg.id);
                const msgEl = document.querySelector(`.scp-msg[data-id="${msg.id}"]`);
                if (msgEl) {
                    msgEl.classList.remove('scp-msg-starred');
                    const btn = msgEl.querySelector('.scp-msg-btn-star');
                    if (btn) { btn.classList.remove('starred'); btn.title = 'Star message'; }
                }
                renderFavoritesPanel();
            });

            frag.appendChild(item);
        });
        listEl.appendChild(frag);
    }

    function openFavoritesPanel() {
        const panel = document.getElementById('scp-fav-panel');
        const btn = document.getElementById('scp-fav-btn');
        if (!panel) return;
        renderFavoritesPanel();
        panel.style.display = 'flex';
        btn?.classList.add('active');
    }

    function closeFavoritesPanel() {
        const panel = document.getElementById('scp-fav-panel');
        const btn = document.getElementById('scp-fav-btn');
        if (panel) panel.style.display = 'none';
        btn?.classList.remove('active');
    }

    // ─── File Attachments ────────────────────────────────────────────────────────

    let _pendingAttachments = []; // [{id, name, type, dataUrl, isImage, file}]

    function _attachmentId() { return `att_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

    async function _fileToDataUrl(file) {
        return new Promise((res, rej) => {
            const r = new FileReader();
            r.onload = () => res(r.result);
            r.onerror = () => {
                _dbgAdd('ATTACHMENT_READ_FAILED', { error: 'FileReader failed' });
                rej(new Error('Read failed'));
            };
            r.readAsDataURL(file);
        });
    }

    async function _getCaptionViaExtension(file) {
        const ctx = SillyTavern.getContext();
        try {
            const captionMod = await import('/scripts/extensions/image-captioning/index.js').catch(() => null);
            if (captionMod && typeof captionMod.getCaptionForFile === 'function') {
                const caption = await captionMod.getCaptionForFile(file, null, true);
                return caption || '';
            }
        } catch (_) {}
        try {
            const dataUrl = await _fileToDataUrl(file);
            const base64 = dataUrl.split(',')[1];
            const res = await fetch('/api/extra/caption', {
                method: 'POST',
                headers: { ...ctx.getRequestHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: base64 }),
            });
            if (res.ok) {
                const data = await res.json();
                return data.caption || '';
            }
        } catch (_) {}
        return '';
    }

    async function _processAttachmentsBeforeSend(atts, isPreview = false) {
        const s = getSettings();
        const mode = s.imageAnalysisMode || 'direct';
        const processed = [];
        for (const a of atts) {
            if (a.isImage && mode === 'caption') {
                if (isPreview) {
                    processed.push({ ...a, sendAsText: true, textContent: `[Image "${a.name}" (caption will be generated on send)]` });
                } else {
                    let cap = await _getCaptionViaExtension(a.file).catch((e)=>{
                        console.warn("[ST-Copilot] Captioning error:", e);
                        _dbgAdd('IMAGE_CAPTIONING_SERVICE_MISSING', { name: a.name });
                        return '';
                    });
                    if (!cap) toastr.warning(`Captioning failed for ${a.name}`, EXT_DISPLAY);
                    processed.push({
                        ...a,
                        sendAsText: true,
                        textContent: cap ? `[Image "${a.name}" caption: ${cap}]` : `[Image "${a.name}" (captioning failed)]`
                    });
                }
            } else if (!a.isImage) {
                let text = a.textContent;
                if (!text && a.file) {
                    try { text = await a.file.text(); } catch(e) { text = '(binary data or read error)'; }
                }
                processed.push({ ...a, sendAsText: true, textContent: text });
            } else {
                processed.push({ ...a });
            }
        }
        return processed;
    }

    function _mergeContent(baseText, atts) {
        if (!atts || !atts.length) return baseText;
        const textParts = atts.filter(a => a.textContent).map(a => a.sendAsText ? a.textContent : `[Attached file "${a.name}"]\n${a.textContent}`);
        const textPrefix = textParts.join('\n\n');
        
        let combinedText = '';
        if (textPrefix && baseText) combinedText = `${textPrefix}\n\n${baseText}`;
        else if (textPrefix) combinedText = textPrefix;
        else combinedText = baseText;
        
        const imgBlocks = atts.filter(a => a.isImage && !a.sendAsText).map(a => ({ type: 'image_url', image_url: { url: a.dataUrl } }));
        
        if (imgBlocks.length > 0) {
            return [...imgBlocks, { type: 'text', text: combinedText }];
        }
        return combinedText;
    }

    function _renderAttachmentPreviews() {
        let previewBar = document.getElementById('scp-attachment-bar');
        const inputRow = document.querySelector('.scp-input-row');
        if (!inputRow) return;

        if (!_pendingAttachments.length) {
            previewBar?.remove();
            return;
        }

        if (!previewBar) {
            previewBar = document.createElement('div');
            previewBar.id = 'scp-attachment-bar';
            previewBar.className = 'scp-attachment-bar';
            inputRow.parentNode.insertBefore(previewBar, inputRow);
        }
        previewBar.innerHTML = '';

        for (const att of _pendingAttachments) {
            const item = document.createElement('div');
            item.className = 'scp-att-item';
            item.dataset.id = att.id;

            if (att.isImage) {
                const img = document.createElement('img');
                img.src = att.dataUrl;
                img.className = 'scp-att-thumb';
                img.title = att.name;
                img.addEventListener('click', () => _openImageLightbox(att));
                item.appendChild(img);
            } else {
                const icon = document.createElement('div');
                icon.className = 'scp-att-icon';
                icon.innerHTML = `<i class="fa-solid fa-file"></i>`;
                icon.title = att.name;
                item.appendChild(icon);
                const lbl = document.createElement('div');
                lbl.className = 'scp-att-label';
                lbl.textContent = att.name.length > 14 ? att.name.slice(0, 12) + '…' : att.name;
                item.appendChild(lbl);
                item.addEventListener('click', () => _openTextLightbox(att));
            }

            const removeBtn = document.createElement('button');
            removeBtn.className = 'scp-att-remove';
            removeBtn.innerHTML = '×';
            removeBtn.title = 'Remove';
            removeBtn.addEventListener('click', e => {
                e.stopPropagation();

                _dbgAdd('ATTACHMENT_REMOVE', { id: att.id });

                _pendingAttachments = _pendingAttachments.filter(a => a.id !== att.id);
                _renderAttachmentPreviews();
                updateMsgCount(getCurrentSession());
            });
            item.appendChild(removeBtn);
            previewBar.appendChild(item);
        }
    }

    let _lightboxEl = null;
    let _lightboxScale = 1;
    let _lightboxOrigin = { x: 0.5, y: 0.5 };

    function _openImageLightbox(att) {
        _dbgAdd('ATTACHMENT_LIGHTBOX_OPEN', { isImage: true });

        if (_lightboxEl) _lightboxEl.remove();
        _lightboxScale = 1;

        const overlay = document.createElement('div');
        overlay.className = 'scp-lightbox';
        _lightboxEl = overlay;

        const img = document.createElement('img');
        img.src = att.dataUrl;
        img.className = 'scp-lightbox-img';
        img.style.transform = `scale(1)`;
        img.style.transformOrigin = '50% 50%';

        overlay.appendChild(img);
        document.body.appendChild(overlay);

        img.addEventListener('click', e => {
            if (_lightboxScale >= 3) { _lightboxScale = 1; }
            else { _lightboxScale = Math.min(3, _lightboxScale + 1); }
            const rect = img.getBoundingClientRect();
            const ox = ((e.clientX - rect.left) / rect.width * 100).toFixed(1);
            const oy = ((e.clientY - rect.top) / rect.height * 100).toFixed(1);
            img.style.transformOrigin = `${ox}% ${oy}%`;
            img.style.transform = `scale(${_lightboxScale})`;
            img.style.cursor = _lightboxScale > 1 ? 'zoom-out' : 'zoom-in';
        });
        overlay.addEventListener('click', e => {
            if (e.target === overlay) { overlay.remove(); _lightboxEl = null; }
        });
        document.addEventListener('keydown', function onEsc(e) {
            if (e.key === 'Escape') { overlay.remove(); _lightboxEl = null; document.removeEventListener('keydown', onEsc); }
        });
    }

    async function _openTextLightbox(att) {
        _dbgAdd('ATTACHMENT_LIGHTBOX_OPEN', { isImage: false });

        if (_lightboxEl) _lightboxEl.remove();
        const overlay = document.createElement('div');
        overlay.className = 'scp-lightbox';
        _lightboxEl = overlay;
        const pre = document.createElement('pre');
        pre.className = 'scp-lightbox-text';
        
        let text = att.textContent;
        if (!text && att.file) {
            try { text = await att.file.text(); att.textContent = text; } 
            catch(e) { text = 'Error reading file.'; }
        }
        pre.textContent = text || 'Loading...';
        
        overlay.appendChild(pre);
        document.body.appendChild(overlay);
        overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); _lightboxEl = null; }});
        document.addEventListener('keydown', function onEsc(e) { if (e.key === 'Escape') { overlay.remove(); _lightboxEl = null; document.removeEventListener('keydown', onEsc); }});
    }

    async function _addAttachments(files) {
        for (const file of files) {
            const isImage = file.type.startsWith('image/');
            let dataUrl = null;
            if (isImage) {
                dataUrl = await _fileToDataUrl(file).catch(() => null);
                if (!dataUrl) continue;
            }
            
            _pendingAttachments.push({
                id: _attachmentId(),
                name: file.name, type: file.type, mimeType: file.type,
                dataUrl, isImage, file, textContent: null,
            });

            _dbgAdd('ATTACHMENT_ADD', { name: file.name, type: file.type, size: file.size });
        }
        _renderAttachmentPreviews();
        updateMsgCount(getCurrentSession());
    }

    // ─── Init ────────────────────────────────────────────────────────────────────

    async function loadManifestVersion() {
        try {
            const res = await fetch(`/scripts/extensions/${__extPath}/manifest.json`);
            if (res.ok) {
                const manifest = await res.json();
                extVersion = manifest.version || CHANGELOG[0]?.version || '?';
            } else {
                extVersion = CHANGELOG[0]?.version || '?';
            }
        } catch (_) {
            extVersion = CHANGELOG[0]?.version || '?';
        }
    }

    async function init() {
        _dbgSetupGlobalErrorHandlers();
        try { ST_WorldInfo = await import('/scripts/world-info.js'); } catch(e) { console.warn('ST-Copilot: Could not import world-info.js'); }
        try { ST_Utils = await import('/scripts/utils.js'); } catch(e) { console.warn('ST-Copilot: Could not import utils.js'); }
        await loadManifestVersion();
        getSettings(); await injectUI();
        const ctx = SillyTavern.getContext();
        const container = document.getElementById('extensions_settings') || document.getElementById('extensions_settings2');
        if (container) {
            try {
                const html = await ctx.renderExtensionTemplateAsync(__extPath, 'settings');
                if (html) container.insertAdjacentHTML('beforeend', html);
            } catch (e) {}
        }
        restoreWindowState(); attachWindowListeners(); setupSettingsHandlers(); updateSettingsUI(); setupLorebookManagerListeners(); setupSettingsPanelListeners(); setupChatPickerListeners(); setupChangelogListeners();
        
        const s = getSettings();
        
        if (s.windowVisible && !s.minimized) {
            windowEl.style.display = 'flex';
            _copilotActive = true;
        } else {
            windowEl.style.display = 'none';
            _copilotActive = false;
        }
        
        updateIconVisibility();
        
        onChatChanged();
        const es = ctx.eventSource || window.eventSource;
        const et = ctx.event_types || window.event_types || {};

        if (es) {
            es.on(et.CHAT_CHANGED || 'chat_changed', onChatChanged);
            es.on(et.CHARACTER_SELECTED || 'character_selected', onChatChanged);
            es.on(et.APP_READY || 'app_ready', () => {
                updateProfilesList();
                updateSPConnProfileList();
            });

            const cmEvents = [
                et.CONNECTION_PROFILE_CREATED || 'connection_profile_created',
                et.CONNECTION_PROFILE_UPDATED || 'connection_profile_updated',
                et.CONNECTION_PROFILE_DELETED || 'connection_profile_deleted',
                et.CONNECTION_PROFILE_LOADED || 'connection_profile_loaded'
            ];
            cmEvents.forEach(evt => {
                es.on(evt, () => {
                    updateProfilesList();
                    updateSPConnProfileList();
                });
            });
            
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
        
        setupHotkey(); setupSearchHotkey(); setupGhostHotkey(); addWandButton();
        checkChangelogAutoShow();
        _takeProfileSnapshot();
        _dbgSnapshotSettings();
        updateMemoryDot();

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

        const preventSpinBug = e => {
            if (e.target && e.target.tagName === 'INPUT' && e.target.type === 'number') {
                e.stopPropagation();
            }
        };
        [
            windowEl, 
            document.getElementById('scp-settings-overlay'), 
            document.getElementById('scp-lb-overlay'), 
            document.getElementById('scp-picker-overlay')
        ].filter(Boolean).forEach(el => {
            el.addEventListener('mousedown', preventSpinBug);
            el.addEventListener('mouseup', preventSpinBug);
            el.addEventListener('pointerdown', preventSpinBug);
            el.addEventListener('pointerup', preventSpinBug);
        });

        console.log(`[${EXT_DISPLAY}] Initialized.`);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else setTimeout(init, 0);
})();