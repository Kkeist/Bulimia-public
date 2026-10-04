/**
 * 补丁区：模组自带补丁 + 自由导入补丁
 * - 模组自带：从当前模组 module/<id>/patches/ 按 module.json 的 patches 数组加载
 * - 自由导入：设置中的 patchGroups，每组可来自导入的世界书或手动新建，可编辑/新建/删除
 * - 注入到 prompt 时作为 system 消息；提示词查看器用「下一条 prompt」预览
 */

const Patches = {
    /** 模组补丁缓存：key = moduleId + ':' + filename，value = { id, name, content } */
    _moduleCache: new Map(),
    /** 当前模组已加载的补丁列表（供同步 getEnabledPatchMessagesSync 使用） */
    _currentModulePatches: [],

    setCurrentModulePatches(list) {
        this._currentModulePatches = Array.isArray(list) ? list : [];
    },
    getCurrentModulePatches() {
        return this._currentModulePatches || [];
    },

    /**
     * 获取当前模组的补丁列表（从 module.json 的 patches 数组）
     * @param {Object} module - ModuleManager.getCurrent() 的模块对象，需含 id、patches（可选数组）
     * @returns {Promise<Array<{id:string,name:string,content:string}>>}
     */
    async getModulePatches(module) {
        if (!module || !module.id) return [];
        const list = module.patches || [];
        if (!Array.isArray(list) || list.length === 0) return [];
        const folder = module.folderKey || String(module.id).replace(/^story_/, '') || module.id;
        const base = `module/${folder}/patches/`;
        const out = [];
        for (const filename of list) {
            const key = `${module.id}:${filename}`;
            if (this._moduleCache.has(key)) {
                const c = this._moduleCache.get(key);
                if (c) out.push(c);
                continue;
            }
            try {
                const res = await fetch(base + filename);
                if (!res.ok) continue;
                const data = await res.json();
                const id = data.id || filename.replace(/\.json$/i, '');
                const name = data.name || id;
                const content = (data.content || '').trim();
                const item = { id, name, content };
                this._moduleCache.set(key, item);
                out.push(item);
            } catch (e) {
                console.warn('Patches.getModulePatches:', base + filename, e);
            }
        }
        return out;
    },

    /**
     * 获取自由导入的补丁组列表（来自设置）
     * @param {Object} settings - Storage.getSettings()
     * @returns {Array<{id:string,name:string,source:string,entries:Array<{id,name,content,enabled}>}>}
     */
    getImportedGroups(settings = {}) {
        return Array.isArray(settings.patchGroups) ? settings.patchGroups : [];
    },

    /** 默认插入深度（与 _buildMessages 的 DEPTH_CONTEXT 一致，越大越靠前） */
    DEFAULT_DEPTH: 4,
    /** 默认插入顺序（数值越大在同深度内越靠前） */
    DEFAULT_ORDER: 100,

    /**
     * 将关键词字符串拆成数组（英文逗号分隔，trim，去空）
     * @param {string|string[]} keywords - 逗号分隔字符串或数组
     * @returns {string[]}
     */
    _parseKeywords(keywords) {
        if (Array.isArray(keywords)) return keywords.map(k => String(k).trim()).filter(Boolean);
        const s = String(keywords || '').trim();
        if (!s) return [];
        return s.split(/,\s*/).map(k => k.trim()).filter(Boolean);
    },

    /**
     * 同步获取当前应注入的补丁消息：模组自带 + 自由导入（按需条目依赖 contextString 关键词匹配）
     * 每条带 injection_depth、injection_order，与写作指导一起按深度/顺序注入。
     * @param {Object} settings - Storage.getSettings()
     * @param {Array<{id,name,content}>} [modulePatches] - 已加载的模组补丁，不传则用 getCurrentModulePatches()
     * @param {string} [contextString] - 最近对话+总结拼接文本；按需条目仅当此处包含任一关键词时注入
     * @returns {Array<{role,content,identifier,injection_depth,injection_order}>}
     */
    getEnabledPatchMessagesSync(settings = {}, modulePatches, contextString = '') {
        const list = modulePatches != null ? modulePatches : this.getCurrentModulePatches();
        const moduleEnabled = settings.patchModuleEnabled || {};
        const groups = this.getImportedGroups(settings);
        const messages = [];
        const D = this.DEFAULT_DEPTH;
        const O = this.DEFAULT_ORDER;
        const ctx = String(contextString || '');

        for (const p of list) {
            if (!moduleEnabled[p.id]) continue;
            if (!(p.content && String(p.content).trim())) continue;
            messages.push({
                role: 'system',
                content: `<补丁·模组·${p.name}>\n${p.content}\n</补丁·模组·${p.name}>`,
                identifier: `patch-module-${p.id}`,
                label: p.name,
                injection_depth: p.injection_depth ?? D,
                injection_order: p.injection_order ?? O
            });
        }

        for (const g of groups) {
            if (g.groupEnabled === false) continue;
            const entries = Array.isArray(g.entries) ? g.entries : [];
            for (const e of entries) {
                if (!e.enabled || !(e.content && String(e.content).trim())) continue;
                if (e.constant === false) {
                    const kw = this._parseKeywords(e.keywords);
                    if (kw.length > 0 && ctx) {
                        const lower = ctx.toLowerCase();
                        const match = kw.some(k => lower.includes(k.toLowerCase()));
                        if (!match) continue;
                    }
                }
                const name = e.name || e.comment || e.id || '条目';
                messages.push({
                    role: 'system',
                    content: `<补丁·${g.name || g.id}·${name}>\n${String(e.content).trim()}\n</补丁·${g.name || g.id}·${name}>`,
                    identifier: `patch-imported-${g.id}-${e.id}`,
                    label: (g.name || g.id) + '·' + name,
                    injection_depth: e.injection_depth ?? D,
                    injection_order: e.injection_order ?? O
                });
            }
        }

        return messages;
    }
};
