import { getEffectiveSettings } from '../session.js';

let _regexModule = false;

export async function loadRegexModule() {
    if (_regexModule !== false) return _regexModule;
    try {
        _regexModule = await import('/scripts/extensions/regex/engine.js');
    } catch (e) {
        _regexModule = null;
    }
    return _regexModule;
}

export async function applyRegexIfEnabled(text, isUser, depth) {
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