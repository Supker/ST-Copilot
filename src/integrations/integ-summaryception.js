export function _getSummaryceptionSummary() {
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