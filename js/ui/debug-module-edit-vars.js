/**
 * 模组编辑标签里「变量」区块：名称、类型、初始值、取值范围、字段、给 AI 的说明与快捷规则、自动计算、按条件开放。
 * 区块在界面里先改一份草稿，每次改动通过 ModuleEditor.setVariables 整体提交；提交失败时原因显示在区块内，草稿保留，模组不变。
 * 还没填名称的新变量只留在草稿里，填了名称才会写入模组。
 * 扩展 DebugModuleJump（debug-module-edit-panel.js 先加载）。
 */
Object.assign(DebugModuleJump, {
    _ME_VTYPES: [['number', I18n.t('数值')], ['string', I18n.t('文字')], ['boolean', I18n.t('开关')], ['list', I18n.t('列表')], ['object', I18n.t('对象')], ['list_of_object', I18n.t('对象列表')]],
    _ME_FTYPES: [['number', I18n.t('数值')], ['string', I18n.t('文字')], ['boolean', I18n.t('开关')]],
    /** 自动计算、开放条件超过这个条数时默认折起（每条一个条件编辑器），展开时才挂上 */
    _ME_OPEN_MAX: 3,
    _ME_CATS: [['module', I18n.t('普通')], ['switch', I18n.t('按条件开放')], ['builtin', I18n.t('自动计算')], ['temp', I18n.t('不发给 AI')]],

    // ---- 草稿 ----

    /** 一个变量的配置超过这么多字，默认只显示一行，展开才画出内容（带几百项初始内容或几十条条件的变量，详细表单一次画出来会卡住页面） */
    _ME_VAR_OPEN_CHARS: 4000,

    /** 各变量的展开状态：{ 序号: true / false }，第一次画出来时按大小决定并记下 */
    _meVarOpenMap() {
        if (this._meVarOpenFor !== this._meVarDraftFor || !this._meVarOpen) { this._meVarOpen = {}; this._meVarOpenFor = this._meVarDraftFor; }
        return this._meVarOpen;
    },

    _meVarIsOpen(i, v) {
        const map = this._meVarOpenMap();
        if (map[i] === undefined) map[i] = JSON.stringify(v).length <= this._ME_VAR_OPEN_CHARS;
        return map[i];
    },

    _meVarsDraft(m) {
        if (!this._meVarDraft || this._meVarDraftFor !== m.id) {
            this._meVarDraft = JSON.parse(JSON.stringify(m.variables || []));
            this._meVarDraftFor = m.id;
        }
        return this._meVarDraft;
    },

    /** 界面上显示的类型：「列表，每项是对象」当作对象列表 */
    _meUiType(v) {
        if (v.type === 'list' && (v.elementType === 'object' || v.listItemType === 'object')) return 'list_of_object';
        return v.type || 'string';
    },

    _meVarsHtml(m) {
        this._meVarDraft = null;
        const draft = this._meVarsDraft(m);
        return this._meVarsInner(draft);
    },

    _meVarsInner(draft) {
        if (!draft.length) return `<div class="mjx-qnone">${I18n.t('这个事件还没有变量。')}</div>`;
        return draft.map((v, i) => this._meVarRowHtml(v, i)).join('');
    },

    // ---- 小件 ----

    _meSeg(attrs, on, labels) {
        const [a, b] = labels || [I18n.t('是'), I18n.t('否')];
        return `<div class="cx-seg" role="radiogroup">` +
            `<button type="button" role="radio" aria-checked="${on}" class="cx-segb${on ? ' on' : ''}" data-meact="seg" ${attrs} data-val="1">${a}</button>` +
            `<button type="button" role="radio" aria-checked="${!on}" class="cx-segb${on ? '' : ' on'}" data-meact="seg" ${attrs} data-val="0">${b}</button></div>`;
    },

    /** 可以不设的数字（取值范围等）：先选「不限 / 限制」，选了限制才出现数字框 */
    _meOptNum(key, label, val, extra) {
        const has = val != null && val !== '';
        return `<div class="me-opt"><span class="me-optlab">${label}</span>` +
            this._meSeg(`data-optk="${key}"`, has, [I18n.t('限制'), I18n.t('不限')]) +
            (has ? `<input type="number" class="mjx-fin" data-vk="${key}" value="${this._esc(val)}" step="any" ${extra || ''}>` : '') + '</div>';
    },

    _meNumberInput(attrs, val, extra) {
        return `<input type="number" class="mjx-fin" ${attrs} value="${val == null ? '' : this._esc(val)}" step="any" ${extra || ''}>`;
    },

    _meTextLine(attrs, val, ph, aria, cls) {
        return `<textarea rows="1" class="mjx-fta me-line${cls ? ' ' + cls : ''}" ${attrs} placeholder="${this._esc(ph || '')}" aria-label="${this._esc(aria || ph || '')}">${this._esc(val == null ? '' : val)}</textarea>`;
    },

    // ---- 一个变量 ----

    _meVarRowHtml(v, i) {
        const t = this._meUiType(v);
        const open = this._meVarIsOpen(i, v);
        return `<div class="me-var" data-vi="${i}">` +
            `<div class="me-varhead">${this._meTextLine('data-vk="name"', v.name, I18n.t('变量名称'), I18n.t('变量名称'), 'me-vname')}` +
            `<select class="mjx-fin me-vtype" data-vk="type" aria-label="${I18n.t('变量类型')}">${this._meOpt(this._ME_VTYPES, t)}</select>` +
            `<select class="mjx-fin me-vcat" data-vk="category" aria-label="${I18n.t('变量类别')}">${this._meOpt(this._ME_CATS, v.category || 'module')}</select>` +
            `<button type="button" class="mjx-b" data-meact="vartoggle" data-vi="${i}" aria-expanded="${open}">${open ? I18n.t('收起') : I18n.t('展开')}</button>` +
            `<button type="button" class="mjx-b mjx-b-untrig" data-meact="delvar" data-vi="${i}">${I18n.t('删除')}</button></div>` +
            `<div class="me-varrest">${open ? this._meVarRestHtml(v, i, t) : ''}</div></div>`;
    },

    /** 一个变量除名称行之外的内容：初始值与取值范围、给 AI 的说明、自动计算、开放条件 */
    _meVarRestHtml(v, i, t) {
        const esc = this._esc.bind(this);
        let body = '';
        if (t === 'number') {
            body = `<label>${I18n.t('初始值')}${this._meNumberInput('data-vk="iv"', v.initialValue)}</label>` +
                this._meOptNum('min', I18n.t('最小值'), v.min) + this._meOptNum('max', I18n.t('最大值'), v.max);
        } else if (t === 'string') {
            body = `<label>${I18n.t('初始值')}<textarea rows="1" class="mjx-fta me-line" data-vk="iv">${esc(v.initialValue == null ? '' : v.initialValue)}</textarea></label>` +
                this._meOptNum('maxLength', I18n.t('最大长度'), v.maxLength, 'min="0"');
        } else if (t === 'boolean') {
            body = `<div class="me-opt"><span class="me-optlab">${I18n.t('初始值')}</span>${this._meSeg('data-ivbool="1"', v.initialValue === true)}</div>`;
        } else if (t === 'list') {
            const el = v.elementType || 'string';
            const items = (Array.isArray(v.initialValue) ? v.initialValue : []).map((x, ii) => `<span class="me-chip">${esc(String(x))}<button type="button" data-meact="delitem" data-vi="${i}" data-ii="${ii}" aria-label="${I18n.t('删除这一项')}">×</button></span>`).join('');
            body = `<label>${I18n.t('元素类型')}<select class="mjx-fin" data-vk="elementType">${this._meOpt(this._ME_FTYPES, el)}</select></label>` +
                `<div class="me-chips">${items || `<span class="mjx-qnone">${I18n.t('初始为空')}</span>`}</div>` +
                `<div class="me-addrow"><input type="${el === 'number' ? 'number' : 'text'}" class="mjx-fin" data-vk="newitem" placeholder="${I18n.t('新元素')}" ${el === 'number' ? 'step="any"' : ''}><button type="button" class="mjx-b" data-meact="additem" data-vi="${i}">${I18n.t('加入')}</button></div>`;
        } else {
            body = this._meFieldsHtml(v, i) + this._meInitialHtml(v, i, t);
        }
        return `<div class="me-varbody">${body}</div>` +
            this._meAiHtml(v, i, t) + this._meComputeHtml(v, i, t) + this._meSwitchHtml(v, i);
    },

    /** 展开 / 收起一个变量：只画这一个，别的不动 */
    _meVarToggle(i, btn) {
        const m = this.moduleSystem.getModule(this._meSel);
        const draft = this._meVarsDraft(m);
        const v = draft[i];
        const card = btn.closest('.me-var');
        if (!v || !card) return;
        const open = !this._meVarIsOpen(i, v);
        this._meVarOpenMap()[i] = open;
        card.querySelector('.me-varrest').innerHTML = open ? this._meVarRestHtml(v, i, this._meUiType(v)) : '';
        btn.textContent = open ? I18n.t('收起') : I18n.t('展开');
        btn.setAttribute('aria-expanded', String(open));
        if (open) this._meMountVarConds(card);
    },

    // ---- 对象的字段 ----

    _meFieldsHtml(v, i) {
        const rows = (v.fields || []).map((f, fi) => {
            const dv = f.type === 'number'
                ? this._meNumberInput('data-fk="default"', f.default === '' || f.default == null ? 0 : f.default)
                : (f.type === 'boolean'
                    ? `<select class="mjx-fin" data-fk="default">${this._meOpt([['true', I18n.t('是')], ['false', I18n.t('否')]], f.default === true || f.default === 'true' ? 'true' : 'false')}</select>`
                    : this._meTextLine('data-fk="default"', f.default, I18n.t('默认值')));
            return `<div class="me-field" data-fi="${fi}">${this._meTextLine('data-fk="name"', f.name, I18n.t('字段名称'), I18n.t('字段名称'))}` +
                `<select class="mjx-fin" data-fk="type" aria-label="${I18n.t('字段类型')}">${this._meOpt(this._ME_FTYPES, f.type || 'string')}</select>${dv}` +
                `<button type="button" class="mjx-b mjx-b-untrig" data-meact="delfield" data-vi="${i}" data-fi="${fi}">${I18n.t('删除')}</button></div>`;
        }).join('');
        return `<div class="me-fields"><span class="me-optlab">${I18n.t('字段')}</span>${rows || `<span class="mjx-qnone">${I18n.t('还没有字段。')}</span>`}</div>` +
            `<button type="button" class="mjx-b" data-meact="addfield" data-vi="${i}">${I18n.t('新增字段')}</button>`;
    },

    /** 对象列表的初始内容有几百项时先只画一部分（每项一组输入框，一次全画会卡住页面） */
    _ME_OBJ_PAGE: 20,

    _meObjShown(vi, total) {
        if (!this._meObjOpen || this._meObjOpenFor !== this._meVarDraftFor) { this._meObjOpen = {}; this._meObjPin = {}; this._meObjOpenFor = this._meVarDraftFor; }
        return Math.min(total, Math.max(this._meObjOpen[vi] || 0, this._ME_OBJ_PAGE));
    },

    /** 对象与对象列表的初始值：按已定义的字段填 */
    _meInitialHtml(v, i, t) {
        const fields = v.fields || [];
        if (!fields.length) return `<div class="me-fields"><span class="mjx-qnone">${I18n.t('先添加字段，才能设置初始内容。')}</span></div>`;
        const one = (obj, oi) => '<div class="me-objval" data-oi="' + oi + '">' + fields.map((f) => {
            const cur = obj && obj[f.name] !== undefined ? obj[f.name] : f.default;
            const lab = this._esc(f.name);
            if (f.type === 'number') return `<label>${lab}${this._meNumberInput(`data-ok="${this._esc(f.name)}"`, cur === '' || cur == null ? 0 : cur)}</label>`;
            if (f.type === 'boolean') return `<label>${lab}<select class="mjx-fin" data-ok="${this._esc(f.name)}">${this._meOpt([['true', I18n.t('是')], ['false', I18n.t('否')]], cur === true || cur === 'true' ? 'true' : 'false')}</select></label>`;
            return `<label>${lab}${this._meTextLine(`data-ok="${this._esc(f.name)}"`, cur, f.name)}</label>`;
        }).join('') + (oi >= 0 ? `<button type="button" class="mjx-b mjx-b-untrig" data-meact="delobj" data-vi="${i}" data-oi="${oi}">${I18n.t('删除这一项')}</button>` : '') + '</div>';
        if (t === 'object') return `<div class="me-fields"><span class="me-optlab">${I18n.t('初始内容')}</span>${one(v.initialValue && typeof v.initialValue === 'object' ? v.initialValue : {}, -1)}</div>`;
        const items = Array.isArray(v.initialValue) ? v.initialValue : [];
        const shown = this._meObjShown(i, items.length);
        const pinned = this._meObjPin[i];
        const rows = items.slice(0, shown).map((o, oi) => one(o, oi));
        const rest = items.length - shown - (pinned !== undefined && pinned >= shown && pinned < items.length ? 1 : 0);
        const more = rest > 0 ? `<button type="button" class="mjx-b" data-meact="moreobj" data-vi="${i}">${I18n.t('显示更多（还有 {n} 项）', { n: rest })}</button>` : '';
        if (pinned !== undefined && pinned >= shown && pinned < items.length) rows.push(one(items[pinned], pinned));
        return `<div class="me-fields"><span class="me-optlab">${I18n.t('初始内容')}</span>${rows.join('') || `<span class="mjx-qnone">${I18n.t('初始为空')}</span>`}${more}</div>` +
            `<button type="button" class="mjx-b" data-meact="addobj" data-vi="${i}">${I18n.t('加入一项')}</button>`;
    },

    // ---- 给 AI 的说明与快捷规则 ----

    _meAiHtml(v, i, t) {
        const rules = Array.isArray(v.changeRules) ? v.changeRules : [];
        const open = (v.generalRules || v.readonly || rules.length) ? ' open' : '';
        const canRule = ['number', 'string', 'boolean'].includes(t);
        return `<details class="me-rules" data-dkey="ai|${i}"${open}><summary>${I18n.t('给 AI 的说明和操作')}</summary>` +
            `<label class="mjx-flab">${I18n.t('说明')}</label>` +
            `<textarea rows="2" class="mjx-fta" data-vk="generalRules" placeholder="${I18n.t('告诉 AI 这个变量是什么、怎么用')}">${this._esc(v.generalRules || '')}</textarea>` +
            `<div class="me-opt"><span class="me-optlab">${I18n.t('AI 可以修改')}</span>${this._meSeg('data-vkseg="readonly"', v.readonly !== true)}</div>` +
            (canRule ? this._meRulesHtml(v, i, t) : '') + `</details>`;
    },

    _meRulesHtml(v, i, t) {
        const esc = this._esc.bind(this);
        const ops = ModuleEditor.RULE_OPS[t] || [];
        const rules = Array.isArray(v.changeRules) ? v.changeRules : [];
        const rows = rules.map((r, ri) => {
            const parts = ModuleEditor.ruleParts(r, t);
            if (!parts) {
                return `<div class="me-rule" data-ri="${ri}"><span class="mjx-qnone">${esc(r.name || '')}${I18n.t('（带参数的规则，这里不能修改）')}</span>` +
                    `<button type="button" class="mjx-b mjx-b-untrig" data-meact="delrule" data-vi="${i}" data-ri="${ri}">${I18n.t('删除')}</button></div>`;
            }
            const valEl = t === 'number'
                ? this._meNumberInput('data-rk="value"', parts.value)
                : (t === 'boolean'
                    ? `<select class="mjx-fin" data-rk="value">${this._meOpt([['true', I18n.t('是')], ['false', I18n.t('否')]], parts.value === true || parts.value === 'true' ? 'true' : 'false')}</select>`
                    : this._meTextLine('data-rk="value"', parts.value, I18n.t('内容')));
            return `<div class="me-rule" data-ri="${ri}">${this._meTextLine('data-rk="name"', r.name, I18n.t('规则名称'), I18n.t('规则名称'))}` +
                `<select class="mjx-fin" data-rk="operation" aria-label="${I18n.t('操作')}">${this._meOpt(ops, parts.operation)}</select>${valEl}` +
                `<button type="button" class="mjx-b mjx-b-untrig" data-meact="delrule" data-vi="${i}" data-ri="${ri}">${I18n.t('删除')}</button></div>`;
        }).join('');
        return `<span class="me-optlab">${I18n.t('AI 可用的快捷规则（{n}）', { n: rules.length })}</span>${rows}` +
            `<button type="button" class="mjx-b" data-meact="addrule" data-vi="${i}">${I18n.t('新增规则')}</button>`;
    },

    // ---- 自动计算：按顺序，第一条条件满足的生效；都不满足时用初始值 ----

    _meComputeHtml(v, i, t) {
        const list = Array.isArray(v.computeConditions) ? v.computeConditions : [];
        if ((v.category || 'module') !== 'builtin' && !list.length) return '';
        const vars = this._meAllVars();
        const rows = list.map((c, ki) => {
            const lit = ModuleEditor.formulaLiteral(c.formula);
            const kind = ['number', 'string', 'boolean'].includes(t) ? t : null;
            const isLit = lit && kind && lit.kind === kind;
            let result;
            if (isLit) {
                result = kind === 'number' ? this._meNumberInput('data-ck="value"', lit.value)
                    : (kind === 'boolean' ? `<select class="mjx-fin" data-ck="value">${this._meOpt([['true', I18n.t('是')], ['false', I18n.t('否')]], lit.value ? 'true' : 'false')}</select>`
                        : this._meTextLine('data-ck="value"', lit.value, I18n.t('结果')));
            } else {
                result = `<textarea rows="1" class="mjx-fta me-line" data-ck="formula" placeholder="${I18n.t('公式，变量写成 {{变量名}}')}">${this._esc(ModuleEditor.formulaToDisplay(c.formula, vars))}</textarea>`;
            }
            const modeSel = kind ? `<select class="mjx-fin" data-ck="mode" aria-label="${I18n.t('结果的写法')}">${this._meOpt([['value', I18n.t('固定值')], ['formula', I18n.t('公式')]], isLit ? 'value' : 'formula')}</select>` : '';
            return `<div class="me-comp" data-ki="${ki}"><div class="me-comphead"><span class="me-optlab">${I18n.t('第 {n} 条：满足以下条件时', { n: ki + 1 })}</span>` +
                `<button type="button" class="mjx-b" data-meact="compup" data-vi="${i}" data-ki="${ki}"${ki === 0 ? ' disabled' : ''}>${I18n.t('上移')}</button>` +
                `<button type="button" class="mjx-b" data-meact="compdown" data-vi="${i}" data-ki="${ki}"${ki === list.length - 1 ? ' disabled' : ''}>${I18n.t('下移')}</button>` +
                `<button type="button" class="mjx-b mjx-b-untrig" data-meact="delcomp" data-vi="${i}" data-ki="${ki}">${I18n.t('删除')}</button></div>` +
                `<div class="mjx-cbhost" data-cbhost="comp|${i}|${ki}"></div>` +
                `<div class="me-opt"><span class="me-optlab">${I18n.t('结果')}</span>${modeSel}${result}</div></div>`;
        }).join('');
        return `<details class="me-rules" data-dkey="comp|${i}"${list.length <= this._ME_OPEN_MAX ? ' open' : ''}><summary>${I18n.t('自动计算（{n}）', { n: list.length })}</summary>` +
            `<p class="me-hint">${I18n.t('按顺序检查，第一条条件满足的生效；都不满足时用初始值。')}</p>${rows}` +
            `<button type="button" class="mjx-b" data-meact="addcomp" data-vi="${i}">${I18n.t('新增一条')}</button></details>`;
    },

    // ---- 按条件开放 ----

    _meSwitchHtml(v, i) {
        const list = Array.isArray(v.switchConditions) ? v.switchConditions : [];
        if ((v.category || 'module') !== 'switch' && !list.length) return '';
        const rows = list.map((s, si) => `<div class="me-comp" data-si="${si}"><div class="me-comphead"><span class="me-optlab">${I18n.t('第 {n} 条', { n: si + 1 })}</span>` +
            `<select class="mjx-fin" data-sk="action" aria-label="${I18n.t('动作')}">${this._meOpt([['open', I18n.t('满足时发给 AI')], ['close', I18n.t('满足时不发给 AI')]], s.action || 'open')}</select>` +
            `<select class="mjx-fin" data-sk="type" aria-label="${I18n.t('判断时机')}">${this._meOpt([['display', I18n.t('按当前状态判断')], ['trigger', I18n.t('按进入条件的规则判断')]], s.type || 'display')}</select>` +
            `<button type="button" class="mjx-b mjx-b-untrig" data-meact="delsw" data-vi="${i}" data-si="${si}">${I18n.t('删除')}</button></div>` +
            `<div class="mjx-cbhost" data-cbhost="sw|${i}|${si}"></div></div>`).join('');
        return `<details class="me-rules" data-dkey="sw|${i}"${list.length <= this._ME_OPEN_MAX ? ' open' : ''}><summary>${I18n.t('开放条件（{n}）', { n: list.length })}</summary>` +
            `<p class="me-hint">${I18n.t('按顺序检查，第一条满足的生效；没有条件时，变量有内容就发给 AI。')}</p>${rows}` +
            `<button type="button" class="mjx-b" data-meact="addsw" data-vi="${i}">${I18n.t('新增一条')}</button></details>`;
    },

    // ---- 条件编辑器挂载 ----

    _meAllVars() {
        const out = [];
        const ms = this.moduleSystem;
        if (ms) ms.modules.forEach((mm) => (mm.variables || []).forEach((x) => { if (x && x.id) out.push({ id: x.id, name: x.name || x.id, type: x.type || 'string' }); }));
        return out;
    },

    _meCondOptions() {
        const ms = this.moduleSystem;
        const modules = [];
        ms.modules.forEach((mm) => { if (mm) modules.push({ id: mm.id, name: mm.name || I18n.t('未命名') }); });
        return { variables: this._varList(), modules, units: this.timeSystem && this.timeSystem.getUnits ? this.timeSystem.getUnits() : null };
    },

    /** 变量行里的条件编辑器（自动计算、开放条件） */
    _meMountVarConds(box) {
        if (typeof window.ConditionBuilder === 'undefined' || !box) return;
        const m = this.moduleSystem.getModule(this._meSel);
        const draft = this._meVarsDraft(m);
        const opts = this._meCondOptions();
        this._meMountHosts(box, (host) => {
            const [kind, vis, ks] = host.getAttribute('data-cbhost').split('|');
            const v = draft[Number(vis)];
            if (!v) return;
            const entry = kind === 'comp' ? v.computeConditions[Number(ks)] : v.switchConditions[Number(ks)];
            if (!entry) return;
            const def = (kind === 'comp' ? entry.conditionDef : entry.condition) || { logic: 'OR', groups: [] };
            ConditionBuilder.mount(host, def, {
                variables: opts.variables, modules: opts.modules, units: opts.units,
                onChange: (value) => {
                    const cur = this._meVarsDraft(m)[Number(vis)];
                    if (!cur) return;
                    const target = kind === 'comp' ? cur.computeConditions[Number(ks)] : cur.switchConditions[Number(ks)];
                    if (!target) return;
                    const next = value || { logic: 'OR', groups: [] };
                    if (kind === 'comp') target.conditionDef = next; else target.condition = next;
                    this._meCommitVars(false);
                },
                onRemoved: (msg) => this._meUndoSnapshotToast(msg)
            });
        });
        if (window.FormControls) FormControls.enhance(box);
    },

    // ---- 提交 ----

    _meVarShowError(msg, soft) {
        const el = document.getElementById('me-varerr');
        if (!el) return;
        el.hidden = !msg;
        el.classList.toggle('me-hintline', !!soft);
        el.textContent = msg || '';
    },

    /** 提交给模组的变量：还没填名称的新变量先不写入 */
    _meVarPayload(draft) {
        return draft.filter((v) => !(v._new && !String(v.name || '').trim())).map((v) => { const c = JSON.parse(JSON.stringify(v)); delete c._new; return c; });
    },

    _meRedrawVars() {
        const box = document.getElementById('me-vars');
        if (!box) return;
        this._meKeepDetails(box, () => {
            box.innerHTML = this._meVarsInner(this._meVarDraft || []);
            if (window.FormControls) FormControls.enhance(box);
            this._meMountVarConds(box);
        });
    },

    /** 重画之后保持各折叠块原来的展开 / 收起（新出现的块按默认） */
    _meKeepDetails(box, redraw) {
        const state = new Map();
        box.querySelectorAll('details[data-dkey]').forEach((d) => state.set(d.getAttribute('data-dkey'), d.open));
        redraw();
        box.querySelectorAll('details[data-dkey]').forEach((d) => {
            const k = d.getAttribute('data-dkey');
            if (state.has(k)) d.open = state.get(k);
        });
    },

    /** 草稿提交；失败时错误显示在变量区，草稿保留 */
    _meCommitVars(redraw) {
        const m = this.moduleSystem.getModule(this._meSel);
        const ed = this._meEditor();
        const pending = (this._meVarDraft || []).some((v) => v._new && !String(v.name || '').trim());
        let ok = false;
        try {
            const out = ed.setVariables(m.id, this._meVarPayload(this._meVarDraft));
            // 已提交的变量换成整理后的内容；还没填名称的保持原样
            let k = 0;
            this._meVarDraft = this._meVarDraft.map((v) => ((v._new && !String(v.name || '').trim()) ? v : JSON.parse(JSON.stringify(out[k++]))));
            this._meVarShowError(pending ? I18n.t('新变量填了名称才会保存。') : '', pending);
            this._meAfterEdit({ panel: false });
            ok = true;
        } catch (e) {
            if (e && e.name === 'EditError') this._meVarShowError(e.message);
            else { console.error(e); this._meVarShowError(I18n.t('变量没有保存成功：') + e.message); }
        }
        if (redraw) this._meRedrawVars();
        return ok;
    },

    _meAddVar() {
        const m = this.moduleSystem.getModule(this._meSel);
        const draft = this._meVarsDraft(m);
        draft.push({ name: '', type: 'number', category: 'module', initialValue: 0, _new: true });
        this._meVarOpenMap()[draft.length - 1] = true;
        this._meRedrawVars();
        const names = document.querySelectorAll('#me-vars .me-vname');
        if (names.length) names[names.length - 1].focus();
        this._meVarShowError(I18n.t('新变量填了名称才会保存。'), true);
    },

    _meDelVar(i) {
        const m = this.moduleSystem.getModule(this._meSel);
        const draft = this._meVarsDraft(m);
        const removed = draft.splice(i, 1)[0];
        if (!removed) return;
        const openBefore = this._meVarOpenMap();
        const shifted = {};
        Object.keys(openBefore).forEach((k) => { const n = Number(k); if (n < i) shifted[n] = openBefore[k]; else if (n > i) shifted[n - 1] = openBefore[k]; });
        this._meVarOpen = shifted;
        if (removed._new && !String(removed.name || '').trim()) {
            this._meRedrawVars();
            this._meCommitVars(false);
            return;
        }
        const ok = this._meCommitVars(true);
        if (ok) this._meUndoSnapshotToast(I18n.t('已删除变量「{name}」。', { name: removed.name || I18n.t('未命名') }));
        else { draft.splice(i, 0, removed); this._meVarOpen = openBefore; this._meRedrawVars(); }
    },

    /** 对草稿里的某个变量做结构性修改后提交并重画 */
    _meVarStruct(i, fn) {
        const m = this.moduleSystem.getModule(this._meSel);
        const draft = this._meVarsDraft(m);
        if (!draft[i]) return;
        const ed = this._meEditor();
        const steps = ed.version;
        fn(draft[i]);
        // 返回「模组真的改了」：还没写进模组的草稿（没填名称的新变量）改了不算
        return this._meCommitVars(true) && ed.version > steps;
    },

    /** 删除成功之后给撤销入口；没成功（提交被拒绝）时草稿已原样保留，不提示 */
    _meDeleted(ok, text) {
        if (ok) this._meUndoSnapshotToast(text);
    },

    _meAddListItem(i) {
        const row = document.querySelector(`#me-vars .me-var[data-vi="${i}"]`);
        const inp = row && row.querySelector('[data-vk="newitem"]');
        if (!inp || inp.value === '') return;
        const val = inp.value;
        this._meVarStruct(i, (v) => {
            const x = v.elementType === 'number' ? Number(val) : (v.elementType === 'boolean' ? val === 'true' : val);
            if (v.elementType === 'number' && !Number.isFinite(x)) return;
            v.initialValue = (Array.isArray(v.initialValue) ? v.initialValue : []).concat([x]);
        });
    },

    // ---- 点击 ----

    _meVarAction(name, el) {
        const vi = Number(el.getAttribute('data-vi'));
        const num = (k) => Number(el.getAttribute(k));
        const defOp = (v) => ((ModuleEditor.RULE_OPS[v.type] || [['set']])[0][0]);
        const uniqueName = (list, base) => { let n = base; let k = 2; while (list.some((x) => x.name === n)) n = `${base} ${k++}`; return n; };
        switch (name) {
            case 'addvar': this._meAddVar(); return true;
            case 'vartoggle': this._meVarToggle(vi, el); return true;
            case 'delvar': this._meDelVar(vi); return true;
            case 'addfield': this._meVarStruct(vi, (v) => { v.fields = (v.fields || []).concat([{ name: uniqueName(v.fields || [], I18n.t('新字段')), type: 'string', default: '' }]); }); return true;
            case 'delfield': this._meDeleted(this._meVarStruct(vi, (v) => { v.fields.splice(num('data-fi'), 1); }), I18n.t('已删除一个字段。')); return true;
            case 'additem': this._meAddListItem(vi); return true;
            case 'delitem': this._meDeleted(this._meVarStruct(vi, (v) => { v.initialValue.splice(num('data-ii'), 1); }), I18n.t('已删除一项。')); return true;
            case 'addobj': this._meVarStruct(vi, (v) => {
                const o = {}; (v.fields || []).forEach((f) => { o[f.name] = f.default; });
                v.initialValue = (Array.isArray(v.initialValue) ? v.initialValue : []).concat([o]);
                this._meObjShown(vi, 0);
                this._meObjPin[vi] = v.initialValue.length - 1;
            }); return true;
            case 'moreobj': {
                const v = this._meVarsDraft(this.moduleSystem.getModule(this._meSel))[vi];
                this._meObjOpen[vi] = this._meObjShown(vi, v.initialValue.length) + 50;
                delete this._meObjPin[vi];
                this._meRedrawVars();
                return true;
            }
            case 'delobj': this._meDeleted(this._meVarStruct(vi, (v) => { v.initialValue.splice(num('data-oi'), 1); this._meObjShown(vi, 0); delete this._meObjPin[vi]; }), I18n.t('已删除一项。')); return true;
            case 'addrule': this._meVarStruct(vi, (v) => { v.changeRules = (v.changeRules || []).concat([{ name: uniqueName(v.changeRules || [], I18n.t('新规则')), operation: defOp(v), value: v.type === 'number' ? 1 : '' }]); }); return true;
            case 'delrule': this._meDeleted(this._meVarStruct(vi, (v) => { v.changeRules.splice(num('data-ri'), 1); if (!v.changeRules.length) delete v.changeRules; }), I18n.t('已删除一条规则。')); return true;
            case 'addcomp': this._meVarStruct(vi, (v) => {
                const t = this._meUiType(v);
                const f = t === 'number' ? '0' : (t === 'boolean' ? 'true' : "''");
                v.computeConditions = (v.computeConditions || []).concat([{ conditionDef: { logic: 'OR', groups: [] }, formula: f }]);
            }); return true;
            case 'delcomp': this._meDeleted(this._meVarStruct(vi, (v) => { v.computeConditions.splice(num('data-ki'), 1); }), I18n.t('已删除一条自动计算。')); return true;
            case 'compup': case 'compdown': this._meVarStruct(vi, (v) => {
                const k = num('data-ki'); const j = name === 'compup' ? k - 1 : k + 1;
                if (j < 0 || j >= v.computeConditions.length) return;
                [v.computeConditions[k], v.computeConditions[j]] = [v.computeConditions[j], v.computeConditions[k]];
            }); return true;
            case 'addsw': this._meVarStruct(vi, (v) => { v.switchConditions = (v.switchConditions || []).concat([{ type: 'display', action: 'open', condition: { logic: 'OR', groups: [] } }]); }); return true;
            case 'delsw': this._meDeleted(this._meVarStruct(vi, (v) => { v.switchConditions.splice(num('data-si'), 1); }), I18n.t('已删除一条开放条件。')); return true;
            case 'seg': return this._meSegClick(el);
            default: return false;
        }
    },

    /** 是 / 否切换和「限制 / 不限」切换 */
    _meSegClick(el) {
        const row = el.closest('.me-var');
        if (!row) return false;
        const vi = Number(row.getAttribute('data-vi'));
        const on = el.getAttribute('data-val') === '1';
        const optk = el.getAttribute('data-optk');
        const vkseg = el.getAttribute('data-vkseg');
        const ivbool = el.getAttribute('data-ivbool');
        this._meVarStruct(vi, (v) => {
            if (optk) {
                if (!on) delete v[optk];
                else v[optk] = optk === 'maxLength' ? 100 : (optk === 'min' ? 0 : 100);
            } else if (vkseg === 'readonly') {
                if (on) delete v.readonly; else v.readonly = true;
            } else if (ivbool) {
                v.initialValue = on;
            }
        });
        return true;
    },

    // ---- 输入框内容改变 ----

    _meVarChange(t) {
        const row = t.closest('.me-var');
        if (!row) return;
        const m = this.moduleSystem.getModule(this._meSel);
        const draft = this._meVarsDraft(m);
        const v = draft[Number(row.getAttribute('data-vi'))];
        if (!v) return;
        const num = (s) => (s === '' ? 0 : Number(s));
        const fk = t.getAttribute('data-fk');
        const rk = t.getAttribute('data-rk');
        const ck = t.getAttribute('data-ck');
        const sk = t.getAttribute('data-sk');
        const ok = t.getAttribute('data-ok');
        const key = t.getAttribute('data-vk');
        if (fk) {
            const f = v.fields[Number(t.closest('.me-field').getAttribute('data-fi'))];
            if (fk === 'default') f.default = f.type === 'boolean' ? t.value === 'true' : (f.type === 'number' ? num(t.value) : t.value);
            else f[fk] = t.value;
            if (fk === 'type') f.default = f.type === 'number' ? 0 : (f.type === 'boolean' ? false : '');
            this._meCommitVars(fk === 'type');
            return;
        }
        if (rk) {
            const r = v.changeRules[Number(t.closest('.me-rule').getAttribute('data-ri'))];
            const parts = ModuleEditor.ruleParts(r, v.type) || { operation: r.operation, value: r.value };
            if (rk === 'name') r.name = t.value;
            else if (rk === 'operation') { parts.operation = t.value; }
            else if (rk === 'value') parts.value = v.type === 'number' ? num(t.value) : (v.type === 'boolean' ? t.value === 'true' : t.value);
            if (rk !== 'name') { r.operation = parts.operation; r.value = parts.value; }
            this._meCommitVars(false);
            return;
        }
        if (ck) {
            const c = v.computeConditions[Number(t.closest('.me-comp').getAttribute('data-ki'))];
            const vt = this._meUiType(v);
            if (ck === 'value') c.formula = ModuleEditor.formulaFromLiteral(vt, vt === 'number' ? num(t.value) : (vt === 'boolean' ? t.value === 'true' : t.value));
            else if (ck === 'formula') {
                try { c.formula = ModuleEditor.formulaFromDisplay(t.value, this._meAllVars()); }
                catch (e) { this._meVarShowError(e.message); return; }
            } else if (ck === 'mode') {
                if (t.value === 'value') c.formula = vt === 'number' ? '0' : (vt === 'boolean' ? 'true' : "''");
                this._meVarStruct(Number(row.getAttribute('data-vi')), () => {});
                return;
            }
            this._meCommitVars(false);
            return;
        }
        if (sk) {
            const s = v.switchConditions[Number(t.closest('.me-comp').getAttribute('data-si'))];
            s[sk] = t.value;
            this._meCommitVars(false);
            return;
        }
        if (ok) {
            const f = (v.fields || []).find((x) => x.name === ok);
            const val = f && f.type === 'number' ? num(t.value) : (f && f.type === 'boolean' ? t.value === 'true' : t.value);
            const oi = Number(t.closest('.me-objval').getAttribute('data-oi'));
            if (oi < 0) v.initialValue = Object.assign({}, v.initialValue || {}, { [ok]: val });
            else { v.initialValue = (v.initialValue || []).slice(); v.initialValue[oi] = Object.assign({}, v.initialValue[oi] || {}, { [ok]: val }); }
            this._meCommitVars(false);
            return;
        }
        if (key === 'newitem') return;
        if (key === 'name') v.name = t.value;
        else if (key === 'type') {
            const ui = this._meUiType(v);
            if (t.value === ui) return;
            v.type = t.value;
            v.initialValue = undefined;
            delete v.min; delete v.max; delete v.maxLength; delete v.elementType; delete v.listItemType;
            if (v.type === 'object' || v.type === 'list_of_object') v.fields = v.fields || [];
            if (v.changeRules) {
                v.changeRules = v.changeRules.filter((r) => (ModuleEditor.RULE_OPS[v.type] || []).some(([o]) => o === r.operation) || !ModuleEditor.ruleParts(r, v.type));
                if (!v.changeRules.length) delete v.changeRules;
            }
            if (v.computeConditions) v.computeConditions = [];
            this._meCommitVars(true);
            return;
        } else if (key === 'category') {
            v.category = t.value;
            this._meCommitVars(true);
            return;
        } else if (key === 'iv') {
            v.initialValue = v.type === 'number' ? num(t.value) : t.value;
        } else if (key === 'generalRules') {
            v.generalRules = t.value;
        } else if (key === 'min' || key === 'max' || key === 'maxLength') {
            v[key] = t.value === '' ? undefined : Number(t.value);
        } else if (key === 'elementType') {
            v.elementType = t.value; v.initialValue = [];
            if (t.value !== 'object') delete v.listItemType;
            this._meCommitVars(true);
            return;
        }
        this._meCommitVars(false);
    }
});
