# ST-Copilot

ST-Copilot is a meta-assistant extension for SillyTavern. It provides a floating, independent chat interface that sits on top of your main roleplay. 

Instead of roleplaying, this assistant acts as your creative partner. It reads your current character data, lore, and recent chat history to help you brainstorm ideas, check continuity, get writing feedback, or ask questions about the ongoing story—all without breaking the immersion of your main chat.

## Features

* **Context-Aware:** Automatically reads your Character Card, User Persona, Author's Note, and recent chat history to understand the current state of your roleplay.
* **AI-Powered Lorebook Editing:** Ask the assistant to update your world info. Review changes through interactive "Proposal Cards" and a side-by-side Diff viewer before applying them. The system now tracks and records when you accept or reject entries within the AI context for better continuity.
* **Dynamic Lorebook Injection:** Advanced control over World Info. Manually force entries "In" or "Out" of context, or let the system auto-inject lore based on chat keywords.
* **Floating Interface:** A draggable, resizable window that can be minimized to a small dock icon when not in use. Adjustable opacity allows you to see the chat behind it. Now fully optimized for mobile devices, including the Lorebook manager and confirmation dialogs.
* **Independent Sessions:** Create and switch between multiple Copilot conversations for the same character or chat.
* **API Flexibility:** Use your current SillyTavern API connection, or bind the Copilot to a completely different, specific connection profile.
* **Message Editing & Regeneration:** Edit your prompts, regenerate responses, and view precise token counts for your payloads.
* **Highly Customizable:** Includes multiple visual presets and a full custom theme editor.
* **Configuration Profiles:** Save your Copilot settings and automatically load them for specific characters or chats. Includes a safety confirmation dialog if you try to switch profiles with unsaved changes.

## Installation

1. Open SillyTavern.
2. Click the **Extensions** icon (the blocks) in the top menu.
3. Open the **Install Extension** menu.
4. Paste the link to this repository and click **Install**.
5. Refresh your SillyTavern page.

## How to Use

Once installed, ST-Copilot can be opened in a few ways:
* Use the default keyboard shortcut: `Alt+Shift+C`.
* Click the **Extensions Menu** (the magic wand icon) and select **ST-Copilot**.
* If minimized, click the floating bot icon in the bottom right corner of your screen.

Type your question or request into the input box. For example:
* "Based on the last few messages, what is a realistic reaction for the character?"
* "Summarize the current state of the world."
* "Can you rewrite my last message to sound more descriptive?"
* "Create a new lorebook entry for the sword I just found."

## Configuration and Settings

You can configure ST-Copilot by opening the SillyTavern Extensions Settings (the sliding panel on the left) and finding the ST-Copilot section.

### General
* Enable or disable the extension entirely.
* Change or disable the keyboard shortcut to toggle the window.
* **Persistent Floating Icon:** Keep the dock icon visible at all times, even when the main window is hidden.
* Clear all saved sessions to free up local storage space.

### Configuration Profiles
Save your current settings (context depth, system prompts, etc.) as a profile. You can bind specific profiles to automatically load when you chat with specific characters. A warning will appear if you attempt to switch profiles while having unsaved modifications.

### Connection
* **Use Currently Selected API:** The Copilot will use whatever API model you are currently using for your roleplay.
* **Use Specific Profile:** Force the Copilot to always use a specific SillyTavern connection profile (e.g., using a cheaper/faster model for meta-chat, and a complex model for roleplay).
* Adjust the maximum response tokens for the assistant.

### Lorebook Settings
* **Auto-Keyword Scanning:** Set the scanning depth for both the main ST chat and the Copilot history to trigger lore entries.
* **AI Management Prompt:** Customize the instructions the AI uses to propose lorebook changes. 
  * *Note: The default prompt has been significantly updated in v1.7.2. If you are using an old custom prompt, it is highly recommended to reset it to default to utilize new logic.*
* **Macro Support:** The AI Management Prompt now supports the `{{active_lorebooks}}` macro to provide the AI with a list of currently active lorebooks.

### Context Payload
Choose exactly what ST-Copilot is allowed to read:
* **Include ST System Prompt:** Sends the main SillyTavern system prompt.
* **Include Author's Note:** Sends the active Author's Note.
* **Include Character Card:** Sends the character's name, description, personality, and scenario.
* **Include User Persona:** Sends your active persona description.
* **Session History Depth:** The number of recent roleplay messages the Copilot will read to understand the immediate context.

### System Prompt
Define how the Copilot behaves. You can modify this to change its personality or strictness.

### Response Trimming
* **String Trimming:** Automatically remove specific strings or tags (like reasoning `<think>` blocks) from the assistant's responses to keep your chat clean.

### Interface Theme
Select from built-in themes to match your SillyTavern setup, or build your own custom theme by adjusting background colors, text colors, blur effects, and border radius.

## Advanced Features

* **Lorebook Manager:** Click the book icon in the toolbar to open a dedicated manager. 
  * **Expandable Entries:** Click on any entry to expand its description for easier reading.
  * **Individual Dropdowns:** Each entry now features its own Lorebook selection dropdown for precise organization.
  * **Status Tracking:** Search entries, manually force them into context, or review AI-proposed changes.
* **Context Inspector:** Click the "Context" button in the Copilot toolbar to see the exact text and JSON payload being sent to the AI. This is highly useful for debugging prompt sizes and token counts.
* **Macros:** The Copilot supports standard SillyTavern macros in your input, such as `{{user}}`, `{{char}}`, and `{{lastMessage}}`, as well as the specialized `{{active_lorebooks}}` in lore-related prompts.
* **Click-to-Type Depth:** In the Copilot window toolbar, you can click the number next to the "Ctx" slider to manually type an exact number of chat history messages you want the AI to read.