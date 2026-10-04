/**
 * 模组编辑标签的右侧编辑面板：基本信息、进入与完成条件、变量、投递、插件，以及流程设置。
 * 每个输入框在内容改变时通过 ModuleEditor 提交；提交失败时原因显示在该区块内，模组保持不变。
 * 扩展 DebugModuleJump（debug-tab-module-edit.js 先加载）。
 */
Object.assign(DebugModuleJump, {
    _meOpt(pairs, cur) {
        return pairs.map(([v, t]) => `<option value="${this._esc(v)}"${v === cur ? ' selected' : ''}>${this._esc(t)}</option>`).join('');
    },

    _mePanelEl() { return document.getElementById('me-panel'); },

    /** 面板整体重画：保留滚动位置，条件编辑器重新挂载 */
    _meRenderPanel() {
        const el = this._mePanelEl();
        if (!el) return;
        const top = el.scrollTop;
        const ms = this.moduleSystem;
        if (this._meFlowSel) {
            const mod = ms.getModule(this._meFlowSel.parentId);
            if (!mod || !(this._meFlowSel.flow in (mod.flows || {})) && !mod.subModules.has(this._meFlowSel.flow)) this._meFlowSel = null;
        }
        el.innerHTML = this._meFlowSel ? this._meFlowPanelHtml() : this._meNodePanelHtml();
        this._meBindPanel(el);
        if (window.FormControls) FormControls.enhance(el);
        el.scrollTop = top;
    },

    // ---- 工具栏 ----

    _meToolbarHtml(opts) {
        const b = (act, label, cls = '', extra = '') => `<button type="button" class="mjx-b me-tb ${cls}" data-meact="${act}" ${extra}>${label}</button>`;
        return '<div class="me-toolbar">' +
            b('addchild', I18n.t('新建事件')) +
            (opts.canAddFlow ? b('addflow', I18n.t('新建分流程')) : '') +
            (opts.canMove ? b('up', I18n.t('上移')) + b('down', I18n.t('下移')) + b('copy', I18n.t('复制')) + b('cut', I18n.t('剪切')) : '') +
            (this._meClipboard ? b('paste', I18n.t('粘贴到这里')) : '') +
            (opts.canDelete ? b('delnode', I18n.t('删除'), 'mjx-b-untrig') : '') + '</div>';
    },

    // ---- 流程面板 ----

    _meFlowPanelHtml() {
        const { parentId, flow } = this._meFlowSel;
        const ms = this.moduleSystem;
        const mod = ms.getModule(parentId);
        const esc = this._esc.bind(this);
        const isMain = flow === 'main';
        const meta = (mod.flows && mod.flows[flow]) || {};
        const entry = meta.entryEvent ? ms.getModule(meta.entryEvent) : null;
        let html = `<div class="mjx-sin"><div class="mjx-dh"><span class="mjx-dt">${isMain ? I18n.t('主流程') : I18n.t('分流程：{name}', { name: esc(this._flowName(flow, mod)) })}</span></div>` +
            this._meToolbarHtml({ canAddFlow: false, canMove: false, canDelete: false });
        if (!isMain) {
            html += `<section class="me-sec"><h4>${I18n.t('流程设置')}</h4>` +
                `<label class="mjx-flab" for="me-flowname">${I18n.t('名称')}</label><textarea rows="1" class="mjx-fta me-line" id="me-flowname">${esc(this._flowName(flow, mod))}</textarea>` +
                `<label class="mjx-flab">${I18n.t('进入前需要完成的事件')}</label>` +
                `<div class="me-pickrow"><button type="button" class="mjx-b me-pickbtn" data-meact="pickentry">${entry ? esc(entry.name) : I18n.t('不限制')}</button>` +
                (entry ? `<button type="button" class="mjx-b" data-meact="clearentry">${I18n.t('不限制')}</button>` : '') + '</div>' +
                '<div class="me-pickpop" id="me-pickpop" hidden></div>' +
                `<div class="me-actrow"><button type="button" class="mjx-b mjx-b-untrig" data-meact="delflow">${I18n.t('删除这个分流程')}</button></div></section>`;
        }
        return html + '</div>';
    },

    // ---- 事件面板 ----

    _meNodePanelHtml() {
        const ms = this.moduleSystem;
        const esc = this._esc.bind(this);
        const m = ms.getModule(this._meSel);
        if (!m) return `<div class="mjx-empty">${I18n.t('没有选中的事件。')}</div>`;
        const isRoot = m.id === ms.rootModuleId;
        const typeOpts = this._meOpt(this._ME_TYPES.map((t) => [t, this._TYC[t]]), m.type);
        const cfg = isRoot ? this._meEditor().getConfig() : null;
        const sec = (id, title, inner) => `<section class="me-sec" id="${id}"><h4>${title}</h4>${inner}</section>`;
        return '<div class="mjx-sin">' +
            `<div class="mjx-dh"><span class="mjx-dt">${esc(m.name || I18n.t('未命名'))}</span></div>` +
            this._meToolbarHtml({ canAddFlow: true, canMove: !isRoot, canDelete: !isRoot }) +
            sec('me-basicsec', I18n.t('基本信息'),
                `<label class="mjx-flab" for="me-name">${I18n.t('名称')}</label><textarea rows="1" class="mjx-fta me-line" id="me-name">${esc(m.name || '')}</textarea>` +
                (isRoot ? '' : `<label class="mjx-flab" for="me-type">${I18n.t('类型')}</label><select id="me-type" class="mjx-fin">${typeOpts}</select>`) +
                `<label class="mjx-flab" for="me-note">${I18n.t('备注')}</label><textarea class="mjx-fta" id="me-note" rows="2">${esc(m.note || '')}</textarea>` +
                (m.type === 'timeline' ? `<div id="me-trig">${this._meTrigHtml(m)}</div>` : '') +
                `<label class="mjx-flab">${I18n.t('标签')}</label><div id="me-tags"></div>`) +
            (isRoot ? this._meRootHtml(cfg) : '') +
            sec('me-infosec', I18n.t('背景'), `<div id="me-info">${this._meInfoHtml(m)}</div><p class="me-err" id="me-infoerr" hidden></p><button type="button" class="mjx-b" data-meact="addinfo">${I18n.t('新增背景')}</button>`) +
            sec('me-entrysec', I18n.t('进入条件'), '<div id="me-entry" class="mjx-cbhost"></div>') +
            sec('me-compsec', I18n.t('完成条件'), '<div id="me-comp" class="mjx-cbhost"></div>') +
            sec('me-setsec', I18n.t('进入时设置变量'), `<p class="me-hint">${I18n.t('进入这个事件时，把下面的变量设成指定的值。')}</p><div id="me-set">${this._meSetHtml(m)}</div><p class="me-err" id="me-seterr" hidden></p><button type="button" class="mjx-b" data-meact="addset">${I18n.t('新增设置')}</button>`) +
            sec('me-varsec', I18n.t('变量'), `<div id="me-vars">${this._meVarsHtml(m)}</div><p class="me-err" id="me-varerr" hidden></p><button type="button" class="mjx-b" data-meact="addvar">${I18n.t('新增变量')}</button>`) +
            sec('me-delivsec', I18n.t('投递'), `<div id="me-deliv">${this._meDelivHtml(m)}</div><p class="me-err" id="me-deliverr" hidden></p><button type="button" class="mjx-b" data-meact="adddeliv">${I18n.t('新增投递')}</button>`) +
            sec('me-queuesec', I18n.t('提示词里的队列'), `<div id="me-queue">${this._meQueueHtml(m)}</div>`) +
            sec('me-pluginsec', I18n.t('插件'), `<div id="mjx-e-plugins">${this._pluginEditRows(m)}</div><button type="button" class="mjx-b" data-addplugin="1">${I18n.t('新增插件')}</button>`) +
            '</div>';
    },

    _meBindPanel(el) {
        el.onclick = (e) => {
            const add = e.target.closest('[data-addplugin]');
            if (add) { this._addPluginRegistration(); return; }
            const act = e.target.closest('[data-meact]');
            if (act && el.contains(act)) { e.stopPropagation(); this._mePanelAction(act.getAttribute('data-meact'), act); }
        };
        el.onchange = (e) => this._mePanelChange(e.target);
        el.onkeydown = (e) => { if (e.key === 'Enter' && !e.isComposing && e.target.classList && e.target.classList.contains('me-line')) { e.preventDefault(); e.target.blur(); } };
        el.oninput = (e) => {
            const t = e.target;
            if (t.id === 'me-name' || t.id === 'me-flowname') return;
        };
        if (!this._meFlowSel) {
            const m = this.moduleSystem.getModule(this._meSel);
            this._meMountConditions(m);
            this._meMountMisc(m);
            this._bindPluginRows(el);
        }
    },

    _meMountConditions(m) {
        if (typeof window.ConditionBuilder === 'undefined' || !m) return;
        const ms = this.moduleSystem;
        const modules = [];
        ms.modules.forEach((mm) => { if (mm && mm.id !== m.id) modules.push({ id: mm.id, name: mm.name || I18n.t('未命名') }); });
        const vars = this._varList();
        const wrap = (def) => (def && def.groups && def.groups.length) ? [{ type: 'precondition', conditionDef: def }] : [];
        const mount = (id, kind, wrappers) => {
            const host = document.getElementById(id);
            if (!host) return;
            const def = (Array.isArray(wrappers) ? wrappers : []).map((w) => w && w.conditionDef).find((d) => d && Array.isArray(d.groups)) || { logic: 'OR', groups: [] };
            ConditionBuilder.mount(host, def, {
                variables: vars, modules, units: this.timeSystem && this.timeSystem.getUnits ? this.timeSystem.getUnits() : null,
                onChange: (value) => { this._meDo((ed) => ed.setConditions(m.id, kind, wrap(value)), { panel: false }); },
                onRemoved: (msg) => this._meUndoSnapshotToast(msg)
            });
        };
        mount('me-entry', 'entry', m.entryConditions);
        mount('me-comp', 'completion', m.completionConditions);
        if (window.FormControls) { const e1 = document.getElementById('me-entry'); const e2 = document.getElementById('me-comp'); if (e1) FormControls.enhance(e1); if (e2) FormControls.enhance(e2); }
    },

    // ---- 面板上的动作 ----

    _mePanelAction(name, el) {
        const ms = this.moduleSystem;
        const id = this._meSel;
        switch (name) {
            case 'addchild': this._meAddChildDialog(); break;
            case 'addflow': this._meAddFlowDialog(); break;
            case 'up': case 'down': this._meDo((ed) => ed.moveNode(id, name), { panel: false }); break;
            case 'copy': this._meCopyNode(id); break;
            case 'cut': this._meCutNode(id); break;
            case 'paste': this._mePasteNode(this._meFlowSel ? this._meFlowSel.parentId : id, this._meFlowSel ? this._meFlowSel.flow : 'main'); break;
            case 'delnode': this._deleteCurrentNode(); break;
            case 'pickentry': this._mePickEntryEvent(); break;
            case 'clearentry': this._meDo((ed) => ed.setFlowEntryEvent(this._meFlowSel.parentId, this._meFlowSel.flow, null)); break;
            case 'delflow': this._meDeleteFlow(); break;
            default:
                if (!this._meMiscAction(name, el)) this._meVarAction(name, el);
        }
    },

    _mePanelChange(t) {
        const m = this.moduleSystem.getModule(this._meSel);
        if (t.id === 'me-name' && m) {
            const r = this._meDo((ed) => ed.rename(m.id, t.value), { panel: false });
            if (!r.ok) t.value = m.name;
            else { const dt = document.querySelector('#me-panel .mjx-dt'); if (dt) dt.textContent = t.value.trim(); }
        } else if (t.id === 'me-type' && m) {
            const r = this._meDo((ed) => ed.setType(m.id, t.value), { panel: false });
            if (!r.ok) t.value = m.type;
        } else if (t.id === 'me-info' && m) {
            this._meDo((ed) => ed.setInfo(m.id, t.value), { panel: false });
        } else if (t.id === 'me-note' && m) {
            this._meDo((ed) => ed.setNote(m.id, t.value), { panel: false });
        } else if (t.id === 'me-flowname') {
            const { parentId, flow } = this._meFlowSel;
            const r = this._meDo((ed) => ed.renameFlow(parentId, flow, t.value), { panel: false });
            if (!r.ok) t.value = this._flowName(flow, this.moduleSystem.getModule(parentId));
        } else if (t.closest && t.closest('#me-vars')) {
            this._meVarChange(t);
        } else {
            this._meMiscChange(t);
        }
    },

    // ---- 新建事件 / 分流程 ----

    _meAddChildDialog() {
        const ms = this.moduleSystem;
        const parentId = this._meFlowSel ? this._meFlowSel.parentId : this._meSel;
        const parent = ms.getModule(parentId);
        const esc = this._esc.bind(this);
        const flows = Object.keys(parent.flows || {});
        if (!flows.includes('main')) flows.unshift('main');
        const flowSel = this._meFlowSel ? this._meFlowSel.flow : 'main';
        const flowOpts = flows.map((f) => `<option value="${esc(f)}"${f === flowSel ? ' selected' : ''}>${f === 'main' ? I18n.t('主流程') : esc(this._flowName(f, parent))}</option>`).join('');
        const html = '<div class="me-dialog">' +
            `<label class="mjx-flab" for="me-new-name">${I18n.t('名称')}</label><input type="text" class="mjx-fin" id="me-new-name" placeholder="${I18n.t('事件名称')}" autocomplete="off">` +
            `<label class="mjx-flab" for="me-new-type">${I18n.t('类型')}</label><select id="me-new-type" class="mjx-fin">${this._meOpt(this._ME_TYPES.map((t) => [t, this._TYC[t]]), 'trigger_chain')}</select>` +
            (flows.length > 1 ? `<label class="mjx-flab" for="me-new-flow">${I18n.t('放入')}</label><select id="me-new-flow" class="mjx-fin">${flowOpts}</select>` : '') +
            '</div>';
        Modal.show(I18n.t('新建事件'), html, {
            buttons: [{ label: I18n.t('取消'), action: 'cancel' }, { label: I18n.t('新建'), action: 'ok', class: 'btn-primary' }],
            onAction: (action) => {
                if (action !== 'ok') { Modal.close(); return; }
                const name = document.getElementById('me-new-name').value;
                const type = document.getElementById('me-new-type').value;
                const fsel = document.getElementById('me-new-flow');
                const flow = fsel ? fsel.value : flowSel;
                Modal.close();
                const r = this._meDo((ed) => ed.addChild(parentId, flow, { name, type }), { panel: false });
                if (r.ok) {
                    this._meCollapsed['MET|' + parentId] = false;
                    this._meCollapsed['MET|F|' + parentId + '|' + flow] = false;
                    this._meSelect(r.result);
                }
            }
        });
        setTimeout(() => { const i = document.getElementById('me-new-name'); if (i) i.focus(); }, 50);
    },

    async _meAddFlowDialog() {
        const name = await Modal.prompt(I18n.t('新建分流程'), I18n.t('分流程名称'));
        if (name == null) return;
        const parentId = this._meSel;
        const r = this._meDo((ed) => ed.addFlow(parentId, name), { panel: false });
        if (r.ok) this._meSelectFlow(parentId, r.result);
    },

    async _meDeleteFlow() {
        const { parentId, flow } = this._meFlowSel;
        const mod = this.moduleSystem.getModule(parentId);
        const n = mod.getFlowSubModules(flow).size;
        const ok = await Modal.confirm(I18n.t('删除分流程'), n ? I18n.t('删除分流程「{name}」及其下 {n} 个事件。', { name: this._esc(this._flowName(flow, mod)), n }) : I18n.t('删除分流程「{name}」。', { name: this._esc(this._flowName(flow, mod)) }), { confirmLabel: I18n.t('删除'), danger: true });
        if (!ok) return;
        const nm = this._flowName(flow, mod);
        const r = this._meDo((ed) => ed.deleteFlow(parentId, flow), { panel: false });
        if (r.ok) {
            this._meFlowSel = null;
            this._meAfterEdit();
            this._meUndoSnapshotToast(I18n.t('已删除分流程「{name}」。', { name: nm }));
        }
    },

    /** 搜索选择：在按钮下方弹出带搜索框的选项列表；再点按钮收起 */
    _mePickEntryEvent() {
        const pop = document.getElementById('me-pickpop');
        if (!pop) return;
        if (!pop.hidden) { pop.hidden = true; return; }
        const ms = this.moduleSystem;
        const esc = this._esc.bind(this);
        const { parentId, flow } = this._meFlowSel;
        const skip = new Set();
        const mod = ms.getModule(parentId);
        mod.getFlowSubModules(flow).forEach((c) => ms._getAllDescendantIds(c.id).forEach((i) => skip.add(i)));
        const items = [];
        ms.modules.forEach((x) => { if (x.id !== ms.rootModuleId && !skip.has(x.id)) items.push(x); });
        pop.hidden = false;
        pop.innerHTML = `<input type="text" class="mjx-fin me-picksearch" placeholder="${I18n.t('搜索事件')}" autocomplete="off"><div class="me-pickopts"></div>`;
        const input = pop.querySelector('input');
        const box = pop.querySelector('.me-pickopts');
        const draw = () => {
            const s = input.value.trim().toLowerCase();
            const list = items.filter((x) => !s || String(x.name || '').toLowerCase().includes(s));
            box.innerHTML = list.length ? list.map((x) => `<button type="button" class="me-pickopt" data-pick="${esc(x.id)}">${esc(x.name || I18n.t('未命名'))}</button>`).join('') : `<div class="me-pickempty">${I18n.t('没有匹配的事件。')}</div>`;
        };
        input.addEventListener('input', draw);
        pop.addEventListener('click', (e) => {
            const b = e.target.closest('[data-pick]');
            if (!b) return;
            pop.hidden = true;
            this._meDo((ed) => ed.setFlowEntryEvent(parentId, flow, b.getAttribute('data-pick')));
        });
        draw();
        input.focus();
    },

    // ---- 插件（面板里的行由插件相关代码渲染与绑定）----

    _addPluginRegistration() {
        if (window.PluginEditor) PluginEditor.add(this);
    },

    /** 插件区块里的编辑与点击由插件编辑器绑定 */
    _bindPluginRows(side) {
        if (window.PluginEditor) PluginEditor.bind(this, side);
    }
});
