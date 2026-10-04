/**
 * 消息格式化工具
 * 完全参考SillyTavern的messageFormatting实现 (script.js:1650-1850)
 * 支持Markdown、HTML渲染、正则处理、代码块保护
 */

const MessageFormatter = {
    // Showdown转换器
    converter: null,

    /**
     * 初始化Markdown转换器
     */
    init() {
        if (typeof showdown !== 'undefined') {
            this.converter = new showdown.Converter({
                emoji: true,
                literalMidWordUnderscores: true,
                parseImgDimensions: true,
                tables: true,
                underline: true,
                simpleLineBreaks: true,
                strikethrough: true,
                disableForced4SpacesIndentedSublists: true,
                // 关键：允许原始HTML通过，不转换为代码块
                ghCodeBlocks: false,  // 禁用GitHub风格代码块（防止HTML被当作代码）
                rawHeaderId: true,    // 允许原始HTML ID
                rawPrefixHeaderId: false,
                noHeaderId: false,
                // 确保HTML标签不被转义
                encodeEmails: false,
                // 允许完整的HTML文档通过
                completeHTMLDocument: false  // 不生成完整HTML文档包装
            });
            console.log('[MessageFormatter] Showdown converter initialized with HTML passthrough enabled');
        } else {
            console.warn('[MessageFormatter] Showdown not found, falling back to marked or simple HTML');
        }
    },

    /**
     * 编码style标签为custom-style标签
     * 参考ST: chats.js:536-541
     */
    _encodeStyleTags(text) {
        const styleRegex = /<style>([\s\S]+?)<\/style>/gims;
        return text.replace(styleRegex, (_, match) => {
            return `<custom-style>${encodeURIComponent(match)}</custom-style>`;
        });
    },

    /**
     * 解码custom-style标签为style标签（带作用域）
     * 参考ST: chats.js:551-626
     */
    _decodeStyleTags(text, { prefix = '.mes_text ' } = {}) {
        const styleDecodeRegex = /<custom-style>([\s\S]+?)<\/custom-style>/gms;

        return text.replace(styleDecodeRegex, (_, style) => {
            try {
                let styleCleaned = decodeURIComponent(style).replace(/<br\/>/g, '');

                // 简化版：直接添加前缀到所有选择器
                // 完整版需要CSS解析库，这里用简单的正则处理
                const scopedStyle = styleCleaned.replace(/(^|})([^{]+){/g, (match, p1, p2) => {
                    const selector = p2.trim();
                    // 跳过@规则（如@media, @keyframes等）
                    if (selector.startsWith('@')) {
                        return match;
                    }
                    return `${p1}${prefix}${selector}{`;
                });

                return `<style>${scopedStyle}</style>`;
            } catch (error) {
                console.error('Style decode error:', error);
                return `<!-- CSS ERROR: ${error.message} -->`;
            }
        });
    },

    /**
     * 隐藏宏语法和特殊标签（不应在UI中显示）
     * 隐藏内容包括：
     * - {{setvar::...}}
     * - {{getvar::...}}
     * - {{input::...}}
     * - 未配对的 <snow> 等标签
     */
    _hideMacrosAndSpecialTags(text) {
        if (!text) return text;

        let result = text;

        // 0. 保护代码块 / 行内代码（避免把代码里的 {{...}} 当宏删掉）
        const protectedBlocks = [];
        result = result.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/g, (match) => {
            const placeholder = `__PROTECTED_BLOCK_${protectedBlocks.length}__`;
            protectedBlocks.push(match);
            return placeholder;
        });

        // 1. 不再删除 {{...}} 宏语法
        // 说明：SillyTavern 的“宏”主要用于提示词处理，不应在聊天显示阶段随意删内容。
        // 这里保留原文，避免把 HTML/组件代码中的 {{ }} 误伤掉。

        // 3. 恢复代码块 / 行内代码
        // 2026-06-05：function 形式 replace 防 original 含 $&/$1-$9/$$ 等 replace special marker 被解释（用户在 ``` $$ ``` 写法本应渲染为 `$$` literal）
        protectedBlocks.forEach((original, index) => {
            result = result.replace(`__PROTECTED_BLOCK_${index}__`, () => original);
        });

        // 4. 清理多余的空行
        result = result.replace(/\n{3,}/g, '\n\n');

        return result.trim();
    },

    /**
     * 格式化消息文本为HTML
     * 完全按照SillyTavern的messageFormatting实现
     * @param {string} text - 原始文本
     * @param {string} role - 消息角色 ('user' | 'assistant' | 'system')
     * @param {number} messageId - 消息ID（用于正则处理和depth计算）
     * @param {Object} options - 选项
     * @param {boolean} [options.isReasoning=false] - 是否是推理内容
     * @returns {string} 格式化后的HTML
     */
    formatMessage(text, role = 'assistant', messageId = -1, { isReasoning = false } = {}) {
        if (!text) return '';

        let mes = text;
        const isSystem = role === 'system';
        const isUser = role === 'user';

        // 0. 先把可渲染HTML转换为占位符（避免后续“隐藏宏语法”误删HTML内容中的 {{ }}）
        if (!isSystem && window.HtmlRenderer && typeof HtmlRenderer.preprocessText === 'function') {
            mes = HtmlRenderer.preprocessText(mes);
        }

        // 1. 再隐藏宏语法和特殊标签（不应在UI显示的内容）
        mes = this._hideMacrosAndSpecialTags(mes);

        // 1. 应用正则处理（必须在Markdown转换之前，参考SillyTavern第1700行）
        // 只对非系统消息应用正则
        if (!isSystem && window.RegexProcessor && window.regex_placement) {
            // 确定regex placement (参考ST: script.js:1677-1692)
            const placement = isReasoning ? window.regex_placement.REASONING :
                isUser ? window.regex_placement.USER_INPUT :
                    window.regex_placement.AI_OUTPUT;

            // 计算消息深度（从最新消息到当前消息的距离）
            // 参考SillyTavern: depth = usableMessages.length - indexOf - 1
            let depth = undefined;
            if (typeof State !== 'undefined' && State.chatHistory && Array.isArray(State.chatHistory)) {
                // 过滤出非系统消息
                const usableMessages = State.chatHistory
                    .map((m, idx) => ({ message: m, index: idx }))
                    .filter(x => x.message.role !== 'system');

                // 找到当前消息在usableMessages中的位置
                const indexOf = usableMessages.findIndex(x => x.index === messageId);

                if (indexOf !== -1 && usableMessages.length > 0) {
                    // depth是从最新消息到当前消息的距离（0是最新消息）
                    depth = usableMessages.length - indexOf - 1;
                }
            }

            // 应用正则处理（参考ST: script.js:1700-1704）
            try {
                mes = RegexProcessor.process(mes, placement, {
                    depth: depth,
                    isMarkdown: true,
                    characterOverride: undefined
                });
            } catch (e) {
                console.error('RegexProcessor error:', e);
                // 如果正则处理失败，继续使用原始文本
            }
        }

        if (!isSystem) {
            // 1.5 预处理Mermaid代码块（在其他处理之前）
            // 将 ```mermaid ... ``` 转换为 <pre class="mermaid"> ... </pre>
            if (window.MermaidRenderer && typeof MermaidRenderer.preprocessText === 'function') {
                mes = MermaidRenderer.preprocessText(mes);
            }

            // 2. 保护HTML标签内的双引号（关键：防止后续引号处理打碎标签）
            // SillyTavern做法：把 <tag attr="x"> 里的 " 临时替换成 \ufffe，处理完再还原
            // 参考ST: script.js:1731-1733
            mes = mes.replace(/<([^>]+)>/g, function (_, contents) {
                return '<' + contents.replace(/"/g, '\ufffe') + '>';
            });

            // 3. 处理引号（转换为<q>标签，参考SillyTavern第1736-1762行）
            // 关键：正则表达式会匹配代码块，但会直接返回原始匹配（不处理引号）
            mes = mes.replace(
                /<style>[\s\S]*?<\/style>|```[\s\S]*?```|~~~[\s\S]*?~~~|``[\s\S]*?``|`[\s\S]*?`|(".*?")|(\u201C.*?\u201D)|(\u00AB.*?\u00BB)|(\u300C.*?\u300D)|(\u300E.*?\u300F)|(\uFF02.*?\uFF02)/gim,
                function (match, p1, p2, p3, p4, p5, p6) {
                    // 如果匹配到代码块或样式标签，直接返回（不处理引号）
                    if (match.startsWith('```') || match.startsWith('~~~') || match.startsWith('``') || match.startsWith('`') || match.startsWith('<style>')) {
                        return match;
                    }
                    // 处理引号
                    if (p1) {
                        // English double quotes
                        return `<q>"${p1.slice(1, -1)}"</q>`;
                    } else if (p2) {
                        // Curly double quotes " "
                        return `<q>"${p2.slice(1, -1)}"</q>`;
                    } else if (p3) {
                        // Guillemets « »
                        return `<q>«${p3.slice(1, -1)}»</q>`;
                    } else if (p4) {
                        // Corner brackets 「 」
                        return `<q>「${p4.slice(1, -1)}」</q>`;
                    } else if (p5) {
                        // White corner brackets 『 』
                        return `<q>『${p5.slice(1, -1)}』</q>`;
                    } else if (p6) {
                        // Fullwidth quotes ＂ ＂
                        return `<q>＂${p6.slice(1, -1)}＂</q>`;
                    } else {
                        // Return the original match if no quotes are found
                        return match;
                    }
                }
            );

            // 4. 还原HTML标签内的双引号（把 \ufffe 还原回 "）
            // 参考ST: script.js:1765-1767
            mes = mes.replace(/\ufffe/g, '"');

            // 5. 处理LaTeX对齐（参考SillyTavern第1769-1770行）
            mes = mes.replaceAll('\\begin{align*}', '$$');
            mes = mes.replaceAll('\\end{align*}', '$$');

            // 6. Markdown转换（使用showdown，参考SillyTavern第1771行）
            if (this.converter) {
                try {
                    mes = this.converter.makeHtml(mes);
                } catch (e) {
                    console.error('Showdown conversion error:', e);
                    // 回退到简单处理
                    mes = this._escapeHtml(mes).replace(/\n/g, '<br>');
                }
            } else if (typeof marked !== 'undefined') {
                // 回退到marked
                try {
                    marked.setOptions({ breaks: true, gfm: true, highlight: null });
                    mes = marked.parse(mes);
                } catch (e) {
                    console.error('Marked conversion error:', e);
                    mes = this._escapeHtml(mes).replace(/\n/g, '<br>');
                }
            } else {
                // 简单处理
                mes = this._escapeHtml(mes).replace(/\n/g, '<br>');
            }

            // 7. 处理代码块中的换行（Firefox兼容，参考SillyTavern第1773-1778行）
            mes = mes.replace(/<code(.*?)>[\s\S]*?<\/code>/g, function (match) {
                // Firefox creates extra newlines from <br>s in code blocks, so we replace them before converting newlines to <br>s.
                return match.replace(/\n/gm, '\u0000');
            });
            mes = mes.replace(/\u0000/g, '\n'); // Restore converted newlines
            mes = mes.trim();

            // 8. 修复代码块中的&amp;（参考SillyTavern第1780-1782行）
            mes = mes.replace(/<code(.*?)>[\s\S]*?<\/code>/g, function (match) {
                return match.replace(/&amp;/g, '&');
            });
        } else {
            // 系统消息简单处理
            mes = this._escapeHtml(mes).replace(/\n/g, '<br>');
        }

        // 9. 编码style标签（参考ST: script.js:1798）
        mes = this._encodeStyleTags(mes);

        // 10. HTML清理（使用DOMPurify，参考ST: script.js:1789-1800）
        // 关键：不设置ALLOWED_TAGS，让DOMPurify使用默认的安全标签列表
        if (typeof DOMPurify !== 'undefined') {
            try {
                const config = {
                    RETURN_DOM: false,
                    RETURN_DOM_FRAGMENT: false,
                    RETURN_TRUSTED_TYPE: false,
                    MESSAGE_SANITIZE: true,
                    // 只添加custom-style，不限制其他标签
                    ADD_TAGS: ['custom-style'],
                };
                mes = DOMPurify.sanitize(mes, config);
            } catch (e) {
                console.error('DOMPurify error:', e);
                // 失败时走 escape 而非 raw HTML —— 用户最多看到 tag 字符串，绝不能 XSS
                mes = this._escapeHtml(mes);
            }
        } else {
            // DOMPurify 库未加载（CDN 挂 / 顺序错）—— 走 escape，绝不直接渲染 raw AI HTML
            console.error('DOMPurify 不存在，AI 内容走 escape 兜底（请检查 DOMPurify 是否加载）');
            mes = this._escapeHtml(mes);
        }

        // 11. 解码style标签（参考ST: script.js:1800）
        mes = this._decodeStyleTags(mes, { prefix: '.message-content ' });

        return mes.trim();
    },

    /**
     * HTML转义
     */
    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};

// 初始化
if (typeof window !== 'undefined') {
    window.MessageFormatter = MessageFormatter;
    // 延迟初始化，确保showdown已加载
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => MessageFormatter.init());
    } else {
        MessageFormatter.init();
    }
}
