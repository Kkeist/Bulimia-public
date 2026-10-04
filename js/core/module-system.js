/**
 * Module System - 模块系统
 * Manages game modules with types, lifecycle, flows, and queue management
 * Based on game-v4/docs/01-core-schemas.md
 */

/**
 * Module States
 */
/** 模块状态：三者互斥，只能取其一。无 triggered。 */
const MODULE_STATES = {
    UNTRIGGERED: 'untriggered',
    ENTERED: 'entered',
    COMPLETED: 'completed'
};

/**
 * Module Types
 */
const MODULE_TYPES = {
    TIMELINE: 'timeline',
    TRIGGER_CHAIN: 'trigger_chain',
    FREE_TRIGGER: 'free_trigger'
};

/**
 * GameModule - represents a single module
 */
class GameModule {
    constructor(config, parentModuleId = null, flowName = 'main') {
        // 原始配置：导出时用它保留系统不认识的字段，保证导出再导入内容不丢
        this._raw = config;
        this.id = config.id;
        this.name = config.name;
        this.type = config.type;
        this.note = config.note || '';
        this.tags = config.tags || [];
        this.parentModuleId = parentModuleId;
        this.flowName = flowName;

        // State management
        this.state = MODULE_STATES.UNTRIGGERED;
        this.enteredTimestamp = null;
        this.completedTimestamp = null;
        /** 运行时：是否被标记为「中断未完成」（01-core-schemas 7.3） */
        this.interrupted = false;
        /** 运行时：中断时填写的总结，供续玩调取 */
        this.interruptSummary = null;

        // Conditions（01-core-schemas: 支持单对象或数组，统一规范为数组）
        this.entryConditions = this._normalizeConditionWrappers(config.entryConditions);
        this.completionConditions = this._normalizeConditionWrappers(config.completionConditions);

        // Content
        this.info = config.info || [];
        this.deliveryInfo = (config.deliveryInfo || []).map(d => ({
            ...d,
            completed: d.completed || false
        }));

        // Display config
        this.queueDisplay = config.queueDisplay || null;

        // For trigger_chain
        this.linkedList = config.linkedList || { prev: null, next: null };

        // For timeline: 时间线按时间进入要求排序用（可选，无则按 0）
        this.triggerTime = config.triggerTime != null ? config.triggerTime : undefined;

        // Variables and plugins
        this.variables = config.variables || [];
        this.plugins = config.plugins || [];
        this.autoSetVariables = config.autoSetVariables || null;
        /** 进入本模块时强制设置的变量（由模组配置，系统不写死任何模组 id 或数值） */
        this.variableSetOnEnter = config.variableSetOnEnter || null;

        // Sub-modules and flows
        this.flows = config.flows || {};
        this.subModules = new Map(); // Map<flowName, Map<moduleId, GameModule>>
        this.flowSummaries = new Map(); // Map<flowName, normalized flow.summary>（01-core-schemas 分流程总结配置）

        // Summary configuration（01-core-schemas: promptList[].condition 与 conditionDef 兼容）
        this.summary = this._normalizeModuleSummary(config.summary || { enabled: false });
        this.summaryText = '';

        // Parse sub-modules（含 flow.summary 解析）
        this.parseSubModules();
    }

    /**
     * Normalize module summary.promptList: 统一使用 conditionDef（兼容 condition 键名）
     * @private
     */
    _normalizeModuleSummary(summary) {
        if (!summary || !summary.promptList || !Array.isArray(summary.promptList)) {
            return summary || { enabled: false };
        }
        return {
            ...summary,
            promptList: summary.promptList.map(item => ({
                ...item,
                conditionDef: item.conditionDef != null ? item.conditionDef : item.condition
            }))
        };
    }

    /**
     * Normalize flow summary（与 module.summary 同一格式：promptList[].condition + content）
     * @private
     */
    _normalizeFlowSummary(summary) {
        return this._normalizeModuleSummary(summary);
    }

    /**
     * 获取分流程总结配置（与 module.summary 同一格式）
     * @param {string} flowName
     * @returns {object|null} { enabled, autoSummarize?, promptList: [{ conditionDef, content }] }
     */
    getFlowSummaryConfig(flowName) {
        return this.flowSummaries.get(flowName) || null;
    }

    /**
     * Normalize entryConditions/completionConditions to array (schema 允许单对象)
     * @private
     */
    _normalizeConditionWrappers(wrappers) {
        if (!wrappers) return [];
        if (Array.isArray(wrappers)) return wrappers;
        if (wrappers && typeof wrappers === 'object' && wrappers.type && wrappers.conditionDef) {
            return [wrappers];
        }
        return [];
    }

    /**
     * Parse sub-modules from flows
     */
    parseSubModules() {
        for (const [flowName, flowData] of Object.entries(this.flows)) {
            if (!this.subModules.has(flowName)) {
                this.subModules.set(flowName, new Map());
            }

            if (flowData.summary && flowData.summary.enabled) {
                this.flowSummaries.set(flowName, this._normalizeFlowSummary(flowData.summary));
            }

            const flowModules = this.subModules.get(flowName);
            if (flowData.subModules) {
                for (const subConfig of flowData.subModules) {
                    const subModule = new GameModule(subConfig, this.id, flowName);
                    flowModules.set(subModule.id, subModule);
                }
            }
        }
    }

    /**
     * Get all sub-modules across all flows
     */
    getAllSubModules() {
        const allSubs = [];
        for (const flowModules of this.subModules.values()) {
            allSubs.push(...flowModules.values());
        }
        return allSubs;
    }

    /**
     * Get sub-modules for a specific flow
     */
    getFlowSubModules(flowName) {
        return this.subModules.get(flowName) || new Map();
    }

    /**
     * 将时间戳存为普通对象（可序列化、可在作弊器编辑）。支持 TimePoint 或 { year, month, day, hour?, minute? }。
     */
    _normalizeRecordTime(timestamp) {
        if (timestamp == null) return null;
        if (typeof timestamp !== 'object') return null;
        return {
            year: timestamp.year ?? 1,
            month: timestamp.month ?? 1,
            day: timestamp.day ?? 1,
            hour: timestamp.hour ?? 0,
            minute: timestamp.minute ?? 0
        };
    }

    /**
     * Change module state.
     * 进入/完成时传入的 timestamp 会写入 enteredTimestamp/completedTimestamp（默认当前时间，由 jumpToModule/completeModule 传入 timeSystem.getCurrentTime()）。
     */
    setState(newState, timestamp) {
        this.state = newState;

        if (newState === MODULE_STATES.ENTERED) {
            this.enteredTimestamp = this._normalizeRecordTime(timestamp);
        } else if (newState === MODULE_STATES.COMPLETED) {
            this.completedTimestamp = this._normalizeRecordTime(timestamp);
        }
        if (newState === MODULE_STATES.UNTRIGGERED) {
            this.enteredTimestamp = null;
            this.completedTimestamp = null;
            this.interrupted = false;
            this.interruptSummary = null;
        }
    }

    /**
     * Check if in a specific state
     */
    isInState(state) {
        return this.state === state;
    }

    /**
     * Mark a deliveryInfo as completed
     */
    completeDeliveryInfo(title) {
        const item = this.deliveryInfo.find(d => d.title === title);
        if (item) {
            item.completed = true;
            return true;
        }
        return false;
    }

    /**
     * Mark a deliveryInfo as not completed
     */
    uncompleteDeliveryInfo(title) {
        const item = this.deliveryInfo.find(d => d.title === title);
        if (item) {
            item.completed = false;
            return true;
        }
        return false;
    }

    /**
     * 导出为可写回 module.json 的配置对象（不含运行时状态）。
     * 字段顺序沿用原始配置；原始配置里有而这里不认识的字段原样保留；
     * 原本没写的字段，取值不是默认值才写出；live 与原始规范化后相同的字段保留原始写法。
     * @returns {Object}
     */
    toConfig() {
        const raw = this._raw && typeof this._raw === 'object' ? this._raw : {};
        const has = (k) => Object.prototype.hasOwnProperty.call(raw, k);
        const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
        const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

        const live = {
            id: this.id, name: this.name, type: this.type, note: this.note, tags: this.tags,
            entryConditions: this.entryConditions, completionConditions: this.completionConditions,
            info: this.info, queueDisplay: this.queueDisplay, linkedList: this.linkedList,
            triggerTime: this.triggerTime, variables: this.variables, plugins: this.plugins,
            autoSetVariables: this.autoSetVariables, variableSetOnEnter: this.variableSetOnEnter
        };
        const defaults = {
            note: '', tags: [], entryConditions: [], completionConditions: [], info: [],
            queueDisplay: null, linkedList: { prev: null, next: null }, triggerTime: undefined,
            variables: [], plugins: [], autoSetVariables: null, variableSetOnEnter: null
        };
        const rawNorm = {
            id: raw.id, name: raw.name, type: raw.type,
            note: raw.note || '', tags: raw.tags || [],
            entryConditions: this._normalizeConditionWrappers(raw.entryConditions),
            completionConditions: this._normalizeConditionWrappers(raw.completionConditions),
            info: raw.info || [], queueDisplay: raw.queueDisplay || null,
            linkedList: raw.linkedList || { prev: null, next: null },
            triggerTime: raw.triggerTime != null ? raw.triggerTime : undefined,
            variables: raw.variables || [], plugins: raw.plugins || [],
            autoSetVariables: raw.autoSetVariables || null, variableSetOnEnter: raw.variableSetOnEnter || null
        };

        const deliveryValue = () => {
            const rawList = Array.isArray(raw.deliveryInfo) ? raw.deliveryInfo : [];
            return this.deliveryInfo.map((d) => {
                const o = clone(d);
                const orig = rawList.find((r) => r && r.title === d.title);
                // completed 是运行时进度，只保留原配置里写明的初始值
                if (orig && Object.prototype.hasOwnProperty.call(orig, 'completed')) o.completed = orig.completed;
                else delete o.completed;
                return o;
            });
        };
        const summaryValue = () => {
            const sm = clone(this.summary);
            if (sm && Array.isArray(sm.promptList)) {
                sm.promptList = sm.promptList.map((it) => {
                    if (it && it.condition !== undefined && it.conditionDef !== undefined) delete it.conditionDef;
                    return it;
                });
            }
            return sm;
        };
        const flowsValue = () => {
            const meta = this.flows && typeof this.flows === 'object' ? this.flows : {};
            const names = Object.keys(meta);
            for (const fn of this.subModules.keys()) if (!names.includes(fn)) names.push(fn);
            const out = {};
            for (const fn of names) {
                const src = meta[fn] && typeof meta[fn] === 'object' ? meta[fn] : {};
                const o = {};
                for (const k of Object.keys(src)) if (k !== 'subModules') o[k] = clone(src[k]);
                const subs = this.subModules.get(fn);
                o.subModules = subs ? [...subs.values()].map((m) => m.toConfig()) : [];
                out[fn] = o;
            }
            return out;
        };
        const cleanPlugins = (list) => list.map((p) => {
            if (!p || typeof p !== 'object') return p;
            const o = {};
            for (const k of Object.keys(p)) if (k[0] !== '_') o[k] = p[k];
            return o;
        });

        const out = {};
        const emit = (key) => {
            if (key === 'id' || key === 'name' || key === 'type') {
                if (live[key] !== undefined) out[key] = live[key];
            } else if (key === 'deliveryInfo') {
                if (has(key) || this.deliveryInfo.length) out[key] = deliveryValue();
            } else if (key === 'summary') {
                if (has(key) || (this.summary && this.summary.enabled)) out[key] = summaryValue();
            } else if (key === 'flows') {
                const f = flowsValue();
                if (has(key) || Object.keys(f).length) out[key] = f;
            } else if (key in live) {
                const lv = key === 'plugins' ? cleanPlugins(live[key]) : live[key];
                if (has(key)) out[key] = same(lv, rawNorm[key]) ? clone(raw[key]) : clone(lv);
                else if (!same(lv, defaults[key])) out[key] = clone(lv);
            } else if (has(key)) {
                out[key] = clone(raw[key]);
            }
        };
        const order = Object.keys(raw);
        for (const k of ['id', 'name', 'type', 'note', 'tags', 'entryConditions', 'completionConditions', 'info', 'deliveryInfo',
            'queueDisplay', 'linkedList', 'triggerTime', 'variables', 'variableSetOnEnter', 'autoSetVariables', 'summary', 'plugins', 'flows']) {
            if (!order.includes(k)) order.push(k);
        }
        for (const k of order) emit(k);
        return out;
    }

    /**
     * Check if module is a leaf (has no sub-modules)
     */
    isLeaf() {
        for (const flowModules of this.subModules.values()) {
            if (flowModules.size > 0) return false;
        }
        return true;
    }

    /**
     * Get pending delivery info that should be displayed
     * @param {ConditionEvaluator} conditionEvaluator
     * @returns {Array}
     */
    getPendingDeliveryInfo(conditionEvaluator) {
        if (!this.deliveryInfo || !Array.isArray(this.deliveryInfo)) return [];
        return this.deliveryInfo.filter(d => {
            if (d.completed) return false;
            if (!d.condition || !conditionEvaluator) return true;
            return conditionEvaluator.evaluate(d.condition.conditionDef || d.condition, 'display');
        });
    }
}

/**
 * ModuleSystem - manages all modules
 */
class ModuleSystem {
    constructor() {
        this.modules = new Map(); // Map<moduleId, GameModule>
        this.rootModuleId = null;
        this.rootModule = null; // Root module (GameModule) - for test panel compatibility
        this.currentModulesByFlow = new Map(); // Map<flowName, GameModule> - 每个 flow 的当前模块
        this.variableSystem = null;
        this.timeSystem = null;
        this.conditionEvaluator = null;
    }

    /**
     * 检查模组配置是否能被正常加载，并找出会让流程失效的问题。
     * errors：会导致数据丢失或无法加载，不应继续导入；warnings：能加载但行为可能不符合预期。
     * 每条 { code, moduleId, name, message }，message 是可直接给创作者看的中文，用事件名而不是内部标识。
     * @param {Object} config 模组配置（与 module.json 同格式）
     * @returns {{ errors: Array, warnings: Array }}
     */
    static validateConfig(config) {
        const errors = [];
        const warnings = [];
        const err = (code, node, message, extra) => errors.push(Object.assign({ code, moduleId: node && node.id, name: node && node.name, message }, extra || {}));
        const warn = (code, node, message, extra) => warnings.push(Object.assign({ code, moduleId: node && node.id, name: node && node.name, message }, extra || {}));
        const label = (n) => (n && n.name) ? `「${n.name}」` : (n && n.id ? I18n.t('（标识 {id}）', { id: n.id }) : I18n.t('（未命名事件）'));
        const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

        if (!isObj(config)) {
            err('root-invalid', null, I18n.t('文件内容不是一个模组。'));
            return { errors, warnings };
        }
        if (typeof config.id !== 'string' || !config.id.trim()) err('root-no-id', config, I18n.t('模组缺少标识，无法导入。'));
        if (typeof config.name !== 'string' || !config.name.trim()) warn('root-no-name', config, I18n.t('模组没有名称。'));
        if (config.flows !== undefined && !isObj(config.flows)) {
            err('flows-invalid', config, I18n.t('模组的流程设置格式不正确。'));
            return { errors, warnings };
        }

        const TYPES = Object.values(MODULE_TYPES);
        const VAR_TYPES = ['number', 'string', 'boolean', 'list', 'object', 'list_of_object'];
        const VAR_CATS = ['module', 'switch', 'builtin', 'temp'];
        const nodes = [];          // { node, parent, flow, depth }
        const ids = new Map();     // id -> node
        const varDefs = new Map(); // variable id -> { def, owner }

        const walk = (node, parent, flow, depth) => {
            if (!isObj(node)) { err('module-invalid', parent, I18n.t('{label}的{flow}里有一个格式不正确的事件。', { label: label(parent), flow: flow === 'main' ? I18n.t('主流程') : I18n.t('分流程') })); return; }
            if (depth > 60) { err('too-deep', node, I18n.t('{label}嵌套层级过深。', { label: label(node) })); return; }
            nodes.push({ node, parent, flow, depth });
            if (depth === 0) {
                if (typeof node.id === 'string' && node.id.trim()) ids.set(node.id, node);
            } else if (typeof node.id !== 'string' || !node.id.trim()) {
                err('module-no-id', node, I18n.t('{label}缺少标识，无法导入。', { label: label(node) }));
            } else if (ids.has(node.id)) {
                err('duplicate-id', node, I18n.t('{a}与{b}使用了相同的标识，导入后其中一个会丢失。', { a: label(ids.get(node.id)), b: label(node) }), { otherName: ids.get(node.id).name });
            } else {
                ids.set(node.id, node);
            }
            if (node.flows !== undefined && !isObj(node.flows)) { err('flows-invalid', node, I18n.t('{label}的流程设置格式不正确。', { label: label(node) })); return; }
            for (const fn of Object.keys(node.flows || {})) {
                const f = node.flows[fn];
                if (!isObj(f) || (f.subModules !== undefined && !Array.isArray(f.subModules))) {
                    err('flow-invalid', node, I18n.t('{label}的流程「{flow}」格式不正确。', { label: label(node), flow: fn }));
                    continue;
                }
                (f.subModules || []).forEach((c) => walk(c, node, fn, depth + 1));
            }
        };
        walk(config, null, 'main', 0);

        // 变量定义
        for (const { node } of nodes) {
            if (!isObj(node)) continue;
            const list = node.variables;
            if (list !== undefined && !Array.isArray(list)) { err('variables-invalid', node, I18n.t('{label}的变量设置格式不正确。', { label: label(node) })); continue; }
            for (const v of (list || [])) {
                if (!isObj(v) || typeof v.id !== 'string' || !v.id.trim()) { err('variable-no-id', node, I18n.t('{label}里有一个变量缺少标识。', { label: label(node) })); continue; }
                if (varDefs.has(v.id)) {
                    err('duplicate-variable', node, I18n.t('变量「{name}」被定义了多次，导入后只有一份生效。', { name: v.name || v.id }));
                    continue;
                }
                varDefs.set(v.id, { def: v, owner: node });
                if (!VAR_TYPES.includes(v.type)) err('variable-bad-type', node, I18n.t('{label}的变量「{name}」类型不正确。', { label: label(node), name: v.name || v.id }));
                if (v.category !== undefined && !VAR_CATS.includes(v.category)) warn('variable-bad-category', node, I18n.t('{label}的变量「{name}」类别不认识。', { label: label(node), name: v.name || v.id }));
                const iv = v.initialValue;
                if (iv !== undefined && iv !== null) {
                    const okType = ({ number: typeof iv === 'number', string: typeof iv === 'string', boolean: typeof iv === 'boolean', list: Array.isArray(iv), object: isObj(iv), list_of_object: Array.isArray(iv) })[v.type];
                    if (okType === false) warn('variable-initial-mismatch', node, I18n.t('变量「{name}」的初始值与类型不一致。', { name: v.name || v.id }));
                }
            }
        }

        // 引用检查
        const checkCondition = (c, node) => {
            if (!isObj(c)) return;
            const refMod = (id) => { if (id != null && id !== '' && !ids.has(id)) warn('unknown-module-ref', node, I18n.t('{label}的条件引用了不存在的事件。', { label: label(node) })); };
            const refVar = (id) => { if (id != null && id !== '' && !varDefs.has(id)) warn('unknown-variable-ref', node, I18n.t('{label}的条件引用了不存在的变量。', { label: label(node) })); };
            switch (c.type) {
                case 'module': refMod(c.moduleId); break;
                case 'variable': refVar(c.variableId); break;
                case 'variable_compare': refVar(c.variableId); refVar(c.compareVariableId); break;
                case 'time': if (c.relative) refMod(c.relative.moduleId); break;
                case 'time_range': if (c.start && c.start.moduleId) refMod(c.start.moduleId); if (c.end && c.end.moduleId) refMod(c.end.moduleId); break;
                default: break;
            }
        };
        const walkDef = (def, node) => {
            if (!isObj(def) || !Array.isArray(def.groups)) return;
            for (const g of def.groups) {
                if (!isObj(g) || !Array.isArray(g.items)) continue;
                for (const it of g.items) {
                    if (!isObj(it)) continue;
                    if (it.itemType === 'group') walkDef(it.group, node);
                    else checkCondition(it.condition, node);
                }
            }
        };
        const walkWrappers = (w, node) => {
            if (!w) return;
            (Array.isArray(w) ? w : [w]).forEach((x) => { if (isObj(x)) walkDef(x.conditionDef || x, node); });
        };
        for (const { node } of nodes) {
            if (!isObj(node)) continue;
            walkWrappers(node.entryConditions, node);
            walkWrappers(node.completionConditions, node);
            (Array.isArray(node.info) ? node.info : []).forEach((x) => { if (isObj(x)) walkWrappers(x.condition, node); });
            (Array.isArray(node.deliveryInfo) ? node.deliveryInfo : []).forEach((x) => { if (isObj(x)) walkWrappers(x.condition, node); });
        }
        for (const { def, owner } of varDefs.values()) {
            (Array.isArray(def.switchConditions) ? def.switchConditions : []).forEach((s) => { if (isObj(s)) walkWrappers(s.condition, owner); });
            (Array.isArray(def.computeConditions) ? def.computeConditions : []).forEach((s) => { if (isObj(s)) walkWrappers(s.conditionDef, owner); });
        }

        // 同一父级同一流程里的兄弟：类型、链序
        const hasTimeCondition = (node) => {
            let found = false;
            const scan = (def) => {
                if (!isObj(def) || !Array.isArray(def.groups)) return;
                for (const g of def.groups) for (const it of (g.items || [])) {
                    if (!isObj(it)) continue;
                    if (it.itemType === 'group') scan(it.group);
                    else if (it.condition && (it.condition.type === 'time' || it.condition.type === 'time_range')) found = true;
                }
            };
            const w = node.entryConditions;
            (Array.isArray(w) ? w : (w ? [w] : [])).forEach((x) => { if (isObj(x)) scan(x.conditionDef || x); });
            return found;
        };
        const groups = new Map();
        for (const { node, parent, flow } of nodes) {
            if (!isObj(node) || !parent) continue;
            if (node.type === undefined) warn('no-type', node, I18n.t('{label}没有设置类型。', { label: label(node) }));
            else if (!TYPES.includes(node.type)) warn('unknown-type', node, I18n.t('{label}的类型不认识，它不会出现在任何队列里。', { label: label(node) }));
            if (node.type === MODULE_TYPES.TIMELINE && !hasTimeCondition(node)) warn('timeline-without-time', node, I18n.t('时间线{label}没有时间条件。', { label: label(node) }));
            if (typeof node.name !== 'string' || !node.name.trim()) warn('module-no-name', node, I18n.t('{label}没有名称。', { label: label(node) }));
            const key = (parent.id || '') + '\u0000' + flow;
            if (!groups.has(key)) groups.set(key, { parent, flow, list: [] });
            groups.get(key).list.push(node);
        }
        for (const { parent, flow, list } of groups.values()) {
            const where = flow === 'main' ? I18n.t('主流程') : I18n.t('分流程「{flow}」', { flow });
            const chain = list.filter((n) => n.type === MODULE_TYPES.TRIGGER_CHAIN);
            const chainIds = new Set(chain.map((n) => n.id));
            for (const n of chain) {
                const ll = isObj(n.linkedList) ? n.linkedList : null;
                if (ll) {
                    for (const side of ['prev', 'next']) {
                        const ref = ll[side];
                        if (ref == null) continue;
                        if (!ids.has(ref)) warn('link-dangling', n, I18n.t('{label}的{side}事件不存在，链会在这里断开。', { label: label(n), side: side === 'prev' ? I18n.t('前一个') : I18n.t('后一个') }));
                        // 链尾的 next 可以指向别的父级里的触发器链（完成后自动进入下一阶段）
                        else if (!chainIds.has(ref) && !(side === 'next' && ids.get(ref).type === MODULE_TYPES.TRIGGER_CHAIN)) warn('link-cross', n, I18n.t('{label}的{side}事件不在同一条链里。', { label: label(n), side: side === 'prev' ? I18n.t('前一个') : I18n.t('后一个') }));
                    }
                    if (ll.next != null && ids.has(ll.next) && chainIds.has(ll.next)) {
                        const nx = ids.get(ll.next);
                        if (isObj(nx.linkedList) && nx.linkedList.prev !== n.id) warn('link-mismatch', n, I18n.t('{a}与{b}的前后关系互相矛盾。', { a: label(n), b: label(nx) }));
                    }
                }
            }
            if (chain.length > 1) {
                const heads = chain.filter((n) => !isObj(n.linkedList) || n.linkedList.prev == null);
                const linkedHeads = heads.filter((n) => isObj(n.linkedList) && n.linkedList.next != null);
                if (heads.length === 0) warn('chain-cycle', parent, I18n.t('{label}{where}里的触发器链首尾相接，没有起点。', { label: label(parent), where }));
                else if (linkedHeads.length > 1) warn('chain-multi-head', parent, I18n.t('{label}{where}里有多条互不相连的触发器链，只有第一条按链序执行。', { label: label(parent), where }));
                // 沿 next 走一遍检查环
                const byId = new Map(chain.map((n) => [n.id, n]));
                for (const h of heads) {
                    const seen = new Set();
                    let cur = h;
                    while (cur && isObj(cur.linkedList) && cur.linkedList.next != null && byId.has(cur.linkedList.next)) {
                        if (seen.has(cur.id)) { warn('chain-cycle', cur, I18n.t('{label}所在的触发器链出现了环。', { label: label(cur) })); break; }
                        seen.add(cur.id);
                        cur = byId.get(cur.linkedList.next);
                    }
                }
            }
        }
        // 同名事件（AI 按名称进入事件，重名会指不清）
        const byName = new Map();
        for (const { node } of nodes) {
            if (!isObj(node) || typeof node.name !== 'string' || !node.name.trim()) continue;
            if (!byName.has(node.name)) byName.set(node.name, []);
            byName.get(node.name).push(node);
        }
        for (const [name, list] of byName) if (list.length > 1) warn('duplicate-name', list[1], I18n.t('有 {n} 个事件都叫「{name}」，AI 按名称进入事件时会分不清。', { n: list.length, name }));
        return { errors, warnings };
    }

    /**
     * Initialize module system with module data
     * @param {Object} moduleData - Root module JSON
     */
    init(moduleData) {
        this.modules.clear();
        this.rootModuleId = moduleData.id;
        const rootModule = new GameModule(moduleData, null, null);
        this.modules.set(rootModule.id, rootModule);
        this.rootModule = rootModule; // Set rootModule for test panel compatibility
        this._registerAllSubModules(rootModule);
        this.updateVariableHierarchy();
        if (this.timeSystem && typeof this.timeSystem.setUnits === 'function') this.timeSystem.setUnits(moduleData.timeUnits);
    }

    /**
     * Register all sub-modules recursively
     * @private
     */
    _registerAllSubModules(module) {
        for (const flowModules of module.subModules.values()) {
            for (const subModule of flowModules.values()) {
                this.modules.set(subModule.id, subModule);
                this._registerAllSubModules(subModule);
            }
        }
    }

    /**
     * Get module by ID
     * @param {string} moduleId
     * @returns {GameModule|null}
     */
    getModule(moduleId) {
        return this.modules.get(moduleId) || null;
    }

    /**
     * 某父级的直接子模块数组（兼容 SummarySystem/PromptGenerator 期望的 getChildModules 接口）。
     * @param {string} parentModuleId
     * @returns {GameModule[]}
     */
    getChildModules(parentModuleId) {
        const p = this.getModule(parentModuleId);
        if (!p || typeof p.getAllSubModules !== 'function') return [];
        return p.getAllSubModules();
    }

    /**
     * 动态添加模块到指定父级的指定 flow（供 module_generator 等一次性插件调用）。
     * 若该 flow 不存在则自动创建。
     * @param {Object} moduleConfig - 模块配置（与 GameModule 构造一致，含 id, name, type, flows 等）
     * @param {string} parentModuleId - 父模块 id（通常为根）
     * @param {string} flowName - 流程名（如 npc_flows）
     * @returns {GameModule|null} 新模块实例
     */
    addDynamicModule(moduleConfig, parentModuleId, flowName) {
        const parent = this.getModule(parentModuleId);
        if (!parent) return null;
        if (!parent.subModules.has(flowName)) {
            parent.subModules.set(flowName, new Map());
        }
        const flowMap = parent.subModules.get(flowName);
        const subModule = new GameModule(moduleConfig, parentModuleId, flowName);
        if (this.modules.has(subModule.id)) return null;
        flowMap.set(subModule.id, subModule);
        this.modules.set(subModule.id, subModule);
        if (this.variableSystem && typeof this.variableSystem.addModuleToHierarchy === 'function') {
            this.variableSystem.addModuleToHierarchy(subModule.id, parentModuleId);
        }
        return subModule;
    }

    /**
     * 递归删除模块及其所有子节点（供调试面板批量删除使用）；根模块不可删。
     * 返回成功删除的模块 id 数组（用于撤回栈记录）。
     * @param {string} moduleId
     * @returns {string[]}
     */
    removeModule(moduleId) {
        if (!moduleId || moduleId === this.rootModuleId) return [];
        const target = this.modules.get(moduleId);
        if (!target) return [];
        const removed = [];
        const recurse = (m) => {
            if (!m) return;
            if (m.subModules && m.subModules.forEach) {
                m.subModules.forEach((flowMap) => {
                    if (!flowMap || !flowMap.forEach) return;
                    const childIds = [];
                    flowMap.forEach((child) => { if (child && child.id) childIds.push(child.id); });
                    childIds.forEach((cid) => { const cm = this.modules.get(cid); if (cm) recurse(cm); });
                });
            }
            // 从父级 subModules.get(flowName) 移除
            const pid = m.parentModuleId;
            const fn = m.flowName || 'main';
            if (pid) {
                const parent = this.modules.get(pid);
                if (parent && parent.subModules && parent.subModules.get) {
                    const flowMap = parent.subModules.get(fn);
                    if (flowMap && flowMap.delete) flowMap.delete(m.id);
                }
            }
            this.modules.delete(m.id);
            if (this.variableSystem && typeof this.variableSystem.removeModuleFromHierarchy === 'function') {
                try { this.variableSystem.removeModuleFromHierarchy(m.id); } catch (_) {}
            }
            removed.push(m.id);
        };
        recurse(target);
        // 被删的模块不能继续作为某个流程的当前模块：改到最近仍存在的祖先
        const gone = new Set(removed);
        for (const [flow, cur] of Array.from(this.currentModulesByFlow)) {
            if (!cur || !gone.has(cur.id)) continue;
            // 被删的都在目标节点之下，目标节点的父级就是最近仍存在的祖先
            const survivor = target.parentModuleId ? this.modules.get(target.parentModuleId) : null;
            this._setFlowCurrent(flow, survivor || null);
        }
        return removed;
    }

    /**
     * 导出整个模组为可写回 module.json 的配置（不含运行时状态）。
     * @returns {Object|null}
     */
    exportConfig() {
        const root = this.rootModule || this.getModule(this.rootModuleId);
        return root ? root.toConfig() : null;
    }

    /**
     * 记录每个模块的运行时状态，供重建模块树后按 id 恢复。
     * @private
     */
    _captureRuntime() {
        const mods = {};
        for (const [id, m] of this.modules) {
            mods[id] = {
                state: m.state,
                enteredTimestamp: m.enteredTimestamp,
                completedTimestamp: m.completedTimestamp,
                interrupted: m.interrupted,
                interruptSummary: m.interruptSummary,
                summaryText: m.summaryText,
                delivered: m.deliveryInfo.filter(d => d.completed).map(d => d.title)
            };
        }
        const current = [];
        for (const [flow, m] of this.currentModulesByFlow) if (m) current.push([flow, m.id]);
        return { mods, current };
    }

    /**
     * 把 _captureRuntime 的结果按 id 写回当前模块树；不存在的模块直接丢弃。
     * 某个流程原来的当前模块已被删除时：当前流程改为其最近的仍存在的祖先（主流程退回根，分流程清空）。
     * @private
     */
    _restoreRuntime(snap, oldParents) {
        for (const [id, r] of Object.entries(snap.mods)) {
            const m = this.modules.get(id);
            if (!m) continue;
            m.state = r.state;
            m.enteredTimestamp = r.enteredTimestamp;
            m.completedTimestamp = r.completedTimestamp;
            m.interrupted = r.interrupted;
            m.interruptSummary = r.interruptSummary;
            m.summaryText = r.summaryText;
            for (const d of m.deliveryInfo) d.completed = r.delivered.includes(d.title) || d.completed;
        }
        this.currentModulesByFlow.clear();
        for (const [flow, id] of snap.current) {
            let cur = this.modules.get(id);
            let hops = 0;
            let pid = id;
            while (!cur && pid && hops++ < 200) {
                pid = oldParents[pid] || null;
                cur = pid ? this.modules.get(pid) : null;
            }
            if (cur) this.currentModulesByFlow.set(flow, cur);
            else if (flow === 'main' && this.rootModule) this.currentModulesByFlow.set('main', this.rootModule);
        }
    }

    /**
     * 用新的配置重建模块树，保留已有的进度：模块状态、当前所在位置、变量当前值、投递完成情况。
     * 配置里不再定义的变量会从变量系统移除；新增的变量取初始值。
     * @param {Object} config 模组配置（与 module.json 同格式）
     */
    replaceConfig(config) {
        if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error(I18n.t('模组内容不是有效的对象'));
        const snap = this._captureRuntime();
        const oldParents = {};
        const definedBefore = [];
        for (const [id, m] of this.modules) {
            oldParents[id] = m.parentModuleId;
            for (const v of (m.variables || [])) if (v && v.id != null) definedBefore.push(v.id);
        }
        const vs = this.variableSystem;
        const values = vs && typeof vs.snapshotValues === 'function' ? vs.snapshotValues() : null;
        this.init(config);
        if (vs) {
            const definedAfter = new Set();
            for (const m of this.modules.values()) for (const v of (m.variables || [])) if (v && v.id != null) definedAfter.add(v.id);
            if (typeof vs.removeVariable === 'function') {
                for (const id of definedBefore) if (!definedAfter.has(id)) vs.removeVariable(id);
            }
            if (values && typeof vs.restoreValues === 'function') vs.restoreValues(values, definedAfter);
        }
        this._restoreRuntime(snap, oldParents);
        if (vs && typeof vs.updateBuiltinVariables === 'function') vs.updateBuiltinVariables();
    }

    /**
     * Set variable system
     * @param {VariableSystem} variableSystem
     */
    setVariableSystem(variableSystem) {
        this.variableSystem = variableSystem;
        if (variableSystem && this.modules.size > 0) {
            this.updateVariableHierarchy();
        }
    }

    /**
     * Set time system
     * @param {TimeSystem} timeSystem
     */
    setTimeSystem(timeSystem) {
        this.timeSystem = timeSystem;
        if (timeSystem && typeof timeSystem.setUnits === 'function' && this.rootModule) timeSystem.setUnits(this.rootModule._raw && this.rootModule._raw.timeUnits);
    }

    /**
     * Set condition evaluator
     * @param {ConditionEvaluator} evaluator
     */
    setConditionEvaluator(evaluator) {
        this.conditionEvaluator = evaluator;
    }

    /**
     * 获取模块到达某状态时的时间戳（供相对时间条件用，如 time_relative）
     * @param {string} moduleId
     * @param {string} state - 'entered' | 'completed'
     * @returns {TimePoint|null} 返回 TimePoint 或 null（未到达该状态或未记录时间）
     */
    getModuleTimestamp(moduleId, state) {
        const module = this.getModule(moduleId);
        if (!module) return null;
        const ts = state === 'entered' ? module.enteredTimestamp : (state === 'completed' ? module.completedTimestamp : null);
        if (!ts) return null;
        if (typeof ts.clone === 'function') return ts;
        if (this.timeSystem && typeof this.timeSystem.toTimePoint === 'function' && ts && typeof ts === 'object' && 'year' in ts) {
            return this.timeSystem.toTimePoint(ts);
        }
        return null;
    }

    /**
     * 日期规范化：防止 day>月末、month>12 等非法值（如 1月33日）。按公历月末处理。
     * @private
     */
    _normalizeDate(obj) {
        if (!obj || typeof obj !== 'object') return obj;
        let { year, month, day, hour, minute } = obj;
        year = year ?? 1;
        month = month ?? 1;
        day = day ?? 1;
        hour = (hour ?? 0) % 24;
        if (hour < 0) hour += 24;
        minute = (minute ?? 0) % 60;
        if (minute < 0) minute += 60;
        const daysInMonth = (m, y) => new Date(y, m, 0).getDate();
        while (day > daysInMonth(month, year)) {
            day -= daysInMonth(month, year);
            month++;
        }
        while (day < 1) {
            month--;
            day += daysInMonth(month, year);
        }
        while (month > 12) { month -= 12; year++; }
        while (month < 1) { month += 12; year--; }
        return { year, month, day, hour, minute };
    }

    /**
     * 将相对时间条件解析为绝对时间（供展示、test panel 等）。与 condition 评估一致：基准 = 某模块某状态记录时间 + offset。
     * 基准未记录时若传入 useCurrentTimeAsBase，则用当前时间作为基准并规范化日期，避免出现 1月33日 等非法日期。
     * @param {Object} relativeSpec - { moduleId, state?: 'entered'|'completed', offset?: { year?, month?, day?, hour?, minute? } }
     * @param {boolean} [useCurrentTimeAsBase=false] - 基准未记录时是否用当前时间作为基准
     * @returns {{ year, month, day, hour, minute }|null} 绝对时间普通对象（已规范化），无法解析时返回 null
     */
    resolveRelativeTime(relativeSpec, useCurrentTimeAsBase = false) {
        if (!relativeSpec || !relativeSpec.moduleId) return null;
        let base = this.getModuleTimestamp(relativeSpec.moduleId, relativeSpec.state || 'entered');
        if (!base && useCurrentTimeAsBase && this.timeSystem) {
            const cur = this.timeSystem.getCurrentTime();
            if (cur && typeof cur === 'object') base = cur;
        }
        if (!base) return null;
        const o = relativeSpec.offset || {};
        const raw = {
            year: (base.year ?? 1) + (o.year ?? 0),
            month: (base.month ?? 1) + (o.month ?? 0),
            day: (base.day ?? 1) + (o.day ?? 0),
            hour: (base.hour ?? 0) + (o.hour ?? 0),
            minute: (base.minute ?? 0) + (o.minute ?? 0)
        };
        return this._normalizeDate(raw);
    }

    /**
     * Get parent chain from root to module (excluding module itself)
     * @private
     */
    _getParentChain(moduleId) {
        const chain = [];
        let current = this.getModule(moduleId);
        while (current && current.parentModuleId) {
            chain.unshift(current.parentModuleId);
            current = this.getModule(current.parentModuleId);
        }
        return chain;
    }

    /**
     * Get all parent chain from root to module (including module itself)
     * 获取从root到module的全部父级路径（包括module本身）
     * @private
     */
    _getAllParentChain(moduleId) {
        const chain = this._getParentChain(moduleId);
        chain.push(moduleId);
        return chain;
    }

    /**
     * Get all descendant IDs recursively
     * @private
     */
    _getAllDescendantIds(moduleId) {
        const module = this.getModule(moduleId);
        if (!module) return [];
        const ids = [moduleId];
        for (const sub of module.getAllSubModules()) {
            ids.push(...this._getAllDescendantIds(sub.id));
        }
        return ids;
    }

    /**
     * Get leaf IDs under a module
     * @private
     */
    _getLeafIdsUnder(moduleId) {
        const module = this.getModule(moduleId);
        if (!module) return [];
        if (module.isLeaf()) return [moduleId];
        const ids = [];
        for (const sub of module.getAllSubModules()) {
            ids.push(...this._getLeafIdsUnder(sub.id));
        }
        return ids;
    }

    /**
     * 在指定 flow 下、从某模块起找到第一个状态为 entered 的叶节点（用于 current 展示为叶而非父级）。
     * @private
     */
    _getEnteredLeafInFlow(moduleId, flowName) {
        const module = this.getModule(moduleId);
        if (!module) return null;
        const flowMap = module.getFlowSubModules(flowName);
        if (!flowMap || flowMap.size === 0) return null;
        for (const [, sub] of flowMap) {
            if (sub.flowName !== flowName) continue;
            if (sub.isLeaf() && sub.state === MODULE_STATES.ENTERED) return sub.id;
            const found = this._getEnteredLeafInFlow(sub.id, flowName);
            if (found) return found;
        }
        return null;
    }

    /**
     * main 流程下「有子模块的根直接子节点」ID 列表（顺序与 flow 一致），用于队列可见范围。
     * @private
     */
    _getMainParentsOrder() {
        const rootId = this.rootModuleId;
        if (!rootId) return [];
        const childIds = this._getDirectChildIdsInFlowOrder('main', rootId);
        return childIds.filter((id) => {
            const m = this.getModule(id);
            return m && !m.isLeaf();
        });
    }

    /**
     * main 流程下根直接子节点中的叶节点 ID 列表（顶层叶，无子模块）。
     * @private
     */
    _getMainTopLeafIds() {
        const rootId = this.rootModuleId;
        if (!rootId) return [];
        const childIds = this._getDirectChildIdsInFlowOrder('main', rootId);
        return childIds.filter((id) => {
            const m = this.getModule(id);
            return m && m.isLeaf();
        });
    }

    /**
     * 获取 main 下某父级内的所有叶节点 ID（链序 + 时间线 + 自由），用于队列可见范围。
     * @private
     */
    _getMainLeavesUnderParent(parentId) {
        const lev = this._getLevelDirectChildren('main', parentId);
        const ids = [...lev.chainOrder, ...lev.timelineList.map(m => m.id), ...lev.freeIds];
        return ids.filter((id) => this.getModule(id)?.isLeaf());
    }

    /**
     * 整条 main 流程上「下一个」触发器链叶及其所在父级。链是连续的主顺序，时间线/自由是插队，队列始终显示该下一个链节点。
     * @returns {{ nextLeaf: string|null, scopeParent: string|null }}
     * @private
     */
    _getNextTriggerChainLeafInWholeFlow() {
        const parentOrder = this._getMainParentsOrder();
        for (const parentId of parentOrder) {
            const nextChain = this._getNextTriggerChainLeafInScope(parentId);
            if (nextChain != null) return { nextLeaf: nextChain, scopeParent: parentId };
        }
        const lastParent = parentOrder[parentOrder.length - 1];
        if (!lastParent) return { nextLeaf: null, scopeParent: null };
        const chainOrder = this._getTriggerChainOrder('main', lastParent);
        const chainTailId = chainOrder.length ? chainOrder[chainOrder.length - 1] : null;
        const nextFirst = chainTailId ? this._getNextParentFirstChainLeaf(chainTailId) : null;
        if (!nextFirst) return { nextLeaf: null, scopeParent: lastParent };
        const nextParentIdx = parentOrder.indexOf(lastParent) + 1;
        const nextParent = nextParentIdx < parentOrder.length ? parentOrder[nextParentIdx] : null;
        return { nextLeaf: nextFirst, scopeParent: nextParent };
    }

    /**
     * 检查模块是否有子级触发器链
     * @param {string} moduleId 
     * @param {string} flowName 
     * @returns {boolean}
     * @private
     */
    _hasChildTriggerChains(moduleId, flowName) {
        const module = this.getModule(moduleId);
        if (!module || module.isLeaf()) return false;
        
        const flowMap = module.getFlowSubModules(flowName);
        if (!flowMap || flowMap.size === 0) return false;
        
        for (const [, subModule] of flowMap) {
            if (subModule.type === MODULE_TYPES.TRIGGER_CHAIN) {
                return true;
            }
        }
        return false;
    }

    /**
     * 队列的「当前所在父级」：以触发器链为主线。当前在链上则 scope = 该链父级；当前在时间线/自由时 scope = 整条流程上下一个链所在父级（保证队列里显示的是链，不是后面的时间线）。
     * @param {GameModule} mainCur - main 流当前模块（叶或浮层父级）
     * @returns {string|null} 父级模块 id
     * @private
     */
    _getScopeParentForQueue(mainCur) {
        if (!mainCur) return null;
        
        // 如果当前是触发器链叶节点，返回其父级
        if (mainCur.type === MODULE_TYPES.TRIGGER_CHAIN && mainCur.isLeaf()) {
            return mainCur.parentModuleId;
        }
        
        // 如果当前是父级模块且已经进入，检查是否有子级触发器链
        if (!mainCur.isLeaf() && mainCur.state === MODULE_STATES.ENTERED) {
            const hasChildChains = this._hasChildTriggerChains(mainCur.id, 'main');
            if (hasChildChains) {
                return mainCur.id; // 当前父级已进入且有子触发器链，scope就是当前父级
            }
        }
        
        // 如果当前模块没有子触发器链，或者是非触发器链的叶节点，则查找整个流程的下一个触发器链
        const { scopeParent } = this._getNextTriggerChainLeafInWholeFlow();
        if (scopeParent) return scopeParent;
        
        return mainCur.isLeaf() ? mainCur.parentModuleId : mainCur.id;
    }

    /**
     * 当前 scope 下「链上的下一个」触发器链节点（叶或大模块）：链顺序中第一个未 entered/未 completed 的；全完成则返回 null。
     * 如果是大模块，返回其第一个叶节点；如果是叶节点，直接返回。
     * @param {string} scopeParentId
     * @returns {string|null}
     * @private
     */
    _getNextTriggerChainLeafInScope(scopeParentId) {
        const chainOrder = this._getTriggerChainOrder('main', scopeParentId);
        for (const id of chainOrder) {
            const module = this.getModule(id);
            if (!module) continue;
            
            const s = module.state;
            if (s !== MODULE_STATES.ENTERED && s !== MODULE_STATES.COMPLETED) {
                // 如果是叶节点，直接返回
                if (module.isLeaf()) {
                    return id;
                }
                // 如果是大模块，返回其第一个触发器链叶节点
                const firstLeaf = this._getFirstLeafInModule(id, 'main');
                return firstLeaf || id;
            }
        }
        return null;
    }

    /**
     * 从 leaf 逐层往上的祖先 id 列表（顶层叶无 parent 时含 rootModuleId）。
     * @private
     */
    _getAncestorIds(leafId) {
        const m = this.getModule(leafId);
        if (!m) return [];
        let p = m.parentModuleId;
        if (!p && m.flowName === 'main') return [this.rootModuleId];
        const out = [];
        while (p) {
            out.push(p);
            const parent = this.getModule(p);
            p = parent ? parent.parentModuleId : null;
        }
        return out;
    }

    /**
     * 某父级下直接子叶中类型为时间线或自由的 id 列表（每层并列 = 该层同父的时间线/自由）。
     * @private
     */
    _getTimelineAndFreeUnderParent(parentId) {
        const leaves = this._getMainLeavesUnderParent(parentId);
        if (!leaves || !leaves.length) return [];
        return leaves.filter((id) => {
            const mod = this.getModule(id);
            return mod && (mod.type === MODULE_TYPES.TIMELINE || mod.type === MODULE_TYPES.FREE_TRIGGER);
        });
    }

    /**
     * 当前 main 可见叶：仅并列（当前 scope 的下一个链节点 + 每层同父的时间线/自由）。下一父级的链不放入 visible，只会在链尾块进 possible。
     * @private
     */
    _getVisibleMainLeaves(mainCurrentLeafId) {
        const mainCur = this.getModule(mainCurrentLeafId);
        if (!mainCur) return [];
        const scopeParent = this._getScopeParentForQueue(mainCur);
        const visible = new Set();
        
        // 优先获取当前scope内的下一个触发器链叶节点
        if (scopeParent) {
            const nextInScope = this._getNextTriggerChainLeafInScope(scopeParent);
            if (nextInScope) {
                visible.add(nextInScope);
            } else {
                // 如果当前scope内没有下一个触发器链，才考虑整个流程的下一个
                const { nextLeaf } = this._getNextTriggerChainLeafInWholeFlow();
                if (nextLeaf) {
                    const nextMod = this.getModule(nextLeaf);
                    if (nextMod && nextMod.parentModuleId === scopeParent) {
                        visible.add(nextLeaf);
                    }
                }
            }
        }
        
        // 添加每层同父的时间线/自由触发器
        for (const ancestorId of this._getAncestorIds(mainCurrentLeafId)) {
            for (const id of this._getTimelineAndFreeUnderParent(ancestorId)) {
                visible.add(id);
            }
        }
        
        if (visible.size === 0 && mainCur.flowName === 'main' && !mainCur.parentModuleId) {
            return this._getMainTopLeafIds();
        }
        return [...visible];
    }

    /**
     * 同父级内叶的「推进顺序」：触发器链为默认主线，时间线/自由为同级插队（跳转到它们相当于插队，当前父级未离开，队列仍为该父级内）。
     * 顺序 = chain[0..lastCompletedIdx]（主线已过）+ timeline + free（插队）+ chain[lastCompletedIdx+1..]（主线未到）
     * @param {string} parentId
     * @param {function(string): string} stateGetter - id => 'completed'|'entered'|'untriggered'
     * @returns {string[]} 叶 id 列表，按推进顺序
     * @private
     */
    _getMainLeavesInProgressionOrder(parentId, stateGetter) {
        const lev = this._getLevelDirectChildren('main', parentId);
        const chainOrder = lev.chainOrder.filter((id) => this.getModule(id)?.isLeaf());
        const timelineIds = lev.timelineList.map((m) => m.id);
        const freeIds = lev.freeIds || [];
        let lastCompletedChainIdx = -1;
        for (let i = 0; i < chainOrder.length; i++) {
            const s = stateGetter(chainOrder[i]);
            if (s === MODULE_STATES.COMPLETED || s === MODULE_STATES.ENTERED) lastCompletedChainIdx = i;
        }
        const before = chainOrder.slice(0, lastCompletedChainIdx + 1);
        const after = chainOrder.slice(lastCompletedChainIdx + 1);
        return [...before, ...timelineIds, ...freeIds, ...after];
    }

    /**
     * 是否为触发器链链尾（无 next）。唯一算链的只有触发器链，时间线不算链。
     * @private
     */
    _isChainTail(moduleId) {
        const m = this.getModule(moduleId);
        if (!m || !m.linkedList || m.type !== MODULE_TYPES.TRIGGER_CHAIN) return false;
        return m.linkedList.next == null;
    }

    /**
     * 链尾时下一父级的第一个链叶（仅 main）；与断言脚本 getNextParentFirstChainLeaf 一致。
     * @private
     */
    _getNextParentFirstChainLeaf(moduleId) {
        const module = this.getModule(moduleId);
        if (!module) return null;
        const parentId = module.parentModuleId;
        if (!parentId) return null;
        const parentOrder = this._getMainParentsOrder();
        const idx = parentOrder.indexOf(parentId);
        if (idx < 0 || idx >= parentOrder.length - 1) return null;
        const nextParentId = parentOrder[idx + 1];
        const chainOrder = this._getTriggerChainOrder('main', nextParentId);
        if (chainOrder.length > 0) {
            const firstChainId = chainOrder[0];
            const firstChain = this.getModule(firstChainId);
            if (firstChain) {
                // 如果是叶节点，直接返回；如果是大模块，返回其第一个叶节点
                if (firstChain.isLeaf()) {
                    return firstChainId;
                } else {
                    const firstLeaf = this._getFirstLeafInModule(firstChainId, 'main');
                    return firstLeaf || firstChainId;
                }
            }
        }
        // 如果没有触发器链，返回第一个叶节点
        const leaves = this._getMainLeavesUnderParent(nextParentId);
        return leaves[0] || null;
    }

    /**
     * 获取某父级在某 flow 下的直接子模块 ID 列表，顺序与 flow 配置一致（Map 插入序）。
     * 用于跳转时按顺序「之前全部完成、之后全部未触发」。
     * @private
     */
    _getDirectChildIdsInFlowOrder(flowName, parentId) {
        const parent = this.getModule(parentId);
        if (!parent) return [];
        const flowMap = parent.getFlowSubModules(flowName);
        if (!flowMap || flowMap.size === 0) return [];
        return Array.from(flowMap.keys());
    }

    /**
     * Get level direct children (same parent, same flow)
     * @private
     */
    _getLevelDirectChildren(flowName, parentId) {
        const parent = this.getModule(parentId);
        const empty = { chainOrder: [], timelineList: [], timelineIds: [], freeIds: [], otherIds: [] };
        if (!parent) return empty;
        const flowMap = parent.getFlowSubModules(flowName);
        if (!flowMap || flowMap.size === 0) return empty;
        const chainOrder = this._getTriggerChainOrder(flowName, parentId);
        const timelineList = this._getTimelinesInGroup(flowName, parentId);
        const timelineIds = timelineList.map(m => m.id);
        const freeIds = [];
        const otherIds = [];
        for (const [id, m] of flowMap) {
            if (chainOrder.includes(id) || timelineIds.includes(id)) continue;
            if (m.type === MODULE_TYPES.FREE_TRIGGER && m.isLeaf()) freeIds.push(id);
            else otherIds.push(id);
        }
        return { chainOrder, timelineList, timelineIds, freeIds, otherIds };
    }

    /**
     * Get trigger chain order for a parent
     * @private
     */
    _getTriggerChainOrder(flowName, parentId) {
        const parent = this.getModule(parentId);
        if (!parent) return [];
        const flowMap = parent.getFlowSubModules(flowName);
        if (!flowMap || flowMap.size === 0) return [];
        const chainModules = [];
        for (const [, m] of flowMap) {
            // 包含所有触发器链类型的模块，不管是叶节点还是大模块
            if (m.type === MODULE_TYPES.TRIGGER_CHAIN) chainModules.push(m);
        }
        if (chainModules.length === 0) return [];
        const inChain = new Set(chainModules.map(m => m.id));
        // 起点优先取「有后继的链头」；整组都没写链接时按配置顺序
        let head = chainModules.find(m => m.linkedList && !m.linkedList.prev && m.linkedList.next);
        if (!head) head = chainModules.find(m => !m.linkedList || !m.linkedList.prev);
        if (!head) return chainModules.map(m => m.id);
        // 沿 next 走；只认同一流程同一父级内的链节点，遇到环或悬空引用就停
        const order = [head.id];
        const seen = new Set(order);
        let cur = head;
        while (cur.linkedList && cur.linkedList.next) {
            const nextMod = this.getModule(cur.linkedList.next);
            if (!nextMod || !inChain.has(nextMod.id) || seen.has(nextMod.id)) break;
            order.push(nextMod.id);
            seen.add(nextMod.id);
            cur = nextMod;
        }
        // 没接进链的触发器链节点按配置顺序排在后面，不能被丢掉
        for (const m of chainModules) if (!seen.has(m.id)) order.push(m.id);
        return order;
    }

    /**
     * Get timelines in the same group (flow + parent)
     * @private
     */
    _getTimelinesInGroup(flowName, parentId) {
        const parent = this.getModule(parentId);
        if (!parent) return [];
        const flowMap = parent.getFlowSubModules(flowName);
        if (!flowMap) return [];
        const list = [];
        for (const [, mod] of flowMap) {
            if (mod.type === MODULE_TYPES.TIMELINE) list.push(mod);
        }
        list.sort((a, b) => ((a.triggerTime != null ? a.triggerTime : 0) - (b.triggerTime != null ? b.triggerTime : 0)));
        return list;
    }

    /**
     * Get previous trigger chain leaf before current module
     * 获取当前模块之前的触发器链leaf（如果有）
     * @private
     */
    _getPreviousTriggerChainLeaf(moduleId, flowName) {
        const module = this.getModule(moduleId);
        if (!module || !module.linkedList || !module.linkedList.prev) return null;
        return this.getModule(module.linkedList.prev);
    }

    /**
     * 进入模块时按进入条件把变量调到满足条件：同一变量只看优先级最高的来源（当前 > 父级 > 链上前一个）。
     * 第一条条件取其边界值（>= 与 <= 取条件值、> 与 < 取相邻整数、== 取条件值）；同一来源里该变量的其余条件已被满足则不再改。
     * @private
     */
    _applyVariableRequirementsForEnteringModule(moduleId, changes) {
        if (!this.variableSystem) return;
        const module = this.getModule(moduleId);
        if (!module) return;

        const sources = this._getEntrySources(moduleId);
        const claims = this._entryVariableClaims(sources);
        const ce = this.conditionEvaluator;
        for (const [varId, srcIdx] of claims) {
            const conds = [];
            for (const { def } of sources[srcIdx].defs) {
                for (const c of this._collectConditionsFromDef(def)) {
                    if (c.type === 'variable' && c.variableId === varId) conds.push(c);
                }
            }
            const target = (c) => {
                const n = Number(c.value);
                const op = String(c.operator || '').toLowerCase();
                if (op === '>=' || op === '<=') return Number.isFinite(n) ? n : undefined;
                if (op === '>') return Number.isFinite(n) ? n + 1 : undefined;
                if (op === '<') return Number.isFinite(n) ? n - 1 : undefined;
                if (op === '==') return c.value;
                return undefined;
            };
            let setVal;
            for (const c of conds) {
                const t = target(c);
                if (t === undefined) continue;
                if (setVal === undefined) { setVal = t; continue; }
                // 已经取了第一条的边界值；其余条件若被满足就不再动
                if (ce && !ce.compareValues(setVal, c.operator, c.value)) setVal = t;
            }
            if (setVal === undefined) continue;
            const oldVal = this.variableSystem.getValue(varId);
            if (this.variableSystem.executeOperation(varId, 'set', setVal) && changes && changes.variables) {
                changes.variables[varId] = { from: oldVal, to: this.variableSystem.getValue(varId) };
            }
        }

        // 更新内置变量
        if (typeof this.variableSystem.updateBuiltinVariables === 'function') {
            this.variableSystem.updateBuiltinVariables();
        }
    }

    /**
     * 处理跳转到父级模块的逻辑：完成之前的同级模块，取消之后的同级模块
     * @param {string} targetParentId 目标父级模块ID
     * @param {string} flowName 流程名
     * @param {*} timestamp 时间戳
     * @param {*} changes 变更记录
     * @private
     */
    _processJumpToParentModule(targetParentId, flowName, timestamp, changes) {
        const targetParent = this.getModule(targetParentId);
        if (!targetParent) return;
        
        // 获取从根到目标父级的路径
        const pathFromRootToParent = this._getAllParentChain(targetParentId);
        
        // 处理路径上的每一层
        for (let i = pathFromRootToParent.length - 1; i >= 0; i--) {
            const currentId = pathFromRootToParent[i];
            const current = this.getModule(currentId);
            if (!current) continue;
            
            // 设置当前模块为进入状态
            current.setState(MODULE_STATES.ENTERED, timestamp);
            if (changes && changes.entered) changes.entered.push(currentId);
            
            // 如果不是目标父级本身，需要处理同级模块的完成/取消
            if (i < pathFromRootToParent.length - 1) {
                const pathChildId = pathFromRootToParent[i + 1];
                const pathChild = this.getModule(pathChildId);
                if (!pathChild) continue;
                
                const flowNameAtLevel = pathChild.flowName;
                if (!flowNameAtLevel) continue;
                
                // 处理同级模块：之前的完成，之后的取消
                const childIdsInOrder = this._getDirectChildIdsInFlowOrder(flowNameAtLevel, currentId);
                const level = this._getLevelDirectChildren(flowNameAtLevel, currentId);
                const { timelineList, timelineIds } = level;
                const chainIdsInOrder = this._getTriggerChainOrder(flowNameAtLevel, currentId);
                
                if (chainIdsInOrder.includes(pathChildId)) {
                    const idx = chainIdsInOrder.indexOf(pathChildId);
                    for (let j = 0; j < idx; j++) {
                        this._completeModuleAndAllTriggerChains(chainIdsInOrder[j], timestamp, changes);
                    }
                    for (let j = idx + 1; j < chainIdsInOrder.length; j++) {
                        this._setModuleAndAllDescendantsUntriggered(chainIdsInOrder[j], timestamp, changes);
                    }
                } else if (timelineIds.includes(pathChildId)) {
                    const tidx = timelineIds.indexOf(pathChildId);
                    for (let j = 0; j < tidx; j++) {
                        this._completeModuleAndAllTriggerChains(timelineList[j].id, timestamp, changes);
                    }
                    for (let j = tidx + 1; j < timelineList.length; j++) {
                        this._setModuleAndAllDescendantsUntriggered(timelineList[j].id, timestamp, changes);
                    }
                }
            }
        }
        
        // 取消同flow内其他已进入的叶节点（不在路径上的）
        for (const [id, mod] of this.modules) {
            if (mod.flowName !== flowName || id === targetParentId || !mod.isLeaf()) continue;
            if (mod.state !== MODULE_STATES.ENTERED) continue;
            if (pathFromRootToParent.includes(id)) continue;
            mod.setState(MODULE_STATES.UNTRIGGERED, timestamp);
            if (changes && changes.canceled) changes.canceled.push(id);
        }
    }

    /**
     * 跳转后按树从 leaf 往前推：路径 = get全部父级(root→leaf)，从 leaf 开始轮流当「当前层」向上处理。
     * 树结构：根 → 流程 → (时间线|触发器链|自由) → 子树，循环。每层属性：initial/进入完成条件、下属 flow、所属链、root。
     * 状态仅三种且互斥：进入(且未完成)、完成、未触发。无 triggered。
     * @private
     */
    _processJumpFromLeafUpward(targetLeafId, leafFlowName, timestamp, changes, applyVarReq = true) {
        // 从总 root 到该 leaf 的路径（含 leaf）
        const pathFromRootToLeaf = this._getAllParentChain(targetLeafId);

        for (let i = pathFromRootToLeaf.length - 1; i >= 0; i--) {
            const currentId = pathFromRootToLeaf[i];
            const current = this.getModule(currentId);
            if (!current) continue;

            if (i === pathFromRootToLeaf.length - 1) {
                // 当前层是 leaf：跳转目标一律设为进入（含原本已完成的，避免「跳入已完成的」仍显示为完成）
                current.setState(MODULE_STATES.ENTERED, timestamp);
                if (changes && changes.entered) changes.entered.push(currentId);
                // updateVariables:false（如完成→自动进下一个）时不应用进入变量需求，避免把
                // 为完成上一个而设的变量改回 next 所在境界值（与断言生成器自动推进保持变量一致）。
                if (applyVarReq) this._applyVariableRequirementsForEnteringModule(currentId, changes);
                continue;
            }

            // 当前层是父级：路径上的父级一律设为进入（含原本已完成的）
            const pathChildId = pathFromRootToLeaf[i + 1];
            const pathChild = this.getModule(pathChildId);
            if (!pathChild) continue;

            const flowNameAtLevel = pathChild.flowName;
            if (!flowNameAtLevel) continue;

            current.setState(MODULE_STATES.ENTERED, timestamp);
            if (changes && changes.entered) changes.entered.push(currentId);

            // 只在同一类型内联动：触发器链只处理链内，时间线只处理时间线内，不互相完成
            const childIdsInOrder = this._getDirectChildIdsInFlowOrder(flowNameAtLevel, currentId);
            const level = this._getLevelDirectChildren(flowNameAtLevel, currentId);
            const { timelineList, timelineIds } = level;
            // 链顺序：flow 内所有 TRIGGER_CHAIN（含大模块），保证 pathChild 是容器时也在链内
            const chainIdsInOrder = this._getTriggerChainOrder(flowNameAtLevel, currentId);

            if (chainIdsInOrder.includes(pathChildId)) {
                const idx = chainIdsInOrder.indexOf(pathChildId);
                for (let j = 0; j < idx; j++) {
                    this._completeModuleAndAllTriggerChains(chainIdsInOrder[j], timestamp, changes);
                }
                for (let j = idx + 1; j < chainIdsInOrder.length; j++) {
                    this._setModuleAndAllDescendantsUntriggered(chainIdsInOrder[j], timestamp, changes);
                }
            } else if (timelineIds.includes(pathChildId)) {
                const tidx = timelineIds.indexOf(pathChildId);
                for (let j = 0; j < tidx; j++) {
                    this._completeModuleAndAllTriggerChains(timelineList[j].id, timestamp, changes);
                }
                for (let j = tidx + 1; j < timelineList.length; j++) {
                    this._setModuleAndAllDescendantsUntriggered(timelineList[j].id, timestamp, changes);
                }
            }
            // 自由：不处理
        }

        // 只把「同 flow、不在路径上、且当前为进入」的节点置为未触发；并取消其祖先（时间线推迟：跳至 wilderness_qi 后 mortal 整支应为 untriggered）
        const toCancelSet = new Set();
        for (const [id, mod] of this.modules) {
            if (mod.flowName !== leafFlowName || id === targetLeafId) continue;
            if (mod.state !== MODULE_STATES.ENTERED) continue;
            if (pathFromRootToLeaf.includes(id)) continue;
            toCancelSet.add(id);
            for (const pid of this._getParentChain(id)) {
                if (!pathFromRootToLeaf.includes(pid)) toCancelSet.add(pid);
            }
        }
        for (const id of toCancelSet) {
            const m = this.getModule(id);
            if (m && m.state !== MODULE_STATES.UNTRIGGERED) {
                m.setState(MODULE_STATES.UNTRIGGERED, timestamp);
                if (changes && changes.canceled) changes.canceled.push(id);
            }
        }
    }

    /**
     * Compute jump effect: path, toComplete, toCancel
     * @private
     * @deprecated 使用 _processJumpFromLeafUpward 代替
     */
    _computeJumpEffect(flowName, targetLeafId) {
        const path = this._getParentChain(targetLeafId).concat(targetLeafId);
        const toComplete = [];
        const toCancelSet = new Set();

        const addToCancel = (id) => {
            toCancelSet.add(id);
            const mod = this.getModule(id);
            if (mod && !mod.isLeaf()) {
                for (const subId of this._getAllDescendantIds(id)) {
                    if (subId !== id) toCancelSet.add(subId);
                }
            }
        };

        // 按树层级递归：从目标到根，每层只处理路径子所属类型
        for (let i = 0; i <= path.length - 2; i++) {
            const levelParentId = path[i];
            const pathChildId = path[i + 1];
            const level = this._getLevelDirectChildren(flowName, levelParentId);
            const { chainOrder, timelineList, timelineIds, freeIds } = level;
            
            const pathChildMod = this.getModule(pathChildId);
            if (!pathChildMod) continue;
            
            const isChain = chainOrder.includes(pathChildId);
            const isTimeline = timelineIds.includes(pathChildId);
            const isFree = freeIds.includes(pathChildId);

            if (isChain) {
                // 路径子是触发器链：只处理同父级下的触发器链顺序
                const idx = chainOrder.indexOf(pathChildId);
                for (let j = 0; j < idx; j++) {
                    const nid = chainOrder[j];
                    if (!toComplete.includes(nid)) toComplete.push(nid);
                }
                for (let j = idx + 1; j < chainOrder.length; j++) {
                    addToCancel(chainOrder[j]);
                }
            } else if (isTimeline) {
                // 路径子是时间线：只处理同父级下的时间线顺序（触发器链不动）
                const tidx = timelineIds.indexOf(pathChildId);
                for (let j = 0; j < tidx; j++) {
                    const m = timelineList[j];
                    if (!toComplete.includes(m.id)) toComplete.push(m.id);
                }
                for (let j = tidx + 1; j < timelineList.length; j++) {
                    addToCancel(timelineList[j].id);
                }
            } else if (isFree) {
                // 路径子是自由触发器：同层并列，不修改链/时间线/自由
            }
        }

        // 同 flow 内其他已进入/已完成的叶节点（不在路径上）需要取消
        for (const [id, mod] of this.modules) {
            if (mod.flowName !== flowName || id === targetLeafId || !mod.isLeaf()) continue;
            if (mod.state !== MODULE_STATES.ENTERED && mod.state !== MODULE_STATES.COMPLETED) continue;
            if (path.includes(id)) continue;
            addToCancel(id);
        }

        return { path, toComplete, toCancel: Array.from(toCancelSet) };
    }

    /**
     * 将模块及其内部所有模块（含大模块）一律设为未触发，遍历并逐个设置状态。
     * @private
     */
    _setModuleAndAllDescendantsUntriggered(moduleId, timestamp, changes) {
        const module = this.getModule(moduleId);
        if (!module) return;
        if (module.state !== MODULE_STATES.UNTRIGGERED) {
            module.setState(MODULE_STATES.UNTRIGGERED, timestamp);
            if (changes && changes.canceled) changes.canceled.push(moduleId);
        }
        for (const sub of module.getAllSubModules()) {
            this._setModuleAndAllDescendantsUntriggered(sub.id, timestamp, changes);
        }
    }

    /**
     * 设置该模块为已完成，并遍历其内部，将其中所有触发器链一直到 leaf 均设为已完成。
     * @private
     */
    _completeModuleAndAllTriggerChains(moduleId, timestamp, changes) {
        const module = this.getModule(moduleId);
        if (!module) return;
        if (module.state !== MODULE_STATES.COMPLETED) {
            module.setState(MODULE_STATES.COMPLETED, timestamp);
            if (changes && changes.completed) changes.completed.push(moduleId);
            if (changes && changes.completedChildren) changes.completedChildren.push(moduleId);
        }
        if (module.isLeaf()) return;
        for (const sub of module.getAllSubModules()) {
            if (sub.type === MODULE_TYPES.TRIGGER_CHAIN) {
                this._completeModuleAndAllTriggerChains(sub.id, timestamp, changes);
            } else if (!sub.isLeaf()) {
                this._completeModuleAndAllTriggerChains(sub.id, timestamp, changes);
            }
        }
    }

    /**
     * Recursively complete all trigger chain leaves under a module
     * @private
     */
    _completeAllTriggerChainLeavesUnder(moduleId, timestamp, result) {
        const module = this.getModule(moduleId);
        if (!module) return;
        
        if (module.isLeaf()) {
            if (module.type === MODULE_TYPES.TRIGGER_CHAIN && module.state !== MODULE_STATES.COMPLETED) {
                module.setState(MODULE_STATES.COMPLETED, timestamp);
                if (result && result.completedChildren) result.completedChildren.push(moduleId);
            }
            return;
        }
        
        // 递归处理所有子模块（所有 flow）
        for (const sub of module.getAllSubModules()) {
            this._completeAllTriggerChainLeavesUnder(sub.id, timestamp, result);
        }
    }

    /**
     * Apply jump effect
     * @private
     */
    _applyJumpEffect(effect, targetLeafId, flowName, timestamp, changes) {
        const { path, toComplete, toCancel } = effect;

        const completeOne = (id) => {
            const m = this.getModule(id);
            if (!m) return;
            if (m.state !== MODULE_STATES.COMPLETED) {
                m.setState(MODULE_STATES.COMPLETED, timestamp);
                if (changes && changes.completed) changes.completed.push(id);
            }
            // 递归完成其下所有触发器链叶节点
            this._completeAllTriggerChainLeavesUnder(id, timestamp, changes);
        };

        for (const id of toComplete) {
            completeOne(id);
        }
        for (const id of toCancel) {
            const m = this.getModule(id);
            if (!m) continue;
            if (m.state === MODULE_STATES.ENTERED || m.state === MODULE_STATES.COMPLETED) {
                m.setState(MODULE_STATES.UNTRIGGERED, timestamp);
                if (changes && changes.canceled) changes.canceled.push(id);
            }
        }
        // 路径进入：所有父级到根与目标一律设为 ENTERED（含原本已完成的）
        for (const pid of path) {
            const p = this.getModule(pid);
            if (p) {
                p.setState(MODULE_STATES.ENTERED, timestamp);
                if (changes && changes.entered) changes.entered.push(pid);
            }
        }
        const targetLeaf = this.getModule(targetLeafId);
        if (targetLeaf) {
            targetLeaf.setState(MODULE_STATES.ENTERED, timestamp);
            if (changes && changes.entered) changes.entered.push(targetLeafId);
        }
    }

    /**
     * Check if all sub-modules are completed (recursive)
     * @private
     */
    _areAllSubModulesCompleted(moduleId, flowName) {
        const module = this.getModule(moduleId);
        if (!module || module.isLeaf()) return true;
        
        const flowMap = module.getFlowSubModules(flowName);
        if (!flowMap || flowMap.size === 0) return true;
        
        for (const [, sub] of flowMap) {
            if (sub.state !== MODULE_STATES.COMPLETED) {
                return false;
            }
            // 递归检查子模块的子模块
            if (!sub.isLeaf() && !this._areAllSubModulesCompleted(sub.id, flowName)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Jump to module
     * 重构后的跳转功能：按照树结构从leaf开始往前推
     */
    jumpToModule(moduleId, options = {}) {
        const opts = { force: false, updateVariables: true, autoLink: true, ...(typeof options === 'boolean' ? { force: options } : options) };
        const module = this.getModule(moduleId);
        if (!module) return { success: false, error: `Module ${moduleId} not found`, moduleId };
        if (!module.isLeaf()) {
            const flowName = module.flowName || 'main';
            const leafId = this._getFirstLeafInModule(moduleId, flowName);
            if (leafId) return this.jumpToModule(leafId, options);
            
            // 分流程不 float：只有 main 在无叶时以父级为当前；其他 flow 无叶则不做任何设置，不失败
            if (flowName !== 'main') {
                return { success: true, moduleId, changes: { completed: [], canceled: [], entered: [], variables: {} } };
            }
            
            // 即使是父级模块，也需要处理之前模块的完成逻辑
            const timestamp = this.timeSystem ? this.timeSystem.getCurrentTime() : null;
            const changes = { completed: [], canceled: [], entered: [], variables: {} };
            
            if (opts.autoLink) {
                // 处理跳转到父级模块的逻辑：完成之前的模块，取消之后的模块
                this._processJumpToParentModule(moduleId, flowName, timestamp, changes);
            } else {
                // 不使用autoLink时，只设置路径为进入状态
                const path = this._getParentChain(moduleId).concat(moduleId);
                for (const pid of path) {
                    const p = this.getModule(pid);
                    if (p) {
                        p.setState(MODULE_STATES.ENTERED, timestamp);
                        changes.entered.push(pid);
                    }
                }
            }
            
            this.currentModulesByFlow.set(flowName, module);
            if (opts.updateVariables && this.variableSystem) {
                this._applyVariableUpdatesForEnteringModule(moduleId, changes);
            }
            return { success: true, moduleId, changes };
        }

        const flowName = module.flowName;
        const targetLeafId = moduleId;
        const targetLeafForCheck = this.getModule(targetLeafId);
        let allowEntry = opts.force || this.canEnterModule(targetLeafId);
        if (!allowEntry) {
            // 完成时间线后跳分流程自由：当前 flow 为浮层（父级）且目标为同 flow 内自由节点时，允许跳转
            const curInFlow = this.currentModulesByFlow.get(flowName);
            if (curInFlow && !curInFlow.isLeaf() && targetLeafForCheck && targetLeafForCheck.type === MODULE_TYPES.FREE_TRIGGER) {
                allowEntry = true;
            }
        }
        if (!allowEntry) return { success: false, error: 'Entry conditions not met', moduleId };

        const timestamp = this.timeSystem ? this.timeSystem.getCurrentTime() : null;
        const changes = { completed: [], canceled: [], entered: [], variables: {} };

        if (opts.autoLink) {
            // 使用新的跳转逻辑：从leaf开始往前推
            this._processJumpFromLeafUpward(targetLeafId, flowName, timestamp, changes, opts.updateVariables);
        } else {
            // 不使用autoLink时，路径与目标一律设为进入（含原本已完成的）
            const path = this._getParentChain(targetLeafId).concat(targetLeafId);
            for (const pid of path) {
                const p = this.getModule(pid);
                if (p) {
                    p.setState(MODULE_STATES.ENTERED, timestamp);
                    changes.entered.push(pid);
                }
            }
            const targetLeaf = this.getModule(targetLeafId);
            if (targetLeaf) {
                targetLeaf.setState(MODULE_STATES.ENTERED, timestamp);
                changes.entered.push(targetLeafId);
            }
            // 取消同flow内其他已进入的leaf
            for (const [id, mod] of this.modules) {
                if (mod.flowName !== flowName || mod.state !== MODULE_STATES.ENTERED || id === targetLeafId || path.includes(id) || !mod.isLeaf()) continue;
                mod.setState(MODULE_STATES.UNTRIGGERED, timestamp);
                changes.canceled.push(id);
            }
        }

        const targetLeaf = this.getModule(targetLeafId);
        this.currentModulesByFlow.set(flowName, targetLeaf);

        // 变量已在 load 时由 updateVariableHierarchy 注册并设置作用域层级，此处不再重复注册以免覆盖当前值
        // 应用变量更新（variableSetOnEnter 和 autoSetVariables）
        if (opts.updateVariables && this.variableSystem) {
            this._applyVariableUpdatesForEnteringModule(targetLeafId, changes);
        }
        if (opts.updateVariables && targetLeaf.autoSetVariables) {
            for (const [varId, value] of Object.entries(targetLeaf.autoSetVariables)) {
                const oldVal = this.variableSystem?.getValue(varId);
                if (this.variableSystem) {
                    this.variableSystem.executeOperation(varId, 'set', value);
                    changes.variables[varId] = { from: oldVal, to: value };
                }
            }
            if (this.variableSystem && typeof this.variableSystem.updateBuiltinVariables === 'function') {
                this.variableSystem.updateBuiltinVariables();
            }
        }
        return { success: true, moduleId, moduleName: this.getModule(moduleId).name, changes };
    }

    /**
     * Complete module
     */
    completeModule(moduleId, options = {}) {
        const module = this.getModule(moduleId);
        if (!module) {
            return { success: false, error: 'Module not found' };
        }

        const timestamp = this.timeSystem ? this.timeSystem.getCurrentTime() : null;
        const result = { success: true, moduleId, autoEntered: null, completedChildren: [] };

        // 大模块：完成 main 下所有触发器链，一直完成到 leaf
        if (!module.isLeaf()) {
            if (!options.force && module.state !== MODULE_STATES.ENTERED && module.state !== MODULE_STATES.COMPLETED) {
                return { success: false, error: I18n.t('大模块须已进入或已完成后才能勾选（或使用 force 自动完成）') };
            }
            module.setState(MODULE_STATES.COMPLETED, timestamp);
            const mainSubs = module.getFlowSubModules('main');
            if (mainSubs) {
                for (const [id, sub] of mainSubs) {
                    if (sub.type === MODULE_TYPES.TRIGGER_CHAIN) {
                        this._completeModuleAndAllTriggerChains(id, timestamp, result);
                    }
                }
            }
            
            const curInFlow = module.flowName && this.currentModulesByFlow.get(module.flowName);
            if (curInFlow && this._getLeafIdsUnder(moduleId).includes(curInFlow.id)) {
                const parentMod = module.parentModuleId ? this.getModule(module.parentModuleId) : null;
                this._setFlowCurrent(module.flowName, parentMod || null);
            }
            return result;
        }

        // 叶节点完成
        if (!options.force && !this.canCompleteModule(moduleId)) {
            return { success: false, error: 'Completion conditions not met' };
        }

        module.setState(MODULE_STATES.COMPLETED, timestamp);

        // 检查是否有下一个自动进入的模块
        let nextModuleId = null;
        if (module.type === MODULE_TYPES.TRIGGER_CHAIN && module.linkedList && module.linkedList.next) {
            nextModuleId = module.linkedList.next;
        }
        // 时间线之间无链式前后关系（jump-complete-rules）：完成顶层时间线（父级即根模块、
        // 无真实分组父级）不自动推进到下一个时间线，应浮层——与断言生成器
        // getNextTimelineInParent（父级为空即返回 null）一致。仅有真实分组父级的时间线组内才推进。
        if (module.type === MODULE_TYPES.TIMELINE && module.parentModuleId && module.parentModuleId !== this.rootModuleId) {
            const timelines = this._getTimelinesInGroup(module.flowName, module.parentModuleId);
            const idx = timelines.findIndex(m => m.id === moduleId);
            if (idx >= 0 && idx < timelines.length - 1) {
                nextModuleId = timelines[idx + 1].id;
            }
        }
        
        if (nextModuleId) {
            const nextModule = this.getModule(nextModuleId);
            // 完成→链/时间线 next 自动进入：变量类合并进入条件不阻拦——进入时由
            // _applyVariableUpdatesForEnteringModule 自动把变量设到满足合并条件（01-core-schemas
            // 「跳转/进入时变量更新」），仅结构类（module/tag/time）未满足才不自动进（→浮层）。
            // 故用 force 进入，让该变量更新真正执行（否则如：为完成 mortal_step_1 把 cultivation
            // 设到 10，会被父级「凡人」的 cultivation 条件挡住而错误浮回父级）。
            // updateVariables:false —— 完成→自动进下一个**不重设变量**（与断言生成器一致：
            // 自动推进保持当前变量；显式 jump 才走「进入数值更新」）。否则会把为完成上一个
            // 而设的变量（如 cultivation=10）改回 next 所在境界值，造成变量回归。
            if (nextModule && this._canAutoEnterNext(nextModuleId)) {
                const jumpResult = this.jumpToModule(nextModuleId, { force: true, updateVariables: false });
                if (jumpResult.success) {
                    result.autoEntered = nextModuleId;
                    return result;
                }
            }
        }

        // 链尾且无下一节点：检查是否需要完成父级并浮到父级
        const isChainTail = module.type === MODULE_TYPES.TRIGGER_CHAIN && 
                           (!module.linkedList || !module.linkedList.next);
        const isTimelineTail = module.type === MODULE_TYPES.TIMELINE;
        
        if (isChainTail || isTimelineTail) {
            const parentModule = module.parentModuleId ? this.getModule(module.parentModuleId) : null;
            if (parentModule) {
                // 检查父级下是否所有子模块都已完成
                const allSubsCompleted = this._areAllSubModulesCompleted(parentModule.id, module.flowName);
                if (allSubsCompleted) {
                    // 完成父级（递归完成其下所有触发器链）
                    parentModule.setState(MODULE_STATES.COMPLETED, timestamp);
                    this._completeAllTriggerChainLeavesUnder(parentModule.id, timestamp, result);
                    // 浮到父级
                    this.currentModulesByFlow.set(module.flowName, parentModule);
                    const grandParentId = parentModule.parentModuleId;
                    if (grandParentId) {
                        const grandParent = this.getModule(grandParentId);
                        if (grandParent) {
                            const allGrandSubsCompleted = this._areAllSubModulesCompleted(grandParentId, module.flowName);
                            if (allGrandSubsCompleted) {
                                grandParent.setState(MODULE_STATES.COMPLETED, timestamp);
                                this._completeAllTriggerChainLeavesUnder(grandParentId, timestamp, result);
                                this.currentModulesByFlow.set(module.flowName, grandParent);
                            }
                        }
                    }
                } else {
                    this.currentModulesByFlow.set(module.flowName, parentModule);
                }
            } else {
                this._setFlowCurrent(module.flowName, null);
            }
        } else {
            if (module.flowName && this.currentModulesByFlow.get(module.flowName)?.id === moduleId) {
                const parentModule = module.parentModuleId ? this.getModule(module.parentModuleId) : null;
                this._setFlowCurrent(module.flowName, parentModule || null);
            }
        }

        return result;
    }

    /**
     * Get any current module from map
     * @private
     */
    _getAnyCurrentModuleFromMap() {
        const arr = Array.from(this.currentModulesByFlow.values());
        return arr.length ? arr[arr.length - 1] : null;
    }

    /**
     * 设置某 flow 的当前模块；若传 null，非 main 则删除，main 则设为根（主流程至少保留一个当前，含浮层）。
     * @private
     */
    _setFlowCurrent(flowName, module) {
        if (module) {
            this.currentModulesByFlow.set(flowName, module);
        } else {
            if (flowName === 'main' && this.rootModuleId) {
                const root = this.getModule(this.rootModuleId);
                if (root) this.currentModulesByFlow.set('main', root);
            } else {
                this.currentModulesByFlow.delete(flowName);
            }
        }
    }

    /**
     * 判断 ancestorId 是否为 descendantId 的严格祖先（在同一棵树下）。
     * @private
     */
    _isAncestorOf(ancestorId, descendantId) {
        if (ancestorId === descendantId) return false;
        return this._getParentChain(descendantId).includes(ancestorId);
    }

    /**
     * Get current module IDs（与 buildQueues 的 flow 顺序一致）。若当前存的是父级（浮层），则解析为该 flow 下已进入的叶节点。
     * 仅在同一 flow 内去重祖先/子孙，避免 main 的根（浮层）被分支叶节点顶掉。
     */
    getCurrentModuleIds() {
        const flowOrder = this._getQueueFlowOrder();
        const raw = flowOrder
            .map(flowName => {
                const m = this.currentModulesByFlow.get(flowName);
                if (!m) return null;
                if (m.state === MODULE_STATES.UNTRIGGERED) return null; // 存的是已取消的节点时视为该 flow 无当前（兜底）
                if (m.isLeaf()) return m.id;
                const leafId = this._getEnteredLeafInFlow(m.id, flowName);
                return leafId || m.id;
            })
            .filter(Boolean);
        const ids = [...raw];
        const flowNames = ids.map(id => this.getModule(id)?.flowName);
        return ids.filter((id, i) => !ids.some((other, j) => other !== id && flowNames[i] === flowNames[j] && this._isAncestorOf(id, other)));
    }

    /**
     * 用于「当前模块」展示：main 始终有一项（可为根/父级浮层），分流程仅在有叶节点当前时展示，且分流程不展示浮层。
     * @returns {{ flowName: string, moduleId: string, moduleName: string, isFloating: boolean }[]}
     */
    getCurrentModulesForDisplay() {
        const flowOrder = this._getQueueFlowOrder();
        const result = [];
        for (const flowName of flowOrder) {
            const m = this.currentModulesByFlow.get(flowName);
            if (!m || m.state === MODULE_STATES.UNTRIGGERED) {
                if (flowName === 'main' && this.rootModuleId) {
                    const root = this.getModule(this.rootModuleId);
                    if (root) result.push({ flowName: 'main', moduleId: root.id, moduleName: root.name || root.id, isFloating: true });
                }
                continue;
            }
            if (flowName === 'main') {
                const name = m.name || m.id;
                result.push({ flowName: 'main', moduleId: m.id, moduleName: name, isFloating: !m.isLeaf() });
            } else {
                if (!m.isLeaf()) continue; // 分流程不展示浮层
                result.push({ flowName, moduleId: m.id, moduleName: m.name || m.id, isFloating: false });
            }
        }
        return result;
    }

    /**
     * 当前模块（用于展示/断言）：与 getCurrentModuleIds 一致，取去重后的第一个当前模块，不出现「同时是父又是子」。
     */
    get currentModule() {
        const ids = this.getCurrentModuleIds();
        if (!ids.length) return null;
        // 多 flow 多「当前所在」：浮层的 main 解析为根模块占位，不应作为单值「当前模块」。
        // 与断言生成器一致：优先取真实已进入的叶（非根占位）；皆为根占位才回根。
        const nonRoot = ids.find(id => id !== this.rootModuleId);
        return this.getModule(nonRoot || ids[0]);
    }

    /**
     * Get path to module (from root to module, including module itself)
     * @param {string} moduleId
     * @returns {string[]}
     */
    getPathToModule(moduleId) {
        if (!moduleId) return [];
        const module = this.getModule(moduleId);
        if (!module) return [];
        const parentChain = this._getParentChain(moduleId);
        return parentChain.concat(moduleId);
    }

    /**
     * Get pending delivery info for a module
     * @param {GameModule} module
     * @returns {Array}
     */
    getPendingDeliveryInfoForModule(module) {
        if (!module || !this.conditionEvaluator) return [];
        return module.getPendingDeliveryInfo(this.conditionEvaluator);
    }

    /**
     * 与断言脚本一致的 flow 顺序，用于 getCurrentModuleIds 等。含 main/sect_story/linger_childhood 及根下其他 flow（如 npc_flows），以便「当前进入的模块」显示所有 flow 的当前。
     */
    _getQueueFlowOrder() {
        const root = this.rootModule;
        if (!root) return ['main'];
        const names = Object.keys(root.flows || {});
        for (const f of root.subModules.keys()) if (!names.includes(f)) names.push(f);
        return ['main', ...names.filter((f) => f !== 'main')];
    }

    /**
     * 将 id 列表按「有序（链/时间线）」与「无序（自由，平级任选）」拆分，供展示用：有序用顺序，无序不表示顺序。
     * @private
     */
    /** 队列顺序：时间线满足时排第一（可打断），时间线按时间进入要求排序，然后触发器链，最后自由。 */
    _sortQueueIdsByType(ids) {
        const byType = (id) => {
            const m = this.getModule(id);
            if (!m) return 2;
            if (m.type === MODULE_TYPES.TIMELINE) return 0;
            if (m.type === MODULE_TYPES.TRIGGER_CHAIN) return 1;
            return 2;
        };
        const timelineSortKey = (id) => {
            const m = this.getModule(id);
            return (m && m.type === MODULE_TYPES.TIMELINE && m.triggerTime != null) ? m.triggerTime : 0;
        };
        return [...ids].sort((a, b) => {
            const ta = byType(a);
            const tb = byType(b);
            if (ta !== tb) return ta - tb;
            if (ta === 0) return timelineSortKey(a) - timelineSortKey(b);
            return 0;
        });
    }

    _splitOrderedUnordered(ids) {
        const ordered = [];
        const unordered = [];
        for (const id of ids) {
            const m = this.getModule(id);
            if (!m) continue;
            if (m.type === MODULE_TYPES.FREE_TRIGGER) unordered.push(id);
            else ordered.push(id);
        }
        return { ordered, unordered };
    }

    /**
     * 按文档 04-debug-panels 与 queue-logic-for-tests 构建五类队列：
     * - current/expected/possible：各含 ordered（链+时间线，有顺序）与 unordered（自由，平级任选一）。
     * - completed：按玩家完成顺序（completedTimestamp 升序）；父级在最后子完成之后完成才计入顺序。
     * - floating：当前队列为空时卡在父级与下一节点之间，记录所在父级。
     */
    buildQueues() {
        const completedModules = Array.from(this.modules.values())
            .filter(m => m.state === MODULE_STATES.COMPLETED && m.flowName);
        const completed = completedModules
            .sort((a, b) => {
                const ta = this.getModuleTimestamp(a.id, 'completed');
                const tb = this.getModuleTimestamp(b.id, 'completed');
                if (!ta) return 1;
                if (!tb) return -1;
                return ta.compare(tb);
            })
            .map(m => m.id);

        const mainCur = this.currentModulesByFlow.get('main');
        let floating = null;

        if (!mainCur) {
            const branchFlows = this._getQueueFlowOrder().filter(f => f !== 'main');
            const branches = branchFlows.map((flowName) => {
                const raw = this._getBranchFlowCurrentQueue(flowName);
                return { flowName, ...this._splitOrderedUnordered(raw) };
            });
            return {
                current: { ordered: [], unordered: [] },
                expected: { ordered: [], unordered: [] },
                possible: { ordered: [], unordered: [] },
                branches,
                completed,
                floating: null
            };
        }

        const isFloating = !mainCur.isLeaf();
        if (isFloating) {
            floating = { flowName: 'main', parentModuleId: mainCur.id };
        }

        const current = [];
        const expected = [];
        const possible = [];

        // 队列范围 = 当前所在父级内；触发器链只显示「下一个」，时间线/自由同父并列才入队
        const scopeParent = this._getScopeParentForQueue(mainCur) || this.rootModuleId;

        let stateBefore;
        if (!isFloating) {
            stateBefore = { state: mainCur.state, completedTimestamp: mainCur.completedTimestamp };
            mainCur.setState(MODULE_STATES.COMPLETED, this.timeSystem ? this.timeSystem.getCurrentTime() : null);
        }

        const visibleMain = this._getVisibleMainLeaves(mainCur.id);

        for (const id of visibleMain) {
            const mod = this.getModule(id);
            if (!mod || !mod.isLeaf()) continue;
            if (mod.state === MODULE_STATES.ENTERED || mod.state === MODULE_STATES.COMPLETED) continue;
            
            // 检查父级模块是否已进入：如果父级未进入，子级触发器链应该进入 possible 队列
            const parentMod = mod.parentModuleId ? this.getModule(mod.parentModuleId) : null;
            const parentNotEntered = parentMod && parentMod.state !== MODULE_STATES.ENTERED && parentMod.state !== MODULE_STATES.COMPLETED;
            
            if (mod.type === MODULE_TYPES.TRIGGER_CHAIN) {
                const chainPrev = mod.linkedList && mod.linkedList.prev != null ? mod.linkedList.prev : null;
                const prevOk = chainPrev == null || this.getModule(chainPrev)?.state === MODULE_STATES.COMPLETED;
                if (!prevOk || parentNotEntered) {
                    possible.push(id);
                    continue;
                }
            }
            
            // 如果父级未进入，所有子级都应该进入 possible 队列
            if (parentNotEntered) {
                possible.push(id);
                continue;
            }
            
            if (mod.type === MODULE_TYPES.TIMELINE && !this._isTimelineTimeReached(id)) {
                expected.push(id);
                continue;
            }
            const cls = this._entryClass(id);
            if (cls === 'current') current.push(id);
            else if (cls === 'expected') expected.push(id);
            else possible.push(id);
        }

        // 未进入下一父级前，下一父级内的链不能进 current（坎）：本 scope 内链已排完时，下一父级首链叶进 possible，不进 current
        const nextChainInScope = this._getNextTriggerChainLeafInScope(scopeParent);
        if (!isFloating && nextChainInScope == null && scopeParent) {
            const chainOrder = this._getTriggerChainOrder('main', scopeParent);
            const chainTailId = chainOrder.length ? chainOrder[chainOrder.length - 1] : null;
            if (chainTailId) {
                const nextFirst = this._getNextParentFirstChainLeaf(chainTailId);
                if (nextFirst && !possible.includes(nextFirst)) possible.push(nextFirst);
            }
        }

        if (!isFloating && stateBefore !== undefined) {
            // 直接还原，不能走 setState：它会清掉进入时间，相对时间条件就找不到参照了
            mainCur.state = stateBefore.state;
            mainCur.completedTimestamp = stateBefore.completedTimestamp;
        }

        const possibleSet = new Set(possible);
        const expectedSet = new Set(expected.filter((id) => !possibleSet.has(id)));
        const currentDeduped = current.filter((id) => !possibleSet.has(id) && !expectedSet.has(id));

        const branchFlows = this._getQueueFlowOrder().filter(f => f !== 'main');
        const branches = branchFlows.map((flowName) => {
            const raw = this._getBranchFlowCurrentQueue(flowName);
            return { flowName, ...this._splitOrderedUnordered(raw) };
        });

        if (currentDeduped.length === 0 && mainCur && mainCur.isLeaf()) {
            floating = { flowName: 'main', parentModuleId: mainCur.parentModuleId || this.rootModuleId };
        }

        return {
            current: this._splitOrderedUnordered(this._sortQueueIdsByType(currentDeduped)),
            expected: this._splitOrderedUnordered(this._sortQueueIdsByType([...expectedSet])),
            possible: this._splitOrderedUnordered(this._sortQueueIdsByType(possible)),
            branches,
            completed,
            floating
        };
    }

    /**
     * 某分流程的「当前可进入」叶节点 id 列表（entryEvent 已完成且满足进入条件的叶）。
     * @private
     */
    _getBranchFlowCurrentQueue(flowName) {
        const rootId = this.rootModuleId;
        if (!rootId) return [];
        const root = this.getModule(rootId);
        if (!root || !root.flows || !root.flows[flowName]) return [];
        const entryEventId = root.flows[flowName].entryEvent;
        if (entryEventId && this.getModule(entryEventId)?.state !== MODULE_STATES.COMPLETED) return [];
        const parentId = rootId;
        const lev = this._getLevelDirectChildren(flowName, parentId);
        const leaves = [...lev.chainOrder, ...lev.timelineList.map(m => m.id), ...lev.freeIds].filter((id) => this.getModule(id)?.isLeaf());
        return leaves.filter((id) => {
            const m = this.getModule(id);
            if (!m || m.state === MODULE_STATES.ENTERED || m.state === MODULE_STATES.COMPLETED) return false;
            const prev = m.linkedList && m.linkedList.prev != null ? m.linkedList.prev : null;
            if (prev != null && this.getModule(prev)?.state !== MODULE_STATES.COMPLETED) return false;
            return this.canEnterModule(id);
        });
    }

    /**
     * Get queue (alias for buildQueues, for game-engine compatibility)
     * @returns {Object}
     */
    getQueue() {
        return this.buildQueues();
    }

    /**
     * Update variable hierarchy (for test panel compatibility)
     * 更新变量作用域层次结构：注册所有模块变量，并设置模块父子关系供 getVisibleVariables 使用。
     */
    updateVariableHierarchy() {
        if (!this.variableSystem) return;

        const hierarchy = {};
        for (const [moduleId, module] of this.modules) {
            if (module.parentModuleId != null) {
                hierarchy[moduleId] = module.parentModuleId;
            }
            if (module.variables && Array.isArray(module.variables) && module.variables.length > 0) {
                this.variableSystem.registerVariables(module.variables, moduleId);
            }
        }
        if (Object.keys(hierarchy).length > 0 && typeof this.variableSystem.setModuleHierarchy === 'function') {
            this.variableSystem.setModuleHierarchy(hierarchy);
        }
    }

    /**
     * Untrigger module
     * 禁止取消链中间节点：若该节点有下一链节点且下一链已进入，则不允许 untrigger。
     */
    untriggerModule(moduleId, options = {}) {
        const module = this.getModule(moduleId);
        if (!module) {
            return { success: false, error: 'Module not found' };
        }

        // 下一链已进入时禁止取消前一节点
        if (module.type === MODULE_TYPES.TRIGGER_CHAIN && module.linkedList && module.linkedList.next) {
            const nextMod = this.getModule(module.linkedList.next);
            if (nextMod && nextMod.state === MODULE_STATES.ENTERED) {
                return { success: false, error: I18n.t('下一链节点已进入，不可取消当前链节点') };
            }
        }

        const timestamp = this.timeSystem ? this.timeSystem.getCurrentTime() : null;

        const toCancel = this._getIdsToCancelWhenLeaving(module.flowName, moduleId);
        for (const id of toCancel) {
            const m = this.getModule(id);
            if (m && (m.state === MODULE_STATES.ENTERED || m.state === MODULE_STATES.COMPLETED)) {
                m.setState(MODULE_STATES.UNTRIGGERED, timestamp);
            }
        }
        // 祖先下面已经有未完成的内容，不能继续是「已完成」：退回进行中
        for (const aid of this._getParentChain(moduleId)) {
            const a = this.getModule(aid);
            if (a && a.state === MODULE_STATES.COMPLETED) {
                a.state = MODULE_STATES.ENTERED;
                a.completedTimestamp = null;
            }
        }
        this._repairCurrentModules();
        return { success: true, moduleId };
    }

    /**
     * 标记模块为「中断未完成」（01-core-schemas 7.3）。模块须已 entered 才写入 interruptedModules；未进入时直接成功返回且不写入。
     * @param {string} moduleId
     * @param {{ summary: string }} options - summary 为中断时填写的总结，供续玩调取
     * @returns {{ success: boolean, error?: string }}
     */
    markModuleInterrupted(moduleId, options = {}) {
        const module = this.getModule(moduleId);
        if (!module) return { success: false, error: 'Module not found' };
        if (module.state !== MODULE_STATES.ENTERED) {
            return { success: true, moduleId }; // 未进入的模块不写入 interruptedModules，但接口返回成功
        }
        module.interrupted = true;
        module.interruptSummary = options.summary != null ? String(options.summary) : '';
        return { success: true, moduleId };
    }

    /**
     * 清除模块的「中断未完成」标记（续玩完成或放弃后调用）
     * @param {string} moduleId
     * @returns {{ success: boolean, error?: string }}
     */
    clearModuleInterrupted(moduleId) {
        const module = this.getModule(moduleId);
        if (!module) return { success: false, error: 'Module not found' };
        module.interrupted = false;
        module.interruptSummary = null;
        return { success: true, moduleId };
    }

    /**
     * 若模块已进入且被标记为中断，返回用于展示的 info 文案（「中断未完成」+ 总结）；否则返回 null
     * @param {string} moduleId
     * @returns {string|null}
     */
    getInterruptInfoForModule(moduleId) {
        const module = this.getModule(moduleId);
        if (!module || module.state !== MODULE_STATES.ENTERED || !module.interrupted) return null;
        const summary = module.interruptSummary ? `\n${module.interruptSummary}` : '';
        return I18n.t('【中断未完成】') + summary;
    }

    /**
     * 取消某节点时需一并取消的 id 集合：该节点自身、其所有子孙，以及路径上每一层中
     * 与路径子节点同类、顺序在其后的兄弟（触发器链按链序，时间线按时间线序）及这些兄弟的子孙。
     * 自由触发器与不同类的兄弟是并列关系，不受影响。
     * @private
     */
    _getIdsToCancelWhenLeaving(flowName, moduleId) {
        const path = this._getParentChain(moduleId).concat(moduleId);
        const toCancelSet = new Set([moduleId]);
        const addDescendants = (id) => {
            for (const subId of this._getAllDescendantIds(id)) toCancelSet.add(subId);
        };
        addDescendants(moduleId);

        for (let i = 0; i <= path.length - 2; i++) {
            const levelParentId = path[i];
            const pathChild = this.getModule(path[i + 1]);
            if (!pathChild) continue;
            const fn = pathChild.flowName;
            let order = [];
            if (pathChild.type === MODULE_TYPES.TRIGGER_CHAIN) order = this._getTriggerChainOrder(fn, levelParentId);
            else if (pathChild.type === MODULE_TYPES.TIMELINE) order = this._getTimelinesInGroup(fn, levelParentId).map(m => m.id);
            const idx = order.indexOf(pathChild.id);
            if (idx < 0) continue;
            for (let j = idx + 1; j < order.length; j++) addDescendants(order[j]);
        }
        return Array.from(toCancelSet);
    }

    /**
     * 当某个流程的「当前模块」已变成未触发时，把它改到最近的、仍在进行或已完成的祖先；
     * 找不到则主流程退回根、其他流程清空。
     * @private
     */
    _repairCurrentModules() {
        for (const [flow, m] of Array.from(this.currentModulesByFlow)) {
            if (!m || m.state !== MODULE_STATES.UNTRIGGERED) continue;
            let pid = m.parentModuleId;
            let target = null;
            while (pid) {
                const p = this.getModule(pid);
                if (!p) break;
                if (p.state !== MODULE_STATES.UNTRIGGERED) { target = p; break; }
                pid = p.parentModuleId;
            }
            this._setFlowCurrent(flow, target);
        }
    }

    /**
     * Can enter module
     */
    /**
     * 完成后自动进入「下一个」（链 next / 时间线 next）的判定：
     * 仅结构类条件（module/tag/time）阻拦；变量类（variable / variable_compare）不阻拦——
     * 进入时由 _applyVariableUpdatesForEnteringModule 自动把变量设到满足合并进入条件
     * （01-core-schemas「进入/跳转时变量更新」），故此处忽略变量类条件。
     * 结构类不满足时返回 false → 不自动进入（浮层），符合「下一个条件没到则 float」。
     * @private
     */
    _canAutoEnterNext(nextId) {
        const m = this.getModule(nextId);
        if (!m) return false;
        if (m.state === MODULE_STATES.ENTERED || m.state === MODULE_STATES.COMPLETED) return false;
        // 流程前置开关 entryEvent（非 main 流程须先完成 entryEvent 模块）
        if (m.flowName && m.flowName !== 'main' && m.parentModuleId) {
            const parent = this.getModule(m.parentModuleId);
            const flowData = parent && parent.flows ? parent.flows[m.flowName] : null;
            if (flowData && flowData.entryEvent && flowData.entryEvent !== m.id &&
                !this.checkModuleState(flowData.entryEvent, 'completed')) {
                return false;
            }
        }
        if (!this.conditionEvaluator) return true;
        return this._evalEntry(nextId, { variable: true });
    }

    canEnterModule(moduleId) {
        if (!this.conditionEvaluator) {
            console.warn('ConditionEvaluator not set');
            return false;
        }

        const module = this.getModule(moduleId);
        if (!module) return false;

        // Can't enter if already entered or completed
        if (module.state === MODULE_STATES.ENTERED || module.state === MODULE_STATES.COMPLETED) {
            return false;
        }

        // 01-core-schemas: 流程前置开关 entryEvent（非 main 流程须先完成 entryEvent 模块）
        if (module.flowName && module.flowName !== 'main' && module.parentModuleId) {
            const parent = this.getModule(module.parentModuleId);
            const flowData = parent && parent.flows ? parent.flows[module.flowName] : null;
            if (flowData && flowData.entryEvent && flowData.entryEvent !== module.id) {
                if (!this.checkModuleState(flowData.entryEvent, 'completed')) {
                    return false;
                }
            }
        }

        // 允许用户跳着进入，系统会自动完成前面的（在 jumpToModule 的 _computeJumpEffect 中处理）
        // 不再阻止顺序检查，只检查条件

        // 进入条件合并规则（01-core-schemas）
        return this._evalEntry(moduleId, {});
    }

    /**
     * Can complete module
     */
    canCompleteModule(moduleId) {
        if (!this.conditionEvaluator) {
            console.warn('ConditionEvaluator not set');
            return false;
        }

        const module = this.getModule(moduleId);
        if (!module) return false;

        // Must be entered first
        if (module.state !== MODULE_STATES.ENTERED) {
            return false;
        }

        // 允许用户跳着完成，系统会自动完成前面的（在 completeModule 中处理）
        // 不再阻止顺序检查，只检查完成条件

        // 01-core-schemas: 仅当「未完成且应展示」的 deliveryInfo 为空时方可完成
        if (module.getPendingDeliveryInfo(this.conditionEvaluator).length > 0) {
            return false;
        }

        // 检查完成条件
        if (!module.completionConditions || module.completionConditions.length === 0) {
            return true;
        }

        for (const wrapper of module.completionConditions) {
            if (wrapper.conditionDef) {
                if (!this.conditionEvaluator.evaluate(wrapper.conditionDef, 'precondition')) {
                    return false;
                }
            }
        }

        return true;
    }

    /**
     * Check module state
     */
    checkModuleState(moduleId, state) {
        const module = this.getModule(moduleId);
        if (!module) return false;
        if (state === 'completed') return module.state === MODULE_STATES.COMPLETED;
        // 「已进入」包含之后已完成的情况
        if (state === 'entered') return module.state === MODULE_STATES.ENTERED || module.state === MODULE_STATES.COMPLETED;
        if (state === 'untriggered') return module.state === MODULE_STATES.UNTRIGGERED;
        return false;
    }

    /**
     * 进入条件的来源，按优先级排列：当前模块 → 逐级父模块（由近到远）→ 链上前一个模块。
     * 每个来源只含自己写的条件，不做合并；合并规则在 _evalEntry 里体现。
     * @returns {Array<{ moduleId: string, defs: Array<{ mode: string, def: Object }> }>}
     * @private
     */
    _getEntrySources(moduleId) {
        const module = this.getModule(moduleId);
        if (!module) return [];
        const take = (m) => {
            const defs = [];
            for (const w of (m.entryConditions || [])) {
                if (w && w.conditionDef && Array.isArray(w.conditionDef.groups)) defs.push({ mode: w.type || 'precondition', def: w.conditionDef });
            }
            return { moduleId: m.id, defs };
        };
        const sources = [take(module)];
        const seen = new Set([moduleId]);
        let parentId = module.parentModuleId;
        while (parentId && !seen.has(parentId)) {
            seen.add(parentId);
            const parent = this.getModule(parentId);
            if (!parent) break;
            sources.push(take(parent));
            parentId = parent.parentModuleId;
        }
        if (module.type === MODULE_TYPES.TRIGGER_CHAIN && module.linkedList && module.linkedList.prev) {
            const prev = this.getModule(module.linkedList.prev);
            if (prev) sources.push(take(prev));
        }
        return sources;
    }

    /**
     * 把 conditionDef 里的所有单个条件摊平成数组（忽略 AND/OR 结构），用于列出引用与计算跳转时的变量目标。
     * @private
     */
    _collectConditionsFromDef(conditionDef) {
        const conditions = [];
        if (!conditionDef || !Array.isArray(conditionDef.groups)) return conditions;
        for (const group of conditionDef.groups) {
            if (!group || !Array.isArray(group.items)) continue;
            for (const item of group.items) {
                if (!item) continue;
                if (item.itemType === 'condition' && item.condition) {
                    conditions.push(item.condition);
                } else if (item.itemType === 'group' && item.group) {
                    conditions.push(...this._collectConditionsFromDef(item.group));
                }
            }
        }
        return conditions;
    }

    /** 条件的类别：变量类、时间类、其余（模块状态、标签等） */
    _conditionKind(c) {
        if (!c) return 'rest';
        if (c.type === 'variable' || c.type === 'variable_compare') return 'variable';
        if (c.type === 'time' || c.type === 'time_range') return 'time';
        return 'rest';
    }

    /**
     * 返回 conditionDef 的副本，其中 shouldSkip 为 true 的单个条件换成「无条件」（视为满足），AND/OR 结构原样保留。
     * @private
     */
    _maskConditionDef(def, shouldSkip) {
        const maskGroup = (g) => {
            if (!g || !Array.isArray(g.items)) return g;
            return Object.assign({}, g, {
                items: g.items.map((it) => {
                    if (!it) return it;
                    if (it.itemType === 'group') return Object.assign({}, it, { group: maskGroup(it.group) });
                    if (it.itemType === 'condition' && it.condition && shouldSkip(it.condition)) {
                        return { itemType: 'condition', condition: { type: 'none' } };
                    }
                    return it;
                })
            });
        };
        return Object.assign({}, def, { groups: (def.groups || []).map(maskGroup) });
    }

    /**
     * 每个变量由哪个来源决定：同一变量出现在多个来源里时，优先级最高的来源说了算（当前模块 > 父级 > 链上前一个）。
     * @private
     */
    _entryVariableClaims(sources) {
        const claims = new Map();
        sources.forEach((src, i) => {
            for (const { def } of src.defs) {
                for (const c of this._collectConditionsFromDef(def)) {
                    if (c.type === 'variable' && c.variableId && !claims.has(c.variableId)) claims.set(c.variableId, i);
                }
            }
        });
        return claims;
    }

    /**
     * 按进入条件合并规则评估模块的进入条件：各来源的条件同时满足；同一变量只看优先级最高的来源。
     * ignore 指定哪些类别的条件不参与（视为满足）：{ variable, time, rest }。
     * @private
     */
    _evalEntry(moduleId, ignore = {}) {
        const ce = this.conditionEvaluator;
        if (!ce) return false;
        const sources = this._getEntrySources(moduleId);
        const claims = this._entryVariableClaims(sources);
        for (let i = 0; i < sources.length; i++) {
            for (const { mode, def } of sources[i].defs) {
                const masked = this._maskConditionDef(def, (c) => {
                    if (c.type === 'variable' && claims.get(c.variableId) !== i) return true;
                    return !!ignore[this._conditionKind(c)];
                });
                if (!ce.evaluate(masked, mode)) return false;
            }
        }
        return true;
    }

    /**
     * 模块在队列里的归类：条件全满足 → current；只差变量或时间 → expected；还差模块状态、标签等 → possible。
     * @returns {'current'|'expected'|'possible'}
     * @private
     */
    _entryClass(moduleId) {
        if (this._evalEntry(moduleId, {})) return 'current';
        return this._evalEntry(moduleId, { variable: true, time: true }) ? 'expected' : 'possible';
    }

    /**
     * 时间线节点是否「时间已到」：只评估进入条件里的时间类条件。
     * 用于队列：时间线是「等到了再插队」；未到时间时进 expected（时间视为变量类条件）。
     * @private
     */
    _isTimelineTimeReached(moduleId) {
        if (!this.conditionEvaluator || !this.timeSystem) return true;
        return this._evalEntry(moduleId, { variable: true, rest: true });
    }

    /**
     * 收集某模块进入条件中的相对时间条件并解析为绝对时间（供 test panel 显示「相对时间已解析」）。
     * @param {string} moduleId
     * @returns {Array<{ refModuleId, refState, offset, resolved, refName }>}
     */
    getResolvedRelativeTimeConditions(moduleId) {
        const out = [];
        for (const src of this._getEntrySources(moduleId)) {
            for (const { def } of src.defs) {
                for (const c of this._collectConditionsFromDef(def)) {
                    if (c && c.type === 'time' && c.timeType === 'relative' && c.relative) {
                        const resolved = this.resolveRelativeTime(c.relative, true);
                        const ref = this.getModule(c.relative.moduleId);
                        out.push({
                            refModuleId: c.relative.moduleId,
                            refState: c.relative.state || 'entered',
                            offset: c.relative.offset || {},
                            resolved,
                            refName: ref ? (ref.name || ref.id) : c.relative.moduleId
                        });
                    }
                }
            }
        }
        return out;
    }

    /**
     * Apply variable updates for entering module
     * 根据模块的 variableSetOnEnter 或 autoSetVariables 设置变量
     * @private
     */
    _applyVariableUpdatesForEnteringModule(moduleId, changes) {
        if (!this.variableSystem) return;
        
        const module = this.getModule(moduleId);
        if (!module) return;

        // 应用 variableSetOnEnter（模组配置的强制变量设置）
        if (module.variableSetOnEnter && typeof module.variableSetOnEnter === 'object') {
            for (const [varId, value] of Object.entries(module.variableSetOnEnter)) {
                const oldVal = this.variableSystem.getValue(varId);
                this.variableSystem.executeOperation(varId, 'set', value);
                if (changes && changes.variables) {
                    changes.variables[varId] = { from: oldVal, to: value };
                }
            }
        }

        // 如果变量系统有 updateBuiltinVariables 方法，调用它（更新由变量系统定义的计算型变量，如 builtin）
        if (typeof this.variableSystem.updateBuiltinVariables === 'function') {
            this.variableSystem.updateBuiltinVariables();
        }
    }

    /**
     * Enter module (alias for jumpToModule)
     */
    enterModule(moduleId, options = {}) {
        return this.jumpToModule(moduleId, options);
    }

    /**
     * Get jump preview
     */
    getJumpPreview(moduleId, options = {}) {
        const module = this.getModule(moduleId);
        const result = {
            toComplete: [],
            toCancel: [],
            toEnter: moduleId,
            parentChain: [],
            conditionsMet: false,
            missingConditions: [],
            moduleName: module ? module.name : ''
        };
        if (!module) return result;

        const flowName = module.flowName;
        const targetLeafId = module.isLeaf() ? moduleId : this._getFirstLeafInModule(moduleId, flowName);
        const targetLeaf = targetLeafId ? this.getModule(targetLeafId) : null;
        result.conditionsMet = options.force || (targetLeaf && this.canEnterModule(targetLeafId));
        
        if (!targetLeafId) {
            result.parentChain = this._getParentChain(moduleId);
            result.toEnter = moduleId;
            return result;
        }
        const effect = this._computeJumpEffect(flowName, targetLeafId);
        result.parentChain = effect.path.slice(0, -1);
        result.toComplete = effect.toComplete.slice();
        result.toCancel = effect.toCancel.slice();
        result.toEnter = targetLeafId;
        return result;
    }

    /**
     * 取该模块在指定 flow（通常 main）下的「第一个触发器链」并递归到第一个 leaf。
     * 进入父级 = 进入 main 的第一个触发器链一直进到第一个 leaf。
     * @private
     */
    _getFirstLeafInModule(moduleId, flowName) {
        const module = this.getModule(moduleId);
        if (!module) return null;
        const childIds = this._getDirectChildIdsInFlowOrder(flowName, moduleId);
        const firstChainId = childIds.find((id) => this.getModule(id)?.type === MODULE_TYPES.TRIGGER_CHAIN);
        if (!firstChainId) return null;
        const firstChain = this.getModule(firstChainId);
        if (!firstChain) return null;
        if (firstChain.isLeaf()) return firstChainId;
        return this._getFirstLeafInModule(firstChainId, flowName);
    }

    /**
     * Get ordered sibling IDs
     * @private
     */
    _getOrderedSiblingIds(flowName, parentId) {
        const level = this._getLevelDirectChildren(flowName, parentId);
        return [...level.chainOrder, ...level.timelineIds, ...level.freeIds, ...level.otherIds];
    }

    /**
     * Load modules (alias for init)
     */
    loadModules(moduleData) {
        this.init(moduleData);
    }

    /**
     * Load module (alias for init)
     */
    loadModule(moduleData) {
        this.init(moduleData);
    }
}

// Export
if (typeof window !== 'undefined') {
    window.ModuleSystem = ModuleSystem;
    window.GameModule = GameModule;
    window.MODULE_STATES = MODULE_STATES;
    window.MODULE_TYPES = MODULE_TYPES;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ModuleSystem, GameModule, MODULE_STATES, MODULE_TYPES };
}
