/**
 * PluginRuntime —— 插件的纯逻辑层（不碰 DOM、不碰全局状态，浏览器与 Node 都能直接加载）。
 *
 * 真实游戏、调试面板的插件测试、模组编辑里的预览都调用这一份：
 *   类型表与别名、变量操作、{{变量}} 文字代入、点击动作 → 变量改动 + 暂存文字、
 *   AI 回复块解析与写入、HTML 里 data-bind / data-action / {{变量}} 的扫描、插件配置校验。
 *
 * 变量存放处（store）约定的接口：
 *   has(id) → 是否存在　get(id) → 当前值　set(id, value)　typeOf(id) → 'number'|'string'|...　nameOf(id) → 显示名
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.PluginRuntime = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var I18n = (typeof self !== 'undefined' && self.I18n) || { t: function (s, p) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return p && p[k] != null ? p[k] : m; }); } };

    // ---------- 类型表 ----------
    var TYPE_DEFS = {
        randomizer: { label: I18n.t('随机器'), oneShot: true, order: 1, frontend: false },
        variable_reader: { label: I18n.t('变量读取器'), oneShot: true, order: 2, frontend: false },
        variable_op: { label: I18n.t('变量操作器'), oneShot: true, order: 3, frontend: false },
        module_generator: { label: I18n.t('模块生成器'), oneShot: true, order: 4, frontend: false },
        summary: { label: I18n.t('总结器'), oneShot: false, order: 9, frontend: false },
        display: { label: I18n.t('显示器'), oneShot: false, order: 9, frontend: true, side: 'right' },
        interactive: { label: I18n.t('交互器'), oneShot: false, order: 9, frontend: true, side: 'left' },
        display_interactive: { label: I18n.t('显示+交互器'), oneShot: false, order: 9, frontend: true, side: 'left' }
    };

    var TYPE_ORDER = ['randomizer', 'variable_reader', 'variable_op', 'module_generator', 'summary', 'display', 'interactive', 'display_interactive'];

    // 旧写法 → 现行类型
    var TYPE_ALIASES = {
        'status-display': 'display',
        status: 'display',
        'random-pool': 'randomizer',
        'module-generator': 'module_generator',
        'variable-reader': 'variable_reader',
        'variable-op': 'variable_op',
        'display-interactive': 'display_interactive'
    };

    // 引擎里仍由旧驱动处理、不走本运行层的类型
    var LEGACY_TYPES = { 'interactive-save': 1, 'schedule-generator': 1, 'trigger-chain-generator': 1 };

    function canonicalType(t) {
        if (typeof t !== 'string') return '';
        if (TYPE_DEFS[t]) return t;
        return TYPE_ALIASES[t] || '';
    }

    function typeLabel(t) {
        var c = canonicalType(t);
        if (c) return TYPE_DEFS[c].label;
        var extra = { 'interactive-save': I18n.t('交互器（旧）'), 'status-display': I18n.t('状态面板'), 'random-pool': I18n.t('随机池（旧）'), 'module-generator': I18n.t('模块生成器（旧）'), 'schedule-generator': I18n.t('排期生成器（旧）'), 'trigger-chain-generator': I18n.t('触发器链生成器（旧）'), status: I18n.t('状态') };
        return extra[t] || (t ? String(t) : I18n.t('插件'));
    }

    /** 界面显示在哪一侧：config.side 明确写了 left / right 就用它，否则按类型的默认侧 */
    function sideOf(t, cfg) {
        if (cfg && (cfg.side === 'left' || cfg.side === 'right')) return cfg.side;
        var c = canonicalType(t);
        return (c && TYPE_DEFS[c].side) || 'left';
    }

    function hasFrontend(t) {
        var c = canonicalType(t);
        return !!(c && TYPE_DEFS[c].frontend);
    }

    // ---------- 值与文字 ----------
    function safeStringify(v) {
        var stack = [];
        try {
            return JSON.stringify(v, function (key, val) {
                if (typeof val === 'function') return undefined;
                if (typeof val === 'bigint') return String(val);
                if (typeof val !== 'object' || val === null) return val;
                while (stack.length && stack[stack.length - 1] !== this) stack.pop();
                if (stack.indexOf(val) >= 0) return I18n.t('[循环引用]');
                stack.push(val);
                return val;
            });
        } catch (e) {
            return I18n.t('[无法显示]');
        }
    }

    function formatValue(v) {
        if (v === undefined || v === null) return '';
        var t = typeof v;
        if (t === 'string') return v;
        if (t === 'number' || t === 'boolean' || t === 'bigint') return String(v);
        if (t === 'function' || t === 'symbol') return '';
        var s = safeStringify(v);
        return s === undefined ? '' : s;
    }

    var PLACEHOLDER_RE = /\{\{\s*([A-Za-z0-9_一-龥]+)\s*\}\}/g;

    /**
     * 把 {{名字}} 换成值（一次扫描，换进去的内容不会再被当成占位符）。
     * lookup(name) 返回 undefined 表示没有这个值；没有的位置换成空文字，名字记进 missing。
     */
    function renderText(template, lookup) {
        var missing = [];
        var out = String(template == null ? '' : template).replace(PLACEHOLDER_RE, function (m, name) {
            var v;
            try { v = lookup(name); } catch (e) { v = undefined; }
            if (v === undefined) {
                if (missing.indexOf(name) < 0) missing.push(name);
                return '';
            }
            return formatValue(v);
        });
        return { text: out, missing: missing };
    }

    function storeLookup(store, scope) {
        return function (name) {
            if (scope && Object.prototype.hasOwnProperty.call(scope, name)) return scope[name];
            if (store && store.has(name)) return store.get(name);
            return undefined;
        };
    }

    function findPlaceholders(text) {
        var out = [];
        String(text == null ? '' : text).replace(PLACEHOLDER_RE, function (m, name) {
            if (out.indexOf(name) < 0) out.push(name);
            return m;
        });
        return out;
    }

    // ---------- 变量操作 ----------
    var OPS = {
        set: { label: I18n.t('设为'), needsValue: true },
        add: { label: I18n.t('增加'), needsValue: true, number: true },
        subtract: { label: I18n.t('减少'), needsValue: true, number: true },
        multiply: { label: I18n.t('乘以'), needsValue: true, number: true },
        append_line: { label: I18n.t('追加一行'), needsValue: true, text: true },
        append_text: { label: I18n.t('接在后面'), needsValue: true, text: true },
        list_add: { label: I18n.t('加入列表'), needsValue: true },
        list_remove: { label: I18n.t('从列表移除'), needsValue: true },
        toggle: { label: I18n.t('开关取反'), needsValue: false },
        clear: { label: I18n.t('清空'), needsValue: false }
    };
    var OP_ORDER = ['set', 'add', 'subtract', 'multiply', 'append_line', 'append_text', 'list_add', 'list_remove', 'toggle', 'clear'];
    var DEFAULT_TEXT_LIMIT = 100000;

    function parseBool(raw) {
        if (raw === true || raw === false) return raw;
        var s = String(raw).trim().toLowerCase();
        if (s === 'true' || s === '1' || s === '是' || s === '开' || s === 'on' || s === 'yes') return true;
        if (s === 'false' || s === '0' || s === '否' || s === '关' || s === 'off' || s === 'no' || s === '') return false;
        return null;
    }

    function parseJsonLoose(raw) {
        if (typeof raw !== 'string') return raw;
        try { return JSON.parse(raw); } catch (e) { return raw; }
    }

    function emptyOf(vtype) {
        if (vtype === 'number') return 0;
        if (vtype === 'boolean' || vtype === 'switch') return false;
        if (vtype === 'list' || vtype === 'list_of_object') return [];
        if (vtype === 'object') return {};
        return '';
    }

    /**
     * 对一个变量值做一次操作。返回 { ok, value, error, trimmed }。
     * vtype 为变量类型（未知时按当前值推断）；opts.textLimit 为文字类变量的最大长度。
     */
    function applyOp(op, current, operand, vtype, opts) {
        opts = opts || {};
        var limit = opts.textLimit || DEFAULT_TEXT_LIMIT;
        if (!OPS[op]) return { ok: false, error: I18n.t('不认识的操作：{op}', { op: op }) };
        var type = vtype || (Array.isArray(current) ? 'list' : (current !== null && typeof current === 'object' ? 'object' : typeof current));
        var n;
        switch (op) {
            case 'set':
                if (type === 'number') {
                    n = typeof operand === 'number' ? operand : Number(String(operand).trim());
                    if (String(operand).trim() === '' || !isFinite(n)) return { ok: false, error: I18n.t('「{value}」不是数字', { value: formatValue(operand) }) };
                    return { ok: true, value: n };
                }
                if (type === 'boolean' || type === 'switch') {
                    var b = parseBool(operand);
                    if (b === null) return { ok: false, error: I18n.t('「{value}」不是开或关', { value: formatValue(operand) }) };
                    return { ok: true, value: b };
                }
                if (type === 'list' || type === 'list_of_object') {
                    var arr = parseJsonLoose(operand);
                    if (!Array.isArray(arr)) return { ok: false, error: I18n.t('列表需要写成 [ ... ] 的形式') };
                    return { ok: true, value: arr };
                }
                if (type === 'object') {
                    var obj = parseJsonLoose(operand);
                    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, error: I18n.t('对象需要写成 { ... } 的形式') };
                    return { ok: true, value: obj };
                }
                return { ok: true, value: formatValue(operand) };
            case 'add':
            case 'subtract':
            case 'multiply':
                if (type !== 'number') return { ok: false, error: I18n.t('只有数值变量能做「{op}」', { op: OPS[op].label }) };
                if (typeof current !== 'number' || !isFinite(current)) return { ok: false, error: I18n.t('变量当前不是数字，无法{op}', { op: OPS[op].label }) };
                n = typeof operand === 'number' ? operand : Number(String(operand).trim());
                if (String(operand).trim() === '' || !isFinite(n)) return { ok: false, error: I18n.t('「{value}」不是数字', { value: formatValue(operand) }) };
                n = op === 'add' ? current + n : (op === 'subtract' ? current - n : current * n);
                if (!isFinite(n)) return { ok: false, error: I18n.t('结果超出数值范围') };
                return { ok: true, value: n };
            case 'append_line':
            case 'append_text':
                if (type !== 'string') return { ok: false, error: I18n.t('只有文字变量能做「{op}」', { op: OPS[op].label }) };
                var base = current === undefined || current === null ? '' : String(current);
                var add = formatValue(operand);
                var joined = op === 'append_line' ? (base ? base + '\n' + add : add) : base + add;
                if (joined.length <= limit) return { ok: true, value: joined };
                // 记录过长时丢弃最早的内容，并告诉调用方发生过
                var cut = joined.length - Math.floor(limit * 0.9);
                var nl = joined.indexOf('\n', cut);
                return { ok: true, value: nl >= 0 ? joined.slice(nl + 1) : joined.slice(cut), trimmed: true };
            case 'list_add':
                if (type !== 'list' && type !== 'list_of_object') return { ok: false, error: I18n.t('只有列表变量能做「{op}」', { op: OPS[op].label }) };
                var list = Array.isArray(current) ? current.slice() : [];
                list.push(parseJsonLoose(operand));
                return { ok: true, value: list };
            case 'list_remove':
                if (type !== 'list' && type !== 'list_of_object') return { ok: false, error: I18n.t('只有列表变量能做「{op}」', { op: OPS[op].label }) };
                var src = Array.isArray(current) ? current.slice() : [];
                var target = parseJsonLoose(operand);
                var key = safeStringify(target);
                for (var i = 0; i < src.length; i++) {
                    if (src[i] === target || safeStringify(src[i]) === key) { src.splice(i, 1); break; }
                }
                return { ok: true, value: src };
            case 'toggle':
                if (type !== 'boolean' && type !== 'switch') return { ok: false, error: I18n.t('只有开关变量能做「{op}」', { op: OPS[op].label }) };
                return { ok: true, value: !current };
            case 'clear':
                return { ok: true, value: emptyOf(type) };
        }
        return { ok: false, error: I18n.t('不认识的操作：{op}', { op: op }) };
    }

    /**
     * 按 ops 列表改变量。每条 {variableId, op, value}，value 里的 {{xxx}} 取自 scope 或变量。
     * 返回 { changes:[{variableId,name,op,before,after,trimmed}], errors:[文字] }；任何一条出错只跳过这一条，错误如实返回。
     */
    function applyOps(ops, store, scope) {
        var changes = [], errors = [];
        (Array.isArray(ops) ? ops : []).forEach(function (o, idx) {
            if (!o || !o.variableId) { errors.push(I18n.t('第 {n} 条变量操作没有选变量', { n: idx + 1 })); return; }
            var name = store.nameOf ? store.nameOf(o.variableId) : o.variableId;
            if (!store.has(o.variableId)) { errors.push(I18n.t('变量「{name}」不存在', { name: name })); return; }
            var rendered = renderText(o.value, storeLookup(store, scope));
            var before = store.get(o.variableId);
            var r = applyOp(o.op || 'set', before, rendered.text, store.typeOf ? store.typeOf(o.variableId) : undefined);
            if (!r.ok) { errors.push(I18n.t('变量「{name}」：{error}', { name: name, error: r.error })); return; }
            if (store.set(o.variableId, r.value) === false) { errors.push(I18n.t('变量「{name}」不能被修改（只读，或类型不符）', { name: name })); return; }
            changes.push({ variableId: o.variableId, name: name, op: o.op || 'set', before: before, after: r.value, trimmed: !!r.trimmed });
        });
        return { changes: changes, errors: errors };
    }

    /** 把「变量系统」（getVariable / getValue / executeOperation）包成 store。 */
    function storeFromVariableSystem(vs) {
        return {
            has: function (id) { return !!(vs.getVariable && vs.getVariable(id)); },
            get: function (id) { return vs.getValue(id); },
            set: function (id, v) { return vs.executeOperation(id, 'set', { value: v }) !== false; },
            typeOf: function (id) { var x = vs.getVariable(id); return x ? x.type : undefined; },
            nameOf: function (id) { var x = vs.getVariable(id); return (x && x.name) || id; }
        };
    }

    // ---------- 点击动作 ----------
    function getActions(def) {
        var a = def && def.config && def.config.actions;
        return Array.isArray(a) ? a : [];
    }

    function findAction(def, name) {
        var list = getActions(def);
        for (var i = 0; i < list.length; i++) if (list[i] && list[i].action === name) return list[i];
        return null;
    }

    /**
     * 处理插件界面里发来的一次动作。msg: { action, label, text }。
     * 返回 { mapped, changes, errors, pendingText }：
     *   mapped=false 表示动作没配置，仍然按默认文字进暂存（不丢弃）。
     */
    function runAction(def, msg, store) {
        var action = String(msg && msg.action != null ? msg.action : '');
        var label = String(msg && msg.label != null ? msg.label : '');
        var text = String(msg && msg.text != null ? msg.text : '');
        var scope = { action: action, label: label, text: text };
        var cfg = findAction(def, action);
        if (!cfg) {
            var d = text ? I18n.t('玩家操作了「{label}」：{text}', { label: label || action, text: text }) : I18n.t('玩家操作了「{label}」', { label: label || action });
            return { mapped: false, changes: [], errors: [], pendingText: d };
        }
        var res = applyOps(cfg.ops, store, scope);
        var pending = '';
        var mode = cfg.sendMode || (cfg.send == null ? 'default' : (String(cfg.send).trim() === '' ? 'none' : 'custom'));
        if (mode === 'default') pending = text ? I18n.t('玩家点击了「{label}」：{text}', { label: cfg.label || label || action, text: text }) : I18n.t('玩家点击了「{label}」', { label: cfg.label || label || action });
        else if (mode === 'custom' && cfg.send != null && String(cfg.send).trim() !== '') pending = renderText(cfg.send, storeLookup(store, scope)).text;
        return { mapped: true, changes: res.changes, errors: res.errors, pendingText: pending };
    }

    // ---------- AI 回复 ----------
    var BLOCK_ID_RE = /^[A-Za-z0-9_\-.:]{1,64}$/;

    function escapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

    function extractBlocks(text, blockId) {
        if (!blockId || !BLOCK_ID_RE.test(blockId) || typeof text !== 'string') return [];
        var re = new RegExp('<' + escapeRegExp(blockId) + '>([\\s\\S]*?)</' + escapeRegExp(blockId) + '>', 'gi');
        var out = [], m;
        while ((m = re.exec(text)) !== null) {
            var body = m[1].trim();
            if (body) out.push(body);
        }
        return out;
    }

    var MAX_REPLY_LEN = 5000;

    /**
     * 回复要写进哪个变量：config.replyBinding = { variableId, mode:'set'|'append_line'|'append_text', prefix }。
     * 没写 replyBinding 时：用 config.outputVariableId（整个替换）；再没有，用名为「<回复块名>_log」的文字变量（追加一行）。
     * 都没有返回 null。
     */
    function resolveReplyBinding(def, store) {
        var cfg = (def && def.config) || {};
        var rb = cfg.replyBinding;
        if (rb && rb.variableId) return { variableId: rb.variableId, mode: rb.mode || 'set', prefix: rb.prefix || '' };
        if (cfg.outputVariableId) return { variableId: cfg.outputVariableId, mode: 'set', prefix: '' };
        var blockId = cfg.blockId || (def && def.id);
        if (blockId && store && store.has(blockId + '_log') && store.typeOf(blockId + '_log') === 'string') return { variableId: blockId + '_log', mode: 'append_line', prefix: '' };
        return null;
    }

    /**
     * 把一段回复内容写进插件配置的变量。
     * 返回 { changes, errors, unbound, truncated }；没有写入位置时 unbound=true，由调用方告诉用户。
     */
    function deliverReply(def, body, store) {
        var out = { changes: [], errors: [], unbound: false, truncated: false };
        var text = String(body == null ? '' : body).trim();
        if (!text) return out;
        if (text.length > MAX_REPLY_LEN) { text = text.slice(0, MAX_REPLY_LEN); out.truncated = true; }
        var rb = resolveReplyBinding(def, store);
        if (!rb) { out.unbound = true; return out; }
        var v = text;
        if (rb.prefix) {
            var pre = String(rb.prefix).replace(/\s+$/, '');
            var plain = pre.replace(/[:：]$/, '');
            var has = text.indexOf(pre) === 0 || (plain && (text.indexOf(plain + ':') === 0 || text.indexOf(plain + '：') === 0));
            if (!has) v = rb.prefix + text;
        }
        var r = applyOps([{ variableId: rb.variableId, op: rb.mode, value: '{{__reply}}' }], store, { __reply: v });
        out.changes = r.changes;
        out.errors = r.errors;
        return out;
    }

    /** AI 回复里 <blockId>…</blockId> 的内容写进变量。返回 { found, bodies, changes, errors, unbound, truncated }。 */
    function applyReply(def, replyText, store) {
        var cfg = (def && def.config) || {};
        var bodies = extractBlocks(replyText, cfg.blockId);
        var out = { found: bodies.length > 0, bodies: bodies, changes: [], errors: [], unbound: false, truncated: false };
        bodies.forEach(function (b) {
            var r = deliverReply(def, b, store);
            out.changes = out.changes.concat(r.changes);
            out.errors = out.errors.concat(r.errors);
            if (r.unbound) out.unbound = true;
            if (r.truncated) out.truncated = true;
        });
        return out;
    }

    // ---------- 发给 AI 的内容 ----------
    function buildPrompt(def, store) {
        var cfg = (def && def.config) || {};
        var r = renderText(cfg.promptTemplate || '', storeLookup(store));
        return { text: r.text, missing: r.missing };
    }

    /** 玩家这一回合暂存的插件操作 → 随用户消息一起发给 AI 的文字；没有暂存返回空字符串。 */
    function formatPending(list) {
        var arr = Array.isArray(list) ? list : [];
        if (!arr.length) return '';
        return I18n.t('〔本回合插件操作〕') + '\n' + arr.map(function (a) { return '- ' + I18n.t('{name}：{desc}', { name: a.pluginName || a.pluginId, desc: a.actionDesc || a.type }); }).join('\n');
    }

    // ---------- 界面文件扫描 ----------
    function stripTags(s) { return String(s).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(); }

    /**
     * 从显示用的 HTML / CSS / 脚本里找出：{{变量}}、data-bind 绑定、data-action 按钮、脚本里 postMessage 的 type。
     */
    function scanBindings(html, css) {
        var src = String(html == null ? '' : html);
        var placeholders = findPlaceholders(src + '\n' + String(css == null ? '' : css));
        var binds = [], actions = [], messageTypes = [], m;
        var bindRe = /data-bind\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
        while ((m = bindRe.exec(src)) !== null) {
            var k = (m[1] != null ? m[1] : m[2]).trim();
            if (k && binds.indexOf(k) < 0) binds.push(k);
        }
        var actRe = /<(\w+)([^>]*?)data-action\s*=\s*(?:"([^"]*)"|'([^']*)')([^>]*)>([\s\S]*?)(?=<\/\1\s*>|$)/gi;
        while ((m = actRe.exec(src)) !== null) {
            var name = (m[3] != null ? m[3] : m[4]).trim();
            if (!name) continue;
            var exists = false;
            for (var i = 0; i < actions.length; i++) if (actions[i].action === name) { exists = true; break; }
            if (!exists) actions.push({ action: name, label: stripTags(m[6]).slice(0, 40) || name, source: 'data-action' });
        }
        // 没有结束标签的 data-action 元素（自闭合或写法特殊）也要找到
        var actLoose = /data-action\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
        while ((m = actLoose.exec(src)) !== null) {
            var nm = (m[1] != null ? m[1] : m[2]).trim();
            if (!nm) continue;
            var seen = false;
            for (var j = 0; j < actions.length; j++) if (actions[j].action === nm) { seen = true; break; }
            if (!seen) actions.push({ action: nm, label: nm, source: 'data-action' });
        }
        var msgRe = /postMessage\s*\(\s*\{[^}]*?\btype\s*:\s*(?:"([^"]+)"|'([^']+)')/gi;
        while ((m = msgRe.exec(src)) !== null) {
            var t = (m[1] != null ? m[1] : m[2]).trim();
            if (t && t.indexOf('__plugin') !== 0 && messageTypes.indexOf(t) < 0) messageTypes.push(t);
        }
        messageTypes.forEach(function (t) {
            for (var q = 0; q < actions.length; q++) if (actions[q].action === t) return;
            actions.push({ action: t, label: t, source: 'script' });
        });
        return { placeholders: placeholders, binds: binds, actions: actions, messageTypes: messageTypes };
    }

    // ---------- 配置整理 ----------
    function cloneJson(v) {
        if (v === undefined) return undefined;
        return JSON.parse(JSON.stringify(v));
    }

    /**
     * 把模组里写的一条插件登记整理成标准形状（不改原对象）。
     * 内联的显示内容统一叫 inlineHtml / inlineStyle，旧名字 _inlineHtml / _inlineStyle 读进来。
     */
    function normalize(raw) {
        var r = raw && typeof raw === 'object' ? raw : {};
        var cfg = r.config && typeof r.config === 'object' ? r.config : {};
        var files = r.files && typeof r.files === 'object' ? r.files : {};
        var cfgFiles = cfg.files && typeof cfg.files === 'object' ? cfg.files : {};
        return {
            id: r.id == null ? '' : String(r.id),
            name: r.name == null ? '' : String(r.name),
            rawType: r.type,
            type: canonicalType(r.type),
            note: r.note || '',
            enabled: r.enabled !== false,
            condition: r.condition && typeof r.condition === 'object' ? r.condition : { type: 'always' },
            files: {
                logic: files.logic || cfgFiles.logic || '',
                display: files.display || cfgFiles.display || '',
                style: files.style || cfgFiles.style || '',
                pool: files.pool || cfgFiles.pool || ''
            },
            inlineHtml: typeof r.inlineHtml === 'string' ? r.inlineHtml : (typeof r._inlineHtml === 'string' ? r._inlineHtml : ''),
            inlineStyle: typeof r.inlineStyle === 'string' ? r.inlineStyle : (typeof r._inlineStyle === 'string' ? r._inlineStyle : ''),
            config: cfg,
            tempVariables: Array.isArray(r.tempVariables) ? r.tempVariables : []
        };
    }

    /** 这个插件界面上实际用到的变量：手动选的 + HTML 里写到的 */
    function boundVariableIds(def, html, css) {
        var out = [];
        var req = def && def.config && Array.isArray(def.config.requiredVariables) ? def.config.requiredVariables : [];
        req.forEach(function (k) { if (k && out.indexOf(k) < 0) out.push(String(k)); });
        var s = scanBindings(html, css);
        s.placeholders.concat(s.binds).forEach(function (k) { if (out.indexOf(k) < 0) out.push(k); });
        return out;
    }

    // ---------- 校验 ----------
    function issue(level, code, plugin, text, hint) {
        return { level: level, code: code, plugin: plugin && (plugin.name || plugin.id) || I18n.t('未命名插件'), text: text, hint: hint || '' };
    }

    /**
     * 检查一条插件登记，返回问题列表（空 = 没问题）。
     * env: {
     *   hasVariable(id), variableName(id), flowNames: [..]（所属模块下的流程名）, ownerExists: boolean,
     *   siblingIds: [..]（其它插件 id，用于 inputSource 检查）, moduleIds: [..]（同一个模块里所有插件的 id，用于查重复编号）, files: { display, style, pool, logic } → { text, error } 加载结果
     * }
     */
    function validate(def, env) {
        env = env || {};
        var out = [];
        var d = def && def.type !== undefined && def.rawType !== undefined ? def : normalize(def);
        var cfg = d.config || {};
        var varName = function (id) { return env.variableName ? env.variableName(id) : id; };
        var hasVar = function (id) { return env.hasVariable ? env.hasVariable(id) : true; };

        if (!d.id) out.push(issue('error', 'ID_MISSING', d, I18n.t('有一个插件没有编号，无法使用。'), I18n.t('重新添加这个插件。')));
        if (env.moduleIds && d.id) {
            var same = env.moduleIds.filter(function (x) { return x === d.id; }).length;
            if (same > 1) out.push(issue('error', 'ID_DUPLICATE', d, I18n.t('同一个模块里有 {n} 个编号相同的插件，只有第一个生效。', { n: same }), I18n.t('删掉多余的，或重新添加一个。')));
        }
        if (!d.name) out.push(issue('warn', 'NAME_MISSING', d, I18n.t('插件还没有名字。'), I18n.t('给它起一个名字，方便在列表里认出来。')));
        if (!d.type) {
            if (LEGACY_TYPES[d.rawType]) return out;
            out.push(issue('error', 'TYPE_UNKNOWN', d, I18n.t('插件类型「{type}」不认识。', { type: d.rawType == null || d.rawType === '' ? I18n.t('空') : d.rawType }), I18n.t('在类型里选一个：{types}。', { types: TYPE_ORDER.map(function (t) { return TYPE_DEFS[t].label; }).join(I18n.t('、')) })));
            return out;
        }
        if (env.ownerExists === false) out.push(issue('error', 'OWNER_MISSING', d, I18n.t('挂靠的模块不存在，插件不会出现。'), I18n.t('在「挂在哪个模块」里重新选一个。')));

        var files = env.files || {};
        ['display', 'style', 'pool', 'logic'].forEach(function (k) {
            var f = files[k];
            if (d.files[k] && f && f.error) out.push(issue('error', f.notFound ? 'FILE_MISSING' : 'FILE_BROKEN', d, f.error, f.notFound ? I18n.t('检查文件是否在模组文件夹里，或改用直接粘贴的内容。') : I18n.t('用文本编辑器打开这个文件，修好格式。')));
        });

        var html = d.inlineHtml || (files.display && files.display.text) || '';
        var css = d.inlineStyle || (files.style && files.style.text) || '';

        if (cfg.blockId != null && cfg.blockId !== '' && !BLOCK_ID_RE.test(String(cfg.blockId))) {
            out.push(issue('error', 'BLOCK_ID_INVALID', d, I18n.t('回复块的名字只能用字母、数字、下划线、横线。'), I18n.t('改一个简单的名字。')));
        }

        var needsFace = d.type === 'display' || d.type === 'interactive' || d.type === 'display_interactive';
        if (needsFace) {
            if (!html && !d.files.display) {
                if (d.type === 'display' || d.type === 'display_interactive') out.push(issue('error', 'DISPLAY_EMPTY', d, I18n.t('没有设置要显示的内容。'), I18n.t('在编辑里粘贴页面内容，或导入一个文件。')));
                else out.push(issue('warn', 'DISPLAY_EMPTY', d, I18n.t('交互器没有页面，玩家没有地方点击或输入。'), I18n.t('在编辑里粘贴页面内容，或导入一个文件。')));
            }
            if (html && String(html).length + String(css).length > 1500000) {
                out.push(issue('error', 'SIZE_TOO_LARGE', d, I18n.t('页面内容太大，无法显示。'), I18n.t('精简页面，或把大图换成小图。')));
            }
            boundVariableIds(d, html, css).forEach(function (k) {
                if (!hasVar(k)) out.push(issue('warn', 'VAR_MISSING', d, I18n.t('页面用到的变量「{name}」不存在。', { name: varName(k) }), I18n.t('在变量里添加它，或重新选一个已有的变量。')));
            });
        } else {
            (cfg.requiredVariables || []).forEach(function (k) {
                if (!hasVar(k)) out.push(issue('warn', 'VAR_MISSING', d, I18n.t('选择的变量「{name}」不存在。', { name: varName(k) }), I18n.t('重新选一个已有的变量。')));
            });
        }

        if (d.type === 'interactive' || d.type === 'display_interactive') {
            var hasPrompt = (d.type === 'interactive' && cfg.promptTemplate) || (d.type === 'display_interactive' && cfg.updatePrompt);
            if (!hasPrompt && !getActions(d).length) out.push(issue('warn', 'PROMPT_EMPTY', d, I18n.t('没有设置发给 AI 的内容，玩家操作不会带给 AI。'), I18n.t('填写提示词，或给按钮设置「发给 AI 的文字」。')));
        }
        getActions(d).forEach(function (a) {
            (a && Array.isArray(a.ops) ? a.ops : []).forEach(function (o) {
                if (!o || !o.variableId) out.push(issue('warn', 'ACTION_VAR_MISSING', d, I18n.t('按钮「{label}」的一条变量操作没有选变量。', { label: a.label || a.action }), I18n.t('选一个变量，或删掉这条操作。')));
                else if (!hasVar(o.variableId)) out.push(issue('warn', 'ACTION_VAR_MISSING', d, I18n.t('按钮「{label}」要改的变量「{name}」不存在。', { label: a.label || a.action, name: varName(o.variableId) }), I18n.t('重新选一个已有的变量。')));
            });
        });
        if (cfg.replyBinding && cfg.replyBinding.variableId && !hasVar(cfg.replyBinding.variableId)) {
            out.push(issue('warn', 'REPLY_VAR_MISSING', d, I18n.t('AI 回复要写入的变量「{name}」不存在。', { name: varName(cfg.replyBinding.variableId) }), I18n.t('重新选一个已有的变量。')));
        }

        if (d.type === 'randomizer') {
            if (!d.files.pool && !cfg.pool && !(Array.isArray(cfg.entries) && cfg.entries.length)) out.push(issue('error', 'POOL_MISSING', d, I18n.t('没有设置随机池。'), I18n.t('导入随机池文件，或在编辑里粘贴池内容。')));
            if (cfg.tempStorage && !hasVar(cfg.tempStorage) && !(d.tempVariables || []).some(function (t) { return t && t.id === cfg.tempStorage; })) {
                out.push(issue('warn', 'TEMP_VAR_MISSING', d, I18n.t('抽到的结果要存进的变量「{name}」不存在。', { name: varName(cfg.tempStorage) }), I18n.t('选一个已有的变量，或不存放。')));
            }
        }
        if (d.type === 'variable_reader') {
            if (!cfg.inputSource) out.push(issue('error', 'INPUT_SOURCE_MISSING', d, I18n.t('没有选要读取哪个插件的结果。'), I18n.t('在「读取哪个插件」里选一个。')));
            else if (env.siblingIds && env.siblingIds.indexOf(cfg.inputSource) < 0) out.push(issue('error', 'INPUT_SOURCE_MISSING', d, I18n.t('要读取的插件「{name}」不存在。', { name: cfg.inputSource }), I18n.t('重新选一个已有的插件。')));
            if (!Array.isArray(cfg.targetVariables) || !cfg.targetVariables.length) out.push(issue('error', 'TARGET_MISSING', d, I18n.t('没有设置读出的内容要写进哪个变量。'), I18n.t('添加一条「写入变量」。')));
            (cfg.targetVariables || []).forEach(function (t) {
                var id = t && t.variableId;
                if (!id) out.push(issue('error', 'TARGET_MISSING', d, I18n.t('有一条写入没有选变量。'), I18n.t('选一个变量，或删掉这条。')));
                else if (!hasVar(id)) out.push(issue('error', 'TARGET_VAR_MISSING', d, I18n.t('要写入的变量「{name}」不存在。', { name: varName(id) }), I18n.t('重新选一个已有的变量。')));
            });
        }
        if (d.type === 'variable_op') {
            if (!Array.isArray(cfg.operations) || !cfg.operations.length) out.push(issue('warn', 'OPS_EMPTY', d, I18n.t('还没有设置任何变量操作。'), I18n.t('添加一条操作。')));
            (cfg.operations || []).forEach(function (o) {
                if (!o || !o.variableId) out.push(issue('error', 'ACTION_VAR_MISSING', d, I18n.t('有一条变量操作没有选变量。'), I18n.t('选一个变量，或删掉这条。')));
                else if (!hasVar(o.variableId)) out.push(issue('error', 'ACTION_VAR_MISSING', d, I18n.t('要操作的变量「{name}」不存在。', { name: varName(o.variableId) }), I18n.t('重新选一个已有的变量。')));
            });
        }
        if (d.type === 'module_generator') {
            var tpl = cfg.moduleTemplate;
            if (!tpl || typeof tpl !== 'object' || !tpl.id) out.push(issue('error', 'TEMPLATE_MISSING', d, I18n.t('没有设置要生成的模块。'), I18n.t('在编辑里填写模块名称和类型。')));
            if (!cfg.outputFlow) out.push(issue('error', 'FLOW_MISSING', d, I18n.t('没有选生成的模块放到哪条流程。'), I18n.t('在「放到哪条流程」里选一个。')));
            else if (env.flowNames && env.flowNames.indexOf(cfg.outputFlow) < 0) out.push(issue('error', 'FLOW_MISSING', d, I18n.t('选择的流程「{name}」不存在。', { name: cfg.outputFlow }), I18n.t('重新选一条已有的流程。')));
            if (cfg.inputSource && cfg.inputSource !== 'builtin' && env.siblingIds && env.siblingIds.indexOf(cfg.inputSource) < 0) out.push(issue('error', 'INPUT_SOURCE_MISSING', d, I18n.t('要读取的插件「{name}」不存在。', { name: cfg.inputSource }), I18n.t('重新选一个已有的插件。')));
        }
        if (d.type === 'summary') {
            if (!cfg.summaryTemplate) out.push(issue('warn', 'SUMMARY_EMPTY', d, I18n.t('没有设置总结的内容。'), I18n.t('填写总结内容，可以插入变量。')));
        }
        return out;
    }

    return {
        TYPE_DEFS: TYPE_DEFS,
        TYPE_ORDER: TYPE_ORDER,
        TYPE_ALIASES: TYPE_ALIASES,
        LEGACY_TYPES: LEGACY_TYPES,
        OPS: OPS,
        OP_ORDER: OP_ORDER,
        BLOCK_ID_RE: BLOCK_ID_RE,
        canonicalType: canonicalType,
        typeLabel: typeLabel,
        hasFrontend: hasFrontend,
        sideOf: sideOf,
        safeStringify: safeStringify,
        formatValue: formatValue,
        renderText: renderText,
        storeLookup: storeLookup,
        findPlaceholders: findPlaceholders,
        applyOp: applyOp,
        applyOps: applyOps,
        storeFromVariableSystem: storeFromVariableSystem,
        getActions: getActions,
        findAction: findAction,
        runAction: runAction,
        extractBlocks: extractBlocks,
        applyReply: applyReply,
        deliverReply: deliverReply,
        resolveReplyBinding: resolveReplyBinding,
        buildPrompt: buildPrompt,
        formatPending: formatPending,
        scanBindings: scanBindings,
        normalize: normalize,
        boundVariableIds: boundVariableIds,
        validate: validate,
        cloneJson: cloneJson
    };
});
