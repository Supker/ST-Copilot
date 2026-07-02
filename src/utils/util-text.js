import { _dbgAdd } from './util-debug.js';

export function _repairJSON(raw) {
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

export function _sanitizeProposedTags(value) {
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

export function normalizeCharNamesInBlock(text) {
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

export function applySearchReplaceToField(fieldContent, searchText, replaceText) {
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

        if (!queryTokens.length) {
            const litIdx = srcText.indexOf(queryText.trim());
            if (litIdx !== -1) return { start: litIdx, end: litIdx + queryText.trim().length, score: 1.0 };
            return null;
        }
        if (!srcTokens.length) return null;

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
            let startPos = srcTokens[bestStartIdx].start;
            let endPos = srcTokens[bestEndIdx].end;

            const qLower = queryText.toLowerCase();
            const lastQTok = queryTokens[queryTokens.length - 1];
            const lastTokIdx = qLower.lastIndexOf(lastQTok);
            if (lastTokIdx !== -1) {
                const trailMatch = queryText.slice(lastTokIdx + lastQTok.length).match(/^[^a-zA-Z0-9\u00C0-\u00FF]+/);
                if (trailMatch && srcText.slice(endPos, endPos + trailMatch[0].length) === trailMatch[0]) {
                    endPos += trailMatch[0].length;
                }
            }

            const firstQTok = queryTokens[0];
            const firstTokIdx = qLower.indexOf(firstQTok);
            if (firstTokIdx > 0) {
                const leadMatch = queryText.slice(0, firstTokIdx).match(/[^a-zA-Z0-9\u00C0-\u00FF]+$/);
                if (leadMatch && srcText.slice(startPos - leadMatch[0].length, startPos) === leadMatch[0]) {
                    startPos -= leadMatch[0].length;
                }
            }

            return { start: startPos, end: endPos, score: bestScore };
        }
        return null;
    }

    if (srch.trim()) {
        const exactIdx = src.indexOf(srch.trim());
        if (exactIdx !== -1) {
            return {
                result: src.slice(0, exactIdx) + repl + src.slice(exactIdx + srch.trim().length),
                matched: true
            };
        }
    }

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

export function _ensureWrapped(text, tag) {
    if (!text || !text.trim()) return '';
    let t = text.trim();
    const open = `<${tag}>`;
    const close = `</${tag}>`;
    
    t = t.replace(new RegExp(`^<${tag}>\\s*`, 'i'), '');
    t = t.replace(new RegExp(`\\s*</${tag}>$`, 'i'), '');
    
    return `${open}\n${t}\n${close}`;
}