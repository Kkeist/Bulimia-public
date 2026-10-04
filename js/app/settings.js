/**
 * 设置页：写作指导、补丁、个人设定、API 连接与预设、输出预设。
 * 扩展 App（app.js 先加载）。
 */
Object.assign(App, {
    /**
     * 切换设置页标签：各标签页叠放在同一区域，页面大小不变，各页滚动位置各自保留。
     */
    switchSettingsTab(tabId) {
        if (!tabId) return;

        document.querySelectorAll('.settings-tab').forEach(tab => {
            const on = tab.dataset.tab === tabId;
            tab.classList.toggle('active', on);
            tab.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        document.querySelectorAll('.settings-panel').forEach(panel => {
            const panelTab = panel.id?.replace('settings-panel-', '');
            const on = panelTab === tabId;
            panel.classList.toggle('active', on);
            if (on) {
                ScrollMemory.track(panel, 'settings:' + panelTab);
                ScrollMemory.restoreOnce(panel, 'settings:' + panelTab);
                if (window.AutoGrow) AutoGrow.refresh(panel);
            }
        });
        UiState.set('settingsTab', tabId);
        this.revealActiveSettingsTab();

        // 切到相关页时刷新内容
        if (tabId === 'api') {
            this.loadAPIConfig();
        }
        if (tabId === 'preset') {
            PresetEditor.loadPresetList();
            PresetEditor.loadModuleList();
            PresetEditor.renderPresetList();
            const select = document.getElementById('prompt-preset-select');
            if (select && select.value) {
                PresetEditor.loadPreset(select.value);
            }
        }
        if (tabId === 'writing-guide') {
            this.loadWritingGuideSettings();
        }
        if (tabId === 'patches') {
            this.loadPatchesSettings();
        }
        if (tabId === 'regex') {
            RegexManager.loadPresetList();
            RegexManager.loadRegexScripts();
            // 如果当前有预设，自动选择
            const currentPreset = PresetEditor.currentPreset;
            if (currentPreset) {
                const presetSelect = document.getElementById('regex-preset-select');
                if (presetSelect) {
                    presetSelect.value = currentPreset.id;
                    RegexManager.loadPreset(currentPreset.id);
                }
            }
        }
        if (tabId === 'module') {
            this.loadModuleList();
            this.loadCurrentModuleInfo();
        }
        if (tabId === 'persona') {
            this.loadPersonas();
        }
        if (tabId === 'save') {
            this.loadSaveList();
            this.updateSaveInfo();
        }
        if (tabId === 'display') {
            this.loadDisplaySettings();
        }
    },

    /** 让当前标签出现在标签栏的可见范围内 */
    revealActiveSettingsTab() {
        const strip = document.querySelector('.settings-tabs');
        const active = strip && strip.querySelector('.settings-tab.active');
        if (!active) return;
        const s = strip.getBoundingClientRect();
        const a = active.getBoundingClientRect();
        if (strip.scrollWidth > strip.clientWidth + 1 && strip.clientHeight < strip.scrollHeight + 1 && getComputedStyle(strip).flexDirection === 'row') {
            strip.scrollLeft += (a.left + a.width / 2) - (s.left + s.width / 2);
        } else if (a.top < s.top || a.bottom > s.bottom) {
            strip.scrollTop += (a.top + a.height / 2) - (s.top + s.height / 2);
        }
    },

    // ===== 写作指导设置 =====
    loadWritingGuideSettings() {
        const settings = Storage.getSettings() || {};
        const cb = document.getElementById('writing-guide-use-builtin');
        const sel = document.getElementById('writing-guide-pov');
        const breakNsfw = document.getElementById('writing-guide-break-nsfw');
        if (cb) cb.checked = settings.useBuiltinWritingGuide !== false;
        if (sel) sel.value = settings.writingGuidePOV || 'off';
        if (breakNsfw) breakNsfw.checked = settings.writingGuideBreakNsfw === true;
        // 没有内置数据时没有这两项可选
        const hasBreak = typeof WritingGuide !== 'undefined' && WritingGuide.BREAK_NSFW_IDS.length > 0;
        const hasPov = typeof WritingGuide !== 'undefined' && Object.keys(WritingGuide.POV_CONTENT).length > 0;
        document.getElementById('writing-guide-break-row')?.classList.toggle('hidden', !hasBreak);
        document.getElementById('writing-guide-pov-card')?.classList.toggle('hidden', !hasPov);
    },

    saveWritingGuideSettings() {
        const settings = Storage.getSettings() || {};
        const cb = document.getElementById('writing-guide-use-builtin');
        const sel = document.getElementById('writing-guide-pov');
        const breakNsfw = document.getElementById('writing-guide-break-nsfw');
        settings.useBuiltinWritingGuide = cb?.checked !== false;
        settings.writingGuidePOV = sel?.value || 'off';
        settings.writingGuideBreakNsfw = breakNsfw?.checked === true;
        Storage.saveSettings(settings);
    },

    // ===== 补丁（模组自带 + 自定义） =====
    async loadPatchesSettings() {
        const module = typeof ModuleManager !== 'undefined' ? ModuleManager.getCurrent() : null;
        const nameEl = document.getElementById('patches-current-module-name');
        if (nameEl) nameEl.textContent = module ? module.name || module.id : '未选择模组';
        if (typeof Patches !== 'undefined' && module && Patches.getModulePatches && Patches.setCurrentModulePatches) {
            const list = await Patches.getModulePatches(module);
            Patches.setCurrentModulePatches(list);
        }
        this.renderPatchesModuleList();
        this._bindPatchGroupEvents();
        this.renderPatchesAllGroups();
    },

    renderPatchesModuleList() {
        const container = document.getElementById('patches-module-list');
        if (!container) return;
        const list = typeof Patches !== 'undefined' ? Patches.getCurrentModulePatches() : [];
        const settings = Storage.getSettings() || {};
        const enabled = settings.patchModuleEnabled || {};
        container.textContent = '';
        if (list.length === 0) {
            container.innerHTML = '<div class="item-list-empty">当前模组没有补丁。</div>';
            return;
        }
        list.forEach(p => {
            const row = document.createElement('div');
            row.className = 'item-list-item';
            const label = document.createElement('label');
            label.className = 'setting-check item-main';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = !!enabled[p.id];
            cb.addEventListener('change', () => {
                const s = Storage.getSettings() || {};
                const map = s.patchModuleEnabled || {};
                map[p.id] = cb.checked;
                Storage.saveSettings({ patchModuleEnabled: map });
            });
            label.appendChild(cb);
            label.appendChild(document.createTextNode(p.name || p.id));
            row.appendChild(label);
            container.appendChild(row);
        });
    },

    _patchGroups() {
        const s = Storage.getSettings() || {};
        return Array.isArray(s.patchGroups) ? s.patchGroups : [];
    },

    _savePatchGroups(groups) {
        Storage.saveSettings({ patchGroups: groups });
    },

    _patchEntry(groups, gid, eid) {
        const g = groups.find(x => x.id === gid);
        const e = g && Array.isArray(g.entries) ? g.entries.find(x => String(x.id || '') === String(eid || '')) : null;
        return { g, e };
    },

    /** 重画补丁分组，并保持设置页当前滚动位置 */
    renderPatchesAllGroups() {
        const container = document.getElementById('patches-imported-groups');
        if (!container) return;
        const panel = document.getElementById('settings-panel-patches');
        ScrollMemory.preserve(panel, () => this._drawPatchGroups(container));
    },

    _drawPatchGroups(container) {
        const groups = this._patchGroups();
        container.textContent = '';
        if (groups.length === 0) {
            container.innerHTML = '<div class="item-list-empty">还没有补丁分组。</div>';
            return;
        }
        groups.forEach(g => container.appendChild(this._buildPatchGroup(g)));
    },

    _chevButton(collapsed, label) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'card-toggle';
        b.dataset.act = 'toggle';
        b.setAttribute('aria-label', label);
        b.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        const c = document.createElement('span');
        c.className = 'chev' + (collapsed ? ' is-right' : '');
        b.appendChild(c);
        return b;
    },

    _buildPatchGroup(g) {
        const groupEnabled = g.groupEnabled !== false;
        const card = document.createElement('div');
        card.className = 'card' + (g.collapsed === true ? ' is-collapsed' : '') + (groupEnabled ? '' : ' is-off');
        card.dataset.gid = g.id;

        const head = document.createElement('div');
        head.className = 'card-head';
        head.appendChild(this._chevButton(g.collapsed === true, '展开或收起分组'));
        const name = document.createElement('input');
        name.type = 'text';
        name.className = 'patch-group-name';
        name.value = g.name || '';
        name.setAttribute('aria-label', '分组名称');
        head.appendChild(name);
        const enable = document.createElement('label');
        enable.className = 'setting-check';
        const enableBox = document.createElement('input');
        enableBox.type = 'checkbox';
        enableBox.className = 'patch-group-enabled';
        enableBox.checked = groupEnabled;
        enable.appendChild(enableBox);
        enable.appendChild(document.createTextNode('启用'));
        head.appendChild(enable);
        const actions = document.createElement('div');
        actions.className = 'card-head-actions';
        actions.innerHTML = '<button type="button" class="btn-small" data-act="add-entry">添加条目</button>' +
            '<button type="button" class="btn-small danger" data-act="delete-group">删除分组</button>';
        head.appendChild(actions);
        card.appendChild(head);

        const body = document.createElement('div');
        body.className = 'card-body';
        const entries = Array.isArray(g.entries) ? g.entries : [];
        if (entries.length === 0) {
            body.innerHTML = '<div class="item-list-empty">这个分组还没有条目。</div>';
        } else {
            const list = document.createElement('div');
            list.className = 'cards';
            list.style.marginTop = '0';
            entries.forEach((e, i) => list.appendChild(this._buildPatchEntry(g, e, i)));
            body.appendChild(list);
        }
        card.appendChild(body);
        return card;
    },

    _buildPatchEntry(g, e, i) {
        const card = document.createElement('div');
        card.className = 'card' + (e.collapsed === true ? ' is-collapsed' : '') + (e.enabled !== false ? '' : ' is-off');
        card.dataset.gid = g.id;
        card.dataset.eid = e.id || '';

        const head = document.createElement('div');
        head.className = 'card-head';
        head.appendChild(this._chevButton(e.collapsed === true, '展开或收起条目'));
        const name = document.createElement('input');
        name.type = 'text';
        name.className = 'patch-entry-name';
        name.value = e.name || e.comment || e.id || `条目${i + 1}`;
        name.setAttribute('aria-label', '条目名称');
        head.appendChild(name);
        const enable = document.createElement('label');
        enable.className = 'setting-check';
        const enableBox = document.createElement('input');
        enableBox.type = 'checkbox';
        enableBox.className = 'patch-entry-enabled';
        enableBox.checked = e.enabled !== false;
        enable.appendChild(enableBox);
        enable.appendChild(document.createTextNode('启用'));
        head.appendChild(enable);
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn-small danger';
        del.dataset.act = 'delete-entry';
        del.textContent = '删除';
        head.appendChild(del);
        card.appendChild(head);

        const body = document.createElement('div');
        body.className = 'card-body';
        const constant = e.constant === true;
        const depth = e.injection_depth != null ? Number(e.injection_depth) : 4;
        const order = e.injection_order != null ? Number(e.injection_order) : 100;
        body.innerHTML =
            '<div class="field"><label>注入方式</label>' +
            '<select class="patch-entry-constant"><option value="constant">常驻</option><option value="normal">出现关键词时</option></select></div>' +
            '<div class="field"><label>关键词</label><div class="patch-entry-keywords"></div></div>' +
            '<div class="field-row" style="margin-bottom: 12px;">' +
            '<div class="field"><label>深度</label><input type="number" class="patch-entry-depth" min="0" max="10" step="1"></div>' +
            '<div class="field"><label>顺序</label><input type="number" class="patch-entry-order" min="0" max="100000" step="1"></div></div>' +
            '<div class="field"><label>内容</label><textarea class="patch-entry-content" rows="4"></textarea></div>';
        body.querySelector('.patch-entry-constant').value = constant ? 'constant' : 'normal';
        body.querySelector('.patch-entry-depth').value = isNaN(depth) ? 4 : depth;
        body.querySelector('.patch-entry-order').value = isNaN(order) ? 100 : order;
        body.querySelector('.patch-entry-content').value = e.content || '';
        const kwHost = body.querySelector('.patch-entry-keywords');
        const tags = TagList.create({
            values: String(e.keywords != null ? e.keywords : '').split(/[,，]/).map(s => s.trim()).filter(Boolean),
            placeholder: '输入关键词后按回车添加',
            onChange: (values) => {
                const groups = this._patchGroups();
                const found = this._patchEntry(groups, g.id, e.id);
                if (found.e) { found.e.keywords = values.join(', '); this._savePatchGroups(groups); }
            }
        });
        kwHost.appendChild(tags.el);
        kwHost.__tags = tags;
        const kwInput = tags.el.querySelector('input');
        const kwButton = tags.el.querySelector('button.btn-small');
        const syncKw = () => { kwInput.disabled = constant; kwButton.disabled = constant; };
        syncKw();
        card.appendChild(body);
        return card;
    },

    /** 补丁分组区的事件统一在容器上处理，只绑定一次 */
    _bindPatchGroupEvents() {
        const container = document.getElementById('patches-imported-groups');
        if (!container || container.__patchBound) return;
        container.__patchBound = true;

        container.addEventListener('click', (ev) => {
            const btn = ev.target.closest('[data-act]');
            if (!btn || !container.contains(btn)) return;
            const card = btn.closest('.card');
            const gid = card.dataset.gid;
            const isEntry = card.dataset.eid !== undefined;
            const act = btn.dataset.act;
            const groups = this._patchGroups();
            const g = groups.find(x => x.id === gid);
            if (!g) return;
            const entry = isEntry ? (g.entries || []).find(x => String(x.id || '') === card.dataset.eid) : null;

            if (act === 'toggle') {
                const target = isEntry ? entry : g;
                if (!target) return;
                target.collapsed = !(target.collapsed === true);
                card.classList.toggle('is-collapsed', target.collapsed);
                btn.setAttribute('aria-expanded', target.collapsed ? 'false' : 'true');
                btn.querySelector('.chev').classList.toggle('is-right', target.collapsed);
                this._savePatchGroups(groups);
            } else if (act === 'add-entry') {
                this.patchesAddEntry(gid);
            } else if (act === 'delete-group') {
                const index = groups.indexOf(g);
                groups.splice(index, 1);
                this._savePatchGroups(groups);
                this.renderPatchesAllGroups();
                Toast.undo('已删除分组。', () => {
                    const cur = this._patchGroups();
                    cur.splice(Math.min(index, cur.length), 0, g);
                    this._savePatchGroups(cur);
                    this.renderPatchesAllGroups();
                });
            } else if (act === 'delete-entry' && entry) {
                const index = g.entries.indexOf(entry);
                g.entries.splice(index, 1);
                this._savePatchGroups(groups);
                this.renderPatchesAllGroups();
                Toast.undo('已删除条目。', () => {
                    const cur = this._patchGroups();
                    const tg = cur.find(x => x.id === gid);
                    if (!tg) return;
                    if (!Array.isArray(tg.entries)) tg.entries = [];
                    tg.entries.splice(Math.min(index, tg.entries.length), 0, entry);
                    this._savePatchGroups(cur);
                    this.renderPatchesAllGroups();
                });
            }
        });

        container.addEventListener('change', (ev) => {
            const el = ev.target;
            const card = el.closest('.card');
            if (!card) return;
            const groups = this._patchGroups();
            const g = groups.find(x => x.id === card.dataset.gid);
            if (!g) return;
            const isEntry = card.dataset.eid !== undefined;
            const entry = isEntry ? (g.entries || []).find(x => String(x.id || '') === card.dataset.eid) : null;

            if (!isEntry) {
                if (el.classList.contains('patch-group-name')) {
                    g.name = el.value.trim() || g.name;
                    el.value = g.name;
                } else if (el.classList.contains('patch-group-enabled')) {
                    g.groupEnabled = el.checked;
                    card.classList.toggle('is-off', !el.checked);
                } else return;
            } else if (entry) {
                if (el.classList.contains('patch-entry-name')) {
                    entry.name = el.value.trim() || entry.name;
                    el.value = entry.name;
                } else if (el.classList.contains('patch-entry-enabled')) {
                    entry.enabled = el.checked;
                    card.classList.toggle('is-off', !el.checked);
                } else if (el.classList.contains('patch-entry-constant')) {
                    entry.constant = el.value === 'constant';
                    const tagInput = card.querySelector('.patch-entry-keywords input');
                    const tagBtn = card.querySelector('.patch-entry-keywords button.btn-small');
                    if (tagInput) tagInput.disabled = entry.constant;
                    if (tagBtn) tagBtn.disabled = entry.constant;
                } else if (el.classList.contains('patch-entry-depth')) {
                    entry.injection_depth = Number(el.value);
                } else if (el.classList.contains('patch-entry-order')) {
                    entry.injection_order = Number(el.value);
                } else return;
            } else return;
            this._savePatchGroups(groups);
        });

        container.addEventListener('input', (ev) => {
            const el = ev.target;
            if (!el.classList.contains('patch-entry-content')) return;
            const card = el.closest('.card');
            const groups = this._patchGroups();
            const found = this._patchEntry(groups, card.dataset.gid, card.dataset.eid);
            if (found.e) { found.e.content = el.value; this._savePatchGroups(groups); }
        });
    },

    async patchesNewGroup() {
        const name = await Modal.prompt('新建分组', '分组名称');
        if (name == null || !String(name).trim()) return;
        const groups = this._patchGroups();
        groups.push({ id: `pg_${Date.now()}`, name: String(name).trim(), source: 'manual', groupEnabled: true, entries: [] });
        this._savePatchGroups(groups);
        this.renderPatchesAllGroups();
        Toast.show('已新建分组。', 'success');
    },

    /** 在指定分组内添加一条空条目（含常驻/关键词/深度/顺序） */
    patchesAddEntry(gid) {
        const groups = this._patchGroups();
        const g = groups.find(x => x.id === gid);
        if (!g) return;
        if (!g.entries) g.entries = [];
        g.entries.push({
            id: `e_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: '新条目',
            content: '',
            enabled: true,
            constant: false,
            keywords: '',
            injection_depth: 4,
            injection_order: 100,
            collapsed: false
        });
        g.collapsed = false;
        this._savePatchGroups(groups);
        this.renderPatchesAllGroups();
        Toast.show('已添加条目。', 'success');
    },

    patchesImportWorldbook(file) {
        const reader = new FileReader();
        reader.onerror = () => Toast.show('这个文件读取不出来。', 'error');
        reader.onload = (e) => {
            let data;
            try {
                data = JSON.parse(e.target.result);
            } catch (err) {
                Toast.show('世界书文件格式错误，无法导入。', 'error');
                return;
            }
            const rawEntries = data.entries != null ? (Array.isArray(data.entries) ? data.entries : Object.values(data.entries)) : [];
            const list = rawEntries.map((entry, i) => {
                const content = String(entry.content || entry.value || '').trim();
                if (!content) return null;
                const constant = entry.constant === true || entry.alwaysActive === true;
                const depth = entry.extensions?.depth ?? entry.depth ?? 4;
                const order = entry.insertion_order ?? entry.order ?? 100;
                const enabled = entry.disable !== true && entry.enabled !== false;
                const keys = entry.keys ?? entry.key ?? [];
                const keywords = Array.isArray(keys) ? keys.join(', ') : (typeof keys === 'string' ? keys : '');
                return {
                    id: entry.uid != null ? String(entry.uid) : `e_${Date.now()}_${i}`,
                    name: entry.comment || entry.name || `条目${i + 1}`,
                    content,
                    enabled,
                    constant,
                    keywords: keywords || '',
                    injection_depth: typeof depth === 'number' ? depth : 4,
                    injection_order: typeof order === 'number' ? order : 100,
                    collapsed: true
                };
            }).filter(Boolean);
            const groups = this._patchGroups();
            const name = file.name ? file.name.replace(/\.json$/i, '') : '世界书';
            groups.push({ id: `pg_${Date.now()}`, name, source: 'worldbook', groupEnabled: true, collapsed: true, entries: list });
            this._savePatchGroups(groups);
            this.renderPatchesAllGroups();
            Toast.show(`已导入“${name}”，共 ${list.length} 条。`, 'success');
        };
        reader.readAsText(file, 'UTF-8');
    },

    // ===== 个人设定 =====
    loadPersonas() {
        PersonaManager.init();
        const select = document.getElementById('persona-select');
        if (!select) return;
        const personas = PersonaManager.getAll();
        select.textContent = '';
        const none = document.createElement('option');
        none.value = '';
        none.textContent = '不使用设定';
        select.appendChild(none);
        personas.forEach(p => {
            const option = document.createElement('option');
            option.value = p.id;
            option.textContent = p.name;
            select.appendChild(option);
        });

        if (PersonaManager.current) {
            select.value = PersonaManager.current.id;
            document.getElementById('input-persona-name').value = PersonaManager.current.name;
            document.getElementById('input-persona-content').value = PersonaManager.current.content;
        }
    },

    loadPersona(personaId) {
        if (!personaId) {
            document.getElementById('input-persona-name').value = '';
            document.getElementById('input-persona-content').value = '';
            PersonaManager.current = null;
            if (typeof DebugViewer !== 'undefined' && DebugViewer.refreshPrompt) DebugViewer.refreshPrompt();
            return;
        }
        PersonaManager.setCurrent(personaId);
        if (PersonaManager.current) {
            document.getElementById('input-persona-name').value = PersonaManager.current.name;
            document.getElementById('input-persona-content').value = PersonaManager.current.content;
        }
        if (typeof DebugViewer !== 'undefined' && DebugViewer.refreshPrompt) DebugViewer.refreshPrompt();
    },

    newPersona() {
        document.getElementById('persona-select').value = '';
        document.getElementById('input-persona-name').value = '';
        document.getElementById('input-persona-content').value = '';
        PersonaManager.current = null;
    },

    savePersona() {
        const name = document.getElementById('input-persona-name').value.trim();
        const content = document.getElementById('input-persona-content').value;
        if (!name) { Toast.show('请输入设定名称。', 'warning'); return; }

        if (PersonaManager.current) {
            PersonaManager.update(PersonaManager.current.id, { name, content });
        } else {
            const persona = PersonaManager.create({ name, content });
            PersonaManager.setCurrent(persona.id);
        }
        this.loadPersonas();
        if (typeof DebugViewer !== 'undefined' && DebugViewer.refreshPrompt) DebugViewer.refreshPrompt();
        Toast.show('已保存。', 'success');
    },

    async deletePersona() {
        if (!PersonaManager.current) {
            Toast.show('没有选中的设定。', 'warning');
            return;
        }

        const confirmed = await Modal.confirm('删除设定', `确定要删除设定“${App._escSave(PersonaManager.current.name)}”吗？`, { danger: true, confirmLabel: '删除' });
        if (!confirmed) return;

        const removed = Object.assign({}, PersonaManager.current);
        PersonaManager.delete(removed.id);
        this.loadPersonas();
        this.newPersona();
        if (typeof DebugViewer !== 'undefined' && DebugViewer.refreshPrompt) DebugViewer.refreshPrompt();
        Toast.undo('已删除设定。', () => {
            if (!PersonaManager.restore(removed)) {
                Toast.show('撤销失败，这个设定已经存在。', 'error');
                return;
            }
            PersonaManager.setCurrent(removed.id);
            this.loadPersonas();
            if (typeof DebugViewer !== 'undefined' && DebugViewer.refreshPrompt) DebugViewer.refreshPrompt();
        });
    },

    // ===== API配置 =====
    /** 读出界面上当前填的连接配置 */
    _readAPIForm() {
        const val = (id) => (document.getElementById(id)?.value || '').trim();
        return {
            provider: document.getElementById('api-provider-select')?.value || 'openai',
            endpoint: val('input-api-endpoint'),
            apiKey: val('input-api-key'),
            model: val('input-api-model-manual') || document.getElementById('api-model-select')?.value || '',
            relay: document.getElementById('api-relay-select')?.value === 'relay'
        };
    },

    /** 把连接配置写到界面上 */
    _writeAPIForm(cfg) {
        const providerId = cfg.provider || 'openai';
        const providerSelect = document.getElementById('api-provider-select');
        if (providerSelect) providerSelect.value = providerId;
        const endpointInput = document.getElementById('input-api-endpoint');
        if (endpointInput) endpointInput.value = cfg.endpoint || '';
        const keyInput = document.getElementById('input-api-key');
        if (keyInput) keyInput.value = cfg.apiKey || '';
        const manual = document.getElementById('input-api-model-manual');
        if (manual) manual.value = '';
        const relaySelect = document.getElementById('api-relay-select');
        if (relaySelect) relaySelect.value = cfg.relay ? 'relay' : 'direct';
        this.populateModelSelect(providerId, cfg.model);
        this.updateDefaultModelsHint(providerId);
        this._applyProviderFieldVisibility(providerId);
    },

    /** 保存当前界面上的配置：写入存储并立即生效 */
    _commitAPIForm() {
        const config = this._readAPIForm();
        const profiles = (Storage.getSettings() || {}).apiProfiles || {};
        profiles[config.provider] = { endpoint: config.endpoint, apiKey: config.apiKey, model: config.model, relay: config.relay };
        Storage.saveSettings({ apiProfiles: profiles });
        APIConnection.updateConfig(config);
        return config;
    },

    loadAPIConfig() {
        const config = Storage.getAPIConfig() || {};
        if (!document.getElementById('api-provider-select')) return;
        const providerId = config.provider || 'openai';
        const provider = APIConnection.providers[providerId];
        this._writeAPIForm({
            provider: providerId,
            endpoint: config.endpoint || (provider ? provider.defaultEndpoint : ''),
            apiKey: config.apiKey,
            model: config.model,
            relay: config.relay
        });
        this.loadAPIPresetList();
        this._refreshAPICapabilities();
    },

    /** 探测本机服务并更新界面：本机命令行和本机转发不可用时明确写出原因 */
    async _refreshAPICapabilities() {
        const caps = await APIConnection.probeCapabilities(true);
        const cliOption = document.querySelector('#api-provider-select option[value="claude_cli"]');
        if (cliOption) {
            cliOption.disabled = !caps.localCli;
            cliOption.textContent = caps.localCli ? '本机 Claude 命令行'
                : (caps.service ? '本机 Claude 命令行（本机没有找到）' : '本机 Claude 命令行（仅本机运行时可用）');
        }
        const relayOption = document.querySelector('#api-relay-select option[value="relay"]');
        if (relayOption) {
            relayOption.disabled = !caps.relay;
            relayOption.textContent = caps.relay ? '经本机转发' : '经本机转发（仅本机运行时可用）';
        }
        const relayHint = document.getElementById('api-relay-hint');
        if (relayHint) {
            relayHint.textContent = caps.relay
                ? '浏览器连不上服务商时，选「经本机转发」。'
                : '这里是在线版本，只能直连；连不上时请使用允许网页访问的服务或反向代理地址。';
        }
        const note = document.querySelector('#api-field-localcli-note .setting-hint');
        if (note) {
            note.textContent = caps.localCli
                ? '用本机已登录的 Claude 命令行生成，不需要填地址和密钥。'
                : (caps.service
                    ? '本机没有找到 Claude 命令行，请先安装并登录，或换一个服务商。'
                    : '本机 Claude 命令行只能在本机运行游戏时使用，请换一个服务商。');
        }
    },

    populateModelSelect(providerId, selectedModel) {
        const provider = APIConnection.providers[providerId];
        const modelSelect = document.getElementById('api-model-select');
        if (!modelSelect || !provider) return;

        modelSelect.innerHTML = '';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = '-- 选择模型 --';
        modelSelect.appendChild(placeholder);

        const names = (provider.defaultModels || []).slice();
        if (selectedModel && names.indexOf(selectedModel) < 0) names.push(selectedModel);
        for (const name of names) {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            if (name === selectedModel) option.selected = true;
            modelSelect.appendChild(option);
        }
    },

    /** 玩家切换了服务商：先记下旧服务商的填写，再换成新服务商各自记住的内容（密钥不会带到别家） */
    onProviderChange(providerId) {
        const previous = APIConnection.config.provider;
        if (previous && previous !== providerId) {
            const profiles = (Storage.getSettings() || {}).apiProfiles || {};
            const old = this._readAPIFormFor(previous);
            profiles[previous] = { endpoint: old.endpoint, apiKey: old.apiKey, model: old.model, relay: old.relay };
            Storage.saveSettings({ apiProfiles: profiles });
        }
        const provider = APIConnection.providers[providerId];
        const saved = ((Storage.getSettings() || {}).apiProfiles || {})[providerId] || {};
        this._writeAPIForm({
            provider: providerId,
            endpoint: saved.endpoint || (provider ? provider.defaultEndpoint : ''),
            apiKey: saved.apiKey || '',
            model: saved.model || '',
            relay: !!saved.relay
        });
        APIConnection.updateConfig(this._readAPIForm());
    },

    /** 切换服务商之前，界面上的内容属于旧服务商 */
    _readAPIFormFor(providerId) {
        return Object.assign(this._readAPIForm(), { provider: providerId });
    },

    /** 按 provider 显隐 API 字段：本机命令行不需要地址、密钥、模型、连接方式、测试连接，只留说明 */
    _applyProviderFieldVisibility(providerId) {
        const p = (typeof APIConnection !== 'undefined' && APIConnection.providers) ? APIConnection.providers[providerId] : null;
        const local = !!(p && p.isLocalCli);
        const set = (id, show) => { const el = document.getElementById(id); if (el) el.style.display = show ? '' : 'none'; };
        set('api-field-endpoint', !local);
        set('api-field-key', !local);
        set('api-field-model', !local);
        set('api-field-relay', !local);
        set('api-field-test', !local);
        set('api-field-localcli-note', local);
    },

    updateDefaultModelsHint(providerId) {
        const provider = APIConnection.providers[providerId];
        const hint = document.getElementById('default-models-hint');
        if (hint && provider && provider.defaultModels && provider.defaultModels.length > 0) {
            hint.textContent = `常用模型: ${provider.defaultModels.join(', ')}`;
        } else if (hint) {
            hint.textContent = '';
        }
    },

    loadAPIPresetList() {
        const select = document.getElementById('api-preset-select');
        if (!select) return;
        const presets = Storage.getAPIPresets() || [];
        select.innerHTML = '';
        const blank = document.createElement('option');
        blank.value = '';
        blank.textContent = '-- 新建配置 --';
        select.appendChild(blank);
        for (const p of presets) {
            const option = document.createElement('option');
            option.value = p.id;
            option.textContent = p.name;
            select.appendChild(option);
        }
    },

    loadAPIPreset(presetId) {
        if (!presetId) return;
        const presets = Storage.getAPIPresets() || [];
        const preset = presets.find(p => p.id === presetId);
        if (preset?.config) {
            this._writeAPIForm(preset.config);
            this._commitAPIForm();
        }
    },

    async saveAPIPreset() {
        const name = await Modal.prompt('保存API预设', '请输入预设名称：');
        if (!name || name.trim() === '') {
            return;
        }

        const config = this._readAPIForm();
        const presets = Storage.getAPIPresets() || [];

        // 检查是否已存在同名预设
        const existingIndex = presets.findIndex(p => p.name === name.trim());
        if (existingIndex >= 0) {
            const confirmed = await Modal.confirm('覆盖预设', `预设“${this._escSave(name.trim())}”已存在，是否覆盖？`);
            if (!confirmed) return;
            presets[existingIndex].config = config;
        } else {
            presets.push({
                id: Date.now().toString(),
                name: name.trim(),
                config
            });
        }

        if (!Storage.saveAPIPresets(presets)) {
            Toast.show('预设没有保存成功，请清理浏览器存储空间后重试。', 'error', 6000);
            return;
        }
        this.loadAPIPresetList();
        Toast.show('API预设已保存', 'success');
    },

    async deleteAPIPreset() {
        const presetId = document.getElementById('api-preset-select')?.value;
        if (!presetId) return;
        let presets = Storage.getAPIPresets() || [];
        const target = presets.find(p => p.id === presetId);
        if (!target) return;
        const confirmed = await Modal.confirm('删除配置', `确定删除配置“${this._escSave(target.name)}”吗？`, { danger: true, confirmLabel: '删除' });
        if (!confirmed) return;
        const index = presets.indexOf(target);
        presets = presets.filter(p => p.id !== presetId);
        if (!Storage.saveAPIPresets(presets)) {
            Toast.show('预设没有删除成功，请清理浏览器存储空间后重试。', 'error', 6000);
            return;
        }
        this.loadAPIPresetList();
        Toast.undo('已删除配置。', () => {
            const cur = Storage.getAPIPresets() || [];
            cur.splice(Math.min(index, cur.length), 0, target);
            if (!Storage.saveAPIPresets(cur)) {
                Toast.show('撤销失败，请清理浏览器存储空间后重试。', 'error', 6000);
                return;
            }
            this.loadAPIPresetList();
        });
    },

    async fetchModels() {
        const form = this._readAPIForm();
        const problem = APIConnection.checkConfigured(Object.assign({}, form, { model: form.model || '-' }));
        if (problem) {
            Toast.show(problem, 'warning', 6000);
            return;
        }

        Toast.show('正在读取模型列表...', 'info');
        this._commitAPIForm();
        try {
            const models = await APIConnection.fetchModels();
            const select = document.getElementById('api-model-select');
            if (select) {
                select.innerHTML = '';
                const placeholder = document.createElement('option');
                placeholder.value = '';
                placeholder.textContent = '-- 选择模型 --';
                select.appendChild(placeholder);
                for (const m of models) {
                    const option = document.createElement('option');
                    option.value = m.id;
                    option.textContent = m.id;
                    if (m.id === form.model) option.selected = true;
                    select.appendChild(option);
                }
            }
            Toast.show(`找到 ${models.length} 个模型，请选择一个。`, 'success');
        } catch (error) {
            // 读取失败：保留当前选项和常用模型，玩家仍然可以手动选或手动填写
            Toast.show('读取模型失败：' + error.message, 'error', 8000);
        }
    },

    async testAPIConnection() {
        const statusEl = document.getElementById('api-test-status');
        const setStatus = (text, color) => {
            if (!statusEl) return;
            statusEl.textContent = text;
            statusEl.style.color = color;
        };

        const form = this._readAPIForm();
        const problem = APIConnection.checkConfigured(form);
        if (problem) {
            setStatus(problem, 'var(--color-danger)');
            return;
        }

        setStatus('测试中...', 'var(--color-text-secondary)');
        this._commitAPIForm();

        const result = await APIConnection.testConnection();
        if (result.success) {
            setStatus('连接成功', 'var(--color-success)');
        } else {
            setStatus('连接失败：' + result.error, 'var(--color-danger)');
        }
    },

    /** 用户看到的：空消息时展示为「场外」自动推进 */
    get AUTO_ADVANCE_TEXT() {
        return '要求自动推进';
    },
    /** 发给 API 的：剧情+场外都空时不再塞指令文案，用中性占位避免 prompt 里一直出现「要求自动推进」 */
    get PROMPT_EMPTY_USER_PLACEHOLDER() {
        return '(继续)';
    },

    /** 场外指导要求：包在 &lt;user_meta&gt; 里，可后续改为设置项 */
    get META_INSTRUCTION() {
        return '请将以下场外要求自然融入回应，不要生硬复读。';
    },
    /** prompt 制造机：在每条 &lt;user_meta&gt; 块前插入，说明 user 消息与指令 block 的关系 */
    get META_BLOCK_GUIDANCE() {
        return '以下若出现 <user_meta> 块，则为该条用户场外指令；紧接的 user 消息为剧情扮演。请按场外要求自然融入回应。';
    }
});
