/**
 * 显示设置、主题、停止字符串与回复内容清理。
 * 扩展 App（app.js 先加载）。
 */
Object.assign(App, {
    // ===== 显示设置 =====
    loadDisplaySettings() {
        const settings = Storage.getSettings() || {};

        // AI名称
        const aiNameInput = document.getElementById('input-ai-name');
        if (aiNameInput) {
            aiNameInput.value = settings.aiName || I18n.t('故事之声');
        }

        // 主题
        const themeSelect = document.getElementById('select-theme');
        if (themeSelect) {
            const theme = Theme.getPreference();
            themeSelect.value = theme;
        }

        // 字体大小
        const fontSizeInput = document.getElementById('input-font-size');
        const fontSize = Number(settings.fontSize) || this.DEFAULT_FONT_SIZE;
        if (fontSizeInput) fontSizeInput.value = fontSize;
        this.applyFontSize(fontSize);

        // 停止字符串
        if (this._stopStringsField) this._stopStringsField.setValues(this.getStopStringList());

        // 复选框选项
        const checkboxes = {
            'checkbox-names-as-stop-strings': 'names_as_stop_strings',
            'checkbox-trim-spaces': 'trim_spaces',
            'checkbox-trim-sentences': 'trim_sentences',
            'checkbox-always-add-names': 'always_add_names',
            'checkbox-hide-thinking': 'hide_thinking',
            'checkbox-auto-clean-response': 'auto_clean_response',
            'checkbox-stream-output': 'stream_output'
        };

        Object.entries(checkboxes).forEach(([id, key]) => {
            const checkbox = document.getElementById(id);
            if (checkbox) {
                checkbox.checked = settings[key] !== undefined ? settings[key] : (id === 'checkbox-names-as-stop-strings' || id === 'checkbox-trim-spaces' || id === 'checkbox-always-add-names' || id === 'checkbox-hide-thinking' || id === 'checkbox-auto-clean-response' || id === 'checkbox-stream-output');
            }
        });

        // 推理格式化
        const thinkingFormatSelect = document.getElementById('select-thinking-format');
        if (thinkingFormatSelect) {
            const format = settings.thinkingFormat || 'tags';
            thinkingFormatSelect.value = format;

            this.syncThinkingTagInputs(format);
        }

        // 自定义 thinking 标签
        const thinkingStartTagInput = document.getElementById('input-thinking-start-tag');
        const thinkingEndTagInput = document.getElementById('input-thinking-end-tag');
        if (thinkingStartTagInput) {
            thinkingStartTagInput.value = settings.thinkingStartTag || '<thinking>';
        }
        if (thinkingEndTagInput) {
            thinkingEndTagInput.value = settings.thinkingEndTag || '</thinking>';
        }
    },

    DEFAULT_FONT_SIZE: 15,

    applyTheme(theme) {
        Theme.apply(theme);
    },

    applyFontSize(size) {
        document.documentElement.style.setProperty('--chat-font-size', size + 'px');
    },

    getStopStringList() {
        const list = (Storage.getSettings() || {}).stopStrings;
        return Array.isArray(list) ? list : ['User:', 'Human:'];
    },

    /** 自定义标签的输入框一直显示，不是自定义时置灰 */
    syncThinkingTagInputs(format) {
        ['input-thinking-start-tag', 'input-thinking-end-tag'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.disabled = format !== 'custom';
        });
    },

    /**
     * 获取停止字符串列表
     */
    _getStopStrings(settings) {
        const stopStrings = settings.stopStrings || ['User:', 'Human:'];
        const result = [...stopStrings];

        // 如果启用"将角色名字作为停止字符串"
        if (settings.names_as_stop_strings) {
            const userName = PersonaManager.current?.name || State.gameState?.playerName || I18n.t('玩家');
            const aiName = settings.aiName || I18n.t('故事之声');
            result.push(`\n${userName}:`);
            result.push(`\n${aiName}:`);
        }

        return result.filter(s => s && s.length > 0);
    },

    /**
     * 处理响应内容（应用显示设置）
     * 解析顺序与 prompt-builder 指令一致：content → turn_summary → ECoT/thinking → qa → prediction → delivery_completed → module_summary；仅解析 <块名> 格式。
     */
    _processResponseContent(content, settings) {
        if (!content) return { content: '', thinking: null, ecot: null, qa: null, prediction: null, turnSummary: null, deliveryCompleted: null, moduleSummary: null };

        let processed = content;
        let thinking = null;
        let ecot = null;
        let qa = null;
        let prediction = null;
        let turnSummary = null;
        let deliveryCompleted = null;
        let moduleSummary = null;

        // 1. <content>：正文，仅此块展示给玩家
        const contentBlockMatch = processed.match(/<content>([\s\S]*?)<\/content>/i);
        let mainDisplayContent = null;
        if (contentBlockMatch) {
            mainDisplayContent = contentBlockMatch[1].trim();
            processed = processed.replace(/<content>[\s\S]*?<\/content>/gi, '');
        }

        // 2. <turn_summary>：本轮摘要（构建历史时非最近几条只发摘要）
        const turnSummaryMatch = processed.match(/<turn_summary>([\s\S]*?)<\/turn_summary>/i);
        if (turnSummaryMatch) {
            turnSummary = turnSummaryMatch[1].trim();
            processed = processed.replace(/<turn_summary>[\s\S]*?<\/turn_summary>/gi, '');
        }

        // 3. ECoT/思维链：<!-- Start the ECoT --> 或 <e-cot>（结束标记兼容 "End of The ECoT" 与 "End of ECoT"）
        const ecotCommentRe = /<!--\s*Start\s+the\s+ECoT\s*-->([\s\S]*?)<!--\s*End\s+of\s+(?:The\s+)?ECoT\s*-->/i;
        const ecotCommentMatch = processed.match(ecotCommentRe);
        if (ecotCommentMatch) {
            ecot = ecotCommentMatch[1].trim();
            processed = processed.replace(ecotCommentRe, '');
        } else {
            const ecotTagRe = /<e-cot>([\s\S]*?)<\/e-cot>/i;
            const ecotTagMatch = processed.match(ecotTagRe);
            if (ecotTagMatch) {
                ecot = ecotTagMatch[1].trim();
                processed = processed.replace(ecotTagRe, '');
            }
        }

        // 提取 <qa>（变量问答），与 prompt-builder 指令一致，仅解析 <> 块
        const qaMatch = processed.match(/<qa>([\s\S]*?)<\/qa>/i);
        if (qaMatch) {
            qa = qaMatch[1].trim();
            processed = processed.replace(/<qa>[\s\S]*?<\/qa>/gi, '');
        }

        // 提取 <prediction>（预测下一条可能打开的模块条目）
        const predictionMatch = processed.match(/<prediction>([\s\S]*?)<\/prediction>/i);
        if (predictionMatch) {
            prediction = predictionMatch[1].trim();
            processed = processed.replace(/<prediction>[\s\S]*?<\/prediction>/gi, '');
        }

        // 6. <delivery_completed>：每行 投递id\t完成 或 投递id\t未完成
        const deliveryCompletedMatch = processed.match(/<delivery_completed>([\s\S]*?)<\/delivery_completed>/i);
        if (deliveryCompletedMatch) {
            const inner = deliveryCompletedMatch[1].trim();
            const lines = inner.split('\n').map(s => s.trim()).filter(Boolean);
            deliveryCompleted = lines.map((line) => {
                const tab = line.indexOf('\t');
                const id = tab >= 0 ? line.slice(0, tab).trim() : line.trim();
                const value = tab >= 0 ? line.slice(tab + 1).trim() : '';
                return { id, completed: /完成|true|是/i.test(value) };
            }).filter((x) => x.id);
            processed = processed.replace(/<delivery_completed>[\s\S]*?<\/delivery_completed>/gi, '');
        }

        // 7. <module_summary>：完成模块时可选的一行剧情要点
        const moduleSummaryMatch = processed.match(/<module_summary>([\s\S]*?)<\/module_summary>/i);
        if (moduleSummaryMatch) {
            moduleSummary = moduleSummaryMatch[1].trim();
            processed = processed.replace(/<module_summary>[\s\S]*?<\/module_summary>/gi, '');
        }

        // 清理可能残留的 content 标签（若上面未匹配到整块）
        processed = processed
            .replace(/<content>[\s\S]*?<\/content>/gi, '')
            .replace(/<\/?content>/gi, '');

        // 提取thinking内容（根据格式化设置）
        const thinkingFormat = settings.thinkingFormat || 'tags';
        if (thinkingFormat === 'tags' || thinkingFormat === 'custom') {
            let startTag = '<thinking>';
            let endTag = '</thinking>';

            if (thinkingFormat === 'custom') {
                startTag = settings.thinkingStartTag || '<thinking>';
                endTag = settings.thinkingEndTag || '</thinking>';
            }

            // 转义特殊字符用于正则表达式
            const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const startTagEscaped = escapeRegex(startTag);
            const endTagEscaped = escapeRegex(endTag);
            const thinkingPattern = new RegExp(`${startTagEscaped}([\\s\\S]*?)${endTagEscaped}`, 'i');

            const thinkingMatch = processed.match(thinkingPattern);
            if (thinkingMatch) {
                thinking = thinkingMatch[1].trim();
                // 如果启用隐藏thinking，从内容中移除
                if (settings.hide_thinking !== false) {
                    const removePattern = new RegExp(`${startTagEscaped}[\\s\\S]*?${endTagEscaped}`, 'gi');
                    processed = processed.replace(removePattern, '');
                }
            }
        }

        // 修剪空格
        if (settings.trim_spaces !== false) {
            processed = processed.trim();
        }

        // 修剪不完整句子
        if (settings.trim_sentences) {
            // 从末尾向前找最后一个句末标点，截断到它（含），丢掉不完整的尾巴。
            const trimmed = processed.replace(/\s+$/, '');
            // 找最后一个 . ! ? 。 ！ ？ 的位置
            const lastSentenceEnd = Math.max(
                trimmed.lastIndexOf('。'),
                trimmed.lastIndexOf('！'),
                trimmed.lastIndexOf('？'),
                trimmed.lastIndexOf('.'),
                trimmed.lastIndexOf('!'),
                trimmed.lastIndexOf('?')
            );
            if (lastSentenceEnd > 0 && lastSentenceEnd < trimmed.length - 1) {
                // 末尾还有内容但不以句末标点收尾 → 截断到 lastSentenceEnd（含）
                processed = trimmed.slice(0, lastSentenceEnd + 1);
            } else {
                processed = trimmed;
            }
        }

        // 移除多余的换行
        processed = processed.replace(/\n{3,}/g, '\n\n').trim();

        // 展示正文：若有 <content> 块则只展示其内容，否则展示去除各块后的剩余内容
        const finalContent = TagParser.stripTags(mainDisplayContent !== null ? mainDisplayContent : processed).replace(/\n{3,}/g, '\n\n').trim();

        return {
            content: finalContent,
            thinking,
            ecot,
            qa,
            prediction,
            turnSummary,
            deliveryCompleted,
            moduleSummary
        };
    }
});
