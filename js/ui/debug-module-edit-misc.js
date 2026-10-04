/**
 * 模组编辑标签里的其余区块：标签、背景、投递、提示词里的队列显示，以及故事根的模组信息和时间设置。
 * 背景和投递同变量一样先改草稿，改动后通过 ModuleEditor 整体提交；提交失败时原因显示在区块内，草稿保留。
 * 扩展 DebugModuleJump（debug-module-edit-panel.js 先加载）。
 */
Object.assign(DebugModuleJump, {
    // ---- 工具 ----

    _meWrap(def) {
        return (def && Array.isArray(def.groups) && def.groups.some((g) => g && Array.isArray(g.items) && g.items.length)) ? [{ type: 'precondition', conditionDef: def }] : [];
    },

    _meDefOf(wrapper) {
        const w = Array.isArray(wrapper) ? wrapper[0] : wrapper;
        return (w && w.conditionDef && Array.isArray(w.conditionDef.groups)) ? w.conditionDef : { logic: 'OR', groups: [] };
    },

    _meHasCond(wrapper) {
        return this._meDefOf(wrapper).groups.some((g) => g && g.items && g.items.length);
    },

    /**
     * 条件编辑器只在所在的折叠块展开时才挂上：折起来的块里有几十个编辑器，一次全画出来会卡住页面。
     * 之后块被展开时（toggle 事件）再补挂。mountOne(host) 负责挂一个。
     */
    _meMountHosts(box, mountOne) {
        if (!box) return;
        box.__mountOne = mountOne;
        const run = (scope) => scope.querySelectorAll('[data-cbhost]').forEach((host) => {
            if (host.hasAttribute('data-mounted')) return;
            const d = host.closest('details');
            if (d && !d.open) return;
            host.setAttribute('data-mounted', '1');
            box.__mountOne(host);
        });
        run(box);
        if (!box.__lazyCond) {
            box.__lazyCond = true;
            box.addEventListener('toggle', (e) => {
                if (!e.target.open) return;
                run(e.target);
                if (window.FormControls) FormControls.enhance(e.target);
            }, true);
        }
    },

    /** 把草稿区块里的条件编辑器逐个挂上；onChange 把新条件写回草稿 */
    _meMountDraftConds(box, getDraft, commit) {
        if (typeof window.ConditionBuilder === 'undefined' || !box) return;
        const opts = this._meCondOptions();
        this._meMountHosts(box, (host) => {
            const idx = Number(host.getAttribute('data-cbhost').split('|')[1]);
            const item = getDraft()[idx];
            if (!item) return;
            ConditionBuilder.mount(host, this._meDefOf(item.condition), {
                variables: opts.variables, modules: opts.modules, units: opts.units,
                onChange: (value) => {
                    const cur = getDraft()[idx];
                    if (!cur) return;
                    cur.condition = this._meWrap(value)[0] || null;
                    commit(false);
                },
                onRemoved: (msg) => this._meUndoSnapshotToast(msg)
            });
        });
        if (window.FormControls) FormControls.enhance(box);
    },

    _meShowErr(id, msg, soft) {
        const el = document.getElementById(id);
        if (!el) return;
        el.hidden = !msg;
        el.classList.toggle('me-hintline', !!soft);
        el.textContent = msg || '';
    },

    /** 提交一份草稿：成功清掉提示并同步游戏，失败把原因写在区块里 */
    _meCommitDraft(errId, apply, redraw, softMsg) {
        let ok = false;
        try {
            apply();
            this._meShowErr(errId, softMsg || '', !!softMsg);
            this._meAfterEdit({ panel: false });
            ok = true;
        } catch (e) {
            if (e && e.name === 'EditError') this._meShowErr(errId, e.message);
            else { console.error(e); this._meShowErr(errId, I18n.t('没有保存成功：') + (e && e.message ? e.message : I18n.t('未知原因'))); }
        }
        if (redraw) redraw();
        return ok;
    },

    // ---- 标签 ----

    _meTagsMount(m) {
        const host = document.getElementById('me-tags');
        if (!host || !window.TagList) return;
        const list = TagList.create({
            values: Array.isArray(m.tags) ? m.tags : [],
            placeholder: I18n.t('添加标签'),
            onChange: (values) => { this._meDo((ed) => ed.setTags(m.id, values), { panel: false }); }
        });
        host.innerHTML = '';
        host.appendChild(list.el);
    },

    // ---- 背景 ----

    _meInfoDraftOf(m) {
        if (!this._meInfoDraft || this._meInfoDraftFor !== m.id) {
            this._meInfoDraft = (Array.isArray(m.info) ? m.info : []).map((x) => (typeof x === 'string' ? { content: x, condition: null } : JSON.parse(JSON.stringify(x))));
            this._meInfoDraftFor = m.id;
        }
        return this._meInfoDraft;
    },

    _meInfoHtml(m) {
        this._meInfoDraft = null;
        return this._meInfoRows(this._meInfoDraftOf(m));
    },

    /** 背景条数多时（日历条目有几千条）一次只画一部分，其余点「显示更多」；没填完的新背景始终显示 */
    _ME_INFO_PAGE: 20,

    _meInfoRows(list) {
        if (!list.length) return `<div class="mjx-qnone">${I18n.t('这个事件还没有背景。')}</div>`;
        if (this._meInfoShownFor !== this._meInfoDraftFor) { this._meInfoShownFor = this._meInfoDraftFor; this._meInfoShown = this._ME_INFO_PAGE; }
        const shown = Math.max(this._meInfoShown || this._ME_INFO_PAGE, 0);
        const card = (d, i) => `<div class="me-card" data-ii="${i}">` +
            `<textarea class="mjx-fta" data-ik="content" rows="3" placeholder="${I18n.t('背景内容')}" aria-label="${I18n.t('背景内容')}">${this._esc(d.content || '')}</textarea>` +
            `<div class="me-opt"><span class="me-optlab">${I18n.t('进入子事件后还发给 AI')}</span>${this._meSeg(`data-iseg="persistent" data-ii="${i}"`, d.persistent === true)}</div>` +
            `<details class="me-rules" data-dkey="info|${i}"${this._meHasCond(d.condition) ? ' open' : ''}><summary>${I18n.t('只在满足条件时发送')}</summary><div class="mjx-cbhost" data-cbhost="info|${i}"></div></details>` +
            `<div class="me-actrow"><button type="button" class="mjx-b mjx-b-untrig" data-meact="delinfo" data-ii="${i}">${I18n.t('删除')}</button></div></div>`;
        const rows = [];
        list.forEach((d, i) => { if (i < shown || d._new) rows.push(card(d, i)); });
        const hidden = list.length - rows.length;
        if (hidden > 0) {
            rows.splice(Math.min(shown, rows.length), 0, `<div class="me-more"><button type="button" class="mjx-b" data-meact="moreinfo">${I18n.t('显示更多（还有 {n} 条）', { n: hidden })}</button></div>`);
        }
        return rows.join('');
    },

    _meInfoCommit(redraw) {
        const m = this.moduleSystem.getModule(this._meSel);
        const draft = this._meInfoDraftOf(m);
        const payload = draft.filter((d) => !(d._new && !String(d.content || '').trim()));
        const pending = payload.length !== draft.length;
        return this._meCommitDraft('me-infoerr', () => this._meEditor().setInfoList(m.id, payload), redraw ? () => this._meRedrawInfo() : null, pending ? I18n.t('新背景填了内容才会保存。') : '');
    },

    _meRedrawInfo() {
        const box = document.getElementById('me-info');
        if (!box) return;
        const m = this.moduleSystem.getModule(this._meSel);
        this._meKeepDetails(box, () => {
            box.innerHTML = this._meInfoRows(this._meInfoDraftOf(m));
            if (window.FormControls) FormControls.enhance(box);
            this._meMountDraftConds(box, () => this._meInfoDraft, (r) => this._meInfoCommit(r));
        });
    },

    _meAddInfo() {
        const m = this.moduleSystem.getModule(this._meSel);
        this._meInfoDraftOf(m).push({ content: '', condition: null, _new: true });
        this._meRedrawInfo();
        const t = document.querySelectorAll('#me-info [data-ik="content"]');
        if (t.length) t[t.length - 1].focus();
        this._meShowErr('me-infoerr', I18n.t('新背景填了内容才会保存。'), true);
    },

    _meDelInfo(i) {
        const m = this.moduleSystem.getModule(this._meSel);
        const draft = this._meInfoDraftOf(m);
        const removed = draft.splice(i, 1)[0];
        if (!removed) return;
        if (removed._new && !String(removed.content || '').trim()) { this._meRedrawInfo(); this._meInfoCommit(false); return; }
        if (this._meInfoCommit(true)) this._meUndoSnapshotToast(I18n.t('已删除一条背景。'));
        else { draft.splice(i, 0, removed); this._meRedrawInfo(); }
    },

    _meInfoChange(t) {
        const card = t.closest('.me-card');
        const m = this.moduleSystem.getModule(this._meSel);
        const d = this._meInfoDraftOf(m)[Number(card.getAttribute('data-ii'))];
        if (!d || t.getAttribute('data-ik') !== 'content') return;
        d.content = t.value;
        this._meInfoCommit(false);
    },

    // ---- 投递 ----

    _meDelivDraftOf(m) {
        if (!this._meDelivDraft || this._meDelivFor !== m.id) {
            this._meDelivDraft = (m.deliveryInfo || []).map((d) => ({ title: d.title, content: d.content, condition: d.condition || null, completed: d.completed }));
            this._meDelivFor = m.id;
        }
        return this._meDelivDraft;
    },

    _meDelivHtml(m) {
        this._meDelivDraft = null;
        return this._meDelivRows(this._meDelivDraftOf(m));
    },

    _meDelivRows(list) {
        if (!list.length) return `<div class="mjx-qnone">${I18n.t('这个事件还没有投递。')}</div>`;
        return list.map((d, i) => `<div class="me-card" data-di="${i}">` +
            `<div class="me-varhead">${this._meTextLine('data-dk="title"', d.title, I18n.t('投递标题'), I18n.t('投递标题'))}<button type="button" class="mjx-b mjx-b-untrig" data-meact="deldeliv" data-di="${i}">${I18n.t('删除')}</button></div>` +
            `<textarea class="mjx-fta" data-dk="content" rows="2" placeholder="${I18n.t('投递内容')}" aria-label="${I18n.t('投递内容')}">${this._esc(d.content || '')}</textarea>` +
            `<details class="me-rules" data-dkey="deliv|${i}"${this._meHasCond(d.condition) ? ' open' : ''}><summary>${I18n.t('只在满足条件时出现')}</summary><div class="mjx-cbhost" data-cbhost="deliv|${i}"></div></details></div>`).join('');
    },

    _meDelivCommit(redraw) {
        const m = this.moduleSystem.getModule(this._meSel);
        const draft = this._meDelivDraftOf(m);
        const payload = draft.filter((d) => !(d._new && !String(d.title || '').trim()));
        const pending = payload.length !== draft.length;
        return this._meCommitDraft('me-deliverr', () => this._meEditor().setDeliveries(m.id, payload), redraw ? () => this._meRedrawDeliv() : null, pending ? I18n.t('新投递填了标题才会保存。') : '');
    },

    _meRedrawDeliv() {
        const box = document.getElementById('me-deliv');
        if (!box) return;
        const m = this.moduleSystem.getModule(this._meSel);
        this._meKeepDetails(box, () => {
            box.innerHTML = this._meDelivRows(this._meDelivDraftOf(m));
            if (window.FormControls) FormControls.enhance(box);
            this._meMountDraftConds(box, () => this._meDelivDraft, (r) => this._meDelivCommit(r));
        });
    },

    _meAddDeliv() {
        const m = this.moduleSystem.getModule(this._meSel);
        this._meDelivDraftOf(m).push({ title: '', content: '', condition: null, _new: true });
        this._meRedrawDeliv();
        const t = document.querySelectorAll('#me-deliv [data-dk="title"]');
        if (t.length) t[t.length - 1].focus();
        this._meShowErr('me-deliverr', I18n.t('新投递填了标题才会保存。'), true);
    },

    _meDelDeliv(i) {
        const m = this.moduleSystem.getModule(this._meSel);
        const draft = this._meDelivDraftOf(m);
        const removed = draft.splice(i, 1)[0];
        if (!removed) return;
        if (removed._new && !String(removed.title || '').trim()) { this._meRedrawDeliv(); this._meDelivCommit(false); return; }
        if (this._meDelivCommit(true)) this._meUndoSnapshotToast(I18n.t('已删除投递「{name}」。', { name: removed.title || I18n.t('未命名') }));
        else { draft.splice(i, 0, removed); this._meRedrawDeliv(); }
    },

    _meDelivChange(t) {
        const card = t.closest('.me-card');
        const m = this.moduleSystem.getModule(this._meSel);
        const d = this._meDelivDraftOf(m)[Number(card.getAttribute('data-di'))];
        const k = t.getAttribute('data-dk');
        if (!d || !k) return;
        d[k] = t.value;
        this._meDelivCommit(false);
    },

    // ---- 进入时设置变量 ----

    _meVarDefs() {
        const out = new Map();
        this.moduleSystem.modules.forEach((mm) => (mm.variables || []).forEach((x) => { if (x && x.id) out.set(x.id, x); }));
        return out;
    },

    _meSetDraftOf(m) {
        if (!this._meSetDraft || this._meSetDraftFor !== m.id) {
            const map = m.variableSetOnEnter && typeof m.variableSetOnEnter === 'object' ? m.variableSetOnEnter : {};
            this._meSetDraft = Object.keys(map).map((k) => ({ variableId: k, value: map[k] }));
            this._meSetDraftFor = m.id;
        }
        return this._meSetDraft;
    },

    _meSetHtml(m) {
        this._meSetDraft = null;
        return this._meSetRows(this._meSetDraftOf(m));
    },

    _meSetRows(list) {
        if (!list.length) return `<div class="mjx-qnone">${I18n.t('没有设置。')}</div>`;
        const defs = this._meVarDefs();
        const options = [...defs.values()].filter((d) => ['number', 'string', 'boolean'].includes(d.type));
        return list.map((r, i) => {
            const def = defs.get(r.variableId);
            const t = def ? def.type : 'string';
            const val = t === 'number'
                ? this._meNumberInput('data-sk2="value"', r.value)
                : (t === 'boolean'
                    ? `<select class="mjx-fin" data-sk2="value">${this._meOpt([['true', I18n.t('是')], ['false', I18n.t('否')]], r.value === true ? 'true' : 'false')}</select>`
                    : this._meTextLine('data-sk2="value"', r.value, I18n.t('值'), I18n.t('值')));
            const known = def ? '' : `<option value="${this._esc(r.variableId)}" selected>${I18n.t('（已删除的变量）')}</option>`;
            return `<div class="me-card" data-si="${i}"><div class="me-varhead">` +
                `<select class="mjx-fin" data-sk2="var" aria-label="${I18n.t('变量')}">${known}${options.map((d) => `<option value="${this._esc(d.id)}"${d.id === r.variableId ? ' selected' : ''}>${this._esc(d.name || I18n.t('未命名变量'))}</option>`).join('')}</select>` +
                `<span class="me-optlab">${I18n.t('设为')}</span>${val}` +
                `<button type="button" class="mjx-b mjx-b-untrig" data-meact="delset" data-si="${i}">${I18n.t('删除')}</button></div></div>`;
        }).join('');
    },

    _meSetCommit(redraw) {
        const m = this.moduleSystem.getModule(this._meSel);
        return this._meCommitDraft('me-seterr', () => this._meEditor().setVariableSetOnEnter(m.id, this._meSetDraftOf(m)), redraw ? () => this._meRedrawSet() : null);
    },

    _meRedrawSet() {
        const box = document.getElementById('me-set');
        if (!box) return;
        box.innerHTML = this._meSetRows(this._meSetDraftOf(this.moduleSystem.getModule(this._meSel)));
        if (window.FormControls) FormControls.enhance(box);
    },

    _meAddSet() {
        const m = this.moduleSystem.getModule(this._meSel);
        const draft = this._meSetDraftOf(m);
        const used = new Set(draft.map((r) => r.variableId));
        const def = [...this._meVarDefs().values()].find((d) => ['number', 'string', 'boolean'].includes(d.type) && !used.has(d.id));
        if (!def) { this._meShowErr('me-seterr', I18n.t('没有可以设置的变量了。')); return; }
        draft.push({ variableId: def.id, value: def.initialValue !== undefined ? def.initialValue : (def.type === 'number' ? 0 : (def.type === 'boolean' ? false : '')) });
        if (!this._meSetCommit(true)) { draft.pop(); this._meRedrawSet(); }
    },

    _meDelSet(i) {
        const m = this.moduleSystem.getModule(this._meSel);
        const draft = this._meSetDraftOf(m);
        const removed = draft.splice(i, 1)[0];
        if (!removed) return;
        if (this._meSetCommit(true)) this._meUndoSnapshotToast(I18n.t('已删除一条设置。'));
        else { draft.splice(i, 0, removed); this._meRedrawSet(); }
    },

    _meSetChange(t) {
        const card = t.closest('.me-card');
        const m = this.moduleSystem.getModule(this._meSel);
        const r = this._meSetDraftOf(m)[Number(card.getAttribute('data-si'))];
        if (!r) return;
        const k = t.getAttribute('data-sk2');
        const defs = this._meVarDefs();
        if (k === 'var') {
            const def = defs.get(t.value);
            r.variableId = t.value;
            r.value = def && def.initialValue !== undefined ? def.initialValue : (def && def.type === 'number' ? 0 : (def && def.type === 'boolean' ? false : ''));
            this._meSetCommit(true);
            return;
        }
        const def = defs.get(r.variableId);
        r.value = def && def.type === 'boolean' ? t.value === 'true' : (def && def.type === 'number' ? (t.value === '' ? 0 : Number(t.value)) : t.value);
        this._meSetCommit(false);
    },

    // ---- 时间线排序值 ----

    _meTrigHtml(m) {
        if (m.type !== 'timeline') return '';
        const has = m.triggerTime != null;
        return `<div class="me-opt"><span class="me-optlab">${I18n.t('排序值（越小越先）')}</span>${this._meSeg('data-trseg="1"', has, [I18n.t('设置'), I18n.t('不设')])}` +
            (has ? this._meNumberInput('data-trk="1"', m.triggerTime, 'min="0" step="1"') : '') + '</div>';
    },

    _meTrigRedraw() {
        const box = document.getElementById('me-trig');
        if (!box) return;
        box.innerHTML = this._meTrigHtml(this.moduleSystem.getModule(this._meSel));
        if (window.FormControls) FormControls.enhance(box);
    },

    _meTrigApply(value) {
        const r = this._meDo((ed) => ed.setTriggerTime(this._meSel, value), { panel: false });
        if (!r.ok) setTimeout(() => this._meTrigRedraw(), 0);
        return r.ok;
    },

    // ---- 提示词里的队列 ----

    _meQueueHtml(m) {
        const qd = m.queueDisplay && typeof m.queueDisplay === 'object' ? m.queueDisplay : null;
        const D = ModuleEditor.QUEUE_DEFAULT;
        return `<div class="me-opt"><span class="me-optlab">${I18n.t('显示数量')}</span>${this._meSeg('data-qseg="on"', !!qd, [I18n.t('自定义'), I18n.t('默认（之后 {after} 个，已完成 {before} 个）', { after: D.after, before: D.before })])}</div>` +
            (qd ? '<div class="me-grid">' +
                `<label>${I18n.t('之后的路线显示几个')}${this._meNumberInput('data-qk="after"', Number(qd.after) || 0, 'min="0" max="99" step="1"')}</label>` +
                `<label>${I18n.t('已完成的事件显示几个')}${this._meNumberInput('data-qk="before"', Number(qd.before) || 0, 'min="0" max="99" step="1"')}</label></div>` : '');
    },

    _meQueueRedraw() {
        const box = document.getElementById('me-queue');
        if (!box) return;
        box.innerHTML = this._meQueueHtml(this.moduleSystem.getModule(this._meSel));
        if (window.FormControls) FormControls.enhance(box);
    },

    _meQueueSeg(el) {
        const on = el.getAttribute('data-val') === '1';
        const D = ModuleEditor.QUEUE_DEFAULT;
        const r = this._meDo((ed) => ed.setQueueDisplay(this._meSel, on ? { before: D.before, after: D.after } : {}), { panel: false });
        if (r.ok) this._meQueueRedraw();
    },

    _meQueueChange(t) {
        const m = this.moduleSystem.getModule(this._meSel);
        const cur = m.queueDisplay || {};
        const next = { before: cur.before, after: cur.after };
        next[t.getAttribute('data-qk')] = t.value === '' ? null : Number(t.value);
        const r = this._meDo((ed) => ed.setQueueDisplay(this._meSel, next), { panel: false });
        if (!r.ok) setTimeout(() => this._meQueueRedraw(), 0);
    },

    // ---- 故事根：模组信息与时间 ----

    _meRootHtml(cfg) {
        const ts = cfg.timeSystem && typeof cfg.timeSystem === 'object' ? cfg.timeSystem : {};
        const iv = ts.initialValues && typeof ts.initialValues === 'object' ? ts.initialValues : {};
        const hasStart = ['year', 'month', 'day', 'hour', 'minute'].some((k) => iv[k] != null);
        const units = cfg.timeUnits && typeof cfg.timeUnits === 'object' ? cfg.timeUnits : null;
        const DEF_START = { year: 1, month: 1, day: 1, hour: 8, minute: 0 };
        const DEF_UNITS = { minutesPerHour: 60, hoursPerDay: 24, daysPerMonth: 30, monthsPerYear: 12 };
        const startBoxes = hasStart ? '<div class="me-grid">' + [['year', I18n.t('年')], ['month', I18n.t('月')], ['day', I18n.t('日')], ['hour', I18n.t('时')], ['minute', I18n.t('分')]].map(([k, lab]) =>
            `<label>${lab}${this._meNumberInput(`data-tk="start.${k}"`, iv[k] != null ? iv[k] : DEF_START[k], 'min="0" step="1"')}</label>`).join('') + '</div>' : '';
        const unitBoxes = units ? '<div class="me-grid">' + [['minutesPerHour', I18n.t('每小时的分钟')], ['hoursPerDay', I18n.t('每天的小时')], ['daysPerMonth', I18n.t('每月的天数')], ['monthsPerYear', I18n.t('每年的月数')]].map(([k, lab]) =>
            `<label>${lab}${this._meNumberInput(`data-tk="unit.${k}"`, units[k] != null ? units[k] : DEF_UNITS[k], 'min="1" step="1"')}</label>`).join('') + '</div>' : '';
        const tokens = [['year', I18n.t('年')], ['month', I18n.t('月')], ['day', I18n.t('日')], ['hour', I18n.t('时')], ['minute', I18n.t('分')]].map(([k, lab]) => `<button type="button" class="me-tok" data-meact="timetoken" data-token="${k}">${I18n.t('插入{lab}', { lab })}</button>`).join('');
        return `<section class="me-sec" id="me-metasec"><h4>${I18n.t('模组信息')}</h4>` +
            `<label class="mjx-flab" for="me-version">${I18n.t('版本')}</label>${this._meTextLine('id="me-version" data-mk="version"', cfg.version, I18n.t('例如 1.0.0'), I18n.t('版本'))}` +
            `<label class="mjx-flab" for="me-desc">${I18n.t('说明')}</label><textarea class="mjx-fta" id="me-desc" data-mk="description" rows="3" placeholder="${I18n.t('这个模组讲什么')}">${this._esc(cfg.description || '')}</textarea>` +
            `<p class="me-err" id="me-metaerr" hidden></p></section>` +
            `<section class="me-sec" id="me-timesec"><h4>${I18n.t('时间')}</h4>` +
            `<div class="me-opt"><span class="me-optlab">${I18n.t('新游戏的起始时间')}</span>${this._meSeg('data-tseg="start"', hasStart, [I18n.t('自定义'), I18n.t('默认')])}</div>${startBoxes}` +
            `<label class="mjx-flab" for="me-timefmt">${I18n.t('时间的显示格式')}</label>${this._meTextLine('id="me-timefmt" data-tk="format"', ts.displayFormat, I18n.t('例如 {{year}}年{{month}}月{{day}}日'), I18n.t('时间显示格式'))}` +
            `<div class="me-toks">${tokens}</div>` +
            `<div class="me-opt"><span class="me-optlab">${I18n.t('进位')}</span>${this._meSeg('data-tseg="units"', !!units, [I18n.t('自定义'), I18n.t('默认')])}</div>${unitBoxes}` +
            `<p class="me-err" id="me-timeerr" hidden></p></section>`;
    },

    _meRootDo(errId, fn) {
        const r = this._meDo(fn, { panel: false });
        if (!r.ok) { this._meShowErr(errId, r.error && r.error.message ? r.error.message : I18n.t('没有保存成功。')); return false; }
        this._meShowErr(errId, '');
        return true;
    },

    _meRootRedraw() {
        const cfg = this._meEditor().getConfig();
        const a = document.getElementById('me-metasec');
        const b = document.getElementById('me-timesec');
        if (!a || !b) return;
        const tmp = document.createElement('div');
        tmp.innerHTML = this._meRootHtml(cfg);
        b.replaceWith(tmp.querySelector('#me-timesec'));
        if (window.FormControls) FormControls.enhance(document.getElementById('me-timesec'));
    },

    _meTimeRead() {
        const box = document.getElementById('me-timesec');
        const start = {}; const units = {};
        let hasStart = false; let hasUnits = false;
        box.querySelectorAll('[data-tk^="start."]').forEach((i) => { hasStart = true; start[i.getAttribute('data-tk').slice(6)] = i.value === '' ? null : Number(i.value); });
        box.querySelectorAll('[data-tk^="unit."]').forEach((i) => { hasUnits = true; units[i.getAttribute('data-tk').slice(5)] = i.value === '' ? null : Number(i.value); });
        return { start: hasStart ? start : null, units: hasUnits ? units : null };
    },

    _meTimeSeg(el) {
        const which = el.getAttribute('data-tseg');
        const on = el.getAttribute('data-val') === '1';
        const DEF_START = { year: 1, month: 1, day: 1, hour: 8, minute: 0 };
        const DEF_UNITS = { minutesPerHour: 60, hoursPerDay: 24, daysPerMonth: 30, monthsPerYear: 12 };
        const patch = which === 'start' ? { initialValues: on ? DEF_START : {} } : { units: on ? DEF_UNITS : {} };
        if (this._meRootDo('me-timeerr', (ed) => ed.setTimeConfig(patch))) this._meRootRedraw();
    },

    _meTimeChange(t) {
        const k = t.getAttribute('data-tk');
        if (k === 'format') { this._meRootDo('me-timeerr', (ed) => ed.setTimeConfig({ displayFormat: t.value })); return; }
        const cur = this._meTimeRead();
        const ok = this._meRootDo('me-timeerr', (ed) => ed.setTimeConfig({ initialValues: cur.start || undefined, units: cur.units || undefined }));
        if (!ok) setTimeout(() => this._meRootRedraw(), 0);
    },

    _meTimeToken(el) {
        const ta = document.getElementById('me-timefmt');
        if (!ta) return;
        ta.value = (ta.value + '{{' + el.getAttribute('data-token') + '}}');
        this._meRootDo('me-timeerr', (ed) => ed.setTimeConfig({ displayFormat: ta.value }));
    },

    _meMetaChange(t) {
        const k = t.getAttribute('data-mk');
        this._meRootDo('me-metaerr', (ed) => ed.setModuleMeta({ [k]: t.value }));
    },

    // ---- 分发 ----

    _meMiscAction(name, el) {
        switch (name) {
            case 'adddeliv': this._meAddDeliv(); return true;
            case 'deldeliv': this._meDelDeliv(Number(el.getAttribute('data-di'))); return true;
            case 'addinfo': this._meAddInfo(); return true;
            case 'moreinfo': this._meInfoShown = (this._meInfoShown || this._ME_INFO_PAGE) + 50; this._meRedrawInfo(); return true;
            case 'delinfo': this._meDelInfo(Number(el.getAttribute('data-ii'))); return true;
            case 'timetoken': this._meTimeToken(el); return true;
            case 'addset': this._meAddSet(); return true;
            case 'delset': this._meDelSet(Number(el.getAttribute('data-si'))); return true;
            case 'seg': {
                if (el.hasAttribute('data-iseg')) {
                    const m = this.moduleSystem.getModule(this._meSel);
                    const d = this._meInfoDraftOf(m)[Number(el.getAttribute('data-ii'))];
                    if (!d) return true;
                    if (el.getAttribute('data-val') === '1') d.persistent = true; else delete d.persistent;
                    this._meInfoCommit(true);
                    return true;
                }
                if (el.hasAttribute('data-trseg')) { if (this._meTrigApply(el.getAttribute('data-val') === '1' ? 0 : null)) this._meTrigRedraw(); return true; }
                if (el.hasAttribute('data-qseg')) { this._meQueueSeg(el); return true; }
                if (el.hasAttribute('data-tseg')) { this._meTimeSeg(el); return true; }
                return false;
            }
            default: return false;
        }
    },

    /** 区块内输入框改变：交给对应区块；不是这些区块的返回 false */
    _meMiscChange(t) {
        if (!t.closest) return false;
        if (t.closest('#me-info')) { this._meInfoChange(t); return true; }
        if (t.closest('#me-deliv')) { this._meDelivChange(t); return true; }
        if (t.closest('#me-queue')) { this._meQueueChange(t); return true; }
        if (t.closest('#me-set')) { this._meSetChange(t); return true; }
        if (t.closest('#me-trig')) { this._meTrigApply(t.value === '' ? null : Number(t.value)); return true; }
        if (t.closest('#me-timesec')) { this._meTimeChange(t); return true; }
        if (t.closest('#me-metasec')) { this._meMetaChange(t); return true; }
        return false;
    },

    /** 面板整体绘制之后：挂上标签、条件编辑器 */
    _meMountMisc(m) {
        this._meTagsMount(m);
        this._meMountDraftConds(document.getElementById('me-info'), () => this._meInfoDraft, (r) => this._meInfoCommit(r));
        this._meMountDraftConds(document.getElementById('me-deliv'), () => this._meDelivDraft, (r) => this._meDelivCommit(r));
        this._meMountVarConds(document.getElementById('me-vars'));
    }
});
