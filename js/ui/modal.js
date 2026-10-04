/**
 * 对话框组件：同一时间只显示一个，统一的大小、按钮位置与关闭方式。
 */

const Modal = {
    container: null,
    resolvePromise: null,
    isResolved: false,
    _options: null,
    _returnFocus: null,
    _scrollSnapshot: null,
    _bound: false,

    init() {
        this.container = document.getElementById('modal-container');
        if (this._bound || !this.container) return;
        this._bound = true;
        this.container.querySelector('.modal-backdrop').addEventListener('click', () => this._dismissByBackdrop());
        document.addEventListener('keydown', (e) => {
            if (!this.isOpen()) return;
            if (e.key === 'Escape') {
                if (document.querySelector('.cs-list')) return;
                e.preventDefault();
                this.dismiss();
            } else if (e.key === 'Tab') {
                this._trapFocus(e);
            }
        });
    },

    isOpen() {
        return !!this.container && !this.container.classList.contains('hidden');
    },

    /**
     * 显示对话框
     * @param {string} title - 标题
     * @param {string} content - 内容（HTML）
     * @param {Object} options - buttons 底部按钮；onAction 按钮回调；wide 使用较宽的窗口
     */
    show(title, content, options = {}) {
        if (!this.container) this.init();
        const wasOpen = this.isOpen();

        const box = this.container.querySelector('.modal-content');
        const titleEl = this.container.querySelector('.modal-title');
        const bodyEl = this.container.querySelector('.modal-body');
        const footerEl = this.container.querySelector('.modal-footer');

        box.classList.toggle('is-wide', !!options.wide);
        titleEl.textContent = title;
        bodyEl.innerHTML = content;
        bodyEl.scrollTop = 0;
        this._options = options;

        if (options.buttons) {
            footerEl.innerHTML = '';
            options.buttons.forEach(btn => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = btn.class || '';
                b.dataset.action = btn.action;
                b.textContent = btn.label;
                b.addEventListener('click', () => { if (options.onAction) options.onAction(btn.action); });
                footerEl.appendChild(b);
            });
        } else {
            footerEl.innerHTML = '';
        }

        this.container.classList.remove('hidden');
        this.isResolved = false;
        if (!wasOpen) this._lockBackground();
        if (window.AutoGrow) AutoGrow.refresh(bodyEl);
        this._focusFirst();
    },

    /**
     * 关闭对话框
     * @param {boolean} skipResolve - 是否跳过resolve（已经通过按钮resolve时）
     */
    close(skipResolve = false) {
        const wasOpen = this.isOpen();
        if (this.container) this.container.classList.add('hidden');
        if (!skipResolve && this.resolvePromise && !this.isResolved) {
            this.isResolved = true;
            this.resolvePromise(null);
        }
        this.resolvePromise = null;
        this._options = null;
        if (wasOpen) this._unlockBackground();
    },

    /** 按 Esc 或点击框外：等同于点击取消类按钮 */
    dismiss() {
        const opts = this._options || {};
        const cancel = (opts.buttons || []).find(b => b.action === 'cancel' || b.action === 'close');
        if (cancel && opts.onAction) opts.onAction(cancel.action);
        else this.close();
    },

    _dismissByBackdrop() {
        const body = this.container.querySelector('.modal-body');
        if (body.querySelector('input:not([type="checkbox"]):not([type="radio"]), textarea')) return;
        this.dismiss();
    },

    _focusables() {
        return Array.prototype.filter.call(
            this.container.querySelectorAll('.modal-content button, .modal-content input, .modal-content textarea, .modal-content select, .modal-content [tabindex]'),
            el => !el.disabled && el.tabIndex >= 0 && el.offsetParent !== null
        );
    },

    _focusFirst() {
        const input = this.container.querySelector('.modal-body input:not([type="checkbox"]):not([type="radio"]):not([readonly]), .modal-body textarea');
        const primary = this.container.querySelector('.modal-footer .btn-primary');
        const target = input || primary || this._focusables()[0];
        if (target) setTimeout(() => target.focus({ preventScroll: true }), 30);
    },

    _trapFocus(e) {
        const list = this._focusables();
        if (!list.length) return;
        const first = list[0];
        const last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    },

    /** 打开时记录背景各滚动区域的位置，关闭后还原；背景不可聚焦、不可滚动 */
    _lockBackground() {
        this._returnFocus = document.activeElement;
        this._scrollSnapshot = [];
        document.querySelectorAll('.page.active, .page.active *').forEach(el => {
            if (el.scrollTop > 0 || el.scrollLeft > 0) this._scrollSnapshot.push([el, el.scrollTop, el.scrollLeft]);
        });
        document.querySelectorAll('.page').forEach(p => {
            p.setAttribute('aria-hidden', 'true');
            if ('inert' in p) p.inert = true;
        });
    },

    _unlockBackground() {
        document.querySelectorAll('.page').forEach(p => {
            p.removeAttribute('aria-hidden');
            if ('inert' in p) p.inert = false;
        });
        (this._scrollSnapshot || []).forEach(([el, top, left]) => {
            if (el.isConnected) { el.scrollTop = top; el.scrollLeft = left; }
        });
        this._scrollSnapshot = null;
        const back = this._returnFocus;
        this._returnFocus = null;
        if (back && back.isConnected && back.focus) back.focus({ preventScroll: true });
    },

    /**
     * 确认对话框
     * @param {string} title - 标题
     * @param {string} message - 消息
     * @param {Object} [opts] - confirmLabel 确认按钮文字；danger 为真时确认按钮用红色
     */
    confirm(title, message, opts = {}) {
        return new Promise(resolve => {
            this.resolvePromise = resolve;
            this.isResolved = false;

            this.show(title, `<div class="confirm-message">${message}</div>`, {
                buttons: [
                    { label: I18n.t('取消'), action: 'cancel' },
                    { label: opts.confirmLabel || I18n.t('确定'), action: 'confirm', class: opts.danger ? 'btn-danger' : 'btn-primary' }
                ],
                onAction: (action) => {
                    this.isResolved = true;
                    this.resolvePromise = null;
                    this.close(true);
                    resolve(action === 'confirm');
                }
            });
        });
    },

    /**
     * 输入对话框
     * 支持两种签名：
     *   prompt(title, placeholder, defaultValue)
     *   prompt(title, { description, placeholder, defaultValue, multiline })
     * 长说明文字（超过 30 字）自动作为说明段显示。
     */
    prompt(title, placeholderOrOpts = '', defaultValue = '') {
        return new Promise(resolve => {
            this.resolvePromise = resolve;
            this.isResolved = false;

            let description = '';
            let placeholder = '';
            let defVal = defaultValue;
            let multiline = false;
            if (placeholderOrOpts && typeof placeholderOrOpts === 'object') {
                description = String(placeholderOrOpts.description || '');
                placeholder = String(placeholderOrOpts.placeholder || '');
                multiline = !!placeholderOrOpts.multiline;
                if (placeholderOrOpts.defaultValue !== undefined) defVal = placeholderOrOpts.defaultValue;
            } else {
                const raw = String(placeholderOrOpts || '');
                if (raw.length > 30) description = raw;
                else placeholder = raw;
            }

            const inputId = 'modal-prompt-input';
            const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
            const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const descHtml = description ? `<div class="modal-prompt-desc">${escText(description)}</div>` : '';
            const field = multiline
                ? `<textarea id="${inputId}" placeholder="${escAttr(placeholder)}">${escText(defVal || '')}</textarea>`
                : `<input type="text" id="${inputId}" placeholder="${escAttr(placeholder)}" value="${escAttr(defVal || '')}" autocomplete="off">`;
            const finish = (action) => {
                const value = document.getElementById(inputId)?.value || '';
                this.isResolved = true;
                this.resolvePromise = null;
                this.close(true);
                resolve(action === 'confirm' ? value : null);
            };
            this.show(title, `<div class="input-dialog">${descHtml}${field}</div>`, {
                buttons: [
                    { label: I18n.t('取消'), action: 'cancel' },
                    { label: I18n.t('确定'), action: 'confirm', class: 'btn-primary' }
                ],
                onAction: finish
            });
            const el = document.getElementById(inputId);
            if (el && !multiline) {
                el.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); finish('confirm'); }
                });
            }
        });
    },

    /**
     * 提示对话框
     * @param {string} title - 标题
     * @param {string} message - 消息
     */
    alert(title, message) {
        return new Promise(resolve => {
            this.show(title, `<div class="confirm-message">${message}</div>`, {
                buttons: [
                    { label: I18n.t('确定'), action: 'close', class: 'btn-primary' }
                ],
                onAction: () => {
                    this.close();
                    resolve();
                }
            });
        });
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Modal };
}
if (typeof window !== 'undefined') window.Modal = Modal;
