import { getSettings, saveSettings } from '../session.js';
import { state } from '../state.js';
import { THEME_CSS_MAP, THEME_PRESETS, ICON_STORAGE_KEY, WIN_ID, EXT_DISPLAY } from '../constants.js';
import { scrollToBottom, saveScrollPosition, restoreScrollPosition } from './ui-chat.js';

const SCP_TOP_Z_INDEX = 2147483000;
const WIN_POS_STORAGE_KEY = 'scp-win-pos';

export function bringWindowToFront() {
    const targets = Array.from(document.body.children).filter(el =>
        el.id?.startsWith('scp-') || el.classList?.contains('scp-dialog-overlay')
    );
    
    const getLayer = (el) => {
        if (el.classList?.contains('scp-dialog-overlay')) return 50;
        if (el.id?.endsWith('-modal')) return 40;
        if (el.id?.endsWith('-overlay')) return 30;
        if (el.id === 'scp-dock-icon') return 20;
        return 10;
    };

    for (const el of targets) {
        el.style.zIndex = String(SCP_TOP_Z_INDEX + getLayer(el));
    }
}

export function makeDraggable(handle, target) {
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
            
            saveWindowState(target);
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
        if (!isWobbly) saveWindowState(target);
    };

    handle.addEventListener('pointerup', onEnd);
    handle.addEventListener('pointercancel', onEnd);
    handle.style.touchAction = 'none';
}

export function makeResizable(target) {
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
            saveWindowState(target);
        });

        h.addEventListener('pointercancel', () => {
            active = false;
            if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
            target.classList.remove('scp-resizing');
        });

        h.style.touchAction = 'none';
    });
}

export function makeIconDraggable(iconTarget) {
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

export function saveWindowState(windowEl) {
    if (!windowEl) return;
    const r = windowEl.getBoundingClientRect();
    try { 
        localStorage.setItem(WIN_POS_STORAGE_KEY, JSON.stringify({ 
            x: r.left, y: r.top, w: r.width, h: r.height 
        })); 
    } catch(_) {}
}

export function applyCustomTheme(theme) {
    if (!theme) return;
    
    // Lazy get elements just to be safe
    const windowEl = document.getElementById(WIN_ID);
    const iconEl = document.getElementById('scp-dock-icon');
    const targets = [
        windowEl, 
        iconEl, 
        document.getElementById('scp-lb-overlay'), 
        document.getElementById('scp-char-overlay'),
        document.getElementById('scp-diff-modal'), 
        document.getElementById('scp-settings-overlay'), 
        document.getElementById('scp-picker-overlay')
    ].filter(Boolean);
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

export function applyWindowBackground() {
    const windowEl = document.getElementById(WIN_ID);
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

export function restoreWindowState(windowEl, iconEl) {
    const s = getSettings(); if (!windowEl) return;
    const isMobile = window.innerWidth <= 900 || ('ontouchstart' in window && window.innerWidth <= 1366);

    let w = 440;
    let h = 600;
    let posRestored = false;

    try {
        const saved = localStorage.getItem(WIN_POS_STORAGE_KEY);
        if (saved) {
            const { x, y, w: savedW, h: savedH } = JSON.parse(saved);
            if (savedW) w = savedW;
            if (savedH) h = savedH;

            if (x != null && y != null) {
                const maxLeft = Math.max(0, window.innerWidth - (isMobile ? window.innerWidth * 0.94 : w));
                windowEl.style.left = `${Math.max(0, Math.min(x, maxLeft))}px`;
                windowEl.style.top = `${Math.max(0, Math.min(y, window.innerHeight - 100))}px`;
                windowEl.style.right = 'auto';
                posRestored = true;
            }
        }
    } catch(_) {}

    if (!posRestored) {
        if (s.windowW) w = s.windowW;
        if (s.windowH) h = s.windowH;

        if (s.windowX !== null && s.windowX !== undefined) {
            const maxLeft = Math.max(0, window.innerWidth - (isMobile ? window.innerWidth * 0.94 : w));
            windowEl.style.left = `${Math.max(0, Math.min(s.windowX, maxLeft))}px`;
            windowEl.style.top = `${Math.max(0, Math.min(s.windowY ?? 80, window.innerHeight - 100))}px`;
            windowEl.style.right = 'auto';
            try { localStorage.setItem(WIN_POS_STORAGE_KEY, JSON.stringify({ x: s.windowX, y: s.windowY, w, h })); } catch(_) {}
        } else if (isMobile) {
            windowEl.style.left = '3vw';
            windowEl.style.top = '8vh';
            windowEl.style.right = 'auto';
        }
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

export function updateIconVisibility(iconEl) {
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

export function setGhostMode(enabled) {
    const windowEl = document.getElementById(WIN_ID);
    state.ghostModeActive = enabled;
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

export function toggleGhostMode() {
    const windowEl = document.getElementById(WIN_ID);
    if (!windowEl || windowEl.style.display === 'none') return;
    setGhostMode(!state.ghostModeActive);
}

let _hotkeyHandler = null;
export function setupHotkey() {
    if (_hotkeyHandler) document.removeEventListener('keydown', _hotkeyHandler);
    _hotkeyHandler = null;
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
        if (active && active !== document.getElementById('scp-input') && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) return;
        e.preventDefault(); toggleVisibility();
    };
    document.addEventListener('keydown', _hotkeyHandler);
}

let _ghostHotkeyHandler = null;
export function setupGhostHotkey() {
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

export function minimize() { 
    saveScrollPosition();
    const windowEl = document.getElementById(WIN_ID);
    const iconEl = document.getElementById('scp-dock-icon');
    setGhostMode(false); 
    const s = getSettings(); 
    s.minimized = true; 
    if(windowEl) windowEl.style.display = 'none'; 
    state.copilotActive = false;
    saveSettings(); 
    updateIconVisibility(iconEl);
}

export function restoreFromMinimize() { 
    const windowEl = document.getElementById(WIN_ID);
    const iconEl = document.getElementById('scp-dock-icon');
    const s = getSettings(); 
    s.minimized = false; 
    if(windowEl) windowEl.style.display = 'flex'; 
    state.copilotActive = true;
    saveSettings(); 
    updateIconVisibility(iconEl);
    restoreScrollPosition(); 
    bringWindowToFront();
}

export function hideWindow() { 
    saveScrollPosition();
    const windowEl = document.getElementById(WIN_ID);
    const iconEl = document.getElementById('scp-dock-icon');
    setGhostMode(false); 
    const s = getSettings(); 
    s.windowVisible = false; 
    s.minimized = false; 
    if(windowEl) windowEl.style.display = 'none'; 
    state.copilotActive = false;
    saveSettings(); 
    updateIconVisibility(iconEl);
}

export function showWindow() {
    const windowEl = document.getElementById(WIN_ID);
    const iconEl = document.getElementById('scp-dock-icon');
    const s = getSettings(); 
    if (!s.enabled) { toastr.warning('ST-Copilot is disabled.', EXT_DISPLAY); return; }
    s.windowVisible = true; 
    s.minimized = false;
    if(windowEl) windowEl.style.display = 'flex';
    state.copilotActive = true;
    saveSettings(); 
    updateIconVisibility(iconEl);
    restoreScrollPosition();
    bringWindowToFront();
}

export function toggleVisibility() {
    const s = getSettings();
    if (!s.windowVisible || s.minimized) { showWindow(); return; }
    if (s.floatingIconPersistent) { hideWindow(); } else { minimize(); }
}

export async function _uploadBgToST(file) {
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

export function _setupBgUpload(btnId, inputId, onUploadSuccess) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener('click', () => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'image/*,video/mp4,video/webm';
        inp.onchange = async () => {
            const file = inp.files[0];
            if (!file) return;
            if (file.size > 25 * 1024 * 1024) { toastr.warning('File is too large (>25MB). Use URL instead.', 'ST-Copilot'); return; }
            const url = await _uploadBgToST(file).catch(() => null);
            if (url) {
                getSettings().windowBgUrl = url;
                saveSettings();
                const urlInput = document.getElementById(inputId);
                if (urlInput) urlInput.value = url;
                applyWindowBackground();
                if (onUploadSuccess) onUploadSuccess();
            } else {
                toastr.error('Failed to upload background.', 'ST-Copilot');
            }
        };
        inp.click();
    });
}