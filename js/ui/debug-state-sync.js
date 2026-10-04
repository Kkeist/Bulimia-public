/**
 * 调试页与游戏状态（State）的双向同步。
 * 游戏状态是唯一的存档来源；调试页里常驻的一套核心系统（模块、变量、时间、总结）在打开调试页或切换标签时
 * 从状态重新读入，在调试操作之后写回状态。转换细节（路径去掉根模块、完成记录、投递）统一由 RuntimeBridge 负责。
 * 扩展 DebugModuleJump（debug-module-jump.js 先加载）。
 */
Object.assign(DebugModuleJump, {
    _syncAvailable() {
        return typeof State !== 'undefined' && window.RuntimeBridge && this.moduleSystem && this.moduleSystem.rootModuleId;
    },

    /**
     * 状态 → 调试页的核心系统。按 id 把模块进度、当前所在、变量值、时间、总结写进常驻的那一套。
     * @returns {boolean} 是否执行了同步
     */
    syncFromState() {
        if (!this._syncAvailable()) return false;
        const ms = this.moduleSystem;
        const vs = this.variableSystem;
        const ts = this.timeSystem;
        const rootId = ms.rootModuleId;
        const config = ms.exportConfig();
        const fresh = RuntimeBridge.build(config, State);
        const fms = fresh.moduleSystem;

        // 状态里记录的动态生成模块：常驻系统里没有就补上
        const dyn = State.dynamicSubModules && State.dynamicSubModules[rootId];
        if (Array.isArray(dyn)) {
            for (const e of dyn) {
                if (e && e.templateRaw && e.templateRaw.id && !ms.getModule(e.templateRaw.id)) {
                    ms.addDynamicModule(JSON.parse(JSON.stringify(e.templateRaw)), rootId, e.flowKey || 'main');
                }
            }
        }
        for (const [id, fm] of fms.modules) {
            const m = ms.getModule(id);
            if (!m) continue;
            m.state = fm.state;
            m.enteredTimestamp = fm.enteredTimestamp;
            m.completedTimestamp = fm.completedTimestamp;
            m.interrupted = fm.interrupted;
            m.interruptSummary = fm.interruptSummary;
            for (const d of m.deliveryInfo) {
                const fd = fm.deliveryInfo.find((x) => x.title === d.title);
                if (fd) d.completed = fd.completed;
            }
        }
        ms.currentModulesByFlow.clear();
        for (const [flow, fm] of fms.currentModulesByFlow) {
            const m = fm && ms.getModule(fm.id);
            if (m) ms.currentModulesByFlow.set(flow, m);
        }
        if (vs) {
            for (const [id, fv] of fresh.variableSystem.variables) {
                const v = vs.getVariable(id);
                if (v && v.type === fv.type) v.value = v.cloneValue(fv.value);
            }
            if (typeof vs.updateBuiltinVariables === 'function') vs.updateBuiltinVariables();
        }
        if (ts) Object.assign(ts.systemValues, fresh.timeSystem.systemValues);
        const ss = this.promptGenerator && this.promptGenerator.summarySystem;
        const saved = State.summaries;
        if (ss && typeof ss.importState === 'function' && saved && !Array.isArray(saved) && typeof saved === 'object') ss.importState(saved);
        return true;
    },

    /**
     * 调试页的核心系统 → 状态。只写模块进度、变量、时间、总结，不改其他存档内容。
     */
    syncToState() {
        if (!this._syncAvailable()) return false;
        const ms = this.moduleSystem;
        const ss = this.promptGenerator && this.promptGenerator.summarySystem;
        RuntimeBridge.commit({
            config: { id: ms.rootModuleId },
            state: State,
            variableSystem: this.variableSystem,
            timeSystem: this.timeSystem,
            moduleSystem: ms,
            summarySystem: ss || null
        });
        if (window.PluginRegistry && PluginRegistry.registerFromModule) PluginRegistry.registerFromModule();
        if (window.Events && window.EVENT_TYPES) Events.emit(EVENT_TYPES.GAME_FLOW_UPDATE);
        return true;
    }
});
