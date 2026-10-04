/**
 * 多语言：以中文原文作为词条的键（源语言 zh），其他语言在 js/i18n/<语言>/ 下按区域登记词典。
 *
 * 用法：
 *   I18n.t('保存')                         // 无词条时原样返回中文
 *   I18n.t('已选择 {n} 条', { n: 3 })       // {name} 占位符
 *   I18n.pick({ zh: '长文本…', en: '…' })    // 整段 prompt / 说明文字按语言选取
 *   I18n.add('en', { '保存': 'Save' })       // 登记词典（可多次调用，后者覆盖前者）
 *
 * 新增语言：在 LANGS 里加一项，再在 js/i18n/<code>/ 下放词典文件并在 index.html 引入。
 * index.html 的固定文字与动态生成界面里残留的中文，由 DOM 遍历按同一词典兜底替换；聊天内容不翻译。
 * 切换语言会重新载入页面（语言存在 localStorage 的 bulimia_lang）。
 */

const I18n = {
    KEY: 'bulimia_lang',
    LANGS: [
        { code: 'zh', name: '中文' },
        { code: 'en', name: 'English' }
    ],
    SOURCE: 'zh',
    lang: 'zh',
    dicts: {},
    ATTRS: ['placeholder', 'aria-label', 'title'],
    SKIP: 'script,style,textarea,#chat-messages,.msg-content,.no-i18n',

    /** 读出语言偏好：已保存的 > 浏览器语言 > 中文 */
    detect() {
        const codes = this.LANGS.map(l => l.code);
        try {
            const saved = window.localStorage.getItem(this.KEY);
            if (codes.includes(saved)) return saved;
        } catch (e) { /* 读不到就按浏览器语言 */ }
        const nav = String((typeof navigator !== 'undefined' && navigator.language) || '').toLowerCase();
        const hit = codes.find(c => c !== this.SOURCE && nav.startsWith(c));
        return hit || this.SOURCE;
    },

    add(lang, dict) {
        this.dicts[lang] = Object.assign(this.dicts[lang] || {}, dict);
    },

    /** 当前语言的词条；没有就返回 undefined */
    _lookup(key) {
        const d = this.dicts[this.lang];
        return d && Object.prototype.hasOwnProperty.call(d, key) ? d[key] : undefined;
    },

    _fmt(text, params) {
        if (!params) return text;
        return text.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined && params[k] !== null ? String(params[k]) : m));
    },

    pick(map, params) {
        const v = map[this.lang] !== undefined ? map[this.lang] : map[this.SOURCE];
        return typeof v === 'string' ? this._fmt(v, params) : v;
    },

    init() {
        this._orig = new WeakMap();
        this._bind();
        this.apply();
        this._observe();
    },

    /** 翻译：以中文原文为键，找不到词条就原样返回；首尾空白保留 */
    t(zh, params) {
        if (typeof zh !== 'string') return zh;
        if (this.lang === this.SOURCE) return this._fmt(zh, params);
        const key = zh.trim();
        const hit = key ? this._lookup(key) : undefined;
        return this._fmt(hit !== undefined ? zh.replace(key, () => hit) : zh, params);
    },

    set(lang) {
        if (!this.LANGS.some(l => l.code === lang) || lang === this.lang) return;
        try { window.localStorage.setItem(this.KEY, lang); } catch (e) { console.warn('语言偏好保存失败：', e); }
        window.location.reload();
    },

    apply(root) {
        const base = root || document.body;
        document.documentElement.lang = this.lang === 'zh' ? 'zh-CN' : this.lang;
        document.title = this.t('贪食症 - Bulimia');
        this._busy = true;
        try { this._walk(base); } finally { this._busy = false; }
        document.querySelectorAll('.lang-select').forEach(s => { s.value = this.lang; });
    },

    _walk(node) {
        if (node.nodeType === 3) return this._text(node);
        if (node.nodeType !== 1) return;
        if (node.matches && node.matches(this.SKIP)) return;
        if (node.closest && node.closest(this.SKIP)) return;
        this._attrs(node);
        for (const c of node.childNodes) this._walk(c);
    },

    _text(node) {
        const orig = this._orig.has(node) ? this._orig.get(node) : node.nodeValue;
        if (!this._orig.has(node)) {
            if (!/[一-龥]/.test(orig)) return;
            this._orig.set(node, orig);
        } else if (node.nodeValue !== orig && node.nodeValue !== this.t(orig)) {
            // 文本被程序改写过，以新文本为准
            if (!/[一-龥]/.test(node.nodeValue)) { this._orig.delete(node); return; }
            this._orig.set(node, node.nodeValue);
            return this._text(node);
        }
        const out = this.lang === this.SOURCE ? orig : this.t(orig);
        if (node.nodeValue !== out) node.nodeValue = out;
    },

    _attrs(el) {
        for (const a of this.ATTRS) {
            if (!el.hasAttribute(a)) continue;
            const key = `data-i18n-${a}`;
            let orig = el.getAttribute(key);
            if (orig === null) {
                orig = el.getAttribute(a);
                if (!/[一-龥]/.test(orig)) continue;
                el.setAttribute(key, orig);
            }
            const out = this.lang === this.SOURCE ? orig : this.t(orig);
            if (el.getAttribute(a) !== out) el.setAttribute(a, out);
        }
    },

    _observe() {
        if (typeof MutationObserver === 'undefined') return;
        new MutationObserver(muts => {
            if (this._busy || this.lang === this.SOURCE) return;
            this._busy = true;
            try {
                for (const m of muts) {
                    if (m.type === 'childList') m.addedNodes.forEach(n => this._walk(n));
                    else if (m.type === 'characterData') this._walk(m.target);
                    else if (m.type === 'attributes' && !m.attributeName.startsWith('data-i18n')) this._attrs(m.target);
                }
            } finally { this._busy = false; }
        }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: this.ATTRS });
    },

    _bind() {
        document.querySelectorAll('.lang-select').forEach(s => {
            s.textContent = '';
            for (const l of this.LANGS) {
                const o = document.createElement('option');
                o.value = l.code;
                o.textContent = l.name;
                s.appendChild(o);
            }
            s.addEventListener('change', () => this.set(s.value));
        });
    }
};

if (typeof window !== 'undefined') window.I18n = I18n;
I18n.lang = I18n.detect();
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => I18n.init());
else I18n.init();
