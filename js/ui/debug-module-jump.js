/**
 * 模块调试面板 —— 只渲染进现有 #debug-module-jump-placeholder（面板内容，不碰顶部标签/页面布局）。
 * 经典白底黑字灰；左部件区横向滚、右详情固定；队列说明在下方+流程名+已完成按顺序；
 * 变量按类型给控件无spinner；类型用颜色标注；点模块进编辑页（接 ConditionBuilder 真实并且/或者条件）；
 * 插件真实预览；无"信息流通核对"。跳转/完成/未触发用 force（调试强制）。
 */
const DebugModuleJump = {
    _mode: 'detail',

    _selId: null,

    _editType: null,

    init(gameFlow) {
        this.gameFlow = gameFlow;
        this.moduleSystem = gameFlow && gameFlow.moduleSystem;
        this.variableSystem = gameFlow && gameFlow.variableSystem;
        this.timeSystem = gameFlow && gameFlow.timeSystem;
        this.promptGenerator = gameFlow && gameFlow.promptGenerator;
        // 插件系统来自调试桥，插件测试标签据此走真实路径
        this.pluginSystem = gameFlow && gameFlow.pluginSystem;
        this.conditionEvaluator = gameFlow && gameFlow.conditionEvaluator;
        this.modulePath = gameFlow && gameFlow.modulePath;
        this.placeholder = document.getElementById('debug-module-jump-placeholder');
        // 跳转标签自己的临时状态：选中项、折叠、搜索词。与其他标签互不共用。
        this._jumpSel = null;
        this._collapsed = {};
        this._searchKw = '';
        this._treeSig = null;
        this.refresh();
    },

    _esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); },

    _TYC: { trigger_chain: '触发器链', timeline: '时间线', free_trigger: '自由触发器', parallel: '分流程' },

    _STC: { untriggered: '未触发', entered: '已进入', completed: '已完成' },

    // 插件类型的中文名；界面上只显示中文
    _PLTC: { interactive: '交互器', display: '显示器', display_interactive: '显示+交互器', module_generator: '模块生成器', randomizer: '随机器', summary: '总结器', variable_op: '变量操作器', variable_reader: '变量读取器', 'interactive-save': '交互器', 'status-display': '状态面板', 'random-pool': '随机池', 'module-generator': '模块生成器', 'status': '状态' },

    _plTypeCN(t) { return this._PLTC[t] || (t ? t : '插件'); },

    _condOpText(op) {
        const t = { '>=': '≥', '<=': '≤', '>': '>', '<': '<', '==': '＝', '=': '＝', '!=': '≠', '!==': '≠', 'in': '属于' };
        return t[op] || String(op == null ? '' : op);
    },

    _modName(id) {
        const m = this.moduleSystem && this.moduleSystem.getModule(id);
        return m ? (m.name || '未命名') : '未找到的模块';
    },

    _varName(id) {
        const vs = this.variableSystem;
        const v = vs && vs.getVariable ? vs.getVariable(id) : null;
        return v ? (v.name || '未命名变量') : '未找到的变量';
    },

    _varList() {
        const out = []; const vs = this.variableSystem;
        if (vs && vs.variables && vs.variables.forEach) vs.variables.forEach((v, id) => { if (v) out.push({ id, name: v.name || id, type: v.type || 'string' }); });
        return out;
    },

    /** 流程显示名：先找所属模块，再找根模块，最后找任意模块上带名字的同名流程 */
    _flowName(k, mod) {
        const ms = this.moduleSystem;
        const pick = (m) => { const fd = m && m.flows ? m.flows[k] : null; return (fd && fd.name) ? fd.name : ''; };
        let nm = pick(mod);
        if (!nm && ms) {
            nm = pick(ms.getModule(ms.rootModuleId));
            if (!nm && ms.modules && ms.modules.forEach) ms.modules.forEach((m) => { if (!nm) nm = pick(m); });
        }
        if (nm) return nm;
        return k === 'main' ? '主流程' : '未命名分流程';
    },

    _timeText(t) {
        if (!t || typeof t !== 'object') return '';
        return [['year', '年'], ['month', '月'], ['day', '日'], ['hour', '时'], ['minute', '分']]
            .filter(([k]) => t[k] != null && t[k] !== '').map(([k, w]) => t[k] + w).join('');
    },

    _valText(varId, v) {
        const vs = this.variableSystem;
        const def = vs && vs.getVariable ? vs.getVariable(varId) : null;
        if (def && def.type === 'boolean') return (v === true || v === 'true' || v === 1) ? '是' : '否';
        if (v == null || v === '') return '空';
        if (Array.isArray(v)) return v.length ? JSON.stringify(v) : '空';
        if (typeof v === 'object') return Object.keys(v).length ? JSON.stringify(v) : '空';
        return String(v);
    },

    /** 单条条件转成人话；所有条件类型都要覆盖，认不出的明说，不能写成空 */
    _condText(c) {
        if (!c) return '';
        const t = c.type || 'variable';
        const stCN = { entered: '已进入', completed: '已完成', untriggered: '未触发' };
        if (t === 'none') return '';
        if (t === 'variable' || t === 'variable_compare') {
            if (!c.variableId) return '（条件未选择变量）';
            const nm = this._varName(c.variableId);
            const op = this._condOpText(c.operator);
            if (t === 'variable_compare' || c.compareKind === 'variable') return `${nm} ${op} ${this._varName(c.compareVariableId)}`;
            const vs = this.variableSystem;
            const cur = vs && vs.getValue ? vs.getValue(c.variableId) : undefined;
            return `${nm} ${op} ${this._valText(c.variableId, c.value)}（当前 ${this._valText(c.variableId, cur)}）`;
        }
        if (t === 'module') return `${this._modName(c.moduleId)} ${stCN[c.state] || '已进入'}`;
        if (t === 'stage_completed') return `${(Array.isArray(c.pathIds) ? c.pathIds : []).map(id => this._modName(id)).join('、')} 均已完成`;
        if (t === 'event_completed') return `${this._modName(c.eventId)} 已触发`;
        if (t === 'time') {
            const mode = c.mode || c.timeType || 'absolute';
            if (mode === 'relative') {
                const r = c.relative || {};
                const off = [['year', '年'], ['month', '月'], ['day', '日'], ['hour', '时'], ['minute', '分']]
                    .filter(([k]) => r.offset && r.offset[k]).map(([k, w]) => r.offset[k] + w).join('');
                return `${this._modName(r.moduleId)} ${r.state === 'completed' ? '完成' : '进入'}后 ${off || '0 天'}`;
            }
            if (mode === 'variable_compare') return `当前时间${c.operator === '<=' ? '不晚于' : '不早于'} ${this._varName(c.variableId)}`;
            return `当前时间不早于 ${this._timeText(c.time)}`;
        }
        if (t === 'time_range') {
            const rep = c.repeat && c.repeat.interval && typeof c.repeat.interval === 'object' ? Object.keys(c.repeat.interval)[0] : '';
            const repText = ({ year: '每年', month: '每月', day: '每天' })[rep] || '';
            return `${repText ? repText + ' ' : ''}${this._timeText(c.start)} 至 ${this._timeText(c.end)}${c.firstDayOnly ? '（仅首日）' : ''}`;
        }
        if (t === 'tag') return `标签 ${(Array.isArray(c.tags) ? c.tags : []).join('、')} ${c.matchType === 'all' ? '全部' : '任一'}满足`;
        return '（未识别的条件）';
    },

    _describeCond(wrappers) {
        if (!wrappers) return '';
        const arr = Array.isArray(wrappers) ? wrappers : [wrappers];
        const joinOf = (logic, dflt) => (String(logic || dflt).toUpperCase() === 'OR' ? ' 或 ' : ' 且 ');
        const walkGroup = (g, wrap) => {
            const items = (g.items || []).map(it => (it.itemType === 'group' && it.group) ? walkGroup(it.group, true) : this._condText(it.condition)).filter(Boolean);
            if (!items.length) return '';
            const s = items.join(joinOf(g.logic, 'AND'));
            return (wrap && items.length > 1) ? '（' + s + '）' : s;
        };
        const walk = (def) => {
            if (!def || !Array.isArray(def.groups)) return '';
            const multi = def.groups.length > 1;
            return def.groups.map(g => walkGroup(g, multi)).filter(Boolean).join(joinOf(def.logic, 'OR'));
        };
        return arr.map(w => (w && w.conditionDef) ? walk(w.conditionDef) : '').filter(Boolean).join(' 且 ');
    },

    _ph() {
        if (!this.placeholder) this.placeholder = document.getElementById('debug-module-jump-placeholder');
        return this.placeholder;
    },

    _stateOf(m) { return (m && m.state) || 'untriggered'; },

    _hasKids(m) { return !!m && typeof m.isLeaf === 'function' && !m.isLeaf(); },

    _shellHtml() {
        // 宽屏左栏是搜索与模块树，右栏是当前模块、队列与详情，两栏各自滚动；窄屏按 当前、搜索、树、详情 排成一列
        return `<div class="mjx"><div class="mjx-shell">` +
            `<div class="mjx-info" id="mjx-info">` +
            `<div class="mjx-top" id="mjx-top"><div id="mjx-r-current"></div><div id="mjx-r-queue"></div></div>` +
            `<div class="mjx-side" id="mjx-side"></div>` +
            `</div>` +
            `<div class="mjx-toolbar">` +
                `<div class="mjx-searchwrap">` +
                    `<input type="text" class="mjx-fin mjx-search" id="mjx-search" placeholder="搜索模块名称" autocomplete="off" aria-label="搜索模块">` +
                    `<button type="button" class="mjx-searchclear" id="mjx-search-clear" aria-label="清空搜索" hidden>×</button>` +
                `</div>` +
                `<button type="button" class="mjx-b mjx-b-search" id="mjx-search-btn">搜索</button>` +
            `</div>` +
            `<div class="mjx-main">` +
                `<div class="mjx-treewrap" id="mjx-treewrap"><div class="mjx-tree" id="mjx-r-tree"></div>` +
                `<div class="mjx-nomatch" id="mjx-nomatch" hidden>没有匹配的模块。</div></div>` +
            `</div>` +
            `<button type="button" class="mjx-b mjx-b-top" data-act="totop" hidden>回到顶部</button>` +
            `</div></div>`;
    },

    /** 骨架只建一次；showError 等把内容换掉后会重建 */
    _ensureShell(ph) {
        if (ph.querySelector('.mjx-shell')) return;
        ph.innerHTML = this._shellHtml();
        this._treeSig = null;
        const si = ph.querySelector('#mjx-search');
        if (si) si.value = this._searchKw || '';
        const sc = ph.querySelector('#mjx-search-clear');
        if (sc) sc.hidden = !this._searchKw;
    },

    _setHtml(sel, html) {
        const el = this.placeholder.querySelector(sel);
        if (el && el._mjxHtml !== html) { el.innerHTML = html; el._mjxHtml = html; }
    },

    /** 页面真正的滚动容器：最近的可滚动祖先 */
    _scroller() {
        let e = this.placeholder && this.placeholder.parentElement;
        while (e && e !== document.body) {
            const o = getComputedStyle(e).overflowY;
            if (o === 'auto' || o === 'scroll') return e;
            e = e.parentElement;
        }
        return document.scrollingElement || document.documentElement;
    },

    /**
     * 执行 fn（会改变布局），并让 getEl() 取到的元素在屏幕上的位置保持不变。
     * 上方内容变高：外层滚动同步下移；变矮且已滚不动：给顶部区域补一段占位，元素不动。
     */
    _withAnchor(getEl, fn) {
        const sc = this._scroller();
        const el = getEl();
        const before = el ? el.getBoundingClientRect().top : null;
        fn();
        const el2 = before == null ? null : getEl();
        if (!el2 || !sc) return;
        let delta = el2.getBoundingClientRect().top - before;
        if (Math.abs(delta) < 0.5) return;
        sc.scrollTop += delta;
        delta = el2.getBoundingClientRect().top - before;
        if (delta < -0.5) {
            const top = this.placeholder.querySelector('#mjx-top');
            if (top) {
                top.style.minHeight = (top.getBoundingClientRect().height - delta) + 'px';
                sc.scrollTop += el2.getBoundingClientRect().top - before;
            }
        }
    },

    /** 任何会重绘的点击：被点的那个元素在屏幕上的位置不动 */
    _keepAnchor(sel, fn) {
        const ph = this._ph();
        if (!ph) { fn(); return; }
        this._inAnchor = true;
        try { this._withAnchor(() => ph.querySelector(sel), fn); }
        finally { this._inAnchor = false; }
    },

    /** 展开 / 收起的小三角：纯样式绘制，不依赖字体里的符号 */
    _caretHtml(collapsed) { return `<span class="cx-caret" data-c="${collapsed ? '1' : '0'}" aria-hidden="true"></span>`; },

    _setCaret(el, collapsed) {
        const c = el && (el.classList && el.classList.contains('cx-caret') ? el : el.querySelector('.cx-caret'));
        if (c) c.setAttribute('data-c', collapsed ? '1' : '0');
    },

    _cssEsc(v) { return (window.CSS && CSS.escape) ? CSS.escape(v) : String(v).replace(/["\\]/g, '\\$&'); },

    refresh() {
        const ph = this._ph();
        if (!ph) return;
        const ms = this.moduleSystem;
        if (!ms || !ms.rootModuleId) {
            ph.innerHTML = '<div class="mjx"><div class="mjx-empty">尚未加载故事。请先在设置中加载故事。</div></div>';
            return;
        }
        this._ensureShell(ph);
        this._bind();
        if (this._inAnchor) { this._renderAll(); return; }
        // 没有明确被点的元素时，以屏幕里第一个可见的节点为锚
        const vh = window.innerHeight || document.documentElement.clientHeight;
        let key = null;
        const rows = ph.querySelectorAll('.mjx-node[data-nid]');
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i].getBoundingClientRect();
            if (r.bottom > 0 && r.top < vh && r.height > 0) { key = rows[i].getAttribute('data-nid'); break; }
        }
        this._withAnchor(() => (key == null ? null : ph.querySelector(`.mjx-node[data-nid="${this._cssEsc(key)}"]`)), () => this._renderAll());
    },

    _renderAll() {
        const ms = this.moduleSystem;
        const curIds = ms.getCurrentModuleIds ? (ms.getCurrentModuleIds() || []) : [];
        if (!this._jumpSel || !ms.getModule(this._jumpSel)) this._jumpSel = curIds[0] || ms.rootModuleId;
        this._setHtml('#mjx-r-current', this._currentHtml());
        this._setHtml('#mjx-r-queue', this._queueHtml());
        this._renderTree(curIds);
        this._setHtml('#mjx-side', this._detailHtml());
        if (this._searchKw) this._applySearch();
        this._updateTop();
    },

    /** 背景条数多时（日历条目有几千条）详情里一次只显示前面一部分 */
    _JUMP_INFO_PAGE: 20,

    /**
     * 从 info（字符串 / 对象 / 对象数组）稳妥取出正文文本，绝不吐 [object Object]。
     * limit 给出时只取前 limit 条；返回 { text, total, shown }。
     */
    _infoParts(mi, limit) {
        const one = (x) => {
            if (x == null) return '';
            if (typeof x === 'string') return x;
            if (typeof x === 'object') return typeof x.content === 'string' ? x.content : (typeof x.text === 'string' ? x.text : '');
            return String(x);
        };
        if (!Array.isArray(mi)) { const t = one(mi); return { text: t, total: t ? 1 : 0, shown: t ? 1 : 0 }; }
        const part = limit == null ? mi : mi.slice(0, limit);
        return { text: part.map(one).filter(Boolean).join('\n'), total: mi.length, shown: part.length };
    },

    /**
     * 顶部「当前模块」：每个流程一行。主流程始终显示，分流程只在有叶节点当前时出现。
     * 停在父级时只写「模块名（float）」。
     */
    _currentHtml() {
        const ms = this.moduleSystem, esc = this._esc.bind(this);
        const cur = ms.getCurrentModulesForDisplay ? ms.getCurrentModulesForDisplay() : [];
        const rows = cur.map((c) => {
            if (c.isFloating) {
                return `<div class="mjx-cur-row mjx-cur-float"><span class="mjx-cur-nm">${esc(c.moduleName)}（float）</span></div>`;
            }
            const path = ms.getPathToModule ? (ms.getPathToModule(c.moduleId) || []) : [];
            const crumbs = path.slice(1, path.length - 1).map(id => this._modName(id));
            const fname = c.flowName === 'main' ? '主流程' : this._flowName(c.flowName);
            return `<div class="mjx-cur-row"><span class="mjx-cur-flow">${esc(fname)}</span>` +
                `<span class="mjx-cur-nm">${esc(c.moduleName)}</span>` +
                (crumbs.length ? `<span class="mjx-cur-path">${esc(crumbs.join(' / '))}</span>` : '') + `</div>`;
        });
        return `<div class="mjx-cur"><div class="mjx-cur-h">当前模块</div>${rows.join('') || '<div class="mjx-qnone">未进入任何模块</div>'}</div>`;
    },

    /** 五类队列全部列出，不截断：当前 / 预期 / 可能 / 分流程 / 已完成 */
    _queueHtml() {
        const ms = this.moduleSystem, esc = this._esc.bind(this);
        const q = ms.buildQueues ? ms.buildQueues() : null;
        if (!q) return '';
        const seg = (s) => !s ? [] : (Array.isArray(s) ? s : [].concat(s.ordered || [], s.unordered || []));
        const chips = (ids) => ids.length
            ? ids.map(id => `<span class="mjx-qchip">${esc(this._modName(id))}</span>`).join('')
            : '<span class="mjx-qnone">无</span>';
        const blk = (title, ids) =>
            `<div class="mjx-qblk"><div class="mjx-qttl">${esc(title)}</div><div class="mjx-qitems">${chips(ids)}</div></div>`;
        const branches = (Array.isArray(q.branches) ? q.branches : [])
            .map(b => ({ flow: this._flowName(b.flowName || b.flow || ''), ids: seg(b) }))
            .filter(b => b.ids.length);
        const flowsBlk = `<div class="mjx-qblk mjx-qblk-wide"><div class="mjx-qttl">分流程</div>` +
            (branches.length
                ? `<div class="mjx-qflows">` + branches.map(b => `<div class="mjx-qflow"><span class="mjx-qfname">${esc(b.flow)}</span><span class="mjx-qfitems">${chips(b.ids)}</span></div>`).join('') + `</div>`
                : `<div class="mjx-qitems">${chips([])}</div>`) +
            `</div>`;
        const done = Array.isArray(q.completed) ? q.completed : [];
        const doneBlk = `<div class="mjx-qblk mjx-qblk-wide"><div class="mjx-qttl">已完成</div><div class="mjx-qchain">` +
            (done.length ? done.map(id => `<span class="mjx-qdn">${esc(this._modName(id))}</span>`).join('<span class="mjx-arr">→</span>') : '<span class="mjx-qnone">无</span>') +
            `</div></div>`;
        return `<div class="mjx-queue">` +
            blk('当前队列', seg(q.current)) + blk('预期队列', seg(q.expected)) + blk('可能队列', seg(q.possible)) +
            flowsBlk + doneBlk + `</div>`;
    },

    _stateText(st) { return this._STC[st] || this._STC.untriggered; },

    /** 模块树结构签名：名称、类型、流程、父子关系任一变化就变 */
    _treeSignature() {
        const ms = this.moduleSystem;
        const parts = [];
        const walk = (m) => {
            parts.push(m.id + '\u0001' + (m.name || '') + '\u0001' + (m.type || ''));
            if (!m.subModules) return;
            m.subModules.forEach((map, flow) => {
                parts.push('F' + flow + '\u0001' + this._flowName(flow, m));
                map.forEach((c) => walk(c));
            });
        };
        const root = ms.getModule(ms.rootModuleId);
        if (root) walk(root);
        return parts.join('\u0002');
    },

    /** 结构变了才重画整棵树；平时只改徽标、当前、选中三种状态 */
    _renderTree(curIds) {
        const ph = this.placeholder;
        const sig = this._treeSignature();
        if (sig !== this._treeSig) {
            const wrap = ph.querySelector('#mjx-treewrap');
            const st = wrap ? wrap.scrollTop : 0, sl = wrap ? wrap.scrollLeft : 0;
            ph.querySelector('#mjx-r-tree').innerHTML = this._treeHtml(curIds);
            this._treeSig = sig;
            if (wrap) { wrap.scrollTop = st; wrap.scrollLeft = sl; }
        }
        const curSet = new Set(curIds);
        ph.querySelectorAll('.mjx-node[data-nid]').forEach((n) => {
            const id = n.getAttribute('data-nid');
            const m = this.moduleSystem.getModule(id);
            if (!m) return;
            const st = this._stateOf(m);
            if (n.getAttribute('data-st') !== st) {
                n.setAttribute('data-st', st);
                const b = n.querySelector('.mjx-badge');
                if (b) { b.className = 'mjx-badge mjx-badge-' + st; b.textContent = this._stateText(st); }
            }
            n.classList.toggle('is-cur', curSet.has(id));
            n.classList.toggle('is-sel', id === this._jumpSel);
        });
    },

    _treeHtml(curIds) {
        const ms = this.moduleSystem, esc = this._esc.bind(this);
        const curSet = new Set(curIds);
        const root = ms.getModule(ms.rootModuleId);
        if (!root) return '<div class="mjx-empty">该故事暂无模块。</div>';
        const rows = [];
        // 折叠展开只切 data-collapsed 属性，所有子节点始终渲染
        const TYPE_ORDER = ['timeline', 'trigger_chain', 'free_trigger'];
        const col = (k) => !!this._collapsed[k];
        const caret = (k) => this._caretHtml(col(k));
        const flowNames = (mod) => (mod.subModules ? [...mod.subModules.keys()] : [])
            .sort((a, b) => (a === 'main' ? -1 : b === 'main' ? 1 : 0));
        const rowHtml = (s, isRoot) => {
            const st = this._stateOf(s);
            const key = isRoot ? 'F|ROOT|' + s.id : s.id;
            const lead = this._hasKids(s)
                ? `<button type="button" class="mjx-cw mjx-cbtn" data-tgl="${esc(key)}" aria-label="展开或收起">${caret(key)}</button>`
                : `<span class="mjx-cw"></span>`;
            return `<div class="mjx-node${isRoot ? ' mjx-node-root' : ''}${s.id === this._jumpSel ? ' is-sel' : ''}${curSet.has(s.id) ? ' is-cur' : ''}" data-nid="${esc(s.id)}" data-st="${esc(st)}">` +
                lead +
                `<button type="button" class="mjx-nm mjx-nmbtn" data-sel="${esc(s.id)}">${esc(s.name || '未命名')}</button>` +
                `<span class="mjx-badge mjx-badge-${esc(st)}">${esc(this._stateText(st))}</span>` +
                (isRoot ? '' :
                    `<span class="mjx-rowacts">` +
                    `<button type="button" class="mjx-rb mjx-rb-jump" data-rjump="${esc(s.id)}">跳转</button>` +
                    `<button type="button" class="mjx-rb mjx-rb-done" data-rdone="${esc(s.id)}">完成</button>` +
                    `<button type="button" class="mjx-rb mjx-rb-untrig" data-runtrig="${esc(s.id)}">未触发</button>` +
                    `</span>`) +
                `</div>`;
        };
        const node = (s, depth) => {
            rows.push(rowHtml(s, false));
            if (this._hasKids(s)) {
                rows.push(`<div class="mjx-children" data-childof="${esc(s.id)}" data-collapsed="${col(s.id) ? '1' : '0'}">`);
                renderFlows(s, depth + 1, false);
                rows.push(`</div>`);
            }
        };
        const renderTypeGroups = (mod, flowName, depth) => {
            const list = [...(mod.getFlowSubModules(flowName)).values()];
            if (!list.length) return;
            const byType = {};
            list.forEach(m => { (byType[m.type] = byType[m.type] || []).push(m); });
            const types = TYPE_ORDER.filter(t => byType[t]).concat(Object.keys(byType).filter(t => TYPE_ORDER.indexOf(t) < 0));
            types.forEach(t => {
                const tk = 'T|' + mod.id + '|' + flowName + '|' + t;
                rows.push(`<div class="mjx-typegroup mjx-tg-${esc(t)}" style="--d:${Math.min(depth, 8)}">` +
                    `<div class="mjx-typehead" data-col="${esc(tk)}" role="button" tabindex="0"><span class="mjx-cw mjx-cae">${caret(tk)}</span><span class="mjx-th-t">${esc(this._TYC[t] || '其他')}（${byType[t].length}）</span></div>` +
                    `<div class="mjx-typebody" data-childof="${esc(tk)}" data-collapsed="${col(tk) ? '1' : '0'}">`);
                byType[t].forEach(s => node(s, depth));
                rows.push(`</div></div>`);
            });
        };
        const renderFlows = (mod, depth, isRoot) => {
            flowNames(mod).forEach(fn => {
                if (!mod.getFlowSubModules(fn).size) return;
                if (fn === 'main' && !isRoot) { renderTypeGroups(mod, fn, depth); return; }
                const fk = 'F|' + mod.id + '|' + fn;
                const isMain = fn === 'main';
                const head = isMain ? this._flowName('main', mod) : '分流程：' + this._flowName(fn, mod);
                rows.push(`<div class="mjx-flowgroup${isMain ? '' : ' mjx-fg-br'}"><div class="mjx-flowhead${isMain ? '' : ' mjx-flowhead-br'}" data-col="${esc(fk)}" role="button" tabindex="0"><span class="mjx-cae">${caret(fk)}</span> ${esc(head)}</div>` +
                    `<div class="mjx-flowbody" data-childof="${esc(fk)}" data-collapsed="${col(fk) ? '1' : '0'}">`);
                renderTypeGroups(mod, fn, depth);
                rows.push(`</div></div>`);
            });
        };
        const rootKey = 'F|ROOT|' + root.id;
        rows.push(rowHtml(root, true));
        rows.push(`<div class="mjx-root-children" data-childof="${esc(rootKey)}" data-collapsed="${col(rootKey) ? '1' : '0'}">`);
        renderFlows(root, 0, true);
        rows.push(`</div>`);
        return rows.join('');
    },

    _detailHtml() {
        const ms = this.moduleSystem, esc = this._esc.bind(this);
        const m = ms.getModule(this._jumpSel);
        if (!m) return '<div class="mjx-empty">选择一个模块查看详情。</div>';
        const path = ms.getPathToModule ? (ms.getPathToModule(m.id) || []) : [];
        const crumbs = path.slice(1, path.length - 1).map(id => this._modName(id));
        if (this._jumpInfoFor !== m.id) { this._jumpInfoFor = m.id; this._jumpInfoShown = this._JUMP_INFO_PAGE; }
        const infoParts = this._infoParts(m.info, this._jumpInfoShown);
        const info = infoParts.text;
        const infoRest = infoParts.total - infoParts.shown;
        const ent = this._describeCond(m.entryConditions), cmp = this._describeCond(m.completionConditions);
        const st = this._stateOf(m);
        return `<div class="mjx-sin mjx-d2">` +
            `<div class="mjx-d2-head">` +
                `<div class="mjx-d2-title">${esc(m.name || '未命名')}</div>` +
                `<div class="mjx-d2-meta">` +
                    (m.type && this._TYC[m.type] ? `<span class="mjx-ty mjx-ty-${esc(m.type)}">${esc(this._TYC[m.type])}</span>` : '') +
                    `<span class="mjx-stt mjx-stt-${esc(st)}">${esc(this._stateText(st))}</span>` +
                    (crumbs.length ? `<span class="mjx-d2-crumbs">${esc(crumbs.join(' / '))}</span>` : '') +
                `</div>` +
            `</div>` +
            (info ? `<div class="mjx-d2-card"><div class="mjx-d2-label">背景${infoParts.total > 1 ? ' ' + infoParts.total : ''}</div><div class="mjx-d2-text">${esc(info)}</div>` +
                (infoRest > 0 ? `<button type="button" class="mjx-b" data-act="moreinfo">显示更多（还有 ${infoRest} 条）</button>` : '') + `</div>` : '') +
            `<div class="mjx-d2-card mjx-d2-cond">` +
                `<div class="mjx-d2-condrow"><span class="mjx-d2-label">进入</span><span class="mjx-d2-text">${ent ? esc(ent) : '可直接进入'}</span></div>` +
                `<div class="mjx-d2-condrow"><span class="mjx-d2-label">完成</span><span class="mjx-d2-text">${cmp ? esc(cmp) : '无特殊条件'}</span></div>` +
            `</div>` +
            this._detailVarsBlock(m) + this._detailPluginsBlock(m) +
            `<div class="mjx-d2-acts">` +
                `<button type="button" class="mjx-b mjx-b-jump" data-act="jump">跳转</button>` +
                `<button type="button" class="mjx-b mjx-b-done" data-act="complete">完成</button>` +
                `<button type="button" class="mjx-b mjx-b-untrig" data-act="untrig">未触发</button>` +
                `<button type="button" class="mjx-b mjx-b-edit" data-act="edit">在模组编辑中打开</button>` +
            `</div></div>`;
    },

    /** 详情里本模块注册的变量：名称、当前值、类型、可见性 */
    _detailVarsBlock(m) {
        const esc = this._esc.bind(this);
        const vs = this.variableSystem;
        const list = Array.isArray(m.variables) ? m.variables : [];
        if (!list.length) return '';
        const rows = list.map(v => {
            const live = (vs && vs.getVariable) ? vs.getVariable(v.id) : null;
            const val = (vs && vs.getValue && live) ? vs.getValue(v.id) : v.initialValue;
            const tCN = (this._vtCN && this._vtCN[v.type || 'string']) || '其他类型';
            let vis = '';
            if (live && Array.isArray(live.switchConditions) && live.switchConditions.length) {
                if (vs && vs.conditionEvaluator) vis = live.shouldSendToAI(vs.conditionEvaluator) ? '当前可见' : '当前不可见';
                else vis = '可见性暂无法判断';
            }
            return `<div class="mjx-d2-chip">` +
                `<span class="mjx-d2-chipk">${esc(v.name || '未命名变量')}</span>` +
                `<span class="mjx-d2-chipv">${esc(this._valText(v.id, val))}</span>` +
                `<span class="mjx-d2-chipt">${esc(tCN)}${vis ? ' · ' + esc(vis) : ''}</span></div>`;
        }).join('');
        return `<div class="mjx-d2-card"><div class="mjx-d2-label">注册变量 ${list.length}</div><div class="mjx-d2-chips">${rows}</div></div>`;
    },

    /**
     * 节点详情里展示本节点注册的「插件」：名字、类型中文、可见性条件描述（precondition / display / always）。
     * 数据来源：m.plugins（模组定义里的注册数组）；根级也一样列。
     */
    _detailPluginsBlock(m) {
        const esc = this._esc.bind(this);
        const list = Array.isArray(m.plugins) ? m.plugins : [];
        if (!list.length) return '';
        const rows = list.map(p => {
            const t = p.type || '';
            const tCN = (this._PLTC && this._PLTC[t]) || this._plTypeCN(t) || t;
            const cond = p.condition || {};
            let condTag;
            if (!cond || !cond.type || cond.type === 'always') condTag = '始终';
            else if (cond.type === 'precondition') condTag = '满足前置启用';
            else if (cond.type === 'display') condTag = '满足显示启用';
            else condTag = String(cond.type);
            return `<div class="mjx-d2-chip" title="${esc(p.name || p.id)}（${esc(tCN)}，${esc(condTag)}）">` +
                `<span class="mjx-d2-chipk">${esc(p.name || p.id || '未命名')}</span>` +
                `<span class="mjx-d2-chipt">${esc(tCN)} · ${esc(condTag)}</span></div>`;
        }).join('');
        return `<div class="mjx-d2-card"><div class="mjx-d2-label">注册插件 ${list.length}</div><div class="mjx-d2-chips">${rows}</div></div>`;
    },

    _vtCN: { number: '数值', string: '文字', boolean: '开关', list: '列表', object: '对象', list_of_object: '对象列表' },

    /** 模组编辑里「插件」区块的内容：全部由插件编辑器（plugin-editor.js）绘制。 */
    _pluginEditRows(m) {
        return window.PluginEditor ? PluginEditor.html(this, m) : '';
    },

    /** 运算符转人话符号（与 prompt-generator._opSymbol 一致）。 */
    _opSym(op) {
        const m = { '>=': '≥', '<=': '≤', '>': '>', '<': '<', '==': '＝', '=': '＝', '!=': '≠', '!==': '≠' };
        return m[op] || op;
    },

    /** 事件只在容器上挂一次（委托），重绘不会重复绑定 */
    _bind() {
        const ph = this.placeholder;
        if (!ph || ph._mjxBound) return;
        ph._mjxBound = true;
        ph.addEventListener('click', (e) => this._onClick(e));
        ph.addEventListener('keydown', (e) => this._onKeydown(e));
        ph.addEventListener('input', (e) => { if (e.target && e.target.id === 'mjx-search') this._onSearchInput(); });
        // scroll 不冒泡，用捕获接住树容器自己的滚动
        ph.addEventListener('scroll', () => this._updateTop(), true);
    },

    _bindScroller() {
        const sc = this._scroller();
        if (this._scrollEl === sc) return;
        if (this._scrollEl) this._scrollEl.removeEventListener('scroll', this._onScroll);
        this._scrollEl = sc;
        this._onScroll = () => this._updateTop();
        sc.addEventListener('scroll', this._onScroll, { passive: true });
    },

    /** 回到顶部按钮：页面或模块树滚过一屏后才出现 */
    _updateTop() {
        const ph = this.placeholder;
        if (!ph) return;
        if (!this._scrollEl) this._bindScroller();
        const btn = ph.querySelector('.mjx-b-top');
        if (!btn) return;
        const sc = this._scrollEl, tw = ph.querySelector('#mjx-treewrap');
        const far = (sc && sc.scrollTop > sc.clientHeight) || (tw && tw.scrollTop > tw.clientHeight);
        btn.hidden = !far;
    },

    _toTop() {
        const ph = this.placeholder;
        const tw = ph.querySelector('#mjx-treewrap'); if (tw) tw.scrollTop = 0;
        const info = ph.querySelector('#mjx-info'); if (info) info.scrollTop = 0;
        const sc = this._scroller(); if (sc) sc.scrollTop = 0;
        this._updateTop();
    },

    _toggleCollapse(key, caretEl) {
        const next = !this._collapsed[key];
        this._collapsed[key] = next;
        const body = this.placeholder.querySelector(`[data-childof="${this._cssEsc(key)}"]`);
        if (body) body.setAttribute('data-collapsed', next ? '1' : '0');
        this._setCaret(caretEl, next);
    },

    _select(id) {
        if (!id || !this.moduleSystem.getModule(id)) return;
        this._jumpSel = id;
        this.placeholder.querySelectorAll('.mjx-node').forEach(n => n.classList.toggle('is-sel', n.getAttribute('data-nid') === id));
        this._setHtml('#mjx-side', this._detailHtml());
    },

    _rowAction(kind, id) {
        const sel = `.mjx-node[data-nid="${this._cssEsc(id)}"]`;
        const fn = kind === 'jump' ? () => this.jumpToModule(id) : kind === 'done' ? () => this.completeModule(id) : () => this.untriggerModule(id);
        this._keepAnchor(sel, fn);
    },

    _sideAction(kind) {
        const id = this._jumpSel;
        const fn = kind === 'jump' ? () => this.jumpToModule(id) : kind === 'complete' ? () => this.completeModule(id) : () => this.untriggerModule(id);
        this._keepAnchor(`#mjx-side [data-act="${kind}"]`, fn);
    },

    /** 在模组编辑标签里打开当前选中的模块 */
    _openInEditor() {
        this._meSel = this._jumpSel;
        if (window.App && App.switchDebugTab) App.switchDebugTab('module-edit').then(() => { if (this.renderModuleEditTab) this.renderModuleEditTab(); });
        else if (this.renderModuleEditTab) this.renderModuleEditTab();
    },

    _onClick(e) {
        const t = e.target;
        if (!t || !t.closest) return;
        let el;
        if ((el = t.closest('[data-rjump]'))) { this._rowAction('jump', el.getAttribute('data-rjump')); return; }
        if ((el = t.closest('[data-rdone]'))) { this._rowAction('done', el.getAttribute('data-rdone')); return; }
        if ((el = t.closest('[data-runtrig]'))) { this._rowAction('untrig', el.getAttribute('data-runtrig')); return; }
        if ((el = t.closest('[data-tgl]'))) { this._toggleCollapse(el.getAttribute('data-tgl'), el); return; }
        if ((el = t.closest('[data-col]'))) { this._toggleCollapse(el.getAttribute('data-col'), el.querySelector('.mjx-cae')); return; }
        if ((el = t.closest('[data-act]'))) {
            const act = el.getAttribute('data-act');
            if (act === 'jump' || act === 'complete' || act === 'untrig') this._sideAction(act);
            else if (act === 'edit') this._openInEditor();
            else if (act === 'moreinfo') { this._jumpInfoShown += 50; this._setHtml('#mjx-side', this._detailHtml()); }
            else if (act === 'totop') this._toTop();
            return;
        }
        if (t.closest('#mjx-search-clear')) {
            const si = this.placeholder.querySelector('#mjx-search');
            if (si) { si.value = ''; si.focus(); }
            this._onSearchInput();
            return;
        }
        if (t.closest('#mjx-search-btn')) { this._onSearchInput(); return; }
        if ((el = t.closest('.mjx-node[data-nid]'))) this._select(el.getAttribute('data-nid'));
    },

    _onKeydown(e) {
        const t = e.target;
        if (!t || !t.closest) return;
        if (t.id === 'mjx-search' && e.key === 'Enter') { e.preventDefault(); this._onSearchInput(); return; }
        if ((e.key === 'Enter' || e.key === ' ') && t.matches && t.matches('[data-col][role="button"]')) {
            e.preventDefault();
            this._toggleCollapse(t.getAttribute('data-col'), t.querySelector('.mjx-cae'));
        }
    },

    _onSearchInput() {
        const ph = this.placeholder;
        const si = ph.querySelector('#mjx-search'), sc = ph.querySelector('#mjx-search-clear');
        this._searchKw = (si ? si.value : '').trim();
        if (sc) sc.hidden = !(si && si.value);
        this._applySearch();
    },

    /** 按关键词过滤模块树：只切样式类，不重画，不动滚动。命中模块的上级和所在流程一并保留可见。 */
    _applySearch() {
        const ph = this.placeholder; if (!ph) return;
        const tree = ph.querySelector('#mjx-r-tree'); if (!tree) return;
        const kw = (this._searchKw || '').toLowerCase();
        tree.setAttribute('data-searching', kw ? '1' : '0');
        const flows = tree.querySelectorAll('.mjx-flowgroup');
        flows.forEach(fg => {
            const head = ((fg.querySelector('.mjx-flowhead') || {}).textContent || '').toLowerCase();
            fg.classList.toggle('is-flowhit', !!kw && head.indexOf(kw) >= 0);
        });
        const nodes = tree.querySelectorAll('.mjx-node[data-nid]');
        nodes.forEach(n => {
            const nm = ((n.querySelector('.mjx-nm') || {}).textContent || '').toLowerCase();
            n.classList.toggle('is-hit', !!kw && (nm.indexOf(kw) >= 0 || !!n.closest('.mjx-flowgroup.is-flowhit')));
        });
        const hasHit = (el) => !!el.querySelector('.is-hit');
        nodes.forEach(n => {
            const nx = n.nextElementSibling;
            const kids = nx && (nx.classList.contains('mjx-children') || nx.classList.contains('mjx-root-children')) ? nx : null;
            const show = !kw || n.classList.contains('is-hit') || (kids && hasHit(kids));
            n.classList.toggle('is-filtered', !show);
            if (kids) kids.classList.toggle('is-filtered', !!kw && !hasHit(kids));
        });
        tree.querySelectorAll('.mjx-typegroup, .mjx-flowgroup, .mjx-root-children').forEach(g => g.classList.toggle('is-filtered', !!kw && !hasHit(g)));
        const none = ph.querySelector('#mjx-nomatch');
        if (none) none.hidden = !(kw && !tree.querySelector('.is-hit'));
    },

    _toast(msg, type) { if (window.Toast) window.Toast.show(msg, type); },

    /** 核心返回的失败原因转成用户能读懂的提示 */
    _failText(action, err) {
        const e = String(err == null ? '' : err);
        if (/not found/i.test(e)) return `未找到这个模块，${action}没有执行。`;
        return e ? `${action}失败：${e}` : `${action}失败。`;
    },

    /** 执行一次模块操作；抛出的错误提示给用户，同时留在控制台 */
    _perform(label, fn) {
        try { return fn(); }
        catch (e) {
            console.error(e);
            this._toast(`${label}时出现错误：${e.message}`, 'error');
            return null;
        }
    },

    /** 模块状态变了：同步变量和路径到游戏状态，再刷新面板 */
    _afterChange() {
        this._syncVariableSystemToState();
        this._syncPath();
        this.refresh();
    },

    jumpToModule(id) {
        const ms = this.moduleSystem; if (!ms) return;
        this._perform('跳转', () => {
            if (!ms.getModule(id)) { this._toast(this._failText('跳转', 'Module not found'), 'error'); return; }
            const r = ms.jumpToModule(id, { force: true });
            if (!r || !r.success) { this._toast(this._failText('跳转', r && r.error), 'error'); return; }
            this._afterChange();
            this._toast('已跳转', 'success');
        });
    },

    completeModule(id) {
        const ms = this.moduleSystem; if (!ms) return;
        this._perform('完成', () => {
            const m = ms.getModule(id);
            if (!m) { this._toast(this._failText('完成', 'Module not found'), 'error'); return; }
            if (this._stateOf(m) === 'completed') { this._toast('该模块已是已完成。', 'info'); return; }
            const r = ms.completeModule(id, { force: true });
            if (!r || !r.success) { this._toast(this._failText('完成', r && r.error), 'error'); return; }
            this._afterChange();
            this._toast(r.autoEntered ? '已完成，并进入下一个模块' : '已完成', 'success');
        });
    },

    untriggerModule(id) {
        const ms = this.moduleSystem; if (!ms) return;
        this._perform('退回未触发', () => {
            const m = ms.getModule(id);
            if (!m) { this._toast(this._failText('退回未触发', 'Module not found'), 'error'); return; }
            if (this._stateOf(m) === 'untriggered') { this._toast('该模块已是未触发。', 'info'); return; }
            const r = ms.untriggerModule(id);
            if (!r || !r.success) { this._toast(this._failText('退回未触发', r && r.error), 'error'); return; }
            this._afterChange();
            this._toast('已退回未触发', 'success');
        });
    },

    /** 调试操作之后写回游戏状态（实现见 debug-state-sync.js） */
    _syncPath() { this.syncToState(); },

    _syncVariableSystemToState() { this.syncToState(); },

    showError(message) { if (this.placeholder) this.placeholder.innerHTML = `<div class="mjx"><div class="mjx-empty">${this._esc(message)}</div></div>`; }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = DebugModuleJump;
} else if (typeof window !== 'undefined') {
    window.DebugModuleJump = DebugModuleJump;
}
