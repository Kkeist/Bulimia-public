/**
 * 预设编辑器
 * 迁移自SillyTavern的PromptManager，支持完整的预设编辑功能
 */

const PresetEditor = {
    currentPreset: null,
    prompts: [],

    /**
     * 初始化
     */
    init() {
        this.bindEvents();
        this.loadPresetList();
        // 启动时：优先恢复上次选择的“当前预设”，若无则使用“默认预设”（写作指导已独立注入，不再作为预设）
        const settings = Storage.getSettings() || {};
        const last = settings.currentPromptPresetId || settings.defaultPromptPresetId;
        if (last && PresetManager.getAll().some(p => p.id === last)) {
            const select = document.getElementById('prompt-preset-select');
            if (select) select.value = last;
            this.loadPreset(last);
        } else {
            this.loadPreset(settings.currentPromptPresetId || '');
        }
    },

    /**
     * 绑定事件
     */
    bindEvents() {
        // 预设选择
        document.getElementById('prompt-preset-select')?.addEventListener('change', (e) => {
            this.loadPreset(e.target.value);
        });

        // 预设操作
        document.getElementById('btn-preset-new')?.addEventListener('click', () => this.newPreset());
        document.getElementById('btn-preset-save')?.addEventListener('click', () => this.savePreset());
        document.getElementById('preset-enable-checkbox')?.addEventListener('change', (e) => this.togglePresetEnabled(e.target.checked));
        // 重命名、导出、删除操作在预设列表中提供，不需要先选择预设
        document.getElementById('btn-import-preset')?.addEventListener('click', () => {
            document.getElementById('file-import-preset')?.click();
        });
        document.getElementById('file-import-preset')?.addEventListener('change', (e) => {
            const f = e.target.files?.[0];
            if (f) this.importPreset(f);
            e.target.value = '';
        });

        // 提示词条目
        document.getElementById('btn-preset-prompt-add')?.addEventListener('click', () => this.addPromptVisual());
        document.getElementById('btn-preset-prompt-sort')?.addEventListener('click', () => this.sortPrompts());
        this._bindListEvents();

        // 模块绑定
        document.getElementById('btn-preset-bind-module')?.addEventListener('click', () => this.bindModule());
        document.getElementById('btn-preset-unbind-module')?.addEventListener('click', () => this.unbindModule());

        // 参数变化
        ['preset-temp', 'preset-top-p', 'preset-freq-pen', 'preset-pres-pen', 'preset-max-tokens'].forEach(id => {
            document.getElementById(id)?.addEventListener('input', () => {
                if (this.currentPreset) {
                    this.currentPreset.parameters = this.getParameters();
                }
            });
        });
    },

    /**
     * 加载预设列表
     */
    loadPresetList() {
        const select = document.getElementById('prompt-preset-select');
        if (!select) return;

        const presets = PresetManager.getAll();
        select.innerHTML = '<option value="">不使用预设</option>' +
            presets.map(p => `<option value="${this._esc(p.id)}">${this._esc(p.name)}</option>`).join('');

        // 关键：保持下拉框选中不“跳回无预设”
        if (this.currentPreset?.id) {
            select.value = this.currentPreset.id;
        } else {
            select.value = '';
        }

        // 同时更新预设列表显示
        this.renderPresetList();
    },

    /**
     * 加载预设
     */
    loadPreset(presetId) {
        if (!presetId) {
            this.currentPreset = null;
            this.prompts = [];
            this._lastJsonOrder = null;
            this.loadModuleList();
            this.renderPromptsVisual();

            // 让“无预设”真正生效
            PresetManager.currentPreset = null;
            // saveSettings 走 spread merge 不能删 key，走专用 deleteSettingsKey
            Storage.deleteSettingsKey('currentPromptPresetId');

            this.syncPresetEnableCheckbox();
            return;
        }

        const preset = PresetManager.getAll().find(p => p.id === presetId);
        if (!preset) {
            // 传入了 ID 但 preset 不存在（已被删 / 数据损坏）—— 清掉 settings 里的死引用并回退到"无预设"
            const settings = Storage.getSettings() || {};
            if (settings.currentPromptPresetId === presetId) {
                Storage.deleteSettingsKey('currentPromptPresetId');
            }
            const sel = document.getElementById('prompt-preset-select');
            if (sel) sel.value = '';
            this.currentPreset = null;
            this.prompts = [];
                return;
        }

        this.currentPreset = preset;
        this.prompts = preset.prompts || [];
        // 记录“JSON 顺序”的参考顺序，用于从字母顺序恢复
        this._lastJsonOrder = [...(preset.promptOrder || [])];

        // 让“当前预设”真正生效（并持久化）
        PresetManager.load(presetId);
        const settings = Storage.getSettings() || {};
        settings.currentPromptPresetId = presetId;
        Storage.saveSettings(settings);

        // 确保promptOrder存在且正确
        if (!preset.promptOrder || preset.promptOrder.length === 0) {
            preset.promptOrder = this.prompts.map(p => p.identifier);
            PresetManager.update(preset.id, { promptOrder: preset.promptOrder });
        }

        // 加载参数
        if (preset.parameters) {
            document.getElementById('preset-temp').value = preset.parameters.temperature || 1.0;
            document.getElementById('preset-top-p').value = preset.parameters.topP || 1.0;
            document.getElementById('preset-freq-pen').value = preset.parameters.frequencyPenalty ?? 0;
            document.getElementById('preset-pres-pen').value = preset.parameters.presencePenalty ?? 0;
            document.getElementById('preset-max-tokens').value = preset.parameters.maxTokens || 300;
        }

        this.renderPromptsVisual();
        this.loadModuleList();

        // 更新正则管理器中的预设选择
        if (RegexManager && typeof RegexManager.loadPreset === 'function') {
            RegexManager.loadPreset(preset.id);
        }

        this.renderPromptsVisual();
        this.syncPresetEnableCheckbox();
    },

    /**
     * 新建预设
     */
    async newPreset() {
        const name = await Modal.prompt('新建预设', '预设名称');
        if (!name || !name.trim()) return;

        const preset = PresetManager.create(name.trim());
        this.currentPreset = preset;
        this.prompts = [];

        // 添加默认prompts
        this.addDefaultPrompts();

        this.loadPresetList();
        document.getElementById('prompt-preset-select').value = preset.id;
        Toast.show('已创建预设。', 'success');
    },

    /**
     * 添加默认prompts
     */
    addDefaultPrompts() {
        const defaults = [
            {
                identifier: 'main',
                name: '主提示词',
                role: 'system',
                content: 'Write {{char}}\'s next reply in a fictional chat between {{char}} and {{user}}.',
                injectionPosition: 0,
                injectionDepth: 0,
                enabled: true
            },
            {
                identifier: 'nsfw',
                name: 'NSFW提示词',
                role: 'system',
                content: '',
                injectionPosition: 0,
                injectionDepth: 0,
                enabled: false
            },
            {
                identifier: 'jailbreak',
                name: '越狱提示词',
                role: 'system',
                content: '',
                injectionPosition: 0,
                injectionDepth: 0,
                enabled: false
            }
        ];

        defaults.forEach(p => {
            if (!this.prompts.find(ep => ep.identifier === p.identifier)) {
                this.prompts.push(p);
            }
        });
    },

    /**
     * 保存预设
     */
    async savePreset() {
        if (!this.currentPreset) {
            Toast.show('请先选择或新建预设。', 'warning');
            return;
        }

        // 更新预设数据
        this.currentPreset.parameters = this.getParameters();
        this.currentPreset.prompts = this.prompts;

        // 保持promptOrder（如果存在），否则根据当前prompts生成
        if (!this.currentPreset.promptOrder || this.currentPreset.promptOrder.length === 0) {
            this.currentPreset.promptOrder = this.prompts.map(p => p.identifier);
        } else {
            // 确保promptOrder包含所有prompts的identifier
            const existingOrder = [...this.currentPreset.promptOrder];
            this.prompts.forEach(p => {
                if (!existingOrder.includes(p.identifier)) {
                    existingOrder.push(p.identifier);
                }
            });
            this.currentPreset.promptOrder = existingOrder;
        }

        PresetManager.update(this.currentPreset.id, this.currentPreset);
        this.loadPresetList(); // 刷新列表
        Toast.show('已保存。', 'success');
    },

    /**
     * 重命名预设（可以传入presetId，也可以使用当前预设）
     */
    async renamePreset(presetId = null) {
        const targetPresetId = presetId || (this.currentPreset?.id);
        if (!targetPresetId) {
            Toast.show('请先选择预设。', 'warning');
            return;
        }

        const preset = PresetManager.getAll().find(p => p.id === targetPresetId);
        if (!preset) {
            Toast.show('找不到这个预设。', 'error');
            return;
        }

        const newName = await Modal.prompt('重命名预设', '预设名称', preset.name);
        if (!newName || !newName.trim()) return;

        if (newName.trim() === preset.name) {
            Toast.show('名称没有变化。', 'info');
            return;
        }

        // 检查名称是否已存在
        const existing = PresetManager.getAll().find(p => p.id !== targetPresetId && p.name === newName.trim());
        if (existing) {
            Toast.show('已有同名预设。', 'error');
            return;
        }

        PresetManager.update(targetPresetId, { name: newName.trim() });

        // 如果重命名的是当前预设，更新currentPreset
        if (this.currentPreset && this.currentPreset.id === targetPresetId) {
            this.currentPreset.name = newName.trim();
        }

        this.loadPresetList();
        if (this.currentPreset && this.currentPreset.id === targetPresetId) {
            document.getElementById('prompt-preset-select').value = targetPresetId;
        }
        this.renderPresetList();
        Toast.show('已重命名。', 'success');
    },

    /**
     * 删除预设（可以传入presetId，也可以使用当前预设）
     */
    async deletePreset(presetId = null) {
        const targetPresetId = presetId || (this.currentPreset?.id);
        if (!targetPresetId) {
            Toast.show('请先选择预设。', 'warning');
            return;
        }

        const preset = PresetManager.getAll().find(p => p.id === targetPresetId);
        if (!preset) {
            Toast.show('找不到这个预设。', 'error');
            return;
        }

        const confirmed = await Modal.confirm('删除预设', `确定要删除预设“${this._esc(preset.name)}”吗？`, { danger: true, confirmLabel: '删除' });
        if (!confirmed) return;

        const snapshot = JSON.parse(JSON.stringify(preset));
        const wasCurrent = !!(this.currentPreset && this.currentPreset.id === targetPresetId);
        PresetManager.delete(targetPresetId);

        // 删除的是当前预设时，清空当前预设
        if (wasCurrent) {
            this.currentPreset = null;
            this.prompts = [];
            document.getElementById('prompt-preset-select').value = '';
        }

        // 设置里记着这个预设时一并清掉，下次启动才不会找不到它
        const settings = Storage.getSettings() || {};
        if (settings.currentPromptPresetId === targetPresetId) {
            Storage.deleteSettingsKey('currentPromptPresetId');
        }

        this.loadPresetList();
        this.renderPresetList();
        Toast.undo('已删除预设。', () => {
            if (!PresetManager.restore(snapshot)) {
                Toast.show('撤销失败，这个预设已经有同名记录。', 'error');
                return;
            }
            this.loadPresetList();
            if (wasCurrent) this.loadPreset(snapshot.id);
            this.renderPresetList();
        });
    },

    /**
     * 开关「启用预设」：勾选=启用预设+其绑定正则，不勾选=不注入预设且不启用其绑定正则
     */
    togglePresetEnabled(checked) {
        const select = document.getElementById('prompt-preset-select');
        const presetId = select?.value;
        if (!presetId) {
            Toast.show('请先选择预设。', 'warning');
            return;
        }
        const preset = PresetManager.presets?.find(p => p.id === presetId);
        if (!preset) return;
        preset.enabled = !!checked;
        if (!preset.settings) preset.settings = {};
        preset.settings.usePreset = !!checked;
        preset.settings.enabled = !!checked;
        const ids = preset.regexBindings || [];
        if (typeof RegexProcessor !== 'undefined' && RegexProcessor.enabledRegex?.preset) {
            ids.forEach(regexId => RegexProcessor.enabledRegex.preset.delete(regexId));
            if (checked) {
                ids.forEach(regexId => {
                    const script = RegexProcessor.regexScripts?.get(regexId);
                    if (script?.enabled) RegexProcessor.enableRegex?.(regexId, 'preset');
                });
            }
        }
        PresetManager._save();
        this.currentPreset = preset;
        Toast.show(checked ? '已启用预设。' : '已关闭预设。', 'success');
    },

    /** 同步「启用预设」勾选与当前预设状态（加载预设/切换预设时调用） */
    syncPresetEnableCheckbox() {
        const cb = document.getElementById('preset-enable-checkbox');
        if (!cb) return;
        const preset = this.currentPreset || (PresetManager.currentPreset || null);
        cb.disabled = !preset;
        const enabled = preset && preset.enabled !== false && preset.settings?.usePreset !== false;
        cb.checked = !!enabled;
    },

    /**
     * 获取参数
     */
    getParameters() {
        return {
            temperature: parseFloat(document.getElementById('preset-temp').value) || 1.0,
            topP: parseFloat(document.getElementById('preset-top-p').value) || 1.0,
            frequencyPenalty: parseFloat(document.getElementById('preset-freq-pen').value) || 0,
            presencePenalty: parseFloat(document.getElementById('preset-pres-pen').value) || 0,
            maxTokens: parseInt(document.getElementById('preset-max-tokens').value) || 300
        };
    },

    // ===== spreset风格：可视化 prompt 编辑 =====

    _ensurePromptOrderCoversAll() {
        if (!this.currentPreset) return;
        this.currentPreset.promptOrder = this.currentPreset.promptOrder || [];
        for (const p of (this.prompts || [])) {
            if (!this.currentPreset.promptOrder.includes(p.identifier)) {
                this.currentPreset.promptOrder.push(p.identifier);
            }
        }
        // 移除不存在的identifier
        this.currentPreset.promptOrder = this.currentPreset.promptOrder.filter(id => (this.prompts || []).some(p => p.identifier === id));
    },

    async addPromptVisual() {
        if (!this.currentPreset) {
            Toast.show('请先选择预设。', 'warning');
            return;
        }
        const name = await Modal.prompt('新增条目', '条目名称');
        if (name == null) return;
        const id = `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        const prompt = {
            identifier: id,
            name: String(name).trim() || '新条目',
            role: 'system',
            content: '',
            injectionPosition: 0,
            injectionDepth: 0,
            injectionOrder: 100,
            enabled: true,
        };
        this.prompts.push(prompt);
        this._ensurePromptOrderCoversAll();
        this.currentPreset.prompts = this.prompts;
        PresetManager.update(this.currentPreset.id, { prompts: this.prompts, promptOrder: this.currentPreset.promptOrder });
        this.renderPromptsVisual();
        this.editPromptVisual(id);
    },

    movePromptInOrder(identifier, delta) {
        if (!this.currentPreset) return;
        const order = this.currentPreset.promptOrder || [];
        const idx = order.indexOf(identifier);
        if (idx === -1) return;
        const newIdx = idx + delta;
        if (newIdx < 0 || newIdx >= order.length) return;
        order.splice(idx, 1);
        order.splice(newIdx, 0, identifier);
        this.currentPreset.promptOrder = order;
        PresetManager.update(this.currentPreset.id, { promptOrder: order });
        this.renderPromptsVisual();
    },

    async editPromptVisual(identifier) {
        if (!this.currentPreset) return;
        const prompt = this.prompts.find(p => p.identifier === identifier);
        if (!prompt) return;

        const pos = Number(prompt.injection_position ?? prompt.injectionPosition ?? 0) === 1 ? 1 : 0;
        const depth = Number(prompt.injection_depth ?? prompt.injectionDepth ?? 0) || 0;
        const order = Number(prompt.injection_order ?? prompt.injectionOrder ?? 100) || 0;
        const html = `
            <div class="form-group">
                <label for="pm-name">名称</label>
                <input type="text" id="pm-name" autocomplete="off">
            </div>
            <div class="form-group">
                <label>角色</label>
                <select id="pm-role">
                    <option value="system">系统</option>
                    <option value="user">玩家</option>
                    <option value="assistant">AI</option>
                </select>
            </div>
            <div class="form-group">
                <label>位置</label>
                <select id="pm-pos">
                    <option value="0">按顺序排列</option>
                    <option value="1">插入对话中</option>
                </select>
            </div>
            <div class="field-row">
                <div class="form-group"><label>插入深度</label><input type="number" id="pm-depth" min="0" max="100" step="1"></div>
                <div class="form-group"><label>顺序</label><input type="number" id="pm-order" min="0" max="100000" step="1"></div>
            </div>
            <label class="setting-check"><input type="checkbox" id="pm-enabled">启用</label>
            <div class="form-group">
                <label for="pm-content">内容</label>
                <textarea id="pm-content" rows="10"></textarea>
            </div>
        `;

        Modal.show('编辑条目', html, {
            wide: true,
            buttons: [
                { label: '取消', action: 'cancel' },
                { label: '保存', action: 'save', class: 'btn-primary' }
            ],
            onAction: (action) => {
                if (action !== 'save') { Modal.close(); return; }
                const read = (id) => document.getElementById(id);
                prompt.name = read('pm-name').value.trim() || prompt.name || '新条目';
                prompt.role = read('pm-role').value;
                prompt.enabled = read('pm-enabled').checked;
                prompt.injectionPosition = prompt.injection_position = Number(read('pm-pos').value) === 1 ? 1 : 0;
                prompt.injectionDepth = prompt.injection_depth = parseInt(read('pm-depth').value, 10) || 0;
                prompt.injectionOrder = prompt.injection_order = parseInt(read('pm-order').value, 10) || 0;
                prompt.content = read('pm-content').value || '';

                this._ensurePromptOrderCoversAll();
                PresetManager.update(this.currentPreset.id, { prompts: this.prompts, promptOrder: this.currentPreset.promptOrder });
                this.renderPromptsVisual();
                Modal.close();
                Toast.show('已保存。', 'success');
            }
        });

        const read = (id) => document.getElementById(id);
        read('pm-name').value = prompt.name || '';
        read('pm-role').value = prompt.role || 'system';
        read('pm-pos').value = String(pos);
        read('pm-depth').value = depth;
        read('pm-order').value = order;
        read('pm-enabled').checked = prompt.enabled !== false;
        read('pm-content').value = prompt.content || '';
        const syncDepth = () => { read('pm-depth').disabled = read('pm-pos').value !== '1'; };
        read('pm-pos').addEventListener('change', syncDepth);
        syncDepth();
    },

    async deletePromptVisual(identifier) {
        if (!this.currentPreset) return;
        const index = this.prompts.findIndex(p => p.identifier === identifier);
        if (index < 0) return;
        const removed = this.prompts[index];
        const order = (this.currentPreset.promptOrder || []).slice();
        this.prompts = this.prompts.filter(p => p.identifier !== identifier);
        this.currentPreset.prompts = this.prompts;
        this._ensurePromptOrderCoversAll();
        PresetManager.update(this.currentPreset.id, { prompts: this.prompts, promptOrder: this.currentPreset.promptOrder });
        this.renderPromptsVisual();
        Toast.undo('已删除条目。', () => {
            if (!this.currentPreset) return;
            this.prompts.splice(Math.min(index, this.prompts.length), 0, removed);
            this.currentPreset.prompts = this.prompts;
            this.currentPreset.promptOrder = order;
            this._ensurePromptOrderCoversAll();
            PresetManager.update(this.currentPreset.id, { prompts: this.prompts, promptOrder: this.currentPreset.promptOrder });
            this.renderPromptsVisual();
        });
    },

    /**
     * 排序Prompts（按钮选择：JSON 顺序 / 字母顺序）
     */
    sortPrompts() {
        if (!this.currentPreset) {
            Toast.show('请先选择预设。', 'warning');
            return;
        }
        const html = `
            <div class="choice-row sort-method-buttons">
                <button type="button" data-sort="json">原始顺序</button>
                <button type="button" data-sort="alphabetical">按名称排序</button>
            </div>
        `;
        Modal.show('排序方式', html, {
            buttons: [{ label: '关闭', action: 'close' }],
            onAction: () => Modal.close()
        });
        document.getElementById('modal-container')?.querySelector('.sort-method-buttons')?.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-sort]');
            if (!btn) return;
            Modal.close(true);
            this._applySortMethod(btn.dataset.sort);
        });
    },

    _applySortMethod(method) {
        if (method === 'json') {
            // 使用加载预设时保存的顺序，这样“字母顺序”后再点“JSON 顺序”能恢复
            const order = (this._lastJsonOrder && this._lastJsonOrder.length) ? this._lastJsonOrder : (this.currentPreset.promptOrder || []);
            const ordered = [];
            const seen = new Set();
            order.forEach(identifier => {
                const prompt = this.prompts.find(p => p.identifier === identifier);
                if (prompt) { ordered.push(prompt); seen.add(identifier); }
            });
            this.prompts.forEach(prompt => {
                if (!seen.has(prompt.identifier)) ordered.push(prompt);
            });
            this.prompts = [...ordered];
            this.currentPreset.promptOrder = this.prompts.map(p => p.identifier);
            this._lastJsonOrder = [...this.currentPreset.promptOrder];
            PresetManager.update(this.currentPreset.id, { prompts: this.prompts, promptOrder: this.currentPreset.promptOrder });
            this.renderPromptsVisual();
                Toast.show('已恢复原始顺序。', 'success');
        } else if (method === 'alphabetical') {
            this.prompts.sort((a, b) => {
                return String(a.name || a.identifier || '').localeCompare(String(b.name || b.identifier || ''), 'zh');
            });
            this.currentPreset.promptOrder = this.prompts.map(p => p.identifier);
            PresetManager.update(this.currentPreset.id, { prompts: this.prompts, promptOrder: this.currentPreset.promptOrder });
            this.renderPromptsVisual();
                Toast.show('已按名称排序。', 'success');
        }
    },

    renderPromptsVisual() {
        const container = document.getElementById('preset-prompts-visual-list');
        if (!container) return;
        const panel = document.getElementById('settings-panel-preset');
        ScrollMemory.preserve(panel, () => {
            container.textContent = '';
            if (!this.currentPreset) {
                container.innerHTML = '<div class="item-list-empty">请先选择预设。</div>';
                return;
            }
            const order = this.currentPreset.promptOrder || [];
            const ordered = [];
            const seen = new Set();
            for (const id of order) {
                const p = this.prompts.find(x => x.identifier === id);
                if (p) { ordered.push(p); seen.add(id); }
            }
            for (const p of this.prompts) if (!seen.has(p.identifier)) ordered.push(p);
            if (ordered.length === 0) {
                container.innerHTML = '<div class="item-list-empty">还没有条目。</div>';
                return;
            }
            const roleName = { system: '系统', user: '玩家', assistant: 'AI' };
            ordered.forEach((p, i) => {
                const card = document.createElement('div');
                card.className = 'card' + (p.enabled ? '' : ' is-off');
                card.dataset.id = p.identifier;
                const head = document.createElement('div');
                head.className = 'card-head';
                const label = document.createElement('label');
                label.className = 'setting-check';
                const box = document.createElement('input');
                box.type = 'checkbox';
                box.className = 'prompt-enabled';
                box.checked = !!p.enabled;
                label.appendChild(box);
                head.appendChild(label);
                const title = document.createElement('span');
                title.className = 'card-title';
                title.textContent = p.name || p.identifier;
                head.appendChild(title);
                const badge = document.createElement('span');
                badge.className = 'badge';
                badge.textContent = roleName[p.role] || p.role;
                head.appendChild(badge);
                const actions = document.createElement('div');
                actions.className = 'card-head-actions';
                actions.innerHTML =
                    '<button type="button" class="btn-small" data-act="up"' + (i === 0 ? ' disabled' : '') + '>上移</button>' +
                    '<button type="button" class="btn-small" data-act="down"' + (i === ordered.length - 1 ? ' disabled' : '') + '>下移</button>' +
                    '<button type="button" class="btn-small" data-act="edit">编辑</button>' +
                    '<button type="button" class="btn-small danger" data-act="delete">删除</button>';
                head.appendChild(actions);
                card.appendChild(head);
                if (p.content) {
                    const pre = document.createElement('div');
                    pre.className = 'card-preview';
                    pre.textContent = p.content;
                    card.appendChild(pre);
                }
                container.appendChild(card);
            });
        });
    },

    _esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },

    /** 条目列表与预设列表的按钮、勾选框统一在容器上处理 */
    _bindListEvents() {
        const prompts = document.getElementById('preset-prompts-visual-list');
        if (prompts) {
            prompts.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-act]');
                const card = e.target.closest('.card');
                if (!btn || !card) return;
                const id = card.dataset.id;
                if (btn.dataset.act === 'up') this.movePromptInOrder(id, -1);
                else if (btn.dataset.act === 'down') this.movePromptInOrder(id, 1);
                else if (btn.dataset.act === 'edit') this.editPromptVisual(id);
                else if (btn.dataset.act === 'delete') this.deletePromptVisual(id);
            });
            prompts.addEventListener('change', (e) => {
                const card = e.target.closest('.card');
                if (card && e.target.classList.contains('prompt-enabled')) this.togglePromptEnabled(card.dataset.id);
            });
        }
        const presets = document.getElementById('preset-list');
        if (presets) {
            presets.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-act]');
                const row = e.target.closest('.item-list-item');
                if (!btn || !row) return;
                const id = row.dataset.id;
                if (btn.dataset.act === 'load') this._selectPreset(id);
                else if (btn.dataset.act === 'default') { this.setDefaultPreset(id); this.renderPresetList(); }
                else if (btn.dataset.act === 'clear-default') { this.clearDefaultPreset(); this.renderPresetList(); }
                else if (btn.dataset.act === 'rename') this.renamePreset(id);
                else if (btn.dataset.act === 'export') this.exportPreset(id);
                else if (btn.dataset.act === 'delete') this.deletePreset(id);
            });
        }
    },

    _selectPreset(id) {
        this.loadPreset(id);
        const select = document.getElementById('prompt-preset-select');
        if (select) select.value = id;
    },

    togglePromptEnabled(identifier) {
        if (!this.currentPreset) return;
        const p = this.prompts.find(x => x.identifier === identifier);
        if (!p) return;

        // 切换启用状态
        p.enabled = !p.enabled;

        // 同步更新 prompt_order[0].order 中的启用状态
        if (this.currentPreset.prompt_order?.[0]?.order) {
            const orderEntry = this.currentPreset.prompt_order[0].order.find(
                e => (typeof e === 'object' ? e?.identifier : e) === identifier
            );
            if (orderEntry && typeof orderEntry === 'object') {
                orderEntry.enabled = p.enabled;
            }
        }

        PresetManager.update(this.currentPreset.id, {
            prompts: this.prompts,
            prompt_order: this.currentPreset.prompt_order
        });
        this.renderPromptsVisual();
    },



    /**
     * 绑定模块
     */
    bindModule() {
        if (!this.currentPreset) {
            Toast.show('请先选择预设。', 'warning');
            return;
        }

        const moduleId = document.getElementById('preset-module-select')?.value;
        if (!moduleId) {
            Toast.show('请先选择模组。', 'warning');
            return;
        }

        this.currentPreset.moduleId = moduleId;
        PresetManager.update(this.currentPreset.id, this.currentPreset);
        Toast.show('已绑定。', 'success');
    },

    /**
     * 解绑模块
     */
    unbindModule() {
        if (!this.currentPreset) {
            Toast.show('请先选择预设。', 'warning');
            return;
        }

        delete this.currentPreset.moduleId;
        PresetManager.update(this.currentPreset.id, this.currentPreset);
        Toast.show('已解绑。', 'success');
    },

    /**
     * 加载模块列表到选择器
     */
    loadModuleList() {
        const select = document.getElementById('preset-module-select');
        if (!select) return;

        const modules = ModuleManager.getAll();
        select.innerHTML = '<option value="">不绑定</option>' +
            modules.map(m => `<option value="${this._esc(m.id)}">${this._esc(m.name)}</option>`).join('');

        // 如果当前预设绑定了模块，选中它
        if (this.currentPreset?.moduleId) {
            select.value = this.currentPreset.moduleId;
        } else {
            select.value = '';
        }
    },


    /**
     * 导入预设
     */
    async importPreset(file) {
        if (!file) return;

        try {
            const preset = await PresetManager.importFromFile(file);
            this.loadPresetList();
            this.loadPreset(preset.id);
            Toast.show(`已导入预设“${preset.name}”。`, 'success');
        } catch (error) {
            console.error('Import preset error:', error);
            Toast.show('导入失败：' + error.message, 'error');
        }
    },

    /**
     * 导出预设（可以传入presetId，也可以使用当前预设）
     */
    exportPreset(presetId = null) {
        const targetPresetId = presetId || (this.currentPreset?.id);
        if (!targetPresetId) {
            Toast.show('请先选择预设。', 'warning');
            return;
        }

        const preset = PresetManager.getAll().find(p => p.id === targetPresetId);
        if (!preset) {
            Toast.show('找不到这个预设。', 'error');
            return;
        }

        if (PresetManager.export(targetPresetId)) {
            Toast.show('已导出。', 'success');
        } else {
            Toast.show('导出失败。', 'error');
        }
    },

    /**
     * 渲染预设列表（在预设列表区域显示）
     */
    renderPresetList() {
        const list = document.getElementById('preset-list');
        if (!list) return;
        const panel = document.getElementById('settings-panel-preset');
        ScrollMemory.preserve(panel, () => {
            list.textContent = '';
            const presets = PresetManager.getAll();
            if (presets.length === 0) {
                list.innerHTML = '<div class="item-list-empty">还没有预设。</div>';
                return;
            }
            const defaultId = (Storage.getSettings() || {}).defaultPromptPresetId || '';
            presets.forEach(p => {
                const isCurrent = this.currentPreset && p.id === this.currentPreset.id;
                const isDefault = p.id === defaultId;
                const row = document.createElement('div');
                row.className = 'item-list-item' + (isCurrent ? ' active' : '');
                row.dataset.id = p.id;
                const main = document.createElement('div');
                main.className = 'item-main';
                const title = document.createElement('strong');
                title.textContent = p.name + (isDefault ? '（默认）' : '');
                const meta = document.createElement('div');
                meta.className = 'item-meta';
                meta.textContent = `${(p.prompts || []).length} 个条目`;
                main.append(title, meta);
                const actions = document.createElement('div');
                actions.className = 'item-actions';
                actions.innerHTML =
                    '<button type="button" class="btn-small" data-act="load">使用</button>' +
                    (isDefault ? '<button type="button" class="btn-small" data-act="clear-default">取消默认</button>'
                        : '<button type="button" class="btn-small" data-act="default">设为默认</button>') +
                    '<button type="button" class="btn-small" data-act="rename">重命名</button>' +
                    '<button type="button" class="btn-small" data-act="export">导出</button>' +
                    '<button type="button" class="btn-small danger" data-act="delete">删除</button>';
                row.append(main, actions);
                list.appendChild(row);
            });
        });
    },

    /**
     * 将当前选中的预设设为系统默认（启动时若无当前预设则自动选中）
     */
    setDefaultPreset(presetId) {
        const settings = Storage.getSettings() || {};
        settings.defaultPromptPresetId = presetId || this.currentPreset?.id;
        Storage.saveSettings(settings);
        Toast.show('已设为默认预设。', 'success');
    },

    /**
     * 取消默认预设
     */
    clearDefaultPreset() {
        // saveSettings 走 spread merge 不能删 key，走专用 deleteSettingsKey
        Storage.deleteSettingsKey('defaultPromptPresetId');
        Toast.show('已取消默认预设。', 'success');
    }
};

// 导出
if (typeof window !== 'undefined') {
    window.PresetEditor = PresetEditor;
}
