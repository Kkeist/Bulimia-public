/**
 * Game Engine - 游戏引擎核心
 * Integrates all core systems and manages game flow
 * Compatible with external UI components (ChatDisplay, PresetManager, PersonaManager, WritingGuide)
 */

class BulimiaEngine {
    constructor() {
        // Core Systems
        this.timeSystem = null;
        this.conditionEvaluator = null;
        this.variableSystem = null;
        this.moduleSystem = null;
        this.pluginSystem = null;

        // Game state
        this.isInitialized = false;
        this.isProcessing = false;
        this.currentModule = null;
        this.moduleBasePath = 'module/';

        // Optional external systems (auto-detected)
        this.summarizer = null;
        this.autoSaveTimer = null;
    }

    /**
     * Initialize the game engine with a module
     */
    async initialize(moduleConfig) {
        if (this.isInitialized) {
            console.warn('Engine already initialized');
            return false;
        }

        // 1. Create TimeSystem
        if (moduleConfig.timeSystem) {
            this.timeSystem = new TimeSystem(moduleConfig.timeSystem);
            console.log('TimeSystem initialized');
        } else {
            console.warn('No timeSystem configuration, using default with all 6 parameters');
            // Default: all 6 system time parameters as per 01-core-schemas.md L118
            this.timeSystem = new TimeSystem({
                parameters: [
                    { id: 'year', type: 'base', systemBinding: 'year' },
                    { id: 'month', type: 'base', systemBinding: 'month' },
                    { id: 'day', type: 'base', systemBinding: 'day' },
                    { id: 'hour', type: 'base', systemBinding: 'hour' },
                    { id: 'minute', type: 'base', systemBinding: 'minute' },
                    { id: 'prefix', type: 'base', systemBinding: 'prefix' }
                ],
                initialValues: { year: 2024, month: 1, day: 1, hour: 0, minute: 0, prefix: '' },
                displayFormat: '{{year}}-{{month}}-{{day}} {{hour}}:{{minute}}'
            });
        }

        // 2. Create ConditionEvaluator with access to all systems
        this.conditionEvaluator = new ConditionEvaluator(
            () => this.timeSystem,
            () => this.variableSystem,
            () => this.moduleSystem
        );

        // 3. Create VariableSystem
        this.variableSystem = new VariableSystem(this.timeSystem, this.conditionEvaluator);

        // 4. Create ModuleSystem
        this.moduleSystem = new ModuleSystem(this.conditionEvaluator, this.variableSystem);

        // 5. Create PluginSystem
        this.pluginSystem = new PluginSystem(this.conditionEvaluator);

        // 6. Load module configuration
        if (moduleConfig.variables) {
            for (const varDef of moduleConfig.variables) {
                this.variableSystem.addVariable(varDef);
            }
            if (typeof this.variableSystem.updateBuiltinVariables === 'function') {
                this.variableSystem.updateBuiltinVariables();
            }
            console.log(`Loaded ${moduleConfig.variables.length} variables`);
        }

        if (moduleConfig.flows) {
            this.moduleSystem.loadModules(moduleConfig.flows);
            console.log(`Loaded modules from flows`);
        }

        if (moduleConfig.plugins) {
            for (const pluginDef of moduleConfig.plugins) {
                await this.pluginSystem.loadPlugin(pluginDef);
            }
            console.log(`Loaded ${moduleConfig.plugins.length} plugins`);
        }

        // 7. Build initial queue
        this.moduleSystem.buildQueue();

        this.isInitialized = true;
        console.log('BulimiaEngine initialized');

        // 8. Optional: Initialize summarizer if available
        if (typeof Summarizer !== 'undefined') {
            this.summarizer = new Summarizer();
            await this.summarizer.init?.();
        }

        // 9. Optional: Start auto-save if configured
        const autoSaveEnabled = typeof CONFIG !== 'undefined' && CONFIG.UI?.AUTO_SAVE_ENABLED;
        if (autoSaveEnabled) {
            this._startAutoSave();
        }

        return true;
    }

    /**
     * Advance time
     */
    advanceTime(changes) {
        if (!this.timeSystem) {
            console.warn('TimeSystem not initialized');
            return false;
        }

        this.timeSystem.advanceTime(changes);

        // Update builtin variables
        this.variableSystem.updateBuiltinVariables();

        // Rebuild queue (time-based modules may now be available)
        this.moduleSystem.buildQueue();

        console.log(`Time advanced to: ${this.timeSystem.formatDisplay()}`);
        return true;
    }

    /**
     * Enter a module
     */
    enterModule(moduleId) {
        const success = this.moduleSystem.enterModule(moduleId);
        if (success) {
            this.currentModule = this.moduleSystem.getModule(moduleId);
            this.moduleSystem.buildQueue();
            this._syncVariableSystemToState();
            this._runOneShotPluginsForModule(moduleId);
            console.log(`Entered module: ${this.currentModule.name}`);
        }
        return success;
    }

    /**
     * Complete current module
     */
    completeCurrentModule() {
        if (!this.currentModule) {
            console.warn('No current module to complete');
            return false;
        }

        const success = this.moduleSystem.completeModule(this.currentModule.id);
        if (success) {
            console.log(`Completed module: ${this.currentModule.name}`);
            this.currentModule = null;
            this.moduleSystem.buildQueue();
        }
        return success;
    }

    /**
     * Jump to a module (debug/cheat)
     */
    jumpToModule(moduleId) {
        const success = this.moduleSystem.jumpToModule(moduleId, true);
        if (success) {
            this.currentModule = this.moduleSystem.getModule(moduleId);
            this._syncVariableSystemToState();
            this._runOneShotPluginsForModule(moduleId);
            console.log(`Jumped to module: ${this.currentModule.name}`);
        }
        return success;
    }

    /**
     * 将 variableSystem 当前值同步到 State.variables，界面（境界等）才能显示正确
     */
    _syncVariableSystemToState() {
        if (typeof State === 'undefined' || !State.variables || !this.variableSystem || !this.variableSystem.variables) return;
        for (const [id, variable] of this.variableSystem.variables) {
            if (variable.value !== undefined) State.variables[id] = variable.value;
        }
    }

    /**
     * 进入模块时执行该模块下的一次性插件（randomizer → variable_reader → module_generator）
     */
    _runOneShotPluginsForModule(moduleId) {
        if (!this.pluginSystem || !this.moduleSystem) return;
        const context = {
            variableSystem: this.variableSystem,
            moduleSystem: this.moduleSystem,
            timeSystem: this.timeSystem
        };
        this.pluginSystem.runOneShotPluginsForModule(moduleId, context);
    }

    /**
     * Execute variable operation
     */
    modifyVariable(variableId, operation, params) {
        return this.variableSystem.executeOperation(variableId, operation, params);
    }

    /**
     * Execute variable changeRule
     */
    executeChangeRule(variableId, ruleName, aiParams = {}) {
        return this.variableSystem.executeChangeRule(variableId, ruleName, aiParams);
    }

    /**
     * Mark deliveryInfo as completed
     */
    completeDeliveryInfo(title) {
        if (!this.currentModule) return false;
        return this.currentModule.completeDeliveryInfo(title);
    }

    /**
     * Execute a plugin
     */
    executePlugin(pluginId) {
        const context = {
            variableSystem: this.variableSystem,
            moduleSystem: this.moduleSystem,
            timeSystem: this.timeSystem
        };
        return this.pluginSystem.executePlugin(pluginId, context);
    }

    /**
     * Get current game state snapshot
     */
    getState() {
        return {
            time: this.timeSystem ? this.timeSystem.formatDisplay() : 'N/A',
            currentModule: this.currentModule ? {
                id: this.currentModule.id,
                name: this.currentModule.name,
                state: this.currentModule.state
            } : null,
            queue: this.moduleSystem.getQueue(),
            variables: Array.from(this.variableSystem.variables.values()).map(v => ({
                id: v.id,
                name: v.name,
                value: v.value,
                type: v.type,
                category: v.category
            })),
            activePlugins: (this.currentModule
                ? this.pluginSystem.getActivePlugins(null, this.currentModule.id)
                : []
            ).map(p => ({ id: p.id, name: p.name, type: p.type }))
        };
    }

    /**
     * Get debug information
     */
    getDebugInfo() {
        return {
            timeSystem: {
                current: this.timeSystem.formatDisplay(),
                parameters: this.timeSystem.getAllValues()
            },
            moduleSystem: {
                totalModules: this.moduleSystem.modules.size,
                currentModule: this.currentModule?.name,
                queueLength: this.moduleSystem.getQueue().length
            },
            variableSystem: {
                totalVariables: this.variableSystem.variables.size,
                byCategory: {
                    module: Array.from(this.variableSystem.variables.values()).filter(v => v.category === 'module').length,
                    switch: Array.from(this.variableSystem.variables.values()).filter(v => v.category === 'switch').length,
                    builtin: Array.from(this.variableSystem.variables.values()).filter(v => v.category === 'builtin').length,
                    temp: Array.from(this.variableSystem.variables.values()).filter(v => v.category === 'temp').length
                }
            },
            pluginSystem: {
                totalPlugins: this.pluginSystem.plugins.size,
                activePlugins: this.pluginSystem.getActivePlugins().length
            }
        };
    }

    // ==================== Compatibility Methods ====================

    /**
     * Main advance loop - handles user input and AI interaction
     * @param {string} userInput - User input
     * @returns {Object} Processing result
     */
    async advance(userInput) {
        if (this.isProcessing) {
            if (typeof Toast !== 'undefined') {
                Toast.show('正在处理中，请稍候...', 'warning');
            }
            console.warn('Already processing, please wait...');
            return null;
        }

        this.isProcessing = true;
        if (typeof Events !== 'undefined') {
            Events.emit('api_request_start');
        }

        try {
            // 1. Collect current state
            const currentState = this._collectState();

            // 2. Get active worldbooks
            const worldbooks = await this._getActiveWorldbooks(currentState);

            // 3. Get plugin pending content (including interactive-save)
            const pluginData = (typeof InteractiveSaveDriver !== 'undefined' && InteractiveSaveDriver.getAllPendingPrompt?.()) || this.pluginSystem?.getPendingPrompt?.() || '';

            // 4. Get summary content if available
            const summaryData = this.summarizer?.getCurrentSummary?.() || '';

            // 5. Build base segments (each with injection_depth/order) + user message
            const built = this._buildBaseMessages({
                currentState,
                worldbooks,
                pluginData,
                summaryData,
                userInput
            });
            const baseSegments = built.segments || [];
            const userMessage = built.userMessage || { role: 'user', content: userInput };

            // 6. Merge game segments with WritingGuide + Preset so all inject by depth/order (interleaved)
            const promptsToInject = [...baseSegments];

            if (typeof WritingGuide !== 'undefined' && WritingGuide.getEntries) {
                const wgEntries = WritingGuide.getEntries().filter(e => e.enabled);
                promptsToInject.push(...wgEntries);
            }

            if (typeof PresetManager !== 'undefined' && PresetManager.currentPreset) {
                const absolutePrompts = PresetManager.getAbsolutePromptsForInjection?.() || [];
                promptsToInject.push(...absolutePrompts);
            }

            // 7. Inject by depth: all items (game segments, worldbooks, WritingGuide, Preset) in one list;
            //    populationInjectionPrompts 按 depth 升序、同 depth 内按 injection_order 降序注入，实现交错
            const baseMessages = [userMessage];
            let finalPrompt = baseMessages;
            if (promptsToInject.length > 0 && typeof PresetManager !== 'undefined' && PresetManager.populationInjectionPrompts) {
                finalPrompt = PresetManager.populationInjectionPrompts(promptsToInject, baseMessages);
            } else if (baseSegments.length > 0) {
                finalPrompt = baseSegments.map(s => ({ role: s.role, content: s.content })).concat(userMessage);
            }

            // 8. Replace {{user}} placeholder (PersonaManager) in all messages
            if (typeof PersonaManager !== 'undefined' && PersonaManager.current?.name) {
                const userName = PersonaManager.current.name;
                finalPrompt = finalPrompt.map(msg => ({
                    ...msg,
                    content: msg.content.replace(/\{\{user\}\}/g, () => userName) // 2026-06-05：function 形式防 $-marker，同 app.js replaceUser
                }));
            }

            // 9. Record prompt log
            if (typeof State !== 'undefined' && State.addPromptLog) {
                const fullPrompt = Array.isArray(finalPrompt) ?
                    finalPrompt.map(m => `${m.role}: ${m.content}`).join('\n\n') : finalPrompt;
                State.addPromptLog({
                    type: 'advance',
                    prompt: fullPrompt,
                    fullLength: fullPrompt.length,
                    timestamp: Date.now()
                });
            }

            // 10. Create streaming message (if ChatDisplay available)
            let streamingMsg = null;
            let fullContent = '';
            let thinkingContent = '';

            if (typeof ChatDisplay !== 'undefined' && ChatDisplay.createStreamingMessage) {
                streamingMsg = ChatDisplay.createStreamingMessage();
            }

            // 11. Call API (streaming preferred)
            let response;

            if (typeof APIConnection !== 'undefined' && APIConnection.send) {
                response = await APIConnection.send(finalPrompt, {
                    stream: true,
                    onChunk: (chunk, accumulated) => {
                        fullContent = accumulated;

                        // Real-time thinking extraction
                        const thinkingMatch = accumulated.match(/<thinking>([\s\S]*?)<\/thinking>/i);
                        if (thinkingMatch) {
                            thinkingContent = thinkingMatch[1].trim();
                            if (streamingMsg) {
                                streamingMsg.message.thinking = thinkingContent;
                            }
                        }

                        // Update display (remove thinking tags and system tags)
                        if (streamingMsg && typeof ChatDisplay !== 'undefined' && ChatDisplay.updateStreamingMessage) {
                            let displayContent = accumulated.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
                            displayContent = displayContent.replace(/【User[：:]\s*】/gi, '');
                            displayContent = displayContent.replace(/【AI[：:]\s*】/gi, '');
                            displayContent = displayContent.replace(/【系统[：:]\s*】/gi, '');
                            displayContent = displayContent.replace(/\[User[：:]\s*\]/gi, '');
                            displayContent = displayContent.replace(/\[AI[：:]\s*\]/gi, '');
                            displayContent = displayContent.replace(/\[System[：:]\s*\]/gi, '');
                            ChatDisplay.updateStreamingMessage(streamingMsg.index, displayContent);
                        }
                    }
                });

                // Finish streaming output
                if (streamingMsg && typeof ChatDisplay !== 'undefined' && ChatDisplay.finishStreamingMessage) {
                    ChatDisplay.finishStreamingMessage(streamingMsg.index);
                }
            } else {
                // Mock response
                response = { success: true, content: `[系统]: 收到输入 "${userInput}"，但当前没有连接到AI API。这是一个模拟响应。` };
            }

            // 12. Parse response (uses AI tag format, no special TF/value parsing)
            const parsed = {
                content: response.content || fullContent,
                thinking: response.thinking || thinkingContent || null,
                raw: response.raw
            };

            // Final content cleanup
            const finalParsed = this._parseResponse({ content: parsed.content });
            parsed.content = finalParsed.content;

            // 13. Parse AI tags and execute operations (core feature)
            // TODO: Implement AI tag parser for <var|...>, <rule|...>, <module|...>, <time|...>, etc.
            // const aiOperations = this._parseAITags(parsed.content);
            // await this._executeAIOperations(aiOperations);

            // 14. Clear pending (all plugins)
            if (typeof InteractiveSaveDriver !== 'undefined' && InteractiveSaveDriver.clearAllPending) {
                InteractiveSaveDriver.clearAllPending();
            }
            this.pluginSystem?.clearPending?.();

            // 15. Update streaming message thinking (if exists)
            if (parsed.thinking && streamingMsg && typeof ChatDisplay !== 'undefined') {
                streamingMsg.message.thinking = parsed.thinking;
                // Re-render to show thinking collapse
                const msgEl = ChatDisplay.container?.querySelector?.(`[data-index="${streamingMsg.index}"]`);
                if (msgEl) {
                    msgEl.remove();
                    ChatDisplay._renderMessage?.(streamingMsg.message, streamingMsg.index);
                }
            }

            // 16. Add to chat history
            const assistantMsg = {
                role: 'assistant',
                content: parsed.content,
                thinking: parsed.thinking || null
            };

            if (typeof State !== 'undefined' && State.addChatMessage) {
                State.addChatMessage({ role: 'user', content: userInput });
                State.addChatMessage(assistantMsg);
            }

            // 17. Check if summarization needed
            await this.summarizer?.checkAndSummarize?.();

            // 18. Update token stats
            if (response.usage && typeof State !== 'undefined' && State.updateTokenStats) {
                State.updateTokenStats(response.usage.total_tokens);
            }

            if (typeof Events !== 'undefined') {
                Events.emit('api_request_success', parsed);
            }

            return {
                success: true,
                content: parsed.content,
                thinking: parsed.thinking
            };

        } catch (error) {
            console.error('Advance error:', error);
            if (typeof Events !== 'undefined') {
                Events.emit('api_request_error', error);
            }

            return {
                success: false,
                canReroll: true,
                error: error.message
            };
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Quick advance using advancer system
     */
    async advanceQuick(type, customRequest = '') {
        if (typeof Advancer === 'undefined') {
            if (typeof Toast !== 'undefined') {
                Toast.show('推进器系统未初始化', 'error');
            }
            return { success: false, error: '推进器系统未初始化' };
        }
        const advancePrompt = Advancer.buildAdvancePrompt?.(type, customRequest) || customRequest;
        return this.advance(advancePrompt);
    }

    /**
     * Collect current state
     */
    _collectState() {
        const state = {
            currentModule: this.currentModule,
            currentTime: this.timeSystem?.formatDisplay(),
            timeParameters: this.timeSystem?.getAllValues() || {},
            variables: {},
            moduleQueue: this.moduleSystem.getQueue(),
            activePlugins: this.pluginSystem.getActivePlugins().map(p => ({ id: p.id, name: p.name, type: p.type }))
        };

        // Collect all variables with their categories
        for (const variable of this.variableSystem.variables.values()) {
            state.variables[variable.id] = {
                value: variable.value,
                type: variable.type,
                category: variable.category,
                name: variable.name
            };
        }

        // Module state
        state.allModules = [];
        for (const module of this.moduleSystem.modules.values()) {
            state.allModules.push({
                id: module.id,
                name: module.name,
                state: module.state,
                type: module.type
            });
        }

        // External state (if available)
        if (typeof State !== 'undefined') {
            state.gameState = State.gameState;
            state.values = State.values;
            state.knownNPCs = Array.from(State.knownNPCs?.keys() || []);
            state.completedTriggers = Array.from(State.completedTriggers || []);
            state.currentPhase = State.gameState?.majorPhase;
            state.currentLocation = State.gameState?.currentLocation;
        }

        return state;
    }

    /**
     * Get active worldbooks
     */
    async _getActiveWorldbooks(currentState) {
        const worldbooks = [];

        // From WorldBookManager if available
        if (typeof WorldBookManager !== 'undefined' && WorldBookManager.filterByConditions) {
            try {
                const active = await WorldBookManager.filterByConditions(currentState);
                worldbooks.push(...active);
            } catch (e) {
            }
            return worldbooks;
        }
        return worldbooks;
    }

    /**
     * Build base segments + user message for injection.
     * 深度：游戏段落固定 depth 0~4、order 300；世界书按条目的 injection_depth/injection_order（无则默认 depth 4、order 250）。
     * 与 WritingGuide、Preset 一起交给 populationInjectionPrompts 按 depth → order 统一注入、交错排列。
     */
    _buildBaseMessages(data) {
        const {
            currentState,
            worldbooks,
            pluginData,
            summaryData,
            userInput
        } = data;

        const segments = [];
        const GAME_ORDER = 300;

        // 有前端插件：仅在所在模块内展示（当前模块 = 插件 ownerModuleId 时才加入 prompt）
        const activeInteractive = this.pluginSystem.getPluginsByType('interactive')
            .concat(this.pluginSystem.getPluginsByType('display_interactive'))
            .filter(p => p.shouldBeActive(this.conditionEvaluator) && (!this.currentModule || p.ownerModuleId === this.currentModule.id));

        // Depth 0: background
        let block = '```background\n';
        block += `当前时间：${currentState.currentTime}\n`;
        if (this.currentModule) {
            block += `\n【${this.currentModule.name}】\n`;
            for (const info of this.currentModule.info) {
                block += `${info.content}\n`;
            }
        }
        block += '```\n\n';
        segments.push({ role: 'system', content: block, injection_depth: 0, injection_order: GAME_ORDER });

        // Depth 1: interactors + variables
        block = '';
        if (activeInteractive.length > 0) {
            block += '```interactors\n';
            for (const plugin of activeInteractive) {
                let segment = (plugin.config.promptTemplate || '');
                segment = segment.replace(/\{\{(\w+)\}\}/g, (match, varId) => {
                    const v = this.variableSystem.getValue(varId);
                    return v !== undefined && v !== null ? String(v) : match;
                });
                block += `【${plugin.name}】(blockId: ${plugin.config.blockId || plugin.id})\n`;
                block += segment + '\n';
                block += `回复格式: <plugin|${plugin.id}|参数列表>\n\n`;
            }
            block += '```\n\n';
        }
        block += '```variables\n【变量】\n';
        for (const variable of this.variableSystem.variables.values()) {
            if (variable.category === 'builtin' || variable.category === 'temp') continue;
            block += `${variable.name} (${variable.id}, ${variable.type}): ${JSON.stringify(variable.value)}\n`;
            if (variable.generalRules) block += `  规则: ${variable.generalRules}\n`;
            if (variable.supportedOperations && variable.supportedOperations.length > 0) {
                for (const op of variable.supportedOperations) {
                    const params = Object.entries(op.params || {}).map(([k, v]) => `${k}=${v}`).join(', ');
                    block += `  ${op.operation}(${params}): ${op.description}\n`;
                }
            }
            if (variable.changeRules && variable.changeRules.length > 0) {
                for (const rule of variable.changeRules) {
                    const hasParams = rule.value && typeof rule.value === 'string' && rule.value.includes('$param');
                    block += `  <rule|${variable.id}|${rule.name}${hasParams ? '|参数' : ''}>\n`;
                }
            }
        }
        block += '```\n\n';
        segments.push({ role: 'system', content: block, injection_depth: 1, injection_order: GAME_ORDER });

        // Depth 2: queue + delivery
        block = '```queue\n';
        const queue = this.moduleSystem.getQueue();
        if (queue.length > 0) {
            block += '【当前队列】（可立即操作）\n';
            for (const moduleId of queue) {
                const module = this.moduleSystem.getModule(moduleId);
                if (!module) continue;
                block += `- ${module.name} (${module.type})\n`;
                if (this.moduleSystem.canCompleteModule(moduleId)) {
                    const pendingDelivery = this.moduleSystem.getPendingDeliveryInfoForModule(module);
                    if (pendingDelivery.length > 0) {
                        const titles = pendingDelivery.map(d => `"${d.title}"`).join(', ');
                        block += `  可完成: <module|complete|${moduleId}> (需确认deliveryInfo: ${titles})\n`;
                    } else {
                        block += `  可完成: <module|complete|${moduleId}>\n`;
                    }
                } else if (this.moduleSystem.canEnterModule(moduleId)) {
                    block += `  可进入: <module|enter|${moduleId}>\n`;
                }
                block += '\n';
            }
        } else {
            block += '【当前队列】（空）\n';
        }
        block += '```\n\n';
        if (this.currentModule) {
            const pending = this.moduleSystem.getPendingDeliveryInfoForModule(this.currentModule);
            if (pending.length > 0) {
                block += '```delivery\n【待确认投递信息】\n';
                pending.forEach((d, i) => {
                    block += `${i + 1}. ${d.title}\n`;
                    block += `   内容: ${d.content}\n`;
                    block += `   确认格式: <delivery|${d.title}|done>\n\n`;
                });
                block += '```\n\n';
            }
        }
        segments.push({ role: 'system', content: block, injection_depth: 2, injection_order: GAME_ORDER });

        // Depth 3: 操作提示（v5 真实路径生效格式：块格式，不是内联管道）
        block = '【操作提示】\n你可以：\n';
        block += '1. 改变量：用 <variables>...</variables> 块，每行「变量名<TAB>新值」（增减：变量名<TAB>+10）。\n';
        block += '2. 确认投递：用 <delivery_completed>...</delivery_completed> 块，每行「投递标题<TAB>完成」。\n';
        block += '3. 模块完成的剧情要点（可选）：用 <module_summary> 块写一行。\n';
        block += '4. 事件进入/完成由系统按条件自动推进，AI 不需要主动写指令推。\n\n';
        segments.push({ role: 'system', content: block, injection_depth: 3, injection_order: GAME_ORDER });

        // Depth 4: summary only (worldbooks go in as separate segments by their own depth/order below)
        if (summaryData) {
            segments.push({
                role: 'system',
                content: `【总结】\n${summaryData}\n\n`,
                injection_depth: 4,
                injection_order: GAME_ORDER
            });
        }

        // Worldbooks: each entry as its own segment with its injection_depth / injection_order (interleaved by rules)
        const WB_DEFAULT_DEPTH = 4;
        const WB_DEFAULT_ORDER = 250;
        if (worldbooks && worldbooks.length > 0) {
            for (const wb of worldbooks) {
                const content = (wb.content && String(wb.content).trim()) || '';
                if (!content) continue;
                const label = wb.id || wb.name || wb.identifier || 'worldbook';
                const text = `[${label}]\n${content}`;
                const depth = wb.injection_depth ?? wb.injectionDepth ?? wb.depth ?? WB_DEFAULT_DEPTH;
                const order = wb.injection_order ?? wb.injectionOrder ?? wb.order ?? WB_DEFAULT_ORDER;
                segments.push({
                    role: 'system',
                    content: text,
                    injection_depth: depth,
                    injection_order: order
                });
            }
        }

        return {
            segments,
            userMessage: { role: 'user', content: userInput }
        };
    }

    /**
     * Build prompt as message array (for PresetManager compatibility)
     */
    _buildPromptAsMessages(data) {
        const built = this._buildBaseMessages(data);
        const messages = (built.segments || []).map(s => ({ role: s.role, content: s.content }));
        messages.push(built.userMessage || { role: 'user', content: data.userInput });
        return messages;
    }

    /**
     * Parse AI response
     */
    _parseResponse(response) {
        let content = response.content || response;
        let thinking = null;

        const thinkingMatch = content.match(/<thinking>([\s\S]*?)<\/thinking>/i);
        if (thinkingMatch) {
            thinking = thinkingMatch[1].trim();
            content = content.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
        }

        content = content.replace(/【User[：:]\s*】/gi, '');
        content = content.replace(/【AI[：:]\s*】/gi, '');
        content = content.replace(/【系统[：:]\s*】/gi, '');
        content = content.replace(/\[User[：:]\s*\]/gi, '');
        content = content.replace(/\[AI[：:]\s*\]/gi, '');
        content = content.replace(/\[System[：:]\s*\]/gi, '');

        content = content.replace(/\n{3,}/g, '\n\n').trim();

        return {
            content: content.trim(),
            thinking,
            raw: response
        };
    }

    /**
     * Start auto-save
     * 2026-06-05 防泄漏：先 clear 旧 timer 再 setInterval；init() 重复调用（reload 模组等）不会多个 timer 同时跑。
     */
    _startAutoSave() {
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
            this.autoSaveTimer = null;
        }
        const interval = (typeof CONFIG !== 'undefined' && CONFIG.UI?.AUTO_SAVE_INTERVAL) || 60000;
        this.autoSaveTimer = setInterval(() => {
            this.autoSave();
        }, interval);
    }

    /**
     * Auto-save
     */
    async autoSave() {
        if (!this.isInitialized) return;
        if (typeof State !== 'undefined' && State.getSnapshot && typeof Storage !== 'undefined' && Storage.saveGame) {
            const snapshot = State.getSnapshot();
            await Storage.saveGame('autosave', snapshot);
            if (typeof Events !== 'undefined') {
                Events.emit('auto_save');
            }
        }
    }

    /**
     * Stop engine
     */
    stop() {
        this.isInitialized = false;
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
            this.autoSaveTimer = null;
        }
    }

    /**
     * New game
     */
    async newGame() {
        if (typeof State !== 'undefined' && State.reset) {
            State.reset();
        }
        await this.initialize(this.moduleSystem.rootModule);
    }

    /**
     * Load save
     */
    async loadSave(saveId) {
        if (typeof Storage !== 'undefined' && Storage.loadGame) {
            const save = await Storage.loadGame(saveId);
            if (save && save.data && typeof State !== 'undefined' && State.restoreFromSnapshot) {
                State.restoreFromSnapshot(save.data);
                return true;
            }
        }
        return false;
    }
}

// Export for browser use
if (typeof window !== 'undefined') {
    window.BulimiaEngine = BulimiaEngine;
}

// Export for Node.js use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { BulimiaEngine };
}
