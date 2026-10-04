/**
 * 模块管理器（通用系统）
 * 约定：一个故事一个文件夹。module/list.json 列出故事文件夹名；每个故事从 module/<故事id>/module.json 加载。
 * 不包含任何游戏内容，仅做格式规范与加载。
 */

const MODULE_FOLDER = 'module';

const ModuleManager = {
    // 所有模块
    modules: [],

    // 当前模块
    currentModule: null,

    // 自导入模组写入 IndexedDB 的排队链；_ownSaved 表示库里是否有内容
    _ownWrite: Promise.resolve(),
    _ownSaved: false,

    /**
     * 初始化：先读玩家自己导入的模组，再按 list.json 从每个故事文件夹加载 module.json
     */
    async init() {
        await this.loadModules();
        await this.loadFromModuleFolder();
        if (!this.currentModule) {
            const currentId = Storage.getSettings().currentModule;
            if (currentId) this.currentModule = this.modules.find(m => m.id === currentId) || null;
        }
        let didLoad = false;
        if (!this.currentModule && this.modules.length > 0) {
            this.load(this.modules[0].id);
            didLoad = true;
        }
        if (this.currentModule && !didLoad && typeof Events !== 'undefined' && typeof EVENT_TYPES !== 'undefined') {
            Events.emit(EVENT_TYPES.MODULE_LOADED, { module: this.currentModule });
        }
        this._saveModules();
    },

    /**
     * 读出玩家自己导入的模组（IndexedDB）。模组文件夹里的模组每次启动都从文件重新读取，不在这里。
     * 旧版本把所有模组整份存在浏览器设置里（几 MB，每次读写设置都要整份解析）：
     * 自己导入的搬进 IndexedDB，文件夹里的丢弃，再把设置里的这一项删掉。
     */
    async loadModules() {
        this.modules = [];
        try {
            this.modules = await Storage.loadUserModules();
        } catch (e) {
            Toast.show(e.message, 'error', 8000);
        }
        const legacy = Storage.getSettings().modules;
        if (Array.isArray(legacy)) {
            const known = new Set(this.modules.map(m => m.id));
            const mine = legacy.filter(m => m && m.id && !m.folderKey && !known.has(m.id));
            try {
                if (mine.length) await Storage.saveUserModules(this.modules.concat(mine));
                this.modules = this.modules.concat(mine);
                Storage.deleteSettingsKey('modules');
            } catch (e) {
                Toast.show(e.message, 'error', 8000);
            }
        }
        this._ownSaved = this.modules.length > 0;
        const currentId = Storage.getSettings().currentModule;
        if (currentId) this.currentModule = this.modules.find(m => m.id === currentId) || null;
    },

    /**
     * 从 module 文件夹加载：list.json 为故事文件夹名数组；每个故事只加载 module/<故事id>/module.json
     * 若 list 为空（如 file:// 下 fetch 失败），会尝试默认故事 id，便于至少能看到一个故事
     */
    async loadFromModuleFolder() {
        let list = [];
        // 2026-06-05：fetch fail 不再只 console.warn —— list.json fail 弹 toast 含原因 + 建议；
        // 单模组 fail 累积到 errors 数组，最后汇总一次 toast 不刷屏。
        let listFetchError = null;
        try {
            const listRes = await fetch(`${MODULE_FOLDER}/list.json`);
            if (listRes.ok) {
                const raw = await listRes.json();
                list = Array.isArray(raw) ? raw : [];
            } else {
                listFetchError = `HTTP ${listRes.status}`;
            }
        } catch (e) {
            listFetchError = e.message;
            console.warn('Module list not found (若用 file:// 打开请改用本地服务器):', e.message);
        }
        if (listFetchError && typeof Toast !== 'undefined' && Toast.show) {
            Toast.show(`模组列表加载失败（${listFetchError}）。若用 file:// 打开请改用本地服务器，例如 npm start`, 'error', 8000);
        }
        // list.json 两种历史格式都支持：
        //  - 旧：字符串数组（故事文件夹名）   ["canglan-sect"]
        //  - 新：对象数组                      [{ id, name, path, enabled, isTest, ... }]
        // 取每条的「文件夹名」key：对象优先 path 末段，否则 id；字符串则其本身。enabled===false 跳过。
        const folderKeyOf = (entry) => {
            if (entry == null) return '';
            if (typeof entry === 'string') return entry.trim();
            if (typeof entry === 'object') {
                if (entry.enabled === false) return '';
                if (entry.path) return String(entry.path).replace(/^\.?\/?/, '').replace(new RegExp('^' + MODULE_FOLDER + '/'), '').replace(/\/+$/, '').trim();
                return String(entry.id || entry.folderKey || entry.name || '').trim();
            }
            return String(entry).trim();
        };

        const loadedIds = [];
        // 2026-06-05：累积单模组 fetch fail，最后汇总一次 toast
        const moduleErrors = [];
        for (const entry of list) {
            const key = folderKeyOf(entry);
            if (!key) continue;
            try {
                const res = await fetch(`${MODULE_FOLDER}/${key}/module.json`);
                if (!res.ok) {
                    moduleErrors.push({ key, error: `HTTP ${res.status}` });
                    console.error(`Story "${key}" module.json HTTP ${res.status}`);
                    continue;
                }

                const data = await res.json();
                const module = this._normalizeModule(data, key);

                const existing = this.modules.find(m => m.id === module.id);
                if (existing) {
                    this.modules[this.modules.indexOf(existing)] = module;
                } else {
                    this.modules.push(module);
                }
                if (this.currentModule && this.currentModule.id === module.id) {
                    this.currentModule = module;
                }
                loadedIds.push(module.id);
            } catch (e) {
                moduleErrors.push({ key, error: e.message });
                console.error(`Failed to load story "${key}":`, e);
            }
        }

        // list 非空却一个都没加载成功 = 真实失败，不静默（调用方据此可如实提示，而非假成功）
        if (list.length > 0 && loadedIds.length === 0) {
            console.error('loadFromModuleFolder: list.json 非空但无任何故事加载成功，请检查 list.json 格式与 module/<id>/module.json 可访问性');
            if (typeof Toast !== 'undefined' && Toast.show) {
                Toast.show(`list.json 列了 ${list.length} 个模组但全部加载失败，请检查 console 详情`, 'error', 8000);
            }
        } else if (moduleErrors.length > 0 && typeof Toast !== 'undefined' && Toast.show) {
            // 部分成功：汇总一次 toast，不一个个刷屏
            const all = moduleErrors.map(e => `${e.key}(${e.error})`).join('、');
            Toast.show(`${moduleErrors.length} 个模组加载失败：${all}（成功 ${loadedIds.length} 个）`, 'warning', 7000);
        }

        // 若当前选中的模块不在本次从 list 实际加载到的故事里，则切换到其中第一个
        const fromListIds = new Set(loadedIds);
        if (this.currentModule && fromListIds.size > 0 && !fromListIds.has(this.currentModule.id)) {
            const first = this.modules.find(m => fromListIds.has(m.id));
            if (first) this.currentModule = first;
        }

        this._saveModules();
    },

    /**
     * 从本地 module.json 重新加载当前模组，放弃内存中的临时编辑（flowNodeOverrides 等仍由调用方或 State 管理）
     * @returns {Promise<Object|null>} 重新加载后的当前模组，失败返回 null
     */
    async reloadCurrentFromFolder() {
        const cur = this.currentModule;
        if (!cur || !cur.folderKey) return null;
        try {
            const res = await fetch(`${MODULE_FOLDER}/${cur.folderKey}/module.json`);
            if (!res.ok) return null;
            const data = await res.json();
            const module = this._normalizeModule(data, cur.folderKey);
            const existing = this.modules.find(m => m.id === module.id);
            if (existing) this.modules[this.modules.indexOf(existing)] = module;
            else this.modules.push(module);
            this.currentModule = module;
            this._saveModules();
            if (typeof Events !== 'undefined' && typeof EVENT_TYPES !== 'undefined') {
                Events.emit(EVENT_TYPES.MODULE_LOADED, { module });
            }
            return module;
        } catch (e) {
            console.error('reloadCurrentFromFolder failed:', e);
            return null;
        }
    },

    /**
     * 获取「第一个触发器链」的首叶路径（用于初始当前位置：同层只考虑 trigger_chain/ordered，再递归到叶）
     * @param {Object} [module] - 故事模块，默认当前
     * @returns {string[]} 路径 id 数组，无则 []
     */
    getFirstTriggerChainLeafModulePath(module) {
        const cur = module || this.currentModule;
        if (!cur || !cur.content) return [];
        const sub = cur.content.subModules || [];
        const triggerChain = sub.filter((n) => n.type === 'trigger_chain');
        if (triggerChain.length === 0) return this.getFirstLeafModulePath(cur);
        const first = triggerChain[0];
        const id = first.id || first.name;
        if (!id) return [];
        return this._getFirstLeafFrom(cur, [id]);
    },

    /**
     * 规范化根模块（故事）：content 内 variables、plugins、subModules 同层级，subModules 递归规范化
     */
    /**
     * 把 flows 结构的故事（canglan-sect / MODULE_STRUCTURE / jump.test 用的规范结构：
     * data.flows.<flow>.subModules，节点 info 为数组、子树挂在 node.flows.<flow>.subModules、
     * 链序用 linkedList.{prev,next}）转换成本管理器期望的 content 形态（content.subModules，
     * 节点 info 为字符串、子树在 node.subModules、链序用 prev/nextModuleId）。
     * 仅当 data 无 .content 但有 .flows 时启用，不影响旧 content 结构的故事。
     */
    _normVarsForFlows(arr) {
        return (Array.isArray(arr) ? arr : []).map((v) => {
            if (!v || v.id == null) return v;
            const nv = { ...v };
            if (nv.value === undefined && nv.initialValue !== undefined) nv.value = nv.initialValue;
            if (!nv.variableRole && !nv.role && nv.category && nv.category !== 'module') nv.variableRole = nv.category;
            if (nv.readonly === true && nv.readOnly === undefined) nv.readOnly = true;
            return nv;
        });
    },
    /** 把 flows-schema 节点 raw（带 flows / info[] / linkedList）转成 ModuleManager 期望的 contentTree node（无 flows，info 字符串，prev/nextModuleId）。
     * 提到方法级是为了支持动态生成节点时复用同一份转换逻辑（addDynamicSubModuleFromRaw）。 */
    _convFlowsNode(n, flowKey) {
        const normVars = this._normVarsForFlows.bind(this);
        const convNode = this._convFlowsNode.bind(this);
        if (!n || typeof n !== 'object') return null;
        let infoStr = '';
        const infoEntries = [];
        if (Array.isArray(n.info)) {
            const plain = [];
            n.info.forEach((it) => {
                if (!it || !it.content) return;
                if (it.condition != null) infoEntries.push({ text: String(it.content), condition: it.condition });
                else plain.push(String(it.content));
            });
            infoStr = plain.join('\n\n');
        } else if (typeof n.info === 'string') infoStr = n.info;
        const childFlows = n.flows || {};
        const childKeys = Object.keys(childFlows);
        let kids = [];
        const mainKidsFirst = childKeys.includes('main') ? ['main', ...childKeys.filter(k => k !== 'main')] : childKeys;
        for (const fk of mainKidsFirst) {
            const arr = (childFlows[fk] && Array.isArray(childFlows[fk].subModules)) ? childFlows[fk].subModules : [];
            for (const c of arr) { const cc = convNode(c, fk); if (cc) kids.push(cc); }
        }
        const ll = n.linkedList || {};
        return {
            id: n.id,
            name: n.name || n.id,
            type: n.type || 'normal',
            info: infoStr,
            infoEntries,
            deliveryInfo: Array.isArray(n.deliveryInfo) ? n.deliveryInfo : [],
            entryConditions: n.entryConditions ?? null,
            completionConditions: n.completionConditions ?? null,
            enterCondition: n.entryConditions ?? null,
            completeCondition: n.completionConditions ?? null,
            prevModuleId: ll.prev != null ? ll.prev : null,
            nextModuleId: ll.next != null ? ll.next : null,
            variables: normVars(n.variables),
            plugins: Array.isArray(n.plugins) ? n.plugins : [],
            openPlugins: Array.isArray(n.openPlugins) ? n.openPlugins : [],
            tags: Array.isArray(n.tags) ? n.tags : (typeof n.tags === 'string' ? n.tags.split(',').map(s => s.trim()).filter(Boolean) : []),
            flowRole: flowKey && flowKey !== 'main' ? 'parallel' : 'main',
            flowName: flowKey && flowKey !== 'main' ? flowKey : undefined,
            subModules: kids
        };
    },

    /**
     * 把 module_generator 生成的动态节点写进 ModuleManager.currentModule 的 contentTree，
     * 让真实游戏 prompt 段 / queue 段 / iframe 渲染都能看到这个新节点（之前只写测试侧 ModuleSystem.modules 里，真实游戏看不到）。
     * @param {Object} templateRaw - moduleTemplate 原始结构（带 id/name/type/plugins/flows）
     * @param {string} flowKey - outputFlow 名（如 npc_flows）
     * @returns {boolean} 是否新增（已存在同 id 返回 false）
     */
    addDynamicSubModuleFromRaw(templateRaw, flowKey) {
        if (!this.currentModule || !this.currentModule.content || !templateRaw || !templateRaw.id) return false;
        const subs = this.currentModule.content.subModules;
        if (!Array.isArray(subs)) return false;
        if (subs.find(s => s && s.id === templateRaw.id)) return false; // 已有同 id 不重复加
        const node = this._convFlowsNode(templateRaw, flowKey || 'main');
        if (!node) return false;
        // 经 _normalizeSubModuleNode 再走一次，保证字段完整（与 _normalizeModule 走的同一道工序）
        const normalized = this._normalizeSubModuleNode(node);
        subs.push(normalized);
        // 记录到 State.dynamicSubModules 让 reload 后能重 apply（module.json 没记录这种动态节点，否则丢）
        if (typeof State !== 'undefined') {
            if (!State.dynamicSubModules) State.dynamicSubModules = {};
            const mid = this.currentModule.id;
            if (!Array.isArray(State.dynamicSubModules[mid])) State.dynamicSubModules[mid] = [];
            // 防同 id 在 State 里重复
            if (!State.dynamicSubModules[mid].find(e => e && e.templateRaw && e.templateRaw.id === templateRaw.id)) {
                State.dynamicSubModules[mid].push({ templateRaw: JSON.parse(JSON.stringify(templateRaw)), flowKey: flowKey || 'main' });
            }
        }
        // 重算 moduleMinData（影响跳转/队列计算）
        if (typeof State !== 'undefined') {
            if (!State.moduleMinData) State.moduleMinData = {};
            State.moduleMinData[this.currentModule.id] = this.computeModuleMinData(this.currentModule);
        }
        // 触发 PluginRegistry 重收集（新节点可能带 plugins）
        if (typeof window !== 'undefined' && window.PluginRegistry && typeof window.PluginRegistry.registerFromModule === 'function') {
            try { window.PluginRegistry.registerFromModule(); } catch (e) {}
        }
        if (typeof window !== 'undefined' && window.Events && window.EVENT_TYPES) {
            try { window.Events.emit(window.EVENT_TYPES.GAME_FLOW_UPDATE); } catch (e) {}
        }
        return true;
    },

    _flowsToContentTree(data) {
        const flows = data.flows || {};
        const flowKeys = Object.keys(flows);
        const normVars = this._normVarsForFlows.bind(this);
        const convNode = this._convFlowsNode.bind(this);
        const rootSub = [];
        const orderedFlows = flowKeys.includes('main') ? ['main', ...flowKeys.filter(k => k !== 'main')] : flowKeys;
        for (const fk of orderedFlows) {
            const arr = (flows[fk] && Array.isArray(flows[fk].subModules)) ? flows[fk].subModules : [];
            for (const c of arr) { const cc = convNode(c, fk); if (cc) rootSub.push(cc); }
        }
        return {
            variables: normVars(data.variables),
            plugins: Array.isArray(data.plugins) ? data.plugins : [],
            subModules: rootSub,
            initialStates: data.initialStates && typeof data.initialStates === 'object' ? data.initialStates : {},
            timeSystem: data.timeSystem && typeof data.timeSystem === 'object' ? data.timeSystem : null,
            info: ''
        };
    },

    _normalizeModule(data, fallbackKey) {
        const id = data.id || `story_${fallbackKey}`;
        const now = Date.now();
        const raw = (data.content && typeof data.content === 'object')
            ? data.content
            : ((data.flows && typeof data.flows === 'object') ? this._flowsToContentTree(data) : {});
        const rawSub = raw.moduleGroup ?? raw.subModules;
        const subModules = Array.isArray(rawSub)
            ? rawSub.map(s => this._normalizeSubModuleNode(s))
            : [];
        return {
            id,
            folderKey: fallbackKey, // 磁盘文件夹名，用于 fetch module/<folderKey>/patches/
            name: data.name || fallbackKey,
            description: data.description || '',
            patches: Array.isArray(data.patches) ? data.patches : [],
            createdAt: data.createdAt || now,
            updatedAt: data.updatedAt || now,
            content: {
                variables: Array.isArray(raw.variables) ? raw.variables : [],
                plugins: Array.isArray(raw.plugins) ? raw.plugins : [],
                openPlugins: Array.isArray(raw.openPlugins) ? raw.openPlugins : [],
                subModules,
                initialStates: raw.initialStates && typeof raw.initialStates === 'object' ? raw.initialStates : {},
                pluginConfigs: raw.pluginConfigs && typeof raw.pluginConfigs === 'object' ? raw.pluginConfigs : {},
                firstMessage: raw.firstMessage,
                introText: raw.introText,
                openingPrompt: raw.openingPrompt,
                stageDisplay: raw.stageDisplay,
                expectedQueueCount: raw.expectedQueueCount != null ? raw.expectedQueueCount : null,
                initialModule: raw.initialModule != null ? raw.initialModule : null,
                timelineEvents: Array.isArray(raw.timelineEvents) ? raw.timelineEvents : [],
                schedulerConfig: raw.schedulerConfig && typeof raw.schedulerConfig === 'object' ? raw.schedulerConfig : { scheduleVisibleWeeks: 2, scheduleAheadMonths: 3 },
                derivedVariableRules: raw.derivedVariableRules != null && typeof raw.derivedVariableRules === 'object' ? raw.derivedVariableRules : (raw.realmRules != null && typeof raw.realmRules === 'object' ? raw.realmRules : null),
                characterPresets: Array.isArray(raw.characterPresets) ? raw.characterPresets : (Array.isArray(raw.npcPresets) ? raw.npcPresets : []),
                info: raw.info || '',
                infoVisibility: raw.infoVisibility || 'visible',
                infoVisibleFrom: raw.infoVisibleFrom || null,
                timeUnits: raw.timeUnits && typeof raw.timeUnits === 'object' ? raw.timeUnits : null
            },
            presetId: data.presetId ?? null
        };
    },

    /**
     * 获取当前故事下某插件的配置（通用系统：不包含游戏内容）
     * 优先读 content.pluginConfigs[pluginId]，若无则尝试 fetch module/<id>/plugins/<pluginId>.json
     */
    async getPluginConfig(pluginId) {
        const cur = this.currentModule;
        if (!cur) return null;
        const embedded = cur.content?.pluginConfigs?.[pluginId];
        if (embedded && typeof embedded === 'object') return embedded;
        try {
            const res = await fetch(`${MODULE_FOLDER}/${cur.id.replace(/^story_/, '')}/plugins/${pluginId}.json`);
            if (res.ok) return await res.json();
        } catch (e) { /* 无服务器或文件不存在时忽略 */ }
        return null;
    },

    /** 同步获取已嵌入的插件配置（无 fetch） */
    getPluginConfigSync(pluginId) {
        const cur = this.currentModule;
        return cur?.content?.pluginConfigs?.[pluginId] ?? null;
    },

    /**
     * 规范化子节点（任意层）：保留 variables、plugins、subModules 同层级，递归处理 subModules
     */
    _normalizeSubModuleNode(node) {
        if (!node || typeof node !== 'object') {
            return { id: '', name: '未命名', type: 'normal', content: '', variables: [], plugins: [], subModules: [] };
        }
        if (node._timelineEvent) {
            return { type: 'timeline', id: node.id || '', name: node.name || '未命名', subModules: [], _timelineEvent: true };
        }
        const rawContent = node.content && typeof node.content === 'object' ? node.content : {};
        const rawSub = node.moduleGroup ?? node.subModules ?? rawContent.moduleGroup ?? rawContent.subModules;
        const triggerChain = node.trigger_chain || rawContent.trigger_chain || [];
        const unordered = node.unordered || rawContent.unordered || [];
        const freeTrigger = node.free_trigger ?? rawContent.free_trigger ?? [];
        const parallel = node.parallel || rawContent.parallel || [];
        const timeline = node.timeline || rawContent.timeline || [];
        const timelineAsNodes = Array.isArray(timeline) ? timeline.map((ev) => ({ _timelineEvent: true, type: 'timeline', id: ev.id || ev.name, name: ev.name || ev.id || '未命名' })) : [];
        const merged = Array.isArray(rawSub) && rawSub.length > 0
            ? rawSub
            : this.getSubModulesInTypeOrder([].concat(
                (Array.isArray(triggerChain) ? triggerChain : []).map(t => ({ ...t, type: t.type || 'trigger_chain' })),
                (Array.isArray(unordered) ? unordered : []).map(u => ({ ...u, type: u.type || 'unordered' })),
                (Array.isArray(freeTrigger) ? freeTrigger : []).map(f => ({ ...f, type: (f.type || 'free_trigger') })),
                (Array.isArray(parallel) ? parallel : []).map(p => ({ ...p, type: 'trigger_chain', flowRole: p.flowRole ?? 'parallel' })),
                timelineAsNodes
            ));
        const subModules = merged.map(s => this._normalizeSubModuleNode(s));
        const contentStr = typeof node.content === 'string' ? node.content : (rawContent.content != null ? rawContent.content : '') || '';
        const rawType = node.type || 'normal';
        const type = (rawType === 'ordered' || rawType === 'parallel') ? 'trigger_chain' : rawType;
        const flowRole = node.flowRole ?? rawContent.flowRole ?? (rawType === 'parallel' ? 'parallel' : (rawType === 'trigger_chain' || rawType === 'ordered' ? 'main' : null));
        const flowName = node.flowName ?? rawContent.flowName ?? (flowRole === 'main' ? '主线' : (flowRole === 'parallel' ? (node.name || node.id || '') : ''));
        return {
            id: node.id || `n_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            name: node.name || '未命名',
            type,
            flowRole: flowRole || undefined,
            flowName: flowName || undefined,
            timeVariableId: node.timeVariableId || rawContent.timeVariableId || null,
            content: contentStr,
            deliveryInfo: Array.isArray(node.deliveryInfo) ? node.deliveryInfo : (Array.isArray(rawContent.deliveryInfo) ? rawContent.deliveryInfo : []),
            variables: Array.isArray(node.variables) ? node.variables : (Array.isArray(rawContent.variables) ? rawContent.variables : []),
            plugins: Array.isArray(node.plugins) ? node.plugins : (Array.isArray(rawContent.plugins) ? rawContent.plugins : []),
            variableRequirements: node.variableRequirements || [],
            openCondition: node.openCondition ?? null,
            linkedModules: node.linkedModules || [],
            initialState: node.initialState != null ? node.initialState : (node.initialStates || {}),
            initialStates: node.initialStates || {},
            stageDisplay: node.stageDisplay || rawContent.stageDisplay || null,
            openVariables: Array.isArray(node.openVariables) ? node.openVariables : (Array.isArray(rawContent.openVariables) ? rawContent.openVariables : []),
            variableToggleActions: Array.isArray(node.variableToggleActions) ? node.variableToggleActions : (Array.isArray(rawContent.variableToggleActions) ? rawContent.variableToggleActions : null),
            openPlugins: Array.isArray(node.openPlugins) ? node.openPlugins : (Array.isArray(rawContent.openPlugins) ? rawContent.openPlugins : []),
            enterRule: node.enterRule ?? rawContent.enterRule ?? null,
            enterCondition: node.enterCondition ?? rawContent.enterCondition ?? null,
            completeCondition: node.completeCondition ?? rawContent.completeCondition ?? null,
            nextRule: node.nextRule ?? rawContent.nextRule ?? null,
            visibleLayersUp: node.visibleLayersUp ?? rawContent.visibleLayersUp ?? 0,
            linkedRandomizer: node.linkedRandomizer || rawContent.linkedRandomizer || null,
            linkedScheduleRandomizer: node.linkedScheduleRandomizer || rawContent.linkedScheduleRandomizer || null,
            linkedModuleGenerator: node.linkedModuleGenerator || rawContent.linkedModuleGenerator || null,
            triggerWorldBook: node.triggerWorldBook || rawContent.triggerWorldBook || null,
            tags: Array.isArray(node.tags) ? node.tags : (typeof node.tags === 'string' ? node.tags.split(',').map(s => s.trim()).filter(Boolean) : []),
            infoEntries: Array.isArray(node.infoEntries) ? node.infoEntries : (Array.isArray(rawContent.infoEntries) ? rawContent.infoEntries : []),
            prevModuleId: node.prevModuleId ?? rawContent.prevModuleId ?? null,
            nextModuleId: node.nextModuleId ?? rawContent.nextModuleId ?? null,
            moduleNote: node.moduleNote ?? rawContent.moduleNote ?? null,
            info: node.info || rawContent.info || '',
            infoVisibility: node.infoVisibility || rawContent.infoVisibility || 'visible',
            infoVisibleFrom: node.infoVisibleFrom || rawContent.infoVisibleFrom || null,
            subModules,
            timeline: Array.isArray(timeline) ? timeline : []
        };
    },

    /**
     * 刷新当前导入：重新从 module 文件夹加载并合并，不改变当前选中的模块 id
     */
    async refreshFromFolder() {
        const currentId = this.currentModule?.id || null;
        await this.loadFromModuleFolder();
        if (currentId) {
            const again = this.modules.find(m => m.id === currentId);
            if (again) this.currentModule = again;
        }
        return this.modules;
    },

    /**
     * 保存模块列表：当前模组的标识进浏览器设置；没有模组文件夹的（玩家自己导入 / 新建的）整份存进 IndexedDB。
     * 文件夹里的模组不保存，每次启动都从文件读取。写入排队进行，失败时提示玩家。
     */
    _saveModules() {
        if (this.currentModule && Storage.getSettings().currentModule !== this.currentModule.id) {
            Storage.saveSettings({ currentModule: this.currentModule.id });
        }
        const mine = this.modules.filter(m => !m.folderKey);
        if (!mine.length && !this._ownSaved) return this._ownWrite;
        this._ownSaved = mine.length > 0;
        this._ownWrite = this._ownWrite
            .then(() => Storage.saveUserModules(mine))
            .catch(e => { Toast.show(e.message, 'error', 8000); });
        return this._ownWrite;
    },

    /**
     * 创建新模块
     */
    create(name, description = '') {
        const module = {
            id: `module_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: name || '新模块',
            description: description || '',
            createdAt: Date.now(),
            updatedAt: Date.now(),

            content: {
                variables: [],
                plugins: [],
                subModules: [],
                initialStates: {}
            },

            // 绑定的预设ID（可选）
            presetId: null
        };

        this.modules.push(module);
        this._saveModules();
        return module;
    },

    /**
     * 加载模块
     */
    load(moduleId) {
        const module = this.modules.find(m => m.id === moduleId);
        if (!module) return false;

        this.currentModule = module;
        const settings = Storage.getSettings() || {};
        settings.currentModule = moduleId;
        Storage.saveSettings(settings);

        // 按理论顺序计算各节点最低 data，存入 State.moduleMinData（流程树跳转用）
        if (typeof State !== 'undefined') {
            if (!State.moduleMinData) State.moduleMinData = {};
            State.moduleMinData[module.id] = this.computeModuleMinData(module);
        }

        // 如果模块绑定了预设，自动加载预设
        if (module.presetId) {
            PresetManager.load(module.presetId);
        }

        // 重新 apply 持久化的动态子模块（module_generator one-shot 之前生成的，存在 State.dynamicSubModules）
        // module.json 没记录这些动态节点，reload 后 subModules 会丢；这里按 State 重 push 回内存树
        try {
            const ds = (typeof State !== 'undefined' && State.dynamicSubModules) ? State.dynamicSubModules[module.id] : null;
            if (Array.isArray(ds) && module.content && Array.isArray(module.content.subModules)) {
                ds.forEach(entry => {
                    if (!entry || !entry.templateRaw || !entry.templateRaw.id) return;
                    if (module.content.subModules.find(s => s && s.id === entry.templateRaw.id)) return;
                    const node = this._convFlowsNode(entry.templateRaw, entry.flowKey || 'main');
                    if (node) module.content.subModules.push(this._normalizeSubModuleNode(node));
                });
            }
        } catch (e) { console.warn('[ModuleManager.load] restore dynamicSubModules:', e); }

        Events.emit(EVENT_TYPES.MODULE_LOADED, { module });
        return true;
    },

    /**
     * 保存当前模块
     */
    save(moduleId = null) {
        const module = moduleId
            ? this.modules.find(m => m.id === moduleId)
            : this.currentModule;

        if (!module) {
            Toast.show('没有可保存的模块', 'warning');
            return false;
        }

        module.updatedAt = Date.now();

        // 更新模块内容（从当前状态）
        if (window.VariableSystem) {
            module.content.variables = VariableSystem.getAll();
        }
        // ModuleSystem 已移除，子模块由模块管理器直接管理

        this._saveModules();
        Toast.show('模块已保存', 'success');
        return true;
    },

    /**
     * 更新模块
     */
    update(moduleId, updates) {
        const module = this.modules.find(m => m.id === moduleId);
        if (!module) return false;

        Object.assign(module, updates, { updatedAt: Date.now() });
        this._saveModules();
        return true;
    },

    /**
     * 删除模块
     */
    delete(moduleId) {
        this.modules = this.modules.filter(m => m.id !== moduleId);
        if (this.currentModule?.id === moduleId) {
            this.currentModule = null;
            // saveSettings 走 spread merge 不能删 key，走专用 deleteSettingsKey
            Storage.deleteSettingsKey('currentModule');
        }
        this._saveModules();
        return true;
    },

    /** 把删掉的模组放回去；列表里已有同一个模组时不覆盖，返回 false */
    restore(module, makeCurrent = false) {
        if (this.modules.some(m => m.id === module.id)) return false;
        this.modules.push(module);
        if (makeCurrent) this.currentModule = module;
        this._saveModules();
        return true;
    },

    /**
     * 获取所有模块
     */
    getAll() {
        return [...this.modules];
    },

    /**
     * 导出模块
     */
    export(moduleId) {
        const module = this.modules.find(m => m.id === moduleId);
        if (!module) return null;

        FileDownload.save(JSON.stringify(module, null, 2), `module_${module.name}`, 'json', 'application/json');
        return true;
    },

    /**
     * 读取模组文件。支持 module.json 格式（含 flows）与旧的 content 格式。
     * module.json 格式会先做完整性检查：有错误时抛出带说明的错误，有提示时随结果返回。
     * @returns {Promise<Object>} 导入后的模组；module.json 格式时附带 warnings（检查提示）
     */
    async importFromFile(file) {
        const text = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error('文件读取失败，请确认文件没有被占用。'));
            reader.readAsText(file);
        });
        let data;
        try { data = JSON.parse(text); }
        catch (e) { throw new Error('文件内容不是有效的模组：格式有误，请确认导入的是导出的模组文件。'); }
        return this.importFromData(data);
    },

    /**
     * 导入已解析的模组数据，检查后加入模组列表。
     * @param {Object} data
     * @param {{ allowWarnings?: boolean }} [opts] 为 false 时遇到提示也抛出（调用方先给用户确认）
     */
    importFromData(data, opts = {}) {
        if (data && typeof data === 'object' && !data.content && typeof ModuleSystem !== 'undefined') {
            const check = ModuleSystem.validateConfig(data);
            if (check.errors.length) {
                const e = new Error(check.errors.slice(0, 3).map(x => x.message).join(' ') + (check.errors.length > 3 ? `另有 ${check.errors.length - 3} 处问题。` : ''));
                e.problems = check;
                throw e;
            }
            if (check.warnings.length && opts.allowWarnings === false) {
                const e = new Error('模组有需要确认的问题。');
                e.problems = check;
                e.needConfirm = true;
                throw e;
            }
            const module = this.addFromConfig(data);
            module.importWarnings = check.warnings;
            return module;
        }
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('文件内容不是有效的模组。');
        const module = data;
        module.id = `module_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        module.createdAt = module.createdAt || Date.now();
        module.updatedAt = Date.now();
        this.modules.push(module);
        this._saveModules();
        if (typeof State !== 'undefined') {
            if (!State.moduleMinData) State.moduleMinData = {};
            State.moduleMinData[module.id] = this.computeModuleMinData(module);
        }
        return module;
    },

    /**
     * 把 module.json 格式的配置加入模组列表（没有对应的模组文件夹）。标识与已有模组冲突时自动换一个。
     */
    addFromConfig(config) {
        const data = JSON.parse(JSON.stringify(config));
        const base = data.id;
        let id = base;
        let n = 1;
        while (this.modules.some(m => m.id === id)) id = `${base}_${++n}`;
        data.id = id;
        const module = this._normalizeModule(data, id);
        module.folderKey = '';
        module.sourceConfig = data;
        this.modules.push(module);
        this._saveModules();
        if (typeof State !== 'undefined') {
            if (!State.moduleMinData) State.moduleMinData = {};
            State.moduleMinData[module.id] = this.computeModuleMinData(module);
        }
        return module;
    },

    /**
     * 用编辑后的 module.json 格式配置替换当前模组的内容，让游戏里实际使用的模组与编辑结果一致。
     * 名称、描述、创建时间、文件夹对应关系保持不变。
     * @returns {boolean} 是否已替换
     */
    applyConfig(config) {
        const cur = this.currentModule;
        if (!cur || !config) return false;
        const fresh = this._normalizeModule(JSON.parse(JSON.stringify(config)), cur.folderKey || cur.id);
        fresh.id = cur.id;
        fresh.folderKey = cur.folderKey;
        fresh.createdAt = cur.createdAt;
        fresh.presetId = cur.presetId;
        if (cur.sourceConfig) fresh.sourceConfig = JSON.parse(JSON.stringify(config));
        const idx = this.modules.indexOf(cur);
        if (idx >= 0) this.modules[idx] = fresh;
        this.currentModule = fresh;
        try {
            const ds = (typeof State !== 'undefined' && State.dynamicSubModules) ? State.dynamicSubModules[fresh.id] : null;
            if (Array.isArray(ds)) {
                ds.forEach(entry => {
                    if (!entry || !entry.templateRaw || !entry.templateRaw.id) return;
                    if (fresh.content.subModules.find(s => s && s.id === entry.templateRaw.id)) return;
                    const node = this._convFlowsNode(entry.templateRaw, entry.flowKey || 'main');
                    if (node) fresh.content.subModules.push(this._normalizeSubModuleNode(node));
                });
            }
        } catch (e) { console.error('applyConfig 动态模块恢复失败', e); }
        if (typeof State !== 'undefined') {
            if (!State.moduleMinData) State.moduleMinData = {};
            State.moduleMinData[fresh.id] = this.computeModuleMinData(fresh);
        }
        this._saveModules();
        if (typeof window !== 'undefined' && window.PluginRegistry && typeof window.PluginRegistry.registerFromModule === 'function') window.PluginRegistry.registerFromModule();
        if (typeof window !== 'undefined' && window.Events && window.EVENT_TYPES) window.Events.emit(window.EVENT_TYPES.GAME_FLOW_UPDATE);
        return true;
    },

    /**
     * 获取当前模块
     */
    getCurrent() {
        return this.currentModule;
    },

    /** 子模块类型排序权重：时间线、触发器链有顺序；自由触发器(free_trigger)/unordered 并列。分流程用 flowRole 区分。 */
    _subModuleTypeOrder(t) {
        if (t === 'timeline') return 0;
        if (t === 'trigger_chain') return 1;
        if (t === 'unordered' || t === 'free_trigger') return 2;
        return 2;
    },

    /**
     * 同层 subModules 按类型顺序排列：时间线 > 触发器链 > 自由触发器 > 并行
     */
    getSubModulesInTypeOrder(subModules) {
        const sub = Array.isArray(subModules) ? [...subModules] : [];
        return sub.sort((a, b) => this._subModuleTypeOrder(a.type) - this._subModuleTypeOrder(b.type));
    },

    /**
     * 获取从根到「第一个最细分子模块」的 id 路径（用于开始游戏默认进入）
     * 同层按类型顺序：时间线 > 触发器链 > 自由触发器，取第一个再递归到叶
     * @param {Object} [module] - 故事模块，默认当前
     * @returns {string[]} 从根到第一个叶子的模块 id 路径，如 ['module_a']
     */
    getFirstLeafModulePath(module) {
        const cur = module || this.currentModule;
        if (!cur || !cur.content) return [];
        const path = [];
        let node = cur.content;
        const sub = this.getSubModulesInTypeOrder(node.subModules || []);
        if (sub.length === 0) return path;
        let current = sub[0];
        while (current) {
            const id = current.id || current.name;
            if (id) path.push(id);
            const nextSub = this.getSubModulesInTypeOrder((current && current.subModules) || []);
            if (nextSub.length === 0) break;
            current = nextSub[0];
        }
        return path;
    },

    /**
     * 根据路径 id 数组取节点（从 content 起）
     * @param {Object} module - 故事模块
     * @param {string[]} pathIds - 从根到该节点的 id 序列，如 ['module_a']
     * @returns {{ node: Object, name: string, parent: Object|null }}
     */
    getModuleNodeByPath(module, pathIds) {
        if (!module || !module.content || !Array.isArray(pathIds) || pathIds.length === 0) {
            return { node: module?.content, name: module?.name || '根', parent: null };
        }
        let parent = null;
        let node = module.content;
        let name = module.name || '根';
        for (const id of pathIds) {
            const sub = Array.isArray(node.subModules) ? node.subModules : [];
            const found = sub.find((n) => (n.id || n.name) === id);
            if (!found) break;
            parent = node;
            node = found;
            name = node.name || node.id || '';
        }
        return { node, name, parent };
    },

    /**
     * 按叶节点 id 查找节点并追加 info 文本（用于 variableRequirements.addToModuleInfo 投递完成后）
     * @param {Object} module - 故事模块
     * @param {string} leafId - 叶节点 id（或 name）
     * @param {string} text - 追加到 node.info 的文本
     */
    appendInfoToNodeByLeafId(module, leafId, text) {
        if (!module || !module.content || !leafId || text == null) return;
        const walk = (node) => {
            if ((node.id || node.name) === leafId) {
                const prev = node.info != null ? String(node.info) : '';
                node.info = prev ? prev + '\n' + text : text;
                return true;
            }
            const sub = Array.isArray(node.subModules) ? node.subModules : [];
            for (const child of sub) {
                if (walk(child)) return true;
            }
            return false;
        };
        walk(module.content);
    },

    /**
     * 按 pathKey 查找节点并追加 info 文本（targetPathKey 为空表示根 content）
     */
    appendInfoToNodeByPathKey(module, pathKey, text) {
        if (!module || !module.content || text == null) return;
        const pathIds = pathKey && String(pathKey).trim() ? String(pathKey).trim().split('|').filter(Boolean) : [];
        const { node } = this.getModuleNodeByPath(module, pathIds);
        if (!node) return;
        const prev = node.info != null ? String(node.info) : '';
        node.info = prev ? prev + '\n' + text : text;
    },

    /**
     * 变量达成后投递 info：遍历模块树中 deliveryInfoOnVariable 规则，条件满足则追加 info 到目标模块（仅首次满足时投递，用 State.variableDeliveryApplied 记录）
     * 规则格式：{ variableId, operator, value, infoText, targetModuleId? }；targetModuleId 缺省时追加到当前节点。
     * @param {Object} module - 故事模块
     */
    applyVariableDeliveryInfo(module) {
        if (!module || !module.content || typeof State === 'undefined' || !State.variables) return;
        const vars = State.variables;
        if (!State.variableDeliveryApplied) State.variableDeliveryApplied = {};
        if (!State.variableDeliveryApplied[module.id]) State.variableDeliveryApplied[module.id] = {};
        const applied = State.variableDeliveryApplied[module.id];
        const walk = (node, pathIds) => {
            const id = node.id || node.name;
            const ids = pathIds ? [...pathIds, id] : [id];
            const rules = Array.isArray(node.deliveryInfoOnVariable) ? node.deliveryInfoOnVariable : [];
            rules.forEach((r, idx) => {
                if (!r.variableId || r.infoText == null) return;
                const ruleKey = ids.join('|') + '|' + idx;
                if (applied[ruleKey]) return;
                const cond = { type: 'variable', variableId: r.variableId, operator: r.operator || '==', value: r.value };
                if (!this._evaluateCondition(cond, vars, module)) return;
                const targetId = r.targetModuleId || id;
                this.appendInfoToNodeByLeafId(module, targetId, r.infoText);
                applied[ruleKey] = true;
            });
            (Array.isArray(node.subModules) ? node.subModules : []).forEach((child) => walk(child, ids));
        };
        const content = module.content;
        (Array.isArray(content.subModules) ? content.subModules : []).forEach((n) => walk(n, []));
    },

    /**
     * 模组树关系：取节点的父、子、兄弟、在父中的索引，便于链表与队列
     * @param {Object} module - 故事模块
     * @param {string[]} pathIds - 节点路径
     * @returns {{ node, name, parent, parentPathIds, children, siblings, indexInParent, nextSibling, prevSibling }}
     */
    getModuleTreeRelations(module, pathIds) {
        const { node, name, parent } = this.getModuleNodeByPath(module, pathIds || []);
        const parentPathIds = pathIds && pathIds.length > 1 ? pathIds.slice(0, -1) : [];
        const parentNode = parentPathIds.length > 0 ? this.getModuleNodeByPath(module, parentPathIds).node : (module && module.content);
        const siblings = Array.isArray(parentNode && parentNode.subModules) ? this.getSubModulesInTypeOrder(parentNode.subModules) : [];
        const currentId = pathIds && pathIds.length > 0 ? pathIds[pathIds.length - 1] : null;
        const indexInParent = currentId != null ? siblings.findIndex((s) => (s.id || s.name) === currentId) : -1;
        const nextSibling = indexInParent >= 0 && indexInParent < siblings.length - 1 ? siblings[indexInParent + 1] : null;
        const prevSibling = indexInParent > 0 ? siblings[indexInParent - 1] : null;
        const children = Array.isArray(node.subModules) ? this.getSubModulesInTypeOrder(node.subModules) : [];
        return {
            node,
            name,
            parent: parentNode,
            parentPathIds,
            children,
            siblings,
            indexInParent,
            nextSibling,
            prevSibling
        };
    },

    /**
     * 链表下一项：同层按类型顺序的下一兄弟；若无兄弟则返回父的下一兄弟的首叶（用于链式推进）
     * @param {Object} module - 故事模块
     * @param {string[]} pathIds - 当前节点路径
     * @returns {{ pathIds: string[], node: Object }|null} 下一叶子路径与节点，无则 null
     */
    getNextInChain(module, pathIds) {
        if (!module || !module.content || !Array.isArray(pathIds) || pathIds.length === 0) return null;
        const rel = this.getModuleTreeRelations(module, pathIds);
        if (rel.nextSibling) {
            const nextId = rel.nextSibling.id || rel.nextSibling.name;
            const nextPath = rel.parentPathIds.concat(nextId);
            const leaf = this._getFirstLeafFrom(module, nextPath);
            return leaf ? { pathIds: leaf, node: this.getModuleNodeByPath(module, leaf).node } : null;
        }
        if (rel.parentPathIds.length === 0) return null;
        return this.getNextInChain(module, rel.parentPathIds);
    },

    _getFirstLeafFrom(module, pathIds) {
        const { node } = this.getModuleNodeByPath(module, pathIds);
        const sub = this.getSubModulesInTypeOrder(node.subModules || []);
        if (sub.length === 0) return pathIds;
        const first = sub[0];
        const id = first.id || first.name;
        return this._getFirstLeafFrom(module, pathIds.concat(id));
    },

    /**
     * 某路径下所有叶子路径（用于并行分支、队列候选）
     * @param {Object} module - 故事模块
     * @param {string[]} pathIds - 从该节点起
     * @returns {string[][]} 叶子路径数组
     */
    getLeavesUnder(module, pathIds) {
        const out = [];
        const { node } = this.getModuleNodeByPath(module, pathIds || []);
        const sub = this.getSubModulesInTypeOrder(node.subModules || []);
        if (sub.length === 0) {
            if (pathIds && pathIds.length > 0) out.push(pathIds);
            return out;
        }
        sub.forEach((n) => {
            const id = n.id || n.name;
            if (id) out.push(...this.getLeavesUnder(module, (pathIds || []).concat(id)));
        });
        return out;
    },

    /**
     * 根下仅触发器链的叶子路径（按链顺序）
     */
    _getTriggerChainLeavesOrdered(module) {
        if (!module || !module.content) return [];
        const sub = this.getSubModulesInTypeOrder(module.content.subModules || []);
        const triggerChain = sub.filter((n) => n.type === 'trigger_chain' && n.flowRole !== 'parallel');
        const out = [];
        triggerChain.forEach((n) => {
            const id = n.id || n.name;
            if (id) out.push(...this.getLeavesUnder(module, [id]));
        });
        return out;
    },

    /**
     * 根下仅触发器链的顶层节点（按链顺序），用于按「当前模块 + 满足条件的下一模块」限定队列
     */
    _getTriggerChainTopLevelNodes(module) {
        if (!module || !module.content) return [];
        const sub = this.getSubModulesInTypeOrder(module.content.subModules || []);
        return sub.filter((n) => n.type === 'trigger_chain' && n.flowRole !== 'parallel').map((n) => ({ id: n.id || n.name, node: n }));
    },

    /**
     * 构建主推进队列：一般只看到自己模块内的队列；下一模块的 leaf 仅当其进入条件满足时才入队。
     * 触发器链按「顶层阶段」分组：当前所在阶段内的 leaf 全量可见（未完成且满足进入条件）；之后阶段仅当该阶段顶层 enterRule 满足时才可见其 leaf。
     * 时间线在「当前触发器后一位」插入；自由触发器优先级低于时间线，满足时入队。并行见 buildParallelQueues。
     * @returns {Array<{ type: 'module'|'timeline_event', pathIds?, eventId?, name?, content? }>}
     */
    buildProgressionQueue(module, vars, writeToState) {
        if (!module || !module.content) return [];
        const variables = vars != null ? vars : (typeof State !== 'undefined' && State.variables ? State.variables : {});
        const currentTriggerPath = (typeof State !== 'undefined' && State.currentModulePath && State.currentModulePath[0] && State.currentModulePath[0].length > 0)
            ? State.currentModulePath[0] : null;
        const currentTimelineId = typeof State !== 'undefined' ? State.currentTimelineEventId : null;
        const currentUnorderedPath = (typeof State !== 'undefined' && State.currentUnorderedPath && State.currentUnorderedPath.length > 0) ? State.currentUnorderedPath : null;

        const completedMap = (typeof State !== 'undefined' && State.flowNodeCompleted && State.flowNodeCompleted[module.id]) ? State.flowNodeCompleted[module.id] : {};
        const topLevelNodes = this._getTriggerChainTopLevelNodes(module);
        const triggerList = [];
        let currentStageIndex = 0;
        if (currentTriggerPath && currentTriggerPath.length > 0) {
            const firstId = currentTriggerPath[0];
            const idx = topLevelNodes.findIndex((t) => t.id === firstId);
            if (idx >= 0) currentStageIndex = idx;
        }
        for (let i = 0; i < topLevelNodes.length; i++) {
            const top = topLevelNodes[i];
            if (!top.id) continue;
            const isCurrentStage = (i === currentStageIndex);
            const topEnterCond = this.getEnterConditionForNode(top.node, module.content);
            const canSeeStage = isCurrentStage || this._evaluateCondition(topEnterCond, variables, module);
            if (!canSeeStage) break;
            const leaves = this.getLeavesUnder(module, [top.id]);
            leaves.forEach((pathIds) => {
                const key = pathIds.join('|');
                if (completedMap[key]) return;
                const { node } = this.getModuleNodeByPath(module, pathIds);
                const enterCond = this.getEnterConditionForNode(node, module.content);
                if (this._evaluateCondition(enterCond, variables, module))
                    triggerList.push({ type: 'module', pathIds, name: this.getModuleNodeByPath(module, pathIds).name });
            });
        }

        const pendingTimeline = this.getTriggeredTimelineEvents(module, variables) || [];
        const timelineItems = pendingTimeline.map((ev) => ({
            type: 'timeline_event',
            eventId: ev.id || ev.name,
            name: ev.name || ev.id,
            content: ev.content || ''
        }));

        const freeItems = [];
        const sub = this.getSubModulesInTypeOrder(module.content.subModules || []);
        const unordered = sub.filter((n) => n.type === 'unordered' || n.type === 'free_trigger');
        unordered.forEach((u) => {
            const enterCond = this.getEnterConditionForNode(u, module.content);
            if (enterCond == null) return;
            if (!this._evaluateCondition(enterCond, variables, module)) return;
            const pathKey = u.id || u.name;
            if (!pathKey) return;
            this.getLeavesUnder(module, [pathKey]).forEach((pathIds) => {
                freeItems.push({ type: 'module', pathIds, name: this.getModuleNodeByPath(module, pathIds).name });
            });
        });

        const seen = new Set();
        const dedup = (arr) => arr.filter((item) => {
            const key = item.type === 'timeline_event' ? 'ev:' + (item.eventId || '') : (item.pathIds && item.pathIds.join('|')) || '';
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        const mainQueue = [];

        const currentIsTrigger = currentTriggerPath && triggerList.some((t) => t.pathIds && t.pathIds.length === currentTriggerPath.length && t.pathIds.every((id, i) => id === currentTriggerPath[i]));
        const triggerIdx = currentTriggerPath ? triggerList.findIndex((t) => t.pathIds && t.pathIds.length === currentTriggerPath.length && t.pathIds.every((id, i) => id === currentTriggerPath[i])) : -1;

        if (currentIsTrigger && triggerIdx >= 0) {
            for (let i = 0; i <= triggerIdx; i++) mainQueue.push(triggerList[i]);
            mainQueue.push(...dedup(freeItems));
            mainQueue.push(...dedup(timelineItems));
            for (let i = triggerIdx + 1; i < triggerList.length; i++) mainQueue.push(triggerList[i]);
        } else {
            mainQueue.push(...dedup(freeItems));
            mainQueue.push(...dedup(timelineItems));
            mainQueue.push(...triggerList);
        }

        if (writeToState && typeof State !== 'undefined') State.progressionQueue = mainQueue;
        return mainQueue;
    },

    /**
     * 当前队列：完成当前模块即满足所有触发条件的后续项（不含当前模块）。仅包含「条件已全部满足」的触发器链叶子 + 已触发的时间线事件。空则表示将进入 floating。
     * 未达成变量要求的下一项放在预期队列并标注未满足条件。
     * @param {Object} module - 故事模块
     * @param {Object} [vars] - 变量
     * @returns {Array<{ type: 'module'|'timeline_event', pathIds?: string[], name: string, eventId?: string }>}
     */
    buildCurrentQueue(module, vars) {
        if (!module || !module.content) return [];
        const variables = vars != null ? vars : (typeof State !== 'undefined' && State.variables ? State.variables : {});
        const currentTriggerPath = (typeof State !== 'undefined' && State.currentModulePath && State.currentModulePath[0] && State.currentModulePath[0].length > 0)
            ? State.currentModulePath[0] : null;
        const topLevelNodes = this._getTriggerChainTopLevelNodes(module);

        const list = [];
        if (currentTriggerPath && currentTriggerPath.length > 0 && topLevelNodes.some((t) => t.id === currentTriggerPath[0])) {
            const baseCompleted = (typeof State !== 'undefined' && State.flowNodeCompleted && State.flowNodeCompleted[module.id]) ? State.flowNodeCompleted[module.id] : {};
            const currentKey = currentTriggerPath.join('|');
            const simulatedCompleted = { ...baseCompleted, [currentKey]: true };

            let prevPath = currentTriggerPath;
            let next = this.getNextInChain(module, currentTriggerPath);
            while (next && next.pathIds) {
                const prevNode = this.getModuleNodeByPath(module, prevPath).node;
                const endCond = this.getEndConditionForNode(prevNode, module.content);
                const conditionToUse = endCond != null ? endCond : this.getEnterConditionForNode(next.node, module.content);
                const topLevelEnterCond = this._getTopLevelEnterConditionIfDifferentModule(module, prevPath, next.pathIds);
                const passTransition = this._evaluateCondition(conditionToUse, variables, module, simulatedCompleted);
                const passTopLevel = topLevelEnterCond == null || this._evaluateCondition(topLevelEnterCond, variables, module, simulatedCompleted);
                // 跨大模块跳转的路线提示：只给下一目标的名字，不深挖目标内部子节点
                // 即遇到跨大模块时允许 push 一次（列入名字），紧接着 break，避免暴露下一大模块的链内细节
                const crossesTopLevel = prevPath && next.pathIds && prevPath[0] !== next.pathIds[0];
                if (passTransition && passTopLevel) {
                    list.push({ type: 'module', pathIds: next.pathIds, name: next.node && (next.node.name || next.pathIds[next.pathIds.length - 1]) });
                    if (crossesTopLevel) break;
                    simulatedCompleted[next.pathIds.join('|')] = true;
                    prevPath = next.pathIds;
                    next = this.getNextInChain(module, next.pathIds);
                } else {
                    break;
                }
            }
        }

        const pendingTimeline = this.getTriggeredTimelineEvents(module, variables) || [];
        const currentTimelineId = typeof State !== 'undefined' ? State.currentTimelineEventId : null;
        for (const ev of pendingTimeline) {
            const eid = ev.id || ev.name;
            if (currentTimelineId && eid === currentTimelineId) continue;
            list.push({
                type: 'timeline_event',
                eventId: eid,
                name: ev.name || eid,
                content: ev.content || ''
            });
        }
        return list;
    },

    /**
     * 并行队列：每个满足进入条件的并行组一条独立队列；完成与主队列无关。
     * @returns {{ [pathKey: string]: Array<{ type: string, pathIds?: string[], name?: string }> }}
     */
    buildParallelQueues(module, vars) {
        if (!module || !module.content) return {};
        const variables = vars != null ? vars : (typeof State !== 'undefined' && State.variables ? State.variables : {});
        const sub = this.getSubModulesInTypeOrder(module.content.subModules || []);
        const parallel = sub.filter((n) => n.flowRole === 'parallel');
        const out = {};
        parallel.forEach((p) => {
            const enterCond = this.getEnterConditionForNode(p, module.content);
            if (!this._evaluateCondition(enterCond, variables, module)) return;
            const pathKey = p.id || p.name;
            if (!pathKey) return;
            const currentParallel = (typeof State !== 'undefined' && State.currentParallelPaths && State.currentParallelPaths[pathKey]) ? State.currentParallelPaths[pathKey] : null;
            const leaves = this.getLeavesUnder(module, [pathKey]);
            const list = [];
            if (currentParallel && currentParallel.length > 0) {
                list.push({ type: 'module', pathIds: currentParallel, name: this.getModuleNodeByPath(module, currentParallel).name });
                const next = this.getNextInChain(module, currentParallel);
                if (next && next.pathIds) {
                    const enter = this.getEnterConditionForNode(next.node, module.content);
                    if (this._evaluateCondition(enter, variables, module))
                        list.push({ type: 'module', pathIds: next.pathIds, name: next.node && (next.node.name || next.pathIds[next.pathIds.length - 1]) });
                }
            } else if (leaves.length > 0) {
                const first = leaves[0];
                const { node } = this.getModuleNodeByPath(module, first);
                if (this._evaluateCondition(this.getEnterConditionForNode(node, module.content), variables, module))
                    list.push({ type: 'module', pathIds: first, name: this.getModuleNodeByPath(module, first).name });
            }
            if (list.length > 0) out[pathKey] = list;
        });
        return out;
    },

    /**
     * 预期队列：完成当前模块后，变量达成即可进入的「下一个」模块（目前变量未达成，并标注未满足条件）+ 未来的最新一个时间线。不跳序。
     * @param {Object} module - 故事模块
     * @param {Object} [vars] - 变量
     * @returns {Array<{ type: string, name?: string, pathIds?: string[], eventId?: string, source: 'main'|'parallel', parallelPathKey?: string, unmetConditionLabel?: string }>}
     */
    /**
   * 路线提示（仅名字）：只给当前及之后几个事件的名字作路线，让 AI 知道往哪走、不乱走
     * 从 currentTriggerPath 沿 chain.next 走最多 maxN 步，所有节点都列出，不 check 进入条件（避免 cultivation 不到 10 就把整条路线砍掉）。
     * 跨大模块也只列名字，不暴露目标内部细节。
     * @param {Object} module
     * @param {number} maxN - 最多几步，默认 4
     * @returns {string[]} 事件名字数组
     */
    buildUpcomingRoute(module, maxN) {
        const max = typeof maxN === 'number' && maxN > 0 ? maxN : 4;
        if (!module || !module.content) return [];
        const currentTriggerPath = (typeof State !== 'undefined' && State.currentModulePath && State.currentModulePath[0] && State.currentModulePath[0].length > 0)
            ? State.currentModulePath[0] : null;
        if (!currentTriggerPath) return [];
        const topLevelNodes = this._getTriggerChainTopLevelNodes(module);
        if (!topLevelNodes.some((t) => t.id === currentTriggerPath[0])) return [];
        const names = [];
        let cur = currentTriggerPath;
        for (let i = 0; i < max; i++) {
            const r = this.getNextInChain(module, cur);
            if (!r || !r.pathIds) break;
            const nm = r.node && (r.node.name || r.pathIds[r.pathIds.length - 1]);
            if (!nm) break;
            names.push(nm);
            cur = r.pathIds;
        }
        return names;
    },

    buildExpectedQueue(module, vars) {
        if (!module || !module.content) return [];
        const variables = vars != null ? vars : (typeof State !== 'undefined' && State.variables ? State.variables : {});
        const currentTriggerPath = (typeof State !== 'undefined' && State.currentModulePath && State.currentModulePath[0] && State.currentModulePath[0].length > 0)
            ? State.currentModulePath[0] : null;
        const topLevelNodes = this._getTriggerChainTopLevelNodes(module);
        const mainExpected = [];

        if (currentTriggerPath && currentTriggerPath.length > 0 && topLevelNodes.some((t) => t.id === currentTriggerPath[0])) {
            const baseCompleted = (typeof State !== 'undefined' && State.flowNodeCompleted && State.flowNodeCompleted[module.id]) ? State.flowNodeCompleted[module.id] : {};
            const currentKey = currentTriggerPath.join('|');
            const simulatedCompleted = { ...baseCompleted, [currentKey]: true };
            let prevPath = currentTriggerPath;
            let next = this.getNextInChain(module, currentTriggerPath);
            while (next && next.pathIds) {
                const prevNode = this.getModuleNodeByPath(module, prevPath).node;
                const endCond = this.getEndConditionForNode(prevNode, module.content);
                const conditionToUse = endCond != null ? endCond : this.getEnterConditionForNode(next.node, module.content);
                const topLevelEnterCond = this._getTopLevelEnterConditionIfDifferentModule(module, prevPath, next.pathIds);
                const passTransition = this._evaluateCondition(conditionToUse, variables, module, simulatedCompleted);
                const passTopLevel = topLevelEnterCond == null || this._evaluateCondition(topLevelEnterCond, variables, module, simulatedCompleted);
                if (passTransition && passTopLevel) {
                    simulatedCompleted[next.pathIds.join('|')] = true;
                    prevPath = next.pathIds;
                    next = this.getNextInChain(module, next.pathIds);
                } else {
                    const unmetParts = this._getUnmetConditionParts(conditionToUse, variables, module, simulatedCompleted);
                    if (topLevelEnterCond != null && !passTopLevel) {
                        const topUnmet = this._getUnmetConditionParts(topLevelEnterCond, variables, module, simulatedCompleted);
                        if (topUnmet.length) unmetParts.push('大模块进入：' + topUnmet.join('；'));
                    }
                    mainExpected.push({
                        type: 'module',
                        pathIds: next.pathIds,
                        name: next.node && (next.node.name || next.pathIds[next.pathIds.length - 1]),
                        source: 'main',
                        unmetConditionLabel: unmetParts.length ? unmetParts.join('；') : '条件未满足'
                    });
                    break;
                }
            }
        }

        const pendingTimeline = this.getTriggeredTimelineEvents(module, variables) || [];
        const currentTimelineId = typeof State !== 'undefined' ? State.currentTimelineEventId : null;
        const nextTimeline = pendingTimeline.find((ev) => (ev.id || ev.name) !== currentTimelineId);
        if (nextTimeline) {
            mainExpected.push({
                type: 'timeline_event',
                eventId: nextTimeline.id || nextTimeline.name,
                name: nextTimeline.name || nextTimeline.id,
                content: nextTimeline.content || '',
                source: 'main'
            });
        } else {
            const events = Array.isArray(module.content.timelineEvents) ? module.content.timelineEvents : [];
            const triggered = (typeof State !== 'undefined' && State.triggeredTimelineEvents && State.triggeredTimelineEvents[module.id]) ? State.triggeredTimelineEvents[module.id] : {};
            const firstUnmet = events.find((ev) => {
                const eid = ev.id || ev.name;
                if (!eid || ev.trigger !== 'calendar') return false;
                if (triggered[eid] === true) return false;
                return !this._evaluateTimelineCondition(ev.condition, variables, module);
            });
            if (firstUnmet) {
                const eid = firstUnmet.id || firstUnmet.name;
                const timelineUnmet = [];
                if (firstUnmet.condition && typeof firstUnmet.condition === 'object') {
                    const timeVarId = this._getTimeVarId(module);
                    const getVal = (v, k) => (typeof getVariableValue === 'function' ? getVariableValue(v, k, timeVarId) : v[k]);
                    for (const [key, want] of Object.entries(firstUnmet.condition)) {
                        const got = getVal(variables, key);
                        if (got !== want && got != want) timelineUnmet.push('变量「' + key + '」需 = ' + want + '（当前 ' + got + '）');
                    }
                }
                mainExpected.push({
                    type: 'timeline_event',
                    eventId: eid,
                    name: firstUnmet.name || eid,
                    content: firstUnmet.content || '',
                    source: 'main',
                    unmetConditionLabel: timelineUnmet.length ? timelineUnmet.join('；') : '时间线条件未满足'
                });
            }
        }

        const parallelExpected = [];
        const sub = this.getSubModulesInTypeOrder(module.content.subModules || []);
        const parallelNodes = sub.filter((n) => n.flowRole === 'parallel');
        parallelNodes.forEach((p) => {
            const pathKey = p.id || p.name;
            if (!pathKey) return;
            const enterCond = this.getEnterConditionForNode(p, module.content);
            if (!this._evaluateCondition(enterCond, variables, module)) return;
            const currentParallel = (typeof State !== 'undefined' && State.currentParallelPaths && State.currentParallelPaths[pathKey]) ? State.currentParallelPaths[pathKey] : null;
            const startPath = currentParallel && currentParallel.length > 0 ? currentParallel : (this.getLeavesUnder(module, [pathKey])[0] || null);
            if (!startPath) return;
            const baseCompleted = (typeof State !== 'undefined' && State.flowNodeCompleted && State.flowNodeCompleted[module.id]) ? State.flowNodeCompleted[module.id] : {};
            const simCompleted = { ...baseCompleted, [startPath.join('|')]: true };
            let prevPath = startPath;
            let next = this.getNextInChain(module, startPath);
            while (next && next.pathIds) {
                const prevNode = this.getModuleNodeByPath(module, prevPath).node;
                const endCond = this.getEndConditionForNode(prevNode, module.content);
                const conditionToUse = endCond != null ? endCond : this.getEnterConditionForNode(next.node, module.content);
                if (this._evaluateCondition(conditionToUse, variables, module, simCompleted)) {
                    simCompleted[next.pathIds.join('|')] = true;
                    prevPath = next.pathIds;
                    next = this.getNextInChain(module, next.pathIds);
                } else {
                    const unmetParts = this._getUnmetConditionParts(conditionToUse, variables, module, simCompleted);
                    parallelExpected.push({
                        type: 'module',
                        pathIds: next.pathIds,
                        name: next.node && (next.node.name || next.pathIds[next.pathIds.length - 1]),
                        source: 'parallel',
                        parallelPathKey: pathKey,
                        unmetConditionLabel: unmetParts.length ? unmetParts.join('；') : '条件未满足'
                    });
                    break;
                }
            }
        });

        return [...mainExpected, ...parallelExpected];
    },

    /**
     * 仅求值条件中的变量部分（module/time/timeRange/tag/stage_completed/event_completed 视为通过），用于判断「可能队列」中变量已达成但还差模块/时间完成。
     */
    _evaluateVariablePartOnly(condition, vars) {
        if (!condition) return true;
        if (condition && typeof condition === 'object' && Array.isArray(condition.conditions)) {
            const vals = condition.conditions.map((c) => this._evaluateVariablePartOnly(c, vars));
            return (condition.logic || 'AND').toLowerCase() === 'or' ? vals.some(Boolean) : vals.every(Boolean);
        }
        if (Array.isArray(condition)) return condition.every((c) => this._evaluateVariablePartOnly(c, vars));
        if (condition.type === 'none' || condition.type === 'stage_completed' || condition.type === 'event_completed' ||
            condition.type === 'module' || condition.type === 'time' || condition.type === 'timeRange' || condition.type === 'tag') return true;
        if (condition.type !== 'variable' || !condition.variableId) return true;
        const left = typeof getVariableValue === 'function' ? getVariableValue(vars, condition.variableId) : vars[condition.variableId];
        const right = condition.value;
        const op = condition.operator;
        // 2026-06-05：boolean coerce 'true'/'false' 字符串 → bool（condition-builder 保存为字符串，varValue 是 boolean）；同 [[condition-compare-type-coerce-2026-06-05]] pattern
        const coerceBool = (v) => v === 'true' ? true : v === 'false' ? false : v;
        if (op === 'in' && Array.isArray(right)) return right.some((v) => v == left) || right.includes(left);
        switch (op) {
            case '==': return coerceBool(left) == coerceBool(right);
            case '!=': return coerceBool(left) != coerceBool(right);
            case '>': return Number(left) > Number(right);
            case '>=': return Number(left) >= Number(right);
            case '<': return Number(left) < Number(right);
            case '<=': return Number(left) <= Number(right);
            default: return false;
        }
    },

    /**
     * 可能队列：变量已达成但完成当前模块也不会进入的模块（还差模块完成）+ 同根下的分流程/自由触发器。
     * @param {Object} module - 故事模块
     * @param {Object} [vars] - 变量
     * @returns {Array<{ type: string, pathIds?: string[], name?: string, flowName?: string }>}
     */
    buildPossibleQueue(module, vars) {
        if (!module || !module.content) return [];
        const variables = vars != null ? vars : (typeof State !== 'undefined' && State.variables ? State.variables : {});
        const completedMap = (typeof State !== 'undefined' && State.flowNodeCompleted && State.flowNodeCompleted[module.id]) ? State.flowNodeCompleted[module.id] : {};
        const currentTriggerPath = (typeof State !== 'undefined' && State.currentModulePath && State.currentModulePath[0] && State.currentModulePath[0].length > 0)
            ? State.currentModulePath[0] : null;
        const currentQueue = this.buildCurrentQueue(module, variables);
        const expectedMain = this.buildExpectedQueue(module, variables).filter((e) => e.source === 'main' && e.type === 'module');
        const currentKeySet = new Set(currentQueue.map((q) => q.pathIds && q.pathIds.join('|')));
        const expectedKeySet = new Set(expectedMain.map((e) => e.pathIds && e.pathIds.join('|')));

        const possible = [];
        const topLevelNodes = this._getTriggerChainTopLevelNodes(module);
        let currentStageIndex = 0;
        if (currentTriggerPath && currentTriggerPath.length > 0) {
            const idx = topLevelNodes.findIndex((t) => t.id === currentTriggerPath[0]);
            if (idx >= 0) currentStageIndex = idx;
        }
        for (let i = currentStageIndex; i < Math.min(currentStageIndex + 2, topLevelNodes.length); i++) {
            const top = topLevelNodes[i];
            if (!top.id) continue;
            const leaves = this.getLeavesUnder(module, [top.id]);
            for (const pathIds of leaves) {
                const key = pathIds.join('|');
                if (completedMap[key]) continue;
                if (currentKeySet.has(key) || expectedKeySet.has(key)) continue;
                const { node } = this.getModuleNodeByPath(module, pathIds);
                const enterCond = this.getEnterConditionForNode(node, module.content);
                if (this._evaluateCondition(enterCond, variables, module)) continue;
                if (this._evaluateVariablePartOnly(enterCond, variables))
                    possible.push({ type: 'module', pathIds, name: this.getModuleNodeByPath(module, pathIds).name });
            }
        }

        const sub = this.getSubModulesInTypeOrder(module.content.subModules || []);
        const parallelNodes = sub.filter((n) => n.flowRole === 'parallel');
        parallelNodes.forEach((p) => {
            const pathKey = p.id || p.name;
            if (!pathKey) return;
            const enterCond = this.getEnterConditionForNode(p, module.content);
            if (!this._evaluateCondition(enterCond, variables, module)) return;
            const flowName = p.flowName || p.name || p.id;
            const leaves = this.getLeavesUnder(module, [pathKey]);
            const first = leaves[0];
            if (first) possible.push({ type: 'module', pathIds: first, name: this.getModuleNodeByPath(module, first).name, flowName });
        });

        const unordered = sub.filter((n) => n.type === 'unordered' || n.type === 'free_trigger');
        unordered.forEach((u) => {
            const enterCond = this.getEnterConditionForNode(u, module.content);
            if (enterCond == null || !this._evaluateCondition(enterCond, variables, module)) return;
            const pathKey = u.id || u.name;
            if (!pathKey) return;
            this.getLeavesUnder(module, [pathKey]).forEach((pathIds) => {
                const key = pathIds.join('|');
                if (!completedMap[key]) possible.push({ type: 'module', pathIds, name: this.getModuleNodeByPath(module, pathIds).name });
            });
        });

        return possible;
    },

    /**
     * 分流程队列：与当前队列逻辑相同，但针对每个分流程独立计算「完成该分流程当前节点即满足的后续叶」，并带分流程名。
     * @param {Object} module - 故事模块
     * @param {Object} [vars] - 变量
     * @returns {{ [flowKey: string]: { flowName: string, queue: Array<{ type: 'module', pathIds: string[], name: string }> } }}
     */
    buildBranchFlowQueues(module, vars) {
        if (!module || !module.content) return {};
        const variables = vars != null ? vars : (typeof State !== 'undefined' && State.variables ? State.variables : {});
        const sub = this.getSubModulesInTypeOrder(module.content.subModules || []);
        const parallelNodes = sub.filter((n) => n.flowRole === 'parallel');
        const out = {};
        parallelNodes.forEach((p) => {
            const pathKey = p.id || p.name;
            if (!pathKey) return;
            const enterCond = this.getEnterConditionForNode(p, module.content);
            if (!this._evaluateCondition(enterCond, variables, module)) return;
            const flowName = p.flowName || p.name || pathKey;
            const currentParallel = (typeof State !== 'undefined' && State.currentParallelPaths && State.currentParallelPaths[pathKey]) ? State.currentParallelPaths[pathKey] : null;
            const leaves = this.getLeavesUnder(module, [pathKey]);
            const startPath = currentParallel && currentParallel.length > 0 ? currentParallel : (leaves[0] || null);
            let list = [];
            let parallelOptions = false;
            if (!startPath) {
                out[pathKey] = { flowName, queue: [], parallelOptions: false };
                return;
            }
            if (!currentParallel || currentParallel.length === 0) {
                if (leaves.length > 1) {
                    list = leaves.map((pathIds) => ({
                        type: 'module',
                        pathIds,
                        name: this.getModuleNodeByPath(module, pathIds).name || pathIds[pathIds.length - 1]
                    }));
                    parallelOptions = true;
                }
            }
            if (!parallelOptions) {
                const baseCompleted = (typeof State !== 'undefined' && State.flowNodeCompleted && State.flowNodeCompleted[module.id]) ? State.flowNodeCompleted[module.id] : {};
                const currentKey = startPath.join('|');
                // 若分流程还未进入（currentParallel 为空且 startPath 也未在 completed 中），把 startPath 自身列为可进入项；
                // 之前逻辑直接 simulatedCompleted[currentKey]=true 跳过 startPath，导致单节点分流程（如 npc_flows 只有 npc_dynamic）永远 queue 空，
                // AI 看不到该分流程任何可进入项 → 无法 enter，整条分流程失效
                const startNotEntered = (!currentParallel || currentParallel.length === 0) && !baseCompleted[currentKey];
                if (startNotEntered) {
                    const startNode = this.getModuleNodeByPath(module, startPath).node;
                    const startEnterCond = this.getEnterConditionForNode(startNode, module.content);
                    if (this._evaluateCondition(startEnterCond, variables, module, baseCompleted)) {
                        list.push({ type: 'module', pathIds: startPath, name: startNode && (startNode.name || startPath[startPath.length - 1]) });
                    }
                }
                const simulatedCompleted = { ...baseCompleted, [currentKey]: true };
                let prevPath = startPath;
                let next = this.getNextInChain(module, startPath);
                while (next && next.pathIds) {
                    const prevNode = this.getModuleNodeByPath(module, prevPath).node;
                    const endCond = this.getEndConditionForNode(prevNode, module.content);
                    const conditionToUse = endCond != null ? endCond : this.getEnterConditionForNode(next.node, module.content);
                    if (this._evaluateCondition(conditionToUse, variables, module, simulatedCompleted)) {
                        list.push({ type: 'module', pathIds: next.pathIds, name: next.node && (next.node.name || next.pathIds[next.pathIds.length - 1]) });
                        simulatedCompleted[next.pathIds.join('|')] = true;
                        prevPath = next.pathIds;
                        next = this.getNextInChain(module, next.pathIds);
                    } else break;
                }
            }
            out[pathKey] = { flowName, queue: list, parallelOptions };
        });
        return out;
    },

    /**
     * 当不处于任何模块时显示的「上一级阶段」名。取最后已完成的触发器路径的父节点名，若无则取第一个触发器链名。
     * @param {Object} module - 故事模块
     * @returns {string} 阶段名，无则空字符串
     */
    getParentStageDisplay(module) {
        if (!module || !module.content) return '';
        const completedMap = (typeof State !== 'undefined' && State.flowNodeCompleted && State.flowNodeCompleted[module.id]) ? State.flowNodeCompleted[module.id] : {};
        const triggerLeaves = this._getTriggerChainLeavesOrdered(module);
        let lastCompletedPath = null;
        for (let i = triggerLeaves.length - 1; i >= 0; i--) {
            const key = triggerLeaves[i].join('|');
            if (completedMap[key]) {
                lastCompletedPath = triggerLeaves[i];
                break;
            }
        }
        if (lastCompletedPath && lastCompletedPath.length > 0) {
            const parentPath = lastCompletedPath.slice(0, -1);
            if (parentPath.length > 0) {
                const { name } = this.getModuleNodeByPath(module, parentPath);
                return name || parentPath[parentPath.length - 1] || '';
            }
        }
        const sub = this.getSubModulesInTypeOrder(module.content.subModules || []);
        const firstTrigger = sub.find((n) => n.type === 'trigger_chain');
        return (firstTrigger && (firstTrigger.name || firstTrigger.id)) || '';
    },

    /**
     * 未入队列列表（用于调试检查）：条件未达成而未排入总队列的候选项。
     * @param {Object} module - 故事模块
     * @param {Object} [vars] - 变量
     * @param {Array} [queue] - 已构建的 progressionQueue，不传则内部 build 一次
     * @returns {Array<{ type: string, name: string, pathIds?: string[], eventId?: string, reason: string }>}
     */
    buildNotInQueue(module, vars, queue) {
        if (!module || !module.content) return [];
        const variables = vars != null ? vars : (typeof State !== 'undefined' && State.variables ? State.variables : {});
        const list = Array.isArray(queue) ? queue : this.buildProgressionQueue(module, variables);
        const inSet = new Set();
        list.forEach((e) => {
            if (e.type === 'module' && Array.isArray(e.pathIds)) inSet.add(e.pathIds.join('|'));
            if (e.type === 'timeline_event' && e.eventId) inSet.add('ev:' + e.eventId);
        });
        const notInQueue = [];
        const sub = Array.isArray(module.content.subModules) ? module.content.subModules : [];
        const unordered = sub.filter((n) => n.type === 'unordered');
        unordered.forEach((u) => {
            const pathKey = u.id || u.name;
            if (!pathKey) return;
            const enterCond = this.getEnterConditionForNode(u, module.content);
            if (enterCond == null) {
                const leaves = this.getLeavesUnder(module, [pathKey]);
                leaves.forEach((pathIds) => {
                    const key = pathIds.join('|');
                    if (!inSet.has(key)) notInQueue.push({ type: 'module', name: this.getModuleNodeByPath(module, pathIds).name || pathKey, pathIds, reason: '无进入条件' });
                });
                return;
            }
            if (!this._evaluateCondition(enterCond, variables, module)) {
                const leaves = this.getLeavesUnder(module, [pathKey]);
                leaves.forEach((pathIds) => {
                    const key = pathIds.join('|');
                    if (!inSet.has(key)) notInQueue.push({ type: 'module', name: this.getModuleNodeByPath(module, pathIds).name || pathKey, pathIds, reason: '进入条件未满足' });
                });
            }
        });
        const events = Array.isArray(module.content.timelineEvents) ? module.content.timelineEvents : [];
        const pending = this.getTriggeredTimelineEvents(module, variables);
        const pendingIds = new Set((pending || []).map((e) => e.id));
        events.forEach((ev) => {
            const id = ev.id || ev.name;
            if (!id || inSet.has('ev:' + id)) return;
            if (!pendingIds.has(id)) notInQueue.push({ type: 'timeline_event', name: ev.name || id, eventId: id, reason: '条件未满足' });
        });
        const parallel = sub.filter((n) => n.flowRole === 'parallel');
        parallel.forEach((p) => {
            const pathKey = p.id || p.name;
            if (!pathKey) return;
            const enterCond = this.getEnterConditionForNode(p, module.content);
            if (enterCond == null || !this._evaluateCondition(enterCond, variables, module)) {
                const leaves = this.getLeavesUnder(module, [pathKey]);
                const flowName = p.flowName || p.name || p.id;
                if (leaves.length > 0 && !inSet.has(leaves[0].join('|'))) notInQueue.push({ type: 'module', name: (p.name || p.id) + '（' + (flowName || '分流程') + '）', pathIds: leaves[0], reason: '进入条件未满足' });
            }
        });
        const triggerLeaves = this._getTriggerChainLeavesOrdered(module);
        triggerLeaves.forEach((pathIds) => {
            const key = pathIds.join('|');
            if (inSet.has(key)) return;
            const { node } = this.getModuleNodeByPath(module, pathIds);
            const enterCond = this.getEnterConditionForNode(node, module.content);
            if (enterCond == null) return;
            if (!this._evaluateCondition(enterCond, variables, module)) {
                const name = this.getModuleNodeByPath(module, pathIds).name || pathIds[pathIds.length - 1];
                notInQueue.push({ type: 'module', name, pathIds, reason: '上级阶段未达成要求' });
            }
        });
        return notInQueue;
    },

    /**
     * 触发器链中已完成的最后 N 个叶子路径（用于 floating 时「完成模块」展示）
     * @param {Object} module - 故事模块
     * @param {number} count - 数量
     * @returns {string[][]} pathIds 数组
     */
    getCompletedTriggerLeaves(module, count) {
        if (!module || !module.id || count <= 0) return [];
        const completedMap = (typeof State !== 'undefined' && State.flowNodeCompleted && State.flowNodeCompleted[module.id]) ? State.flowNodeCompleted[module.id] : {};
        const triggerLeaves = this._getTriggerChainLeavesOrdered(module);
        const completed = triggerLeaves.filter((pathIds) => completedMap[pathIds.join('|')]);
        const n = Math.min(count, completed.length);
        return n > 0 ? completed.slice(-n) : [];
    },

    /**
     * 已完成模组（用于展示）：通常为 1 个，即主线触发器链中最近完成的一个叶子。
     * @param {Object} module - 故事模块
     * @param {number} [count=1] - 展示数量
     * @returns {Array<{ type: 'module', pathIds: string[], name: string }>}
     */
    getCompletedForDisplay(module, count) {
        if (!module || !module.content) return [];
        const n = count != null && count > 0 ? count : 1;
        const pathIdsList = this.getCompletedTriggerLeaves(module, n);
        return pathIdsList.map((pathIds) => ({
            type: 'module',
            pathIds,
            name: this.getModuleNodeByPath(module, pathIds).name || pathIds[pathIds.length - 1]
        }));
    },

    /**
     * 按 stageDisplay 从队列中截取「完成 N / 当前 M / 未来 K」项。当前可由主路径、时间线、自由触发器表示；无主当前时可为 floating（上一级阶段），此时 current 为占位项、不在队列内。
     * @param {Object} module - 故事模块
     * @param {string[][]} pathIdsArray - 当前路径（单路径或多路径）
     * @param {Array} queue - progressionQueue 或 buildProgressionQueue 结果
     * @param {Object} stageDisplay - { before: N, after: M }
     * @param {Object} [opts] - { showFull, currentTimelineEventId, currentUnorderedPath }
     * @returns {{ before: Array, current: Array, after: Array, isFloating?: boolean }}
     */
    getQueueForStageDisplay(module, pathIdsArray, queue, stageDisplay, opts) {
        const { before = 0, after = 1 } = stageDisplay || {};
        const showFull = opts && opts.showFull === true;
        const paths = Array.isArray(pathIdsArray) && pathIdsArray.length > 0
            ? (Array.isArray(pathIdsArray[0]) ? pathIdsArray : [pathIdsArray])
            : [];
        const currentKey = paths.length > 0 && paths[0].length > 0 ? paths[0].join('|') : '';
        const currentTimelineId = (opts && opts.currentTimelineEventId != null) ? opts.currentTimelineEventId : (typeof State !== 'undefined' && State.currentTimelineEventId) ? State.currentTimelineEventId : null;
        const currentUnorderedKey = (opts && opts.currentUnorderedPath && opts.currentUnorderedPath.length > 0) ? opts.currentUnorderedPath.join('|') : (typeof State !== 'undefined' && State.currentUnorderedPath && State.currentUnorderedPath.length > 0) ? State.currentUnorderedPath.join('|') : '';
        const hasMainCurrent = currentKey || currentTimelineId || currentUnorderedKey;
        const list = Array.isArray(queue) ? queue : [];

        if (!hasMainCurrent) {
            const completedPathIds = this.getCompletedTriggerLeaves(module, before);
            const parentName = this.getParentStageDisplay(module);
            const beforeSlice = completedPathIds.map((pathIds) => ({ type: 'module', pathIds, name: this.getModuleNodeByPath(module, pathIds).name }));
            const current = parentName ? [{ type: 'floating', name: parentName }] : [];
            const afterLen = showFull ? list.length : Math.min(after, list.length);
            const afterSlice = afterLen > 0 ? list.slice(0, afterLen) : [];
            return { before: beforeSlice, current, after: afterSlice, isFloating: true };
        }

        let idx = list.findIndex((e) => {
            if (e.type === 'module' && Array.isArray(e.pathIds)) return e.pathIds.join('|') === currentKey || e.pathIds.join('|') === currentUnorderedKey;
            if (e.type === 'timeline_event' && currentTimelineId) return (e.eventId || '') === String(currentTimelineId);
            return false;
        });
        if (idx < 0 && currentTimelineId) idx = list.findIndex((e) => e.type === 'timeline_event' && (e.eventId || '') === String(currentTimelineId));
        if (idx < 0 && currentUnorderedKey) idx = list.findIndex((e) => e.type === 'module' && Array.isArray(e.pathIds) && e.pathIds.join('|') === currentUnorderedKey);
        if (idx < 0) idx = list.findIndex((e) => e.type === 'module' && Array.isArray(e.pathIds) && e.pathIds.join('|') === currentKey);
        const curIdx = idx >= 0 ? idx : 0;
        const beforeLen = showFull ? curIdx : Math.min(before, curIdx);
        const afterLen = showFull ? list.length - curIdx - 1 : Math.min(after, list.length - curIdx - 1);
        const beforeSlice = beforeLen > 0 ? list.slice(Math.max(0, curIdx - beforeLen), curIdx) : [];
        const afterSlice = afterLen > 0 ? list.slice(curIdx + 1, curIdx + 1 + afterLen) : [];
        const current = curIdx >= 0 && list[curIdx] ? [list[curIdx]] : [];
        return { before: beforeSlice, current, after: afterSlice, isFloating: false };
    },

    /**
     * 当前节点及 stageDisplay 下的前一/后一节点名（用于 prompt）
     * 若需按推进队列排序展示，可先 buildProgressionQueue 再 getQueueForStageDisplay(module, pathIds, queue, stageDisplay) 取 before/current/after 自行拼接。
     * @param {Object} module - 故事模块
     * @param {string[]} pathIds - State.currentModulePath
     * @param {Object} stageDisplay - { before: N, after: M }
     * @returns {string} 如 "当前模块：A，下一模块：B"（名称由模组配置决定）
     */
    getModuleStageText(module, pathIds, stageDisplay) {
        const { before = 0, after = 1 } = stageDisplay || {};
        if (!module || !module.content) return '';
        const sub = Array.isArray(module.content.subModules) ? module.content.subModules : [];
        if (sub.length === 0) return '';

        const flatList = [];
        function collect(nodes, depth) {
            nodes.forEach((n) => {
                flatList.push({ id: n.id || n.name, name: n.name || n.id || '未命名', depth });
                if (Array.isArray(n.subModules) && n.subModules.length) collect(n.subModules, depth + 1);
            });
        }
        collect(sub, 0);

        const currentId = pathIds && pathIds.length > 0 ? pathIds[pathIds.length - 1] : (flatList[0]?.id);
        const idx = flatList.findIndex((t) => t.id === currentId);
        if (idx < 0) return '';

        const prevIdx = idx - 1;
        const nextIdx = idx + 1;
        const prevName = prevIdx >= 0 && before > 0 ? flatList[prevIdx].name : null;
        const currName = flatList[idx].name;
        const nextName = nextIdx < flatList.length && after > 0 ? flatList[nextIdx].name : null;

        const parts = [];
        if (nextName) {
            parts.push(`当前处于【${currName}】阶段（本事件未完成）；下一阶段为【${nextName}】`);
        } else {
            parts.push(`当前处于【${currName}】阶段（本阶段为时间线末节）`);
        }
        return parts.join('，') + '。';
    },

    /**
     * 获取当前应发给 AI 的变量要求（前置条件已满足且未已投递的才返回）
     * 支持新格式：conditions + deliverMessage + addToModuleInfo（仅本模块及父级）；旧格式：triggerModuleId + deliveryText。
     * @returns {Array<{ moduleId: string, moduleName: string, pathIds: string[], requirement: object, reqIndex: number }>}
     */
    getPendingVariableRequirementsForPrompt() {
        const cur = this.currentModule;
        if (!cur || !cur.content) return [];
        const vars = typeof State !== 'undefined' && State.variables ? State.variables : {};
        const currentPaths = (typeof State !== 'undefined' && State.currentModulePath && Array.isArray(State.currentModulePath))
            ? (Array.isArray(State.currentModulePath[0]) ? State.currentModulePath : [State.currentModulePath])
            : [];
        if (!State.variableRequirementDelivered) State.variableRequirementDelivered = {};
        if (!State.variableRequirementDelivered[cur.id]) State.variableRequirementDelivered[cur.id] = {};
        const delivered = State.variableRequirementDelivered[cur.id];
        const out = [];
        const walk = (nodes, pathIds) => {
            (nodes || []).forEach((n) => {
                const id = n.id || n.name;
                if (!id) return;
                const ids = [...(pathIds || []), id];
                const pathKey = ids.join('|');
                const reqs = Array.isArray(n.variableRequirements) ? n.variableRequirements : [];
                reqs.forEach((r, reqIndex) => {
                    const deliveryKey = pathKey + '|' + reqIndex;
                    if (delivered[deliveryKey]) return;
                    const conds = Array.isArray(r.conditions) ? r.conditions : (r.condition != null ? [r.condition] : []);
                    const hasNewFormat = conds.length > 0 || r.deliverMessage != null || (Array.isArray(r.addToModuleInfo) && r.addToModuleInfo.length > 0);
                    if (hasNewFormat) {
                        if (conds.length > 0 && !this._evaluateCondition(conds.length === 1 ? conds[0] : conds, vars, cur)) return;
                        const text = r.deliverMessage || r.question || '需要确认';
                        out.push({
                            moduleId: cur.id,
                            moduleName: n.name || n.id || '',
                            pathIds: ids,
                            requirement: { ...r, question: text, deliverMessage: r.deliverMessage, addToModuleInfo: r.addToModuleInfo },
                            reqIndex
                        });
                        return;
                    }
                    if (r.condition && !this._evaluateCondition(r.condition, vars, cur)) return;
                    const triggerModuleId = r.triggerModuleId;
                    if (triggerModuleId) {
                        const resultPath = ids.concat(triggerModuleId);
                        const alreadyEntered = currentPaths.some((p) => Array.isArray(p) && resultPath.length <= p.length && resultPath.every((v, i) => p[i] === v));
                        if (alreadyEntered) return;
                    }
                    const triggerName = (n.name || n.id || '');
                    const nextName = triggerModuleId ? (this.getModuleNodeByPath(cur, triggerModuleId.indexOf('|') >= 0 ? triggerModuleId.split('|') : [triggerModuleId]).name || triggerModuleId) : '';
                    const displayId = r.displayVariableId || r.variableId;
                    const displayVal = displayId && typeof getVariableValue === 'function' ? getVariableValue(vars, displayId) : undefined;
                    let text = r.deliveryText || r.question;
                    if (!text) {
                        if (r.variableId == null && triggerModuleId && nextName) text = `是否结束【${triggerName}】进入【${nextName}】？`;
                        else if (displayId && triggerModuleId && nextName) {
                            const defs = this.getAllVariableDefs(cur);
                            const displayDef = defs.find((d) => d.id === displayId);
                            const displayName = (displayDef && displayDef.name) ? displayDef.name : displayId;
                            text = `【${displayName}】已达成（当前值 ${displayVal}），是否触发【${nextName}】？`;
                        } else if (displayId && triggerName) text = `【变量】已达成（当前值 ${displayVal}），是否触发【${triggerName}】？`;
                        else text = '需要确认';
                    }
                    out.push({
                        moduleId: cur.id,
                        moduleName: triggerName,
                        pathIds: ids,
                        requirement: { ...r, question: text },
                        reqIndex: reqIndex
                    });
                });
                walk(n.subModules || [], ids);
            });
        };
        walk(cur.content.subModules || [], []);
        return out;
    },

    /**
     * 获取当前路径下应发给 AI 的模块 info（节点 info + infoEntries，满足 condition 或 displayCondition 的条目）
     * 仅收集当前路径上各节点的 info 与 infoEntries，用于背景信息 prompt。
     * @param {Object} module - 当前故事模块
     * @param {string[]} pathIds - 当前模块路径
     * @param {Object} [vars] - 变量，默认 State.variables
     * @returns {string[]} 信息文本数组
     */
    getModuleInfoForPrompt(module, pathIds, vars) {
        if (!module || !module.content || !Array.isArray(pathIds)) return [];
        const variables = vars != null ? vars : (typeof State !== 'undefined' && State.variables ? State.variables : {});
        const out = [];
        let node = module.content;
        for (let i = 0; i < pathIds.length; i++) {
            const id = pathIds[i];
            const sub = node.subModules || node.moduleGroup || [];
            const found = sub.find((n) => (n.id || n.name) === id);
            if (!found) break;
            if (found.info && String(found.info).trim()) out.push(String(found.info).trim());
            const entries = Array.isArray(found.infoEntries) ? found.infoEntries : [];
            entries.forEach((entry) => {
                if (!entry || !entry.text) return;
                const cond = entry.condition != null ? entry.condition : entry.displayCondition;
                if (cond != null && !this._evaluateCondition(cond, variables, module)) return;
                out.push(String(entry.text).trim());
            });
            node = found;
        }
        return out;
    },

    /**
     * 获取当前应发给 AI 的投递信息（满足 condition 或 displayCondition 且尚未标记完成的条目）
     * 收集根 content.deliveryInfo 及当前路径上各节点的 deliveryInfo。
     * @param {Object} module - 当前故事模块
     * @param {string[]} pathIds - 当前模块路径
     * @param {Object} [vars] - 变量，默认 State.variables
     * @returns {Array<{ id: string, title: string, text: string }>}
     */
    getDeliveryInfoForPrompt(module, pathIds, vars) {
        if (!module || !module.content) return [];
        const variables = vars != null ? vars : (typeof State !== 'undefined' && State.variables ? State.variables : {});
        if (!State.deliveryCompleted) State.deliveryCompleted = {};
        if (!State.deliveryCompleted[module.id]) State.deliveryCompleted[module.id] = {};
        const completed = State.deliveryCompleted[module.id];
        const out = [];
        const add = (list, inModule) => {
            if (!Array.isArray(list)) return;
            list.forEach((item) => {
                // 模组数据正文字段统一是 content（模板 + 沧澜宗皆然），text 是历史别名兜底。
                const text = item.text != null ? item.text : (item.content != null ? item.content : '');
                // AI 端可见的握手 key（也是 filter 检索 key）：优先 title，没 title 才回退 id；
                // prompt 段发出去的、AI 回 <delivery_completed>/<delivery|done> 写的、filter 检查的，都用同一个 key，避免显式 id + title 两套键时永远过滤不掉的 latent bug。
                const key = item.title || item.id || '';
                if (!key) return;
                if (completed[key]) return;
                const cond = item.condition != null ? item.condition : item.displayCondition;
                if (cond != null && !this._evaluateCondition(cond, variables, module)) return;
                out.push({ id: key, title: key, text });
            });
        };
        add(module.content.deliveryInfo || [], true);
        const nodes = module.content.subModules || module.content.moduleGroup || [];
        const walk = (arr, prefix) => {
            (arr || []).forEach((n) => {
                const id = n.id || n.name;
                if (!id) return;
                const ids = [...(prefix || []), id];
                const isOnPath = pathIds.length >= ids.length && ids.every((x, i) => pathIds[i] === x);
                if (isOnPath && Array.isArray(n.deliveryInfo)) add(n.deliveryInfo, true);
                walk(n.subModules || n.moduleGroup || [], ids);
            });
        };
        walk(nodes, []);
        return out;
    },

    /**
     * 标记某条投递信息为已完成（AI 在 <delivery_completed> 中写 id\t完成 后调用）
     * @param {string} moduleId - 故事模块 id
     * @param {string} deliveryId - 投递条目 id
     */
    applyDeliveryCompleted(moduleId, deliveryId) {
        if (!moduleId || !deliveryId || typeof State === 'undefined') return;
        if (!State.deliveryCompleted) State.deliveryCompleted = {};
        if (!State.deliveryCompleted[moduleId]) State.deliveryCompleted[moduleId] = {};
        State.deliveryCompleted[moduleId][deliveryId] = true;
    },

    /**
     * 记录模块进入时间（用于相对时间条件 module_entered）。在真正进入模块时调用（如设置 State.currentModulePath 后）。
     * @param {string} moduleId - 故事模块 id
     * @param {string} pathKey - 路径 key（pathIds.join('|')）
     * @param {Object} [vars] - 变量，用于取当前时间；默认 State.variables
     */
    recordModuleEnteredAt(moduleId, pathKey, vars) {
        if (!moduleId || !pathKey || typeof State === 'undefined') return;
        const cur = this.currentModule;
        if (!cur || cur.id !== moduleId) return;
        const variables = vars != null ? vars : State.variables;
        const timeObj = this._getTimeObject(variables, cur);
        if (!timeObj || typeof timeObj !== 'object') return;
        if (!State.flowNodeEnteredAt) State.flowNodeEnteredAt = {};
        if (!State.flowNodeEnteredAt[moduleId]) State.flowNodeEnteredAt[moduleId] = {};
        State.flowNodeEnteredAt[moduleId][pathKey] = { year: timeObj.year, month: timeObj.month, day: timeObj.day };
        if (timeObj.hour != null) State.flowNodeEnteredAt[moduleId][pathKey].hour = timeObj.hour;
    },

    /** 标记变量需求已投递并执行 addToModuleInfo（targetPathKey）；用于新格式无 triggerModuleId 时 */
    markVariableRequirementDeliveredAndApplyAddTo(module, pathIds, reqIndex, addToModuleInfo) {
        if (!module || !module.id || !pathIds || !Array.isArray(addToModuleInfo) || addToModuleInfo.length === 0) return;
        const pathKey = pathIds.join('|');
        if (!State.variableRequirementDelivered) State.variableRequirementDelivered = {};
        if (!State.variableRequirementDelivered[module.id]) State.variableRequirementDelivered[module.id] = {};
        State.variableRequirementDelivered[module.id][pathKey + '|' + reqIndex] = true;
        addToModuleInfo.forEach((entry) => {
            const key = entry.targetPathKey != null ? entry.targetPathKey : entry.targetModuleId;
            if (key == null) return;
            const text = entry.infoText != null ? String(entry.infoText) : '';
            if (key.indexOf('|') >= 0 || key === '') this.appendInfoToNodeByPathKey(module, key, text);
            else this.appendInfoToNodeByLeafId(module, key, text);
        });
    },

    /**
     * 解析节点有效进入条件：若节点绑定角色预设则用预设的 appearanceCondition，否则用 enterCondition/enterRule。
     * 无 enterCondition/enterRule 时返回 null，逻辑上视为无限制（调用方按“无条件”处理）。
     * @param {Object} node - 子节点
     * @param {Object} content - 根 content
     * @returns {Object|null} 进入条件对象
     */
    getEnterConditionForNode(node, content) {
        if (!node) return null;
        const presetId = node.bindToCharacterPreset != null ? node.bindToCharacterPreset : node.bindToNpcPreset;
        if (presetId != null && content && Array.isArray(content.characterPresets)) {
            const preset = content.characterPresets.find((p) => (p.id || p.name) === presetId);
            if (preset && preset.appearanceCondition != null) return preset.appearanceCondition;
        }
        return node.enterCondition ?? node.enterRule ?? null;
    },

    /**
     * 解析节点「模块结束条件」：用于判定能否进入下一节点。通常为 nextRule（无则视为无条件或由下一节点前置条件决定）。
     * @param {Object} node - 当前节点（即将结束的模块）
     * @param {Object} content - 根 content
     * @returns {Object|null} 结束条件对象，无则 null
     */
    getEndConditionForNode(node, content) {
        if (!node) return null;
        return node.completeCondition ?? node.nextRule ?? null;
    },

    /**
     * 若下一叶与上一叶不在同一大模块，返回下一叶所在大模块的进入条件；否则返回 null。
     * 用于队列判定：大模块都进不去就别想里面的叶。
     * @param {Object} module - 故事模块
     * @param {string[]} prevPathIds - 上一叶路径
     * @param {string[]} nextPathIds - 下一叶路径
     * @returns {Object|null} 大模块 enterRule，同模块或无则 null
     */
    _getTopLevelEnterConditionIfDifferentModule(module, prevPathIds, nextPathIds) {
        if (!module || !module.content || !Array.isArray(prevPathIds) || !Array.isArray(nextPathIds)) return null;
        const prevTop = prevPathIds[0];
        const nextTop = nextPathIds[0];
        if (prevTop === nextTop) return null;
        const topLevelNodes = this._getTriggerChainTopLevelNodes(module);
        const top = topLevelNodes.find((t) => t.id === nextTop);
        if (!top || !top.node) return null;
        return this.getEnterConditionForNode(top.node, module.content);
    },

    /**
     * 校验逻辑表达式：括号配对、条目号 1..n
     * @param {string} logic - 如 "1 and (2 or 3)"
     * @param {number} n - 条件条数
     * @returns {{ valid: boolean, error?: string }}
     */
    _validateConditionLogic(logic, n) {
        const s = (logic || '').trim();
        if (!s) return { valid: true };
        let depth = 0;
        for (let i = 0; i < s.length; i++) {
            const c = s[i];
            if (c === '(') depth++;
            else if (c === ')') { depth--; if (depth < 0) return { valid: false, error: '括号不匹配' }; }
        }
        if (depth !== 0) return { valid: false, error: '括号不匹配' };
        const refs = s.match(/\d+/g) || [];
        const maxRef = n;
        for (const r of refs) {
            const num = parseInt(r, 10);
            if (num < 1 || num > maxRef) return { valid: false, error: `条目号应为 1～${maxRef}` };
        }
        return { valid: true };
    },

    /**
     * 按逻辑表达式求值条件（条目 1 对应 conditions[0]）
     * @param {Object[]} conditions - 条件数组
     * @param {string} logic - 如 "1 and (2 or 3)"，留空表示全部 AND
     */
    _evaluateConditionWithLogic(conditions, logic, vars, module, completedOverride) {
        if (!conditions || conditions.length === 0) return true;
        const vals = conditions.map((c, i) => this._evaluateCondition(c, vars, module, completedOverride));
        const s = (logic || '').trim().toLowerCase();
        if (!s) return vals.every(Boolean);
        if (s === 'and') return vals.every(Boolean);
        if (s === 'or') return vals.some(Boolean);
        const tokens = s.replace(/\s+/g, ' ').replace(/\(/g, ' ( ').replace(/\)/g, ' ) ').trim().split(/\s+/).filter(Boolean);
        let i = 0;
        const parseOr = () => {
            let left = parseAnd();
            while (i < tokens.length && (tokens[i] === 'or')) {
                i++;
                left = left || parseAnd();
            }
            return left;
        };
        const parseAnd = () => {
            let left = parseTerm();
            while (i < tokens.length && (tokens[i] === 'and')) {
                i++;
                left = left && parseTerm();
            }
            return left;
        };
        const parseTerm = () => {
            if (i >= tokens.length) return false;
            const t = tokens[i];
            if (t === '(') {
                i++;
                const v = parseOr();
                if (i < tokens.length && tokens[i] === ')') i++;
                return v;
            }
            const num = parseInt(t, 10);
            if (!Number.isNaN(num) && num >= 1 && num <= vals.length) {
                i++;
                return Boolean(vals[num - 1]);
            }
            i++;
            return false;
        };
        return parseOr();
    },

    /** 模组绑定的系统时间变量 id（content.timeVariableId，非 "default" 时使用；否则用 calendar/time） */
    _getTimeVarId(module) {
        if (!module || !module.content) return undefined;
        const id = module.content.timeVariableId;
        return (id && id !== 'default') ? id : undefined;
    },

    /** 当前模组时间对象（vars[timeVarId] 或 vars.calendar 或 vars.time） */
    _getTimeObject(vars, module) {
        if (!vars) return null;
        const id = this._getTimeVarId(module);
        if (id && vars[id] != null && typeof vars[id] === 'object') return vars[id];
        if (vars.calendar != null && typeof vars.calendar === 'object') return vars.calendar;
        if (vars.time != null && typeof vars.time === 'object') return vars.time;
        return null;
    },

    /** 用 State.variables / flowNodeCompleted / triggeredTimelineEvents 求值条件，满足返回 true；可选传入 module 用于 event_completed；completedOverride 为 { pathKey: true } 用于模拟「当前节点已完成」。若 condition 为数组则全部满足才为 true；若为 { conditions, logic } 则按 logic 表达式求值。 */
    _evaluateCondition(condition, vars, module = null, completedOverride = null) {
        if (!condition) return true;
        // entryConditions 数组：每个元素都是 wrapper（type='precondition'/'unlock'/...），全部通过才算条件成立
        if (Array.isArray(condition)) return condition.every((c) => this._evaluateCondition(c, vars, module, completedOverride));
        // wrapper { type:'precondition', conditionDef:{...} }：解包到内部 conditionDef
        // 没有这一段时所有 entryConditions 都默认通过（因为 wrapper.type='precondition' 不匹配任何分支，落到 line 2084 默认 return true）
        // → queue 段把所有模块都列为"可进入"污染 prompt（本次 audit 发现 bug-A）
        if (condition.type === 'precondition' && condition.conditionDef) {
            return this._evaluateCondition(condition.conditionDef, vars, module, completedOverride);
        }
        // 内部 conditionDef 结构 { logic:'AND'|'OR', groups:[{logic, items:[{itemType:'condition', condition:{...}}]}] }
        // 模组编辑器生成的标准结构，必须解析；旧 { logic, conditions:[] } 走下面 _evaluateConditionWithLogic
        if (condition.groups && Array.isArray(condition.groups)) {
            const groupLogic = condition.logic || 'AND';
            const evalGroup = (g) => {
                const itemLogic = g.logic || 'AND';
                const itemResults = (Array.isArray(g.items) ? g.items : []).map(it => {
                    if (it && it.itemType === 'condition' && it.condition) {
                        return this._evaluateCondition(it.condition, vars, module, completedOverride);
                    }
                    if (it && it.itemType === 'group' && it.group) {
                        return evalGroup(it.group);
                    }
                    return true;
                });
                return itemLogic === 'OR' ? itemResults.some(Boolean) : itemResults.every(Boolean);
            };
            const groupResults = condition.groups.map(evalGroup);
            return groupLogic === 'OR' ? groupResults.some(Boolean) : groupResults.every(Boolean);
        }
        if (condition && typeof condition === 'object' && !Array.isArray(condition) && Array.isArray(condition.conditions)) {
            return this._evaluateConditionWithLogic(condition.conditions, condition.logic || '', vars, module, completedOverride);
        }
        if (condition.type === 'none') return true;
        if (condition.type === 'module' && condition.moduleId) {
            const cur = module || this.currentModule;
            if (!cur || !cur.id) return false;
            const pathIds = condition.moduleId.indexOf('|') >= 0 ? condition.moduleId.split('|') : this.getPathIdsByModuleId(cur, condition.moduleId);
            if (!pathIds || pathIds.length === 0) return false;
            const pathKey = pathIds.join('|');
            const base = (typeof State !== 'undefined' && State.flowNodeCompleted && State.flowNodeCompleted[cur.id]) ? State.flowNodeCompleted[cur.id] : {};
            const completedMap = completedOverride != null ? { ...base, ...completedOverride } : base;
            const completed = completedMap[pathKey] === true;
            if (condition.state === 'completed') return completed;
            if (condition.state === 'entered') {
                const currentPaths = (typeof State !== 'undefined' && State.currentModulePath) ? (Array.isArray(State.currentModulePath[0]) ? State.currentModulePath : [State.currentModulePath]) : [];
                return currentPaths.some((p) => Array.isArray(p) && p.length >= pathIds.length && pathIds.every((id, i) => p[i] === id));
            }
            return false;
        }
        if (condition.type === 'stage_completed') {
            const pathIds = condition.pathIds;
            if (!Array.isArray(pathIds) || pathIds.length === 0) return true;
            const cur = module || this.currentModule;
            if (!cur || !cur.id) return false;
            const pathKey = pathIds.join('|');
            const base = (typeof State !== 'undefined' && State.flowNodeCompleted && State.flowNodeCompleted[cur.id]) ? State.flowNodeCompleted[cur.id] : {};
            const completedMap = completedOverride != null ? { ...base, ...completedOverride } : base;
            return completedMap[pathKey] === true;
        }
        if (condition.type === 'event_completed') {
            const eventId = condition.eventId;
            if (!eventId) return true;
            const mod = module || this.currentModule;
            if (!mod || !mod.id || typeof State === 'undefined' || !State.triggeredTimelineEvents || !State.triggeredTimelineEvents[mod.id]) return false;
            return State.triggeredTimelineEvents[mod.id][eventId] != null;
        }
        if (condition.type === 'time' && condition.relativeToPath) {
            const cur = module || this.currentModule;
            if (!cur || !cur.id || typeof State === 'undefined' || !State.flowNodeCompletedAt || !State.flowNodeCompletedAt[cur.id]) return false;
            const completedAt = State.flowNodeCompletedAt[cur.id][condition.relativeToPath];
            if (!completedAt || typeof completedAt !== 'object') return false;
            const timeVarId = this._getTimeVarId(module);
            let current = this._getTimeObject(vars, module);
            if (!current) {
                const gy = typeof getVariableValue === 'function' ? getVariableValue(vars, 'calendar_year', timeVarId) : vars.calendar_year;
                const gm = typeof getVariableValue === 'function' ? getVariableValue(vars, 'calendar_month', timeVarId) : vars.calendar_month;
                const gd = typeof getVariableValue === 'function' ? getVariableValue(vars, 'calendar_day', timeVarId) : vars.calendar_day;
                if (gy != null || gm != null || gd != null) current = { year: gy, month: gm, day: gd };
            }
            if (!current) return false;
            const toDays = (o) => {
                if (!o || typeof o !== 'object') return 0;
                const y = Number(o.year) || 0;
                const m = Number(o.month) || 1;
                const d = Number(o.day) || 1;
                const date = new Date(y, m - 1, d);
                return Math.floor(date.getTime() / 86400000);
            };
            const daysSince = toDays(current) - toDays(completedAt);
            if (condition.offsetDays != null) return daysSince === condition.offsetDays;
            if (condition.rangeStartDays != null && condition.rangeEndDays != null)
                return daysSince >= condition.rangeStartDays && daysSince <= condition.rangeEndDays;
            return false;
        }
        // condition.type='time' + timeType='absolute' { time:{year,month,day} }：当前时间 >= 目标
        // 没有这一段时模组里"群英大会"这类绝对时间条件全部默认通过，导致凡人阶段 queue 就包含
        if (condition.type === 'time' && condition.timeType === 'absolute' && condition.time && typeof condition.time === 'object') {
            const cur = module || this.currentModule;
            const current = this._getTimeObject(vars, cur);
            if (!current) return false;
            const toOrd = (o) => {
                const y = Number(o.年 != null ? o.年 : o.year) || 0;
                const m = Number(o.月 != null ? o.月 : o.month) || 1;
                const d = Number(o.日 != null ? o.日 : o.day) || 1;
                return y * 10000 + m * 100 + d;
            };
            return toOrd(current) >= toOrd(condition.time);
        }
        // condition.type='time' + timeType='relative' { relative:{moduleId,state,offset:{day,month,year}} }
        // 锚点模块 entered/completed 后偏移满足；State.flowNodeEnteredAt / flowNodeCompletedAt 取时间戳
        if (condition.type === 'time' && condition.timeType === 'relative' && condition.relative && condition.relative.moduleId) {
            const cur = module || this.currentModule;
            if (!cur || !cur.id || typeof State === 'undefined') return false;
            const anchorMod = condition.relative.moduleId;
            const pathIds = this.getPathIdsByModuleId(cur, anchorMod);
            if (!pathIds || pathIds.length === 0) return false;
            const pathKey = pathIds.join('|');
            const stateType = condition.relative.state || 'entered';
            const stateMap = stateType === 'completed'
                ? (State.flowNodeCompletedAt && State.flowNodeCompletedAt[cur.id])
                : (State.flowNodeEnteredAt && State.flowNodeEnteredAt[cur.id]);
            const anchorTime = stateMap ? stateMap[pathKey] : null;
            if (!anchorTime || typeof anchorTime !== 'object') return false;
            const current = this._getTimeObject(vars, cur);
            if (!current) return false;
            const toDays = (o) => {
                const y = Number(o.年 != null ? o.年 : o.year) || 0;
                const m = Number(o.月 != null ? o.月 : o.month) || 1;
                const d = Number(o.日 != null ? o.日 : o.day) || 1;
                return y * 360 + m * 30 + d;
            };
            const offset = condition.relative.offset || {};
            const offsetDays = (Number(offset.day) || 0) + (Number(offset.month) || 0) * 30 + (Number(offset.year) || 0) * 360;
            return toDays(current) - toDays(anchorTime) >= offsetDays;
        }
        if (condition.type === 'time' && condition.variableId && condition.value && typeof condition.value === 'object') {
            const left = typeof getVariableValue === 'function' ? getVariableValue(vars, condition.variableId) : vars[condition.variableId];
            const right = condition.value;
            const toDayOrd = (o) => {
                if (!o || typeof o !== 'object') return 0;
                const y = Number(o.year) || 0;
                const m = Number(o.month) || 1;
                const d = Number(o.day) || 1;
                return y * 10000 + m * 100 + d;
            };
            const leftOrd = toDayOrd(left);
            const rightOrd = toDayOrd(right);
            const op = condition.operator || '>=';
            switch (op) {
                case '==': return leftOrd === rightOrd;
                case '!=': return leftOrd !== rightOrd;
                case '>': return leftOrd > rightOrd;
                case '>=': return leftOrd >= rightOrd;
                case '<': return leftOrd < rightOrd;
                case '<=': return leftOrd <= rightOrd;
                default: return false;
            }
        }
        if (condition.type === 'time' && condition.mode === 'exact' && condition.timeValue && typeof condition.timeValue === 'object') {
            const cur = module || this.currentModule;
            const current = this._getTimeObject(vars, cur);
            if (!current) return false;
            const toDayOrd = (o) => {
                if (!o || typeof o !== 'object') return 0;
                const y = Number(o.年 != null ? o.年 : o.year) || 0;
                const m = Number(o.月 != null ? o.月 : o.month) || 1;
                const d = Number(o.日 != null ? o.日 : o.day) || 1;
                return y * 10000 + m * 100 + d;
            };
            const curOrd = toDayOrd(current);
            const targetOrd = toDayOrd(condition.timeValue);
            if (condition.when === 'after') return curOrd >= targetOrd;
            if (condition.when === 'before') return curOrd <= targetOrd;
            return curOrd === targetOrd;
        }
        if (condition.type === 'time' && condition.mode === 'relative' && condition.anchor && condition.anchor.moduleId) {
            const cur = module || this.currentModule;
            if (!cur || !cur.id || typeof State === 'undefined') return false;
            const pathIds = this.getPathIdsByModuleId(cur, condition.anchor.moduleId);
            if (!pathIds || pathIds.length === 0) return false;
            const pathKey = pathIds.join('|');
            const anchorType = condition.anchor.type || 'module_completed';
            let anchorTime = null;
            if (anchorType === 'module_completed' && State.flowNodeCompletedAt && State.flowNodeCompletedAt[cur.id]) {
                anchorTime = State.flowNodeCompletedAt[cur.id][pathKey];
            }
            if (anchorType === 'module_entered' && State.flowNodeEnteredAt && State.flowNodeEnteredAt[cur.id]) {
                anchorTime = State.flowNodeEnteredAt[cur.id][pathKey];
            }
            if (!anchorTime || typeof anchorTime !== 'object') return false;
            const current = this._getTimeObject(vars, cur);
            if (!current) return false;
            const toDays = (o) => {
                if (!o || typeof o !== 'object') return 0;
                const y = Number(o.年 != null ? o.年 : o.year) || 0;
                const m = Number(o.月 != null ? o.月 : o.month) || 1;
                const d = Number(o.日 != null ? o.日 : o.day) || 1;
                return y * 360 + m * 30 + d;
            };
            const offset = condition.offset || {};
            const offsetDays = (Number(offset.days) || 0) + (Number(offset.months) || 0) * 30 + (Number(offset.years) || 0) * 360;
            const anchorDays = toDays(anchorTime);
            const curDays = toDays(current);
            const daysSince = curDays - anchorDays;
            if (condition.when === 'after') return daysSince >= offsetDays;
            if (condition.when === 'before') return daysSince <= offsetDays;
            return daysSince === offsetDays;
        }
        if (condition.type === 'timeRange' && (condition.mode === 'exact' || condition.mode === 'relative')) {
            const cur = module || this.currentModule;
            let current = this._getTimeObject(vars, cur);
            if (!current && cur && typeof getVariableValue === 'function') {
                const timeVarId = this._getTimeVarId(cur);
                const gy = getVariableValue(vars, 'calendar_year', timeVarId);
                const gm = getVariableValue(vars, 'calendar_month', timeVarId);
                const gd = getVariableValue(vars, 'calendar_day', timeVarId);
                if (gy != null || gm != null || gd != null) current = { year: gy, month: gm, day: gd };
            }
            if (!current) return false;
            const toDayOrd = (o) => {
                if (!o || typeof o !== 'object') return 0;
                const y = Number(o.年 != null ? o.年 : o.year) || 0;
                const m = Number(o.月 != null ? o.月 : o.month) || 1;
                const d = Number(o.日 != null ? o.日 : o.day) || 1;
                return y * 10000 + m * 100 + d;
            };
            let startOrd; let endOrd;
            if (condition.mode === 'exact' && condition.start != null && condition.end != null) {
                startOrd = toDayOrd(condition.start);
                endOrd = toDayOrd(condition.end);
            } else if (condition.mode === 'relative' && condition.anchor && condition.anchor.moduleId) {
                const pathIds = this.getPathIdsByModuleId(cur, condition.anchor.moduleId);
                if (!pathIds || pathIds.length === 0) return false;
                const pathKey = pathIds.join('|');
                const anchorTime = State.flowNodeCompletedAt && State.flowNodeCompletedAt[cur.id] ? State.flowNodeCompletedAt[cur.id][pathKey] : null;
                if (!anchorTime || typeof anchorTime !== 'object') return false;
                const toDays = (o) => {
                    if (!o || typeof o !== 'object') return 0;
                    const y = Number(o.年 != null ? o.年 : o.year) || 0;
                    const m = Number(o.月 != null ? o.月 : o.month) || 1;
                    const d = Number(o.日 != null ? o.日 : o.day) || 1;
                    return y * 360 + m * 30 + d;
                };
                const anchorDays = toDays(anchorTime);
                const curDays = toDays(current);
                const startOffset = condition.startOffset || {};
                const endOffset = condition.endOffset || {};
                const startDays = (Number(startOffset.days) || 0) + (Number(startOffset.months) || 0) * 30;
                const endDays = (Number(endOffset.days) || 0) + (Number(endOffset.months) || 0) * 30;
                return curDays >= anchorDays + startDays && curDays <= anchorDays + endDays;
            } else {
                return false;
            }
            if (condition.mode === 'exact') {
                const curOrd = toDayOrd(current);
                return curOrd >= startOrd && curOrd <= endOrd;
            }
            return false;
        }
        if (condition.type === 'tag' && condition.tag != null) {
            const cur = module || this.currentModule;
            if (!cur || !cur.content) return false;
            const currentPaths = (typeof State !== 'undefined' && State.currentModulePath)
                ? (Array.isArray(State.currentModulePath[0]) ? State.currentModulePath : [State.currentModulePath])
                : [];
            const tagStr = String(condition.tag).trim();
            if (!tagStr) return true;
            for (const pathIds of currentPaths) {
                if (!Array.isArray(pathIds) || pathIds.length === 0) continue;
                const pathTags = this.getTagsOnPath(cur, pathIds);
                if (pathTags.indexOf(tagStr) !== -1) return true;
            }
            return false;
        }
        if (condition.type === 'interval' && condition.start && condition.end && typeof condition.start === 'object' && typeof condition.end === 'object') {
            const toDayOrd = (o) => {
                if (!o || typeof o !== 'object') return 0;
                const y = Number(o.year) || 0;
                const m = Number(o.month) || 1;
                const d = Number(o.day) || 1;
                return y * 10000 + m * 100 + d;
            };
            const timeVarId = this._getTimeVarId(module);
            let current = condition.variableId && vars[condition.variableId] && typeof vars[condition.variableId] === 'object'
                ? vars[condition.variableId]
                : this._getTimeObject(vars, module);
            if (!current) {
                const gy = typeof getVariableValue === 'function' ? getVariableValue(vars, 'calendar_year', timeVarId) : vars.calendar_year;
                const gm = typeof getVariableValue === 'function' ? getVariableValue(vars, 'calendar_month', timeVarId) : vars.calendar_month;
                const gd = typeof getVariableValue === 'function' ? getVariableValue(vars, 'calendar_day', timeVarId) : vars.calendar_day;
                if (gy != null || gm != null || gd != null) current = { year: gy, month: gm, day: gd };
            }
            const curOrd = toDayOrd(current);
            const startOrd = toDayOrd(condition.start);
            const endOrd = toDayOrd(condition.end);
            if (curOrd < startOrd || curOrd > endOrd) return false;
            if (condition.firstDayOnly === true) return curOrd === startOrd;
            return true;
        }
        if (condition.type !== 'variable' || !condition.variableId) return true;
        const left = typeof getVariableValue === 'function' ? getVariableValue(vars, condition.variableId) : vars[condition.variableId];
        const right = condition.value;
        const op = condition.operator;
        // 2026-06-05：boolean coerce 'true'/'false' 字符串 → bool（同上 _evaluateVariablePartOnly）
        const coerceBool = (v) => v === 'true' ? true : v === 'false' ? false : v;
        if (op === 'in' && Array.isArray(right)) return right.some((v) => v == left) || right.includes(left);
        switch (op) {
            case '==': return coerceBool(left) == coerceBool(right);
            case '!=': return coerceBool(left) != coerceBool(right);
            case '>': return Number(left) > Number(right);
            case '>=': return Number(left) >= Number(right);
            case '<': return Number(left) < Number(right);
            case '<=': return Number(left) <= Number(right);
            default: return false;
        }
    },

    /**
     * 根据模块 id 查找从根到该节点的路径 id 数组（用于新格式 condition.type === 'module'）
     * @param {Object} module - 故事模块
     * @param {string} moduleId - 模块 id（单 id）
     * @returns {string[]|null} 路径 id 数组，未找到返回 null
     */
    getPathIdsByModuleId(module, moduleId) {
        if (!module || !module.content || !moduleId) return null;
        let found = null;
        const walk = (nodes, pathIds) => {
            for (const n of nodes || []) {
                const id = n.id || n.name;
                if (!id) continue;
                const ids = [...(pathIds || []), id];
                if (id === moduleId) { found = ids; return true; }
                const sub = n.subModules || n.moduleGroup || [];
                if (Array.isArray(sub) && sub.length && walk(sub, ids)) return true;
            }
            return false;
        };
        walk(module.content.subModules || module.content.moduleGroup || [], []);
        return found;
    },

    /** 按 id 或 name 查路径——AI 写 <module|enter|名字> 用的是事件名（queue 段暴露的是 name 不是 id），必须按 name 找 */
    getPathIdsByModuleIdOrName(module, key) {
        if (!module || !module.content || !key) return null;
        let found = null;
        const walk = (nodes, pathIds) => {
            for (const n of nodes || []) {
                const id = n.id;
                const name = n.name;
                const localId = id || name;
                if (!localId) continue;
                const ids = [...(pathIds || []), localId];
                if (id === key || name === key) { found = ids; return true; }
                const sub = n.subModules || n.moduleGroup || [];
                if (Array.isArray(sub) && sub.length && walk(sub, ids)) return true;
            }
            return false;
        };
        walk(module.content.subModules || module.content.moduleGroup || [], []);
        return found;
    },

    /**
     * 收集路径 pathIds 上各节点的 tags 并合并为数组（用于 condition.type === 'tag' 展示条件）
     * @param {Object} module - 故事模块
     * @param {string[]} pathIds - 从根到当前节点的路径 id 数组
     * @returns {string[]} 标签数组
     */
    getTagsOnPath(module, pathIds) {
        if (!module || !module.content || !Array.isArray(pathIds)) return [];
        const out = [];
        let node = module.content;
        for (const id of pathIds) {
            const sub = node.subModules || node.moduleGroup || [];
            const found = sub.find((n) => (n.id || n.name) === id);
            if (!found) break;
            const tags = Array.isArray(found.tags) ? found.tags : (typeof found.tags === 'string' ? found.tags.split(',').map(s => s.trim()).filter(Boolean) : []);
            tags.forEach((t) => { if (t && out.indexOf(t) === -1) out.push(t); });
            node = found;
        }
        return out;
    },

    /**
     * 收集未满足的条件描述（用于预期队列标注）。返回人类可读的字符串数组。
     * @param {Object|Array} condition - enterRule 等条件
     * @param {Object} vars - 变量
     * @param {Object} module - 故事模块
     * @param {Object} [completedOverride] - 模拟已完成的 pathKey 映射
     * @returns {string[]}
     */
    _getUnmetConditionParts(condition, vars, module, completedOverride) {
        const parts = [];
        if (!condition) return parts;
        const cur = module || this.currentModule;
        const baseCompleted = (cur && cur.id && typeof State !== 'undefined' && State.flowNodeCompleted && State.flowNodeCompleted[cur.id]) ? State.flowNodeCompleted[cur.id] : {};
        const completedMap = completedOverride != null ? { ...baseCompleted, ...completedOverride } : baseCompleted;

        const collect = (c) => {
            if (!c) return;
            if (Array.isArray(c)) { c.forEach(collect); return; }
            if (c.type === 'stage_completed' && Array.isArray(c.pathIds)) {
                const pathKey = c.pathIds.join('|');
                if (completedMap[pathKey] !== true) {
                    const name = this.getModuleNodeByPath(cur, c.pathIds).name || c.pathIds[c.pathIds.length - 1];
                    parts.push('模块「' + (name || pathKey) + '」未完成');
                }
                return;
            }
            if (c.type === 'event_completed' && c.eventId) {
                const mod = module || this.currentModule;
                if (!mod || !mod.id || typeof State === 'undefined' || !State.triggeredTimelineEvents || !State.triggeredTimelineEvents[mod.id] || State.triggeredTimelineEvents[mod.id][c.eventId] == null)
                    parts.push('时间线模块「' + (c.eventId) + '」未触发');
                return;
            }
            if (c.type === 'time' && c.relativeToPath) {
                const mod = module || this.currentModule;
                if (!mod || !mod.id || typeof State === 'undefined' || !State.flowNodeCompletedAt || !State.flowNodeCompletedAt[mod.id]) {
                    parts.push('相对时间：模块「' + (c.relativeToPath || '') + '」尚未有完成日期');
                    return;
                }
                const completedAt = State.flowNodeCompletedAt[mod.id][c.relativeToPath];
                if (!completedAt || typeof completedAt !== 'object') {
                    parts.push('相对时间：模块「' + c.relativeToPath + '」无完成日期');
                    return;
                }
                const timeVarId = this._getTimeVarId(module);
                let current = this._getTimeObject(vars, module);
                if (!current) {
                    const gy = typeof getVariableValue === 'function' ? getVariableValue(vars, 'calendar_year', timeVarId) : vars.calendar_year;
                    const gm = typeof getVariableValue === 'function' ? getVariableValue(vars, 'calendar_month', timeVarId) : vars.calendar_month;
                    const gd = typeof getVariableValue === 'function' ? getVariableValue(vars, 'calendar_day', timeVarId) : vars.calendar_day;
                    if (gy != null || gm != null || gd != null) current = { year: gy, month: gm, day: gd };
                }
                if (!current) { parts.push('相对时间：无当前日期'); return; }
                const toDays = (o) => {
                    if (!o || typeof o !== 'object') return 0;
                    const y = Number(o.year) || 0;
                    const m = Number(o.month) || 1;
                    const d = Number(o.day) || 1;
                    return Math.floor(new Date(y, m - 1, d).getTime() / 86400000);
                };
                const daysSince = toDays(current) - toDays(completedAt);
                let met = false;
                if (c.offsetDays != null) met = daysSince === c.offsetDays;
                else if (c.rangeStartDays != null && c.rangeEndDays != null) met = daysSince >= c.rangeStartDays && daysSince <= c.rangeEndDays;
                if (!met) {
                    const desc = c.offsetDays != null ? '完成后第' + c.offsetDays + '天' : '完成后第' + (c.rangeStartDays ?? 0) + '～' + (c.rangeEndDays ?? 0) + '天';
                    parts.push('相对时间：模块「' + c.relativeToPath + '」' + desc + ' 未满足（当前距完成 ' + daysSince + ' 天）');
                }
                return;
            }
            if (c.type === 'time' && c.variableId && c.value && typeof c.value === 'object') {
                const left = typeof getVariableValue === 'function' ? getVariableValue(vars, c.variableId) : vars[c.variableId];
                const right = c.value;
                const toDayOrd = (o) => {
                    if (!o || typeof o !== 'object') return 0;
                    const y = Number(o.year) || 0;
                    const m = Number(o.month) || 1;
                    const d = Number(o.day) || 1;
                    return y * 10000 + m * 100 + d;
                };
                const leftOrd = toDayOrd(left);
                const rightOrd = toDayOrd(right);
                const op = c.operator || '>=';
                let met = false;
                switch (op) {
                    case '==': met = leftOrd === rightOrd; break;
                    case '!=': met = leftOrd !== rightOrd; break;
                    case '>': met = leftOrd > rightOrd; break;
                    case '>=': met = leftOrd >= rightOrd; break;
                    case '<': met = leftOrd < rightOrd; break;
                    case '<=': met = leftOrd <= rightOrd; break;
                    default: met = false;
                }
                if (!met) {
                    const defs = this.getAllVariableDefs(cur);
                    const def = defs.find((d) => d.id === c.variableId);
                    const varName = (def && def.name) ? def.name : c.variableId;
                    const dateStr = [right.year, right.month, right.day].filter((x) => x != null && x !== '').join('/');
                    parts.push('时间「' + varName + '」需 ' + (op === '>=' ? '≥' : op === '<=' ? '≤' : op) + ' ' + dateStr + '（当前 ' + (left && typeof left === 'object' ? [left.year, left.month, left.day].filter((x) => x != null).join('/') : left) + '）');
                }
                return;
            }
            if (c.type === 'interval' && c.start && c.end && typeof c.start === 'object' && typeof c.end === 'object') {
                const toDayOrd = (o) => {
                    if (!o || typeof o !== 'object') return 0;
                    const y = Number(o.year) || 0;
                    const m = Number(o.month) || 1;
                    const d = Number(o.day) || 1;
                    return y * 10000 + m * 100 + d;
                };
                let current = c.variableId && vars[c.variableId] && typeof vars[c.variableId] === 'object'
                    ? vars[c.variableId]
                    : this._getTimeObject(vars, module);
                if (!current) {
                    const timeVarId = this._getTimeVarId(module);
                    const gy = typeof getVariableValue === 'function' ? getVariableValue(vars, 'calendar_year', timeVarId) : vars.calendar_year;
                    const gm = typeof getVariableValue === 'function' ? getVariableValue(vars, 'calendar_month', timeVarId) : vars.calendar_month;
                    const gd = typeof getVariableValue === 'function' ? getVariableValue(vars, 'calendar_day', timeVarId) : vars.calendar_day;
                    if (gy != null || gm != null || gd != null) current = { year: gy, month: gm, day: gd };
                }
                const curOrd = toDayOrd(current);
                const startOrd = toDayOrd(c.start);
                const endOrd = toDayOrd(c.end);
                const inRange = curOrd >= startOrd && curOrd <= endOrd;
                const firstDayOnly = c.firstDayOnly === true && curOrd !== startOrd;
                if (!inRange || firstDayOnly) {
                    const s = [c.start.year, c.start.month, c.start.day].filter((x) => x != null).join('/');
                    const e = [c.end.year, c.end.month, c.end.day].filter((x) => x != null).join('/');
                    parts.push('区间 ' + s + '～' + e + (c.firstDayOnly ? '（仅开始日）' : '') + ' 未满足');
                }
                return;
            }
            if (c.type === 'variable' && c.variableId != null) {
                const left = typeof getVariableValue === 'function' ? getVariableValue(vars, c.variableId) : vars[c.variableId];
                const right = c.value;
                const op = c.operator || '==';
                let met = false;
                switch (op) {
                    case '==': met = left == right; break;
                    case '!=': met = left != right; break;
                    case '>': met = Number(left) > Number(right); break;
                    case '>=': met = Number(left) >= Number(right); break;
                    case '<': met = Number(left) < Number(right); break;
                    case '<=': met = Number(left) <= Number(right); break;
                    default: met = false;
                }
                if (!met) {
                    const defs = this.getAllVariableDefs(cur);
                    const def = defs.find((d) => d.id === c.variableId);
                    const varName = (def && def.name) ? def.name : c.variableId;
                    parts.push('变量「' + varName + '」需 ' + (op === '>=' ? '≥' : op === '<=' ? '≤' : op) + ' ' + right + '（当前 ' + left + '）');
                }
            }
        };
        if (condition && typeof condition === 'object' && !Array.isArray(condition) && Array.isArray(condition.conditions)) {
            condition.conditions.forEach(collect);
            return parts;
        }
        collect(condition);
        return parts;
    },

    /**
     * 求值派生变量规则单条 condition（condition 为数组，每项 type 为 variable 或 module_completed）
     * @param {Array} condition
     * @param {Object} vars
     * @param {Object} module
     */
    _evaluateDerivedRuleCondition(condition, vars, module) {
        const list = Array.isArray(condition) ? condition : (condition && typeof condition === 'object' ? [condition] : []);
        for (const item of list) {
            if (!item) continue;
            if (item.type === 'variable' && item.variableId != null) {
                if (!this._evaluateCondition(item, vars || {})) return false;
            } else if (item.type === 'module_completed' && Array.isArray(item.pathIds) && item.pathIds.length > 0 && module && module.id) {
                const pathIds = item.pathIds;
                const pathKey = pathIds.join('|');
                if (typeof State !== 'undefined' && State.flowNodeCompleted && State.flowNodeCompleted[module.id] && State.flowNodeCompleted[module.id][pathKey] === true)
                    continue;
                const currentPaths = (typeof State !== 'undefined' && State.currentModulePath)
                    ? (Array.isArray(State.currentModulePath[0]) ? State.currentModulePath : [State.currentModulePath])
                    : [];
                const inOrPast = currentPaths.some((p) => Array.isArray(p) && p.length >= pathIds.length && pathIds.every((id, i) => p[i] === id));
                if (!inOrPast) return false;
            }
        }
        return true;
    },

    /**
     * 按模组配置的派生变量规则与当前变量、模块完成状态计算并返回匹配到的值（通用）
     * @param {Object} module
     * @param {Object} vars
     * @returns {*} 匹配到的值，无则 undefined
     */
    getDerivedVariableFromRules(module, vars) {
        const content = module && module.content;
        const rulesConfig = content && (content.derivedVariableRules || content.realmRules) && typeof (content.derivedVariableRules || content.realmRules) === 'object' ? (content.derivedVariableRules || content.realmRules) : null;
        const variable = rulesConfig && rulesConfig.variable;
        const targetId = variable && (variable.targetVariableId != null ? variable.targetVariableId : variable.realmVariableId);
        if (!variable || targetId == null || !Array.isArray(variable.rules)) return undefined;
        for (const rule of variable.rules) {
            const val = rule.value != null ? rule.value : rule.realm;
            if (val !== undefined && val !== null && this._evaluateDerivedRuleCondition(rule.condition, vars || {}, module))
                return val;
        }
        return undefined;
    },

    /** 仅排除系统级变量（如有）；模块内部变量由模块用 visibility: 'hidden' 标记，不在此列举 */
    _internalVariableIds() {
        return [];
    },

    /**
     * 将 itemSchema 对象形式转为数组形式：{ name: "string", favor: "number" } -> [{ id: "name", type: "string" }, ...]
     * @param {Object} schema - 键为字段 id，值为 type 字符串或 { type, name? }
     */
    _normalizeItemSchema(schema) {
        if (!schema || typeof schema !== 'object') return null;
        const arr = [];
        Object.entries(schema).forEach(([id, val]) => {
            if (val != null && typeof val === 'object' && !Array.isArray(val)) {
                arr.push({ id, type: val.type || 'string', name: val.name || id });
            } else {
                arr.push({ id, type: typeof val === 'string' ? val : 'string', name: id });
            }
        });
        return arr.length ? arr : null;
    },

    /**
     * 收集模块树中所有变量定义（含 pathIds，用于判断是否在当前阶段）
     * @returns {Array<{ id, name, type, value, pathIds, visibility }>}
     */
    getAllVariableDefs(module) {
        if (!module || !module.content) return [];
        const out = [];
        const walk = (nodes, pathIds) => {
            (nodes || []).forEach((n) => {
                const id = n.id || n.name;
                if (!id) return;
                const ids = [...pathIds, id];
                const vars = Array.isArray(n.variables) ? n.variables : [];
                vars.forEach((v) => {
                    if (v && v.id != null) {
                        const role = v.variableRole || v.role || null;
                        out.push({
                            id: v.id,
                            name: (v.name || v.id).trim() || v.id,
                            type: v.type || 'string',
                            value: v.value,
                            pathIds: ids,
                            variableRole: role,
                            visibility: v.visibility,
                            toggleable: v.toggleable === true,
                            toggleableInModule: v.toggleableInModule === true,
                            initialVisible: v.initialVisible !== false,
                            bindTag: v.bindTag != null ? v.bindTag : null,
                            changeRules: Array.isArray(v.changeRules) ? v.changeRules : [],
                            supportedOps: Array.isArray(v.supportedOps) ? v.supportedOps : [],
                            condition: v.condition != null ? v.condition : null,
                            displayCondition: v.displayCondition != null ? v.displayCondition : null,
                            computedRule: v.computedRule != null ? v.computedRule : null,
                            computeConditions: Array.isArray(v.computeConditions) ? v.computeConditions : [],
                            category: v.category || null,
                            readOnly: (role === 'builtin' || role === 'temp') || v.readOnly === true || v.computed === true,
                            info: v.info != null ? v.info : '',
                            infoEntries: Array.isArray(v.infoEntries) ? v.infoEntries : [],
                            listItemType: v.listItemType || null,
                            itemSchema: Array.isArray(v.itemSchema) ? v.itemSchema : (v.itemSchema && typeof v.itemSchema === 'object' ? this._normalizeItemSchema(v.itemSchema) : null)
                        });
                    }
                });
                walk(n.subModules || [], ids);
            });
        };
        const content = module.content;
        const rootVars = Array.isArray(content.variables) ? content.variables : [];
        rootVars.forEach((v) => {
            if (v && v.id != null) {
                const role = v.variableRole || v.role || null;
                out.push({
                    id: v.id,
                    name: (v.name || v.id).trim() || v.id,
                    type: v.type || 'string',
                    value: v.value,
                    pathIds: [],
                    variableRole: role,
                    visibility: v.visibility,
                    visibleFrom: v.visibleFrom || null,
                    visibleOnlyIn: Array.isArray(v.visibleOnlyIn) ? v.visibleOnlyIn : null,
                    toggleable: v.toggleable === true,
                    toggleableInModule: v.toggleableInModule === true,
                    initialVisible: v.initialVisible !== false,
                    bindTag: v.bindTag != null ? v.bindTag : null,
                    changeRules: Array.isArray(v.changeRules) ? v.changeRules : [],
                    supportedOps: Array.isArray(v.supportedOps) ? v.supportedOps : [],
                    condition: v.condition != null ? v.condition : null,
                    displayCondition: v.displayCondition != null ? v.displayCondition : null,
                    computedRule: v.computedRule != null ? v.computedRule : null,
                    computeConditions: Array.isArray(v.computeConditions) ? v.computeConditions : [],
                    category: v.category || null,
                    readOnly: (role === 'builtin' || role === 'temp') || v.readOnly === true || v.computed === true,
                    info: v.info != null ? v.info : '',
                    infoEntries: Array.isArray(v.infoEntries) ? v.infoEntries : [],
                    listItemType: v.listItemType || null,
                    itemSchema: Array.isArray(v.itemSchema) ? v.itemSchema : (v.itemSchema && typeof v.itemSchema === 'object' ? this._normalizeItemSchema(v.itemSchema) : null)
                });
            }
        });
        walk(content.subModules || [], []);
        const derivedRules = content.derivedVariableRules || content.realmRules;
        const computedVarIds = new Set();
        if (derivedRules && typeof derivedRules === 'object' && derivedRules.variable) {
            const tid = derivedRules.variable.targetVariableId != null ? derivedRules.variable.targetVariableId : derivedRules.variable.realmVariableId;
            if (tid) computedVarIds.add(tid);
        }
        out.forEach((d) => {
            if (computedVarIds.has(d.id)) d.readOnly = true;
        });
        return out;
    },

    /**
     * 某路径（或时间线事件）下「在作用域内」的变量列表：子模块可访问父级变量，不可访问同级变量。
     * @param {object} module - 当前模组
     * @param {string[]} pathIds - 模块路径；空表示根
     * @param {string} [eventId] - 时间线事件 id；若有则仅返回根变量（时间线事件无节点变量）
     * @returns {Array<{ def, currentValue, isOwn }>} def 含 pathIds；isOwn 表示是否由当前节点定义（可改名字类型等），否则仅展示/可改数值
     */
    getVariablesInScopeForPath(module, pathIds, eventId) {
        if (!module || !module.content) return [];
        const defs = this.getAllVariableDefs(module);
        const pathPrefix = (a, b) => a.length <= b.length && a.every((x, i) => x === b[i]);
        const vars = typeof State !== 'undefined' && State.variables ? State.variables : {};
        const getVal = (id) => (vars[id] !== undefined ? vars[id] : (defs.find((d) => d.id === id) || {}).value);

        if (eventId != null && eventId !== '') {
            return defs.filter((d) => d.pathIds.length === 0).map((d) => ({
                def: d,
                currentValue: getVal(d.id),
                isOwn: false
            }));
        }
        const ids = Array.isArray(pathIds) ? pathIds : [];
        return defs.filter((d) => pathPrefix(d.pathIds, ids)).map((d) => {
            const isOwn = d.pathIds.length === ids.length && d.pathIds.every((id, i) => ids[i] === id);
            return { def: d, currentValue: getVal(d.id), isOwn };
        });
    },

    /**
     * 当前路径上各节点声明的「打开变量」id 集合（进入该模块时打开这些根变量）
     */
    getOpenedVarIdsByPath(module, pathIds) {
        if (!module || !module.content || !pathIds || pathIds.length === 0) return new Set();
        const set = new Set();
        for (let i = 0; i < pathIds.length; i++) {
            const prefix = pathIds.slice(0, i + 1);
            const { node } = this.getModuleNodeByPath(module, prefix);
            const actions = Array.isArray(node.variableToggleActions) ? node.variableToggleActions : (Array.isArray(node.openVariables) ? node.openVariables.map((id) => ({ variableId: id, action: 'open' })) : []);
            actions.forEach((a) => {
                const id = a.variableId || a;
                if (a.action === 'close') set.delete(id);
                else set.add(id);
            });
        }
        return set;
    },

    /**
     * 全树中曾被某节点声明为「打开」的变量 id 集合（用于判断「非此类即始终可见」）
     */
    getAllOpenedVarIdsInTree(module) {
        if (!module || !module.content) return new Set();
        const set = new Set();
        const walk = (nodes) => {
            (nodes || []).forEach((n) => {
                const actions = Array.isArray(n.variableToggleActions) ? n.variableToggleActions : (Array.isArray(n.openVariables) ? n.openVariables.map((id) => ({ variableId: id, action: 'open' })) : []);
                actions.forEach((a) => { if ((a.action || 'open') === 'open') set.add(a.variableId || a); });
                walk(n.subModules || []);
            });
        };
        walk(module.content.subModules || []);
        return set;
    },

    /**
     * 深度优先顺序的模块 id 列表（用于 visibleFrom：从某模块开始展示）
     */
    getOrderedModuleIds(module) {
        if (!module || !module.content) return [];
        const list = [];
        const walk = (nodes) => {
            (nodes || []).forEach((n) => {
                const id = n.id || n.name;
                if (id) list.push(id);
                walk(n.subModules || []);
            });
        };
        walk(module.content.subModules || []);
        return list;
    },

    /**
     * 当前路径下应发给 AI 的变量列表：仅当前阶段可见、带名称；排除 visibility: 'hidden'。
     * 根变量：仅由「模块 openVariables」控制——进入某模块时打开这些根变量；未在任何 openVariables 中的根变量始终可见。初始未进入任何声明了该变量的模块时，该变量不可见。
     * @returns {Array<{ id, name, value, type }>}
     */
    getVariablesForPrompt(module, pathIds) {
        if (!module || !module.content) return [];
        const vars = typeof State !== 'undefined' && State.variables ? State.variables : {};
        const internal = this._internalVariableIds();
        const defs = this.getAllVariableDefs(module);
        const pathPrefix = (a, b) => a.length <= b.length && a.every((x, i) => x === b[i]);
        const openedByPath = this.getOpenedVarIdsByPath(module, pathIds);
        const allOpenedInTree = this.getAllOpenedVarIdsInTree(module);
        const result = [];
        defs.forEach((d) => {
            if (internal.indexOf(d.id) !== -1) return;
            if (d.visibility === false || d.visibility === 'hidden') return;
            if (d.variableRole === 'temp') return;
            if (d.pathIds.length > 0 && !pathPrefix(d.pathIds, pathIds)) return;
            if (d.pathIds.length === 0) {
                const inOpenedByPath = openedByPath.has(d.id);
                const needsOpening = allOpenedInTree.has(d.id);
                if (needsOpening && !inOpenedByPath) return;
            }
            if (d.visibleOnlyIn && d.visibleOnlyIn.length > 0) {
                const pathInScope = pathIds.some((id) => d.visibleOnlyIn.indexOf(id) !== -1);
                if (!pathInScope) return;
            }
            const value = vars[d.id] !== undefined ? vars[d.id] : d.value;
            result.push({
                id: d.id,
                name: d.name,
                value,
                type: d.type,
                readOnly: d.readOnly === true,
                listItemType: d.listItemType || undefined,
                itemSchema: d.itemSchema || undefined
            });
        });
        return result;
    },

    /**
     * 当前路径下应发给 AI 的变量相关说明（变量可见时：info + 按当前值匹配的 infoEntries）
     * @returns {string[]} 每项为一段说明文案
     */
    getVariableInfosForPrompt(module, pathIds) {
        if (!module || !module.content) return [];
        const vars = typeof State !== 'undefined' && State.variables ? State.variables : {};
        const internal = this._internalVariableIds();
        const defs = this.getAllVariableDefs(module);
        const pathPrefix = (a, b) => a.length <= b.length && a.every((x, i) => x === b[i]);
        const openedByPath = this.getOpenedVarIdsByPath(module, pathIds);
        const allOpenedInTree = this.getAllOpenedVarIdsInTree(module);
        const lines = [];
        defs.forEach((d) => {
            if (internal.indexOf(d.id) !== -1) return;
            if (d.visibility === false || d.visibility === 'hidden') return;
            if (d.pathIds.length > 0 && !pathPrefix(d.pathIds, pathIds)) return;
            if (d.pathIds.length === 0) {
                const inOpenedByPath = openedByPath.has(d.id);
                const needsOpening = allOpenedInTree.has(d.id);
                if (needsOpening && !inOpenedByPath) return;
            }
            if (d.visibleOnlyIn && d.visibleOnlyIn.length > 0) {
                const pathInScope = pathIds.some((id) => d.visibleOnlyIn.indexOf(id) !== -1);
                if (!pathInScope) return;
            }
            const currentVal = vars[d.id] !== undefined ? vars[d.id] : d.value;
            if (d.info && String(d.info).trim()) lines.push(String(d.info).trim());
            (d.infoEntries || []).forEach((entry) => {
                if (!entry || !entry.text) return;
                let match = false;
                if (entry.value !== undefined) {
                    match = currentVal === entry.value || currentVal == entry.value;
                } else if (entry.min != null && entry.max != null) {
                    const n = Number(currentVal);
                    if (!Number.isNaN(n)) match = n >= Number(entry.min) && n <= Number(entry.max);
                } else if (entry.min != null) {
                    const n = Number(currentVal);
                    if (!Number.isNaN(n)) match = n >= Number(entry.min);
                } else if (entry.max != null) {
                    const n = Number(currentVal);
                    if (!Number.isNaN(n)) match = n <= Number(entry.max);
                }
                if (match) lines.push(String(entry.text).trim());
            });
        });
        return lines;
    },

    /**
     * 当前路径下应发给 AI 的变量增减规则列表（从各变量的 changeRules 收集，可见且非只读变量才参与）
     * @returns {Array<{ variableId, variableName, description, op, value, trigger, min, max, aiDecides }>}
     */
    getVariableChangeRulesForPrompt(module, pathIds) {
        if (!module || !module.content) return [];
        const defs = this.getAllVariableDefs(module);
        const pathPrefix = (a, b) => a.length <= b.length && a.every((x, i) => x === b[i]);
        const openedByPath = this.getOpenedVarIdsByPath(module, pathIds);
        const allOpenedInTree = this.getAllOpenedVarIdsInTree(module);
        const internal = this._internalVariableIds();
        const result = [];
        defs.forEach((d) => {
            if (internal.indexOf(d.id) !== -1) return;
            if (d.visibility === false || d.visibility === 'hidden') return;
            if (d.readOnly === true) return;
            if (d.pathIds.length > 0 && !pathPrefix(d.pathIds, pathIds)) return;
            if (d.pathIds.length === 0) {
                const inOpenedByPath = openedByPath.has(d.id);
                const needsOpening = allOpenedInTree.has(d.id);
                if (needsOpening && !inOpenedByPath) return;
            }
            if (d.visibleOnlyIn && d.visibleOnlyIn.length > 0) {
                const pathInScope = pathIds.some((id) => d.visibleOnlyIn.indexOf(id) !== -1);
                if (!pathInScope) return;
            }
            const rules = Array.isArray(d.changeRules) ? d.changeRules : [];
            rules.forEach((r) => {
                result.push({
                    variableId: d.id,
                    variableName: d.name,
                    description: r.description,
                    op: r.op,
                    value: r.value,
                    trigger: r.trigger,
                    min: r.min,
                    max: r.max,
                    aiDecides: r.aiDecides === true
                });
            });
        });
        return result;
    },

    /**
     * 路径绑定的完整初始状态：根 initialStates + 路径上每一级节点（父级链）的 initialState，用于跳转时更新 State.variables 显示
     * @param {Object} module - 当前模组（含 content）
     * @param {string[]} pathIds - 模块路径
     * @returns {Object} { [varId]: value, ... }
     */
    getPathInitialState(module, pathIds) {
        if (!module || !module.content) return {};
        const content = module.content;
        const rootInitial = (content.initialStates && typeof content.initialStates === 'object' ? content.initialStates : {}) || {};
        const rootVars = Array.isArray(content.variables) ? content.variables : [];
        let acc = { ...rootInitial };
        rootVars.forEach((v) => {
            if (v && v.id != null && acc[v.id] === undefined && v.value !== undefined) acc[v.id] = v.value;
        });
        if (!pathIds || pathIds.length === 0) return acc;
        for (let i = 0; i < pathIds.length; i++) {
            const prefix = pathIds.slice(0, i + 1);
            const { node } = this.getModuleNodeByPath(module, prefix);
            if (!node) continue;
            const nodeInitial = (node.initialState && typeof node.initialState === 'object' ? node.initialState : null)
                || (node.initialStates && typeof node.initialStates === 'object' ? node.initialStates : {}) || {};
            acc = { ...acc, ...nodeInitial };
        }
        return acc;
    },

    /**
     * 跳转时用的完整状态：min data（进入该节点的变量边界）+ 未在该路径上的变量重置为默认值
     */
    getStateForPath(pathIds) {
        const cur = this.currentModule;
        if (!cur || !pathIds || pathIds.length === 0) return {};
        const pathKey = pathIds.join('|');
        const minData = (State.moduleMinData && State.moduleMinData[cur.id] && State.moduleMinData[cur.id][pathKey]) ? State.moduleMinData[cur.id][pathKey] : {};
        const overrides = (State.flowNodeOverrides && State.flowNodeOverrides[cur.id] && State.flowNodeOverrides[cur.id][pathKey]) ? State.flowNodeOverrides[cur.id][pathKey] : null;
        let data = overrides && typeof overrides === 'object' ? { ...overrides } : { ...minData };
        const defs = this.getAllVariableDefs(cur);
        const pathPrefix = (a, b) => a.length <= b.length && a.every((x, i) => x === b[i]);
        defs.forEach((d) => {
            if (d.pathIds.length > 0 && !pathPrefix(d.pathIds, pathIds)) {
                data[d.id] = d.value;
            }
        });
        return data;
    },

    /**
     * 多路径时合并状态（并行节点如 NPC 事件）：各路径的进入边界合并，未在任一路径上的变量重置为默认值
     */
    getStateForPaths(pathsArray) {
        if (!pathsArray || pathsArray.length === 0) return {};
        let merged = {};
        pathsArray.forEach((pathIds) => {
            if (pathIds && pathIds.length) {
                Object.assign(merged, this.getStateForPath(pathIds));
            }
        });
        return merged;
    },

    /**
     * 按理论顺序跑一遍模块树，计算到达每个节点所需的最低 data（变量集合）
     * 用于流程树跳转时自动满足该节点的开启条件；导入/加载模组时调用并存入 State.moduleMinData
     * @param {Object} module - 故事模块（含 content.subModules）
     * @returns {{ [pathKey: string]: { [varId: string]: any } }}
     */
    computeModuleMinData(module) {
        const out = {};
        if (!module || !module.content) return out;
        const content = module.content;
        const rootVars = Array.isArray(content.variables) ? content.variables : [];
        const rootInitial = (content.initialStates && typeof content.initialStates === 'object' ? content.initialStates : {}) || {};
        let acc = { ...rootInitial };
        rootVars.forEach((v) => {
            if (v && v.id != null && acc[v.id] === undefined && v.value !== undefined) {
                acc[v.id] = v.value;
            }
        });
        const pathKey = (pathIds) => pathIds.join('|');

        const walk = (subModules, pathIds) => {
            (subModules || []).forEach((n) => {
                const id = n.id || n.name;
                if (!id) return;
                const ids = [...pathIds, id];
                acc = { ...acc };
                const nodeInitial = (n.initialState && typeof n.initialState === 'object' ? n.initialState : null)
                    || (n.initialStates && typeof n.initialStates === 'object' ? n.initialStates : {}) || {};
                Object.assign(acc, nodeInitial);
                const openCond = n.openCondition;
                if (openCond && openCond.type === 'variable' && openCond.variableId) {
                    this._applyConditionToAcc(acc, openCond);
                }
                const reqs = Array.isArray(n.variableRequirements) ? n.variableRequirements : [];
                reqs.forEach((r) => {
                    if (r.condition && r.condition.type === 'variable' && r.condition.variableId) {
                        this._applyConditionToAcc(acc, r.condition);
                    }
                    if (r.variableId != null) {
                        acc[r.variableId] = r.value !== undefined ? r.value : true;
                    }
                });
                out[pathKey(ids)] = { ...acc };
                walk(n.subModules || [], ids);
            });
        };
        walk(content.subModules || [], []);
        return out;
    },

    /**
     * 日历辅助：30 天/月，360 天/年；返回 dayCount 与 calendar 互转
     */
    _calendarToDayCount(cal) {
        if (!cal || typeof cal !== 'object') return 1;
        const y = Math.max(1, Number(cal.year) || 1);
        const m = Math.max(1, Math.min(12, Number(cal.month) || 1));
        const d = Math.max(1, Math.min(30, Number(cal.day) || 1));
        return (y - 1) * 360 + (m - 1) * 30 + d;
    },
    _dayCountToCalendar(dayCount) {
        let n = Math.max(1, Math.floor(Number(dayCount) || 1));
        const year = Math.floor(n / 360) + 1;
        n = n % 360;
        const month = Math.floor(n / 30) + 1;
        const day = (n % 30) || 30;
        return { year, month, day };
    },

    /**
     * 若当前路径包含「排期随机器」节点且尚未排期，则取排期结果并写入 State.calendarScheduledEvents。
     * 优先使用模组内自定义随机器（scheduleRandomizerPluginId + 脚本注册到 window.ScheduleRandomizers）；
     * 未配置或未注册时使用系统内置：从 random-pools/<poolId>/tasks.json 抽 count 个并随机排日。
     * @param {Object} module - 当前故事模块
     * @param {string[]} pathIds - 当前路径
     * @returns {Promise<void>}
     */
    async runScheduleRandomizerIfNeeded(module, pathIds) {
        if (!module || !module.content || !Array.isArray(pathIds) || pathIds.length === 0) return;
        if (typeof State === 'undefined' || !State.calendarScheduledEvents) return;
        const folderKey = module.folderKey || module.id.replace(/^story_/, '');
        const cfg = module.content.schedulerConfig || {};
        const scheduleAheadMonths = Math.max(1, Number(cfg.scheduleAheadMonths) || 3);
        const vars = State.variables || {};
        const cal = this._getTimeObject(vars, module) || { year: 1, month: 1, day: 1 };
        const todayCount = this._calendarToDayCount(cal);
        const maxDays = scheduleAheadMonths * 30;

        for (let i = 0; i < pathIds.length; i++) {
            const pathPrefix = pathIds.slice(0, i + 1);
            const { node } = this.getModuleNodeByPath(module, pathPrefix);
            const lr = node && node.linkedScheduleRandomizer;
            if (!lr) continue;
            const scheduleToCalendar = lr.scheduleToCalendar === true || (lr.generatorId && !lr.poolId);
            if (!scheduleToCalendar) continue;
            const pathKey = module.id + '|' + pathPrefix.join('|');
            if (State.scheduledForModules && State.scheduledForModules[pathKey]) continue;

            let effectivePoolId = lr.poolId;
            let effectiveCount = lr.count != null ? Number(lr.count) : 5;
            if (lr.generatorId && module.content && module.content.pluginConfigs) {
                const gen = module.content.pluginConfigs[lr.generatorId];
                if (gen && gen.type === 'schedule-generator' && gen.randomizerId) {
                    const rand = module.content.pluginConfigs[gen.randomizerId];
                    if (rand && rand.type === 'randomizer') {
                        effectivePoolId = rand.poolId != null ? rand.poolId : (Array.isArray(rand.poolIds) && rand.poolIds.length > 0 ? rand.poolIds[0] : effectivePoolId);
                        const pc = rand.pickCount;
                        effectiveCount = rand.count != null ? Number(rand.count) : (typeof pc === 'object' && pc != null ? Math.max(1, Math.floor(((pc.min || 0) + (pc.max || 0)) / 2)) : (pc != null ? Number(pc) : 5));
                    }
                }
            }

            const options = {
                scheduleAheadMonths,
                todayCount,
                maxDays,
                folderKey,
                lr,
                dayCountToCalendar: (n) => this._dayCountToCalendar(n),
                calendarToDayCount: (c) => this._calendarToDayCount(c)
            };

            let eventsToSchedule = [];
            const useCustom = lr.scheduleRandomizerPluginId != null || lr.scheduleRandomizerScript != null;
            const pluginId = lr.scheduleRandomizerPluginId || (useCustom && node ? (node.id || node.name) : null);
            const scriptPath = lr.scheduleRandomizerScript || (pluginId ? `plugins/${pluginId}.js` : null);

            if (useCustom && (pluginId || scriptPath)) {
                const idToCall = lr.scheduleRandomizerPluginId || (node && (node.id || node.name));
                if (typeof window !== 'undefined' && window.ScheduleRandomizers && idToCall && typeof window.ScheduleRandomizers[idToCall] === 'function') {
                    try {
                        const custom = await window.ScheduleRandomizers[idToCall](module, node, pathPrefix, vars, options);
                        eventsToSchedule = Array.isArray(custom) ? custom : [];
                    } catch (e) {
                        console.warn('[ModuleManager] custom schedule randomizer failed:', idToCall, e);
                    }
                }
                if (eventsToSchedule.length === 0 && scriptPath) {
                    try {
                        const scriptUrl = `${MODULE_FOLDER}/${folderKey}/${scriptPath.replace(/^\//, '')}`;
                        const res = await fetch(scriptUrl);
                        if (res.ok) {
                            const code = await res.text();
                            try { (function () { eval(code); })(); } catch (_) { /* 脚本可自行注册到 window.ScheduleRandomizers */ }
                            const idToCall2 = lr.scheduleRandomizerPluginId || (node && (node.id || node.name));
                            if (idToCall2 && window.ScheduleRandomizers && typeof window.ScheduleRandomizers[idToCall2] === 'function') {
                                const custom = await window.ScheduleRandomizers[idToCall2](module, node, pathPrefix, vars, options);
                                eventsToSchedule = Array.isArray(custom) ? custom : [];
                            }
                        }
                    } catch (e) {
                        console.warn('[ModuleManager] schedule randomizer script load failed:', scriptPath, e);
                    }
                }
            }

            if (eventsToSchedule.length === 0 && effectivePoolId) {
                let items = [];
                try {
                    const res = await fetch(`${MODULE_FOLDER}/${folderKey}/random-pools/${effectivePoolId}/tasks.json`);
                    if (res.ok) {
                        const data = await res.json();
                        items = Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : []);
                    }
                } catch (e) {
                    console.warn('[ModuleManager] runScheduleRandomizerIfNeeded fetch pool failed:', effectivePoolId, e);
                }
                const count = Math.max(1, Math.min(items.length * 2, effectiveCount));
                const usedDays = new Set();
                for (let k = 0; k < count && items.length > 0; k++) {
                    const item = items[Math.floor(Math.random() * items.length)];
                    const id = item.id || item.label || `task_${k}`;
                    const content = item.content != null ? item.content : (item.label || id);
                    let offset = Math.floor(Math.random() * maxDays) + 1;
                    while (usedDays.has(offset) && usedDays.size < maxDays) offset = Math.floor(Math.random() * maxDays) + 1;
                    usedDays.add(offset);
                    eventsToSchedule.push({
                        content: typeof content === 'string' ? content : JSON.stringify(content),
                        triggerDate: this._dayCountToCalendar(todayCount + offset),
                        condition: lr.condition && typeof lr.condition === 'object' ? lr.condition : undefined,
                        promptTemplateId: lr.promptTemplateId || 'timeline_event',
                        id,
                        name: item.label || id
                    });
                }
            }

            const defaultCondition = lr.condition && typeof lr.condition === 'object' ? lr.condition : undefined;
            const usedDays = new Set();
            for (let k = 0; k < eventsToSchedule.length; k++) {
                const ev = eventsToSchedule[k];
                let triggerDate = ev.triggerDate && typeof ev.triggerDate === 'object' ? ev.triggerDate : null;
                if (!triggerDate) {
                    let offset = Math.floor(Math.random() * maxDays) + 1;
                    while (usedDays.has(offset) && usedDays.size < maxDays) offset = Math.floor(Math.random() * maxDays) + 1;
                    usedDays.add(offset);
                    triggerDate = this._dayCountToCalendar(todayCount + offset);
                }
                const id = ev.id || `sched_${k}`;
                const name = ev.name || id;
                State.calendarScheduledEvents.push({
                    id: `sched_${pathKey.replace(/\|/g, '_')}_${String(id).replace(/\|/g, '_')}_${k}`,
                    name,
                    triggerDate,
                    content: typeof ev.content === 'string' ? ev.content : JSON.stringify(ev.content != null ? ev.content : ''),
                    promptTemplateId: ev.promptTemplateId || lr.promptTemplateId || 'timeline_event',
                    condition: ev.condition && typeof ev.condition === 'object' ? ev.condition : defaultCondition
                });
                // 2026-06-05：cap 1000 防排期 fail（触发后理论 remove）累积撑爆 State
                while (State.calendarScheduledEvents.length > 1000) State.calendarScheduledEvents.shift();
            }
            if (eventsToSchedule.length > 0) {
                if (!State.scheduledForModules) State.scheduledForModules = {};
                State.scheduledForModules[pathKey] = true;
            }
        }
    },

    /**
     * 获取当前路径下活跃节点的 tags 并集（整条路径上所有节点的 tags，用于时间线事件 allowedTags 过滤）
     */
    getActiveLeafTags(module) {
        if (!module) return [];
        const currentPaths = (typeof State !== 'undefined' && State.currentModulePath)
            ? (Array.isArray(State.currentModulePath[0]) ? State.currentModulePath : [State.currentModulePath])
            : [];
        const tags = new Set();
        for (const pathIds of currentPaths) {
            if (!Array.isArray(pathIds) || pathIds.length === 0) continue;
            for (let i = 1; i <= pathIds.length; i++) {
                const prefix = pathIds.slice(0, i);
                const { node } = this.getModuleNodeByPath(module, prefix);
                if (node && Array.isArray(node.tags)) node.tags.forEach((t) => tags.add(t));
            }
        }
        return Array.from(tags);
    },

    /**
     * 求值时间线事件的 condition（扁平对象：键为变量 id，值为需匹配的值；支持 calendar_year/month/day/era；使用模组绑定的时间变量）
     */
    _evaluateTimelineCondition(condition, vars, module = null) {
        if (!condition || typeof condition !== 'object') return true;
        const timeVarId = module ? this._getTimeVarId(module) : undefined;
        const getVal = (v, k) => (typeof getVariableValue === 'function' ? getVariableValue(v, k, timeVarId) : v[k]);
        for (const [key, want] of Object.entries(condition)) {
            const got = getVal(vars, key);
            if (got !== want && got != want) return false;
        }
        return true;
    },

    /**
     * 计算时间线重复触发的去重 key（单位+每N 或 按区间 intervals）
     */
    _getTimelineRepeatKey(repeat, year, month, day) {
        if (!repeat) return true;
        if (repeat === 'yearly') return year != null ? String(year) : true;
        if (repeat === 'monthly') return (year != null && month != null) ? `${year}-${month}` : true;
        if (typeof repeat === 'object' && Array.isArray(repeat.intervals) && repeat.intervals.length > 0) {
            const toOrd = (o) => {
                if (!o || typeof o !== 'object') return 0;
                return (Number(o.year) || 0) * 10000 + (Number(o.month) || 1) * 100 + (Number(o.day) || 1);
            };
            const curOrd = (year != null && month != null && day != null) ? toOrd({ year, month, day }) : 0;
            for (let i = 0; i < repeat.intervals.length; i++) {
                const iv = repeat.intervals[i];
                if (!iv || typeof iv.start !== 'object' || typeof iv.end !== 'object') continue;
                const s = toOrd(iv.start);
                const e = toOrd(iv.end);
                if (curOrd < s || curOrd > e) continue;
                if (iv.unit && iv.interval != null && iv.interval >= 1) {
                    const u = iv.unit;
                    const intv = iv.interval;
                    if (u === 'day' && year != null && month != null && day != null) {
                        const start = new Date(year, 0, 0);
                        const d = new Date(year, month - 1, day);
                        const dayOfYear = Math.round((d - start) / (24 * 60 * 60 * 1000));
                        return `interval-${i}-${year}-${Math.floor(dayOfYear / intv)}`;
                    }
                    if (u === 'year' && year != null) return `interval-${i}-${Math.floor(year / intv)}`;
                    if (u === 'month' && year != null && month != null) return `interval-${i}-${year}-${Math.floor((month - 1) / intv)}`;
                    if (u === 'week' && year != null && month != null && day != null) {
                        const start = new Date(year, 0, 0);
                        const d = new Date(year, month - 1, day);
                        const dayOfYear = Math.round((d - start) / (24 * 60 * 60 * 1000));
                        return `interval-${i}-${year}-${Math.floor(dayOfYear / 7 / intv)}`;
                    }
                }
                return `interval-${i}`;
            }
            return null;
        }
        if (typeof repeat !== 'object' || !repeat.unit) return true;
        const u = repeat.unit;
        const interval = (repeat.interval != null && repeat.interval >= 1) ? repeat.interval : 1;
        if (u === 'year') {
            if (repeat.month != null && year != null && month != null) return `${year}-${month}`;
            return year != null ? String(Math.floor(year / interval)) : true;
        }
        if (u === 'month') {
            if (repeat.day != null && year != null && month != null && day != null) return `${year}-${month}-${day}`;
            return (year != null && month != null) ? `${year}-${Math.floor((month - 1) / interval)}` : true;
        }
        if (u === 'week') {
            if (year != null && month != null && day != null) {
                const start = new Date(year, 0, 0);
                const d = new Date(year, month - 1, day);
                const dayOfYear = Math.round((d - start) / (24 * 60 * 60 * 1000));
                const weekOfYear = Math.floor(dayOfYear / 7);
                return `${year}-${Math.floor(weekOfYear / interval)}` + (repeat.dayOfWeek != null ? '-' + repeat.dayOfWeek : '');
            }
            return true;
        }
        if (u === 'day' || u === 'hour' || u === 'minute') {
            if (year != null && month != null && day != null) {
                const start = new Date(year, 0, 0);
                const d = new Date(year, month - 1, day);
                const dayOfYear = Math.round((d - start) / (24 * 60 * 60 * 1000));
                return `${year}-${Math.floor(dayOfYear / interval)}`;
            }
            return true;
        }
        return true;
    },

    /**
     * 获取当前应触发的时间线事件（content.timelineEvents + moduleGroup 内 type===timeline 节点 + State.calendarScheduledEvents 动态排期）
     */
    getTriggeredTimelineEvents(module, vars) {
        if (!module || !module.content) return [];
        const timeVarId = this._getTimeVarId(module);
        const getVal = (v, k) => (typeof getVariableValue === 'function' ? getVariableValue(v, k, timeVarId) : v[k]);
        const year = getVal(vars, 'calendar_year');
        const month = getVal(vars, 'calendar_month');
        const day = getVal(vars, 'calendar_day');
        const out = [];
        const seenIds = new Set();

        const events = module.content.timelineEvents;
        const triggered = (typeof State !== 'undefined' && State.triggeredTimelineEvents && State.triggeredTimelineEvents[module.id]) ? State.triggeredTimelineEvents[module.id] : {};
        const addTimelineNode = (node, pathIds) => {
            if (node.type !== 'timeline' || node._timelineEvent) return;
            const enterCond = node.enterCondition || node.timelineTrigger;
            if (enterCond != null && !this._evaluateCondition(enterCond, vars, module)) return;
            const eventId = node.id || node.name;
            if (!eventId || seenIds.has(eventId)) return;
            const pathKey = pathIds && pathIds.length > 0 ? pathIds.join('|') : '';
            if (pathKey && triggered[eventId] === true) return;
            seenIds.add(eventId);
            out.push({
                id: eventId,
                name: node.name || eventId,
                content: node.content || '',
                promptTemplateId: node.promptTemplateId,
                scheduled: false,
                _fromModuleGroup: true
            });
        };
        const walkTimelineNodes = (nodes, pathIds) => {
            (nodes || []).forEach((n) => {
                const id = n.id || n.name;
                if (!id) return;
                const ids = [...(pathIds || []), id];
                if (n.type === 'timeline') addTimelineNode(n, ids);
                walkTimelineNodes(n.subModules || n.moduleGroup || [], ids);
            });
        };
        walkTimelineNodes(module.content.subModules || module.content.moduleGroup || [], []);

        if (Array.isArray(events)) {
            for (const ev of events) {
                if (ev.trigger !== 'calendar') continue;
                if (!this._evaluateTimelineCondition(ev.condition, vars, module)) continue;
                const eventId = ev.id || ev.name;
                if (!eventId) continue;
                const repeat = ev.repeat;
                if (repeat && typeof repeat === 'object' && repeat.unit === 'year' && repeat.month != null && month !== repeat.month) continue;
                if (repeat && typeof repeat === 'object' && repeat.unit === 'month' && repeat.day != null && day !== repeat.day) continue;
                if (repeat && typeof repeat === 'object' && repeat.unit === 'week' && repeat.dayOfWeek != null) {
                    const d = (day != null && month != null && year != null) ? new Date(year, month - 1, day).getDay() : -1;
                    if (d !== repeat.dayOfWeek) continue;
                }
                const repeatKey = this._getTimelineRepeatKey(repeat, year, month, day);
                if (repeat && typeof repeat === 'object' && Array.isArray(repeat.intervals) && repeat.intervals.length > 0 && !repeatKey) continue;
                if (triggered[eventId] === true) continue;
                if (repeatKey && triggered[eventId] === repeatKey) continue;
                if (ev.allowedTags && ev.allowedTags.length > 0) {
                    const activeTags = this.getActiveLeafTags(module);
                    const hasMatch = ev.allowedTags.some((t) => activeTags.indexOf(t) !== -1);
                    if (!hasMatch) continue;
                }
                if (seenIds.has(eventId)) continue;
                seenIds.add(eventId);
                out.push({
                    id: eventId,
                    name: ev.name || eventId,
                    content: ev.content || '',
                    promptTemplateId: ev.promptTemplateId,
                    scheduled: false
                });
            }
        }

        const scheduled = (typeof State !== 'undefined' && State.calendarScheduledEvents) ? State.calendarScheduledEvents : [];
        for (const ev of scheduled) {
            const d = ev.triggerDate;
            if (!d || d.year !== year || d.month !== month || d.day !== day) continue;
            if (ev.condition && !this._evaluateTimelineCondition(ev.condition, vars, module)) continue;
            out.push({
                id: ev.id,
                name: ev.name || ev.id,
                content: ev.content || '',
                promptTemplateId: ev.promptTemplateId,
                scheduled: true
            });
        }
        return out;
    },

    /**
     * 标记时间线事件已触发（发送后调用）；动态排期事件从 calendarScheduledEvents 移除
     */
    markTimelineEventsTriggered(moduleId, events, vars) {
        if (!events || events.length === 0) return;
        if (typeof State === 'undefined') return;
        const scheduledIds = new Set(events.filter((e) => e.scheduled).map((e) => e.id));
        if (scheduledIds.size > 0 && State.calendarScheduledEvents) {
            State.calendarScheduledEvents = State.calendarScheduledEvents.filter((e) => !scheduledIds.has(e.id));
        }
        const normal = events.filter((e) => !e.scheduled);
        if (normal.length === 0) return;
        if (!State.triggeredTimelineEvents) return;
        const cur = this.currentModule;
        const list = (cur && cur.id === moduleId && cur.content && cur.content.timelineEvents) ? cur.content.timelineEvents : [];
        const timeVarId = cur ? this._getTimeVarId(cur) : undefined;
        const getVal = (v, k) => (typeof getVariableValue === 'function' ? getVariableValue(v, k, timeVarId) : v[k]);
        const year = getVal(vars, 'calendar_year');
        const month = getVal(vars, 'calendar_month');
        const day = getVal(vars, 'calendar_day');
        if (!State.triggeredTimelineEvents[moduleId]) State.triggeredTimelineEvents[moduleId] = {};
        for (const ev of normal) {
            const def = list.find((e) => (e.id || e.name) === ev.id);
            const repeat = def && def.repeat;
            const key = this._getTimelineRepeatKey(repeat, year, month, day);
            if (key != null) State.triggeredTimelineEvents[moduleId][ev.id] = key;
            if (def && def.onCompleteSetVariable && typeof def.onCompleteSetVariable === 'object') {
                if (!State.variables) State.variables = {};
                for (const [varId, val] of Object.entries(def.onCompleteSetVariable)) {
                    State.variables[varId] = val;
                }
            }
        }
    },

    /**
     * 根据条件更新 acc，使条件满足（如 >= 20 则至少为 20）
     */
    _applyConditionToAcc(acc, cond) {
        const id = cond.variableId;
        const op = cond.operator;
        const val = cond.value;
        if (id == null) return;
        const current = acc[id];
        switch (op) {
            case '>=':
                acc[id] = Math.max(current !== undefined ? Number(current) : -Infinity, Number(val));
                break;
            case '>':
                acc[id] = Math.max(current !== undefined ? Number(current) : -Infinity, Number(val) + 1);
                break;
            case '==':
                acc[id] = val;
                break;
            case '!=':
                if (current === val) acc[id] = val === true ? false : (val === false ? true : current);
                break;
            default:
                if (val !== undefined) acc[id] = val;
        }
    }
};

// 导出
if (typeof window !== 'undefined') {
    window.ModuleManager = ModuleManager;
}
