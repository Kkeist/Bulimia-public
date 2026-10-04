/**
 * 调试页「写作指导」标签下半部分：世界书与作者注释（TavernLayer）。
 * 数据在 State.tavern，改动立即存进浏览器本地（TavernLayer.save）；下一次发送起生效。
 * 扩展 DebugModuleJump（依赖 debug-tab-cheat.js 里的 DebugCtl，须在它之后加载；样式沿用 cx-* / sm-*）。
 */
Object.assign(DebugModuleJump, {
    _TV_POS: [['before_char', I18n.t('模组内容前')], ['after_char', I18n.t('模组内容后')], ['as_system', I18n.t('作为系统消息')], ['as_user', I18n.t('作为用户消息')], ['as_assistant', I18n.t('作为助手消息')], ['at_depth', I18n.t('倒数第几条前')]],

    _tvEnsureHost() {
        const panel = document.getElementById('debug-panel-writing-guide');
        if (!panel) return null;
        let host = panel.querySelector('#mjx-tavern');
        if (!host) { host = document.createElement('div'); host.id = 'mjx-tavern'; panel.appendChild(host); }
        return host;
    },

    renderWritingGuideTab() {
        const host = this._tvEnsureHost();
        if (!host || !window.TavernLayer) return;
        DebugCtl.undo.hide();
        DebugCtl.closePicks(null);
        host.innerHTML = this._tvHtml();
        this._tvBind(host);
        DebugCtl.fitAll(host);
    },

    _tvBind(host) {
        if (host.__tvBound) return;
        host.__tvBound = true;
        DebugCtl.bindNumeric(host, 'input.cx-num');
        DebugCtl.bindGrow(host);
        DebugCtl.bindPick(host);
        host.addEventListener('click', (e) => this._tvOnClick(e));
        host.addEventListener('change', (e) => this._tvOnChange(e));
        host.addEventListener('cx-pick', (e) => this._tvOnPick(e));
    },

    _tvSaved() {
        if (TavernLayer.save()) DebugCtl.notify(I18n.t('已保存。'), 'success');
    },

    // ---------- 界面 ----------
    _tvSeg(on, attrs, labels) {
        const [a, b] = labels || [I18n.t('是'), I18n.t('否')];
        return `<div class="cx-seg" role="radiogroup">` +
            `<button type="button" role="radio" aria-checked="${on}" class="cx-segb${on ? ' on' : ''}" ${attrs} data-val="1">${a}</button>` +
            `<button type="button" role="radio" aria-checked="${!on}" class="cx-segb${on ? '' : ' on'}" ${attrs} data-val="0">${b}</button></div>`;
    },

    _tvNum(val, attrs, o) {
        const e = DebugCtl.esc;
        return `<div class="cx-numwrap"><input type="text" inputmode="numeric" class="cx-in cx-num" ${attrs} data-int="1" data-min="${o.min}" data-max="${o.max}" data-prev="${e(val)}" data-label="${e(o.label)}" value="${e(val)}" aria-label="${e(o.label)}">` +
            `${o.unit ? `<span class="cx-unit">${e(o.unit)}</span>` : ''}</div>`;
    },

    _tvPosOf(entry) {
        const m = String(entry.position || '').match(/^at_depth_(\d+)$/);
        return m ? { key: 'at_depth', depth: Number(m[1]) } : { key: entry.position || 'before_char', depth: 4 };
    },

    _tvEntryHtml(en, i) {
        const e = DebugCtl.esc;
        const pos = this._tvPosOf(en);
        const field = (label, body) => `<div class="sm-field"><span class="sm-flab">${label}</span>${body}</div>`;
        return `<div class="sm-card" data-ti="${i}">` +
            field(I18n.t('名称'), `<input type="text" class="cx-in" data-tf="comment" value="${e(en.comment || '')}" aria-label="${I18n.t('名称')}">`) +
            field(I18n.t('启用'), this._tvSeg(en.enabled !== false, `data-act="tvtoggle" data-tf="enabled"`)) +
            field(I18n.t('触发方式'), this._tvSeg(!!en.constant, `data-act="tvtoggle" data-tf="constant"`, [I18n.t('一直带上'), I18n.t('关键词触发')])) +
            (en.constant ? '' : field(I18n.t('关键词（逗号分隔，可写 /正则/）'), `<input type="text" class="cx-in" data-tf="keys" value="${e((en.keys || []).join('，'))}" aria-label="${I18n.t('关键词')}">`)) +
            field(I18n.t('内容'), `<textarea class="cx-in cx-grow" rows="2" data-tf="content" aria-label="${I18n.t('内容')}">${e(en.content || '')}</textarea>`) +
            field(I18n.t('放在哪里'), DebugCtl.pickHtml({ key: 'tvpos', value: pos.key, options: this._TV_POS.map((p) => ({ value: p[0], label: p[1] })) })) +
            (pos.key === 'at_depth' ? field(I18n.t('倒数第几条前'), this._tvNum(pos.depth, 'data-tf="depth"', { min: 1, max: 999, label: I18n.t('倒数第几条前'), unit: I18n.t('条') })) : '') +
            field(I18n.t('顺序（小的在前）'), this._tvNum(en.insertion_order == null ? 100 : en.insertion_order, 'data-tf="order"', { min: 0, max: 99999, label: I18n.t('顺序') })) +
            field(I18n.t('出现概率'), this._tvNum(en.probability == null ? 100 : en.probability, 'data-tf="prob"', { min: 0, max: 100, label: I18n.t('出现概率'), unit: '%' })) +
            `<div class="sm-actions"><button type="button" class="cx-btn cx-del" data-act="tvdel">${I18n.t('删除')}</button></div></div>`;
    },

    _tvHtml() {
        const e = DebugCtl.esc;
        const tv = TavernLayer._store();
        const wb = tv.worldbook;
        const row = (label, body) => `<div class="sm-cfgrow"><span class="sm-cfglab">${label}</span><div class="sm-cfgctl">${body}</div></div>`;
        return `<div class="sm" id="tv-root">` +
            `<div class="cx-sec"><div class="cx-sttl">${I18n.t('世界书与作者注释')}</div>` +
            row(I18n.t('启用'), this._tvSeg(!!tv.enabled, 'data-act="tvenable"')) +
            `<div class="sm-field"><span class="sm-flab">${I18n.t('作者注释')}</span><textarea class="cx-in cx-grow" rows="2" id="tv-an" aria-label="${I18n.t('作者注释')}">${e(tv.authorsNote || '')}</textarea></div>` +
            row(I18n.t('作者注释放在倒数第几条前'), this._tvNum(tv.authorsNoteDepth == null ? 4 : tv.authorsNoteDepth, 'id="tv-and"', { min: 0, max: 999, label: I18n.t('作者注释的位置'), unit: I18n.t('条') })) +
            row(I18n.t('扫描最近几条消息找关键词'), this._tvNum(wb.scanDepth == null ? 10 : wb.scanDepth, 'id="tv-sd"', { min: 1, max: 999, label: I18n.t('扫描条数'), unit: I18n.t('条') })) +
            row(I18n.t('命中的条目再触发别的条目'), this._tvSeg(wb.recursive !== false, 'data-act="tvrec"')) +
            `</div><div class="cx-sec"><div class="cx-sttl">${I18n.t('世界书条目（{n}）', { n: wb.entries.length })}</div>` +
            (wb.entries.map((en, i) => this._tvEntryHtml(en, i)).join('') || `<div class="cx-muted cx-emptyline">${I18n.t('暂无条目。')}</div>`) +
            `<div class="sm-actions"><button type="button" class="cx-btn cx-btn-main" data-act="tvadd">${I18n.t('新增条目')}</button></div></div></div>`;
    },

    _tvRefreshAll() {
        const host = this._tvEnsureHost();
        const root = host && host.querySelector('#tv-root');
        if (!root) return;
        DebugCtl.replaceKeepingPlace(root, this._tvHtml());
        DebugCtl.fitAll(host);
    },

    _tvRefreshCard(i) {
        const host = this._tvEnsureHost();
        const card = host && host.querySelector(`.sm-card[data-ti="${i}"]`);
        const en = TavernLayer._store().worldbook.entries[i];
        if (!card || !en) return;
        const next = DebugCtl.replaceKeepingPlace(card, this._tvEntryHtml(en, i));
        DebugCtl.fitAll(next);
    },

    // ---------- 事件 ----------
    _tvOnClick(e) {
        const t = e.target.closest ? e.target.closest('[data-act]') : null;
        if (!t) return;
        const act = t.getAttribute('data-act');
        const tv = TavernLayer._store();
        const wb = tv.worldbook;
        const on = t.getAttribute('data-val') === '1';
        if (act === 'tvenable') { tv.enabled = on; this._tvSaved(); this._tvRefreshAll(); }
        else if (act === 'tvrec') { wb.recursive = on; this._tvSaved(); this._tvRefreshAll(); }
        else if (act === 'tvadd') {
            wb.entries.push({ comment: '', keys: [], content: '', enabled: true, constant: false, probability: 100, insertion_order: 100, position: 'before_char' });
            this._tvSaved(); this._tvRefreshAll();
        } else if (act === 'tvtoggle') {
            const i = Number(t.closest('.sm-card').getAttribute('data-ti'));
            const en = wb.entries[i]; if (!en) return;
            en[t.getAttribute('data-tf')] = on;
            this._tvSaved(); this._tvRefreshCard(i);
        } else if (act === 'tvdel') {
            const i = Number(t.closest('.sm-card').getAttribute('data-ti'));
            const item = wb.entries.splice(i, 1)[0];
            if (!item) return;
            this._tvSaved(); this._tvRefreshAll();
            DebugCtl.undo.show(I18n.t('已删除一条世界书条目。'), () => {
                TavernLayer._store().worldbook.entries.splice(Math.min(i, TavernLayer._store().worldbook.entries.length), 0, item);
                this._tvSaved(); this._tvRefreshAll();
            });
        }
    },

    _tvOnPick(e) {
        if (e.detail.key !== 'tvpos') return;
        const card = e.detail.pick.closest('.sm-card');
        const i = Number(card.getAttribute('data-ti'));
        const en = TavernLayer._store().worldbook.entries[i];
        if (!en) return;
        const val = e.detail.value;
        en.position = val === 'at_depth' ? 'at_depth_' + this._tvPosOf(en).depth : val;
        this._tvSaved(); this._tvRefreshCard(i);
    },

    /** 数字框提交：解析、收回范围、写入，并说明发生了什么 */
    _tvNumChange(el, apply) {
        const spec = DebugCtl.numSpec(el); const prev = el.getAttribute('data-prev'); const label = el.getAttribute('data-label') || '';
        const r = DebugCtl.parseNum(el.value, spec);
        if (!r.ok) { DebugCtl.notify(DebugCtl.numMessage(label, r, spec, prev), 'error'); el.value = prev == null ? '' : prev; return; }
        if (r.clamped) DebugCtl.notify(DebugCtl.numMessage(label, r, spec, prev, r.n), 'error');
        el.value = String(r.n);
        if (String(r.n) === prev) return;
        el.setAttribute('data-prev', String(r.n));
        apply(r.n);
        this._tvSaved();
    },

    _tvOnChange(e) {
        const el = e.target; if (!el || !el.matches) return;
        const tv = TavernLayer._store();
        const wb = tv.worldbook;
        if (el.id === 'tv-an') { tv.authorsNote = el.value; this._tvSaved(); return; }
        if (el.id === 'tv-and') { this._tvNumChange(el, (n) => { tv.authorsNoteDepth = n; }); return; }
        if (el.id === 'tv-sd') { this._tvNumChange(el, (n) => { wb.scanDepth = n; }); return; }
        const card = el.closest('.sm-card');
        if (!card) return;
        const en = wb.entries[Number(card.getAttribute('data-ti'))];
        if (!en) return;
        const f = el.getAttribute('data-tf');
        if (f === 'comment' || f === 'content') { en[f] = el.value; this._tvSaved(); }
        else if (f === 'keys') { en.keys = el.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean); this._tvSaved(); }
        else if (f === 'order') this._tvNumChange(el, (n) => { en.insertion_order = n; });
        else if (f === 'prob') this._tvNumChange(el, (n) => { en.probability = n; });
        else if (f === 'depth') this._tvNumChange(el, (n) => { en.position = 'at_depth_' + n; });
    }
});
