/**
 * 运行时桥：真实游戏状态（State）与核心系统（模块 / 变量 / 时间 / 条件 / 总结 / 提示词 / 标签）之间的转换。
 *
 * 状态是唯一的存档来源。生成提示词、落地 AI 回复之前，用 build 把状态装进一套全新的核心系统；
 * 操作完用 commit 写回状态。核心系统不跨回合保留，所以不会和状态漂移。
 *
 * 状态里的模块路径不含根模块 id（与 ModuleManager 一致）；核心系统的路径含根，转换时统一去掉。
 */
const RuntimeBridge = {
    DEFAULT_TIME_FORMAT: '{{year}}年{{month}}月{{day}}日 {{hour}}时',

    /** 去掉路径开头的根模块 id。 */
    stripRoot(path, rootId) {
        const ids = Array.isArray(path) ? path.filter(x => x != null && x !== '') : [];
        return ids.length && ids[0] === rootId ? ids.slice(1) : ids;
    },

    /** 状态里的当前路径统一成「路径数组的数组」，兼容单条路径与多条路径两种存法。 */
    normalizePaths(currentModulePath, rootId) {
        const cmp = Array.isArray(currentModulePath) ? currentModulePath : [];
        const list = (cmp.length && Array.isArray(cmp[0])) ? cmp : (cmp.length ? [cmp] : []);
        return list.map(p => this.stripRoot(p, rootId)).filter(p => p.length > 0);
    },

    _clone(v) {
        return (v !== null && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
    },

    _num(v) {
        return (typeof v === 'number' && isFinite(v)) ? v : null;
    },

    /**
     * 用模组原始配置 + 游戏状态装一套核心系统。
     * @param {object} config - 模组原始配置（module.json 的内容）
     * @param {object} state - 游戏状态（State）
     * @param {object} [opts]
     * @returns {{config, state, timeSystem, variableSystem, moduleSystem, conditionEvaluator, summarySystem, promptGenerator, tagParser}}
     */
    build(config, state, opts = {}) {
        if (!config || !config.id) throw new Error('模组配置缺少根模块');
        const rootId = config.id;
        const vars = (state && state.variables) || {};

        const timeCfg = (config.timeSystem && typeof config.timeSystem === 'object') ? { ...config.timeSystem } : {};
        if (!timeCfg.displayFormat) timeCfg.displayFormat = this.DEFAULT_TIME_FORMAT;
        const timeSystem = new TimeSystem(timeCfg);
        const t = vars.time;
        if (t && typeof t === 'object') {
            const vals = {};
            for (const k of ['year', 'month', 'day', 'hour', 'minute']) {
                const n = this._num(t[k]);
                if (n !== null) vals[k] = n;
            }
            timeSystem.setInitialValues(vals);
        }

        const variableSystem = new VariableSystem();
        const moduleSystem = new ModuleSystem();
        moduleSystem.setTimeSystem(timeSystem);
        moduleSystem.setVariableSystem(variableSystem);
        moduleSystem.loadModule(config);

        const getTags = () => this._collectTags(moduleSystem);
        const conditionEvaluator = new ConditionEvaluator({ variableSystem, timeSystem, moduleSystem, getCurrentTags: getTags });
        moduleSystem.setConditionEvaluator(conditionEvaluator);
        variableSystem.setConditionEvaluator(conditionEvaluator);

        // 动态生成的模块（模块生成器写入状态里的记录）
        const dyn = state && state.dynamicSubModules && state.dynamicSubModules[rootId];
        if (Array.isArray(dyn)) {
            for (const entry of dyn) {
                if (entry && entry.templateRaw && entry.templateRaw.id) {
                    moduleSystem.addDynamicModule(this._clone(entry.templateRaw), rootId, entry.flowKey || 'main');
                }
            }
        }

        for (const v of variableSystem.variables.values()) {
            // 模组里写成「列表，每项是对象」的变量，按对象列表处理（支持新增 / 修改 / 移除某一项）
            if (v.type === 'list' && v.listItemType === 'object') v.type = 'list_of_object';
            // 变量当前值以状态为准
            if (Object.prototype.hasOwnProperty.call(vars, v.id) && vars[v.id] !== undefined) {
                v.value = this._clone(vars[v.id]);
            }
        }

        this._deriveModuleStates(moduleSystem, timeSystem, state, rootId);
        this._deriveDeliveries(moduleSystem, state, rootId);

        let summarySystem = null;
        if (typeof SummarySystem === 'function') {
            summarySystem = new SummarySystem();
            const saved = state && state.summaries;
            if (saved && !Array.isArray(saved) && typeof saved === 'object') summarySystem.importState(saved);
            summarySystem.setTimeSystem(timeSystem);
            summarySystem.setVariableSystem(variableSystem);
            summarySystem.setModuleSystem(moduleSystem);
        }

        variableSystem.updateBuiltinVariables();

        const engine = { config, state, timeSystem, variableSystem, moduleSystem, conditionEvaluator, summarySystem, promptGenerator: null, tagParser: null };

        if (typeof PromptGenerator === 'function') {
            const pg = new PromptGenerator();
            pg.setTimeSystem(timeSystem);
            pg.setVariableSystem(variableSystem);
            pg.setModuleSystem(moduleSystem);
            if (summarySystem) pg.setSummarySystem(summarySystem);
            pg.setPluginSystem(this._pluginAdapter(engine));
            engine.promptGenerator = pg;
        }
        if (typeof TagParser === 'function') {
            const tp = new TagParser();
            tp.setVariableSystem(variableSystem);
            tp.setTimeSystem(timeSystem);
            tp.setModuleSystem(moduleSystem);
            if (summarySystem) tp.setSummarySystem(summarySystem);
            tp.setPluginSystem(this._pluginAdapter(engine));
            if (engine.promptGenerator) { tp.setPromptGenerator(engine.promptGenerator); engine.promptGenerator.setTagParser(tp); }
            tp.timeUnits = config.timeUnits || null;
            engine.tagParser = tp;
        }
        return engine;
    },

    _collectTags(moduleSystem) {
        const out = [];
        for (const m of moduleSystem.modules.values()) {
            if (m.state === 'entered' && Array.isArray(m.tags)) out.push(...m.tags);
        }
        return out;
    },

    _toTs(rec) {
        if (!rec || typeof rec !== 'object') return null;
        return { year: rec.year ?? 1, month: rec.month ?? 1, day: rec.day ?? 1, hour: rec.hour ?? 0, minute: rec.minute ?? 0 };
    },

    /** 状态里记录的「已完成 / 当前所在」写进模块系统。 */
    _deriveModuleStates(ms, timeSystem, state, rootId) {
        const completed = (state && state.flowNodeCompleted && state.flowNodeCompleted[rootId]) || {};
        const completedAt = (state && state.flowNodeCompletedAt && state.flowNodeCompletedAt[rootId]) || {};
        const enteredAt = (state && state.flowNodeEnteredAt && state.flowNodeEnteredAt[rootId]) || {};
        const now = timeSystem.getCurrentTime();
        const completedIds = new Set();

        for (const key of Object.keys(completed)) {
            if (!completed[key]) continue;
            const ids = this.stripRoot(key.split('|'), rootId);
            const m = ids.length ? ms.getModule(ids[ids.length - 1]) : null;
            if (!m) continue;
            m.setState('completed', this._toTs(completedAt[key]) || now);
            completedIds.add(m.id);
        }

        const paths = this.normalizePaths(state && state.currentModulePath, rootId);
        const root = ms.getModule(rootId);
        let mainSet = false;
        for (const path of paths) {
            const leaf = ms.getModule(path[path.length - 1]);
            if (!leaf) continue;
            const chain = ms.getPathToModule(leaf.id);
            for (const pid of chain) {
                const pm = ms.getModule(pid);
                if (!pm) continue;
                if (pid === leaf.id && completedIds.has(pid)) continue;
                if (pid !== leaf.id && completedIds.has(pid) && pm.state === 'completed') continue;
                pm.setState('entered', this._toTs(enteredAt[this.stripRoot(ms.getPathToModule(pid), rootId).join('|')]) || now);
            }
            const flow = leaf.flowName || 'main';
            if (completedIds.has(leaf.id)) {
                const parent = leaf.parentModuleId ? ms.getModule(leaf.parentModuleId) : null;
                ms._setFlowCurrent(flow, parent && parent.id !== rootId ? parent : null);
            } else {
                ms._setFlowCurrent(flow, leaf);
            }
            if (flow === 'main') mainSet = true;
        }
        if (!mainSet) ms._setFlowCurrent('main', null);
        if (paths.length && root && root.state !== 'completed') root.setState('entered', now);
    },

    /** 已确认完成的投递写进对应模块。 */
    _deriveDeliveries(ms, state, rootId) {
        const done = (state && state.deliveryCompleted && state.deliveryCompleted[rootId]) || {};
        for (const m of ms.modules.values()) {
            if (!Array.isArray(m.deliveryInfo)) continue;
            for (const d of m.deliveryInfo) {
                const key = d.title || d.id;
                if (key && done[key]) d.completed = true;
            }
        }
    },

    /**
     * 插件适配：沿「根 + 所有已进入模块」收集插件，只返回当前生效的。
     * 与 PluginSystem.getActivePlugins 同名同参，供提示词生成器与标签解析器使用。
     */
    _pluginAdapter(engine) {
        const self = this;
        return {
            getActivePlugins(type) {
                const ms = engine.moduleSystem;
                const out = [];
                const seen = new Set();
                const scopeIds = [];
                for (const m of ms.modules.values()) {
                    if (m.id === ms.rootModuleId || m.state === 'entered') scopeIds.push(m.id);
                }
                for (const ownerId of scopeIds) {
                    const owner = ms.getModule(ownerId);
                    for (const raw of (owner.plugins || [])) {
                        if (!raw || !raw.id || seen.has(raw.id)) continue;
                        if (type != null && raw.type !== type) continue;
                        if (!self._pluginActive(raw, engine.conditionEvaluator)) continue;
                        seen.add(raw.id);
                        out.push({ id: raw.id, name: raw.name, type: raw.type, config: raw.config || {}, ownerModuleId: ownerId });
                    }
                }
                return out;
            },
            /** 按名字或 id 找当前生效的插件（任意类型）。 */
            findActive(nameOrId) {
                const key = String(nameOrId == null ? '' : nameOrId).trim();
                if (!key) return null;
                const all = this.getActivePlugins(null);
                const byId = all.filter(p => p.id === key);
                if (byId.length === 1) return byId[0];
                const byName = all.filter(p => (p.name || p.id) === key);
                return byName.length === 1 ? byName[0] : null;
            }
        };
    },

    /** 插件此刻是否生效：没关掉，且生效条件（没写就是始终生效）满足。 */
    _pluginActive(raw, conditionEvaluator) {
        if (raw.enabled === false) return false;
        const cond = raw.condition;
        if (!cond || !cond.type || cond.type === 'always') return true;
        if (!conditionEvaluator || !cond.conditionDef) return false;
        return conditionEvaluator.evaluate(cond.conditionDef, cond.type === 'display' ? 'display' : 'precondition');
    },

    /** 把核心系统里的结果写回状态。 */
    commit(engine) {
        const { config, state, variableSystem: vs, timeSystem: ts, moduleSystem: ms } = engine;
        const rootId = config.id;
        if (!state.variables) state.variables = {};

        for (const v of vs.variables.values()) {
            state.variables[v.id] = this._clone(v.value);
        }

        const sv = ts.systemValues;
        const oldTime = (state.variables.time && typeof state.variables.time === 'object') ? state.variables.time : {};
        state.variables.time = { ...oldTime, year: sv.year, month: sv.month, day: sv.day, hour: sv.hour, minute: sv.minute };

        const completedMap = {};
        const completedAt = {};
        const enteredAt = {};
        const known = new Set();
        for (const m of ms.modules.values()) {
            if (m.id === rootId) continue;
            known.add(m.id);
            const key = this.stripRoot(ms.getPathToModule(m.id), rootId).join('|');
            if (m.state === 'completed') {
                completedMap[key] = true;
                const c = this._toTs(m.completedTimestamp);
                if (c) completedAt[key] = { year: c.year, month: c.month, day: c.day, hour: c.hour };
            }
            if (m.state === 'entered' || m.state === 'completed') {
                const e = this._toTs(m.enteredTimestamp);
                if (e) enteredAt[key] = { year: e.year, month: e.month, day: e.day, hour: e.hour };
            }
        }
        const keepUnknown = (old, target) => {
            for (const k of Object.keys(old || {})) {
                const last = k.split('|').pop();
                if (!known.has(last) && !(k in target)) target[k] = old[k];
            }
        };
        if (!state.flowNodeCompleted) state.flowNodeCompleted = {};
        if (!state.flowNodeCompletedAt) state.flowNodeCompletedAt = {};
        if (!state.flowNodeEnteredAt) state.flowNodeEnteredAt = {};
        keepUnknown(state.flowNodeCompleted[rootId], completedMap);
        keepUnknown(state.flowNodeCompletedAt[rootId], completedAt);
        keepUnknown(state.flowNodeEnteredAt[rootId], enteredAt);
        state.flowNodeCompleted[rootId] = completedMap;
        state.flowNodeCompletedAt[rootId] = completedAt;
        state.flowNodeEnteredAt[rootId] = { ...(state.flowNodeEnteredAt[rootId] || {}), ...enteredAt };

        const paths = [];
        const mainCur = ms.currentModulesByFlow.get('main');
        const mainPath = (mainCur && mainCur.id !== rootId) ? this.stripRoot(ms.getPathToModule(mainCur.id), rootId) : [];
        paths.push(mainPath);
        for (const [flow, m] of ms.currentModulesByFlow) {
            if (flow === 'main' || !m || m.state === 'untriggered' || !m.isLeaf()) continue;
            paths.push(this.stripRoot(ms.getPathToModule(m.id), rootId));
        }
        state.currentModulePath = (paths.length === 1 && paths[0].length === 0) ? [] : paths;

        if (!state.deliveryCompleted) state.deliveryCompleted = {};
        const done = { ...(state.deliveryCompleted[rootId] || {}) };
        for (const m of ms.modules.values()) {
            for (const d of (m.deliveryInfo || [])) {
                const key = d.title || d.id;
                if (!key) continue;
                if (d.completed) done[key] = true; else delete done[key];
            }
        }
        state.deliveryCompleted[rootId] = done;

        if (engine.summarySystem) state.summaries = engine.summarySystem.exportState();
    }
};

if (typeof window !== 'undefined') window.RuntimeBridge = RuntimeBridge;
if (typeof module !== 'undefined' && module.exports) module.exports = { RuntimeBridge };
