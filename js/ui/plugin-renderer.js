/**
 * PluginRenderer —— 插件的显示、测试运行与说明文字的统一接口。
 * 游戏两侧的插件区、调试里的插件测试、模组编辑里的预览都从这里取，保证三处看到的是同一份结果。
 *
 *   face（插件的「界面」）
 *     PluginRenderer.makeFace(def, env) → { id, name, def, loadDoc(), getVars(), baseUrl }
 *       def: PluginRuntime.normalize() 的结果；env: { modulePath, getValue(id), cache }
 *   mount
 *     PluginRenderer.mount(container, face, hooks) → PluginSandbox 实例（隔离运行，见 plugin-sandbox.js）
 *   文字
 *     typeCN / buildInfoSummary / substVars / describeGeneratorResult / describeRandomizerResult / describeVariableReaderTargets
 *   测试运行
 *     runPlugin(plugin, ctx) → { ok, result, error }；diffVarSnapshot / fullVarSnapshot 用于对比变量前后变化
 */
(function () {
    'use strict';

    var RT = window.PluginRuntime;

    var PLUGIN_TYPES = {
        RANDOMIZER: 'randomizer',
        VARIABLE_READER: 'variable_reader',
        VARIABLE_OP: 'variable_op',
        MODULE_GENERATOR: 'module_generator',
        SUMMARY: 'summary',
        DISPLAY: 'display',
        INTERACTIVE: 'interactive',
        DISPLAY_INTERACTIVE: 'display_interactive'
    };

    function typeCN(t) { return RT.typeLabel(t); }

    // ---------- 文件读取 ----------
    var defaultCache = new Map();

    /** 读一个文本文件，失败时返回 { error, notFound }，不抛异常。 */
    function fetchText(url, label, cache) {
        var c = cache || defaultCache;
        if (c.has(url)) return c.get(url);
        var p = fetch(url).then(function (r) {
            if (r.status === 404) return { error: label + '没找到（' + url + '）。', notFound: true };
            if (!r.ok) return { error: label + '读取失败（' + r.status + '）。', notFound: false };
            return r.text().then(function (t) { return { text: t }; });
        }, function () {
            return { error: label + '读取失败，请检查网络或服务是否在运行。', notFound: false };
        });
        c.set(url, p);
        return p;
    }

    function joinPath(base, file) {
        var b = String(base || '').replace(/\/+$/, '');
        return b ? b + '/' + file : file;
    }

    function dirUrl(modulePath, file) {
        try {
            var rel = joinPath(modulePath, file ? String(file).replace(/[^\/]*$/, '') : '');
            var u = new URL(rel, document.baseURI);
            return u.href.replace(/[^\/]*$/, '');
        } catch (e) { return undefined; }
    }

    /**
     * 取一条插件需要的所有文件的读取结果：{ display, style, pool, logic } → { text } | { error, notFound } | 不存在则无该键
     */
    function loadFiles(def, env) {
        env = env || {};
        var names = { display: '显示文件', style: '样式文件', pool: '随机池文件', logic: '脚本文件' };
        var out = {}, jobs = [];
        Object.keys(names).forEach(function (k) {
            var f = def.files && def.files[k];
            if (!f) return;
            jobs.push(fetchText(joinPath(env.modulePath, f), names[k], env.cache).then(function (r) {
                if (r.error) { r.error = names[k] + '没找到：' + f + '。'; if (!r.notFound) r.error = names[k] + '读取失败：' + f + '。'; }
                out[k] = r;
            }));
        });
        return Promise.all(jobs).then(function () { return out; });
    }

    /** 插件的显示内容：内联的优先于文件里的（逐项）。返回 { html, css, js } 或 { error }。 */
    function resolveDoc(def, files) {
        var html = def.inlineHtml || (files.display && files.display.text) || '';
        var css = def.inlineStyle || (files.style && files.style.text) || '';
        if (!html) {
            if (files.display && files.display.error) return { error: files.display.error };
            return { error: '没有设置要显示的内容。' };
        }
        var js = (files.logic && files.logic.text) || '';
        var doc = { html: html, css: css, js: js };
        if (files.style && files.style.error && !def.inlineStyle) doc.cssError = files.style.error;
        return doc;
    }

    // ---------- face ----------
    function makeFace(def, env) {
        env = env || {};
        var face = {
            id: def.id,
            name: def.name || def.id,
            def: def,
            baseUrl: dirUrl(env.modulePath, def.files && def.files.display),
            files: null,
            doc: null
        };
        face.loadDoc = function () {
            return loadFiles(def, env).then(function (files) {
                face.files = files;
                var d = resolveDoc(def, files);
                face.doc = d;
                return d;
            });
        };
        face.boundIds = function () {
            var d = face.doc || {};
            return RT.boundVariableIds(def, d.html || def.inlineHtml || '', d.css || def.inlineStyle || '');
        };
        face.getVars = function () {
            var m = {};
            face.boundIds().forEach(function (k) { m[k] = env.getValue ? env.getValue(k) : undefined; });
            return m;
        };
        return face;
    }

    function mount(container, face, hooks) {
        hooks = hooks || {};
        var cfg = face.def.config || {};
        return window.PluginSandbox.mount(container, {
            pluginId: face.id,
            name: face.name,
            baseUrl: face.baseUrl,
            minHeight: typeof cfg.minHeight === 'number' && cfg.minHeight > 0 ? cfg.minHeight : 60,
            allowExternalImages: cfg.allowExternalImages === true,
            getDoc: face.loadDoc,
            getVars: face.getVars,
            onAction: hooks.onAction,
            onNotice: hooks.onNotice,
            onStateChange: hooks.onStateChange
        });
    }

    // ---------- 文字 ----------
    /** 所属模块 / 流程 / 子级继承 / 可见性，拼成人话。 */
    function buildInfoSummary(plugin, opts) {
        opts = opts || {};
        var ms = opts.moduleSystem;
        var ownerId = plugin.ownerModuleId || opts.ownerModuleId || '';
        // 动态生成的事件不在静态模块树里，查到的会是生成器所在的父模块
        var ownerMod = ms && ms.getModule && !opts.isDynamicEvent ? ms.getModule(ownerId) : null;
        var ownerName = opts.ownerDisplayName || (ownerMod && ownerMod.name) || ownerId || '—';
        var flowDisplay = opts.flowName || (ownerMod && ownerMod.flowName) || 'main';
        var flowText = flowDisplay === 'main' ? '主流程' : flowDisplay;
        var inheritedNames = [];
        if (ownerMod && ownerMod.getAllSubModules && !opts.isDynamicEvent) {
            var walk = function (m) {
                if (!m) return;
                if (m.id !== ownerMod.id) inheritedNames.push(m.name || m.id);
                if (m.getAllSubModules) Array.from(m.getAllSubModules()).forEach(walk);
            };
            Array.from(ownerMod.getAllSubModules()).forEach(walk);
        }
        var scopeText = opts.isDynamicEvent
            ? '挂在「' + ownerName + '」（' + flowText + '）—— 由生成器运行时动态生成的事件'
            : '挂在「' + ownerName + '」（' + flowText + '）';
        var cond = plugin.condition || {};
        var visText;
        if (!cond.type || cond.type === 'always') visText = '始终启用';
        else if (cond.type === 'precondition') visText = '满足前置条件时启用';
        else if (cond.type === 'display') visText = '满足显示条件时启用';
        else visText = String(cond.type);
        return { scopeText: scopeText, visText: visText, ownerName: ownerName, flowText: flowText, inheritedNames: inheritedNames, cond: cond };
    }

    /** {{变量}} → 变量当前值（给提示词用的文字代入；变量不存在的换成空）。 */
    function substVars(template, varMap) {
        return RT.renderText(template, function (k) { return varMap && Object.prototype.hasOwnProperty.call(varMap, k) ? varMap[k] : undefined; }).text;
    }

    function snapshotVars(variableSystem, keys) {
        var out = {};
        if (!variableSystem || !variableSystem.getValue) return out;
        (keys || []).forEach(function (k) {
            try { out[k] = variableSystem.getValue(k); } catch (e) { out[k] = undefined; }
        });
        return out;
    }

    /** 测试运行：绕过「是否启用」的判断，直接调用插件的 execute。 */
    function runPlugin(plugin, ctx) {
        if (!plugin || typeof plugin.execute !== 'function') return { ok: false, error: '这个插件没有可运行的内容。' };
        var context = Object.assign({}, ctx || {});
        if (!context.pluginSystem && plugin._pluginSystem) context.pluginSystem = plugin._pluginSystem;
        try {
            return { ok: true, result: plugin.execute(context) };
        } catch (e) {
            return { ok: false, error: e && e.message ? e.message : String(e) };
        }
    }

    /**
     * 模块生成器的真实生成结果 → 人话。逐项列出：名字 / 类型 / 挂到哪条流程 / 背景 / 进入与完成条件 / 变量 / 子插件 / 子流程。
     */
    function describeGeneratorResult(generated, plugin, opts) {
        opts = opts || {};
        var lines = [];
        var cfg = (plugin && plugin.config) || {};
        var flowName = opts.flowName || cfg.outputFlow || '—';
        var inputSrc = cfg.inputSource || 'builtin';
        var tpl = cfg.moduleTemplate || {};
        var tplName = tpl.name || tpl.id || '—';
        var tplTypeCN = (opts.eventTypeCN && opts.eventTypeCN[tpl.type]) || tpl.type || '—';
        lines.push('这个生成器做什么');
        lines.push('取什么输入：' + (inputSrc === 'builtin' ? '不读别的插件，每次都按模板生成一份' : '读取「' + inputSrc + '」的结果，填进模板里对应的位置'));
        lines.push('生成方式：按模板「' + tplName + '」（' + tplTypeCN + '）生成一个模块，放进流程「' + flowName + '」');
        lines.push('');
        lines.push('这次生成的结果');
        if (generated && typeof generated === 'object') {
            lines.push('生成了模块「' + (generated.name || generated.id || '—') + '」');
            lines.push('类型：' + ((opts.eventTypeCN && opts.eventTypeCN[generated.type]) || generated.type || '—'));
            lines.push('放在流程：' + flowName);
            var ownerName = opts.ownerModuleName || (plugin && plugin.ownerModuleId) || '';
            if (ownerName) lines.push('位置：' + ownerName + ' → ' + flowName + ' → ' + (generated.name || generated.id || '—'));
            var infoArr = Array.isArray(generated.info) ? generated.info : (generated.info ? [generated.info] : []);
            var infoText = infoArr.map(function (i) { return typeof i === 'string' ? i : (i && i.content) || ''; }).filter(Boolean).join('\n');
            lines.push('');
            if (infoText.trim()) { lines.push('背景：'); infoText.split('\n').forEach(function (l) { lines.push('  ' + l); }); }
            else lines.push('背景：没有填写');
            var ec = Array.isArray(generated.entryConditions) ? generated.entryConditions : [];
            var cc = Array.isArray(generated.completionConditions) ? generated.completionConditions : [];
            lines.push('');
            lines.push(ec.length ? '进入条件：' + ec.length + ' 组' : '进入条件：没有（可直接进入）');
            lines.push(cc.length ? '完成条件：' + cc.length + ' 组' : '完成条件：没有');
            var vars = Array.isArray(generated.variables) ? generated.variables : [];
            lines.push('');
            if (vars.length) {
                lines.push('带的变量：');
                vars.forEach(function (vv) {
                    var vt = ({ number: '数值', string: '文字', boolean: '开关', list: '列表', object: '对象' })[vv.type] || vv.type || '';
                    var iv = vv.initialValue;
                    lines.push('  ' + (vv.name || vv.id) + '（' + vt + '）：' + (iv === undefined || iv === null || iv === '' ? '空' : RT.formatValue(iv)));
                });
            } else lines.push('带的变量：没有');
            var pls = Array.isArray(generated.plugins) ? generated.plugins : [];
            lines.push('');
            if (pls.length) {
                lines.push('带 ' + pls.length + ' 个插件：');
                pls.forEach(function (pp) {
                    lines.push('  ' + (pp.name || pp.id) + '（' + typeCN(pp.type) + '）');
                    var pcfg = pp.config || {};
                    if (pcfg.promptTemplate) lines.push('    发给 AI 的内容：' + String(pcfg.promptTemplate).split('\n').slice(0, 2).join(' / '));
                    if (Array.isArray(pcfg.requiredVariables) && pcfg.requiredVariables.length) lines.push('    用到的变量：' + pcfg.requiredVariables.join('、'));
                });
            } else lines.push('带的插件：没有');
            var flowKeys = generated.flows ? Object.keys(generated.flows) : [];
            lines.push('');
            if (flowKeys.length) {
                lines.push('包含的流程：' + flowKeys.join('、'));
                flowKeys.forEach(function (fk) {
                    var fd = generated.flows[fk] || {};
                    var subCnt = Array.isArray(fd.subModules) ? fd.subModules.length : 0;
                    lines.push('  ' + fk + '：' + subCnt + ' 个子模块');
                });
            } else lines.push('包含的流程：没有');
        } else if (generated == null) {
            lines.push('没有生成模块。上游插件没有结果，或触发条件没有满足。');
        } else {
            lines.push('生成结果：' + RT.formatValue(generated));
        }
        return lines;
    }

    function describeRandomizerResult(picked) {
        if (picked == null) return ['没有抽到东西。池子是空的，或条件没有满足。'];
        if (typeof picked === 'string') return ['抽到：' + picked];
        if (typeof picked === 'object') {
            var lines = [];
            var name = picked.name || picked.title || picked.id || '（无名）';
            var content = picked.content || picked.text || picked.description;
            lines.push('抽到：「' + name + '」');
            if (content) lines.push(String(content));
            var keyCN = { type: '类型', effects: '影响', tags: '标签', weight: '权重', rarity: '稀有度', cost: '消耗', reward: '奖励', cooldown: '冷却' };
            var valCN = { positive: '正面', negative: '负面', neutral: '中性', special: '特殊' };
            Object.keys(picked).forEach(function (k) {
                if (['id', 'name', 'title', 'content', 'text', 'description'].indexOf(k) >= 0) return;
                var v = picked[k];
                if (v == null) return;
                var label = keyCN[k] || k;
                if (v && typeof v === 'object' && !Array.isArray(v)) {
                    lines.push(label + '：' + Object.keys(v).map(function (sk) { return sk + ' ' + (typeof v[sk] === 'number' && v[sk] >= 0 ? '+' : '') + v[sk]; }).join('、'));
                } else if (Array.isArray(v)) {
                    lines.push(label + '：' + v.map(function (x) { return RT.formatValue(x); }).join('、'));
                } else {
                    lines.push(label + '：' + (valCN[v] || v));
                }
            });
            return lines;
        }
        return ['抽到：' + String(picked)];
    }

    function describeVariableReaderTargets(plugin, varMap) {
        var cfg = plugin.config || {};
        var targets = Array.isArray(cfg.targetVariables) ? cfg.targetVariables : [];
        if (!targets.length) return ['还没有设置要写入的变量。'];
        return targets.map(function (t) {
            var id = (t && (t.variableId || t.id || t.name)) || t;
            var cur = varMap && varMap[id];
            var mapping = t && t.mapping ? '（取 ' + (cfg.inputSource || '上游结果') + ' 的 ' + t.mapping + '）' : '';
            return id + mapping + '：当前 ' + (cur == null || cur === '' ? '空' : RT.formatValue(cur));
        });
    }

    /** 变量改动前后对比 → [{ name, before, after }]；空数组 = 没有改动。 */
    function diffVarSnapshot(beforeMap, variableSystem, formatValue) {
        if (!variableSystem || !variableSystem.variables) return [];
        var out = [];
        var fmt = formatValue || function (v) { return v == null ? '空' : RT.formatValue(v); };
        variableSystem.variables.forEach(function (v, id) {
            var after;
            try { after = variableSystem.getValue(id); } catch (e) { return; }
            if (RT.safeStringify(after) !== RT.safeStringify(beforeMap[id])) out.push({ id: id, name: v.name || id, before: fmt(beforeMap[id]), after: fmt(after) });
        });
        return out;
    }

    function fullVarSnapshot(variableSystem) {
        var out = {};
        if (!variableSystem || !variableSystem.variables) return out;
        variableSystem.variables.forEach(function (v, id) {
            try { out[id] = RT.cloneJson(variableSystem.getValue(id)); } catch (e) { out[id] = undefined; }
        });
        return out;
    }

    window.PluginRenderer = {
        PLUGIN_TYPES: PLUGIN_TYPES,
        typeCN: typeCN,
        fetchText: fetchText,
        loadFiles: loadFiles,
        resolveDoc: resolveDoc,
        makeFace: makeFace,
        mount: mount,
        buildInfoSummary: buildInfoSummary,
        substVars: substVars,
        snapshotVars: snapshotVars,
        runPlugin: runPlugin,
        describeGeneratorResult: describeGeneratorResult,
        describeRandomizerResult: describeRandomizerResult,
        describeVariableReaderTargets: describeVariableReaderTargets,
        diffVarSnapshot: diffVarSnapshot,
        fullVarSnapshot: fullVarSnapshot
    };
})();
