/**
 * 版式控制：宽屏判断、可视区域高度（软键盘与安全区）、侧栏抽屉。
 * 宽屏的判断语句与 css/components/layout.css 中的媒体查询保持同一句。
 */

const LayoutMode = {
    WIDE_QUERY: '(orientation: landscape) and (min-width: 640px)',

    _mql: null,
    _openSide: null,
    _returnFocus: null,
    _panelRaf: 0,

    init() {
        this._mql = window.matchMedia(this.WIDE_QUERY);
        const onModeChange = () => {
            this.closeDrawers();
            document.documentElement.setAttribute('data-layout', this.isWide() ? 'wide' : 'narrow');
        };
        if (this._mql.addEventListener) this._mql.addEventListener('change', onModeChange);
        else this._mql.addListener(onModeChange);
        onModeChange();

        this._bindViewport();
        this._bindDrawers();
        this._observePanels();
        ['left', 'right'].forEach(side => {
            const scroller = document.querySelector('#panel-' + side + ' .panel-scroll');
            if (!scroller) return;
            ScrollMemory.track(scroller, 'drawer:' + side);
            ScrollMemory.restoreOnce(scroller, 'drawer:' + side);
        });
    },

    isWide() {
        return this._mql ? this._mql.matches : window.matchMedia(this.WIDE_QUERY).matches;
    },

    // ---------- 可视区域 ----------

    /** 应用高度取可视区域高度：软键盘弹出时随之收缩，输入框不被遮挡 */
    _applyViewport() {
        const vv = window.visualViewport;
        const zoomed = vv && vv.scale > 1.01;
        const height = (vv && !zoomed) ? vv.height : window.innerHeight;
        const top = (vv && !zoomed) ? vv.offsetTop : 0;
        const root = document.documentElement.style;
        root.setProperty('--app-h', height + 'px');
        root.setProperty('--app-top', top + 'px');
    },

    _bindViewport() {
        const update = () => this._applyViewport();
        window.addEventListener('resize', update);
        window.addEventListener('orientationchange', update);
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', update);
            window.visualViewport.addEventListener('scroll', update);
        }
        update();
    },

    // ---------- 侧栏抽屉 ----------

    _panel(side) { return document.getElementById(side === 'left' ? 'panel-left' : 'panel-right'); },

    openDrawer(side) {
        if (this.isWide()) return;
        const panel = this._panel(side);
        const backdrop = document.getElementById('drawer-backdrop');
        if (!panel || !backdrop) return;
        this.closeDrawers();
        this._returnFocus = document.activeElement;
        this._openSide = side;
        panel.classList.add('is-open');
        backdrop.classList.add('is-open');
        document.querySelectorAll('[data-drawer-open]').forEach(btn => {
            btn.setAttribute('aria-expanded', btn.getAttribute('data-drawer-open') === side ? 'true' : 'false');
        });
    },

    closeDrawers() {
        const backdrop = document.getElementById('drawer-backdrop');
        ['left', 'right'].forEach(side => {
            const panel = this._panel(side);
            if (panel) panel.classList.remove('is-open');
        });
        if (backdrop) backdrop.classList.remove('is-open');
        document.querySelectorAll('[data-drawer-open]').forEach(btn => btn.setAttribute('aria-expanded', 'false'));
        if (this._openSide && this._returnFocus && this._returnFocus.focus) this._returnFocus.focus();
        this._openSide = null;
        this._returnFocus = null;
    },

    _bindDrawers() {
        document.querySelectorAll('[data-drawer-open]').forEach(btn => {
            btn.addEventListener('click', () => {
                const side = btn.getAttribute('data-drawer-open');
                if (this._openSide === side) this.closeDrawers();
                else this.openDrawer(side);
            });
        });
        const backdrop = document.getElementById('drawer-backdrop');
        if (backdrop) backdrop.addEventListener('click', () => this.closeDrawers());
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this._openSide) this.closeDrawers();
        });
    },

    // ---------- 侧栏是否有内容 ----------

    /** 侧栏没有内容时，宽屏收起该栏、窄屏隐藏对应入口 */
    _syncPanels() {
        const page = document.getElementById('page-game');
        if (!page) return;
        const left = document.getElementById('left-plugins-container');
        const right = document.getElementById('right-plugins-container');
        page.setAttribute('data-left', left && left.children.length > 0 ? '1' : '0');
        page.setAttribute('data-right', right && right.children.length > 0 ? '1' : '0');
    },

    _observePanels() {
        const schedule = () => {
            if (this._panelRaf) return;
            this._panelRaf = requestAnimationFrame(() => {
                this._panelRaf = 0;
                this._syncPanels();
            });
        };
        ['left-plugins-container', 'right-plugins-container'].forEach(id => {
            const el = document.getElementById(id);
            if (el) new MutationObserver(schedule).observe(el, { childList: true });
        });
        this._syncPanels();
    }
};

if (typeof window !== 'undefined') window.LayoutMode = LayoutMode;
