/**
 * game-v3 的过渡入口
 * 目标：先把 game/ 的“存档 + Persona + 开始游戏/读档入口 + autosave + 弹窗”原样搬过来。
 * 其余系统后续再按 SillyTavern 重做。
 */

// 兼容：当前阶段没有完整 Engine/WidgetManager，但存档逻辑依赖它们的少量字段
window.Engine = window.Engine || {
    isRunning: false,
    async init() { this.isRunning = true; },
    async loadSave(saveId) {
        const save = await Storage.loadGame(saveId);
        if (!save?.data) return false;
        State.restoreFromSnapshot(save.data);
        return true;
    },
    autoSave() { return App.autoSaveToCurrentSlot(); },
};
window.WidgetManager = window.WidgetManager || { updateAll() { } };

const App = {
    initialized: false,

    currentPage: 'game',

    // 生成状态控制
    isGenerating: false,

    abortController: null,

    async init() {
        try {
            LayoutMode.init();
            FormControls.init();
            try {
                await Storage.init();
            } catch (storageError) {
                Toast.show(storageError.message, 'error', 10000);
            }
            ChatDisplay.init();

            // 初始化消息格式化工具（必须在其他组件之前）
            if (window.MessageFormatter) {
                MessageFormatter.init();
            }

            // 初始化API连接和预设管理器
            APIConnection.init();
            PresetManager.init();
            await PresetManager.ensureBuiltinPreset();
            if (typeof WritingGuide !== 'undefined' && WritingGuide.loadDefault) await WritingGuide.loadDefault();
            RegexProcessor.init();

            // 初始化UI组件（模块从 module/ 文件夹自动导入，默认 main 为总模块）
            await ModuleManager.init();
            PresetEditor.init();
            RegexManager.init();
            DebugViewer.init();
            if (window.PluginRegistry) await PluginRegistry.init();

            // 加载显示设置
            this.loadDisplaySettings();

            this.bindAllEvents();
            if (window.Events && window.EVENT_TYPES) {
                Events.on(EVENT_TYPES.GAME_FLOW_UPDATE, () => {
                    this.updateSystemStatusBar && this.updateSystemStatusBar();
                });
            }
            this.loadAPIConfig();
            this.loadPersonas();
            await this.loadSaveList();
            this.updateSaveInfo();
            this.initialized = true;
            await this.resumeLastGame();
            this.updateSystemStatusBar();
            this.restoreUiPage();
        } catch (error) {
            console.error('Init error:', error);
            Toast.show('初始化失败: ' + error.message, 'error');
        } finally {
            document.documentElement.classList.remove('is-booting');
        }
    },

    /** 刷新后回到刷新前所在的页面与设置标签 */
    restoreUiPage() {
        const page = UiState.get('page', null);
        const tab = UiState.get('settingsTab', null);
        if (tab) this.switchSettingsTab(tab);
        if (!page || page === this.currentPage || !document.getElementById(`page-${page}`)) return;
        if (page === 'game' && !Engine.isRunning) return;
        if (page === 'debug') {
            const debugTab = UiState.get('debugTab', null);
            if (debugTab && document.querySelector(`.debug-tab[data-tab="${debugTab}"]`)) {
                document.querySelectorAll('.debug-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === debugTab));
            }
        }
        this.showPage(page);
    },

    // ===== 页面切换（保持 game/ 的调用方式）=====
    showPage(pageId) {
        LayoutMode.closeDrawers();
        document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
        const pageEl = document.getElementById(`page-${pageId}`);
        if (pageEl) pageEl.classList.add('active');
        UiState.set('page', pageId);
        // 打开调试页时刷新当前选中的调试标签内容（变量/流程/模块等才能正确显示）
        if (pageId === 'debug') {
            const activeTab = document.querySelector('.debug-tab.active');
            const tabId = activeTab?.dataset?.tab;
            if (tabId) this.switchDebugTab(tabId);
        }
        this.currentPage = pageId;
        if (pageId === 'settings') {
            this.loadPersonas();
            this.loadSaveList();
            this.updateSaveInfo();
            this.revealActiveSettingsTab();
            if (window.AutoGrow) AutoGrow.refresh(document.getElementById('page-settings'));
        }
        if (pageId === 'debug') {
            DebugViewer.refreshPrompt();
            if (DebugViewer.refreshModuleTree) DebugViewer.refreshModuleTree();
            if (DebugViewer.refreshVariablesList) DebugViewer.refreshVariablesList();
            if (window.DebugFlow && DebugFlow.refresh) DebugFlow.refresh();
            // 模块跳转面板：优先用 GameFlow.moduleSystem，否则用设置中已加载模组构建调试桥
            if (window.DebugModuleJump) {
                if (window.GameFlow && window.GameFlow.moduleSystem) {
                    if (!DebugModuleJump.moduleSystem) DebugModuleJump.init(window.GameFlow);
                    if (DebugModuleJump.refresh) DebugModuleJump.refresh();
                } else if (window.ModuleManager && ModuleManager.currentModule) {
                    this.buildDebugBridgeAndInitModuleJump();
                } else {
                    if (!DebugModuleJump.moduleSystem) DebugModuleJump.showError('请在设置中先加载模组');
                    else if (DebugModuleJump.refresh) DebugModuleJump.refresh();
                }
            }
        }
        if (pageId === 'game') {
            if (typeof ChatDisplay !== 'undefined' && (!ChatDisplay.messages || ChatDisplay.messages.length === 0)) {
                ChatDisplay.loadHistory(State.chatHistory || []);
            }
            this.updateSystemStatusBar && this.updateSystemStatusBar();
            if (window.PluginRegistry) {
            // 当前路径已变 → 必须重跑 registerFromModule 沿新路径收集 sub-module 的 plugins；只 renderUI 会拿不到状态面板/战斗面板等子模块插件
            if (PluginRegistry.registerFromModule) PluginRegistry.registerFromModule();
            else if (PluginRegistry.renderUI) PluginRegistry.renderUI();
        }
            if (window.Events && window.EVENT_TYPES && window.InteractiveSaveDriver) {
                Events.emit(EVENT_TYPES.PHONE_PENDING_CHANGED, { count: InteractiveSaveDriver.getTotalPendingCount() });
            }
        }
    },

    /**
     * 切换调试标签页
     */
    async switchDebugTab(tabId) {
        if (window.DebugModuleJump && DebugModuleJump.syncFromState) {
            try { DebugModuleJump.syncFromState(); }
            catch (e) { console.error('syncFromState', e); Toast.show('读取游戏进度失败：' + e.message, 'error'); }
        }
        document.querySelectorAll('.debug-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabId);
        });
        document.querySelectorAll('.debug-panel').forEach(panel => {
            const panelTab = panel.id?.replace('debug-panel-', '');
            panel.classList.toggle('active', panelTab === tabId);
        });
        UiState.set('debugTab', tabId);
        if (window.AutoGrow) AutoGrow.refresh(document.getElementById('page-debug'));
        // A6（2026-05-22 → 自检 2026-05-23 加严）：每次切 tab 都复位 DebugModuleJump 的编辑临时态
        // 防各 tab 之间编辑状态串：_editVars / _mode / _editType / _plSel / _meSel / _sumSelId 等
        if (window.DebugModuleJump) {
            DebugModuleJump._editVars = null;
            DebugModuleJump._editType = null;
            DebugModuleJump._mode = 'detail';
        }

        if (tabId === 'prompt') {
            DebugViewer.refreshPrompt();
        }
        if (tabId === 'writing-guide') {
            if (typeof WritingGuide !== 'undefined' && WritingGuide.loadDefault && !WritingGuide._defaultCache) {
                await WritingGuide.loadDefault();
            }
            if (DebugViewer.refreshWritingGuideList) DebugViewer.refreshWritingGuideList();
            if (window.DebugModuleJump && DebugModuleJump.renderWritingGuideTab) DebugModuleJump.renderWritingGuideTab();
        }
        if (tabId === 'flow') {
            if (typeof DebugFlow !== 'undefined' && DebugFlow.refresh) DebugFlow.refresh();
            if (DebugViewer.refreshModuleTree) DebugViewer.refreshModuleTree();
            if (DebugViewer.refreshVariablesList) DebugViewer.refreshVariablesList();
        }
        if (tabId === 'modules' && DebugViewer.refreshModuleTree) {
            DebugViewer.refreshModuleTree();
        }
        if (tabId === 'plugins' && DebugViewer.refreshPluginsList) {
            DebugViewer.refreshPluginsList();
        }
        if (tabId === 'pending' && DebugViewer.refreshPendingList) {
            DebugViewer.refreshPendingList();
        }
        if (tabId === 'variables') {
            if (DebugViewer.refreshVariablesList) DebugViewer.refreshVariablesList();
            if (typeof DebugFlow !== 'undefined' && DebugFlow.refresh) DebugFlow.refresh();
        }
        if (tabId === 'raw-replies') {
            if (window.DebugModuleJump && DebugModuleJump.renderRawTab) DebugModuleJump.renderRawTab();
            else if (DebugViewer.refreshRawRepliesList) DebugViewer.refreshRawRepliesList();
        }
        // 模块跳转面板
        if (tabId === 'module-jump' && typeof DebugModuleJump !== 'undefined' && DebugModuleJump.refresh) {
            // tab 隔离：切回模块跳转 tab 必复位 _mode / _selId / _editVars ——
            // 防"先去模组编辑 tab 编辑模块 A → 回模块跳转，详情变成 A 的编辑页"这种 tab 状态污染
            DebugModuleJump._mode = 'detail';
            DebugModuleJump._editVars = null;
            if (DebugModuleJump.moduleSystem && DebugModuleJump.moduleSystem.getCurrentModuleIds) {
                const cur = DebugModuleJump.moduleSystem.getCurrentModuleIds() || [];
                if (cur[0]) DebugModuleJump._selId = cur[0];
            }
            DebugModuleJump.refresh();
        }
        if (tabId === 'summary') {
            if (window.DebugModuleJump && DebugModuleJump.renderSummaryTab) DebugModuleJump.renderSummaryTab();
        }
        if (tabId === 'plugin-test') {
            if (window.DebugModuleJump && DebugModuleJump.renderPluginTab) DebugModuleJump.renderPluginTab();
        }
        if (tabId === 'cheat' && window.DebugModuleJump && DebugModuleJump.renderCheatTab) DebugModuleJump.renderCheatTab();
        if (tabId === 'module-edit') {
            if (window.DebugModuleJump && DebugModuleJump.renderModuleEditTab) DebugModuleJump.renderModuleEditTab();
        }
        // 离开插件测试即卸载其 iframe（测试页很重，常驻会拖垮整个调试 UI）
        if (tabId !== 'plugin-test') {
            const pt = document.querySelector('#debug-panel-plugin-test .plugin-tester');
            if (pt && pt.querySelector('iframe')) pt.innerHTML = '';
        }
        this._restoreDebugScroll(tabId);
    },

    /** 调试页每个标签自己滚动，宽屏两栏又各自滚动：逐个记住位置，切回来、刷新后都回到原处 */
    DEBUG_SCROLLERS: ['.dbg-col', '#mjx-info', '#mjx-treewrap', '.me-tree', '.me-right', '.pl-left', '.pl-right', '.debug-fill-list', '#debug-prompt-content'],

    _restoreDebugScroll(tabId) {
        const panel = document.getElementById('debug-panel-' + tabId);
        if (!panel) return;
        const list = [[panel, 'debug:' + tabId]];
        this.DEBUG_SCROLLERS.forEach(sel => {
            panel.querySelectorAll(sel).forEach((el, i) => list.push([el, 'debug:' + tabId + ':' + sel + ':' + i]));
        });
        list.forEach(([el, key]) => {
            ScrollMemory.track(el, key);
            ScrollMemory.restoreWhenReady(el, key);
        });
    },

    /** 状态栏收起 / 展开；选择记在浏览器本地，存不了时照常可用，只是下次打开回到展开。 */
    _bindStatusToggle() {
        const bar = document.getElementById('status-bar');
        const btn = document.getElementById('btn-status-toggle');
        if (!bar || !btn) return;
        const KEY = 'bulimia_status_collapsed';
        const apply = (collapsed) => {
            bar.classList.toggle('is-collapsed', collapsed);
            btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            btn.querySelector('.chev').classList.toggle('is-up', !collapsed);
        };
        let saved = false;
        try { saved = localStorage.getItem(KEY) === '1'; } catch (e) { saved = false; }
        apply(saved);
        btn.addEventListener('click', () => {
            const next = !bar.classList.contains('is-collapsed');
            apply(next);
            try { localStorage.setItem(KEY, next ? '1' : '0'); } catch (e) { /* 存储不可用时只影响下次打开 */ }
        });
    },

    // ===== 事件绑定（只保留存档/Persona/入口所需）=====
    bindAllEvents() {
        // 返回按钮
        document.getElementById('btn-settings-back')?.addEventListener('click', () => this.showPage('game'));
        document.getElementById('btn-debug-back')?.addEventListener('click', () => this.showPage('game'));

        // 输入框上面一排的设置、调试入口
        document.getElementById('btn-tb-settings')?.addEventListener('click', () => this.showPage('settings'));
        document.getElementById('btn-tb-debug')?.addEventListener('click', () => this.showPage('debug'));
        this._bindStatusToggle();

        // 调试标签页切换
        document.querySelectorAll('.debug-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const tabId = e.currentTarget.dataset.tab;
                this.switchDebugTab(tabId);
            });
        });

        // 调试页：点击模组树条目打开右侧详情（委托到 page-debug，确保切到 flow 并显示详情）
        document.getElementById('page-debug')?.addEventListener('click', (e) => {
            const row = e.target.closest('.flow-tree-node');
            if (!row) return;
            if (e.target.closest('.flow-tree-toggle') || e.target.closest('.flow-tree-completed-label') || e.target.closest('.flow-btn-goto')) return;
            const cur = typeof ModuleManager !== 'undefined' && ModuleManager.getCurrent ? ModuleManager.getCurrent() : null;
            if (!cur) return;
            this.switchDebugTab('flow');
            const pathStr = row.dataset.path;
            const pathIds = (pathStr === undefined || pathStr === '') ? [] : pathStr.split('|').filter(Boolean);
            const { node: selNode, name: selName } = (typeof ModuleManager !== 'undefined' && ModuleManager.getModuleNodeByPath) ? ModuleManager.getModuleNodeByPath(cur, pathIds) : {};
            if (typeof DebugViewer !== 'undefined' && typeof DebugViewer._showModuleDetail === 'function') {
                DebugViewer._showModuleDetail(selNode || cur.content, selName || (pathIds.length === 0 ? cur.name : '未命名'), pathIds.length === 0, cur, pathIds);
            }
        });

        // 设置选项卡（关键：存档页/Persona页切换）
        document.querySelectorAll('.settings-tab').forEach(tab => {
            tab.addEventListener('click', (e) => this.switchSettingsTab(e.currentTarget.dataset.tab));
        });

        // API设置（迁移自SillyTavern）
        document.getElementById('btn-toggle-api-key')?.addEventListener('click', () => {
            const input = document.getElementById('input-api-key');
            const btn = document.getElementById('btn-toggle-api-key');
            if (input.type === 'password') {
                input.type = 'text';
                btn.textContent = '隐藏';
            } else {
                input.type = 'password';
                btn.textContent = '显示';
            }
        });
        document.getElementById('api-provider-select')?.addEventListener('change', (e) => this.onProviderChange(e.target.value));
        document.getElementById('btn-fetch-models')?.addEventListener('click', () => this.fetchModels());
        document.getElementById('btn-test-api')?.addEventListener('click', () => this.testAPIConnection());
        document.getElementById('btn-api-preset-save')?.addEventListener('click', () => this.saveAPIPreset());
        document.getElementById('btn-api-preset-delete')?.addEventListener('click', () => this.deleteAPIPreset());
        document.getElementById('api-preset-select')?.addEventListener('change', (e) => this.loadAPIPreset(e.target.value));
        ['input-api-endpoint', 'input-api-key', 'api-model-select', 'input-api-model-manual', 'api-relay-select'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', () => this._commitAPIForm());
        });

        // 写作指导设置
        document.getElementById('writing-guide-use-builtin')?.addEventListener('change', () => this.saveWritingGuideSettings());
        document.getElementById('writing-guide-pov')?.addEventListener('change', () => this.saveWritingGuideSettings());
        document.getElementById('writing-guide-break-nsfw')?.addEventListener('change', () => this.saveWritingGuideSettings());

        // 补丁区设置
        document.getElementById('patches-goto-module')?.addEventListener('click', () => { this.showPage('settings'); this.switchSettingsTab('module'); });
        document.getElementById('patches-group-new')?.addEventListener('click', () => this.patchesNewGroup());
        document.getElementById('patches-group-import-wb')?.addEventListener('click', () => document.getElementById('file-import-worldbook')?.click());
        document.getElementById('file-import-worldbook')?.addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) this.patchesImportWorldbook(f); e.target.value = ''; });

        // 预设导入（迁移自SillyTavern）
        // 预设导入导出（在PresetEditor中处理）
        // document.getElementById('btn-import-preset')?.addEventListener('click', () => {
        //     document.getElementById('file-import-preset')?.click();
        // });
        // document.getElementById('file-import-preset')?.addEventListener('change', (e) => this.importPreset(e.target.files[0]));
        // document.getElementById('btn-export-preset')?.addEventListener('click', () => this.exportPreset());

        // Persona
        document.getElementById('btn-new-persona')?.addEventListener('click', () => this.newPersona());
        document.getElementById('btn-delete-persona')?.addEventListener('click', () => this.deletePersona());
        document.getElementById('btn-save-persona')?.addEventListener('click', () => this.savePersona());
        document.getElementById('persona-select')?.addEventListener('change', (e) => this.loadPersona(e.target.value));

        // 存档（设置页）
        document.getElementById('btn-export-save')?.addEventListener('click', () => this.exportSave());
        document.getElementById('btn-copy-save-text')?.addEventListener('click', () => this.copySaveText());
        document.getElementById('btn-paste-save-text')?.addEventListener('click', () => this.pasteImportSave());
        document.getElementById('btn-import-save')?.addEventListener('click', () => document.getElementById('file-import-save')?.click());
        document.getElementById('file-import-save')?.addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) this.importSave(f); e.target.value = ''; });
        document.getElementById('btn-rename-save')?.addEventListener('click', () => this.renameSave());

        // 存档（底部快速按钮）
        document.getElementById('btn-new-game-quick')?.addEventListener('click', () => this.startNewGame());
        document.getElementById('btn-load-saves')?.addEventListener('click', () => this.showSavesModal());

        // ===== 聊天输入和发送 =====
        document.getElementById('btn-send')?.addEventListener('click', () => this.sendMessage());
        document.getElementById('btn-stop')?.addEventListener('click', () => this.stopGeneration());
        const onEnterSend = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        };
        document.getElementById('user-input')?.addEventListener('keydown', onEnterSend);
        document.getElementById('user-meta-input')?.addEventListener('keydown', onEnterSend);

        // 场外指令伸缩：点击展开/收起，记住状态
        const metaToggle = document.getElementById('chat-meta-toggle');
        const metaBlock = document.getElementById('chat-meta-block');
        const inputWrapper = document.getElementById('text-input-wrapper');
        const metaExpandedKey = 'bulimia_chat_meta_expanded';
        if (metaToggle && metaBlock && inputWrapper) {
            const apply = (expanded) => {
                metaBlock.classList.toggle('collapsed', !expanded);
                inputWrapper.classList.toggle('expanded-meta', expanded);
                metaToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
                if (expanded && window.AutoGrow) AutoGrow.refresh(metaBlock);
            };
            apply(Storage.getLocal(metaExpandedKey) === true);
            metaToggle.addEventListener('click', () => {
                const expanded = metaBlock.classList.contains('collapsed');
                apply(expanded);
                Storage.setLocal(metaExpandedKey, expanded);
            });
        }

        // ===== 操作按钮 =====
        document.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const action = e.currentTarget.dataset.action;
                this.handleAction(action);
            });
        });

        // ===== 暂存操作 =====
        document.getElementById('btn-view-pending')?.addEventListener('click', () => this.showPendingActions());
        document.getElementById('btn-clear-pending')?.addEventListener('click', () => this.clearPendingActions());
        if (typeof Events !== 'undefined' && typeof EVENT_TYPES !== 'undefined') {
            Events.on(EVENT_TYPES.PHONE_PENDING_CHANGED, (data) => {
                const el = document.getElementById('pending-count');
                const bar = document.getElementById('pending-bar');
                const count = (window.InteractiveSaveDriver ? InteractiveSaveDriver.getTotalPendingCount() : 0);
                if (el) el.textContent = String(count);
                if (bar) bar.classList.toggle('hidden', count === 0);
            });
        }

        // ===== 模块管理 =====
        document.getElementById('current-module-select')?.addEventListener('change', (e) => {
            this.loadModule(e.target.value);
        });
        document.getElementById('btn-module-new')?.addEventListener('click', () => this.newModule());
        document.getElementById('btn-module-save')?.addEventListener('click', () => this.saveModule());
        document.getElementById('btn-module-import')?.addEventListener('click', () => {
            document.getElementById('file-import-module')?.click();
        });
        document.getElementById('file-import-module')?.addEventListener('change', (e) => {
            const f = e.target.files?.[0];
            if (f) this.importModule(f);
            e.target.value = '';
        });
        document.getElementById('btn-module-export')?.addEventListener('click', () => this.exportModule());
        document.getElementById('btn-module-refresh-folder')?.addEventListener('click', () => this.refreshModuleFromFolder());

        // ===== 显示设置 =====
        document.getElementById('input-ai-name')?.addEventListener('change', (e) => {
            const settings = Storage.getSettings() || {};
            settings.aiName = e.target.value;
            Storage.saveSettings(settings);
        });
        document.getElementById('select-theme')?.addEventListener('change', (e) => {
            this.applyTheme(e.target.value);
            Storage.saveTheme(e.target.value);
        });
        document.getElementById('input-font-size')?.addEventListener('change', (e) => {
            const size = Number(e.target.value);
            this.applyFontSize(size);
            Storage.saveSettings({ fontSize: size });
        });

        // 停止字符串：标签式增删
        const stopHost = document.getElementById('stop-strings-field');
        if (stopHost) {
            this._stopStringsField = TagList.create({
                values: this.getStopStringList(),
                placeholder: '输入后按回车添加',
                separator: /\n/,
                onChange: (values) => Storage.saveSettings({ stopStrings: values })
            });
            stopHost.appendChild(this._stopStringsField.el);
        }

        // 显示选项
        ['checkbox-names-as-stop-strings', 'checkbox-trim-spaces', 'checkbox-trim-sentences',
            'checkbox-always-add-names', 'checkbox-hide-thinking', 'checkbox-auto-clean-response',
            'checkbox-stream-output'].forEach(id => {
                document.getElementById(id)?.addEventListener('change', (e) => {
                    const settings = Storage.getSettings() || {};
                    const key = id.replace('checkbox-', '').replace(/-/g, '_');
                    settings[key] = e.target.checked;
                    Storage.saveSettings(settings);
                });
            });

        document.getElementById('select-thinking-format')?.addEventListener('change', (e) => {
            const settings = Storage.getSettings() || {};
            settings.thinkingFormat = e.target.value;
            Storage.saveSettings(settings);

            this.syncThinkingTagInputs(e.target.value);
        });

        // 自定义 thinking 标签
        document.getElementById('input-thinking-start-tag')?.addEventListener('change', (e) => {
            const settings = Storage.getSettings() || {};
            settings.thinkingStartTag = e.target.value;
            Storage.saveSettings(settings);
        });

        document.getElementById('input-thinking-end-tag')?.addEventListener('change', (e) => {
            const settings = Storage.getSettings() || {};
            settings.thinkingEndTag = e.target.value;
            Storage.saveSettings(settings);
        });

        // 模块编辑器快捷键：仅在 module-edit tab 激活、且焦点不在输入框时生效
        // Ctrl+F 焦点搜索 / Ctrl+X 剪切选中 / Ctrl+C 复制选中 / Ctrl+V 粘贴到选中节点 main / Delete 删选中 / Ctrl+Z 撤回 / Ctrl+Y 重做
        document.addEventListener('keydown', (e) => {
            const editPanel = document.getElementById('debug-panel-module-edit');
            if (!editPanel || !editPanel.classList.contains('active')) return;
            // 焦点在 input/textarea/contenteditable → 跳过（让原生编辑行为）
            // 例外：Ctrl+F 即使在 search input 里也照常聚焦（已是 input → noop）
            const ae = document.activeElement;
            const inEditField = ae && (
                ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' ||
                (ae.getAttribute && ae.getAttribute('contenteditable') === 'true')
            );
            if (!window.DebugModuleJump) return;
            const DMJ = DebugModuleJump;
            const selId = DMJ._meSel;
            // Ctrl+F：聚焦搜索
            if ((e.ctrlKey || e.metaKey) && e.key && e.key.toLowerCase() === 'f') {
                e.preventDefault();
                const inp = document.getElementById('mjx-me-search-input');
                if (inp) { inp.focus(); inp.select && inp.select(); }
                return;
            }
            if (inEditField) return; // 其他快捷键不在输入框生效
            // Ctrl+X / Ctrl+C：多选状态（_meMulti 非空）→ 批量；否则单条用 _meSel
            if ((e.ctrlKey || e.metaKey) && e.key && e.key.toLowerCase() === 'x') {
                if (DMJ._meMulti && DMJ._meMulti.size > 0 && DMJ._meCutMulti) { e.preventDefault(); DMJ._meCutMulti(); return; }
                if (selId) { e.preventDefault(); DMJ._meCutNode(selId); return; }
            }
            if ((e.ctrlKey || e.metaKey) && e.key && e.key.toLowerCase() === 'c') {
                if (DMJ._meMulti && DMJ._meMulti.size > 0 && DMJ._meCopyMulti) { e.preventDefault(); DMJ._meCopyMulti(); return; }
                if (selId) { e.preventDefault(); DMJ._meCopyNode(selId); return; }
            }
            if ((e.ctrlKey || e.metaKey) && e.key && e.key.toLowerCase() === 'v' && selId && DMJ._meClipboard) {
                e.preventDefault(); DMJ._mePasteNode(selId, 'main'); return;
            }
            if (e.key === 'Delete' && selId && DMJ._deleteCurrentNode) {
                e.preventDefault();
                // delnode 是右栏行为，复用它（含 Modal.confirm）
                DMJ._selId = selId; DMJ._deleteCurrentNode();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key && e.key.toLowerCase() === 'z' && DMJ._meUndo) {
                e.preventDefault(); DMJ._meUndo(); return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key && e.key.toLowerCase() === 'y' && DMJ._meRedo) {
                e.preventDefault(); DMJ._meRedo(); return;
            }
        });
    },

    // ===== 开始游戏 =====

    _newSaveId() {
        return `存档_${new Date().toLocaleDateString().replace(/\//g, '-')}_${Date.now().toString().slice(-4)}`;
    },

    /** 按当前模组写入新游戏的起始状态：起始位置与各变量的初始值 */
    _seedNewGameState() {
        const curModule = typeof ModuleManager !== 'undefined' ? ModuleManager.getCurrent() : null;
        this._applyModuleStartTime();
        if (curModule && typeof ModuleManager.getFirstLeafModulePath === 'function') {
            // 起始位置落在首个触发器链叶，而非首个顶层时间线
            const firstPath = (typeof ModuleManager.getFirstTriggerChainLeafModulePath === 'function')
                ? ModuleManager.getFirstTriggerChainLeafModulePath(curModule)
                : ModuleManager.getFirstLeafModulePath(curModule);
            State.currentModulePath = [firstPath];
            if (firstPath && firstPath.length && typeof ModuleManager.recordModuleEnteredAt === 'function') {
                ModuleManager.recordModuleEnteredAt(curModule.id, firstPath.join('|'), State.variables);
            }
            // 起步时先跑一次模组里的一次性生成器，让提示词队列从一开始就含动态节点
            try {
                this._runModuleGeneratorsForCurrentPath(curModule, firstPath || []);
            } catch (error) {
                console.error('Module generator error:', error);
                Toast.show('部分初始内容没有生成成功：' + error.message, 'error', 8000);
            }
        }
        if (curModule?.content) {
            const c = curModule.content;
            if (!State.variables) State.variables = {};
            if (c.initialStates && typeof c.initialStates === 'object') {
                Object.assign(State.variables, c.initialStates);
            }
            const collectVarDefaults = (node) => {
                (node.variables || []).forEach((v) => {
                    if (v && v.id != null && State.variables[v.id] === undefined && v.value !== undefined) {
                        State.variables[v.id] = v.value;
                    }
                });
                (node.subModules || []).forEach((n) => collectVarDefaults(n));
            };
            collectVarDefaults(c);
        }
        const pathArr = State.currentModulePath && State.currentModulePath.length && Array.isArray(State.currentModulePath[0]) ? State.currentModulePath : (State.currentModulePath?.length ? [State.currentModulePath] : []);
        if (typeof ModuleManager !== 'undefined' && pathArr.length > 0) {
            const pathState = pathArr.length > 1 && typeof ModuleManager.getStateForPaths === 'function'
                ? ModuleManager.getStateForPaths(pathArr)
                : (typeof ModuleManager.getStateForPath === 'function' ? ModuleManager.getStateForPath(pathArr[0]) : {});
            const systemIds = ['turnSerial', 'foreshadow_short', 'foreshadow_long'];
            const preserved = {};
            systemIds.forEach((id) => { if (State.variables[id] !== undefined) preserved[id] = State.variables[id]; });
            Object.assign(State.variables, pathState);
            Object.assign(State.variables, preserved);
        }
    },

    /**
     * 进入游戏页并确保有存档槽与引擎状态，不弹确认、不清空对话。
     * 首页「开始游戏」「继续游戏」调用此方法。
     */
    async enterGame() {
        if (Engine.isRunning && State.currentSaveId) {
            this.showPage('game');
            return;
        }
        if (!State.currentSaveId) State.currentSaveId = this._newSaveId();
        if (!(State.chatHistory && State.chatHistory.length > 0)) {
            await this.ensureEngineConfig();
            this._seedNewGameState();
        }
        await Engine.init();
        this.showPage('game');
        this.updateSaveInfo();
        ChatDisplay.loadHistory(State.chatHistory || []);
    },

    async startNewGame() {
        if (this.isGenerating) {
            Toast.show('正在生成中，请先停止。', 'warning');
            return;
        }
        // 还没有开始任何游戏时直接开始，不用确认
        if (Engine.isRunning) {
            const confirmed = await Modal.confirm('新游戏', '开始新游戏？当前游戏会自动保存。');
            if (!confirmed) return;
        }

        if (Engine.isRunning && State.currentSaveId) {
            if (!(await this.autoSaveToCurrentSlot())) return;
        }

        State.reset();
        State.currentSaveId = this._newSaveId();
        ChatDisplay.clear();
        await this.ensureEngineConfig();
        this._seedNewGameState();
        await Engine.init();
        this.showPage('game');
        this.updateSaveInfo();
        ChatDisplay.loadHistory(State.chatHistory || []);

        if (await this.autoSaveToCurrentSlot()) Toast.show('已开始新游戏。', 'success');
    }
};

window.App = App;
// 兼容旧UI调用
window.App.rerollLast = () => App.rerollLastMessage();
document.addEventListener('DOMContentLoaded', () => App.init());
