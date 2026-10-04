/**
 * 通用「交互+存档」插件驱动 (InteractiveSaveDriver)
 * 实际聊天记录、联系人等全部存在存档里；本驱动只负责展示与输入→prompt、输出→展示。
 * 配置与内容全部来自故事模块（module/<故事id>/plugins/<pluginId>.json），系统不包含游戏内容。
 */

const _minimalApps = [
    { id: 'sms', name: '短信', phoneTypes: ['feature', 'smart'] },
    { id: 'phone', name: '电话', phoneTypes: ['feature', 'smart'] }
];

const InteractiveSaveDriver = {
    currentPluginId: null,
    pluginConfig: null,
    phoneType: 'feature',
    phoneTypeOverride: null,
    _testSaveId: null,
    apps: new Map(),
    pendingMessages: [],
    pendingCalls: [],
    contacts: new Map(),
    callHistory: [],
    unreadCount: 0,
    currentApp: null,
    currentChat: null,
    inCall: false,
    currentCallContact: null,
    currentContainer: null,

    getPluginConfig() {
        return this.pluginConfig || {};
    },

    getStorageKey(pluginId) {
        const id = pluginId || this.currentPluginId || 'phone';
        const prefix = CONFIG?.STORAGE_KEYS?.PLUGIN_DATA || 'bulimia_plugin_data';
        const moduleId = window.ModuleManager?.currentModule?.id || 'default';
        const saveId = this._testSaveId || (typeof State !== 'undefined' && State.currentSaveId) ? State.currentSaveId : 'default';
        return `${prefix}_${id}_${moduleId}_${saveId}`;
    },

    hasSignal() {
        const state = typeof State !== 'undefined' ? State.gameState : {};
        const cfg = this.getPluginConfig();
        const phases = cfg.noSignalPhases;
        if (Array.isArray(phases) && state.majorPhase != null && phases.includes(state.majorPhase)) return false;
        return true;
    },

    _appRenderers: {
        sms: function () { return InteractiveSaveDriver.renderSMSApp(); },
        phone: function () { return InteractiveSaveDriver.renderPhoneApp(); }
    },

    loadFromStorage(pluginId) {
        const key = this.getStorageKey(pluginId);
        if (typeof Storage === 'undefined') return;
        const raw = Storage.getLocal(key);
        if (!raw) return;
        try {
            if (Array.isArray(raw.contacts)) {
                this.contacts.clear();
                raw.contacts.forEach(([id, obj]) => this.contacts.set(id, { ...obj, messages: obj.messages || [] }));
            }
            if (Array.isArray(raw.callHistory)) this.callHistory = raw.callHistory;
            if (Array.isArray(raw.pendingMessages)) this.pendingMessages = raw.pendingMessages;
            if (Array.isArray(raw.pendingCalls)) this.pendingCalls = raw.pendingCalls;
        } catch (e) { console.warn('Plugin loadFromStorage failed', e); }
    },

    saveToStorage(pluginId) {
        const id = pluginId || this.currentPluginId;
        if (!id) return;
        const key = this.getStorageKey(id);
        if (typeof Storage === 'undefined') return;
        const contactsArr = Array.from(this.contacts.entries());
        Storage.setLocal(key, { contacts: contactsArr, callHistory: this.callHistory || [], pendingMessages: this.pendingMessages || [], pendingCalls: this.pendingCalls || [] });
    },

    init(pluginId, config) {
        this.currentPluginId = pluginId;
        this.pluginConfig = config || {};
        this.applyAppsFromConfig(this.pluginConfig);
        this.loadFromStorage(pluginId);
        const defaults = (this.pluginConfig.defaultContacts || []);
        if (this.contacts.size === 0 && defaults.length) {
            defaults.forEach(c => this.addContact(c));
            this.saveToStorage(pluginId);
        }
    },

    applyAppsFromConfig(config) {
        this.apps.clear();
        const list = (config && config.apps && config.apps.length) ? config.apps : _minimalApps;
        const self = this;
        list.forEach(app => {
            const render = this._appRenderers[app.id];
            self.apps.set(app.id, { ...app, render: render || (() => '<div class="empty-message">这个应用没有内容</div>') });
        });
    },

    /**
     * 渲染插件：由 PluginRegistry 调用，内容与参数来自故事 config；testParams 仅调试用（如 phoneType、saveId）
     * 若 config.interactorDisplay.listFromVar 存在，则列表从 State.variables[listFromVar] 读取（通用交互器模式）。
     */
    render(pluginId, config, container, testParams) {
        this.currentPluginId = pluginId;
        this.pluginConfig = config || {};
        this.currentContainer = container;
        this.phoneTypeOverride = testParams && testParams.phoneType ? testParams.phoneType : null;
        this._testSaveId = testParams && testParams.saveId ? testParams.saveId : null;
        const disp = config?.interactorDisplay;
        if (disp && disp.listFromVar && container) {
            this._renderListFromVar(container);
            this._testSaveId = null;
            return;
        }
        if (this.apps.size === 0) this.applyAppsFromConfig(this.pluginConfig);
        this.loadFromStorage(pluginId);
        const defaults = (this.pluginConfig.defaultContacts || []);
        if (this.contacts.size === 0 && defaults.length) {
            defaults.forEach(c => this.addContact(c));
            this.saveToStorage(pluginId);
        }
        this.renderHomeScreen();
        this._testSaveId = null;
    },

    _getChatStorageKey(contactId) {
        const base = this.getStorageKey(this.currentPluginId);
        const safe = String(contactId || '').replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '_');
        return base + '_chat_' + (safe || 'unknown');
    },

    _loadChatMessages(contactId) {
        if (typeof Storage === 'undefined') return [];
        const raw = Storage.getLocal(this._getChatStorageKey(contactId));
        return Array.isArray(raw) ? raw : (raw && Array.isArray(raw.messages) ? raw.messages : []);
    },

    _saveChatMessages(contactId, messages) {
        if (typeof Storage === 'undefined' || !contactId) return;
        Storage.setLocal(this._getChatStorageKey(contactId), Array.isArray(messages) ? messages : []);
    },

    _renderListFromVar(container) {
        const cfg = this.pluginConfig || {};
        const disp = cfg.interactorDisplay || {};
        const listVar = disp.listFromVar;
        const titleField = disp.titleField || 'name';
        const subtitleField = disp.subtitleField || 'personality';
        const lastMessageKey = disp.lastMessageKey || 'lastReply';
        const favorField = disp.favorField || 'favor';
        const vars = (typeof State !== 'undefined' && State.variables) ? State.variables : {};
        const list = Array.isArray(vars[listVar]) ? vars[listVar] : [];
        const label = cfg.label || this.currentPluginId || '列表';

        let html = '<div class="plugin-interactor-list-from-var">';
        html += '<div class="plugin-interactor-header">' + (label.replace(/</g, '&lt;')) + '</div>';
        html += '<div class="plugin-interactor-list">';
        if (list.length === 0) {
            html += '<div class="plugin-item plugin-interactor-empty">暂无条目（变量 ' + (listVar || '').replace(/</g, '&lt;') + ' 为空）</div>';
        } else {
            list.forEach((item, idx) => {
                const id = (item && item[titleField]) != null ? String(item[titleField]) : 'item_' + idx;
                const title = (item && item[titleField]) != null ? String(item[titleField]) : '—';
                const subtitle = (item && item[subtitleField]) != null ? String(item[subtitleField]) : '';
                const lastMsg = (item && item[lastMessageKey]) != null ? String(item[lastMessageKey]) : '';
                const favor = (item && item[favorField]) != null ? item[favorField] : '';
                const favorStr = favor !== '' ? ' 好感 ' + favor : '';
                html += '<div class="plugin-interactor-item" data-contact-id="' + id.replace(/"/g, '&quot;') + '" data-index="' + idx + '">';
                html += '<span class="plugin-interactor-title">' + title.replace(/</g, '&lt;') + '</span>';
                html += '<span class="plugin-interactor-subtitle">' + (subtitle || lastMsg || '—').replace(/</g, '&lt;').slice(0, 40) + (favorStr ? ' · ' + favorStr : '') + '</span>';
                html += '</div>';
            });
        }
        html += '</div>';
        html += '<div class="plugin-interactor-chat-area hidden" id="' + this.currentPluginId + '-chat-area">';
        html += '<div class="plugin-interactor-chat-nav"><button type="button" class="plugin-interactor-back">← 返回</button><span class="plugin-interactor-chat-title"></span></div>';
        html += '<div class="plugin-interactor-chat-messages"></div>';
        html += '<div class="plugin-interactor-chat-input"><input type="text" placeholder="输入消息（将加入暂存）" maxlength="' + (cfg.maxReplyLength || 200) + '"><button type="button" class="plugin-interactor-send">发送</button></div>';
        html += '</div>';
        html += '</div>';
        container.innerHTML = html;

        container.querySelectorAll('.plugin-interactor-item').forEach((el) => {
            el.addEventListener('click', () => {
                const id = el.getAttribute('data-contact-id');
                const idx = parseInt(el.getAttribute('data-index'), 10);
                const item = list[idx];
                if (!id) return;
                container.querySelector('.plugin-interactor-list').classList.add('hidden');
                const area = container.querySelector('.plugin-interactor-chat-area');
                if (area) {
                    area.classList.remove('hidden');
                    area.querySelector('.plugin-interactor-chat-title').textContent = (item && item[titleField]) || id;
                    const msgsEl = area.querySelector('.plugin-interactor-chat-messages');
                    const messages = this._loadChatMessages(id);
                    msgsEl.innerHTML = messages.length === 0
                        ? '<div class="plugin-item">暂无记录</div>'
                        : messages.map((m) => '<div class="plugin-interactor-msg ' + (m.from === 'user' ? 'sent' : 'received') + '">' + (m.content || '').replace(/</g, '&lt;') + '</div>').join('');
                    const input = area.querySelector('input');
                    const sendBtn = area.querySelector('.plugin-interactor-send');
                    if (sendBtn) sendBtn.onclick = () => {
                        const text = (input && input.value || '').trim();
                        if (!text) return;
                        messages.push({ from: 'user', content: text, time: Date.now() });
                        // 2026-06-05：cap 500 防 plugin-interactor 长期对话累积撑爆 localStorage（同 [[iframe-postmessage-dos-cap-2026-06-05]] 累积 cap pattern）
                        while (messages.length > 500) messages.shift();
                        this._saveChatMessages(id, messages);
                        if (input) input.value = '';
                        msgsEl.innerHTML = messages.map((m) => '<div class="plugin-interactor-msg ' + (m.from === 'user' ? 'sent' : 'received') + '">' + (m.content || '').replace(/</g, '&lt;') + '</div>').join('');
                        msgsEl.scrollTop = msgsEl.scrollHeight;
                        if (window.Events && window.EVENT_TYPES && cfg.replyTag) {
                            const payload = { pluginId: this.currentPluginId, contactId: id, content: text, format: cfg.replyFormat || '角色名：消息' };
                            Events.emit(EVENT_TYPES.PHONE_PENDING_CHANGED, { count: (window.InteractiveSaveDriver && InteractiveSaveDriver.getTotalPendingCount ? InteractiveSaveDriver.getTotalPendingCount() : 0) + 1 });
                        }
                    };
                }
            });
        });
        container.querySelector('.plugin-interactor-back')?.addEventListener('click', () => {
            container.querySelector('.plugin-interactor-list').classList.remove('hidden');
            container.querySelector('.plugin-interactor-chat-area').classList.add('hidden');
        });
    },

    renderInContainer(container) {
        if (this.currentPluginId && this.pluginConfig) {
            this.currentContainer = container;
            this.renderHomeScreen();
        }
    },
    
    /**
     * 注册应用
     * @param {Object} app - 应用配置
     */
    registerApp(app) {
        this.apps.set(app.id, app);
    },
    
    /**
     * 切换手机类型
     * @param {string} type - 'feature' | 'smart'
     */
    switchPhoneType(type) {
        this.phoneType = type;
        this.renderHomeScreen();
    },
    
    autoDetectPhoneType() {
        if (this.phoneTypeOverride) return this.phoneTypeOverride;
        const state = typeof State !== 'undefined' ? State.gameState : {};
        const phase = state.majorPhase;
        const cfg = this.getPluginConfig();
        const rule = cfg.phoneTypeRule || {};
        if (phase != null && rule[phase]) return rule[phase];
        return rule.default || 'feature';
    },
    
    /**
     * 渲染主屏幕
     */
    renderHomeScreen() {
        const screen = this.currentContainer || document.getElementById('phone-content');
        if (!screen) return;
        
        // 自动检测手机类型
        this.phoneType = this.autoDetectPhoneType();
        
        const date = State.gameState?.currentDate || { hour: 12, minute: 0, month: 1, day: 1 };
        const timeStr = `${String(date.hour).padStart(2, '0')}:${String(date.minute).padStart(2, '0')}`;
        const dateStr = `${date.month}月${date.day}日`;
        const phoneLabel = '' + (this.phoneType === 'feature' ? 'feature' : 'smart');
        
        let html = '';
        
        // 手机框架
        html += `<div class="phone-frame ${this.phoneType}">`;
        
        const noSignal = !this.hasSignal();
        const cfg = this.getPluginConfig();
        const canViewHistory = noSignal && (cfg.canViewHistoryWhenNoSignal !== false);
        // 状态栏
        html += `
            <div class="phone-status-bar">
                <span>${timeStr}</span>
                <span class="phone-type-label">${phoneLabel}</span>
                <span>${noSignal ? '无信号' : ''}</span>
            </div>
        `;
        if (noSignal && canViewHistory) {
            html += `<div class="phone-no-signal-hint" style="padding:4px 8px;font-size:12px;color:var(--color-text-muted);">无信号，仅可查看聊天记录</div>`;
        }
        
        // 主屏幕
        html += `<div class="phone-screen-content">`;
        
        if (this.phoneType === 'feature') {
            html += `
                <div class="phone-home feature">
                    <div class="phone-time-display large">
                        <div class="time">${timeStr}</div>
                        <div class="date">${dateStr}</div>
                    </div>
            `;
            
            // 新消息提示
            if (this.unreadCount > 0) {
                html += `
                    <div class="phone-notification" onclick="PhoneManager.openApp('sms')">
                        <span class="phone-notification-badge">${this.unreadCount}</span>
                        收到${this.unreadCount}条新消息
                    </div>
                `;
            }
            
            html += `
                <div class="phone-apps-grid feature">
                    <div class="phone-app-icon large" onclick="PhoneManager.openApp('phone')">
                        <div class="icon">话</div>
                        <span class="label">电话</span>
                    </div>
                    <div class="phone-app-icon large" onclick="PhoneManager.openApp('sms')">
                        <div class="icon">信</div>
                        <span class="label">短信</span>
                        ${this.unreadCount > 0 ? `<span class="badge">${this.unreadCount}</span>` : ''}
                    </div>
                </div>
            `;
            
            html += `</div>`;
        } else {
            html += `
                <div class="phone-home smart">
                    <div class="phone-time-display">
                        <div class="time">${timeStr}</div>
                        <div class="date">${dateStr}</div>
                    </div>
                    <div class="phone-apps-grid smart">
            `;
            
            // 显示适用于当前手机类型的应用
            for (const [id, app] of this.apps) {
                if (app.phoneTypes.includes(this.phoneType)) {
                    const hasBadge = (id === 'sms' && this.unreadCount > 0);
                    html += `
                        <div class="phone-app-icon" onclick="PhoneManager.openApp('${id}')">
                            <div class="icon">${app.icon || String(app.name || app.id).charAt(0)}</div>
                            <span class="label">${app.name}</span>
                            ${hasBadge ? `<span class="badge">${this.unreadCount}</span>` : ''}
                        </div>
                    `;
                }
            }
            
            html += `
                    </div>
                </div>
            `;
        }
        
        html += `</div>`; // phone-screen-content
        
        // 暂存指示器
        const pendingTotal = this.pendingMessages.length + this.pendingCalls.length;
        if (pendingTotal > 0) {
            html += `
                <div class="phone-pending-indicator">
                    有${pendingTotal}项操作待处理
                </div>
            `;
        }
        
        html += `</div>`; // phone-frame
        
        screen.innerHTML = html;
    },
    
    /**
     * 打开应用
     * @param {string} appId - 应用ID
     */
    openApp(appId) {
        const app = this.apps.get(appId);
        if (app && app.render) {
            this.currentApp = appId;
            const screen = this.currentContainer || document.getElementById('phone-screen');
            if (screen) {
                screen.innerHTML = app.render();
            }
        }
    },
    
    /**
     * 返回主屏幕
     */
    goHome() {
        this.currentApp = null;
        this.currentChat = null;
        this.renderHomeScreen();
    },
    
    /**
     * 渲染短信应用
     */
    renderSMSApp() {
        let html = `
            <div class="phone-nav">
                <button class="phone-back-btn" onclick="PhoneManager.goHome()">←</button>
                <span class="phone-title">短信</span>
            </div>
            <div class="sms-list">
        `;
        
        // 显示联系人列表
        for (const [id, contact] of this.contacts) {
            const lastMsg = contact.messages?.[contact.messages.length - 1];
            html += `
                <div class="sms-item" onclick="PhoneManager.openChat('${id}')">
                    <div class="sms-avatar">${contact.name.charAt(0)}</div>
                    <div class="sms-content">
                        <div class="sms-name">${contact.name}</div>
                        <div class="sms-preview">${lastMsg?.content || '暂无消息'}</div>
                    </div>
                    <div class="sms-time">${lastMsg?.time || ''}</div>
                </div>
            `;
        }
        
        if (this.contacts.size === 0) {
            html += `<div style="padding: 20px; text-align: center; color: var(--color-text-muted);">暂无联系人</div>`;
        }
        
        html += `</div>`;
        
        return html;
    },
    
    /**
     * 渲染电话应用
     */
    renderPhoneApp() {
        let html = `
            <div class="phone-nav">
                <button class="phone-back-btn" onclick="PhoneManager.goHome()">←</button>
                <span class="phone-title">电话</span>
            </div>
            <div class="phone-app-content">
                <div class="phone-tabs">
                    <button class="phone-tab active" onclick="PhoneManager.showPhoneTab('contacts')">联系人</button>
                    <button class="phone-tab" onclick="PhoneManager.showPhoneTab('history')">通话记录</button>
                </div>
                <div class="phone-tab-content" id="phone-contacts-tab">
                    <div class="contact-list">
        `;
        
        // 显示联系人列表
        for (const [id, contact] of this.contacts) {
            html += `
                <div class="contact-item" onclick="PhoneManager.showCallDialog('${id}')">
                    <div class="contact-avatar">${contact.name.charAt(0)}</div>
                    <div class="contact-info">
                        <div class="contact-name">${contact.name}</div>
                        <div class="contact-relation">${contact.relation || ''}</div>
                    </div>
                    <button class="call-btn" onclick="event.stopPropagation(); PhoneManager.initiateCall('${id}')">拨打</button>
                </div>
            `;
        }
        
        if (this.contacts.size === 0) {
            html += `<div class="empty-message">暂无联系人</div>`;
        }
        
        html += `
                    </div>
                </div>
                <div class="phone-tab-content hidden" id="phone-history-tab">
                    <div class="call-history-list">
        `;
        
        // 显示通话记录
        if (this.callHistory.length === 0) {
            html += `<div class="empty-message">暂无通话记录</div>`;
        } else {
            for (const call of this.callHistory.slice().reverse()) {
                const contact = this.contacts.get(call.contactId);
                const icon = call.type === 'outgoing' ? '拨出' : (call.type === 'incoming' ? '来电' : '未接');
                html += `
                    <div class="call-history-item">
                        <span class="call-icon">${icon}</span>
                        <div class="call-info">
                            <div class="call-name">${contact?.name || call.contactId}</div>
                            <div class="call-time">${new Date(call.timestamp).toLocaleString()}</div>
                        </div>
                    </div>
                `;
            }
        }
        
        html += `
                    </div>
                </div>
            </div>
        `;
        
        return html;
    },
    
    /**
     * 切换电话应用选项卡
     */
    showPhoneTab(tabName) {
        const screen = this.currentContainer || document.getElementById('phone-content');
        if (!screen) return;
        
        // 更新选项卡按钮
        screen.querySelectorAll('.phone-tab').forEach(tab => {
            tab.classList.toggle('active', tab.textContent.includes(tabName === 'contacts' ? '联系人' : '通话记录'));
        });
        
        // 显示对应内容
        const contactsTab = screen.querySelector('#phone-contacts-tab');
        const historyTab = screen.querySelector('#phone-history-tab');
        
        if (contactsTab) contactsTab.classList.toggle('hidden', tabName !== 'contacts');
        if (historyTab) historyTab.classList.toggle('hidden', tabName !== 'history');
    },
    
    /**
     * 显示拨号确认对话框
     */
    showCallDialog(contactId) {
        const contact = this.contacts.get(contactId);
        if (!contact) return;
        if (!this.hasSignal()) {
            if (window.Toast) Toast.show('无信号，无法拨打电话', 'warning');
            return;
        }
        if (window.Modal) Modal.confirm('拨打电话', `确定要给 ${contact.name} 打电话吗？\n\n（通话内容将在下次AI回复时处理）`).then(confirmed => {
            if (confirmed) {
                this.initiateCall(contactId);
            }
        });
    },
    
    /**
     * 发起通话（暂存）
     */
    initiateCall(contactId) {
        if (!this.hasSignal()) {
            if (window.Toast) Toast.show('无信号，无法拨打电话', 'warning');
            return;
        }
        const contact = this.contacts.get(contactId);
        if (!contact) return;

        // 2026-06-05：cap 防累积撑爆 localStorage
        const MAX_PHONE_CALL_HISTORY = 500;
        const MAX_PENDING_CALLS = 100;

        // 添加到暂存
        this.pendingCalls.push({
            contactId,
            type: 'outgoing',
            timestamp: Date.now()
        });
        while (this.pendingCalls.length > MAX_PENDING_CALLS) this.pendingCalls.shift();

        // 添加到通话记录
        this.callHistory.push({
            contactId,
            type: 'outgoing',
            timestamp: Date.now(),
            pending: true
        });
        while (this.callHistory.length > MAX_PHONE_CALL_HISTORY) this.callHistory.shift();
        
        if (window.Toast) Toast.show(`已添加拨打 ${contact.name} 的电话到暂存`, 'success');
        this.saveToStorage();
        if (window.Events && window.EVENT_TYPES) Events.emit(EVENT_TYPES.PHONE_PENDING_CHANGED, { count: this.getTotalPendingCount() });
        this.renderHomeScreen();
    },
    
    /**
     * 接听来电（从AI响应触发）
     */
    receiveCall(contactId, callerName) {
        // 添加到通话记录
        this.callHistory.push({
            contactId,
            type: 'incoming',
            timestamp: Date.now(),
            callerName
        });
        // 2026-06-05：同 initiateCall，cap 500 防累积
        while (this.callHistory.length > 500) this.callHistory.shift();
        
        // 显示来电通知
        Toast.show(`来电：${callerName || contactId}`, 'info');
        
        Events.emit(EVENT_TYPES.PHONE_CALL_RECEIVED, {
            contactId,
            callerName
        });
    },
    
    /**
     * 打开聊天界面
     * @param {string} contactId - 联系人ID
     */
    openChat(contactId) {
        const contact = this.contacts.get(contactId);
        if (!contact) return;
        
        this.currentChat = contactId;
        
        const screen = this.currentContainer || document.getElementById('phone-screen');
        if (!screen) return;
        
        let html = `
            <div class="phone-nav">
                <button class="phone-back-btn" onclick="PhoneManager.openApp('${this.currentApp}')">←</button>
                <span class="phone-title">${contact.name}</span>
            </div>
            <div class="phone-chat">
                <div class="phone-chat-messages">
        `;
        
        // 显示消息
        for (const msg of (contact.messages || [])) {
            html += `
                <div class="phone-chat-message ${msg.sent ? 'sent' : 'received'}">
                    ${msg.content}
                </div>
            `;
        }
        
        const noSignal = !this.hasSignal();
        const canSend = !noSignal;
        html += `
                </div>
                <div class="phone-chat-input">
                    ${canSend ? `<input type="text" id="phone-message-input" placeholder="输入消息..."><button onclick="PhoneManager.sendMessage()">发送</button>` : '<span class="phone-readonly-hint">无信号，仅可查看记录</span>'}
                </div>
            </div>
        `;
        
        screen.innerHTML = html;
    },
    
    /**
     * 发送消息（暂存）
     */
    sendMessage() {
        if (!this.hasSignal()) {
            if (window.Toast) Toast.show('无信号，无法发送', 'warning');
            return;
        }
        const input = document.getElementById('phone-message-input');
        const message = input?.value?.trim();
        
        if (!message || !this.currentChat) return;
        
        // 2026-06-05：cap 防累积（同 [[iframe-postmessage-dos-cap-2026-06-05]] 累积 cap pattern）
        const MAX_PENDING_PHONE_MSGS = 100;
        const MAX_PHONE_CONTACT_MSGS = 500;

        // 添加到暂存
        this.pendingMessages.push({
            contactId: this.currentChat,
            content: message,
            timestamp: Date.now()
        });
        while (this.pendingMessages.length > MAX_PENDING_PHONE_MSGS) this.pendingMessages.shift();

        // 添加到本地显示
        const contact = this.contacts.get(this.currentChat);
        if (contact) {
            if (!contact.messages) contact.messages = [];
            contact.messages.push({
                content: message,
                sent: true,
                time: new Date().toLocaleTimeString()
            });
            while (contact.messages.length > MAX_PHONE_CONTACT_MSGS) contact.messages.shift();
        }
        
        // 清空输入框
        input.value = '';
        
        // 刷新显示
        this.openChat(this.currentChat);
        
        this.saveToStorage();
        if (window.Events && window.EVENT_TYPES) Events.emit(EVENT_TYPES.PHONE_PENDING_CHANGED, { count: this.getTotalPendingCount() });
    },

    getPendingPrompt(pluginId) {
        const id = pluginId || this.currentPluginId;
        let msgs = this.pendingMessages;
        let calls = this.pendingCalls;
        let contacts = this.contacts;
        if (id && id !== this.currentPluginId && typeof Storage !== 'undefined') {
            const raw = Storage.getLocal(this.getStorageKey(id));
            if (raw) {
                msgs = raw.pendingMessages || [];
                calls = raw.pendingCalls || [];
                contacts = new Map();
                (raw.contacts || []).forEach(([k, v]) => contacts.set(k, v));
            }
        }
        if (msgs.length === 0 && calls.length === 0) return '';
        let prompt = '【手机操作】\n';
        for (const msg of msgs) {
            const c = contacts.get && contacts.get(msg.contactId) || {};
            prompt += `- 给${c.name || '未知'}发送短信: ${msg.content}\n`;
        }
        for (const call of calls) {
            const c = contacts.get && contacts.get(call.contactId) || {};
            prompt += `- 拨打${c.name || '未知'}的电话\n`;
        }
        return prompt;
    },

    getAllPendingPrompt() {
        let out = '';
        if (window.PluginRegistry) {
            for (const [id, p] of PluginRegistry.plugins) {
                if (p.pluginType === 'interactive-save' && window.InteractiveSaveDriver) {
                    const s = InteractiveSaveDriver.getPendingPrompt(id);
                    if (s) out += s;
                }
            }
        }
        return out;
    },

    clearPending(pluginId) {
        const id = pluginId || this.currentPluginId;
        if (id === this.currentPluginId) {
            this.pendingMessages = [];
            this.pendingCalls = [];
            this.saveToStorage(id);
        } else if (id && typeof Storage !== 'undefined') {
            const key = this.getStorageKey(id);
            const raw = Storage.getLocal(key) || {};
            raw.pendingMessages = [];
            raw.pendingCalls = [];
            Storage.setLocal(key, raw);
        }
        if (window.Events && window.EVENT_TYPES) Events.emit(EVENT_TYPES.PHONE_PENDING_CHANGED, { count: this.getTotalPendingCount() });
    },

    getTotalPendingCount() {
        let n = this.pendingMessages.length + this.pendingCalls.length;
        if (window.PluginRegistry && this.currentPluginId) {
            for (const [id, p] of PluginRegistry.plugins) {
                if (p.pluginType === 'interactive-save' && id !== this.currentPluginId) {
                    const raw = typeof Storage !== 'undefined' ? Storage.getLocal(this.getStorageKey(id)) : null;
                    if (raw) n += (raw.pendingMessages || []).length + (raw.pendingCalls || []).length;
                }
            }
        }
        return n;
    },

    /** 供主界面/调试区展示暂存列表用 */
    getPendingItems(pluginId) {
        const id = pluginId || this.currentPluginId;
        if (id === this.currentPluginId) {
            return { messages: this.pendingMessages || [], calls: this.pendingCalls || [], contacts: this.contacts };
        }
        const raw = typeof Storage !== 'undefined' ? Storage.getLocal(this.getStorageKey(id)) : null;
        const contacts = new Map();
        if (raw && Array.isArray(raw.contacts)) raw.contacts.forEach(([k, v]) => contacts.set(k, v));
        return { messages: raw?.pendingMessages || [], calls: raw?.pendingCalls || [], contacts };
    },
    
    /**
     * 添加联系人
     * @param {Object} contact - 联系人信息
     */
    addContact(contact) {
        this.contacts.set(contact.id, {
            ...contact,
            messages: contact.messages || []
        });
        this.saveToStorage();
    },
    
    /**
     * 接收消息（从AI响应）
     * @param {string} contactId - 联系人ID
     * @param {string} content - 消息内容
     */
    receiveMessage(contactId, content) {
        const contact = this.contacts.get(contactId);
        if (contact) {
            if (!contact.messages) contact.messages = [];
            contact.messages.push({
                content,
                sent: false,
                time: new Date().toLocaleTimeString()
            });
            // 2026-06-05：cap 500 防长期 NPC 对话累积无限增长撑爆 phone-manager localStorage（同 [[iframe-postmessage-dos-cap-2026-06-05]] 累积 cap pattern）
            const MAX_PHONE_MESSAGES = 500;
            while (contact.messages.length > MAX_PHONE_MESSAGES) contact.messages.shift();
            this.unreadCount++;
            this.saveToStorage();
            if (window.Events && window.EVENT_TYPES) Events.emit(EVENT_TYPES.PHONE_MESSAGE_RECEIVED, { contactId, content });
        }
    },

    clearAllPending() {
        if (window.PluginRegistry) {
            for (const [id, p] of PluginRegistry.plugins) {
                if (p.pluginType === 'interactive-save') this.clearPending(id);
            }
        }
    }
};

if (typeof window !== 'undefined') {
    window.InteractiveSaveDriver = InteractiveSaveDriver;
    window.PhoneManager = InteractiveSaveDriver;
}
if (typeof module !== 'undefined' && module.exports) module.exports = { InteractiveSaveDriver, PhoneManager: InteractiveSaveDriver };
