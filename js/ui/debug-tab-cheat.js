/**
 * 调试页共用输入控件（DebugCtl）与「作弊器」标签。
 * 扩展 DebugModuleJump（debug-module-jump.js 先加载；本文件先于 debug-tab-summary.js 加载）。
 *
 * DebugCtl：只收数字的输入框、随内容长高的文本框、带搜索的下拉、删除后的撤销条。
 * 作弊器：临时改运行中的变量与时间，数据写进变量系统、全局 State，并立即体现在提示词里。
 */
const DebugCtl = (() => {
    const MAX_SAFE = 9007199254740991;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const clone = (v) => (v !== null && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;

    // ---- 提示（同一句话 1.2 秒内不重复弹） ----
    const lastToast = { msg: '', at: 0 };
    const notify = (msg, type) => {
        const now = Date.now();
        if (msg === lastToast.msg && now - lastToast.at < 1200) return;
        lastToast.msg = msg; lastToast.at = now;
        if (window.Toast) window.Toast.show(msg, type || 'error');
    };

    // ---- 只收数字的输入框 ----
    // 元素属性：data-int="1" 只收整数；data-min / data-max 为范围（离开输入框时收回范围内）。
    const FULL = { '０': '0', '１': '1', '２': '2', '３': '3', '４': '4', '５': '5', '６': '6', '７': '7', '８': '8', '９': '9', '．': '.', '。': '.', '－': '-', '−': '-' };
    const normalize = (s) => String(s).replace(/[０-９．。－−]/g, (c) => FULL[c] || c);
    const num = (s) => { if (s == null || s === '') return null; const n = Number(s); return isFinite(n) ? n : null; };

    const numSpec = (el) => {
        const min = num(el.getAttribute('data-min'));
        const max = num(el.getAttribute('data-max'));
        return { int: el.getAttribute('data-int') === '1', min, max, neg: min == null || min < 0 };
    };

    /** 输入中的半成品也算合法（如「-」「3.」），只看字符构成 */
    const partialOk = (v, spec) => {
        if (!(spec.int ? /^-?\d*$/ : /^-?\d*\.?\d*$/).test(v)) return false;
        if (!spec.neg && v.indexOf('-') >= 0) return false;
        return true;
    };

    const resultOf = (el, data) => {
        const v = el.value;
        const s = el.selectionStart == null ? v.length : el.selectionStart;
        const e = el.selectionEnd == null ? v.length : el.selectionEnd;
        return v.slice(0, s) + data + v.slice(e);
    };

    const sanitize = (el) => {
        const spec = numSpec(el);
        const v = el.value;
        let c = normalize(v).replace(/[^\d.\-]/g, '');
        c = c.replace(/(?!^)-/g, '');
        if (!spec.neg) c = c.replace(/-/g, '');
        if (spec.int) c = c.replace(/\./g, '');
        else { const d = c.indexOf('.'); if (d >= 0) c = c.slice(0, d + 1) + c.slice(d + 1).replace(/\./g, ''); }
        if (c !== normalize(v)) notify('这个框只能输入数字。');
        if (c !== v) el.value = c;
    };

    /** 提交时解析：返回 { ok, n, clamped, reason } */
    const parseNum = (raw, spec) => {
        const s = normalize(String(raw == null ? '' : raw)).trim();
        if (s === '') return { ok: false, reason: 'empty' };
        if (!(spec.int ? /^-?\d+$/ : /^-?(\d+\.?\d*|\.\d+)$/).test(s)) return { ok: false, reason: 'invalid' };
        let n = Number(s);
        if (!isFinite(n) || Math.abs(n) > MAX_SAFE) return { ok: false, reason: 'huge' };
        if (n === 0) n = 0;
        let clamped = false;
        if (spec.min != null && n < spec.min) { n = spec.min; clamped = true; }
        if (spec.max != null && n > spec.max) { n = spec.max; clamped = true; }
        return { ok: true, n, clamped };
    };

    const rangeText = (spec) => {
        if (spec.min != null && spec.max != null) return `${spec.min}～${spec.max}`;
        if (spec.min != null) return `最小 ${spec.min}`;
        if (spec.max != null) return `最大 ${spec.max}`;
        return '';
    };

    /** 数字框的失败提示语：原因 + 结果 */
    const numMessage = (label, r, spec, prevText, finalN) => {
        const pre = label ? label + '：' : '';
        const back = prevText === '' || prevText == null ? '已恢复原值。' : `已恢复为 ${prevText}。`;
        if (!r.ok) {
            if (r.reason === 'empty') return `${pre}数值不能为空，${back}`;
            if (r.reason === 'huge') return `${pre}数值过大，${back}`;
            return `${pre}不是有效数字，${back}`;
        }
        if (r.clamped) return `${pre}超出范围，已改为 ${finalN}（${rangeText(spec)}）。`;
        return '';
    };

    /**
     * 在 root 上挂「只收数字」的委托守卫：选择器匹配的输入框，键盘、粘贴、输入法、拖放里的非数字一律进不去。
     */
    const bindNumeric = (root, selector) => {
        const hit = (e) => (e.target && e.target.matches && e.target.matches(selector)) ? e.target : null;
        root.addEventListener('keydown', (e) => {
            const el = hit(e); if (!el) return;
            if (e.isComposing || e.keyCode === 229) return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            if (e.key === 'Enter') { e.preventDefault(); el.blur(); return; }
            if (!e.key || e.key.length !== 1) return;
            const ch = normalize(e.key);
            const spec = numSpec(el);
            if (!/^[\d.\-]$/.test(ch) || !partialOk(normalize(resultOf(el, ch)), spec)) {
                e.preventDefault();
                notify('这个框只能输入数字。');
            }
        });
        root.addEventListener('beforeinput', (e) => {
            const el = hit(e); if (!el) return;
            if (e.isComposing || e.inputType === 'insertCompositionText') return;
            if (!e.inputType || e.inputType.indexOf('insert') !== 0) return;
            let data = e.data;
            if (data == null && e.dataTransfer) data = e.dataTransfer.getData('text');
            if (data == null) return;
            if (!partialOk(normalize(resultOf(el, data)), numSpec(el))) {
                e.preventDefault();
                notify('这个框只能输入数字。');
            }
        });
        root.addEventListener('paste', (e) => {
            const el = hit(e); if (!el) return;
            const cd = e.clipboardData || window.clipboardData;
            const txt = cd ? cd.getData('text') : '';
            if (txt && !partialOk(normalize(resultOf(el, txt)), numSpec(el))) {
                e.preventDefault();
                notify('粘贴的内容不是数字。');
            }
        });
        root.addEventListener('drop', (e) => {
            const el = hit(e); if (!el) return;
            const txt = e.dataTransfer ? e.dataTransfer.getData('text') : '';
            if (txt && !partialOk(normalize(resultOf(el, txt)), numSpec(el))) {
                e.preventDefault();
                notify('拖入的内容不是数字。');
            }
        });
        root.addEventListener('input', (e) => {
            const el = hit(e); if (!el) return;
            if (e.isComposing) return;
            sanitize(el);
        });
        root.addEventListener('compositionend', (e) => {
            const el = hit(e); if (!el) return;
            sanitize(el);
        });
    };

    // ---- 随内容长高的文本框 ----
    const fit = (el) => {
        el.style.height = 'auto';
        const h = el.scrollHeight;
        if (h > 0) el.style.height = (h + 2) + 'px';
    };
    const fitAll = (root) => { AutoGrow.fitMany([...root.querySelectorAll('textarea.cx-grow')]); };
    const bindGrow = (root) => {
        root.addEventListener('input', (e) => { if (e.target && e.target.matches && e.target.matches('textarea.cx-grow')) fit(e.target); });
    };

    // ---- 带搜索的下拉（选项多时用；点触发按钮再点一次收起） ----
    // 结构：.cx-pick[data-pick] > button.cx-pick-btn + .cx-pick-pop[hidden] > input.cx-pick-q + .cx-pick-list > button.cx-pick-opt[data-v]
    const pickHtml = (opts) => {
        // opts: { key, value, options:[{value,label}], placeholder, emptyLabel }
        const list = opts.options || [];
        const cur = list.filter((o) => String(o.value) === String(opts.value))[0];
        const label = cur ? cur.label : (opts.emptyLabel || '请选择');
        return `<div class="cx-pick" data-pick="${esc(opts.key || '')}" data-value="${esc(opts.value == null ? '' : opts.value)}">` +
            `<button type="button" class="cx-pick-btn${cur ? '' : ' cx-pick-none'}" aria-haspopup="listbox" aria-expanded="false"><span class="cx-pick-label">${esc(label)}</span><span class="cx-caret" aria-hidden="true"></span></button>` +
            `<div class="cx-pick-pop" hidden><input type="text" class="cx-in cx-pick-q" placeholder="搜索" aria-label="搜索选项">` +
            `<div class="cx-pick-list" role="listbox">` +
            (list.length ? list.map((o) => `<button type="button" role="option" class="cx-pick-opt${String(o.value) === String(opts.value) ? ' on' : ''}" data-v="${esc(o.value)}">${esc(o.label)}</button>`).join('') : '<div class="cx-pick-empty">没有可选项。</div>') +
            `<div class="cx-pick-empty cx-pick-nomatch" hidden>没有匹配的选项。</div></div></div></div>`;
    };

    const closePicks = (except) => {
        document.querySelectorAll('.cx-pick.open').forEach((p) => {
            if (p === except) return;
            p.classList.remove('open');
            const pop = p.querySelector('.cx-pick-pop'); if (pop) pop.hidden = true;
            const b = p.querySelector('.cx-pick-btn'); if (b) b.setAttribute('aria-expanded', 'false');
        });
    };

    const filterPick = (pick, kw) => {
        const k = kw.trim().toLowerCase();
        let n = 0;
        pick.querySelectorAll('.cx-pick-opt').forEach((o) => {
            const show = !k || o.textContent.toLowerCase().indexOf(k) >= 0;
            o.hidden = !show; if (show) n++;
        });
        const nm = pick.querySelector('.cx-pick-nomatch'); if (nm) nm.hidden = n > 0;
    };

    /** 选中后在 root 上触发 cx-pick 事件：detail = { key, value, label, pick } */
    const bindPick = (root) => {
        root.addEventListener('click', (e) => {
            const btn = e.target.closest ? e.target.closest('.cx-pick-btn') : null;
            if (btn && root.contains(btn)) {
                const pick = btn.closest('.cx-pick');
                const willOpen = !pick.classList.contains('open');
                closePicks(willOpen ? pick : null);
                if (!willOpen) { pick.classList.remove('open'); pick.querySelector('.cx-pick-pop').hidden = true; btn.setAttribute('aria-expanded', 'false'); return; }
                pick.classList.add('open');
                pick.querySelector('.cx-pick-pop').hidden = false;
                btn.setAttribute('aria-expanded', 'true');
                const q = pick.querySelector('.cx-pick-q'); q.value = ''; filterPick(pick, '');
                q.focus();
                return;
            }
            const opt = e.target.closest ? e.target.closest('.cx-pick-opt') : null;
            if (opt && root.contains(opt)) {
                const pick = opt.closest('.cx-pick');
                const value = opt.getAttribute('data-v');
                pick.setAttribute('data-value', value);
                pick.querySelector('.cx-pick-label').textContent = opt.textContent;
                pick.querySelector('.cx-pick-btn').classList.remove('cx-pick-none');
                pick.querySelectorAll('.cx-pick-opt').forEach((o) => o.classList.toggle('on', o === opt));
                closePicks(null);
                root.dispatchEvent(new CustomEvent('cx-pick', { bubbles: true, detail: { key: pick.getAttribute('data-pick'), value, label: opt.textContent, pick } }));
            }
        });
        root.addEventListener('input', (e) => {
            if (e.target && e.target.matches && e.target.matches('.cx-pick-q')) filterPick(e.target.closest('.cx-pick'), e.target.value);
        });
    };

    let docBound = false;
    const bindDocOnce = () => {
        if (docBound) return; docBound = true;
        document.addEventListener('mousedown', (e) => { if (!e.target.closest || !e.target.closest('.cx-pick')) closePicks(null); }, true);
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePicks(null); });
    };
    bindDocOnce();

    // ---- 删除后的撤销条 ----
    let undoEl = null, undoFn = null, undoTimer = null;
    const undoHide = () => {
        if (undoTimer) { clearTimeout(undoTimer); undoTimer = null; }
        undoFn = null;
        if (undoEl) undoEl.hidden = true;
    };
    const undoShow = (text, fn) => {
        if (!undoEl) {
            undoEl = document.createElement('div');
            undoEl.id = 'cx-undo';
            undoEl.className = 'cx-undo';
            undoEl.setAttribute('role', 'status');
            undoEl.innerHTML = '<div class="cx-undo-in"><span class="cx-undo-msg"></span><button type="button" class="cx-undo-btn">撤销</button></div>';
            document.body.appendChild(undoEl);
            undoEl.querySelector('.cx-undo-btn').addEventListener('click', () => { const f = undoFn; undoHide(); if (f) f(); });
        }
        undoEl.querySelector('.cx-undo-msg').textContent = text;
        undoFn = fn;
        undoEl.hidden = false;
        if (undoTimer) clearTimeout(undoTimer);
        undoTimer = setTimeout(undoHide, 10000);
    };

    /** 局部替换一个元素并保持它在屏幕上的位置不动 */
    const scroller = (el) => {
        let e = el && el.parentElement;
        while (e && e !== document.body) {
            const o = getComputedStyle(e).overflowY;
            if ((o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight) return e;
            e = e.parentElement;
        }
        return document.scrollingElement || document.documentElement;
    };
    const replaceKeepingPlace = (oldEl, html) => {
        const sc = scroller(oldEl);
        const before = oldEl.getBoundingClientRect().top;
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        const next = tmp.firstElementChild;
        oldEl.replaceWith(next);
        fitAll(next);
        const after = next.getBoundingClientRect().top;
        if (sc && after !== before) sc.scrollTop += (after - before);
        return next;
    };

    return {
        esc, clone, notify, normalize, numSpec, parseNum, rangeText, numMessage,
        bindNumeric, fit, fitAll, bindGrow, pickHtml, bindPick, closePicks,
        undo: { show: undoShow, hide: undoHide },
        scroller, replaceKeepingPlace
    };
})();
window.DebugCtl = DebugCtl;

// ================= 作弊器标签 =================
Object.assign(DebugModuleJump, {
    _CHT_TYPE_CN: { number: '数值', string: '文字', boolean: '开关', list: '列表', object: '对象', list_of_object: '对象列表' },

    _CHT_CHIPS: [['string', '文字'], ['number', '数值'], ['boolean', '是否'], ['list', '列表'], ['object', '对象']],

    _cht() {
        if (!this._chtState) this._chtState = { collapsed: {}, q: '', promptOpen: false, cache: {}, bound: null, listOpen: {} };
        return this._chtState;
    },

    /** 作弊器标签：临时改运行中的变量与时间 */
    renderCheatTab() {
        const panel = document.getElementById('debug-panel-cheat');
        const box = (panel && panel.querySelector('.cheat-tool')) || panel;
        if (!box) return;
        DebugCtl.undo.hide();
        DebugCtl.closePicks(null);
        const ms = this.moduleSystem;
        if (!ms || !ms.rootModuleId) {
            box.innerHTML = '<div class="cx"><div class="cx-empty">尚未加载故事。</div></div>';
            return;
        }
        const st = this._cht();
        st.cache = {};
        const curIds = (ms.getCurrentModuleIds ? (ms.getCurrentModuleIds() || []) : []);
        box.innerHTML = `<div class="cx dbg-cols" id="mjx-cheat">` +
            `<div class="dbg-col">` + this._chtToolbarHtml() + this._varsHtml() + `</div>` +
            `<div class="dbg-col">` + this._timeHtml() + this._promptHtml(curIds) + `</div>` +
            `</div>`;
        this._chtBind(box);
        DebugCtl.fitAll(box);
        this._chtApplyFilter();
    },

    _chtBind(box) {
        const st = this._cht();
        if (st.bound === box) return;
        st.bound = box;
        DebugCtl.bindNumeric(box, 'input.cx-num');
        DebugCtl.bindGrow(box);
        DebugCtl.bindPick(box);
        box.addEventListener('click', (e) => this._chtOnClick(e));
        box.addEventListener('change', (e) => this._chtOnChange(e));
        box.addEventListener('input', (e) => {
            if (e.target && e.target.matches && e.target.matches('.cx-search')) { this._cht().q = e.target.value; this._chtApplyFilter(); }
        });
        box.addEventListener('keydown', (e) => {
            if (e.target && e.target.matches && e.target.matches('.cx-search') && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
        });
        box.addEventListener('cx-pick', (e) => this._chtOnPick(e));
    },

    // ---------- 顶部工具条 ----------
    _chtToolbarHtml() {
        const st = this._cht();
        return `<div class="cx-sec cx-tools">` +
            `<div class="cx-searchwrap"><input type="text" class="cx-in cx-search" placeholder="搜索变量" aria-label="搜索变量" value="${DebugCtl.esc(st.q)}">` +
            `<button type="button" class="cx-clear" data-act="searchclear" aria-label="清空搜索" hidden>×</button></div>` +
            `<div class="cx-toolbtns"><button type="button" class="cx-btn is-ghost" data-act="expandall">全部展开</button>` +
            `<button type="button" class="cx-btn is-ghost" data-act="collapseall">全部折叠</button></div>` +
            `<div class="cx-status" aria-live="polite"></div></div>`;
    },

    _chtApplyFilter() {
        const box = this._cht().bound; if (!box) return;
        const root = box.querySelector('#mjx-cheat'); if (!root) return;
        const kw = this._cht().q.trim().toLowerCase();
        const vars = root.querySelector('.cx-vars');
        if (vars) { if (kw) vars.setAttribute('data-q', '1'); else vars.removeAttribute('data-q'); }
        let shown = 0, total = 0;
        root.querySelectorAll('.cx-row[data-vid]').forEach((r) => {
            total++;
            const hit = !kw || (r.getAttribute('data-k') || '').indexOf(kw) >= 0;
            r.classList.toggle('cx-hide', !hit);
            if (hit) shown++;
        });
        root.querySelectorAll('.cx-group').forEach((g) => {
            const any = g.querySelector('.cx-row[data-vid]:not(.cx-hide)');
            g.classList.toggle('cx-hide', !any);
        });
        const clear = root.querySelector('.cx-clear'); if (clear) clear.hidden = !kw;
        const status = root.querySelector('.cx-status');
        if (status) status.textContent = kw ? (shown ? `匹配 ${shown} / ${total} 项` : '没有匹配的变量。') : '';
    },

    // ---------- 时间 ----------
    _CHT_TIME: [['year', '年'], ['month', '月'], ['day', '日'], ['hour', '时'], ['minute', '分']],

    /** 时间系统里能改的字段：键 → 参数 id */
    _chtTimeParams() {
        const ts = this.timeSystem; const out = {};
        if (!ts || !ts.parameters) return out;
        ts.parameters.forEach((p) => { if (p.type === 'base' && !p.calculationOnly && p.systemBinding && !out[p.systemBinding]) out[p.systemBinding] = p.id; });
        return out;
    },

    /** 各时间字段的取值范围：按模组的进位单位（每月几天等） */
    _chtTimeBounds(key) {
        const u = this.timeSystem.getUnits();
        if (key === 'year') return { min: 1, max: 99999 };
        if (key === 'month') return { min: 1, max: u.mpy };
        if (key === 'day') return { min: 1, max: u.dpm };
        if (key === 'hour') return { min: 0, max: u.hpd - 1 };
        return { min: 0, max: u.mph - 1 };
    },

    _timeHtml() {
        const ts = this.timeSystem; const e = DebugCtl.esc;
        const tv = (ts && ts.getCurrentTime) ? (ts.getCurrentTime() || {}) : {};
        const params = this._chtTimeParams();
        const t = { year: Number(tv.year) || 1, month: Number(tv.month) || 1, day: Number(tv.day) || 1, hour: Number(tv.hour) || 0, minute: Number(tv.minute) || 0 };
        const boxes = this._CHT_TIME.filter(([k]) => params[k]).map(([k, lab]) => {
            const b = this._chtTimeBounds(k);
            return `<label class="cx-tu"><span class="cx-tl">${lab}</span>` +
                `<input type="text" inputmode="numeric" class="cx-in cx-num cx-time" data-time="${k}" data-int="1" data-min="${b.min}" data-max="${b.max}" data-prev="${t[k]}" data-label="${lab}" value="${t[k]}"></label>`;
        }).join('');
        return `<div class="cx-sec cx-timesec"><div class="cx-sttl">当前时间</div>` +
            (boxes ? `<div class="cx-time">${boxes}</div>` : '<div class="cx-muted">当前故事的时间不可修改。</div>') + `</div>`;
    },

    /** 把一组时间值写进时间系统；校验范围、重算队列、同步 State */
    _chtApplyTime(srcEl) {
        const ts = this.timeSystem; const box = this._cht().bound;
        if (!ts || !box) return;
        const params = this._chtTimeParams();
        const cur = ts.getCurrentTime();
        const t = { year: cur.year, month: cur.month, day: cur.day, hour: cur.hour, minute: cur.minute };
        const msgs = [];
        const els = {};
        box.querySelectorAll('.cx-time').forEach((el) => { els[el.getAttribute('data-time')] = el; });
        const key0 = srcEl ? srcEl.getAttribute('data-time') : null;
        // 先处理被改的那个框，再按新的年月校正日
        const order = this._CHT_TIME.map(([k]) => k);
        const sorted = key0 ? [key0].concat(order.filter((k) => k !== key0)) : order;
        sorted.forEach((k) => {
            const el = els[k]; if (!el) return;
            const b = this._chtTimeBounds(k);
            el.setAttribute('data-min', b.min); el.setAttribute('data-max', b.max);
            const spec = DebugCtl.numSpec(el);
            const r = DebugCtl.parseNum(el.value, spec);
            if (!r.ok) {
                if (k === key0) msgs.push(DebugCtl.numMessage(el.getAttribute('data-label'), r, spec, el.getAttribute('data-prev')));
                el.value = String(t[k]);
                return;
            }
            if (r.clamped) msgs.push(DebugCtl.numMessage(el.getAttribute('data-label'), r, spec, '', r.n));
            t[k] = r.n;
        });
        msgs.filter(Boolean).forEach((m) => DebugCtl.notify(m, 'error'));
        const changes = {};
        Object.keys(params).forEach((k) => { if (t[k] !== cur[k]) changes[params[k]] = t[k]; });
        if (Object.keys(changes).length) {
            try {
                ts.advanceTime(changes);
                this._chtAfterWrite();
                DebugCtl.notify('已更新当前时间。', 'success');
            } catch (err) {
                console.error(err);
                DebugCtl.notify('时间没有写入：' + err.message, 'error');
            }
        }
        // 把框刷成最终值，并更新各框范围
        this._chtRefreshTimeBoxes();
    },

    _chtRefreshTimeBoxes() {
        const box = this._cht().bound; if (!box) return;
        const tv = this.timeSystem.getCurrentTime();
        const t = { year: tv.year, month: tv.month, day: tv.day, hour: tv.hour, minute: tv.minute };
        box.querySelectorAll('.cx-time').forEach((el) => {
            const k = el.getAttribute('data-time');
            const b = this._chtTimeBounds(k);
            el.setAttribute('data-min', b.min); el.setAttribute('data-max', b.max);
            el.value = String(t[k]); el.setAttribute('data-prev', String(t[k]));
        });
    },

    // ---------- 变量定义 ----------
    _chtRawDef(v) {
        const ms = this.moduleSystem;
        const mod = ms && v.ownerModuleId ? ms.getModule(v.ownerModuleId) : null;
        return (mod && Array.isArray(mod.variables)) ? (mod.variables.filter((x) => x && x.id === v.id)[0] || null) : null;
    },

    /**
     * 字段定义统一成 [{ key, label, type, elementType, min, max, integer, def, fields }]。
     * schema=true 是 objectSchema（id 是键、name 是显示名）；否则是 fields（name 既是键也是显示名）。
     */
    _chtNormFields(fields, schema) {
        const num0 = (x) => (x == null || x === '' || !isFinite(Number(x)) ? null : Number(x));
        const one = (f) => {
            if (f == null) return null;
            if (typeof f === 'string') { const k = f.trim(); return k ? { key: k, label: k, type: 'string' } : null; }
            if (typeof f !== 'object') return null;
            const rawKey = schema ? (f.id != null && f.id !== '' ? f.id : (f.key != null ? f.key : f.name)) : (f.name != null && f.name !== '' ? f.name : f.key);
            const key = rawKey == null ? '' : String(rawKey).trim();
            if (!key) return null;
            const label = schema ? (f.name || key) : (f.label || key);
            const sub = Array.isArray(f.objectSchema) ? this._chtNormFields(f.objectSchema, true) : (Array.isArray(f.fields) ? this._chtNormFields(f.fields, false) : null);
            return { key, label, type: f.type || 'string', elementType: f.listItemType || f.elementType || null, min: num0(f.min), max: num0(f.max), integer: f.integer === true, def: f.default !== undefined ? f.default : f.defaultValue, fields: sub };
        };
        return (Array.isArray(fields) ? fields : []).map(one).filter(Boolean);
    },

    /** 变量的完整定义（运行时变量 + 模组原始定义里的取值范围、字段） */
    _chtDef(id, v) {
        const raw = this._chtRawDef(v) || {};
        const fieldsFromRaw = Array.isArray(raw.fields) && raw.fields.length ? this._chtNormFields(raw.fields, false) : null;
        const schemaSrc = (Array.isArray(raw.objectSchema) && raw.objectSchema.length) ? raw.objectSchema : (Array.isArray(v.objectSchema) && v.objectSchema.length ? v.objectSchema : null);
        let fields = fieldsFromRaw || (schemaSrc ? this._chtNormFields(schemaSrc, true) : null);
        if (!fields && typeof v.getFields === 'function') {
            const own = v.getFields();
            if (Array.isArray(own) && own.length) fields = this._chtNormFields(own, false);
        }
        const n = (x) => (x == null || x === '' || !isFinite(Number(x)) ? null : Number(x));
        const cat = v.category || '';
        const computed = cat === 'builtin' || v.computed === true || (Array.isArray(v.computeConditions) && v.computeConditions.length > 0);
        return {
            id, name: v.name || '未命名变量', type: v.type || raw.type || 'string', category: cat,
            readonly: v.readonly === true || raw.readonly === true || computed,
            min: n(raw.min != null ? raw.min : v.min), max: n(raw.max != null ? raw.max : v.max),
            integer: raw.integer === true, maxLength: n(raw.maxLength), unit: raw.unit || '',
            elementType: raw.elementType || raw.listItemType || v.listItemType || null,
            fields
        };
    },

    _chtDefault(type, fields, elementType) {
        if (type === 'number') return 0;
        if (type === 'boolean') return false;
        if (type === 'list' || type === 'list_of_object') return [];
        if (type === 'object') {
            const o = {};
            (fields || []).forEach((f) => { o[f.key] = f.def !== undefined && f.def !== '' && f.def !== null ? this._chtCoerceDefault(f) : this._chtDefault(f.type, f.fields, f.elementType); });
            return o;
        }
        return '';
    },

    _chtCoerceDefault(f) {
        if (f.type === 'number') { const n = Number(f.def); return isFinite(n) ? n : 0; }
        if (f.type === 'boolean') return f.def === true || f.def === 'true';
        return f.def;
    },

    _chtInfer(val) {
        if (typeof val === 'number') return 'number';
        if (typeof val === 'boolean') return 'boolean';
        if (Array.isArray(val)) return 'list';
        if (val && typeof val === 'object') return 'object';
        return 'string';
    },

    // ---------- 变量树 ----------
    _varsHtml() {
        const vs = this.variableSystem, ms = this.moduleSystem; const e = DebugCtl.esc;
        const st = this._cht();
        const grouped = new Map();
        if (vs && vs.variables && vs.variables.forEach) vs.variables.forEach((v, id) => {
            if (!v) return;
            const owner = v.ownerModuleId || ms.rootModuleId;
            if (!grouped.has(owner)) grouped.set(owner, []);
            grouped.get(owner).push({ id, v });
        });
        const used = new Set();
        const rowHtml = (id, v) => { const h = this._chtRowHtml(id, v); st.cache[id] = h; return h; };
        const walk = (moduleId, depth) => {
            const mod = ms.getModule(moduleId);
            const own = grouped.get(moduleId) || [];
            used.add(moduleId);
            let kids = '';
            if (mod && mod.getAllSubModules) [...mod.getAllSubModules()].forEach((c) => { kids += walk(c.id, depth + 1); });
            if (!own.length && !kids) return '';
            const total = own.length + (kids.match(/data-vid=/g) || []).length;
            const key = 'g|' + moduleId;
            const collapsed = !!st.collapsed[key];
            return `<section class="cx-group" data-g="${e(key)}" data-collapsed="${collapsed ? '1' : '0'}">` +
                `<button type="button" class="cx-gh" data-act="gtoggle" aria-expanded="${collapsed ? 'false' : 'true'}"><span class="cx-caret" aria-hidden="true"></span>` +
                `<span class="cx-gname">${e(mod ? (mod.name || '未命名模块') : '未命名模块')}</span><span class="cx-count">${total}</span></button>` +
                `<div class="cx-gbody">${own.map(({ id, v }) => rowHtml(id, v)).join('')}${kids}</div></section>`;
        };
        let html = walk(ms.rootModuleId, 0);
        // 不在模块树里的变量
        const rest = [];
        grouped.forEach((list, owner) => { if (!used.has(owner)) list.forEach((x) => rest.push(x)); });
        if (rest.length) {
            const key = 'g|__rest';
            const collapsed = !!st.collapsed[key];
            html += `<section class="cx-group" data-g="${key}" data-collapsed="${collapsed ? '1' : '0'}">` +
                `<button type="button" class="cx-gh" data-act="gtoggle" aria-expanded="${collapsed ? 'false' : 'true'}"><span class="cx-caret" aria-hidden="true"></span><span class="cx-gname">其他变量</span><span class="cx-count">${rest.length}</span></button>` +
                `<div class="cx-gbody">${rest.map(({ id, v }) => rowHtml(id, v)).join('')}</div></section>`;
        }
        return `<div class="cx-sec cx-varsec"><div class="cx-sttl">当前变量</div>` +
            `<div class="cx-vars">${html || '<div class="cx-muted">当前没有变量。</div>'}</div></div>`;
    },

    _chtFmtRO(val) {
        if (val === undefined || val === null || val === '') return '—';
        if (typeof val === 'object') return JSON.stringify(val);
        if (typeof val === 'boolean') return val ? '是' : '否';
        return String(val);
    },

    /** 单个变量行 */
    _chtRowHtml(id, v) {
        const e = DebugCtl.esc;
        const def = this._chtDef(id, v);
        const vs = this.variableSystem;
        const val = vs.getValue(id);
        const ownerMod = this.moduleSystem.getModule(v.ownerModuleId);
        const typeCN = this._CHT_TYPE_CN[def.type] || def.type;
        const keys = [def.name, typeCN, ownerMod ? ownerMod.name : ''].join(' ').toLowerCase();
        const head = `<div class="cx-rhead"><span class="cx-vn">${e(def.name)}</span><span class="cx-vt">${e(typeCN)}</span>${def.readonly ? '<span class="cx-ro">只读</span>' : ''}</div>`;
        const body = def.readonly ? `<div class="cx-rovalue">${e(this._chtFmtRO(val))}</div>` : this._chtEditor(def, val, [id], def.name);
        const parts = [];
        if (!def.readonly && v.changeRules && v.changeRules.length) parts.push('可用规则：' + v.changeRules.map((r) => r.name).filter(Boolean).join('、'));
        if (v.computeConditions && v.computeConditions.length) {
            const d = v.computeConditions.map((c) => { const t = c.conditionDef ? this._describeDef(c.conditionDef) : ''; return t ? `${t} → ${c.formula || ''}` : (c.formula || ''); }).filter(Boolean).join('；');
            if (d && !def.readonly) parts.push('自动计算：' + d);
        }
        if (v.switchConditions && v.switchConditions.length) parts.push('可见性条件：' + this._describeSwitchConds(v.switchConditions));
        const meta = parts.length ? `<div class="cx-meta">${e(parts.join('｜'))}</div>` : '';
        return `<div class="cx-row" data-vid="${e(id)}" data-k="${e(keys)}">${head}<div class="cx-rbody">${body}</div>${meta}</div>`;
    },

    // ---------- 值编辑器（按类型递归） ----------
    /**
     * spec：{ type, elementType, fields, min, max, integer, maxLength, unit }
     * path：从变量 id 开始的取值路径（写进 data-p）
     */
    _chtEditor(spec, val, path, label) {
        const e = DebugCtl.esc; const p = e(JSON.stringify(path)); const lab = e(label || '');
        const t = spec.type;
        if (t === 'number') {
            const s = { int: spec.integer, min: spec.min, max: spec.max };
            const shown = (typeof val === 'number' && isFinite(val)) ? String(val) : '';
            const range = DebugCtl.rangeText(s);
            return `<div class="cx-numwrap"><input type="text" inputmode="${spec.integer ? 'numeric' : 'decimal'}" class="cx-in cx-num cx-val" data-p="${p}" data-label="${lab}" data-prev="${e(shown)}"` +
                `${spec.integer ? ' data-int="1"' : ''}${spec.min != null ? ` data-min="${spec.min}"` : ''}${spec.max != null ? ` data-max="${spec.max}"` : ''} value="${e(shown)}" aria-label="${lab}">` +
                (spec.unit ? `<span class="cx-unit">${e(spec.unit)}</span>` : '') + (range ? `<span class="cx-range">${e(range)}</span>` : '') + `</div>`;
        }
        if (t === 'boolean') {
            const on = val === true || val === 'true' || val === 1;
            return `<div class="cx-seg" role="radiogroup" aria-label="${lab}">` +
                `<button type="button" role="radio" aria-checked="${on}" class="cx-segb${on ? ' on' : ''}" data-act="boolset" data-p="${p}" data-bool="1">是</button>` +
                `<button type="button" role="radio" aria-checked="${!on}" class="cx-segb${on ? '' : ' on'}" data-act="boolset" data-p="${p}" data-bool="0">否</button></div>`;
        }
        if (t === 'list' || t === 'list_of_object') return this._chtListEditor(spec, val, path, label);
        if (t === 'object') return this._chtObjectEditor(spec, val, path, label);
        return `<textarea class="cx-in cx-grow cx-val" rows="1" data-p="${p}" data-label="${lab}"${spec.maxLength != null ? ` maxlength="${spec.maxLength}"` : ''} aria-label="${lab}">${e(val == null ? '' : val)}</textarea>`;
    },

    /** 列表超过这个条数时先只显示前面这些，其余点「显示其余」再展开（几百项的列表一次渲染会卡住页面） */
    _CHT_LIST_SHOW: 20,

    _chtListEditor(spec, val, path, label) {
        const e = DebugCtl.esc; const p = e(JSON.stringify(path));
        const list = Array.isArray(val) ? val : [];
        let et = spec.type === 'list_of_object' ? 'object' : (spec.elementType || null);
        if (et === 'list_of_object') et = 'object';
        const known = !!et;
        const st = this._cht();
        const open = list.length <= this._CHT_LIST_SHOW || !!st.listOpen[JSON.stringify(path)];
        const items = (open ? list : list.slice(0, this._CHT_LIST_SHOW)).map((item, i) => {
            const itype = known ? et : this._chtInfer(item);
            const ispec = { type: itype, fields: spec.fields, min: spec.min, max: spec.max, integer: spec.integer, elementType: null };
            const ipath = path.concat([i]);
            return `<div class="cx-li"><span class="cx-idx">${i + 1}</span><div class="cx-lival">${this._chtEditor(ispec, item, ipath, `${label || ''} ${i + 1}`)}</div>` +
                `<button type="button" class="cx-btn cx-del" data-act="ldel" data-p="${e(JSON.stringify(ipath))}">删除</button></div>`;
        }).join('');
        const more = open ? '' : `<button type="button" class="cx-btn is-ghost cx-more" data-act="lmore" data-p="${p}">显示其余 ${list.length - this._CHT_LIST_SHOW} 项</button>`;
        let add;
        if (known) add = `<button type="button" class="cx-btn cx-add" data-act="ladd" data-p="${p}" data-et="${e(et)}">添加一项</button>`;
        else add = `<div class="cx-addrow" data-p="${p}"><div class="cx-chips" role="radiogroup" aria-label="新增项类型">` +
            this._CHT_CHIPS.filter((c) => c[0] !== 'list').map((c, i) => `<button type="button" role="radio" aria-checked="${i === 0}" class="cx-chip${i === 0 ? ' on' : ''}" data-act="chip" data-t="${c[0]}">${c[1]}</button>`).join('') +
            `</div><button type="button" class="cx-btn cx-add" data-act="ladd" data-p="${p}">添加一项</button></div>`;
        return `<div class="cx-list">${items || '<div class="cx-muted cx-emptyline">空</div>'}${more}${add}</div>`;
    },

    _chtObjectEditor(spec, val, path, label) {
        const e = DebugCtl.esc; const p = e(JSON.stringify(path));
        const obj = (val && typeof val === 'object' && !Array.isArray(val)) ? val : {};
        const fields = spec.fields && spec.fields.length ? spec.fields : null;
        const known = new Set();
        let rows = '';
        if (fields) fields.forEach((f) => {
            known.add(f.key);
            const has = Object.prototype.hasOwnProperty.call(obj, f.key);
            const fv = has ? obj[f.key] : this._chtDefault(f.type, f.fields, f.elementType);
            const fspec = { type: f.type, elementType: f.elementType, fields: f.fields, min: f.min, max: f.max, integer: f.integer };
            rows += `<div class="cx-kv"><span class="cx-k">${e(f.label)}</span><div class="cx-kvv">${this._chtEditor(fspec, fv, path.concat([f.key]), f.label)}</div></div>`;
        });
        Object.keys(obj).forEach((k) => {
            if (known.has(k)) return;
            const itype = this._chtInfer(obj[k]);
            rows += `<div class="cx-kv"><span class="cx-k">${e(k)}</span><div class="cx-kvv">${this._chtEditor({ type: itype }, obj[k], path.concat([k]), k)}</div>` +
                `<button type="button" class="cx-btn cx-del" data-act="odel" data-p="${e(JSON.stringify(path.concat([k])))}">删除</button></div>`;
        });
        const add = fields ? '' : `<div class="cx-addrow cx-addfield" data-p="${p}">` +
            `<input type="text" class="cx-in cx-newkey" placeholder="字段名" aria-label="新字段名">` +
            `<div class="cx-chips" role="radiogroup" aria-label="新字段类型">` +
            this._CHT_CHIPS.map((c, i) => `<button type="button" role="radio" aria-checked="${i === 0}" class="cx-chip${i === 0 ? ' on' : ''}" data-act="chip" data-t="${c[0]}">${c[1]}</button>`).join('') +
            `</div><button type="button" class="cx-btn cx-add" data-act="oadd" data-p="${p}">添加字段</button></div>`;
        return `<div class="cx-obj">${rows || (fields ? '' : '<div class="cx-muted cx-emptyline">空</div>')}${add}</div>`;
    },

    // ---------- 事件 ----------
    _chtOnClick(e) {
        const t = e.target.closest ? e.target.closest('[data-act]') : null;
        const box = this._cht().bound;
        if (!t || !box || !box.contains(t)) return;
        const act = t.getAttribute('data-act');
        if (act === 'gtoggle') {
            const g = t.closest('.cx-group'); const key = g.getAttribute('data-g');
            const next = g.getAttribute('data-collapsed') !== '1';
            this._cht().collapsed[key] = next;
            g.setAttribute('data-collapsed', next ? '1' : '0');
            t.setAttribute('aria-expanded', next ? 'false' : 'true');
            if (!next) DebugCtl.fitAll(g);
        } else if (act === 'expandall' || act === 'collapseall') {
            const collapse = act === 'collapseall';
            box.querySelectorAll('.cx-group').forEach((g) => {
                this._cht().collapsed[g.getAttribute('data-g')] = collapse;
                g.setAttribute('data-collapsed', collapse ? '1' : '0');
                const h = g.querySelector('.cx-gh'); if (h) h.setAttribute('aria-expanded', collapse ? 'false' : 'true');
            });
            if (!collapse) DebugCtl.fitAll(box);
        } else if (act === 'searchclear') {
            const si = box.querySelector('.cx-search'); if (si) { si.value = ''; si.focus(); }
            this._cht().q = ''; this._chtApplyFilter();
        } else if (act === 'ptoggle') {
            const sec = t.closest('.cx-promptsec'); const open = sec.getAttribute('data-open') !== '1';
            this._cht().promptOpen = open; sec.setAttribute('data-open', open ? '1' : '0');
            t.setAttribute('aria-expanded', open ? 'true' : 'false');
        } else if (act === 'openprompt') {
            if (window.App && App.switchDebugTab) App.switchDebugTab('prompt');
        } else if (act === 'boolset') {
            this._chtWritePath(JSON.parse(t.getAttribute('data-p')), t.getAttribute('data-bool') === '1');
        } else if (act === 'chip') {
            const wrap = t.closest('.cx-chips');
            wrap.querySelectorAll('.cx-chip').forEach((c) => { const on = c === t; c.classList.toggle('on', on); c.setAttribute('aria-checked', on ? 'true' : 'false'); });
        } else if (act === 'lmore') {
            const path = JSON.parse(t.getAttribute('data-p'));
            this._cht().listOpen[JSON.stringify(path)] = true;
            this._chtInvalidateRow(path[0]);
        } else if (act === 'ladd') {
            this._chtListAdd(t);
        } else if (act === 'ldel') {
            this._chtDeleteAt(JSON.parse(t.getAttribute('data-p')), 'list');
        } else if (act === 'oadd') {
            this._chtObjAdd(t);
        } else if (act === 'odel') {
            this._chtDeleteAt(JSON.parse(t.getAttribute('data-p')), 'object');
        }
    },

    _chtOnChange(e) {
        const el = e.target;
        if (!el || !el.matches) return;
        if (el.matches('input.cx-time')) { this._chtApplyTime(el); return; }
        if (el.matches('input.cx-num[data-p]')) { this._chtOnNumber(el); return; }
        if (el.matches('textarea.cx-val[data-p]')) { this._chtWritePath(JSON.parse(el.getAttribute('data-p')), el.value); }
    },

    _chtOnNumber(el) {
        const path = JSON.parse(el.getAttribute('data-p'));
        const spec = DebugCtl.numSpec(el);
        const prev = el.getAttribute('data-prev');
        const label = el.getAttribute('data-label') || '';
        const r = DebugCtl.parseNum(el.value, spec);
        if (!r.ok) {
            DebugCtl.notify(DebugCtl.numMessage(label, r, spec, prev), 'error');
            el.value = prev == null ? '' : prev;
            return;
        }
        if (r.clamped) DebugCtl.notify(DebugCtl.numMessage(label, r, spec, prev, r.n), 'error');
        el.value = String(r.n);
        if (String(r.n) === prev) return;
        this._chtWritePath(path, r.n);
    },

    _chtOnPick() { /* 作弊器没有带搜索的下拉 */ },

    // ---------- 写入 ----------
    /** 按路径改一处，整个变量一次写回 */
    _chtWritePath(path, value, opts) {
        const vs = this.variableSystem; const id = path[0];
        const v = vs.getVariable(id);
        if (!v) { DebugCtl.notify('这个变量已不存在。', 'error'); return false; }
        let next;
        if (path.length === 1) next = value;
        else {
            const cur = vs.getValue(id);
            const def = this._chtDef(id, v);
            next = DebugCtl.clone(cur == null ? this._chtDefault(def.type === 'list_of_object' ? 'list' : def.type) : cur);
            let node = next;
            for (let i = 1; i < path.length - 1; i++) {
                if (node[path[i]] == null || typeof node[path[i]] !== 'object') node[path[i]] = typeof path[i + 1] === 'number' ? [] : {};
                node = node[path[i]];
            }
            const last = path[path.length - 1];
            if (opts && opts.splice) node.splice(last, 1);
            else if (opts && opts.remove) delete node[last];
            else node[last] = value;
        }
        return this._chtCommit(id, next);
    },

    _chtCommit(id, next) {
        const vs = this.variableSystem; const v = vs.getVariable(id);
        const name = v.name || '变量';
        if (v.readonly || v.category === 'builtin') { DebugCtl.notify(`「${name}」是只读变量，没有写入。`, 'error'); this._chtInvalidateRow(id); return false; }
        if (typeof v.validateValue === 'function' && !v.validateValue(next)) {
            DebugCtl.notify(`「${name}」是${this._CHT_TYPE_CN[v.type] || v.type}类型，这个值的类型不符，没有写入。`, 'error');
            this._chtInvalidateRow(id);
            return false;
        }
        let ok;
        vs.lastError = null; vs.lastAdjust = null;
        try { ok = vs.executeOperation(id, 'set', { value: next }); }
        catch (err) { console.error(err); DebugCtl.notify(`「${name}」写入出错：${err.message}`, 'error'); this._chtInvalidateRow(id); return false; }
        if (ok === false) {
            DebugCtl.notify(vs.lastError ? `「${name}」没有写入：${vs.lastError}` : `「${name}」没有写入，已保留原值。`, 'error');
            this._chtInvalidateRow(id);
            return false;
        }
        if (vs.lastAdjust) DebugCtl.notify(String(vs.lastAdjust), 'error');
        try { this._chtAfterWrite(); }
        catch (err) { console.error(err); DebugCtl.notify('写入后刷新出错：' + err.message, 'error'); return false; }
        DebugCtl.notify(`已更新「${name}」。`, 'success');
        return true;
    },

    /** 写入之后：重算内置变量与队列，同步到全局状态，刷新界面里变了的部分 */
    _chtAfterWrite() {
        const vs = this.variableSystem, ms = this.moduleSystem;
        if (vs && vs.updateBuiltinVariables) vs.updateBuiltinVariables();
        if (ms && ms.buildQueues) ms.buildQueues();
        if (typeof this._syncVariableSystemToState !== 'function') throw new Error('变量同步入口不存在');
        this._syncVariableSystemToState();
        this._chtPatchRows();
        this._chtRefreshPrompt();
    },

    _chtInvalidateRow(id) {
        const st = this._cht(); st.cache[id] = null;
        this._chtPatchRows();
    },

    /** 只替换内容变了的变量行；正在输入的行不动 */
    _chtPatchRows() {
        const box = this._cht().bound; const vs = this.variableSystem; const st = this._cht();
        if (!box) return;
        box.querySelectorAll('.cx-row[data-vid]').forEach((row) => {
            const id = row.getAttribute('data-vid');
            const v = vs.getVariable(id);
            if (!v) return;
            const html = this._chtRowHtml(id, v);
            if (st.cache[id] === html) return;
            const ae = document.activeElement;
            const inRow = !!ae && row.contains(ae);
            // 正在输入文字的行保持原样，等输入完成再刷新
            if (inRow && ae.matches('input, textarea') && st.cache[id] !== null) return;
            st.cache[id] = html;
            const focusKey = inRow ? { act: ae.getAttribute('data-act'), p: ae.getAttribute('data-p'), bool: ae.getAttribute('data-bool') } : null;
            const next = DebugCtl.replaceKeepingPlace(row, html);
            if (st.q) next.classList.toggle('cx-hide', (next.getAttribute('data-k') || '').indexOf(st.q.trim().toLowerCase()) < 0);
            if (focusKey && focusKey.act) {
                const again = [].slice.call(next.querySelectorAll('[data-act]')).filter((x) => x.getAttribute('data-act') === focusKey.act && x.getAttribute('data-p') === focusKey.p && x.getAttribute('data-bool') === focusKey.bool)[0];
                if (again) again.focus();
            }
        });
    },

    _chtListAdd(btn) {
        const path = JSON.parse(btn.getAttribute('data-p'));
        const vs = this.variableSystem; const v = vs.getVariable(path[0]);
        const def = this._chtDef(path[0], v);
        let et = btn.getAttribute('data-et');
        if (!et) {
            const row = btn.closest('.cx-addrow'); const chip = row && row.querySelector('.cx-chip.on');
            et = chip ? chip.getAttribute('data-t') : 'string';
        }
        // 目标节点的定义：根变量用变量自己的字段，嵌套处按路径往下找
        const holder = this._chtLookupSpec(def, path);
        const item = this._chtDefault(et, holder && holder.fields ? holder.fields : def.fields, null);
        const cur = vs.getValue(path[0]);
        const base = DebugCtl.clone(cur == null ? this._chtDefault('list') : cur);
        let node = base;
        for (let i = 1; i < path.length; i++) node = node[path[i]];
        if (!Array.isArray(node)) { DebugCtl.notify('这个位置不是列表，没有添加。', 'error'); return; }
        node.push(item);
        this._cht().listOpen[JSON.stringify(path)] = true;
        this._chtCommit(path[0], base);
    },

    /** 沿路径找到某个位置的字段定义（找不到返回根定义的一部分或 null） */
    _chtLookupSpec(def, path) {
        let spec = def;
        for (let i = 1; i < path.length; i++) {
            if (!spec) return null;
            if (typeof path[i] === 'number') continue;
            const f = (spec.fields || []).filter((x) => x.key === path[i])[0];
            spec = f || null;
        }
        return spec;
    },

    _chtObjAdd(btn) {
        const row = btn.closest('.cx-addrow');
        const path = JSON.parse(btn.getAttribute('data-p'));
        const keyEl = row.querySelector('.cx-newkey');
        const key = keyEl ? keyEl.value.trim() : '';
        if (!key) { DebugCtl.notify('请先填写字段名。', 'error'); if (keyEl) keyEl.focus(); return; }
        const chip = row.querySelector('.cx-chip.on');
        const type = chip ? chip.getAttribute('data-t') : 'string';
        const vs = this.variableSystem;
        const cur = vs.getValue(path[0]);
        const base = DebugCtl.clone(cur == null ? this._chtDefault('object') : cur);
        let node = base;
        for (let i = 1; i < path.length; i++) node = node[path[i]];
        if (!node || typeof node !== 'object' || Array.isArray(node)) { DebugCtl.notify('这个位置不是对象，没有添加。', 'error'); return; }
        if (Object.prototype.hasOwnProperty.call(node, key)) { DebugCtl.notify(`已有名为「${key}」的字段。`, 'error'); return; }
        node[key] = this._chtDefault(type);
        this._chtCommit(path[0], base);
    },

    /** 删除列表项或对象字段，并给出撤销 */
    _chtDeleteAt(path, kind) {
        const vs = this.variableSystem; const id = path[0];
        const v = vs.getVariable(id); if (!v) return;
        const before = DebugCtl.clone(vs.getValue(id));
        const ok = this._chtWritePath(path, null, kind === 'list' ? { splice: true } : { remove: true });
        if (!ok) return;
        DebugCtl.undo.show(`已删除${kind === 'list' ? '一项' : '一个字段'}。`, () => { this._chtCommit(id, before); });
    },

    // ---------- 提示词 ----------
    _chtPromptText() {
        // 与真实发送同一份组装（读取游戏状态，调试页的改动已写回状态）
        try { return DebugViewer.buildFullPrompt(App.wireWithSources(App.buildNextPromptPreview())); }
        catch (err) { console.error(err); return '提示词生成失败：' + err.message; }
    },

    _promptHtml() {
        const open = this._cht().promptOpen;
        const text = this._chtPromptText();
        return `<div class="cx-sec cx-promptsec" data-open="${open ? '1' : '0'}">` +
            `<div class="cx-sttl cx-sttl-row"><button type="button" class="cx-gh cx-ph" data-act="ptoggle" aria-expanded="${open ? 'true' : 'false'}"><span class="cx-caret" aria-hidden="true"></span><span class="cx-gname">当前提示词</span></button>` +
            `<button type="button" class="cx-btn" data-act="openprompt">打开提示词查看器</button></div>` +
            `<pre class="cx-pre">${DebugCtl.esc(text || '（无内容）')}</pre></div>`;
    },

    _chtRefreshPrompt() {
        const box = this._cht().bound; if (!box) return;
        const pre = box.querySelector('.cx-promptsec .cx-pre'); if (!pre) return;
        pre.textContent = this._chtPromptText() || '（无内容）';
    },

    // ---------- 描述（作弊器行与插件测试标签共用） ----------
    /** 把变量条件描述成一句话 */
    _describeDef(def) {
        if (!def || !Array.isArray(def.groups)) return '';
        const vs = this.variableSystem;
        const walkGroup = (g) => {
            const items = (g.items || []).map((it) => {
                if (it.itemType === 'group' && it.group) return walkGroup(it.group);
                const c = it.condition;
                if (!c || c.type !== 'variable' || !c.variableId) return '';
                const v = vs && vs.getVariable ? vs.getVariable(c.variableId) : null;
                const vName = (v && v.name) ? v.name : '变量';
                return `${vName} ${this._opSym(c.operator)} ${c.value}`;
            }).filter(Boolean);
            const join = (g.logic === 'OR') ? ' 或 ' : ' 且 ';
            return items.length > 1 ? `(${items.join(join)})` : items.join(join);
        };
        return def.groups.map(walkGroup).filter(Boolean).join(def.logic === 'OR' ? ' 或 ' : ' 且 ');
    },

    _describeSwitchConds(sw) {
        return sw.map((s) => {
            const d = s.conditionDef ? this._describeDef(s.conditionDef) : '';
            const tag = s.type === 'display' ? '展示' : (s.type === 'trigger' ? '生效' : (s.type || ''));
            return d ? `${tag ? tag + '时' : ''}${d}` : '';
        }).filter(Boolean).join('；');
    }
});
