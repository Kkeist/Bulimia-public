/**
 * 发给 AI 的消息组装：写作指导、预设、补丁、模组七段、对话历史。
 * 发送与提示词查看器共用同一份组装代码，查看器看到的就是真正发出去的内容。
 * 扩展 App（app.js 先加载）。
 */
Object.assign(App, {
    /** 模组段落对应的消息标识。 */
    MODULE_SEGMENT_IDENTIFIERS: {
        background: 'module-background',
        interactors: 'module-interactors',
        variables: 'module-variables',
        queue: 'module-queue',
        delivery: 'module-delivery',
        progress: 'module-progress',
        operations: 'module-operations',
        module_summary: 'module-summary',
        global_summary: 'global-summary'
    },

    /** 需要单一 system 槽位的提供商：system 消息要合并成开头一条。 */
    SINGLE_SYSTEM_PROVIDERS: ['claude', 'google', 'cohere', 'claude_cli'],

    /**
     * 读取输入框和暂存的插件操作，得到这次要发的「剧情」与「场外」。
     * 发送与提示词预览共用这一份。
     */
    _collectUserTurnInput(optionalMessage) {
        let roleplay;
        let meta;
        if (optionalMessage != null && String(optionalMessage).trim()) {
            const parsed = this._parseRoleplayMeta(optionalMessage);
            roleplay = parsed.roleplay;
            meta = parsed.meta;
        } else {
            const input = document.getElementById('user-input');
            const metaInput = document.getElementById('user-meta-input');
            roleplay = (input && input.value) ? input.value.trim() : '';
            meta = (metaInput && metaInput.value) ? metaInput.value.trim() : '';
        }
        // 暂存的插件操作随这一轮一起发给 AI
        const pendingText = this.formatPendingForPrompt ? this.formatPendingForPrompt() : '';
        if (pendingText) roleplay = roleplay ? (roleplay + '\n\n' + pendingText) : pendingText;
        return { roleplay, meta, pendingText };
    },

    /** 这一轮写进聊天记录的两条消息（场外块 + 用户消息），发送与预览用同一份。 */
    _userTurnMessages(roleplay, meta) {
        const out = [];
        if (meta) {
            out.push({
                role: 'system',
                content: `<user_meta>\n${this.META_INSTRUCTION}\n\n${meta}\n</user_meta>`,
                identifier: 'user-meta-block',
                metaContent: meta,
                injected: true
            });
        }
        out.push({
            role: 'user',
            content: roleplay || (!meta ? this.PROMPT_EMPTY_USER_PLACEHOLDER : I18n.t('(仅场外)')),
            roleplay,
            meta
        });
        return out;
    },

    /**
     * 模组七段（背景 / 交互器 / 变量 / 队列 / 投递 / 指令 / 进程信息）。
     * 只读：不改状态，预览和发送都用它。
     * @returns {{ segments: Array<{id, text}>, ctx: object, warning: string }}
     */
    _moduleSegments() {
        const ctx = { moduleIds: [], variableIds: [], completableIds: [], conditionalTitles: [], turn: this._currentTurnNumber() };
        const cur = typeof ModuleManager !== 'undefined' ? ModuleManager.getCurrent() : null;
        if (!cur) return { segments: [], ctx, warning: '' };
        const engine = this.buildEngine();
        if (!engine) {
            const loading = !!this._engineConfigLoading[cur.id];
            return { segments: [], ctx, warning: loading ? I18n.t('模组数据还在读取') : I18n.t('当前模组不是新版格式，没有模组提示词') };
        }
        const pg = engine.promptGenerator;
        pg.turn = ctx.turn;
        pg.windowTurns = this._windowTurns();
        pg.failedOps = Array.isArray(State.lastFailedOps) ? State.lastFailedOps : [];
        const ms = engine.moduleSystem;
        const currentId = ms.getCurrentModuleIds()[0] || ms.rootModuleId;
        const segments = pg.generateSegments(currentId);
        if (!segments.some(s => s.id === 'global_summary') && State.currentSummary && String(State.currentSummary).trim()) {
            segments.push({ id: 'global_summary', text: '```global_summary\n' + String(State.currentSummary).trim() + '\n```' });
        }
        ctx.moduleIds = Array.from(pg.lastVisibleModuleIds);
        ctx.variableIds = Array.from(pg.lastVisibleVariableIds);
        ctx.completableIds = Array.from(pg.lastCompletableModuleIds);
        ctx.conditionalTitles = pg.lastShownConditionalTitles.slice();
        return { segments, ctx, warning: '' };
    },

    /**
     * 组装完整消息数组。顺序（首因 / 近因）：
     * 1. 人设与名字  2. 写作指导（创作向）  3. 补丁  4. 模组七段（除指令段）
     * 5. 对话历史  6. 指令段  7. 写作指导（格式 / 思维 / 规则）+ 场外说明 + 预设
     * 当前条 user 只发剧情，场外放在前一条 system 的 &lt;user_meta&gt; 里。
     * @param {object} p - { roleplay, meta, history }，history 默认是当前聊天记录
     * @returns {{ messages: Array, ctx: object, warning: string }}
     */
    _assembleMessages({ roleplay, meta, history }) {
        const userMessage = (roleplay != null && String(roleplay).trim()) ? String(roleplay).trim() : '';
        const metaContent = (meta != null && String(meta).trim()) ? String(meta).trim() : '';
        const displaySettings = Storage.getSettings() || {};
        const userName = PersonaManager.current?.name || State.gameState?.playerName || I18n.t('玩家');
        const aiName = displaySettings.aiName || I18n.t('故事之声');
        // function 形式的 replace，避免 userName 含 $& 等替换标记被解释
        const replaceUser = (s) => (typeof s === 'string' ? s.replace(/\{\{user\}\}/g, () => userName) : s);

        const recentTotal = Math.max(20, (displaySettings.chatHistoryContextSize ?? 20));
        const recentFullCount = Math.min(10, Math.max(2, (displaySettings.recentFullMessagesCount ?? 5)));
        const fullHistory = (history || State.chatHistory || []).filter(m => m && !m.uiOnly);
        const recentHistory = fullHistory.slice(-recentTotal);
        const settings = displaySettings;

        // ——— 1. 人设 / 名字 ———
        const frontMessages = [];
        if (PersonaManager.current) {
            let personaContent = `Persona: ${PersonaManager.current.name}\n${PersonaManager.current.content}`;
            if (displaySettings.always_add_names !== false) personaContent += '\n\n' + I18n.t('用户名字：{name}', { name: userName }) + '\n' + I18n.t('AI名字：{name}', { name: aiName });
            frontMessages.push({ role: 'system', content: personaContent, identifier: 'persona', injected: true });
        } else if (displaySettings.always_add_names !== false) {
            frontMessages.push({ role: 'system', content: I18n.t('用户名字：{name}', { name: userName }) + '\n' + I18n.t('AI名字：{name}', { name: aiName }), identifier: 'names', injected: true });
        }

        // ——— 2. 写作指导·创作向 ———
        const writingGuideFront = [];
        if (settings.useBuiltinWritingGuide !== false && typeof WritingGuide !== 'undefined' && WritingGuide.getEntries) {
            const pov = settings.writingGuidePOV;
            if (pov && pov !== 'off' && WritingGuide.POV_CONTENT && WritingGuide.POV_CONTENT[pov]) {
                const c = String(WritingGuide.POV_CONTENT[pov]).trim();
                if (c) writingGuideFront.push({ role: 'system', content: c, identifier: 'wg-pov', injected: true });
            }
            const wgEntries = WritingGuide.getEntries().filter(e => e.enabled !== false && e.content && String(e.content).trim());
            for (const e of wgEntries) {
                if (this._isWritingGuideEndEntry(e.identifier)) continue;
                writingGuideFront.push({ role: e.role || 'system', content: String(e.content).trim(), identifier: e.identifier || 'wg-entry', label: e.name, injected: true });
            }
        }

        // ——— 3. 补丁 ———
        const worldbookMessages = [];
        const contextParts = [];
        if (State.currentSummary && String(State.currentSummary).trim()) contextParts.push(String(State.currentSummary).trim());
        for (let i = Math.max(0, recentHistory.length - 8); i < recentHistory.length; i++) {
            const msg = recentHistory[i];
            if (msg && (msg.content || '').trim()) contextParts.push(String(msg.content).trim());
        }
        const patchContextString = contextParts.join('\n');
        if (typeof Patches !== 'undefined' && Patches.getEnabledPatchMessagesSync) {
            const patchMessages = Patches.getEnabledPatchMessagesSync(displaySettings, null, patchContextString);
            patchMessages.forEach((m, i) => {
                const c = (m.content && String(m.content).trim()) ? String(m.content).trim() : '';
                if (c) worldbookMessages.push({ role: m.role || 'system', content: c, identifier: m.identifier || `patch-${i}`, label: m.label, injected: true });
            });
        }

        // ——— 4. 模组七段 ———
        const mod = this._moduleSegments();
        const idOf = (segId) => this.MODULE_SEGMENT_IDENTIFIERS[segId] || ('module-' + segId);
        const toMsg = (s) => ({ role: 'system', content: s.text, identifier: idOf(s.id), injected: true });
        const moduleMessages = mod.segments.filter(s => s.id !== 'progress').map(toMsg);
        const progressMessages = mod.segments.filter(s => s.id === 'progress').map(toMsg);

        // ——— 5. 对话历史 ———
        let lastUserMetaBlockIndex = -1;
        for (let j = recentHistory.length - 1; j >= 0; j--) {
            if (recentHistory[j].identifier === 'user-meta-block') { lastUserMetaBlockIndex = j; break; }
        }
        const chatMessages = [];
        for (let i = 0; i < recentHistory.length; i++) {
            const msg = recentHistory[i];
            if (msg.identifier === 'user-meta-block') {
                if (i === lastUserMetaBlockIndex) {
                    chatMessages.push({ role: msg.role, content: msg.content || '', identifier: msg.identifier || 'user-meta-block', injected: true });
                } else {
                    let rawMeta = msg.metaContent;
                    if (rawMeta == null || rawMeta === '') {
                        const c = (msg.content || '').replace(/<user_meta>\s*/i, '');
                        const end = c.indexOf('\n</user_meta>');
                        const inner = end >= 0 ? c.slice(0, end) : c;
                        const nn = inner.indexOf('\n\n');
                        rawMeta = (nn >= 0 ? inner.slice(nn + 2) : inner).trim();
                    }
                    chatMessages.push({ role: msg.role, content: `<user_meta>\n${rawMeta || ''}\n</user_meta>`, identifier: msg.identifier || 'user-meta-block', injected: true });
                }
                continue;
            }
            let content = msg.content || '';
            if (msg.role === 'assistant' && i < recentHistory.length - recentFullCount) {
                const summary = (msg.turnSummary && String(msg.turnSummary).trim()) ? String(msg.turnSummary).trim() : '';
                content = summary ? I18n.t('[本轮摘要] {summary}', { summary }) : content;
            }
            chatMessages.push({ role: msg.role, content, identifier: msg.identifier || `chat-${chatMessages.length}` });
        }
        // 历史里没有当前这一条（比如时间推进自动触发的提问）：补一条，不塞假的「继续」
        const hasCurrentContent = userMessage || metaContent;
        const lastRole = chatMessages.length > 0 ? chatMessages[chatMessages.length - 1].role : null;
        if (lastRole !== 'user' && hasCurrentContent) {
            if (metaContent) {
                chatMessages.push({ role: 'system', content: `<user_meta>\n${this.META_INSTRUCTION}\n\n${metaContent}\n</user_meta>`, identifier: 'user-meta-block', injected: true });
            }
            const currentUserContent = userMessage || (!metaContent ? this.PROMPT_EMPTY_USER_PLACEHOLDER : I18n.t('(仅场外)'));
            chatMessages.push({ role: 'user', content: currentUserContent, identifier: 'current-user' });
        }

        // ——— 6. 写作指导·格式 / 思维 / 规则 + 预设 ———
        const writingGuideEnd = this._getWritingGuideEndMessages();
        const endMessages = this._getPresetPromptMessages();
        // 场外说明讲的是「下面对话里的 <user_meta> 块」：只在对话里真有场外块时发，放在对话历史前面；
        // 写作指导末尾的 AI 开头（预填）因此保持在倒数位置，不被它挤开
        const hasMeta = chatMessages.some(m => m.identifier === 'user-meta-block');
        const metaGuidance = hasMeta ? [{ role: 'system', content: this.META_BLOCK_GUIDANCE, identifier: 'user-meta-guidance', injected: true }] : [];

        let base = [...frontMessages, ...writingGuideFront, ...worldbookMessages, ...moduleMessages, ...metaGuidance, ...chatMessages, ...progressMessages, ...writingGuideEnd, ...endMessages];
        // 酒馆「半支持」层：世界书 / 作者注释按它自己的规则注入；模组内容原样保留为主体
        if (window.TavernLayer && TavernLayer.apply) {
            try {
                const scanText = chatMessages.slice(-10).map(m => (m && m.content) || '').join('\n');
                base = TavernLayer.apply(base, scanText);
            } catch (e) {
                throw new Error(I18n.t('世界书注入失败：{error}', { error: e && e.message ? e.message : e }));
            }
        }
        base.forEach((m) => {
            if (m && typeof m.content === 'string') m.content = replaceUser(m.content);
        });
        return { messages: base, ctx: mod.ctx, warning: mod.warning };
    },

    /** 真实发送用：基于当前聊天记录（当前这一轮已写入）组装。 */
    _buildMessages(roleplay, metaContent) {
        return this._assembleMessages({ roleplay, meta: metaContent }).messages;
    },

    /**
     * 发送前的准备：确保模组配置已读到，组装消息，同时给出本回合发给 AI 的可操作范围。
     * @returns {Promise<{ messages: Array, ctx: object, warning: string }>}
     */
    async prepareTurn(roleplay, meta) {
        if (this._summaryJob) await this._summaryJob;
        await this.ensureEngineConfig();
        return this._assembleMessages({ roleplay, meta });
    },

    /**
     * 按提供商把消息整理成真正发出去的形式，并保留每条的来源标识（查看器显示用）。
     * 需要单一 system 槽位的提供商：开头连续的 system 合并成一条，之后的 system 改成 user 消息。
     */
    wireWithSources(messages, provider) {
        const prov = provider || (Storage.getAPIConfig() || {}).provider;
        const list = (messages || []).map(m => ({ role: m.role, content: m.content, sources: [m.identifier || m.role], labels: [m.label || ''] }));
        if (!this.SINGLE_SYSTEM_PROVIDERS.includes(prov)) return list;
        const out = [];
        let i = 0;
        const lead = { role: 'system', content: '', sources: [], labels: [] };
        while (i < list.length && list[i].role === 'system') {
            lead.content += (lead.content ? '\n\n' : '') + list[i].content;
            lead.sources.push(...list[i].sources);
            lead.labels.push(...list[i].labels);
            i++;
        }
        if (lead.sources.length) out.push(lead);
        for (; i < list.length; i++) {
            out.push(list[i].role === 'system' ? { ...list[i], role: 'user' } : list[i]);
        }
        return out;
    },

    /** 真正交给接口层的消息：只有 role 与 content。 */
    toWireMessages(messages, provider) {
        return this.wireWithSources(messages, provider).map(m => ({ role: m.role, content: m.content }));
    },

    /**
     * 构建「此刻点发送」将要发出的完整消息（提示词查看器用）。
     * 与真实发送同一份组装：先把这一轮的场外块和用户消息放进历史，再组装。
     * @param {string} [userMessagePlaceholder] 传入则当作输入内容，否则读输入框
     * @returns {Array<{role, content, identifier?}>}
     */
    buildNextPromptPreview(userMessagePlaceholder) {
        const { roleplay, meta } = this._collectUserTurnInput(userMessagePlaceholder);
        const history = (State.chatHistory || []).concat(this._userTurnMessages(roleplay, meta));
        return this._assembleMessages({ roleplay, meta, history }).messages;
    },

    /** 写作指导条目是否属于「放最后」类（格式 / 思维 / 规则 / ECoT 等，近因效应）。 */
    _isWritingGuideEndEntry(identifier) {
        if (identifier == null || identifier === '') return false;
        const id = String(identifier).toLowerCase();
        return id.includes('ecot') || id.includes('rule') || id.includes('voice-tail') || id.includes('template') || id.includes('format') || id.includes('思维') || id.includes('格式');
    },

    /** 写作指导里「放最后」的条目（ECoT 模板、RULE 等）。 */
    _getWritingGuideEndMessages() {
        const out = [];
        const settings = Storage.getSettings() || {};
        if (settings.useBuiltinWritingGuide === false || typeof WritingGuide === 'undefined' || !WritingGuide.getEntries) return out;
        const wgEntries = WritingGuide.getEntries().filter(e => e.enabled !== false && e.content && String(e.content).trim());
        for (const e of wgEntries) {
            if (!this._isWritingGuideEndEntry(e.identifier)) continue;
            out.push({ role: e.role || 'system', content: String(e.content).trim(), identifier: e.identifier || 'wg-end', label: e.name, injected: true });
        }
        return out;
    },

    /** 当前预设的 prompt 消息数组，拼在消息列表最后。 */
    _getPresetPromptMessages() {
        if (!PresetManager.currentPreset) return [];
        const preset = PresetManager.currentPreset;
        if (preset.enabled === false || preset.settings?.enabled === false || preset.settings?.usePreset === false) return [];
        const orderEntries = PresetManager.getPromptOrderForCharacter(null);
        const enabledIds = new Set(orderEntries.filter(e => e.enabled !== false).map(e => e.identifier));
        const orderedPrompts = PresetManager.getCurrentPrompts();
        const list = orderedPrompts.filter(p => enabledIds.has(p.identifier) && p.content && String(p.content).trim());
        return list.map(p => ({ role: p.role || 'system', content: String(p.content).trim(), identifier: p.identifier || 'preset', label: p.name, injected: true }));
    }
});
