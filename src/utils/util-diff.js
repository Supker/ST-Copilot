import { escHtml } from './util-dom.js';
import { _dbgAdd } from './util-debug.js';

export function computeLCS(a, b) {
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

export function computeLineDiff(original, modified) {
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

export function highlightInlineDiff(oldLine, newLine) {
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

export function processDiffLinesForInline(diffLines) {
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

export function renderDiffUnified(diffLines) {
    if (!diffLines.length) return '<div style="padding:20px;color:var(--scp-text-muted);text-align:center">No changes to display</div>';
    const processed = processDiffLinesForInline(diffLines);
    return `<div class="scp-diff-unified">${processed.map(l => {
        const cls = l.type === 'added' ? 'scp-diff-add' : l.type === 'removed' ? 'scp-diff-rem' : 'scp-diff-ctx';
        const pfx = l.type === 'added' ? '+' : l.type === 'removed' ? '-' : ' ';
        return `<div class="${cls}"><span class="scp-diff-pfx">${pfx}</span>${l.html}</div>`;
    }).join('')}</div>`;
}

export function renderDiffSplit(original, modified) {
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

export function openTextDiffModal(title, originalText, newText) {
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
    import('../ui/ui-window.js').then(m => m.bringWindowToFront());
}