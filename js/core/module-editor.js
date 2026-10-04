/**
 * 模组编辑模型：所有编辑都落在配置（与 module.json 同格式的纯数据）上，再整体交给 ModuleSystem.replaceConfig 生效。
 * 因此编辑结果、撤销重做、导出文件、覆盖原文件用的是同一份数据，且保留当前进度（模块状态、变量值）。
 * 不依赖界面；界面只调用这里的方法并展示 EditError.message。
 */
class EditError extends Error {
    constructor(message) {
        super(message);
        this.name = 'EditError';
    }
}

const EDIT_TYPES = ['trigger_chain', 'timeline', 'free_trigger'];
const EDIT_TYPE_NAMES = { trigger_chain: I18n.t('触发器链'), timeline: I18n.t('时间线'), free_trigger: I18n.t('自由触发器') };

class ModuleEditor {
    /** 队列显示的默认值（与提示词生成一致：之后路线 3 个，已完成 0 个） */
    static get QUEUE_DEFAULT() { return { before: 0, after: 3 }; }

    /**
     * @param {ModuleSystem} moduleSystem
     * @param {VariableSystem} [variableSystem]
     */
    constructor(moduleSystem, variableSystem) {
        this.ms = moduleSystem;
        this.vs = variableSystem || moduleSystem.variableSystem || null;
        this.maxHistory = 100;
        this.resetBaseline();
    }

    // ---- 基线、历史、脏标记 ----

    /** 把当前配置记为「已保存的版本」，清空撤销重做 */
    resetBaseline() {
        this.version = (this.version || 0) + 1;
        this.baseline = this.ms.exportConfig();
        this.baselineJson = JSON.stringify(this.baseline);
        this.past = [];
        this.future = [];
    }

    getConfig() {
        return this.ms.exportConfig();
    }

    /** 与基线相比是否有未保存的改动（撤销回基线内容后为 false） */
    isDirty() {
        return JSON.stringify(this.ms.exportConfig()) !== this.baselineJson;
    }

    /** 撤销栈里的步数 */
    get undoCount() { return this.past.length; }
    get redoCount() { return this.future.length; }

    /** 标记已保存（覆盖原文件成功后调用），之后的改动相对这个版本计算 */
    markSaved() {
        this.baseline = this.ms.exportConfig();
        this.baselineJson = JSON.stringify(this.baseline);
    }

    undo() {
        if (!this.past.length) return false;
        this.version++;
        const cur = this.ms.exportConfig();
        const prev = this.past.pop();
        this.future.push(cur);
        this.ms.replaceConfig(prev);
        return true;
    }

    redo() {
        if (!this.future.length) return false;
        this.version++;
        const cur = this.ms.exportConfig();
        const next = this.future.pop();
        this.past.push(cur);
        this.ms.replaceConfig(next);
        return true;
    }

    /** 回到基线版本；这一步本身可以撤销 */
    restoreBaseline() {
        this._push(this.ms.exportConfig());
        this.ms.replaceConfig(JSON.parse(this.baselineJson));
    }

    /** 当前配置里的问题（会导致流程失效的和需要留意的），每条带可读的中文说明 */
    problems() {
        return ModuleSystem.validateConfig(this.ms.exportConfig());
    }

    /** 在直接修改运行中的模块（不经本类的方法）之前调用，让这次修改可以撤销 */
    checkpoint() {
        this._push(this.ms.exportConfig());
    }

    /** 撤销栈每变化一次加一：界面据此判断「撤销」入口是否还对应最近的那次修改 */
    _push(snapshot) {
        this.version++;
        this.past.push(snapshot);
        if (this.past.length > this.maxHistory) this.past.shift();
        this.future = [];
    }

    /**
     * 对配置做一次修改：mutator 改的是副本；通过检查后整体生效并记入撤销栈。
     * mutator 抛出的 EditError 会原样抛给调用方，此时模组不变。
     */
    _apply(mutator) {
        const before = this.ms.exportConfig();
        const cfg = JSON.parse(JSON.stringify(before));
        const result = mutator(cfg);
        const check = ModuleSystem.validateConfig(cfg);
        if (check.errors.length) throw new EditError(check.errors[0].message);
        if (JSON.stringify(cfg) === JSON.stringify(before)) return result;
        this._push(before);
        this.ms.replaceConfig(cfg);
        return result;
    }

    // ---- 树查找与工具 ----

    static _find(cfg, id) {
        const walk = (node, parent, flow) => {
            if (node.id === id) return { node, parent, flow, list: parent ? parent.flows[flow].subModules : null };
            for (const fn of Object.keys(node.flows || {})) {
                const list = node.flows[fn].subModules || [];
                for (const c of list) {
                    const r = walk(c, node, fn);
                    if (r) return r;
                }
            }
            return null;
        };
        return walk(cfg, null, null);
    }

    static _all(cfg) {
        const out = [];
        const walk = (n) => {
            out.push(n);
            for (const fn of Object.keys(n.flows || {})) for (const c of (n.flows[fn].subModules || [])) walk(c);
        };
        walk(cfg);
        return out;
    }

    static _uid(cfg, prefix) {
        const used = new Set(ModuleEditor._all(cfg).map((n) => n.id));
        for (const n of ModuleEditor._all(cfg)) for (const v of (n.variables || [])) if (v && v.id) used.add(v.id);
        const stamp = Date.now().toString(36);
        let id;
        do { ModuleEditor._seq = (ModuleEditor._seq || 0) + 1; id = `${prefix}_${stamp}${ModuleEditor._seq}`; } while (used.has(id));
        return id;
    }

    static _need(cfg, id) {
        const r = ModuleEditor._find(cfg, id);
        if (!r) throw new EditError(I18n.t('没有找到这个事件，可能已被删除。'));
        return r;
    }

    static _uniqueName(cfg, base) {
        const names = new Set(ModuleEditor._all(cfg).map((n) => n.name));
        if (!names.has(base)) return base;
        let i = 2;
        while (names.has(`${base} ${i}`)) i++;
        return `${base} ${i}`;
    }

    /**
     * 同一父级同一流程里的触发器链按数组顺序重新写链接。
     * 只处理已经在用链接的组，或明确要求（force）的组；整组都没写链接的保持原样（按数组顺序执行）。
     */
    static _relink(list, force) {
        const chain = list.filter((n) => n.type === 'trigger_chain');
        const usesLinks = chain.some((n) => n.linkedList && (n.linkedList.prev != null || n.linkedList.next != null));
        if (!usesLinks && !(force && chain.length > 1)) {
            for (const n of list) if (n.type !== 'trigger_chain' && n.linkedList && (n.linkedList.prev != null || n.linkedList.next != null)) n.linkedList = { prev: null, next: null };
            return;
        }
        chain.forEach((n, i) => {
            n.linkedList = { prev: i > 0 ? chain[i - 1].id : null, next: i < chain.length - 1 ? chain[i + 1].id : null };
        });
        for (const n of list) if (n.type !== 'trigger_chain' && n.linkedList) delete n.linkedList;
    }

    /** 条件包装：只保留有内容的条件，没有内容返回 null */
    static _cleanWrapper(w) {
        let one = Array.isArray(w) ? w[0] : w;
        if (one && Array.isArray(one.groups) && !one.conditionDef) one = { type: 'precondition', conditionDef: one };
        if (!one || !one.conditionDef || !Array.isArray(one.conditionDef.groups)) return null;
        if (!one.conditionDef.groups.some((g) => g && Array.isArray(g.items) && g.items.length)) return null;
        return JSON.parse(JSON.stringify(one));
    }

    static _checkType(type) {
        if (!EDIT_TYPES.includes(type)) throw new EditError(I18n.t('事件类型不正确。'));
    }

    // ---- 新建 ----

    /** 一份全新的空模组配置 */
    static createBlank(name) {
        const n = String(name || '').trim();
        if (!n) throw new EditError(I18n.t('请先填写模组名称。'));
        return {
            id: `mod_${Date.now().toString(36)}`,
            name: n,
            version: '1.0.0',
            variables: [],
            flows: { main: { entryEvent: null, subModules: [] } }
        };
    }

    // ---- 事件 ----

    /**
     * 在父事件的某个流程末尾新建子事件。
     * @returns {string} 新事件的标识
     */
    addChild(parentId, flowName, { name, type } = {}) {
        ModuleEditor._checkType(type || 'trigger_chain');
        return this._apply((cfg) => {
            const { node: parent } = ModuleEditor._need(cfg, parentId);
            if (!parent.flows) parent.flows = {};
            const fn = flowName || 'main';
            if (!parent.flows[fn]) {
                if (fn !== 'main') throw new EditError(I18n.t('没有找到这个流程。'));
                parent.flows.main = { entryEvent: null, subModules: [] };
            }
            const list = parent.flows[fn].subModules;
            const id = ModuleEditor._uid(cfg, 'ev');
            const base = String(name || '').trim() || I18n.t('新事件');
            const node = { id, name: ModuleEditor._uniqueName(cfg, base), type: type || 'trigger_chain', info: [], entryConditions: [], completionConditions: [], variables: [], plugins: [], flows: { main: { entryEvent: null, subModules: [] } } };
            list.push(node);
            ModuleEditor._relink(list, node.type === 'trigger_chain');
            return id;
        });
    }

    rename(id, name) {
        const n = String(name == null ? '' : name).trim();
        if (!n) throw new EditError(I18n.t('名称不能为空。'));
        this._apply((cfg) => { ModuleEditor._need(cfg, id).node.name = n; });
    }

    setType(id, type) {
        ModuleEditor._checkType(type);
        this._apply((cfg) => {
            const r = ModuleEditor._need(cfg, id);
            if (!r.parent) throw new EditError(I18n.t('故事根没有类型。'));
            if (r.node.type === type) return;
            r.node.type = type;
            ModuleEditor._relink(r.list, type === 'trigger_chain');
        });
    }

    /** 背景文字：写进第一条背景，其余条目保留；清空则移除第一条 */
    setInfo(id, text) {
        this._apply((cfg) => {
            const { node } = ModuleEditor._need(cfg, id);
            const t = String(text == null ? '' : text);
            if (!Array.isArray(node.info)) node.info = [];
            if (node.info.length && node.info[0] && typeof node.info[0] === 'object') {
                if (t) node.info[0].content = t; else node.info.shift();
            } else if (t) node.info.unshift({ content: t, condition: null });
        });
    }

    /**
     * 背景条目整体替换。每条 { content, persistent, condition }：
     * persistent 为真时，这条背景在子事件进行中也会发给 AI；condition 满足时才发。
     */
    setInfoList(id, list) {
        this._apply((cfg) => {
            const { node } = ModuleEditor._need(cfg, id);
            const out = [];
            for (const raw of (Array.isArray(list) ? list : [])) {
                const content = String(raw && raw.content != null ? raw.content : '');
                if (!content.trim()) throw new EditError(I18n.t('背景内容不能为空。'));
                const item = { content, condition: ModuleEditor._cleanWrapper(raw.condition) };
                if (raw.persistent) item.persistent = true;
                out.push(item);
            }
            node.info = out;
        });
    }

    /** 提示词里「之后的路线」显示几个、「已完成」显示几个；两项都为 null 时恢复默认 */
    setQueueDisplay(id, { before = null, after = null } = {}) {
        const norm = (x, label) => {
            if (x == null || x === '') return null;
            const n = Number(x);
            if (!Number.isInteger(n) || n < 0 || n > 99) throw new EditError(I18n.t('{label}要填 0 到 99 之间的整数。', { label }));
            return n;
        };
        const b = norm(before, I18n.t('已完成事件的显示数量'));
        const a = norm(after, I18n.t('之后路线的显示数量'));
        this._apply((cfg) => {
            const { node } = ModuleEditor._need(cfg, id);
            if (b == null && a == null) { delete node.queueDisplay; return; }
            node.queueDisplay = { before: b == null ? ModuleEditor.QUEUE_DEFAULT.before : b, after: a == null ? ModuleEditor.QUEUE_DEFAULT.after : a };
        });
    }

    /** 模组自身的信息：版本号、说明（名称用 rename） */
    setModuleMeta(patch) {
        this._apply((cfg) => {
            for (const k of ['version', 'description']) {
                if (!patch || patch[k] === undefined) continue;
                const t = String(patch[k] == null ? '' : patch[k]);
                if (t.trim()) cfg[k] = t; else delete cfg[k];
            }
        });
    }

    /**
     * 时间系统：新游戏的起始时间、显示格式、进位单位。起始时间和单位的值为 null 表示不设置（用默认）。
     * 当前正在玩的存档不受影响。
     */
    setTimeConfig({ initialValues, displayFormat, units } = {}) {
        const INT_KEYS = ['year', 'month', 'day', 'hour', 'minute'];
        const LABEL = { year: I18n.t('年'), month: I18n.t('月'), day: I18n.t('日'), hour: I18n.t('时'), minute: I18n.t('分') };
        const UNIT_KEYS = [['minutesPerHour', I18n.t('每小时的分钟数')], ['hoursPerDay', I18n.t('每天的小时数')], ['daysPerMonth', I18n.t('每月的天数')], ['monthsPerYear', I18n.t('每年的月数')]];
        const iv = {};
        if (initialValues) {
            for (const k of INT_KEYS) {
                const x = initialValues[k];
                if (x == null || x === '') continue;
                const n = Number(x);
                if (!Number.isInteger(n) || n < 0 || n > 999999) throw new EditError(I18n.t('起始时间的{unit}要填非负整数。', { unit: LABEL[k] }));
                iv[k] = n;
            }
        }
        const un = {};
        if (units) {
            for (const [k, label] of UNIT_KEYS) {
                const x = units[k];
                if (x == null || x === '') continue;
                const n = Number(x);
                if (!Number.isInteger(n) || n < 1 || n > 9999) throw new EditError(I18n.t('{label}要填 1 以上的整数。', { label }));
                un[k] = n;
            }
        }
        this._apply((cfg) => {
            if (initialValues) {
                const ts = cfg.timeSystem && typeof cfg.timeSystem === 'object' ? cfg.timeSystem : (Object.keys(iv).length ? (cfg.timeSystem = {}) : null);
                if (ts) {
                    const keep = Object.assign({}, ts.initialValues || {});
                    for (const k of INT_KEYS) delete keep[k];
                    const merged = Object.assign(keep, iv);
                    if (Object.keys(merged).length) ts.initialValues = merged; else delete ts.initialValues;
                }
            }
            if (displayFormat !== undefined) {
                const f = String(displayFormat == null ? '' : displayFormat);
                if (f.trim()) {
                    const ts = cfg.timeSystem && typeof cfg.timeSystem === 'object' ? cfg.timeSystem : (cfg.timeSystem = {});
                    ts.displayFormat = f;
                } else if (cfg.timeSystem && typeof cfg.timeSystem === 'object') delete cfg.timeSystem.displayFormat;
            }
            if (units) {
                if (Object.keys(un).length) cfg.timeUnits = un; else delete cfg.timeUnits;
            }
        });
    }

    /**
     * 进入这个事件时强制设置的变量。list 的每项 { variableId, value }；只能选数值、文字、开关三种变量，
     * 值要符合变量类型和取值范围，同一个变量只能出现一次。列表为空时去掉这项设置。
     */
    setVariableSetOnEnter(id, list) {
        this._apply((cfg) => {
            const { node } = ModuleEditor._need(cfg, id);
            const defs = new Map();
            for (const n of ModuleEditor._all(cfg)) for (const v of (n.variables || [])) if (v && v.id) defs.set(v.id, v);
            const map = {};
            for (const r of (Array.isArray(list) ? list : [])) {
                if (!r || !r.variableId) throw new EditError(I18n.t('请先选择变量。'));
                const def = defs.get(r.variableId);
                if (!def) throw new EditError(I18n.t('选择的变量已经不存在。'));
                const name = def.name || I18n.t('未命名变量');
                if (Object.prototype.hasOwnProperty.call(map, r.variableId)) throw new EditError(I18n.t('变量「{name}」重复了。', { name }));
                let value = r.value;
                if (def.type === 'number') {
                    value = (typeof value === 'number') ? value : (value === '' || value == null ? NaN : Number(value));
                    if (!Number.isFinite(value)) throw new EditError(I18n.t('变量「{name}」的值要填数字。', { name }));
                    if ((def.min != null && value < def.min) || (def.max != null && value > def.max)) {
                        throw new EditError(I18n.t('变量「{name}」的值要在 {min} 到 {max} 之间。', { name, min: def.min != null ? def.min : I18n.t('不限'), max: def.max != null ? def.max : I18n.t('不限') }));
                    }
                } else if (def.type === 'boolean') {
                    value = value === true || value === 'true';
                } else if (def.type === 'string') {
                    value = value == null ? '' : String(value);
                    if (def.maxLength != null && value.length > def.maxLength) throw new EditError(I18n.t('变量「{name}」最多 {n} 个字。', { name, n: def.maxLength }));
                } else {
                    throw new EditError(I18n.t('变量「{name}」是{kind}，不能在这里设置。', { name, kind: def.type === 'list' || def.type === 'list_of_object' ? I18n.t('列表') : I18n.t('对象') }));
                }
                map[r.variableId] = value;
            }
            if (Object.keys(map).length) node.variableSetOnEnter = map; else delete node.variableSetOnEnter;
        });
    }

    /** 时间线的排序值：越小越先；null 表示不设置 */
    setTriggerTime(id, value) {
        let n = null;
        if (value !== null && value !== undefined && value !== '') {
            n = Number(value);
            if (!Number.isInteger(n) || n < 0 || n > 99999999999) throw new EditError(I18n.t('排序值要填非负整数。'));
        }
        this._apply((cfg) => {
            const { node } = ModuleEditor._need(cfg, id);
            if (n === null) delete node.triggerTime; else node.triggerTime = n;
        });
    }

    setNote(id, text) {
        this._apply((cfg) => {
            const { node } = ModuleEditor._need(cfg, id);
            const t = String(text == null ? '' : text);
            if (t) node.note = t; else delete node.note;
        });
    }

    setTags(id, tags) {
        this._apply((cfg) => {
            const { node } = ModuleEditor._need(cfg, id);
            const list = Array.from(new Set((Array.isArray(tags) ? tags : []).map((x) => String(x).trim()).filter(Boolean)));
            if (list.length || node.tags) node.tags = list;
        });
    }

    /** 删除事件及其全部子孙；清理指向它们的流程前置事件和链接。返回被删的标识 */
    deleteNode(id) {
        return this._apply((cfg) => {
            const r = ModuleEditor._need(cfg, id);
            if (!r.parent) throw new EditError(I18n.t('故事根不能删除。'));
            const gone = new Set(ModuleEditor._all(r.node).map((n) => n.id));
            r.list.splice(r.list.indexOf(r.node), 1);
            ModuleEditor._relink(r.list, false);
            for (const n of ModuleEditor._all(cfg)) {
                for (const fn of Object.keys(n.flows || {})) {
                    if (gone.has(n.flows[fn].entryEvent)) n.flows[fn].entryEvent = null;
                }
                if (n.linkedList) {
                    if (gone.has(n.linkedList.prev)) n.linkedList.prev = null;
                    if (gone.has(n.linkedList.next)) n.linkedList.next = null;
                }
            }
            return Array.from(gone);
        });
    }

    /** 在同一父级同一流程、同一类型的兄弟之间上移或下移一位 */
    moveNode(id, dir) {
        this._apply((cfg) => {
            const r = ModuleEditor._need(cfg, id);
            if (!r.parent) throw new EditError(I18n.t('故事根不能移动。'));
            const peers = r.list.filter((n) => n.type === r.node.type);
            const i = peers.indexOf(r.node);
            const j = dir === 'up' ? i - 1 : i + 1;
            if (j < 0 || j >= peers.length) return;
            const a = r.list.indexOf(r.node);
            const b = r.list.indexOf(peers[j]);
            [r.list[a], r.list[b]] = [r.list[b], r.list[a]];
            ModuleEditor._relink(r.list, r.node.type === 'trigger_chain');
        });
    }

    /** 把事件（含子孙）移到另一个父事件的某个流程末尾 */
    moveTo(id, newParentId, newFlow) {
        this._apply((cfg) => {
            const r = ModuleEditor._need(cfg, id);
            if (!r.parent) throw new EditError(I18n.t('故事根不能移动。'));
            const np = ModuleEditor._need(cfg, newParentId);
            if (ModuleEditor._all(r.node).some((n) => n.id === newParentId)) throw new EditError(I18n.t('不能移到它自己的内部。'));
            const fn = newFlow || 'main';
            if (!np.node.flows) np.node.flows = {};
            if (!np.node.flows[fn]) {
                if (fn !== 'main') throw new EditError(I18n.t('没有找到这个流程。'));
                np.node.flows.main = { entryEvent: null, subModules: [] };
            }
            r.list.splice(r.list.indexOf(r.node), 1);
            ModuleEditor._relink(r.list, false);
            if (r.node.linkedList) r.node.linkedList = { prev: null, next: null };
            np.node.flows[fn].subModules.push(r.node);
            ModuleEditor._relink(np.node.flows[fn].subModules, r.node.type === 'trigger_chain');
        });
    }

    /** 复制事件（含子孙）到某个父事件的某个流程末尾，全部换新标识；返回新根的标识 */
    duplicate(id, targetParentId, targetFlow) {
        return this._apply((cfg) => {
            const r = ModuleEditor._need(cfg, id);
            if (!r.parent) throw new EditError(I18n.t('故事根不能复制。'));
            const tp = ModuleEditor._need(cfg, targetParentId == null ? r.parent.id : targetParentId);
            const fn = targetFlow || r.flow;
            if (!tp.node.flows) tp.node.flows = {};
            if (!tp.node.flows[fn]) tp.node.flows[fn] = { entryEvent: null, subModules: [] };
            const copy = JSON.parse(JSON.stringify(r.node));
            const map = new Map();
            let k = 0;
            for (const n of ModuleEditor._all(copy)) map.set(n.id, `${ModuleEditor._uid(cfg, 'ev')}${k++}`);
            for (const n of ModuleEditor._all(copy)) {
                n.id = map.get(n.id);
                if (n.linkedList) {
                    n.linkedList = { prev: map.get(n.linkedList.prev) || null, next: map.get(n.linkedList.next) || null };
                }
            }
            copy.name = ModuleEditor._uniqueName(cfg, I18n.t('{name} 副本', { name: r.node.name }));
            if (copy.linkedList) copy.linkedList = { prev: null, next: null };
            tp.node.flows[fn].subModules.push(copy);
            ModuleEditor._relink(tp.node.flows[fn].subModules, copy.type === 'trigger_chain');
            return copy.id;
        });
    }

    // ---- 流程 ----

    /** 新建分流程，名称是显示用的文字，标识自动分配；返回流程的键 */
    addFlow(parentId, name) {
        const n = String(name == null ? '' : name).trim();
        if (!n) throw new EditError(I18n.t('分流程名称不能为空。'));
        return this._apply((cfg) => {
            const { node } = ModuleEditor._need(cfg, parentId);
            if (!node.flows) node.flows = {};
            for (const k of Object.keys(node.flows)) {
                if ((node.flows[k].name || k) === n) throw new EditError(I18n.t('已经有同名的流程。'));
            }
            const key = ModuleEditor._uid(cfg, 'flow');
            node.flows[key] = { entryEvent: null, name: n, subModules: [] };
            return key;
        });
    }

    renameFlow(parentId, flowKey, name) {
        const n = String(name == null ? '' : name).trim();
        if (!n) throw new EditError(I18n.t('流程名称不能为空。'));
        this._apply((cfg) => {
            const { node } = ModuleEditor._need(cfg, parentId);
            if (!node.flows || !node.flows[flowKey]) throw new EditError(I18n.t('没有找到这个流程。'));
            if (flowKey === 'main') throw new EditError(I18n.t('主流程不能改名。'));
            for (const k of Object.keys(node.flows)) if (k !== flowKey && (node.flows[k].name || k) === n) throw new EditError(I18n.t('已经有同名的流程。'));
            node.flows[flowKey].name = n;
        });
    }

    deleteFlow(parentId, flowKey) {
        if (flowKey === 'main') throw new EditError(I18n.t('主流程不能删除。'));
        return this._apply((cfg) => {
            const { node } = ModuleEditor._need(cfg, parentId);
            if (!node.flows || !node.flows[flowKey]) throw new EditError(I18n.t('没有找到这个流程。'));
            const gone = new Set();
            for (const c of node.flows[flowKey].subModules || []) for (const n of ModuleEditor._all(c)) gone.add(n.id);
            delete node.flows[flowKey];
            for (const n of ModuleEditor._all(cfg)) {
                for (const fn of Object.keys(n.flows || {})) if (gone.has(n.flows[fn].entryEvent)) n.flows[fn].entryEvent = null;
            }
            return Array.from(gone);
        });
    }

    /** 流程前置事件：完成它之后才能进入这个流程；null 表示没有 */
    setFlowEntryEvent(parentId, flowKey, moduleId) {
        this._apply((cfg) => {
            const { node } = ModuleEditor._need(cfg, parentId);
            if (!node.flows || !node.flows[flowKey]) throw new EditError(I18n.t('没有找到这个流程。'));
            if (moduleId != null && !ModuleEditor._find(cfg, moduleId)) throw new EditError(I18n.t('没有找到这个事件。'));
            node.flows[flowKey].entryEvent = moduleId == null ? null : moduleId;
        });
    }

    // ---- 条件 ----

    /**
     * @param {'entry'|'completion'} kind
     * @param {Array|Object|null} wrappers  条件包装对象数组；条件为空时清除
     */
    setConditions(id, kind, wrappers) {
        this._apply((cfg) => {
            const { node } = ModuleEditor._need(cfg, id);
            const key = kind === 'entry' ? 'entryConditions' : 'completionConditions';
            const list = (Array.isArray(wrappers) ? wrappers : (wrappers ? [wrappers] : []))
                .filter((w) => w && w.conditionDef && Array.isArray(w.conditionDef.groups) && w.conditionDef.groups.some((g) => g && Array.isArray(g.items) && g.items.length));
            node[key] = JSON.parse(JSON.stringify(list));
        });
    }

    // ---- 变量 ----

    /**
     * 整体替换某个事件注册的变量。新增的变量自动分配标识；名称不能为空、不能重复；初始值按类型收拢。
     * 初始值或类型被改动的变量，当前值同步为新的初始值；其余变量保留当前值。
     * @returns {Array} 写入后的变量定义
     */
    setVariables(id, defs) {
        const before = this.ms.exportConfig();
        const out = this._apply((cfg) => {
            const { node } = ModuleEditor._need(cfg, id);
            const others = new Map();
            for (const n of ModuleEditor._all(cfg)) {
                if (n.id === id) continue;
                for (const v of (n.variables || [])) if (v && v.id) others.set(v.id, n);
            }
            const names = new Set();
            const result = [];
            const existing = new Map((node.variables || []).filter((x) => x && x.id).map((x) => [x.id, JSON.stringify(x)]));
            for (const raw of (Array.isArray(defs) ? defs : [])) {
                const same = raw && raw.id && existing.get(raw.id) === JSON.stringify(raw);
                const v = same ? JSON.parse(JSON.stringify(raw)) : ModuleEditor.normalizeVariable(raw);
                if (!v.name) throw new EditError(I18n.t('变量名称不能为空。'));
                if (names.has(v.name)) throw new EditError(I18n.t('变量名称「{name}」重复了。', { name: v.name }));
                names.add(v.name);
                if (!v.id) v.id = ModuleEditor._uid(cfg, 'var');
                if (others.has(v.id) || result.some((x) => x.id === v.id)) throw new EditError(I18n.t('变量「{name}」与其他变量冲突。', { name: v.name }));
                result.push(v);
            }
            for (const [vid, owner] of others) {
                const ov = (owner.variables || []).find((x) => x.id === vid);
                if (ov && names.has(ov.name)) throw new EditError(I18n.t('变量名称「{name}」已被「{owner}」使用。', { name: ov.name, owner: owner.name || I18n.t('其他事件') }));
            }
            node.variables = result;
            return result;
        });
        const old = new Map();
        const collect = (cfg) => { for (const n of ModuleEditor._all(cfg)) for (const v of (n.variables || [])) if (v && v.id) old.set(v.id, v); };
        collect(before);
        if (this.vs) {
            for (const v of out) {
                const o = old.get(v.id);
                if (o && (o.type !== v.type || JSON.stringify(o.initialValue) !== JSON.stringify(v.initialValue))) {
                    const live = this.vs.getVariable(v.id);
                    if (live) live.value = live.cloneValue(live.initialValue);
                }
            }
            if (typeof this.vs.updateBuiltinVariables === 'function') this.vs.updateBuiltinVariables();
        }
        return out;
    }

    static get VAR_TYPES() { return ['number', 'string', 'boolean', 'list', 'object', 'list_of_object']; }
    static get VAR_CATEGORIES() { return ['module', 'switch', 'builtin', 'temp']; }

    /** 把界面里的变量行整理成合法的变量定义：类型合法、初始值符合类型、只保留该类型用得到的设置 */
    static normalizeVariable(raw) {
        const r = raw || {};
        const type = ModuleEditor.VAR_TYPES.includes(r.type) ? r.type : 'string';
        const v = Object.assign({}, r);
        v.type = type;
        v.name = String(r.name == null ? '' : r.name).trim();
        v.category = ModuleEditor.VAR_CATEGORIES.includes(r.category) ? r.category : 'module';
        let iv = r.initialValue;
        switch (type) {
            case 'number': iv = (typeof iv === 'number' && Number.isFinite(iv)) ? iv : (Number.isFinite(Number(iv)) && iv !== '' && iv != null ? Number(iv) : 0); break;
            case 'boolean': iv = iv === true || iv === 'true'; break;
            case 'string': iv = iv == null ? '' : String(iv); break;
            case 'list': case 'list_of_object': iv = Array.isArray(iv) ? iv : []; break;
            case 'object': iv = (iv && typeof iv === 'object' && !Array.isArray(iv)) ? iv : {}; break;
            default: break;
        }
        v.initialValue = iv;
        for (const k of ['min', 'max', 'maxLength']) {
            if (type === (k === 'maxLength' ? 'string' : 'number') && r[k] !== '' && r[k] != null && Number.isFinite(Number(r[k]))) v[k] = Number(r[k]);
            else delete v[k];
        }
        if (type === 'number' && v.min != null && v.max != null && v.min > v.max) throw new EditError(I18n.t('变量「{name}」的最小值不能大于最大值。', { name: v.name || I18n.t('未命名') }));
        if (type === 'list') {
            v.elementType = r.elementType || r.listItemType || 'string';
            if (v.elementType === 'object') v.listItemType = 'object'; else delete v.listItemType;
        } else {
            delete v.elementType;
            delete v.listItemType;
        }
        if (type === 'object' || type === 'list_of_object' || (type === 'list' && v.elementType === 'object')) {
            const seen = new Set();
            const fields = (Array.isArray(r.fields) ? r.fields : []).map((f) => ({ name: String(f && f.name != null ? f.name : '').trim(), type: ['number', 'string', 'boolean'].includes(f && f.type) ? f.type : 'string', default: f && f.default !== undefined ? f.default : '' }))
                .filter((f) => f.name && !seen.has(f.name) && seen.add(f.name));
            if (fields.length || Array.isArray(r.fields)) v.fields = fields; else delete v.fields;
        } else delete v.fields;
        const gr = String(r.generalRules == null ? '' : r.generalRules);
        if (gr.trim()) v.generalRules = gr; else delete v.generalRules;
        if (r.readonly === true) v.readonly = true; else delete v.readonly;
        v.changeRules = ModuleEditor.normalizeRules(r.changeRules, v);
        if (!v.changeRules.length) delete v.changeRules;
        v.computeConditions = ModuleEditor.normalizeCompute(r.computeConditions, v);
        if (!v.computeConditions.length) delete v.computeConditions;
        v.switchConditions = ModuleEditor.normalizeSwitch(r.switchConditions);
        if (!v.switchConditions.length) delete v.switchConditions;
        delete v._ivRaw;
        return v;
    }

    // ---- 变量的快捷规则（AI 用 <rule|变量|规则名> 触发）----

    static get RULE_OPS() {
        return {
            number: [['add', I18n.t('增加')], ['subtract', I18n.t('减少')], ['set', I18n.t('设为')], ['multiply', I18n.t('乘以')], ['divide', I18n.t('除以')]],
            string: [['set', I18n.t('设为')]],
            boolean: [['set', I18n.t('设为')]]
        };
    }

    /**
     * 把一条规则拆成 { operation, value }，供界面编辑。
     * 支持 { operation, value }，以及 "+10" "-5" "*2" "/2" "set 100" 100 这类简写。
     * 带参数（$）、对象取值的规则返回 null：界面保持原样，不改写。
     */
    static ruleParts(rule, varType) {
        if (!rule || typeof rule !== 'object') return null;
        for (const k of Object.keys(rule)) if (!['name', 'operation', 'value'].includes(k)) return null;
        const ok = (op, value) => ((typeof value === 'string' && /\$/.test(value)) ? null : { operation: op, value });
        if (rule.operation) {
            if (rule.value !== undefined && !['number', 'string', 'boolean'].includes(typeof rule.value)) return null;
            return ok(rule.operation, rule.value === undefined ? '' : rule.value);
        }
        const raw = rule.value;
        if (typeof raw === 'number' || typeof raw === 'boolean') return { operation: 'set', value: raw };
        if (typeof raw !== 'string') return null;
        if (varType !== 'number') return ok('set', raw);
        const s = raw.trim();
        let m;
        const num = (t) => { const n = Number(t); return t !== '' && Number.isFinite(n) ? n : null; };
        const op = (name, t) => { const n = num(t); return n == null ? null : { operation: name, value: n }; };
        if ((m = s.match(/^\+\s*(.+)$/))) return op('add', m[1]);
        if ((m = s.match(/^[-－]\s*(.+)$/))) return op('subtract', m[1]);
        if ((m = s.match(/^[*×]\s*(.+)$/))) return op('multiply', m[1]);
        if ((m = s.match(/^[/÷]\s*(.+)$/))) return op('divide', m[1]);
        if ((m = s.match(/^set\s+(.+)$/i))) return op('set', m[1]);
        return op('set', s);
    }

    /** 规则整理：名称不能为空、不能重复；数值变量的取值必须是数字 */
    static normalizeRules(list, v) {
        const out = [];
        const names = new Set();
        const who = v.name || I18n.t('未命名');
        for (const raw of (Array.isArray(list) ? list : [])) {
            if (!raw || typeof raw !== 'object') continue;
            const name = String(raw.name == null ? '' : raw.name).trim();
            if (!name) throw new EditError(I18n.t('变量「{who}」有一条规则没有名称。', { who }));
            if (names.has(name)) throw new EditError(I18n.t('变量「{who}」里有两条规则都叫「{name}」。', { who, name }));
            names.add(name);
            const rule = Object.assign({}, raw, { name });
            const parts = ModuleEditor.ruleParts(raw, v.type);
            if (parts && v.type === 'number') {
                if (typeof parts.value !== 'number' || !Number.isFinite(parts.value)) throw new EditError(I18n.t('规则「{name}」的数值要填数字。', { name }));
                if (parts.operation === 'divide' && parts.value === 0) throw new EditError(I18n.t('规则「{name}」不能除以 0。', { name }));
            }
            out.push(rule);
        }
        return out;
    }

    // ---- 自动计算（按顺序，第一条条件满足的生效）----

    /** 公式里的 {{变量编号}} 换成 {{变量名}} 供人读 */
    static formulaToDisplay(formula, vars) {
        const byId = new Map((vars || []).map((x) => [x.id, x.name]));
        return String(formula == null ? '' : formula).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, id) => `{{${byId.get(id) || id}}}`);
    }

    /** 反向：{{变量名}} 换回 {{变量编号}}；名字找不到时报错 */
    static formulaFromDisplay(text, vars) {
        const byName = new Map((vars || []).map((x) => [x.name, x.id]));
        const byId = new Set((vars || []).map((x) => x.id));
        return String(text == null ? '' : text).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, name) => {
            if (byName.has(name)) return `{{${byName.get(name)}}}`;
            if (byId.has(name)) return `{{${name}}}`;
            throw new EditError(I18n.t('公式里的变量「{name}」不存在。', { name }));
        });
    }

    /** 公式是不是单纯的一个常量：返回 { kind, value }，否则 null */
    static formulaLiteral(formula) {
        const s = String(formula == null ? '' : formula).trim();
        let m;
        if ((m = s.match(/^'((?:[^'\\]|\\.)*)'$/)) || (m = s.match(/^"((?:[^"\\]|\\.)*)"$/))) return { kind: 'string', value: m[1].replace(/\\(.)/g, '$1') };
        if (/^-?\d+(\.\d+)?$/.test(s)) return { kind: 'number', value: Number(s) };
        if (s === 'true' || s === 'false') return { kind: 'boolean', value: s === 'true' };
        return null;
    }

    static formulaFromLiteral(kind, value) {
        if (kind === 'string') return `'${String(value == null ? '' : value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
        if (kind === 'boolean') return (value === true || value === 'true') ? 'true' : 'false';
        return String(Number(value));
    }

    static normalizeCompute(list, v) {
        const out = [];
        for (const raw of (Array.isArray(list) ? list : [])) {
            if (!raw || typeof raw !== 'object') continue;
            const formula = String(raw.formula == null ? '' : raw.formula).trim();
            if (!formula) throw new EditError(I18n.t('变量「{name}」有一条自动计算没有填结果。', { name: v.name || I18n.t('未命名') }));
            if (typeof FormulaEvaluator !== 'undefined') {
                try { FormulaEvaluator.evaluate(formula, () => 0); }
                catch (e) { throw new EditError(I18n.t('变量「{name}」的计算公式有误：{msg}', { name: v.name || I18n.t('未命名'), msg: e.message })); }
            }
            out.push(Object.assign({}, raw, { formula, conditionDef: raw.conditionDef && Array.isArray(raw.conditionDef.groups) ? raw.conditionDef : { logic: 'OR', groups: [] } }));
        }
        return out;
    }

    // ---- 按条件开放 ----

    static normalizeSwitch(list) {
        const out = [];
        for (const raw of (Array.isArray(list) ? list : [])) {
            if (!raw || typeof raw !== 'object') continue;
            out.push(Object.assign({}, raw, {
                type: raw.type === 'trigger' ? 'trigger' : 'display',
                action: raw.action === 'close' ? 'close' : 'open',
                condition: raw.condition && Array.isArray(raw.condition.groups) ? raw.condition : { logic: 'OR', groups: [] }
            }));
        }
        return out;
    }

    // ---- 投递 ----

    setDeliveries(id, list) {
        this._apply((cfg) => {
            const { node } = ModuleEditor._need(cfg, id);
            const titles = new Set();
            const out = [];
            for (const d of (Array.isArray(list) ? list : [])) {
                const title = String(d && d.title != null ? d.title : '').trim();
                if (!title) throw new EditError(I18n.t('投递标题不能为空。'));
                if (titles.has(title)) throw new EditError(I18n.t('投递标题「{title}」重复了。', { title }));
                titles.add(title);
                const item = { title, content: String(d.content == null ? '' : d.content), condition: ModuleEditor._cleanWrapper(d.condition) };
                if (d.completed !== undefined) item.completed = !!d.completed;
                out.push(item);
            }
            node.deliveryInfo = out;
        });
    }
}

if (typeof window !== 'undefined') {
    window.ModuleEditor = ModuleEditor;
    window.EditError = EditError;
    window.EDIT_TYPES = EDIT_TYPES;
    window.EDIT_TYPE_NAMES = EDIT_TYPE_NAMES;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ModuleEditor, EditError, EDIT_TYPES, EDIT_TYPE_NAMES };
}
