/**
 * 标签解析器：抓取 AI 回复里的内联指令 <类型|参数|参数...>，逐条在核心系统上执行，
 * 并给每一条返回「生效了什么」或「为什么没生效」。
 *
 * 支持的标签：
 *   <var|变量名|操作|值>            <rule|变量名|规则名|参数>        <time|参数|add或set|数值>
 *   <module|enter或complete|事件名>  <delivery|标题|done或uncompleted>
 *   <foreshadow|标题|描述|触发条件>   <plugin|插件名|内容>            <summary|类型|内容>
 *
 * 名字（变量、事件、插件）以本回合发给 AI 的范围（setScope）为准，范围外的写法一律不执行。
 */

const TAG_TYPES = ['var', 'rule', 'time', 'module', 'delivery', 'foreshadow', 'plugin', 'interrupt', 'summary'];
const TAG_TYPE_PATTERN = TAG_TYPES.join('|');

/** 提示词里的格式示例词：AI 照抄它们不算真实操作。 */
const TAG_PLACEHOLDER_WORDS = new Set(['事件名', '变量名', '规则名', '插件名', '标题', '参数', '数值', '值', '操作', '内容', '描述', '触发条件', '参数ID', '类型',
    'event name', 'variable name', 'rule name', 'plugin name', 'title', 'param', 'params', 'parameter', 'parameter list', 'value', 'number', 'operation', 'content', 'description', 'trigger condition', 'param id', 'paramid', 'type']);

/** 数值参数的绝对值上限，超过当作无效输入。 */
const TAG_NUMBER_LIMIT = 1e12;
const TAG_TEXT_LIMIT = 5000;

const TAG_OP_ALIAS = {
    add: 'add', plus: 'add', increase: 'add', '+': 'add', '加': 'add', '增加': 'add',
    subtract: 'subtract', sub: 'subtract', minus: 'subtract', decrease: 'subtract', '-': 'subtract', '减': 'subtract', '减少': 'subtract',
    multiply: 'multiply', mul: 'multiply', times: 'multiply', '*': 'multiply', '乘': 'multiply',
    divide: 'divide', div: 'divide', '/': 'divide', '除': 'divide',
    set: 'set', assign: 'set', '=': 'set', '设置': 'set', '设为': 'set',
    append: 'append', push: 'append', '追加': 'append',
    remove: 'remove', delete: 'remove', '移除': 'remove', '删除': 'remove',
    extend: 'extend',
    add_item: 'add_item', modify_item: 'modify_item', remove_item: 'remove_item'
};

const TAG_TIME_PARAM_ALIAS = { '年': 'year', '月': 'month', '日': 'day', '天': 'day', '时': 'hour', '小时': 'hour', '分': 'minute', '分钟': 'minute' };

const TAG_TYPE_LABEL = { number: '数值', string: '文字', boolean: '开关', list: '列表', list_of_object: '对象列表', object: '对象' };

class TagParser {
    constructor() {
        this.variableSystem = null;
        this.timeSystem = null;
        this.moduleSystem = null;
        this.summarySystem = null;
        this.pluginSystem = null;
        this.promptGenerator = null;
        /** 模组的时间进位配置（minutesPerHour / hoursPerDay / daysPerMonth / monthsPerYear），没有就用默认。 */
        this.timeUnits = null;
        /** 本回合发给 AI 的可操作范围；为 null 表示不限制（程序内部调用）。 */
        this.scope = null;
        /** 上一轮没生效的操作，下一轮提示词里会提醒 AI。 */
        this._failedOps = [];
    }

    setVariableSystem(s) { this.variableSystem = s; }
    setTimeSystem(s) { this.timeSystem = s; }
    setModuleSystem(s) { this.moduleSystem = s; }
    setSummarySystem(s) { this.summarySystem = s; }
    setPluginSystem(s) { this.pluginSystem = s; }
    setPromptGenerator(g) { this.promptGenerator = g; }

    /** scope: { moduleIds: string[], variableIds: string[] }，来自生成提示词时记录的范围。 */
    setScope(scope) {
        this.scope = scope ? { moduleIds: new Set(scope.moduleIds || []), variableIds: new Set(scope.variableIds || []) } : null;
    }

    getAndClearFailedOps() {
        const list = this._failedOps;
        this._failedOps = [];
        return list;
    }

    // ==========================================
    // 扫描：把文本里的标签找出来
    // ==========================================

    /** 标签匹配正则（每次新建，避免 lastIndex 串用）。兼容全角尖括号与全角竖线。 */
    static tagRegex() {
        return new RegExp('[<＜]\\s*(' + TAG_TYPE_PATTERN + ')\\s*[|｜]([^<>＜＞\\n]*)[>＞]', 'gi');
    }

    static _normOp(op) {
        return ({ '≥': '>=', '≤': '<=', '≠': '!=', '＝': '==', '=': '==' })[op] || op;
    }

    static _stripQuotes(s) {
        return String(s).replace(/^[\s"'“”‘’「」『』]+|[\s"'“”‘’「」『』]+$/g, '');
    }

    /**
     * 文本里所有指令标签的位置。伏笔标签的触发条件里可能带「>」「>=」，按整行取到最后一个「>」；
     * 其余标签遇到第一个「>」结束。
     * @returns {Array<{ start, end, type, body }>} 按出现顺序
     */
    static spans(text) {
        const src = String(text == null ? '' : text);
        const spans = [];
        const fore = new RegExp('[<＜]\\s*foreshadow\\s*[|｜]([^\\n]*)[>＞]', 'gi');
        let m;
        while ((m = fore.exec(src)) !== null) spans.push({ start: m.index, end: m.index + m[0].length, type: 'foreshadow', body: m[1] });
        const covered = (i) => spans.some(s => i >= s.start && i < s.end);
        const re = TagParser.tagRegex();
        while ((m = re.exec(src)) !== null) {
            if (covered(m.index)) continue;
            spans.push({ start: m.index, end: m.index + m[0].length, type: m[1].toLowerCase(), body: m[2] });
        }
        return spans.sort((a, b) => a.start - b.start);
    }

    /**
     * 找出文本里所有标签。
     * @returns {{ tags: Array<{type, args, raw, key}>, malformed: Array<{raw, reason}> }}
     */
    static scan(text) {
        const src = String(text == null ? '' : text);
        const spans = TagParser.spans(src);
        const tags = spans.map(s => {
            const args = s.body.split(/[|｜]/).map(TagParser._stripQuotes);
            const raw = src.slice(s.start, s.end).replace(/＜/g, '<').replace(/＞/g, '>').replace(/｜/g, '|');
            return { type: s.type, args, raw, key: s.type + '|' + args.join('|'), index: s.start };
        });
        const malformed = [];
        const startRe = new RegExp('[<＜]\\s*(' + TAG_TYPE_PATTERN + ')\\s*[|｜]', 'gi');
        const isSpanStart = (i) => spans.some(s => s.start === i);
        let lineStart = 0;
        for (const line of src.split('\n')) {
            let s;
            startRe.lastIndex = 0;
            while ((s = startRe.exec(line)) !== null) {
                if (isSpanStart(lineStart + s.index)) continue;
                const rest = line.slice(s.index + s[0].length);
                const close = rest.search(/[>＞]/);
                const nextOpen = rest.search(/[<＜]/);
                if (close < 0 || (nextOpen >= 0 && nextOpen < close)) {
                    malformed.push({ raw: line.slice(s.index).trim(), reason: nextOpen >= 0 && close >= 0 ? I18n.t('标签里又套了一个标签') : I18n.t('标签没有以「>」结尾') });
                }
            }
            lineStart += line.length + 1;
        }
        return { tags, malformed };
    }

    /** 展示用：去掉文本里所有指令标签。 */
    static stripTags(text) {
        const src = String(text == null ? '' : text);
        const spans = TagParser.spans(src);
        let out = '';
        let pos = 0;
        for (const s of spans) { out += src.slice(pos, s.start); pos = s.end; }
        return out + src.slice(pos);
    }

    /** 取 <name>...</name> 块的内容（第一个）；没有返回 null。 */
    static extractBlock(text, name) {
        const re = new RegExp('<' + name + '>([\\s\\S]*?)</' + name + '>', 'i');
        const m = String(text == null ? '' : text).match(re);
        return m ? m[1] : null;
    }

    // ==========================================
    // 执行
    // ==========================================

    /**
     * 抓取并执行文本里的全部标签。
     * @returns {{ effects: Effect[] }}  Effect: { kind, tag, ok, summary, reason?, ignored?, quiet?, plugin? }
     */
    applyAll(text) {
        const effects = [];
        const { tags, malformed } = TagParser.scan(text);
        const seen = new Set();
        for (const tag of tags) {
            if (seen.has(tag.key)) {
                effects.push({ kind: tag.type, tag: tag.raw, ok: false, ignored: true, summary: tag.raw, reason: I18n.t('同一条指令在回复里重复出现，只执行了一次') });
                continue;
            }
            seen.add(tag.key);
            let eff;
            try {
                eff = this.applyTag(tag);
            } catch (e) {
                eff = { kind: tag.type, tag: tag.raw, ok: false, summary: tag.raw, reason: I18n.t('执行时出错：{msg}', { msg: (e && e.message ? e.message : e) }) };
            }
            effects.push(eff);
        }
        for (const bad of malformed) {
            const kind = (bad.raw.match(/^[<＜]\s*(\w+)/) || [])[1];
            effects.push({ kind: kind ? kind.toLowerCase() : 'unknown', tag: bad.raw, ok: false, summary: bad.raw, reason: bad.reason });
        }
        for (const eff of effects) {
            if (!eff.ok && !eff.quiet && !eff.ignored) this._pushFailed(eff);
        }
        return { effects };
    }

    _pushFailed(eff) {
        this._failedOps.push({ type: eff.kind, name: eff.tag, reason: eff.reason });
        while (this._failedOps.length > 50) this._failedOps.shift();
    }

    /** 执行单个标签，返回 Effect。 */
    applyTag(tag) {
        const base = { kind: tag.type, tag: tag.raw };
        const fail = (reason, extra) => ({ ...base, ok: false, summary: tag.raw, reason, ...(extra || {}) });
        const ok = (summary, extra) => ({ ...base, ok: true, summary, ...(extra || {}) });
        if (tag.args.length && tag.args.every(a => a === '' || TAG_PLACEHOLDER_WORDS.has(a) || TAG_PLACEHOLDER_WORDS.has(String(a).toLowerCase()))) {
            return fail(I18n.t('这是提示词里的格式示例，不是真实操作'), { quiet: true });
        }
        if (tag.args.some(a => (TAG_PLACEHOLDER_WORDS.has(a) || TAG_PLACEHOLDER_WORDS.has(String(a).toLowerCase())) && (tag.type === 'module' || tag.type === 'var' || tag.type === 'rule'))) {
            return fail(I18n.t('这是提示词里的格式示例，不是真实操作'), { quiet: true });
        }
        switch (tag.type) {
            case 'var': return this._doVar(tag, ok, fail);
            case 'rule': return this._doRule(tag, ok, fail);
            case 'time': return this._doTime(tag, ok, fail);
            case 'module': return this._doModule(tag, ok, fail);
            case 'delivery': return this._doDelivery(tag, ok, fail);
            case 'foreshadow': return this._doForeshadow(tag, ok, fail);
            case 'plugin': return this._doPlugin(tag, ok, fail);
            case 'summary': return this._doSummary(tag, ok, fail);
            case 'interrupt': return fail(I18n.t('这个指令现在不会生效'));
            default: return fail(I18n.t('不认识的指令类型'));
        }
    }

    // ---------- 变量 ----------

    _typeOf(variable) {
        return variable.type === 'list' && variable.listItemType === 'object' ? 'list_of_object' : variable.type;
    }

    /** 把 AI 写的名字（或 id）对到本回合范围内的变量。 */
    _resolveVariable(nameOrId) {
        const vs = this.variableSystem;
        if (!vs) return { error: I18n.t('变量系统没有准备好') };
        const key = String(nameOrId == null ? '' : nameOrId).trim();
        if (!key) return { error: I18n.t('没有写变量名') };
        const all = Array.from(vs.variables.values());
        const inScope = (v) => !this.scope || this.scope.variableIds.has(v.id);
        const pick = (list) => {
            const byName = list.filter(v => (v.name || v.id) === key);
            if (byName.length === 1) return byName[0];
            if (byName.length > 1) return 'dup';
            const byId = list.filter(v => v.id === key);
            return byId.length === 1 ? byId[0] : null;
        };
        const scoped = pick(all.filter(inScope));
        if (scoped === 'dup') return { error: I18n.t('有多个同名变量，无法确定是哪一个') };
        if (scoped) return { variable: scoped };
        const anyHit = pick(all);
        if (anyHit && anyHit !== 'dup') {
            if (anyHit.readonly || anyHit.category === 'builtin') return { error: I18n.t('「{name}」由系统计算，不能直接修改', { name: key }) };
            return { error: I18n.t('「{name}」现在不在可用变量里', { name: key }) };
        }
        return { error: I18n.t('没有叫「{name}」的变量', { name: key }) };
    }

    _num(raw) {
        if (typeof raw === 'number') return isFinite(raw) ? raw : NaN;
        const s = String(raw == null ? '' : raw).trim().replace(/,/g, '').replace(/，/g, '');
        if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return NaN;
        return Number(s);
    }

    _describeValue(v) {
        if (v === undefined || v === null || v === '') return I18n.t('（空）');
        if (typeof v === 'boolean') return v ? I18n.t('是') : I18n.t('否');
        if (typeof v === 'object') { try { return JSON.stringify(v); } catch (_) { return String(v); } }
        return String(v);
    }

    _parsePairs(s) {
        const out = {};
        String(s == null ? '' : s).split(/[,，]/).forEach(part => {
            const i = part.indexOf('=');
            if (i < 0) return;
            const k = TagParser._stripQuotes(part.slice(0, i));
            let v = TagParser._stripQuotes(part.slice(i + 1));
            if (k) out[k] = (v !== '' && !isNaN(Number(v))) ? Number(v) : (v === 'true' ? true : (v === 'false' ? false : v));
        });
        return out;
    }

    /**
     * 对一个变量执行一次操作。成功返回 { ok: true, before, after, text }，失败返回 { ok: false, reason }。
     */
    _operate(variable, rawOp, rawValue) {
        const vs = this.variableSystem;
        const name = variable.name || variable.id;
        const op = TAG_OP_ALIAS[String(rawOp == null ? '' : rawOp).trim().toLowerCase()] || null;
        const type = this._typeOf(variable);
        if (!op) return { ok: false, reason: I18n.t('不认识的操作「{op}」', { op: rawOp }) };
        if (variable.readonly || variable.category === 'builtin') return { ok: false, reason: I18n.t('「{name}」由系统计算，不能直接修改', { name }) };
        const before = this._clone(variable.value);
        const value = rawValue == null ? '' : rawValue;
        const typeLabel = TAG_TYPE_LABEL[type] ? I18n.t(TAG_TYPE_LABEL[type]) : type;
        const bad = (why) => ({ ok: false, reason: why });
        const finish = (okResult, text) => {
            if (!okResult) return bad(I18n.t('「{name}」没有改动', { name }));
            return { ok: true, before, after: this._clone(variable.value), text };
        };

        if (type === 'number') {
            if (!['add', 'subtract', 'multiply', 'divide', 'set'].includes(op)) return bad(I18n.t('「{name}」是{type}，不支持「{op}」', { name, type: typeLabel, op: rawOp }));
            const n = this._num(value);
            if (isNaN(n)) return bad(I18n.t('「{name}」是{type}，「{value}」不是数字', { name, type: typeLabel, value }));
            if (Math.abs(n) > TAG_NUMBER_LIMIT) return bad(I18n.t('数字「{value}」太大了', { value }));
            if (op === 'divide' && n === 0) return bad(I18n.t('不能除以 0'));
            const cur = Number(variable.value) || 0;
            const next = op === 'add' ? cur + n : op === 'subtract' ? cur - n : op === 'multiply' ? cur * n : op === 'divide' ? cur / n : n;
            if (!isFinite(next) || Math.abs(next) > TAG_NUMBER_LIMIT) return bad(I18n.t('改完之后的数字超出范围'));
            variable.value = cur;
            const done = vs.executeOperation(variable.id, op === 'set' ? 'set' : op, n);
            const text = op === 'add' ? '+' + n : op === 'subtract' ? '-' + n : op === 'multiply' ? '×' + n : op === 'divide' ? '÷' + n : I18n.t('改为 {v}', { v: n });
            return finish(done, text);
        }
        if (type === 'string') {
            if (op !== 'set' && op !== 'append') return bad(I18n.t('「{name}」是{type}，只能设置或追加', { name, type: typeLabel }));
            const s = String(value);
            if (s.length > TAG_TEXT_LIMIT) return bad(I18n.t('文字太长了（超过 {n} 字）', { n: TAG_TEXT_LIMIT }));
            const next = op === 'set' ? s : String(variable.value == null ? '' : variable.value) + s;
            if (next.length > TAG_TEXT_LIMIT * 20) return bad(I18n.t('追加后文字太长了'));
            variable.value = variable.clampValue(next).value;
            return { ok: true, before, after: variable.value, text: op === 'set' ? I18n.t('改为「{v}」', { v: s }) : I18n.t('追加「{v}」', { v: s }) };
        }
        if (type === 'boolean') {
            if (op !== 'set') return bad(I18n.t('「{name}」是{type}，只能设置为是或否', { name, type: typeLabel }));
            const s = String(value).trim().toLowerCase();
            let b;
            if (['true', '是', '开', '1', 'yes', 'on'].includes(s)) b = true;
            else if (['false', '否', '关', '0', 'no', 'off'].includes(s)) b = false;
            else return bad(I18n.t('「{name}」是{type}，「{value}」不是是或否', { name, type: typeLabel, value }));
            const done = vs.executeOperation(variable.id, 'set', b);
            return finish(done, I18n.t('改为{v}', { v: b ? I18n.t('是') : I18n.t('否') }));
        }
        if (type === 'list') {
            if (!['append', 'remove', 'extend', 'set'].includes(op)) return bad(I18n.t('「{name}」是{type}，不支持「{op}」', { name, type: typeLabel, op: rawOp }));
            if (String(value).length > TAG_TEXT_LIMIT) return bad(I18n.t('内容太长了'));
            let arg = value;
            if (op === 'extend') arg = String(value).split(/[,，]/).map(x => TagParser._stripQuotes(x)).filter(x => x !== '');
            if (op === 'set') {
                try { arg = JSON.parse(value); } catch (_) { arg = String(value).split(/[,，]/).map(x => TagParser._stripQuotes(x)).filter(x => x !== ''); }
                if (!Array.isArray(arg)) return bad(I18n.t('「{name}」是{type}，需要写成列表', { name, type: typeLabel }));
            }
            if (op === 'remove' && !(variable.value || []).includes(arg)) return bad(I18n.t('「{name}」里没有「{value}」', { name, value }));
            const done = vs.executeOperation(variable.id, op, arg);
            return finish(done, op === 'append' ? I18n.t('加入「{v}」', { v: value }) : op === 'remove' ? I18n.t('移除「{v}」', { v: value }) : op === 'extend' ? I18n.t('加入 {n} 项', { n: arg.length }) : I18n.t('改为 {v}', { v: this._describeValue(arg) }));
        }
        if (type === 'list_of_object') {
            if (op === 'add_item') {
                const item = this._parsePairs(value);
                if (!Object.keys(item).length) return bad(I18n.t('「{name}」要写成 字段=值 的形式', { name }));
                const done = vs.executeOperation(variable.id, 'add_item', item);
                return finish(done, I18n.t('新增一项'));
            }
            if (op === 'remove_item') {
                const idx = this._num(value);
                if (isNaN(idx) || !Number.isInteger(idx)) return bad(I18n.t('序号「{value}」不是整数', { value }));
                if (idx < 0 || idx >= (variable.value || []).length) return bad(I18n.t('序号 {idx} 超出范围', { idx }));
                return finish(vs.executeOperation(variable.id, 'remove_item', idx), I18n.t('移除序号 {idx}', { idx }));
            }
            if (op === 'modify_item') {
                const p = this._parsePairs(value);
                if (typeof p.index !== 'number' || !p.field || !p.op) return bad(I18n.t('要写成 index=序号,field=字段,op=add或set,value=值'));
                const idx = p.index;
                if (!Number.isInteger(idx) || idx < 0 || idx >= (variable.value || []).length) return bad(I18n.t('序号 {idx} 超出范围', { idx }));
                if (p.op === 'add' || p.op === 'subtract') {
                    if (typeof variable.value[idx][p.field] !== 'number' || typeof p.value !== 'number') return bad(I18n.t('字段「{field}」不是数字，不能加减', { field: p.field }));
                }
                return finish(vs.executeOperation(variable.id, 'modify_item', { index: idx, field: p.field, op: p.op, value: p.value }), I18n.t('修改序号 {idx}', { idx }));
            }
            if (op === 'set') {
                let arr;
                try { arr = JSON.parse(value); } catch (_) { return bad(I18n.t('需要写成 JSON 列表')); }
                if (!Array.isArray(arr) || !arr.every(x => x && typeof x === 'object')) return bad(I18n.t('「{name}」是{type}，每一项都要是对象', { name, type: typeLabel }));
                return finish(vs.executeOperation(variable.id, 'set', arr), I18n.t('改为 {n} 项', { n: arr.length }));
            }
            return bad(I18n.t('「{name}」是{type}，不支持「{op}」', { name, type: typeLabel, op: rawOp }));
        }
        if (type === 'object') {
            if (op === 'modify_item') {
                const p = this._parsePairs(value);
                if (!p.field || !p.op) return bad(I18n.t('要写成 field=字段,op=add或set,value=值'));
                if ((p.op === 'add' || p.op === 'subtract') && (typeof (variable.value || {})[p.field] !== 'number' || typeof p.value !== 'number')) return bad(I18n.t('字段「{field}」不是数字，不能加减', { field: p.field }));
                return finish(vs.executeOperation(variable.id, 'modify_item', { field: p.field, op: p.op, value: p.value }), I18n.t('修改「{field}」', { field: p.field }));
            }
            if (op === 'set') {
                let obj;
                try { obj = JSON.parse(value); } catch (_) { return bad(I18n.t('需要写成 JSON 对象')); }
                if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return bad(I18n.t('「{name}」是{type}，需要写成 JSON 对象', { name, type: typeLabel }));
                return finish(vs.executeOperation(variable.id, 'set', obj), I18n.t('改为新的对象'));
            }
            return bad(I18n.t('「{name}」是{type}，不支持「{op}」', { name, type: typeLabel, op: rawOp }));
        }
        return bad(I18n.t('「{name}」的类型不支持这个操作', { name }));
    }

    _clone(v) {
        return (v !== null && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
    }

    _record(type, tagText, details) {
        if (this.summarySystem) this.summarySystem.recordOperation(type, tagText, details || null);
    }

    _doVar(tag, ok, fail) {
        const [nameOrId, op, ...rest] = tag.args;
        if (!nameOrId || !op) return fail(I18n.t('缺少变量名或操作'));
        const r = this._resolveVariable(nameOrId);
        if (r.error) return fail(r.error);
        const res = this._operate(r.variable, op, rest.join('|'));
        if (!res.ok) return fail(res.reason);
        this.variableSystem.updateBuiltinVariables();
        this._record('variable', tag.raw, { variableId: r.variable.id, before: res.before, after: res.after });
        return ok(I18n.t('「{name}」{text}（{before} → {after}）', { name: r.variable.name || r.variable.id, text: res.text, before: this._describeValue(res.before), after: this._describeValue(res.after) }), { variableId: r.variable.id });
    }

    /** 把规则的取值写法整理成「操作 + 值」。支持 operation 字段，也支持 "+10" "-5" "set 100" "100" 这类简写。 */
    _ruleToOp(rule, param, variable) {
        const sub = (v) => (typeof v === 'string' && param != null) ? v.replace(/\$param/g, () => param) : v;
        if (rule.operation) {
            const rv = rule.value;
            if (rv && typeof rv === 'object' && !Array.isArray(rv)) {
                const o = {};
                for (const [k, val] of Object.entries(rv)) o[k] = (typeof val === 'string' && val.startsWith('$')) ? (param != null ? param : undefined) : val;
                return { op: rule.operation, value: Object.entries(o).map(([k, val]) => k + '=' + val).join(',') };
            }
            return { op: rule.operation, value: sub(rv) };
        }
        const raw = sub(rule.value);
        if (typeof raw === 'number') return { op: 'set', value: raw };
        const s = String(raw == null ? '' : raw).trim();
        let m;
        if ((m = s.match(/^\+\s*(.+)$/))) return { op: 'add', value: m[1] };
        if ((m = s.match(/^[-－]\s*(.+)$/))) return { op: 'subtract', value: m[1] };
        if ((m = s.match(/^[*×]\s*(.+)$/))) return { op: 'multiply', value: m[1] };
        if ((m = s.match(/^[/÷]\s*(.+)$/))) return { op: 'divide', value: m[1] };
        if ((m = s.match(/^set\s+(.+)$/i))) return { op: 'set', value: m[1] };
        return { op: 'set', value: s };
    }

    _doRule(tag, ok, fail) {
        const [nameOrId, ruleName, param] = tag.args;
        if (!nameOrId || !ruleName) return fail(I18n.t('缺少变量名或规则名'));
        const r = this._resolveVariable(nameOrId);
        if (r.error) return fail(r.error);
        const v = r.variable;
        const name = v.name || v.id;
        const rules = Array.isArray(v.changeRules) ? v.changeRules : [];
        if (!rules.length) return fail(I18n.t('「{name}」没有可用的快捷规则', { name }));
        const rule = rules.find(x => x.name === ruleName);
        if (!rule) return fail(I18n.t('「{name}」没有叫「{rule}」的快捷规则（可用：{list}）', { name, rule: ruleName, list: rules.map(x => x.name).join(I18n.t('、')) }));
        if (rule.min != null || rule.max != null) {
            const n = this._num(param);
            if (!isNaN(n)) {
                if (rule.min != null && n < Number(rule.min)) return fail(I18n.t('「{rule}」的取值不能小于 {n}', { rule: ruleName, n: rule.min }));
                if (rule.max != null && n > Number(rule.max)) return fail(I18n.t('「{rule}」的取值不能大于 {n}', { rule: ruleName, n: rule.max }));
            }
        }
        const conv = this._ruleToOp(rule, param, v);
        if (conv.value === undefined || (typeof conv.value === 'string' && /\$\w+/.test(conv.value))) return fail(I18n.t('「{rule}」需要再写一个参数', { rule: ruleName }));
        const res = this._operate(v, conv.op, conv.value);
        if (!res.ok) return fail(res.reason);
        this.variableSystem.updateBuiltinVariables();
        this._record('variable', tag.raw, { variableId: v.id, ruleName, before: res.before, after: res.after });
        return ok(I18n.t('「{name}」执行「{rule}」（{before} → {after}）', { name, rule: ruleName, before: this._describeValue(res.before), after: this._describeValue(res.after) }), { variableId: v.id });
    }

    // ---------- 时间 ----------

    _timeUnits() {
        return TimeSystem.resolveUnits(this.timeUnits);
    }

    /** 进位：分 -> 时 -> 日 -> 月 -> 年（日、月从 1 起算）。 */
    static normalizeTime(sv, units) {
        return TimeSystem.normalize(sv, units);
    }

    _doTime(tag, ok, fail) {
        const ts = this.timeSystem;
        if (!ts) return fail(I18n.t('时间系统没有准备好'));
        let [param, op, val] = tag.args;
        if (!param || !op) return fail(I18n.t('缺少时间参数或操作'));
        param = TAG_TIME_PARAM_ALIAS[param] || String(param).trim().toLowerCase();
        const p = ts.getParameter(param);
        if (!p) return fail(I18n.t('没有叫「{name}」的时间参数', { name: param }));
        if (p.calculationOnly || p.type !== 'base') return fail(I18n.t('「{name}」由系统自动计算，不能直接修改', { name: param }));
        const action = TAG_OP_ALIAS[String(op).trim().toLowerCase()];
        if (action !== 'add' && action !== 'set') return fail(I18n.t('时间只能用 add（推进）或 set（设定）'));
        const n = this._num(val);
        if (isNaN(n)) return fail(I18n.t('「{value}」不是数字', { value: val }));
        if (!Number.isInteger(n)) return fail(I18n.t('时间需要整数'));
        if (Math.abs(n) > TAG_NUMBER_LIMIT) return fail(I18n.t('数字「{value}」太大了', { value: val }));
        const units = this._timeUnits();
        const before = { ...ts.systemValues };
        const after = { ...before };
        const key = p.systemBinding;
        if (action === 'add') {
            if (n < 0) return fail(I18n.t('时间只能往前推进'));
            after[key] = (after[key] || 0) + n;
        } else {
            const lim = { month: [1, units.mpy], day: [1, units.dpm], hour: [0, units.hpd - 1], minute: [0, units.mph - 1] }[key];
            if (lim && (n < lim[0] || n > lim[1])) return fail(I18n.t('「{name}」要在 {min} 到 {max} 之间', { name: param, min: lim[0], max: lim[1] }));
            after[key] = n;
        }
        TagParser.normalizeTime(after, units);
        const cmp = ['year', 'month', 'day', 'hour', 'minute'];
        for (const k of cmp) {
            if ((after[k] || 0) > (before[k] || 0)) break;
            if ((after[k] || 0) < (before[k] || 0)) return fail(I18n.t('时间只能往前推进'));
        }
        const changes = {};
        for (const k of cmp) {
            if (after[k] === before[k]) continue;
            const tp = ts.parameters.find(x => x.type === 'base' && x.systemBinding === k && !x.calculationOnly);
            if (tp) changes[tp.id] = after[k];
        }
        ts.advanceTime(changes);
        this._record('time', tag.raw, { before, after });
        const timeText = {
            add: { year: I18n.t('时间推进{n}年', { n }), month: I18n.t('时间推进{n}月', { n }), day: I18n.t('时间推进{n}日', { n }), hour: I18n.t('时间推进{n}时', { n }), minute: I18n.t('时间推进{n}分', { n }) },
            set: { year: I18n.t('时间设为{n}年', { n }), month: I18n.t('时间设为{n}月', { n }), day: I18n.t('时间设为{n}日', { n }), hour: I18n.t('时间设为{n}时', { n }), minute: I18n.t('时间设为{n}分', { n }) }
        }[action][param] || (action === 'add' ? I18n.t('时间推进{n}{unit}', { n, unit: param }) : I18n.t('时间设为{n}{unit}', { n, unit: param }));
        const now = (this.promptGenerator && typeof this.promptGenerator.formatTimeLine === 'function') ? this.promptGenerator.formatTimeLine() : ts.getDisplayTime();
        return ok(timeText + I18n.t('（现在是 {now}）', { now }));
    }

    // ---------- 事件 ----------

    _moduleName(id) {
        const m = this.moduleSystem && this.moduleSystem.getModule(id);
        return m ? (m.name || m.id) : id;
    }

    /** 名字 -> 事件 id。candidates 为 null 时在全部事件里找。 */
    _resolveModule(nameOrId, candidates) {
        const ms = this.moduleSystem;
        const key = String(nameOrId == null ? '' : nameOrId).trim();
        if (!key) return { error: I18n.t('没有写事件名') };
        const all = Array.from(ms.modules.values()).filter(m => m.id !== ms.rootModuleId);
        const pool = candidates ? all.filter(m => candidates.has(m.id)) : all;
        const byName = pool.filter(m => (m.name || m.id) === key);
        if (byName.length === 1) return { id: byName[0].id };
        if (byName.length > 1) return { error: I18n.t('有多个同名事件，无法确定是哪一个') };
        const byId = pool.filter(m => m.id === key);
        if (byId.length === 1) return { id: byId[0].id };
        return { notInPool: all.some(m => (m.name || m.id) === key || m.id === key) };
    }

    _describeUnmet(wrappers) {
        if (this.promptGenerator && typeof this.promptGenerator._describeGate === 'function') {
            const s = this.promptGenerator._describeGate(wrappers);
            if (s) return s;
        }
        return '';
    }

    /**
     * 主流程里「进入下一个 = 当前事件默认已完成」，所以判断进入条件时先假设当前事件已完成
     * （与队列的算法一致）；fn 执行完恢复原状态。
     */
    _withCurrentCompleted(target, fn) {
        const ms = this.moduleSystem;
        const flow = target.flowName || 'main';
        const cur = flow === 'main' ? ms.currentModulesByFlow.get('main') : null;
        if (cur && cur.isLeaf() && cur.state === 'entered' && cur.id !== target.id) {
            const saved = { state: cur.state, entered: cur.enteredTimestamp, completed: cur.completedTimestamp };
            cur.setState('completed', ms.timeSystem ? ms.timeSystem.getCurrentTime() : null);
            try {
                return fn();
            } finally {
                cur.state = saved.state;
                cur.enteredTimestamp = saved.entered;
                cur.completedTimestamp = saved.completed;
            }
        }
        return fn();
    }

    /** 进入条件是否满足（系统的合并判定：当前模块 > 父级 > 链上前一个，同一变量当前优先；分流程还要看前置事件）。 */
    _canEnterNow(target) {
        return this._withCurrentCompleted(target, () => this.moduleSystem.canEnterModule(target.id));
    }

    _describeCondition(c) {
        const vs = this.variableSystem;
        const vname = (id) => { const v = vs && vs.getVariable(id); return v ? (v.name || id) : id; };
        const op = (o) => ({ '>=': '≥', '<=': '≤', '==': '＝', '!=': '≠' })[o] || o;
        if (c.type === 'variable') {
            const cur = vs ? vs.getValue(c.variableId) : undefined;
            return `${vname(c.variableId)} ${op(c.operator)} ${c.value}` + I18n.t('（当前 {cur}）', { cur: this._describeValue(cur) });
        }
        if (c.type === 'variable_compare') return `${vname(c.variableId)} ${op(c.operator)} ${vname(c.compareVariableId)}`;
        if (c.type === 'module') return c.state === 'completed' ? I18n.t('「{name}」要先完成', { name: this._moduleName(c.moduleId) }) : I18n.t('「{name}」要先进入', { name: this._moduleName(c.moduleId) });
        if (c.type === 'time' || c.type === 'time_range') return I18n.t('时间还没到');
        if (c.type === 'tag') return I18n.t('需要的标签没有出现');
        return I18n.t('有一项条件没满足');
    }

    /** 列出没满足的进入条件，每条一句人话。 */
    _unmetEntryConditions(target) {
        const ms = this.moduleSystem;
        const ce = ms.conditionEvaluator;
        const out = [];
        if (target.flowName && target.flowName !== 'main' && target.parentModuleId) {
            const parent = ms.getModule(target.parentModuleId);
            const fd = parent && parent.flows ? parent.flows[target.flowName] : null;
            if (fd && fd.entryEvent && fd.entryEvent !== target.id && !ms.checkModuleState(fd.entryEvent, 'completed')) {
                out.push(I18n.t('要先完成「{name}」', { name: this._moduleName(fd.entryEvent) }));
            }
        }
        const sources = ms._getEntrySources(target.id);
        const claims = ms._entryVariableClaims(sources);
        sources.forEach((src, i) => {
            for (const { def } of src.defs) {
                for (const c of ms._collectConditionsFromDef(def)) {
                    if (c.type === 'variable' && claims.get(c.variableId) !== i) continue;
                    let met = true;
                    try { met = ce.evaluateCondition(c, 'precondition'); } catch (_) { met = true; }
                    if (!met) {
                        const text = this._describeCondition(c);
                        if (!out.includes(text)) out.push(text);
                    }
                }
            }
        });
        return out;
    }

    _doModule(tag, ok, fail) {
        const ms = this.moduleSystem;
        if (!ms) return fail(I18n.t('事件系统没有准备好'));
        let [action, nameOrId] = tag.args;
        action = ({ enter: 'enter', '进入': 'enter', complete: 'complete', '完成': 'complete', finish: 'complete' })[String(action || '').trim().toLowerCase()];
        if (!action) return fail(I18n.t('事件操作只有 enter（进入）和 complete（完成）'));
        if (!nameOrId) return fail(I18n.t('没有写事件名'));
        const key = String(nameOrId).trim();

        if (action === 'enter') {
            const found = this._resolveModule(key, this.scope ? this.scope.moduleIds : null);
            if (found.error) return fail(found.error);
            if (!found.id) {
                if (!found.notInPool) return fail(I18n.t('没有叫「{name}」的事件', { name: key }));
                const any = this._resolveModule(key, null);
                const st = any.id ? ms.getModule(any.id).state : '';
                if (st === 'entered') return fail(I18n.t('「{name}」已经在进行中', { name: key }));
                if (st === 'completed') return fail(I18n.t('「{name}」已经完成了', { name: key }));
                return fail(I18n.t('「{name}」现在不能进入（不在可进入的事件里）', { name: key }));
            }
            const target = ms.getModule(found.id);
            if (!target.isLeaf()) return fail(I18n.t('「{name}」不是具体事件，不能直接进入', { name: key }));
            if (!this._canEnterNow(target)) {
                const unmet = this._withCurrentCompleted(target, () => this._unmetEntryConditions(target));
                return fail(unmet.length ? I18n.t('「{name}」的进入条件还没满足：{why}', { name: key, why: unmet.join(I18n.t('；')) }) : I18n.t('「{name}」的进入条件还没满足', { name: key }));
            }
            const res = ms.jumpToModule(found.id, { force: true, updateVariables: false });
            if (!res || !res.success) return fail(I18n.t('「{name}」进入失败：{why}', { name: key, why: (res && res.error) || I18n.t('原因不明') }));
            const changes = res.changes || {};
            const done = (changes.completed || []).filter(id => id !== found.id).map(id => this._moduleName(id));
            this._record('module', tag.raw, { action, moduleId: found.id });
            return ok(I18n.t('进入事件「{name}」', { name: target.name }) + (done.length ? I18n.t('（前面的「{list}」按顺序算作已完成）', { list: done.join(I18n.t('、')) }) : ''), { moduleId: found.id });
        }

        const currentIds = new Set(ms.getCurrentModuleIds().filter(id => id !== ms.rootModuleId && ms.getModule(id) && ms.getModule(id).isLeaf()));
        const found = this._resolveModule(key, currentIds);
        if (found.error) return fail(found.error);
        if (!found.id) return fail(found.notInPool ? I18n.t('「{name}」不是正在进行的事件', { name: key }) : I18n.t('没有叫「{name}」的事件', { name: key }));
        const target = ms.getModule(found.id);
        const pending = ms.getPendingDeliveryInfoForModule(target).map(d => d.title);
        const res = ms.completeModule(found.id);
        if (!res || !res.success) {
            if (pending.length) return fail(I18n.t('「{name}」还有没确认的投递：{list}', { name: key, list: pending.join(I18n.t('、')) }));
            const why = this._describeUnmet(target.completionConditions);
            return fail(why ? I18n.t('「{name}」的完成条件还没满足：{why}', { name: key, why }) : I18n.t('「{name}」的完成条件还没满足', { name: key }));
        }
        this._record('module', tag.raw, { action, moduleId: found.id });
        if (this.summarySystem && typeof this.summarySystem.recordPendingParentSummary === 'function') {
            this.summarySystem.recordPendingParentSummary(ms, found.id);
        }
        return ok(I18n.t('完成事件「{name}」', { name: target.name }) + (res.autoEntered ? I18n.t('，自动进入「{name}」', { name: this._moduleName(res.autoEntered) }) : ''), { moduleId: found.id });
    }

    // ---------- 投递 ----------

    _pendingDeliveries() {
        const ms = this.moduleSystem;
        const out = [];
        if (!ms) return out;
        const ids = new Set();
        for (const id of ms.getCurrentModuleIds()) for (const pid of ms.getPathToModule(id)) ids.add(pid);
        ids.add(ms.rootModuleId);
        for (const id of ids) {
            const m = ms.getModule(id);
            if (m) for (const d of (m.deliveryInfo || [])) out.push({ module: m, item: d });
        }
        return out;
    }

    _doDelivery(tag, ok, fail) {
        let [title, status] = tag.args;
        if (!title) return fail(I18n.t('没有写投递标题'));
        const st = String(status == null || status === '' ? 'done' : status).trim().toLowerCase();
        const isDone = ['done', 'complete', 'completed', 'confirmed', 'received', 'yes', '完成', '已完成', 'true', '是', '已收到'].includes(st);
        const isUndone = ['uncompleted', 'undone', 'not done', 'not completed', 'incomplete', 'no', '未完成', 'false', '否', '没完成'].includes(st);
        if (!isDone && !isUndone) return fail(I18n.t('投递状态只能写 done 或 uncompleted'));
        const ce = this.moduleSystem ? this.moduleSystem.conditionEvaluator : null;
        const entry = this._pendingDeliveries().find(x => (x.item.title || x.item.id) === title);
        const cond = this.summarySystem && this.summarySystem.conditionalDeliveries
            ? this.summarySystem.conditionalDeliveries.find(d => d.title === title) : null;
        if (!entry && !cond) return fail(I18n.t('没有叫「{name}」的投递信息', { name: title }));
        if (entry) {
            if (isDone && entry.item.completed) return fail(I18n.t('「{name}」之前已经确认过了', { name: title }));
            if (!entry.item.completed && !entry.module.getPendingDeliveryInfo(ce).includes(entry.item)) return fail(I18n.t('「{name}」现在还没有出现', { name: title }));
            entry.item.completed = isDone;
        }
        if (cond) {
            if (isDone && cond.completed) return fail(I18n.t('「{name}」之前已经确认过了', { name: title }));
            if (isDone) this.summarySystem.markConditionalDeliveryDone(title);
            else this.summarySystem.markConditionalDeliveryUncomplete(title);
        }
        this._record('delivery', tag.raw, { title, status: isDone ? 'done' : 'uncompleted' });
        return ok(isDone ? I18n.t('确认投递「{name}」', { name: title }) : I18n.t('投递「{name}」标为未完成，之后还会再提醒', { name: title }));
    }

    // ---------- 伏笔 ----------

    /** 把触发条件里的名字换成 id。写法：variable:修为>=100 / time:day>=30 / module:事件名:completed */
    _foreshadowCondition(str) {
        const s = String(str == null ? '' : str).trim();
        if (!s) return { cond: { type: 'always' }, str: '' };
        const ss = this.summarySystem;
        let m = s.match(/^module\s*:\s*(.+?)\s*:\s*(entered|completed)$/i);
        if (m) {
            const found = this._resolveModule(m[1], null);
            if (!found.id) return { error: I18n.t('触发条件里的事件「{name}」没有找到', { name: m[1] }) };
            return { cond: { type: 'module', moduleId: found.id, state: m[2].toLowerCase() }, str: 'module:' + found.id + ':' + m[2].toLowerCase() };
        }
        m = s.match(/^variable\s*:\s*(.+?)\s*(>=|<=|==|!=|≥|≤|≠|＝|=|>|<)\s*(.+)$/i);
        if (m) {
            const r = this._resolveVariable(m[1]);
            if (r.error) return { error: I18n.t('触发条件里的变量：{why}', { why: r.error }) };
            const val = ss ? ss._parseCondValue(m[3].trim()) : m[3].trim();
            const opv = TagParser._normOp(m[2]);
            return { cond: { type: 'variable', variableId: r.variable.id, operator: opv, value: val }, str: 'variable:' + r.variable.id + opv + m[3].trim() };
        }
        m = s.match(/^time\s*:\s*(\w+)\s*(>=|<=|==|!=|≥|≤|≠|＝|=|>|<)\s*(.+)$/i);
        if (m) {
            const param = TAG_TIME_PARAM_ALIAS[m[1]] || m[1].toLowerCase();
            if (!this.timeSystem || !this.timeSystem.getParameter(param)) return { error: I18n.t('触发条件里的时间参数「{name}」不存在', { name: m[1] }) };
            const val = ss ? ss._parseCondValue(m[3].trim()) : m[3].trim();
            const opt = TagParser._normOp(m[2]);
            return { cond: { type: 'time', param, operator: opt, value: val }, str: 'time:' + param + opt + m[3].trim() };
        }
        return { error: I18n.t('触发条件的写法不对，应为 variable:变量名>=数值、time:day>=30 或 module:事件名:completed') };
    }

    _doForeshadow(tag, ok, fail) {
        const ss = this.summarySystem;
        if (!ss || typeof ss.addConditionalDelivery !== 'function') return fail(I18n.t('伏笔功能没有准备好'));
        const [title, description, ...rest] = tag.args;
        if (!title) return fail(I18n.t('没有写伏笔标题'));
        if (String(title).length > 200 || String(description || '').length > TAG_TEXT_LIMIT) return fail(I18n.t('伏笔内容太长了'));
        if (ss.conditionalDeliveries.some(d => d.title === title && !d.completed)) return fail(I18n.t('已经有一条同名的伏笔了'));
        const c = this._foreshadowCondition(rest.join('|'));
        if (c.error) return fail(c.error);
        ss.addConditionalDelivery({ title, content: description || '', conditionStr: c.str, conditionParsed: c.cond });
        this._record('foreshadow', tag.raw, { title });
        return ok(I18n.t('记下伏笔「{name}」', { name: title }) + (c.str ? I18n.t('，条件满足后提醒') : I18n.t('，下一轮就会提醒')));
    }

    // ---------- 插件 ----------

    _doPlugin(tag, ok, fail) {
        if (!this.pluginSystem || typeof this.pluginSystem.findActive !== 'function') return fail(I18n.t('插件系统没有准备好'));
        const [nameOrId, ...rest] = tag.args;
        if (!nameOrId) return fail(I18n.t('没有写插件名'));
        const plugin = this.pluginSystem.findActive(nameOrId);
        if (!plugin) return fail(I18n.t('没有叫「{name}」的插件，或它现在没有启用', { name: nameOrId }));
        const content = rest.join('|');
        if (content.length > TAG_TEXT_LIMIT) return fail(I18n.t('插件内容太长了'));
        this._record('plugin', tag.raw, { pluginId: plugin.id });
        return ok(I18n.t('调用插件「{name}」', { name: plugin.name || plugin.id }), { plugin: { id: plugin.id, name: plugin.name, type: plugin.type, config: plugin.config, content } });
    }

    // ---------- 总结 ----------

    _doSummary(tag, ok, fail) {
        const ss = this.summarySystem;
        if (!ss) return fail(I18n.t('总结功能没有准备好'));
        const args = tag.args;
        const type = String(args[0] || '').toLowerCase();
        if (type === 'global') {
            const content = args.slice(1).join('|').trim();
            if (!content) return fail(I18n.t('总结内容是空的'));
            ss.addSingleSummary(content);
            this._record('summary', tag.raw, { type });
            return ok(I18n.t('记下一条剧情总结'));
        }
        if (type === 'module') {
            const ms = this.moduleSystem;
            let moduleId = null, content;
            if (args.length >= 3) {
                const found = this._resolveModule(args[1], null);
                if (!found.id) return fail(I18n.t('没有叫「{name}」的事件', { name: args[1] }));
                moduleId = found.id; content = args.slice(2).join('|').trim();
            } else {
                const cur = ms.getCurrentModuleIds().filter(id => id !== ms.rootModuleId)[0];
                if (!cur) return fail(I18n.t('现在没有正在进行的事件'));
                moduleId = cur; content = args.slice(1).join('|').trim();
            }
            if (!content) return fail(I18n.t('总结内容是空的'));
            ss.setModuleSummary(moduleId, content);
            this._record('summary', tag.raw, { type, moduleId });
            return ok(I18n.t('记下「{name}」的总结', { name: this._moduleName(moduleId) }));
        }
        if (type === 'plugin') {
            const content = args.slice(1).join('|').trim();
            if (!content) return fail(I18n.t('总结内容是空的'));
            ss.addPluginSummaryContent(content);
            this._record('summary', tag.raw, { type });
            return ok(I18n.t('记下一条插件总结'));
        }
        return fail(I18n.t('总结类型只有 global、module、plugin'));
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TagParser };
}
if (typeof window !== 'undefined') {
    window.TagParser = TagParser;
}
