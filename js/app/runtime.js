/**
 * 运行时：把真实游戏状态装进核心系统（模块 / 变量 / 时间 / 总结 / 提示词 / 标签），供发送与回复落地使用。
 * 扩展 App（app.js 先加载）。
 */
Object.assign(App, {
    /** 模组原始配置缓存：{ 模组 id: module.json 的内容 } */
    _engineConfigs: {},
    _engineConfigLoading: {},

    /** 当前模组的原始配置（已缓存时同步返回，否则 null）。 */
    getEngineConfig() {
        const cur = ModuleManager.getCurrent();
        return cur ? (this._engineConfigs[cur.id] || null) : null;
    },

    /** 直接指定当前模组的配置（模组编辑改完之后调用，让提示词立刻用新配置）。 */
    setEngineConfig(config) {
        const cur = ModuleManager.getCurrent();
        if (!cur || !config) return;
        this._engineConfigs[cur.id] = config.id ? config : { ...config, id: cur.id };
    },

    /** 丢掉当前模组的配置缓存（重新从文件加载模组之后调用）。 */
    clearEngineConfig() {
        const cur = ModuleManager.getCurrent();
        if (cur) delete this._engineConfigs[cur.id];
    },

    /**
     * 确保当前模组的原始配置已读到。读取失败抛出面向玩家的错误；
     * 模组不是可读取的格式时返回 null，由调用方告知玩家。
     */
    async ensureEngineConfig() {
        const cur = ModuleManager.getCurrent();
        if (!cur) return null;
        if (this._engineConfigs[cur.id]) return this._engineConfigs[cur.id];
        if (this._engineConfigLoading[cur.id]) return this._engineConfigLoading[cur.id];
        const job = (async () => {
            let config = null;
            if (cur.flows && typeof cur.flows === 'object') {
                config = cur;
            } else if (cur.sourceConfig) {
                config = cur.sourceConfig;
            } else if (cur.folderKey) {
                let res;
                try {
                    res = await ModuleManager._fetchModuleJson(cur.folderKey);
                } catch (e) {
                    throw new Error(I18n.t('读取模组文件失败，请确认用本地服务器打开页面后再试'));
                }
                if (!res.ok) throw new Error(I18n.t('读取模组文件失败（{status}），请到设置里重新加载模组', { status: res.status }));
                config = await res.json();
            }
            if (!config) return null;
            if (!config.id) config = { ...config, id: cur.id };
            this._engineConfigs[cur.id] = config;
            return config;
        })();
        this._engineConfigLoading[cur.id] = job;
        try {
            return await job;
        } finally {
            delete this._engineConfigLoading[cur.id];
        }
    },

    /**
     * 新游戏的起始时间：按模组 timeSystem.initialValues（只取年月日时分里写了的），没有配置就保持系统默认。
     * 需要模组配置已读到（ensureEngineConfig）。
     */
    _applyModuleStartTime() {
        const config = this.getEngineConfig();
        const iv = config && config.timeSystem && config.timeSystem.initialValues;
        if (!iv || typeof iv !== 'object') return;
        if (!State.variables) State.variables = State._createDefaultVariables();
        const time = { ...(State.variables.time || {}) };
        ['year', 'month', 'day', 'hour', 'minute'].forEach(k => {
            if (typeof iv[k] === 'number' && isFinite(iv[k])) time[k] = iv[k];
        });
        State.variables.time = time;
    },

    /** 用当前状态装一套核心系统；模组配置还没读到或模组格式不支持时返回 null。 */
    buildEngine() {
        const config = this.getEngineConfig();
        if (!config || typeof RuntimeBridge === 'undefined') return null;
        return RuntimeBridge.build(config, State);
    },

    /** 当前回合序号：已有的 AI 回复条数。 */
    _currentTurnNumber() {
        return (State.chatHistory || []).filter(m => m && m.role === 'assistant').length;
    },

    /**
     * 当前存档的总结系统（读出一份可编辑的实例）。改完用 saveSummarySystem 写回。
     * 没有模组配置时也能用：总结数据只依赖存档。
     */
    getSummarySystem() {
        const ss = new SummarySystem();
        const saved = State.summaries;
        if (saved && !Array.isArray(saved) && typeof saved === 'object') ss.importState(saved);
        return ss;
    },

    saveSummarySystem(ss) {
        State.summaries = ss.exportState();
        if (this.autoSaveToCurrentSlot) this.autoSaveToCurrentSlot();
    },

    /**
     * 一回合开始前的可回退状态：变量、时间、事件进度、投递、总结。
     * 重新生成这一回合时用它把状态退回去，避免上一次回复的操作被重复执行。
     */
    _captureTurnState() {
        const keys = ['variables', 'currentModulePath', 'flowNodeCompleted', 'flowNodeCompletedAt', 'flowNodeEnteredAt', 'deliveryCompleted', 'summaries', 'lastFailedOps'];
        const snap = {};
        keys.forEach(k => { snap[k] = JSON.parse(JSON.stringify(State[k] === undefined ? null : State[k])); });
        return snap;
    },

    _restoreTurnState(snap) {
        if (!snap) return;
        Object.keys(snap).forEach(k => { State[k] = JSON.parse(JSON.stringify(snap[k])); });
        if (State.lastFailedOps === null) State.lastFailedOps = [];
    }
});
