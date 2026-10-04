/**
 * 正则处理器
 * 迁移自SillyTavern的regex扩展，支持预设绑定正则
 * 参考：【soliumbra】预设内置正则v2 github版.json
 * 
 * 新增功能：
 * - placement支持：根据上下文(AI输出/用户输入等)过滤正则
 * - depth支持：根据消息深度过滤正则
 * - markdownOnly/promptOnly支持
 */

const RegexProcessor = {
    // 所有正则脚本
    regexScripts: new Map(), // Map<regexId, RegexScript>

    // 启用的正则（按类型分组）
    enabledRegex: {
        global: new Set(),    // 全局正则
        preset: new Set()     // 预设绑定正则
    },

    /**
     * 初始化
     */
    init() {
        // 与 SillyTavern 一致的 placement 枚举，MessageFormatter 依赖此变量才会跑正则
        if (typeof window !== 'undefined' && !window.regex_placement) {
            window.regex_placement = {
                USER_INPUT: 1,
                AI_OUTPUT: 2,
                REASONING: 3
            };
        }
        // 从存储加载正则脚本
        this._loadRegexScripts();
    },

    /**
     * 加载正则脚本
     */
    _loadRegexScripts() {
        // 单独使用自己的localStorage键，避免被其它 settings 覆盖
        const saved = Storage.getLocal(CONFIG.STORAGE_KEYS.REGEX_SCRIPTS) || [];
        saved.forEach((script, idx) => {
            // 兼容disabled字段（SillyTavern使用disabled）
            if (script.disabled !== undefined && script.enabled === undefined) {
                script.enabled = !script.disabled;
            }
            // 统一字段：保持 disabled 与 enabled 同步（我们内部以 enabled 为准）
            if (script.enabled !== undefined) {
                script.disabled = !script.enabled;
            }
            // 确保trimStrings是数组
            if (!Array.isArray(script.trimStrings)) {
                script.trimStrings = script.trimStrings ? [script.trimStrings] : [];
            }
            // 确保placement是数组
            if (!Array.isArray(script.placement)) {
                script.placement = script.placement !== undefined ? [script.placement] : [window.regex_placement ? window.regex_placement.AI_OUTPUT : 2];
            }
            // 稳定顺序：记录导入/保存时的顺序，保证执行顺序可控（避免 Set 顺序导致规则"看起来乱跑"）
            if (script.order === undefined) {
                script.order = idx;
            }
            this.regexScripts.set(script.id, script);
            if (script.enabled) {
                this._enableRegex(script.id, script.type || 'global');
            }
        });
    },

    /**
     * 保存正则脚本
     */
    _saveRegexScripts() {
        const scripts = Array.from(this.regexScripts.values())
            .sort((a, b) => {
                const ao = (a?.order ?? Number.MAX_SAFE_INTEGER);
                const bo = (b?.order ?? Number.MAX_SAFE_INTEGER);
                if (ao !== bo) return ao - bo;
                return (a?.createdAt ?? 0) - (b?.createdAt ?? 0);
            });
        // 独立保存，防止其它模块写 settings 时误覆盖
        Storage.setLocal(CONFIG.STORAGE_KEYS.REGEX_SCRIPTS, scripts);
    },

    /**
     * 2026-06-05：保存前 pattern 校验工具。invalid 返回 { ok:false, error:'...' } + 弹 toast 阻止保存。
     * 同 [[regex-processor-invalid-pattern-2026-06-05]] 运行时防御，输入端先拒比运行时再 toast 更早暴露问题给作者。
     */
    _validatePattern(pattern, flags, scriptName) {
        if (!pattern) return { ok: true }; // 空 pattern 业务上等于禁用脚本，不校验
        try {
            new RegExp(pattern, flags || 'gi');
            return { ok: true };
        } catch (e) {
            const name = scriptName || '此脚本';
            const msg = `正则脚本「${name}」语法错误，无法保存：${e.message}`;
            console.error('[RegexProcessor] _validatePattern:', msg);
            if (typeof Toast !== 'undefined' && Toast.show) Toast.show(msg, 'error', 6000);
            return { ok: false, error: e.message };
        }
    },

    /**
     * 创建正则脚本
     * @param {Object} config - 配置
     */
    createRegexScript(config) {
        const {
            id,
            name,
            pattern,
            replacement,
            flags = 'gi',
            type = 'global',
            enabled = false,
            description = '',
            trimStrings = [],
            placement = [window.regex_placement ? window.regex_placement.AI_OUTPUT : 2], // 默认只应用于AI输出
            minDepth = null, // 最小深度 (-1表示无限制)
            maxDepth = null, // 最大深度 (-1表示无限制)
            markdownOnly = false, // 仅在Markdown上下文应用
            promptOnly = false, // 仅在Prompt上下文应用
            runOnEdit = true, // 编辑时是否运行
        } = config;

        const realPattern = pattern || config.findRegex || '';
        const realFlags = flags || 'gi';
        // 2026-06-05：保存前 pattern 校验，invalid 拒绝创建（返回 null），不让坏数据进 store
        const v = this._validatePattern(realPattern, realFlags, name);
        if (!v.ok) return null;

        const script = {
            // 允许导入时保留既有ID（关键：预设绑定依赖id一致）
            id: id || `regex_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name,
            pattern: realPattern, // 兼容findRegex
            replacement: replacement || config.replaceString || '', // 兼容replaceString
            flags,
            type, // 'global' | 'preset'
            enabled,
            disabled: !enabled, // 同时保存disabled字段（SillyTavern使用disabled）
            description,
            trimStrings: Array.isArray(trimStrings) ? trimStrings : (trimStrings ? [trimStrings] : []),
            // 新增字段：placement和depth支持
            placement: Array.isArray(placement) ? placement : [placement],
            minDepth: minDepth !== null && minDepth !== undefined ? Number(minDepth) : null,
            maxDepth: maxDepth !== null && maxDepth !== undefined ? Number(maxDepth) : null,
            markdownOnly: Boolean(markdownOnly),
            promptOnly: Boolean(promptOnly),
            runOnEdit: runOnEdit !== false, // 默认true
            // 顺序：追加到末尾（保持执行顺序稳定）
            order: (() => {
                const existing = Array.from(this.regexScripts.values());
                const maxOrder = existing.reduce((max, s) => Math.max(max, s.order ?? 0), -1);
                return maxOrder + 1;
            })(),
            createdAt: Date.now()
        };

        this.regexScripts.set(script.id, script);
        if (script.enabled) {
            this._enableRegex(script.id, script.type);
        }
        this._saveRegexScripts();
        return script;
    },

    /**
     * 启用正则
     */
    enableRegex(regexId) {
        const script = this.regexScripts.get(regexId);
        if (!script) return false;

        script.enabled = true;
        script.disabled = false;
        this._enableRegex(regexId, script.type || 'global');
        this._saveRegexScripts();
        return true;
    },

    /**
     * 内部：启用正则（添加到对应集合）
     */
    _enableRegex(regexId, type) {
        // 先从其他类型移除
        this.enabledRegex.global.delete(regexId);
        this.enabledRegex.preset.delete(regexId);

        // 添加到对应类型（只支持global和preset）
        if (type === 'global') {
            this.enabledRegex.global.add(regexId);
        } else if (type === 'preset') {
            this.enabledRegex.preset.add(regexId);
        }
    },

    /**
     * 禁用正则
     */
    disableRegex(regexId) {
        const script = this.regexScripts.get(regexId);
        if (!script) return false;

        script.enabled = false;
        script.disabled = true;
        this.enabledRegex.global.delete(regexId);
        this.enabledRegex.preset.delete(regexId);
        this._saveRegexScripts();
        return true;
    },

    /**
     * 处理文本（应用所有启用的正则）
     * 参考SillyTavern: getRegexedString (engine.js:334-381)
     * @param {string} text - 要处理的文本
     * @param {number} placement - 正则应用位置 (regex_placement枚举值)
     * @param {Object} options - 选项
     * @param {number} [options.depth] - 消息深度 (0是最新消息)
     * @param {string} [options.characterOverride] - 角色名覆盖
     * @param {boolean} [options.isMarkdown=false] - 是否是Markdown上下文
     * @param {boolean} [options.isPrompt=false] - 是否是Prompt上下文
     * @param {boolean} [options.isEdit=false] - 是否是编辑操作
     * @returns {string} 处理后的文本
     */
    process(text, placement, { depth, characterOverride, isMarkdown = false, isPrompt = false, isEdit = false } = {}) {
        if (typeof text !== 'string') {
            console.warn('RegexProcessor.process: text不是字符串，返回空字符串');
            return '';
        }

        let result = text;

        // 获取所有启用的正则脚本，按order排序
        const all = Array.from(this.regexScripts.values())
            .filter(s => s && (s.type === 'global' || s.type === 'preset'))
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

        for (const script of all) {
            // 跳过禁用的脚本
            if (!script?.enabled || script?.disabled) continue;

            // 只在对应集合里启用才执行（避免类型变更/旧集合残留导致误跑）
            if (script.type === 'global' && !this.enabledRegex.global.has(script.id)) continue;
            if (script.type === 'preset' && !this.enabledRegex.preset.has(script.id)) continue;

            // 检查markdownOnly和promptOnly条件
            // 参考ST: engine.js:349-355
            const shouldApply = (
                // Script applies to Markdown and input is Markdown
                (script.markdownOnly && isMarkdown) ||
                // Script applies to Generate and input is Generate
                (script.promptOnly && isPrompt) ||
                // Script applies to all cases when neither "only"s are true
                (!script.markdownOnly && !script.promptOnly && !isMarkdown && !isPrompt)
            );

            if (!shouldApply) {
                continue;
            }

            // 检查编辑时是否运行
            // 参考ST: engine.js:356-359
            if (isEdit && !script.runOnEdit) {
                console.debug(`RegexProcessor: 跳过脚本 ${script.name}，因为它不在编辑时运行`);
                continue;
            }

            // 检查depth是否在min/max范围内
            // 参考ST: engine.js:362-372
            if (typeof depth === 'number') {
                if (!isNaN(script.minDepth) && script.minDepth !== null && script.minDepth >= -1 && depth < script.minDepth) {
                    console.debug(`RegexProcessor: 跳过脚本 ${script.name}，depth ${depth} < minDepth ${script.minDepth}`);
                    continue;
                }

                if (!isNaN(script.maxDepth) && script.maxDepth !== null && script.maxDepth >= 0 && depth > script.maxDepth) {
                    console.debug(`RegexProcessor: 跳过脚本 ${script.name}，depth ${depth} > maxDepth ${script.maxDepth}`);
                    continue;
                }
            }

            // 检查placement是否匹配
            // 参考ST: engine.js:374-376
            if (placement !== undefined && Array.isArray(script.placement) && script.placement.length > 0) {
                if (!script.placement.includes(placement)) {
                    console.debug(`RegexProcessor: 跳过脚本 ${script.name}，placement ${placement} 不在列表中`);
                    continue;
                }
            }

            // 应用正则
            result = this._applyRegex(result, script, { characterOverride });
        }

        return result;
    },

    /**
     * 应用单个正则脚本
     * @param {string} text - 要处理的文本
     * @param {Object} script - 正则脚本
     * @param {Object} options - 选项
     * @param {string} [options.characterOverride] - 角色名覆盖
     * @returns {string} 处理后的文本
     */
    _applyRegex(text, script, { characterOverride } = {}) {
        // 检查脚本是否被禁用
        const isDisabled = script.disabled === true || script.enabled === false;
        if (!script || isDisabled || !script.pattern || !text) {
            return text;
        }

        // 2026-06-05：作者写 invalid regex（如 `[unclosed`）会让 new RegExp 抛 SyntaxError，
        // 整个 RegexProcessor.process 中断，后续 scripts 全跳过 + 上层崩。
        // 改成 try/catch 包：invalid pattern → 跳过该 script 不抛 + 一次性 toast 提示作者哪条错；
        // 不污染重复 toast（用 RegexProcessor._invalidPatternWarned set 去重）。
        let regex;
        try {
            regex = new RegExp(script.pattern, script.flags || 'gi');
        } catch (e) {
            const key = script.id || script.name || script.pattern;
            if (!RegexProcessor._invalidPatternWarned) RegexProcessor._invalidPatternWarned = new Set();
            if (!RegexProcessor._invalidPatternWarned.has(key)) {
                RegexProcessor._invalidPatternWarned.add(key);
                const name = script.name || script.id || '未命名脚本';
                console.error(`[RegexProcessor] 脚本「${name}」pattern 无效，已跳过：${e.message}`);
                if (typeof Toast !== 'undefined' && Toast.show) {
                    Toast.show(`正则脚本「${name}」语法错误已跳过：${e.message}`, 'error', 6000);
                }
            }
            return text;
        }
        if (!regex) {
            return text;
        }

        const result = text.replace(regex, function (match, ...args) {
            let groups = null;
            let captureGroups = args;

            if (args.length > 0) {
                const lastArg = args[args.length - 1];
                if (lastArg && typeof lastArg === 'object' && !Array.isArray(lastArg) && !(lastArg instanceof String)) {
                    const keys = Object.keys(lastArg);
                    if (keys.length > 0 && keys.some(k => typeof lastArg[k] === 'string')) {
                        groups = lastArg;
                        captureGroups = args.slice(0, -1);
                    }
                }
            }

            let replaceString = script.replacement || script.replaceString || '';
            replaceString = replaceString.replace(/{{match}}/gi, '$0');

            const replaceWithGroups = replaceString.replaceAll(/\$(\d+)|(\$0)|(\$<([^>]+)>)/g, (fullMatch, num, zero, namedPrefix, groupName) => {
                let matchedValue = null;

                if (zero || (num && Number(num) === 0)) {
                    matchedValue = match;
                } else if (num) {
                    const index = Number(num);
                    if (index > 0 && index <= captureGroups.length) {
                        matchedValue = captureGroups[index - 1];
                    }
                } else if (groupName && groups) {
                    matchedValue = groups[groupName];
                }

                if (!matchedValue) {
                    return '';
                }

                let filteredMatch = matchedValue;
                if (script.trimStrings && Array.isArray(script.trimStrings) && script.trimStrings.length > 0) {
                    script.trimStrings.forEach(trimString => {
                        if (trimString) {
                            filteredMatch = filteredMatch.replaceAll(trimString, '');
                        }
                    });
                }

                return filteredMatch;
            });

            return replaceWithGroups;
        });

        return result;
    },

    /**
     * 更新正则脚本
     */
    updateRegexScript(regexId, updates) {
        const script = this.regexScripts.get(regexId);
        if (!script) return false;

        // 2026-06-05：若 updates 改了 pattern 或 flags，先校验新组合 valid；invalid 拒绝更新
        if (updates && (updates.pattern !== undefined || updates.flags !== undefined)) {
            const newPattern = updates.pattern !== undefined ? updates.pattern : script.pattern;
            const newFlags = updates.flags !== undefined ? updates.flags : script.flags;
            const v = this._validatePattern(newPattern, newFlags, updates.name || script.name);
            if (!v.ok) return false;
        }

        // 更新字段
        Object.assign(script, updates);

        // 确保placement是数组
        if (updates.placement !== undefined && !Array.isArray(script.placement)) {
            script.placement = [script.placement];
        }

        // 同步enabled和disabled
        if (updates.enabled !== undefined) {
            script.disabled = !updates.enabled;
        }
        if (updates.disabled !== undefined) {
            script.enabled = !updates.disabled;
        }

        // 如果启用状态改变，更新集合
        if (script.enabled) {
            this._enableRegex(regexId, script.type || 'global');
        } else {
            this.enabledRegex.global.delete(regexId);
            this.enabledRegex.preset.delete(regexId);
        }

        this._saveRegexScripts();
        return true;
    },

    /**
     * 删除正则脚本
     */
    deleteRegexScript(regexId) {
        const deleted = this.regexScripts.delete(regexId);
        if (deleted) {
            this.enabledRegex.global.delete(regexId);
            this.enabledRegex.preset.delete(regexId);
            this._saveRegexScripts();
        }
        return deleted;
    },

    /**
     * 获取所有正则脚本
     */
    getAllRegexScripts() {
        return Array.from(this.regexScripts.values())
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    },

    /**
     * 获取指定类型的正则脚本
     */
    getRegexScriptsByType(type) {
        return this.getAllRegexScripts().filter(s => s.type === type);
    },

    /**
     * 导入正则脚本
     */
    importRegexScripts(scripts, options = {}) {
        const { type = 'global', overwrite = false } = options;
        let imported = 0;

        scripts.forEach((script, idx) => {
            // 如果不覆盖且ID已存在，跳过
            if (!overwrite && script.id && this.regexScripts.has(script.id)) {
                return;
            }

            // 创建或更新脚本
            const config = {
                ...script,
                type,
                // 保持导入顺序
                order: script.order !== undefined ? script.order : (this.regexScripts.size + idx)
            };

            if (script.id && this.regexScripts.has(script.id)) {
                this.updateRegexScript(script.id, config);
            } else {
                this.createRegexScript(config);
            }

            imported++;
        });

        return imported;
    },

    /**
     * 导出正则脚本
     */
    exportRegexScripts(type = null) {
        const scripts = type ? this.getRegexScriptsByType(type) : this.getAllRegexScripts();
        return scripts.map(s => ({ ...s })); // 返回副本
    },

    /**
     * 清空所有正则脚本
     */
    clearAllRegexScripts() {
        this.regexScripts.clear();
        this.enabledRegex.global.clear();
        this.enabledRegex.preset.clear();
        this._saveRegexScripts();
    },

    /**
     * 获取所有正则脚本（向后兼容的别名）
     * @deprecated 使用 getAllRegexScripts 代替
     */
    getAllScripts() {
        return this.getAllRegexScripts();
    },

    /**
     * 更新正则脚本（向后兼容的别名，供 regex-manager / 导入等调用）
     */
    updateScript(regexId, updates) {
        return this.updateRegexScript(regexId, updates);
    },

    /**
     * 删除正则脚本（向后兼容的别名）
     */
    deleteScript(regexId) {
        return this.deleteRegexScript(regexId);
    }
};

// 导出
window.RegexProcessor = RegexProcessor;
