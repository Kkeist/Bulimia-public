/**
 * 正则管理器
 * 迁移自SillyTavern的regex扩展，支持预设绑定正则
 */

const RegexManager = {
    currentPresetId: null,
    /** 已展开详情的脚本 id，刷新列表时保持展开状态 */
    _expandedIds: new Set(),
    // 批量选择模式及选中项（按类型区分：global / preset）
    multiSelectMode: {
        global: false,
        preset: false,
    },
    selectedIds: {
        global: new Set(),
        preset: new Set(),
    },
    
    /**
     * 初始化
     */
    init() {
        this.bindEvents();
        this.loadRegexScripts();
        this.loadPresetList();
    },
    
    /**
     * 绑定事件
     */
    bindEvents() {
        // 预设选择
        document.getElementById('regex-preset-select')?.addEventListener('change', (e) => {
            this.loadPreset(e.target.value);
        });
        
        // 预设操作
        document.getElementById('btn-regex-preset-create')?.addEventListener('click', () => this.createPreset());
        document.getElementById('btn-regex-preset-import')?.addEventListener('click', () => {
            document.getElementById('file-import-regex-preset')?.click();
        });
        document.getElementById('file-import-regex-preset')?.addEventListener('change', async (e) => {
            await this.importPresetRegex(e.target.files);
            // 允许重复选择同一批文件
            e.target.value = '';
        });
        document.getElementById('btn-regex-preset-update')?.addEventListener('click', () => this.updatePreset());
        document.getElementById('btn-regex-preset-apply')?.addEventListener('click', () => this.applyPreset());
        document.getElementById('btn-regex-preset-select-mode')?.addEventListener('click', () => this.toggleSelectMode('preset'));
        document.getElementById('btn-regex-preset-select-all')?.addEventListener('click', () => this.selectAll('preset'));
        document.getElementById('btn-regex-preset-move-to-global')?.addEventListener('click', () => this.moveSelectedToGlobal());
        
        // 全局正则
        document.getElementById('btn-regex-global-add')?.addEventListener('click', () => this.addRegexScript('global'));
        document.getElementById('btn-regex-global-import')?.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.multiple = true;
            input.onchange = async (e) => {
                const files = Array.from(e.target.files || []);
                if (files.length) {
                    await this.importRegexFiles(files, 'global');
                }
            };
            input.click();
        });
        document.getElementById('btn-regex-global-select-mode')?.addEventListener('click', () => this.toggleSelectMode('global'));
        document.getElementById('btn-regex-global-select-all')?.addEventListener('click', () => this.selectAll('global'));
        document.getElementById('btn-regex-global-move-to-preset')?.addEventListener('click', () => this.moveSelectedToPreset());
        document.getElementById('btn-regex-global-delete-selected')?.addEventListener('click', () => this.deleteSelectedScripts('global'));
        
        // 预设正则批量删除
        document.getElementById('btn-regex-preset-delete-selected')?.addEventListener('click', () => this.deleteSelectedScripts('preset'));

        ['regex-global-list', 'regex-preset-bindings'].forEach(id => this._bindListEvents(document.getElementById(id)));
    },

    /** 脚本列表里的按钮与勾选框统一在容器上处理 */
    _bindListEvents(container) {
        if (!container) return;
        container.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-act]');
            const item = e.target.closest('.card');
            if (!btn || !item) return;
            const id = item.dataset.id;
            if (btn.dataset.act === 'toggle') this.toggleDetails(id);
            else if (btn.dataset.act === 'enable') this.toggleScript(id);
            else if (btn.dataset.act === 'edit') this.editScript(id);
            else if (btn.dataset.act === 'delete') this.deleteScript(id);
        });
        container.addEventListener('change', (e) => {
            const box = e.target.closest('.regex-script-select');
            if (box) this.onSelectClick(box.dataset.type, box.dataset.id, box.checked);
        });
    },

    /** 重画脚本列表时保持设置页滚动位置 */
    _redraw(fn) {
        ScrollMemory.preserve(document.getElementById('settings-panel-regex'), fn);
    },
    
    /**
     * 加载正则脚本列表
     */
    loadRegexScripts() {
        const scripts = RegexProcessor.getAllScripts();
        
        // 分离全局和预设
        const globalScripts = scripts.filter(s => s.type === 'global');
        const presetScripts = scripts.filter(s => s.type === 'preset');
        
        this.renderScriptList('regex-global-list', globalScripts, 'global');
        
        // 渲染预设绑定正则（如果有当前预设）
        if (this.currentPresetId) {
            this.renderPresetBindings(presetScripts);
        } else {
            const container = document.getElementById('regex-preset-bindings');
            if (container) {
                container.innerHTML = '<div class="item-list-empty">' + I18n.t('请先选择预设。') + '</div>';
            }
        }
    },
    
    /**
     * HTML转义（用于正则页面显示）
     */
    _escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
    
    /**
     * 渲染脚本列表
     */
    renderScriptList(containerId, scripts, type) {
        const container = document.getElementById(containerId);
        if (!container) return;
        this._redraw(() => {
            container.textContent = '';
            if (scripts.length === 0) {
                container.innerHTML = '<div class="item-list-empty">' + I18n.t('还没有正则脚本。') + '</div>';
                return;
            }
            const isSelectMode = this.multiSelectMode?.[type];
            const selectedSet = this.selectedIds?.[type] || new Set();
            scripts.forEach(script => container.appendChild(this._buildScriptCard(script, type, isSelectMode, selectedSet)));
        });
    },

    _buildScriptCard(script, type, isSelectMode, selectedSet) {
        const expanded = this._expandedIds.has(script.id);
        const card = document.createElement('div');
        card.className = 'card' + (expanded ? '' : ' is-collapsed') + (script.enabled ? '' : ' is-off');
        card.dataset.id = script.id;

        const head = document.createElement('div');
        head.className = 'card-head';
        if (isSelectMode) {
            const box = document.createElement('input');
            box.type = 'checkbox';
            box.className = 'regex-script-select';
            box.dataset.id = script.id;
            box.dataset.type = type;
            box.checked = selectedSet.has(script.id);
            box.setAttribute('aria-label', I18n.t('选择这条正则'));
            head.appendChild(box);
        }
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'card-toggle';
        toggle.dataset.act = 'toggle';
        toggle.setAttribute('aria-label', I18n.t('展开或收起'));
        toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        const chev = document.createElement('span');
        chev.className = 'chev' + (expanded ? '' : ' is-right');
        toggle.appendChild(chev);
        head.appendChild(toggle);
        const title = document.createElement('span');
        title.className = 'card-title';
        title.textContent = script.name;
        head.appendChild(title);
        const actions = document.createElement('div');
        actions.className = 'card-head-actions';
        actions.innerHTML =
            '<button type="button" class="btn-small' + (script.enabled ? ' is-on' : '') + '" data-act="enable" aria-pressed="' + (script.enabled ? 'true' : 'false') + '">' + (script.enabled ? I18n.t('已启用') : I18n.t('未启用')) + '</button>' +
            '<button type="button" class="btn-small" data-act="edit">' + I18n.t('编辑') + '</button>' +
            '<button type="button" class="btn-small danger" data-act="delete">' + I18n.t('删除') + '</button>';
        head.appendChild(actions);
        card.appendChild(head);

        const body = document.createElement('div');
        body.className = 'card-body';
        const addBlock = (label, text) => {
            const l = document.createElement('span');
            l.className = 'card-label';
            l.textContent = label;
            const pre = document.createElement('pre');
            pre.className = 'card-code';
            pre.textContent = text;
            body.append(l, pre);
        };
        addBlock(I18n.t('匹配规则'), script.pattern || '');
        addBlock(I18n.t('替换内容'), script.replacement || '');
        if (script.description) {
            const d = document.createElement('div');
            d.className = 'card-meta';
            d.textContent = script.description;
            body.appendChild(d);
        }
        card.appendChild(body);
        return card;
    },
    
    /**
     * 渲染预设绑定正则
     */
    renderPresetBindings(scripts) {
        const container = document.getElementById('regex-preset-bindings');
        if (!container) return;
        
        if (!this.currentPresetId) {
            container.innerHTML = '<div class="item-list-empty">' + I18n.t('请先选择预设。') + '</div>';
            return;
        }
        
        const preset = PresetManager.getAll().find(p => p.id === this.currentPresetId);
        if (!preset) {
            container.innerHTML = '<div class="item-list-empty">' + I18n.t('找不到这个预设。') + '</div>';
            return;
        }
        
        // 获取预设绑定的正则脚本
        const regexBindings = preset.regexBindings || [];
        if (regexBindings.length === 0) {
            container.innerHTML = '<div class="item-list-empty">' + I18n.t('当前预设没有绑定正则。') + '</div>';
            return;
        }
        
        // 过滤出绑定的脚本
        const boundScripts = scripts.filter(s => regexBindings.includes(s.id));
        
        if (boundScripts.length === 0) {
            container.innerHTML = '<div class="item-list-empty">' + I18n.t('没有找到绑定的正则，请重新导入。') + '</div>';
            return;
        }
        
        this.renderScriptList('regex-preset-bindings', boundScripts, 'preset');
    },
    
    /**
     * 加载预设列表
     */
    loadPresetList() {
        const select = document.getElementById('regex-preset-select');
        if (!select) return;
        
        const presets = PresetManager.getAll();
        select.innerHTML = '<option value="">' + I18n.t('选择预设') + '</option>' +
            presets.map(p => `<option value="${this._escapeHtml(p.id)}">${this._escapeHtml(p.name)}</option>`).join('');
    },
    
    /**
     * 加载预设
     */
    loadPreset(presetId) {
        this.currentPresetId = presetId;
        
        // 更新选择器
        const select = document.getElementById('regex-preset-select');
        if (select) {
            select.value = presetId || '';
        }
        
        // 刷新正则脚本显示
        this.loadRegexScripts();
    },
    
    /**
     * 创建预设正则
     */
    async createPreset() {
        if (!this.currentPresetId) {
            Toast.show(I18n.t('请先选择预设。'), 'warning');
            return;
        }
        
        const script = await this.showScriptEditor();
        if (script) {
            script.type = 'preset';
            RegexProcessor.createRegexScript(script);
            PresetManager.bindRegexToPreset(this.currentPresetId, script.id);
            this.loadRegexScripts();
            Toast.show(I18n.t('已创建。'), 'success');
        }
    },
    
    /**
     * 更新预设
     */
    async updatePreset() {
        if (!this.currentPresetId) {
            Toast.show(I18n.t('请先选择预设。'), 'warning');
            return;
        }
        
        const preset = PresetManager.getAll().find(p => p.id === this.currentPresetId);
        if (!preset) return;
        
        // 收集当前预设绑定的正则（所有preset类型的正则）
        const presetScripts = RegexProcessor.getAllScripts()
            .filter(s => s.type === 'preset')
            .map(s => s.id);
        
        preset.regexBindings = [...presetScripts];
        PresetManager.update(preset.id, preset);
        this.loadRegexScripts();
        Toast.show(I18n.t('已绑定全部预设正则。'), 'success');
    },
    
    /**
     * 应用预设
     */
    async applyPreset() {
        if (!this.currentPresetId) {
            Toast.show(I18n.t('请先选择预设。'), 'warning');
            return;
        }
        
        PresetManager.load(this.currentPresetId);
        
        // 应用预设绑定的正则（只启用那些enabled=true的）
        const preset = PresetManager.getAll().find(p => p.id === this.currentPresetId);
        if (preset && preset.regexBindings) {
            preset.regexBindings.forEach(regexId => {
                const script = RegexProcessor.regexScripts.get(regexId);
                if (script) {
                    // 确保类型正确
                    script.type = 'preset';
                    // 只启用那些enabled=true的预设绑定正则
                    if (script.enabled) {
                        RegexProcessor.enableRegex(regexId, 'preset');
                    } else {
                        // 保持禁用状态，只更新类型
                        RegexProcessor._enableRegex(regexId, 'preset');
                        // 然后立即从启用集合中移除（因为enabled=false）
                        RegexProcessor.enabledRegex.preset.delete(regexId);
                    }
                }
            });
        }
        
        Toast.show(I18n.t('已应用。'), 'success');
    },
    
    
    /**
     * 添加正则脚本
     */
    async addRegexScript(type) {
        const script = await this.showScriptEditor();
        if (script) {
            script.type = type;
            RegexProcessor.createRegexScript(script);
            this.loadRegexScripts();
            Toast.show(I18n.t('已添加。'), 'success');
        }
    },
    
    /**
     * 批量删除选中的脚本
     */
    async deleteSelectedScripts(type) {
        const set = this.selectedIds?.[type];
        const scriptIds = set ? Array.from(set) : [];
        
        if (!scriptIds.length) {
            Toast.show(I18n.t('请先选择要删除的正则。'), 'warning');
            return;
        }
        
        const confirmed = await Modal.confirm(I18n.t('删除正则'), I18n.t('确定要删除选中的 {n} 条正则吗？', { n: scriptIds.length }), { danger: true, confirmLabel: I18n.t('删除') });
        if (!confirmed) return;
        
        const records = scriptIds.map(id => this._removeScript(id)).filter(Boolean);
        
        // 清空选中集合
        if (set) {
            set.clear();
        }
        
        this.loadRegexScripts();
        Toast.undo(I18n.t('已删除 {n} 条正则。', { n: records.length }), () => {
            records.forEach(r => this._restoreScript(r));
            this.loadRegexScripts();
        });
    },

    /** 删掉一条脚本并解除它在各预设里的绑定，返回恢复它所需的记录 */
    _removeScript(scriptId) {
        const script = RegexProcessor.getAllScripts().find(s => s.id === scriptId);
        if (!script) return null;
        const record = { snapshot: { ...script }, wasBoundTo: [] };
        for (const preset of PresetManager.getAll()) {
            if (preset.regexBindings && preset.regexBindings.includes(scriptId)) {
                record.wasBoundTo.push(preset.id);
                preset.regexBindings = preset.regexBindings.filter(id => id !== scriptId);
                PresetManager.update(preset.id, preset);
            }
        }
        RegexProcessor.deleteScript(scriptId);
        return record;
    },

    _restoreScript(record) {
        RegexProcessor.createRegexScript(record.snapshot);
        record.wasBoundTo.forEach(pid => {
            const preset = PresetManager.getAll().find(p => p.id === pid);
            if (preset) {
                preset.regexBindings = (preset.regexBindings || []).concat(record.snapshot.id);
                PresetManager.update(preset.id, preset);
            }
        });
    },
    
    /**
     * 切换某个类型的选择模式
     */
    toggleSelectMode(type) {
        this.multiSelectMode[type] = !this.multiSelectMode[type];
        // 退出选择模式时清空选中
        if (!this.multiSelectMode[type]) {
            this.selectedIds[type]?.clear();
        }
        this.loadRegexScripts();
    },
    
    /**
     * 全选某个类型的脚本
     */
    selectAll(type) {
        // 自动打开选择模式
        this.multiSelectMode[type] = true;
        const set = this.selectedIds[type] || new Set();
        this.selectedIds[type] = set;
        
        let scripts = [];
        if (type === 'global') {
            scripts = RegexProcessor.getAllScripts().filter(s => s.type === 'global');
        } else {
            if (!this.currentPresetId) {
                Toast.show(I18n.t('请先选择预设。'), 'warning');
                return;
            }
            const preset = PresetManager.getAll().find(p => p.id === this.currentPresetId);
            const bindings = preset?.regexBindings || [];
            const all = RegexProcessor.getAllScripts();
            scripts = all.filter(s => bindings.includes(s.id));
        }
        
        // 检查是否已经“全选”，如果是则改为全不选
        const allSelected = scripts.length > 0 && scripts.every(s => set.has(s.id));
        set.clear();
        if (!allSelected) {
            scripts.forEach(s => set.add(s.id));
        }
        
        this.loadRegexScripts();
    },
    
    /**
     * 单个勾选/取消勾选
     */
    onSelectClick(type, scriptId, checked) {
        const set = this.selectedIds[type] || new Set();
        this.selectedIds[type] = set;
        if (checked) {
            set.add(scriptId);
        } else {
            set.delete(scriptId);
        }
    },
    
    /**
     * 将当前预设中的选中脚本移动到全局
     */
    async moveSelectedToGlobal() {
        const set = this.selectedIds.preset;
        const scriptIds = set ? Array.from(set) : [];
        if (!scriptIds.length) {
            Toast.show(I18n.t('请先勾选要移动的正则。'), 'warning');
            return;
        }
        
        const confirmed = await Modal.confirm(I18n.t('移到全局'), I18n.t('确定将选中的 {n} 条正则移到全局吗？', { n: scriptIds.length }));
        if (!confirmed) return;
        
        const allScripts = RegexProcessor.getAllScripts();
        
        for (const scriptId of scriptIds) {
            const script = allScripts.find(s => s.id === scriptId);
            if (!script) continue;
            
            const wasEnabled = script.enabled;
            // 先关闭，再修改类型，再按新类型启用
            RegexProcessor.disableRegex(scriptId);
            RegexProcessor.updateScript(scriptId, { type: 'global' });
            if (wasEnabled) {
                RegexProcessor.enableRegex(scriptId, 'global');
            }
            
            // 从所有预设的绑定中移除
            const presets = PresetManager.getAll();
            for (const preset of presets) {
                if (preset.regexBindings && preset.regexBindings.includes(scriptId)) {
                    preset.regexBindings = preset.regexBindings.filter(id => id !== scriptId);
                    PresetManager.update(preset.id, preset);
                }
            }
        }
        
        set.clear();
        this.loadRegexScripts();
        Toast.show(I18n.t('已移到全局：{n} 条。', { n: scriptIds.length }), 'success');
    },
    
    /**
     * 将全局中的选中脚本移动到当前预设
     */
    async moveSelectedToPreset() {
        if (!this.currentPresetId) {
            Toast.show(I18n.t('请先选择预设。'), 'warning');
            return;
        }
        
        const set = this.selectedIds.global;
        const scriptIds = set ? Array.from(set) : [];
        if (!scriptIds.length) {
            Toast.show(I18n.t('请先勾选要移动的正则。'), 'warning');
            return;
        }
        
        const confirmed = await Modal.confirm(I18n.t('移到预设'), I18n.t('确定将选中的 {n} 条正则移到当前预设吗？', { n: scriptIds.length }));
        if (!confirmed) return;
        
        const allScripts = RegexProcessor.getAllScripts();
        const preset = PresetManager.getAll().find(p => p.id === this.currentPresetId);
        if (!preset) {
            Toast.show(I18n.t('找不到这个预设。'), 'error');
            return;
        }
        if (!preset.regexBindings) preset.regexBindings = [];
        
        for (const scriptId of scriptIds) {
            const script = allScripts.find(s => s.id === scriptId);
            if (!script) continue;
            
            const wasEnabled = script.enabled;
            RegexProcessor.disableRegex(scriptId);
            RegexProcessor.updateScript(scriptId, { type: 'preset' });
            if (wasEnabled) {
                RegexProcessor.enableRegex(scriptId, 'preset');
            }
            
            if (!preset.regexBindings.includes(scriptId)) {
                preset.regexBindings.push(scriptId);
            }
        }
        
        PresetManager.update(preset.id, preset);
        set.clear();
        this.loadRegexScripts();
        Toast.show(I18n.t('已移到当前预设：{n} 条。', { n: scriptIds.length }), 'success');
    },
    
    /**
     * 显示脚本编辑器
     */
    async showScriptEditor(script = null) {
        const flags = String(script?.flags ?? 'gi');
        const html = `
            <div class="form-group">
                <label for="edit-regex-name">${I18n.t('名称')}</label>
                <input type="text" id="edit-regex-name" autocomplete="off">
            </div>
            <div class="form-group">
                <label for="edit-regex-pattern">${I18n.t('匹配规则')}</label>
                <input type="text" id="edit-regex-pattern" autocomplete="off" spellcheck="false">
            </div>
            <div class="form-group">
                <label for="edit-regex-replacement">${I18n.t('替换内容')}</label>
                <textarea id="edit-regex-replacement" rows="3"></textarea>
            </div>
            <div class="form-group">
                <label>${I18n.t('匹配方式')}</label>
                <label class="setting-check"><input type="checkbox" data-flag="g">${I18n.t('匹配全部')}</label>
                <label class="setting-check"><input type="checkbox" data-flag="i">${I18n.t('忽略大小写')}</label>
                <label class="setting-check"><input type="checkbox" data-flag="m">${I18n.t('多行匹配')}</label>
                <label class="setting-check"><input type="checkbox" data-flag="s">${I18n.t('点号匹配换行')}</label>
            </div>
            <div class="form-group">
                <label for="edit-regex-description">${I18n.t('描述')}</label>
                <textarea id="edit-regex-description" rows="3"></textarea>
            </div>
        `;

        return new Promise((resolve) => {
            Modal.show(script ? I18n.t('编辑正则') : I18n.t('新建正则'), html, {
                buttons: [
                    { label: I18n.t('取消'), action: 'cancel' },
                    { label: I18n.t('保存'), action: 'save', class: 'btn-primary' }
                ],
                onAction: (action) => {
                    if (action !== 'save') { resolve(null); Modal.close(); return; }
                    const name = document.getElementById('edit-regex-name').value.trim();
                    const pattern = document.getElementById('edit-regex-pattern').value.trim();
                    if (!name || !pattern) {
                        Toast.show(I18n.t('名称和匹配规则不能为空。'), 'error');
                        return;
                    }
                    const picked = Array.prototype.filter.call(document.querySelectorAll('#modal-container [data-flag]'), b => b.checked)
                        .map(b => b.dataset.flag).join('');
                    resolve({
                        name,
                        pattern,
                        replacement: document.getElementById('edit-regex-replacement').value.trim(),
                        flags: picked,
                        description: document.getElementById('edit-regex-description').value.trim(),
                        enabled: script?.enabled ?? false
                    });
                    Modal.close();
                }
            });
            document.getElementById('edit-regex-name').value = script?.name || '';
            document.getElementById('edit-regex-pattern').value = script?.pattern || '';
            document.getElementById('edit-regex-replacement').value = script?.replacement || '';
            document.getElementById('edit-regex-description').value = script?.description || '';
            document.querySelectorAll('#modal-container [data-flag]').forEach(b => { b.checked = flags.indexOf(b.dataset.flag) >= 0; });
        });
    },
    
    /**
     * 切换脚本启用状态
     */
    toggleScript(scriptId) {
        const script = RegexProcessor.getAllScripts().find(s => s.id === scriptId);
        if (!script) return;
        
        if (script.enabled) {
            RegexProcessor.disableRegex(scriptId);
        } else {
            RegexProcessor.enableRegex(scriptId, script.type || 'global');
        }
        
        this.loadRegexScripts();
    },
    
    /**
     * 切换脚本详情展开/折叠
     */
    toggleDetails(scriptId) {
        const item = document.querySelector(`.card[data-id="${scriptId}"]`);
        if (!item) return;
        const collapsed = item.classList.toggle('is-collapsed');
        const btn = item.querySelector('[data-act="toggle"]');
        if (btn) {
            btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            btn.querySelector('.chev').classList.toggle('is-right', collapsed);
        }
        if (collapsed) this._expandedIds.delete(scriptId);
        else this._expandedIds.add(scriptId);
    },
    
    /**
     * 编辑脚本
     */
    async editScript(scriptId) {
        const script = RegexProcessor.getAllScripts().find(s => s.id === scriptId);
        if (!script) return;
        
        const updated = await this.showScriptEditor(script);
        if (updated) {
            RegexProcessor.updateScript(scriptId, updated);
            this.loadRegexScripts();
            Toast.show(I18n.t('已保存。'), 'success');
        }
    },
    
    /**
     * 删除脚本
     */
    async deleteScript(scriptId) {
        const record = this._removeScript(scriptId);
        if (!record) return;
        this.loadRegexScripts();
        Toast.undo(I18n.t('已删除正则。'), () => {
            this._restoreScript(record);
            this.loadRegexScripts();
        });
    },
    
    /**
     * 导入正则脚本
     */
    async importRegexFiles(files, type) {
        const list = Array.from(files || []);
        if (!list.length) return;

        // 确保type是'global'或'preset'，不允许scoped
        if (type !== 'global' && type !== 'preset') {
            type = 'global';
        }

        let total = 0;
        let skippedTotal = 0;
        try {
            for (const file of list) {
                const text = await file.text();
                const data = JSON.parse(text);
                const scripts = Array.isArray(data) ? data : [data];

                let skipped = 0;
                for (const scriptData of scripts) {
                    const normalized = this._normalizeImportedRegex(scriptData, file.name);
                    if (!normalized.pattern) {
                        skipped++;
                        continue;
                    }
                    // 强制设置为指定的type，忽略导入数据中的type
                    const script = {
                        id: normalized.id,
                        name: normalized.name,
                        pattern: normalized.pattern,
                        replacement: normalized.replacement,
                        flags: normalized.flags,
                        description: normalized.description,
                        type: type, // 强制使用传入的type
                        enabled: normalized.enabled !== undefined ? normalized.enabled : false,
                        context: normalized.context,
                    };
                    
                    RegexProcessor.createRegexScript(script);
                    total++;
                }
                skippedTotal += skipped;
            }
            this.loadRegexScripts();
            const isPreset = type === 'preset';
            if (skippedTotal) Toast.show(isPreset
                ? I18n.t('已导入 {total} 条预设正则，{skipped} 条没有匹配规则，已跳过。', { total, skipped: skippedTotal })
                : I18n.t('已导入 {total} 条全局正则，{skipped} 条没有匹配规则，已跳过。', { total, skipped: skippedTotal }), 'warning', 6000);
            else Toast.show(isPreset
                ? I18n.t('已导入 {total} 条预设正则。', { total })
                : I18n.t('已导入 {total} 条全局正则。', { total }), 'success');
        } catch (error) {
            console.error('Import regex files error:', error);
            Toast.show(error instanceof SyntaxError ? I18n.t('这个文件不是正则脚本文件，换一个再试。') : I18n.t('导入失败：{msg}', { msg: error.message }), 'error');
        }
    },
    
    /**
     * 导入预设绑定的正则（参考SillyTavern）
     */
    async importPresetRegex(files) {
        if (!files || files.length === 0) return;
        
        if (!this.currentPresetId) {
            Toast.show(I18n.t('请先选择预设。'), 'warning');
            return;
        }
        
        try {
            let totalImported = 0;
            let skippedTotal = 0;
            const preset = PresetManager.getAll().find(p => p.id === this.currentPresetId);
            if (!preset) {
                Toast.show(I18n.t('找不到这个预设。'), 'error');
                return;
            }
            
            // 初始化regexBindings数组
            if (!preset.regexBindings) {
                preset.regexBindings = [];
            }
            
            for (const file of Array.from(files)) {
                const text = await file.text();
                const data = JSON.parse(text);
                
                // 支持单个脚本或脚本数组
                const scripts = Array.isArray(data) ? data : [data];
                
                for (const scriptData of scripts) {
                    const normalized = this._normalizeImportedRegex(scriptData, file.name);
                    const scriptId = normalized.id || `regex_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    if (!normalized.pattern) {
                        skippedTotal++;
                        continue;
                    }
                    const script = {
                        id: scriptId,
                        name: normalized.name,
                        pattern: normalized.pattern,
                        replacement: normalized.replacement,
                        flags: normalized.flags,
                        description: normalized.description,
                        type: 'preset', // 强制设置为preset类型
                        enabled: normalized.enabled !== undefined ? normalized.enabled : false,
                        context: normalized.context,
                        presetId: this.currentPresetId
                    };
                    
                    // 创建或更新正则脚本
                    const existing = RegexProcessor.getAllScripts().find(s => s.id === scriptId);
                    if (existing) {
                        // 更新时确保type是preset
                        RegexProcessor.updateScript(scriptId, script);
                    } else {
                        // 关键：RegexProcessor 现在支持保留 id
                        RegexProcessor.createRegexScript(script);
                    }
                    
                    // 添加到预设的regexBindings（如果还没有）
                    if (!preset.regexBindings.includes(scriptId)) {
                        preset.regexBindings.push(scriptId);
                    }
                    
                    totalImported++;
                }
            }
            
            // 保存预设
            PresetManager.update(this.currentPresetId, preset);
            
            // 刷新显示
            this.loadRegexScripts();
            if (skippedTotal) Toast.show(I18n.t('已导入 {total} 条预设正则，{skipped} 条没有匹配规则，已跳过。', { total: totalImported, skipped: skippedTotal }), 'warning', 6000);
            else Toast.show(I18n.t('已导入 {total} 条预设正则。', { total: totalImported }), 'success');
        } catch (error) {
            console.error('Import preset regex error:', error);
            Toast.show(error instanceof SyntaxError ? I18n.t('这个文件不是正则脚本文件，换一个再试。') : I18n.t('导入失败：{msg}', { msg: error.message }), 'error');
        }
    }
    ,

    /**
     * 兼容 SillyTavern regex 导入格式：
     * - scriptName / findRegex / replaceString / disabled
     * 以及我们已有的 name / pattern / replacement / flags 等
     */
    _normalizeImportedRegex(scriptData, fallbackFileName = '') {
        const id = scriptData.id;
        const name = scriptData.name || scriptData.scriptName || fallbackFileName.replace(/\.[^/.]+$/, '') || I18n.t('未命名正则');
        const description = scriptData.description || '';
        const context = scriptData.context || {};

        // enabled/disabled 兼容
        const enabled = (scriptData.enabled !== undefined)
            ? !!scriptData.enabled
            : (scriptData.disabled !== undefined ? !scriptData.disabled : true);

        // pattern/flags 兼容
        const raw = (scriptData.pattern || scriptData.regex || scriptData.find || scriptData.findRegex || '').toString();
        let pattern = '';
        let flags = (scriptData.flags || 'gi').toString();

        if (raw.startsWith('/') && raw.lastIndexOf('/') > 0) {
            const last = raw.lastIndexOf('/');
            pattern = raw.slice(1, last);
            const f = raw.slice(last + 1);
            if (f) flags = f;
        } else {
            pattern = raw;
        }

        const replacement = (scriptData.replacement || scriptData.replace || scriptData.substitute || scriptData.replaceString || '').toString();
        const trimStrings = Array.isArray(scriptData.trimStrings)
            ? scriptData.trimStrings
            : (typeof scriptData.trimStrings === 'string' && scriptData.trimStrings.trim().length
                ? scriptData.trimStrings.split('\n').map(s => s.trim()).filter(Boolean)
                : []);

        return { id, name, pattern, flags, replacement, description, enabled, context, type: scriptData.type, trimStrings };
    }
};

// 导出
if (typeof window !== 'undefined') {
    window.RegexManager = RegexManager;
}
