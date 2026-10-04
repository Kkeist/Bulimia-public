/**
 * 提示词生成器：按「背景 / 交互器 / 变量 / 队列 / 投递 / 指令 / 进程信息」七段生成发给 AI 的模组提示词。
 * 每段都用 ```块名 包起来。名字一律用中文显示名，不出现内部 id。
 * 真实游戏经 RuntimeBridge 装好核心系统后调用；调试桥也用同一个类。
 */

/** 变量类型在提示词里的写法（给 AI 看，用它认得的类型名）。 */
const PROMPT_TYPE_NAMES = { number: 'number', string: 'string', boolean: 'bool', bool: 'bool', list: 'list', list_of_object: 'list<object>', object: 'object', switch: 'bool' };

class PromptGenerator {
    constructor() {
        this.timeSystem = null;
        this.variableSystem = null;
        this.moduleSystem = null;
        this.summarySystem = null;
        this.pluginSystem = null;
        this.tagParser = null;
        // 本回合发给 AI 的可操作范围（闭菜单）：段落生成时累积，标签解析按它校验。
        this.lastVisibleModuleIds = new Set();
        this.lastVisibleVariableIds = new Set();
        // 本回合队列段里标了「可完成」的事件
        this.lastCompletableModuleIds = new Set();
        // 本回合投递段里发出的条件化投递（伏笔）标题；发送成功后调用方据此记录提醒回合
        this.lastShownConditionalTitles = [];
        this.lastInteractorCount = 0;
        // 上一轮没生效的操作（调用方从存档里取来放进去，生成提示词不会清它）
        this.failedOps = [];
        // 当前回合序号（伏笔「隔几轮再提醒」、总结判断哪些回合已滑出对话窗口用）
        this.turn = null;
        this.windowTurns = null;
    }

    setTagParser(tagParser) { this.tagParser = tagParser; }
    setTimeSystem(timeSystem) { this.timeSystem = timeSystem; }
    setVariableSystem(variableSystem) { this.variableSystem = variableSystem; }
    setModuleSystem(moduleSystem) { this.moduleSystem = moduleSystem; }
    setSummarySystem(summarySystem) { this.summarySystem = summarySystem; }
    setPluginSystem(pluginSystem) { this.pluginSystem = pluginSystem; }

    // ==========================================
    // 总入口
    // ==========================================

    /**
     * 生成完整提示词（各段用空行连起来）。
     * @param {string} currentModuleId - 主流程当前所在的事件
     * @param {object} [options] - writingGuideSegment：插在指令段和进程信息之间的写作指导
     */
    generatePrompt(currentModuleId, options = {}) {
        return this.generateSegments(currentModuleId, options).map(s => s.text).join('\n\n');
    }

    /**
     * 按段返回：[{ id, text }]，id 为 background / interactors / variables / queue / delivery / progress / operations / module_summary / global_summary。
     * 空段不返回。
     */
    generateSegments(currentModuleId, options = {}) {
        const out = [];
        const add = (id, text) => { if (text) out.push({ id, text }); };
        add('background', this.generateBackground(currentModuleId));
        add('interactors', this.generateInteractors(currentModuleId));
        add('variables', this.generateVariables(currentModuleId));
        add('queue', this.generateModuleQueue(currentModuleId));
        add('delivery', this.generateDeliveryInfo(currentModuleId));
        add('progress', this.generateExpectedProgress());
        if (options.writingGuideSegment) add('writing_guide', options.writingGuideSegment);
        for (const seg of this.generateProcessSegments(currentModuleId)) add(seg.id, seg.text);
        return out;
    }

    // ==========================================
    // 工具
    // ==========================================

    /** 所有当前所在的叶事件（主流程在前）；还没进入具体事件时为空。 */
    _currentLeafIds(currentModuleId) {
        const ms = this.moduleSystem;
        if (!ms) return [];
        const ids = (typeof ms.getCurrentModuleIds === 'function' ? ms.getCurrentModuleIds() : [])
            .filter(id => id !== ms.rootModuleId && ms.getModule(id) && ms.getModule(id).isLeaf() && ms.getModule(id).state === 'entered');
        if (currentModuleId && !ids.includes(currentModuleId)) {
            const m = ms.getModule(currentModuleId);
            if (m && m.isLeaf() && currentModuleId !== ms.rootModuleId) return [currentModuleId];
            return [];
        }
        return ids;
    }

    _name(id) {
        const m = this.moduleSystem && this.moduleSystem.getModule(id);
        return m ? (m.name || m.id) : id;
    }

    formatTimeLine() {
        const ts = this.timeSystem;
        if (!ts) return '';
        let s = ts.getDisplayTime();
        const sv = ts.systemValues || {};
        const fmt = ts.displayFormat || '';
        const pad = (n) => String(n || 0).padStart(2, '0');
        if (!/\{\{\s*hour\s*\}\}/.test(fmt) && (sv.hour || sv.minute)) s += ' ' + pad(sv.hour) + ':' + pad(sv.minute);
        return s;
    }

    // ==========================================
    // 段1 背景
    // ==========================================

    generateBackground(currentModuleId) {
        const ms = this.moduleSystem;
        let prompt = '```background\n';
        if (this.timeSystem) {
            prompt += I18n.t('当前时间：{time}', { time: this.formatTimeLine() }) + '\n';
            if (typeof this.timeSystem.getLastTimeChange === 'function') {
                const change = this.timeSystem.getLastTimeChange();
                if (change) prompt += I18n.t('（时间已推进：{change}）', { change }) + '\n';
            }
        }

        if (ms) {
            const leafIds = this._currentLeafIds(currentModuleId);
            if (leafIds.length === 0) {
                const root = currentModuleId ? ms.getModule(currentModuleId) : null;
                const name = root ? (root.name || root.id) : (ms.rootModule ? ms.rootModule.name : '');
                if (name) prompt += I18n.t('当前事件：{name}（暂未进入具体事件）', { name }) + '\n';
            }
            leafIds.forEach((id, i) => {
                prompt += (i === 0 ? I18n.t('当前事件：{name}', { name: this._name(id) }) : I18n.t('同时进行的事件：{name}', { name: this._name(id) })) + '\n';
            });
            const infoBlocks = [];
            const evaluate = (item) => {
                if (!item.condition) return true;
                if (typeof ms.evaluateConditionWrapper === 'function') return ms.evaluateConditionWrapper(item.condition);
                const ce = ms.conditionEvaluator;
                if (!ce) return true;
                const def = item.condition.conditionDef || item.condition;
                return ce.evaluate(def, 'display');
            };
            const collect = (module, persistentOnly) => {
                if (!module || !Array.isArray(module.info)) return;
                for (const item of module.info) {
                    if (!item || !item.content) continue;
                    if (persistentOnly && !item.persistent) continue;
                    if (!evaluate(item)) continue;
                    infoBlocks.push(String(item.content));
                }
            };
            const targets = leafIds.length ? leafIds : (currentModuleId ? [currentModuleId] : []);
            for (const id of targets) {
                const module = ms.getModule(id);
                collect(module, false);
                // 父级只发标了 persistent 的 info，最多回溯 3 层
                let ancestorId = module ? module.parentModuleId : null;
                let depth = 0;
                while (ancestorId && depth < 3) {
                    const ancestor = ms.getModule(ancestorId);
                    collect(ancestor, true);
                    ancestorId = ancestor ? ancestor.parentModuleId : null;
                    depth++;
                }
            }
            const unique = infoBlocks.filter((t, i) => infoBlocks.indexOf(t) === i);
            if (unique.length) prompt += '\n' + unique.join('\n\n') + '\n';
        }

        prompt += '```';
        return prompt;
    }

    // ==========================================
    // 段2 交互器
    // ==========================================

    _interactivePlugins(currentModuleId) {
        if (!this.pluginSystem) return [];
        const list = [];
        for (const type of ['interactive', 'display_interactive']) {
            const found = this.pluginSystem.getActivePlugins(type, currentModuleId) || [];
            for (const p of found) if (!list.includes(p)) list.push(p);
        }
        return list;
    }

    /** 总结器：把变量整理成一段文字，随交互器段落一起发出。 */
    _pluginSummaries(currentModuleId) {
        if (!this.pluginSystem || typeof PluginRuntime === 'undefined' || !this.variableSystem) return [];
        const store = PluginRuntime.storeFromVariableSystem(this.variableSystem);
        const out = [];
        for (const p of (this.pluginSystem.getActivePlugins('summary', currentModuleId) || [])) {
            const text = PluginRuntime.renderText((p.config || {}).summaryTemplate || '', PluginRuntime.storeLookup(store)).text.trim();
            if (text) out.push({ name: p.name || p.id, text });
        }
        return out;
    }

    generateInteractors(currentModuleId) {
        const summaries = this._pluginSummaries(currentModuleId);
        const entries = [];
        this._interactivePlugins(currentModuleId).forEach(plugin => {
            const cfg = plugin.config || {};
            let text = String(cfg.promptTemplate || cfg.updatePrompt || '');
            text = text.replace(/\{\{(\w+)\}\}/g, (match, varId) => {
                const v = this.variableSystem ? this.variableSystem.getValue(varId) : undefined;
                return v === undefined || v === null ? '' : String(v);
            }).replace(/\n{3,}/g, '\n\n').trim();
            // 没有任何要告诉 AI 的内容时，只剩一个名字，不列出
            if (!text && !cfg.outputFormat) return;
            entries.push({ name: plugin.name || plugin.id, text, outputFormat: cfg.outputFormat });
        });
        this.lastInteractorCount = entries.length;
        if (!entries.length && !summaries.length) return null;
        const lines = [];
        summaries.forEach(s => { lines.push(I18n.t('【{name}】', { name: s.name })); lines.push(s.text); lines.push(''); });
        entries.forEach(e => {
            lines.push(I18n.t('【{name}】', { name: e.name }));
            if (e.text) lines.push(e.text);
            if (e.outputFormat) lines.push(I18n.t('回复格式：{format}', { format: e.outputFormat }));
            lines.push('');
        });
        return '```interactors\n' + lines.join('\n').trim() + '\n```';
    }

    // ==========================================
    // 段3 变量
    // ==========================================

    typeName(variable) {
        const t = variable.type === 'list' && variable.listItemType === 'object' ? 'list_of_object' : variable.type;
        return PROMPT_TYPE_NAMES[t] || t || 'string';
    }

    /** 变更规则的一句话写法：规则名（取值）。 */
    _ruleLabel(rule) {
        if (rule.operation) {
            const v = rule.value;
            const vs = (v && typeof v === 'object') ? Object.entries(v).map(([k, x]) => k + '=' + x).join(',') : (v == null ? '' : String(v));
            return I18n.t('{name}（{detail}）', { name: rule.name, detail: rule.operation + (vs ? ' ' + vs : '') });
        }
        return rule.value != null && rule.value !== '' ? I18n.t('{name}（{detail}）', { name: rule.name, detail: rule.value }) : String(rule.name);
    }

    generateVariables(currentModuleId) {
        if (!this.variableSystem) return null;
        const scopeIds = this._currentLeafIds(currentModuleId);
        const owners = scopeIds.length ? scopeIds : (currentModuleId ? [currentModuleId] : (this.moduleSystem ? [this.moduleSystem.rootModuleId] : []));
        const seen = new Set();
        const variables = [];
        owners.forEach(id => {
            (this.variableSystem.getAIVisibleVariables(id) || []).forEach(v => {
                if (!seen.has(v.id)) { seen.add(v.id); variables.push(v); }
            });
        });
        if (!variables.length) {
            this.lastVisibleVariableIds = new Set();
            return null;
        }

        const lines = [];
        const visible = new Set();
        variables.forEach(variable => {
            visible.add(variable.id);
            const val = this.formatValue(variable.value, variable);
            const shown = (val === '' || val === '[]' || val === '{}') ? I18n.pick({ zh: '（空）', en: '(empty)' }) : val.replace(/\n/g, '\n    ');
            lines.push(`${variable.name} (${this.typeName(variable)}): ${shown}`);
            if (variable.generalRules) lines.push(I18n.t('  说明：{text}', { text: String(variable.generalRules).trim() }));
            const rules = (variable.changeRules || []).filter(r => r && r.name);
            if (rules.length) lines.push(I18n.t('  可用规则：{rules}', { rules: rules.map(r => this._ruleLabel(r)).join(I18n.pick({ zh: '、', en: ', ' })) }));
        });
        this.lastVisibleVariableIds = visible;
        return '```variables\n' + lines.join('\n') + '\n```';
    }

    // ==========================================
    // 条件说明
    // ==========================================

    _queueSegmentIds(seg) {
        if (!seg) return [];
        if (Array.isArray(seg)) return seg;
        return [].concat(seg.ordered || [], seg.unordered || []);
    }

    _opSymbol(op) {
        const m = { '>=': '≥', '<=': '≤', '>': '>', '<': '<', '==': '＝', '=': '＝', '!=': '≠', '!==': '≠' };
        return m[op] || op;
    }

    /**
     * 把完成 / 进入条件整理成一句话并标注当前值，如「修为 ≥ 10（当前 0）」。
     * 只写变量条件；多条用「且 / 或」连接，拿不到就返回空串。
     */
    _describeGate(wrappers) {
        if (!wrappers || !wrappers.length || !this.variableSystem) return '';
        const parts = [];
        const walkDef = (def) => {
            if (!def) return '';
            const groupStrs = (def.groups || []).map(g => {
                const items = (g.items || []).map(it => {
                    if (it.itemType === 'group' && it.group) return walkDef(it.group);
                    const c = it.condition;
                    if (!c || c.type !== 'variable' || !c.variableId) return '';
                    const v = this.variableSystem.getVariable(c.variableId);
                    const vName = (v && v.name) ? v.name : c.variableId;
                    const cur = this.variableSystem.getValue(c.variableId);
                    const curStr = (cur === undefined || cur === null || cur === '') ? I18n.pick({ zh: '（空）', en: '(empty)' }) : this.formatValue(cur);
                    return I18n.t('{name} {op} {value}（当前 {cur}）', { name: vName, op: this._opSymbol(c.operator), value: String(c.value), cur: curStr });
                }).filter(Boolean);
                const join = (g.logic === 'OR') ? I18n.pick({ zh: ' 或 ', en: ' or ' }) : I18n.pick({ zh: ' 且 ', en: ' and ' });
                return items.length > 1 ? `(${items.join(join)})` : items.join(join);
            }).filter(Boolean);
            return groupStrs.join((def.logic === 'OR') ? I18n.pick({ zh: ' 或 ', en: ' or ' }) : I18n.pick({ zh: ' 且 ', en: ' and ' }));
        };
        for (const w of wrappers) {
            const s = w && w.conditionDef ? walkDef(w.conditionDef) : '';
            if (s) parts.push(s);
        }
        return parts.join(I18n.pick({ zh: ' 且 ', en: ' and ' }));
    }

    _flowDisplayName(flowName) {
        const rootId = this.moduleSystem && this.moduleSystem.rootModuleId;
        const root = rootId ? this.moduleSystem.getModule(rootId) : null;
        const fd = (root && root.flows) ? root.flows[flowName] : null;
        return (fd && fd.name) ? fd.name : flowName;
    }

    // ==========================================
    // 段4 队列
    // ==========================================

    /**
     * 此刻能做什么：哪些正在进行的事件可完成 / 还缺什么，哪些事件可以进入，分流程里哪些可以并行进入。
     * 不写指令格式（指令段统一说明）。
     */
    generateModuleQueue(currentModuleId) {
        const ms = this.moduleSystem;
        this.lastVisibleModuleIds = new Set();
        this.lastCompletableModuleIds = new Set();
        if (!ms) return null;
        const queues = ms.getQueue();
        if (!queues) return null;

        const lines = [];
        const shown = new Set();
        const enterable = new Set();

        const leafIds = this._currentLeafIds(currentModuleId);
        const canDo = [];
        const cannot = [];
        leafIds.forEach(id => {
            const m = ms.getModule(id);
            this.lastCompletableModuleIds.add(id);
            if (ms.canCompleteModule(id)) { canDo.push(I18n.t('- {name}', { name: m.name || id })); return; }
            const why = [];
            const pending = ms.getPendingDeliveryInfoForModule(m).map(d => d.title);
            if (pending.length) why.push(I18n.t('先确认投递：{titles}', { titles: pending.join(I18n.pick({ zh: '、', en: ', ' })) }));
            const gate = this._describeGate(m.completionConditions);
            if (gate) why.push(I18n.t('还需要 {gate}', { gate }));
            cannot.push(why.length ? I18n.t('- {name}（{why}）', { name: m.name || id, why: why.join(I18n.pick({ zh: '；', en: '; ' })) }) : I18n.t('- {name}', { name: m.name || id }));
        });
        if (canDo.length) { lines.push(I18n.t('可完成：')); lines.push(...canDo); }
        if (cannot.length) { lines.push(I18n.t('暂不能完成：')); lines.push(...cannot); }

        // 主流程：当前事件完成后可进入的事件
        const mainNames = [];
        this._queueSegmentIds(queues.current).forEach(id => {
            shown.add(id);
            enterable.add(id);
            mainNames.push(I18n.t('- {name}', { name: this._name(id) }));
        });
        if (mainNames.length) { lines.push(I18n.t('可进入：')); lines.push(...mainNames); }

        // 分流程：可并行进入
        (queues.branches || []).forEach(branch => {
            const ids = this._queueSegmentIds(branch);
            if (!ids.length) return;
            lines.push(I18n.t('分流程「{flow}」（可并行）：', { flow: this._flowDisplayName(branch.flowName) }));
            ids.forEach(id => { shown.add(id); enterable.add(id); lines.push(I18n.t('- {name}', { name: this._name(id) })); });
        });

        if (queues.floating && lines.length === 0) {
            const parent = ms.getModule(queues.floating.parentModuleId);
            lines.push(I18n.t('暂未进入具体事件，正处于「{stage}」。', { stage: parent ? (parent.name || I18n.t('当前阶段')) : I18n.t('当前阶段') }));
        }

        // 之后会走到的事件，只给名字，数量由模组的 queueDisplay.after 控制（默认 3）
        const curMod = currentModuleId ? ms.getModule(currentModuleId) : null;
        const qd = (curMod && curMod.queueDisplay) || null;
        const after = qd ? (Number(qd.after) || 0) : 3;
        const before = qd ? (Number(qd.before) || 0) : 0;
        if (after > 0) {
            const upNames = [];
            for (const id of [].concat(this._queueSegmentIds(queues.expected), this._queueSegmentIds(queues.possible))) {
                if (shown.has(id) || upNames.includes(this._name(id))) continue;
                upNames.push(this._name(id));
                if (upNames.length >= after) break;
            }
            if (upNames.length) lines.push(I18n.t('之后的路线（尚不能进入）：{names}', { names: upNames.join(' → ') }));
        }
        if (before > 0 && Array.isArray(queues.completed) && queues.completed.length) {
            const tail = queues.completed.slice(-before).map(id => this._name(id));
            if (tail.length) lines.push(I18n.t('已完成：{names}', { names: tail.join(' → ') }));
        }

        // 上一轮没生效的指令
        const failed = Array.isArray(this.failedOps) ? this.failedOps.slice(-5) : [];
        if (failed.length) {
            lines.push('');
            lines.push(I18n.t('上一轮没有生效的指令（需要的话按上文的名字重写）：'));
            failed.forEach(f => lines.push(I18n.t('- {name}：{reason}', { name: f.name, reason: String(f.reason) })));
        }

        this.lastVisibleModuleIds = enterable;
        if (lines.length === 0) return null;
        return '```queue\n' + lines.join('\n') + '\n```';
    }

    // ==========================================
    // 段5 投递
    // ==========================================

    generateDeliveryInfo(currentModuleId) {
        const ms = this.moduleSystem;
        this.lastShownConditionalTitles = [];
        if (!ms) return null;
        const items = [];
        const scopeIds = this._currentLeafIds(currentModuleId);
        const ids = new Set();
        scopeIds.forEach(id => ms.getPathToModule(id).forEach(p => ids.add(p)));
        if (currentModuleId) ms.getPathToModule(currentModuleId).forEach(p => ids.add(p));
        if (ms.rootModuleId) ids.add(ms.rootModuleId);
        for (const id of ids) {
            const m = ms.getModule(id);
            if (!m) continue;
            const pending = ms.getPendingDeliveryInfoForModule(m);
            for (const d of pending) items.push({ title: d.title, content: d.content, tag: '' });
        }
        if (this.summarySystem && typeof this.summarySystem.getConditionalDeliveriesForPrompt === 'function') {
            const conditional = this.summarySystem.getConditionalDeliveriesForPrompt(this.turn);
            for (const c of conditional) {
                items.push({ title: c.title, content: c.content, tag: I18n.t('（伏笔）') });
                this.lastShownConditionalTitles.push(c.title);
            }
        }
        if (!items.length) return null;
        let prompt = '```delivery\n' + I18n.t('【待确认的投递信息】') + '\n';
        items.forEach((info, index) => {
            prompt += `${index + 1}. ${info.title}${info.tag}\n`;
            if (info.content) prompt += I18n.t('   内容：{content}', { content: info.content }) + '\n';
        });
        prompt += '```';
        return prompt;
    }

    // ==========================================
    // 段6 指令说明
    // ==========================================

    /**
     * 本回合可用的全部指令，按类别分组；只写此刻用得上的类别。名字都要照抄上面各段里写的。
     */
    generateExpectedProgress() {
        const hasVariables = this.lastVisibleVariableIds && this.lastVisibleVariableIds.size > 0;
        const hasRules = hasVariables && this.variableSystem && Array.from(this.lastVisibleVariableIds).some(id => {
            const v = this.variableSystem.getVariable(id);
            return v && v.changeRules && v.changeRules.length;
        });
        const hasEvents = (this.lastVisibleModuleIds && this.lastVisibleModuleIds.size > 0) || (this.lastCompletableModuleIds && this.lastCompletableModuleIds.size > 0);
        const hasDelivery = this.lastShownConditionalTitles.length > 0 || this._hasPendingDelivery();
        const hasPlugins = this.lastInteractorCount > 0;

        const out = ['```progress', I18n.t('指令每条一行，名字照抄上文，写错不生效。')];
        if (hasEvents) {
            out.push(I18n.t('【事件】'));
            out.push(I18n.t('<module|enter|事件名> 进入「可进入」里的事件，当前事件算已完成'));
            out.push(I18n.t('<module|complete|事件名> 完成「可完成」里的事件，时机由你按剧情定'));
        }
        if (hasVariables) {
            out.push(I18n.t('【变量】'));
            out.push(I18n.t('<var|变量名|操作|值> number：add/subtract/set；string、bool：set；list：append/remove；object：set'));
            if (hasRules) out.push(I18n.t('<rule|变量名|规则名> 用「可用规则」，有规则时优先'));
        }
        out.push(I18n.t('【时间】'));
        out.push(I18n.t('<time|参数|add或set|数值> 参数 year/month/day/hour/minute，add 只能往前'));
        if (hasDelivery) {
            out.push(I18n.t('【投递】'));
            out.push(I18n.t('<delivery|标题|done> 已融入剧情，不再发；<delivery|标题|uncompleted> 未做，下一轮再提醒'));
        }
        out.push(I18n.t('【伏笔】'));
        out.push(I18n.t('<foreshadow|标题|描述|触发条件> 记下以后要提醒自己的事；条件写 variable:变量名>=数值、time:day>=30、module:事件名:completed，留空则下一轮提醒'));
        if (hasPlugins) {
            out.push(I18n.t('【插件】'));
            out.push(I18n.t('<plugin|插件名|内容> 调用「交互器」里的插件，内容按其回复格式'));
        }
        out.push('```');
        return out.join('\n');
    }

    _hasPendingDelivery() {
        const ms = this.moduleSystem;
        if (!ms) return false;
        for (const id of ms.getCurrentModuleIds().concat([ms.rootModuleId])) {
            for (const pid of ms.getPathToModule(id)) {
                const m = ms.getModule(pid);
                if (m && ms.getPendingDeliveryInfoForModule(m).length) return true;
            }
        }
        return false;
    }

    // ==========================================
    // 段7 进程信息
    // ==========================================

    /** 最近操作 / 模块总结 / 全局总结，没有内容的不返回。 */
    generateProcessSegments(currentModuleId) {
        const out = [];
        if (!this.summarySystem) return out;
        const ops = this.summarySystem.getRecentOperationsForPrompt();
        if (ops) out.push({ id: 'operations', text: ops });
        const mods = this.summarySystem.getModuleSummariesForPrompt(currentModuleId, this.moduleSystem);
        if (mods) out.push({ id: 'module_summary', text: mods });
        const global = this.summarySystem.getGlobalSummaryForPrompt({ currentTurn: this.turn, windowTurns: this.windowTurns });
        if (global) out.push({ id: 'global_summary', text: global });
        return out;
    }

    generateProcessInfo(currentModuleId) {
        const segs = this.generateProcessSegments(currentModuleId);
        return segs.length ? segs.map(s => s.text).join('\n\n') : null;
    }

    // ==========================================
    // 仅模块信息（调试页用）
    // ==========================================

    generateModuleInfoSegment(currentModuleId) {
        if (!this.moduleSystem || !currentModuleId) return '';
        const currentModule = this.moduleSystem.getModule(currentModuleId);
        if (!currentModule) return '';

        const moduleLabel = currentModule.name || currentModule.id;
        let prompt = '```background\n' + I18n.t('当前模块：{name}', { name: moduleLabel }) + '\n\n' + I18n.t('【仅模块信息】') + '\n\n';
        const collectInfo = (module, label) => {
            if (!module || !module.info || module.info.length === 0) return;
            prompt += I18n.t('【{label}】', { label }) + '\n';
            module.info.forEach(infoItem => { prompt += `${infoItem.content}\n\n`; });
        };
        collectInfo(currentModule, currentModule.name || currentModule.id);
        let ancestorId = currentModule.parentModuleId;
        let depth = 0;
        while (ancestorId && depth < 3) {
            const ancestorModule = this.moduleSystem.getModule(ancestorId);
            if (ancestorModule) collectInfo(ancestorModule, I18n.t('{name}（父级）', { name: ancestorModule.name || ancestorModule.id }));
            ancestorId = ancestorModule ? ancestorModule.parentModuleId : null;
            depth++;
        }
        prompt += '```';
        return prompt;
    }

    getModuleOnlyPrompt(currentModuleId) {
        const parts = [];
        const infoSeg = this.generateModuleInfoSegment(currentModuleId);
        if (infoSeg) parts.push(infoSeg);
        const variablesSeg = this.generateVariables(currentModuleId);
        if (variablesSeg) parts.push(variablesSeg);
        const queue = this.generateModuleQueue(currentModuleId);
        if (queue) parts.push(queue);
        const delivery = this.generateDeliveryInfo(currentModuleId);
        if (delivery) parts.push(delivery);
        return parts.length === 0 ? I18n.t('(当前无模块相关信息)') : parts.join('\n\n');
    }

    // ==========================================
    // 格式化
    // ==========================================

    getCategoryLabel(category) {
        const labels = { 'module': 'module', 'switch': 'switch', 'builtin': 'builtin', 'temp': 'temp' };
        return labels[category] || 'module';
    }

    formatValue(value, variable) {
        if (value === undefined || value === null) return '';
        if (Array.isArray(value)) {
            if (value.length === 0) return '[]';
            if (typeof value[0] === 'object') return JSON.stringify(value);
            return `[${value.join(', ')}]`;
        }
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
    }

    formatOperationParams(params) {
        if (!params) return '';
        return Object.entries(params).map(([key, type]) => `${key}=${type}`).join(', ');
    }

    formatMissingConditions(conditions) {
        if (!conditions || conditions.length === 0) return I18n.pick({ zh: '无', en: 'None' });
        const vName = (id) => {
            const v = this.variableSystem && this.variableSystem.getVariable ? this.variableSystem.getVariable(id) : null;
            return (v && v.name) ? v.name : id;
        };
        const mName = (id) => {
            const m = this.moduleSystem && this.moduleSystem.getModule ? this.moduleSystem.getModule(id) : null;
            return (m && m.name) ? m.name : id;
        };
        return conditions.map(c => {
            if (c.type === 'time') return I18n.t('时间未到 {required}', { required: String(c.required) });
            if (c.type === 'variable') return I18n.t('{name} {op} {value} (当前: {cur})', { name: vName(c.variableId), op: this._opSymbol(c.operator), value: String(c.value), cur: String(c.current) });
            if (c.type === 'module') return `${mName(c.moduleId)} ${c.state}`;
            return I18n.t('未知条件');
        }).join(', ');
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports.PromptGenerator = PromptGenerator;
}
if (typeof window !== 'undefined') {
    window.PromptGenerator = PromptGenerator;
}
