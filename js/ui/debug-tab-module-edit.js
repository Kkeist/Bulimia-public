/**
 * 调试页「模组编辑」标签：左侧事件树 + 顶部操作栏；右侧编辑面板见 debug-module-edit-panel.js。
 * 所有修改都经 ModuleEditor（js/core/module-editor.js）落在配置上，再整体生效并同步给游戏；
 * 撤销、重做、导出、覆盖原文件用的是同一份配置。
 * 扩展 DebugModuleJump（debug-module-jump.js 先加载）。
 */
Object.assign(DebugModuleJump, {
    _ME_TYPES: ['timeline', 'trigger_chain', 'free_trigger'],

    // ---- 编辑器与状态 ----

    _meEditor() {
        const ms = this.moduleSystem;
        if (!ms) return null;
        if (!this._editor || this._editor.ms !== ms) {
            this._editor = new ModuleEditor(ms, this.variableSystem);
            this._meClipboard = null;
            this._meFlowSel = null;
        }
        return this._editor;
    },

    _meToast(message, type) {
        if (window.Toast) window.Toast.show(message, type || 'success');
    },

    /** 执行一次编辑：成功后刷新界面并同步到游戏；失败时给出原因，模组保持不变 */
    _meDo(fn, opts = {}) {
        const ed = this._meEditor();
        try {
            const result = fn(ed);
            this._meAfterEdit(opts);
            return { ok: true, result };
        } catch (e) {
            if (e && e.name === 'EditError') {
                this._meToast(e.message, 'error');
                return { ok: false, error: e };
            }
            console.error('模组编辑出错', e);
            this._meToast('修改没有成功：' + (e && e.message ? e.message : '未知原因'), 'error');
            return { ok: false, error: e };
        }
    },

    /** 编辑之后：同步游戏里实际使用的模组与进度，再刷新界面（panel: false 时保留右侧面板，避免打断输入） */
    _meAfterEdit(opts = {}) {
        const ed = this._meEditor();
        const config = ed.getConfig();
        if (window.ModuleManager && ModuleManager.applyConfig) ModuleManager.applyConfig(config);
        if (window.App && App.setEngineConfig) App.setEngineConfig(config);
        this.syncToState();
        this._meRenderHeader();
        this._meRenderTree();
        if (opts.panel !== false) this._meRenderPanel();
        else this._meRenderCrumb();
    },

    // ---- 外壳 ----

    renderModuleEditTab() {
        const box = document.querySelector('#debug-panel-module-edit .module-editor') || document.getElementById('debug-panel-module-edit');
        if (!box) return;
        const ms = this.moduleSystem;
        if (!ms || !ms.rootModuleId) {
            box.innerHTML = '<div class="mjx"><div class="mjx-empty">还没有加载模组。</div></div>';
            return;
        }
        this._meEditor();
        if (!this._meSel || !ms.getModule(this._meSel)) this._meSel = ms.rootModuleId;
        if (!this._meCollapsed) this._meCollapsed = {};
        this._selId = this._meSel;
        this._editVars = null;
        this._mode = 'edit';
        if (!box.querySelector('#mjx-me')) {
            box.innerHTML = '<div class="mjx" id="mjx-me">' +
                '<div class="me-header" id="me-header"></div>' +
                '<div class="mjx-pl-wrap me-wrap">' +
                '<div class="mjx-pl-left me-left">' +
                '<div class="me-search"><input type="text" id="me-search" placeholder="搜索事件" autocomplete="off"><button type="button" class="me-x" id="me-search-clear" aria-label="清空搜索">×</button></div>' +
                '<div class="me-crumb" id="me-crumb"></div>' +
                '<div class="me-clipbar" id="me-clipbar" hidden></div>' +
                '<div class="me-tree" id="me-tree"></div></div>' +
                '<div class="mjx-pl-right mjx-side me-right" id="me-panel"></div></div>' +
                '<input type="file" id="me-import-file" accept="application/json,.json" hidden></div>';
            this._meBind(box.querySelector('#mjx-me'));
        }
        this._meExpandToSelection();
        this._meRenderHeader();
        this._meRenderTree();
        this._meRenderPanel();
    },

    _meBind(root) {
        root.addEventListener('click', (e) => {
            const act = e.target.closest('[data-meact]');
            if (act && root.contains(act)) { e.stopPropagation(); this._meOnAction(act.getAttribute('data-meact'), act); return; }
            const col = e.target.closest('[data-mecol]');
            if (col && root.contains(col)) { e.stopPropagation(); this._meToggle(col.getAttribute('data-mecol')); return; }
            const sel = e.target.closest('[data-mesel]');
            if (sel && root.contains(sel)) { e.stopPropagation(); this._meSelect(sel.getAttribute('data-mesel')); return; }
            const fl = e.target.closest('[data-meflow]');
            if (fl && root.contains(fl)) { e.stopPropagation(); const [pid, fk] = fl.getAttribute('data-meflow').split('\u0001'); this._meSelectFlow(pid, fk); return; }
        });
        const search = root.querySelector('#me-search');
        search.addEventListener('input', () => { this._meSearch = search.value; this._meRenderTree(); });
        root.querySelector('#me-search-clear').addEventListener('click', () => { search.value = ''; this._meSearch = ''; this._meRenderTree(); search.focus(); });
        root.querySelector('#me-import-file').addEventListener('change', (e) => {
            const f = e.target.files && e.target.files[0];
            e.target.value = '';
            if (f) this._meImportFile(f);
        });
    },

    _meOnAction(name, el) {
        switch (name) {
            case 'undo': this._meUndo(); break;
            case 'redo': this._meRedo(); break;
            case 'restore': this._meRestoreImport(); break;
            case 'export': this._meExportNewModule(); break;
            case 'overwrite': this._meOverwriteOriginal(); break;
            case 'newmod': this._meNewModule(); break;
            case 'import': document.getElementById('me-import-file').click(); break;
            case 'problems': this._meShowProblems(); break;
            case 'clipclear': this._meClipboard = null; this._meRenderClip(); this._meRenderTree(); break;
            default: this._mePanelAction(name, el);
        }
    },

    // ---- 顶部操作栏 ----

    _meRenderHeader() {
        const h = document.getElementById('me-header');
        const ed = this._meEditor();
        if (!h || !ed) return;
        const check = ed.problems();
        const pc = check.errors.length + check.warnings.length;
        const dirty = ed.isDirty();
        const btn = (act, label, kind = '', extra = '') => `<button type="button" class="mjx-b me-btn${kind ? ' is-' + kind : ''}" data-meact="${act}" ${extra}>${label}</button>`;
        // 左边是撤回、重做与丢弃改动，右边是模组文件操作，「覆盖原模组」是这一页的主操作
        const html =
            btn('undo', '撤回' + (ed.undoCount ? `（${ed.undoCount}）` : ''), 'ghost', ed.undoCount ? '' : 'disabled') +
            btn('redo', '重做' + (ed.redoCount ? `（${ed.redoCount}）` : ''), 'ghost', ed.redoCount ? '' : 'disabled') +
            btn('restore', '恢复导入状态', 'danger') +
            `<span class="me-spacer"></span>` +
            btn('newmod', '新建模组') +
            btn('import', '导入模组') +
            btn('export', '导出新模组') +
            btn('overwrite', '覆盖原模组', 'primary') +
            `<span class="me-status${dirty ? ' is-dirty' : ''}">${dirty ? '有未保存的改动' : '没有未保存的改动'}</span>` +
            (pc ? `<button type="button" class="me-problems" data-meact="problems">${pc} 条提示</button>` : '');
        if (h.__html !== html) { h.innerHTML = html; h.__html = html; }
    },

    _meShowProblems() {
        const ed = this._meEditor();
        const check = ed.problems();
        const esc = this._esc.bind(this);
        const rows = [...check.errors, ...check.warnings].map((p) => `<li>${esc(p.message)}</li>`).join('');
        if (window.Modal) Modal.alert('模组检查', `<ul class="me-problist">${rows || '<li>没有发现问题。</li>'}</ul>`);
    },

    _meRenderCrumb() {
        const el = document.getElementById('me-crumb');
        const ms = this.moduleSystem;
        if (!el || !ms) return;
        const esc = this._esc.bind(this);
        const chain = [];
        let cur = ms.getModule(this._meSel);
        while (cur) { chain.unshift(cur); cur = cur.parentModuleId ? ms.getModule(cur.parentModuleId) : null; }
        el.innerHTML = chain.map((m, i) => `<button type="button" class="me-crumbbtn${i === chain.length - 1 ? ' on' : ''}" data-mesel="${esc(m.id)}">${esc(m.name || '未命名')}</button>`).join('<span class="me-sep">/</span>');
    },

    _meRenderClip() {
        const el = document.getElementById('me-clipbar');
        if (!el) return;
        const cb = this._meClipboard;
        if (!cb) { el.hidden = true; el.innerHTML = ''; return; }
        const m = this.moduleSystem.getModule(cb.id);
        el.hidden = false;
        el.innerHTML = `<span>${cb.mode === 'copy' ? '已复制' : '已剪切'}「${this._esc(m ? m.name : '')}」，在目标事件的编辑面板里点粘贴。</span><button type="button" class="me-x" data-meact="clipclear" aria-label="取消">×</button>`;
    },

    // ---- 左侧事件树 ----

    _meExpandToSelection() {
        const ms = this.moduleSystem;
        let cur = ms.getModule(this._meSel);
        while (cur) {
            this._meCollapsed['MET|' + cur.id] = false;
            if (cur.parentModuleId) {
                this._meCollapsed['MET|F|' + cur.parentModuleId + '|' + cur.flowName] = false;
                this._meCollapsed['MET|T|' + cur.parentModuleId + '|' + cur.flowName + '|' + cur.type] = false;
            }
            cur = cur.parentModuleId ? ms.getModule(cur.parentModuleId) : null;
        }
    },

    _meMatches(m) {
        const s = (this._meSearch || '').trim().toLowerCase();
        return !s || String(m.name || '').toLowerCase().includes(s);
    },

    _meSubtreeMatches(m) {
        if (this._meMatches(m)) return true;
        return m.getAllSubModules().some((c) => this._meSubtreeMatches(c));
    },

    _meTreeHtml() {
        const ms = this.moduleSystem;
        const esc = this._esc.bind(this);
        const root = ms.getModule(ms.rootModuleId);
        const col = (k) => !!this._meCollapsed[k];
        const searching = !!(this._meSearch || '').trim();
        const out = [];
        const node = (s, depth, idx, total) => {
            if (!this._meSubtreeMatches(s)) return;
            const hasKids = s.getAllSubModules().length > 0;
            const ck = 'MET|' + s.id;
            const collapsed = col(ck) && !searching;
            const sel = s.id === this._meSel && !this._meFlowSel;
            const cut = this._meClipboard && this._meClipboard.mode === 'cut' && this._meClipboard.id === s.id;
            out.push(`<div class="mjx-me-node${sel ? ' on' : ''}${cut ? ' mjx-cut' : ''}${searching && !this._meMatches(s) ? ' mjx-faded' : ''}" style="--d:${Math.min(depth, 8)}">` +
                (hasKids ? `<button type="button" class="mjx-cw mjx-cbtn" data-mecol="${esc(ck)}" aria-label="展开或收起">${this._caretHtml(collapsed)}</button>` : '<span class="mjx-cw"></span>') +
                `<button type="button" class="mjx-me-name" data-mesel="${esc(s.id)}"><span class="mjx-pl-n">${esc(s.name || '未命名')}</span>` +
                `<span class="mjx-pl-t">${esc(this._TYC[s.type] || '')}</span>` +
                (total > 1 && s.type !== 'free_trigger' ? `<span class="mjx-me-ord">第 ${idx + 1}/${total}</span>` : '') + '</button></div>');
            if (hasKids) {
                out.push(`<div class="mjx-children" data-childof="${esc(ck)}" data-collapsed="${collapsed ? '1' : '0'}">`);
                flowsOf(s, depth + 1);
                out.push('</div>');
            }
        };
        const groups = (mod, fn, depth) => {
            const list = [...mod.getFlowSubModules(fn).values()];
            if (!list.length) { out.push('<div class="me-emptyflow">还没有事件。</div>'); return; }
            const byType = {};
            list.forEach((x) => { (byType[x.type] = byType[x.type] || []).push(x); });
            const types = this._ME_TYPES.filter((t) => byType[t]).concat(Object.keys(byType).filter((t) => !this._ME_TYPES.includes(t)));
            types.forEach((t) => {
                const ordered = t === 'trigger_chain' ? mod.getFlowSubModules(fn) && [...this.moduleSystem._getTriggerChainOrder(fn, mod.id)].map((id) => ms.getModule(id)).filter(Boolean)
                    : (t === 'timeline' ? this.moduleSystem._getTimelinesInGroup(fn, mod.id) : byType[t]);
                const tk = 'MET|T|' + mod.id + '|' + fn + '|' + t;
                const tcol = col(tk) && !searching;
                out.push(`<div class="mjx-typegroup mjx-tg-${esc(t)}" style="--d:${Math.min(depth, 8)}"><div class="mjx-typehead" data-mecol="${esc(tk)}"><span class="mjx-cw mjx-cae">${this._caretHtml(tcol)}</span><span class="mjx-th-t">${esc(this._TYC[t] || '其他')}（${ordered.length}）</span></div>` +
                    `<div class="mjx-typebody" data-childof="${esc(tk)}" data-collapsed="${tcol ? '1' : '0'}">`);
                ordered.forEach((s, i) => node(s, depth, i, ordered.length));
                out.push('</div></div>');
            });
        };
        const flowsOf = (mod, depth) => {
            const names = Object.keys(mod.flows || {});
            for (const k of mod.subModules.keys()) if (!names.includes(k)) names.push(k);
            names.sort((a, b) => (a === 'main' ? -1 : b === 'main' ? 1 : 0));
            names.forEach((fn) => {
                const count = mod.getFlowSubModules(fn).size;
                if (fn === 'main' && !count && mod.id !== root.id) return;
                const fk = 'MET|F|' + mod.id + '|' + fn;
                const fcol = col(fk) && !searching;
                const selF = this._meFlowSel && this._meFlowSel.parentId === mod.id && this._meFlowSel.flow === fn;
                out.push(`<div class="mjx-flowgroup${fn === 'main' ? '' : ' mjx-fg-br'}"><div class="mjx-flowhead${selF ? ' me-on' : ''}">` +
                    `<button type="button" class="mjx-cw mjx-cbtn" data-mecol="${esc(fk)}" aria-label="展开或收起">${this._caretHtml(fcol)}</button>` +
                    `<button type="button" class="me-flowname" data-meflow="${esc(mod.id)}\u0001${esc(fn)}">${fn === 'main' ? '主流程' : '分流程：' + esc(this._flowName(fn, mod))}（${count}）</button></div>` +
                    `<div class="mjx-flowbody" data-childof="${esc(fk)}" data-collapsed="${fcol ? '1' : '0'}">`);
                groups(mod, fn, depth);
                out.push('</div></div>');
            });
        };
        const rootCol = col('MET|ROOT') && !searching;
        out.push(`<div class="mjx-me-node mjx-node-root${this._meSel === root.id && !this._meFlowSel ? ' on' : ''}">` +
            `<button type="button" class="mjx-cw mjx-cbtn" data-mecol="MET|ROOT" aria-label="展开或收起">${this._caretHtml(rootCol)}</button>` +
            `<button type="button" class="mjx-me-name" data-mesel="${esc(root.id)}"><span class="mjx-pl-n">${esc(root.name || '未命名')}</span><span class="mjx-pl-t">故事</span></button></div>`);
        out.push(`<div class="mjx-root-children" data-childof="MET|ROOT" data-collapsed="${rootCol ? '1' : '0'}">`);
        flowsOf(root, 0);
        out.push('</div>');
        return out.join('');
    },

    _meRenderTree() {
        const el = document.getElementById('me-tree');
        if (!el) return;
        const left = el.closest('.me-left');
        const top = left ? left.scrollTop : 0;
        const html = this._meTreeHtml();
        if (el.__html !== html) { el.innerHTML = html; el.__html = html; }
        if (left) left.scrollTop = top;
        this._meRenderCrumb();
        this._meRenderClip();
    },

    _meToggle(key) {
        const next = !this._meCollapsed[key];
        this._meCollapsed[key] = next;
        const root = document.getElementById('mjx-me');
        const body = root.querySelector(`[data-childof="${key.replace(/"/g, '\\"')}"]`);
        if (body) body.setAttribute('data-collapsed', next ? '1' : '0');
        const head = root.querySelector(`[data-mecol="${key.replace(/"/g, '\\"')}"]`);
        const c = head && (head.classList.contains('mjx-cbtn') ? head : head.querySelector('.mjx-cae'));
        this._setCaret(c, next);
        const tree = document.getElementById('me-tree');
        if (tree) tree.__html = null;
    },

    _meSelect(id) {
        this._meSel = id;
        this._selId = id;
        this._meFlowSel = null;
        this._editVars = null;
        this._meRenderTree();
        this._meRenderPanel();
    },

    _meSelectFlow(parentId, flow) {
        this._meFlowSel = { parentId, flow };
        this._meSel = parentId;
        this._selId = parentId;
        this._meRenderTree();
        this._meRenderPanel();
    },

    // ---- 撤销、重做、恢复 ----

    _meUndo() {
        const ed = this._meEditor();
        if (!ed.undo()) { this._meToast('没有可撤回的操作。', 'warning'); return; }
        this._meAfterEdit();
    },

    _meRedo() {
        const ed = this._meEditor();
        if (!ed.redo()) { this._meToast('没有可重做的操作。', 'warning'); return; }
        this._meAfterEdit();
    },

    async _meRestoreImport() {
        const ed = this._meEditor();
        const ok = await Modal.confirm('恢复导入状态', ed.isDirty() ? '当前的修改会全部放弃，回到导入时的内容。可以用撤回找回。' : '当前没有修改，内容与导入时一致。', { confirmLabel: '恢复' });
        if (!ok) return;
        ed.restoreBaseline();
        this._meAfterEdit();
        this._meToast('已恢复导入状态。');
    },

    // ---- 新建、导入、导出、覆盖 ----

    async _meNewModule() {
        const name = await Modal.prompt('新建模组', '模组名称');
        if (name == null) return;
        let cfg;
        try { cfg = ModuleEditor.createBlank(name); }
        catch (e) { this._meToast(e.message, 'error'); return; }
        await this._meLoadConfig(cfg, '已新建模组。');
    },

    /** 把一份配置作为新模组加入并切换过去，调试页随之重建 */
    async _meLoadConfig(cfg, doneText) {
        const module = ModuleManager.addFromConfig(cfg);
        if (!ModuleManager.load(module.id)) { this._meToast('切换到新模组失败。', 'error'); return; }
        window.__debugBridgeModuleId = null;
        if (window.App && App.setEngineConfig) App.setEngineConfig(JSON.parse(JSON.stringify(cfg)));
        this._editor = null;
        this._meSel = null;
        this._meFlowSel = null;
        await App.buildDebugBridgeAndInitModuleJump();
        if (window.App && App.loadModuleList) App.loadModuleList();
        this.renderModuleEditTab();
        this._meToast(doneText);
    },

    async _meImportFile(file) {
        let data;
        try { data = JSON.parse(await file.text()); }
        catch (e) { await Modal.alert('导入模组', '文件内容不是有效的模组，请确认导入的是导出的模组文件。'); return; }
        if (!data || typeof data !== 'object' || Array.isArray(data) || data.content) {
            await Modal.alert('导入模组', '文件内容不是有效的模组。');
            return;
        }
        const check = ModuleSystem.validateConfig(data);
        const esc = this._esc.bind(this);
        const list = (items) => `<ul class="me-problist">${items.map((p) => `<li>${esc(p.message)}</li>`).join('')}</ul>`;
        if (check.errors.length) {
            await Modal.alert('无法导入', `这个文件有以下问题，需要先修正：${list(check.errors)}`);
            return;
        }
        if (check.warnings.length) {
            const ok = await Modal.confirm('导入模组', `这个文件有以下提示，仍然导入吗？${list(check.warnings)}`, { confirmLabel: '仍然导入' });
            if (!ok) return;
        }
        await this._meLoadConfig(data, '已导入模组。');
    },

    _meExportNewModule() {
        const ed = this._meEditor();
        try {
            const data = ed.getConfig();
            FileDownload.save(JSON.stringify(data, null, 2), data.name || 'module', 'json', 'application/json');
            this._meToast('已开始下载。');
        } catch (e) {
            console.error('导出失败', e);
            this._meToast('导出失败：' + e.message, 'error');
        }
    },

    async _meOverwriteOriginal() {
        const ed = this._meEditor();
        const caps = window.APIConnection ? await APIConnection.probeCapabilities() : null;
        const folder = (window.ModuleManager && ModuleManager.currentModule && ModuleManager.currentModule.folderKey) || '';
        if ((caps && !caps.moduleWrite) || !folder) {
            this._meToast(folder ? '在线版本不能覆盖原模组文件，已改为下载新的模组文件。' : '这个模组没有对应的文件，已改为下载新的模组文件。', 'warning', 6000);
            this._meExportNewModule();
            return;
        }
        const check = ed.problems();
        if (check.errors.length) { await Modal.alert('覆盖原模组', '模组还有必须处理的问题，不能保存。'); return; }
        const ok = await Modal.confirm('覆盖原模组', '原文件会被当前内容替换，替换前自动备份一份。', { confirmLabel: '覆盖', danger: true });
        if (!ok) return;
        const data = ed.getConfig();
        try {
            const bk = await fetch(`/api/modules/${encodeURIComponent(folder)}/backup`, { method: 'POST' });
            if (!bk.ok) throw new Error('备份没有成功，原文件未改动。');
            const res = await fetch(`/api/modules/${encodeURIComponent(folder)}/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error((body && body.message) || '保存没有成功，原文件未改动。');
            }
            ed.markSaved();
            this._meRenderHeader();
            this._meToast('已覆盖原模组，原文件已备份。');
        } catch (e) {
            this._meToast(e.message, 'error', 6000);
        }
    },

    // ---- 剪切、复制、粘贴（快捷键与编辑面板共用）----

    _meCutNode(id) {
        if (id === this.moduleSystem.rootModuleId) { this._meToast('故事根不能剪切。', 'error'); return; }
        this._meClipboard = { mode: 'cut', id };
        this._meRenderClip(); this._meRenderTree();
    },

    _meCopyNode(id) {
        if (id === this.moduleSystem.rootModuleId) { this._meToast('故事根不能复制。', 'error'); return; }
        this._meClipboard = { mode: 'copy', id };
        this._meRenderClip(); this._meRenderTree();
    },

    _mePasteNode(targetId, flow) {
        const cb = this._meClipboard;
        if (!cb) { this._meToast('没有可粘贴的内容，先剪切或复制一个事件。', 'warning'); return; }
        const r = this._meDo((ed) => (cb.mode === 'cut' ? ed.moveTo(cb.id, targetId, flow || 'main') : ed.duplicate(cb.id, targetId, flow || 'main')));
        if (r.ok) {
            if (cb.mode === 'cut') this._meClipboard = null;
            this._meRenderClip();
            this._meToast(cb.mode === 'cut' ? '已移动。' : '已复制。');
        }
    },

    /** 删除之后的撤销入口；删除之后又做了别的修改时，只提示去用顶部的撤回，避免撤销到别的修改 */
    _meUndoSnapshotToast(text) {
        const ed = this._meEditor();
        const version = ed.version;
        Toast.undo(text, () => {
            if (this._meEditor() !== ed || ed.version !== version) {
                this._meToast('删除之后又做了别的修改，请用上方的撤回。', 'warning');
                return;
            }
            this._meUndo();
        });
    },

    /** 删除当前选中的事件（快捷键与编辑面板共用），删完提供撤销 */
    async _deleteCurrentNode() {
        const ms = this.moduleSystem;
        const id = this._meSel || this._selId;
        const m = ms.getModule(id);
        if (!m) return;
        if (m.id === ms.rootModuleId) { this._meToast('故事根不能删除。', 'error'); return; }
        const n = ms._getAllDescendantIds(id).length - 1;
        const ok = await Modal.confirm('删除事件', `删除「${this._esc(m.name || '未命名')}」${n > 0 ? `及其下 ${n} 个事件` : ''}。`, { confirmLabel: '删除', danger: true });
        if (!ok) return;
        const parent = m.parentModuleId;
        const r = this._meDo((ed) => ed.deleteNode(id), { panel: false });
        if (r.ok) {
            this._meSel = parent || ms.rootModuleId;
            this._selId = this._meSel;
            this._meFlowSel = null;
            this._meAfterEdit();
            this._meUndoSnapshotToast(`已删除「${m.name || '未命名'}」。`);
        }
    }
});

// 有没保存的改动时，关闭或刷新页面前让浏览器先问一句
window.addEventListener('beforeunload', (e) => {
    const ed = DebugModuleJump._editor;
    if (ed && ed.isDirty()) {
        e.preventDefault();
        e.returnValue = '';
    }
});
