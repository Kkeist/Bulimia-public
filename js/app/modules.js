/**
 * 模组加载与管理：列表、导入导出、从文件夹刷新、调试桥接。
 * 扩展 App（app.js 先加载）。
 */
Object.assign(App, {
    // ===== 模块管理 =====
    loadModuleList() {
        const select = document.getElementById('current-module-select');
        if (!select) return;

        const modules = ModuleManager.getAll();
        select.innerHTML = '<option value="">' + I18n.t('未选择') + '</option>' +
            modules.map(m => `<option value="${this._escSave(m.id)}">${this._escSave(m.name)}</option>`).join('');

        const current = ModuleManager.getCurrent();
        if (current) select.value = current.id;

        const list = document.getElementById('module-list');
        if (!list) return;
        list.textContent = '';
        if (modules.length === 0) {
            list.innerHTML = '<div class="item-list-empty">' + I18n.t('没有可用的模组。') + '</div>';
            return;
        }
        modules.forEach(m => {
            const isCurrent = current && m.id === current.id;
            const row = document.createElement('div');
            row.className = 'item-list-item' + (isCurrent ? ' active' : '');
            const main = document.createElement('div');
            main.className = 'item-main';
            const title = document.createElement('strong');
            title.textContent = m.name;
            const desc = document.createElement('div');
            desc.className = 'item-meta';
            desc.textContent = m.description || I18n.t('无描述');
            const when = document.createElement('div');
            when.className = 'item-meta';
            when.textContent = new Date(m.updatedAt).toLocaleString();
            main.append(title, desc, when);
            const actions = document.createElement('div');
            actions.className = 'item-actions';
            [['加载', 'load', ''], ['导出', 'export', ''], ['删除', 'delete', ' danger']].forEach(([label, act, cls]) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'btn-small' + cls;
                b.textContent = I18n.t(label);
                b.addEventListener('click', () => {
                    if (act === 'load') this.loadModule(m.id);
                    else if (act === 'export') this.exportModule(m.id);
                    else this.deleteModule(m.id);
                });
                actions.appendChild(b);
            });
            row.append(main, actions);
            list.appendChild(row);
        });
    },

    async loadModule(moduleId) {
        if (!moduleId) {
            ModuleManager.currentModule = null;
            if (window.__debugBridgeModuleId !== undefined) window.__debugBridgeModuleId = null;
            Storage.removeLocal(CONFIG.STORAGE_KEYS.CURRENT_MODULE);
            this.loadCurrentModuleInfo();
            return;
        }

        if (ModuleManager.load(moduleId)) {
            if (window.__debugBridgeModuleId !== undefined) window.__debugBridgeModuleId = null;
            if (typeof Patches !== 'undefined' && Patches.getModulePatches && Patches.setCurrentModulePatches) {
                Patches.getModulePatches(ModuleManager.getCurrent()).then(Patches.setCurrentModulePatches);
            }
            this.loadCurrentModuleInfo();
            this.loadModuleList();
            Toast.show(I18n.t('已加载模组。'), 'success');
        } else {
            Toast.show(I18n.t('加载模组失败。'), 'error');
        }
    },

    /**
     * 用设置中已加载的模组构建调试桥（ModuleSystem 等）并初始化模块跳转面板，使调试区可查看已有模组
     */
    async buildDebugBridgeAndInitModuleJump() {
        if (!window.DebugModuleJump || !window.ModuleManager) return;
        const cur = ModuleManager.currentModule;
        if (!cur) {
            DebugModuleJump.showError(I18n.t('请在设置中先加载模组'));
            return;
        }
        const moduleId = cur.id;
        if (window.__debugBridgeModuleId === moduleId && DebugModuleJump.moduleSystem) {
            DebugModuleJump.refresh();
            return;
        }
        const folderKey = cur.folderKey || String(moduleId).replace(/^story_/, '');
        let config;
        if (cur.sourceConfig) {
            config = JSON.parse(JSON.stringify(cur.sourceConfig));
        } else {
            try {
                const res = await fetch(`module/${folderKey}/module.json`);
                if (!res.ok) throw new Error(res.statusText || I18n.t('无法加载'));
                config = await res.json();
            } catch (e) {
                console.error('读取模组文件失败', e);
                DebugModuleJump.showError(I18n.t('无法读取当前模组的文件，请确认模组文件夹仍在原位置。'));
                return;
            }
        }
        if (typeof ModuleSystem === 'undefined' || typeof VariableSystem === 'undefined' || typeof TimeSystem === 'undefined' ||
            typeof ConditionEvaluator === 'undefined' || typeof SummarySystem === 'undefined' || typeof PromptGenerator === 'undefined') {
            DebugModuleJump.showError(I18n.t('核心模块脚本未加载'));
            return;
        }
        const timeSystem = new TimeSystem(config.timeSystem || { displayFormat: '{{year}}-{{month}}-{{day}}', initialValues: { year: 1, month: 1, day: 1 } });
        const variableSystem = new VariableSystem();
        const moduleSystem = new ModuleSystem();
        const summarySystem = new SummarySystem();
        const promptGenerator = new PromptGenerator();
        const conditionContext = { variableSystem, moduleSystem, timeSystem };
        const conditionEvaluator = new ConditionEvaluator(conditionContext);
        variableSystem.setConditionEvaluator(conditionEvaluator);
        moduleSystem.setConditionEvaluator(conditionEvaluator);
        moduleSystem.setVariableSystem(variableSystem);
        moduleSystem.setTimeSystem(timeSystem);
        summarySystem.setTimeSystem(timeSystem);
        summarySystem.setVariableSystem(variableSystem);
        summarySystem.setModuleSystem(moduleSystem);
        promptGenerator.setTimeSystem(timeSystem);
        promptGenerator.setVariableSystem(variableSystem);
        promptGenerator.setModuleSystem(moduleSystem);
        promptGenerator.setSummarySystem(summarySystem);
        moduleSystem.loadModule(config);
        if (config.variables && config.variables.length) {
            variableSystem.registerVariables(config.variables, config.id);
            if (typeof variableSystem.updateBuiltinVariables === 'function') variableSystem.updateBuiltinVariables();
        }
        // 调试桥接上插件系统，让「插件测试」标签走真实的 plugin.execute。
        // 注册顺序：递归遍历模块 registerPlugins；模块生成器模板里的插件也注册；loadAllFiles 加载显示 / 样式 / 随机池；暂存变量补注册。
        let pluginSystem = null;
        const modulePath = 'module/' + folderKey;
        if (typeof PluginSystem === 'function') {
            pluginSystem = new PluginSystem();
            pluginSystem.setConditionEvaluator(conditionEvaluator);
            pluginSystem.setBaseModulePath(modulePath);
            for (const [mid, mod] of moduleSystem.modules) {
                if (mod.plugins && mod.plugins.length > 0) {
                    pluginSystem.registerPlugins(mod.plugins, mod.id);
                    for (const p of mod.plugins) {
                        if (p.type === 'module_generator' && p.config && p.config.moduleTemplate && Array.isArray(p.config.moduleTemplate.plugins) && p.config.moduleTemplate.plugins.length > 0) {
                            pluginSystem.registerPlugins(p.config.moduleTemplate.plugins, mod.id);
                        }
                    }
                }
            }
            // 异步加载 display/style/pool —— 不 await，让调试面板先渲染信息块；真测试运行时 loadedFiles 已就绪
            pluginSystem.loadAllFiles().then(() => {
                // 文件加载完后刷一次插件 tab，让 display 真渲染出来（如果当前打开的是 plugin-test tab）
                if (window.DebugModuleJump && DebugModuleJump.renderPluginTab && document.getElementById('debug-panel-plugin-test') && !document.getElementById('debug-panel-plugin-test').classList.contains('hidden')) {
                    DebugModuleJump.renderPluginTab();
                }
            }).catch(e => Toast.show(I18n.t('插件的文件没有读到：{msg}', { msg: e && e.message ? e.message : e }), 'error', 8000));
            // 注册插件用到的暂存变量（randomizer tempStorage、插件 tempVariables）；否则 executeOperation 会报错
            for (const p of pluginSystem.plugins.values()) {
                const cfg = p.config || {};
                const owner = p.ownerModuleId || config.id;
                if (cfg.tempStorage) {
                    variableSystem.registerVariables([{ id: cfg.tempStorage, name: cfg.tempStorage, type: 'object', category: 'temp', initialValue: null }], owner);
                }
                if (Array.isArray(cfg.tempVariables)) {
                    variableSystem.registerVariables(cfg.tempVariables.map(t => ({ id: t.id, name: t.name || t.id, type: t.type || 'string', category: 'temp', initialValue: t.initialValue ?? null })), owner);
                }
            }
            promptGenerator.setPluginSystem(pluginSystem);
        }
        const bridge = { moduleSystem, variableSystem, timeSystem, promptGenerator, pluginSystem, conditionEvaluator, modulePath };
        window.__debugBridgeModuleId = moduleId;
        DebugModuleJump.init(bridge);
        try { DebugModuleJump.syncFromState(); }
        catch (e) { console.error('syncFromState', e); Toast.show(I18n.t('读取游戏进度失败：{msg}', { msg: e.message }), 'error'); }
        DebugModuleJump.refresh();
    },

    loadCurrentModuleInfo() {
        const module = ModuleManager.getCurrent();

        const nameInput = document.getElementById('module-name-input');
        const descInput = document.getElementById('module-description-input');

        if (module) {
            if (nameInput) nameInput.value = module.name || '';
            if (descInput) descInput.value = module.description || '';
        } else {
            if (nameInput) nameInput.value = '';
            if (descInput) descInput.value = '';
        }
    },

    async newModule() {
        const name = await Modal.prompt(I18n.t('新建模组'), I18n.t('模组名称'));
        if (!name || !name.trim()) return;

        const description = await Modal.prompt(I18n.t('模组描述'), I18n.t('模组描述（选填）'), '');

        const module = ModuleManager.create(name.trim(), description || '');
        this.loadModuleList();
        document.getElementById('current-module-select').value = module.id;
        this.loadModule(module.id);
        Toast.show(I18n.t('已创建模组。'), 'success');
    },

    saveModule() {
        const moduleId = document.getElementById('current-module-select')?.value;
        if (!moduleId) {
            Toast.show(I18n.t('请先选择或新建模组。'), 'warning');
            return;
        }

        const name = document.getElementById('module-name-input')?.value?.trim();
        const description = document.getElementById('module-description-input')?.value?.trim() || '';

        if (!name) {
            Toast.show(I18n.t('模组名称不能为空。'), 'error');
            return;
        }

        ModuleManager.update(moduleId, { name, description });
        ModuleManager.save(moduleId);
        this.loadModuleList();
        Toast.show(I18n.t('已保存。'), 'success');
    },

    async importModule(file) {
        if (!file) return;

        try {
            const module = await ModuleManager.importFromFile(file);
            this.loadModuleList();
            Toast.show(I18n.t('已导入模组“{name}”。', { name: module.name }), 'success');
        } catch (error) {
            console.error('Import module error:', error);
            Toast.show(I18n.t('导入失败：{msg}', { msg: error.message }), 'error');
        }
    },

    exportModule(moduleId = null) {
        const id = moduleId || document.getElementById('current-module-select')?.value;
        if (!id) {
            Toast.show(I18n.t('请先选择要导出的模组。'), 'warning');
            return;
        }

        if (ModuleManager.export(id)) {
            Toast.show(I18n.t('已导出。'), 'success');
        } else {
            Toast.show(I18n.t('导出失败。'), 'error');
        }
    },

    async deleteModule(moduleId) {
        const module = ModuleManager.getAll().find(m => m.id === moduleId);
        if (!module) return;

        const confirmed = await Modal.confirm(I18n.t('删除模组'), I18n.t('确定要删除模组“{name}”吗？', { name: this._escSave(module.name) }), { danger: true, confirmLabel: I18n.t('删除') });
        if (!confirmed) return;

        const wasCurrent = ModuleManager.currentModule && ModuleManager.currentModule.id === moduleId;
        ModuleManager.delete(moduleId);
        this.loadModuleList();
        this.loadCurrentModuleInfo();
        Toast.undo(I18n.t('已删除模组。'), () => {
            if (!ModuleManager.restore(module, wasCurrent)) {
                Toast.show(I18n.t('撤销失败，这个模组已经存在。'), 'error');
                return;
            }
            this.loadModuleList();
            this.loadCurrentModuleInfo();
        });
    },

    /** 从 module 文件夹重新加载模块列表并刷新 UI */
    async refreshModuleFromFolder() {
        try {
            await ModuleManager.refreshFromFolder();
            this.loadModuleList();
            this.loadCurrentModuleInfo();
            if (typeof PresetEditor !== 'undefined' && PresetEditor.loadModuleList) {
                PresetEditor.loadModuleList();
            }
            Toast.show(I18n.t('已重新读取模组。'), 'success');
        } catch (e) {
            console.error('Refresh module folder error:', e);
            Toast.show(I18n.t('重新读取失败：{msg}', { msg: e.message || e }), 'error');
        }
    }
});
