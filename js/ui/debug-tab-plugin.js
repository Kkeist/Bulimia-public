/**
 * 调试页「插件测试」标签。
 * 不写任何代码就能测：选一个插件 → 改测试变量 → 点按钮 / 点「运行」/「模拟 AI 回复」→ 看到真实渲染的页面、
 * 改了哪些变量（前后对比）、发给 AI 的内容、暂存的操作。
 * 测试在一份独立的变量副本上进行，不会改动正在玩的游戏；运行逻辑与游戏里完全相同（PluginRuntime / PluginSystem / PluginRenderer）。
 * 扩展 DebugModuleJump（debug-module-jump.js 先加载）。
 */
const PluginTester = {
    sessions: {},
    widths: [['320', '手机窄屏'], ['390', '手机'], ['600', '平板'], ['0', '占满']],

    esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); },

    fmt(v) {
        if (v === undefined || v === null || v === '') return '空';
        const s = PluginRuntime.formatValue(v);
        return s === '' ? '空' : s;
    },

    // ---------- 变量副本 ----------
    /** 复制一份变量系统：包含当前所有变量与取值，改它不影响游戏 */
    cloneVariableSystem(vs) {
        const copy = new VariableSystem();
        if (vs.conditionEvaluator) copy.setConditionEvaluator(vs.conditionEvaluator);
        vs.variables.forEach((v, id) => {
            const cfg = {
                id, name: v.name, type: v.type, category: v.category,
                initialValue: v.value === undefined ? null : JSON.parse(JSON.stringify(v.value)),
                readonly: v.readonly, generalRules: v.generalRules, changeRules: v.changeRules,
                supportedOperations: v.supportedOperations, switchConditions: v.switchConditions,
                computeConditions: v.computeConditions, listItemType: v.listItemType, objectSchema: v.objectSchema
            };
            copy.registerVariable(new Variable(cfg, v.ownerModuleId));
        });
        return copy;
    },

    // ---------- 数据：所有插件 ----------
    allPlugins(dbg) {
        const ms = dbg.moduleSystem;
        const out = [];
        if (!ms || !ms.rootModuleId) return out;
        const seen = new Set();
        const add = (p, m, extra) => {
            const key = m.id + '|' + p.id;
            if (seen.has(key)) return;
            seen.add(key);
            out.push(Object.assign({ p, modId: m.id, modName: m.name || m.id, flow: m.flowName || 'main', key }, extra || {}));
        };
        const visit = (m) => {
            if (!m) return;
            (Array.isArray(m.plugins) ? m.plugins : []).forEach(p => {
                if (!p || !p.id) return;
                add(p, m);
                // 生成器模板里自带的插件：动态生成的模块里才有，也列出来方便测试
                if (p.type === 'module_generator' && p.config && p.config.moduleTemplate && Array.isArray(p.config.moduleTemplate.plugins)) {
                    const tpl = p.config.moduleTemplate;
                    p.config.moduleTemplate.plugins.forEach(sp => {
                        if (!sp || !sp.id) return;
                        add(sp, m, { modName: (tpl.name || tpl.id || '生成的模块') + '（由「' + (p.name || p.id) + '」生成）', isDynamic: true, dynamicOwnerName: tpl.name || tpl.id, flow: p.config.outputFlow || 'main' });
                    });
                }
            });
            if (m.getAllSubModules) Array.from(m.getAllSubModules()).forEach(visit);
        };
        visit(ms.getModule(ms.rootModuleId));
        return out;
    },

    // ---------- 会话 ----------
    session(dbg, entry) {
        let s = this.sessions[entry.key];
        const rawSig = PluginRuntime.safeStringify(entry.p);
        if (s && s.sig === rawSig) return s;
        if (s && s.inst) { try { s.inst.destroy(); } catch (e) { /* 已经移除 */ } }
        s = {
            key: entry.key, entry, sig: rawSig,
            vs: this.cloneVariableSystem(dbg.variableSystem),
            pending: [], log: [], sys: null, plugin: null, inst: null, face: null,
            base: PluginRenderer.fullVarSnapshot(dbg.variableSystem),
            width: '390', actionText: {}, replyText: null, notes: []
        };
        this.sessions[entry.key] = s;
        return s;
    },

    reset(dbg, entry) {
        const s = this.sessions[entry.key];
        if (s && s.inst) { try { s.inst.destroy(); } catch (e) { /* 已经移除 */ } }
        delete this.sessions[entry.key];
    },

    /** 会话里的运行系统：把全部插件按真实方式登记，文件读取好 */
    async ensureSystem(dbg, s, list) {
        if (s.sys) return s.sys;
        const sys = new PluginSystem();
        sys.setConditionEvaluator(dbg.conditionEvaluator);
        sys.setBaseModulePath(dbg.modulePath);
        list.forEach(x => sys.registerPlugin(x.p, x.modId));
        await sys.loadAllFiles();
        s.sys = sys;
        s.plugin = sys.getPlugin(s.entry.p.id, s.entry.modId);
        return sys;
    },

    store(s) { return PluginRuntime.storeFromVariableSystem(s.vs); },

    diffSinceStart(s) {
        const rows = [];
        const cur = PluginRenderer.fullVarSnapshot(s.vs);
        Object.keys(cur).forEach(id => {
            if (PluginRuntime.safeStringify(cur[id]) !== PluginRuntime.safeStringify(s.base[id])) {
                const v = s.vs.getVariable(id);
                rows.push({ id, name: (v && v.name) || id, before: s.base[id], after: cur[id] });
            }
        });
        return rows;
    },

    // ---------- 变量输入控件 ----------
    varControl(s, id) {
        const esc = this.esc;
        const v = s.vs.getVariable(id);
        const type = (v && v.type) || 'string';
        const cur = s.vs.getValue(id);
        const attr = 'data-plvar="' + esc(id) + '" data-vt="' + esc(type) + '"';
        const locked = v && (v.category === 'builtin' || v.readonly) ? ' disabled' : '';
        if (type === 'boolean' || type === 'switch') return '<label class="pl-switch"><input type="checkbox" ' + attr + (cur === true ? ' checked' : '') + locked + '><span>' + (cur === true ? '开' : '关') + '</span></label>';
        if (type === 'number') return '<input type="number" step="any" class="pl-in" ' + attr + ' value="' + esc(typeof cur === 'number' ? cur : '') + '"' + locked + '>';
        if (type === 'list' || type === 'list_of_object') {
            const txt = (Array.isArray(cur) ? cur : []).map(x => typeof x === 'object' ? PluginRuntime.safeStringify(x) : String(x)).join('\n');
            return '<textarea class="pl-in pl-ta" rows="3" ' + attr + ' placeholder="每行一项"' + locked + '>' + esc(txt) + '</textarea>';
        }
        if (type === 'object') return '<textarea class="pl-in pl-ta" rows="3" ' + attr + locked + '>' + esc(cur && typeof cur === 'object' ? JSON.stringify(cur, null, 2) : '') + '</textarea>';
        const sv = cur == null || typeof cur === 'object' ? '' : String(cur);
        if (sv.indexOf('\n') >= 0 || sv.length > 50) return '<textarea class="pl-in pl-ta" rows="3" ' + attr + locked + '>' + esc(sv) + '</textarea>';
        return '<input type="text" class="pl-in" ' + attr + ' value="' + esc(sv) + '"' + locked + '>';
    },

    readControl(el) {
        const type = el.getAttribute('data-vt');
        if (type === 'boolean' || type === 'switch') return !!el.checked;
        if (type === 'number') { const n = Number(el.value); return el.value.trim() === '' || !isFinite(n) ? null : n; }
        if (type === 'list' || type === 'list_of_object') return el.value.split('\n').map(x => x.trim()).filter(Boolean).map(x => { try { return JSON.parse(x); } catch (e) { return x; } });
        if (type === 'object') { try { const o = JSON.parse(el.value || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : null; } catch (e) { return null; } }
        return el.value;
    },

    // ---------- 页面 ----------
    render(dbg) {
        const box = document.querySelector('#debug-panel-plugin-test .plugin-tester') || document.getElementById('debug-panel-plugin-test');
        if (!box) return;
        this.dbg = dbg;
        const list = this.allPlugins(dbg);
        this.list = list;
        if (!list.length) { box.innerHTML = '<div class="mjx"><div class="mjx-empty">还没有加载模组，或这个模组没有插件。</div></div>'; return; }
        if (!this.sel || !list.find(x => x.key === this.sel)) this.sel = list[0].key;
        if (!this.collapsed) this.collapsed = {};
        const esc = this.esc;
        const byMod = {};
        const order = [];
        list.forEach(x => { if (!byMod[x.modId + '|' + (x.isDynamic ? x.modName : '')]) { byMod[x.modId + '|' + (x.isDynamic ? x.modName : '')] = { name: x.modName, items: [] }; order.push(x.modId + '|' + (x.isDynamic ? x.modName : '')); } byMod[x.modId + '|' + (x.isDynamic ? x.modName : '')].items.push(x); });
        let tree = '<div class="pl-tree">';
        order.forEach(k => {
            const g = byMod[k];
            tree += '<div class="pl-group"><button type="button" class="pl-group-head" data-plcol="' + esc(k) + '" aria-expanded="' + (this.collapsed[k] ? 'false' : 'true') + '">' + esc(g.name) + '</button>' +
                '<div class="pl-group-body"' + (this.collapsed[k] ? ' hidden' : '') + '>' +
                g.items.map(x => '<button type="button" class="pl-leaf' + (x.key === this.sel ? ' on' : '') + '" data-plsel="' + esc(x.key) + '"><span class="pl-leaf-name">' + esc(x.p.name || '未命名插件') + '</span>' +
                    '<span class="pl-leaf-type">' + esc(PluginRuntime.typeLabel(x.p.type)) + '<span class="pl-leaf-issue" data-plissue="' + esc(x.key) + '"></span></span></button>').join('') + '</div></div>';
        });
        tree += '</div>';
        box.innerHTML = '<div class="mjx pl-root"><div class="pl-wrap"><div class="pl-left">' + tree + '</div><div class="pl-right" id="pl-right"></div></div></div>';
        box.querySelectorAll('[data-plsel]').forEach(b => b.addEventListener('click', () => {
            this.sel = b.getAttribute('data-plsel');
            box.querySelectorAll('[data-plsel]').forEach(x => x.classList.toggle('on', x === b));
            this.renderRight();
        }));
        box.querySelectorAll('[data-plcol]').forEach(h => h.addEventListener('click', () => {
            const k = h.getAttribute('data-plcol');
            this.collapsed[k] = !this.collapsed[k];
            h.setAttribute('aria-expanded', this.collapsed[k] ? 'false' : 'true');
            h.nextElementSibling.hidden = !!this.collapsed[k];
        }));
        this.renderRight();
        this.markIssues(box, list);
    },

    /** 读好各插件的文件后，在列表里标出有问题的插件 */
    async markIssues(box, list) {
        const sys = new PluginSystem();
        sys.setBaseModulePath(this.dbg.modulePath);
        list.forEach(x => sys.registerPlugin(x.p, x.modId));
        await sys.loadAllFiles();
        if (!box.isConnected) return;
        list.forEach(x => {
            const n = this.validate(this.dbg, x, list, sys.getPlugin(x.p.id, x.modId)).filter(i => i.level === 'error').length;
            const el = box.querySelector('[data-plissue="' + (window.CSS && CSS.escape ? CSS.escape(x.key) : x.key) + '"]');
            if (el) el.textContent = n ? ' · ' + n + ' 个问题' : '';
        });
    },

    /** 对一条插件做配置检查（缺文件、变量不存在、流程不存在等），每条带「哪里有问题、怎么处理」 */
    validate(dbg, entry, list, plugin) {
        const ms = dbg.moduleSystem;
        const vs = dbg.variableSystem;
        const mod = ms.getModule(entry.modId);
        const own = plugin || null;
        const flowNames = Object.keys((mod && mod.flows) || {});
        if (mod && mod.subModules && mod.subModules.forEach) mod.subModules.forEach((v, k) => { if (flowNames.indexOf(k) < 0) flowNames.push(k); });
        if (flowNames.indexOf('main') < 0) flowNames.push('main');
        const env = {
            hasVariable: id => !!(vs && vs.getVariable(id)) || (entry.p.config && entry.p.config.tempStorage === id),
            variableName: id => { const v = vs && vs.getVariable(id); return (v && v.name) || id; },
            flowNames: entry.isDynamic ? undefined : flowNames,
            siblingIds: list.map(x => x.p.id),
            moduleIds: entry.isDynamic ? undefined : ((mod && mod.plugins) || []).map(x => x && x.id),
            ownerExists: !!mod,
            files: own ? own.fileReport() : {}
        };
        return PluginRuntime.validate(PluginRuntime.normalize(entry.p), env);
    },

    async renderRight() {
        const dbg = this.dbg;
        const right = document.getElementById('pl-right');
        if (!right) return;
        const entry = this.list.find(x => x.key === this.sel);
        if (!entry) { right.innerHTML = '<div class="mjx-empty">从左边选一个插件。</div>'; return; }
        const s = this.session(dbg, entry);
        await this.ensureSystem(dbg, s, this.list);
        if (this.sel !== entry.key || document.getElementById('pl-right') !== right) return;
        const def = PluginRuntime.normalize(entry.p);
        const esc = this.esc;
        const type = def.type || def.rawType;
        const summary = PluginRenderer.buildInfoSummary({ ownerModuleId: entry.modId, condition: def.condition, name: def.name }, {
            moduleSystem: dbg.moduleSystem, ownerModuleId: entry.modId,
            flowName: entry.flow === 'main' ? 'main' : dbg._flowName(entry.flow),
            isDynamicEvent: !!entry.isDynamic, ownerDisplayName: entry.isDynamic ? entry.dynamicOwnerName : undefined
        });
        const inherit = summary.inheritedNames.length ? '，旗下 ' + summary.inheritedNames.length + ' 个子模块自动继承' : '';
        let condDesc = '';
        if (def.condition && def.condition.conditionDef && dbg._describeDef) { try { condDesc = dbg._describeDef(def.condition.conditionDef); } catch (e) { condDesc = ''; } }
        const issues = this.validate(dbg, entry, this.list, s.plugin);
        let html = '<div class="pl-head"><span class="pl-title">' + esc(def.name || '未命名插件') + '</span><span class="pl-type">' + esc(PluginRuntime.typeLabel(type)) + '</span></div>' +
            '<div class="pl-actions"><button type="button" class="mjx-b mjx-b-edit" data-pl="edit">在模组编辑里修改</button><button type="button" class="mjx-b" data-pl="reset">全部重置</button></div>' +
            '<section class="pl-sec"><h5>信息</h5><dl class="pl-info">' +
            '<dt>所属模块</dt><dd>' + esc(summary.scopeText + inherit) + '</dd>' +
            '<dt>可见性</dt><dd>' + esc(summary.visText + (condDesc ? '：' + condDesc : '')) + '</dd>' +
            '<dt>作用</dt><dd>' + esc(this.purpose(def)) + '</dd></dl></section>';
        if (issues.length) {
            html += '<section class="pl-sec pl-sec-warn"><h5>需要处理的问题（' + issues.length + '）</h5>' + issues.map(i => '<div class="pl-issue pl-issue-' + i.level + '"><div>' + esc(i.text) + '</div>' + (i.hint ? '<div class="pl-issue-hint">' + esc(i.hint) + '</div>' : '') + '</div>').join('') + '</section>';
        }
        html += '<div id="pl-body"></div>';
        right.innerHTML = html;
        this.bindRight(right, entry, s, def);
        this.renderBody(entry, s, def);
    },

    purpose(def) {
        switch (def.type) {
            case 'randomizer': return '进入所属模块时从随机池里抽一项；结果可以存进一个变量，供变量读取器等使用。';
            case 'variable_reader': return '进入所属模块时，把上游插件的结果写进变量。';
            case 'variable_op': return '进入所属模块时，按设定改变一批变量。';
            case 'module_generator': return '进入所属模块时，按模板生成一个模块，放进指定流程。';
            case 'summary': return '把几个变量整理成一段文字，随提示词一起发给 AI。';
            case 'display': return '在所属模块里显示一个页面，用来展示变量；不发给 AI。';
            case 'interactive': return '在所属模块里显示一个页面；玩家的操作会暂存并随下一条消息发给 AI，AI 的回复写回变量。';
            case 'display_interactive': return '显示一个页面；每次发消息时把设定的内容发给 AI，AI 的回复写回变量并显示。';
            default: return '这个类型的插件不认识。';
        }
    },

    bindRight(right, entry, s, def) {
        right.onclick = (e) => {
            const b = e.target.closest('[data-pl]');
            if (!b || !right.contains(b)) return;
            const act = b.getAttribute('data-pl');
            if (act === 'edit') this.openEditor(entry);
            else if (act === 'reset') { this.reset(this.dbg, entry); this.renderRight(); }
        };
    },

    openEditor(entry) {
        const dbg = this.dbg;
        dbg._meSel = entry.modId;
        dbg._selId = entry.modId;
        if (window.PluginEditor) PluginEditor.focusPlugin = entry.p.id;
        if (window.App && App.switchDebugTab) {
            const r = App.switchDebugTab('module-edit');
            Promise.resolve(r).then(() => { if (dbg.renderModuleEditTab) dbg.renderModuleEditTab(); });
        }
    },

    // ---------- 各类型的测试区 ----------
    async renderBody(entry, s, def) {
        const dbg = this.dbg;
        const body = document.getElementById('pl-body');
        if (!body) return;
        await this.ensureSystem(dbg, s, this.list);
        if (document.getElementById('pl-body') !== body) return;
        const type = def.type;
        const esc = this.esc;
        let html = '';
        if (!type) { body.innerHTML = '<section class="pl-sec"><h5>测试</h5><div class="pl-muted">这个插件的类型不认识，先在模组编辑里改成已有的类型。</div></section>'; return; }

        if (type === 'display' || type === 'interactive' || type === 'display_interactive') {
            html += '<section class="pl-sec"><h5>页面</h5><div class="pl-toolbar"><label class="pl-lab">宽度</label><select class="pl-sel" data-plwidth="1">' +
                this.widths.map(w => '<option value="' + w[0] + '"' + (String(s.width) === w[0] ? ' selected' : '') + '>' + w[1] + (w[0] === '0' ? '' : '（' + w[0] + '）') + '</option>').join('') +
                '</select></div><div class="pl-stage" id="pl-stage"></div><div id="pl-stage-msg" class="pl-muted"></div></section>';
        }
        html += '<section class="pl-sec"><h5>测试用变量</h5><div class="pl-muted">在这里改的只是测试用的副本，不影响游戏。</div><div id="pl-vars"></div></section>';
        if (type === 'display' || type === 'interactive' || type === 'display_interactive') html += '<section class="pl-sec" id="pl-sim-click"><h5>模拟点击</h5><div id="pl-actions"></div></section>';
        if (type === 'interactive' || type === 'display_interactive') {
            html += '<section class="pl-sec"><h5>暂存的操作</h5><div class="pl-muted">玩家点击后先暂存，下次发送消息时一起发给 AI。</div><div id="pl-pending"></div></section>' +
                '<section class="pl-sec"><h5>发给 AI 的内容</h5><div id="pl-prompt"></div></section>' +
                '<section class="pl-sec"><h5>模拟 AI 回复</h5><div id="pl-reply"></div></section>';
        }
        if (type === 'randomizer' || type === 'variable_reader' || type === 'variable_op' || type === 'module_generator' || type === 'summary') {
            html += '<section class="pl-sec"><h5>运行</h5><div id="pl-run"></div></section>';
        }
        html += '<section class="pl-sec"><h5>本次测试改变的变量</h5><div id="pl-changes"></div></section>';
        body.innerHTML = html;
        this.bindBody(body, entry, s, def);
        this.renderVars(entry, s, def);
        this.renderChanges(s);
        if (type === 'display' || type === 'interactive' || type === 'display_interactive') this.mountStage(entry, s, def);
        if (type === 'interactive' || type === 'display_interactive') { this.renderPending(s); this.renderPrompt(s, def); this.renderReply(s, def); }
        if (type === 'randomizer' || type === 'variable_reader' || type === 'variable_op' || type === 'module_generator' || type === 'summary') this.renderRun(entry, s, def);
        if (window.FormControls) FormControls.enhance(body);
    },

    /** 页面用到的变量：手动选的 + 页面里写到的；没有页面的类型取设置里用到的 */
    boundIds(s, def) {
        const plugin = s.plugin;
        const doc = plugin && plugin.displayDoc ? plugin.displayDoc() : { html: def.inlineHtml, css: def.inlineStyle };
        const ids = PluginRuntime.boundVariableIds(def, doc.html || '', doc.css || '');
        const cfg = def.config || {};
        const add = (k) => { if (k && ids.indexOf(k) < 0) ids.push(k); };
        (cfg.actions || []).forEach(a => (a.ops || []).forEach(o => add(o && o.variableId)));
        if (cfg.replyBinding) add(cfg.replyBinding.variableId);
        (cfg.targetVariables || []).forEach(t => add(t && t.variableId));
        (cfg.operations || []).forEach(o => add(o && o.variableId));
        if (cfg.tempStorage) add(cfg.tempStorage);
        PluginRuntime.findPlaceholders((cfg.promptTemplate || '') + ' ' + (cfg.updatePrompt || '') + ' ' + (cfg.summaryTemplate || '')).forEach(add);
        return ids.filter(k => s.vs.getVariable(k));
    },

    renderVars(entry, s, def) {
        const box = document.getElementById('pl-vars');
        if (!box) return;
        const ids = this.boundIds(s, def);
        if (!ids.length) { box.innerHTML = '<div class="pl-muted">这个插件没有用到变量。</div>'; return; }
        box.innerHTML = ids.map(id => {
            const v = s.vs.getVariable(id);
            return '<div class="pl-vrow"><span class="pl-vname">' + this.esc((v && v.name) || id) + '</span>' + this.varControl(s, id) + '</div>';
        }).join('');
        if (window.FormControls) FormControls.enhance(box);
    },

    renderChanges(s) {
        const box = document.getElementById('pl-changes');
        if (!box) return;
        const rows = this.diffSinceStart(s);
        box.innerHTML = rows.length
            ? '<table class="pl-table"><thead><tr><th>变量</th><th>开始时</th><th>现在</th></tr></thead><tbody>' + rows.map(r => '<tr><td>' + this.esc(r.name) + '</td><td>' + this.esc(this.fmt(r.before)) + '</td><td>' + this.esc(this.fmt(r.after)) + '</td></tr>').join('') + '</tbody></table>'
            : '<div class="pl-muted">还没有变量被改变。</div>';
    },

    renderPending(s) {
        const box = document.getElementById('pl-pending');
        if (!box) return;
        box.innerHTML = s.pending.length
            ? s.pending.map((a, i) => '<div class="pl-pend"><span>' + this.esc((a.pluginName || '') + '：' + (a.actionDesc || a.type)) + '</span><button type="button" class="mjx-b" data-plpend-del="' + i + '">删除</button></div>').join('')
            : '<div class="pl-muted">现在没有暂存的操作。</div>';
    },

    /** 发给 AI 的内容：提示词里这个插件的说明段，加上随用户消息发出的暂存操作 */
    renderPrompt(s, def) {
        const box = document.getElementById('pl-prompt');
        if (!box) return;
        const block = this.promptBlock(s, def);
        const pend = PluginRuntime.formatPending(s.pending);
        const parts = [];
        parts.push('<div class="pl-label">提示词里的插件说明</div><pre class="pl-pre">' + this.esc(block || '（这个插件没有往提示词里写说明）') + '</pre>');
        parts.push('<div class="pl-label">随玩家消息发出的操作</div><pre class="pl-pre">' + this.esc(pend || '（没有暂存的操作，不会发任何内容）') + '</pre>');
        const missing = [];
        const tpl = (def.config || {}).promptTemplate || (def.config || {}).updatePrompt || '';
        PluginRuntime.findPlaceholders(tpl).forEach(k => { if (!s.vs.getVariable(k)) missing.push(k); });
        if (missing.length) parts.push('<div class="pl-issue pl-issue-warn">提示词里用到了不存在的变量：' + this.esc(missing.join('、')) + '，发出去时这部分是空的。</div>');
        box.innerHTML = parts.join('');
    },

    /** 用游戏里真正生成提示词的代码，算出这个插件在提示词「交互器」段里的样子（用测试用的变量副本） */
    promptBlock(s, def) {
        if (typeof PromptGenerator !== 'function' || !s.plugin) return '';
        const pg = new PromptGenerator();
        pg.setVariableSystem(s.vs);
        const item = { id: def.id, name: def.name, type: def.type, config: def.config, ownerModuleId: s.entry.modId };
        pg.setPluginSystem({ getActivePlugins: (type) => (type == null || type === def.type) ? [item] : [] });
        try { return pg.generateInteractors(s.entry.modId) || ''; } catch (e) { return '提示词生成出错：' + e.message; }
    },

    replyBlock(def) { return (def.config || {}).blockId || def.id; },

    renderReply(s, def) {
        const box = document.getElementById('pl-reply');
        if (!box) return;
        const block = this.replyBlock(def);
        if (s.replyText == null) s.replyText = def.config && def.config.replyBinding && def.config.replyBinding.prefix ? def.config.replyBinding.prefix + '这是一条测试回复。' : '这是一条测试回复。';
        const rb = PluginRuntime.resolveReplyBinding(def, this.store(s));
        const target = rb ? ((s.vs.getVariable(rb.variableId) || {}).name || rb.variableId) : null;
        box.innerHTML = '<div class="pl-label">AI 回复的内容（可以改）</div><textarea class="pl-in pl-ta" rows="3" id="pl-reply-text">' + this.esc(s.replyText) + '</textarea>' +
            '<div class="pl-muted">回复会写进：' + (target ? this.esc('变量「' + target + '」（' + ({ set: '覆盖', append_line: '追加一行', append_text: '接在后面' }[rb.mode] || rb.mode) + '）') : '还没有设置，这个插件的回复不会被保存') + '</div>' +
            '<div class="pl-toolbar"><button type="button" class="mjx-b mjx-b-jump" data-plreply="1">模拟 AI 回复</button></div><div id="pl-reply-out"></div>' +
            '<details class="pl-details"><summary>完整的模拟回复</summary><pre class="pl-pre" id="pl-reply-raw"></pre></details>';
        this.updateRawReply(s, def);
        if (window.FormControls) FormControls.enhance(box);
    },

    rawReply(s, def) { const b = this.replyBlock(def); return '<' + b + '>' + (s.replyText || '') + '</' + b + '>'; },

    updateRawReply(s, def) { const el = document.getElementById('pl-reply-raw'); if (el) el.textContent = this.rawReply(s, def); },

    // ---------- 页面显示 ----------
    mountStage(entry, s, def) {
        const stage = document.getElementById('pl-stage');
        if (!stage) return;
        if (s.inst) { try { s.inst.destroy(); } catch (e) { /* 已经移除 */ } s.inst = null; }
        stage.innerHTML = '';
        stage.style.maxWidth = String(s.width) === '0' ? '' : s.width + 'px';
        const face = PluginRenderer.makeFace(def, { modulePath: this.dbg.modulePath, cache: this.cache || (this.cache = new Map()), getValue: id => s.vs.getValue(id) });
        // 内联内容 / 已读到的文件内容优先；绕过缓存，保证看到的是最新编辑
        const plugin = s.plugin;
        if (plugin && plugin.displayDoc) {
            face.loadDoc = () => {
                const d = plugin.displayDoc();
                const files = plugin.fileReport();
                if (!d.html) return Promise.resolve({ error: files.display && files.display.error ? files.display.error : '没有设置要显示的内容。' });
                face.doc = { html: d.html, css: d.css, js: typeof plugin.loadedFiles.logic === 'string' ? plugin.loadedFiles.logic : '' };
                return Promise.resolve(face.doc);
            };
        }
        s.face = face;
        s.inst = PluginRenderer.mount(stage, face, {
            onAction: (msg, inst) => this.handleAction(entry, s, def, msg, inst),
            onNotice: (text) => { const m = document.getElementById('pl-stage-msg'); if (m) m.textContent = text; }
        });
    },

    refreshStage(s) { if (s.inst) s.inst.setVars(s.face.getVars()); },

    handleAction(entry, s, def, msg, inst) {
        const before = PluginRenderer.fullVarSnapshot(s.vs);
        const store = this.store(s);
        const res = PluginRuntime.runAction(def, msg, store);
        if (res.errors.length && inst && inst.notice) inst.notice('这次操作没有完全生效：' + res.errors.join('；'));
        if (res.pendingText) s.pending.push({ pluginId: def.id, pluginName: def.name, type: msg.action, label: msg.label, text: msg.text, actionDesc: res.pendingText });
        s.log.push({ msg, res, before });
        this.afterChange(s, def, res.errors);
    },

    afterChange(s, def, errors) {
        this.refreshStage(s);
        this.renderVars(null, s, def);
        this.renderChanges(s);
        this.renderPending(s);
        this.renderPrompt(s, def);
        const msg = document.getElementById('pl-stage-msg');
        if (msg && errors && errors.length) msg.textContent = errors.join('；');
    },

    renderActionButtons(s, def) {
        const box = document.getElementById('pl-actions');
        if (!box) return;
        const plugin = s.plugin;
        const doc = plugin && plugin.displayDoc ? plugin.displayDoc() : { html: '', css: '' };
        const found = PluginRuntime.scanBindings(doc.html + '\n' + (typeof (plugin && plugin.loadedFiles.logic) === 'string' ? plugin.loadedFiles.logic : ''), '').actions;
        const cfgActions = PluginRuntime.getActions(def);
        const list = found.slice();
        cfgActions.forEach(a => { if (a && a.action && !list.some(f => f.action === a.action)) list.push({ action: a.action, label: a.label || a.action, source: 'config' }); });
        if (!list.length) { box.innerHTML = '<div class="pl-muted">页面里没有可点击的按钮。</div>'; return; }
        box.innerHTML = list.map((a, i) => {
            const cfg = PluginRuntime.findAction(def, a.action);
            const text = (cfg && /\{\{\s*text\s*\}\}/.test(JSON.stringify(cfg))) || a.source === 'script' ? '<input type="text" class="pl-in pl-act-text" data-plact-text="' + this.esc(a.action) + '" value="' + this.esc(s.actionText[a.action] != null ? s.actionText[a.action] : '你好') + '">' : '';
            return '<div class="pl-act"><button type="button" class="mjx-b mjx-b-jump" data-plact="' + this.esc(a.action) + '" data-pllabel="' + this.esc(a.label) + '">点击「' + this.esc((cfg && cfg.label) || a.label) + '」</button>' + text +
                '<span class="pl-muted">' + (cfg ? '已设置效果' : '没有设置效果，只会暂存一条操作') + '</span></div>';
        }).join('');
        if (window.FormControls) FormControls.enhance(box);
    },

    // ---------- 一次性类型的运行 ----------
    renderRun(entry, s, def) {
        const box = document.getElementById('pl-run');
        if (!box) return;
        const esc = this.esc;
        let pre = '';
        if (def.type === 'randomizer') {
            const pool = (s.plugin && s.plugin.loadedFiles.pool) || def.config.pool || null;
            const list = Array.isArray(pool) ? pool : (pool && (pool.items || pool.events || pool.entries)) || [];
            pre = '<div class="pl-muted">随机池：' + (Array.isArray(list) && list.length ? '共 ' + list.length + ' 项：' + esc(list.slice(0, 6).map(x => (x && (x.name || x.title || x.id)) || '—').join('、') + (list.length > 6 ? ' 等' : '')) : (pool ? '格式较新，运行后查看结果' : '没有读到随机池')) + '</div>';
        }
        if (def.type === 'variable_reader') {
            pre = '<label class="pl-check"><input type="checkbox" id="pl-run-upstream" checked><span>先运行上游插件「' + esc(def.config.inputSource || '未选') + '」再读取</span></label>';
        }
        const label = { randomizer: '运行一次（随机抽一项）', variable_reader: '运行（读取并写入变量）', variable_op: '运行（执行这些变量操作）', module_generator: '运行（测试生成，不影响游戏）', summary: '生成总结文字' }[def.type];
        box.innerHTML = pre + '<div class="pl-toolbar"><button type="button" class="mjx-b mjx-b-jump" data-plrun="1">' + label + '</button>' +
            (def.type === 'randomizer' ? '<button type="button" class="mjx-b" data-plrun10="1">连抽 20 次看分布</button>' : '') +
            (def.type === 'module_generator' ? '<button type="button" class="mjx-b mjx-b-edit" data-plrun-real="1">真的加入游戏</button>' : '') +
            '</div><div id="pl-run-out"></div>';
    },

    runCtx(s, opts) {
        const dbg = this.dbg;
        const ms = dbg.moduleSystem;
        const existing = new Set();
        ms.modules.forEach((m, id) => existing.add(id));
        const added = [];
        const real = opts && opts.real;
        const moduleSystem = {
            addDynamicModule: (mod, ownerId, flow) => {
                if (real) {
                    if (existing.has(mod.id)) return null;
                    const m = ms.addDynamicModule(mod, ownerId, flow);
                    if (!m) return null;
                    if (window.ModuleManager && ModuleManager.addDynamicSubModuleFromRaw) ModuleManager.addDynamicSubModuleFromRaw(mod, flow);
                    added.push({ id: mod.id, flow, real: true });
                    return m;
                }
                added.push({ id: mod.id, flow, real: false, already: existing.has(mod.id) });
                return { id: mod.id };
            }
        };
        return { ctx: { variableSystem: s.vs, moduleSystem, timeSystem: dbg.timeSystem, pluginSystem: s.sys }, added };
    },

    runOnce(entry, s, def, opts) {
        const out = document.getElementById('pl-run-out');
        const before = PluginRenderer.fullVarSnapshot(s.vs);
        const lines = [];
        const plugin = s.plugin;
        if (!plugin) { out.innerHTML = '<div class="pl-issue pl-issue-error">这个插件没有登记成功，先处理上面的问题。</div>'; return; }
        const rc = this.runCtx(s, opts);
        const errs = [];
        if (def.type === 'variable_reader' && document.getElementById('pl-run-upstream') && document.getElementById('pl-run-upstream').checked) {
            const up = s.sys.getPlugin(def.config.inputSource, entry.modId);
            if (up) { const ur = PluginRenderer.runPlugin(up, rc.ctx); if (!ur.ok) errs.push('上游插件「' + (up.name || up.id) + '」运行出错：' + ur.error); }
        }
        const r = errs.length ? { ok: false, error: errs[0] } : PluginRenderer.runPlugin(plugin, rc.ctx);
        let html = '';
        if (!r.ok) {
            html += '<div class="pl-issue pl-issue-error">运行出错：' + this.esc(r.error) + '</div>';
        } else if (def.type === 'randomizer') {
            html += '<div class="pl-label">抽到的结果</div><pre class="pl-pre">' + this.esc(PluginRenderer.describeRandomizerResult(r.result).join('\n')) + '</pre>';
            if (def.config.tempStorage) html += '<div class="pl-muted">已存进变量「' + this.esc(((s.vs.getVariable(def.config.tempStorage) || {}).name) || def.config.tempStorage) + '」。</div>';
        } else if (def.type === 'variable_reader') {
            const w = r.result || { written: [], skipped: [] };
            html += '<div class="pl-label">读到的结果</div><pre class="pl-pre">' + this.esc(plugin.inputSource ? PluginRuntime.formatValue((s.sys.getPlugin(plugin.inputSource, entry.modId) || {}).output) : '') + '</pre>';
            html += '<div class="pl-label">写进了</div>' + (w.written.length ? '<div>' + this.esc(w.written.map(id => ((s.vs.getVariable(id) || {}).name || id)).join('、')) + '</div>' : '<div class="pl-muted">没有写入任何变量。</div>');
            if (w.skipped.length) html += '<div class="pl-issue pl-issue-warn">' + this.esc(w.skipped.join('；')) + '</div>';
        } else if (def.type === 'variable_op') {
            const res = r.result || { changes: [], errors: [] };
            if (res.errors.length) html += '<div class="pl-issue pl-issue-warn">' + this.esc(res.errors.join('；')) + '</div>';
            if (!res.changes.length && !res.errors.length) html += '<div class="pl-muted">没有执行任何操作。</div>';
        } else if (def.type === 'module_generator') {
            html += '<div class="pl-label">生成的模块</div><pre class="pl-pre">' + this.esc(PluginRenderer.describeGeneratorResult(r.result, plugin, { flowName: this.dbg._flowName(def.config.outputFlow || ''), eventTypeCN: this.dbg._TYC, ownerModuleName: entry.modName }).join('\n')) + '</pre>';
            const a = rc.added[0];
            const add = plugin.lastAdd;
            if (a) html += '<div class="pl-muted">' + (a.real ? '已加入游戏里的「' + this.esc(this.dbg._flowName(a.flow)) + '」流程。' : '测试里已放进「' + this.esc(this.dbg._flowName(a.flow)) + '」流程，没有写进游戏。') + (a.already ? '游戏里已经有这个模块，真实运行时不会重复生成。' : '') + '</div>';
            else if (add && !add.added) html += '<div class="pl-issue pl-issue-warn">' + this.esc(add.reason) + '</div>';
        } else if (def.type === 'summary') {
            const t = r.result && r.result.text;
            html += '<div class="pl-label">总结文字</div><pre class="pl-pre">' + this.esc(t ? t : '（没有内容）') + '</pre>';
            if (r.result && r.result.missing && r.result.missing.length) html += '<div class="pl-issue pl-issue-warn">用到了不存在的变量：' + this.esc(r.result.missing.join('、')) + '</div>';
            if (t) html += '<div class="pl-label">会这样放进提示词</div><pre class="pl-pre">' + this.esc(this.promptBlock(s, def)) + '</pre>';
        }
        if (def.type !== 'summary') {
            const diff = PluginRenderer.diffVarSnapshot(before, s.vs, v => this.fmt(v));
            html += '<div class="pl-label">这次运行改变的变量</div>' + (diff.length ? '<table class="pl-table"><thead><tr><th>变量</th><th>运行前</th><th>运行后</th></tr></thead><tbody>' + diff.map(d => '<tr><td>' + this.esc(d.name) + '</td><td>' + this.esc(d.before) + '</td><td>' + this.esc(d.after) + '</td></tr>').join('') + '</tbody></table>' : '<div class="pl-muted">没有变量被改变。</div>');
        }
        out.innerHTML = html;
        this.renderVars(entry, s, def);
        this.renderChanges(s);
    },

    runMany(entry, s, def) {
        const out = document.getElementById('pl-run-out');
        const plugin = s.plugin;
        const counts = {};
        let failed = '';
        const rc = this.runCtx(s);
        for (let i = 0; i < 20; i++) {
            const r = PluginRenderer.runPlugin(plugin, rc.ctx);
            if (!r.ok) { failed = r.error; break; }
            const k = r.result && typeof r.result === 'object' ? (r.result.name || r.result.title || r.result.id || '（无名）') : String(r.result);
            counts[k] = (counts[k] || 0) + 1;
        }
        out.innerHTML = failed ? '<div class="pl-issue pl-issue-error">运行出错：' + this.esc(failed) + '</div>'
            : '<div class="pl-label">20 次的结果</div><table class="pl-table"><tbody>' + Object.keys(counts).map(k => '<tr><td>' + this.esc(k) + '</td><td>' + counts[k] + ' 次</td></tr>').join('') + '</tbody></table>';
        this.renderChanges(s);
    },

    // ---------- 事件 ----------
    bindBody(body, entry, s, def) {
        const dbg = this.dbg;
        body.onchange = (e) => {
            const t = e.target;
            if (t.matches('[data-plwidth]')) {
                s.width = t.value;
                const stage = document.getElementById('pl-stage');
                if (stage) stage.style.maxWidth = String(s.width) === '0' ? '' : s.width + 'px';
                return;
            }
            if (t.matches('[data-plvar]')) {
                const id = t.getAttribute('data-plvar');
                const val = this.readControl(t);
                if (val === null && t.getAttribute('data-vt') !== 'string') { t.classList.add('pl-bad'); return; }
                t.classList.remove('pl-bad');
                if (!s.vs.executeOperation(id, 'set', { value: val })) { t.classList.add('pl-bad'); return; }
                if (t.type === 'checkbox') { const sp = t.parentNode.querySelector('span'); if (sp) sp.textContent = t.checked ? '开' : '关'; }
                this.afterChange(s, def, []);
                return;
            }
            if (t.matches('[data-plact-text]')) { s.actionText[t.getAttribute('data-plact-text')] = t.value; return; }
            if (t.id === 'pl-reply-text') { s.replyText = t.value; this.updateRawReply(s, def); }
        };
        body.oninput = (e) => {
            const t = e.target;
            if (t.id === 'pl-reply-text') { s.replyText = t.value; this.updateRawReply(s, def); }
            else if (t.matches('[data-plact-text]')) s.actionText[t.getAttribute('data-plact-text')] = t.value;
        };
        body.onclick = (e) => {
            const b = e.target.closest('button');
            if (!b || !body.contains(b)) return;
            if (b.hasAttribute('data-plact')) {
                const a = b.getAttribute('data-plact');
                const textEl = body.querySelector('[data-plact-text="' + (window.CSS && CSS.escape ? CSS.escape(a) : a) + '"]');
                this.handleAction(entry, s, def, { action: a, label: b.getAttribute('data-pllabel') || '', text: textEl ? textEl.value : '' }, s.inst);
            } else if (b.hasAttribute('data-plpend-del')) {
                s.pending.splice(Number(b.getAttribute('data-plpend-del')), 1);
                this.renderPending(s);
                this.renderPrompt(s, def);
            } else if (b.hasAttribute('data-plreply')) {
                this.simulateReply(entry, s, def);
            } else if (b.hasAttribute('data-plrun')) {
                this.runOnce(entry, s, def);
            } else if (b.hasAttribute('data-plrun10')) {
                this.runMany(entry, s, def);
            } else if (b.hasAttribute('data-plrun-real')) {
                this.runOnce(entry, s, def, { real: true });
                dbg.refresh && dbg.refresh();
            }
        };
        if (def.type === 'display' || def.type === 'interactive' || def.type === 'display_interactive') this.renderActionButtons(s, def);
    },

    simulateReply(entry, s, def) {
        const out = document.getElementById('pl-reply-out');
        const raw = this.rawReply(s, def);
        const store = this.store(s);
        const r = PluginRuntime.applyReply(def, raw, store);
        let html = '';
        if (r.unbound) html += '<div class="pl-issue pl-issue-warn">这个插件还没有设置回复要写进哪个变量，回复不会被保存。在模组编辑里设置「AI 回复写入哪个变量」。</div>';
        r.changes.forEach(c => { html += '<div class="pl-res">变量「' + this.esc(c.name) + '」：' + this.esc(this.fmt(c.before)) + ' → ' + this.esc(this.fmt(c.after)) + (c.trimmed ? '（记录太长，较早的内容已清理）' : '') + '</div>'; });
        if (r.errors.length) html += '<div class="pl-issue pl-issue-warn">' + this.esc(r.errors.join('；')) + '</div>';
        if (r.truncated) html += '<div class="pl-issue pl-issue-warn">回复太长，只保留了前 5000 个字。</div>';
        out.innerHTML = html || '<div class="pl-muted">没有变量被改变。</div>';
        this.afterChange(s, def, []);
    }
};

window.PluginTester = PluginTester;

Object.assign(DebugModuleJump, {
    _allPlugins() { return PluginTester.allPlugins(this); },
    renderPluginTab() { PluginTester.render(this); }
});
