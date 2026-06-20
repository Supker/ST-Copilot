import { EXT_DISPLAY } from '../constants.js';

export function escHtml(str) {
    return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;width:1px;height:1px;';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    try { document.execCommand('copy'); toastr.success('Copied', EXT_DISPLAY); }
    catch (e) { toastr.error('Copy failed', EXT_DISPLAY); }
    ta.remove();
}

export function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text)
            .then(() => toastr.success('Copied', EXT_DISPLAY))
            .catch(() => fallbackCopy(text));
    } else { fallbackCopy(text); }
}

export function autoResize(el) { 
    el.style.height = 'auto'; 
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`; 
}

export function showCustomDialog({ type = 'alert', title = '', message = '', htmlMessage = '', defaultValue = '', placeholder = '', delayConfirm = 0 }) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'scp-dialog-overlay';
        overlay.style.zIndex = '2147483050';
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

export async function _fileToDataUrl(file) {
    return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = () => {
            rej(new Error('Read failed'));
        };
        r.readAsDataURL(file);
    });
}