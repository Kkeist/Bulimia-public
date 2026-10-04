/**
 * 预设管理器 - 完全照搬 SillyTavern 格式与注入逻辑
 * ST: prompts[], prompt_order: [{ character_id, order: [{ identifier, enabled }] }], populationInjectionPrompts
 */

const DEFAULT_DEPTH = 4;
const DEFAULT_ORDER = 100;

const PresetManager = {
    presets: [],
    currentPreset: null,
    regexBindings: new Map(),

    init() {
        const settings = Storage.getSettings() || {};
        this.presets = settings.promptPresets || [];
        const bindings = settings.regexBindings || {};
        this.regexBindings = new Map(Object.entries(bindings));
    },

    /**
     * 确保内置预设已加入系统（写作指导已改为独立注入，不再作为内置预设）
     * 可配合“默认预设”：settings.defaultPromptPresetId 指定启动时自动选中的预设
     */
    async ensureBuiltinPreset() {
        // 写作指导通过 WritingGuide 模块独立注入，不在此处加载
    },

    _save() {
        const settings = Storage.getSettings() || {};
        settings.promptPresets = this.presets;
        settings.regexBindings = Object.fromEntries(this.regexBindings);
        Storage.saveSettings(settings);
    },

    /**
     * 照搬 ST：获取当前角色的 prompt_order（identifier + enabled）
     * 优先使用 prompt_order[0].order 中保存的顺序和启用状态
     */
    getPromptOrderForCharacter(character) {
        if (!this.currentPreset) return [];
        const preset = this.currentPreset;
        const prompt_order = preset.prompt_order || [];
        const prompts = preset.prompts || [];
        const byId = new Map(prompts.map(p => [p.identifier, p]));

        // 如果没有 prompt_order，使用 prompts 的默认顺序和 enabled 状态
        if (prompt_order.length === 0) {
            return prompts.map(p => ({
                identifier: p.identifier,
                enabled: p.enabled !== false
            }));
        }

        // 检查是否是 ST 格式的 { character_id, order: [...] } 结构
        const first = prompt_order[0];
        if (first && typeof first === 'object' && Array.isArray(first.order)) {
            // 使用 prompt_order[0].order 中的顺序和 enabled 状态
            return first.order.map(e => {
                const identifier = typeof e === 'string' ? e : e?.identifier;
                // 优先使用 prompt_order 中的 enabled 状态
                const orderEnabled = typeof e === 'object' && e !== null && 'enabled' in e
                    ? e.enabled
                    : null;
                // 如果 prompt_order 没有 enabled，回退到 prompts 中的状态
                const prompt = byId.get(identifier);
                const enabled = orderEnabled !== null ? orderEnabled : (prompt?.enabled !== false);
                return { identifier, enabled };
            }).filter(e => e.identifier); // 过滤掉无效的 identifier
        }

        // 兼容扁平格式的 prompt_order（只有 identifier 字符串或简单对象）
        return prompt_order.map(entry => {
            const identifier = typeof entry === 'string' ? entry : entry?.identifier;
            const orderEnabled = typeof entry === 'object' && entry !== null && 'enabled' in entry
                ? entry.enabled
                : null;
            const prompt = byId.get(identifier);
            const enabled = orderEnabled !== null ? orderEnabled : (prompt?.enabled !== false);
            return { identifier, enabled };
        }).filter(e => e.identifier);
    },

    /**
     * 照搬 ST populationInjectionPrompts：按 depth → order → role 注入
     */
    populationInjectionPrompts(prompts, messages) {
        if (!Array.isArray(prompts) || prompts.length === 0) return messages;
        const withContent = prompts.filter(p => p.content && String(p.content).trim());
        if (withContent.length === 0) return messages;

        const maxDepth = Math.max(0, ...withContent.map(p => (p.injection_depth ?? p.injectionDepth ?? 0)));
        let totalInserted = 0;
        const reversed = [...messages].reverse();

        for (let i = 0; i <= maxDepth; i++) {
            const depthPrompts = withContent.filter(p => (p.injection_depth ?? p.injectionDepth ?? 0) === i);
            if (depthPrompts.length === 0) continue;

            const orderGroups = {};
            for (const p of depthPrompts) {
                const order = p.injection_order ?? p.injectionOrder ?? DEFAULT_ORDER;
                if (!orderGroups[order]) orderGroups[order] = [];
                orderGroups[order].push(p);
            }
            const orders = Object.keys(orderGroups).sort((a, b) => Number(b) - Number(a));
            const roleMessages = [];
            const roles = ['system', 'user', 'assistant'];
            for (const order of orders) {
                const orderPrompts = orderGroups[order];
                for (const role of roles) {
                    const parts = orderPrompts
                        .filter(p => (p.role || 'system') === role)
                        .map(p => (p.content || '').trim())
                        .filter(Boolean);
                    if (parts.length) {
                        roleMessages.push({ role, content: parts.join('\n'), injected: true });
                    }
                }
            }
            if (roleMessages.length) {
                const injectIdx = i + totalInserted;
                reversed.splice(injectIdx, 0, ...roleMessages);
                totalInserted += roleMessages.length;
            }
        }

        return reversed.reverse();
    },

    /**
     * 获取用于 in-chat 注入的 absolute prompts（injection_position === 1），按 prompt_order 顺序
     */
    getAbsolutePromptsForInjection() {
        if (!this.currentPreset) return [];
        const preset = this.currentPreset;
        const prompts = preset.prompts || [];
        const orderEntries = this.getPromptOrderForCharacter(null);
        const byId = new Map(prompts.map(p => [p.identifier, p]));

        const absolute = [];
        for (const e of orderEntries) {
            if (e.enabled === false) continue;
            const p = byId.get(e.identifier);
            if (!p || !(p.content && String(p.content).trim())) continue;
            const pos = p.injection_position ?? p.injectionPosition ?? 0;
            if (pos !== 1 && pos !== 'absolute') continue;
            absolute.push({
                identifier: p.identifier,
                name: p.name,
                role: p.role || 'system',
                content: p.content,
                injection_depth: p.injection_depth ?? p.injectionDepth ?? 0,
                injection_order: p.injection_order ?? p.injectionOrder ?? DEFAULT_ORDER,
                injection_position: pos
            });
        }
        return absolute;
    },

    getCurrentPrompts() {
        if (!this.currentPreset) return [];
        const preset = this.currentPreset;
        const prompts = preset.prompts || [];
        const orderEntries = this.getPromptOrderForCharacter(null);
        const byId = new Map(prompts.map(p => [p.identifier, p]));
        const ordered = [];
        for (const e of orderEntries) {
            const p = byId.get(e.identifier);
            if (p) ordered.push(p);
        }
        prompts.forEach(p => {
            if (!orderEntries.some(e => e.identifier === p.identifier)) ordered.push(p);
        });
        return ordered;
    },

    getCurrentParameters() {
        if (!this.currentPreset) return null;
        const p = this.currentPreset;
        const params = p.parameters || p;
        return {
            temperature: params.temperature ?? params.temp_openai ?? 0.8,
            topP: params.top_p ?? params.top_p_openai ?? 0.9,
            frequencyPenalty: params.frequencyPenalty ?? params.freq_pen_openai ?? 0,
            presencePenalty: params.presencePenalty ?? params.pres_pen_openai ?? 0,
            maxTokens: params.maxTokens ?? params.openai_max_tokens ?? 4096
        };
    },

    load(presetId) {
        const preset = this.presets.find(p => p.id === presetId);
        if (preset) {
            this.currentPreset = preset;
            if (preset.regexBindings && preset.regexBindings.length) {
                this._applyRegexBindings(preset.regexBindings);
            }
            return true;
        }
        return false;
    },

    _applyRegexBindings(regexIds) {
        if (typeof RegexProcessor === 'undefined') return;
        (regexIds || []).forEach(regexId => {
            const script = RegexProcessor.regexScripts?.get(regexId);
            if (script) {
                script.type = 'preset';
                if (script.enabled) RegexProcessor.enableRegex?.(regexId, 'preset');
            }
        });
    },

    /**
     * 照搬 ST 预设 JSON 格式解析
     * 关键点：
     * 1. prompt_order[0].order 定义显示顺序
     * 2. prompt_order[0].order 中的 enabled 覆盖 prompts 中的默认 enabled
     * 3. 不过滤 {{// 注释内容
     */
    _parseSillyTavernPreset(data) {
        const name = data.name || data.preset_name || '未命名预设';
        const preset = {
            id: data.id || `preset_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            name,
            source: 'sillytavern',
            enabled: data.enabled !== false,
            createdAt: data.createdAt ?? data.created_at ?? Date.now(),
            updatedAt: Date.now(),
            parameters: {
                temperature: data.temp_openai ?? data.temperature ?? 1,
                topP: data.top_p_openai ?? data.top_p ?? 1,
                topK: data.top_k_openai ?? data.top_k ?? 0,
                minP: data.min_p_openai ?? data.min_p ?? 0,
                frequencyPenalty: data.freq_pen_openai ?? data.frequency_penalty ?? 0,
                presencePenalty: data.pres_pen_openai ?? data.presence_penalty ?? 0,
                maxTokens: data.openai_max_tokens ?? data.max_tokens ?? 300,
                maxContext: data.openai_max_context ?? data.max_context ?? 4096
            },
            prompts: [],
            prompt_order: [],  // 完整保留 ST 格式的 prompt_order
            promptOrder: [],   // 扁平化的顺序数组（仅 identifier）
            regexBindings: data['regexes-bindings'] || data.regexBindings || [],
            settings: {
                stream: data.stream_openai ?? data.stream ?? false,
                useSysprompt: data.use_sysprompt ?? false,
                enabled: data.enabled !== false,
                usePreset: data.use_preset !== false,
                wiFormat: data.wi_format ?? '{0}',
                scenarioFormat: data.scenario_format ?? '{{scenario}}',
                personalityFormat: data.personality_format ?? '{{personality}}'
            }
        };

        // 1. 先解析 prompt_order 以获取顺序和启用状态覆盖
        const orderMap = new Map(); // identifier -> { enabled, index }
        let hasValidOrder = false;

        if (Array.isArray(data.prompt_order) && data.prompt_order.length > 0) {
            const firstEntry = data.prompt_order[0];
            if (firstEntry && typeof firstEntry === 'object' && Array.isArray(firstEntry.order)) {
                hasValidOrder = true;
                // 完整保留 prompt_order 结构
                preset.prompt_order = JSON.parse(JSON.stringify(data.prompt_order));

                // 建立顺序映射
                firstEntry.order.forEach((entry, index) => {
                    const id = typeof entry === 'string' ? entry : entry?.identifier;
                    const enabled = typeof entry === 'object' && entry !== null && 'enabled' in entry
                        ? entry.enabled
                        : true; // 默认启用
                    if (id) {
                        orderMap.set(id, { enabled, index });
                    }
                });
            }
        }

        // 2. 解析 prompts 数组，不过滤 {{// 注释
        const promptsById = new Map();
        if (Array.isArray(data.prompts)) {
            for (const p of data.prompts) {
                // 不再过滤 {{// 开头的内容 - SillyTavern 不会过滤
                const identifier = p.identifier;

                // 从 prompt_order 获取启用状态覆盖
                const orderInfo = orderMap.get(identifier);
                const enabled = orderInfo !== undefined ? orderInfo.enabled : (p.enabled !== false);

                const prompt = {
                    identifier: identifier,
                    name: p.name || p.identifier,
                    role: p.role || 'system',
                    content: p.content || '',
                    injection_position: p.injection_position ?? 0,
                    injection_depth: p.injection_depth ?? 0,
                    injection_order: p.injection_order ?? DEFAULT_ORDER,
                    injectionPosition: p.injection_position ?? 0,
                    injectionDepth: p.injection_depth ?? 0,
                    injectionOrder: p.injection_order ?? DEFAULT_ORDER,
                    enabled: enabled,
                    system_prompt: p.system_prompt ?? false,
                    marker: p.marker ?? false,
                    forbid_overrides: p.forbid_overrides ?? false
                };

                preset.prompts.push(prompt);
                promptsById.set(identifier, prompt);
            }
        }

        // 3. 构建 promptOrder（按 prompt_order[0].order 的顺序）
        if (hasValidOrder) {
            const firstEntry = data.prompt_order[0];
            // 按 prompt_order[0].order 中的顺序排列
            for (const entry of firstEntry.order) {
                const id = typeof entry === 'string' ? entry : entry?.identifier;
                if (id && promptsById.has(id)) {
                    preset.promptOrder.push(id);
                }
            }
            // 将不在 prompt_order 中但在 prompts 中的添加到末尾
            for (const p of preset.prompts) {
                if (!preset.promptOrder.includes(p.identifier)) {
                    preset.promptOrder.push(p.identifier);
                }
            }
        } else if (Array.isArray(data.prompt_order) && data.prompt_order.length > 0) {
            // 兼容扁平格式的 prompt_order
            for (const entry of data.prompt_order) {
                const id = typeof entry === 'string' ? entry : entry?.identifier;
                if (id && promptsById.has(id)) {
                    preset.promptOrder.push(id);
                }
            }
            for (const p of preset.prompts) {
                if (!preset.promptOrder.includes(p.identifier)) {
                    preset.promptOrder.push(p.identifier);
                }
            }
        } else {
            // 没有 prompt_order，使用 prompts 数组顺序
            preset.promptOrder = preset.prompts.map(p => p.identifier);
        }

        // 4. 按 promptOrder 顺序重排 prompts 数组
        const orderedPrompts = [];
        for (const id of preset.promptOrder) {
            const p = promptsById.get(id);
            if (p) orderedPrompts.push(p);
        }
        preset.prompts = orderedPrompts;

        return preset;
    },

    async importFromFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => {
                try {
                    const data = JSON.parse(e.target.result);
                    const preset = this._parseSillyTavernPreset(data);
                    this.presets.push(preset);
                    this._save();
                    resolve(preset);
                } catch (err) {
                    reject(err);
                }
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsText(file);
        });
    },

    create(name) {
        const preset = {
            id: String(Date.now()),
            name: name || '新预设',
            source: 'local',
            enabled: true,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            parameters: {
                temperature: 1,
                topP: 1,
                topK: 0,
                minP: 0,
                frequencyPenalty: 0,
                presencePenalty: 0,
                maxTokens: 300,
                maxContext: 4096
            },
            prompts: [],
            prompt_order: [{ character_id: 0, order: [] }],
            promptOrder: [],
            regexBindings: [],
            settings: { stream: false, useSysprompt: false, enabled: true, usePreset: true, wiFormat: '{0}', scenarioFormat: '{{scenario}}', personalityFormat: '{{personality}}' }
        };
        this.presets.push(preset);
        this._save();
        return preset;
    },

    update(presetId, updates) {
        const preset = this.presets.find(p => p.id === presetId);
        if (preset) {
            Object.assign(preset, updates, { updatedAt: Date.now() });
            this._save();
            return true;
        }
        return false;
    },

    delete(presetId) {
        this.presets = this.presets.filter(p => p.id !== presetId);
        if (this.currentPreset?.id === presetId) this.currentPreset = null;
        this._save();
    },

    /** 把删掉的预设放回去；列表里已有同一个预设时不覆盖，返回 false */
    restore(preset) {
        if (this.presets.some(p => p.id === preset.id)) return false;
        this.presets.push(preset);
        this._save();
        return true;
    },

    getAll() {
        return [...this.presets];
    },

    export(presetId) {
        const preset = this.presets.find(p => p.id === presetId);
        if (!preset) return null;
        const out = {
            id: preset.id,
            name: preset.name,
            enabled: preset.enabled !== false,
            use_preset: preset.settings?.usePreset !== false,
            temp_openai: preset.parameters?.temperature ?? 1,
            top_p_openai: preset.parameters?.topP ?? 1,
            top_k_openai: preset.parameters?.topK ?? 0,
            freq_pen_openai: preset.parameters?.frequencyPenalty ?? 0,
            pres_pen_openai: preset.parameters?.presencePenalty ?? 0,
            openai_max_tokens: preset.parameters?.maxTokens ?? 300,
            openai_max_context: preset.parameters?.maxContext ?? 4096,
            prompts: (preset.prompts || []).map(p => ({
                identifier: p.identifier,
                name: p.name,
                role: p.role,
                content: p.content,
                injection_position: p.injection_position ?? p.injectionPosition ?? 0,
                injection_depth: p.injection_depth ?? p.injectionDepth ?? 0,
                injection_order: p.injection_order ?? p.injectionOrder ?? DEFAULT_ORDER,
                enabled: p.enabled !== false
            })),
            prompt_order: preset.prompt_order || (preset.promptOrder || []).map(id => ({ identifier: id, enabled: true })),
            'regexes-bindings': preset.regexBindings || []
        };
        FileDownload.save(JSON.stringify(out, null, 2), `preset_${preset.name || 'export'}`, 'json', 'application/json');
        return true;
    },

    bindRegexToPreset(presetId, regexId) {
        const preset = this.presets.find(p => p.id === presetId);
        if (!preset) return false;
        preset.regexBindings = preset.regexBindings || [];
        if (!preset.regexBindings.includes(regexId)) {
            preset.regexBindings.push(regexId);
            this._save();
        }
        return true;
    },

    unbindRegexFromPreset(presetId, regexId) {
        const preset = this.presets.find(p => p.id === presetId);
        if (!preset || !preset.regexBindings) return false;
        preset.regexBindings = preset.regexBindings.filter(id => id !== regexId);
        this._save();
        return true;
    },

    movePrompt(presetId, promptId, newIndex) {
        const preset = this.presets.find(p => p.id === presetId);
        if (!preset) return false;

        // 获取当前的 order 数组（保留 enabled 状态）
        const currentOrder = preset.prompt_order?.[0]?.order || [];
        const enabledMap = new Map();

        // 建立 identifier -> enabled 的映射
        for (const entry of currentOrder) {
            const id = typeof entry === 'string' ? entry : entry?.identifier;
            const enabled = typeof entry === 'object' && entry !== null && 'enabled' in entry
                ? entry.enabled
                : true;
            if (id) enabledMap.set(id, enabled);
        }

        // 使用 promptOrder 进行排序操作
        const order = [...(preset.promptOrder || [])];
        const idx = order.indexOf(promptId);
        if (idx === -1) return false;

        order.splice(idx, 1);
        order.splice(newIndex, 0, promptId);
        preset.promptOrder = order;

        // 更新 prompt_order 结构，保留原来的 enabled 状态
        if (preset.prompt_order?.[0]) {
            preset.prompt_order[0].order = order.map(id => ({
                identifier: id,
                enabled: enabledMap.has(id) ? enabledMap.get(id) : true
            }));
        } else {
            preset.prompt_order = [{
                character_id: 0,
                order: order.map(id => ({ identifier: id, enabled: enabledMap.get(id) ?? true }))
            }];
        }

        this._save();
        return true;
    }
};

if (typeof window !== 'undefined') window.PresetManager = PresetManager;
