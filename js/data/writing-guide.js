/**
 * 写作指导数据与注入逻辑（非预设，独立于 PresetManager）
 * - 内置条目内容不在代码里：来自 data/builtin-presets/writing-guide.json（条目）与 writing-guide-core.json（顺序、分组、固定段落）；
 *   这两个文件不存在时就是「没有内置写作指导」，只剩下回复格式与摘要格式两条解析所需的协议段。
 * - 用户可在调试区编辑、添加、导入，存于 settings.writingGuideEntries
 * - 与输出预设可同时注入，写作指导优先
 */

/** 两段协议的各语言文字（用 id 取，便于比对存档里存下的旧默认文字） */
const WG_PROTOCOL_TEXT = {
    'wg-reply-format-blocks': {
        zh: `# 回复格式
- **正文**：必须用 \`<content>\` 和 \`</content>\` 完整包裹；系统仅展示此块作为主内容。正文以外内容不得放入此块。
- **本轮摘要**（必填）：见「本轮摘要格式」；须包含 \`<turn_summary>\` 和 \`</turn_summary>\`。
- **系统指令**：内联标签 \`<类型|参数|参数|...>\`，一条一行，写在正文之后；可用的指令以本回合「指令」段为准，名字要照抄上方段落里的。`,
        en: `# Reply format
- **Body**: must be fully wrapped in \`<content>\` and \`</content>\`; the system shows only this block as the main content. Nothing other than the body may go inside this block.
- **Turn summary** (required): see "Turn summary format"; it must include \`<turn_summary>\` and \`</turn_summary>\`.
- **System commands**: inline tags \`<type|param|param|...>\`, one per line, written after the body; the available commands are those in this turn's "commands" section, and names must be copied exactly from the sections above.
- **Language**: write the body and the summary in English.`
    },
    'wg-turn-summary-format': {
        zh: `# 本轮摘要格式（<turn_summary> 内必填）
每轮回复须包含 \`<turn_summary>\` 和 \`</turn_summary>\`，内**只需填写以下两行**（与主线剧情强相关，非一两句话概括）：

scene: 当前场景，写简要地点或情境
plot: 总结本次正文剧情。需保留关键信息、记录名词和新出现信息，去除冗余内容，避免升华和评价，**使用流水账形式**

**说明**：serial（序号）与 time（日期时间）由系统根据变量自动填入，你无需填写。以上两行与正文物理隔离，写在 \`<turn_summary>\` 与 \`</turn_summary>\` 之间。摘要用于历史上下文压缩：非最近几条消息只发摘要不发全文。`,
        en: `# Turn summary format (required inside <turn_summary>)
Every reply must include \`<turn_summary>\` and \`</turn_summary>\`, containing **only the following two lines** (closely tied to the main storyline, not a one- or two-sentence overview):

scene: the current scene; a brief location or situation
plot: summarize the plot of this turn's body. Keep key information, record nouns and newly introduced information, remove redundancy, avoid sublimation and commentary, and **write it as a running log**

**Note**: serial (sequence number) and time (date/time) are filled in automatically by the system from variables; you do not need to write them. The two lines above are physically separated from the body and go between \`<turn_summary>\` and \`</turn_summary>\`. The summary is used to compress history context: messages other than the most recent few are sent as summaries only, not in full.`
    }
};

const WritingGuide = {
    _defaultCache: null,

    /** 内置写作指导数据是否存在 */
    hasBuiltin: false,

    /** 内置数据读取失败时的原因（读不到文件不算失败：那是没有内置数据） */
    loadError: '',

    /** 回复解析器依赖的两段协议：与写作风格无关，没有内置数据时也始终存在；内置数据里有同名条目时以内置数据为准 */
    PROTOCOL_ORDER: ['wg-reply-format-blocks', 'wg-turn-summary-format'],
    PROTOCOL: {
        'wg-reply-format-blocks': {
            name: I18n.t('回复格式与可解析块'),
            content: I18n.pick(WG_PROTOCOL_TEXT['wg-reply-format-blocks'])
        },
        'wg-turn-summary-format': {
            name: I18n.t('本轮摘要格式'),
            content: I18n.pick(WG_PROTOCOL_TEXT['wg-turn-summary-format'])
        }
    },

    /** 以下四项由内置数据文件填充；没有内置数据时为空 */
    BLOCK_AND_TITLE: {},
    ORDER_FULL: [],
    POV_CONTENT: {},
    /** 破限与 NSFW 一键开关：为 true 时启用 BREAK_NSFW_IDS 里的条目 */
    BREAK_NSFW_SETTING_KEY: 'writingGuideBreakNsfw',
    BREAK_NSFW_IDS: [],

    /** 默认注入深度与顺序 */
    DEFAULT_DEPTH: 4,
    DEFAULT_ORDER: 100,

    isProtocolEntry(identifier) {
        return this.PROTOCOL_ORDER.includes(identifier);
    },

    /** 取 JSON：文件不存在返回 null，其余失败（网络、内容损坏）抛出 */
    /** 非中文界面优先读同名的 <名>.<语言>.json（如 writing-guide.en.json），没有就用默认文件 */
    async _fetchLocalized(url) {
        if (I18n.lang !== I18n.SOURCE) {
            try {
                const localized = await this._fetchOptional(url.replace(/\.json$/, '.' + I18n.lang + '.json'));
                if (localized) return localized;
            } catch (e) { console.warn('WritingGuide._fetchLocalized:', e); }
        }
        return this._fetchOptional(url);
    },

    async _fetchOptional(url) {
        const res = await fetch(url);
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(I18n.t('{url} 返回 {status}', { url, status: res.status }));
        return res.json();
    },

    _normalize(e) {
        return {
            identifier: e.identifier,
            name: e.name || e.identifier,
            content: e.content || '',
            enabled: e.enabled !== false,
            injection_depth: e.injection_depth ?? e.injectionDepth ?? this.DEFAULT_DEPTH,
            injection_order: e.injection_order ?? e.injectionOrder ?? this.DEFAULT_ORDER,
            role: e.role || 'system'
        };
    },

    /** 由内置数据拼出默认条目列表：先按固定顺序，数据里多出来的接在后面，协议段补在最后 */
    _buildDefault(guide, core) {
        const blockAndTitle = (core && core.blockAndTitle) || {};
        const order = (core && Array.isArray(core.order)) ? core.order : [];
        const byId = new Map();
        const listed = [];
        for (const p of (guide && Array.isArray(guide.prompts)) ? guide.prompts : []) {
            const wrap = blockAndTitle[p.identifier];
            let content = (p.content || '').trim();
            if (wrap && content) content = `<${wrap.block}>\n## ${wrap.title}\n${content}\n</${wrap.block}>`;
            byId.set(p.identifier, this._normalize({ ...p, content }));
            listed.push(p.identifier);
        }
        for (const e of (core && Array.isArray(core.entries)) ? core.entries : []) byId.set(e.identifier, this._normalize(e));
        for (const id of this.PROTOCOL_ORDER) {
            if (!byId.has(id)) byId.set(id, this._normalize({ identifier: id, ...this.PROTOCOL[id] }));
        }
        const ids = [...order];
        if (!core) for (const id of listed) if (!ids.includes(id)) ids.push(id);
        for (const id of this.PROTOCOL_ORDER) if (!ids.includes(id)) ids.push(id);
        return ids.map(id => byId.get(id)).filter(Boolean);
    },

    /**
     * 加载默认写作指导条目。内置数据文件不存在是正常状态（没有内置写作指导）；
     * 文件存在但读不出来时明确提示，并且不缓存，下次进入写作指导页再试。
     */
    async loadDefault() {
        if (this._defaultCache) return;
        let guide = null;
        let core = null;
        try {
            guide = await this._fetchLocalized('data/builtin-presets/writing-guide.json');
            core = await this._fetchLocalized('data/builtin-presets/writing-guide-core.json');
        } catch (e) {
            this.loadError = e && e.message ? e.message : String(e);
            console.error('WritingGuide.loadDefault:', e);
            if (typeof Toast !== 'undefined') Toast.show(I18n.t('内置写作指导读取失败，请刷新页面重试。'), 'error');
            return;
        }
        this.loadError = '';
        this.hasBuiltin = !!(guide || core);
        this.BLOCK_AND_TITLE = (core && core.blockAndTitle) || {};
        this.ORDER_FULL = (core && Array.isArray(core.order)) ? core.order : [];
        this.POV_CONTENT = (core && core.pov) || {};
        this.BREAK_NSFW_IDS = (core && Array.isArray(core.breakNsfwIds)) ? core.breakNsfwIds : [];
        this._defaultCache = this._buildDefault(guide, core);
    },

    /** 新建条目用的编号：由程序分配，用户只填名称和内容 */
    newIdentifier() {
        return 'wg-user-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    },

    /**
     * 解析导入的文件。JSON 文件取其中的 prompts 数组（或条目数组）；其他文本文件整个作为一条，名称取文件名。
     * @returns {Array<{identifier,name,content,enabled}>}
     */
    parseImport(text, fileName) {
        const base = String(fileName || '').replace(/\.[^.]*$/, '') || I18n.t('导入的条目');
        if (/\.json$/i.test(String(fileName || ''))) {
            let data;
            try { data = JSON.parse(text); } catch { throw new Error(I18n.t('文件格式不正确，无法导入。')); }
            const list = Array.isArray(data) ? data : (data && Array.isArray(data.prompts) ? data.prompts : null);
            if (!list) throw new Error(I18n.t('文件里没有找到写作指导条目。'));
            const out = list.filter(p => p && typeof p === 'object' && String(p.content || '').trim())
                .map(p => ({ identifier: this.newIdentifier(), name: String(p.name || p.identifier || base), content: String(p.content).trim(), enabled: p.enabled !== false }));
            if (!out.length) throw new Error(I18n.t('文件里没有找到写作指导条目。'));
            return out;
        }
        const content = String(text || '').trim();
        if (!content) throw new Error(I18n.t('文件是空的，无法导入。'));
        return [{ identifier: this.newIdentifier(), name: base, content, enabled: true }];
    },

    /**
     * 获取当前写作指导条目（自定义优先，否则默认）
     * 协议段与破限 / NSFW 条目始终返回；破限 / NSFW 条目的 enabled 由一键开关决定。
     * 自定义列表里默认条目按默认顺序排，用户自己添加的条目接在固定的结束段之前。
     */
    getEntries() {
        const settings = typeof Storage !== 'undefined' && Storage.getSettings ? Storage.getSettings() : {};
        const custom = settings.writingGuideEntries;
        const defaultList = this._defaultCache || this._buildDefault(null, null);
        const breakNsfw = settings[this.BREAK_NSFW_SETTING_KEY] === true;
        let raw;
        if (Array.isArray(custom) && custom.length > 0) {
            const byId = new Map(custom.map(e => [e.identifier, e]));
            for (const e of defaultList) {
                if ((this.BREAK_NSFW_IDS.includes(e.identifier) || this.isProtocolEntry(e.identifier)) && !byId.has(e.identifier)) byId.set(e.identifier, e);
            }
            const known = defaultList.map(e => e.identifier);
            raw = known.map(id => byId.get(id)).filter(Boolean);
            const own = custom.filter(e => !known.includes(e.identifier));
            const at = raw.findIndex(e => e.identifier === 'wg-wrap-end');
            raw.splice(at < 0 ? raw.length : at, 0, ...own);
        } else {
            raw = defaultList;
        }
        // 回复格式说明要和解析器一致，不随存档里旧的自定义内容走
        const protocolDefault = new Map(defaultList.filter(e => this.isProtocolEntry(e.identifier)).map(e => [e.identifier, e]));
        // 协议段若还是中文默认文字（切换界面语言前存下的），跟随当前语言的默认
        const staleProtocol = (e) => {
            const d = protocolDefault.get(e.identifier);
            const src = WG_PROTOCOL_TEXT[e.identifier];
            if (!d || !src || I18n.lang === I18n.SOURCE) return {};
            return String(e.content || '').trim() === src[I18n.SOURCE].trim() ? { content: d.content } : {};
        };
        const withMeta = raw.map(e => ({
            ...e,
            ...(e.identifier === 'wg-reply-format-blocks' && protocolDefault.has(e.identifier) ? { content: protocolDefault.get(e.identifier).content } : {}),
            ...staleProtocol(e),
            role: e.role || 'system',
            injection_depth: e.injection_depth ?? e.injectionDepth ?? this.DEFAULT_DEPTH,
            injection_order: e.injection_order ?? e.injectionOrder ?? this.DEFAULT_ORDER
        }));
        withMeta.forEach(e => {
            if (this.BREAK_NSFW_IDS.includes(e.identifier)) e.enabled = breakNsfw;
        });
        return withMeta;
    },

    /**
     * 保存用户自定义写作指导条目
     */
    saveEntries(entries) {
        if (typeof Storage === 'undefined' || !Storage.saveSettings) return;
        const settings = Storage.getSettings() || {};
        settings.writingGuideEntries = Array.isArray(entries) ? entries : null;
        Storage.saveSettings(settings);
    },

    /**
     * 恢复为默认条目（清除自定义）
     */
    resetToDefault() {
        this.saveEntries(null);
    }
};
if (typeof window !== 'undefined') window.WritingGuide = WritingGuide;
