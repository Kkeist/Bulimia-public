/**
 * 存档：读档、存档列表、导入导出、重命名、自动存档。
 * 扩展 App（app.js 先加载）。
 */
Object.assign(App, {
    LAST_SAVE_KEY: 'bulimia_last_save',

    _escSave(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },

    /**
     * 往容器里画存档列表。存档名、预览文字都是玩家或导入文件里的内容，一律按文字写入，不当作网页代码。
     * @param {HTMLElement} container
     * @param {Array} saves
     * @param {{currentId?:string, onLoad:function(string), onDelete:function(string)}} handlers
     */
    _renderSaveRows(container, saves, handlers) {
        container.textContent = '';
        for (const save of saves) {
            const row = document.createElement('div');
            row.className = 'item-list-item' + (save.id === handlers.currentId ? ' active' : '');

            const info = document.createElement('div');
            info.style.flex = '1';
            const title = document.createElement('strong');
            title.textContent = (save.preview?.persona || save.id) + (save.id === handlers.currentId ? '（当前）' : '');
            const when = document.createElement('div');
            when.style.cssText = 'font-size: 11px; color: var(--color-text-muted); margin-top: 2px;';
            when.textContent = `${new Date(save.timestamp).toLocaleString()} ${save.preview?.date ? '· ' + save.preview.date : ''}`;
            const last = document.createElement('div');
            last.style.cssText = 'font-size: 11px; color: var(--color-text-secondary); margin-top: 2px; word-break: break-word; overflow-wrap: anywhere;';
            last.textContent = save.preview?.lastContent || '';
            info.append(title, when, last);

            const actions = document.createElement('div');
            const loadBtn = document.createElement('button');
            loadBtn.className = 'btn-small';
            loadBtn.textContent = '加载';
            loadBtn.addEventListener('click', () => handlers.onLoad(save.id));
            const delBtn = document.createElement('button');
            delBtn.className = 'btn-small danger';
            delBtn.textContent = '删除';
            delBtn.addEventListener('click', () => handlers.onDelete(save.id));
            actions.append(loadBtn, delBtn);

            row.append(info, actions);
            container.appendChild(row);
        }
    },

    /** 读取存档列表；读不出来时告诉玩家并返回 null */
    async _listSavesOrReport() {
        try {
            return await Storage.listSaves();
        } catch (error) {
            Toast.show('读取存档列表失败：' + error.message, 'error', 6000);
            return null;
        }
    },

    async showLoadGame() {
        const saves = await this._listSavesOrReport();
        if (!saves) return;
        if (saves.length === 0) {
            Toast.show('没有找到存档', 'info');
            return;
        }
        this._showSavesDialog('选择存档', saves);
    },

    async showSavesModal() {
        const saves = await this._listSavesOrReport();
        if (!saves) return;
        this._showSavesDialog('读取存档', saves);
    },

    /** 弹出存档列表：加载、删除都在列表里 */
    _showSavesDialog(title, saves) {
        const listId = 'saves-dialog-list';
        Modal.show(title, saves.length === 0
            ? '<div class="item-list-empty">暂无存档，开始新游戏后会自动保存</div>'
            : `<div class="item-list" id="${listId}" style="max-height: 400px;"></div>`, {
            buttons: [{ label: '关闭', action: 'close' }],
            onAction: () => Modal.close()
        });
        const box = document.getElementById(listId);
        if (!box) return;
        this._renderSaveRows(box, saves, {
            currentId: State.currentSaveId,
            onLoad: async (id) => { Modal.close(); await this.loadGame(id); },
            onDelete: async (id) => {
                if (await this.deleteSave(id)) {
                    const rest = await this._listSavesOrReport();
                    if (rest) this._showSavesDialog(title, rest);
                } else {
                    this._showSavesDialog(title, saves);
                }
            }
        });
    },

    async loadGame(saveId) {
        if (this.isGenerating) {
            Toast.show('正在生成中，请先点击“停止”再读取存档', 'warning');
            return;
        }
        let success = false;
        try {
            success = await Engine.loadSave(saveId);
        } catch (error) {
            Toast.show('这个存档读取不出来，内容可能已经损坏。其他存档没有受影响。', 'error', 8000);
            return;
        }
        if (!success) {
            Toast.show('没有找到这个存档，可能已被删除。', 'error');
            return;
        }
        State.currentSaveId = saveId;
        Engine.isRunning = true;
        this.showPage('game');
        this.updateSaveInfo();
        this.updateSystemStatusBar && this.updateSystemStatusBar();
        if (window.PluginRegistry) {
            // 当前路径已变 → 必须重跑 registerFromModule 沿新路径收集 sub-module 的 plugins；只 renderUI 会拿不到状态面板/战斗面板等子模块插件
            if (PluginRegistry.registerFromModule) PluginRegistry.registerFromModule();
            else if (PluginRegistry.renderUI) PluginRegistry.renderUI();
        }
        ChatDisplay.loadHistory(State.chatHistory || []);
        Storage.setLocal(this.LAST_SAVE_KEY, saveId);
        Toast.show('存档已加载', 'success');
    },

    /** 打开页面时回到上次玩的存档；没有记录或存档已删除就留在首页 */
    async resumeLastGame() {
        const id = Storage.getLocal(this.LAST_SAVE_KEY);
        if (!id || typeof id !== 'string') return;
        let exists = false;
        try {
            exists = !!(await Storage.loadGame(id));
        } catch (error) {
            Toast.show('读取上次的存档失败：' + error.message, 'error', 6000);
            return;
        }
        if (!exists) {
            Storage.removeLocal(this.LAST_SAVE_KEY);
            return;
        }
        await this.loadGame(id);
    },

    async loadSaveList() {
        const list = document.getElementById('save-list');
        if (!list) return;
        const saves = await this._listSavesOrReport();
        if (!saves) return;

        if (saves.length === 0) {
            list.innerHTML = '<div class="item-list-empty">没有存档</div>';
            return;
        }

        this._renderSaveRows(list, saves, {
            currentId: State.currentSaveId,
            onLoad: (id) => this.loadGame(id),
            onDelete: (id) => this.deleteSave(id)
        });
    },

    /** 删除存档（先确认）；返回是否真的删了 */
    async deleteSave(saveId) {
        if (!saveId) {
            Toast.show('存档名称无效', 'error');
            return false;
        }

        const confirmed = await Modal.confirm('删除存档', `确定要删除存档“${this._escSave(saveId)}”吗？删除后不能恢复。`);
        if (!confirmed) return false;

        try {
            await Storage.deleteSave(saveId);
        } catch (error) {
            Toast.show('删除失败：' + error.message, 'error', 6000);
            return false;
        }
        if (State.currentSaveId === saveId) {
            State.currentSaveId = null;
            Storage.removeLocal(this.LAST_SAVE_KEY);
            this.updateSaveInfo();
        }
        await this.loadSaveList();
        Toast.show('存档已删除', 'success');
        return true;
    },

    /** 取当前存档的导出文字：先存一次，确保导出的是最新进度 */
    async _currentSaveText() {
        if (!State.currentSaveId) {
            Toast.show('还没有存档可以导出，先开始游戏吧。', 'warning');
            return null;
        }
        if (!(await this.autoSaveToCurrentSlot())) return null;
        const text = await Storage.getSaveExportText(State.currentSaveId);
        if (!text) {
            Toast.show('没有找到当前存档。', 'error');
            return null;
        }
        return text;
    },

    async exportSave() {
        try {
            const text = await this._currentSaveText();
            if (!text) return;
            const name = FileDownload.save(text, State.currentSaveId, 'json', 'application/json');
            Toast.show('已开始下载：' + name, 'success', 5000);
        } catch (error) {
            Toast.show('导出失败：' + error.message, 'error', 6000);
        }
    },

    /** 下载被拦住时的备用办法：把存档文字显示出来，复制后自己保存 */
    async copySaveText() {
        try {
            const text = await this._currentSaveText();
            if (text) FileDownload.showText('存档文字', text);
        } catch (error) {
            Toast.show('导出失败：' + error.message, 'error', 6000);
        }
    },

    _readFileText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error('这个文件读取不出来。'));
            reader.readAsText(file);
        });
    },

    async importSave(file) {
        if (!file) return;
        try {
            await this._importSaveFromText(await this._readFileText(file));
        } catch (error) {
            Toast.show('导入失败：' + error.message, 'error', 6000);
        }
    },

    async pasteImportSave() {
        const text = await Modal.prompt('粘贴存档文字', { description: '把复制出来的存档文字粘贴到这里。', placeholder: '' });
        if (!text || !text.trim()) return;
        try {
            await this._importSaveFromText(text);
        } catch (error) {
            Toast.show('导入失败：' + error.message, 'error', 6000);
        }
    },

    async _importSaveFromText(text) {
        const id = await Storage.importSaveText(text);
        await this.loadSaveList();
        const loadNow = await Modal.confirm('导入完成', `已导入为存档“${this._escSave(id)}”，现在读取它吗？`);
        if (loadNow) await this.loadGame(id);
    },

    updateSaveInfo() {
        const saveName = State.currentSaveId || '未开始';

        const saveDisplay = document.getElementById('current-save-display');
        if (saveDisplay) {
            saveDisplay.textContent = saveName;
        }

        const saveNameInput = document.getElementById('current-save-name-input');
        if (saveNameInput && State.currentSaveId) {
            saveNameInput.value = State.currentSaveId;
        }
    },

    /** 页头标题（模组名）与状态栏（名字、日期） */
    updateSystemStatusBar() {
        const persona = typeof PersonaManager !== 'undefined' ? PersonaManager.current : null;
        const mod = typeof ModuleManager !== 'undefined' && ModuleManager.getCurrent ? ModuleManager.getCurrent() : null;
        const running = typeof Engine !== 'undefined' && Engine.isRunning;
        // 还没有开始游戏：中间只显示标题，页头不写模组名、不显示状态栏
        const page = document.getElementById('page-game');
        if (page) page.classList.toggle('is-empty', !running);
        const title = document.getElementById('game-module-title');
        if (title) title.textContent = running && mod ? (mod.name || '') : '';
        const el = document.getElementById('status-permanent-content');
        if (!el) return;
        const name = (persona && persona.name) || '';
        const vars = (typeof State !== 'undefined' && State.variables) ? State.variables : {};
        const cal = vars.calendar && typeof vars.calendar === 'object' ? vars.calendar : (vars.time && typeof vars.time === 'object' ? vars.time : null);
        let dateStr = '';
        if (cal && cal.year != null) {
            dateStr = (cal.era != null ? (cal.era || '') : '') + (cal.year || 0) + '年' + (cal.month != null ? cal.month : 1) + '月' + (cal.day != null ? cal.day : 1) + '日';
        }
        el.textContent = '';
        [['名字', name], ['日期', dateStr]].forEach(([label, value]) => {
            if (!value) return;
            const item = document.createElement('span');
            item.className = 'status-item';
            const k = document.createElement('span');
            k.className = 'status-item-name';
            k.textContent = label;
            item.appendChild(k);
            item.appendChild(document.createTextNode(value));
            el.appendChild(item);
        });
        // 名字和日期都没有时没有可看的，整条状态栏连同小方块一起不显示
        const bar = document.getElementById('status-bar');
        if (bar) bar.classList.toggle('hidden', el.children.length === 0);
    },

    async renameSave() {
        const newName = document.getElementById('current-save-name-input')?.value?.trim();
        if (!newName) {
            Toast.show('请输入存档名称', 'warning');
            return;
        }
        if (!Engine.isRunning) {
            Toast.show('先开始游戏，才能给存档命名。', 'warning');
            return;
        }
        if (newName === State.currentSaveId) {
            Toast.show('存档名称未改变', 'info');
            return;
        }

        try {
            const existing = (await Storage.listSaves()).map(sv => sv.id);
            if (existing.includes(newName)) {
                Toast.show('已经有同名的存档了，请换一个名字。', 'warning');
                return;
            }
            const oldId = State.currentSaveId;
            State.currentSaveId = newName;
            if (!(await this.autoSaveToCurrentSlot())) {
                State.currentSaveId = oldId;
                return;
            }
            if (oldId) await Storage.deleteSave(oldId);
            this.updateSaveInfo();
            await this.loadSaveList();
            Toast.show('存档已重命名', 'success');
        } catch (error) {
            Toast.show('重命名失败：' + error.message, 'error', 6000);
        }
    },

    async autoSaveToCurrentSlot() {
        if (!Engine.isRunning) return false;

        if (!State.currentSaveId) {
            State.currentSaveId = `存档_${new Date().toLocaleDateString().replace(/\//g, '-')}_${Date.now().toString().slice(-4)}`;
        }

        try {
            const snapshot = State.getSnapshot();
            snapshot.chatHistory = ChatDisplay.messages;
            snapshot.currentPersona = PersonaManager.current || null;
            await Storage.saveGame(State.currentSaveId, snapshot);
            if (this._lastSaveIdWritten !== State.currentSaveId) {
                Storage.setLocal(this.LAST_SAVE_KEY, State.currentSaveId);
                this._lastSaveIdWritten = State.currentSaveId;
            }
            this.updateSaveInfo();
            Events.emit(EVENT_TYPES.AUTO_SAVE, { saveId: State.currentSaveId });
            if (this._saveFailing) {
                this._saveFailing = false;
                Toast.show('自动存档已恢复。', 'success');
            }
            return true;
        } catch (error) {
            this._reportSaveFailure(error);
            return false;
        }
    },

    /** 存档失败：告诉玩家原因；连续失败时每分钟最多提示一次。旧存档不会被动到。 */
    _reportSaveFailure(error) {
        this._saveFailing = true;
        const now = Date.now();
        if (this._lastSaveWarnAt && now - this._lastSaveWarnAt < 60000) return;
        this._lastSaveWarnAt = now;
        Toast.show(error && error.message ? error.message : '存档没有保存成功，请重试。', 'error', 8000);
    }
});
