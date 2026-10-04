/**
 * 游戏流程控制器
 * 负责管理当前游戏阶段、时间线推进、通用Prompt生成
 */

class GameFlow {
    constructor() {
        this.currentModule = null;
        this.timelineIndex = 0;
        this.activePlugins = new Set();
        this.debugMode = false;

        // 绑定事件
        if (typeof Events !== 'undefined' && typeof EVENT_TYPES !== 'undefined') {
            Events.on(EVENT_TYPES.MODULE_LOADED, (data) => this.loadModule(data.module));
        }
    }

    /**
     * 初始化
     */
    init() {
        if (window.ModuleManager && ModuleManager.currentModule) {
            this.loadModule(ModuleManager.currentModule);
        }
        console.log('GameFlow initialized');
    }

    /**
     * 加载当前模块数据
     */
    loadModule(module) {
        if (!module || !module.content) return;

        this.currentModule = module;
        console.log(`Loaded module: ${module.name}`);

        // 重置状态
        this.timelineIndex = 0;
        this.activePlugins.clear();

        // 加载默认开启的系统/插件
        if (module.content.systems) {
            for (const [key, system] of Object.entries(module.content.systems)) {
                if (system.enabled) {
                    this.activePlugins.add(key);
                }
            }
        }
        // 模组声明的开放插件（如 status-display、交互器）一并激活
        if (Array.isArray(module.content.openPlugins)) {
            module.content.openPlugins.forEach((id) => this.activePlugins.add(id));
        }

        // 触发更新事件
        this.emitUpdate();
    }

    /**
     * 获取通用Ask Prompt
     * @returns {string} Prompt文本
     */
    getUniversalPrompt(context = {}) {
        if (!this.currentModule) return "当前无模块";

        const timeline = this.currentModule.content.timeline || [];
        const currentEvent = timeline[this.timelineIndex];
        const prompts = this.currentModule.content.prompts || {};

        // 1. 检查是否在时间线末尾 -> 模块转换
        if (this.timelineIndex >= timeline.length - 1) {
            let template = prompts.stage_transition || "本阶段结束，是否进入下一阶段？";
            return this.formatPrompt(template, {
                current_stage: this.currentModule.name,
                condition: "时间线结束",
                next_stage: this.getNextStageName()
            });
        }

        // 2. 普通时间线推进
        let template = prompts.general_ask || "当前是【{{current_time}}】，是否继续？";
        return this.formatPrompt(template, {
            current_time: currentEvent ? currentEvent.name : "未知时间",
            action: "进入下一阶段",
            ...context
        });
    }

    /**
     * 格式化Prompt模板
     */
    formatPrompt(template, data) {
        return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
            return data[key] || match;
        });
    }

    /**
     * 获取下一阶段名称
     */
    getNextStageName() {
        // 这里应该去查找下一模块的ID对应的Name，简化处理直接返回ID
        return this.currentModule.next_stage || "无";
    }

    /**
     * 推进时间线
     */
    advanceTimeline() {
        if (!this.currentModule) return;
        const timeline = this.currentModule.content.timeline || [];

        if (this.timelineIndex < timeline.length - 1) {
            this.timelineIndex++;
            this.emitUpdate();
            return true;
        }
        return false;
    }

    /**
     * 切换到下一阶段
     */
    transitionToNextStage() {
        if (!this.currentModule) return false;

        const nextStageId = this.currentModule.next_stage;
        if (!nextStageId || nextStageId === 'none') {
            console.warn('No next stage defined');
            return false;
        }

        if (window.ModuleManager) {
            return ModuleManager.load(nextStageId);
        }
        return false;
    }

    /**
     * 作弊：跳转到指定时间点
     */
    cheatJumpToEvent(index) {
        if (!this.currentModule) return;
        const timeline = this.currentModule.content.timeline || [];
        if (index >= 0 && index < timeline.length) {
            this.timelineIndex = index;
            this.emitUpdate();
        }
    }

    /**
     * 作弊：切换插件开关
     */
    cheatTogglePlugin(pluginId, state) {
        if (state) {
            this.activePlugins.add(pluginId);
        } else {
            this.activePlugins.delete(pluginId);
        }
        this.emitUpdate();
    }

    /**
     * 发出更新通知
     */
    emitUpdate() {
        if (typeof Events !== 'undefined' && typeof EVENT_TYPES !== 'undefined') {
            Events.emit(EVENT_TYPES.GAME_FLOW_UPDATE, {
                module: this.currentModule,
                currentEvent: this.getCurrentEvent(),
                plugins: Array.from(this.activePlugins)
            });
        }
    }

    getCurrentEvent() {
        if (!this.currentModule) return null;
        const timeline = this.currentModule.content.timeline || [];
        return timeline[this.timelineIndex];
    }
}

// 导出单例
window.GameFlow = new GameFlow();
