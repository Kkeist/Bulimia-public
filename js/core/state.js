/**
 * 全局状态管理
 * 管理游戏所有内部状态（数值、进度等）
 */

class StateManager {
    constructor() {
        // 游戏状态
        this.gameState = this._createDefaultGameState();

        // 数值系统（所有数值存储在这里，AI只读取/修改，不生成）
        this.values = this._createDefaultValues();

        // 聊天历史
        this.chatHistory = [];

        // 总结内容（不可见，仅作弊窗口可查看）
        this.summaries = [];
        this.currentSummary = '';

        // 已认识的NPC
        this.knownNPCs = new Map();

        // 已完成的触发器
        this.completedTriggers = new Set();

        // 当前激活的世界书条目
        this.activeWorldbooks = new Set();

        // 【暂存交互模型】iframe 插件按钮点击攒成的动作队列：[{ pluginId, type, name, params, ts }, ...]
        // 玩家点发送时合并到 roleplay 一并送 AI；不存档 = 玩家中途读档会丢攒着的"打一拳/吃药"
        this.pendingPluginActions = [];

        // 档案记录
        this.archives = {};
        this.memos = [];
        // 游戏开始时间（第一次对话的时间戳，用于相对时间计算）
        this.gameStartTimestamp = null;

        // 当前模块路径（从根到当前最细节点 id 数组，用于 prompt 与流程；主触发器链）
        this.currentModulePath = [];
        // 时间线当前事件 id（时间线只能有一个当前）
        this.currentTimelineEventId = null;
        // 自由触发器当前路径（只能有一个当前）
        this.currentUnorderedPath = null;
        // 并行各组当前路径：{ [并行组 pathKey]: pathIds }，同一并行组内只能有一个当前
        this.currentParallelPaths = {};
        // 推进队列：叶子模组/时间线事件的有序列表，每项 { type: 'module'|'timeline_event', pathIds?, eventId?, name?, content?, priority? }；可按参数随时重新计算
        this.progressionQueue = [];

        // 各模块按理论顺序跑一遍得到的最低 data 要求（pathKey -> { varId: value }），导入/加载模组时计算并存入
        this.moduleMinData = {};
        // 流程树节点个性化数值覆盖（跳转时优先使用；pathKey -> { varId: value }）
        this.flowNodeOverrides = {};
        // 模组完成勾选（调试用）：{ moduleId: { pathKey: true } }，勾选后该节点及子节点视为已完成
        this.flowNodeCompleted = {};
        // 模块完成时的日期（用于相对时间条件）：{ moduleId: { pathKey: { year, month, day } } }
        this.flowNodeCompletedAt = {};
        // 模块进入时的日期（用于相对时间条件 module_entered）：{ moduleId: { pathKey: { year, month, day, hour? } } }
        this.flowNodeEnteredAt = {};
        // 投递 info 是否已完成（信息投递成功 bool）：{ moduleId: { deliveryId: true } }，完成后不再发送
        this.deliveryCompleted = {};
        // 模块剧情要点：{ moduleId: { pathKey: { content, ts } } } —— AI 在 <module_summary> 块写一行；用于完成模块时回忆/接 prompt
        this.moduleSummaries = {};
        // 动态生成的子模块（module_generator one-shot 触发后写入；reload 后 ModuleManager.load 末尾按这份重 apply 回 subModules）：
        // { moduleId: [ { templateRaw: <raw>, flowKey: 'npc_flows' }, ... ] }
        this.dynamicSubModules = {};
        // 时间线事件已触发记录：{ [moduleId]: { [eventId]: true（一次性）| "year"（每年）| "year-month"（每月） } }
        this.triggeredTimelineEvents = {};
        // 动态排期事件（随机器/脚本写入）：[{ id, triggerDate: {year,month,day}, content, promptTemplateId?, condition? }]，触发后移除
        this.calendarScheduledEvents = [];
        // 已为某节点跑过排期随机器：{ [moduleId:pathKey]: true }，避免重复排期
        this.scheduledForModules = {};
        // 插件测试生成的临时模块/队列（仅测试用，不写入实际模组；可重置清除）
        this.temporaryGeneratedModules = [];

        // 系统变量（时间、摘要序号、剧情伏笔、模组变量等，与存档一起持久化）
        this.variables = this._createDefaultVariables();

        // Prompt日志（调试用）
        this.promptLogs = [];

        // Token统计（仅保留历史记录，不累加总计）
        this.tokenStats = {
            history: []
        };
    }

    /**
     * 创建默认游戏状态
     */
    _createDefaultGameState() {
        return JSON.parse(JSON.stringify(CONFIG.DEFAULT_GAME_STATE));
    }

    /**
     * 创建默认系统变量（时间、摘要序号、剧情伏笔）
     */
    _createDefaultVariables() {
        return {
            turnSerial: 0,
            time: {
                year: 1,
                month: 1,
                day: 1,
                hour: 8,
                weekday: 1
            },
            foreshadow_short: [],
            foreshadow_long: []
        };
    }

    /**
     * 创建默认数值（通用空对象，具体数值由模组通过 content.variables / State.variables 等管理）
     */
    _createDefaultValues() {
        return {};
    }

    /**
     * 获取数值（支持路径访问，路径由模组约定）
     * @param {string} path - 数值路径
     */
    getValue(path) {
        const parts = path.split('.');
        let current = this.values;

        for (const part of parts) {
            if (current === undefined || current === null) {
                return undefined;
            }
            current = current[part];
        }

        return current;
    }

    /**
     * 设置数值
     * @param {string} path - 数值路径
     * @param {any} value - 新值
     * @param {boolean} silent - 是否静默（不触发事件）
     */
    setValue(path, value, silent = false) {
        const parts = path.split('.');
        let current = this.values;

        // 遍历到倒数第二层
        for (let i = 0; i < parts.length - 1; i++) {
            if (current[parts[i]] === undefined) {
                current[parts[i]] = {};
            }
            current = current[parts[i]];
        }

        const lastKey = parts[parts.length - 1];
        const oldValue = current[lastKey];
        current[lastKey] = value;

        if (!silent) {
            Events.emit(EVENT_TYPES.VALUE_CHANGED, {
                path,
                oldValue,
                newValue: value
            });
        }

        return true;
    }

    /**
     * 调整数值（增减）
     * @param {string} path - 数值路径
     * @param {number} delta - 变化量
     */
    adjustValue(path, delta) {
        const currentValue = this.getValue(path);
        if (typeof currentValue !== 'number') {
            console.warn(`Cannot adjust non-number value at ${path}`);
            return false;
        }
        return this.setValue(path, currentValue + delta);
    }

    /**
     * 批量设置数值
     * @param {Object} changes - { path: value } 格式的对象
     */
    setValues(changes) {
        const results = {};
        for (const [path, value] of Object.entries(changes)) {
            results[path] = this.setValue(path, value, true);
        }
        Events.emit(EVENT_TYPES.VALUES_BATCH_CHANGED, changes);
        return results;
    }

    /**
     * 获取当前游戏状态快照（用于存档）
     */
    getSnapshot() {
        return {
            gameState: JSON.parse(JSON.stringify(this.gameState)),
            values: JSON.parse(JSON.stringify(this.values)),
            variables: JSON.parse(JSON.stringify(this.variables || this._createDefaultVariables())),
            currentModulePath: Array.isArray(this.currentModulePath) ? [...this.currentModulePath] : [],
            currentTimelineEventId: this.currentTimelineEventId,
            currentUnorderedPath: this.currentUnorderedPath ? [...this.currentUnorderedPath] : null,
            currentParallelPaths: this.currentParallelPaths && typeof this.currentParallelPaths === 'object' ? JSON.parse(JSON.stringify(this.currentParallelPaths)) : {},
            progressionQueue: Array.isArray(this.progressionQueue) ? this.progressionQueue.map((e) => ({ ...e })) : [],
            moduleMinData: JSON.parse(JSON.stringify(this.moduleMinData || {})),
            flowNodeOverrides: JSON.parse(JSON.stringify(this.flowNodeOverrides || {})),
            flowNodeCompleted: JSON.parse(JSON.stringify(this.flowNodeCompleted || {})),
            flowNodeCompletedAt: JSON.parse(JSON.stringify(this.flowNodeCompletedAt || {})),
            flowNodeEnteredAt: JSON.parse(JSON.stringify(this.flowNodeEnteredAt || {})),
            deliveryCompleted: JSON.parse(JSON.stringify(this.deliveryCompleted || {})),
            moduleSummaries: JSON.parse(JSON.stringify(this.moduleSummaries || {})),
            pendingPluginActions: Array.isArray(this.pendingPluginActions) ? JSON.parse(JSON.stringify(this.pendingPluginActions)) : [],
            dynamicSubModules: JSON.parse(JSON.stringify(this.dynamicSubModules || {})),
            triggeredTimelineEvents: JSON.parse(JSON.stringify(this.triggeredTimelineEvents || {})),
            calendarScheduledEvents: JSON.parse(JSON.stringify(this.calendarScheduledEvents || [])),
            scheduledForModules: JSON.parse(JSON.stringify(this.scheduledForModules || {})),
            chatHistory: JSON.parse(JSON.stringify(this.chatHistory)),
            summaries: JSON.parse(JSON.stringify(this.summaries)),
            currentSummary: this.currentSummary,
            knownNPCs: Array.from(this.knownNPCs.entries()),
            completedTriggers: Array.from(this.completedTriggers),
            activeWorldbooks: Array.from(this.activeWorldbooks),
            archives: JSON.parse(JSON.stringify(this.archives)),
            memos: JSON.parse(JSON.stringify(this.memos)),
            tokenStats: JSON.parse(JSON.stringify(this.tokenStats)),
            gameStartTimestamp: this.gameStartTimestamp
        };
    }

    /**
     * 从快照恢复状态
     * @param {Object} snapshot - 状态快照
     */
    restoreFromSnapshot(snapshot) {
        this.gameState = snapshot.gameState;
        this.values = snapshot.values;
        this.variables = snapshot.variables || this._createDefaultVariables();
        this.currentModulePath = Array.isArray(snapshot.currentModulePath) ? snapshot.currentModulePath : [];
        this.currentTimelineEventId = snapshot.currentTimelineEventId != null ? snapshot.currentTimelineEventId : null;
        this.currentUnorderedPath = Array.isArray(snapshot.currentUnorderedPath) ? snapshot.currentUnorderedPath : null;
        this.currentParallelPaths = snapshot.currentParallelPaths && typeof snapshot.currentParallelPaths === 'object' ? snapshot.currentParallelPaths : {};
        this.progressionQueue = Array.isArray(snapshot.progressionQueue) ? snapshot.progressionQueue : [];
        this.moduleMinData = snapshot.moduleMinData && typeof snapshot.moduleMinData === 'object' ? snapshot.moduleMinData : {};
        this.flowNodeOverrides = snapshot.flowNodeOverrides && typeof snapshot.flowNodeOverrides === 'object' ? snapshot.flowNodeOverrides : {};
        this.flowNodeCompleted = snapshot.flowNodeCompleted && typeof snapshot.flowNodeCompleted === 'object' ? snapshot.flowNodeCompleted : {};
        this.flowNodeCompletedAt = snapshot.flowNodeCompletedAt && typeof snapshot.flowNodeCompletedAt === 'object' ? snapshot.flowNodeCompletedAt : {};
        this.flowNodeEnteredAt = snapshot.flowNodeEnteredAt && typeof snapshot.flowNodeEnteredAt === 'object' ? snapshot.flowNodeEnteredAt : {};
        this.deliveryCompleted = snapshot.deliveryCompleted && typeof snapshot.deliveryCompleted === 'object' ? snapshot.deliveryCompleted : {};
        this.moduleSummaries = snapshot.moduleSummaries && typeof snapshot.moduleSummaries === 'object' ? snapshot.moduleSummaries : {};
        this.pendingPluginActions = Array.isArray(snapshot.pendingPluginActions) ? snapshot.pendingPluginActions : [];
        this.dynamicSubModules = snapshot.dynamicSubModules && typeof snapshot.dynamicSubModules === 'object' ? snapshot.dynamicSubModules : {};
        this.triggeredTimelineEvents = snapshot.triggeredTimelineEvents && typeof snapshot.triggeredTimelineEvents === 'object' ? snapshot.triggeredTimelineEvents : {};
        this.calendarScheduledEvents = Array.isArray(snapshot.calendarScheduledEvents) ? snapshot.calendarScheduledEvents : [];
        this.scheduledForModules = snapshot.scheduledForModules && typeof snapshot.scheduledForModules === 'object' ? snapshot.scheduledForModules : {};
        this.chatHistory = snapshot.chatHistory || [];
        this.summaries = snapshot.summaries || [];
        this.currentSummary = snapshot.currentSummary || '';
        this.knownNPCs = new Map(snapshot.knownNPCs || []);
        this.completedTriggers = new Set(snapshot.completedTriggers || []);
        this.activeWorldbooks = new Set(snapshot.activeWorldbooks || []);
        this.archives = snapshot.archives || this.archives;
        this.memos = snapshot.memos || [];
        this.tokenStats = snapshot.tokenStats || { history: [] };
        // 恢复游戏开始时间（如果存在）
        if (snapshot.gameStartTimestamp) {
            this.gameStartTimestamp = snapshot.gameStartTimestamp;
        }

        Events.emit(EVENT_TYPES.GAME_STATE_CHANGED, this.gameState);
    }

    /**
     * 重置状态（新游戏）
     */
    reset() {
        this.gameState = this._createDefaultGameState();
        this.values = this._createDefaultValues();
        this.variables = this._createDefaultVariables();
        this.chatHistory = [];
        this.summaries = [];
        this.currentSummary = '';
        this.knownNPCs.clear();
        this.completedTriggers.clear();
        this.activeWorldbooks.clear();
        this.archives = {};
        this.memos = [];
        this.promptLogs = [];
        this.tokenStats = { history: [] };
        this.gameStartTimestamp = null;
        this.currentModulePath = [];
        this.currentTimelineEventId = null;
        this.currentUnorderedPath = null;
        this.currentParallelPaths = {};
        this.progressionQueue = [];
        this.moduleMinData = {};
        this.flowNodeOverrides = {};
        this.flowNodeCompleted = {};
        this.flowNodeCompletedAt = {};
        this.flowNodeEnteredAt = {};
        this.deliveryCompleted = {};
        this.moduleSummaries = {};
        this.pendingPluginActions = [];
        this.dynamicSubModules = {};
        this.triggeredTimelineEvents = {};
        this.calendarScheduledEvents = [];
        this.scheduledForModules = {};
        // 2026-06-05 audit：reset 也要清测试临时模块，防止新游戏后调试面板还看到旧测试数据
        this.temporaryGeneratedModules = [];

        Events.emit(EVENT_TYPES.GAME_STATE_CHANGED, this.gameState);
    }

    /**
     * 更新游戏状态
     * @param {Object} updates - 要更新的字段
     */
    updateGameState(updates) {
        Object.assign(this.gameState, updates);
        Events.emit(EVENT_TYPES.GAME_STATE_CHANGED, this.gameState);
    }

    /**
     * 添加聊天消息
     * @param {Object} message - 消息对象
     */
    addChatMessage(message) {
        const msg = {
            id: Date.now(),
            timestamp: new Date().toISOString(),
            ...message
        };
        this.chatHistory.push(msg);
        Events.emit(EVENT_TYPES.CHAT_MESSAGE_ADDED, msg);
        return msg;
    }

    /**
     * 添加Prompt日志
     * @param {Object} log - 日志对象
     */
    addPromptLog(log) {
        this.promptLogs.unshift({
            timestamp: new Date().toISOString(),
            ...log
        });
        // 只保留最近50条
        if (this.promptLogs.length > 50) {
            this.promptLogs.pop();
        }
    }

    /**
     * 更新Token统计（仅保留历史记录，不累加总计）
     * @param {number} tokens - 本次使用的token数
     */
    updateTokenStats(tokens) {
        // 不再累加总计，只保留历史记录
        this.tokenStats.history.push({
            timestamp: Date.now(),
            tokens
        });
        // 只保留最近100条记录
        if (this.tokenStats.history.length > 100) {
            this.tokenStats.history.shift();
        }
    }
}

// 全局状态管理器实例
const State = new StateManager();

// 导出到全局（浏览器环境）
if (typeof window !== 'undefined') {
    window.State = State;
    window.StateManager = StateManager;
}

// 导出（Node.js环境）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { StateManager, State };
}
