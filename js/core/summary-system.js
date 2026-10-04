/**
 * Summary System - 总结系统
 * Manages operation summaries, global summaries, module summaries, and plugin summaries
 * Based on game-v4/docs/03-summary-system.md
 */

/**
 * OperationRecord - represents a single operation record
 */
class OperationRecord {
    constructor(type, content, timestamp = null) {
        this.type = type;           // 'variable', 'module', 'delivery', 'time', 'interrupt', 'foreshadow', 'summary', 'plugin'
        this.content = content;     // The actual operation content (tag or structured data)
        this.timestamp = timestamp || new Date();
        this.details = null;        // Additional details (e.g., before/after values)
    }

    setDetails(details) {
        this.details = details;
    }

    /** 从存档里的普通对象还原。 */
    static from(plain) {
        const r = new OperationRecord(plain && plain.type, plain && plain.content, plain && plain.timestamp ? new Date(plain.timestamp) : null);
        if (plain && plain.details) r.details = plain.details;
        return r;
    }

    toString() {
        return String(this.content);
    }
}

/**
 * SummarySystem - manages all summary types
 */
class SummarySystem {
    constructor() {
        // Operation Summary
        this.operations = [];               // All操作记录
        this.interactions = [];              // 交互分组（每次对话轮次）

        // Global Summary
        this.singleSummaries = [];           // 单条总结列表
        this.megaSummaries = [];             // 大总结列表
        this.originalMessages = [];          // 原始消息列表

        // Module Summary
        this.moduleSummaries = new Map();    // Map<moduleId, {content, timestamp}>

        // Flow Summary（与 module 同一格式：按 content 存）
        this.flowSummaries = new Map();      // Map<flowKey, { content, timestamp }>，flowKey = `${rootModuleId}:${flowName}`

        // Plugin Summary
        this.pluginSummaries = new Map();    // Map<pluginId, events[]>
        this.pluginSummaryContents = [];     // 02-ai-protocol: <summary|plugin|内容> 的通用条目

        // 02-ai-protocol: 条件化投递（foreshadow 创建的伏笔/待办）
        this.conditionalDeliveries = [];  // { title, content, conditionParsed, completed }

        // 子模块 complete 后待处理父模块总结（由代码登记，调用方请求 AI 后写回）
        this._pendingParentSummaries = [];

        // Configuration
        this.config = {
            operationSummary: {
                enabled: true,
                recentInteractionCount: 2,   // 保留最近N次交互的操作
                displayInPrompt: true
            },
            globalSummary: {
                enabled: true,
                summarizeEveryMessage: true,
                keepRecentOriginalMessages: 3,
                keepRecentSingleSummaries: 10,
                compressSummariesEvery: 10,  // 每N条单条总结压缩为1个大总结
                autoHideOlder: true
            }
        };
    }

    /**
     * Configure the summary system
     */
    configure(config) {
        this.config = { ...this.config, ...config };
    }

    /**
     * 解析 foreshadow 触发条件字符串为可评估对象
     * 示例: "variable:score>=80" | "time:day>=30" | "module:homework:completed"
     */
    _parseForeshadowCondition(conditionStr) {
        if (!conditionStr || typeof conditionStr !== 'string') return null;
        const parts = conditionStr.trim().split(':').map(s => s.trim());
        if (parts.length === 3 && parts[0] === 'module') {
            return { type: 'module', moduleId: parts[1], state: parts[2] };
        }
        if (parts.length >= 2) {
            const type = parts[0];
            const rest = parts.slice(1).join(':');
            const opMatch = rest.match(/^(.+?)(>=|<=|==|!=|>|<)(.+)$/);
            if (opMatch) {
                return {
                    type,
                    param: type === 'time' ? opMatch[1].trim() : undefined,
                    variableId: type === 'variable' ? opMatch[1].trim() : undefined,
                    operator: opMatch[2],
                    value: this._parseCondValue(opMatch[3].trim())
                };
            }
        }
        return null;
    }

    _parseCondValue(v) {
        if (v === 'true') return true;
        if (v === 'false') return false;
        const n = Number(v);
        if (!isNaN(n)) return n;
        return v;
    }

    /**
     * 评估单条条件化投递条件（依赖已注入的 variable/time/module 系统）
     */
    _evaluateConditionalDeliveryCondition(cond) {
        if (!cond) return false;
        if (cond.type === 'always') return true;
        if (cond.type === 'variable' && this._variableSystem && cond.variableId != null) {
            const val = this._variableSystem.getValue(cond.variableId);
            if (val === undefined) return false;
            return this._compareCond(val, cond.operator, cond.value);
        }
        if (cond.type === 'time' && this._timeSystem && cond.param != null) {
            let val;
            const t = this._timeSystem.getCurrentTime();
            if (t[cond.param] !== undefined) {
                val = t[cond.param];
            } else if (typeof this._timeSystem.getParameter === 'function') {
                const param = this._timeSystem.getParameter(cond.param);
                if (param && typeof param.calculate === 'function') {
                    val = param.calculate(this._timeSystem.systemValues);
                }
            }
            if (val === undefined) return false;
            return this._compareCond(val, cond.operator, cond.value);
        }
        if (cond.type === 'module' && this._moduleSystem && cond.moduleId && cond.state) {
            return this._moduleSystem.checkModuleState(cond.moduleId, cond.state);
        }
        return false;
    }

    _compareCond(a, op, b) {
        switch (op) {
            case '>=': return a >= b;
            case '<=': return a <= b;
            case '==': return a === b;
            case '!=': return a !== b;
            case '>': return a > b;
            case '<': return a < b;
            default: return false;
        }
    }

    /**
     * 添加条件化投递（伏笔 / 待办）。
     * conditionParsed 已解析好时直接用；否则按 conditionStr 解析。reflowTurns：发出后没被确认时，隔几轮再提醒（默认每轮）。
     */
    addConditionalDelivery({ title, content, conditionStr, conditionParsed, reflowTurns }) {
        const parsed = conditionParsed !== undefined ? conditionParsed : this._parseForeshadowCondition(conditionStr);
        this.conditionalDeliveries.push({
            title,
            content: content || '',
            conditionStr: conditionStr || '',
            conditionParsed: parsed,
            completed: false,
            reflowTurns: Number.isInteger(reflowTurns) && reflowTurns > 0 ? reflowTurns : 1,
            lastShownTurn: null
        });
    }

    /**
     * 获取当前应展示的条件化投递：条件已满足、未完成、且距上次提醒已过 reflowTurns 轮。
     * @param {number} [turn] 当前回合序号，不传则不做回流间隔判断
     */
    getConditionalDeliveriesForPrompt(turn) {
        return this.conditionalDeliveries.filter(item => {
            if (item.completed || !item.conditionParsed) return false;
            if (!this._evaluateConditionalDeliveryCondition(item.conditionParsed)) return false;
            if (turn != null && item.lastShownTurn != null && turn - item.lastShownTurn < (item.reflowTurns || 1)) return false;
            return true;
        });
    }

    /** 记录这些伏笔在第 turn 轮发给了 AI。 */
    markConditionalDeliveriesShown(titles, turn) {
        for (const d of this.conditionalDeliveries) if (titles.includes(d.title)) d.lastShownTurn = turn;
    }

    /**
     * 标记条件化投递为已完成（<delivery|标题|done>）
     */
    markConditionalDeliveryDone(title) {
        const item = this.conditionalDeliveries.find(d => d.title === title);
        if (item) {
            item.completed = true;
            return true;
        }
        return false;
    }

    /**
     * 标记条件化投递为未完成（<delivery|标题|uncompleted>）
     */
    markConditionalDeliveryUncomplete(title) {
        const item = this.conditionalDeliveries.find(d => d.title === title);
        if (item) {
            item.completed = false;
            return true;
        }
        return false;
    }

    /**
     * 注入时间系统（测试面板等调用，用于与其它系统 API 一致）
     */
    setTimeSystem(timeSystem) {
        this._timeSystem = timeSystem;
    }

    /**
     * 注入变量系统（测试面板等调用）
     */
    setVariableSystem(variableSystem) {
        this._variableSystem = variableSystem;
    }

    /**
     * 注入模块系统（测试面板等调用；getModuleSummariesForPrompt 也可用此引用）
     */
    setModuleSystem(moduleSystem) {
        this._moduleSystem = moduleSystem;
    }

    // ==========================================
    // Operation Summary 操作总结
    // ==========================================

    /**
     * Record an operation
     * @param {string} type - 操作类型
     * @param {string} content - 操作内容（tag格式）
     * @param {object} details - 额外信息
     */
    recordOperation(type, content, details = null) {
        if (!this.config.operationSummary.enabled) return;

        const record = new OperationRecord(type, content);
        if (details) {
            record.setDetails(details);
        }

        this.operations.push(record);
    }

    /**
     * Start a new interaction (对话轮次)
     */
    startNewInteraction() {
        // 将当前operations归档到interactions
        if (this.operations.length > 0) {
            this.interactions.push({
                timestamp: new Date(),
                operations: [...this.operations]
            });
            this.operations = [];
        }

        // 清理过旧的交互记录
        const keepCount = this.config.operationSummary.recentInteractionCount;
        if (this.interactions.length > keepCount) {
            this.interactions = this.interactions.slice(-keepCount);
        }
    }

    /**
     * Get recent operations for prompt
     */
    getRecentOperationsForPrompt() {
        if (!this.config.operationSummary.enabled ||
            !this.config.operationSummary.displayInPrompt) {
            return null;
        }

        const allOps = [];

        // 获取最近N次交互的所有操作
        this.interactions.forEach(interaction => {
            allOps.push(...interaction.operations);
        });

        // 加上当前交互的操作
        allOps.push(...this.operations);

        if (allOps.length === 0) return null;

        // 格式化为prompt文本
        let prompt = '```operations\n【最近操作】（已经执行过，不要重复）\n';
        allOps.forEach((op, index) => {
            prompt += `${index + 1}. ${op.toString()}\n`;
            if (op.details && op.details.before !== undefined && op.details.after !== undefined) {
                prompt += `   ${this.formatDetails(op.details)}\n`;
            }
        });
        prompt += '```';

        return prompt;
    }

    formatDetails(details) {
        const f = (v) => (v !== null && typeof v === 'object') ? JSON.stringify(v) : String(v);
        return `${f(details.before)} → ${f(details.after)}`;
    }

    /**
     * Clear operation history
     */
    clearOperationHistory() {
        this.operations = [];
        this.interactions = [];
    }

    // ==========================================
    // Global Summary 全局总结
    // ==========================================

    /**
     * Add a single summary from AI
     */
    addSingleSummary(content, turn) {
        if (!this.config.globalSummary.enabled) return;

        this.singleSummaries.push({
            content: content,
            turn: Number.isInteger(turn) ? turn : null,
            timestamp: new Date()
        });
    }

    /**
     * 已经滑出对话窗口的单条总结（对话窗口里还看得到原文的不算）。没记回合序号的一律算已滑出。
     * @param {number} currentTurn 当前回合序号
     * @param {number} windowTurns 对话窗口覆盖的回合数
     */
    getSlidOutSingles(currentTurn, windowTurns) {
        if (!Number.isInteger(currentTurn) || !Number.isInteger(windowTurns)) return this.singleSummaries.slice();
        return this.singleSummaries.filter(s => s.turn == null || s.turn <= currentTurn - windowTurns);
    }

    /** 已滑出窗口的单条总结攒够 compressSummariesEvery 条，就该压缩成大总结。 */
    needsCompression(currentTurn, windowTurns) {
        if (!this.config.globalSummary.enabled) return false;
        return this.getSlidOutSingles(currentTurn, windowTurns).length >= this.config.globalSummary.compressSummariesEvery;
    }

    /**
     * 把前 count 条单条总结并入一条大总结（压缩完成后调用）。
     */
    mergeIntoMegaSummary(content, count) {
        this.megaSummaries.push({ content: content, timestamp: new Date(), sourceCount: count });
        this.singleSummaries = this.singleSummaries.slice(count);
    }

    /**
     * Add a mega summary (压缩后的大总结)
     */
    addMegaSummary(content) {
        this.megaSummaries.push({
            content: content,
            timestamp: new Date(),
            sourceCount: this.singleSummaries.length
        });

        // 清空已压缩的单条总结
        if (this.config.globalSummary.autoHideOlder) {
            this.singleSummaries = [];
        }
    }

    /**
     * Add an original message
     */
    addOriginalMessage(role, content) {
        this.originalMessages.push({
            role: role,  // 'user' or 'assistant'
            content: content,
            timestamp: new Date()
        });

        // 只保留最近N条
        const keepCount = this.config.globalSummary.keepRecentOriginalMessages;
        if (this.originalMessages.length > keepCount) {
            this.originalMessages = this.originalMessages.slice(-keepCount);
        }
    }

    /**
     * Get global summary for prompt
     */
    getGlobalSummaryForPrompt(opts = {}) {
        if (!this.config.globalSummary.enabled) return null;

        // 对话窗口里还看得到原文的回合不重复发单条总结
        const singles = this.getSlidOutSingles(opts.currentTurn, opts.windowTurns);
        if (this.megaSummaries.length === 0 && singles.length === 0 && this.originalMessages.length === 0) return null;

        let prompt = '```global_summary\n';

        // 大总结
        if (this.megaSummaries.length > 0) {
            prompt += '【大总结】\n';
            this.megaSummaries.forEach(mega => {
                prompt += `${mega.content}\n\n`;
            });
        }

        // 最近的单条总结
        const keep = this.config.globalSummary.keepRecentSingleSummaries;
        const recentSingles = keep >= singles.length ? singles : (keep > 0 ? singles.slice(-keep) : []);
        if (recentSingles.length > 0) {
            prompt += `【之前的剧情（按时间）】\n`;
            recentSingles.forEach((single, index) => {
                prompt += `${index + 1}. ${single.content}\n`;
            });
            prompt += '\n';
        }

        // 最近的原始消息
        if (this.originalMessages.length > 0) {
            prompt += `【最近${this.originalMessages.length}条原始消息】\n`;
            this.originalMessages.forEach(msg => {
                const roleLabel = msg.role === 'user' ? 'User' : 'AI';
                prompt += `- ${roleLabel}: ${msg.content}\n`;
            });
        }

        prompt += '```';
        return prompt;
    }

    /**
     * Edit global summary (for debug panel)
     */
    editMegaSummary(index, newContent) {
        if (index >= 0 && index < this.megaSummaries.length) {
            this.megaSummaries[index].content = newContent;
            this.megaSummaries[index].timestamp = new Date();
        }
    }

    // ==========================================
    // Module Summary 模块总结
    // ==========================================

    /**
     * 判断 conditionDef 是否为空（03/01：无 condition 时默认「子模块完成时各总结一次」）
     * @private
     */
    _isEmptyConditionDef(conditionDef) {
        if (conditionDef == null || conditionDef === undefined) return true;
        if (Array.isArray(conditionDef) && conditionDef.length === 0) return true;
        if (typeof conditionDef === 'object' && (!conditionDef.groups || conditionDef.groups.length === 0)) return true;
        return false;
    }

    /**
     * 子模块完成时，若父模块启用了「无条件总结条」，返回该父模块的总结请求（由代码登记待处理，调用方请求 AI 后写回）
     * @param {object} moduleSystem
     * @param {string} completedModuleId 本回合完成的子模块 id
     * @returns {{ parentId: string, parentName: string, content: string }|null}
     */
    getParentSummaryRequestAfterChildComplete(moduleSystem, completedModuleId) {
        if (!moduleSystem || !completedModuleId) return null;
        const module = moduleSystem.getModule(completedModuleId);
        if (!module || !module.parentModuleId) return null;
        const parent = moduleSystem.getModule(module.parentModuleId);
        if (!parent || !parent.summary || !parent.summary.enabled || !Array.isArray(parent.summary.promptList)) return null;
        const item = parent.summary.promptList.find(entry => {
            const cd = entry.conditionDef != null ? entry.conditionDef : entry.condition;
            return this._isEmptyConditionDef(cd);
        });
        if (!item) return null;
        return { parentId: parent.id, parentName: parent.name || parent.id, content: item.content || '' };
    }

    /**
     * 登记「子模块完成」触发的父模块总结请求（仅由 tag 执行处调用，代码判断不交给 AI）
     * @param {object} moduleSystem
     * @param {string} completedModuleId
     */
    recordPendingParentSummary(moduleSystem, completedModuleId) {
        const request = this.getParentSummaryRequestAfterChildComplete(moduleSystem, completedModuleId);
        if (request) this._pendingParentSummaries.push(request);
    }

    /**
     * 取出并清空待处理父模块总结列表，供调用方逐条请求总结并 setModuleSummary
     * @returns {Array<{ parentId: string, parentName: string, content: string }>}
     */
    getAndClearPendingParentSummaries() {
        const list = this._pendingParentSummaries.slice();
        this._pendingParentSummaries = [];
        return list;
    }

    /**
     * 返回所有启用了「无条件总结条」的模块（用于调试或批量查询）
     * @param {object} moduleSystem
     * @returns {Array<{ moduleId: string, name: string, content: string }>}
     */
    getModulesWithNoConditionSummary(moduleSystem) {
        if (!moduleSystem || !moduleSystem.modules) return [];
        const out = [];
        for (const [, mod] of moduleSystem.modules) {
            if (!mod.summary || !mod.summary.enabled || !Array.isArray(mod.summary.promptList)) continue;
            const item = mod.summary.promptList.find(entry => {
                const cd = entry.conditionDef != null ? entry.conditionDef : entry.condition;
                return this._isEmptyConditionDef(cd);
            });
            if (item) out.push({ moduleId: mod.id, name: mod.name || mod.id, content: item.content || '' });
        }
        return out;
    }

    /**
     * 按 01-core-schemas 获取模块总结配置（module.summary）
     * @param {object} moduleSystem
     * @param {string} moduleId
     * @returns {object|null} { enabled, autoSummarize?, promptList: [{ conditionDef, content }] }
     */
    getModuleSummaryConfig(moduleSystem, moduleId) {
        if (!moduleSystem || !moduleId) return null;
        const m = moduleSystem.getModule(moduleId);
        return m && m.summary ? m.summary : null;
    }

    /**
     * 按 01-core-schemas 获取分流程总结配置（与 module.summary 同一格式）
     * @param {object} moduleSystem
     * @param {string} rootModuleId 拥有该 flow 的根模块 id
     * @param {string} flowName
     * @returns {object|null} { enabled, autoSummarize?, promptList: [{ conditionDef, content }] }
     */
    getFlowSummaryConfig(moduleSystem, rootModuleId, flowName) {
        if (!moduleSystem || !rootModuleId || !flowName) return null;
        const root = moduleSystem.getModule(rootModuleId);
        return root && typeof root.getFlowSummaryConfig === 'function' ? root.getFlowSummaryConfig(flowName) : null;
    }

    /**
     * 设置分流程总结内容（与 module 同一：单条 content）
     * @param {string} rootModuleId
     * @param {string} flowName
     * @param {string} content
     */
    setFlowSummary(rootModuleId, flowName, content) {
        const key = `${rootModuleId}:${flowName}`;
        this.flowSummaries.set(key, { content: content ?? '', timestamp: new Date() });
    }

    /**
     * 获取分流程总结内容
     * @param {string} rootModuleId
     * @param {string} flowName
     * @returns {object|null} { content, timestamp }
     */
    getFlowSummary(rootModuleId, flowName) {
        return this.flowSummaries.get(`${rootModuleId}:${flowName}`) || null;
    }

    /**
     * Add or update module summary
     */
    setModuleSummary(moduleId, content) {
        this.moduleSummaries.set(moduleId, {
            content: content,
            timestamp: new Date()
        });
    }

    /**
     * Get module summary
     */
    getModuleSummary(moduleId) {
        return this.moduleSummaries.get(moduleId);
    }

    /**
     * Get module summaries for prompt (with scope rules)
     * 
     * 作用域规则：
     * - 同父级模块间互相发送子模块总结
     * - 跨父级只发送父级总结
     * 
     * @param {string} currentModuleId 
     * @param {object} moduleSystem - 需要访问模块层级结构
     */
    getModuleSummariesForPrompt(currentModuleId, moduleSystem) {
        if (!currentModuleId || !moduleSystem) return null;

        const currentModule = moduleSystem.getModule(currentModuleId);
        if (!currentModule) return null;

        const sections = [];
        const parentId = currentModule.parentModuleId;

        if (parentId) {
            // 同父级的兄弟模块总结
            const lines = [];
            for (const sibling of moduleSystem.getChildModules(parentId)) {
                if (sibling.id === currentModuleId) continue;
                const summary = this.getModuleSummary(sibling.id);
                if (summary) lines.push(`- ${sibling.name}: ${summary.content}`);
            }
            if (lines.length > 0) {
                sections.push(`[当前父级: ${moduleSystem.getModule(parentId).name}]\n${lines.join('\n')}`);
            }

            // 各级父级模块自己的总结（不含其他子模块）
            let ancestorId = parentId;
            while (ancestorId) {
                const ancestorModule = moduleSystem.getModule(ancestorId);
                const ancestorSummary = this.getModuleSummary(ancestorId);
                if (ancestorSummary) sections.push(`[父级模块: ${ancestorModule.name}]\n${ancestorSummary.content}`);
                ancestorId = ancestorModule.parentModuleId;
            }
        }

        if (sections.length === 0) return null;
        return '```module_summary\n【相关模块总结】\n\n' + sections.join('\n\n') + '\n```';
    }

    /**
     * Clear module summary
     */
    clearModuleSummary(moduleId) {
        this.moduleSummaries.delete(moduleId);
    }

    // ==========================================
    // Plugin Summary 插件总结
    // ==========================================

    /**
     * 添加插件相关总结（02-ai-protocol: <summary|plugin|内容>）
     */
    addPluginSummaryContent(content) {
        if (content && String(content).trim()) {
            this.pluginSummaryContents.push({ content: String(content).trim(), timestamp: new Date() });
        }
    }

    /**
     * Record a plugin event
     */
    recordPluginEvent(pluginId, event) {
        if (!this.pluginSummaries.has(pluginId)) {
            this.pluginSummaries.set(pluginId, []);
        }

        this.pluginSummaries.get(pluginId).push({
            event: event,
            timestamp: new Date()
        });
    }

    /**
     * Get plugin events
     */
    getPluginEvents(pluginId) {
        return this.pluginSummaries.get(pluginId) || [];
    }

    /**
     * Clear plugin events
     */
    clearPluginEvents(pluginId) {
        this.pluginSummaries.delete(pluginId);
    }

    // ==========================================
    // Utility Methods
    // ==========================================

    /**
     * Reset all summaries
     */
    resetAll() {
        this.operations = [];
        this.interactions = [];
        this.singleSummaries = [];
        this.megaSummaries = [];
        this.originalMessages = [];
        this.moduleSummaries.clear();
        this.pluginSummaries.clear();
        this.pluginSummaryContents = [];
        this.conditionalDeliveries = [];
        this._pendingParentSummaries = [];
    }

    /**
     * Export state (for save/load)
     */
    exportState() {
        return {
            operations: this.operations,
            interactions: this.interactions,
            singleSummaries: this.singleSummaries,
            megaSummaries: this.megaSummaries,
            originalMessages: this.originalMessages,
            moduleSummaries: Array.from(this.moduleSummaries.entries()),
            pluginSummaries: Array.from(this.pluginSummaries.entries()),
            pluginSummaryContents: this.pluginSummaryContents || [],
            conditionalDeliveries: this.conditionalDeliveries || [],
            config: this.config
        };
    }

    /**
     * Import state (for save/load)
     */
    importState(state) {
        this.operations = (state.operations || []).map(o => OperationRecord.from(o));
        this.interactions = (state.interactions || []).map(it => ({
            ...it,
            timestamp: it && it.timestamp ? new Date(it.timestamp) : new Date(),
            operations: ((it && it.operations) || []).map(o => OperationRecord.from(o))
        }));
        this.singleSummaries = state.singleSummaries || [];
        this.megaSummaries = state.megaSummaries || [];
        this.originalMessages = state.originalMessages || [];
        this.moduleSummaries = new Map(state.moduleSummaries || []);
        this.pluginSummaries = new Map(state.pluginSummaries || []);
        this.pluginSummaryContents = state.pluginSummaryContents || [];
        this.conditionalDeliveries = state.conditionalDeliveries || [];
        if (state.config) {
            this.config = { ...this.config, ...state.config };
        }
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SummarySystem, OperationRecord };
}
