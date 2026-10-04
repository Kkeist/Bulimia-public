/**
 * 插件注册表（真实游戏里的插件运行层）。
 *
 *   收集：从当前故事沿「根 → 当前路径上每一层模块」收集插件登记，同一个编号子级覆盖父级；
 *   校验：缺文件 / 文件损坏 / 类型不认识 / 重复编号 / 变量不存在 等问题在载入时就记录（getIssues），并显示在插件区；
 *   显示：显示器、交互器、显示+交互器用 PluginRenderer.mount 放进隔离页面，左右两侧各一个容器；
 *   动作：插件界面里的点击、输入 → 按插件配置改变量 + 进入「暂存操作」，玩家点发送时一起发给 AI；
 *   回复：AI 回复里的插件块按配置写回变量；
 *   一次性插件：进入模块时按「随机器 → 变量读取器 → 变量操作器 → 模块生成器」运行；
 *   旧式插件（pluginConfigs 单独配置的几种）见 plugin-legacy.js。
 */
(function () {
    'use strict';
    var RT = window.PluginRuntime;
    var MODULE_FOLDER = 'module';
    var WATCH_MS = 500;

    function curModule() {
        if (!window.ModuleManager) return null;
        return (ModuleManager.getCurrent ? ModuleManager.getCurrent() : ModuleManager.currentModule) || null;
    }

    function currentPathIds() {
        if (typeof State === 'undefined' || !State.currentModulePath) return [];
        var p = State.currentModulePath;
        return Array.isArray(p[0]) ? (p[0] || []) : p;
    }

    function inferType(v) {
        if (Array.isArray(v)) return 'list';
        if (v !== null && typeof v === 'object') return 'object';
        if (typeof v === 'boolean') return 'boolean';
        if (typeof v === 'number') return 'number';
        return 'string';
    }

    function validType(type, v) {
        switch (type) {
            case 'number': return typeof v === 'number' && isFinite(v);
            case 'string': return typeof v === 'string';
            case 'boolean': case 'switch': return typeof v === 'boolean';
            case 'list': case 'list_of_object': return Array.isArray(v);
            case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v);
            default: return true;
        }
    }

    /**
     * 以 State.variables 为存放处、以模组里的变量定义为类型来源的「变量系统」。
     * 提供插件运行层需要的接口：getVariable / getValue / executeOperation('set') / variables。
     */
    function makeStateVariableSystem(cur, extraDefs) {
        var defs = {};
        var list = [];
        list = (window.ModuleManager && ModuleManager.getAllVariableDefs) ? ModuleManager.getAllVariableDefs(cur) : [];
        list.forEach(function (d) { if (d && d.id != null) defs[d.id] = d; });
        (extraDefs || []).forEach(function (d) { if (d && !defs[d.id]) defs[d.id] = d; });
        function vars() { if (!State.variables) State.variables = {}; return State.variables; }
        var vs = {
            getVariable: function (id) {
                var d = defs[id];
                var cv = vars()[id];
                if (d) return { id: d.id, name: d.name || d.id, type: d.type || 'string', readonly: !!d.readOnly };
                if (cv !== undefined) return { id: id, name: id, type: inferType(cv), readonly: false };
                return undefined;
            },
            getValue: function (id) {
                var v = vars()[id];
                if (v !== undefined) return v;
                return defs[id] ? defs[id].value : undefined;
            },
            executeOperation: function (id, op, params) {
                var info = vs.getVariable(id);
                if (!info || info.readonly || op !== 'set') return false;
                var value = params && typeof params === 'object' && 'value' in params ? params.value : params;
                if (!validType(info.type, value)) return false;
                vars()[id] = RT.cloneJson(value);
                return true;
            }
        };
        Object.defineProperty(vs, 'variables', {
            get: function () {
                var m = new Map();
                Object.keys(defs).forEach(function (id) { m.set(id, vs.getVariable(id)); });
                Object.keys(vars()).forEach(function (id) { if (!m.has(id) && vars()[id] !== undefined) m.set(id, vs.getVariable(id)); });
                return m;
            }
        });
        return vs;
    }

    var Registry = {
        plugins: new Map(),
        activePlugins: new Set(),
        system: null,
        issues: [],
        TYPES: { GLOBAL: 'global', INTERACTIVE: 'interactive', BUILTIN: 'builtin', STATUS: 'status' },

        _run: 0,
        _ready: Promise.resolve(),
        _cache: new Map(),
        _widgets: new Map(),
        _watchTimer: null,
        _condSig: '',
        _enteredPath: undefined,
        _seenSaveId: undefined,

        // ---------- 启动 ----------
        init: function () {
            var self = this;
            return this.registerFromModule().then(function () {
                if (window.Events && window.EVENT_TYPES) {
                    Events.on(EVENT_TYPES.MODULE_LOADED, function () { self.clearCache(); self.registerFromModule(); });
                    Events.on(EVENT_TYPES.GAME_FLOW_UPDATE, function (data) {
                        self.updateActivePlugins(data && data.plugins ? data.plugins : null);
                    });
                }
            });
        },

        clearCache: function () { this._cache.clear(); },

        // ---------- 收集 ----------
        /** 沿根 → 当前路径逐层收集插件登记。同一个编号子级覆盖父级。 */
        _collect: function (cur) {
            var content = cur.content || {};
            var pathIds = currentPathIds();
            var layers = [];
            var issues0 = [];
            var missingId = null;
            layers.push({ ownerId: cur.id, ownerName: cur.name || cur.id, list: content.plugins });
            var node = content;
            for (var i = 0; i < pathIds.length; i++) {
                var subs = Array.isArray(node && node.subModules) ? node.subModules : [];
                var found = null;
                for (var j = 0; j < subs.length; j++) if ((subs[j].id || subs[j].name) === pathIds[i]) { found = subs[j]; break; }
                if (!found) { missingId = pathIds[i]; break; }
                node = found;
                layers.push({ ownerId: found.id || found.name, ownerName: found.name || found.id, list: found.plugins });
            }
            // 生成器模板里自带的插件：路径正好在该模板生成的模块上时才有效
            (Array.isArray(content.plugins) ? content.plugins : []).forEach(function (item) {
                if (item && item.type === 'module_generator' && item.config && item.config.moduleTemplate) {
                    var tpl = item.config.moduleTemplate;
                    if (pathIds.length && pathIds[pathIds.length - 1] === tpl.id && Array.isArray(tpl.plugins)) {
                        layers.push({ ownerId: tpl.id, ownerName: tpl.name || tpl.id, list: tpl.plugins });
                        if (missingId === tpl.id) missingId = null;
                    }
                }
            });
            if (missingId !== null) {
                issues0.push({ level: 'warn', code: 'OWNER_MISSING', plugin: I18n.t('当前位置'), text: I18n.t('当前所在的模块「{id}」已经不在模组里，它和它下面各层的插件没有加载。', { id: missingId }), hint: I18n.t('回到上一层模块，或在模组编辑里把它加回来。') });
            }
            var issues = issues0;
            var byId = new Map();
            var order = [];
            layers.forEach(function (layer, depth) {
                var seenHere = {};
                (Array.isArray(layer.list) ? layer.list : []).forEach(function (raw) {
                    if (!raw || typeof raw !== 'object') {
                        issues.push({ level: 'error', code: 'ENTRY_BROKEN', plugin: layer.ownerName, text: I18n.t('「{name}」里有一条插件登记不是正确的格式，已忽略。', { name: layer.ownerName }), hint: I18n.t('在模组编辑里重新添加这个插件。') });
                        return;
                    }
                    var id = raw.id == null ? '' : String(raw.id);
                    if (!id) { issues.push({ level: 'error', code: 'ID_MISSING', plugin: raw.name || I18n.t('未命名插件'), text: I18n.t('有一个插件没有编号，无法使用。'), hint: I18n.t('重新添加这个插件。') }); return; }
                    if (seenHere[id]) {
                        issues.push({ level: 'error', code: 'ID_DUPLICATE', plugin: raw.name || id, text: I18n.t('「{name}」下有两个编号相同的插件，后面这个没有生效。', { name: layer.ownerName }), hint: I18n.t('删掉其中一个，或给它换个编号。') });
                        return;
                    }
                    seenHere[id] = true;
                    var item = { raw: raw, id: id, ownerId: layer.ownerId, ownerName: layer.ownerName, depth: depth, overrides: [] };
                    if (byId.has(id)) item.overrides = byId.get(id).overrides.concat([byId.get(id).ownerName]);
                    else order.push(id);
                    byId.set(id, item);
                });
            });
            return { items: order.map(function (id) { return byId.get(id); }), issues: issues };
        },

        // ---------- 登记 ----------
        registerFromModule: function () {
            var self = this;
            var run = ++this._run;
            var cur = curModule();
            if (!cur) {
                this.plugins.clear();
                this.activePlugins.clear();
                this.issues = [];
                this.system = null;
                this.renderUI();
                return Promise.resolve();
            }
            var folder = cur.folderKey || String(cur.id || '').replace(/^story_/, '');
            var modulePath = MODULE_FOLDER + '/' + folder;
            var collected = this._collect(cur);
            var pluginConfigs = (cur.content && cur.content.pluginConfigs) || {};

            // 存档切换后，「上次进入的路径」重新以当前存档为准（不重复触发进入时的一次性插件）
            var saveId = (typeof State !== 'undefined' && State.currentSaveId) || '';
            if (this._seenSaveId !== saveId || this._enteredPath === undefined) {
                this._seenSaveId = saveId;
                var inProgress = typeof State !== 'undefined' && Array.isArray(State.chatHistory) && State.chatHistory.length > 0;
                this._enteredPath = inProgress ? currentPathIds().slice() : null;
            }

            var legacyItems = [];
            var newItems = [];
            var legacyConfigPromises = [];
            collected.items.forEach(function (it) {
                var rawType = it.raw.type;
                var config = pluginConfigs[it.id] || (window.ModuleManager && ModuleManager.getPluginConfigSync ? ModuleManager.getPluginConfigSync(it.id) : null);
                var maybeLegacy = rawType === 'interactive-save' || rawType === 'status-display' || rawType === 'random-pool' || rawType === 'randomizer' || rawType === 'schedule-generator' || rawType === 'trigger-chain-generator';
                if (!config && maybeLegacy && (rawType === 'interactive-save' || rawType === 'status-display' || rawType === 'random-pool') && window.ModuleManager && ModuleManager.getPluginConfig) {
                    legacyConfigPromises.push(ModuleManager.getPluginConfig(it.id).then(function (c) { if (c) pluginConfigs[it.id] = c; return c; }));
                }
                if (config && window.PluginLegacy && PluginLegacy.handles(rawType, config)) legacyItems.push({ it: it, config: config });
                else if (rawType === 'interactive-save' || rawType === 'schedule-generator' || rawType === 'trigger-chain-generator') legacyItems.push({ it: it, config: config });
                else newItems.push(it);
            });

            var legacyScripts = [];
            collected.items.forEach(function (it) {
                var s = it.raw.script;
                if (s && legacyScripts.indexOf(s) < 0) legacyScripts.push(s);
            });

            var loadLegacy = Promise.all(legacyConfigPromises).then(function () {
                return Promise.all(legacyScripts.map(function (s) {
                    return PluginLegacy.loadModulePluginScript(folder, s).then(function () { return null; }, function (e) { return e.message; });
                }));
            });

            var fileJobs = newItems.map(function (it) {
                var def = RT.normalize(it.raw);
                return PluginRenderer.loadFiles(def, { modulePath: modulePath, cache: self._cache }).then(function (files) {
                    if (files.pool && files.pool.text != null) {
                        try { files.pool = { text: files.pool.text, value: JSON.parse(files.pool.text) }; }
                        catch (e) { files.pool = { error: I18n.t('随机池文件内容格式不对：{file}。', { file: def.files.pool }), notFound: false }; }
                    }
                    return { it: it, def: def, files: files };
                });
            });

            var done = Promise.all([loadLegacy, Promise.all(fileJobs)]).then(function (res) {
                if (run !== self._run) return;
                self._apply(cur, modulePath, collected, legacyItems, res[0], res[1]);
            });
            this._ready = done;
            return done;
        },

        /** 等到最新一次登记完成（登记过程中又被重新触发时，等最后那一次） */
        whenReady: function () {
            var self = this;
            var r = this._ready;
            return r.then(function () { return r !== self._ready ? self.whenReady() : null; });
        },

        _apply: function (cur, modulePath, collected, legacyItems, legacyScriptErrors, loaded) {
            var self = this;
            var issues = collected.issues.slice();
            legacyScriptErrors.forEach(function (m) { if (m) issues.push({ level: 'error', code: 'FILE_MISSING', plugin: I18n.t('旧式插件'), text: m, hint: I18n.t('检查脚本文件是否在模组文件夹里。') }); });

            var system = new PluginSystem();
            var extraDefs = [];
            var siblingIds = collected.items.map(function (i) { return i.id; });
            var defsById = {};
            try { (ModuleManager.getAllVariableDefs(cur) || []).forEach(function (d) { defsById[d.id] = d; }); }
            catch (e) { issues.push({ level: 'error', code: 'VARS_FAILED', plugin: I18n.t('变量'), text: I18n.t('读取模组的变量时出错：{error}', { error: e.message }), hint: I18n.t('检查模组里的变量设置。') }); }
            loaded.forEach(function (l) {
                var cfg = l.def.config || {};
                if (cfg.tempStorage) extraDefs.push({ id: cfg.tempStorage, name: cfg.tempStorage, type: 'object', value: null });
                (l.def.tempVariables || []).forEach(function (t) { if (t && t.id) extraDefs.push({ id: t.id, name: t.name || t.id, type: t.type || 'string', value: t.initialValue == null ? null : t.initialValue }); });
            });
            var tempIds = {};
            extraDefs.forEach(function (d) { tempIds[d.id] = d; });
            var stateVars = (typeof State !== 'undefined' && State.variables) || {};
            var env = {
                hasVariable: function (id) { return !!defsById[id] || !!tempIds[id] || (stateVars[id] !== undefined); },
                variableName: function (id) { return (defsById[id] && defsById[id].name) || (tempIds[id] && tempIds[id].name) || id; },
                siblingIds: siblingIds
            };

            var entries = new Map();
            loaded.forEach(function (l) {
                var it = l.it, def = l.def;
                var found = RT.validate(def, Object.assign({}, env, { files: l.files }));
                found.forEach(function (i) { issues.push(i); });
                if (!def.type) return;
                var plugin = system.registerPlugin(it.raw, it.ownerId);
                if (!plugin) return;
                if (l.files.display && l.files.display.text != null) plugin.loadedFiles.display = l.files.display.text;
                if (l.files.style && l.files.style.text != null) plugin.loadedFiles.style = l.files.style.text;
                if (l.files.logic && l.files.logic.text != null) plugin.loadedFiles.logic = l.files.logic.text;
                if (l.files.pool && l.files.pool.value !== undefined) plugin.loadedFiles.pool = l.files.pool.value;
                var hasFace = RT.hasFrontend(def.type);
                var uiType = def.type === 'display' ? self.TYPES.STATUS : (hasFace ? self.TYPES.INTERACTIVE : self.TYPES.GLOBAL);
                var cfg = def.config || {};
                var entry = {
                    id: def.id,
                    name: def.name || def.id,
                    type: uiType,
                    pluginType: def.type,
                    description: cfg.description || def.note || '',
                    config: cfg,
                    files: def.files,
                    hasFrontend: hasFace,
                    ownerModuleId: it.ownerId,
                    ownerName: it.ownerName,
                    overrides: it.overrides,
                    def: def,
                    plugin: plugin,
                    sig: RT.safeStringify({ d: def, o: it.ownerId, f: Object.keys(l.files).map(function (k) { return l.files[k].text ? l.files[k].text.length : (l.files[k].error || ''); }) })
                };
                entry.render = function (container) { self._renderInto(container, entry); };
                entries.set(def.id, entry);
            });
            system.registerIssues.forEach(function (i) { issues.push(i); });

            this.system = system;
            this.issues = issues;
            this._modulePath = modulePath;
            this._extraDefs = extraDefs;
            this._cur = cur;

            // 旧式插件
            var oldEntries = new Map();
            var holder = { TYPES: this.TYPES, plugins: oldEntries, register: function (id, config) {
                oldEntries.set(id, Object.assign({ id: id }, config));
                if (config.onInit) { try { config.onInit(); } catch (e) { issues.push({ level: 'error', code: 'LEGACY_INIT', plugin: config.name || id, text: I18n.t('旧式插件初始化出错：{error}', { error: e.message }), hint: '' }); } }
            } };
            legacyItems.forEach(function (l) {
                try { PluginLegacy.register(holder, l.it.id, l.it.raw.type, l.config, l.it.raw.name); }
                catch (e) { issues.push({ level: 'error', code: 'LEGACY_REGISTER', plugin: l.it.raw.name || l.it.id, text: I18n.t('旧式插件登记出错：{error}', { error: e.message }), hint: '' }); }
            });

            // 只存在于 pluginConfigs 里、没有登记在模块上的旧式插件
            var cfgs = (cur.content && cur.content.pluginConfigs) || {};
            Object.keys(cfgs).forEach(function (cid) {
                if (entries.has(cid) || oldEntries.has(cid)) return;
                var c = cfgs[cid];
                if (c && PluginLegacy.handles(c.type, c)) {
                    try { PluginLegacy.register(holder, cid, c.type, c, c.label || c.name || cid); }
                    catch (e) { issues.push({ level: 'error', code: 'LEGACY_REGISTER', plugin: c.label || c.name || cid, text: I18n.t('旧式插件登记出错：{error}', { error: e.message }), hint: '' }); }
                }
            });

            var next = new Map();
            entries.forEach(function (e, id) { next.set(id, e); });
            oldEntries.forEach(function (e, id) { if (!next.has(id)) next.set(id, e); });
            this.plugins = next;

            // 激活：旧式的全局插件自动激活；显示类插件满足条件、并且模组没有另行限定时激活
            var open = Array.isArray(cur.content && cur.content.openPlugins) ? cur.content.openPlugins : [];
            open.forEach(function (id) {
                if (!next.has(id)) issues.push({ level: 'warn', code: 'OPEN_MISSING', plugin: String(id), text: I18n.t('模组设置了要显示的插件「{id}」，但当前没有这个插件。', { id: id }), hint: I18n.t('在模组编辑里添加它，或从显示列表里去掉。') });
            });
            var active = new Set();
            next.forEach(function (e, id) {
                if (e.type === self.TYPES.GLOBAL && !e.def) { active.add(id); return; }
                if (!e.hasFrontend) return;
                if (open.length && open.indexOf(id) < 0) return;
                if (e.def && !self._conditionMet(e.def)) return;
                active.add(id);
            });
            // 手动在调试里显示 / 隐藏过的，沿用
            if (this._manualActive) this._manualActive.forEach(function (v, id) { if (next.has(id) && next.get(id).hasFrontend) { if (v) active.add(id); else active.delete(id); } });
            this.activePlugins = active;
            this.renderUI();
            this._startWatch();
        },

        _conditionMet: function (def) {
            var c = def.condition || {};
            if (def.enabled === false) return false;
            if (!c.type || c.type === 'always') return true;
            if (!c.conditionDef || !window.ModuleManager || !ModuleManager._evaluateCondition) return true;
            try { return !!ModuleManager._evaluateCondition(c.conditionDef, State.variables || {}, this._cur); }
            catch (e) { this._reportIssue({ level: 'warn', code: 'CONDITION_ERROR', plugin: def.name || def.id, text: I18n.t('触发条件无法判断：{error}', { error: e.message }), hint: I18n.t('检查这个插件的触发条件。') }); return false; }
        },

        register: function (id, config) {
            this.plugins.set(id, Object.assign({ id: id }, config));
            if (config.onInit) config.onInit();
            if (config.type === this.TYPES.GLOBAL) this.activate(id);
        },

        activate: function (id) {
            if (!this.plugins.has(id) || this.activePlugins.has(id)) return;
            this._manualActive = this._manualActive || new Map();
            this._manualActive.set(id, true);
            this.activePlugins.add(id);
            this.renderUI();
        },

        deactivate: function (id) {
            if (!this.activePlugins.has(id)) return;
            var p = this.plugins.get(id);
            if (p && p.type === this.TYPES.GLOBAL) return;
            this._manualActive = this._manualActive || new Map();
            this._manualActive.set(id, false);
            this.activePlugins.delete(id);
            this.renderUI();
        },

        updateActivePlugins: function (activeIds) {
            var self = this;
            if (Array.isArray(activeIds)) {
                var keep = new Set();
                this.activePlugins.forEach(function (id) { var p = self.plugins.get(id); if (p && p.type === self.TYPES.GLOBAL) keep.add(id); });
                activeIds.forEach(function (id) { if (self.plugins.has(id)) keep.add(id); });
                this.activePlugins = keep;
            }
            this.renderUI();
        },

        /** 运行中发现的问题：同一条只记一次，并刷新插件区的提示 */
        _reportIssue: function (issue) {
            var dup = this.issues.some(function (i) { return i.code === issue.code && i.plugin === issue.plugin && i.text === issue.text; });
            if (dup) return;
            this.issues.push(issue);
            this.renderUI();
        },

        // ---------- 变量 ----------
        _variableSystem: function () {
            return makeStateVariableSystem(this._cur || curModule(), this._extraDefs);
        },

        _store: function () {
            return RT.storeFromVariableSystem(this._variableSystem());
        },

        _save: function () {
            if (window.App && App.autoSaveToCurrentSlot) {
                try { App.autoSaveToCurrentSlot(); }
                catch (e) { if (window.Toast) Toast.show(I18n.t('插件改动的变量没能存档：{error}', { error: e.message }), 'error'); else throw e; }
            }
        },

        // ---------- 显示 ----------
        _issuesFor: function (id) {
            var name = (this.plugins.get(id) && this.plugins.get(id).name) || '';
            return this.issues.filter(function (i) { return i.plugin === name; });
        },

        _faceFor: function (entry) {
            var self = this;
            var vs = null;
            return PluginRenderer.makeFace(entry.def, {
                modulePath: this._modulePath,
                cache: this._cache,
                getValue: function (id) { if (!vs) vs = self._variableSystem(); return vs.getValue(id); }
            });
        },

        _mountEntry: function (container, entry) {
            var self = this;
            var face = this._faceFor(entry);
            var inst = PluginRenderer.mount(container, face, {
                onAction: function (msg) { self.handleAction(entry.id, msg, inst); }
            });
            return { face: face, inst: inst };
        },

        _renderInto: function (container, entry) {
            if (!container) return;
            container.innerHTML = '';
            if (entry.hasFrontend) { this._mountEntry(container, entry); return; }
            var d = document.createElement('div');
            d.className = 'plugin-item';
            d.textContent = I18n.t('{type}：进入所属模块时自动运行，没有界面。', { type: RT.typeLabel(entry.pluginType) });
            container.appendChild(d);
        },

        refreshVars: function () {
            var vs = this._variableSystem();
            this._widgets.forEach(function (w) {
                if (!w.face) return;
                var m = {};
                w.face.boundIds().forEach(function (k) { m[k] = vs.getValue(k); });
                w.inst.setVars(m);
            });
        },

        _startWatch: function () {
            var self = this;
            if (this._watchTimer) return;
            this._watchTimer = setInterval(function () {
                if (document.hidden || !self._widgets.size && !self.plugins.size) return;
                try {
                    self.refreshVars();
                    var sig = '';
                    self.plugins.forEach(function (e, id) { if (e.def && e.hasFrontend && e.def.condition && e.def.condition.type && e.def.condition.type !== 'always') sig += id + (self._conditionMet(e.def) ? '1' : '0'); });
                    if (sig !== self._condSig) { self._condSig = sig; if (self._condSigReady) self.registerFromModule(); self._condSigReady = true; }
                } catch (e) { self._reportIssue({ level: 'error', code: 'REFRESH_FAILED', plugin: I18n.t('插件'), text: I18n.t('刷新插件界面时出错：{error}', { error: e.message }), hint: '' }); }
            }, WATCH_MS);
        },

        /** 把当前激活的插件放进左右两侧；界面没变的插件保留原来的页面，不重新载入 */
        renderUI: function () {
            var left = document.getElementById('left-plugins-container');
            var right = document.getElementById('right-plugins-container');
            if (!left || !right) return;
            var self = this;
            var wanted = [];
            this.activePlugins.forEach(function (id) {
                var e = self.plugins.get(id);
                if (e && e.hasFrontend) wanted.push(e);
            });
            // 去掉不再需要的
            this._widgets.forEach(function (w, id) {
                var e = self.plugins.get(id);
                var still = wanted.indexOf(e) >= 0 && e.sig === w.sig;
                if (!still) { w.inst.destroy(); if (w.wrapper.parentNode) w.wrapper.parentNode.removeChild(w.wrapper); self._widgets.delete(id); }
            });
            // 问题提示
            this._renderIssues(left);
            wanted.forEach(function (e) {
                var side = (e.def ? RT.sideOf(e.def.type, e.config) === 'right' : e.type === self.TYPES.STATUS) ? right : left;
                var w = self._widgets.get(e.id);
                if (!w) {
                    var wrapper = document.createElement('div');
                    wrapper.className = 'plugin-widget plugin-' + e.type;
                    wrapper.id = 'plugin-' + e.id;
                    var header = document.createElement('div');
                    header.className = 'plugin-widget-header';
                    var title = document.createElement('span');
                    title.className = 'plugin-widget-title';
                    title.textContent = e.name;
                    var toggle = document.createElement('button');
                    toggle.type = 'button';
                    toggle.className = 'plugin-widget-toggle';
                    toggle.setAttribute('aria-label', I18n.t('折叠或展开'));
                    toggle.textContent = I18n.t('收起');
                    header.appendChild(title);
                    header.appendChild(toggle);
                    var content = document.createElement('div');
                    content.className = 'plugin-widget-content';
                    wrapper.appendChild(header);
                    wrapper.appendChild(content);
                    var flip = function () {
                        wrapper.classList.toggle('collapsed');
                        toggle.textContent = wrapper.classList.contains('collapsed') ? I18n.t('展开') : I18n.t('收起');
                    };
                    header.addEventListener('click', flip);
                    var m = self._mountEntry(content, e);
                    w = { wrapper: wrapper, face: m.face, inst: m.inst, sig: e.sig };
                    self._widgets.set(e.id, w);
                }
                if (w.wrapper.parentNode !== side) side.appendChild(w.wrapper);
            });
        },

        _renderIssues: function (left) {
            var box = left.querySelector('.plugin-issues');
            var list = this.issues;
            if (!list.length) { if (box) box.parentNode.removeChild(box); return; }
            if (!box) {
                box = document.createElement('div');
                box.className = 'plugin-issues';
                left.insertBefore(box, left.firstChild);
            }
            var frag = document.createDocumentFragment();
            var head = document.createElement('div');
            head.className = 'plugin-issues-head';
            head.textContent = I18n.t('有 {n} 个插件问题', { n: list.length });
            frag.appendChild(head);
            list.forEach(function (i) {
                var row = document.createElement('div');
                row.className = 'plugin-issue plugin-issue-' + i.level;
                var t = document.createElement('div');
                t.className = 'plugin-issue-text';
                t.textContent = I18n.t('「{name}」{text}', { name: i.plugin, text: i.text });
                row.appendChild(t);
                if (i.hint) {
                    var h = document.createElement('div');
                    h.className = 'plugin-issue-hint';
                    h.textContent = i.hint;
                    row.appendChild(h);
                }
                frag.appendChild(row);
            });
            box.innerHTML = '';
            box.appendChild(frag);
        },

        getIssues: function () { return this.issues.slice(); },

        // ---------- 动作与回复 ----------
        /** 插件界面里的一次点击或输入 */
        handleAction: function (pluginId, msg, inst) {
            var entry = this.plugins.get(pluginId);
            if (!entry || !entry.def) return;
            var store = this._store();
            var res = RT.runAction(entry.def, msg, store);
            if (res.changes.length) this._save();
            if (res.errors.length && inst && inst.notice) inst.notice(I18n.t('这次操作没有完全生效：{errors}', { errors: res.errors.join(I18n.t('；')) }));
            if (res.pendingText && window.App && App.addPendingPluginAction) {
                App.addPendingPluginAction({ pluginId: pluginId, pluginName: entry.name, type: msg.action, label: msg.label, text: msg.text, actionDesc: res.pendingText, timestamp: Date.now() });
                if (App.renderPendingPluginActions) App.renderPendingPluginActions();
            }
            this.refreshVars();
        },

        /** 插件收到 AI 回复后，把没能写入的原因显示在它的界面上方；变量变了就刷新界面。 */
        noteReply: function (pluginId, info) {
            var w = this._widgets.get(pluginId);
            if (w) {
                if (info.unbound) w.inst.notice(I18n.t('AI 回复了这个插件，但还没有设置回复要写进哪个变量。'));
                else if (info.errors && info.errors.length) w.inst.notice(I18n.t('AI 的回复没有完全写入：{errors}', { errors: info.errors.join(I18n.t('；')) }));
                else if (info.truncated) w.inst.notice(I18n.t('AI 的回复太长，只保留了前 5000 个字。'));
            }
            this.refreshVars();
        },

        // ---------- 进入模块时的一次性插件 ----------
        /**
         * 进入路径 pathIds：运行新进入的那些层（含刚进入的模块）下的一次性插件。
         * 新游戏的第一次进入也包含故事根上的插件。返回 Promise<{ ran, errors }>。
         */
        onEnter: function (pathIds) {
            var self = this;
            return this.whenReady().then(function () { return self._runEnter(pathIds); });
        },

        _runEnter: function (pathIds) {
            var cur = this._cur || curModule();
            var all = { ran: [], errors: [] };
            if (!cur || !this.system) return all;
            var ids = Array.isArray(pathIds) ? pathIds.slice() : [];
            var prev = this._enteredPath;
            var common = 0;
            if (Array.isArray(prev)) while (common < prev.length && common < ids.length && prev[common] === ids[common]) common++;
            var entered = [];
            if (prev === null || prev === undefined) entered.push(cur.id);
            for (var i = common; i < ids.length; i++) entered.push(ids[i]);
            this._enteredPath = ids;
            if (!entered.length) return all;
            var self = this;
            var context = {
                variableSystem: this._variableSystem(),
                moduleSystem: {
                    addDynamicModule: function (mod, ownerId, flow) {
                        var ok = window.ModuleManager && ModuleManager.addDynamicSubModuleFromRaw && ModuleManager.addDynamicSubModuleFromRaw(mod, flow);
                        return ok ? { id: mod.id } : null;
                    }
                }
            };
            entered.forEach(function (moduleId) {
                var r = self.system.runOneShot(moduleId, context);
                Object.keys(r.results).forEach(function (pid) { if (r.results[pid] !== null) all.ran.push(pid); });
                r.errors.forEach(function (e) {
                    all.errors.push(e);
                    self.issues.push({ level: 'error', code: 'RUN_FAILED', plugin: e.plugin, text: I18n.t('进入模块时没能运行：{error}', { error: e.message }), hint: '' });
                });
            });
            if (all.ran.length) this._save();
            if (all.errors.length) this.renderUI();
            return all;
        }
    };

    window.PluginRegistry = Registry;
    window.PluginRegistryInternals = { makeStateVariableSystem: makeStateVariableSystem };
})();
