/**
 * 旧式插件（由模组 pluginConfigs 单独配置、由 InteractiveSaveDriver / RunRandomizer 驱动的那几种）的登记。
 * 覆盖类型：interactive-save、status-display、random-pool / randomizer（带 pluginConfigs）、schedule-generator、trigger-chain-generator。
 * 新写法的插件（直接写在模块 plugins 里、带 files / config 的）不走这里，见 plugin-registry.js。
 */
(function () {
    'use strict';
    var MODULE_FOLDER = 'module';

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function show(v) { return v === undefined || v === null ? '—' : (typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)); }

    /** 从模块目录动态加载一个脚本（旧式插件自带的脚本） */
    function loadModulePluginScript(moduleFolder, scriptPath) {
        var src = MODULE_FOLDER + '/' + moduleFolder + '/' + scriptPath;
        if (document.querySelector('script[src="' + src + '"]')) return Promise.resolve();
        return new Promise(function (resolve, reject) {
            var script = document.createElement('script');
            script.src = src;
            script.onload = function () { resolve(); };
            script.onerror = function () { reject(new Error('插件脚本没能载入：' + src)); };
            document.head.appendChild(script);
        });
    }

    /** 通用随机器：按 pluginConfigs 的 poolId、outputVariableId 从模组 random-pools 抽取并写入变量 */
    function runRandomizerGeneric(pluginId, opts) {
        var testOnly = opts && opts.testOnly === true;
        var cur = (typeof ModuleManager !== 'undefined' && ModuleManager.getCurrent) ? ModuleManager.getCurrent() : null;
        if (!cur || !cur.content || !cur.content.pluginConfigs) return Promise.resolve(testOnly ? null : undefined);
        var config = cur.content.pluginConfigs[pluginId];
        if (!config || (config.type !== 'randomizer' && config.type !== 'random-pool')) return Promise.resolve(testOnly ? null : undefined);
        var folderKey = cur.folderKey || (cur.id && cur.id.replace(/^story_/, '')) || '';
        var poolId = config.poolId;
        var outputVariableId = config.outputVariableId;
        if (!poolId || !outputVariableId) return Promise.resolve(testOnly ? null : undefined);

        var tryJson = function (url) {
            return fetch(url).then(function (r) { return r.ok ? r.json() : null; }, function () { return null; });
        };
        var chain = tryJson(MODULE_FOLDER + '/' + folderKey + '/random-pools/' + poolId + '.json').then(function (direct) {
            if (direct) return { poolData: direct, items: [] };
            var names = ['tasks.json', 'items.json', 'personality_pool.json'];
            var next = function (i) {
                if (i >= names.length) return Promise.resolve({ poolData: null, items: [] });
                return tryJson(MODULE_FOLDER + '/' + folderKey + '/random-pools/' + poolId + '/' + names[i]).then(function (data) {
                    if (!data) return next(i + 1);
                    var items = Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : []);
                    return items.length ? { poolData: data, items: items } : next(i + 1);
                });
            };
            return next(0);
        });
        return chain.then(function (found) {
            var poolData = found.poolData, items = found.items;
            var empty = function () {
                if (!testOnly && typeof State !== 'undefined' && State.variables) State.variables[outputVariableId] = [];
                if (window.Toast) Toast.show('随机池是空的：' + poolId, 'warning');
                return testOnly ? [] : undefined;
            };
            if (!poolData) return empty();
            var result;
            var Picker = (typeof window !== 'undefined' && window.RandomPoolPicker) || null;
            var isNewFormat = poolData && typeof poolData === 'object' && (poolData.poolType || poolData.sections || (Array.isArray(poolData.entries) && !poolData.items));
            if (Picker && isNewFormat) {
                var ctx = Object.assign({}, config.context || {});
                if (typeof State !== 'undefined' && State.variables) {
                    Object.keys(State.variables).forEach(function (vid) { if (!(vid in ctx)) ctx[vid] = State.variables[vid]; });
                }
                result = Picker.pickValue(poolData, ctx);
            } else {
                if (!items.length) items = Array.isArray(poolData.items) ? poolData.items : (Array.isArray(poolData) ? poolData : []);
                if (!items.length) return empty();
                var count = config.count != null ? Math.max(1, config.count) : 3;
                if (config.pickCount != null && typeof config.pickCount === 'object') {
                    var min = config.pickCount.min != null ? config.pickCount.min : count;
                    var max = config.pickCount.max != null ? config.pickCount.max : count;
                    count = min + Math.floor(Math.random() * (Math.max(min, max) - min + 1));
                } else if (config.pickCount != null) count = Math.max(1, Math.floor(Number(config.pickCount)));
                count = Math.min(count, items.length);
                var idx = [];
                while (idx.length < count) {
                    var i = Math.floor(Math.random() * items.length);
                    if (idx.indexOf(i) === -1) idx.push(i);
                }
                result = idx.map(function (i2) { return items[i2]; });
            }
            if (!testOnly) {
                if (typeof State !== 'undefined') {
                    if (!State.variables) State.variables = {};
                    State.variables[outputVariableId] = result;
                }
                if (window.App && window.App.autoSaveToCurrentSlot) window.App.autoSaveToCurrentSlot();
                if (window.Toast) Toast.show('已写入变量：' + outputVariableId + '，共 ' + (Array.isArray(result) ? result.length : 1) + ' 条', 'success');
            }
            return testOnly ? result : undefined;
        });
    }

    if (typeof window !== 'undefined' && typeof window.RunRandomizer === 'undefined') window.RunRandomizer = runRandomizerGeneric;

    function pid(id) { return String(id).replace(/"/g, '&quot;'); }

    function registerRandomizer(reg, id, name, type, cfg) {
        reg.register(id, {
            name: name, type: reg.TYPES.GLOBAL, description: cfg.description || '随机器，由事件触发', pluginType: type, config: cfg, hasFrontend: false,
            render: function (container) {
                if (!container) return;
                var custom = window.__PluginRenders__ && window.__PluginRenders__[id];
                if (custom) { try { custom(container, cfg); } catch (e) { container.innerHTML = '<div class="plugin-item">' + esc(e.message) + '</div>'; } return; }
                var outVarId = cfg.outputVariableId || '';
                var vars = (typeof State !== 'undefined' && State.variables) ? State.variables : {};
                var runBtn = typeof window.RunRandomizer === 'function' ? '<button type="button" class="btn-small plugin-test-run-randomizer" data-plugin-id="' + pid(id) + '">运行一次</button>' : '';
                var resetBtn = '<button type="button" class="btn-small plugin-test-reset" data-plugin-id="' + pid(id) + '">重置</button>';
                container.innerHTML = '<div class="plugin-item"><p class="plugin-test-hint">测试结果不存储，仅供预览</p><div class="plugin-test-output-var">输出变量：<code>' + esc(outVarId) + '</code></div><pre class="plugin-test-output-value">' + esc(show(outVarId ? vars[outVarId] : null)) + '</pre><div class="plugin-test-actions">' + runBtn + ' ' + resetBtn + '</div></div>';
                var run = container.querySelector('.plugin-test-run-randomizer');
                if (run) run.addEventListener('click', function () {
                    if (typeof window.RunRandomizer !== 'function') return;
                    window.RunRandomizer(id, { testOnly: true }).then(function (result) {
                        var pre = container.querySelector('.plugin-test-output-value');
                        if (pre) pre.textContent = show(result);
                    }, function (e) { if (window.Toast) Toast.show('运行失败：' + e.message, 'error'); });
                });
                var rs = container.querySelector('.plugin-test-reset');
                if (rs) rs.addEventListener('click', function () { var p = reg.plugins.get(id); if (p && p.render) p.render(container, cfg); });
            }
        });
    }

    function registerGenerator(reg, id, name, type, cfg) {
        var desc = type === 'schedule-generator' ? '排期生成器，由节点 linkedScheduleRandomizer 引用' : '触发器链生成器，由节点 linkedModuleGenerator 引用';
        var srcVarId = cfg.sourceVariableId || '';
        var randomizerId = cfg.randomizerId || null;
        reg.register(id, {
            name: name, type: reg.TYPES.GLOBAL, description: cfg.description || desc, pluginType: type, config: cfg, hasFrontend: false,
            render: function (container) {
                if (!container) return;
                var custom = window.__PluginRenders__ && window.__PluginRenders__[id];
                if (custom) { try { custom(container, cfg); } catch (e) { container.innerHTML = '<div class="plugin-item">' + esc(e.message) + '</div>'; } return; }
                var vars = (typeof State !== 'undefined' && State.variables) ? State.variables : {};
                var tempList = (typeof State !== 'undefined' && Array.isArray(State.temporaryGeneratedModules)) ? State.temporaryGeneratedModules : [];
                var tempLabel = type === 'schedule-generator' ? '测试生成的排期' : '测试生成的临时模块';
                var tempHtml = tempList.length ? '<div class="plugin-test-temp-list"><strong>' + tempLabel + '</strong>（' + tempList.length + ' 条）<ul>' + tempList.map(function (t) { return '<li>' + esc(typeof t === 'object' && t != null ? (t.name || t.id || t.content || JSON.stringify(t)) : String(t)) + '</li>'; }).join('') + '</ul></div>' : '';
                var formatHint = esc(cfg.outputFormat || cfg.requiredFormat || '') || '未设置输出格式';
                container.innerHTML = '<div class="plugin-item"><p class="plugin-test-hint">先运行随机器写入来源变量，再生成临时内容（仅测试，不写入模组）</p>' + esc(desc) + '<br/>来源变量：<code>' + esc(srcVarId) + '</code><pre class="plugin-test-output-value">' + esc(show(srcVarId ? vars[srcVarId] : null)) + '</pre>' + tempHtml + '<div class="plugin-test-format"><strong>需求格式</strong>：' + formatHint + '</div><div class="plugin-test-actions"><button type="button" class="btn-small plugin-test-run-generator">测试运行</button> <button type="button" class="btn-small plugin-test-reset">清除测试内容</button></div></div>';
                var again = function () { var p = reg.plugins.get(id); if (p && p.render) p.render(container, cfg); };
                var run = container.querySelector('.plugin-test-run-generator');
                if (run) run.addEventListener('click', function () {
                    var before = (randomizerId && typeof window.RunRandomizer === 'function') ? window.RunRandomizer(randomizerId, { testOnly: false }) : Promise.resolve();
                    before.then(function () {
                        var srcVal = srcVarId && State.variables ? State.variables[srcVarId] : null;
                        var list = Array.isArray(srcVal) ? srcVal : (srcVal != null ? [srcVal] : []);
                        State.temporaryGeneratedModules = list.slice(0, 50).map(function (x) { return typeof x === 'object' && x !== null ? { id: x.id, name: x.name || x.label, content: x.content || x.label } : { content: String(x) }; });
                        again();
                        if (window.Toast) Toast.show('已生成 ' + State.temporaryGeneratedModules.length + ' 条测试数据（仅测试）', 'success');
                    }, function (e) { if (window.Toast) Toast.show('测试运行失败：' + e.message, 'error'); });
                });
                var rs = container.querySelector('.plugin-test-reset');
                if (rs) rs.addEventListener('click', function () {
                    if (typeof State !== 'undefined') State.temporaryGeneratedModules = [];
                    again();
                    if (window.Toast) Toast.show('已清除测试内容', 'success');
                });
            }
        });
    }

    function registerInteractiveSave(reg, id, name, type, config) {
        var custom = window.__PluginRenders__ && window.__PluginRenders__[id];
        reg.register(id, {
            name: name, type: reg.TYPES.GLOBAL, description: config.description || '', pluginType: type, config: config, hasFrontend: true,
            render: function (container, testParams) {
                if (!container) return;
                if (custom) { try { window.__PluginRenders__[id](container, config, testParams); } catch (e) { container.innerHTML = '<div class="plugin-item">渲染出错：' + esc(e.message) + '</div>'; } return; }
                if (window.InteractiveSaveDriver) InteractiveSaveDriver.render(id, config, container, testParams);
                else container.innerHTML = '<div class="plugin-item">交互插件驱动没有载入</div>';
            },
            onInit: function () { if (!custom && window.InteractiveSaveDriver) InteractiveSaveDriver.init(id, config); }
        });
    }

    function registerStatusDisplay(reg, id, name, type, config) {
        var custom = window.__PluginRenders__ && window.__PluginRenders__[id];
        reg.register(id, {
            name: name, type: reg.TYPES.STATUS, description: config.description || '', pluginType: type, config: config, hasFrontend: true,
            render: function (container) {
                if (!container) return;
                if (custom) { try { window.__PluginRenders__[id](container, config); } catch (e) { container.innerHTML = '<div class="plugin-item">渲染出错：' + esc(e.message) + '</div>'; } return; }
                var vars = (typeof State !== 'undefined' && State.variables) ? State.variables : {};
                var personaNameKey = config.personaNameKey || 'persona_name';
                var labels = config.displayLabels || {};
                var keys = Array.isArray(config.displayVars) ? config.displayVars : [];
                if (keys.length === 0 && typeof ModuleManager !== 'undefined' && ModuleManager.getCurrent) {
                    var cur = ModuleManager.getCurrent();
                    var pathIds = (typeof State !== 'undefined' && State.currentModulePath && Array.isArray(State.currentModulePath[0])) ? State.currentModulePath[0] : [];
                    var inScope = typeof ModuleManager.getVariablesInScopeForPath === 'function' ? ModuleManager.getVariablesInScopeForPath(cur, pathIds, State.currentTimelineEventId || undefined) : [];
                    keys = inScope.map(function (x) { return x.def.id; }).filter(Boolean);
                }
                var lines = keys.map(function (key) {
                    var val;
                    if (key === personaNameKey) val = (typeof PersonaManager !== 'undefined' && PersonaManager.current && PersonaManager.current.name) ? PersonaManager.current.name : '—';
                    else { var v = vars[key]; val = v === undefined || v === null ? '—' : (typeof v === 'object' ? JSON.stringify(v) : String(v)); }
                    return (labels[key] || key) + '：' + val;
                });
                container.innerHTML = lines.length ? '<div class="plugin-status-lines">' + lines.map(function (l) { return '<div class="plugin-status-line">' + esc(l) + '</div>'; }).join('') + '</div>' : '<div class="plugin-item">没有要显示的变量。</div>';
            }
        });
    }

    /** 这条登记是否走旧式路径：旧类型，或类型是 status-display / random-pool / randomizer 并且模组里有单独的 pluginConfigs */
    function handles(type, config) {
        if (type === 'interactive-save' || type === 'schedule-generator' || type === 'trigger-chain-generator') return true;
        return !!config && (type === 'status-display' || type === 'random-pool' || type === 'randomizer');
    }

    function register(reg, id, type, config, nameFallback) {
        var name = (config && (config.label || config.name)) || nameFallback || id;
        if (type === 'interactive-save') return registerInteractiveSave(reg, id, name, type, config || {});
        if (type === 'status-display') return registerStatusDisplay(reg, id, name, type, config || {});
        if (type === 'random-pool' || type === 'randomizer') return registerRandomizer(reg, id, name, type, config || {});
        if (type === 'schedule-generator' || type === 'trigger-chain-generator') return registerGenerator(reg, id, name, type, config || {});
    }

    window.PluginLegacy = { handles: handles, register: register, loadModulePluginScript: loadModulePluginScript, runRandomizerGeneric: runRandomizerGeneric };
})();
