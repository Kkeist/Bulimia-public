/**
 * 表单控件：自绘下拉、只收数字的数字框、随内容长高的文本框、标签式增删列表。
 * 原生控件保留在页面中承载取值与事件，外观由这里接管。
 */

const _selectValueDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
const _selectIndexDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
const _textareaValueDesc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');

// ============================================================
// 下拉
// ============================================================

const CustomSelect = {
    _current: null,

    enhance(select) {
        if (select.__cs || select.multiple || select.size > 1 || select.hasAttribute('data-native')) return;
        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = ('cs-trigger ' + select.className).trim();
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-expanded', 'false');
        if (select.getAttribute('aria-label')) trigger.setAttribute('aria-label', select.getAttribute('aria-label'));
        select.insertAdjacentElement('afterend', trigger);
        select.style.display = 'none';
        select.__cs = { trigger };

        const sync = () => {
            const opt = select.options[select.selectedIndex];
            trigger.textContent = opt ? opt.textContent : '';
            trigger.disabled = select.disabled;
            trigger.classList.toggle('is-placeholder', !select.value);
        };
        select.__cs.sync = sync;

        Object.defineProperty(select, 'value', {
            configurable: true,
            get() { return _selectValueDesc.get.call(this); },
            set(v) { _selectValueDesc.set.call(this, v); sync(); }
        });
        Object.defineProperty(select, 'selectedIndex', {
            configurable: true,
            get() { return _selectIndexDesc.get.call(this); },
            set(v) { _selectIndexDesc.set.call(this, v); sync(); }
        });
        new MutationObserver(sync).observe(select, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'selected', 'label'] });

        trigger.addEventListener('click', () => {
            if (this._current && this._current.select === select) this.close();
            else this.open(select);
        });
        trigger.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                this.open(select);
            }
        });
        sync();
    },

    open(select) {
        this.close();
        const info = select.__cs;
        if (!info || select.disabled) return;
        const trigger = info.trigger;
        const list = document.createElement('div');
        list.className = 'cs-list';
        list.setAttribute('role', 'listbox');
        Array.prototype.forEach.call(select.options, (opt, idx) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'cs-option';
            b.setAttribute('role', 'option');
            b.setAttribute('aria-selected', idx === select.selectedIndex ? 'true' : 'false');
            b.dataset.index = String(idx);
            b.textContent = opt.textContent;
            b.disabled = opt.disabled;
            list.appendChild(b);
        });
        document.body.appendChild(list);

        const vv = window.visualViewport;
        const vw = window.innerWidth;
        const vh = vv ? vv.height : window.innerHeight;
        const rect = trigger.getBoundingClientRect();
        const width = Math.min(Math.max(rect.width, 160), vw - 16);
        const left = Math.max(8, Math.min(rect.left, vw - width - 8));
        const below = vh - rect.bottom - 8;
        const above = rect.top - 8;
        const natural = list.scrollHeight + 2;
        const openUp = below < Math.min(natural, 200) && above > below;
        const maxH = Math.max(120, Math.min(openUp ? above : below, 360));
        list.style.width = width + 'px';
        list.style.left = left + 'px';
        list.style.maxHeight = maxH + 'px';
        const h = Math.min(natural, maxH);
        list.style.top = (openUp ? Math.max(8, rect.top - h - 2) : rect.bottom + 2) + 'px';

        trigger.setAttribute('aria-expanded', 'true');
        const onPointer = (e) => {
            if (list.contains(e.target) || trigger.contains(e.target)) return;
            this.close();
        };
        const onScroll = (e) => { if (!list.contains(e.target)) this.close(); };
        const onKey = (e) => this._onKey(e, list, trigger);
        const onResize = () => this.close();
        document.addEventListener('pointerdown', onPointer, true);
        document.addEventListener('scroll', onScroll, true);
        document.addEventListener('keydown', onKey, true);
        window.addEventListener('resize', onResize);
        list.addEventListener('click', (e) => {
            const b = e.target.closest('.cs-option');
            if (!b || b.disabled) return;
            _selectIndexDesc.set.call(select, Number(b.dataset.index));
            info.sync();
            this.close();
            select.dispatchEvent(new Event('input', { bubbles: true }));
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        this._current = { select, list, trigger, cleanup: () => {
            document.removeEventListener('pointerdown', onPointer, true);
            document.removeEventListener('scroll', onScroll, true);
            document.removeEventListener('keydown', onKey, true);
            window.removeEventListener('resize', onResize);
        } };
        const selected = list.querySelector('[aria-selected="true"]') || list.querySelector('.cs-option');
        if (selected) {
            selected.focus();
            const top = selected.offsetTop - list.clientHeight / 2 + selected.offsetHeight / 2;
            list.scrollTop = Math.max(0, top);
        }
    },

    _onKey(e, list, trigger) {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            this.close();
            trigger.focus();
            return;
        }
        const opts = Array.prototype.filter.call(list.querySelectorAll('.cs-option'), b => !b.disabled);
        const idx = opts.indexOf(document.activeElement);
        let next = -1;
        if (e.key === 'ArrowDown') next = Math.min(opts.length - 1, idx + 1);
        else if (e.key === 'ArrowUp') next = Math.max(0, idx - 1);
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = opts.length - 1;
        if (next >= 0) {
            e.preventDefault();
            opts[next].focus();
        }
    },

    close() {
        const cur = this._current;
        if (!cur) return;
        this._current = null;
        cur.cleanup();
        cur.list.remove();
        cur.trigger.setAttribute('aria-expanded', 'false');
    },

    enhanceAll(root) {
        root.querySelectorAll('select').forEach(s => this.enhance(s));
    }
};

// ============================================================
// 数字框
// ============================================================

const NumberField = {
    enhance(input) {
        if (input.__nf || input.type !== 'number' || input.hasAttribute('data-native')) return;
        input.__nf = true;
        const wrap = document.createElement('div');
        wrap.className = 'num-field';
        input.parentNode.insertBefore(wrap, input);

        // 面板里的数字只给直接输入的框：不配加减号、拉条，也不响应上下方向键
        wrap.appendChild(input);
        if (input.dataset.unit) {
            const u = document.createElement('span');
            u.className = 'num-unit';
            u.textContent = input.dataset.unit;
            wrap.appendChild(u);
        }
        input.setAttribute('inputmode', this._decimals(input) > 0 ? 'decimal' : 'numeric');

        const num = (attr, d) => { const v = parseFloat(input.getAttribute(attr)); return isNaN(v) ? d : v; };
        const min = () => num('min', -Infinity);
        const max = () => num('max', Infinity);
        const fmt = (v) => String(Number(v.toFixed(this._decimals(input))));
        const clamp = (v) => Math.min(max(), Math.max(min(), v));
        let last = input.value;

        const commit = (value, notify) => {
            input.value = value;
            last = value;
            if (notify) {
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
        };
        const normalize = () => {
            const raw = parseFloat(input.value);
            if (isNaN(raw)) {
                const fallback = last !== '' && !isNaN(parseFloat(last)) ? parseFloat(last) : (min() > -Infinity ? min() : 0);
                commit(fmt(clamp(fallback)), true);
                return;
            }
            const fixed = fmt(clamp(raw));
            if (fixed !== input.value) commit(fixed, true);
            else last = fixed;
        };
        input.addEventListener('beforeinput', (e) => {
            if (e.inputType !== 'insertText' && e.inputType !== 'insertFromPaste') return;
            const text = e.data || '';
            const decimals = this._decimals(input) > 0;
            const allowMinus = min() < 0;
            const re = new RegExp('^[0-9' + (decimals ? '.' : '') + (allowMinus ? '\\-' : '') + ']*$');
            if (!re.test(text)) e.preventDefault();
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') e.preventDefault();
        });
        input.addEventListener('wheel', (e) => { if (document.activeElement === input) e.preventDefault(); }, { passive: false });
        input.addEventListener('blur', normalize);
        input.addEventListener('change', () => { if (input.value === '' || isNaN(parseFloat(input.value))) normalize(); });

        const valueDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        Object.defineProperty(input, 'value', {
            configurable: true,
            get() { return valueDesc.get.call(this); },
            set(v) { valueDesc.set.call(this, v); last = valueDesc.get.call(this); }
        });
    },

    _decimals(input) {
        const s = input.getAttribute('step');
        if (!s || s === 'any') return 0;
        const i = s.indexOf('.');
        return i < 0 ? 0 : s.length - i - 1;
    },

    enhanceAll(root) {
        root.querySelectorAll('input[type="number"]').forEach(i => this.enhance(i));
    }
};

// ============================================================
// 随内容长高的文本框
// ============================================================

const AutoGrow = {
    /** 单个文本框：先清成 auto 再读 scrollHeight（读会强制排版）。成批处理用 fitMany */
    fit(ta) {
        if (!ta.offsetParent && getComputedStyle(ta).position !== 'fixed') return;
        ta.style.height = 'auto';
        ta.style.height = ta.scrollHeight + 2 + 'px';
    },

    /**
     * 成批调整高度：先全部读可见性、全部清成 auto，再统一读 scrollHeight、统一写回。
     * 读写交替会让每个文本框都强制整页排版一次，几千个文本框就是几秒到几分钟。
     */
    fitMany(list) {
        const shown = list.filter(ta => ta.offsetParent || getComputedStyle(ta).position === 'fixed');
        shown.forEach(ta => { ta.style.height = 'auto'; });
        const heights = shown.map(ta => ta.scrollHeight);
        shown.forEach((ta, i) => { ta.style.height = heights[i] + 2 + 'px'; });
    },

    _attach(ta) {
        if (ta.__ag || ta.readOnly || ta.hasAttribute('data-native')) return false;
        ta.__ag = true;
        ta.addEventListener('input', () => this.fit(ta));
        Object.defineProperty(ta, 'value', {
            configurable: true,
            get() { return _textareaValueDesc.get.call(this); },
            set(v) { _textareaValueDesc.set.call(this, v); AutoGrow.fit(this); }
        });
        return true;
    },

    enhance(ta) {
        if (this._attach(ta)) this.fit(ta);
    },

    enhanceAll(root) {
        const fresh = [];
        root.querySelectorAll('textarea').forEach(t => { if (this._attach(t)) fresh.push(t); });
        this.fitMany(fresh);
    },

    /** 容器从隐藏变为可见、窗口宽度变化后重新计算高度 */
    refresh(root) {
        this.fitMany([...(root || document).querySelectorAll('textarea')].filter(t => t.__ag));
    }
};

// ============================================================
// 标签式增删列表
// ============================================================

const TagList = {
    /**
     * 创建标签列表，返回 { el, getValues, setValues }
     * @param {Object} opts - values 初始值；placeholder 输入框提示；onChange 变化回调
     */
    create(opts = {}) {
        let values = Array.isArray(opts.values) ? opts.values.slice() : [];
        const el = document.createElement('div');
        el.className = 'tag-field';
        const list = document.createElement('div');
        list.className = 'tag-list';
        const add = document.createElement('div');
        add.className = 'tag-add';
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = opts.placeholder || '';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-small';
        btn.textContent = I18n.t('添加');
        add.appendChild(input);
        add.appendChild(btn);
        el.appendChild(list);
        el.appendChild(add);

        const emit = () => { if (opts.onChange) opts.onChange(values.slice()); };
        const render = () => {
            list.innerHTML = '';
            list.style.display = values.length ? '' : 'none';
            values.forEach((v, i) => {
                const tag = document.createElement('span');
                tag.className = 'tag';
                const text = document.createElement('span');
                text.className = 'tag-text';
                text.textContent = v;
                const rm = document.createElement('button');
                rm.type = 'button';
                rm.className = 'tag-remove';
                rm.setAttribute('aria-label', I18n.t('删除'));
                rm.textContent = '×';
                rm.addEventListener('click', () => {
                    const removed = values[i];
                    values.splice(i, 1);
                    render();
                    emit();
                    if (window.Toast && Toast.undo) {
                        Toast.undo(I18n.t('已删除'), () => { values.splice(i, 0, removed); render(); emit(); });
                    }
                });
                tag.appendChild(text);
                tag.appendChild(rm);
                list.appendChild(tag);
            });
        };
        const addFromInput = () => {
            const parts = input.value.split(opts.separator || /[,，]/).map(s => s.trim()).filter(Boolean);
            if (!parts.length) return;
            parts.forEach(p => { if (values.indexOf(p) < 0) values.push(p); });
            input.value = '';
            render();
            emit();
        };
        btn.addEventListener('click', addFromInput);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); addFromInput(); }
        });
        render();
        return {
            el,
            getValues: () => values.slice(),
            setValues: (v) => { values = Array.isArray(v) ? v.slice() : []; render(); }
        };
    }
};

// ============================================================
// 接入页面
// ============================================================

const FormControls = {
    ROOT_SELECTORS: ['#page-settings', '#page-game', '#page-debug', '#modal-container'],

    init() {
        this.ROOT_SELECTORS.forEach(sel => {
            const root = document.querySelector(sel);
            if (!root) return;
            this.enhance(root);
            new MutationObserver((records) => {
                records.forEach(r => r.addedNodes.forEach(n => {
                    if (n.nodeType !== 1) return;
                    this.enhance(n);
                }));
            }).observe(root, { childList: true, subtree: true });
        });
        window.addEventListener('resize', () => AutoGrow.refresh(document));
    },

    enhance(node) {
        if (node.tagName === 'SELECT') CustomSelect.enhance(node);
        else if (node.tagName === 'TEXTAREA') AutoGrow.enhance(node);
        else if (node.tagName === 'INPUT' && node.type === 'number') NumberField.enhance(node);
        if (node.querySelectorAll) {
            CustomSelect.enhanceAll(node);
            NumberField.enhanceAll(node);
            AutoGrow.enhanceAll(node);
        }
    }
};

if (typeof window !== 'undefined') {
    window.CustomSelect = CustomSelect;
    window.NumberField = NumberField;
    window.AutoGrow = AutoGrow;
    window.TagList = TagList;
    window.FormControls = FormControls;
}
