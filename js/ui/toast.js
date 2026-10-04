/**
 * 提示组件：短暂显示的消息，可带「撤销」按钮。
 */

const Toast = {
    container: null,

    init() {
        this.container = document.getElementById('toast-container');
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = 'toast-container';
            document.body.appendChild(this.container);
        }
        this.container.setAttribute('role', 'status');
        this.container.setAttribute('aria-live', 'polite');
    },

    /**
     * 显示提示
     * @param {string} message - 消息内容
     * @param {string} type - 类型: 'success' | 'error' | 'warning' | 'info'
     * @param {number} duration - 显示时长(ms)
     * @param {Object} [action] - { label, onClick } 提示中的操作按钮
     */
    show(message, type = 'info', duration = CONFIG?.UI?.TOAST_DURATION || 3000, action = null) {
        if (!this.container) this.init();

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        const text = document.createElement('span');
        text.className = 'toast-text';
        text.textContent = message;
        toast.appendChild(text);

        const remove = () => {
            if (!toast.isConnected) return;
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 200);
        };
        if (action) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'toast-action';
            btn.textContent = action.label;
            btn.addEventListener('click', () => { remove(); action.onClick(); });
            toast.appendChild(btn);
        }

        // 点一下提示本身就收起（报错提示；普通提示不挡点击，自己消失）
        toast.addEventListener('click', (e) => { if (!e.target.closest('.toast-action')) remove(); });
        this.container.appendChild(toast);
        setTimeout(remove, duration);
        return toast;
    },

    /** 删除类操作之后给出的撤销入口 */
    undo(message, onUndo, duration = 8000) {
        return this.show(message, 'info', duration, { label: '撤销', onClick: onUndo });
    },

    success(message, duration) { return this.show(message, 'success', duration); },
    error(message, duration) { return this.show(message, 'error', duration); },
    warning(message, duration) { return this.show(message, 'warning', duration); },
    info(message, duration) { return this.show(message, 'info', duration); }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Toast };
}
if (typeof window !== 'undefined') window.Toast = Toast;
