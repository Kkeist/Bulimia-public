/**
 * 插件测试执行器 - 按规则完整重写
 * 规则摘要：
 * - 随机器：测随机结果对不对（来自池、格式正确、暂存写入）。
 * - 变量读取器：测(1)调用得到的原始信息与上游插件理应得到的是否一致 (2)存储格式/映射对不对 (3)系统有没有真的把变量存进去。
 * - 模块生成器：测(1)上游信息 (2)生成格式 (3)系统真的加进 flow、跳转/结构正常（整个 flow、父模块下该分流程）。
 * - 展示器：测读取变量展示给用户看对不对（html、变量键、变量值与上下文一致）。
 * - 交互器：测用户给 AI 的 prompt 对不对、AI 返回整理后存进变量/展示对不对（prompt/blockId/outputFormat + 模拟回复写入后变量包含）。
 * - 展示交互器：测发送的 prompt 对不对、内容能否正常展示（updatePrompt、html、variablesKeys）。
 */
(function(global) {
    'use strict';

    function extractByMapping(input, mapping) {
        if (input == null || mapping == null || mapping === '') return undefined;
        var keys = String(mapping).split('.');
        var value = input;
        for (var i = 0; i < keys.length; i++) {
            if (value != null && typeof value === 'object') value = value[keys[i]];
            else return undefined;
        }
        return value;
    }

    function runAssertions(testCase, out, context, moduleSystem, plugin) {
        var a = testCase.assertions || {};

        if (a.returnValueIdOneOf && Array.isArray(a.returnValueIdOneOf)) {
            if (out == null) return { pass: false, message: '返回为 null' };
            if (a.returnValueIdOneOf.indexOf(out.id) === -1)
                return { pass: false, message: '返回 id 不在池中: ' + out.id };
        }

        if (a.returnValueId !== undefined) {
            if (out == null || out.id !== a.returnValueId)
                return { pass: false, message: '返回 id 应为 ' + a.returnValueId + '，实际 ' + (out && out.id) };
        }

        if (a.returnValueFields && Array.isArray(a.returnValueFields)) {
            if (out == null || typeof out !== 'object') return { pass: false, message: '返回非对象' };
            for (var i = 0; i < a.returnValueFields.length; i++) {
                if (out[a.returnValueFields[i]] === undefined)
                    return { pass: false, message: '返回缺少字段: ' + a.returnValueFields[i] };
            }
        }

        if (a.tempStorageEqualsReturn && context && context.variableSystem) {
            var stored = context.variableSystem.getValue(a.tempStorageEqualsReturn);
            if (stored === undefined)
                return { pass: false, message: '暂存未写入: ' + a.tempStorageEqualsReturn };
            if (out && typeof out === 'object' && stored && typeof stored === 'object') {
                if (stored.id !== out.id || stored.name !== out.name)
                    return { pass: false, message: '暂存与返回值不一致' };
            }
        }

        if (a.sourcePluginId && a.sourceOutputIdOneOf && Array.isArray(a.sourceOutputIdOneOf) && context && context.pluginSystem) {
            var sourcePlugin = context.pluginSystem.getPlugin(a.sourcePluginId);
            if (!sourcePlugin || !sourcePlugin.output)
                return { pass: false, message: '变量读取器上游插件无输出: ' + a.sourcePluginId };
            var sid = sourcePlugin.output.id != null ? sourcePlugin.output.id : sourcePlugin.output;
            if (a.sourceOutputIdOneOf.indexOf(sid) === -1)
                return { pass: false, message: '调用得到的原始信息与上游理应得到的不一致，上游 output.id=' + sid };
        }

        if (a.sourceOutputHasFields && Array.isArray(a.sourceOutputHasFields) && context && context.pluginSystem && a.sourcePluginId) {
            var src = context.pluginSystem.getPlugin(a.sourcePluginId);
            if (!src || !src.output) return { pass: false, message: '上游无输出' };
            var raw = src.output;
            for (var fi = 0; fi < a.sourceOutputHasFields.length; fi++) {
                if (raw[a.sourceOutputHasFields[fi]] === undefined)
                    return { pass: false, message: '上游输出缺少字段: ' + a.sourceOutputHasFields[fi] };
            }
        }

        if (a.storedVariableEqualsSourceMapping && context && context.variableSystem && context.pluginSystem) {
            var sm = a.storedVariableEqualsSourceMapping;
            var sPlugin = context.pluginSystem.getPlugin(sm.sourcePluginId);
            if (!sPlugin || !sPlugin.output)
                return { pass: false, message: '上游插件无输出，无法校验映射' };
            var expectedVal = extractByMapping(sPlugin.output, sm.mapping);
            var actualVal = context.variableSystem.getValue(sm.variableId);
            if (actualVal === undefined)
                return { pass: false, message: '变量未写入: ' + sm.variableId };
            if (JSON.stringify(actualVal) !== JSON.stringify(expectedVal))
                return { pass: false, message: '读取的东西映射不对，变量 ' + sm.variableId + ' 应为 ' + String(expectedVal) + '，实际 ' + String(actualVal) };
        }

        if (a.promptContains && (Array.isArray(a.promptContains) || typeof a.promptContains === 'string')) {
            var arr = Array.isArray(a.promptContains) ? a.promptContains : [a.promptContains];
            var p = (out && out.prompt != null) ? String(out.prompt) : '';
            for (var pi = 0; pi < arr.length; pi++) {
                var need = arr[pi];
                if (p.indexOf(need) === -1)
                    return { pass: false, message: '用户发的内容没进 prompt，应包含: "' + need + '"' };
            }
        }
        if (a.prompt !== undefined) {
            if (!out || typeof out.prompt !== 'string')
                return { pass: false, message: '无 prompt' };
            if (out.prompt.trim() !== a.prompt)
                return { pass: false, message: '发给 AI 的 prompt 不对，期望: ' + a.prompt.slice(0, 40) + '...' };
        }
        if (a.promptEquals !== undefined) {
            var expPrompt = a.promptEquals;
            var actualPrompt = (out && out.prompt !== undefined) ? String(out.prompt).trim() : '';
            if (expPrompt === '') {
                if (actualPrompt !== '')
                    return { pass: false, message: '期望无 prompt，实际: ' + actualPrompt.slice(0, 60) };
            } else {
                if (actualPrompt !== expPrompt)
                    return { pass: false, message: 'prompt 应为 "' + expPrompt + '"，实际 "' + actualPrompt + '"' };
            }
        }

        if (a.blockId !== undefined) {
            if (!out || out.blockId !== a.blockId)
                return { pass: false, message: 'blockId 应为 ' + a.blockId + '，实际 ' + (out && out.blockId) };
        }

        if (a.outputFormat !== undefined) {
            if (!out || typeof out.outputFormat !== 'string')
                return { pass: false, message: '无 outputFormat' };
            if (out.outputFormat.trim() !== a.outputFormat)
                return { pass: false, message: 'outputFormat 不符' };
        }

        if (a.returnValueType !== undefined) {
            if (!out || out.type !== a.returnValueType)
                return { pass: false, message: '返回 type 应为 ' + a.returnValueType };
        }

        if (a.returnValueHasFields && Array.isArray(a.returnValueHasFields)) {
            if (out == null || typeof out !== 'object') return { pass: false, message: '返回非对象' };
            for (var j = 0; j < a.returnValueHasFields.length; j++) {
                if (out[a.returnValueHasFields[j]] === undefined)
                    return { pass: false, message: '返回缺少: ' + a.returnValueHasFields[j] };
            }
        }

        if (a.flowsMainEntryEvent !== undefined) {
            if (!out || !out.flows || !out.flows.main)
                return { pass: false, message: '缺少 flows.main' };
            if (out.flows.main.entryEvent !== a.flowsMainEntryEvent)
                return { pass: false, message: 'flows.main.entryEvent 应为 ' + a.flowsMainEntryEvent };
        }

        if (a.flowsMainSubModulesIsArray) {
            if (!out || !out.flows || !out.flows.main)
                return { pass: false, message: '缺少 flows.main' };
            if (!Array.isArray(out.flows.main.subModules))
                return { pass: false, message: 'flows.main.subModules 应为数组' };
        }

        if (a.registeredInModuleSystem && moduleSystem && out && out.id) {
            if (!moduleSystem.getModule(out.id))
                return { pass: false, message: '系统没有真的把模块加进去: ' + out.id };
        }

        if (a.generatedModuleFlowName && moduleSystem && out && out.id) {
            var mod = moduleSystem.getModule(out.id);
            if (!mod) return { pass: false, message: '生成模块不在系统中' };
            if (mod.flowName !== a.generatedModuleFlowName)
                return { pass: false, message: '生成模块 flowName 应为 ' + a.generatedModuleFlowName + '，实际 ' + mod.flowName };
        }

        if (a.generatedModuleParentId && moduleSystem && out && out.id) {
            var m = moduleSystem.getModule(out.id);
            if (!m) return { pass: false, message: '生成模块不在系统中' };
            if (m.parentModuleId !== a.generatedModuleParentId)
                return { pass: false, message: '生成模块 parentModuleId 应为 ' + a.generatedModuleParentId + '，实际 ' + m.parentModuleId };
        }

        if (a.hasHtml) {
            if (!out || typeof out.html !== 'string' || !out.html.trim())
                return { pass: false, message: '无 html，展示器无法给用户看' };
        }

        if (a.variablesKeys && Array.isArray(a.variablesKeys)) {
            if (!out || typeof out.variables !== 'object')
                return { pass: false, message: '无 variables' };
            var keys = Object.keys(out.variables).sort();
            var expected = a.variablesKeys.slice().sort();
            if (keys.length !== expected.length || keys.some(function(k, i) { return k !== expected[i]; }))
                return { pass: false, message: 'variables 键应为 ' + expected.join(', ') + '，实际 ' + keys.join(', ') };
        }

        if (a.displayVariableValuesMatchContext && out && out.variables && context && context.variableSystem) {
            for (var vk in out.variables) {
                if (!out.variables.hasOwnProperty(vk)) continue;
                var ctxVal = context.variableSystem.getValue(vk);
                var outVal = out.variables[vk];
                if (JSON.stringify(ctxVal) !== JSON.stringify(outVal))
                    return { pass: false, message: '展示器变量 ' + vk + ' 与上下文不一致，展示给用户看会错' };
            }
        }

        if (a.updatePromptEquals !== undefined) {
            var actual = (out && out.updatePrompt !== undefined) ? String(out.updatePrompt) : '';
            var expUpdate = a.updatePromptEquals;
            if (expUpdate === '') {
                if (actual !== '' && actual !== undefined)
                    return { pass: false, message: 'updatePrompt 应为空，实际 "' + actual + '"' };
            } else {
                if (actual !== expUpdate)
                    return { pass: false, message: 'updatePrompt 应为 "' + expUpdate + '"，实际 "' + actual + '"' };
            }
        }

        if (a.storedVariableIds && Array.isArray(a.storedVariableIds) && context && context.variableSystem) {
            for (var vi = 0; vi < a.storedVariableIds.length; vi++) {
                var varId = a.storedVariableIds[vi];
                var val = context.variableSystem.getValue(varId);
                if (val === undefined)
                    return { pass: false, message: '系统没有真的把变量存进去: ' + varId };
            }
        }

        if (a.variableValueOneOf && typeof a.variableValueOneOf === 'object' && context && context.variableSystem) {
            for (var vk in a.variableValueOneOf) {
                if (!a.variableValueOneOf.hasOwnProperty(vk)) continue;
                var allowed = a.variableValueOneOf[vk];
                if (!Array.isArray(allowed)) continue;
                var vVal = context.variableSystem.getValue(vk);
                if (vVal === undefined)
                    return { pass: false, message: '变量未写入: ' + vk };
                if (allowed.indexOf(vVal) === -1)
                    return { pass: false, message: '变量 ' + vk + ' 的值 "' + vVal + '" 不是理应存的东西（不在允许列表）' };
            }
        }

        if (a.afterReplyVariableContains && typeof a.afterReplyVariableContains === 'object' && context && context.variableSystem) {
            for (var vid in a.afterReplyVariableContains) {
                if (!a.afterReplyVariableContains.hasOwnProperty(vid)) continue;
                var expectedSub = a.afterReplyVariableContains[vid];
                var actualVal = context.variableSystem.getValue(vid);
                if (actualVal === undefined || actualVal === null)
                    return { pass: false, message: 'AI 返回整理后未写入展示变量: ' + vid };
                if (String(actualVal).indexOf(expectedSub) === -1)
                    return { pass: false, message: 'AI 返回给用户的内容不对，变量 ' + vid + ' 应包含 "' + expectedSub + '"' };
            }
        }

        if (a.variableContainsAll && typeof a.variableContainsAll === 'object' && context && context.variableSystem) {
            for (var vcid in a.variableContainsAll) {
                if (!a.variableContainsAll.hasOwnProperty(vcid)) continue;
                var subs = a.variableContainsAll[vcid];
                if (!Array.isArray(subs)) continue;
                var vVal = context.variableSystem.getValue(vcid);
                if (vVal === undefined || vVal === null)
                    return { pass: false, message: '变量未写入: ' + vcid };
                var vStr = String(vVal);
                for (var si = 0; si < subs.length; si++) {
                    if (vStr.indexOf(subs[si]) === -1)
                        return { pass: false, message: '变量 ' + vcid + ' 应同时包含用户操作与 AI 回复，缺少: "' + subs[si] + '"' };
                }
            }
        }

        if (a.variableValueEquals && typeof a.variableValueEquals === 'object' && context && context.variableSystem) {
            for (var vid in a.variableValueEquals) {
                if (!a.variableValueEquals.hasOwnProperty(vid)) continue;
                var expectedVal = a.variableValueEquals[vid];
                var actualVal = context.variableSystem.getValue(vid);
                if (JSON.stringify(actualVal) !== JSON.stringify(expectedVal))
                    return { pass: false, message: '变量 ' + vid + ' 应为 ' + JSON.stringify(expectedVal) + '，实际 ' + JSON.stringify(actualVal) };
            }
        }

        if (a.variableValueIncrement && typeof a.variableValueIncrement === 'object' && context && context.variableSystem) {
            for (var vidi in a.variableValueIncrement) {
                if (!a.variableValueIncrement.hasOwnProperty(vidi)) continue;
                var spec = a.variableValueIncrement[vidi];
                var from = (spec && typeof spec === 'object' && 'from' in spec) ? spec.from : 0;
                var by = (spec && typeof spec === 'object' && 'by' in spec) ? spec.by : (typeof spec === 'number' ? spec : 0);
                var expectedNum = from + by;
                var numVal = context.variableSystem.getValue(vidi);
                if (typeof numVal !== 'number')
                    return { pass: false, message: '变量 ' + vidi + ' 非数字，实际 ' + typeof numVal };
                if (numVal !== expectedNum)
                    return { pass: false, message: '变量 ' + vidi + ' 期望 ' + expectedNum + '（from ' + from + ' + by ' + by + '），实际 ' + numVal };
            }
        }

        if (a.flowModuleCountMin && moduleSystem && typeof a.flowModuleCountMin === 'object') {
            var fc = a.flowModuleCountMin;
            var parentId = fc.parentModuleId;
            var flowName = fc.flowName;
            var minCount = fc.min != null ? fc.min : 1;
            var parent = moduleSystem.getModule(parentId);
            if (!parent || !parent.subModules || !parent.subModules.get(flowName))
                return { pass: false, message: 'flow ' + flowName + ' 不存在或为空' };
            var flowMap = parent.subModules.get(flowName);
            var count = flowMap ? flowMap.size : 0;
            if (count < minCount)
                return { pass: false, message: 'flow ' + flowName + ' 下模块数应至少 ' + minCount + '，实际 ' + count };
        }

        if (a.promptEmpty) {
            var p = (out && out.prompt != null) ? String(out.prompt).trim() : '';
            if (p !== '')
                return { pass: false, message: '暂存为空时期望不发内容给 AI（prompt 为空），实际: ' + p.slice(0, 60) };
        }

        return { pass: true, message: testCase.name };
    }

    function collectActual(testCase, out, ctx, moduleSystem, plugin) {
        var actual = {};
        if (out != null) {
            actual.returnValue = out;
            if (out.prompt != null) actual.prompt = out.prompt;
        }
        var varIds = new Set();
        var setup = testCase.setup || {};
        var a = testCase.assertions || {};
        if (setup.replyVariableId) varIds.add(setup.replyVariableId);
        if (Array.isArray(a.storedVariableIds)) a.storedVariableIds.forEach(function(id) { varIds.add(id); });
        if (a.afterReplyVariableContains && typeof a.afterReplyVariableContains === 'object')
            Object.keys(a.afterReplyVariableContains).forEach(function(id) { varIds.add(id); });
        if (a.variableValueOneOf && typeof a.variableValueOneOf === 'object')
            Object.keys(a.variableValueOneOf).forEach(function(id) { varIds.add(id); });
        if (a.variableContainsAll && typeof a.variableContainsAll === 'object')
            Object.keys(a.variableContainsAll).forEach(function(id) { varIds.add(id); });
        if (ctx.variableSystem && varIds.size > 0) {
            actual.storedVariables = {};
            varIds.forEach(function(id) {
                actual.storedVariables[id] = ctx.variableSystem.getValue(id);
            });
        }
        if (plugin && plugin.type === 'variable_reader' && a.sourcePluginId && ctx.pluginSystem) {
            var src = ctx.pluginSystem.getPlugin(a.sourcePluginId);
            if (src && src.output) actual.sourceOutput = src.output;
        }
        if (out && out.id && moduleSystem && (plugin && plugin.type === 'module_generator')) {
            var m = moduleSystem.getModule(out.id);
            if (m) actual.generatedModule = { id: m.id, name: m.name, flowName: m.flowName, parentModuleId: m.parentModuleId };
        }
        return actual;
    }

    function runOneTest(testCase, pluginSystem, getContext, moduleSystem) {
        var pluginId = testCase.pluginId;
        if (!pluginId) return { pass: false, message: '用例缺少 pluginId' };
        var plugin = pluginSystem.getPlugin(pluginId);
        if (!plugin) return { pass: false, message: '未找到插件: ' + pluginId };
        var ctx = getContext();
        if (!ctx) return { pass: false, message: '无 context' };
        var setup = testCase.setup || {};

        if (ctx.variableSystem && setup.initialVariables) {
            for (var k in setup.initialVariables) {
                ctx.variableSystem.executeOperation(k, 'set', setup.initialVariables[k]);
            }
            if (typeof ctx.variableSystem.updateBuiltinVariables === 'function') {
                ctx.variableSystem.updateBuiltinVariables();
            }
        }

        var oneShotResults = null;
        if (setup.jumpToModule && ctx.moduleSystem) {
            var jumpRes = ctx.moduleSystem.jumpToModule(setup.jumpToModule, { force: true });
            if (!jumpRes || !jumpRes.success)
                return { pass: false, message: 'setup.jumpToModule 失败: ' + setup.jumpToModule + (jumpRes && jumpRes.error ? ' - ' + jumpRes.error : ''), actual: {} };
            if (ctx.pluginSystem && typeof ctx.pluginSystem.runOneShotPluginsForModule === 'function') {
                oneShotResults = ctx.pluginSystem.runOneShotPluginsForModule(setup.jumpToModule, ctx);
            }
        }

        if (setup.setTime && ctx.timeSystem && typeof ctx.timeSystem.advanceTime === 'function') {
            try {
                ctx.timeSystem.advanceTime(setup.setTime);
            } catch (e) {
                return { pass: false, message: 'setup.setTime 失败: ' + (e.message || e), actual: {} };
            }
        }

        if (Array.isArray(setup.runPluginIds)) {
            for (var i = 0; i < setup.runPluginIds.length; i++) {
                try {
                    ctx.pluginSystem.executePlugin(setup.runPluginIds[i], ctx);
                } catch (e) {
                    return { pass: false, message: 'setup.runPluginIds 执行失败: ' + setup.runPluginIds[i] + ' - ' + (e.message || e), actual: {} };
                }
            }
        }

        var out;
        if (oneShotResults && (plugin.type === 'randomizer' || plugin.type === 'variable_reader' || plugin.type === 'module_generator') && plugin.ownerModuleId === setup.jumpToModule && oneShotResults[pluginId] !== undefined) {
            out = oneShotResults[pluginId];
        } else {
            try {
                out = ctx.pluginSystem.executePlugin(pluginId, ctx);
            } catch (e) {
                if (setup.expectExecutionError) return { pass: true, message: testCase.name + '（期望执行失败）', actual: { error: (e.message || e) + '' } };
                return { pass: false, message: (e.message || e) + '', actual: {} };
            }
        }
        if (setup.expectExecutionError) return { pass: false, message: '期望插件执行失败，但执行成功', actual: collectActual(testCase, out, ctx, moduleSystem, plugin) };

        if (setup.mockAiBlockContent != null && setup.replyVariableId && ctx.variableSystem && out && out.blockId) {
            var blockContent = typeof setup.mockAiBlockContent === 'string'
                ? setup.mockAiBlockContent
                : (setup.mockAiBlockContent.content != null ? setup.mockAiBlockContent.content : null);
            if (blockContent != null) {
                var existing = ctx.variableSystem.getValue(setup.replyVariableId);
                var next = (existing != null && existing !== '') ? (existing + '\n' + blockContent) : blockContent;
                ctx.variableSystem.executeOperation(setup.replyVariableId, 'set', next);
            }
        }

        if (testCase.assertions.moduleInFlow && out && out.id && moduleSystem && plugin) {
            var flowName = testCase.assertions.moduleInFlow.flowName;
            if (flowName) {
                var parent = moduleSystem.getModule(plugin.ownerModuleId);
                var flowMap = parent && parent.subModules && parent.subModules.get(flowName);
                if (!flowMap || !flowMap.has(out.id))
                    return { pass: false, message: '生成模块未加入父模块的「' + flowName + '」分流程，整个 flow 里没有真的加进去', actual: collectActual(testCase, out, ctx, moduleSystem, plugin) };
            }
        }

        var result = runAssertions(testCase, out, ctx, moduleSystem, plugin);
        result.actual = collectActual(testCase, out, ctx, moduleSystem, plugin);
        return result;
    }

    function runPluginTests(pluginSystem, getContext, moduleSystem, pluginTests, options) {
        if (!pluginSystem || typeof getContext !== 'function') return [];
        var tests = (pluginTests && pluginTests.tests) ? pluginTests.tests : [];
        if (!tests.length) return [];
        var moduleSystemRef = moduleSystem;
        var resetBetweenTests = options && options.resetBetweenTests;
        var resetState = options && typeof options.resetState === 'function' ? options.resetState : null;
        return tests.map(function(t) {
            if (resetBetweenTests && resetState) {
                try { resetState(); } catch (e) { return { name: t.name || t.pluginId, pluginId: t.pluginId, pass: false, message: 'resetState 失败: ' + (e.message || e), actual: {} }; }
            }
            var r = runOneTest(t, pluginSystem, getContext, moduleSystemRef);
            return {
                name: t.name || t.pluginId,
                pluginId: t.pluginId,
                pass: r.pass,
                message: r.message,
                actual: r.actual
            };
        });
    }

    function runOnePluginTest(plugin, context, moduleSystem, pluginTests) {
        var tests = (pluginTests && pluginTests.tests) ? pluginTests.tests : [];
        var tc = null;
        for (var i = 0; i < tests.length; i++) {
            if (tests[i].pluginId === plugin.id) { tc = tests[i]; break; }
        }
        if (!tc) return { pass: true, message: '无对应用例，跳过' };
        var getContext = function() { return context; };
        return runOneTest(tc, context.pluginSystem, getContext, moduleSystem);
    }

    global.PluginAutomatedTests = {
        runOne: runOnePluginTest,
        runAll: runPluginTests
    };
})(typeof window !== 'undefined' ? window : this);
