/**
 * 条件编辑器（并且 / 或者）—— 可复用组件，参考 260406 手机文游编辑器 condition-builder。
 *
 * 数据结构（与 condition-system.js 实际评估一致）：
 *   conditionDef = { logic:'OR', groups:[ { logic:'AND', items:[ {itemType:'condition', condition:<C>} ] } ] }
 *   组与组 = 或者；组内规则 = 并且；无组 = 始终满足。
 *   C: {type:'variable', variableId, operator, value}
 *      {type:'variable_compare', variableId, operator, compareVariableId}
 *
 * 运算符只暴露引擎 compareValues 真支持的（>= <= == != > <），避免做出"假条件"。
 * 变量只列引擎能可靠比较的 number/string/boolean，list/object 不可选并给说明。
 * 全部经典白底黑字灰自定义控件，无任何浏览器原生 select / number spinner。
 *
 * 用法：const ctl = ConditionBuilder.mount(container, def, { variables:[{id,name,type}], onChange });
 *       ctl.getValue() -> 规范化 conditionDef（空返回 null）
 */
const ConditionBuilder = {
    _ops(type) {
        if (type === 'number') {
            return [
                { v: '>=', t: I18n.t('大于等于') }, { v: '<=', t: I18n.t('小于等于') },
                { v: '>', t: I18n.t('大于') }, { v: '<', t: I18n.t('小于') },
                { v: '==', t: I18n.t('等于') }, { v: '!=', t: I18n.t('不等于') }
            ];
        }
        return [{ v: '==', t: I18n.t('等于') }, { v: '!=', t: I18n.t('不等于') }];
    },

    _esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    },

    _varDef(id) { return (this._vars || []).find(v => v && v.id === id) || null; },

    _selectableVars() {
        return (this._vars || []).filter(v => v && ['number', 'string', 'boolean'].includes(v.type));
    },

    _typeLabel(t) { return ({ number: I18n.t('数值'), string: I18n.t('文字'), boolean: I18n.t('开关') })[t] || t; },

    /** 一条规则是否填完整、能真正判断；没填完的规则只留在界面上，不写进模组 */
    _itemValid(it) {
        if (!it || it.itemType !== 'condition' || !it.condition) return false;
        const c = it.condition;
        const t = c.type || 'variable';
        if (t === 'variable') {
            if (!c.variableId) return false;
            // 对比对象是另一个变量时，两个变量要同类型；否则比较值不能空，数值变量的比较值要是数字
            if (c.compareKind === 'variable') {
                if (!c.compareVariableId) return false;
                const vDef = this._varDef(c.variableId), cDef = this._varDef(c.compareVariableId);
                return !!(vDef && cDef && vDef.type === cDef.type);
            }
            if (c.value === '' || c.value === undefined || c.value === null) return false;
            const vDef = this._varDef(c.variableId);
            if (vDef && vDef.type === 'number' && isNaN(Number(c.value))) return false;
            return true;
        }
        if (t === 'variable_compare') {
            if (!c.variableId || !c.compareVariableId) return false;
            const vDef = this._varDef(c.variableId), cDef = this._varDef(c.compareVariableId);
            return !!(vDef && cDef && vDef.type === cDef.type);
        }
        if (t === 'module') return !!c.moduleId && !!c.state;
        if (t === 'time') {
            const mode = c.mode || c.timeType || 'absolute';
            if (mode === 'relative') return !!(c.relative && c.relative.moduleId && c.relative.state);
            if (mode === 'variable_compare') return !!(c.variableId && c.operator);
            return !!(c.time && (c.time.year || c.time.month || c.time.day));
        }
        if (t === 'time_range') return !!(c.start || c.end);
        if (t === 'tag') return Array.isArray(c.tags) && c.tags.length > 0;
        if (t === 'stage_completed') return Array.isArray(c.pathIds) && c.pathIds.length > 0;
        if (t === 'event_completed') return !!c.eventId;
        return false;
    },

    _normalize(def) {
        if (!def || !Array.isArray(def.groups)) return null;
        const groups = def.groups.map(g => {
            const items = (g.items || []).filter(it => this._itemValid(it));
            return items.length ? { logic: 'AND', items } : null;
        }).filter(Boolean);
        return groups.length ? { logic: 'OR', groups } : null;
    },

    /**
     * 把任意嵌套的条件结构（AND/OR 组合、组里套组）展开成「或者的若干组，组内并且」，含义不变。
     * 编辑器只表达这种形式；不先展开的话，组内「或者」、嵌套组会在保存时被悄悄改成「并且」或丢掉。
     * 展开后超过 64 组时返回 null（条件太复杂，不在这里编辑）。
     * @returns {{ logic: 'OR', groups: Array }|null}
     */
    _toDnf(def) {
        if (!def || !Array.isArray(def.groups)) return { logic: 'OR', groups: [] };
        const LIMIT = 64;
        let overflow = false;
        const cross = (a, b) => {
            const out = [];
            for (const x of a) for (const y of b) out.push(x.concat(y));
            if (out.length > LIMIT) overflow = true;
            return out;
        };
        const combine = (logic, parts) => {
            if (!parts.length) return [[]];
            if (String(logic || 'AND').toUpperCase() === 'OR') {
                const out = [].concat(...parts);
                if (out.length > LIMIT) overflow = true;
                return out;
            }
            return parts.reduce((acc, p) => cross(acc, p), [[]]);
        };
        const group = (g) => {
            const parts = (g.items || []).map((it) => {
                if (!it) return null;
                if (it.itemType === 'group' && it.group) return group(it.group);
                if (it.itemType === 'condition' && it.condition) return [[it.condition]];
                return null;
            }).filter(Boolean);
            return combine(g.logic, parts);
        };
        const dnf = combine(def.logic, def.groups.filter(Boolean).map(group));
        if (overflow) return null;
        // 有一组是空的（始终满足），整体就是始终满足
        if (dnf.some((c) => c.length === 0)) return { logic: 'OR', groups: [] };
        return { logic: 'OR', groups: dnf.map((c) => ({ logic: 'AND', items: c.map((condition) => ({ itemType: 'condition', condition })) })) };
    },

    mount(container, def, opts) {
        opts = opts || {};
        // 每次 mount 产生独立实例，否则进入/完成两个编辑器共用单例状态会互相污染
        const inst = Object.create(ConditionBuilder);
        inst._vars = opts.variables || [];
        inst._modules = opts.modules || [];  // [{id,name}] 给 module / time relative 模块选择用
        inst._onChange = typeof opts.onChange === 'function' ? opts.onChange : function () {};
        inst._onRemoved = typeof opts.onRemoved === 'function' ? opts.onRemoved : null;
        inst._units = opts.units || null;  // { mph, hpd, dpm, mpy }：时间框的取值范围按它收回
        const flat = this._toDnf(def && Array.isArray(def.groups) ? JSON.parse(JSON.stringify(def)) : null);
        if (flat === null) {
            container.innerHTML = `<div class="cbx-empty">${I18n.t('这组条件的组合太复杂，不在这里编辑。')}</div>`;
            return { getValue: () => (def && Array.isArray(def.groups) ? def : null), destroy: () => { container.innerHTML = ''; } };
        }
        inst._def = flat;
        if (!inst._def.groups) inst._def.groups = [];
        inst._container = container;
        inst._render();
        return {
            getValue: () => inst._normalize(inst._def),
            destroy: () => { if (inst._container) inst._container.innerHTML = ''; }
        };
    },

    _emit() {
        this._syncRuleState();
        this._onChange(this._normalize(this._def));
    },

    /** 每条规则按当前内容显示「还没填完」的提示 */
    _syncRuleState() {
        if (!this._container) return;
        this._container.querySelectorAll('.cbx-rule').forEach((el) => {
            const [gi, ri] = el.getAttribute('data-r').split('|').map(Number);
            const group = this._def.groups[gi];
            const ok = this._itemValid(group && group.items[ri]);
            el.classList.toggle('cbx-incomplete', !ok);
            const hint = el.querySelector(':scope > .cbx-hint');
            if (!ok && !hint) {
                const h = document.createElement('div');
                h.className = 'cbx-hint';
                h.textContent = I18n.t('还没填完，暂时不会生效。');
                el.appendChild(h);
            } else if (ok && hint) hint.remove();
        });
    },

    _render() {
        const esc = this._esc.bind(this);
        const def = this._def;
        const parts = ['<div class="cbx">'];
        if (!def.groups.length) parts.push(`<div class="cbx-empty">${I18n.t('无条件，始终满足。')}</div>`);
        def.groups.forEach((g, gi) => {
            if (gi > 0) parts.push(`<div class="cbx-or">${I18n.t('或者')}</div>`);
            parts.push(`<div class="cbx-group" data-g="${gi}">`);
            parts.push(`<div class="cbx-ghead"><span class="cbx-gtitle">${I18n.t('条件组 {n}（组内全部满足）', { n: gi + 1 })}</span>` +
                `<button type="button" class="cbx-btn cbx-del" data-delg="${gi}">${I18n.t('删除本组')}</button></div>`);
            (g.items || []).forEach((it, ri) => {
                if (ri > 0) parts.push(`<div class="cbx-and">${I18n.t('并且')}</div>`);
                parts.push(this._ruleHtml(it.condition || {}, gi, ri));
            });
            parts.push(`<button type="button" class="cbx-btn cbx-add" data-addrule="${gi}">${I18n.t('+ 并且（加一条规则）')}</button>`);
            parts.push('</div>');
        });
        parts.push(`<button type="button" class="cbx-btn cbx-addg">${I18n.t('+ 或者（加一个条件组）')}</button>`);
        parts.push('</div>');
        this._container.innerHTML = parts.join('');
        this._bind();
    },

    /** 规则类型选项：
     *  variable / variable_compare：变量
     *  module：单模块状态（已进入/已完成）
     *  stage_completed：多模块（pathIds 批量都已完成）
     *  event_completed：时间线事件已触发的别名（语义 = module + state=completed，但 UI 上单独暴露）
     *  time：时间到达（absolute / relative / variable_compare 子类型）
     *  time_range：时间区间（含周期重复 + firstDayOnly 仅周期第一天触发）
     *  tag：多标签（matchType any/all）
     */
    _typeOpts() {
        return [
            { v: 'variable', t: I18n.t('变量') },
            { v: 'variable_compare', t: I18n.t('变量对比') },
            { v: 'module', t: I18n.t('模块状态') },
            { v: 'stage_completed', t: I18n.t('阶段已完成（多模块批量）') },
            { v: 'event_completed', t: I18n.t('时间线事件已触发') },
            { v: 'time', t: I18n.t('时间到达') },
            { v: 'time_range', t: I18n.t('时间区间') },
            { v: 'tag', t: I18n.t('标签') }
        ];
    },
    _typeLabelOf(type) { return (this._typeOpts().find(o => o.v === type) || { t: I18n.t('变量') }).t; },

    _ruleHtml(c, gi, ri) {
        const esc = this._esc.bind(this);
        // 第一个字段：规则类型选择（让作者一眼看见有几种条件可选——不藏到下级菜单里）
        const typeDD = this._ddHtml(`t|${gi}|${ri}`, this._typeLabelOf(c.type || 'variable'), this._typeOpts().map(o => ({ val: o.v, label: o.t })));
        let fields = '';
        if (c.type === 'variable' || !c.type) {
            // 变量比较对象 = 「值 / 变量」切换下拉；选「变量」时和 variable_compare 一样下拉真实变量，不让手敲 id
            const sel = this._selectableVars();
            const vDef = this._varDef(c.variableId);
            const vType = vDef ? vDef.type : 'number';
            const varDD = this._ddHtml(`v|${gi}|${ri}`, vDef ? vDef.name : I18n.t('（选择变量）'), sel.map(v => ({ val: v.id, label: `${v.name}${I18n.t('（{type}）', { type: this._typeLabel(v.type) })}` })));
            const ops = this._ops(vType);
            const curOp = ops.find(o => o.v === c.operator) || ops[0];
            const opDD = this._ddHtml(`o|${gi}|${ri}`, curOp ? curOp.t : I18n.t('运算符'), ops.map(o => ({ val: o.v, label: o.t })));
            const cmpKind = c.compareKind === 'variable' ? 'variable' : 'value';
            const cmpKindDD = this._ddHtml(`ck|${gi}|${ri}`, cmpKind === 'variable' ? I18n.t('变量') : I18n.t('值'), [{ val: 'value', label: I18n.t('值') }, { val: 'variable', label: I18n.t('变量') }]);
            let valHtml;
            if (cmpKind === 'variable') {
                // 对比变量只列与主变量类型相同的，类型不同的比较没有意义
                const sameType = sel.filter(v => v.type === vType);
                const cmpDef = this._varDef(c.compareVariableId);
                valHtml = this._ddHtml(`cv|${gi}|${ri}`, cmpDef ? cmpDef.name : I18n.t('（选择同类型变量）'), sameType.map(v => ({ val: v.id, label: v.name })));
            } else if (vType === 'boolean') {
                valHtml = this._ddHtml(`b|${gi}|${ri}`, (c.value === true || c.value === 'true') ? I18n.t('是') : I18n.t('否'), [{ val: 'true', label: I18n.t('是') }, { val: 'false', label: I18n.t('否') }]);
            } else {
                const kind = vType === 'number' ? 'type="text" inputmode="decimal" data-numonly="decimal"' : 'type="text"';
                valHtml = `<input ${kind} class="cbx-val" data-val="${gi}|${ri}" value="${esc(c.value == null ? '' : c.value)}" placeholder="${vType === 'number' ? I18n.t('数值') : I18n.t('文字')}">`;
            }
            fields = `${varDD}${opDD}${cmpKindDD}${valHtml}`;
        } else if (c.type === 'variable_compare') {
            const sel = this._selectableVars();
            const vDef = this._varDef(c.variableId);
            const vType = vDef ? vDef.type : 'number';
            const varDD = this._ddHtml(`v|${gi}|${ri}`, vDef ? vDef.name : I18n.t('（选择变量）'), sel.map(v => ({ val: v.id, label: `${v.name}${I18n.t('（{type}）', { type: this._typeLabel(v.type) })}` })));
            const ops = this._ops(vType);
            const curOp = ops.find(o => o.v === c.operator) || ops[0];
            const opDD = this._ddHtml(`o|${gi}|${ri}`, curOp ? curOp.t : I18n.t('运算符'), ops.map(o => ({ val: o.v, label: o.t })));
            // 对比变量只列与主变量同类型
            const sameType = sel.filter(v => v.type === vType);
            const cmpDef = this._varDef(c.compareVariableId);
            const cmpDD = this._ddHtml(`cv|${gi}|${ri}`, cmpDef ? cmpDef.name : I18n.t('（选择同类型变量）'), sameType.map(v => ({ val: v.id, label: v.name })));
            fields = `${varDD}${opDD}${cmpDD}`;
        } else if (c.type === 'module') {
            const mods = this._modules || [];
            const mDef = mods.find(m => m.id === c.moduleId);
            const modDD = this._ddHtml(`m|${gi}|${ri}`, mDef ? mDef.name : I18n.t('（选择模块）'), mods.map(m => ({ val: m.id, label: m.name || m.id })));
            // 状态下拉：已进入 / 已完成 / 未触发
            const stateLabel = c.state === 'completed' ? I18n.t('已完成') : (c.state === 'untriggered' ? I18n.t('未触发') : I18n.t('已进入'));
            const stateDD = this._ddHtml(`ms|${gi}|${ri}`, stateLabel, [
                { val: 'entered', label: I18n.t('已进入') },
                { val: 'completed', label: I18n.t('已完成') },
                { val: 'untriggered', label: I18n.t('未触发') }
            ]);
            fields = `${modDD}${stateDD}`;
        } else if (c.type === 'stage_completed') {
            // 多模块批量已完成：选多个模块（逗号分隔模块名/id 列出），全部 completed 才满足
            const mods = this._modules || [];
            const cur = Array.isArray(c.pathIds) ? c.pathIds : [];
            const curNames = cur.map(id => { const m = mods.find(mm => mm.id === id); return m ? (m.name || m.id) : id; }).join('，');
            // 列所有模块作为可选项；点哪个就加/移
            const opts = mods.map(m => ({ val: m.id, label: `${m.name || m.id}${cur.indexOf(m.id) >= 0 ? I18n.t('（已选）') : ''}` }));
            const pickDD = this._ddHtml(`sc|${gi}|${ri}`, cur.length ? I18n.t('已选 {n} 个', { n: cur.length }) : I18n.t('（点击逐个加）'), opts);
            fields = `${pickDD}<input type="text" class="cbx-val cbx-tagin" data-stagelist="${gi}|${ri}" value="${esc(curNames)}" placeholder="${I18n.t('从上面下拉里逐个加')}" readonly>`;
        } else if (c.type === 'event_completed') {
            // 时间线事件已触发——单模块的语义化别名（与 module + state=completed 等价但表达更清晰）
            const mods = this._modules || [];
            const mDef = mods.find(m => m.id === c.eventId);
            const evDD = this._ddHtml(`ev|${gi}|${ri}`, mDef ? mDef.name : I18n.t('（选择时间线事件）'), mods.map(m => ({ val: m.id, label: m.name || m.id })));
            fields = `${evDD}<span class="cbx-tlab">${I18n.t('已触发')}</span>`;
        } else if (c.type === 'time') {
            // time 4 变体：absolute（精确日期）/ relative（相对模块偏移，含相对路径后 N 天 + 相对锚点）/ variable_compare（日期变量比较）
            const mode = c.mode || c.timeType || 'absolute';
            const modeOpts = [
                { val: 'absolute', label: I18n.t('精确日期') },
                { val: 'relative', label: I18n.t('相对模块进入/完成后偏移') },
                { val: 'variable_compare', label: I18n.t('比较日期变量') }
            ];
            const curModeLabel = (modeOpts.find(o => o.val === mode) || modeOpts[0]).label;
            const ttDD = this._ddHtml(`tt|${gi}|${ri}`, curModeLabel, modeOpts);
            if (mode === 'absolute') {
                const tm = c.time || {};
                const f = (k, lab) => `<span class="cbx-tu"><label>${lab}</label><input type="text" inputmode="numeric" class="cbx-val cbx-tin" data-tabs="${gi}|${ri}|${k}" value="${esc(tm[k] != null ? tm[k] : '')}"></span>`;
                fields = `${ttDD}${f('year', I18n.t('年'))}${f('month', I18n.t('月'))}${f('day', I18n.t('日'))}${f('hour', I18n.t('时'))}${f('minute', I18n.t('分'))}`;
            } else if (mode === 'relative') {
                const rel = c.relative || {};
                const mods = this._modules || [];
                const mDef = mods.find(m => m.id === rel.moduleId);
                const modDD = this._ddHtml(`tr-m|${gi}|${ri}`, mDef ? mDef.name : I18n.t('（锚点模块）'), mods.map(m => ({ val: m.id, label: m.name || m.id })));
                const stateDD = this._ddHtml(`tr-s|${gi}|${ri}`, rel.state === 'completed' ? I18n.t('完成后') : I18n.t('进入后'), [{ val: 'entered', label: I18n.t('进入后') }, { val: 'completed', label: I18n.t('完成后') }]);
                const off = rel.offset || {};
                const f = (k, lab) => `<span class="cbx-tu"><label>${lab}</label><input type="text" inputmode="numeric" class="cbx-val cbx-tin" data-trel="${gi}|${ri}|${k}" value="${esc(off[k] != null ? off[k] : '')}"></span>`;
                fields = `${ttDD}${modDD}${stateDD}${f('year', I18n.t('+年'))}${f('month', I18n.t('+月'))}${f('day', I18n.t('+日'))}${f('hour', I18n.t('+时'))}${f('minute', I18n.t('+分'))}`;
            } else {
                // variable_compare：日期变量比较——选一个变量，比它当时记录的时间值是否 ≤/≥ 当前
                const sel = this._selectableVars();
                const vDef = this._varDef(c.variableId);
                const varDD = this._ddHtml(`tv|${gi}|${ri}`, vDef ? vDef.name : I18n.t('（选择日期变量）'), sel.map(v => ({ val: v.id, label: v.name || v.id })));
                const ops = [{ v: '>=', t: I18n.t('≥（当前不早于变量值）') }, { v: '<=', t: I18n.t('≤（当前不晚于变量值）') }];
                const curOp = ops.find(o => o.v === c.operator) || ops[0];
                const opDD = this._ddHtml(`tvop|${gi}|${ri}`, curOp.t, ops.map(o => ({ val: o.v, label: o.t })));
                fields = `${ttDD}${varDD}${opDD}`;
            }
        } else if (c.type === 'time_range') {
            // 区间：精确日期 start/end + 周期 interval + 仅周期第一天触发 firstDayOnly
            const s = c.start || {}, e2 = c.end || {};
            const rep = c.repeat || {};
            const repIntKey = rep.interval && typeof rep.interval === 'object' ? Object.keys(rep.interval)[0] : '';
            const firstDay = !!c.firstDayOnly;
            const f = (k, lab, obj, dataKey) => `<span class="cbx-tu"><label>${lab}</label><input type="text" inputmode="numeric" class="cbx-val cbx-tin" data-${dataKey}="${gi}|${ri}|${k}" value="${esc(obj[k] != null ? obj[k] : '')}"></span>`;
            const repDD = this._ddHtml(`rep|${gi}|${ri}`, repIntKey === 'year' ? I18n.t('每年') : (repIntKey === 'month' ? I18n.t('每月') : (repIntKey === 'day' ? I18n.t('每天') : I18n.t('不重复'))),
                [{ val: '', label: I18n.t('不重复') }, { val: 'year', label: I18n.t('每年') }, { val: 'month', label: I18n.t('每月') }, { val: 'day', label: I18n.t('每天') }]);
            const firstDayBtn = `<button type="button" class="cbx-mini${firstDay ? ' on' : ''}" data-firstday="${gi}|${ri}" title="${I18n.t('只在每个周期的第一天触发')}">${firstDay ? I18n.t('仅周期首日') : I18n.t('整个周期')}</button>`;
            fields = `<span class="cbx-tlab">${I18n.t('从')}</span>${f('year', I18n.t('年'), s, 'trs')}${f('month', I18n.t('月'), s, 'trs')}${f('day', I18n.t('日'), s, 'trs')}` +
                `<span class="cbx-tlab">${I18n.t('到')}</span>${f('year', I18n.t('年'), e2, 'tre')}${f('month', I18n.t('月'), e2, 'tre')}${f('day', I18n.t('日'), e2, 'tre')}${repDD}${firstDayBtn}`;
        } else if (c.type === 'tag') {
            const tagsStr = Array.isArray(c.tags) ? c.tags.join('，') : '';
            const mt = c.matchType || 'any';
            const mtDD = this._ddHtml(`mt|${gi}|${ri}`, mt === 'all' ? I18n.t('全部满足') : I18n.t('任一满足'), [{ val: 'any', label: I18n.t('任一满足') }, { val: 'all', label: I18n.t('全部满足') }]);
            fields = `<input type="text" class="cbx-val cbx-tagin" data-tags="${gi}|${ri}" value="${esc(tagsStr)}" placeholder="${I18n.t('逗号分隔多个标签')}">${mtDD}`;
        }
        const complete = this._itemValid({ itemType: 'condition', condition: c });
        return `<div class="cbx-rule${complete ? '' : ' cbx-incomplete'}" data-r="${gi}|${ri}">` +
            `<div class="cbx-rfields">${typeDD}${fields}</div>` +
            `<button type="button" class="cbx-btn cbx-del" data-delr="${gi}|${ri}" aria-label="${I18n.t('删除这条规则')}">×</button>` +
            (complete ? '' : `<div class="cbx-hint">${I18n.t('还没填完，暂时不会生效。')}</div>`) + '</div>';
    },

    /**
     * 下拉带搜索过滤：选模块 / 变量时输入关键字实时过滤选项；
     * 选项只能从列表里选，不让手敲编号
     * 阈值：选项 >= 5 才出搜索框（小列表不要打扰）
     */
    _ddHtml(key, label, options) {
        const esc = this._esc.bind(this);
        // 选项按钮在第一次展开时才生成（一个变量下拉有几十项，一页几十个条件就是几千个按钮）
        if (!this._ddOptions) this._ddOptions = {};
        this._ddOptions[key] = options;
        const searchBox = (options.length >= 5)
            ? `<input type="text" class="cbx-ddsearch" placeholder="${I18n.t('搜索')}" data-ddsearch="${esc(key)}">`
            : '';
        return `<div class="cbx-dd" data-dd="${esc(key)}">` +
            `<button type="button" class="cbx-ddbtn" data-ddtoggle="${esc(key)}">` +
            `<span class="cbx-ddlab">${esc(label)}</span><span class="cbx-ddcar" aria-hidden="true"></span></button>` +
            `<div class="cbx-ddlist" hidden>${searchBox}<div class="cbx-ddopts" data-ddfill="${esc(key)}"></div></div></div>`;
    },

    /** 生成某个下拉的选项按钮（只做一次） */
    _fillDropdown(list) {
        const holder = list.querySelector('[data-ddfill]');
        if (!holder) return;
        const key = holder.getAttribute('data-ddfill');
        holder.removeAttribute('data-ddfill');
        const esc = this._esc.bind(this);
        const options = (this._ddOptions && this._ddOptions[key]) || [];
        holder.innerHTML = options.map(o =>
            `<button type="button" class="cbx-ddopt" data-ddpick="${esc(key)}" data-ddval="${esc(o.val)}">${esc(o.label)}</button>`
        ).join('') || `<div class="cbx-ddempty">${I18n.t('无可选项')}</div>`;
        holder.addEventListener('click', (e) => {
            const b = e.target.closest('[data-ddpick]');
            if (!b || !holder.contains(b)) return;
            e.stopPropagation();
            list.hidden = true;
            this._onPick(b.getAttribute('data-ddpick'), b.getAttribute('data-ddval'));
        });
    },

    /** 只收数字的输入框：键盘、粘贴、输入法都拦，非法字符进不去；空着表示不设置 */
    _bindDigitsOnly(root) {
        const rules = [['.cbx-tin', /^[0-9]*$/, /[^0-9]/g], ['[data-numonly="decimal"]', /^-?[0-9]*\.?[0-9]*$/, /[^0-9.\-]/g]];
        rules.forEach(([sel, full, strip]) => root.querySelectorAll(sel).forEach((inp) => {
            inp.addEventListener('beforeinput', (e) => {
                if (e.inputType && e.inputType.indexOf('insert') === 0 && e.data != null && !full.test(inp.value.slice(0, inp.selectionStart) + e.data + inp.value.slice(inp.selectionEnd))) e.preventDefault();
            });
            inp.addEventListener('input', () => {
                if (!full.test(inp.value)) inp.value = inp.value.replace(strip, '');
            });
        }));
    },

    _bind() {
        const root = this._container;
        this._bindDigitsOnly(root);
        const closeAll = () => root.querySelectorAll('.cbx-ddlist').forEach(l => l.hidden = true);
        root.querySelectorAll('[data-ddtoggle]').forEach(b => b.addEventListener('click', (e) => {
            e.stopPropagation();
            const list = b.parentElement.querySelector('.cbx-ddlist');
            const willOpen = list.hidden;
            closeAll();
            if (willOpen) this._fillDropdown(list);
            list.hidden = !willOpen;
            // F8：打开时聚焦搜索框
            if (willOpen) { const s = list.querySelector('.cbx-ddsearch'); if (s) setTimeout(() => s.focus(), 0); }
        }));
        // F8：搜索框实时过滤选项
        root.querySelectorAll('[data-ddsearch]').forEach(inp => {
            inp.addEventListener('click', e => e.stopPropagation());
            inp.addEventListener('input', () => {
                const q = inp.value.trim().toLowerCase();
                const list = inp.parentElement;
                list.querySelectorAll('.cbx-ddopt').forEach(opt => {
                    const txt = opt.textContent.toLowerCase();
                    opt.style.display = (!q || txt.includes(q)) ? '' : 'none';
                });
            });
        });
        if (this._docClose) document.removeEventListener('click', this._docClose);
        this._docClose = () => closeAll();
        document.addEventListener('click', this._docClose);
        // variable 类型的 value 输入
        root.querySelectorAll('[data-val]:not(.cbx-tin):not(.cbx-tagin)').forEach(inp => inp.addEventListener('input', () => {
            const [gi, ri] = inp.getAttribute('data-val').split('|').map(Number);
            const c = this._def.groups[gi].items[ri].condition;
            const vDef = this._varDef(c.variableId);
            c.value = (vDef && vDef.type === 'number') ? this._toNum(inp.value) : inp.value;
            this._emit();
        }));
        // 时间框：超出范围的数字收回到范围内，并说明
        root.querySelectorAll('[data-tabs], [data-trs], [data-tre]').forEach(inp => inp.addEventListener('change', () => this._clampTimeInput(inp)));
        // time absolute 字段
        root.querySelectorAll('[data-tabs]').forEach(inp => inp.addEventListener('input', () => {
            const [gis, ris, key] = inp.getAttribute('data-tabs').split('|');
            const c = this._def.groups[+gis].items[+ris].condition;
            if (!c.time) c.time = {};
            const n = parseInt(inp.value, 10);
            if (inp.value === '') delete c.time[key]; else if (!isNaN(n)) c.time[key] = n;
            this._emit();
        }));
        // time relative offset
        root.querySelectorAll('[data-trel]').forEach(inp => inp.addEventListener('input', () => {
            const [gis, ris, key] = inp.getAttribute('data-trel').split('|');
            const c = this._def.groups[+gis].items[+ris].condition;
            if (!c.relative) c.relative = {};
            if (!c.relative.offset) c.relative.offset = {};
            const n = parseInt(inp.value, 10);
            if (inp.value === '') delete c.relative.offset[key]; else if (!isNaN(n)) c.relative.offset[key] = n;
            this._emit();
        }));
        // time_range start/end 字段
        root.querySelectorAll('[data-trs]').forEach(inp => inp.addEventListener('input', () => {
            const [gis, ris, key] = inp.getAttribute('data-trs').split('|');
            const c = this._def.groups[+gis].items[+ris].condition;
            if (!c.start) c.start = {};
            const n = parseInt(inp.value, 10);
            if (inp.value === '') delete c.start[key]; else if (!isNaN(n)) c.start[key] = n;
            this._emit();
        }));
        root.querySelectorAll('[data-tre]').forEach(inp => inp.addEventListener('input', () => {
            const [gis, ris, key] = inp.getAttribute('data-tre').split('|');
            const c = this._def.groups[+gis].items[+ris].condition;
            if (!c.end) c.end = {};
            const n = parseInt(inp.value, 10);
            if (inp.value === '') delete c.end[key]; else if (!isNaN(n)) c.end[key] = n;
            this._emit();
        }));
        // tag 多标签输入
        root.querySelectorAll('[data-tags]').forEach(inp => inp.addEventListener('input', () => {
            const [gi, ri] = inp.getAttribute('data-tags').split('|').map(Number);
            const c = this._def.groups[gi].items[ri].condition;
            c.tags = inp.value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
            this._emit();
        }));
        // time_range firstDayOnly 切换按钮
        root.querySelectorAll('[data-firstday]').forEach(b => b.addEventListener('click', () => {
            const [gi, ri] = b.getAttribute('data-firstday').split('|').map(Number);
            const c = this._def.groups[gi].items[ri].condition;
            c.firstDayOnly = !c.firstDayOnly;
            this._render(); this._emit();
        }));
        root.querySelectorAll('[data-delr]').forEach(b => b.addEventListener('click', () => {
            const [gi, ri] = b.getAttribute('data-delr').split('|').map(Number);
            const removed = this._def.groups[gi].items.splice(ri, 1)[0];
            if (!this._def.groups[gi].items.length) this._def.groups.splice(gi, 1);
            this._render(); this._emit();
            if (this._onRemoved && this._itemValid(removed)) this._onRemoved(I18n.t('已删除一条规则。'));
        }));
        root.querySelectorAll('[data-delg]').forEach(b => b.addEventListener('click', () => {
            const removed = this._def.groups.splice(Number(b.getAttribute('data-delg')), 1)[0];
            this._render(); this._emit();
            if (this._onRemoved && removed && (removed.items || []).some(it => this._itemValid(it))) this._onRemoved(I18n.t('已删除一个条件组。'));
        }));
        root.querySelectorAll('[data-addrule]').forEach(b => b.addEventListener('click', () => {
            this._def.groups[Number(b.getAttribute('data-addrule'))].items.push(this._blankRule());
            this._render(); this._emit();
        }));
        const ag = root.querySelector('.cbx-addg');
        if (ag) ag.addEventListener('click', () => {
            this._def.groups.push({ logic: 'AND', items: [this._blankRule()] });
            this._render(); this._emit();
        });
    },

    /** 时间框的最大值：按模组的进位单位；年没有上限，没有单位信息时也不限 */
    _timeMax(key) {
        const u = this._units;
        if (!u) return null;
        const v = ({ month: u.mpy, day: u.dpm, hour: u.hpd - 1, minute: u.mph - 1 })[key];
        return v == null ? null : v;
    },

    _clampTimeInput(inp) {
        const attr = ['data-tabs', 'data-trs', 'data-tre'].find(a => inp.hasAttribute(a));
        const key = inp.getAttribute(attr).split('|')[2];
        if (inp.value === '') return;
        const n = parseInt(inp.value, 10);
        if (isNaN(n)) return;
        const labels = { year: I18n.t('年'), month: I18n.t('月'), day: I18n.t('日'), hour: I18n.t('时'), minute: I18n.t('分') };
        let fixed = n;
        const max = this._timeMax(key);
        if (key === 'month' || key === 'day') fixed = Math.max(1, fixed);
        if (max != null) fixed = Math.min(max, fixed);
        if (fixed === n) return;
        inp.value = String(fixed);
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        if (typeof Toast !== 'undefined' && Toast.show) Toast.show(I18n.t('{label}要在 {min} 到 {max} 之间，已改为 {fixed}。', { label: labels[key], min: key === 'month' || key === 'day' ? 1 : 0, max: max != null ? max : fixed, fixed }), 'warning');
    },

    _blankRule() {
        const first = this._selectableVars()[0];
        return {
            itemType: 'condition',
            condition: { type: 'variable', variableId: first ? first.id : '', operator: first ? this._ops(first.type)[0].v : '==', value: '' }
        };
    },

    _toNum(s) { const n = Number(s); return Number.isNaN(n) ? s : n; },

    _onPick(key, val) {
        const [kind, gis, ris] = key.split('|');
        const gi = Number(gis), ri = Number(ris);
        const c = this._def.groups[gi].items[ri].condition;
        if (kind === 't') {
            // 切换规则类型：保留新类型必要字段、清掉旧类型字段，避免脏数据
            const old = c.type || 'variable';
            if (old === val) { this._render(); return; }
            for (const k of Object.keys(c)) delete c[k];
            c.type = val;
            if (val === 'variable') {
                const first = this._selectableVars()[0];
                c.variableId = first ? first.id : '';
                c.operator = first ? this._ops(first.type)[0].v : '==';
                c.value = '';
            } else if (val === 'variable_compare') {
                const first = this._selectableVars()[0];
                c.variableId = first ? first.id : '';
                c.operator = first ? this._ops(first.type)[0].v : '==';
                c.compareVariableId = '';
            } else if (val === 'module') {
                c.moduleId = (this._modules && this._modules[0] && this._modules[0].id) || '';
                c.state = 'entered';
            } else if (val === 'stage_completed') {
                c.pathIds = [];
            } else if (val === 'event_completed') {
                c.eventId = (this._modules && this._modules[0] && this._modules[0].id) || '';
            } else if (val === 'time') {
                c.mode = 'absolute';
                c.time = {};
            } else if (val === 'time_range') {
                c.start = {}; c.end = {};
            } else if (val === 'tag') {
                c.tags = []; c.matchType = 'any';
            }
        } else if (kind === 'v') {
            c.variableId = val;
            const vDef = this._varDef(val);
            const ops = this._ops(vDef ? vDef.type : 'number');
            if (!ops.find(o => o.v === c.operator)) c.operator = ops[0].v;
            if (vDef && vDef.type === 'boolean' && c.type === 'variable') c.value = 'true';
        } else if (kind === 'o') { c.operator = val; }
        // variable 行的「值 / 变量」切换：切到变量时清掉 value 并加 compareVariableId；切回值时反之
        else if (kind === 'ck') {
            c.compareKind = val;
            if (val === 'variable') { c.compareVariableId = c.compareVariableId || ''; delete c.value; }
            else { c.value = c.value == null ? '' : c.value; delete c.compareVariableId; }
        }
        else if (kind === 'cv') { c.compareVariableId = val; }
        else if (kind === 'b') { c.value = (val === 'true'); }
        else if (kind === 'm') { c.moduleId = val; }
        else if (kind === 'ms') { c.state = val; }
        else if (kind === 'sc') {
            // stage_completed 多选 pathIds：点同一个模块切换加/移
            if (!Array.isArray(c.pathIds)) c.pathIds = [];
            const idx = c.pathIds.indexOf(val);
            if (idx >= 0) c.pathIds.splice(idx, 1); else c.pathIds.push(val);
        }
        else if (kind === 'ev') { c.eventId = val; }
        else if (kind === 'tt') {
            c.mode = val;
            if (val === 'relative') { c.relative = c.relative || {}; delete c.time; delete c.variableId; delete c.operator; }
            else if (val === 'absolute') { c.time = c.time || {}; delete c.relative; delete c.variableId; delete c.operator; }
            else if (val === 'variable_compare') { delete c.time; delete c.relative; c.variableId = c.variableId || ''; c.operator = c.operator || '>='; }
        }
        else if (kind === 'tr-m') { c.relative = c.relative || {}; c.relative.moduleId = val; }
        else if (kind === 'tr-s') { c.relative = c.relative || {}; c.relative.state = val; }
        else if (kind === 'tv') { c.variableId = val; }
        else if (kind === 'tvop') { c.operator = val; }
        else if (kind === 'rep') {
            if (!val) { delete c.repeat; }
            else { c.repeat = { enabled: true, interval: { [val]: 1 } }; }
        }
        else if (kind === 'mt') { c.matchType = val; }
        this._render();
        this._emit();
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ConditionBuilder;
} else if (typeof window !== 'undefined') {
    window.ConditionBuilder = ConditionBuilder;
}
