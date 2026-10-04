/**
 * 调试支持系统 - Debug Support System
 * 提供后端调试接口和工具函数
 */

class DebugSupport {
    constructor(gameEngine, moduleJumpSystem) {
        this.gameEngine = gameEngine;
        this.jumpSystem = moduleJumpSystem;
        this.debugLog = [];
        this.maxLogSize = 1000;
        this.debugMode = false;
    }

    /**
     * 启用调试模式
     */
    enable() {
        this.debugMode = true;
        this.log('Debug mode enabled', 'system');

        // 注入全局调试对象
        if (typeof window !== 'undefined') {
            window.__DEBUG__ = this;
            console.log('[Debug] Debug tools available at window.__DEBUG__');
        }
    }

    /**
     * 禁用调试模式
     */
    disable() {
        this.debugMode = false;
        this.log('Debug mode disabled', 'system');
    }

    /**
     * 记录调试日志
     */
    log(message, category = 'general', data = null) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            category: category,
            message: message,
            data: data
        };

        this.debugLog.push(logEntry);

        // 限制日志大小
        if (this.debugLog.length > this.maxLogSize) {
            this.debugLog.shift();
        }

        if (this.debugMode) {
            console.log(`[${category}] ${message}`, data || '');
        }
    }

    /**
     * 获取调试日志
     */
    getLog(category = null, limit = 100) {
        let logs = this.debugLog;

        if (category) {
            logs = logs.filter(entry => entry.category === category);
        }

        return logs.slice(-limit);
    }

    /**
     * 清空调试日志
     */
    clearLog() {
        this.debugLog = [];
        this.log('Log cleared', 'system');
    }

    /**
     * 获取系统状态快照
     */
    getSystemSnapshot() {
        return {
            timestamp: new Date().toISOString(),
            gameEngine: {
                initialized: this.gameEngine ? this.gameEngine.initialized : false,
                currentModule: this.gameEngine ? this.gameEngine.currentModuleId : null
            },
            jumpSystem: {
                initialized: this.jumpSystem ? this.jumpSystem.initialized : false,
                moduleCount: this.jumpSystem ? this.jumpSystem.moduleIndex.size : 0,
                flowCount: this.jumpSystem ? this.jumpSystem.flowIndex.size : 0
            },
            debugMode: this.debugMode,
            logSize: this.debugLog.length
        };
    }

    /**
     * 跳转到模块（调试用）
     */
    jumpTo(moduleId, force = false) {
        if (!this.jumpSystem) {
            this.log('Jump system not available', 'error');
            return { success: false, error: 'Jump system not initialized' };
        }

        this.log(`Jumping to module: ${moduleId} (force: ${force})`, 'jump', { moduleId, force });

        const result = this.jumpSystem.jumpToModule(moduleId, force);

        if (result.success) {
            this.log(`Successfully jumped to ${result.moduleName}`, 'jump', result);
        } else {
            this.log(`Failed to jump: ${result.error}`, 'error', result);
        }

        return result;
    }

    /**
     * 获取模块详细信息
     */
    inspectModule(moduleId) {
        if (!this.jumpSystem) {
            return { error: 'Jump system not initialized' };
        }

        const info = this.jumpSystem.getModuleInfo(moduleId);

        if (!info) {
            return { error: `Module not found: ${moduleId}` };
        }

        const moduleData = this.jumpSystem.moduleIndex.get(moduleId);

        return {
            ...info,
            fullModule: moduleData.module,
            variables: this._getModuleVariables(moduleId),
            plugins: this._getModulePlugins(moduleId),
            accessibleVariables: this._getAccessibleVariables(moduleId)
        };
    }

    /**
     * 获取模块的变量
     */
    _getModuleVariables(moduleId) {
        const moduleData = this.jumpSystem.moduleIndex.get(moduleId);
        if (!moduleData || !moduleData.module.variables) return [];

        return moduleData.module.variables.map(v => ({
            id: v.id,
            name: v.name,
            type: v.type,
            category: v.category,
            currentValue: this._getVariableValue(v.id)
        }));
    }

    /**
     * 获取模块的插件
     */
    _getModulePlugins(moduleId) {
        const moduleData = this.jumpSystem.moduleIndex.get(moduleId);
        if (!moduleData || !moduleData.module.plugins) return [];

        return moduleData.module.plugins.map(p => ({
            id: p.id,
            name: p.name,
            type: p.type,
            enabled: p.enabled,
            condition: p.condition
        }));
    }

    /**
     * 获取模块可访问的所有变量（包括父级）
     */
    _getAccessibleVariables(moduleId) {
        const variables = [];
        const moduleData = this.jumpSystem.moduleIndex.get(moduleId);

        if (!moduleData) return variables;

        // 收集当前模块的变量
        if (moduleData.module.variables) {
            variables.push(...moduleData.module.variables.map(v => ({
                ...v,
                scope: 'local'
            })));
        }

        // 收集父级变量
        let parent = moduleData.parentModule;
        let level = 1;

        while (parent) {
            if (parent.variables) {
                variables.push(...parent.variables.map(v => ({
                    ...v,
                    scope: `parent-${level}`
                })));
            }

            const parentInfo = [...this.jumpSystem.moduleIndex.values()].find(
                info => info.module === parent
            );
            parent = parentInfo ? parentInfo.parentModule : null;
            level++;
        }

        return variables;
    }

    /**
     * 获取变量值（需要与游戏引擎集成）
     */
    _getVariableValue(variableId) {
        // 实际应该从游戏引擎的变量系统获取
        return '(需要集成游戏引擎)';
    }

    /**
     * 设置变量值（调试用）
     */
    setVariable(variableId, value) {
        this.log(`Setting variable ${variableId} = ${value}`, 'variable', { variableId, value });

        if (this.gameEngine && this.gameEngine.variableSystem) {
            return this.gameEngine.variableSystem.setValue(variableId, value);
        }

        return { success: false, error: 'Variable system not available' };
    }

    /**
     * 获取当前队列
     */
    getQueue() {
        if (!this.jumpSystem) {
            return { error: 'Jump system not initialized' };
        }

        const queue = this.jumpSystem.getCurrentQueue();
        this.log(`Current queue has ${queue.length} modules`, 'queue', queue);

        return queue;
    }

    /**
     * 搜索模块
     */
    search(query) {
        if (!this.jumpSystem) {
            return { error: 'Jump system not initialized' };
        }

        const results = this.jumpSystem.searchModules(query);
        this.log(`Search "${query}" found ${results.length} results`, 'search', results);

        return results;
    }

    /**
     * 列出所有flow
     */
    listFlows() {
        if (!this.jumpSystem) {
            return { error: 'Jump system not initialized' };
        }

        const flows = [];

        for (const [flowId, flowData] of this.jumpSystem.flowIndex) {
            const modules = this.jumpSystem.getModulesInFlow(flowId);

            flows.push({
                id: flowId,
                entryEvent: flowData.entryEvent,
                moduleCount: modules.length,
                modules: modules.map(m => ({ id: m.id, name: m.name, type: m.type }))
            });
        }

        return flows;
    }

    /**
     * 完成模块（调试用）
     */
    completeModule(moduleId) {
        if (!this.jumpSystem) {
            return { success: false, error: 'Jump system not initialized' };
        }

        this.log(`Completing module: ${moduleId}`, 'jump');
        this.jumpSystem.completeModule(moduleId);

        return { success: true, moduleId };
    }

    /**
     * 重置所有模块状态
     */
    resetAllModules() {
        if (!this.jumpSystem) {
            return { success: false, error: 'Jump system not initialized' };
        }

        this.log('Resetting all module states', 'system');
        this.jumpSystem.reset();

        return { success: true };
    }

    /**
     * 导出调试报告
     */
    exportReport() {
        return {
            timestamp: new Date().toISOString(),
            snapshot: this.getSystemSnapshot(),
            recentLog: this.getLog(null, 50),
            flows: this.listFlows(),
            queue: this.getQueue()
        };
    }

    /**
     * 性能分析辅助函数
     */
    startTimer(label) {
        this.timers = this.timers || {};
        this.timers[label] = performance.now();
    }

    endTimer(label) {
        if (!this.timers || !this.timers[label]) {
            return null;
        }

        const duration = performance.now() - this.timers[label];
        this.log(`Timer "${label}": ${duration.toFixed(2)}ms`, 'performance', { label, duration });
        delete this.timers[label];

        return duration;
    }

    /**
     * 条件评估测试
     */
    testCondition(conditionDef) {
        this.log('Testing condition', 'condition', conditionDef);

        // 实际应该调用游戏引擎的条件系统
        // 这里返回模拟结果
        return {
            result: true,
            details: '(需要集成条件系统)',
            conditionDef: conditionDef
        };
    }

    /**
     * 获取模块的进入条件分析
     */
    analyzeEntryConditions(moduleId) {
        const moduleData = this.jumpSystem.moduleIndex.get(moduleId);

        if (!moduleData || !moduleData.module.entryConditions) {
            return { error: 'No entry conditions' };
        }

        return {
            moduleId: moduleId,
            moduleName: moduleData.module.name,
            conditions: moduleData.module.entryConditions,
            evaluation: this.testCondition(moduleData.module.entryConditions.conditionDef)
        };
    }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DebugSupport;
}
