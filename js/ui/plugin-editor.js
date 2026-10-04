/**
 * 插件编辑器：模组编辑里「插件」区块的全部界面。
 * 类型、挂在哪个模块、触发条件、变量绑定、按钮效果、提示词、回复写入位置都用选择或填数字完成；
 * 页面内容（HTML / CSS）可以导入文件或直接粘贴，旁边实时预览，并自动列出页面里用到的变量和按钮。
 * 源码只在「源码」里只读显示，不是唯一的操作方式。
 * 改动直接写在模组配置里的插件登记上，经 DebugModuleJump 的编辑流程生效、可撤销。
 */
const PluginEditor = {
    openCards: {},
    focusPlugin: null,
    previews: new Map(),
    cache: new Map(),
    _uid: 0,
    _timer: 0,
    _lastCheckpoint: 0,

    FACE: { display: 1, interactive: 1, display_interactive: 1 },
    SEND_MODES: [['default', I18n.t('默认文字')], ['none', I18n.t('不发送')], ['custom', I18n.t('自定义文字')]],
    REPLY_MODES: [['set', I18n.t('覆盖原来的内容')], ['append_line', I18n.t('追加一行')], ['append_text', I18n.t('接在后面')]],
    TEMPLATE_TYPES: [['free_trigger', I18n.t('自由触发器')], ['trigger_chain', I18n.t('触发器链')], ['timeline', I18n.t('时间线')]],
    DELETE_TEXT: { 'blk-del': I18n.t('已删除内容块。'), 'req-del': I18n.t('已移除变量。'), 'act-del': I18n.t('已删除按钮设置。'), 'op-del': I18n.t('已删除变量操作。'), 'tv-del': I18n.t('已删除写入。') },
    SIDES: [['', I18n.t('默认')], ['left', I18n.t('左侧')], ['right', I18n.t('右侧')]],
    COND_MODES: [['always', I18n.t('始终启用')], ['precondition', I18n.t('满足条件时启用')]],

    esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); },

    uid() { return 'pe' + (++this._uid); },

    // ---------- 上下文 ----------
    ctxFor(dbg, m) {
        const ms = dbg.moduleSystem;
        const mods = [];
        const walk = (mod, depth) => {
            mods.push({ id: mod.id, name: mod.name || I18n.t('未命名'), depth });
            if (mod.getAllSubModules) Array.from(mod.getAllSubModules()).forEach(c => walk(c, depth + 1));
        };
        walk(ms.getModule(ms.rootModuleId), 0);
        const plugins = [];
        mods.forEach(x => { const mm = ms.getModule(x.id); (mm.plugins || []).forEach(pp => { if (pp && pp.id) plugins.push({ p: pp, modId: x.id, modName: x.name }); }); });
        const flows = Object.keys(m.flows || {});
        if (m.subModules && m.subModules.forEach) m.subModules.forEach((v, k) => { if (flows.indexOf(k) < 0) flows.push(k); });
        if (flows.indexOf('main') < 0) flows.unshift('main');
        return { dbg, m, vars: dbg._varList(), mods, plugins, flows, modulePath: dbg.modulePath };
    },

    varName(ctx, id) { const v = ctx.vars.find(x => x.id === id); return v ? v.name : id; },
    varType(ctx, id) { const v = ctx.vars.find(x => x.id === id); return v ? v.type : ''; },

    // ---------- 小部件 ----------
    option(value, label, selected) { return '<option value="' + this.esc(value) + '"' + (selected ? ' selected' : '') + '>' + this.esc(label) + '</option>'; },

    select(attrs, pairs, current) { return '<select class="pe-in" ' + attrs + '>' + pairs.map(x => this.option(x[0], x[1], String(x[0]) === String(current))).join('') + '</select>'; },

    varSelect(ctx, attrs, current, placeholder) {
        const pairs = [['', placeholder || I18n.t('（不选）')]].concat(ctx.vars.map(v => [v.id, I18n.t('{name}（{type}）', { name: v.name, type: this.typeCN(v.type) })]));
        if (current && !ctx.vars.some(v => v.id === current)) pairs.push([current, I18n.t('{id}（不存在）', { id: current })]);
        return this.select(attrs, pairs, current || '');
    },

    typeCN(t) { return ({ number: I18n.t('数值'), string: I18n.t('文字'), boolean: I18n.t('开关'), switch: I18n.t('开关'), list: I18n.t('列表'), object: I18n.t('对象'), list_of_object: I18n.t('对象列表') })[t] || t || I18n.t('文字'); },

    field(label, inner, hint) { return '<div class="pe-field"><label class="pe-label">' + this.esc(label) + '</label>' + inner + (hint ? '<div class="pe-hint">' + this.esc(hint) + '</div>' : '') + '</div>'; },

    /** 文本框旁边的「插入变量」下拉；选中后把 {{变量}} 插进文本框光标处 */
    insertBox(ctx, target, withText) {
        const opts = [['', I18n.t('插入变量')]];
        if (withText) opts.push(['{{text}}', I18n.t('玩家输入的文字')]);
        ctx.vars.forEach(v => opts.push(['{{' + v.id + '}}', I18n.t('{name}（{type}）', { name: v.name, type: this.typeCN(v.type) })]));
        return '<select class="pe-in pe-ins" data-pe-ins="' + this.esc(target) + '" aria-label="' + I18n.t('插入变量') + '">' + opts.map(o => this.option(o[0], o[1], false)).join('') + '</select>';
    },

    textareaWithInsert(ctx, pf, value, rows, withText, placeholder) {
        const id = this.uid();
        return '<textarea class="pe-in pe-ta" rows="' + (rows || 3) + '" data-pf="' + this.esc(pf) + '" data-uid="' + id + '"' + (placeholder ? ' placeholder="' + this.esc(placeholder) + '"' : '') + '>' + this.esc(value || '') + '</textarea>' + this.insertBox(ctx, id, withText);
    },

    // ---------- 总体 ----------
    html(dbg, m) {
        const list = Array.isArray(m.plugins) ? m.plugins : [];
        if (!list.length) return '<div class="mjx-empty">' + I18n.t('这个事件还没有插件。') + '</div>';
        const ctx = this.ctxFor(dbg, m);
        return list.map((p, i) => this.card(ctx, p, i)).join('');
    },

    card(ctx, p, i) {
        const esc = this.esc;
        const def = PluginRuntime.normalize(p);
        const open = !!this.openCards[ctx.m.id + '|' + p.id];
        const typeLabel = PluginRuntime.typeLabel(def.type || def.rawType);
        return '<div class="pe-card" data-pi="' + i + '" data-pid="' + esc(p.id) + '">' +
            '<div class="pe-head"><button type="button" class="pe-toggle" data-pe="toggle" aria-expanded="' + (open ? 'true' : 'false') + '">' +
            '<span class="pe-name">' + esc(p.name || I18n.t('未命名插件')) + '</span><span class="pe-type">' + esc(typeLabel) + '</span><span class="pe-badge" data-pe-badge="1"></span></button>' +
            '<button type="button" class="mjx-b mjx-b-untrig" data-pe="del">' + I18n.t('删除') + '</button></div>' +
            '<div class="pe-body"' + (open ? '' : ' hidden') + '>' + (open ? this.body(ctx, p, i, def) : '') + '</div></div>';
    },

    body(ctx, p, i, def) {
        const type = def.type;
        let h = '<div class="pe-issues" data-pe-issues="1"></div>';
        h += this.sectionBasic(ctx, p, def);
        if (this.FACE[type]) h += this.sectionFace(ctx, p, def) + this.sectionActions(ctx, p, def);
        if (type === 'interactive' || type === 'display_interactive') h += this.sectionPrompt(ctx, p, def);
        if (type === 'randomizer') h += this.sectionRandomizer(ctx, p, def);
        if (type === 'variable_reader') h += this.sectionReader(ctx, p, def);
        if (type === 'variable_op') h += this.sectionOps(ctx, p, def);
        if (type === 'module_generator') h += this.sectionGenerator(ctx, p, def);
        if (type === 'summary') h += this.sectionSummary(ctx, p, def);
        h += '<div class="pe-actions"><button type="button" class="mjx-b mjx-b-jump" data-pe="test">' + I18n.t('在插件测试里试一试') + '</button></div>';
        h += '<details class="pe-details"><summary>' + I18n.t('源码（只读）') + '</summary><textarea class="pe-in pe-ta pe-src" rows="10" readonly data-native="1" data-pe-src="1"></textarea></details>';
        return h;
    },

    // ---------- 各区块 ----------
    sectionBasic(ctx, p, def) {
        const esc = this.esc;
        const typePairs = PluginRuntime.TYPE_ORDER.map(t => [t, PluginRuntime.typeLabel(t)]);
        if (!def.type) typePairs.unshift([String(p.type == null ? '' : p.type), I18n.t('{id}（不认识）', { id: String(p.type || I18n.t('（空）')) })]);
        const modPairs = ctx.mods.map(x => [x.id, new Array(x.depth + 1).join('　') + x.name]);
        const condMode = def.condition && def.condition.type && def.condition.type !== 'always' ? 'precondition' : 'always';
        return '<section class="pe-sec"><h5>' + I18n.t('基本') + '</h5>' +
            this.field(I18n.t('名称'), '<input type="text" class="pe-in" data-pf="name" value="' + esc(p.name || '') + '">') +
            this.field(I18n.t('类型'), this.select('data-pf="type" data-pe-struct="1"', typePairs, def.type || String(p.type == null ? '' : p.type)), I18n.t('改类型会保留已填的内容，只是不用的部分不再生效。')) +
            this.field(I18n.t('挂在哪个模块'), this.select('data-pe-attach="1"', modPairs, ctx.m.id), I18n.t('插件只在这个模块里显示和运行，旗下的子模块自动继承。')) +
            this.field(I18n.t('启用'), '<label class="pe-check"><input type="checkbox" data-pf="enabled" data-kind="bool"' + (p.enabled === false ? '' : ' checked') + '><span>' + I18n.t('启用这个插件') + '</span></label>') +
            this.field(I18n.t('什么时候生效'), this.select('data-pe-cond="1"', this.COND_MODES, condMode) + '<div class="pe-cond-host" data-pe-cond-host="1"' + (condMode === 'always' ? ' hidden' : '') + '></div>') +
            '</section>';
    },

    chips(ctx, ids) {
        if (!ids.length) return '<div class="pe-hint">' + I18n.t('页面里没有用到变量。') + '</div>';
        return '<div class="pe-chips">' + ids.map(id => {
            const ok = ctx.vars.some(v => v.id === id);
            return '<span class="pe-chip' + (ok ? '' : ' pe-chip-bad') + '">' + this.esc(ok ? this.varName(ctx, id) : I18n.t('{id}（不存在）', { id: id })) + '</span>';
        }).join('') + '</div>';
    },

    pageMode(def) {
        const cfg = def.config || {};
        if (cfg.pageMode === 'build' || cfg.pageMode === 'custom') return cfg.pageMode;
        return def.inlineHtml || def.files.display ? 'custom' : 'build';
    },

    sectionFace(ctx, p, def) {
        const esc = this.esc;
        const cfg = def.config || {};
        const req = Array.isArray(cfg.requiredVariables) ? cfg.requiredVariables : [];
        const mode = this.pageMode(def);
        const fileNote = (def.files.display ? I18n.t('使用文件「{file}」；改动后改用这里的内容。', { file: def.files.display }) : '');
        let content;
        if (mode === 'build') {
            const blocks = Array.isArray(cfg.pageBlocks) ? cfg.pageBlocks : [];
            content = this.field(I18n.t('页面内容'), '<div data-pe-blocks="1">' + this.blocksHtml(ctx, blocks) + '</div><div class="pe-row">' + this.select('data-pe-blk-add="1"', [['', I18n.t('添加内容块')]].concat(PluginPageBuilder.ORDER.map(t => [t, PluginPageBuilder.TYPES[t].label])), '') + '</div>', I18n.t('按钮点击后做什么，在下面「页面里的按钮」里设置。')) +
                '<details class="pe-details"><summary>' + I18n.t('页面源码（只读）') + '</summary>' +
                '<textarea class="pe-in pe-ta pe-code" rows="8" readonly data-pe-doc="html" data-native="1" spellcheck="false">' + esc(def.inlineHtml) + '</textarea>' +
                '<textarea class="pe-in pe-ta pe-code" rows="6" readonly data-pe-doc="css" data-native="1" spellcheck="false">' + esc(def.inlineStyle) + '</textarea></details>';
        } else {
            content = this.field(I18n.t('页面内容（HTML）'), '<textarea class="pe-in pe-ta pe-code" rows="10" data-pf="inlineHtml" data-pe-doc="html" data-native="1" spellcheck="false">' + esc(def.inlineHtml) + '</textarea>' +
                '<div class="pe-row"><button type="button" class="mjx-b" data-pe="import-html">' + I18n.t('导入 HTML 文件') + '</button><input type="file" accept=".html,.htm,.txt" hidden data-pe-file="html"></div>', fileNote || I18n.t('粘贴页面代码或导入文件。页面里可以写 {{变量}}，用 data-bind 让数值自动更新。')) +
                this.field(I18n.t('样式（CSS）'), '<textarea class="pe-in pe-ta pe-code" rows="6" data-pf="inlineStyle" data-pe-doc="css" data-native="1" spellcheck="false">' + esc(def.inlineStyle) + '</textarea>' +
                    '<div class="pe-row"><button type="button" class="mjx-b" data-pe="import-css">' + I18n.t('导入 CSS 文件') + '</button><input type="file" accept=".css,.txt" hidden data-pe-file="css"></div>');
        }
        return '<section class="pe-sec"><h5>' + I18n.t('页面') + '</h5>' +
            this.field(I18n.t('制作方式'), this.select('data-pe-pagemode="1"', [['build', I18n.t('点选搭建')], ['custom', I18n.t('自己的页面内容')]], mode)) +
            content +
            this.field(I18n.t('预览'), '<div class="pe-row"><label class="pe-hint">' + I18n.t('宽度') + '</label>' + this.select('data-pe-prevw="1"', [['320', I18n.t('手机窄屏（320）')], ['390', I18n.t('手机（390）')], ['600', I18n.t('平板（600）')], ['0', I18n.t('占满')]], '390') + '</div><div class="pe-preview" data-pe-preview="1"></div><div class="pe-hint" data-pe-prevmsg="1"></div>', I18n.t('预览用的是现在的变量值，点击不会改动游戏。')) +
            this.field(I18n.t('显示位置'), this.select('data-pf="config.side"', this.SIDES, cfg.side || ''), I18n.t('默认：显示器在右侧，其余在左侧。')) +
            this.field(I18n.t('页面里用到的变量'), '<div data-pe-detected="1"></div>', I18n.t('自动找出页面里写的 {{变量}} 和 data-bind。')) +
            this.field(I18n.t('另外绑定的变量'), this.reqList(ctx, req)) +
            this.field(I18n.t('网络图片'), '<label class="pe-check"><input type="checkbox" data-pf="config.allowExternalImages" data-kind="bool"' + (cfg.allowExternalImages === true ? ' checked' : '') + '><span>' + I18n.t('允许页面加载网络上的图片') + '</span></label>', I18n.t('打开后页面会向图片所在的网站发出请求；默认关闭。')) +
            '</section>';
    },

    /** 点选搭建的内容块列表 */
    blocksHtml(ctx, blocks) {
        if (!blocks.length) return '<div class="pe-hint">' + I18n.t('还没有内容块。') + '</div>';
        const probs = PluginPageBuilder.problems(blocks);
        const inp = (f, v, extra) => '<input type="text" class="pe-in" data-pe-bf="' + f + '" value="' + this.esc(v == null ? '' : v) + '"' + (extra || '') + '>';
        return blocks.map((b, k) => {
            const def = PluginPageBuilder.TYPES[b.type];
            let fields = '';
            if (!def) fields = '<div class="pe-hint">' + this.esc(I18n.t('这个内容块不认识，删掉后重新添加。')) + '</div>';
            else if (b.type === 'title' || b.type === 'text') {
                const id = this.uid();
                fields = this.field(I18n.t('文字'), '<textarea class="pe-in pe-ta" rows="2" data-pe-bf="text" data-uid="' + id + '">' + this.esc(b.text || '') + '</textarea>' + this.insertBox(ctx, id, false));
            } else if (b.type === 'value') {
                fields = this.field(I18n.t('名称'), inp('label', b.label)) + this.field(I18n.t('变量'), this.varSelect(ctx, 'data-pe-bf="variableId"', b.variableId || '', I18n.t('选变量')));
            } else if (b.type === 'bar') {
                fields = this.field(I18n.t('名称'), inp('label', b.label)) + this.field(I18n.t('变量'), this.varSelect(ctx, 'data-pe-bf="variableId"', b.variableId || '', I18n.t('选变量'))) +
                    this.field(I18n.t('变量等于多少时是满的'), '<input type="number" step="any" min="0" class="pe-in" data-pe-bf="max" value="' + this.esc(b.max == null ? '' : b.max) + '">');
            } else if (b.type === 'button') {
                fields = this.field(I18n.t('按钮上的字'), inp('label', b.label));
            } else if (b.type === 'input') {
                fields = this.field(I18n.t('输入框的提示文字'), inp('placeholder', b.placeholder)) + this.field(I18n.t('发送按钮上的字'), inp('label', b.label));
            }
            const prob = probs.filter(x => x.index === k).map(x => '<div class="pe-hint pe-bad">' + this.esc(x.text) + '</div>').join('');
            return '<div class="pe-blk" data-bk="' + k + '"><div class="pe-blk-head"><b>' + this.esc(def ? def.label : I18n.t('未知')) + '</b><span class="pe-blk-ops">' +
                '<button type="button" class="mjx-b" data-pe="blk-up"' + (k === 0 ? ' disabled' : '') + '>' + I18n.t('上移') + '</button>' +
                '<button type="button" class="mjx-b" data-pe="blk-down"' + (k === blocks.length - 1 ? ' disabled' : '') + '>' + I18n.t('下移') + '</button>' +
                '<button type="button" class="mjx-b mjx-b-untrig" data-pe="blk-del">' + I18n.t('删除') + '</button></span></div>' + fields + prob + '</div>';
        }).join('');
    },

    reqList(ctx, req) {
        const chips = req.map((id, k) => '<span class="pe-chip">' + this.esc(this.varName(ctx, id)) + '<button type="button" class="pe-chip-x" data-pe="req-del" data-ri="' + k + '" aria-label="' + I18n.t('移除') + '">×</button></span>').join('');
        return '<div class="pe-chips">' + (chips || '<span class="pe-hint">' + I18n.t('没有。') + '</span>') + '</div><div class="pe-row">' + this.varSelect(ctx, 'data-pe-req-add="1"', '', I18n.t('添加变量')) + '</div>';
    },

    /** 页面里的按钮 → 点击后的效果 */
    detectedActions(p, def, extraText) {
        const html = def.inlineHtml || '';
        const found = PluginRuntime.scanBindings(html + '\n' + (extraText || ''), '').actions;
        const list = found.slice();
        PluginRuntime.getActions(def).forEach(a => { if (a && a.action && !list.some(f => f.action === a.action)) list.push({ action: a.action, label: a.label || a.action, source: 'config' }); });
        return list;
    },

    sectionActions(ctx, p, def) {
        return '<section class="pe-sec"><h5>' + I18n.t('页面里的按钮') + '</h5><div class="pe-hint">' + I18n.t('自动列出页面里的按钮。给每个按钮选择点击后做什么，不用写代码。') + '</div><div data-pe-actions="1">' + this.actionsHtml(ctx, p, def) + '</div></section>';
    },

    actionsHtml(ctx, p, def) {
        const esc = this.esc;
        const rows = this.detectedActions(p, def, def.logicText);
        if (!rows.length) return '<div class="pe-hint">' + this.esc(I18n.t('页面里还没有按钮。给按钮加上 data-action="名称"，这里就会列出来。')) + '</div>';
        const isDisplay = def.type === 'display';
        return rows.map(r => {
            const cfg = PluginRuntime.findAction(def, r.action) || {};
            const mode = cfg.sendMode || (cfg.send == null ? 'default' : (String(cfg.send).trim() === '' ? 'none' : 'custom'));
            const id = this.uid();
            const note = r.source === 'config' ? I18n.t('页面里没有这个按钮') : (r.source === 'script' ? I18n.t('来自页面脚本') : '');
            return '<div class="pe-act" data-pe-an="' + esc(r.action) + '">' +
                '<div class="pe-act-head"><b>' + esc(r.label || r.action) + '</b>' + (note ? '<span class="pe-hint">' + esc(note) + '</span>' : '') + (r.source === 'config' ? '<button type="button" class="mjx-b mjx-b-untrig" data-pe="act-del">' + I18n.t('删除') + '</button>' : '') + '</div>' +
                (isDisplay ? '' : this.field(I18n.t('点击后发给 AI'), this.select('data-pe-sendmode="1"', this.SEND_MODES, mode) +
                    (mode === 'custom' ? '<textarea class="pe-in pe-ta" rows="2" data-pe-send="1" data-uid="' + id + '">' + esc(cfg.send || '') + '</textarea>' + this.insertBox(ctx, id, true) : ''))) +
                this.field(I18n.t('点击后改变量'), '<div data-pe-ops="1">' + (cfg.ops || []).map((o, k) => this.opRow(ctx, o, k, 'act-op')).join('') + '</div><div class="pe-row"><button type="button" class="mjx-b" data-pe="act-op-add">' + I18n.t('添加变量操作') + '</button></div>') +
                '</div>';
        }).join('');
    },

    /** 一行变量操作：变量 + 操作 + 值 */
    opRow(ctx, o, k, kind) {
        const type = this.varType(ctx, o.variableId);
        const ops = this.opsFor(type);
        const op = o.op || 'set';
        const needs = PluginRuntime.OPS[op] ? PluginRuntime.OPS[op].needsValue : true;
        const id = this.uid();
        let valueHtml = '';
        if (needs) {
            if (type === 'number' && (op === 'add' || op === 'subtract' || op === 'multiply' || op === 'set')) valueHtml = '<input type="number" step="any" class="pe-in" data-pe-opv="1" value="' + this.esc(o.value == null ? '' : o.value) + '">';
            else valueHtml = '<textarea class="pe-in pe-ta" rows="1" data-pe-opv="1" data-uid="' + id + '">' + this.esc(o.value == null ? '' : o.value) + '</textarea>' + this.insertBox(ctx, id, true);
        }
        return '<div class="pe-oprow" data-ok="' + k + '" data-pe-kind="' + kind + '">' + this.varSelect(ctx, 'data-pe-opvar="1"', o.variableId || '', I18n.t('选变量')) +
            this.select('data-pe-opop="1"', ops.map(x => [x, PluginRuntime.OPS[x].label]), op) + valueHtml +
            '<button type="button" class="mjx-b mjx-b-untrig" data-pe="op-del">' + I18n.t('删除') + '</button></div>';
    },

    opsFor(type) {
        const base = { number: ['set', 'add', 'subtract', 'multiply'], string: ['set', 'append_line', 'append_text', 'clear'], boolean: ['set', 'toggle'], switch: ['set', 'toggle'], list: ['set', 'list_add', 'list_remove', 'clear'], list_of_object: ['set', 'list_add', 'list_remove', 'clear'], object: ['set', 'clear'] };
        return base[type] || ['set'];
    },

    sectionPrompt(ctx, p, def) {
        const esc = this.esc;
        const cfg = def.config || {};
        const isInter = def.type === 'interactive';
        const rb = cfg.replyBinding || {};
        return '<section class="pe-sec"><h5>' + I18n.t('发给 AI 的内容') + '</h5>' +
            this.field(isInter ? I18n.t('提示词') : I18n.t('每次发送时附带的内容'), this.textareaWithInsert(ctx, isInter ? 'config.promptTemplate' : 'config.updatePrompt', isInter ? cfg.promptTemplate : cfg.updatePrompt, 4, false), I18n.t('写给 AI 看的说明。用「插入变量」把变量的当前值放进去。')) +
            this.field(I18n.t('玩家怎么操作'), '<textarea class="pe-in pe-ta" rows="2" data-pf="config.userInteraction">' + esc(cfg.userInteraction || '') + '</textarea>', I18n.t('一句话告诉 AI 玩家在这个插件里能做什么，可以不填。')) +
            this.field(I18n.t('要求 AI 怎么回复'), '<textarea class="pe-in pe-ta" rows="2" data-pf="config.outputFormat">' + esc(cfg.outputFormat || '') + '</textarea>', I18n.t('例如：在 <名字> 块内只回复一行。')) +
            this.field(I18n.t('回复块的名字'), '<input type="text" class="pe-in" data-pf="config.blockId" value="' + esc(cfg.blockId || '') + '" placeholder="' + I18n.t('只用字母、数字、下划线') + '">', I18n.t('AI 把回复放在 <这个名字></这个名字> 里，系统据此认出是给这个插件的。')) +
            this.field(I18n.t('AI 的回复写进哪个变量'), this.varSelect(ctx, 'data-pf="config.replyBinding.variableId" data-struct="1"', rb.variableId || '', I18n.t('不保存回复')) +
                (rb.variableId ? '<div class="pe-row">' + this.select('data-pf="config.replyBinding.mode"', this.REPLY_MODES, rb.mode || 'set') + '<textarea class="pe-in pe-ta" rows="1" data-pf="config.replyBinding.prefix" placeholder="' + I18n.t('每条回复前面加的文字（可不填）') + '">' + esc(rb.prefix || '') + '</textarea></div>' : '')) +
            '</section>';
    },

    sectionRandomizer(ctx, p, def) {
        const cfg = def.config || {};
        const poolNote = def.files.pool ? I18n.t('使用文件「{file}」；改动后改用这里的内容。', { file: def.files.pool }) : '';
        return '<section class="pe-sec"><h5>' + I18n.t('随机池') + '</h5>' +
            this.field(I18n.t('池的内容（JSON）'), '<textarea class="pe-in pe-ta pe-code" rows="10" data-pe-pool="1" data-native="1" spellcheck="false"></textarea>' +
                '<div class="pe-row"><button type="button" class="mjx-b" data-pe="import-pool">' + I18n.t('导入池文件') + '</button><input type="file" accept=".json,.txt" hidden data-pe-file="pool"></div><div class="pe-hint" data-pe-poolmsg="1"></div>', poolNote || I18n.t('导入文件，或直接粘贴。每一项一个对象，可以带 id、名称、权重等。')) +
            this.field(I18n.t('抽到的结果存进哪个变量'), this.varSelect(ctx, 'data-pf="config.tempStorage"', cfg.tempStorage || '', I18n.t('不存放')), I18n.t('变量读取器可以从这里读取抽到的结果；变量类型要是对象。')) +
            '</section>';
    },

    sectionReader(ctx, p, def) {
        const cfg = def.config || {};
        const upstream = ctx.plugins.filter(x => x.p.id !== p.id && PluginRuntime.canonicalType(x.p.type) === 'randomizer');
        const pairs = [['', I18n.t('（选一个插件）')]].concat(upstream.map(x => [x.p.id, I18n.t('{name}（{mod}）', { name: x.p.name || x.p.id, mod: x.modName })]));
        if (cfg.inputSource && !upstream.some(x => x.p.id === cfg.inputSource)) pairs.push([cfg.inputSource, I18n.t('{id}（不存在）', { id: cfg.inputSource })]);
        const targets = Array.isArray(cfg.targetVariables) ? cfg.targetVariables : [];
        return '<section class="pe-sec"><h5>' + I18n.t('读取') + '</h5>' +
            this.field(I18n.t('读取哪个插件的结果'), this.select('data-pf="config.inputSource"', pairs, cfg.inputSource || ''), I18n.t('一般选一个随机器。')) +
            this.field(I18n.t('写进哪些变量'), '<div data-pe-targets="1">' + targets.map((t, k) => '<div class="pe-oprow" data-tk="' + k + '">' + this.varSelect(ctx, 'data-pe-tvar="1"', t.variableId || '', I18n.t('选变量')) +
                '<textarea class="pe-in pe-ta" rows="1" data-pe-tmap="1" placeholder="' + I18n.t('结果里的哪一项（留空 = 整个结果）') + '">' + this.esc(t.mapping || '') + '</textarea>' +
                '<button type="button" class="mjx-b mjx-b-untrig" data-pe="tv-del">' + I18n.t('删除') + '</button></div>').join('') + '</div><div class="pe-row"><button type="button" class="mjx-b" data-pe="tv-add">' + I18n.t('添加写入') + '</button></div>', I18n.t('「哪一项」填结果里的字段名，例如 id、name。')) +
            '</section>';
    },

    sectionOps(ctx, p, def) {
        const ops = Array.isArray(def.config.operations) ? def.config.operations : [];
        return '<section class="pe-sec"><h5>' + I18n.t('变量操作') + '</h5><div class="pe-hint">' + I18n.t('进入所属模块时，按顺序执行下面的操作。') + '</div><div data-pe-oplist="1">' + ops.map((o, k) => this.opRow(ctx, o, k, 'op')).join('') +
            '</div><div class="pe-row"><button type="button" class="mjx-b" data-pe="op-add">' + I18n.t('添加变量操作') + '</button></div></section>';
    },

    sectionGenerator(ctx, p, def) {
        const cfg = def.config || {};
        const tpl = cfg.moduleTemplate || {};
        const rand = ctx.plugins.filter(x => x.p.id !== p.id && PluginRuntime.canonicalType(x.p.type) === 'randomizer');
        const srcPairs = [['builtin', I18n.t('不读别的插件（每次生成同样的模块）')]].concat(rand.map(x => [x.p.id, I18n.t('读取「{name}」的结果', { name: x.p.name || x.p.id })]));
        const flowPairs = [['', I18n.t('（选一条流程）')]].concat(ctx.flows.map(f => [f, f === 'main' ? I18n.t('主流程') : ctx.dbg._flowName(f, ctx.m)]));
        if (cfg.outputFlow && ctx.flows.indexOf(cfg.outputFlow) < 0) flowPairs.push([cfg.outputFlow, I18n.t('{id}（不存在）', { id: cfg.outputFlow })]);
        const info = Array.isArray(tpl.info) ? tpl.info.map(x => (x && x.content) || '').filter(Boolean).join('\n') : (tpl.info || '');
        const subPlugins = Array.isArray(tpl.plugins) ? tpl.plugins.length : 0;
        return '<section class="pe-sec"><h5>' + I18n.t('生成的模块') + '</h5>' +
            this.field(I18n.t('生成的模块放到哪条流程'), this.select('data-pf="config.outputFlow"', flowPairs, cfg.outputFlow || '')) +
            this.field(I18n.t('读取什么'), this.select('data-pf="config.inputSource"', srcPairs, cfg.inputSource || 'builtin'), I18n.t('读取随机器时，模块里写的 {{名字}} 会换成结果里同名的内容。')) +
            this.field(I18n.t('模块名称'), '<input type="text" class="pe-in" data-pe-tpl="name" value="' + this.esc(tpl.name || '') + '">') +
            this.field(I18n.t('模块类型'), this.select('data-pe-tpl="type"', this.TEMPLATE_TYPES, tpl.type || 'free_trigger')) +
            this.field(I18n.t('模块的背景'), '<textarea class="pe-in pe-ta" rows="3" data-pe-tpl="info">' + this.esc(info) + '</textarea>') +
            '<div class="pe-hint">' + this.esc(I18n.t('生成的模块里带 {n} 个插件（在「源码」里查看）。', { n: subPlugins })) + '</div></section>';
    },

    sectionSummary(ctx, p, def) {
        return '<section class="pe-sec"><h5>' + I18n.t('总结') + '</h5>' +
            this.field(I18n.t('总结的内容'), this.textareaWithInsert(ctx, 'config.summaryTemplate', def.config.summaryTemplate, 4, false), I18n.t('一段文字，会随提示词发给 AI。用「插入变量」放进变量的当前值。')) + '</section>';
    },

    // ---------- 绑定 ----------
    bind(dbg, side) {
        const box = side.querySelector('#mjx-e-plugins');
        if (!box) return;
        this.dbg = dbg;
        this.box = box;
        box.onclick = (e) => this.onClick(e);
        box.onchange = (e) => this.onChange(e);
        box.oninput = (e) => this.onInput(e);
        box.querySelectorAll('.pe-card').forEach(card => { if (card.querySelector('.pe-body') && !card.querySelector('.pe-body').hidden) this.activate(card); });
        if (this.focusPlugin) {
            const card = box.querySelector('.pe-card[data-pid="' + (window.CSS && CSS.escape ? CSS.escape(this.focusPlugin) : this.focusPlugin) + '"]');
            this.focusPlugin = null;
            if (card) { this.setOpen(card, true); card.scrollIntoView({ block: 'start' }); }
        }
        if (window.FormControls) FormControls.enhance(box);
    },

    ctxOf(card) {
        const dbg = this.dbg;
        const m = dbg.moduleSystem.getModule(dbg._selId);
        return { ctx: this.ctxFor(dbg, m), m, p: m.plugins[Number(card.getAttribute('data-pi'))], i: Number(card.getAttribute('data-pi')) };
    },

    setOpen(card, open) {
        const { ctx, m, p, i } = this.ctxOf(card);
        const key = m.id + '|' + p.id;
        this.openCards[key] = open;
        const body = card.querySelector('.pe-body');
        card.querySelector('.pe-toggle').setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) {
            body.innerHTML = this.body(ctx, p, i, PluginRuntime.normalize(p));
            body.hidden = false;
            if (window.FormControls) FormControls.enhance(body);
            this.activate(card);
        } else {
            body.hidden = true;
            this.destroyPreview(p.id);
            body.innerHTML = '';
        }
    },

    /** 展开后的初始化：读文件内容填进文本框、挂条件编辑器、预览、检查问题 */
    activate(card) {
        const { ctx, m, p } = this.ctxOf(card);
        const def = PluginRuntime.normalize(p);
        this.refreshSource(card, p);
        this.mountCondition(card, ctx, p, def);
        this.fillDocs(card, ctx, p, def).then(() => { this.refreshDetected(card); this.refreshPreview(card); });
        if (def.type === 'randomizer') this.fillPool(card, ctx, p, def);
        this.refreshIssues(card);
    },

    destroyPreview(pid) { const inst = this.previews.get(pid); if (inst) { try { inst.destroy(); } catch (e) { /* 已经移除 */ } this.previews.delete(pid); } },

    refreshSource(card, p) {
        const t = card.querySelector('[data-pe-src]');
        if (t) t.value = JSON.stringify(p, null, 2);
    },

    mountCondition(card, ctx, p, def) {
        const host = card.querySelector('[data-pe-cond-host]');
        if (!host || typeof ConditionBuilder === 'undefined') return;
        const conds = def.condition && def.condition.conditionDef ? def.condition.conditionDef : { logic: 'OR', groups: [] };
        const mods = ctx.mods.map(x => ({ id: x.id, name: x.name }));
        ConditionBuilder.mount(host, conds, {
            variables: ctx.vars, modules: mods,
            onChange: (value) => { this.mutate(card, (pp) => { pp.condition = { type: 'precondition', conditionDef: value || { logic: 'OR', groups: [] } }; }, false); }
        });
    },

    async fillDocs(card, ctx, p, def) {
        const jobs = [];
        const put = (sel, text, flagKey) => {
            const ta = card.querySelector(sel);
            if (!ta || ta.dataset.touched === '1' || ta.value) return;
            ta.value = text;
        };
        const read = async (file, label) => {
            const r = await PluginRenderer.fetchText((ctx.modulePath ? ctx.modulePath.replace(/\/+$/, '') + '/' : '') + file, label, this.cache);
            return r.text || '';
        };
        if (!def.inlineHtml && def.files.display) jobs.push(read(def.files.display, I18n.t('显示文件')).then(t => put('[data-pe-doc="html"]', t)));
        if (!def.inlineStyle && def.files.style) jobs.push(read(def.files.style, I18n.t('样式文件')).then(t => put('[data-pe-doc="css"]', t)));
        if (def.files.logic) jobs.push(read(def.files.logic, I18n.t('脚本文件')).then(t => { card._logicText = t; }));
        await Promise.all(jobs);
    },

    async fillPool(card, ctx, p, def) {
        const ta = card.querySelector('[data-pe-pool]');
        if (!ta) return;
        let text = '';
        if (def.config.pool) text = JSON.stringify(def.config.pool, null, 2);
        else if (def.files.pool) {
            const r = await PluginRenderer.fetchText((ctx.modulePath ? ctx.modulePath.replace(/\/+$/, '') + '/' : '') + def.files.pool, I18n.t('随机池文件'), this.cache);
            text = r.text || '';
        }
        if (ta.dataset.touched !== '1') ta.value = text;
        this.checkPool(card, ta.value);
    },

    checkPool(card, text) {
        const msg = card.querySelector('[data-pe-poolmsg]');
        if (!msg) return null;
        if (!String(text).trim()) { msg.textContent = I18n.t('还没有随机池。'); msg.className = 'pe-hint pe-bad'; return null; }
        try {
            const v = JSON.parse(text);
            const list = Array.isArray(v) ? v : (v && (v.items || v.events || v.entries)) || null;
            msg.textContent = Array.isArray(list) ? I18n.t('格式正确，共 {n} 项。', { n: list.length }) : I18n.t('格式正确。');
            msg.className = 'pe-hint';
            return v;
        } catch (e) {
            msg.textContent = I18n.t('格式不对：{error}。修好之前不会保存这次修改。', { error: e.message });
            msg.className = 'pe-hint pe-bad';
            return null;
        }
    },

    refreshDetected(card) {
        const { ctx, p } = this.ctxOf(card);
        const def = PluginRuntime.normalize(p);
        const html = (card.querySelector('[data-pe-doc="html"]') || {}).value || def.inlineHtml || '';
        const css = (card.querySelector('[data-pe-doc="css"]') || {}).value || def.inlineStyle || '';
        const det = card.querySelector('[data-pe-detected]');
        if (det) {
            const s = PluginRuntime.scanBindings(html, css);
            const ids = s.placeholders.concat(s.binds.filter(k => s.placeholders.indexOf(k) < 0));
            det.innerHTML = this.chips(ctx, ids);
        }
        const act = card.querySelector('[data-pe-actions]');
        if (act && !act.contains(document.activeElement)) {
            def.inlineHtml = html;
            def.logicText = card._logicText || '';
            act.innerHTML = this.actionsHtml(ctx, p, def);
            if (window.FormControls) FormControls.enhance(act);
        }
    },

    refreshPreview(card) {
        const host = card.querySelector('[data-pe-preview]');
        if (!host) return;
        const { ctx, m, p } = this.ctxOf(card);
        this.destroyPreview(p.id);
        host.innerHTML = '';
        const html = (card.querySelector('[data-pe-doc="html"]') || {}).value || '';
        const css = (card.querySelector('[data-pe-doc="css"]') || {}).value || '';
        const msg = card.querySelector('[data-pe-prevmsg]');
        if (msg) msg.textContent = '';
        if (!html.trim()) { if (msg) msg.textContent = I18n.t('还没有页面内容。'); return; }
        const w = (card.querySelector('[data-pe-prevw]') || {}).value || '390';
        host.style.maxWidth = w === '0' ? '' : w + 'px';
        const def = PluginRuntime.normalize(p);
        const vs = ctx.dbg.variableSystem;
        const face = PluginRenderer.makeFace(def, { modulePath: ctx.modulePath, cache: this.cache, getValue: id => (vs ? vs.getValue(id) : undefined) });
        face.loadDoc = () => { face.doc = { html, css, js: card._logicText || '' }; return Promise.resolve(face.doc); };
        const inst = PluginRenderer.mount(host, face, { onNotice: (t) => { if (msg) msg.textContent = t; } });
        this.previews.set(p.id, inst);
    },

    refreshIssues(card) {
        const { ctx, m, p } = this.ctxOf(card);
        const def = PluginRuntime.normalize(p);
        PluginRenderer.loadFiles(def, { modulePath: ctx.modulePath, cache: this.cache }).then(files => {
            const flowNames = ctx.flows;
            const env = {
                hasVariable: id => ctx.vars.some(v => v.id === id) || (def.config && def.config.tempStorage === id),
                variableName: id => this.varName(ctx, id),
                flowNames, siblingIds: ctx.plugins.map(x => x.p.id), moduleIds: (m.plugins || []).map(x => x && x.id), ownerExists: true, files
            };
            const issues = PluginRuntime.validate(def, env);
            const box = card.querySelector('[data-pe-issues]');
            if (box) box.innerHTML = issues.length ? '<section class="pe-sec pe-sec-warn"><h5>' + this.esc(I18n.t('需要处理的问题（{n}）', { n: issues.length })) + '</h5>' + issues.map(i => '<div class="pe-issue"><div>' + this.esc(i.text) + '</div>' + (i.hint ? '<div class="pe-hint">' + this.esc(i.hint) + '</div>' : '') + '</div>').join('') + '</section>' : '';
            const badge = card.querySelector('[data-pe-badge]');
            if (badge) badge.textContent = issues.filter(i => i.level === 'error').length ? I18n.t('{n} 个问题', { n: issues.filter(i => i.level === 'error').length }) : '';
        });
    },

    // ---------- 修改模型 ----------
    /** 修改一个插件。structural 为 true 时整块重画（类型、增删行这类会改变界面的修改）。 */
    mutate(card, fn, structural) {
        const { ctx, m, p, i } = this.ctxOf(card);
        const dbg = this.dbg;
        const now = Date.now();
        if (now - this._lastCheckpoint > 2500) { dbg._meEditor().checkpoint(); this._lastCheckpoint = now; }
        fn(p, ctx, m);
        this.refreshSource(card, p);
        if (structural) {
            this._lastCheckpoint = 0;
            this.rerenderCard(card);
            dbg._meAfterEdit({ panel: false });
        } else {
            clearTimeout(this._timer);
            this._timer = setTimeout(() => { dbg._meAfterEdit({ panel: false }); this.refreshIssues(card); }, 400);
        }
    },

    rerenderCard(card) {
        const { ctx, m, p, i } = this.ctxOf(card);
        const fresh = document.createElement('div');
        fresh.innerHTML = this.card(ctx, p, i);
        const next = fresh.firstElementChild;
        this.destroyPreview(p.id);
        card.parentNode.replaceChild(next, card);
        if (window.FormControls) FormControls.enhance(next);
        if (!next.querySelector('.pe-body').hidden) this.activate(next);
        return next;
    },

    setPath(obj, path, value) {
        const keys = path.split('.');
        let o = obj;
        for (let k = 0; k < keys.length - 1; k++) {
            if (o[keys[k]] == null || typeof o[keys[k]] !== 'object') o[keys[k]] = {};
            o = o[keys[k]];
        }
        o[keys[keys.length - 1]] = value;
    },

    getAction(p, name, create) {
        p.config = p.config || {};
        if (!Array.isArray(p.config.actions)) p.config.actions = [];
        let a = p.config.actions.find(x => x && x.action === name);
        if (!a && create) { a = { action: name, label: name, ops: [] }; p.config.actions.push(a); }
        return a;
    },

    // ---------- 事件 ----------
    onInput(e) {
        const t = e.target;
        const card = t.closest('.pe-card');
        if (!card) return;
        if (t.matches('[data-pe-doc]')) {
            t.dataset.touched = '1';
            const kind = t.getAttribute('data-pe-doc');
            this.mutate(card, (p) => { p[kind === 'html' ? 'inlineHtml' : 'inlineStyle'] = t.value; }, false);
            clearTimeout(this._prevTimer);
            this._prevTimer = setTimeout(() => { this.refreshDetected(card); this.refreshPreview(card); }, 450);
            return;
        }
        if (t.matches('[data-pe-pool]')) {
            t.dataset.touched = '1';
            const v = this.checkPool(card, t.value);
            if (v !== null) this.mutate(card, (p) => { p.config = p.config || {}; p.config.pool = v; }, false);
            return;
        }
        if (t.matches('[data-pe-bf]')) { this.blockEdit(card, t); return; }
        if (t.matches('[data-pf]') && t.tagName !== 'SELECT' && t.type !== 'checkbox') this.applyField(card, t);
        else if (t.matches('[data-pe-opv]')) this.applyOpField(card, t);
        else if (t.matches('[data-pe-send]')) { const an = t.closest('[data-pe-an]').getAttribute('data-pe-an'); this.mutate(card, (p) => { const a = this.getAction(p, an, true); a.send = t.value; }, false); }
        else if (t.matches('[data-pe-tmap]')) { const k = Number(t.closest('[data-tk]').getAttribute('data-tk')); this.mutate(card, (p) => { p.config.targetVariables[k].mapping = t.value; }, false); }
        else if (t.matches('[data-pe-tpl]')) this.applyTemplateField(card, t);
    },

    onChange(e) {
        const t = e.target;
        const card = t.closest('.pe-card');
        if (!card) return;
        if (t.matches('[data-pe-ins]')) { this.insertInto(card, t); return; }
        if (t.matches('[data-pe-bf]')) { this.blockEdit(card, t); return; }
        if (t.matches('[data-pe-blk-add]')) { if (t.value) { const type = t.value; this.applyBlocks(card, (blocks) => { blocks.push(PluginPageBuilder.newBlock(type)); }, true); } return; }
        if (t.matches('[data-pe-pagemode]')) { this.switchPageMode(card, t.value); return; }
        if (t.matches('[data-pe-file]')) { this.importFile(card, t); return; }
        if (t.matches('[data-pe-prevw]')) { this.refreshPreview(card); return; }
        if (t.matches('[data-pe-attach]')) { this.moveTo(card, t.value); return; }
        if (t.matches('[data-pe-cond]')) {
            const host = card.querySelector('[data-pe-cond-host]');
            host.hidden = t.value === 'always';
            this.mutate(card, (p) => { p.condition = t.value === 'always' ? { type: 'always' } : { type: 'precondition', conditionDef: (p.condition && p.condition.conditionDef) || { logic: 'OR', groups: [] } }; }, false);
            if (t.value !== 'always') { const { ctx, p } = this.ctxOf(card); this.mountCondition(card, ctx, p, PluginRuntime.normalize(p)); }
            return;
        }
        if (t.matches('[data-pe-req-add]')) {
            if (!t.value) return;
            const id = t.value;
            this.mutate(card, (p) => { p.config = p.config || {}; const r = Array.isArray(p.config.requiredVariables) ? p.config.requiredVariables : (p.config.requiredVariables = []); if (r.indexOf(id) < 0) r.push(id); }, true);
            return;
        }
        if (t.matches('[data-pe-sendmode]')) {
            const an = t.closest('[data-pe-an]').getAttribute('data-pe-an');
            const mode = t.value;
            this.mutate(card, (p) => { const a = this.getAction(p, an, true); a.sendMode = mode; if (mode === 'custom' && a.send == null) a.send = ''; if (mode !== 'custom') delete a.send; }, true);
            return;
        }
        if (t.matches('[data-pe-opvar], [data-pe-opop]')) { this.applyOpField(card, t); return; }
        if (t.matches('[data-pe-tvar]')) { const k = Number(t.closest('[data-tk]').getAttribute('data-tk')); this.mutate(card, (p) => { p.config.targetVariables[k].variableId = t.value; }, false); return; }
        if (t.matches('[data-pe-tpl]')) { this.applyTemplateField(card, t); return; }
        if (t.matches('[data-pf]')) this.applyField(card, t);
    },

    applyField(card, t) {
        const path = t.getAttribute('data-pf');
        const kind = t.getAttribute('data-kind');
        let value = t.value;
        if (kind === 'bool') value = !!t.checked;
        const structural = t.hasAttribute('data-pe-struct') || t.hasAttribute('data-struct');
        if (path === 'config.blockId' && value && !PluginRuntime.BLOCK_ID_RE.test(value)) { t.classList.add('pe-bad'); return; }
        t.classList.remove('pe-bad');
        this.mutate(card, (p) => {
            this.setPath(p, path, value);
            if (path === 'name') { const n = card.querySelector('.pe-name'); if (n) n.textContent = value || I18n.t('未命名插件'); }
            if (path === 'config.replyBinding.variableId') {
                if (!value) { delete p.config.replyBinding; }
                else { p.config.replyBinding.mode = p.config.replyBinding.mode || 'set'; p.config.replyBinding.prefix = p.config.replyBinding.prefix || ''; }
            }
            if (path === 'config.tempStorage' && !value) delete p.config.tempStorage;
            if (path === 'config.side' && !value) delete p.config.side;
        }, structural);
    },

    /** 改内容块列表，并用它重新生成页面内容 */
    applyBlocks(card, fn, structural) {
        this.mutate(card, (p) => {
            p.config = p.config || {};
            p.config.pageMode = 'build';
            if (!Array.isArray(p.config.pageBlocks)) p.config.pageBlocks = [];
            fn(p.config.pageBlocks, p);
            const out = PluginPageBuilder.build(p.config.pageBlocks);
            p.inlineHtml = out.html;
            p.inlineStyle = out.css;
        }, structural);
        if (structural) return;
        this.refreshBlockHints(card);
        const { p } = this.ctxOf(card);
        const h = card.querySelector('[data-pe-doc="html"]');
        const c = card.querySelector('[data-pe-doc="css"]');
        if (h) h.value = p.inlineHtml || '';
        if (c) c.value = p.inlineStyle || '';
        clearTimeout(this._prevTimer);
        this._prevTimer = setTimeout(() => { this.refreshDetected(card); this.refreshPreview(card); }, 450);
    },

    /** 输入过程中就地更新每个内容块下面的「还缺什么」提示，不重画输入框 */
    refreshBlockHints(card) {
        const { p } = this.ctxOf(card);
        const blocks = (p.config && p.config.pageBlocks) || [];
        const probs = PluginPageBuilder.problems(blocks);
        card.querySelectorAll('.pe-blk').forEach((el, k) => {
            el.querySelectorAll(':scope > .pe-bad').forEach(n => n.remove());
            probs.filter(x => x.index === k).forEach(x => {
                const d = document.createElement('div');
                d.className = 'pe-hint pe-bad';
                d.textContent = x.text;
                el.appendChild(d);
            });
        });
    },

    blockEdit(card, t) {
        const k = Number(t.closest('[data-bk]').getAttribute('data-bk'));
        const f = t.getAttribute('data-pe-bf');
        const v = f === 'max' ? (t.value === '' ? '' : Number(t.value)) : t.value;
        this.applyBlocks(card, (blocks) => { if (blocks[k]) blocks[k][f] = v; }, f === 'variableId');
    },

    async switchPageMode(card, mode) {
        const { p } = this.ctxOf(card);
        const def = PluginRuntime.normalize(p);
        if (mode === this.pageMode(def)) return;
        if (mode === 'build') {
            const hasContent = !!(def.inlineHtml || def.files.display);
            if (hasContent && !(window.Modal && await Modal.confirm(I18n.t('改用点选搭建'), I18n.t('现在的页面内容会被替换，可以撤销。'), { danger: true, confirmLabel: I18n.t('替换') }))) {
                this.rerenderCard(card);
                return;
            }
            this.mutate(card, (pp) => { pp.config = pp.config || {}; pp.config.pageMode = 'build'; pp.config.pageBlocks = []; pp.inlineHtml = ''; pp.inlineStyle = ''; }, true);
        } else {
            this.mutate(card, (pp) => { pp.config = pp.config || {}; pp.config.pageMode = 'custom'; delete pp.config.pageBlocks; }, true);
        }
    },

    applyOpField(card, t) {
        const row = t.closest('.pe-oprow');
        const k = Number(row.getAttribute('data-ok'));
        const kind = row.getAttribute('data-pe-kind');
        const isVarOrOp = t.matches('[data-pe-opvar], [data-pe-opop]');
        this.mutate(card, (p) => {
            let o;
            if (kind === 'op') { p.config = p.config || {}; o = (p.config.operations || [])[k]; }
            else { const an = row.closest('[data-pe-an]').getAttribute('data-pe-an'); const a = this.getAction(p, an, true); o = (a.ops || (a.ops = []))[k]; }
            if (!o) return;
            if (t.matches('[data-pe-opvar]')) { o.variableId = t.value; o.op = this.opsFor(this.varType(this.ctxOf(card).ctx, t.value))[0]; o.value = ''; }
            else if (t.matches('[data-pe-opop]')) { o.op = t.value; }
            else o.value = t.value;
        }, isVarOrOp);
    },

    applyTemplateField(card, t) {
        const key = t.getAttribute('data-pe-tpl');
        this.mutate(card, (p) => {
            p.config = p.config || {};
            const tpl = p.config.moduleTemplate || (p.config.moduleTemplate = { id: 'gen_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: '', type: 'free_trigger', plugins: [], flows: { main: { entryEvent: null, subModules: [] } } });
            if (key === 'info') tpl.info = t.value ? [{ content: t.value, condition: null }] : [];
            else tpl[key] = t.value;
        }, false);
    },

    insertInto(card, sel) {
        const value = sel.value;
        if (!value) return;
        const target = card.querySelector('[data-uid="' + sel.getAttribute('data-pe-ins') + '"]');
        sel.value = '';
        if (!target) return;
        const start = target.selectionStart == null ? target.value.length : target.selectionStart;
        const end = target.selectionEnd == null ? target.value.length : target.selectionEnd;
        target.value = target.value.slice(0, start) + value + target.value.slice(end);
        const pos = start + value.length;
        try { target.setSelectionRange(pos, pos); } catch (e) { /* 数字框没有光标位置 */ }
        target.focus();
        target.dispatchEvent(new Event('input', { bubbles: true }));
    },

    async importFile(card, input) {
        const file = input.files && input.files[0];
        input.value = '';
        if (!file) return;
        let text;
        try { text = await file.text(); } catch (e) { if (window.Toast) Toast.show(I18n.t('读取文件失败。'), 'error'); return; }
        const kind = input.getAttribute('data-pe-file');
        const ta = kind === 'pool' ? card.querySelector('[data-pe-pool]') : card.querySelector('[data-pe-doc="' + kind + '"]');
        if (!ta) return;
        ta.value = text;
        ta.dataset.touched = '1';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
    },

    moveTo(card, targetId) {
        const { m, p, i } = this.ctxOf(card);
        const dbg = this.dbg;
        const target = dbg.moduleSystem.getModule(targetId);
        if (!target || target.id === m.id) return;
        dbg._meEditor().checkpoint();
        const [moved] = m.plugins.splice(i, 1);
        if (!Array.isArray(target.plugins)) target.plugins = [];
        target.plugins.push(moved);
        this.openCards[target.id + '|' + moved.id] = true;
        dbg._meSel = target.id;
        dbg._selId = target.id;
        dbg._meAfterEdit();
        if (window.Toast) Toast.show(I18n.t('已移到「{name}」。', { name: target.name || I18n.t('未命名') }), 'success');
    },

    onClick(e) {
        const b = e.target.closest('[data-pe]');
        if (!b || !this.box.contains(b)) return;
        const card = b.closest('.pe-card');
        const act = b.getAttribute('data-pe');
        if (!card) return;
        const dbg = this.dbg;
        const delText = this.DELETE_TEXT[act];
        if (delText) this._lastCheckpoint = 0;
        switch (act) {
            case 'toggle': this.setOpen(card, b.getAttribute('aria-expanded') !== 'true'); break;
            case 'del': this.remove(card); break;
            case 'test': this.openTest(card); break;
            case 'import-html': card.querySelector('[data-pe-file="html"]').click(); break;
            case 'import-css': card.querySelector('[data-pe-file="css"]').click(); break;
            case 'import-pool': card.querySelector('[data-pe-file="pool"]').click(); break;
            case 'blk-up': case 'blk-down': case 'blk-del': {
                const k = Number(b.closest('[data-bk]').getAttribute('data-bk'));
                this.applyBlocks(card, (blocks) => {
                    if (act === 'blk-del') blocks.splice(k, 1);
                    else { const j = act === 'blk-up' ? k - 1 : k + 1; if (j >= 0 && j < blocks.length) { const x = blocks[k]; blocks[k] = blocks[j]; blocks[j] = x; } }
                }, true);
                break;
            }
            case 'req-del': { const k = Number(b.getAttribute('data-ri')); this.mutate(card, (p) => { p.config.requiredVariables.splice(k, 1); }, true); break; }
            case 'act-del': { const an = b.closest('[data-pe-an]').getAttribute('data-pe-an'); this.mutate(card, (p) => { p.config.actions = (p.config.actions || []).filter(x => x.action !== an); }, true); break; }
            case 'act-op-add': { const an = b.closest('[data-pe-an]').getAttribute('data-pe-an'); this.mutate(card, (p) => { const a = this.getAction(p, an, true); (a.ops || (a.ops = [])).push({ variableId: '', op: 'set', value: '' }); }, true); break; }
            case 'op-add': this.mutate(card, (p) => { p.config = p.config || {}; (p.config.operations || (p.config.operations = [])).push({ variableId: '', op: 'set', value: '' }); }, true); break;
            case 'op-del': {
                const row = b.closest('.pe-oprow');
                const k = Number(row.getAttribute('data-ok'));
                const kind = row.getAttribute('data-pe-kind');
                this.mutate(card, (p) => {
                    if (kind === 'op') p.config.operations.splice(k, 1);
                    else { const an = row.closest('[data-pe-an]').getAttribute('data-pe-an'); this.getAction(p, an, true).ops.splice(k, 1); }
                }, true);
                break;
            }
            case 'tv-add': this.mutate(card, (p) => { p.config = p.config || {}; (p.config.targetVariables || (p.config.targetVariables = [])).push({ variableId: '', mapping: '' }); }, true); break;
            case 'tv-del': { const k = Number(b.closest('[data-tk]').getAttribute('data-tk')); this.mutate(card, (p) => { p.config.targetVariables.splice(k, 1); }, true); break; }
            default: break;
        }
        if (delText && window.Toast && Toast.undo) Toast.undo(delText, () => dbg._meUndo());
    },

    remove(card) {
        const { m, p, i } = this.ctxOf(card);
        const dbg = this.dbg;
        dbg._meEditor().checkpoint();
        const nm = p.name || I18n.t('插件');
        this.destroyPreview(p.id);
        m.plugins.splice(i, 1);
        dbg._meAfterEdit();
        if (window.Toast && Toast.undo) Toast.undo(I18n.t('已删除插件「{name}」。', { name: nm }), () => dbg._meUndo());
    },

    openTest(card) {
        const { m, p } = this.ctxOf(card);
        if (window.PluginTester) PluginTester.sel = m.id + '|' + p.id;
        if (window.App && App.switchDebugTab) App.switchDebugTab('plugin-test');
    },

    /** 新增一个空插件（类型默认显示器，之后在卡片里改类型、填内容） */
    add(dbg) {
        const ms = dbg.moduleSystem;
        const m = ms && ms.getModule ? ms.getModule(dbg._selId) : null;
        if (!m) { if (window.Toast) Toast.show(I18n.t('没有选中事件。'), 'error'); return; }
        if (!Array.isArray(m.plugins)) m.plugins = [];
        dbg._meEditor().checkpoint();
        const id = 'plugin_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        m.plugins.push({ id, name: I18n.t('新插件'), type: 'display', condition: { type: 'always' }, config: {}, files: {} });
        this.openCards[m.id + '|' + id] = true;
        dbg._meAfterEdit();
    }
};

window.PluginEditor = PluginEditor;
