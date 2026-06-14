import { escHtml } from './util-dom.js';

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

export function showColorPicker(anchorEl, initialVal, onChange) {
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