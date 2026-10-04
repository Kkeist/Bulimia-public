/**
 * 酒馆「半支持」层 —— 世界书(World Info) + Author's Note + 深度注入。
 * 移植自 260421-claudeRP 的 tavern-prompt.js（scanKeywords / scanWithRecursion / at_depth 注入）。
 *
 * 定位：项目主体仍是「模组系统」（程序卡信息流通）。这是附加的酒馆兼容层，
 * 在模组层之外、发送前对消息序列做世界书/作者注释注入；模组为主、酒馆为辅。
 *
 * 数据存在 State.tavern：
 *   { enabled:bool, worldbook:{ scanDepth, recursive, entries:[Entry] },
 *     authorsNote:string, authorsNoteDepth:number }
 *   Entry: { comment, keys:[], content, enabled, constant, probability,
 *            case_sensitive, selective, secondary_keys:[], insertion_order, position }
 *   position: before_char | after_char | as_system | as_user | as_assistant | at_depth_<N>
 */
const TavernLayer = {
    /** 世界书与作者注释存在浏览器本地，不随存档走 */
    STORAGE_KEY: 'bulimia_tavern',

    _default() {
        return { enabled: false, worldbook: { scanDepth: 10, recursive: true, entries: [] }, authorsNote: '', authorsNoteDepth: 4 };
    },

    _store() {
        const s = (typeof State !== 'undefined' && State) ? State : {};
        if (!s.tavern) {
            const saved = (typeof Storage !== 'undefined' && Storage.getLocal) ? Storage.getLocal(this.STORAGE_KEY) : null;
            s.tavern = saved && typeof saved === 'object' ? saved : this._default();
        }
        if (!s.tavern.worldbook) s.tavern.worldbook = { scanDepth: 10, recursive: true, entries: [] };
        if (!Array.isArray(s.tavern.worldbook.entries)) s.tavern.worldbook.entries = [];
        return s.tavern;
    },

    /** 把当前的世界书与作者注释存进浏览器；存不下时存储层会提示，返回 false */
    save() {
        return Storage.setLocal(this.STORAGE_KEY, this._store());
    },

    /**
     * 条目的「概率」判定用的 0-99 数：由条目内容和已有的 AI 回复条数算出，同一时刻结果固定，
     * 这样提示词预览和真正发送得到同样的结果。
     */
    _rollPercent(entry) {
        const turn = (typeof State !== 'undefined' && State.chatHistory) ? State.chatHistory.filter(m => m && m.role === 'assistant').length : 0;
        const s = String(entry.comment || '') + '|' + String(entry.content || '') + '|' + turn;
        let h = 2166136261;
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
        return (h >>> 0) % 100;
    },

    /** 关键词扫描（忠抄）：constant=常驻；否则关键词命中（支持 /regex/）；selective 走二级关键词 */
    scanKeywords(text, entry) {
        const prob = entry.probability == null ? 100 : entry.probability;
        if (prob < 100 && this._rollPercent(entry) >= prob) return false;
        if (entry.constant) return true;
        const t = entry.case_sensitive ? text : String(text || '').toLowerCase();
        const matchKey = (keys) => (keys || []).some(k => {
            const key = entry.case_sensitive ? String(k).trim() : String(k).trim().toLowerCase();
            if (!key) return false;
            if (key.startsWith('/') && key.endsWith('/')) {
                try { return new RegExp(key.slice(1, -1), entry.case_sensitive ? '' : 'i').test(text); } catch (e) { return false; }
            }
            return t.indexOf(key) >= 0;
        });
        if (!matchKey(entry.keys)) return false;
        if (entry.selective && entry.secondary_keys && entry.secondary_keys.length > 0) return matchKey(entry.secondary_keys);
        return true;
    },

    /** 递归扫描（忠抄）：命中条目内容并入扫描文本，最多 maxDepth 轮 */
    scanWithRecursion(text, allEntries, maxDepth) {
        maxDepth = maxDepth || 3;
        const matched = new Set();
        let scanText = text;
        for (let d = 0; d < maxDepth; d++) {
            let found = false;
            for (const e of allEntries) {
                if (matched.has(e) || !e.enabled) continue;
                if (this.scanKeywords(scanText, e)) { matched.add(e); scanText += '\n' + (e.content || ''); found = true; }
            }
            if (!found) break;
        }
        return [...matched];
    },

    /**
     * 在「已组装好的消息数组」上应用酒馆层（模组层之外、发送前调用）。
     * @param messages 现有消息数组 [{role,content}]（会就地不改，返回新数组）
     * @param scanText 用于关键词扫描的近期文本（一般是最近若干条聊天 + 本次用户输入）
     * @returns 注入世界书/作者注释后的新消息数组（模组内容原样保留在前，酒馆为辅）
     */
    apply(messages, scanText) {
        const tv = this._store();
        if (!tv.enabled) return messages.slice();
        const wb = tv.worldbook || {};
        const all = (wb.entries || []).filter(e => e && e.enabled);
        if (!all.length && !tv.authorsNote) return messages.slice();
        const matched = this.scanWithRecursion(String(scanText || ''), all, wb.recursive === false ? 1 : 3);
        const buckets = {};
        for (const e of matched) {
            const pos = e.position || 'before_char';
            (buckets[pos] = buckets[pos] || []).push(e);
        }
        for (const k of Object.keys(buckets)) buckets[k].sort((a, b) => (a.insertion_order || 100) - (b.insertion_order || 100));
        const txt = (pos) => (buckets[pos] || []).map(e => e.content || '').filter(Boolean).join('\n\n');

        const out = [];
        // before_char：世界书前置（放在模组内容之前，作为补充背景；模组仍是主体）
        if (buckets.before_char) out.push({ role: 'system', content: txt('before_char'), identifier: 'tavern-wb-before', injected: true });
        // 原消息（模组层 + 聊天）原样
        for (const m of messages) out.push(m);
        // after_char：世界书后置
        if (buckets.after_char) out.push({ role: 'system', content: txt('after_char'), identifier: 'tavern-wb-after', injected: true });
        // as_system/as_user/as_assistant：按角色追加
        ['as_system', 'as_user', 'as_assistant'].forEach(p => {
            if (buckets[p]) out.push({ role: p.replace('as_', ''), content: txt(p), identifier: 'tavern-wb-' + p, injected: true });
        });
        // at_depth_N：从底部往上数 N 条位置插入（忠抄）
        const depthEntries = [];
        for (const key of Object.keys(buckets)) {
            const dm = key.match(/^at_depth_(\d+)$/);
            if (dm) depthEntries.push({ depth: parseInt(dm[1], 10), content: txt(key) });
        }
        depthEntries.sort((a, b) => a.depth - b.depth);
        for (const de of depthEntries) {
            const idx = Math.max(0, out.length - de.depth);
            out.splice(idx, 0, { role: 'system', content: de.content, identifier: 'tavern-wb-depth' + de.depth, injected: true });
        }
        // Author's Note：用户级，按深度从底部往上插（忠抄）
        if (tv.authorsNote && String(tv.authorsNote).trim()) {
            const anDepth = tv.authorsNoteDepth == null ? 4 : tv.authorsNoteDepth;
            const anIdx = Math.max(0, out.length - anDepth);
            out.splice(anIdx, 0, { role: 'system', content: String(tv.authorsNote), identifier: 'tavern-authors-note', injected: true });
        }
        return out;
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = TavernLayer;
} else if (typeof window !== 'undefined') {
    window.TavernLayer = TavernLayer;
}
