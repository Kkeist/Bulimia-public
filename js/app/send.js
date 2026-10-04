/**
 * 发送：用户输入格式化、插件暂存动作、发送消息、停止生成。
 * 扩展 App（app.js 先加载）。
 */
Object.assign(App, {
    /**
     * 用户看到的展示内容：剧情 + 若有场外则一行【场外】有事/无（不把整段场外贴出来）。
     * @param {string} roleplay - 剧情/扮演
     * @param {string} meta - 场外指令
     * @param {boolean} [allowEmptyAdvance] - 两者都空时是否算「自动推进」
     * @returns {string|null} 展示用字符串；两者都空且 allowEmptyAdvance 为 false 时返回 null
     */
    _formatUserDisplayContent(roleplay, meta, allowEmptyAdvance = true) {
        const r = (roleplay != null && String(roleplay).trim()) ? String(roleplay).trim() : '';
        const m = (meta != null && String(meta).trim()) ? String(meta).trim() : '';
        if (!r && !m) return allowEmptyAdvance ? I18n.t('【场外】自动推进') : null;
        if (r && !m) return r;
        if (!r && m) return I18n.t('【场外】有事');
        return r + '\n' + I18n.t('【场外】有事');
    },

    /**
     * 从「可选消息」字符串解析出 roleplay / meta（兼容旧格式【剧情】\n...\n\n【场外指令】\n...）。
     * @param {string} raw
     * @returns {{ roleplay: string, meta: string }}
     */
    _parseRoleplayMeta(raw) {
        const s = (raw != null && String(raw).trim()) ? String(raw).trim() : '';
        const metaLabel = (s.includes(I18n.t('【场外指令】')) ? I18n.t('【场外指令】') : '【场外指令】');
        const roleplayLabel = (s.includes(I18n.t('【剧情】')) ? I18n.t('【剧情】') : '【剧情】');
        const idxMeta = s.indexOf(metaLabel);
        const idxRole = s.indexOf(roleplayLabel);
        if (idxMeta >= 0 && idxRole >= 0) {
            const afterRole = idxRole + roleplayLabel.length;
            const roleEnd = idxMeta > idxRole ? idxMeta : s.length;
            let roleplay = s.slice(afterRole, roleEnd).replace(/\n+$/, '').trim();
            let meta = idxMeta >= 0 ? s.slice(idxMeta + metaLabel.length).replace(/\n+$/, '').trim() : '';
            return { roleplay: roleplay || '', meta: meta || '' };
        }
        if (idxMeta >= 0) {
            const meta = s.slice(idxMeta + metaLabel.length).replace(/\n+$/, '').trim();
            return { roleplay: '', meta: meta || '' };
        }
        return { roleplay: s, meta: '' };
    },

    /**
     * 将「剧情/扮演」与「场外指令」合并为发给 AI 的单条用户内容字符串（旧逻辑，用于兼容/历史）。
     * @param {string} roleplay - 剧情/扮演内容
     * @param {string} meta - 场外指令内容
     * @param {boolean} [allowEmptyAdvance] - 当两者都空时是否用「要求自动推进」，默认 true
     * @returns {string|null} 合并后的内容；若两者都空且 allowEmptyAdvance 为 false 则返回 null
     */
    _formatUserContent(roleplay, meta, allowEmptyAdvance = true) {
        const r = (roleplay != null && String(roleplay).trim()) ? String(roleplay).trim() : '';
        const m = (meta != null && String(meta).trim()) ? String(meta).trim() : '';
        if (!r && !m) return allowEmptyAdvance ? `${I18n.t('【场外指令】')}\n${this.AUTO_ADVANCE_TEXT}` : null;
        if (r && !m) return r;
        if (!r && m) return `${I18n.t('【场外指令】')}\n${m}`;
        return `${I18n.t('【剧情】')}\n${r}\n\n${I18n.t('【场外指令】')}\n${m}`;
    },

    // ===== 发送消息（从 game/ 迁移）=====
    /**
     * 暂存交互模型：
     * iframe 插件按钮点击 → 写变量给即时反馈 + 推进 State.pendingPluginActions 暂存队列
     * 用户点主输入框「发送」时把暂存动作合并到正文末尾一起送 AI；发完清空。
     * 持久化到 State 让刷新不丢；UI 用 #pending-plugin-actions 区显示。
     */
    addPendingPluginAction(action) {
        if (!State.pendingPluginActions) State.pendingPluginActions = [];
        State.pendingPluginActions.push(action);
        // 2026-06-05：cap 100 防玩家攒着不发累积无限（正常 sendMessage 会清空，cap 是 safety net）
        const MAX_PENDING_PLUGIN_ACTIONS = 100;
        while (State.pendingPluginActions.length > MAX_PENDING_PLUGIN_ACTIONS) State.pendingPluginActions.shift();
        if (typeof App !== 'undefined' && App.autoSaveToCurrentSlot) App.autoSaveToCurrentSlot();
    },

    removePendingPluginAction(index) {
        if (!Array.isArray(State.pendingPluginActions)) return;
        State.pendingPluginActions.splice(index, 1);
        this.renderPendingPluginActions();
        if (typeof App !== 'undefined' && App.autoSaveToCurrentSlot) App.autoSaveToCurrentSlot();
    },

    clearPendingPluginActions() {
        State.pendingPluginActions = [];
        this.renderPendingPluginActions();
        if (typeof App !== 'undefined' && App.autoSaveToCurrentSlot) App.autoSaveToCurrentSlot();
    },

    /**
     * 把暂存的动作拼成给 AI 看的字符串。格式：
     *   〔本回合插件操作〕
     *   - 修炼交互：玩家选择开始修炼
     *   - NPC对话：玩家发送「你好」
     * 没暂存返回空字符串。
     */
    formatPendingForPrompt() {
        return PluginRuntime.formatPending(State.pendingPluginActions);
    },

    /**
     * 渲染暂存动作区 #pending-plugin-actions（主输入框上方），列每条 + 单删 + 全部清除按钮。
     * 没暂存时整块隐藏（display:none）让 UI 不占空。
     */
    renderPendingPluginActions() {
        const box = document.getElementById('pending-plugin-actions');
        if (!box) return;
        const arr = Array.isArray(State.pendingPluginActions) ? State.pendingPluginActions : [];
        if (arr.length === 0) {
            box.innerHTML = '';
            box.style.display = 'none';
            return;
        }
        box.style.display = 'block';
        const html = arr.map((a, i) =>
            `<div class="pending-action-item"><span class="pending-action-name">${(a.pluginName||a.pluginId||'').replace(/</g,'&lt;')}${I18n.t('：')}</span>` +
            `<span class="pending-action-desc">${(a.actionDesc||a.type||'').replace(/</g,'&lt;')}</span>` +
            `<button type="button" class="pending-action-remove" data-idx="${i}" title="${I18n.t('删除这条')}">×</button></div>`
        ).join('');
        box.innerHTML =
            `<div class="pending-actions-header">${I18n.t('暂存操作 ({n})', { n: arr.length })} <button type="button" id="pending-actions-clear" class="btn-small">${I18n.t('全部清除')}</button></div>` +
            `<div class="pending-actions-list">${html}</div>`;
        box.querySelectorAll('.pending-action-remove').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = Number(btn.dataset.idx);
                if (Number.isFinite(idx)) this.removePendingPluginAction(idx);
            });
        });
        const clearBtn = box.querySelector('#pending-actions-clear');
        if (clearBtn) clearBtn.addEventListener('click', () => this.clearPendingPluginActions());
    },

    async sendMessage(optionalMessage) {
        const input = document.getElementById('user-input');
        const metaInput = document.getElementById('user-meta-input');
        if (!input) return;

        // 未进入游戏时先进入游戏页并确保存档/引擎，避免首条消息发不出去、错过模组初始消息
        if (!State.currentSaveId || !Engine.isRunning) {
            await this.enterGame();
        }

        // 生成中禁止发送（必须先停止）
        if (this.isGenerating) {
            Toast.show(I18n.t('正在生成中，请先点击“停止”再发送新消息'), 'warning');
            return;
        }

        // 配置没填全就不动聊天和输入框，直接告诉玩家
        const configProblem = APIConnection.checkConfigured();
        if (configProblem) {
            Toast.show(configProblem, 'warning', 6000);
            return;
        }

        let roleplay;
        let meta;
        const fromInputs = !(optionalMessage != null && String(optionalMessage).trim());
        if (!fromInputs) {
            const parsed = this._parseRoleplayMeta(optionalMessage);
            roleplay = parsed.roleplay;
            meta = parsed.meta;
        } else {
            roleplay = input.value ? input.value.trim() : '';
            meta = metaInput ? (metaInput.value ? metaInput.value.trim() : '') : '';
        }
        // 发送失败时要还原到输入框的原样内容
        const draftRoleplay = roleplay;
        const draftMeta = meta;

        // 暂存交互合并：把 State.pendingPluginActions 拼成"〔本回合插件操作〕..."追加到 roleplay 末尾
        // 让用户的"打怪!"+ 攒的几个攻击/防御/施法点击 一起送 AI；发完清空
        const pendingText = this.formatPendingForPrompt ? this.formatPendingForPrompt() : '';
        if (pendingText) {
            roleplay = roleplay ? (roleplay + '\n\n' + pendingText) : pendingText;
        }

        const displayContent = this._formatUserDisplayContent(roleplay, meta, true);
        if (displayContent == null) return;

        if (fromInputs && input && metaInput) {
            input.value = '';
            metaInput.value = '';
        }

        // 如果是第一次发送消息，记录开始时间
        const hadStartTimestamp = !!State.gameStartTimestamp;
        if (!State.gameStartTimestamp && (!State.chatHistory || State.chatHistory.length === 0)) {
            State.gameStartTimestamp = Date.now();
        }

        // 失败时回到这个长度：撤掉这次发送加进聊天的消息
        const chatLengthBefore = ChatDisplay.messages.length;

        // 有场外时先往聊天记录里写一条单独的 instruction block，再写 user（没有发送场外就没有 block）
        if (meta) {
            const blockContent = `<user_meta>\n${this.META_INSTRUCTION}\n\n${meta}\n</user_meta>`;
            ChatDisplay.addMessage({
                role: 'system',
                content: blockContent,
                identifier: 'user-meta-block',
                metaContent: meta,
                injected: true
            });
        }
        const userContentForPrompt = roleplay || (!meta ? this.PROMPT_EMPTY_USER_PLACEHOLDER : I18n.t('(仅场外)'));
        ChatDisplay.addMessage({
            role: 'user',
            content: userContentForPrompt,
            roleplay,
            meta,
            personaName: PersonaManager.current?.name || null
        });

        // 显示生成状态
        this._showGenerating(true);

        try {
            await this.getAIResponse(roleplay, meta);

            // 这次发送已经记在聊天里，暂存的插件操作随之清空
            if (pendingText) this.clearPendingPluginActions();

            // 自动保存
            await this.autoSaveToCurrentSlot();

        } catch (error) {
            this._reportGenerateError(error);
            // 没有收到任何回复：撤销这次发送，输入框和暂存操作还原，玩家可以直接再发
            const gotReply = ChatDisplay.messages.slice(chatLengthBefore).some(m => m.role === 'assistant');
            if (gotReply) {
                if (pendingText) this.clearPendingPluginActions();
            } else {
                this._truncateChat(chatLengthBefore);
                if (!hadStartTimestamp) State.gameStartTimestamp = null;
                if (fromInputs && input && metaInput && !input.value && !metaInput.value) {
                    input.value = draftRoleplay;
                    metaInput.value = draftMeta;
                    input.dispatchEvent(new Event('input'));
                    metaInput.dispatchEvent(new Event('input'));
                }
                await this.autoSaveToCurrentSlot();
            }
        } finally {
            // 隐藏生成状态
            this._showGenerating(false);
        }
    },

    /**
     * 显示/隐藏生成状态
     */
    _showGenerating(show) {
        this.isGenerating = show;
        if (show) {
            this._stopRequested = false;
            this._generationSeq = (this._generationSeq || 0) + 1;
        }

        const loadingEl = document.getElementById('chat-loading');
        const stopBtn = document.getElementById('btn-stop');
        const sendBtn = document.getElementById('btn-send');

        if (show) {
            loadingEl?.classList.remove('hidden');
            stopBtn?.classList.remove('hidden');
            sendBtn?.classList.add('hidden');
        } else {
            loadingEl?.classList.add('hidden');
            stopBtn?.classList.add('hidden');
            sendBtn?.classList.remove('hidden');
            this.abortController = null;
        }
    },

    /**
     * 停止AI生成：中断请求，已收到的内容由生成流程保留；
     * 界面状态在生成流程收尾时恢复，超过 3 秒还没恢复就强制恢复。
     */
    stopGeneration() {
        if (!this.isGenerating) return;
        this._stopRequested = true;
        if (this.abortController) this.abortController.abort();
        Toast.show(I18n.t('已停止生成'), 'info');
        const seq = this._generationSeq;
        setTimeout(() => {
            if (this.isGenerating && this._generationSeq === seq) {
                this._showGenerating(false);
                ChatDisplay.finishStreamingMessage();
            }
        }, 3000);
    }
});
