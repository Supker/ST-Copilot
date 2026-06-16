export const EXT_NAME = 'st_copilot';
export const EXT_DISPLAY = 'ST-Copilot';
export const WIN_ID = 'scp-window';
export const ICON_ID = 'scp-dock-icon';
export const MODAL_ID = 'scp-ctx-modal';
export const ICON_STORAGE_KEY = 'scp-icon-position';
export const EMBEDDED_BOOK_KEY = '__char_embedded__';

export const DEFAULT_SYSTEM_PROMPT = `<system_role>
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

export const DEFAULT_LB_MANAGE_PROMPT = `<context>
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

<outlet_entries_info>
Outlet entries (position=5) are reusable content blocks injected wherever {{outlet::outlet_name}} macro appears in other prompts or scenarios. They are NOT directly added to context.
To create an outlet entry: use "add" action with "outlet":true and "outlet_name":"your_outlet_name".
To convert an existing entry to outlet: use "edit" with "outlet":true and "outlet_name":"your_outlet_name".
Active outlet entries are listed in lorebook_context under "Outlet Entries" (if exists).
</outlet_entries_info>

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

export const DEFAULT_CHAR_EDIT_DIRECTIVE = `<context>
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

export const DEFAULT_CHAT_EDIT_DIRECTIVE = `<context>
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

export const LB_FORMAT_BLOCK = `\`\`\`lorebook-changes
{"changes":[
  {"action":"add","worldName":"BookName","name":"EntryName","triggers":["keyword"],"content":"Entry content","constant":false},
  {"action":"add","worldName":"BookName","name":"OutletEntry","content":"Outlet content here","outlet":true,"outlet_name":"my_outlet_name"},
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

export const CHAR_EDIT_FORMAT_BLOCK = `\`\`\`character-changes
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

export const CHAR_CREATE_FORMAT_BLOCK = `\`\`\`character-create
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

export const CHAT_EDIT_FORMAT_BLOCK = `\`\`\`chat-changes
{"changes":[
  {"action":"rename_chat","name":"New Chat Display Name"},
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

export const DEFAULT_MEMORY_PROMPT = `<memory_logic>
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
export const MEMORY_FORMAT_BLOCK = `\`\`\`memory-update\n[\n  {"action":"add","scope":"global|character|chat|session","key":"CategoryName","value":"Fact to remember"},\n  {"action":"edit","scope":"exact_existing_scope","key":"exact_existing_key","value":"Updated fact"},\n  {"action":"delete","scope":"exact_existing_scope","key":"exact_existing_key"}\n]\n\`\`\``;

export const DEFAULT_TOOLS_PROMPT = `Imperative: NEVER hallucinate missing context. If chat history, specific lore, or data appears absent, DO NOT assume the chat hasn't started or the data doesn't exist. You MUST proactively use your tools to fetch, verify, and retrieve the actual state before answering.

Process: Output \`tool_call\` JSON block -> Receive result -> Finalize response to the Human. You may chain tools sequentially.

<available_tools>
{{tools_list}}
</available_tools>

<output_format>
{{tool_call_format}}.
</output_format>`;
export const TOOL_CALL_FORMAT_BLOCK = `\`\`\`tool_call\n{"name": "tool_name","input": {"parameter_name": "value"}}\n\`\`\``;

    // ─── Changelog Data ──────────────────────────────────────────────────────────
export const CHANGELOG = [
    {
        version: '2.8.2',
        date: '6/16/2026',
        announce: true,
        notes: [
            '<strong>Character Management</strong> — Copilot can now access and modify Name, Main Prompt Override, and Post-History Instructions.',
            '<strong>Lorebook API</strong> — Added <code>get_lorebooks</code> tool and upgraded <code>search_lorebook_entries</code> with <code>is_constant</code> and <code>is_outlet</code> parameters.',
            '<strong>Dynamic Outlets</strong> — Enabled AI autonomy for creating and modifying Lorebook Outlets (requires Lorebook Prompt reset to default).',
            '<strong>Chat Management</strong> — Added support for renaming the current chat via Proposed Chat Changes.',
            '<strong>Stability & Tokens</strong> — Fixed critical session deletion bugs, improved token counting accuracy, and optimized save-lock logic.'
        ],
    },
    {
        version: '2.8.1',
        date: '6/15/2026',
        announce: false,
        notes: [
            '<strong>World Info Outlets</strong> — Added full support for the <code>{{outlet::name}}</code> macro syntax for dynamic content injection.',
            '<strong>UI Navigation</strong> — Repositioned tab buttons in the settings panel for improved accessibility and user flow.',
            '<strong>Stability</strong> — Fixed various minor regressions and internal logic bugs.'
        ],
    },
    {
        version: '2.8.0',
        date: '6/11/2026',
        announce: false,
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

export const THEME_PRESETS = {
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

export const THEME_VAR_DEFS = [
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

export const THEME_CSS_MAP = {
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

export const TOOL_DEFINITIONS = [
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
            name: 'search_lorebook_entry',
            label: 'Search Lorebook Entries',
            icon: 'fa-book',
            description: 'Search for entries in active lorebooks by name, keyword, or content. Can filter by constant or outlet type.',
            settingKey: 'toolsEnabled_search_lorebook',
            schema: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Text to search for in entry names, keys, and content' },
                    book_name: { type: 'string', description: 'Specific lorebook name to search (optional)' },
                    search_in: { type: 'string', enum: ['all', 'name', 'keys', 'content'], description: 'Where to search (default: all)' },
                    only_constant: { type: 'boolean', description: 'If true, return only constant (always-active) entries' },
                    only_outlet: { type: 'boolean', description: 'If true, return only outlet entries (injected via {{outlet::name}} macro)' },
                },
                required: ['query'],
            },
        },
        {
            id: 'get_lorebooks',
            name: 'get_lorebooks',
            label: 'Get Lorebooks',
            icon: 'fa-book-open',
            description: 'Get all active lorebook names. Optionally list entry names and types for each book.',
            settingKey: 'toolsEnabled_get_lorebooks',
            schema: {
                type: 'object',
                properties: {
                    include_entries: { type: 'boolean', description: 'If true, include entry names/types for each lorebook' },
                    book_name: { type: 'string', description: 'When include_entries is true, limit to this specific lorebook (optional)' },
                },
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

export const I = {
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

export const QP_ICON_POOL = [
        '🔍','💡','📋','✨','🎭','📖','🗺️','⚔️','🧠','💬',
        '🎯','🔮','📝','🌍','❓','🎨','💭','🔥','⚡','🎲',
        '👁️','🧩','📚','🗣️','💫','🌟','🎬','🧪','🏆','🎵',
        '🌙','☀️','🌊','🍃','💎','🛡️','🗡️','🏰','🐉','🦋',
        '🎪','🌀','🔑','💀','🌹','🍷','🎩','🧿','🔔','⭐',
        '🐺','🦊','🐦','🌸','🍄','🔴','🟣','🔵','🟡','🟢',
    ];