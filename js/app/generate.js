/**
 * 生成：请求 AI、换一条回复、推进时间、重新生成。
 * 扩展 App（app.js 先加载）。
 *
 * 失败的处理约定：
 *  - 没有收到任何内容：占位消息撤掉，错误提示给玩家，调用方负责还原这次发送。
 *  - 玩家点了停止、或流到一半断了：已收到的部分保留在消息里（标记 incomplete），
 *    不应用到游戏状态（变量、模块推进），玩家可以重 Roll。
 */
Object.assign(App, {
    /** 本轮请求参数：来自输出预设和显示设置；同时建立本轮的中断控制器 */
    _requestOptions(onChunk) {
        const preset = (PresetManager.currentPreset && PresetManager.currentPreset.parameters) || {};
        const display = Storage.getSettings() || {};
        const stopStrings = this._getStopStrings(display);
        const stream = display.stream_output !== false;
        this.abortController = new AbortController();
        if (this._stopRequested) this.abortController.abort();
        return {
            maxTokens: preset.maxTokens || 4096,
            temperature: preset.temperature ?? 0.8,
            topP: preset.topP ?? 0.9,
            frequencyPenalty: preset.frequencyPenalty ?? 0,
            presencePenalty: preset.presencePenalty ?? 0,
            stop: stopStrings.length > 0 ? stopStrings : undefined,
            stream,
            signal: this.abortController.signal,
            onChunk: stream ? onChunk : undefined
        };
    },

    /** 只收到一半的回复拿来显示：去掉已完整的标签块，没收尾的块一并略去 */
    _partialDisplayText(raw, settings) {
        let text = this._processResponseContent(String(raw || ''), settings || {}).content || '';
        const open = text.match(/<content>([\s\S]*)$/i);
        if (open) text = open[1];
        text = text.replace(/<(?:turn_summary|qa|prediction|delivery_completed|module_summary|e-cot|thinking|think)>[\s\S]*$/i, '');
        text = text.replace(/<!--\s*Start\s+the\s+ECoT[\s\S]*$/i, '');
        text = text.replace(/<\/?[a-z_|\-]*$/i, '');
        return text.trim();
    },

    /** 回复没收完时给玩家看的说明 */
    _incompleteNotice(reason, detail) {
        const keep = '已保留收到的部分，没有影响游戏进度，可以点「重Roll」重新生成。';
        if (reason === 'stopped') return '已停止生成。' + keep;
        if (reason === 'timeout') return '等待太久，回复没有收完。' + keep;
        if (reason === 'error') return '服务商在回复过程中报错' + (detail ? '：' + detail : '') + '。' + keep;
        if (reason === 'interrupted') return '网络中断，回复没有收完。' + keep;
        return '服务提前结束了连接，回复没有收完。' + keep;
    },

    /** 没有收到可用内容时的错误说明 */
    _emptyIncompleteMessage(reason, detail) {
        if (reason === 'timeout') return '等待太久，没有收到可用的内容，请重试。';
        if (reason === 'error') return '服务商在回复过程中报错' + (detail ? '：' + detail : '') + '，没有收到可用的内容，请重试。';
        if (reason === 'interrupted') return '网络中断，没有收到可用的内容，请重试。';
        return '服务提前结束了连接，没有收到可用的内容，请重试。';
    },

    /** 请求失败后收尾：玩家主动停止且已有内容就保留，否则撤掉占位消息 */
    _settleFailedReply(index, error) {
        const msg = ChatDisplay.messages[index];
        const partial = msg && msg.streaming ? String(msg.content || '') : '';
        if (error && error.name === 'AbortError' && partial.trim()) {
            const shown = this._partialDisplayText(partial, Storage.getSettings() || {});
            if (shown) {
                msg.content = shown;
                msg.incomplete = true;
                msg.incompleteReason = 'stopped';
                ChatDisplay.finishStreamingMessage(index);
                if (State.chatHistory[index]) { State.chatHistory[index].content = shown; State.chatHistory[index].incomplete = true; }
                this.autoSaveToCurrentSlot();
                return;
            }
        }
        this._truncateChat(index);
    },

    /** 聊天只保留前 length 条（不弹确认）：用于撤掉失败的发送 */
    _truncateChat(length) {
        ChatDisplay.loadHistory(ChatDisplay.messages.slice(0, length));
    },

    /** 把失败原因告诉玩家（停止不算失败） */
    _reportGenerateError(error) {
        if (error && error.name === 'AbortError') return;
        Toast.show(error && error.message ? error.message : '生成失败，请重试。', 'error', 8000);
    },

    /** 回复在流到一半时结束：保留收到的内容，不应用到游戏状态 */
    _keepIncompleteReply(index, response, messages, displaySettings) {
        const shown = this._partialDisplayText(response.content, displaySettings);
        if (!shown) {
            this._truncateChat(index);
            throw new Error(this._emptyIncompleteMessage(response.incompleteReason, response.incompleteDetail));
        }
        const msg = ChatDisplay.messages[index];
        if (msg) {
            msg.content = shown;
            msg.incomplete = true;
            msg.incompleteReason = response.incompleteReason;
            if (response.thinking) msg.thinking = response.thinking;
            ChatDisplay.finishStreamingMessage(index);
            if (State.chatHistory[index]) {
                State.chatHistory[index].content = shown;
                State.chatHistory[index].incomplete = true;
            }
        }
        this.updateTokenDisplay(response.usage);
        DebugViewer.recordResponse({ ...response, content: shown }, messages);
        Toast.show(this._incompleteNotice(response.incompleteReason, response.incompleteDetail), 'warning', 8000);
        this._lastReplyIncomplete = true;
        return shown;
    },

    /** 回复正常结束但有需要提醒的情况（被长度上限截断、被过滤） */
    _noteFinishReason(response) {
        if (response.finishReason === 'length') {
            Toast.show('回复被长度上限截断了，可以在输出预设里调大最大长度。', 'warning', 6000);
        } else if (response.finishReason === 'content_filter') {
            Toast.show('回复被服务商的内容过滤截断了，可以重Roll。', 'warning', 6000);
        }
    },

    /**
     * 获取AI回复（使用API连接）。
     * @param {string} roleplayOrCombined - 剧情/扮演内容，或兼容旧版时传入的整条合并字符串
     * @param {string} [meta] - 场外指令；不传则从 roleplayOrCombined 解析（兼容旧格式）
     */
    async getAIResponse(roleplayOrCombined, meta) {
        this._lastReplyIncomplete = false;
        const problem = APIConnection.checkConfigured();
        if (problem) throw new Error(problem);

        let roleplay;
        let metaContent;
        if (meta !== undefined && meta !== null) {
            roleplay = (roleplayOrCombined != null && String(roleplayOrCombined).trim()) ? String(roleplayOrCombined).trim() : '';
            metaContent = (meta != null && String(meta).trim()) ? String(meta).trim() : '';
        } else {
            const parsed = this._parseRoleplayMeta(roleplayOrCombined);
            roleplay = parsed.roleplay;
            metaContent = parsed.meta;
        }

        // 构建消息数组：场外进 <user_meta> 块，user 只发剧情；同时记下本回合发给 AI 的可操作范围
        const turn = await this.prepareTurn(roleplay, metaContent);
        const wire = this.wireWithSources(turn.messages);
        const messages = wire.map(({ role, content }) => ({ role, content }));
        DebugViewer.recordSent(wire);
        const preTurnState = this._captureTurnState();

        // 记录本轮注入的时间线事件，回复成功后标记为已触发
        const curModule = typeof ModuleManager !== 'undefined' ? ModuleManager.getCurrent() : null;
        const varsForMark = State.variables || {};
        this._lastTriggeredTimelineEvents = (curModule && typeof ModuleManager !== 'undefined' && ModuleManager.getTriggeredTimelineEvents)
            ? ModuleManager.getTriggeredTimelineEvents(curModule, varsForMark)
            : [];

        // 创建流式消息占位符
        const streamingMsg = ChatDisplay.createStreamingMessage();
        const displaySettings = Storage.getSettings() || {};

        let response;
        try {
            response = await APIConnection.send(messages, this._requestOptions((chunk, fullContent) => {
                // 流式过程中只显示原文，等完整响应后再统一处理
                ChatDisplay.updateStreamingMessage(streamingMsg.index, fullContent);
            }));
        } catch (error) {
            this._settleFailedReply(streamingMsg.index, error);
            throw error;
        }

        if (response.incomplete) {
            return this._keepIncompleteReply(streamingMsg.index, response, messages, displaySettings);
        }

        // 原始正文（兼容 response 为 {} 或 content 非字符串，含 reroll 时）
        const rawContentStr = this._getRawContentFromResponse(response);
        // 处理响应内容（应用显示设置）
        const processed = this._processResponseContent(rawContentStr, displaySettings);

        // 更新消息对象
        const lastMsg = ChatDisplay.messages[streamingMsg.index];
        if (lastMsg) {
            // 更新content（已应用正则和显示设置）
            lastMsg.content = processed.content;

            // 更新thinking（从response或processed中获取）
            const thinking = response.thinking || processed.thinking;
            if (thinking) {
                lastMsg.thinking = thinking;
            }

            // 更新e-cot（从response或processed中获取）
            const ecot = response.ecot || processed.ecot;
            if (ecot) {
                lastMsg.ecot = ecot;
            }

            // 更新问答区（qa）
            if (processed.qa) {
                lastMsg.qa = processed.qa;
            }

            // 更新预测区（prediction）
            if (processed.prediction) {
                lastMsg.prediction = processed.prediction;
            }

            // 更新本轮摘要（系统填入 serial/time，只规范化一次避免 turnSerial 加两次）
            let normalizedSummary = null;
            if (processed.turnSummary) {
                normalizedSummary = this._normalizeTurnSummary(processed.turnSummary);
                lastMsg.turnSummary = normalizedSummary;
            }

            // 完成流式更新（会重新渲染，应用正则和显示thinking/qa/prediction）
            ChatDisplay.finishStreamingMessage(streamingMsg.index);

            // 更新State 与 ChatDisplay.messages（含原始 API 返回全文，存档用 ChatDisplay.messages）
            if (State.chatHistory[streamingMsg.index]) {
                State.chatHistory[streamingMsg.index].content = processed.content;
                if (thinking) State.chatHistory[streamingMsg.index].thinking = thinking;
                if (ecot) State.chatHistory[streamingMsg.index].ecot = ecot;
                if (processed.qa) State.chatHistory[streamingMsg.index].qa = processed.qa;
                if (processed.prediction) State.chatHistory[streamingMsg.index].prediction = processed.prediction;
                if (normalizedSummary) State.chatHistory[streamingMsg.index].turnSummary = normalizedSummary;
            }
            this._setMessageRawContent(streamingMsg.index, response, processed);
        } else {
            ChatDisplay.finishStreamingMessage(streamingMsg.index);
        }

        // 回复里的指令（变量、事件、时间、投递、伏笔、插件、总结）落到游戏状态，并把结果告诉玩家
        const applied = this._applyReplyEffects(rawContentStr, processed, turn.ctx, { turnSummary: lastMsg ? lastMsg.turnSummary : null });
        this._recordReplyEffects(streamingMsg.index, applied.effects, preTurnState, { raw: rawContentStr, ctx: turn.ctx, turnSummary: lastMsg ? lastMsg.turnSummary : null });

        // 更新token统计：优先使用API返回的 usage，没有的话本地估算
        if (typeof TokenCounter !== 'undefined') {
            const promptTokens = response.usage?.prompt_tokens ?? TokenCounter.countMessages(messages);
            const completionTokens = response.usage?.completion_tokens ?? TokenCounter.countText(processed.content);
            const totalTokens = response.usage?.total_tokens ?? (promptTokens + completionTokens);
            response.usage = {
                prompt_tokens: promptTokens,
                completion_tokens: completionTokens,
                total_tokens: totalTokens
            };
        }

        this.updateTokenDisplay(response.usage);

        // 记录响应到调试查看器（包含完整的thinking、ecot、qa、prediction、turnSummary，以及发送的消息数组）
        DebugViewer.recordResponse({
            ...response,
            thinking: response.thinking || processed.thinking,
            ecot: response.ecot || processed.ecot,
            qa: processed.qa,
            prediction: processed.prediction,
            turnSummary: processed.turnSummary,
            content: processed.content
        }, messages);

        this._noteFinishReason(response);
        return processed.content;
    },

    /**
     * 为swipe生成新的AI版本（写回到指定assistant消息的swipes里）
     * @param {string|{content:string,roleplay?:string,meta?:string}} userMessageOrObj - 用户消息文本或带 roleplay/meta 的消息对象
     * @param {number} assistantIndex - 要写入swipe的assistant消息索引
     */
    async getAIResponseForSwipe(userMessageOrObj, assistantIndex) {
        this._lastReplyIncomplete = false;
        if (this.isGenerating) throw new Error('正在生成中，请先点停止。');
        const problem = APIConnection.checkConfigured();
        if (problem) throw new Error(problem);

        const targetMsg = ChatDisplay.messages?.[assistantIndex];
        if (!targetMsg || targetMsg.role !== 'assistant') {
            throw new Error('这条消息不能重新生成。');
        }

        let roleplay;
        let meta;
        if (userMessageOrObj && typeof userMessageOrObj === 'object' && (userMessageOrObj.roleplay !== undefined || userMessageOrObj.meta !== undefined)) {
            roleplay = userMessageOrObj.roleplay ?? '';
            meta = userMessageOrObj.meta ?? '';
        } else {
            const parsed = this._parseRoleplayMeta(typeof userMessageOrObj === 'string' ? userMessageOrObj : (userMessageOrObj?.content ?? ''));
            roleplay = parsed.roleplay;
            meta = parsed.meta;
        }

        // 先建好版本列表（原来的回复是第一个版本），再清空显示
        ChatDisplay._initSwipes(targetMsg);
        // 重新生成这一回合：先把状态退回到这一回合开始前，避免上一次回复的指令被重复执行
        if (targetMsg.preTurnState) this._restoreTurnState(targetMsg.preTurnState);
        const turn = await this.prepareTurn(roleplay, meta);
        const wire = this.wireWithSources(turn.messages);
        const messages = wire.map(({ role, content }) => ({ role, content }));
        DebugViewer.recordSent(wire);
        const displaySettings = Storage.getSettings() || {};

        // 进入生成状态
        this._showGenerating(true);

        // 先把目标消息切成“流式占位”
        const previousContent = targetMsg.content;
        targetMsg.content = '';
        targetMsg.streaming = true;
        ChatDisplay.updateStreamingMessage(assistantIndex, '');

        const restorePrevious = () => {
            targetMsg.content = targetMsg.swipes?.[targetMsg.swipeId || 0] ?? previousContent;
            ChatDisplay.finishStreamingMessage(assistantIndex);
            ChatDisplay._refreshMessage(assistantIndex);
        };
        const keepAsNewVersion = (text, reason, detail) => {
            ChatDisplay.addSwipe(assistantIndex, text);
            targetMsg.incomplete = true;
            targetMsg.incompleteReason = reason;
            ChatDisplay.finishStreamingMessage(assistantIndex);
            Toast.show(this._incompleteNotice(reason, detail), 'warning', 8000);
        };

        try {
            let response;
            try {
                response = await APIConnection.send(messages, this._requestOptions((chunk, fullContent) => {
                    ChatDisplay.updateStreamingMessage(assistantIndex, fullContent);
                }));
            } catch (error) {
                if (error && error.name === 'AbortError') {
                    const shown = this._partialDisplayText(targetMsg.content, displaySettings);
                    if (shown) keepAsNewVersion(shown, 'stopped');
                    else restorePrevious();
                    return null;
                }
                restorePrevious();
                throw error;
            }

            if (response.incomplete) {
                const shown = this._partialDisplayText(response.content, displaySettings);
                if (!shown) {
                    restorePrevious();
                    throw new Error(this._emptyIncompleteMessage(response.incompleteReason, response.incompleteDetail));
                }
                keepAsNewVersion(shown, response.incompleteReason, response.incompleteDetail);
                this._lastReplyIncomplete = true;
                this.updateTokenDisplay(response.usage);
                DebugViewer.recordResponse({ ...response, content: shown }, messages);
                return shown;
            }

            const rawContentStr = this._getRawContentFromResponse(response);
            const processed = this._processResponseContent(rawContentStr, displaySettings);

            // 回复里的指令落到游戏状态（与主路径同一套）
            const swipeSummary = processed.turnSummary ? this._normalizeTurnSummary(processed.turnSummary, { increment: false }) : null;
            const applied = this._applyReplyEffects(rawContentStr, processed, turn.ctx, { turnSummary: swipeSummary });
            this._recordReplyEffects(assistantIndex, applied.effects, targetMsg.preTurnState || null, { raw: rawContentStr, ctx: turn.ctx, turnSummary: swipeSummary });

            // 写入swipe（保留原版本，新增一个版本）
            ChatDisplay.addSwipe(assistantIndex, processed.content);
            delete targetMsg.incomplete;
            delete targetMsg.incompleteReason;

            // 完成流式（如果启用过）
            ChatDisplay.finishStreamingMessage(assistantIndex);

            this.updateTokenDisplay(response.usage);
            DebugViewer.recordResponse({
                ...response,
                thinking: response.thinking || processed.thinking,
                ecot: response.ecot || processed.ecot,
                qa: processed.qa,
                prediction: processed.prediction,
                turnSummary: processed.turnSummary,
                content: processed.content
            }, messages);

            // 写回该条消息（reroll 后需更新 State 与 ChatDisplay.messages；存档用 ChatDisplay.messages）
            if (State.chatHistory && State.chatHistory[assistantIndex]) {
                State.chatHistory[assistantIndex].content = processed.content;
                if (processed.turnSummary) State.chatHistory[assistantIndex].turnSummary = this._normalizeTurnSummary(processed.turnSummary, { increment: false });
                if (processed.thinking) State.chatHistory[assistantIndex].thinking = processed.thinking;
                if (processed.qa) State.chatHistory[assistantIndex].qa = processed.qa;
                if (processed.prediction) State.chatHistory[assistantIndex].prediction = processed.prediction;
            }
            this._setMessageRawContent(assistantIndex, response, processed);

            this._noteFinishReason(response);
            return processed.content;
        } finally {
            this._showGenerating(false);
        }
    },

    /**
     * 处理操作按钮
     */
    handleAction(action) {
        switch (action) {
            case 'advance-event':
                this.advanceTime('event');
                break;
            case 'advance-day':
                this.advanceTime('day');
                break;
            case 'advance-custom':
                this.advanceTimeCustom();
                break;
            case 'reroll':
                this.rerollLastMessage();
                break;
            case 'delete-multi':
                ChatDisplay.toggleMultiSelectMode();
                break;
            default:
                console.log('Unknown action:', action);
        }
    },

    /**
     * 时间推进功能
     * @param {string} unit - 'event' | 'hour' | 'day' | 'week'
     */
    async advanceTime(unit = 'day') {
        if (!Engine.isRunning) {
            Toast.show('请先开始游戏', 'warning');
            return;
        }

        // 推进必须在“当前没有输出/生成”时才能触发（避免联动混乱）
        if (this.isGenerating) {
            Toast.show('正在生成中，不能时间推进。请先停止生成。', 'warning');
            return;
        }

        // 确保默认时间存在：前缀 + 年/月/日/星期/时:分，推进按此流逝
        if (!State.variables) {
            State.variables = typeof State._createDefaultVariables === 'function' ? State._createDefaultVariables() : { turnSerial: 0, time: { year: 1, month: 1, day: 1, dayOfWeek: 0, hour: 8, minute: 0 }, foreshadow_short: [], foreshadow_long: [] };
        }
        if (!State.variables.time) {
            State.variables.time = { year: 1, month: 1, day: 1, dayOfWeek: 0, hour: 8, minute: 0 };
        }

        const time = State.variables.time;
        const prevTime = { ...time };
        let timeUpdateText = '';
        let displayLabel = '';

        switch (unit) {
            case 'event':
                // 事件 = 到队列下一项（由队列逻辑处理；此处仅作占位）
                timeUpdateText = '推进到队列下一项';
                displayLabel = '推进到队列下一项';
                break;
            case 'hour':
                time.hour = (time.hour || 0) + 1;
                time.minute = time.minute != null ? time.minute : 0;
                if (time.hour >= 24) {
                    time.hour = 0;
                    this._advanceOneDay(time);
                }
                timeUpdateText = `时间推进到 ${String(time.hour).padStart(2, '0')}:${String(time.minute || 0).padStart(2, '0')}`;
                break;
            case 'day':
                this._advanceOneDay(time);
                time.hour = 8;
                time.minute = time.minute != null ? time.minute : 0;
                timeUpdateText = `${time.year}年${time.month}月${time.day}日`;
                displayLabel = '推进到今天结束';
                break;
            case 'week':
                for (let i = 0; i < 7; i++) {
                    this._advanceOneDay(time);
                }
                time.hour = 8;
                timeUpdateText = `一周过去了，现在是第${time.day}天`;
                break;
        }

        if (State.gameState && typeof formatDateForDisplay === 'function') {
            State.gameState.currentDate = formatDateForDisplay(State.variables);
        } else if (State.gameState && time) {
            State.gameState.currentDate = `${time.year}年${time.month}月${time.day}日 ${String(time.hour || 8).padStart(2, '0')}:${String(time.minute != null ? time.minute : 0).padStart(2, '0')}`;
        }

        const prevDate = State.gameState ? State.gameState.currentDate : undefined;
        const chatLengthBefore = ChatDisplay.messages.length;
        ChatDisplay.addMessage({
            role: 'system',
            content: `${displayLabel}`,
            isAdvanceSummary: true,
            timestamp: Date.now()
        });

        const fromStr = prevTime ? `${prevTime.year}年${prevTime.month}月${prevTime.day}日 ${String(prevTime.hour || 8).padStart(2, '0')}:${String(prevTime.minute != null ? prevTime.minute : 0).padStart(2, '0')}` : '';
        const toStr = time ? `${time.year}年${time.month}月${time.day}日 ${String(time.hour || 8).padStart(2, '0')}:${String(time.minute != null ? time.minute : 0).padStart(2, '0')}` : '';
        const aiPrompt =
            `[时间推进]\n` +
            `从：${fromStr}\n` +
            `到：${toStr}\n\n` +
            `请用简洁叙事概括这段时间推进期间发生的事件与状态变化（如果无事发生也要说明），然后从当前时间点继续剧情。`;

        // 不在聊天里显示这条prompt，只是自动触发AI回复
        // 推进也属于“生成”，必须可停止
        this._showGenerating(true);
        try {
            await this.getAIResponse(aiPrompt);
        } catch (error) {
            this._reportGenerateError(error);
            // 没有收到任何回复：这次推进作废，时间和聊天都还原
            if (!ChatDisplay.messages.slice(chatLengthBefore).some(m => m.role === 'assistant')) {
                Object.keys(time).forEach(k => { if (!(k in prevTime)) delete time[k]; });
                Object.assign(time, prevTime);
                if (State.gameState) State.gameState.currentDate = prevDate;
                this._truncateChat(chatLengthBefore);
                await this.autoSaveToCurrentSlot();
                return;
            }
        } finally {
            this._showGenerating(false);
        }

        // 自动保存
        await this.autoSaveToCurrentSlot();

        if (!this._lastReplyIncomplete) Toast.show(timeUpdateText, 'success');
    },

    /**
     * 推进一天的辅助函数
     */
    _advanceOneDay(time) {
        time.day = (time.day || 1) + 1;
        const dw = time.dayOfWeek != null ? time.dayOfWeek : (time.weekday != null ? time.weekday : 0);
        time.dayOfWeek = (dw + 1) % 7;
        time.weekday = time.dayOfWeek;

        if (time.day > 30) {
            time.day = 1;
            time.month = (time.month || 1) + 1;
            if (time.month > 12) {
                time.month = 1;
                time.year = (time.year || 1) + 1;
            }
        }
    },

    /**
     * 自定义时间推进（让AI判断）
     */
    async advanceTimeCustom() {
        if (!Engine.isRunning) {
            Toast.show('请先开始游戏', 'warning');
            return;
        }

        if (this.isGenerating) {
            Toast.show('正在生成中，请先停止生成。', 'warning');
            return;
        }

        const customPrompt = await Modal.prompt(
            '自定义时间推进',
            '描述你想推进到的时间点（例如："到下午"、"到第二天早上"、"一周后"）：'
        );

        if (!customPrompt || customPrompt.trim() === '') {
            return;
        }

        // 发送给AI让其判断
        const chatLengthBefore = ChatDisplay.messages.length;
        const systemMessage = {
            role: 'user',
            content: `[时间推进请求] ${customPrompt.trim()}`,
            timestamp: Date.now()
        };
        ChatDisplay.addMessage(systemMessage);

        // 触发AI响应；没有收到任何回复就撤回这条请求
        this._showGenerating(true);
        try {
            await this.getAIResponse(customPrompt.trim());
        } catch (error) {
            this._reportGenerateError(error);
            if (!ChatDisplay.messages.slice(chatLengthBefore).some(m => m.role === 'assistant')) {
                this._truncateChat(chatLengthBefore);
                await this.autoSaveToCurrentSlot();
            }
        } finally {
            this._showGenerating(false);
        }
        await this.autoSaveToCurrentSlot();
    },

    /**
     * 重Roll最后一条AI消息
     */
    async rerollLastMessage() {
        const lastMsg = ChatDisplay.messages?.[ChatDisplay.messages.length - 1];
        if (!lastMsg) {
            Toast.show('没有可重Roll的消息', 'warning');
            return;
        }

        // 正常：最后一条是AI消息 -> 重Roll它
        if (lastMsg.role === 'assistant') {
            await ChatDisplay.rerollMessage(ChatDisplay.messages.length - 1);
            return;
        }

        // 兼容：如果没有AI消息（最后一条是user/system），默认重新发送最近一条用户消息
        const lastUser = ChatDisplay.getLastUserMessage?.();
        if (!lastUser?.content) {
            Toast.show('找不到可重新发送的用户消息', 'warning');
            return;
        }

        if (this.isGenerating) {
            Toast.show('正在生成中，请先停止生成。', 'warning');
            return;
        }
        this._showGenerating(true);
        try {
            if (lastUser.roleplay !== undefined || lastUser.meta !== undefined) {
                await this.getAIResponse(lastUser.roleplay ?? '', lastUser.meta ?? '');
            } else {
                await this.getAIResponse(lastUser.content);
            }
            await this.autoSaveToCurrentSlot();
        } catch (error) {
            this._reportGenerateError(error);
        } finally {
            this._showGenerating(false);
        }
    },

    /**
     * 更新Token显示（在调试页面）- 只显示单次计数，不显示总计
     */
    updateTokenDisplay(usage) {
        if (!usage) return;

        // 只在调试页面显示Token
        const tokenCountEl = document.getElementById('debug-token-count');

        if (tokenCountEl) {
            tokenCountEl.textContent = usage.total_tokens || 0;
        }
    },

    /**
     * 显示暂存操作（聚合各插件暂存，如手机短信/通话）
     */
    showPendingActions() {
        let html = '';
        const driver = window.InteractiveSaveDriver;
        if (window.PluginRegistry && driver) {
            for (const [pluginId, p] of PluginRegistry.plugins) {
                if (p.pluginType !== 'interactive-save') continue;
                const { messages: msgs, calls, contacts } = driver.getPendingItems(pluginId);
                if (msgs.length || calls.length) {
                    html += `<div class="pending-section"><strong>${p.name || pluginId}</strong><ul>`;
                    msgs.forEach(m => {
                        const c = contacts.get && contacts.get(m.contactId);
                        html += `<li>给 ${c?.name || m.contactId} 发短信: ${m.content}</li>`;
                    });
                    calls.forEach(c => {
                        const contact = contacts.get && contacts.get(c.contactId);
                        html += `<li>拨打 ${contact?.name || c.contactId}</li>`;
                    });
                    html += '</ul></div>';
                }
            }
        }
        if (!html) html = '<div class="item-list-empty">暂无暂存操作</div>';
        Modal.show('暂存操作', html, {
            buttons: [{ label: '关闭', action: 'close' }],
            onAction: () => Modal.close()
        });
    },

    /**
     * 清空暂存操作（各插件暂存一并清空）
     */
    clearPendingActions() {
        if (window.InteractiveSaveDriver) InteractiveSaveDriver.clearAllPending();
        if (window.Events && window.EVENT_TYPES) Events.emit(EVENT_TYPES.PLUGIN_PENDING_CLEARED, {});
        Toast.show('已清空暂存', 'success');
    }
});
