/**
 * Mermaid图表渲染器
 * 参考SillyTavern Extension-Mermaid实现
 * 
 * 功能：
 * 1. 检测聊天消息中的mermaid代码块
 * 2. 将代码块转换为可渲染的mermaid图表
 * 3. 支持流程图、时序图、甘特图等各种mermaid图表类型
 */

const MermaidRenderer = {
    // 是否已初始化
    initialized: false,

    // Mermaid配置
    config: {
        theme: 'dark',
        themeVariables: {
            darkMode: true,
            primaryColor: '#bdbdbd',
            secondaryColor: '#1f1f1f',
            tertiaryColor: '#2a2a2a',
            primaryTextColor: '#e0e0e0',
            secondaryTextColor: '#a0a0a0',
            lineColor: '#505050',
            fontSize: '14px'
        },
        flowchart: {
            htmlLabels: true,
            curve: 'basis'
        },
        sequence: {
            diagramMarginX: 50,
            diagramMarginY: 10,
            actorMargin: 50
        },
        gantt: {
            titleTopMargin: 25,
            barHeight: 20,
            barGap: 4
        },
        securityLevel: 'strict' // 图表文字来自 AI 回复，不允许点击脚本和原样 HTML
    },

    /**
     * 初始化Mermaid
     */
    async init() {
        if (this.initialized) return;

        if (typeof mermaid === 'undefined') {
            await this._loadMermaid();
        }

        if (typeof mermaid !== 'undefined') {
            try {
                mermaid.initialize({
                    startOnLoad: false, // 我们手动控制渲染
                    ...this.config
                });
                this.initialized = true;
            } catch (error) {
                throw new Error(I18n.t('图表组件初始化失败'));
            }
        }
    },

    /**
     * 按需加载本地的 Mermaid（文件较大，只有消息里真有图表时才加载）
     */
    _loadMermaid() {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'vendor/mermaid/mermaid.min.js';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error(I18n.t('图表组件加载失败')));
            document.head.appendChild(script);
        });
    },

    /**
     * 在消息元素中渲染所有Mermaid图表
     * @param {HTMLElement} container - 消息容器元素
     */
    async renderInContainer(container) {
        // 查找所有mermaid代码块
        // 支持多种格式：
        // 1. ```mermaid ... ``` 代码块
        // 2. <pre class="mermaid"> ... </pre>
        // 3. <code class="language-mermaid"> ... </code>

        const codeBlocks = container.querySelectorAll('code.language-mermaid, pre code.language-mermaid');
        const preElements = container.querySelectorAll('pre.mermaid');

        let diagramsToRender = [];

        // 处理 code.language-mermaid
        codeBlocks.forEach((codeEl, index) => {
            const code = codeEl.textContent.trim();
            if (!code) return;

            // 创建新的mermaid容器
            const mermaidDiv = document.createElement('div');
            mermaidDiv.className = 'mermaid-diagram';
            mermaidDiv.dataset.mermaidIndex = index;

            // 替换代码块的父元素（通常是<pre>）
            const parent = codeEl.parentElement;
            if (parent && parent.tagName === 'PRE') {
                parent.replaceWith(mermaidDiv);
            } else {
                codeEl.replaceWith(mermaidDiv);
            }

            diagramsToRender.push({ element: mermaidDiv, code, id: `mermaid-${Date.now()}-${index}` });
        });

        // 处理 pre.mermaid
        preElements.forEach((preEl, index) => {
            // 检查是否已经渲染过
            if (preEl.dataset.mermaidRendered === 'true') return;

            const code = preEl.textContent.trim();
            if (!code) return;

            // 标记为待渲染
            preEl.dataset.mermaidRendered = 'true';
            diagramsToRender.push({
                element: preEl,
                code,
                id: `mermaid-pre-${Date.now()}-${index}`
            });
        });

        if (diagramsToRender.length === 0) return;

        try {
            await this.init();
        } catch (error) {
            for (const diagram of diagramsToRender) {
                diagram.element.innerHTML = `<div class="mermaid-error">${I18n.t('{msg}，图表无法显示。', { msg: error.message })}</div>`;
            }
            return;
        }

        // 渲染所有图表
        for (const diagram of diagramsToRender) {
            try {
                await this._renderSingleDiagram(diagram);
            } catch (error) {
                diagram.element.textContent = '';
                const box = document.createElement('div');
                box.className = 'mermaid-error';
                box.textContent = I18n.t('图表格式有误，无法显示。');
                diagram.element.appendChild(box);
            }
        }
    },

    /**
     * 渲染单个Mermaid图表
     */
    async _renderSingleDiagram({ element, code, id }) {
        try {
            // 使用mermaid.render()渲染图表
            const { svg } = await mermaid.render(id, code);

            // 将SVG插入元素
            element.innerHTML = svg;
            element.classList.add('mermaid-rendered');
        } catch (error) {
            throw error;
        }
    },

    /**
     * 在整个聊天容器中渲染所有Mermaid图表
     * 通常在消息完成后调用
     */
    async renderAll() {
        const chatContainer = document.getElementById('chat-messages');
        if (chatContainer) {
            await this.renderInContainer(chatContainer);
        }
    },

    /**
     * 预处理消息文本，将mermaid代码块转换为正确的格式
     * 在消息格式化之前调用
     * @param {string} text - 原始消息文本
     * @returns {string} 处理后的文本
     */
    preprocessText(text) {
        if (!text) return text;

        // 将 ```mermaid ... ``` 代码块转换为 <pre class="mermaid"> ... </pre>
        // 这样可以避免被Showdown转换为普通代码块
        const mermaidRegex = /```mermaid\s*([\s\S]*?)```/gi;

        return text.replace(mermaidRegex, (match, content) => {
            const trimmedContent = content.trim();
            return `<pre class="mermaid">${this._escapeHtml(trimmedContent)}</pre>`;
        });
    },

    /**
     * HTML转义（保留特定字符用于Mermaid语法）
     */
    _escapeHtml(text) {
        // 只转义可能破坏HTML结构的字符，保留Mermaid语法字符
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }
};

// 导出到全局
if (typeof window !== 'undefined') {
    window.MermaidRenderer = MermaidRenderer;

    // DOM加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => MermaidRenderer.init());
    } else {
        MermaidRenderer.init();
    }
}
