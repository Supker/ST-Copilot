import { _fileToDataUrl } from '../utils/util-dom.js';
import { _dbgAdd } from '../utils/util-debug.js';

export async function _getCaptionViaExtension(file) {
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