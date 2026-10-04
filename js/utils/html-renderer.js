/**
 * HTML 文档渲染器：AI 回复里的完整 HTML 文档、```html 代码块，放进隔离页面显示。
 * 隔离运行层同插件界面（见 js/plugins/plugin-sandbox.js）：独立来源、禁止网络请求、脚本卡死或报错不影响本体。
 */

const HtmlRenderer = {
    counter: 0,

    _decode(b64) { return decodeURIComponent(escape(atob(b64))); },

    _encode(text) { return btoa(unescape(encodeURIComponent(text))); },

    /** 预处理消息文本：把 HTML 文档和 ```html 代码块换成占位，之后由 renderInContainer 渲染 */
    preprocessText(text) {
        if (!text) return text;
        let result = this._processHtmlCodeBlocks(text);
        result = this._processFullHtmlDocuments(result);
        return result;
    },

    _processHtmlCodeBlocks(text) {
        return text.replace(/```html\s*([\s\S]*?)```/gi, (match, content) => {
            const trimmed = content.trim();
            if (this._isFullHtmlDocument(trimmed)) return this._createPlaceholder(trimmed);
            if (this._hasRenderableHtml(trimmed)) return this._createPlaceholder(this._wrapInBasicHtml(trimmed));
            return match;
        });
    },

    _processFullHtmlDocuments(text) {
        return text.replace(/(<!DOCTYPE\s+html[\s\S]*?<\/html>|<html[\s\S]*?<\/html>)/gi, (match) => this._createPlaceholder(match));
    },

    _isFullHtmlDocument(html) {
        const t = html.trim().toLowerCase();
        return t.startsWith('<!doctype html') || t.startsWith('<html') || (t.includes('<head') && t.includes('<body'));
    },

    _hasRenderableHtml(html) {
        const lower = html.toLowerCase();
        return ['<div', '<button', '<form', '<input', '<select', '<table', '<canvas', '<svg', '<style', '<script'].some(tag => lower.includes(tag));
    },

    _wrapInBasicHtml(fragment) {
        return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">' +
            '<style>* { margin: 0; padding: 0; box-sizing: border-box; } body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 16px; background: #1f1f1f; color: #e0e0e0; }</style>' +
            '</head><body>' + fragment + '</body></html>';
    },

    _createPlaceholder(htmlContent) {
        const id = 'html-render-' + Date.now() + '-' + (this.counter++);
        return '<div class="html-render-container" data-html-id="' + id + '" data-html-content="' + this._encode(htmlContent) + '">' +
            '<div class="html-render-loading">' + I18n.t('正在载入页面…') + '</div></div>';
    },

    /** 渲染容器里所有还没渲染的占位 */
    async renderInContainer(container) {
        const placeholders = container.querySelectorAll('.html-render-container:not(.html-rendered)');
        for (const placeholder of placeholders) this._renderSingle(placeholder);
    },

    _renderSingle(placeholder) {
        const encoded = placeholder.dataset.htmlContent;
        const id = placeholder.dataset.htmlId;
        placeholder.innerHTML = '';
        placeholder.classList.add('html-rendered');
        let html;
        try { html = this._decode(encoded); }
        catch (e) { placeholder.textContent = I18n.t('这段网页内容无法显示。'); return; }

        const wrapper = document.createElement('div');
        wrapper.className = 'html-iframe-wrapper';
        wrapper.id = id;

        const toolbar = document.createElement('div');
        toolbar.className = 'html-render-toolbar';
        const label = document.createElement('span');
        label.className = 'html-render-label';
        label.textContent = I18n.t('网页内容');
        const actions = document.createElement('div');
        actions.className = 'html-render-actions';
        const mk = (text, fn) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'html-action-btn';
            b.textContent = text;
            b.addEventListener('click', fn);
            return b;
        };
        actions.appendChild(mk(I18n.t('全屏'), () => this.toggleFullscreen(id)));
        actions.appendChild(mk(I18n.t('复制'), () => this.copyHtml(html)));
        toolbar.appendChild(label);
        toolbar.appendChild(actions);

        const stage = document.createElement('div');
        stage.className = 'html-render-stage';
        wrapper.appendChild(toolbar);
        wrapper.appendChild(stage);
        placeholder.appendChild(wrapper);

        window.PluginSandbox.mount(stage, {
            pluginId: id,
            name: I18n.t('网页内容'),
            minHeight: 120,
            getDoc: () => ({ html, css: '' })
        });
    },

    toggleFullscreen(id) {
        const wrapper = document.getElementById(id);
        if (!wrapper) return;
        const on = !wrapper.classList.contains('fullscreen');
        wrapper.classList.toggle('fullscreen', on);
        document.body.style.overflow = on ? 'hidden' : '';
    },

    /** 复制页面代码：优先用剪贴板接口，不可用时退回选中文字复制 */
    async copyHtml(text) {
        const notify = (msg, type) => { if (window.Toast) Toast.show(msg, type); };
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                notify(I18n.t('已复制。'), 'success');
                return;
            }
        } catch (e) { /* 剪贴板接口被拒绝，改用下面的方式 */ }
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        document.body.removeChild(ta);
        notify(ok ? I18n.t('已复制。') : I18n.t('复制失败，请允许浏览器的剪贴板权限后重试。'), ok ? 'success' : 'error');
    },

    async renderAll() {
        const chat = document.getElementById('chat-messages');
        if (chat) await this.renderInContainer(chat);
    }
};

if (typeof window !== 'undefined') window.HtmlRenderer = HtmlRenderer;
