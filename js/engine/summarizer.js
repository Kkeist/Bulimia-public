/**
 * 多层总结系统
 * 支持全局总结、插件内部总结、分层递归压缩
 *
 * 总结存放位置（与系统分离，不包含故事内容）：
 * - 内存：this.summaries（global / plugins）
 * - 持久化：CONFIG.DB_STORES.SUMMARIES（IndexedDB），id 应含 saveId 以便按存档区分
 */

class SummarizerSystem {
    constructor() {
        // 配置
        this.config = {
            // 全局对话总结
            globalTrigger: CONFIG.SUMMARY?.AUTO_TRIGGER_MESSAGES || 20,
            globalKeepRecent: CONFIG.SUMMARY?.KEEP_RECENT_MESSAGES || 5,

            // 各层总结字数限制
            recentSummaryMaxChars: 2000,      // 最近总结
            midSummaryMaxChars: 1000,         // 中期总结
            ancientSummaryMaxChars: 500,      // 远古总结

            // 递归压缩阈值
            compressThreshold: 3,  // 同一层级超过N条时压缩

            // 插件总结配置
            pluginSummaryTrigger: 10,  // 插件消息数触发
            pluginSummaryMaxChars: 500
        };

        // 总结存储结构
        this.summaries = {
            // 全局对话总结（分层）
            global: {
                recent: [],     // 最近的详细总结
                mid: [],        // 中期压缩总结
                ancient: []     // 远古高度压缩总结
            },

            // 插件内部总结
            plugins: {
                phone: {
                    // contactId: { messages: [], summary: '' }
                },
                notes: [],      // 传纸条
                events: []      // 事件记录
            }
        };

        // 上次总结时的消息数量
        this.lastSummaryAtCount = 0;
    }

    // ==================== 全局对话总结 ====================

    /**
     * 检查是否需要自动总结
     */
    async checkAndSummarize() {
        const messageCount = State.chatHistory?.length || 0;
        const messagesSinceLastSummary = messageCount - this.lastSummaryAtCount;

        if (messagesSinceLastSummary >= this.config.globalTrigger) {
            await this.summarizeGlobal();
        }
    }

    /**
     * 执行全局对话总结
     */
    async summarizeGlobal() {
        const messages = State.chatHistory || [];
        const keepCount = this.config.globalKeepRecent;

        // 获取需要总结的消息
        const toSummarize = messages.slice(0, -keepCount);
        if (toSummarize.length === 0) return null;

        // 构建总结prompt
        const prompt = this._buildGlobalSummaryPrompt(toSummarize);

        try {
            const response = await APIConnection.send(prompt, {
                maxTokens: 1000,
                temperature: 0.3
            });

            const summary = this._extractSummary(response.content);

            // 存入recent层
            this.summaries.global.recent.push({
                id: Date.now(),
                timestamp: new Date().toISOString(),
                messageCount: toSummarize.length,
                content: summary
            });

            // 检查是否需要递归压缩
            await this._checkAndCompressGlobal();

            // 更新计数
            this.lastSummaryAtCount = messages.length;

            // 更新State
            this._updateCurrentSummary();

            Events.emit(EVENT_TYPES.SUMMARY_CREATED, { type: 'global', summary });

            return summary;
        } catch (error) {
            console.error('Global summary failed:', error);
            return null;
        }
    }

    /**
     * 检查并压缩全局总结
     */
    async _checkAndCompressGlobal() {
        const { recent, mid, ancient } = this.summaries.global;

        // recent -> mid 压缩
        if (recent.length >= this.config.compressThreshold) {
            const toCompress = recent.splice(0, recent.length - 1);
            const compressed = await this._compressSummaries(toCompress, 'mid');
            if (compressed) {
                mid.push({
                    id: Date.now(),
                    timestamp: new Date().toISOString(),
                    originalCount: toCompress.length,
                    content: compressed
                });
            }
        }

        // mid -> ancient 压缩
        if (mid.length >= this.config.compressThreshold) {
            const toCompress = mid.splice(0, mid.length - 1);
            const compressed = await this._compressSummaries(toCompress, 'ancient');
            if (compressed) {
                ancient.push({
                    id: Date.now(),
                    timestamp: new Date().toISOString(),
                    originalCount: toCompress.length,
                    content: compressed
                });
            }
        }

        // ancient 内部压缩（超过阈值时合并）
        if (ancient.length >= this.config.compressThreshold * 2) {
            const toCompress = ancient.splice(0, ancient.length - 1);
            const compressed = await this._compressSummaries(toCompress, 'ancient');
            if (compressed) {
                ancient.unshift({
                    id: Date.now(),
                    timestamp: new Date().toISOString(),
                    originalCount: toCompress.length,
                    content: compressed
                });
            }
        }
    }

    /**
     * 压缩多个总结为一个
     */
    async _compressSummaries(summaries, targetLevel) {
        if (summaries.length === 0) return null;

        const maxChars = {
            recent: this.config.recentSummaryMaxChars,
            mid: this.config.midSummaryMaxChars,
            ancient: this.config.ancientSummaryMaxChars
        }[targetLevel] || 500;

        const prompt = this._buildCompressPrompt(summaries, maxChars, targetLevel);

        try {
            const response = await APIConnection.send(prompt, {
                maxTokens: Math.ceil(maxChars * 0.8),
                temperature: 0.2
            });

            return this._extractSummary(response.content);
        } catch (error) {
            console.error('Compress summary failed:', error);
            // 失败时简单拼接
            return summaries.map(s => s.content).join('\n---\n').slice(0, maxChars);
        }
    }

    // ==================== 插件内部总结 ====================

    /**
     * 总结手机聊天记录
     */
    async summarizePhoneChat(contactId, messages) {
        if (!messages || messages.length < this.config.pluginSummaryTrigger) {
            return null;
        }

        const prompt = this._buildPluginSummaryPrompt('phone', contactId, messages);

        try {
            const response = await APIConnection.send(prompt, {
                maxTokens: 500,
                temperature: 0.3
            });

            const summary = this._extractSummary(response.content);

            // 存储
            this.summaries.plugins.phone[contactId] = {
                summary,
                lastMessageCount: messages.length,
                timestamp: Date.now()
            };

            return summary;
        } catch (error) {
            console.error('Phone chat summary failed:', error);
            return null;
        }
    }

    /**
     * 总结传纸条记录
     */
    async summarizeNotes(notes) {
        if (!notes || notes.length < 5) return null;

        const prompt = this._buildPluginSummaryPrompt('notes', null, notes);

        try {
            const response = await APIConnection.send(prompt, {
                maxTokens: 300,
                temperature: 0.3
            });

            const summary = this._extractSummary(response.content);

            this.summaries.plugins.notes.push({
                summary,
                noteCount: notes.length,
                timestamp: Date.now()
            });

            return summary;
        } catch (error) {
            console.error('Notes summary failed:', error);
            return null;
        }
    }

    /**
     * 记录重要事件（不需要AI总结，直接记录）
     */
    recordEvent(event) {
        this.summaries.plugins.events.push({
            ...event,
            timestamp: Date.now()
        });

        // 保持事件数量在合理范围
        if (this.summaries.plugins.events.length > 50) {
            this.summaries.plugins.events = this.summaries.plugins.events.slice(-30);
        }
    }

    // ==================== Prompt构建 ====================

    /**
     * 构建全局总结Prompt（融合 MoM/Alice 风格：时间顺序、事件因果、关键对话、伏笔、不评判）
     */
    _buildGlobalSummaryPrompt(messages) {
        let prompt = `【系统指令：对话内容总结】\n\n`;
        prompt += `你是内部总结助手。请对以下对话进行总结，总结只用于内部记录，不会展示给用户。\n\n`;

        prompt += `基本原则：\n`;
        prompt += `- 复述事实，不做道德评判或评价。\n`;
        prompt += `- 按时间顺序组织信息，可标注大致时间/阶段以便区分先后。\n`;
        prompt += `- 所有对剧情有影响的人物（含配角）均需在事件中体现，不省略任何角色线。\n`;
        prompt += `- 信息优先级：事件 > 计划/意图 > 关键对话 > 物品/约定 > 情绪变化。\n`;
        prompt += `- 每个事件摘要须包含：因果与行为、关键对话（可引述）、计划与执行、重要物品/承诺/情感发展。\n`;
        prompt += `- 直接陈述事实，使用简洁清晰语言，避免修辞与修饰。\n`;
        prompt += `- 不回避敏感内容，保证记录完全还原前文含义。\n`;
        prompt += `- 保留未解决的伏笔、待办事项与数值/状态变化。\n`;
        prompt += `- 字数控制在${this.config.recentSummaryMaxChars}字以内。\n\n`;

        prompt += `待总结的对话：\n---\n`;

        const userName = PersonaManager.current?.name || '玩家';
        const aiName = Storage.getSettings()?.aiName || '故事之声';

      // 完整保留，不做缩略
        for (const msg of messages) {
            const role = msg.role === 'user' ? userName : aiName;
            prompt += `${role}: ${msg.content}\n\n`;
        }

        prompt += `---\n\n请仅输出总结内容，使用以下标签包裹：\n<summary>\n内容\n</summary>`;

        return [{ role: 'user', content: prompt }];
    }

    /**
     * 构建压缩总结Prompt
     */
    _buildCompressPrompt(summaries, maxChars, level) {
        const levelDesc = {
            mid: '中期压缩（保留主要事件和关键信息）',
            ancient: '远古压缩（只保留最重要的里程碑事件）'
        }[level] || '压缩';

        let prompt = `【系统指令：总结压缩】\n\n`;
        prompt += `请将以下多段总结压缩为一段，进行${levelDesc}。\n\n`;
        prompt += `要求：\n`;
        prompt += `1. 合并相似内容，去除重复\n`;
        prompt += `2. 保留最重要的信息点\n`;
        prompt += `3. 字数控制在${maxChars}字以内\n`;
        prompt += `4. 越久远的信息可以越简略\n\n`;

        prompt += `待压缩的总结：\n---\n`;

        for (let i = 0; i < summaries.length; i++) {
            prompt += `【第${i + 1}段】\n${summaries[i].content}\n\n`;
        }

        prompt += `---\n\n请输出压缩后的总结：\n<summary>\n内容\n</summary>`;

        return [{ role: 'user', content: prompt }];
    }

    /**
     * 构建插件总结Prompt
     */
    _buildPluginSummaryPrompt(pluginType, identifier, data) {
        let prompt = `【系统指令：${pluginType}内容总结】\n\n`;

        switch (pluginType) {
            case 'phone':
                prompt += `请总结与"${identifier}"的手机聊天记录要点：\n\n`;
                prompt += `要求：保留重要话题、约定、情感变化\n`;
                prompt += `字数：${this.config.pluginSummaryMaxChars}字以内\n\n`;
                prompt += `聊天记录：\n---\n`;
                for (const msg of data.slice(-20)) {  // 只取最近20条
                    prompt += `[${msg.sender}]: ${msg.content}\n`;
                }
                break;

            case 'notes':
                prompt += `请总结这些传纸条的内容要点：\n\n`;
                prompt += `字数：300字以内\n\n`;
                prompt += `纸条内容：\n---\n`;
                for (const note of data) {
                    prompt += `→${note.target}: ${note.content}\n`;
                }
                break;
        }

        prompt += `---\n\n请输出总结：\n<summary>\n内容\n</summary>`;

        return [{ role: 'user', content: prompt }];
    }

    /**
     * 从响应中提取总结
     */
    _extractSummary(content) {
        const match = content.match(/<summary>([\s\S]*?)<\/summary>/);
        return match ? match[1].trim() : content.trim();
    }

    // ==================== 获取总结（发送给AI） ====================

    /**
     * 获取完整的上下文总结（用于发送给AI）
     */
    getContextSummary() {
        const parts = [];
        const { global, plugins } = this.summaries;

        // 远古总结（高度压缩）
        if (global.ancient.length > 0) {
            parts.push('【远古记忆】');
            parts.push(global.ancient.map(s => s.content).join('\n'));
        }

        // 中期总结
        if (global.mid.length > 0) {
            parts.push('【过往总结】');
            parts.push(global.mid.map(s => s.content).join('\n---\n'));
        }

        // 最近总结（最详细）
        if (global.recent.length > 0) {
            parts.push('【近期记录】');
            parts.push(global.recent.map(s => s.content).join('\n---\n'));
        }

        // 重要事件
        if (plugins.events.length > 0) {
            parts.push('【重要事件】');
            parts.push(plugins.events.slice(-10).map(e =>
                `- ${e.type}: ${e.description}`
            ).join('\n'));
        }

        return parts.join('\n\n');
    }

    /**
     * 获取指定联系人的手机聊天总结
     */
    getPhoneChatSummary(contactId) {
        return this.summaries.plugins.phone[contactId]?.summary || null;
    }

    /**
     * 获取所有手机聊天总结
     */
    getAllPhoneSummaries() {
        const result = {};
        for (const [id, data] of Object.entries(this.summaries.plugins.phone)) {
            if (data.summary) {
                result[id] = data.summary;
            }
        }
        return result;
    }

    // ==================== 更新State ====================

    /**
     * 更新State.currentSummary
     */
    _updateCurrentSummary() {
        State.currentSummary = this.getContextSummary();
        State.summaries = this.summaries;
    }

    // ==================== 作弊窗口接口 ====================

    /**
     * 手动触发全局总结
     */
    async forceSummarize() {
        return this.summarizeGlobal();
    }

    /**
     * 编辑总结内容
     */
    editCurrentSummary(newContent) {
        // 编辑最近一条recent总结
        if (this.summaries.global.recent.length > 0) {
            this.summaries.global.recent[this.summaries.global.recent.length - 1].content = newContent;
        } else {
            this.summaries.global.recent.push({
                id: Date.now(),
                timestamp: new Date().toISOString(),
                messageCount: 0,
                content: newContent
            });
        }
        this._updateCurrentSummary();
        Events.emit(EVENT_TYPES.SUMMARY_UPDATED, { summary: newContent });
    }

    /**
     * 清空所有总结
     */
    clearAll() {
        this.summaries = {
            global: { recent: [], mid: [], ancient: [] },
            plugins: { phone: {}, notes: [], events: [] }
        };
        State.currentSummary = '';
        State.summaries = this.summaries;
        this.lastSummaryAtCount = 0;
    }

    /**
     * 获取统计信息
     */
    getStats() {
        const { global, plugins } = this.summaries;
        return {
            globalRecent: global.recent.length,
            globalMid: global.mid.length,
            globalAncient: global.ancient.length,
            phoneChats: Object.keys(plugins.phone).length,
            notes: plugins.notes.length,
            events: plugins.events.length,
            totalLength: State.currentSummary?.length || 0,
            lastSummaryAt: this.lastSummaryAtCount,
            currentMessageCount: State.chatHistory?.length || 0,
            untilNextSummary: Math.max(0,
                this.config.globalTrigger - ((State.chatHistory?.length || 0) - this.lastSummaryAtCount)
            )
        };
    }

    /**
     * 获取所有总结详情（用于作弊窗口显示）
     */
    getAllSummariesDetail() {
        return {
            global: {
                recent: this.summaries.global.recent.map(s => ({
                    ...s,
                    preview: s.content
                })),
                mid: this.summaries.global.mid.map(s => ({
                    ...s,
                    preview: s.content
                })),
                ancient: this.summaries.global.ancient.map(s => ({
                    ...s,
                    preview: s.content
                }))
            },
            plugins: {
                phone: Object.entries(this.summaries.plugins.phone).map(([id, data]) => ({
                    contactId: id,
                    ...data,
                    preview: data.summary || ''
                })),
                events: this.summaries.plugins.events.slice(-20)
            }
        };
    }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SummarizerSystem };
}
