/**
 * 界面状态记忆：当前页、设置标签、折叠状态、各滚动区域的位置。
 * 存放在会话存储中，刷新页面后恢复；会话存储不可用时只保留在内存中。
 */

const UiState = {
    KEY: 'bulimia_ui_state',
    _data: null,
    _warned: false,

    _load() {
        if (this._data) return this._data;
        let parsed = null;
        try {
            const raw = window.sessionStorage.getItem(this.KEY);
            parsed = raw ? JSON.parse(raw) : null;
        } catch (e) {
            this._warnOnce(e);
        }
        this._data = (parsed && typeof parsed === 'object') ? parsed : {};
        return this._data;
    },

    _warnOnce(err) {
        if (this._warned) return;
        this._warned = true;
        console.warn('界面状态无法写入会话存储，刷新后将不再恢复位置：', err);
    },

    _flush() {
        try {
            window.sessionStorage.setItem(this.KEY, JSON.stringify(this._data));
        } catch (e) {
            this._warnOnce(e);
        }
    },

    get(key, fallback) {
        const v = this._load()[key];
        return v === undefined ? fallback : v;
    },

    set(key, value) {
        this._load()[key] = value;
        this._flush();
    },

    getMap(mapKey, key, fallback) {
        const m = this._load()[mapKey];
        if (!m || m[key] === undefined) return fallback;
        return m[key];
    },

    setMap(mapKey, key, value) {
        const d = this._load();
        if (!d[mapKey] || typeof d[mapKey] !== 'object') d[mapKey] = {};
        d[mapKey][key] = value;
        this._flush();
    }
};

/**
 * 滚动位置记忆：监听滚动并保存，重绘或刷新后恢复。
 * 位置同时记录是否贴着底部，贴底的区域恢复时仍贴底。
 */
const ScrollMemory = {
    BOTTOM_SLACK: 24,
    _tracked: [],
    _hooked: false,
    _frozen: false,

    _saveAll() {
        this._tracked.forEach(([el, key]) => {
            if (el.isConnected) this.save(el, typeof key === 'function' ? key() : key);
        });
    },

    isNearBottom(el) {
        return el.scrollHeight - el.scrollTop - el.clientHeight <= this.BOTTOM_SLACK;
    },

    /** 开始记录某个滚动区域；键名可以是函数，同一个滚动区域按当前内容分别记录时用 */
    track(el, key) {
        if (!el || el.__scrollTracked) return;
        el.__scrollTracked = true;
        this._tracked.push([el, key]);
        if (!this._hooked) {
            this._hooked = true;
            // 离开页面时浏览器先拆内容再触发滚动事件，位置会被拆出来的值覆盖；
            // 所以在拆之前写一遍当前位置并冻结，之后的滚动事件不再保存
            const freeze = () => {
                if (this._frozen) return;
                this._saveAll();
                this._frozen = true;
            };
            window.addEventListener('beforeunload', freeze);
            window.addEventListener('pagehide', freeze);
            window.addEventListener('pageshow', () => { this._frozen = false; });
        }
        let raf = 0;
        el.addEventListener('scroll', () => {
            if (raf) return;
            raf = requestAnimationFrame(() => {
                raf = 0;
                this.save(el, typeof key === 'function' ? key() : key);
            });
        }, { passive: true });
    },

    save(el, key) {
        if (this._frozen || !el || !key || el.clientHeight === 0) return;
        UiState.setMap('scroll', key, { top: Math.round(el.scrollTop), bottom: this.isNearBottom(el) });
    },

    /** 恢复已保存的位置；没有记录时返回 false */
    restore(el, key) {
        const rec = UiState.getMap('scroll', key, null);
        if (!el || !rec) return false;
        el.scrollTop = rec.bottom ? el.scrollHeight : rec.top;
        return true;
    },

    /**
     * 刷新页面后第一次显示某个区域时恢复位置。内容可能稍后才画完，所以短时间内重试；
     * 玩家一开始自己滚动就不再干预。
     */
    restoreOnce(el, key) {
        if (!el || el.__scrollRestored) return;
        el.__scrollRestored = true;
        this.restoreWhenReady(el, key);
    },

    /** 内容可能稍后才画完：短时间内重试恢复位置，玩家自己一滚动就不再干预 */
    restoreWhenReady(el, key) {
        if (!el) return;
        const token = (el.__restoreToken = (el.__restoreToken || 0) + 1);
        const rec = UiState.getMap('scroll', key, null);
        if (!rec || !rec.top) return;
        let touched = false;
        const mark = () => { touched = true; };
        ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach(ev => el.addEventListener(ev, mark, { once: true, passive: true }));
        // 里面的文本框等内容会陆续撑高，三秒内每隔一会儿再对一次位置
        const started = Date.now();
        const attempt = () => {
            if (touched || el.__restoreToken !== token) return;
            el.scrollTop = rec.top;
            if (Date.now() - started < 3000) setTimeout(attempt, 100);
        };
        requestAnimationFrame(attempt);
    },

    /** 执行会改变内容的重绘，并保持滚动位置不变；stickBottom 为真时原先贴底的区域仍贴底 */
    preserve(el, fn, stickBottom = false) {
        if (!el) return fn();
        const top = el.scrollTop;
        const wasBottom = stickBottom && this.isNearBottom(el);
        const result = fn();
        el.scrollTop = wasBottom ? el.scrollHeight : top;
        return result;
    }
};

if (typeof window !== 'undefined') {
    window.UiState = UiState;
    window.ScrollMemory = ScrollMemory;
}
