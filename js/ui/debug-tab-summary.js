/**
 * 调试页「总结」标签：总结设置、全局总结、模块记忆树、伏笔、投递、插件总结。
 * 扩展 DebugModuleJump（依赖 debug-tab-cheat.js 里的 DebugCtl，须在它之后加载）。
 *
 * 数据直接读写 DebugModuleJump.promptGenerator.summarySystem；每次修改后把整份总结写进全局状态的
 * summaries 字段，保证存档与真实运行读到同一份。
 */
Object.assign(DebugModuleJump, {
    _SM_TYPE_ORDER: ['timeline', 'trigger_chain', 'free_trigger'],
    _SM_TYPE_CN: { timeline: '时间线', trigger_chain: '触发器链', free_trigger: '自由触发器' },
    _SM_OPS: [['>=', '≥'], ['<=', '≤'], ['==', '＝'], ['!=', '≠'], ['>', '>'], ['<', '<']],
    _SM_TIME_PARAMS: [['year', '年'], ['month', '月'], ['day', '日'], ['hour', '时'], ['minute', '分']],

    /** 设置项：path 是 summarySystem.config 里的位置 */
    _SM_CFG: [
        { title: '全局总结', rows: [
            { path: 'globalSummary.enabled', label: '启用全局总结', kind: 'bool' },
            { path: 'globalSummary.keepRecentOriginalMessages', label: '发送最近原文', kind: 'num', unit: '条', min: 0, max: 1000 },
            { path: 'globalSummary.keepRecentSingleSummaries', label: '发送最近单条总结', kind: 'num', unit: '条', min: 0, max: 1000 },
            { path: 'globalSummary.compressSummariesEvery', label: '每隔多少条单条总结合并为大总结', kind: 'num', unit: '条', min: 1, max: 1000 },
            { path: 'globalSummary.autoHideOlder', label: '合并后清除已合并的单条总结', kind: 'bool' }
        ] },
        { title: '操作记录', rows: [
            { path: 'operationSummary.enabled', label: '记录操作', kind: 'bool' },
            { path: 'operationSummary.displayInPrompt', label: '发送操作记录', kind: 'bool' },
            { path: 'operationSummary.recentInteractionCount', label: '发送最近几轮的操作', kind: 'num', unit: '轮', min: 0, max: 1000 }
        ] }
    ],

    _sm() {
        if (!this._smState) this._smState = { sel: null, collapsed: {}, bound: null };
        return this._smState;
    },

    _smSS() { return this.promptGenerator && this.promptGenerator.summarySystem; },

    // ---------- 与全局状态同步 ----------
    /** 全局状态里已有同格式的总结时，以它为准载入（只在状态里的对象换了以后载入一次） */
    _smAdopt(ss) {
        if (typeof State === 'undefined') return;
        const s = State.summaries;
        if (!s || Array.isArray(s) || typeof s !== 'object') return;
        if (ss.__stateRef === s) return;
        if (!('singleSummaries' in s || 'moduleSummaries' in s || 'conditionalDeliveries' in s)) return;
        ss.importState(s);
        ss.__stateRef = s;
    },

    /** 把整份总结写进全局状态；状态里是别的格式时不覆盖，并明确提示 */
    _smSync() {
        const ss = this._smSS();
        if (!ss || typeof State === 'undefined') return;
        const s = State.summaries;
        const sameShape = s && !Array.isArray(s) && typeof s === 'object' && ('singleSummaries' in s || 'moduleSummaries' in s || 'conditionalDeliveries' in s);
        if (s && !Array.isArray(s) && !sameShape && Object.keys(s).length) {
            DebugCtl.notify('存档里的总结格式与当前不同，这次修改没有写进存档。', 'error');
            return;
        }
        State.summaries = ss.exportState();
        ss.__stateRef = State.summaries;
    },

    _smSaved() { DebugCtl.notify('已保存。', 'success'); },

    // ---------- 入口 ----------
    renderSummaryTab() {
        const panel = document.getElementById('debug-panel-summary');
        const box = (panel && panel.querySelector('.summary-manager')) || panel;
        if (!box) return;
        DebugCtl.undo.hide();
        DebugCtl.closePicks(null);
        const ss = this._smSS(), ms = this.moduleSystem;
        if (!ss || !ms || !ms.rootModuleId) { box.innerHTML = '<div class="sm cx"><div class="cx-empty">尚未加载故事。</div></div>'; return; }
        this._smAdopt(ss);
        const cfg = ss.config = ss.config || {};
        cfg.globalSummary = cfg.globalSummary || {};
        cfg.operationSummary = cfg.operationSummary || {};
        const st = this._sm();
        if (!st.sel || !ms.getModule(st.sel)) st.sel = ms.rootModuleId;
        box.innerHTML = `<div class="sm dbg-cols" id="mjx-sum">` +
            `<div class="dbg-col">` +
            `<div class="cx-sec" id="sm-sec-settings">${this._smSettingsHtml(ss)}</div>` +
            `<div class="cx-sec" id="sm-sec-global">${this._smGlobalHtml(ss)}</div>` +
            `<div class="cx-sec" id="sm-sec-fs">${this._smForeshadowHtml(ss)}</div>` +
            `</div><div class="dbg-col">` +
            `<div class="cx-sec" id="sm-sec-modules">${this._smModulesHtml(ms, ss)}</div>` +
            `<div class="cx-sec" id="sm-sec-dl">${this._smDeliveryHtml(ms, ss)}</div>` +
            `<div class="cx-sec" id="sm-sec-plugins">${this._smPluginsHtml(ss)}</div>` +
            `</div></div>`;
        this._smBind(box);
        DebugCtl.fitAll(box);
    },

    _smBind(box) {
        const st = this._sm();
        if (st.bound === box) return;
        st.bound = box;
        DebugCtl.bindNumeric(box, 'input.cx-num');
        DebugCtl.bindGrow(box);
        DebugCtl.bindPick(box);
        box.addEventListener('click', (e) => this._smOnClick(e));
        box.addEventListener('change', (e) => this._smOnChange(e));
        box.addEventListener('cx-pick', (e) => this._smOnPick(e));
    },

    /** 只替换一个区块，并保持它在屏幕上的位置 */
    _smReplace(id) {
        const box = this._sm().bound; if (!box) return;
        const el = box.querySelector('#' + id); if (!el) return;
        const ss = this._smSS(), ms = this.moduleSystem;
        const map = {
            'sm-sec-settings': () => this._smSettingsHtml(ss),
            'sm-sec-global': () => this._smGlobalHtml(ss),
            'sm-sec-modules': () => this._smModulesHtml(ms, ss),
            'sm-sec-fs': () => this._smForeshadowHtml(ss),
            'sm-sec-dl': () => this._smDeliveryHtml(ms, ss),
            'sm-sec-plugins': () => this._smPluginsHtml(ss)
        };
        DebugCtl.replaceKeepingPlace(el, `<div class="cx-sec" id="${id}">${map[id]()}</div>`);
    },

    // ---------- 总结设置 ----------
    _smCfgGet(path) {
        let o = this._smSS().config;
        for (const k of path.split('.')) { if (o == null) return undefined; o = o[k]; }
        return o;
    },

    _smCfgSet(path, v) {
        const parts = path.split('.'); let o = this._smSS().config;
        for (let i = 0; i < parts.length - 1; i++) { if (!o[parts[i]] || typeof o[parts[i]] !== 'object') o[parts[i]] = {}; o = o[parts[i]]; }
        o[parts[parts.length - 1]] = v;
    },

    _smBoolHtml(on, attrs, label) {
        return `<div class="cx-seg" role="radiogroup" aria-label="${DebugCtl.esc(label || '')}">` +
            `<button type="button" role="radio" aria-checked="${on}" class="cx-segb${on ? ' on' : ''}" ${attrs} data-bool="1">是</button>` +
            `<button type="button" role="radio" aria-checked="${!on}" class="cx-segb${on ? '' : ' on'}" ${attrs} data-bool="0">否</button></div>`;
    },

    _smNumHtml(val, attrs, opts) {
        const e = DebugCtl.esc; const o = opts || {};
        const shown = (val == null || val === '') ? '' : String(val);
        return `<div class="cx-numwrap"><input type="text" inputmode="numeric" class="cx-in cx-num" ${attrs} data-int="1"` +
            `${o.min != null ? ` data-min="${o.min}"` : ''}${o.max != null ? ` data-max="${o.max}"` : ''} data-prev="${e(shown)}" data-label="${e(o.label || '')}" value="${e(shown)}" aria-label="${e(o.label || '')}">` +
            `${o.unit ? `<span class="cx-unit">${e(o.unit)}</span>` : ''}</div>`;
    },

    _smSettingsHtml(ss) {
        const e = DebugCtl.esc;
        const blocks = this._SM_CFG.map((g) => {
            const rows = g.rows.map((r) => {
                const v = this._smCfgGet(r.path);
                const ctl = r.kind === 'bool'
                    ? this._smBoolHtml(v === true, `data-act="cfgbool" data-cfg="${e(r.path)}"`, r.label)
                    : this._smNumHtml(v, `data-cfg="${e(r.path)}"`, { min: r.min, max: r.max, unit: r.unit, label: r.label });
                return `<div class="sm-cfgrow"><span class="sm-cfglab">${e(r.label)}</span><div class="sm-cfgctl">${ctl}</div></div>`;
            }).join('');
            return `<div class="sm-cfggroup"><div class="sm-sub">${e(g.title)}</div>${rows}</div>`;
        }).join('');
        const action = `<div class="sm-actions"><button type="button" class="cx-btn is-accent" data-act="compressnow">立即整理总结</button><span class="sm-status" id="sm-compress-status" aria-live="polite"></span></div>`;
        return `<div class="cx-sttl">总结设置</div>${blocks}${action}`;
    },

    /** 手动整理：把已滑出对话窗口的单条总结现在就并成一条大总结（需要先配好并连上 AI） */
    async _smCompressNow(btn) {
        const status = document.getElementById('sm-compress-status');
        const before = this._smSS().megaSummaries.length;
        btn.disabled = true;
        if (status) status.textContent = '正在整理，请稍等。';
        let done = false;
        try { done = await App.compressSummariesNow(); }
        finally { btn.disabled = false; }
        const ss = this._smSS();
        ss.__stateRef = null;
        this._smAdopt(ss);
        this._smReplace('sm-sec-global');
        const st = document.getElementById('sm-compress-status');
        if (st) st.textContent = done ? `已整理，现在有 ${ss.megaSummaries.length} 条大总结。` : (ss.megaSummaries.length > before ? '' : '没有整理。');
    },

    // ---------- 全局总结 ----------
    _smItemText(x) {
        if (typeof x === 'string') return x;
        if (x && typeof x === 'object') return typeof x.content === 'string' ? x.content : '';
        return '';
    },

    _smGlobalHtml(ss) {
        const e = DebugCtl.esc; const st = this._sm();
        const cats = [
            { cat: 'single', title: '单条总结', arr: ss.singleSummaries, add: true },
            { cat: 'mega', title: '大总结', arr: ss.megaSummaries, add: true },
            { cat: 'orig', title: '原始消息', arr: ss.originalMessages, add: true, role: true },
            { cat: 'pluginc', title: '插件总结条目', arr: ss.pluginSummaryContents, add: true }
        ];
        const block = (c) => {
            const key = 'g|' + c.cat; const col = !!st.collapsed[key];
            const items = (c.arr || []).map((x, i) => this._smEntryHtml(c.cat, null, i, x, !!c.role)).join('');
            const add = c.add ? `<div class="sm-addrow" data-cat="${c.cat}">` +
                (c.role ? this._smRoleHtml('user', 'data-act="newrole"') : '') +
                `<textarea class="cx-in cx-grow sm-newtext" rows="1" placeholder="新增内容" aria-label="新增内容"></textarea>` +
                `<button type="button" class="cx-btn" data-act="gadd" data-cat="${c.cat}">添加</button></div>` : '';
            return this._smFold(key, c.title, (c.arr || []).length, col, (items || '<div class="cx-muted cx-emptyline">空</div>') + add);
        };
        // 操作记录：本轮 + 历史各轮
        const okey = 'g|ops'; const ocol = !!st.collapsed[okey];
        const curOps = (ss.operations || []).map((x, i) => this._smEntryHtml('op', 'cur', i, x, false)).join('');
        const hist = (ss.interactions || []).map((it, gi) => {
            const list = (it && Array.isArray(it.operations)) ? it.operations : [];
            return `<div class="sm-sub">第 ${gi + 1} 轮</div>` + (list.length ? list.map((x, i) => this._smEntryHtml('op', String(gi), i, x, false)).join('') : '<div class="cx-muted cx-emptyline">空</div>');
        }).join('');
        const opsBody = `<div class="sm-sub">本轮</div>${curOps || '<div class="cx-muted cx-emptyline">空</div>'}${hist}`;
        const total = (ss.operations || []).length + (ss.interactions || []).reduce((n, it) => n + ((it && it.operations) ? it.operations.length : 0), 0);
        return `<div class="cx-sttl">全局总结</div>` + cats.map(block).join('') + this._smFold(okey, '操作记录', total, ocol, opsBody);
    },

    _smFold(key, title, count, collapsed, body) {
        const e = DebugCtl.esc;
        return `<section class="cx-group sm-fold" data-g="${e(key)}" data-collapsed="${collapsed ? '1' : '0'}">` +
            `<button type="button" class="cx-gh" data-act="ftoggle" aria-expanded="${collapsed ? 'false' : 'true'}"><span class="cx-caret" aria-hidden="true"></span><span class="cx-gname">${e(title)}</span><span class="cx-count">${count}</span></button>` +
            `<div class="cx-gbody">${body}</div></section>`;
    },

    _smRoleHtml(role, attrs) {
        const user = role === 'user';
        return `<div class="cx-seg sm-role" role="radiogroup" aria-label="发送方">` +
            `<button type="button" role="radio" aria-checked="${user}" class="cx-segb${user ? ' on' : ''}" ${attrs} data-role="user">用户</button>` +
            `<button type="button" role="radio" aria-checked="${!user}" class="cx-segb${user ? '' : ' on'}" ${attrs} data-role="assistant">AI</button></div>`;
    },

    _smEntryHtml(cat, grp, i, x, role) {
        const e = DebugCtl.esc;
        const g = grp == null ? '' : ` data-grp="${e(grp)}"`;
        const roleHtml = role ? this._smRoleHtml(x && x.role === 'assistant' ? 'assistant' : 'user', `data-act="entrole" data-cat="${cat}" data-idx="${i}"`) : '';
        return `<div class="sm-entry"><span class="cx-idx">${i + 1}</span><div class="sm-entrybody">${roleHtml}` +
            `<textarea class="cx-in cx-grow sm-edit" rows="1" data-cat="${cat}"${g} data-idx="${i}" aria-label="第 ${i + 1} 条内容">${e(this._smItemText(x))}</textarea></div>` +
            `<button type="button" class="cx-btn cx-del" data-act="gdel" data-cat="${cat}"${g} data-idx="${i}">删除</button></div>`;
    },

    /** 取分类对应的数组 */
    _smArr(ss, cat, grp) {
        if (cat === 'single') return ss.singleSummaries;
        if (cat === 'mega') return ss.megaSummaries;
        if (cat === 'orig') return ss.originalMessages;
        if (cat === 'pluginc') return ss.pluginSummaryContents;
        if (cat === 'op') {
            if (grp === 'cur') return ss.operations;
            const it = ss.interactions[Number(grp)];
            return it ? it.operations : null;
        }
        return null;
    },

    // ---------- 模块记忆树 ----------
    _smModulesHtml(ms, ss) {
        return `<div class="cx-sttl">模块总结</div><div class="sm-split">` +
            `<div class="sm-treebox"><div class="sm-tree" id="sm-tree">${this._smTreeHtml(ms, ss)}</div></div>` +
            `<div class="sm-detail" id="sm-detail">${this._smDetailHtml(ms, ss, this._sm().sel)}</div></div>`;
    },

    _smHasSummary(ss, id) {
        const s = ss.moduleSummaries && ss.moduleSummaries.get ? ss.moduleSummaries.get(id) : null;
        return !!(s && s.content);
    },

    _smFlowName(mod, k) {
        const fd = mod && mod.flows ? mod.flows[k] : null;
        return (fd && fd.name) ? fd.name : k;
    },

    _smTreeHtml(ms, ss) {
        const e = DebugCtl.esc; const st = this._sm();
        const root = ms.getModule(ms.rootModuleId); if (!root) return '<div class="cx-muted">该故事暂无模块。</div>';
        const col = (k) => !!st.collapsed[k];
        const toggle = (k, label, cls) => `<button type="button" class="sm-fh ${cls || ''}" data-act="ntoggle" data-k="${e(k)}" aria-expanded="${col(k) ? 'false' : 'true'}"><span class="cx-caret" aria-hidden="true"></span><span class="sm-fhname">${e(label)}</span></button>`;
        const node = (m) => {
            const id = m.id; const key = 'n|' + id;
            const kids = m.getAllSubModules ? [...m.getAllSubModules()] : [];
            const has = this._smHasSummary(ss, id);
            const row = `<div class="sm-node${id === st.sel ? ' on' : ''}" data-nid="${e(id)}">` +
                (kids.length ? `<button type="button" class="sm-twist" data-act="ntoggle" data-k="${e(key)}" aria-expanded="${col(key) ? 'false' : 'true'}" aria-label="展开或折叠"><span class="cx-caret" aria-hidden="true"></span></button>` : '<span class="sm-twist sm-twist-empty"></span>') +
                `<button type="button" class="sm-name" data-act="nsel" data-id="${e(id)}">${e(m.name || '未命名模块')}</button>` +
                `<span class="sm-badge${has ? ' has' : ''}">${has ? '有总结' : '空'}</span></div>`;
            return row + (kids.length ? `<div class="sm-kids" data-kids="${e(key)}" data-collapsed="${col(key) ? '1' : '0'}">${flows(m)}</div>` : '');
        };
        const flows = (mod) => {
            const names = mod.flows ? Object.keys(mod.flows) : [];
            names.sort((a, b) => (a === 'main' ? -1 : b === 'main' ? 1 : 0));
            return names.map((fn) => {
                const map = (mod.getFlowSubModules && mod.getFlowSubModules(fn)) || new Map();
                const list = [...map.values()]; if (!list.length) return '';
                const fk = 'f|' + mod.id + '|' + fn;
                const byType = {}; list.forEach((m) => { (byType[m.type] = byType[m.type] || []).push(m); });
                const types = this._SM_TYPE_ORDER.filter((t) => byType[t]).concat(Object.keys(byType).filter((t) => this._SM_TYPE_ORDER.indexOf(t) < 0));
                const inner = types.map((t) => {
                    const tk = 't|' + mod.id + '|' + fn + '|' + t;
                    return `<div class="sm-type">${toggle(tk, `${this._SM_TYPE_CN[t] || '其他'}（${byType[t].length}）`, 'sm-fh-type')}` +
                        `<div class="sm-kids" data-kids="${e(tk)}" data-collapsed="${col(tk) ? '1' : '0'}">${byType[t].map(node).join('')}</div></div>`;
                }).join('');
                const title = fn === 'main' ? '主流程' : '分流程：' + this._smFlowName(mod, fn);
                return `<div class="sm-flow">${toggle(fk, title, 'sm-fh-flow')}<div class="sm-kids" data-kids="${e(fk)}" data-collapsed="${col(fk) ? '1' : '0'}">${inner}</div></div>`;
            }).join('');
        };
        return node(root);
    },

    _smDetailHtml(ms, ss, id) {
        const e = DebugCtl.esc;
        const m = id ? ms.getModule(id) : null;
        if (!m) return '<div class="cx-muted">在左侧选择一个模块。</div>';
        const sm = ss.moduleSummaries.get(id);
        const content = sm && sm.content ? sm.content : '';
        const on = !!(m.summary && m.summary.enabled);
        let h = `<div class="sm-dhead"><span class="sm-dtitle">${e(m.name || '未命名模块')}</span><span class="sm-badge${on ? ' has' : ''}">${on ? '已启用总结' : '未启用总结'}</span></div>` +
            `<div class="sm-sub">模块总结</div>` +
            `<textarea class="cx-in cx-grow sm-modtext" rows="2" data-mid="${e(id)}" aria-label="模块总结">${e(content)}</textarea>` +
            `<div class="sm-actions"><button type="button" class="cx-btn cx-del" data-act="mclear" data-mid="${e(id)}">清除</button></div>`;
        const flows = m.flows ? Object.keys(m.flows).filter((f) => f !== 'main') : [];
        flows.forEach((f) => {
            const fs = ss.flowSummaries && ss.flowSummaries.get ? ss.flowSummaries.get(id + ':' + f) : null;
            h += `<div class="sm-sub">分流程总结：${e(this._smFlowName(m, f))}</div>` +
                `<textarea class="cx-in cx-grow sm-flowtext" rows="2" data-mid="${e(id)}" data-flow="${e(f)}" aria-label="分流程总结">${e(fs && fs.content ? fs.content : '')}</textarea>` +
                `<div class="sm-actions"><button type="button" class="cx-btn cx-del" data-act="fclear" data-mid="${e(id)}" data-flow="${e(f)}">清除</button></div>`;
        });
        return h;
    },

    // ---------- 伏笔与投递 ----------
    _smCDList(ss) {
        if (!Array.isArray(ss.conditionalDeliveries)) ss.conditionalDeliveries = [];
        return ss.conditionalDeliveries;
    },

    /** 伏笔：手写、无触发条件、按回流轮数重发；其余是按条件触发的投递 */
    _smIsForeshadow(x) {
        if (x.kind === 'foreshadow') return true;
        return !(x.conditionStr && String(x.conditionStr).trim()) && typeof x.recallRounds === 'number';
    },

    _smForeshadowHtml(ss) {
        const e = DebugCtl.esc;
        const list = this._smCDList(ss);
        const cards = list.map((x, i) => ({ x, i })).filter((p) => this._smIsForeshadow(p.x)).map((p) => {
            const x = p.x, i = p.i;
            return `<div class="sm-card" data-di="${i}" data-kind="fs">` +
                `<div class="sm-field"><span class="sm-flab">标题</span><input type="text" class="cx-in sm-fs-title" data-di="${i}" value="${e(x.title || '')}" aria-label="伏笔标题"></div>` +
                `<div class="sm-field"><span class="sm-flab">内容</span><textarea class="cx-in cx-grow sm-fs-content" rows="2" data-di="${i}" aria-label="伏笔内容">${e(x.content || '')}</textarea></div>` +
                `<div class="sm-field"><span class="sm-flab">回流轮数</span>${this._smNumHtml(x.recallRounds == null ? 0 : x.recallRounds, `data-act-n="fsrounds" data-di="${i}"`, { min: 0, max: 999, unit: '轮', label: '回流轮数' })}</div>` +
                `<div class="sm-field"><span class="sm-flab">已完成</span>${this._smBoolHtml(!!x.completed, `data-act="dlbool" data-di="${i}"`, '已完成')}</div>` +
                `<div class="sm-actions"><button type="button" class="cx-btn cx-del" data-act="dldel" data-di="${i}">删除</button></div></div>`;
        }).join('');
        const n = list.filter((x) => this._smIsForeshadow(x)).length;
        return `<div class="cx-sttl">伏笔（${n}）</div>${cards || '<div class="cx-muted cx-emptyline">暂无伏笔。</div>'}` +
            `<div class="sm-card sm-new" data-kind="fsnew"><div class="sm-sub">新增伏笔</div>` +
            `<div class="sm-field"><span class="sm-flab">标题</span><input type="text" class="cx-in sm-new-title" aria-label="新伏笔标题"></div>` +
            `<div class="sm-field"><span class="sm-flab">内容</span><textarea class="cx-in cx-grow sm-new-content" rows="2" aria-label="新伏笔内容"></textarea></div>` +
            `<div class="sm-field"><span class="sm-flab">回流轮数</span>${this._smNumHtml(5, 'data-new="rounds"', { min: 0, max: 999, unit: '轮', label: '回流轮数' })}</div>` +
            `<div class="sm-actions"><button type="button" class="cx-btn cx-btn-main" data-act="fsadd">添加伏笔</button></div></div>`;
    },

    _smDeliveryHtml(ms, ss) {
        const e = DebugCtl.esc;
        const list = this._smCDList(ss);
        // 模组里写好的投递：只看完成情况，可手动改完成状态
        let mods = '';
        if (ms.modules && ms.modules.forEach) ms.modules.forEach((m) => {
            const di = Array.isArray(m.deliveryInfo) ? m.deliveryInfo : [];
            if (!di.length) return;
            mods += `<div class="sm-sub">${e(m.name || '未命名模块')}</div>` + di.map((d, k) =>
                `<div class="sm-card sm-mdel"><div class="sm-dtext"><b>${e(d.title || '未命名投递')}</b>${d.content ? `<div class="sm-dbody">${e(d.content)}</div>` : ''}</div>` +
                `<div class="sm-field"><span class="sm-flab">已完成</span>${this._smBoolHtml(!!d.completed, `data-act="mdelbool" data-mid="${e(m.id)}" data-title="${e(d.title || '')}"`, '已完成')}</div></div>`).join('');
        });
        const cards = list.map((x, i) => ({ x, i })).filter((p) => !this._smIsForeshadow(p.x)).map((p) => this._smCondCardHtml(ss, p.x, p.i)).join('');
        const n = list.filter((x) => !this._smIsForeshadow(x)).length;
        return `<div class="cx-sttl">投递</div>` +
            `<div class="sm-sub">模组投递的完成情况</div>${mods || '<div class="cx-muted cx-emptyline">暂无模组投递。</div>'}` +
            `<div class="sm-sub">按条件投递（${n}）</div>${cards || '<div class="cx-muted cx-emptyline">暂无按条件的投递。</div>'}` +
            `<div class="sm-card sm-new" data-kind="dlnew"><div class="sm-sub">新增投递</div>` +
            `<div class="sm-field"><span class="sm-flab">标题</span><input type="text" class="cx-in sm-new-title" aria-label="新投递标题"></div>` +
            `<div class="sm-field"><span class="sm-flab">内容</span><textarea class="cx-in cx-grow sm-new-content" rows="2" aria-label="新投递内容"></textarea></div>` +
            `<div class="sm-field"><span class="sm-flab">触发条件</span><div class="sm-cond" data-cond="new">${this._smCondBuilderHtml(this._smCondDraft('variable'))}</div></div>` +
            `<div class="sm-actions"><button type="button" class="cx-btn cx-btn-main" data-act="dladd">添加投递</button></div></div>`;
    },

    _smCondCardHtml(ss, x, i) {
        const e = DebugCtl.esc;
        const status = this._smCondStatus(ss, x);
        const parsed = x.conditionParsed ? this._smCondFromParsed(x.conditionParsed) : this._smCondDraft('variable');
        return `<div class="sm-card" data-di="${i}" data-kind="dl">` +
            `<div class="sm-field"><span class="sm-flab">标题</span><input type="text" class="cx-in sm-dl-title" data-di="${i}" value="${e(x.title || '')}" aria-label="投递标题"></div>` +
            `<div class="sm-field"><span class="sm-flab">内容</span><textarea class="cx-in cx-grow sm-dl-content" rows="2" data-di="${i}" aria-label="投递内容">${e(x.content || '')}</textarea></div>` +
            `<div class="sm-field"><span class="sm-flab">触发条件</span><div class="sm-cond" data-cond="${i}">${this._smCondBuilderHtml(parsed)}</div></div>` +
            `<div class="sm-field"><span class="sm-flab">已完成</span>${this._smBoolHtml(!!x.completed, `data-act="dlbool" data-di="${i}"`, '已完成')}<span class="sm-status">${e(status)}</span></div>` +
            `<div class="sm-actions"><button type="button" class="cx-btn cx-del" data-act="dldel" data-di="${i}">删除</button></div></div>`;
    },

    // ---------- 触发条件编辑 ----------
    _smVarOptions() {
        const vs = this.variableSystem; const out = [];
        if (vs && vs.variables) vs.variables.forEach((v, id) => { if (v && ['number', 'string', 'boolean'].indexOf(v.type) >= 0) out.push({ value: id, label: v.name || '未命名变量' }); });
        return out;
    },

    _smModOptions() {
        const ms = this.moduleSystem; const out = [];
        if (ms && ms.modules && ms.modules.forEach) ms.modules.forEach((m) => { if (m) out.push({ value: m.id, label: m.name || '未命名模块' }); });
        return out;
    },

    _smCondDraft(type) {
        if (type === 'time') return { type: 'time', param: 'day', operator: '>=', value: 1 };
        if (type === 'module') { const o = this._smModOptions()[0]; return { type: 'module', moduleId: o ? o.value : '', state: 'completed' }; }
        const o = this._smVarOptions()[0];
        const v = o ? this.variableSystem.getVariable(o.value) : null;
        return { type: 'variable', variableId: o ? o.value : '', operator: '>=', value: v && v.type === 'string' ? '' : (v && v.type === 'boolean' ? true : 0) };
    },

    _smCondFromParsed(p) {
        if (p.type === 'time') return { type: 'time', param: p.param, operator: p.operator, value: p.value };
        if (p.type === 'module') return { type: 'module', moduleId: p.moduleId, state: p.state };
        return { type: 'variable', variableId: p.variableId, operator: p.operator, value: p.value };
    },

    /** 条件 → 系统认的写法；条件还不完整时返回 null */
    _smCondStr(c) {
        if (!c) return null;
        if (c.type === 'module') return c.moduleId && c.state ? `module:${c.moduleId}:${c.state}` : null;
        if (c.value === '' || c.value == null || (typeof c.value === 'number' && !isFinite(c.value))) return null;
        if (c.type === 'time') return c.param ? `time:${c.param}${c.operator}${c.value}` : null;
        return c.variableId ? `variable:${c.variableId}${c.operator}${c.value}` : null;
    },

    _smChips(items, cur, act) {
        const e = DebugCtl.esc;
        return `<div class="cx-chips" role="radiogroup">` + items.map((it) => `<button type="button" role="radio" aria-checked="${String(it[0]) === String(cur)}" class="cx-chip${String(it[0]) === String(cur) ? ' on' : ''}" data-act="${act}" data-v="${e(it[0])}">${e(it[1])}</button>`).join('') + `</div>`;
    },

    _smCondBuilderHtml(c) {
        const e = DebugCtl.esc;
        let h = this._smChips([['variable', '变量'], ['time', '时间'], ['module', '模块状态']], c.type, 'ctype');
        if (c.type === 'module') {
            h += DebugCtl.pickHtml({ key: 'cmod', value: c.moduleId, options: this._smModOptions(), emptyLabel: '选择模块' });
            h += this._smChips([['entered', '已进入'], ['completed', '已完成']], c.state, 'cstate');
        } else if (c.type === 'time') {
            h += this._smChips(this._SM_TIME_PARAMS, c.param, 'cparam');
            h += this._smChips(this._SM_OPS, c.operator, 'cop');
            h += this._smNumHtml(c.value, 'data-cval="1"', { min: 0, max: 99999, label: '数值' });
        } else {
            h += DebugCtl.pickHtml({ key: 'cvar', value: c.variableId, options: this._smVarOptions(), emptyLabel: '选择变量' });
            const v = c.variableId ? this.variableSystem.getVariable(c.variableId) : null;
            const t = v ? v.type : 'number';
            const ops = t === 'number' ? this._SM_OPS : this._SM_OPS.filter((o) => o[0] === '==' || o[0] === '!=');
            h += this._smChips(ops, c.operator, 'cop');
            if (t === 'boolean') h += this._smBoolHtml(c.value === true, 'data-act="cbool"', '比较值');
            else if (t === 'string') h += `<input type="text" class="cx-in sm-cval-text" value="${e(c.value == null ? '' : c.value)}" aria-label="比较值">`;
            else h += this._smNumHtml(c.value, 'data-cval="1"', { label: '比较值' }).replace('data-int="1"', '');
        }
        return h;
    },

    /** 从界面读出当前条件 */
    _smCondRead(host) {
        const on = (act) => { const b = host.querySelector(`.cx-chip.on[data-act="${act}"]`); return b ? b.getAttribute('data-v') : null; };
        const type = on('ctype');
        if (type === 'module') {
            const p = host.querySelector('.cx-pick'); return { type, moduleId: p ? p.getAttribute('data-value') : '', state: on('cstate') };
        }
        if (type === 'time') {
            const n = host.querySelector('input[data-cval]'); const r = DebugCtl.parseNum(n.value, { int: true, min: 0, max: 99999 });
            return { type, param: on('cparam'), operator: on('cop'), value: r.ok ? r.n : null };
        }
        const p = host.querySelector('.cx-pick'); const id = p ? p.getAttribute('data-value') : '';
        const v = id ? this.variableSystem.getVariable(id) : null; const t = v ? v.type : 'number';
        let value;
        if (t === 'boolean') { const b = host.querySelector('.cx-segb.on'); value = !!b && b.getAttribute('data-bool') === '1'; }
        else if (t === 'string') value = host.querySelector('.sm-cval-text').value;
        else { const n = host.querySelector('input[data-cval]'); const r = DebugCtl.parseNum(n.value, { int: false, min: null, max: null }); value = r.ok ? r.n : null; }
        return { type, variableId: id, operator: on('cop'), value };
    },

    // ---------- 插件总结 ----------
    _smPluginsHtml(ss) {
        const e = DebugCtl.esc;
        const psys = this.pluginSystem; const plugins = [];
        if (psys && psys.plugins && psys.plugins.forEach) psys.plugins.forEach((p) => { if (p) plugins.push(p); });
        const known = new Set(plugins.map((p) => p.id));
        if (ss.pluginSummaries && ss.pluginSummaries.forEach) ss.pluginSummaries.forEach((v, id) => { if (!known.has(id)) plugins.push({ id, name: '未知插件', type: '' }); });
        const cfg = ss.config.pluginSummary = ss.config.pluginSummary || {};
        const by = cfg.byPlugin = cfg.byPlugin || {};
        const globalKeep = this._smCfgGet('globalSummary.keepRecentOriginalMessages');
        const cards = plugins.map((p) => {
            const c = by[p.id] || {};
            const events = (ss.pluginSummaries && ss.pluginSummaries.get(p.id)) || [];
            const evs = events.map((ev, i) => {
                const text = ev && typeof ev.event === 'string' ? ev.event : null;
                const body = text !== null
                    ? `<textarea class="cx-in cx-grow sm-pl-event" rows="1" data-pid="${e(p.id)}" data-idx="${i}" aria-label="第 ${i + 1} 条总结">${e(text)}</textarea>`
                    : `<div class="sm-dtext">${e(JSON.stringify(ev && ev.event !== undefined ? ev.event : ev))}</div>`;
                return `<div class="sm-entry"><span class="cx-idx">${i + 1}</span><div class="sm-entrybody">${body}</div>` +
                    `<button type="button" class="cx-btn cx-del" data-act="pldel" data-pid="${e(p.id)}" data-idx="${i}">删除</button></div>`;
            }).join('');
            return `<div class="sm-card" data-pid="${e(p.id)}"><div class="sm-dhead"><span class="sm-dtitle">${e(p.name || '未命名插件')}</span>${p.type && this._plTypeCN ? `<span class="cx-vt">${e(this._plTypeCN(p.type))}</span>` : ''}</div>` +
                `<div class="sm-field"><span class="sm-flab">总结轮数</span>${this._smNumHtml(c.summaryRounds == null ? 10 : c.summaryRounds, `data-plcfg="summaryRounds" data-pid="${e(p.id)}"`, { min: 1, max: 999, unit: '轮', label: '总结轮数' })}</div>` +
                `<div class="sm-field"><span class="sm-flab">原始消息保留轮数</span>${this._smNumHtml(c.keepRecentOriginalMessages == null ? globalKeep : c.keepRecentOriginalMessages, `data-plcfg="keepRecentOriginalMessages" data-pid="${e(p.id)}"`, { min: 0, max: 999, unit: '轮', label: '原始消息保留轮数' })}</div>` +
                `<div class="sm-sub">已有总结（${events.length}）</div>${evs || '<div class="cx-muted cx-emptyline">暂无。</div>'}</div>`;
        }).join('');
        return `<div class="cx-sttl">插件总结</div>${cards || '<div class="cx-muted cx-emptyline">暂无插件。</div>'}`;
    },

    // ---------- 事件 ----------
    _smOnClick(e) {
        const t = e.target.closest ? e.target.closest('[data-act]') : null;
        const box = this._sm().bound;
        if (!t || !box || !box.contains(t)) return;
        const act = t.getAttribute('data-act');
        const ss = this._smSS(), ms = this.moduleSystem, st = this._sm();
        if (act === 'ftoggle') {
            const g = t.closest('.cx-group'); const key = g.getAttribute('data-g');
            const next = g.getAttribute('data-collapsed') !== '1';
            st.collapsed[key] = next; g.setAttribute('data-collapsed', next ? '1' : '0'); t.setAttribute('aria-expanded', next ? 'false' : 'true');
            if (!next) DebugCtl.fitAll(g);
        } else if (act === 'ntoggle') {
            const k = t.getAttribute('data-k'); const next = !st.collapsed[k];
            st.collapsed[k] = next;
            box.querySelectorAll('[data-k]').forEach((x) => { if (x.getAttribute('data-k') === k) x.setAttribute('aria-expanded', next ? 'false' : 'true'); });
            box.querySelectorAll('[data-kids]').forEach((x) => { if (x.getAttribute('data-kids') === k) x.setAttribute('data-collapsed', next ? '1' : '0'); });
        } else if (act === 'nsel') {
            st.sel = t.getAttribute('data-id');
            box.querySelectorAll('.sm-node').forEach((n) => n.classList.toggle('on', n.getAttribute('data-nid') === st.sel));
            const d = box.querySelector('#sm-detail'); d.innerHTML = this._smDetailHtml(ms, ss, st.sel); DebugCtl.fitAll(d);
        } else if (act === 'compressnow') {
            this._smCompressNow(t);
        } else if (act === 'cfgbool') {
            this._smCfgSet(t.getAttribute('data-cfg'), t.getAttribute('data-bool') === '1');
            this._smSync(); this._smReplace('sm-sec-settings'); this._smSaved();
        } else if (act === 'gadd') this._smGlobalAdd(t);
        else if (act === 'gdel') this._smEntryDelete(t);
        else if (act === 'entrole') {
            const arr = this._smArr(ss, t.getAttribute('data-cat')); const x = arr && arr[Number(t.getAttribute('data-idx'))];
            if (x && typeof x === 'object') { x.role = t.getAttribute('data-role'); this._smSync(); this._smReplace('sm-sec-global'); this._smSaved(); }
        } else if (act === 'newrole') {
            const row = t.closest('.sm-addrow'); row.querySelectorAll('.cx-segb').forEach((b) => { const on = b === t; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); });
        } else if (act === 'mclear') {
            const id = t.getAttribute('data-mid'); const prev = ss.moduleSummaries.get(id);
            if (!prev) return;
            ss.clearModuleSummary(id); this._smSync(); this._smRefreshModules();
            DebugCtl.undo.show('已清除模块总结。', () => { ss.moduleSummaries.set(id, prev); this._smSync(); this._smRefreshModules(); });
        } else if (act === 'fclear') {
            const key = t.getAttribute('data-mid') + ':' + t.getAttribute('data-flow'); const prev = ss.flowSummaries.get(key);
            if (!prev) return;
            ss.flowSummaries.delete(key); this._smSync(); this._smRefreshModules();
            DebugCtl.undo.show('已清除分流程总结。', () => { ss.flowSummaries.set(key, prev); this._smSync(); this._smRefreshModules(); });
        } else if (act === 'dlbool') {
            const x = this._smCDList(ss)[Number(t.getAttribute('data-di'))]; if (!x) return;
            x.completed = t.getAttribute('data-bool') === '1'; this._smSync(); this._smReplace('sm-sec-fs'); this._smReplace('sm-sec-dl'); this._smSaved();
        } else if (act === 'mdelbool') this._smModuleDelivery(t);
        else if (act === 'dldel') this._smCDDelete(t);
        else if (act === 'fsadd') this._smForeshadowAdd(t);
        else if (act === 'dladd') this._smDeliveryAdd(t);
        else if (act === 'pldel') this._smPluginEventDelete(t);
        else if (act === 'ctype' || act === 'cparam' || act === 'cop' || act === 'cstate' || act === 'cbool') this._smCondControl(t, act);
    },

    _smRefreshModules() {
        const box = this._sm().bound; if (!box) return;
        const ss = this._smSS(), ms = this.moduleSystem, st = this._sm();
        const tree = box.querySelector('#sm-tree'); if (tree) tree.innerHTML = this._smTreeHtml(ms, ss);
        const d = box.querySelector('#sm-detail'); if (d) { d.innerHTML = this._smDetailHtml(ms, ss, st.sel); DebugCtl.fitAll(d); }
    },

    _smOnChange(e) {
        const el = e.target; if (!el || !el.matches) return;
        const ss = this._smSS();
        if (el.matches('input.cx-num[data-cfg]')) { this._smNumChange(el, (n) => { this._smCfgSet(el.getAttribute('data-cfg'), n); }); return; }
        if (el.matches('input.cx-num[data-plcfg]')) {
            this._smNumChange(el, (n) => {
                const by = ss.config.pluginSummary.byPlugin; const pid = el.getAttribute('data-pid');
                by[pid] = by[pid] || {}; by[pid][el.getAttribute('data-plcfg')] = n;
            });
            return;
        }
        if (el.matches('input.cx-num[data-act-n="fsrounds"]')) {
            this._smNumChange(el, (n) => { const x = this._smCDList(ss)[Number(el.getAttribute('data-di'))]; if (x) x.recallRounds = n; });
            return;
        }
        if (el.matches('input.cx-num[data-cval]')) { const host = el.closest('.sm-cond'); this._smCondCommit(host); return; }
        if (el.matches('.sm-cval-text')) { this._smCondCommit(el.closest('.sm-cond')); return; }
        if (el.matches('textarea.sm-edit')) this._smEntryEdit(el);
        else if (el.matches('textarea.sm-modtext')) {
            const id = el.getAttribute('data-mid'); const v = el.value;
            if (v.trim() === '') { if (ss.moduleSummaries.has(id)) ss.clearModuleSummary(id); } else ss.setModuleSummary(id, v);
            this._smSync(); this._smSaved(); this._smRefreshTreeBadges();
        } else if (el.matches('textarea.sm-flowtext')) {
            const id = el.getAttribute('data-mid'), f = el.getAttribute('data-flow'); const v = el.value;
            if (v.trim() === '') ss.flowSummaries.delete(id + ':' + f); else ss.setFlowSummary(id, f, v);
            this._smSync(); this._smSaved();
        } else if (el.matches('.sm-fs-title, .sm-dl-title')) this._smTitleEdit(el);
        else if (el.matches('.sm-fs-content, .sm-dl-content')) {
            const x = this._smCDList(ss)[Number(el.getAttribute('data-di'))]; if (!x) return;
            x.content = el.value; this._smSync(); this._smSaved();
        } else if (el.matches('textarea.sm-pl-event')) {
            const arr = ss.pluginSummaries.get(el.getAttribute('data-pid')); const x = arr && arr[Number(el.getAttribute('data-idx'))];
            if (!x) return;
            if (el.value.trim() === '') { DebugCtl.notify('内容不能为空；要移除请点删除。', 'error'); el.value = x.event; DebugCtl.fit(el); return; }
            x.event = el.value; this._smSync(); this._smSaved();
        }
    },

    _smRefreshTreeBadges() {
        const box = this._sm().bound; const ss = this._smSS(); if (!box) return;
        box.querySelectorAll('.sm-node').forEach((n) => {
            const has = this._smHasSummary(ss, n.getAttribute('data-nid'));
            const b = n.querySelector('.sm-badge'); if (b) { b.classList.toggle('has', has); b.textContent = has ? '有总结' : '空'; }
        });
    },

    /** 数字框提交：解析、收回范围、写入，并说明发生了什么 */
    _smNumChange(el, apply) {
        const spec = DebugCtl.numSpec(el); const prev = el.getAttribute('data-prev'); const label = el.getAttribute('data-label') || '';
        const r = DebugCtl.parseNum(el.value, spec);
        if (!r.ok) { DebugCtl.notify(DebugCtl.numMessage(label, r, spec, prev), 'error'); el.value = prev == null ? '' : prev; return; }
        if (r.clamped) DebugCtl.notify(DebugCtl.numMessage(label, r, spec, prev, r.n), 'error');
        el.value = String(r.n);
        if (String(r.n) === prev) return;
        el.setAttribute('data-prev', String(r.n));
        apply(r.n); this._smSync(); this._smSaved();
    },

    _smEntryEdit(el) {
        const ss = this._smSS();
        const arr = this._smArr(ss, el.getAttribute('data-cat'), el.getAttribute('data-grp'));
        const i = Number(el.getAttribute('data-idx')); const x = arr && arr[i];
        if (x === undefined) return;
        if (el.value.trim() === '') { DebugCtl.notify('内容不能为空；要移除请点删除。', 'error'); el.value = this._smItemText(x); DebugCtl.fit(el); return; }
        if (typeof x === 'string') arr[i] = el.value; else x.content = el.value;
        this._smSync(); this._smSaved();
    },

    _smEntryDelete(btn) {
        const ss = this._smSS(); const cat = btn.getAttribute('data-cat'), grp = btn.getAttribute('data-grp');
        const arr = this._smArr(ss, cat, grp); const i = Number(btn.getAttribute('data-idx'));
        if (!arr || i < 0 || i >= arr.length) return;
        const item = arr.splice(i, 1)[0];
        this._smSync(); this._smReplace('sm-sec-global');
        DebugCtl.undo.show('已删除一条。', () => { const a = this._smArr(ss, cat, grp); if (a) { a.splice(Math.min(i, a.length), 0, item); this._smSync(); this._smReplace('sm-sec-global'); } });
    },

    _smGlobalAdd(btn) {
        const ss = this._smSS(); const row = btn.closest('.sm-addrow'); const cat = btn.getAttribute('data-cat');
        const ta = row.querySelector('.sm-newtext'); const text = ta.value.trim();
        if (!text) { DebugCtl.notify('请先填写内容。', 'error'); ta.focus(); return; }
        const arr = this._smArr(ss, cat);
        if (cat === 'orig') { const on = row.querySelector('.cx-segb.on'); arr.push({ role: on ? on.getAttribute('data-role') : 'user', content: text, timestamp: new Date() }); }
        else if (cat === 'mega') arr.push({ content: text, timestamp: new Date(), sourceCount: 0 });
        else arr.push({ content: text, timestamp: new Date() });
        this._smSync(); this._smReplace('sm-sec-global'); this._smSaved();
    },

    _smTitleExists(ss, title, exceptIdx) {
        return this._smCDList(ss).some((x, i) => i !== exceptIdx && (x.title || '') === title);
    },

    _smTitleEdit(el) {
        const ss = this._smSS(); const i = Number(el.getAttribute('data-di')); const x = this._smCDList(ss)[i]; if (!x) return;
        const v = el.value.trim();
        if (!v) { DebugCtl.notify('标题不能为空。', 'error'); el.value = x.title || ''; return; }
        if (this._smTitleExists(ss, v, i)) { DebugCtl.notify('已有同名的伏笔或投递。', 'error'); el.value = x.title || ''; return; }
        x.title = v; this._smSync(); this._smSaved();
    },

    _smForeshadowAdd(btn) {
        const ss = this._smSS(); const card = btn.closest('.sm-card');
        const title = card.querySelector('.sm-new-title').value.trim(); const content = card.querySelector('.sm-new-content').value;
        const rEl = card.querySelector('input[data-new="rounds"]'); const r = DebugCtl.parseNum(rEl.value, DebugCtl.numSpec(rEl));
        if (!title) { DebugCtl.notify('请先填写标题。', 'error'); card.querySelector('.sm-new-title').focus(); return; }
        if (this._smTitleExists(ss, title, -1)) { DebugCtl.notify('已有同名的伏笔或投递。', 'error'); return; }
        if (!r.ok) { DebugCtl.notify('回流轮数需要填写数字。', 'error'); return; }
        this._smCDList(ss).push({ title, content, conditionStr: '', conditionParsed: null, completed: false, recallRounds: r.n, kind: 'foreshadow' });
        this._smSync(); this._smReplace('sm-sec-fs'); this._smSaved();
    },

    _smDeliveryAdd(btn) {
        const ss = this._smSS(); const card = btn.closest('.sm-card');
        const title = card.querySelector('.sm-new-title').value.trim(); const content = card.querySelector('.sm-new-content').value;
        if (!title) { DebugCtl.notify('请先填写标题。', 'error'); card.querySelector('.sm-new-title').focus(); return; }
        if (this._smTitleExists(ss, title, -1)) { DebugCtl.notify('已有同名的伏笔或投递。', 'error'); return; }
        const cond = this._smCondRead(card.querySelector('.sm-cond'));
        const str = this._smCondStr(cond);
        if (!str) { DebugCtl.notify('请先把触发条件填完整。', 'error'); return; }
        const parsed = ss._parseForeshadowCondition(str);
        if (!parsed) { DebugCtl.notify('这个触发条件无法识别，请重新选择。', 'error'); return; }
        this._smCDList(ss).push({ title, content, conditionStr: str, conditionParsed: parsed, completed: false });
        this._smSync(); this._smReplace('sm-sec-dl'); this._smSaved();
    },

    _smCDDelete(btn) {
        const ss = this._smSS(); const list = this._smCDList(ss); const i = Number(btn.getAttribute('data-di'));
        if (i < 0 || i >= list.length) return;
        const item = list.splice(i, 1)[0];
        this._smSync(); this._smReplace('sm-sec-fs'); this._smReplace('sm-sec-dl');
        DebugCtl.undo.show('已删除一条。', () => { const l = this._smCDList(ss); l.splice(Math.min(i, l.length), 0, item); this._smSync(); this._smReplace('sm-sec-fs'); this._smReplace('sm-sec-dl'); });
    },

    _smPluginEventDelete(btn) {
        const ss = this._smSS(); const pid = btn.getAttribute('data-pid'); const i = Number(btn.getAttribute('data-idx'));
        const arr = ss.pluginSummaries.get(pid); if (!arr || i < 0 || i >= arr.length) return;
        const item = arr.splice(i, 1)[0];
        this._smSync(); this._smReplace('sm-sec-plugins');
        DebugCtl.undo.show('已删除一条插件总结。', () => { const a = ss.pluginSummaries.get(pid) || []; a.splice(Math.min(i, a.length), 0, item); ss.pluginSummaries.set(pid, a); this._smSync(); this._smReplace('sm-sec-plugins'); });
    },

    /** 模组里写好的投递：改完成状态，同时写进全局状态里的已完成记录 */
    _smModuleDelivery(btn) {
        const ms = this.moduleSystem; const m = ms.getModule(btn.getAttribute('data-mid')); const title = btn.getAttribute('data-title');
        if (!m) return;
        const done = btn.getAttribute('data-bool') === '1';
        if (done) m.completeDeliveryInfo(title); else m.uncompleteDeliveryInfo(title);
        if (typeof State !== 'undefined') {
            if (!State.deliveryCompleted) State.deliveryCompleted = {};
            const rootId = ms.rootModuleId;
            const map = Object.assign({}, State.deliveryCompleted[rootId] || {});
            if (done) map[title] = true; else delete map[title];
            State.deliveryCompleted[rootId] = map;
        }
        this._smReplace('sm-sec-dl'); this._smSaved();
    },

    // ---------- 条件控件 ----------
    _smCondControl(btn, act) {
        const host = btn.closest('.sm-cond'); if (!host) return;
        if (act === 'cbool') {
            host.querySelectorAll('.cx-segb').forEach((b) => { const on = b === btn; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); });
        } else {
            btn.closest('.cx-chips').querySelectorAll('.cx-chip').forEach((c) => { const on = c === btn; c.classList.toggle('on', on); c.setAttribute('aria-checked', on ? 'true' : 'false'); });
        }
        if (act === 'ctype') { host.innerHTML = this._smCondBuilderHtml(this._smCondDraft(btn.getAttribute('data-v'))); }
        this._smCondCommit(host);
    },

    _smOnPick(e) {
        const host = e.detail.pick.closest('.sm-cond'); if (!host) return;
        if (e.detail.key === 'cvar') {
            // 换了变量，运算符与比较值按新变量的类型重置
            const v = this.variableSystem.getVariable(e.detail.value);
            const c = { type: 'variable', variableId: e.detail.value, operator: '>=', value: v && v.type === 'string' ? '' : (v && v.type === 'boolean' ? true : 0) };
            if (v && v.type !== 'number') c.operator = '==';
            host.innerHTML = this._smCondBuilderHtml(c);
        }
        this._smCondCommit(host);
    },

    /** 条件有变：已有的投递立即写回；新增表单里只保留在界面上 */
    _smCondCommit(host) {
        if (!host) return;
        const key = host.getAttribute('data-cond');
        if (key === 'new') return;
        const ss = this._smSS(); const x = this._smCDList(ss)[Number(key)]; if (!x) return;
        const cond = this._smCondRead(host); const str = this._smCondStr(cond);
        if (!str) { DebugCtl.notify('触发条件还不完整，没有保存。', 'error'); return; }
        const parsed = ss._parseForeshadowCondition(str);
        if (!parsed) { DebugCtl.notify('这个触发条件无法识别，没有保存。', 'error'); return; }
        x.conditionStr = str; x.conditionParsed = parsed;
        this._smSync(); this._smSaved();
        const card = host.closest('.sm-card');
        const status = card && card.querySelector('.sm-status');
        if (status) status.textContent = this._smCondStatus(ss, x);
    },

    /** 按投递现在的条件说明状态；检查条件时出错就把出错的原因写出来 */
    _smCondStatus(ss, x) {
        if (x.completed) return '已完成';
        if (!x.conditionParsed) return '条件未设置';
        try {
            return ss._evaluateConditionalDeliveryCondition(x.conditionParsed) ? '条件已满足，待发送' : '条件未满足';
        } catch (err) {
            console.error(err);
            return '检查条件时出错：' + err.message;
        }
    }
});
