/**
 * 调试查看器
 * 显示完整的输出内容，包括thinking、e-cot、原始输出等
 */
const DebugViewer = {
    lastResponse: null,
    lastSent: null,
    promptMode: 'next',

    /**
     * 初始化
     */
    init() {
        this.bindEvents();
        this.refreshPrompt();
    },

    /**
     * 绑定事件
     */
    bindEvents() {
        // 刷新按钮
        document.getElementById('btn-debug-refresh-prompt')?.addEventListener('click', () => {
            this.refreshPrompt();
        });

        document.getElementById('btn-debug-prompt-mode-next')?.addEventListener('click', () => this.switchPromptMode('next'));
        document.getElementById('btn-debug-prompt-mode-last')?.addEventListener('click', () => this.switchPromptMode('last'));
        document.getElementById('btn-debug-prompt-fold')?.addEventListener('click', () => this.toggleAllBlocks());

        // 复制按钮
        document.getElementById('btn-debug-copy-prompt')?.addEventListener('click', () => {
            this.copyPrompt();
        });

        // 输出标签切换
        document.querySelectorAll('.debug-output-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const outputType = e.currentTarget.dataset.output;
                this.switchOutputTab(outputType);
            });
        });

        // 写作指导
        document.getElementById('btn-debug-wg-save')?.addEventListener('click', () => this.saveWritingGuide());
        document.getElementById('btn-debug-wg-reset')?.addEventListener('click', () => this.resetWritingGuide());
        document.getElementById('btn-debug-wg-add')?.addEventListener('click', () => this.addWritingGuideEntry());
        document.getElementById('btn-debug-wg-import')?.addEventListener('click', () => document.getElementById('file-import-writing-guide')?.click());
        document.getElementById('file-import-writing-guide')?.addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0];
            e.target.value = '';
            await this.importWritingGuideFile(file);
        });

        // 原始回复
        document.getElementById('btn-debug-refresh-raw-replies')?.addEventListener('click', () => { if (window.DebugModuleJump) DebugModuleJump.renderRawTab(); });
    },

    /**
     * 刷新写作指导列表（调试区）
     */
    refreshWritingGuideList() {
        const listEl = document.getElementById('debug-writing-guide-list');
        if (!listEl) return;
        if (typeof WritingGuide === 'undefined' || !WritingGuide.getEntries) {
            listEl.innerHTML = `<div class="debug-item">${I18n.t('未加载写作指导模块')}</div>`;
            return;
        }
        const entries = WritingGuide.getEntries();
        const breakNsfwIds = WritingGuide.BREAK_NSFW_IDS || [];
        document.getElementById('debug-wg-break-hint')?.classList.toggle('hidden', breakNsfwIds.length === 0);
        const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const hasOwn = entries.some(e => !WritingGuide.isProtocolEntry(e.identifier));
        const emptyHint = hasOwn ? '' : `<div class="debug-item debug-wg-empty">${I18n.t('还没有写作指导。可以添加条目，或导入文件。')}</div>`;
        listEl.innerHTML = emptyHint + entries.map((e, idx) => {
            const id = esc(e.identifier || '');
            const checked = e.enabled !== false ? ' checked' : '';
            const isMasterControlled = breakNsfwIds.includes(e.identifier);
            const isFixed = isMasterControlled || WritingGuide.isProtocolEntry(e.identifier);
            const controlledBySwitch = isMasterControlled ? ` <span class="debug-wg-master-hint">${I18n.t('由设置里的开关控制')}</span>` : '';
            const checkboxReadonly = isMasterControlled ? ' disabled' : '';
            const del = isFixed ? '' : `<button type="button" class="btn-small btn-ghost danger wg-del" data-identifier="${id}" onclick="event.stopPropagation()">${I18n.t('删除')}</button>`;
            return `
                <details class="debug-wg-card" data-identifier="${id}" data-index="${idx}">
                    <summary>
                        <input type="checkbox" class="wg-enabled" data-identifier="${id}"${checked}${checkboxReadonly} onclick="event.stopPropagation()">
                        <input type="text" class="wg-name" data-identifier="${id}" placeholder="${I18n.t('名称')}" onclick="event.stopPropagation()">
                        ${controlledBySwitch}
                        ${del}
                        <span class="cx-caret debug-wg-toggle" aria-hidden="true"></span>
                    </summary>
                    <div class="debug-wg-body">
                        <textarea class="wg-content" data-identifier="${id}" rows="6" placeholder="${I18n.t('内容')}"></textarea>
                    </div>
                </details>`;
        }).join('');
        entries.forEach((e, idx) => {
            const card = listEl.querySelector(`.debug-wg-card[data-index="${idx}"]`);
            if (!card) return;
            const nameEl = card.querySelector('.wg-name');
            const contentEl = card.querySelector('.wg-content');
            if (nameEl) nameEl.value = e.name || '';
            if (contentEl) contentEl.value = e.content || '';
        });
        listEl.querySelectorAll('.wg-del').forEach(btn => btn.addEventListener('click', () => this.deleteWritingGuideEntry(btn.dataset.identifier)));
    },

    /** 从调试区表单读出当前所有条目 */
    _collectWritingGuide() {
        const listEl = document.getElementById('debug-writing-guide-list');
        const entries = [];
        if (!listEl) return entries;
        listEl.querySelectorAll('.debug-wg-card').forEach((div) => {
            const identifier = div.dataset.identifier;
            if (!identifier) return;
            const enabled = div.querySelector('.wg-enabled')?.checked !== false;
            const name = (div.querySelector('.wg-name')?.value || '').trim();
            const content = (div.querySelector('.wg-content')?.value || '').trim();
            entries.push({ identifier, name, content, enabled });
        });
        return entries;
    },

    /**
     * 保存写作指导（从调试区表单写回 Storage）
     */
    saveWritingGuide() {
        if (typeof WritingGuide === 'undefined' || !WritingGuide.saveEntries) { Toast.show(I18n.t('写作指导现在不能保存。'), 'error'); return; }
        if (!document.getElementById('debug-writing-guide-list')) return;
        WritingGuide.saveEntries(this._collectWritingGuide());
        Toast.show(I18n.t('写作指导已保存。'), 'success');
    },

    /** 新增一条空白条目：先把表单里的改动一起保存，再展开新条目 */
    addWritingGuideEntry() {
        if (typeof WritingGuide === 'undefined' || !WritingGuide.saveEntries) { Toast.show(I18n.t('写作指导现在不能保存。'), 'error'); return; }
        const entry = { identifier: WritingGuide.newIdentifier(), name: '', content: '', enabled: true };
        WritingGuide.saveEntries(this._withEntries([entry]));
        this.refreshWritingGuideList();
        const card = document.querySelector(`#debug-writing-guide-list .debug-wg-card[data-identifier="${entry.identifier}"]`);
        if (card) { card.open = true; card.querySelector('.wg-name')?.focus(); card.scrollIntoView({ block: 'nearest' }); }
    },

    /** 当前表单里的条目加上新条目；新条目接在结束段之前，与 getEntries 的排法一致 */
    _withEntries(extra) {
        const cur = this._collectWritingGuide();
        const at = cur.findIndex(e => e.identifier === 'wg-wrap-end');
        cur.splice(at < 0 ? cur.length : at, 0, ...extra);
        return cur;
    },

    /** 导入文件：JSON（含 prompts 数组）或文本文件 */
    async importWritingGuideFile(file) {
        if (!file) return;
        let entries;
        try {
            entries = WritingGuide.parseImport(await file.text(), file.name);
        } catch (e) {
            Toast.show(e.message, 'error');
            return;
        }
        WritingGuide.saveEntries(this._withEntries(entries));
        this.refreshWritingGuideList();
        Toast.show(I18n.t('已导入 {n} 条写作指导。', { n: entries.length }), 'success');
    },

    /** 删除一条自己添加或导入的条目，给撤销 */
    deleteWritingGuideEntry(identifier) {
        const before = this._collectWritingGuide();
        const rest = before.filter(e => e.identifier !== identifier);
        if (rest.length === before.length) return;
        WritingGuide.saveEntries(rest);
        this.refreshWritingGuideList();
        Toast.undo(I18n.t('已删除一条写作指导。'), () => {
            WritingGuide.saveEntries(before);
            this.refreshWritingGuideList();
        });
    },

    /**
     * 恢复写作指导为默认：会丢掉现在的修改，先问一句
     */
    async resetWritingGuide() {
        if (typeof WritingGuide === 'undefined' || !WritingGuide.resetToDefault) { Toast.show(I18n.t('写作指导现在不能恢复默认。'), 'error'); return; }
        const ok = await Modal.confirm(I18n.t('恢复默认'), I18n.t('现在的修改会全部丢掉。'), { confirmLabel: I18n.t('恢复'), danger: true });
        if (!ok) return;
        WritingGuide.resetToDefault();
        this.refreshWritingGuideList();
        Toast.show(I18n.t('已恢复为默认写作指导。'), 'success');
    },

    /**
     * 切换输出标签
     */
    switchOutputTab(outputType) {
        document.querySelectorAll('.debug-output-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.output === outputType);
        });

        document.querySelectorAll('.debug-output-content').forEach(content => {
            // 匹配完整的content ID
            const contentId = content.id;
            const expectedId = `debug-prompt-content-${outputType}`;
            content.classList.toggle('active', contentId === expectedId);
        });
    },

    /** 消息来源的中文名：类别，再加上条目自己的名字（写作指导、补丁、预设各条目分得开）。 */
    _sourceLabel(id, name) {
        const exact = {
            persona: '人设', names: '名字', 'module-background': '背景', 'module-interactors': '交互器', 'module-variables': '变量',
            'module-queue': '队列', 'module-delivery': '投递', 'module-progress': '指令', 'module-operations': '最近操作',
            'module-summary': '模块总结', 'global-summary': '全局总结', 'user-meta-block': '场外', 'user-meta-guidance': '场外说明',
            'current-user': '本轮用户消息', 'wg-pov': '写作指导·人称', 'tavern-authors-note': '作者注释'
        };
        if (exact[id]) return I18n.t(exact[id]);
        let kind = '';
        if (/^wg-/.test(id)) kind = '写作指导';
        else if (/^patch-/.test(id)) kind = '补丁';
        else if (/^tavern-wb-/.test(id)) kind = '世界书';
        else if (/^chat-/.test(id) || id === 'user' || id === 'assistant' || id === 'system') kind = '对话';
        else kind = '输出预设';
        return name ? I18n.t(kind) + '·' + name : I18n.t(kind);
    },

    /** 一条消息的来源说明：同一条里合并了多段时逐段列出，重复的只写一次。 */
    _labelOf(m) {
        const names = m.labels || [];
        return (m.sources || []).map((s, k) => this._sourceLabel(s, names[k])).filter((s, k, arr) => arr.indexOf(s) === k).join(I18n.pick({ zh: '、', en: ', ' }));
    },

    /** 当前要显示的消息列表 [{role, content, sources}]，以及说明文字。 */
    _currentWire() {
        if (this.promptMode === 'last') {
            if (!this.lastSent || !this.lastSent.length) return { wire: [], note: I18n.t('还没有发送过消息。') };
            return { wire: this.lastSent, note: '' };
        }
        if (typeof App === 'undefined' || !App.buildNextPromptPreview) return { wire: [], note: I18n.t('游戏还没有准备好。') };
        const cur = typeof ModuleManager !== 'undefined' ? ModuleManager.getCurrent() : null;
        if (cur && !App.getEngineConfig() && App._engineConfigLoading) {
            App.ensureEngineConfig().then(() => this.refreshPrompt()).catch(() => this.refreshPrompt());
        }
        try {
            const wire = App.wireWithSources(App.buildNextPromptPreview());
            const note = (cur && !App.getEngineConfig()) ? I18n.t('模组数据还没读到，模组相关的段落暂时没有。') : '';
            return { wire, note };
        } catch (e) {
            return { wire: [], note: I18n.t('提示词生成失败：') + (e && e.message ? e.message : e) };
        }
    },

    /**
     * 刷新Prompt显示：默认显示「此刻点发送将发出的内容」（与真实发送同一份组装），
     * 也可切到「上次实际发送」。折叠状态和滚动位置在刷新后保持。
     */
    refreshPrompt() {
        const { wire, note } = this._currentWire();
        const fullPrompt = this.buildFullPrompt(wire);
        this._renderPromptBlocks(wire, note);
        const thinking = this.extractThinking();
        const ecot = this.extractEcot();
        const qa = this.extractQA();
        const prediction = this.extractPrediction();
        const raw = this.getRawOutput();

        document.getElementById('debug-thinking-content').value = thinking;
        document.getElementById('debug-ecot-content').value = ecot;
        const qaEl = document.getElementById('debug-qa-content');
        if (qaEl) qaEl.value = qa;
        const predictionEl = document.getElementById('debug-prediction-content');
        if (predictionEl) predictionEl.value = prediction;
        document.getElementById('debug-raw-content').textContent = raw;

        const tokenCountEl = document.getElementById('debug-token-count');
        if (tokenCountEl) {
            let tokens = 0;
            if (typeof TokenCounter !== 'undefined') {
                tokens = wire.length ? TokenCounter.countMessages(wire.map(m => ({ role: m.role, content: m.content }))) : TokenCounter.countText(fullPrompt);
            }
            tokenCountEl.textContent = String(tokens || 0);
        }
        document.getElementById('btn-debug-prompt-mode-next')?.classList.toggle('active', this.promptMode !== 'last');
        document.getElementById('btn-debug-prompt-mode-last')?.classList.toggle('active', this.promptMode === 'last');
    },

    /** 把消息列表画成可折叠的分块；已展开的块和滚动位置保持不变。 */
    _renderPromptBlocks(wire, note) {
        const box = document.getElementById('debug-prompt-content');
        if (!box) return;
        if (!this._openBlocks) this._openBlocks = {};
        const scrollTop = box.scrollTop;
        const frag = document.createDocumentFragment();
        if (note) {
            const n = document.createElement('div');
            n.className = 'prompt-note';
            n.textContent = note;
            frag.appendChild(n);
        }
        wire.forEach((m, i) => {
            const label = this._labelOf(m);
            const key = i + '|' + (m.sources || []).join(',');
            const d = document.createElement('details');
            d.className = 'prompt-block';
            d.dataset.key = key;
            d.open = !!this._openBlocks[key];
            d.addEventListener('toggle', () => { this._openBlocks[key] = d.open; });
            const s = document.createElement('summary');
            s.innerHTML = '<span class="prompt-block-index"></span><span class="prompt-block-source"></span><span class="prompt-block-role"></span><span class="prompt-block-size"></span>';
            s.children[0].textContent = '#' + i;
            s.children[1].textContent = label;
            s.children[2].textContent = String(m.role || 'system').toUpperCase();
            s.children[3].textContent = I18n.t('{n} 字', { n: (m.content || '').length });
            const pre = document.createElement('pre');
            pre.className = 'prompt-block-body';
            pre.textContent = m.content || '';
            d.appendChild(s);
            d.appendChild(pre);
            frag.appendChild(d);
        });
        box.replaceChildren ? box.replaceChildren(frag) : (box.innerHTML = '', box.appendChild(frag));
        box.scrollTop = scrollTop;
    },

    /** 全部折叠 / 全部展开（再点一次展开）。 */
    toggleAllBlocks() {
        const box = document.getElementById('debug-prompt-content');
        if (!box) return;
        const blocks = Array.from(box.querySelectorAll('details.prompt-block'));
        const anyOpen = blocks.some(b => b.open);
        blocks.forEach(b => { b.open = !anyOpen; });
        const btn = document.getElementById('btn-debug-prompt-fold');
        if (btn) btn.textContent = anyOpen ? I18n.t('全部展开') : I18n.t('全部折叠');
    },

    /** 完整提示词文本（复制用）：每条消息一段，标明序号、角色、来源。 */
    buildFullPrompt(wire) {
        const list = wire || this._currentWire().wire;
        return list.map((m, idx) => {
            const label = this._labelOf(m);
            return `[${idx}] ${(m.role || 'system').toUpperCase()}${label ? ' (' + label + ')' : ''}\n${m.content || ''}`;
        }).join('\n\n---\n\n');
    },

    /** 提示词查看器刷新入口（模组编辑等处调用）。 */
    refreshPromptViewer() {
        this.refreshPrompt();
    },

    /** 记录这次真正发出去的消息（含每条的来源），供「上次发送」查看。 */
    recordSent(wire) {
        this.lastSent = wire;
    },

    switchPromptMode(mode) {
        this.promptMode = mode === 'last' ? 'last' : 'next';
        this.refreshPrompt();
    },

    /**
     * 提取Thinking内容
     */
    extractThinking() {
        // 优先从lastResponse获取
        if (this.lastResponse?.thinking) {
            return this.lastResponse.thinking;
        }

        // 从最后一条AI消息中提取thinking
        const lastMsg = State.chatHistory?.slice().reverse().find(m => m.role === 'assistant');
        if (lastMsg?.thinking) {
            return lastMsg.thinking;
        }

        return '';
    },

    /**
     * 提取 e-cot 内容（思维链：<!-- Start the ECoT --><!-- End of The ECoT -->）
     */
    extractEcot() {
        // 优先从lastResponse获取
        if (this.lastResponse?.ecot) {
            return this.lastResponse.ecot;
        }

        // 从最后一条AI消息中提取 e-cot
        const lastMsg = State.chatHistory?.slice().reverse().find(m => m.role === 'assistant');
        if (lastMsg?.ecot) {
            return lastMsg.ecot;
        }

        // 检查原始响应中是否有 e-cot 标记（从raw中提取）
        if (this.lastResponse?.raw?.ecot) {
            return this.lastResponse.raw.ecot;
        }

        // 检查是否有 ECoT HTML注释格式（结束标记兼容 End of The ECoT / End of ECoT）
        const lastMsgContent = lastMsg?.content || '';
        const ecotCommentMatch = lastMsgContent.match(/<!--\s*Start\s+the\s+ECoT\s*-->([\s\S]*?)<!--\s*End\s+of\s+(?:The\s+)?ECoT\s*-->/i);
        if (ecotCommentMatch) {
            return ecotCommentMatch[1].trim();
        }

        const ecotTagMatch = lastMsgContent.match(/<e-cot>([\s\S]*?)<\/e-cot>/i);
        return ecotTagMatch ? ecotTagMatch[1].trim() : '';
    },

    /**
     * 提取问答区内容
     */
    extractQA() {
        if (this.lastResponse?.qa) {
            return this.lastResponse.qa;
        }
        const lastMsg = State.chatHistory?.slice().reverse().find(m => m.role === 'assistant');
        return lastMsg?.qa || '';
    },

    /**
     * 提取预测区内容
     */
    extractPrediction() {
        if (this.lastResponse?.prediction) {
            return this.lastResponse.prediction;
        }
        const lastMsg = State.chatHistory?.slice().reverse().find(m => m.role === 'assistant');
        return lastMsg?.prediction || '';
    },

    /**
     * 获取原始输出
     */
    getRawOutput() {
        if (!this.lastResponse) {
            // 如果没有lastResponse，尝试从最后一条消息构建
            const lastMsg = State.chatHistory?.slice().reverse().find(m => m.role === 'assistant');
            if (lastMsg) {
                return JSON.stringify({
                    content: lastMsg.content,
                    thinking: lastMsg.thinking || null,
                    ecot: lastMsg.ecot || null,
                    role: lastMsg.role,
                    timestamp: lastMsg.timestamp
                }, null, 2);
            }
            return '';
        }

        return JSON.stringify(this.lastResponse, null, 2);
    },

    /**
     * 记录API响应；没有收到过发送记录时，用传入的消息数组代替
     */
    recordResponse(response, messages = null) {
        this.lastResponse = response;
        if (messages && !this.lastSent) this.lastSent = messages.map(m => ({ role: m.role, content: m.content, sources: [m.identifier || m.role], labels: [m.label || ''] }));

        // 如果调试页面是活动的，自动刷新
        const debugPage = document.getElementById('page-debug');
        if (debugPage && debugPage.classList.contains('active')) {
            this.refreshPrompt();
        }
    },

    /** 把文字放进剪贴板：先用系统接口，不行再用选中复制，都不行就提示手动复制。 */
    copyText(text) {
        const done = () => Toast.show(I18n.t('已复制到剪贴板'), 'success');
        const fallback = () => {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;resize:none';
            document.body.appendChild(ta);
            ta.select();
            let ok = false;
            try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
            ta.remove();
            if (ok) done(); else Toast.show(I18n.t('这个浏览器不允许自动复制，请在展开的内容里手动选中复制。'), 'warning', 6000);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(fallback);
        } else {
            fallback();
        }
    },

    /**
     * 复制Prompt
     */
    copyPrompt() {
        const activeTab = document.querySelector('.debug-output-tab.active');
        const outputType = activeTab?.dataset.output || 'full';

        let content = '';
        switch (outputType) {
            case 'full':
                content = this.buildFullPrompt();
                break;
            case 'thinking':
                content = document.getElementById('debug-thinking-content').value;
                break;
            case 'ecot':
                content = document.getElementById('debug-ecot-content').value;
                break;
            case 'qa':
                content = document.getElementById('debug-qa-content')?.value || '';
                break;
            case 'prediction':
                content = document.getElementById('debug-prediction-content')?.value || '';
                break;
            case 'raw':
                content = document.getElementById('debug-raw-content').textContent;
                break;
        }
        this.copyText(content);
    }
};

// 导出
if (typeof window !== 'undefined') {
    window.DebugViewer = DebugViewer;
}
