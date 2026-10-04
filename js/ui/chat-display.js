/**
 * 聊天显示组件
 * 负责渲染和管理聊天消息，支持Markdown
 */

const ChatDisplay = {
    // 消息容器
    container: null,

    // 消息历史
    messages: [],

    // 当前编辑的消息索引
    editingIndex: -1,

    // 多选删除模式
    multiSelectMode: false,
    selectedMessageIds: new Set(),

    /**
     * 初始化
     */
    init() {
        this.container = document.getElementById('chat-messages');
        this.messages = [];
        this.editingIndex = -1;
        const display = document.getElementById('chat-display');
        this._display = display;
        this._stick = true;
        if (!display || display.__chatBound) return;
        display.__chatBound = true;
        ScrollMemory.track(display, 'chat');
        display.addEventListener('scroll', () => { this._stick = ScrollMemory.isNearBottom(display); }, { passive: true });
        if (window.ResizeObserver) {
            const follow = () => { if (this._stick) display.scrollTop = display.scrollHeight; };
            new ResizeObserver(follow).observe(display);
            new ResizeObserver(follow).observe(this.container);
        }
        display.addEventListener('click', (e) => this._onClick(e));
        display.addEventListener('change', (e) => {
            const box = e.target.closest('.message-select-checkbox');
            if (box) this.toggleMessageSelection(Number(box.dataset.index), box.checked);
        });
        const del = document.getElementById('btn-multi-delete');
        if (del) del.addEventListener('click', () => this.deleteSelectedMessages());
        const cancel = document.getElementById('btn-multi-cancel');
        if (cancel) cancel.addEventListener('click', () => this.toggleMultiSelectMode());
    },

    /** 消息区内按钮的统一入口，按钮用 data-act 标明动作 */
    _onClick(e) {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const msgEl = btn.closest('.message');
        const index = msgEl ? Number(msgEl.dataset.index) : -1;
        switch (btn.dataset.act) {
            case 'swipe-left': this.swipeLeft(index); break;
            case 'swipe-right': this.swipeRight(index); break;
            case 'reroll': this.rerollMessage(index); break;
            case 'edit': this.editMessage(index); break;
            case 'copy': this.copyMessage(index); break;
            case 'delete': this.deleteMessage(index); break;
            case 'save-edit': this.saveEdit(index); break;
            case 'cancel-edit': this.cancelEdit(index); break;
            case 'hint-reroll': btn.closest('.reroll-hint').remove(); App.rerollLast(); break;
            case 'hint-dismiss': btn.closest('.reroll-hint').remove(); break;
            default: break;
        }
    },

    /**
     * 唯一消息 id：时间戳加计数加随机后缀，同一毫秒内连续添加也不会重复。
     */
    _genMessageId() {
        if (typeof this._msgIdCounter !== 'number') this._msgIdCounter = 0;
        this._msgIdCounter++;
        return Date.now() + '_' + this._msgIdCounter + '_' + Math.random().toString(36).slice(2, 8);
    },

    /**
     * 添加消息
     * @param {Object} message - 消息对象
     * @returns {Object} 消息对象（用于流式更新）
     */
    addMessage(message) {
        /**
         * message格式:
         * {
         *   role: 'user' | 'assistant' | 'system',
         *   content: string,
         *   thinking?: string,  // AI思考过程
         *   isAdvanceSummary?: boolean,  // 是否是推进总结
         *   isTestMessage?: boolean,  // 是否是测试消息
         *   timestamp?: number
         * }
         */
        const msg = {
            ...message,
            id: this._genMessageId(),
            timestamp: message.timestamp || Date.now(),
            streaming: false
        };

        this.messages.push(msg);
        const index = this.messages.length - 1;
        const startCard = this.container?.querySelector('#start-game-card');
        if (startCard) startCard.remove();
        this._renderMessage(msg, index);
        this._scrollToBottom();

        // 保存到状态（避免重复添加）
        State.chatHistory = State.chatHistory || [];
        // 检查是否已存在（避免流式消息重复添加）
        if (!State.chatHistory.find(m => m.id === msg.id)) {
            State.chatHistory.push(msg);
        }

        // 自动保存聊天历史（对于非流式消息）
        if (!msg.streaming) {
            this._autoSaveChatHistory();
        }

        return { message: msg, index };
    },

    /**
     * 创建流式消息（用于AI回复）
     */
    createStreamingMessage() {
        const msg = {
            role: 'assistant',
            content: '',
            id: this._genMessageId(),
            timestamp: Date.now(),
            streaming: true
        };

        this.messages.push(msg);
        const index = this.messages.length - 1;
        this._renderMessage(msg, index);

        // 保存到状态（空内容，避免重复）
        State.chatHistory = State.chatHistory || [];
        if (!State.chatHistory.find(m => m.id === msg.id)) {
            State.chatHistory.push(msg);
        }

        return { message: msg, index };
    },

    /**
     * 更新流式消息内容
     */
    updateStreamingMessage(index, content) {
        const msg = this.messages[index];
        if (!msg) return;

        msg.content = content;
        msg.streaming = true;

        // 更新DOM
        const msgEl = this.container.querySelector(`[data-index="${index}"]`);
        if (msgEl) {
            const contentEl = msgEl.querySelector('.message-content');
            if (contentEl) {
                // 流式更新时：只处理Markdown，不应用正则（正则等完整响应后再应用）
                // 也不处理thinking/e-cot（等完整响应后再提取）
                let displayContent = content;

                // 临时移除thinking和ecot标签，避免在流式过程中被解析（结束标记兼容 End of The ECoT / End of ECoT）
                displayContent = displayContent.replace(/<!--\s*Start\s+the\s+ECoT\s*-->[\s\S]*?<!--\s*End\s+of\s+(?:The\s+)?ECoT\s*-->/gi, '');
                displayContent = displayContent.replace(/<e-cot>[\s\S]*?<\/e-cot>/gi, '');

                const displaySettings = Storage.getSettings() || {};
                const thinkingFormat = displaySettings.thinkingFormat || 'tags';
                if (thinkingFormat === 'tags' || thinkingFormat === 'custom') {
                    let startTag = '<thinking>';
                    let endTag = '</thinking>';
                    if (thinkingFormat === 'custom') {
                        startTag = displaySettings.thinkingStartTag || '<thinking>';
                        endTag = displaySettings.thinkingEndTag || '</thinking>';
                    }
                    const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const startTagEscaped = escapeRegex(startTag);
                    const endTagEscaped = escapeRegex(endTag);
                    const removePattern = new RegExp(`${startTagEscaped}[\\s\\S]*?${endTagEscaped}`, 'gi');
                    displayContent = displayContent.replace(removePattern, '');
                }

                // 流式输出：使用MessageFormatter格式化
                // 流式过程中不应用正则（等完整响应后再应用）
                if (window.MessageFormatter && MessageFormatter.converter) {
                    // 流式时临时禁用正则处理
                    const originalProcess = window.RegexProcessor?.process;
                    if (window.RegexProcessor) {
                        window.RegexProcessor.process = (text) => text; // 临时禁用
                    }

                    try {
                        // 找到对应的State.chatHistory索引
                        let messageId = index;
                        if (msg.id && typeof State !== 'undefined' && State.chatHistory) {
                            const chatIndex = State.chatHistory.findIndex(m => m.id === msg.id);
                            if (chatIndex !== -1) {
                                messageId = chatIndex;
                            }
                        }
                        const formatted = MessageFormatter.formatMessage(displayContent, msg.role || 'assistant', messageId);
                        contentEl.innerHTML = formatted;
                    } catch (e) {
                        console.warn('Stream format error:', e);
                        let html = this._escapeHtml(displayContent);
                        html = html.replace(/\n/g, '<br>');
                        contentEl.innerHTML = html;
                    } finally {
                        // 恢复正则处理
                        if (window.RegexProcessor && originalProcess) {
                            window.RegexProcessor.process = originalProcess;
                        }
                    }
                } else if (typeof marked !== 'undefined') {
                    // 回退到marked
                    marked.setOptions({ breaks: true, gfm: true, highlight: null });
                    try {
                        // 回复里可能带网页代码，必须先过 DOMPurify；它没加载就按纯文本转义。
                        const rawHtml = marked.parse(displayContent);
                        if (typeof DOMPurify !== 'undefined') {
                            contentEl.innerHTML = DOMPurify.sanitize(rawHtml, { ADD_TAGS: ['custom-style'] });
                        } else {
                            let html = this._escapeHtml(displayContent);
                            html = html.replace(/\n/g, '<br>');
                            contentEl.innerHTML = html;
                        }
                    } catch (e) {
                        let html = this._escapeHtml(displayContent);
                        html = html.replace(/\n/g, '<br>');
                        contentEl.innerHTML = html;
                    }
                } else {
                    // 简单转义和换行处理
                    let html = this._escapeHtml(displayContent);
                    html = html.replace(/\n/g, '<br>');
                    contentEl.innerHTML = html;
                }
            }
        }

        // 更新状态（流式过程中不更新thinking）
        if (State.chatHistory[index]) {
            State.chatHistory[index].content = content;
        }

        this._followIfSticky();
    },

    /**
     * 完成流式消息（重新渲染，应用正则和显示thinking/qa/prediction）
     */
    finishStreamingMessage(index = null) {
        // 兼容：不传index时，自动结束最后一条正在streaming的assistant消息
        if (index === null || typeof index === 'undefined') {
            for (let i = this.messages.length - 1; i >= 0; i--) {
                if (this.messages[i]?.role === 'assistant' && this.messages[i]?.streaming) {
                    index = i;
                    break;
                }
            }
        }

        const msg = this.messages[index];
        if (!msg) return;

        msg.streaming = false;

        // 重新渲染消息（应用正则和显示thinking/qa/prediction）
        const msgEl = this.container.querySelector(`[data-index="${index}"]`);
        if (msgEl) {
            msgEl.classList.remove('streaming');
            const streamingLine = msgEl.querySelector('.streaming-status-above-swipes');
            if (streamingLine) streamingLine.remove();
        }
        // 兜底：输出结束后确保所有「AI正在输出」都被移除（防止 index 错位等情况）
        if (this.container) {
            this.container.querySelectorAll('.streaming-status-above-swipes').forEach(el => el.remove());
        }
        if (msgEl) {

            // 更新content（应用正则处理和完整格式化）
            const contentEl = msgEl.querySelector('.message-content');
            if (contentEl) {
                // 找到对应的State.chatHistory索引
                let messageId = index;
                if (msg.id && typeof State !== 'undefined' && State.chatHistory) {
                    const chatIndex = State.chatHistory.findIndex(m => m.id === msg.id);
                    if (chatIndex !== -1) {
                        messageId = chatIndex;
                    }
                }
                // 完整响应后，重新格式化（应用正则）
                contentEl.innerHTML = this._parseMarkdown(msg.content, msg.role || 'assistant', messageId);
            }

            // 添加或更新thinking部分（如果存在）
            if (msg.thinking) {
                this._renderDetailsSection(msgEl, 'thinking-details', I18n.t('思考过程'), msg.thinking);
            }

            // 添加或更新e-cot部分（如果存在）
            if (msg.ecot) {
                this._renderDetailsSection(msgEl, 'ecot-details', I18n.t('思维链'), msg.ecot);
            }

            // 添加或更新问答区部分（如果存在）
            if (msg.qa) {
                this._renderDetailsSection(msgEl, 'qa-details', I18n.t('问答区'), msg.qa);
            }

            // 添加或更新预测区部分（如果存在）
            if (msg.prediction) {
                this._renderDetailsSection(msgEl, 'prediction-details', I18n.t('预测区'), msg.prediction);
            }

            // 添加或更新本轮摘要部分（如果存在，用于历史压缩时「非最近几条只发摘要」）
            if (msg.turnSummary) {
                this._renderDetailsSection(msgEl, 'turn-summary-details', I18n.t('本轮摘要'), msg.turnSummary);
            }

            // seeds：不在聊天界面强制展示（避免污染正文），但要同步进State，便于调试/后续用
        }

        // 确保状态同步
        if (State.chatHistory[index]) {
            State.chatHistory[index].content = msg.content;
            State.chatHistory[index].streaming = false;
            if (msg.thinking) {
                State.chatHistory[index].thinking = msg.thinking;
            }
            if (msg.ecot) {
                State.chatHistory[index].ecot = msg.ecot;
            }
            if (msg.qa) {
                State.chatHistory[index].qa = msg.qa;
            }
            if (msg.prediction) {
                State.chatHistory[index].prediction = msg.prediction;
            }
            if (msg.turnSummary) {
                State.chatHistory[index].turnSummary = msg.turnSummary;
            }
            if (msg.seeds) {
                State.chatHistory[index].seeds = msg.seeds;
            }
        }

        // 渲染Mermaid图表（在消息完全渲染后）
        if (window.MermaidRenderer && typeof MermaidRenderer.renderAll === 'function') {
            MermaidRenderer.renderAll().catch(err => {
                console.warn('[ChatDisplay] Mermaid rendering failed:', err);
            });
        }

        // 渲染HTML iframe（在消息完全渲染后）
        if (window.HtmlRenderer && typeof HtmlRenderer.renderAll === 'function') {
            HtmlRenderer.renderAll().catch(err => {
                console.warn('[ChatDisplay] HTML rendering failed:', err);
            });
        }

        // 自动保存聊天历史
        this._autoSaveChatHistory();
    },

    /**
     * 渲染details折叠区域（thinking/ecot/qa/prediction）
     */
    _renderDetailsSection(msgEl, className, title, content) {
        let detailsEl = msgEl.querySelector(`.${className}`);
        if (!detailsEl) {
            const detailsHTML = `
                <details class="${className}">
                    <summary class="details-summary">
                        <span class="details-title">${title}</span>
                        <span class="details-toggle chev" aria-hidden="true"></span>
                    </summary>
                    <div class="details-content">${this._parseMarkdown(content, 'assistant', -1)}</div>
                </details>
            `;
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = detailsHTML;
            detailsEl = tempDiv.firstElementChild;
            const headerEl = msgEl.querySelector('.message-header');
            if (headerEl) {
                headerEl.after(detailsEl);
            }
        } else {
            const contentEl = detailsEl.querySelector('.details-content');
            if (contentEl) {
                contentEl.innerHTML = this._parseMarkdown(content, 'assistant', -1);
            }
        }
    },

    /**
     * 自动保存到当前存档
     */
    async _autoSaveChatHistory() {
        // 调用App的自动保存方法
        if (typeof App !== 'undefined' && App.autoSaveToCurrentSlot) {
            await App.autoSaveToCurrentSlot();
        }

        // 更新存档信息显示
        if (typeof App !== 'undefined' && App.updateSaveInfo) {
            App.updateSaveInfo();
        }
    },

    /**
     * 渲染单条消息
     */
    _renderMessage(message, index) {
        const prevMsg = index > 0 ? this.messages[index - 1] : null;
        const hasMetaBlockBefore = prevMsg && prevMsg.identifier === 'user-meta-block';

        if (message.identifier === 'user-meta-block') {
            const div = document.createElement('div');
            div.className = 'message user-meta-block-placeholder';
            div.dataset.index = index;
            div.setAttribute('aria-hidden', 'true');
            div.style.display = 'none';
            this.container.appendChild(div);
            return;
        }

        const div = document.createElement('div');
        div.className = 'message ' + message.role;
        div.dataset.index = index;
        if (message.id != null) div.dataset.mid = message.id;

        if (message.isAdvanceSummary) div.classList.add('advance-summary');
        if (message.isTestMessage) div.classList.add('test-message');
        if (message.streaming) div.classList.add('streaming');

        let messageId = index;
        if (message.id && typeof State !== 'undefined' && State.chatHistory) {
            const chatIndex = State.chatHistory.findIndex(m => m.id === message.id);
            if (chatIndex !== -1) messageId = chatIndex;
        }
        const htmlContent = this._parseMarkdown(message.content || '', message.role, messageId);

        const settings = Storage.getSettings() || {};
        const userName = PersonaManager.current?.name || State.gameState?.playerName || I18n.t('玩家');
        const aiName = settings.aiName || I18n.t('故事之声');
        const roleLabel = ({ 'user': userName, 'assistant': aiName, 'system': I18n.t('系统') }[message.role] || message.role);
        const time = new Date(message.timestamp).toLocaleTimeString();
        const streamingIndicator = message.streaming ? '<span class="streaming-indicator" aria-hidden="true"></span>' : '';

        const thinkingContent = (message.thinking && message.role === 'assistant') ? `
            <details class="thinking-details">
                <summary class="thinking-summary">
                    <span class="thinking-title">${I18n.t('思考过程')}</span>
                    <span class="thinking-toggle chev" aria-hidden="true"></span>
                </summary>
                <div class="thinking-content">${this._parseMarkdown(message.thinking, 'assistant', index)}</div>
            </details>
        ` : '';

        const multiSelectCheckbox = this.multiSelectMode ? `
            <input type="checkbox" class="message-select-checkbox" data-index="${index}" aria-label="${I18n.t('选择这条消息')}"
                   ${this.selectedMessageIds.has(index) ? 'checked' : ''}>
        ` : '';

        const metaBox = (message.role === 'user' && hasMetaBlockBefore && prevMsg) ? (() => {
            const metaText = (prevMsg.metaContent || prevMsg.content || '').replace(/<[^>]*>/g, '').trim();
            const label = metaText ? (I18n.t('场外：') + metaText) : I18n.t('场外');
            return '<div class="user-meta-inline">' + this._escapeHtml(label) + '</div>';
        })() : '';

        const swipesHtml = message.role === 'assistant' ? (() => {
            const swipes = (message.swipes && Array.isArray(message.swipes)) ? message.swipes : [message.content || ''];
            const swipeId = (typeof message.swipeId === 'number') ? message.swipeId : 0;
            const leftDisabled = swipes.length <= 1 || swipeId <= 0 ? 'disabled' : '';
            const rightLabel = (swipeId < swipes.length - 1) ? I18n.t('下一个版本') : I18n.t('生成新版本');
            const streamingLine = message.streaming ? `<div class="streaming-status-above-swipes">${I18n.t('正在生成')}</div>` : '';
            return `
                ${streamingLine}
                <div class="swipes-container">
                    <button type="button" class="swipe-btn swipe-left" data-act="swipe-left" aria-label="${I18n.t('上一个版本')}" ${leftDisabled}><span class="chev is-left" aria-hidden="true"></span></button>
                    <span class="swipes-counter">${swipes.length ? (swipeId + 1) : 1}/${Math.max(swipes.length, 1)}</span>
                    <button type="button" class="swipe-btn swipe-right" data-act="swipe-right" aria-label="${rightLabel}" title="${rightLabel}"><span class="chev is-right" aria-hidden="true"></span></button>
                </div>
            `;
        })() : '';

        div.innerHTML = `
            <div class="message-header">
                ${multiSelectCheckbox}
                <span class="message-role ${message.role}">${this._escapeHtml(roleLabel)}</span>
                <span class="message-time">${time}${streamingIndicator}</span>
            </div>
            ${thinkingContent}
            <div class="message-content">${metaBox}${htmlContent}</div>
            ${swipesHtml}
            <div class="message-edit-area">
                <textarea class="message-edit-textarea" aria-label="${I18n.t('消息内容')}"></textarea>
                ${message.role === 'user' ? `
                <div class="message-edit-meta-row">
                    <label class="message-edit-label">${I18n.t('场外指令')}</label>
                    <textarea class="message-edit-meta" rows="2" aria-label="${I18n.t('场外指令')}"></textarea>
                </div>
                ` : ''}
                <div class="message-edit-actions">
                    <button type="button" class="msg-action-btn" data-act="save-edit">${I18n.t('保存')}</button>
                    <button type="button" class="msg-action-btn" data-act="cancel-edit">${I18n.t('取消')}</button>
                </div>
            </div>
            <div class="message-actions">
                ${message.role === 'assistant' ? `<button type="button" class="msg-action-btn" data-act="reroll">${I18n.t('重新生成')}</button>` : ''}
                <button type="button" class="msg-action-btn" data-act="edit">${I18n.t('编辑')}</button>
                <button type="button" class="msg-action-btn" data-act="copy">${I18n.t('复制')}</button>
                <button type="button" class="msg-action-btn danger" data-act="delete">${I18n.t('删除')}</button>
            </div>
        `;

        const textarea = div.querySelector('.message-edit-textarea');
        if (textarea) textarea.value = message.content || '';
        if (message.role === 'user') {
            const metaTextarea = div.querySelector('.message-edit-meta');
            if (metaTextarea && hasMetaBlockBefore && prevMsg) metaTextarea.value = this._getMetaFromBlock(prevMsg) || '';
        }

        if (this.multiSelectMode) {
            div.addEventListener('click', (e) => this._handleMessageClick(e, index));
            if (this.selectedMessageIds.has(index)) div.classList.add('selected');
        }

        this.container.appendChild(div);
    },


    /**
     * 解析Markdown（包装MessageFormatter.formatMessage）
     * @param {string} text - 要格式化的文本
     * @param {string} role - 消息角色
     * @param {number} messageId - 消息ID（用于depth计算）
     * @returns {string} 格式化后的HTML
     */
    _parseMarkdown(text, role = 'assistant', messageId = -1) {
        if (!text) return '';

        // 使用MessageFormatter格式化
        if (window.MessageFormatter && typeof MessageFormatter.formatMessage === 'function') {
            try {
                return MessageFormatter.formatMessage(text, role, messageId);
            } catch (e) {
                console.error('MessageFormatter error:', e);
                // 回退到简单处理
                return this._escapeHtml(text).replace(/\n/g, '<br>');
            }
        }

        // 回退：使用marked或简单处理
        if (typeof marked !== 'undefined') {
            try {
                marked.setOptions({ breaks: true, gfm: true, highlight: null });
                // 回复里可能带网页代码，必须先过 DOMPurify
                const rawHtml = marked.parse(text);
                if (typeof DOMPurify !== 'undefined') {
                    return DOMPurify.sanitize(rawHtml, { ADD_TAGS: ['custom-style'] });
                }
                return this._escapeHtml(text).replace(/\n/g, '<br>');
            } catch (e) {
                console.error('Marked error:', e);
                return this._escapeHtml(text).replace(/\n/g, '<br>');
            }
        }

        // 最简单的回退
        return this._escapeHtml(text).replace(/\n/g, '<br>');
    },

    /**
     * HTML转义
     */
    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    /**
     * 切换多选删除模式
     */
    toggleMultiSelectMode() {
        this.multiSelectMode = !this.multiSelectMode;
        this.selectedMessageIds.clear();
        if (this.container) this.container.classList.toggle('multi-select-mode', this.multiSelectMode);
        this._updateMultiSelectToolbar();
        this._rerenderAll();
    },

    /** 清空并按当前消息列表重画，保持滚动位置 */
    _rerenderAll() {
        if (!this.container) return;
        const display = this._display;
        // 重画前记下哪些折叠块是展开的，重画后原样展开
        const opened = new Set(Array.prototype.map.call(
            this.container.querySelectorAll('.message[data-mid] details[open]'),
            d => d.closest('.message').dataset.mid + '|' + d.className
        ));
        ScrollMemory.preserve(display, () => {
            this.container.innerHTML = '';
            this.messages.forEach((m, i) => this._renderMessage(m, i));
            this.container.querySelectorAll('.message[data-mid] details').forEach(d => {
                if (opened.has(d.closest('.message').dataset.mid + '|' + d.className)) d.open = true;
            });
        });
        if (window.MermaidRenderer) MermaidRenderer.renderAll().catch(err => console.warn('[ChatDisplay] Mermaid rendering failed:', err));
        if (window.HtmlRenderer) HtmlRenderer.renderAll().catch(err => console.warn('[ChatDisplay] HTML rendering failed:', err));
    },

    /**
     * 更新多选工具栏
     */
    _updateMultiSelectToolbar() {
        const area = document.getElementById('input-area');
        if (area) area.classList.toggle('is-multi-select', this.multiSelectMode);
        this._updateSelectedCount();
    },

    /**
     * 更新选中计数
     */
    _updateSelectedCount() {
        const countEl = document.getElementById('selected-count');
        if (countEl) {
            countEl.textContent = this.selectedMessageIds.size;
        }
    },

    /**
     * 切换消息选择状态（点击整条消息）
     */
    toggleMessageSelection(index, checked) {
        if (typeof checked === 'boolean') {
            // 来自checkbox
            if (checked) {
                this.selectedMessageIds.add(index);
            } else {
                this.selectedMessageIds.delete(index);
            }
        } else {
            // 来自点击消息
            if (this.selectedMessageIds.has(index)) {
                this.selectedMessageIds.delete(index);
            } else {
                this.selectedMessageIds.add(index);
            }
        }

        // 更新消息的选中样式
        const messageEl = this.container.querySelector(`[data-index="${index}"]`);
        if (messageEl) {
            messageEl.classList.toggle('selected', this.selectedMessageIds.has(index));
            const checkbox = messageEl.querySelector('.message-select-checkbox');
            if (checkbox) {
                checkbox.checked = this.selectedMessageIds.has(index);
            }
        }

        this._updateSelectedCount();
    },

    /**
     * 处理消息点击（多选模式下选中消息）
     * 行为：点击一条消息，选中从该消息到最后一条的所有消息
     * 如果点击的是已选中的消息，则只取消选中那一条
     */
    _handleMessageClick(event, index) {
        // 如果不是多选模式，不处理
        if (!this.multiSelectMode) return;

        // 如果点击的是按钮、链接、输入框等，不处理
        const target = event.target;
        if (target.tagName === 'BUTTON' ||
            target.tagName === 'A' ||
            target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.closest('.message-actions') ||
            target.closest('.message-edit-area')) {
            return;
        }

        // 如果当前消息已选中，只取消选中这一条
        if (this.selectedMessageIds.has(index)) {
            this.selectedMessageIds.delete(index);
            const messageEl = this.container.querySelector(`[data-index="${index}"]`);
            if (messageEl) {
                messageEl.classList.remove('selected');
                const checkbox = messageEl.querySelector('.message-select-checkbox');
                if (checkbox) checkbox.checked = false;
            }
        } else {
            // 未选中：选中从该消息到最后一条的所有消息
            for (let i = index; i < this.messages.length; i++) {
                this.selectedMessageIds.add(i);
                const messageEl = this.container.querySelector(`[data-index="${i}"]`);
                if (messageEl) {
                    messageEl.classList.add('selected');
                    const checkbox = messageEl.querySelector('.message-select-checkbox');
                    if (checkbox) checkbox.checked = true;
                }
            }
        }

        this._updateSelectedCount();
    },

    /**
     * 删除选中的消息
     */
    async deleteSelectedMessages() {
        if (this.selectedMessageIds.size === 0) {
            Toast.show(I18n.t('请先选择要删除的消息。'), 'warning');
            return;
        }

        const count = this.selectedMessageIds.size;
        const confirmed = await Modal.confirm(I18n.t('删除消息'), I18n.t('确定要删除选中的 {count} 条消息吗？', { count }), { danger: true, confirmLabel: I18n.t('删除') });
        if (!confirmed) return;

        const before = this.messages.slice();
        const sortedIndices = Array.from(this.selectedMessageIds).sort((a, b) => b - a);
        const deletedIds = new Set();
        sortedIndices.forEach(index => {
            if (this.messages[index]) {
                if (this.messages[index].id != null) deletedIds.add(this.messages[index].id);
                this.messages.splice(index, 1);
            }
        });
        if (deletedIds.size > 0 && Array.isArray(State.chatHistory)) {
            State.chatHistory = State.chatHistory.filter(m => !m || !deletedIds.has(m.id));
        }
        this._removeOrphanedMetaBlocks();

        this.selectedMessageIds.clear();
        this.multiSelectMode = false;
        if (this.container) this.container.classList.remove('multi-select-mode');
        this._updateMultiSelectToolbar();
        this._rerenderAll();
        await this._autoSaveChatHistory();
        this._offerUndo(I18n.t('已删除 {count} 条消息。', { count }), before);
    },

    /** 删除之后给出撤销入口：恢复删除前的整份消息列表 */
    _offerUndo(message, before) {
        Toast.undo(message, () => {
            this.messages = before.slice();
            State.chatHistory = [...this.messages];
            this._rerenderAll();
            this._autoSaveChatHistory();
        });
    },

    /**
     * 滚动到底部
     */
    _scrollToBottom() {
        const display = this._display || document.getElementById('chat-display');
        if (!display) return;
        this._stick = true;
        display.scrollTop = display.scrollHeight;
    },

    /** 流式输出时，只有读者原本就在底部才跟随新内容 */
    _followIfSticky() {
        if (this._stick && this._display) this._display.scrollTop = this._display.scrollHeight;
    },

    /**
     * 显示加载状态
     */
    showLoading() {
        document.getElementById('chat-loading')?.classList.remove('hidden');
        this._scrollToBottom();
    },

    /**
     * 隐藏加载状态
     */
    hideLoading() {
        document.getElementById('chat-loading')?.classList.add('hidden');
    },

    /**
     * 显示重Roll提示
     */
    showRerollHint(reason) {
        const hint = document.createElement('div');
        hint.className = 'reroll-hint';
        hint.innerHTML = `
            <div class="reroll-hint-title">${I18n.t('回复需要重新生成')}</div>
            <div class="reroll-hint-reason">${this._escapeHtml(reason)}</div>
            <div class="reroll-hint-actions">
                <button type="button" class="action-btn" data-act="hint-reroll">${I18n.t('重新生成')}</button>
                <button type="button" class="action-btn" data-act="hint-dismiss">${I18n.t('忽略')}</button>
            </div>
        `;
        this.container.appendChild(hint);
        this._followIfSticky();
    },

    /**
     * 重Roll消息
     */
    async rerollMessage(index) {
        const message = this.messages[index];
        if (!message || message.role !== 'assistant') {
            Toast.show(I18n.t('只能重新生成 AI 的消息。'), 'warning');
            return;
        }

        // 获取该消息之前的用户消息
        let userMessage = null;
        for (let i = index - 1; i >= 0; i--) {
            if (this.messages[i].role === 'user') {
                userMessage = this.messages[i];
                break;
            }
        }

        if (!userMessage) {
            Toast.show(I18n.t('找不到对应的玩家消息。'), 'error');
            return;
        }

        // 使用swipe：保留原消息，生成新版本写入swipes
        this._initSwipes(message);

        if (typeof App !== 'undefined' && typeof App.getAIResponseForSwipe === 'function') {
            try {
                await App.getAIResponseForSwipe(userMessage, index);
            } catch (error) {
                console.error('Reroll error:', error);
                Toast.show(I18n.t('重新生成失败：{msg}', { msg: error.message }), 'error');
                // 失败时恢复当前显示为当前swipe版本
                message.content = message.swipes?.[message.swipeId || 0] || message.content;
                message.streaming = false;
                this._refreshMessage(index);
            }
            return;
        }

        Toast.show(I18n.t('暂时无法重新生成。'), 'error');
    },

    /**
     * 初始化消息的swipes数组（如果不存在）
     */
    _initSwipes(message) {
        if (!message.swipes) {
            message.swipes = [message.content];
            message.swipeId = 0;
        }
    },

    /**
     * 添加新的swipe版本
     */
    addSwipe(index, content) {
        const message = this.messages[index];
        if (!message) return;

        this._initSwipes(message);
        message.swipes.push(content);
        // 单条消息最多保留 20 个版本，超出时丢弃最早的
        const MAX_SWIPES = 20;
        while (message.swipes.length > MAX_SWIPES) {
            message.swipes.shift();
            // 丢弃最早版本后，当前版本序号同步前移
            if (typeof message.swipeId === 'number' && message.swipeId > 0) message.swipeId--;
        }
        message.swipeId = message.swipes.length - 1;
        message.content = content;

        // 更新State
        if (State.chatHistory && State.chatHistory[index]) {
            State.chatHistory[index] = { ...message };
        }

        // 刷新显示
        this._refreshMessage(index);
        this._autoSaveChatHistory();
    },

    /**
     * 向左切换swipe（查看上一个版本）
     */
    swipeLeft(index) {
        const message = this.messages[index];
        if (!message?.swipes || message.swipes.length <= 1) {
            Toast.show(I18n.t('没有其他版本。'), 'info');
            return;
        }

        if ((message.swipeId || 0) <= 0) {
            Toast.show(I18n.t('已经是第一个版本。'), 'info');
            return;
        }

        message.swipeId--;
        message.content = message.swipes[message.swipeId];
        if (typeof App !== 'undefined' && App.onSwipeSwitched) App.onSwipeSwitched(index);

        // 更新State
        if (State.chatHistory && State.chatHistory[index]) {
            State.chatHistory[index] = { ...message };
        }

        this._refreshMessage(index);
        this._autoSaveChatHistory();
    },

    /**
     * 向右切换swipe（查看下一个版本，或生成新版本）
     */
    async swipeRight(index) {
        const message = this.messages[index];
        if (!message) return;

        this._initSwipes(message);

        if (message.swipeId < message.swipes.length - 1) {
            // 还有更多版本，切换到下一个
            message.swipeId++;
            message.content = message.swipes[message.swipeId];
            if (typeof App !== 'undefined' && App.onSwipeSwitched) App.onSwipeSwitched(index);

            // 更新State
            if (State.chatHistory && State.chatHistory[index]) {
                State.chatHistory[index] = { ...message };
            }

            this._refreshMessage(index);
            this._autoSaveChatHistory();
            } else {
            // 已经是最后一个版本，生成新版本
            await this.rerollMessage(index);
        }
    },

    /**
     * 刷新单条消息的显示（不重渲染整个列表）
     */
    _refreshMessage(index) {
        const messageEl = this.container.querySelector(`[data-index="${index}"]`);
        const message = this.messages[index];

        if (!messageEl || !message) return;

        // 更新内容
        const contentEl = messageEl.querySelector('.message-content');
        if (contentEl) {
            contentEl.innerHTML = this._parseMarkdown(message.content || '', message.role, index);
        }

        // 确保swipe控件存在/更新（首次生成swipe时需要补上DOM）
        const existingSwipes = messageEl.querySelector('.swipes-container');
        const shouldHaveSwipes = message.role === 'assistant' && message.swipes && message.swipes.length > 1;
        if (shouldHaveSwipes && !existingSwipes) {
            const actionsEl = messageEl.querySelector('.message-edit-area') || messageEl.querySelector('.message-actions');
            const swipesDiv = document.createElement('div');
            swipesDiv.className = 'swipes-container';
            swipesDiv.innerHTML = `
                <button type="button" class="swipe-btn swipe-left" data-act="swipe-left" aria-label="${I18n.t('上一个版本')}"><span class="chev is-left" aria-hidden="true"></span></button>
                <span class="swipes-counter">${(message.swipeId || 0) + 1}/${message.swipes.length}</span>
                <button type="button" class="swipe-btn swipe-right" data-act="swipe-right" aria-label="${I18n.t('下一个版本')}"><span class="chev is-right" aria-hidden="true"></span></button>
            `;
            if (actionsEl && actionsEl.parentElement) {
                actionsEl.parentElement.insertBefore(swipesDiv, actionsEl);
            } else {
                messageEl.appendChild(swipesDiv);
            }
        } else if (!shouldHaveSwipes && existingSwipes) {
            existingSwipes.remove();
        }

        // 更新swipe计数器与左右按钮的 disabled 状态（否则往右切后再往左会点不动）
        const counterEl = messageEl.querySelector('.swipes-counter');
        if (counterEl && message.swipes) {
            counterEl.textContent = `${(message.swipeId || 0) + 1}/${message.swipes.length}`;
        }
        const leftBtn = messageEl.querySelector('.swipes-container .swipe-left');
        const rightBtn = messageEl.querySelector('.swipes-container .swipe-right');
        if (leftBtn) {
            const swipeId = (typeof message.swipeId === 'number') ? message.swipeId : 0;
            const canGoLeft = message.swipes && message.swipes.length > 1 && swipeId > 0;
            leftBtn.disabled = !canGoLeft;
            leftBtn.setAttribute('aria-disabled', !canGoLeft);
        }
        if (rightBtn && message.swipes) {
            const atLast = (message.swipeId || 0) >= message.swipes.length - 1;
            rightBtn.title = atLast ? I18n.t('生成新版本') : I18n.t('下一个版本');
            rightBtn.setAttribute('aria-label', rightBtn.title);
        }

        // 渲染Mermaid和HTML
        if (window.MermaidRenderer) MermaidRenderer.renderInContainer(messageEl).catch(() => { });
        if (window.HtmlRenderer) HtmlRenderer.renderInContainer(messageEl).catch(() => { });
    },

    /**
     * 从 user-meta-block 取场外原文（metaContent 或从 content 解析）
     */
    _getMetaFromBlock(block) {
        if (!block || block.identifier !== 'user-meta-block') return '';
        let v = block.metaContent;
        if (v != null && v !== '') return v;
        const c = (block.content || '').replace(/<user_meta>\s*/i, '');
        const end = c.indexOf('\n</user_meta>');
        const inner = end >= 0 ? c.slice(0, end) : c;
        const nn = inner.indexOf('\n\n');
        return (nn >= 0 ? inner.slice(nn + 2) : inner).trim();
    },

    /**
     * 编辑消息（user 时同时可编场内+场外）
     */
    editMessage(index) {
        const messageEl = this.container.querySelector(`[data-index="${index}"]`);
        if (!messageEl) return;

        const msg = this.messages[index];
        const textarea = messageEl.querySelector('.message-edit-textarea');
        if (textarea && msg) {
            textarea.value = msg.content || '';
        }
        if (msg && msg.role === 'user') {
            const metaTextarea = messageEl.querySelector('.message-edit-meta');
            if (metaTextarea) {
                const prev = this.messages[index - 1];
                metaTextarea.value = this._getMetaFromBlock(prev) || '';
            }
        }

        this.editingIndex = index;
        messageEl.classList.add('editing');

        if (textarea) {
            setTimeout(() => {
                textarea.focus();
                textarea.setSelectionRange(textarea.value.length, textarea.value.length);
            }, 100);
        }
    },

    /**
     * 保存编辑（user 时同步更新/插入/删除场外 block）
     */
    async saveEdit(index) {
        try {
            const messageEl = this.container.querySelector(`[data-index="${index}"]`);
            if (!messageEl) {
                console.error('Message element not found for index:', index);
                Toast.show(I18n.t('找不到这条消息。'), 'error');
                return;
            }

            const textarea = messageEl.querySelector('.message-edit-textarea');
            if (!textarea) {
                console.error('Textarea not found for index:', index);
                Toast.show(I18n.t('找不到编辑框。'), 'error');
                return;
            }

            const newContent = textarea.value.trim();
            const msg = this.messages[index];
            if (!msg) {
                console.error('Message not found at index:', index);
                Toast.show(I18n.t('找不到这条消息。'), 'error');
                return;
            }

            let newMeta = '';
            if (msg.role === 'user') {
                const metaTextarea = messageEl.querySelector('.message-edit-meta');
                if (metaTextarea) newMeta = (metaTextarea.value || '').trim();
            }

            // 更新本条消息内容
            msg.content = newContent;
            if (msg.role === 'user') {
                if (msg.roleplay !== undefined) msg.roleplay = newContent;
            }

            let didSplice = false;
            let userMessageIndex = index;

            if (msg.role === 'user') {
                const prev = this.messages[index - 1];
                const hasBlock = prev?.identifier === 'user-meta-block';
                const metaInstruction = (typeof App !== 'undefined' && App.META_INSTRUCTION) || I18n.t('请将以下场外要求自然融入回应，不要生硬复读。');

                if (hasBlock && newMeta === '') {
                    // 清空场外：删除 block
                    this.messages.splice(index - 1, 1);
                    didSplice = true;
                    userMessageIndex = index - 1;
                } else if (hasBlock && newMeta !== '') {
                    // 更新已有 block
                    const isLastBlock = (() => {
                        let last = -1;
                        for (let i = 0; i < this.messages.length; i++) {
                            if (this.messages[i]?.identifier === 'user-meta-block') last = i;
                        }
                        return last === index - 1;
                    })();
                    prev.metaContent = newMeta;
                    prev.content = isLastBlock
                        ? `<user_meta>\n${metaInstruction}\n\n${newMeta}\n</user_meta>`
                        : `<user_meta>\n${newMeta}\n</user_meta>`;
                } else if (!hasBlock && newMeta !== '') {
                    // 新增场外：在 user 前插入 block
                    const isLastUser = (index === this.messages.length - 1);
                    const blockContent = isLastUser
                        ? `<user_meta>\n${metaInstruction}\n\n${newMeta}\n</user_meta>`
                        : `<user_meta>\n${newMeta}\n</user_meta>`;
                    this.messages.splice(index, 0, {
                        role: 'system',
                        content: blockContent,
                        identifier: 'user-meta-block',
                        metaContent: newMeta,
                        injected: true
                    });
                    didSplice = true;
                    userMessageIndex = index + 1;
                }
            }

            if (!State.chatHistory) State.chatHistory = [];
            State.chatHistory = [...this.messages];

            messageEl.classList.remove('editing');
            this.editingIndex = -1;

            if (didSplice) {
                this.messages.forEach((m, i) => { m.id = m.id || this._genMessageId(); });
                this._rerenderAll();
            } else {
                const contentEl = messageEl.querySelector('.message-content');
                if (contentEl) {
                    const role = msg?.role || 'user';
                    const idx = userMessageIndex;
                    const prevMsg = this.messages[idx - 1];
                    const hasMetaBlockBefore = prevMsg?.identifier === 'user-meta-block';
                    const metaBox = (msg.role === 'user' && hasMetaBlockBefore && prevMsg) ? (() => {
                        const metaText = (prevMsg.metaContent || prevMsg.content || '').replace(/<[^>]*>/g, '').trim();
                        const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                        const label = metaText ? (I18n.t('场外：') + metaText) : I18n.t('场外');
                        return '<div class="user-meta-inline">' + esc(label) + '</div>';
                    })() : '';
                    contentEl.innerHTML = metaBox + this._parseMarkdown(newContent, role, idx);
                }
            }

            if (!didSplice && messageEl.parentNode) {
                if (window.MermaidRenderer && typeof MermaidRenderer.renderInContainer === 'function') {
                    MermaidRenderer.renderInContainer(messageEl).catch(() => {});
                }
                if (window.HtmlRenderer && typeof HtmlRenderer.renderInContainer === 'function') {
                    HtmlRenderer.renderInContainer(messageEl).catch(() => {});
                }
            }

            await this._autoSaveChatHistory();
            Toast.show(I18n.t('已保存。'), 'success');

            if (msg.role === 'user') {
                const hasLaterMessages = userMessageIndex < this.messages.length - 1;
                if (hasLaterMessages) {
                    const confirmReroll = await Modal.confirm(
                        I18n.t('重新生成后续回复'),
                        I18n.t('已修改玩家消息，是否重新生成之后的 AI 回复？')
                    );
                    if (confirmReroll) {
                        this.messages.splice(userMessageIndex + 1);
                        State.chatHistory = [...this.messages];
                        this._rerenderAll();
                        if (typeof App !== 'undefined' && App.getAIResponse) {
                            this.showLoading();
                            try {
                                await App.getAIResponse(newContent, this.messages[userMessageIndex - 1]?.identifier === 'user-meta-block' ? this._getMetaFromBlock(this.messages[userMessageIndex - 1]) : '');
                            } catch (error) {
                                console.error('Regenerate error:', error);
                                Toast.show(I18n.t('重新生成失败。'), 'error');
                            } finally {
                                this.hideLoading();
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Save edit error:', error);
            Toast.show(I18n.t('保存失败：{msg}', { msg: error.message }), 'error');
        }
    },

    /**
     * 取消编辑（恢复场内与场外）
     */
    cancelEdit(index) {
        const messageEl = this.container.querySelector(`[data-index="${index}"]`);
        if (!messageEl) return;

        const msg = this.messages[index];
        const textarea = messageEl.querySelector('.message-edit-textarea');
        if (textarea && msg) textarea.value = msg.content || '';
        if (msg && msg.role === 'user') {
            const metaTextarea = messageEl.querySelector('.message-edit-meta');
            if (metaTextarea) {
                const prev = this.messages[index - 1];
                metaTextarea.value = this._getMetaFromBlock(prev) || '';
            }
        }

        messageEl.classList.remove('editing');
        this.editingIndex = -1;
    },

    /**
     * 复制消息（参考SillyTavern，复制原始内容，不是HTML）
     */
    copyMessage(index) {
        const message = this.messages[index];
        if (!message) return;

        // 复制原始内容（不是HTML渲染后的内容）
        const textToCopy = message.content || '';

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(textToCopy)
                .then(() => Toast.show(I18n.t('已复制。'), 'success'))
                .catch((err) => {
                    console.error('Copy error:', err);
                    // 回退方案：使用传统方法
                    this._fallbackCopyText(textToCopy);
                });
        } else {
            // 回退方案
            this._fallbackCopyText(textToCopy);
        }
    },

    /**
     * 回退复制方法
     */
    _fallbackCopyText(text) {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        try {
            const successful = document.execCommand('copy');
            if (successful) {
                Toast.show(I18n.t('已复制。'), 'success');
            } else {
                Toast.show(I18n.t('复制失败。'), 'error');
            }
        } catch (err) {
            console.error('Fallback copy error:', err);
            Toast.show(I18n.t('复制失败。'), 'error');
        } finally {
            document.body.removeChild(textArea);
        }
    },

    /**
     * 从记录里清除孤立的 user-meta-block（后面没有紧接 user 的 block），并同步 State
     */
    _removeOrphanedMetaBlocks() {
        for (let i = this.messages.length - 1; i >= 0; i--) {
            if (this.messages[i]?.identifier === 'user-meta-block' && (i + 1 >= this.messages.length || this.messages[i + 1]?.role !== 'user')) {
                this.messages.splice(i, 1);
            }
        }
        if (typeof State !== 'undefined') State.chatHistory = [...this.messages];
    },

    /**
     * 删除消息：只删本条。删最新=回档，删中间=只删中间。删完后清除孤立 block。
     */
    async deleteMessage(index) {
        if (index < 0 || index >= this.messages.length) {
            console.warn('Invalid message index:', index);
            return;
        }

        try {
            const confirmed = await Modal.confirm(I18n.t('删除消息'), I18n.t('确定要删除这条消息吗？'), { danger: true, confirmLabel: I18n.t('删除') });
            if (!confirmed) return;

            const before = this.messages.slice();
            const deletedId = this.messages[index] && this.messages[index].id;
            this.messages.splice(index, 1);
            if (deletedId != null && Array.isArray(State.chatHistory)) {
                State.chatHistory = State.chatHistory.filter(m => m && m.id !== deletedId);
            }
            this._removeOrphanedMetaBlocks();
            this.messages.forEach((m, i) => { if (!m.id) m.id = this._genMessageId(); });
            this._rerenderAll();
            this._autoSaveChatHistory();
            this._offerUndo(I18n.t('已删除消息。'), before);
        } catch (error) {
            console.error('Delete message error:', error);
            Toast.show(I18n.t('删除失败：{msg}', { msg: error.message }), 'error');
        }
    },

    /**
     * 清空所有消息
     */
    clear(skipStartCard) {
        this.messages = [];
        State.chatHistory = [];
        if (this.container) {
            this.container.innerHTML = '';
            if (!skipStartCard) this._renderStartGameCard();
        }
    },

    /**
     * 无对话时显示「开始游戏」按钮卡片（可删除，不与已有内容存档冲突）。
     * 仅当已进入/加载过存档时显示；未加载任何存档时不显示。
     */
    _renderStartGameCard() {
        if (!this.container || this.messages.length > 0) return;
        if (typeof State !== 'undefined' && !State.currentSaveId) return;
        const cur = typeof ModuleManager !== 'undefined' ? ModuleManager.getCurrent() : null;
        const firstMsg = (cur?.content?.firstMessage || I18n.t('开始游戏')).trim();
        const card = document.createElement('div');
        card.id = 'start-game-card';
        card.className = 'message start-game-card';
        card.innerHTML = `
            <div class="message-header">
                <span class="message-role system">${I18n.t('系统')}</span>
                <button type="button" class="btn-start-game-delete">${I18n.t('移除')}</button>
            </div>
            <div class="start-game-card-body">
                <button type="button" class="btn-start-game-send"></button>
            </div>
        `;
        card.querySelector('.btn-start-game-send').textContent = firstMsg;
        card.querySelector('.btn-start-game-send').addEventListener('click', () => {
            if (typeof App !== 'undefined' && App.sendMessage) App.sendMessage(firstMsg);
        });
        card.querySelector('.btn-start-game-delete').addEventListener('click', () => {
            if (typeof State !== 'undefined') State.chatHistory = [];
            card.remove();
        });
        this.container.appendChild(card);
    },

    /**
     * 加载历史消息。有内容则渲染消息；无内容则只显示「开始游戏」按钮卡片（不写入 State.chatHistory，不与存档冲突）。
     */
    loadHistory(messages) {
        let list = Array.isArray(messages) ? [...messages] : [];
        for (let i = list.length - 1; i >= 0; i--) {
            if (list[i]?.identifier === 'user-meta-block' && (i + 1 >= list.length || list[i + 1]?.role !== 'user')) {
                list.splice(i, 1);
            }
        }
        this.clear(true);
        if (list.length === 0) {
            this._renderStartGameCard();
            if (typeof State !== 'undefined') State.chatHistory = [];
            return;
        }
        if (typeof State !== 'undefined') State.chatHistory = list;
        list.forEach((msg, i) => {
            this.messages.push(msg);
            this._renderMessage(msg, i);
        });
        this._restoreChatScroll();

        // 渲染Mermaid图表（加载历史消息后）
        if (window.MermaidRenderer && typeof MermaidRenderer.renderAll === 'function') {
            MermaidRenderer.renderAll().catch(err => {
                console.warn('[ChatDisplay] Mermaid rendering failed:', err);
            });
        }

        // 渲染HTML iframe（加载历史消息后）
        if (window.HtmlRenderer && typeof HtmlRenderer.renderAll === 'function') {
            HtmlRenderer.renderAll().catch(err => {
                console.warn('[ChatDisplay] HTML rendering failed:', err);
            });
        }
    },

    /** 刷新页面后回到离开时的位置；没有记录或原本贴底则回到最新消息 */
    _restoreChatScroll() {
        const display = this._display;
        if (!display) return;
        const rec = UiState.getMap('scroll', 'chat', null);
        if (rec && !rec.bottom && !this._chatScrollRestored) {
            this._chatScrollRestored = true;
            this._stick = false;
            display.scrollTop = rec.top;
            ScrollMemory.restoreWhenReady(display, 'chat');
        } else {
            this._chatScrollRestored = true;
            this._scrollToBottom();
        }
    },

    /**
     * 获取最后一条消息
     */
    getLastMessage() {
        return this.messages[this.messages.length - 1];
    },

    /**
     * 获取最后一条用户消息
     */
    getLastUserMessage() {
        for (let i = this.messages.length - 1; i >= 0; i--) {
            if (this.messages[i].role === 'user') {
                return this.messages[i];
            }
        }
        return null;
    }
};

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ChatDisplay };
}
if (typeof window !== 'undefined') window.ChatDisplay = ChatDisplay;
