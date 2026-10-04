/**
 * 存储管理器
 * 管理IndexedDB和LocalStorage
 */

/** 存储出错：kind 是类别（quota 空间不足、unavailable 浏览器不允许、failed 其他），message 给玩家看 */
class StorageError extends Error {
    constructor(kind, message) {
        super(message);
        this.name = 'StorageError';
        this.kind = kind;
    }
}

class StorageManager {
    constructor() {
        this.db = null;
        this.isReady = false;
        this.localAvailable = true;
    }

    /** 浏览器的本地存储能不能用（隐私模式、被禁用时不能） */
    _probeLocal() {
        try {
            const k = '__bulimia_probe__';
            localStorage.setItem(k, '1');
            localStorage.removeItem(k);
            return true;
        } catch (e) {
            return false;
        }
    }

    /** 把底层错误整理成玩家看得懂的 StorageError */
    _storageError(e) {
        if (e instanceof StorageError) return e;
        const isQuota = e && (e.name === 'QuotaExceededError' || e.code === 22 || (typeof e.message === 'string' && /quota/i.test(e.message)));
        if (isQuota) return new StorageError('quota', '浏览器的存储空间不够了，没有保存成功。请先导出存档备份，再清理浏览器空间。');
        if (e && (e.name === 'SecurityError' || e.name === 'InvalidStateError')) {
            return new StorageError('unavailable', '这个浏览器不允许保存数据（可能是隐私模式），存档和设置无法保存。');
        }
        return new StorageError('failed', '存档没有保存成功，请重试。');
    }

    /**
     * 初始化IndexedDB
     */
    async init() {
        this.localAvailable = this._probeLocal();
        if (!this.localAvailable && typeof Toast !== 'undefined') {
            Toast.show('这个浏览器不允许保存设置（可能是隐私模式），刷新后设置会丢失。', 'warning', 8000);
        }
        return new Promise((resolve, reject) => {
            if (typeof indexedDB === 'undefined') {
                reject(new StorageError('unavailable', '这个浏览器不支持保存存档，游戏进度无法保存。'));
                return;
            }
            let request;
            try {
                request = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);
            } catch (e) {
                reject(new StorageError('unavailable', '这个浏览器不允许保存存档（可能是隐私模式），游戏进度无法保存。'));
                return;
            }

            request.onerror = () => {
                reject(new StorageError('unavailable', '这个浏览器不允许保存存档（可能是隐私模式），游戏进度无法保存。'));
            };

            request.onsuccess = () => {
                this.db = request.result;
                this.isReady = true;
                this.db.onversionchange = () => { this.db.close(); this.db = null; this.isReady = false; };
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // 创建存档存储
                if (!db.objectStoreNames.contains(CONFIG.DB_STORES.SAVES)) {
                    db.createObjectStore(CONFIG.DB_STORES.SAVES, { keyPath: 'id' });
                }

                // 创建聊天历史存储
                if (!db.objectStoreNames.contains(CONFIG.DB_STORES.CHAT_HISTORY)) {
                    db.createObjectStore(CONFIG.DB_STORES.CHAT_HISTORY, { keyPath: 'chatId' });
                }

                // 创建NPC存储
                if (!db.objectStoreNames.contains(CONFIG.DB_STORES.NPCS)) {
                    db.createObjectStore(CONFIG.DB_STORES.NPCS, { keyPath: 'id' });
                }

                // 创建世界书存储
                if (!db.objectStoreNames.contains(CONFIG.DB_STORES.WORLDBOOKS)) {
                    db.createObjectStore(CONFIG.DB_STORES.WORLDBOOKS, { keyPath: 'id' });
                }

                // 创建总结存储
                if (!db.objectStoreNames.contains(CONFIG.DB_STORES.SUMMARIES)) {
                    db.createObjectStore(CONFIG.DB_STORES.SUMMARIES, { keyPath: 'id' });
                }

                // 玩家自己导入的模组（没有模组文件夹的）
                if (!db.objectStoreNames.contains(CONFIG.DB_STORES.MODULES)) {
                    db.createObjectStore(CONFIG.DB_STORES.MODULES, { keyPath: 'id' });
                }
            };
        });
    }

    // ==================== IndexedDB 操作 ====================

    /**
     * 通用存储操作
     */
    async _dbOperation(storeName, mode, operation) {
        if (!this.db) {
            throw new StorageError('unavailable', '存档功能不可用，游戏进度无法保存。');
        }

        return new Promise((resolve, reject) => {
            let transaction;
            let request;
            try {
                transaction = this.db.transaction(storeName, mode);
                request = operation(transaction.objectStore(storeName));
            } catch (e) {
                try { if (transaction) transaction.abort(); } catch (_) { /* 事务已结束 */ }
                reject(this._storageError(e));
                return;
            }
            let result;
            request.onsuccess = () => {
                result = request.result;
                if (mode === 'readonly') resolve(result);
            };
            // 写入要等事务真正提交：空间不足会在提交时才报错，请求本身看起来是成功的
            transaction.oncomplete = () => resolve(result);
            transaction.onabort = () => reject(this._storageError(transaction.error || request.error));
        });
    }

    /**
     * 保存游戏存档
     */
    async saveGame(saveId, data) {
        // 存档名字：本存档内最新一条 user 消息使用的 persona
        let previewPersona = data.currentPersona?.name || '未设置角色';
        if (data.chatHistory && data.chatHistory.length > 0) {
            for (let i = data.chatHistory.length - 1; i >= 0; i--) {
                const msg = data.chatHistory[i];
                if (msg.role === 'user' && (msg.personaName != null && msg.personaName !== '')) {
                    previewPersona = msg.personaName;
                    break;
                }
            }
        }

        // 获取最后一条消息内容（优先AI消息）
        let lastContent = '';
        if (data.chatHistory && data.chatHistory.length > 0) {
            // 从后往前找最后一条AI消息或任意消息
            for (let i = data.chatHistory.length - 1; i >= 0; i--) {
                const msg = data.chatHistory[i];
                if (msg.role === 'assistant' && msg.content) {
                    lastContent = msg.content.replace(/\n/g, ' ');
                    break;
                }
            }
            // 如果没找到AI消息，用最后一条
            if (!lastContent && data.chatHistory[data.chatHistory.length - 1]?.content) {
                lastContent = data.chatHistory[data.chatHistory.length - 1].content.replace(/\n/g, ' ');
            }
        }

        const save = {
            id: saveId,
            timestamp: Date.now(),
            data: data,
            preview: {
                phase: data.gameState?.majorPhase,
                date: data.gameState?.currentDate,
                location: data.gameState?.currentLocation,
                persona: previewPersona,
                lastContent: lastContent || '(无内容)'
            }
        };

        await this._dbOperation(CONFIG.DB_STORES.SAVES, 'readwrite',
            store => store.put(save)
        );

        Events.emit(EVENT_TYPES.SAVE_CREATED, { saveId });
        return save;
    }

    /**
     * 加载游戏存档
     */
    async loadGame(saveId) {
        const save = await this._dbOperation(CONFIG.DB_STORES.SAVES, 'readonly',
            store => store.get(saveId)
        );

        if (save) {
            Events.emit(EVENT_TYPES.SAVE_LOADED, { saveId });
        }

        return save;
    }

    /**
     * 获取所有存档列表
     */
    async listSaves() {
        return this._dbOperation(CONFIG.DB_STORES.SAVES, 'readonly',
            store => store.getAll()
        );
    }

    /**
     * 删除存档
     */
    async deleteSave(saveId) {
        await this._dbOperation(CONFIG.DB_STORES.SAVES, 'readwrite',
            store => store.delete(saveId)
        );
        Events.emit(EVENT_TYPES.SAVE_DELETED, { saveId });
    }

    /** 玩家自己导入的模组。整份存在 IndexedDB 里，不进浏览器设置（设置存在 localStorage，空间只有几 MB） */
    async loadUserModules() {
        return this._dbOperation(CONFIG.DB_STORES.MODULES, 'readonly',
            store => store.getAll()
        );
    }

    /** 用给定的列表整体替换已保存的自导入模组（同一个事务，要么全成功要么不变） */
    async saveUserModules(modules) {
        return this._dbOperation(CONFIG.DB_STORES.MODULES, 'readwrite', store => {
            store.clear();
            let last = null;
            modules.forEach(m => { last = store.put(m); });
            return last || store.count();
        });
    }

    /**
     * 保存世界书
     */
    async saveWorldbook(worldbook) {
        return this._dbOperation(CONFIG.DB_STORES.WORLDBOOKS, 'readwrite',
            store => store.put(worldbook)
        );
    }

    /**
     * 加载所有世界书
     */
    async loadWorldbooks() {
        return this._dbOperation(CONFIG.DB_STORES.WORLDBOOKS, 'readonly',
            store => store.getAll()
        );
    }

    /**
     * 保存NPC数据
     */
    async saveNPC(npc) {
        return this._dbOperation(CONFIG.DB_STORES.NPCS, 'readwrite',
            store => store.put(npc)
        );
    }

    /**
     * 加载所有NPC
     */
    async loadNPCs() {
        return this._dbOperation(CONFIG.DB_STORES.NPCS, 'readonly',
            store => store.getAll()
        );
    }

    // ==================== 聊天历史存储 ====================

    /**
     * 保存当前聊天历史
     * @param {string} chatId - 聊天ID（默认使用当前会话）
     * @param {Array} messages - 消息数组
     */
    async saveChatHistory(chatId, messages) {
        if (!this.db) return false;

        const chatData = {
            chatId: chatId || 'current',
            messages: messages,
            timestamp: Date.now(),
            preview: messages.length > 0 ? messages[messages.length - 1].content : ''
        };

        try {
            await this._dbOperation(CONFIG.DB_STORES.CHAT_HISTORY, 'readwrite',
                store => store.put(chatData)
            );
            return true;
        } catch (error) {
            console.error('Failed to save chat history:', error);
            return false;
        }
    }

    /**
     * 加载聊天历史
     * @param {string} chatId - 聊天ID
     */
    async loadChatHistory(chatId) {
        if (!this.db) return null;

        try {
            return await this._dbOperation(CONFIG.DB_STORES.CHAT_HISTORY, 'readonly',
                store => store.get(chatId || 'current')
            );
        } catch (error) {
            console.error('Failed to load chat history:', error);
            return null;
        }
    }

    /**
     * 获取所有聊天历史列表
     */
    async listChatHistories() {
        if (!this.db) return [];

        try {
            return await this._dbOperation(CONFIG.DB_STORES.CHAT_HISTORY, 'readonly',
                store => store.getAll()
            );
        } catch (error) {
            console.error('Failed to list chat histories:', error);
            return [];
        }
    }

    /**
     * 删除聊天历史
     * @param {string} chatId - 聊天ID
     */
    async deleteChatHistory(chatId) {
        if (!this.db) return false;

        try {
            await this._dbOperation(CONFIG.DB_STORES.CHAT_HISTORY, 'readwrite',
                store => store.delete(chatId)
            );
            return true;
        } catch (error) {
            console.error('Failed to delete chat history:', error);
            return false;
        }
    }

    // ==================== LocalStorage 操作 ====================

    /**
     * 获取LocalStorage数据
     */
    getLocal(key) {
        try {
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : null;
        } catch (e) {
            // 内容损坏：先把原文备份到另一个键里，避免下次保存时把它覆盖掉
            try {
                const raw = localStorage.getItem(key);
                if (raw && !localStorage.getItem(key + '.corrupt')) {
                    localStorage.setItem(key + '.corrupt', raw);
                    if (typeof Toast !== 'undefined' && Toast.show) {
                        Toast.show('浏览器里保存的设置损坏了，已按空白设置继续，原内容已另外备份。', 'warning', 8000);
                    }
                }
            } catch (_) { /* 备份也写不了，只能这样 */ }
            return null;
        }
    }

    /**
     * 设置LocalStorage数据
     * 空间不足时只清可以重新生成的缓存（promptLogs / temporaryGeneratedModules）并重试一次；
     * 仍失败就提示玩家并返回 false，不删任何玩家自己的数据。
     */
    setLocal(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (e) {
            const isQuota = e && (
                e.name === 'QuotaExceededError' ||
                e.code === 22 ||
                (typeof e.message === 'string' && /quota/i.test(e.message))
            );
            if (isQuota) {
                // 试清纯渲染缓存（可重生成，不损失玩家进度）+ 重试一次
                let cleaned = false;
                try {
                    if (typeof State !== 'undefined') {
                        if (Array.isArray(State.promptLogs) && State.promptLogs.length > 0) { State.promptLogs = []; cleaned = true; }
                        if (Array.isArray(State.temporaryGeneratedModules) && State.temporaryGeneratedModules.length > 0) { State.temporaryGeneratedModules = []; cleaned = true; }
                    }
                } catch (_) {}
                if (cleaned) {
                    try {
                        localStorage.setItem(key, JSON.stringify(value));
                        if (typeof Toast !== 'undefined' && Toast.show) Toast.show('浏览器存储空间不够，已清理调试缓存后保存成功。', 'warning', 4000);
                        return true;
                    } catch (e2) {
                        /* 重试仍失败，下面提示玩家 */
                    }
                }
                if (typeof Toast !== 'undefined' && Toast.show) {
                    Toast.show('浏览器存储空间不够，设置没有保存成功。请先导出存档备份，再清理浏览器空间。', 'error', 8000);
                }
            } else if (typeof Toast !== 'undefined' && Toast.show) {
                Toast.show('设置没有保存成功：这个浏览器不允许保存数据（可能是隐私模式）。', 'error', 5000);
            }
            return false;
        }
    }

    /**
     * 删除LocalStorage数据
     */
    removeLocal(key) {
        try {
            localStorage.removeItem(key);
            return true;
        } catch (e) {
            return false;
        }
    }

    // ==================== API配置存储 ====================

    getAPIConfig() {
        const settings = this.getSettings();
        return settings.apiConfig || CONFIG.API_DEFAULTS;
    }

    saveAPIConfig(config) {
        const settings = this.getSettings();
        settings.apiConfig = config;
        return this.saveSettings(settings);
    }

    getAPIPresets() {
        const settings = this.getSettings();
        return settings.apiPresets || [];
    }

    saveAPIPresets(presets) {
        const settings = this.getSettings();
        settings.apiPresets = presets;
        return this.saveSettings(settings);
    }

    // ==================== Persona存储 ====================

    getPersonas() {
        const settings = this.getSettings();
        return settings.personas || [];
    }

    savePersonas(personas) {
        const settings = this.getSettings();
        settings.personas = personas;
        return this.saveSettings(settings);
    }

    getCurrentPersona() {
        const settings = this.getSettings();
        return settings.currentPersona;
    }

    setCurrentPersona(persona) {
        const settings = this.getSettings();
        settings.currentPersona = persona;
        return this.saveSettings(settings);
    }

    // ==================== 设置存储 ====================

    getSettings() {
        return this.getLocal(CONFIG.STORAGE_KEYS.SETTINGS) || {};
    }

    saveSettings(settings) {
        // 统一做一次“旧值合并”，防止有人传半截对象把其它字段（比如regexScripts）覆盖掉
        const current = this.getSettings() || {};
        const merged = { ...current, ...settings };

        // 2026-06-05 audit：删了 calendarNotes 同步进 State 的死代码——State 端没人读这字段，纯泄漏；
        // settings.calendarNotes 自身保留（用户设置里可能仍有这字段，不主动删避免擦数据）。
        return this.setLocal(CONFIG.STORAGE_KEYS.SETTINGS, merged);
    }

    // 删除 settings 里某个字段。
    // 为什么单独开 API：saveSettings 走 {...current, ...settings} 合并防半截对象覆盖其他字段，
    // 但 spread 不能"删 key"——`delete settings.foo; saveSettings(settings)` 永远删不掉。
    // 想真正清字段的调用方走这条路径。
    deleteSettingsKey(key) {
        const current = this.getSettings() || {};
        if (!(key in current)) return true;
        delete current[key];
        return this.setLocal(CONFIG.STORAGE_KEYS.SETTINGS, current);
    }

    getTheme() {
        const settings = this.getSettings();
        return settings.theme || 'minimal-white';
    }

    saveTheme(theme) {
        const settings = this.getSettings();
        settings.theme = theme;
        return this.saveSettings(settings);
    }

    // ==================== 导入导出 ====================

    /** 存档的导出文字（JSON）；存档不存在返回 null */
    async getSaveExportText(saveId) {
        const save = await this.loadGame(saveId);
        if (!save || !save.data) return null;
        return JSON.stringify({ format: 'bulimia-save', version: 1, exportedAt: Date.now(), save });
    }

    /**
     * 解析并校验导入的存档文字，返回 { id, data }。
     * 内容读不出来或不像存档时抛 StorageError，不改动任何已有存档。
     */
    parseSaveText(text) {
        const bad = (msg) => new StorageError('failed', msg);
        let obj;
        try {
            obj = JSON.parse(String(text || '').replace(/^\uFEFF/, ''));
        } catch (e) {
            throw bad('这不是存档文件，内容无法读取。');
        }
        const rec = obj && typeof obj === 'object' && obj.save && typeof obj.save === 'object' ? obj.save : obj;
        const data = rec && rec.data;
        const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
        if (!isObj(data) || (data.chatHistory === undefined && data.variables === undefined && data.gameState === undefined)) {
            throw bad('这个文件里没有找到存档内容。');
        }
        if (data.chatHistory !== undefined && !Array.isArray(data.chatHistory)) throw bad('存档里的聊天记录格式不对，无法导入。');
        if (data.variables !== undefined && !isObj(data.variables)) throw bad('存档里的变量格式不对，无法导入。');
        if (data.gameState !== undefined && !isObj(data.gameState)) throw bad('存档里的游戏状态格式不对，无法导入。');
        return { id: typeof rec.id === 'string' && rec.id.trim() ? rec.id.trim() : '导入的存档', data };
    }

    /** 导入存档文字，用一个不与现有存档重名的新名字保存；返回新存档的名字 */
    async importSaveText(text) {
        const parsed = this.parseSaveText(text);
        const existing = new Set((await this.listSaves()).map(s => s.id));
        let id = parsed.id;
        if (existing.has(id)) {
            let n = 1;
            while (existing.has(`${parsed.id}（导入${n === 1 ? '' : n}）`)) n++;
            id = `${parsed.id}（导入${n === 1 ? '' : n}）`;
        }
        await this.saveGame(id, parsed.data);
        return id;
    }
}

// 全局存储管理器实例
const Storage = new StorageManager();

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { StorageManager, Storage };
}
