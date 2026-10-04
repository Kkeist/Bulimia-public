/**
 * 回复落地：把 AI 回复里的指令（变量、事件、时间、投递、伏笔、插件、总结）落到游戏状态上，
 * 并给出每一条「生效了什么」或「为什么没生效」。
 * 扩展 App（app.js 先加载）。
 */
Object.assign(App, {
    /** 插件回复块单条正文、对话记录总长的上限 */
    MAX_PLUGIN_REPLY_LEN: 5000,
    MAX_PLUGIN_LOG_LEN: 100000,
    PLUGIN_LOG_TRIM: 10000,

    /**
     * 从 API 返回对象中取出原始正文字符串（兼容 response 为 {} 或 content 非字符串）
     * @param {{ content?: string, raw?: object }} response - APIConnection.send 的返回值
     * @returns {string}
     */
    _getRawContentFromResponse(response) {
        if (!response) return '';
        if (typeof response.content === 'string' && response.content) return response.content;
        const raw = response.raw;
        if (raw && typeof raw === 'object') {
            if (typeof raw.fullContent === 'string') return raw.fullContent; // 流式返回
            if (typeof raw.choices?.[0]?.message?.content === 'string') return raw.choices[0].message.content;
            if (Array.isArray(raw.content)) return raw.content.filter(b => b.type === 'text').map(b => b.text || '').join('\n');
        }
        return '';
    },

    /** 写入原始回复到当前消息（State + ChatDisplay），存档用 ChatDisplay.messages，必须都写上 */
    _setMessageRawContent(index, response, processed) {
        const raw = this._getRawContentFromResponse(response) || (processed && processed.content) || '';
        const msg = (State.chatHistory && State.chatHistory[index]) ? State.chatHistory[index] : null;
        if (msg) msg.rawContent = raw;
        if (typeof ChatDisplay !== 'undefined' && ChatDisplay.messages && ChatDisplay.messages[index]) {
            ChatDisplay.messages[index].rawContent = raw;
        }
    },

    /**
     * 把一条完整的 AI 回复落到游戏状态上。
     * 用状态装一套核心系统，按本回合发给 AI 的可操作范围执行全部指令，再把结果写回状态。
     * @param {string} raw - AI 回复原文
     * @param {object} processed - _processResponseContent 的结果
     * @param {object} ctx - 发送时记录的范围 { moduleIds, variableIds, conditionalTitles, turn }
     * @param {object} [opts] - turnSummary：本轮摘要全文
     * @returns {{ effects: Array<{kind, tag, ok, summary, reason, quiet, ignored}> }}
     */
    _applyReplyEffects(raw, processed, ctx, opts = {}) {
        const effects = [];
        const text = String(raw || '');
        const scanned = TagParser.scan(text);
        const hasInstructions = scanned.tags.length > 0 || scanned.malformed.length > 0;
        const config = this.getEngineConfig();
        if (!config) {
            if (hasInstructions) effects.push({ kind: 'unknown', tag: '', ok: false, summary: '', reason: '当前模组没有可用的游戏数据，AI 回复里的指令都没有执行' });
            this._finishReplyEffects(effects);
            return { effects };
        }

        let engine = null;
        try {
            engine = RuntimeBridge.build(config, State);
            const ss = engine.summarySystem;
            ss.startNewInteraction();
            const tp = engine.tagParser;
            tp.setScope({ moduleIds: (ctx && ctx.moduleIds) || [], variableIds: (ctx && ctx.variableIds) || [] });

            const postWrites = [];
            effects.push(...tp.applyAll(text).effects);
            effects.push(...this._applyLegacyBlocks(text, processed, tp));
            this._applyPluginEffects(effects, engine, postWrites);
            effects.push(...this._applyPluginReplyBlocks(text, engine, postWrites));

            if (opts.turnSummary) ss.addSingleSummary(opts.turnSummary, ((ctx && ctx.turn) || 0) + 1);
            if (processed && processed.moduleSummary) {
                const ms = engine.moduleSystem;
                const curId = ms.getCurrentModuleIds().filter(id => id !== ms.rootModuleId)[0];
                if (curId) ss.setModuleSummary(curId, processed.moduleSummary);
            }
            if (ctx && ctx.conditionalTitles && ctx.conditionalTitles.length) {
                ss.markConditionalDeliveriesShown(ctx.conditionalTitles, ctx.turn);
            }

            const pathBefore = JSON.stringify(State.currentModulePath);
            RuntimeBridge.commit(engine);
            postWrites.forEach(([key, value]) => { State.variables[key] = value; });
            if (JSON.stringify(State.currentModulePath) !== pathBefore) this._afterModulePathChanged(config, effects);
        } catch (e) {
            console.error('落地 AI 回复里的指令时出错:', e);
            effects.push({ kind: 'unknown', tag: '', ok: false, summary: '', reason: '处理指令时出错：' + (e && e.message ? e.message : e) + '。这一轮的指令都没有生效' });
        }
        this._finishReplyEffects(effects);
        return { effects };
    },

    /** 记下没生效的指令（下一轮提示词里提醒 AI）并通知界面刷新。 */
    _finishReplyEffects(effects) {
        State.lastFailedOps = effects.filter(e => !e.ok && !e.quiet && !e.ignored && e.tag).map(e => ({ name: e.tag, reason: e.reason }));
        if (window.Events && window.EVENT_TYPES) Events.emit(EVENT_TYPES.GAME_FLOW_UPDATE);
        if (typeof this.updateSystemStatusBar === 'function') this.updateSystemStatusBar();
    },

    /** 事件进度变了：重新收集当前路径上的插件，并运行刚进入的事件上的模块生成器。 */
    _afterModulePathChanged(config, effects) {
        const cur = ModuleManager.getCurrent();
        if (window.PluginRegistry && PluginRegistry.registerFromModule) PluginRegistry.registerFromModule();
        if (!cur) return;
        const paths = RuntimeBridge.normalizePaths(State.currentModulePath, config.id);
        for (const path of paths) {
            try {
                this._runModuleGeneratorsForCurrentPath(cur, path);
            } catch (e) {
                effects.push({ kind: 'plugin', tag: '', ok: false, summary: '', reason: '模块生成器出错：' + (e && e.message ? e.message : e) });
            }
        }
    },

    /** 旧写法：<variables> 块里每行「变量名 = 值」、<delivery_completed> 块里每行「标题 完成」，走同一套校验。 */
    _applyLegacyBlocks(text, processed, tp) {
        const out = [];
        const vars = TagParser.extractBlock(text, 'variables');
        if (vars != null) {
            vars.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 200).forEach(line => {
                const m = line.match(/^([^\t=]+)[\t=](.*)$/);
                if (!m) return;
                const name = m[1].trim();
                let value = m[2].trim();
                let op = 'set';
                let n;
                if (/^\+\s*\d/.test(value)) { op = 'add'; value = value.replace(/^\+\s*/, ''); }
                else if (/^-\s*\d/.test(value) && !isNaN(n = Number(value.replace(/^-\s*/, '')))) { op = 'subtract'; value = String(n); }
                out.push(tp.applyTag({ type: 'var', args: [name, op, value], raw: '<variables> ' + line, key: 'variables|' + line }));
            });
        }
        const done = processed && Array.isArray(processed.deliveryCompleted) ? processed.deliveryCompleted : [];
        done.forEach(entry => {
            if (!entry || !entry.id) return;
            out.push(tp.applyTag({ type: 'delivery', args: [entry.id, entry.completed ? 'done' : 'uncompleted'], raw: '<delivery_completed> ' + entry.id, key: 'dc|' + entry.id }));
        });
        return out;
    },

    /** <plugin|名字|内容> 指令：交互插件收到回复，模块生成器生成模块。结果直接写回对应的 effect。 */
    _applyPluginEffects(effects, engine, postWrites) {
        for (const eff of effects) {
            if (!eff.ok || !eff.plugin) continue;
            const p = eff.plugin;
            if (p.type === 'module_generator') {
                const tpl = p.config && p.config.moduleTemplate;
                const flowKey = p.config && p.config.outputFlow;
                if (!tpl || !flowKey) { eff.ok = false; eff.reason = '「' + (p.name || p.id) + '」缺少要生成的模块'; continue; }
                const added = ModuleManager.addDynamicSubModuleFromRaw(tpl, flowKey);
                if (!added) { eff.ok = false; eff.reason = '「' + (tpl.name || tpl.id) + '」已经生成过了'; continue; }
                eff.summary = '生成了「' + (tpl.name || tpl.id) + '」';
                continue;
            }
            if (p.type !== 'interactive' && p.type !== 'display_interactive') {
                eff.ok = false;
                eff.reason = '「' + (p.name || p.id) + '」不接收 AI 的回复';
                continue;
            }
            const res = this._deliverPluginReply(p, p.content, engine, postWrites);
            if (!res.ok) { eff.ok = false; eff.reason = res.reason; continue; }
            if (res.note) eff.summary += res.note;
        }
    },

    /** 回复里的插件块（如 <npc_chat>...</npc_chat>）：按插件配置写进变量（规则见 PluginRuntime.applyReply）。 */
    _applyPluginReplyBlocks(text, engine, postWrites) {
        const out = [];
        const adapter = engine.tagParser.pluginSystem;
        if (!adapter || typeof adapter.getActivePlugins !== 'function') return out;
        const store = PluginRuntime.storeFromVariableSystem(engine.variableSystem);
        for (const plugin of adapter.getActivePlugins(null)) {
            if (plugin.type !== 'interactive' && plugin.type !== 'display_interactive') continue;
            if (!plugin.config || !plugin.config.blockId) continue;
            const r = PluginRuntime.applyReply(plugin, text, store);
            if (!r.found) continue;
            if (window.PluginRegistry && PluginRegistry.noteReply) PluginRegistry.noteReply(plugin.id, r);
            const note = this._pluginReplyNote(r);
            const tag = '<' + plugin.config.blockId + '>';
            if (r.unbound) out.push({ kind: 'plugin', tag, ok: false, summary: '', reason: '「' + (plugin.name || plugin.id) + '」还没有设置回复要写进哪个变量，回复没有保存' });
            else if (r.errors.length && !r.changes.length) out.push({ kind: 'plugin', tag, ok: false, summary: '', reason: '「' + (plugin.name || plugin.id) + '」的回复没有写入：' + r.errors.join('；') });
            else out.push({ kind: 'plugin', tag, ok: true, summary: '「' + (plugin.name || plugin.id) + '」收到回复' + note });
        }
        return out;
    },

    /** 回复写入时需要补充给玩家看的说明（内容被截短、记录被清理、部分没写入）。 */
    _pluginReplyNote(r) {
        let note = '';
        if (r.truncated) note += '（内容太长，只保留了前 5000 个字）';
        if (r.changes.some(c => c.trimmed)) note += '（记录太长，较早的内容已清理）';
        if (r.errors.length && r.changes.length) note += '（部分没有写入：' + r.errors.join('；') + '）';
        return note;
    },

    /**
     * <plugin|名字|内容> 指令：把内容当作 AI 给这个插件的回复，写进插件配置的变量。
     * @returns {{ ok: boolean, note: string, reason: string }}
     */
    _deliverPluginReply(plugin, body, engine, postWrites) {
        const store = PluginRuntime.storeFromVariableSystem(engine.variableSystem);
        const r = PluginRuntime.deliverReply(plugin, body, store);
        if (window.PluginRegistry && PluginRegistry.noteReply) PluginRegistry.noteReply(plugin.id, r);
        if (r.unbound) return { ok: false, note: '', reason: '「' + (plugin.name || plugin.id) + '」还没有设置回复要写进哪个变量，回复没有保存' };
        if (r.errors.length && !r.changes.length) return { ok: false, note: '', reason: '「' + (plugin.name || plugin.id) + '」的回复没有写入：' + r.errors.join('；') };
        return { ok: true, note: this._pluginReplyNote(r), reason: '' };
    },

    /**
     * 进入新事件之后，运行新进入的各层模块下的一次性插件（随机器、变量读取器、变量操作器、模块生成器）。
     * 新游戏的第一次进入也包含故事根上的插件。运行规则见 PluginRegistry.onEnter。
     */
    _runModuleGeneratorsForCurrentPath(cur, pathIds) {
        if (!window.PluginRegistry || !PluginRegistry.onEnter) return;
        PluginRegistry.onEnter(pathIds).then(res => {
            if (res.errors.length && window.Toast) Toast.show('有插件在进入模块时没能运行，详情见调试里的插件测试。', 'warning');
        });
    },

    /**
     * 记下这一轮指令的执行结果：存在这条 AI 消息上，并在聊天里给玩家一条说明。
     * 状态回退点只留在最新一条 AI 消息上（重新生成时用）。
     */
    _recordReplyEffects(index, effects, preTurnState, info) {
        const msg = ChatDisplay.messages[index];
        if (!msg) return;
        const compact = effects.filter(e => !e.quiet).map(e => ({ kind: e.kind, tag: e.tag, ok: e.ok, summary: e.summary, reason: e.reason || '' }));
        msg.effects = compact;
        if (info) {
            // 每个版本各存一份当时的原文、范围和结果，切换版本时按它重放
            if (!Array.isArray(msg.swipeData)) msg.swipeData = [];
            const version = Number.isInteger(info.version) ? info.version : (msg.swipes ? msg.swipes.length : 0);
            msg.swipeData[version] = { raw: info.raw, ctx: info.ctx, turnSummary: info.turnSummary || null, effects: compact };
            while (msg.swipeData.length > 20) msg.swipeData.shift();
        }
        if (preTurnState) {
            (ChatDisplay.messages || []).forEach(m => { if (m && m.role === 'assistant' && m !== msg) delete m.preTurnState; });
            msg.preTurnState = preTurnState;
        }
        this._removeLastReport(msg.id);
        const text = this._effectsReportText(effects);
        if (text) ChatDisplay.addMessage({ role: 'system', content: text, uiOnly: true, tagReport: true, reportFor: msg.id });
        this.scheduleSummaryJob();
    },

    /**
     * 左右切换回复版本之后调用：把游戏状态也切到那个版本。
     * 状态先退回这一回合开始前，再重放该版本的指令，保证显示的版本和状态一致。
     */
    onSwipeSwitched(index) {
        const msg = ChatDisplay.messages[index];
        if (!msg || msg.role !== 'assistant' || !Array.isArray(msg.swipes)) return;
        const version = msg.swipeId || 0;
        const data = msg.swipeData && msg.swipeData[version];
        if (!msg.preTurnState) {
            Toast.show('只有最新一条回复切换版本时，游戏状态才会跟着变。', 'info', 5000);
            return;
        }
        if (!data) {
            Toast.show('这个版本没有保存当时的游戏变化，游戏状态保持不变。', 'warning', 6000);
            return;
        }
        this._restoreTurnState(msg.preTurnState);
        const processed = this._processResponseContent(data.raw, Storage.getSettings() || {});
        const applied = this._applyReplyEffects(data.raw, processed, data.ctx, { turnSummary: data.turnSummary });
        msg.rawContent = data.raw;
        msg.turnSummary = data.turnSummary;
        this._recordReplyEffects(index, applied.effects, null, { version, raw: data.raw, ctx: data.ctx, turnSummary: data.turnSummary });
    },

    /** 重新生成时撤掉这条消息上一次的说明（它一定是聊天里最后一条）。 */
    _removeLastReport(assistantId) {
        const list = ChatDisplay.messages || [];
        const last = list[list.length - 1];
        if (!last || !last.tagReport || last.reportFor !== assistantId) return;
        list.pop();
        State.chatHistory = (State.chatHistory || []).filter(m => m && m.id !== last.id);
        const el = ChatDisplay.container && ChatDisplay.container.querySelector('[data-index="' + list.length + '"]');
        if (el) el.remove();
    },

    /**
     * 给玩家看的一段说明：这一轮 AI 的指令哪些生效了、哪些没生效以及原因。没有可说的返回空字符串。
     */
    _effectsReportText(effects) {
        const shown = (effects || []).filter(e => !e.quiet);
        const okList = shown.filter(e => e.ok);
        const badList = shown.filter(e => !e.ok);
        const parts = [];
        if (okList.length) parts.push('**本轮变化**\n' + okList.map(e => '- ' + e.summary).join('\n'));
        if (badList.length) parts.push('**没有生效**\n' + badList.map(e => '- ' + (e.tag ? '`' + e.tag + '`：' : '') + e.reason).join('\n'));
        return parts.join('\n\n');
    },

    /**
     * 为本轮摘要填入 serial 与 time（由系统根据变量自动填入，AI 只填 scene/plot）
     * @param {string} rawSummary - AI 输出的 scene + plot 两行
     * @param {{ increment?: boolean }} [opts] - increment 为 false 时不递增 turnSerial（用于 reroll 同一回合）
     * @returns {string} 完整四行：serial + time + rawSummary
     */
    _normalizeTurnSummary(rawSummary, opts = {}) {
        if (!rawSummary || !String(rawSummary).trim()) return rawSummary || '';
        if (!State.variables) {
            State.variables = typeof State._createDefaultVariables === 'function' ? State._createDefaultVariables() : { turnSerial: 0, time: { year: 1, month: 1, day: 1, hour: 8, weekday: 1 }, foreshadow_short: [], foreshadow_long: [] };
        }
        const shouldIncrement = opts.increment !== false;
        const serial = shouldIncrement ? (State.variables.turnSerial = (State.variables.turnSerial || 0) + 1) : (State.variables.turnSerial || 0);
        const serialStr = String(serial).padStart(3, '0');
        const timeStr = State.gameState?.currentDate || (State.variables.time
            ? `第${State.variables.time.day || 1}天 ${String(State.variables.time.hour ?? 8).padStart(2, '0')}:00`
            : '第1天 08:00');
        return `serial: ${serialStr}\ntime: ${timeStr}\n${String(rawSummary).trim()}`;
    }
});
