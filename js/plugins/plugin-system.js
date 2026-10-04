/**
 * Plugin System —— 插件的运行实体（8 类）与注册表。
 * 随机器 / 变量读取器 / 变量操作器 / 模块生成器 在进入所属模块时各执行一次；
 * 显示器 / 交互器 / 显示+交互器 提供界面与发给 AI 的内容；总结器提供一段随提示词发送的总结文字。
 * 纯逻辑（变量操作、模板代入、校验）在 plugin-runtime.js；界面隔离在 plugin-sandbox.js。
 */

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

var PLUGIN_CONDITION_TYPES = {
    PRECONDITION: 'precondition',
    DISPLAY: 'display',
    ALWAYS: 'always'
};

(function () {
    'use strict';
    var RT = (typeof window !== 'undefined' && window.PluginRuntime) || (typeof globalThis !== 'undefined' && globalThis.PluginRuntime) || null;
    if (!RT) throw new Error('plugin-runtime.js 需要先于 plugin-system.js 加载');

    function readFile(url, kind) {
        return fetch(url).then(function (r) {
            if (r.status === 404) return { error: I18n.t('文件没找到（{url}）', { url: url }), notFound: true };
            if (!r.ok) return { error: I18n.t('文件读取失败（{status}）：{url}', { status: r.status, url: url }), notFound: false };
            if (kind === 'json') {
                return r.text().then(function (t) {
                    try { return { value: JSON.parse(t) }; } catch (e) { return { error: I18n.t('文件内容格式不对（不是正确的 JSON）：{url}', { url: url }), notFound: false }; }
                });
            }
            return r.text().then(function (t) { return { value: t }; });
        }, function () {
            return { error: I18n.t('文件读取失败（网络或服务不可用）：{url}', { url: url }), notFound: false };
        });
    }

    /**
     * Plugin —— 所有插件的基类
     */
    class Plugin {
        constructor(config, ownerModuleId) {
            this.raw = config;
            this.def = RT.normalize(config);
            this.id = this.def.id;
            this.name = this.def.name;
            this.type = this.def.type || this.def.rawType;
            this.note = this.def.note;
            this.ownerModuleId = ownerModuleId;
            this.condition = this.def.condition;
            this.enabled = this.def.enabled;
            this.files = this.def.files;
            this.config = this.def.config;
            this.tempVariables = this.def.tempVariables;
            this._inlineHtml = this.def.inlineHtml;
            this._inlineStyle = this.def.inlineStyle;
            this.loadedFiles = { logic: null, display: null, style: null, pool: null };
            this.loadErrors = {};
            this.isActive = false;
            this.output = null;
        }

        shouldBeActive(conditionEvaluator) {
            if (!this.enabled) return false;
            var c = this.condition || {};
            if (!c.type || c.type === PLUGIN_CONDITION_TYPES.ALWAYS) return true;
            if (!conditionEvaluator) return false;
            if (c.type === PLUGIN_CONDITION_TYPES.PRECONDITION) return !!conditionEvaluator.evaluate(c.conditionDef, 'precondition');
            if (c.type === PLUGIN_CONDITION_TYPES.DISPLAY) return !!conditionEvaluator.evaluate(c.conditionDef, 'display');
            return false;
        }

        /** 读取这个插件声明的文件。失败不抛错，原因记在 loadErrors 里，由校验统一报告。 */
        loadFiles(baseModulePath) {
            var self = this;
            var base = String(baseModulePath || '').replace(/\/+$/, '');
            var jobs = [];
            var plan = [['logic', 'text', I18n.t('脚本文件')], ['display', 'text', I18n.t('显示文件')], ['style', 'text', I18n.t('样式文件')], ['pool', 'json', I18n.t('随机池文件')]];
            plan.forEach(function (p) {
                var f = self.files[p[0]];
                if (!f) return;
                jobs.push(readFile(base ? base + '/' + f : f, p[1]).then(function (r) {
                    if (r.error) {
                        self.loadedFiles[p[0]] = null;
                        self.loadErrors[p[0]] = { error: I18n.t('{file}：{error}', { file: p[2], error: r.error }), notFound: !!r.notFound };
                    } else {
                        self.loadedFiles[p[0]] = r.value;
                        delete self.loadErrors[p[0]];
                    }
                }));
            });
            return Promise.all(jobs);
        }

        /** 给校验用：各文件的读取结果 */
        fileReport() {
            var out = {};
            var self = this;
            ['display', 'style', 'pool', 'logic'].forEach(function (k) {
                if (!self.files[k]) return;
                if (self.loadErrors[k]) out[k] = self.loadErrors[k];
                else if (self.loadedFiles[k] != null) out[k] = { text: typeof self.loadedFiles[k] === 'string' ? self.loadedFiles[k] : '' };
            });
            return out;
        }

        /** 显示用的 HTML / CSS：内联的优先于文件里的 */
        displayDoc() {
            return {
                html: this._inlineHtml || (typeof this.loadedFiles.display === 'string' ? this.loadedFiles.display : ''),
                css: this._inlineStyle || (typeof this.loadedFiles.style === 'string' ? this.loadedFiles.style : '')
            };
        }

        execute(context) {
            throw new Error(I18n.t('这种插件没有可运行的内容'));
        }
    }

    function varsFor(plugin, context) {
        var doc = plugin.displayDoc();
        var out = {};
        RT.boundVariableIds(plugin.def, doc.html, doc.css).forEach(function (id) {
            out[id] = context.variableSystem ? context.variableSystem.getValue(id) : undefined;
        });
        return out;
    }

    function storeOf(context) {
        if (!context || !context.variableSystem) throw new Error(I18n.t('没有可用的变量系统'));
        return RT.storeFromVariableSystem(context.variableSystem);
    }

    /**
     * RandomizerPlugin —— 从随机池里抽一项
     */
    class RandomizerPlugin extends Plugin {
        constructor(config, ownerModuleId) {
            super(config, ownerModuleId);
            this.tempStorage = this.config.tempStorage;
        }

        execute(context) {
            if (!this.config.pool && this.loadErrors.pool) throw new Error(this.loadErrors.pool.error);
            var pool = this.config.pool || this.loadedFiles.pool || null;
            if (!pool) throw new Error(I18n.t('随机池还没有载入，或没有设置随机池。'));
            var Picker = (typeof window !== 'undefined' && window.RandomPoolPicker) || null;
            var isNewFormat = pool && typeof pool === 'object' && (pool.poolType || pool.sections || (Array.isArray(pool.entries) && !pool.items && !pool.events));
            var selected;
            if (Picker && isNewFormat) {
                var condCtx = {};
                var cc = this.config.conditionContext || {};
                Object.keys(cc).forEach(function (k) { condCtx[k] = cc[k]; });
                var vs = context && context.variableSystem;
                if (vs && vs.variables) {
                    vs.variables.forEach(function (v, vid) { if (v && v.value !== undefined && !(vid in condCtx)) condCtx[vid] = v.value; });
                }
                selected = Picker.pick(pool, condCtx);
            } else {
                var list = Array.isArray(pool) ? pool : (pool.items || pool.events || pool.entries || null);
                if (!Array.isArray(list) || list.length === 0) throw new Error(I18n.t('随机池是空的。'));
                var weights = pool && !Array.isArray(pool) ? pool.weights : null;
                var w = function (e) { return weights ? (weights[e && e.id] != null ? weights[e.id] : (weights[e] != null ? weights[e] : 0)) : 1; };
                var total = list.reduce(function (s, e) { return s + w(e); }, 0);
                if (!weights || total <= 0) {
                    selected = list[Math.floor(Math.random() * list.length)];
                } else {
                    var r = Math.random() * total;
                    for (var i = 0; i < list.length; i++) { r -= w(list[i]); if (r <= 0) { selected = list[i]; break; } }
                    if (selected === undefined) selected = list[list.length - 1];
                }
            }
            if (selected === undefined || selected === null) throw new Error(I18n.t('这次没有抽到东西（池子为空，或条件都没有满足）。'));
            this.output = selected;
            if (this.tempStorage && context && context.variableSystem) {
                var ok = context.variableSystem.executeOperation(this.tempStorage, 'set', { value: selected });
                if (ok === false) throw new Error(I18n.t('抽到的结果没能存进变量「{name}」（变量不存在或类型不是对象）。', { name: this.tempStorage }));
            }
            return selected;
        }
    }

    /**
     * VariableReaderPlugin —— 把上游插件的结果写进变量
     */
    class VariableReaderPlugin extends Plugin {
        constructor(config, ownerModuleId) {
            super(config, ownerModuleId);
            this.inputSource = this.config.inputSource;
            this.targetVariables = this.config.targetVariables || [];
        }

        execute(context) {
            var src = context.pluginSystem && context.pluginSystem.getPlugin(this.inputSource, this.ownerModuleId);
            if (!src) throw new Error(I18n.t('要读取的插件「{name}」不存在。', { name: this.inputSource }));
            if (src.output === null || src.output === undefined) throw new Error(I18n.t('上游插件「{name}」还没有结果，先让它运行一次。', { name: src.name || src.id }));
            var store = storeOf(context);
            var written = [], skipped = [];
            var self = this;
            this.targetVariables.forEach(function (t) {
                var id = t && t.variableId;
                if (!id) { skipped.push(I18n.t('有一条写入没有选变量')); return; }
                var value = self.extractValue(src.output, t.mapping);
                if (value === undefined) { skipped.push(I18n.t('上游结果里没有「{field}」，变量「{name}」没有改动', { field: t.mapping, name: store.nameOf(id) })); return; }
                if (!store.has(id)) { skipped.push(I18n.t('变量「{id}」不存在', { id: id })); return; }
                if (!store.set(id, value)) { skipped.push(I18n.t('变量「{name}」不能写入这个值', { name: store.nameOf(id) })); return; }
                written.push(id);
            });
            if (!written.length && skipped.length) throw new Error(skipped.join(I18n.t('；')));
            return { written: written, skipped: skipped };
        }

        extractValue(input, mapping) {
            if (mapping == null || String(mapping).trim() === '') return input;
            var keys = String(mapping).trim().split('.');
            var value = input;
            for (var i = 0; i < keys.length; i++) {
                if (value && typeof value === 'object') value = value[keys[i]];
                else return undefined;
            }
            return value;
        }
    }

    /**
     * VariableOpPlugin —— 进入模块时按设定改一批变量
     */
    class VariableOpPlugin extends Plugin {
        execute(context) {
            var res = RT.applyOps(this.config.operations, storeOf(context), {});
            if (res.errors.length && !res.changes.length) throw new Error(res.errors.join(I18n.t('；')));
            return res;
        }
    }

    function fillTemplate(node, data) {
        if (typeof node === 'string') {
            var whole = /^\{\{\s*([A-Za-z0-9_一-龥]+)\s*\}\}$/.exec(node);
            if (whole && data[whole[1]] !== undefined) return data[whole[1]];
            return RT.renderText(node, function (k) { return data[k]; }).text;
        }
        if (Array.isArray(node)) return node.map(function (n) { return fillTemplate(n, data); });
        if (node && typeof node === 'object') {
            var out = {};
            Object.keys(node).forEach(function (k) { out[k] = fillTemplate(node[k], data); });
            return out;
        }
        return node;
    }

    /**
     * ModuleGeneratorPlugin —— 按模板生成一个模块，放进指定流程
     */
    class ModuleGeneratorPlugin extends Plugin {
        constructor(config, ownerModuleId) {
            super(config, ownerModuleId);
            this.inputSource = this.config.inputSource;
            this.outputFlow = this.config.outputFlow;
            this.moduleTemplate = this.config.moduleTemplate;
            this.lastAdd = null;
        }

        execute(context) {
            if (!this.moduleTemplate || !this.moduleTemplate.id) throw new Error(I18n.t('没有设置要生成的模块。'));
            if (!this.outputFlow) throw new Error(I18n.t('没有设置生成的模块放到哪条流程。'));
            var data;
            if (!this.inputSource || this.inputSource === 'builtin') {
                data = (context && context.builtinData) || {};
            } else {
                var src = context.pluginSystem && context.pluginSystem.getPlugin(this.inputSource, this.ownerModuleId);
                if (!src) throw new Error(I18n.t('要读取的插件「{name}」不存在。', { name: this.inputSource }));
                if (src.output === null || src.output === undefined) throw new Error(I18n.t('上游插件「{name}」还没有结果，先让它运行一次。', { name: src.name || src.id }));
                data = src.output && typeof src.output === 'object' ? src.output : { value: src.output };
            }
            var newModule = this.generateModule(this.moduleTemplate, data);
            this.lastAdd = null;
            if (context.moduleSystem) {
                var added = context.moduleSystem.addDynamicModule(newModule, this.ownerModuleId, this.outputFlow);
                this.lastAdd = added ? { added: true } : { added: false, reason: I18n.t('已经有同编号的模块，没有重复添加；或放置的位置不存在。') };
            }
            return newModule;
        }

        generateModule(template, data) {
            return fillTemplate(RT.cloneJson(template), data || {});
        }
    }

    /**
     * 显示、交互类插件共用：界面内容 + 绑定的变量
     */
    class FacePlugin extends Plugin {
        constructor(config, ownerModuleId) {
            super(config, ownerModuleId);
            this.fixedWidth = this.config.fixedWidth || 300;
            this.minHeight = this.config.minHeight || 200;
            this.requiredVariables = this.config.requiredVariables || [];
        }

        faceResult(context) {
            var doc = this.displayDoc();
            return { html: doc.html, css: doc.css, variables: varsFor(this, context), width: this.fixedWidth, minHeight: this.minHeight };
        }
    }

    class DisplayPlugin extends FacePlugin {
        execute(context) { return this.faceResult(context); }
    }

    /**
     * InteractivePlugin —— 玩家操作 + AI 回复：promptTemplate 代入变量后发给 AI，回复块按 replyBinding 写回变量
     */
    class InteractivePlugin extends FacePlugin {
        constructor(config, ownerModuleId) {
            super(config, ownerModuleId);
            this.promptTemplate = this.config.promptTemplate;
            this.outputFormat = this.config.outputFormat;
            this.blockId = this.config.blockId || this.id;
            this.userInteraction = this.config.userInteraction;
        }

        execute(context) {
            var prompt = '';
            if (context.variableSystem) {
                prompt = RT.buildPrompt(this.def, storeOf(context)).text;
                // 第一个选定的变量当作暂存：为空就不发内容给 AI
                if (this.requiredVariables.length > 0) {
                    var staging = context.variableSystem.getValue(this.requiredVariables[0]);
                    if (staging === undefined || staging === null || (typeof staging === 'string' && staging.trim() === '')) prompt = '';
                }
            }
            var result = { prompt: prompt, outputFormat: this.outputFormat, blockId: this.blockId, userInteraction: this.userInteraction };
            var doc = this.displayDoc();
            if (doc.html && context.variableSystem) {
                var face = this.faceResult(context);
                result.html = face.html; result.css = face.css; result.variables = face.variables; result.width = face.width; result.minHeight = face.minHeight;
            }
            return result;
        }
    }

    class DisplayInteractivePlugin extends FacePlugin {
        constructor(config, ownerModuleId) {
            super(config, ownerModuleId);
            this.updatePrompt = this.config.updatePrompt;
            this.blockId = this.config.blockId || this.id;
            this.outputFormat = this.config.outputFormat;
        }

        execute(context) {
            var result = this.faceResult(context);
            var prompt = '';
            if (this.updatePrompt != null && String(this.updatePrompt) !== '' && context.variableSystem) {
                prompt = RT.renderText(String(this.updatePrompt), RT.storeLookup(storeOf(context))).text;
            }
            result.updatePrompt = prompt;
            result.blockId = this.blockId;
            result.outputFormat = this.outputFormat;
            return result;
        }
    }

    /**
     * SummaryPlugin —— 把几个变量整理成一段总结文字，随提示词发给 AI
     */
    class SummaryPlugin extends Plugin {
        execute(context) {
            var r = RT.renderText(this.config.summaryTemplate || '', RT.storeLookup(storeOf(context)));
            return { text: r.text, missing: r.missing };
        }
    }

    var CLASS_BY_TYPE = {
        randomizer: RandomizerPlugin,
        variable_reader: VariableReaderPlugin,
        variable_op: VariableOpPlugin,
        module_generator: ModuleGeneratorPlugin,
        summary: SummaryPlugin,
        display: DisplayPlugin,
        interactive: InteractivePlugin,
        display_interactive: DisplayInteractivePlugin
    };

    /**
     * PluginSystem —— 管理所有插件。同一个编号可以挂在不同模块上（子级覆盖父级），所以按「模块 + 编号」登记。
     */
    class PluginSystem {
        constructor() {
            this.plugins = new Map();      // key: 模块|编号 → Plugin
            this.byId = new Map();         // 编号 → [Plugin]
            this.conditionEvaluator = null;
            this.baseModulePath = '';
            this.registerIssues = [];      // 登记时就发现的问题
            this.lastRunErrors = [];       // 最近一次自动运行里出错的插件
        }

        setConditionEvaluator(evaluator) { this.conditionEvaluator = evaluator; }

        setBaseModulePath(path) { this.baseModulePath = path; }

        /**
         * 登记一个插件。类型不认识、缺编号、同模块重复的不会登记，原因记进 registerIssues（界面上能看到）。
         */
        registerPlugin(pluginConfig, ownerModuleId) {
            var def = RT.normalize(pluginConfig);
            var label = def.name || def.id || I18n.t('未命名插件');
            if (!def.id) { this.registerIssues.push({ level: 'error', code: 'ID_MISSING', plugin: label, text: I18n.t('有一个插件没有编号，无法使用。'), hint: I18n.t('重新添加这个插件。') }); return null; }
            if (!def.type) {
                if (!RT.LEGACY_TYPES[def.rawType]) this.registerIssues.push({ level: 'error', code: 'TYPE_UNKNOWN', plugin: label, text: I18n.t('插件类型「{type}」不认识。', { type: def.rawType == null || def.rawType === '' ? I18n.t('空') : def.rawType }), hint: I18n.t('在类型里选一个已有的类型。') });
                return null;
            }
            var key = ownerModuleId + '|' + def.id;
            if (this.plugins.has(key)) {
                this.registerIssues.push({ level: 'error', code: 'ID_DUPLICATE', plugin: label, text: I18n.t('同一个模块下有两个编号相同的插件，后面这个没有生效。'), hint: I18n.t('删掉其中一个，或给它换个编号。') });
                return null;
            }
            var Cls = CLASS_BY_TYPE[def.type];
            var cfg = Object.assign({}, pluginConfig, { type: def.type });
            var plugin = new Cls(cfg, ownerModuleId);
            this.plugins.set(key, plugin);
            if (!this.byId.has(def.id)) this.byId.set(def.id, []);
            this.byId.get(def.id).push(plugin);
            return plugin;
        }

        registerPlugins(pluginConfigs, ownerModuleId) {
            var out = [];
            var self = this;
            (Array.isArray(pluginConfigs) ? pluginConfigs : []).forEach(function (c) {
                var p = self.registerPlugin(c, ownerModuleId);
                if (p) out.push(p);
            });
            return out;
        }

        /**
         * 按编号取插件。同一个编号有多个时，优先取 ownerModuleId 下的，否则取最先登记的。
         */
        getPlugin(pluginId, ownerModuleId) {
            var list = this.byId.get(pluginId);
            if (!list || !list.length) return undefined;
            if (ownerModuleId != null) {
                for (var i = 0; i < list.length; i++) if (list[i].ownerModuleId === ownerModuleId) return list[i];
            }
            return list[0];
        }

        getActivePlugins(type, ownerModuleId) {
            var active = [];
            for (var p of this.plugins.values()) {
                if (!p.shouldBeActive(this.conditionEvaluator)) continue;
                if (type != null && p.type !== type) continue;
                if (ownerModuleId != null && p.ownerModuleId !== ownerModuleId) continue;
                active.push(p);
            }
            return active;
        }

        getPluginsByType(type) {
            var out = [];
            for (var p of this.plugins.values()) if (p.type === type) out.push(p);
            return out;
        }

        loadAllFiles() {
            var jobs = [];
            for (var p of this.plugins.values()) jobs.push(p.loadFiles(this.baseModulePath));
            return Promise.all(jobs);
        }

        /** 所有登记问题 + 文件读取失败 + 配置校验的结果 */
        collectIssues(env) {
            var self = this;
            var out = this.registerIssues.slice();
            var siblingIds = [];
            this.plugins.forEach(function (p) { siblingIds.push(p.id); });
            this.plugins.forEach(function (p) {
                var e = Object.assign({}, env || {}, { files: p.fileReport(), siblingIds: siblingIds });
                RT.validate(p.def, e).forEach(function (i) { out.push(i); });
            });
            return out;
        }

        executePlugin(pluginId, context, ownerModuleId) {
            var plugin = this.getPlugin(pluginId, ownerModuleId);
            if (!plugin) throw new Error(I18n.t('插件「{name}」不存在。', { name: pluginId }));
            if (!plugin.shouldBeActive(this.conditionEvaluator)) throw new Error(I18n.t('插件「{name}」当前没有启用。', { name: plugin.name }));
            context.pluginSystem = this;
            return plugin.execute(context);
        }

        executePluginsByType(type, context) {
            var results = {};
            context.pluginSystem = this;
            for (var p of this.getPluginsByType(type)) {
                if (p.shouldBeActive(this.conditionEvaluator)) results[p.id] = p.execute(context);
            }
            return results;
        }

        /**
         * 进入模块时运行该模块下的一次性插件，顺序：随机器 → 变量读取器 → 变量操作器 → 模块生成器。
         * 返回 { results, errors }：某个插件出错只记录，不影响后面的插件。
         */
        runOneShot(moduleId, context) {
            var results = {}, errors = [];
            context.pluginSystem = this;
            var order = ['randomizer', 'variable_reader', 'variable_op', 'module_generator'];
            for (var t = 0; t < order.length; t++) {
                for (var p of this.plugins.values()) {
                    if (p.type !== order[t] || p.ownerModuleId !== moduleId) continue;
                    if (!p.shouldBeActive(this.conditionEvaluator)) continue;
                    try { results[p.id] = p.execute(context); }
                    catch (e) { results[p.id] = null; errors.push({ pluginId: p.id, plugin: p.name || p.id, message: e && e.message ? e.message : String(e) }); }
                }
            }
            this.lastRunErrors = errors;
            return { results: results, errors: errors };
        }

        runOneShotPluginsForModule(moduleId, context) {
            return this.runOneShot(moduleId, context).results;
        }
    }

    if (typeof window !== 'undefined') {
        window.PLUGIN_TYPES = PLUGIN_TYPES;
        window.PLUGIN_CONDITION_TYPES = PLUGIN_CONDITION_TYPES;
        window.PluginSystem = PluginSystem;
        window.Plugin = Plugin;
        window.RandomizerPlugin = RandomizerPlugin;
        window.VariableReaderPlugin = VariableReaderPlugin;
        window.VariableOpPlugin = VariableOpPlugin;
        window.ModuleGeneratorPlugin = ModuleGeneratorPlugin;
        window.SummaryPlugin = SummaryPlugin;
        window.DisplayPlugin = DisplayPlugin;
        window.InteractivePlugin = InteractivePlugin;
        window.DisplayInteractivePlugin = DisplayInteractivePlugin;
    }
})();
