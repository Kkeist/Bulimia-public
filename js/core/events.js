/**
 * 事件总线
 * 用于组件间通信
 */

class EventBus {
    constructor() {
        this.listeners = new Map();
    }

    /**
     * 订阅事件
     * @param {string} event - 事件名
     * @param {Function} callback - 回调函数
     * @returns {Function} 取消订阅函数
     */
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(callback);

        // 返回取消订阅函数
        return () => this.off(event, callback);
    }

    /**
     * 订阅一次性事件
     * @param {string} event - 事件名
     * @param {Function} callback - 回调函数
     */
    once(event, callback) {
        const wrapper = (...args) => {
            callback(...args);
            this.off(event, wrapper);
        };
        this.on(event, wrapper);
    }

    /**
     * 取消订阅
     * @param {string} event - 事件名
     * @param {Function} callback - 回调函数
     */
    off(event, callback) {
        if (this.listeners.has(event)) {
            this.listeners.get(event).delete(callback);
        }
    }

    /**
     * 触发事件
     * @param {string} event - 事件名
     * @param {any} data - 事件数据
     */
    emit(event, data) {
        if (this.listeners.has(event)) {
            this.listeners.get(event).forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Error in event handler for ${event}:`, error);
                }
            });
        }
    }

    /**
     * 清除所有事件监听
     * @param {string} [event] - 可选，指定事件名
     */
    clear(event) {
        if (event) {
            this.listeners.delete(event);
        } else {
            this.listeners.clear();
        }
    }
}

// 全局事件总线实例
const Events = new EventBus();

// 预定义事件名常量
const EVENT_TYPES = {
    // 游戏状态
    GAME_STATE_CHANGED: 'game:state:changed',
    GAME_PHASE_CHANGED: 'game:phase:changed',
    GAME_TIME_ADVANCED: 'game:time:advanced',
    GAME_LOCATION_CHANGED: 'game:location:changed',

    // API相关
    API_REQUEST_START: 'api:request:start',
    API_REQUEST_SUCCESS: 'api:request:success',
    API_REQUEST_ERROR: 'api:request:error',
    API_STREAM_CHUNK: 'api:stream:chunk',

    // 聊天相关
    CHAT_MESSAGE_ADDED: 'chat:message:added',
    CHAT_MESSAGE_UPDATED: 'chat:message:updated',
    CHAT_CLEARED: 'chat:cleared',

    // 数值相关
    VALUE_CHANGED: 'value:changed',
    VALUES_BATCH_CHANGED: 'values:batch:changed',
    VALUE_CHANGE_FAILED: 'value:change:failed',

    // 世界书相关
    WORLDBOOK_ACTIVATED: 'worldbook:activated',
    WORLDBOOK_DEACTIVATED: 'worldbook:deactivated',

    // 触发器相关
    TRIGGER_ACTIVATED: 'trigger:activated',
    TRIGGER_COMPLETED: 'trigger:completed',
    TIMELINE_ADVANCED: 'timeline:advanced',

    // 总结相关
    SUMMARY_CREATED: 'summary:created',
    SUMMARY_UPDATED: 'summary:updated',

    // 手机相关
    PHONE_MESSAGE_RECEIVED: 'phone:message:received',
    PHONE_MESSAGE_SENT: 'phone:message:sent',
    PHONE_PENDING_CHANGED: 'phone:pending:changed',

    // 插件相关
    PLUGIN_ACTION_ADDED: 'plugin:action:added',
    PLUGIN_ACTION_REMOVED: 'plugin:action:removed',
    PLUGIN_PENDING_CLEARED: 'plugin:pending:cleared',

    // NPC相关
    NPC_CREATED: 'npc:created',
    NPC_RELATIONSHIP_CHANGED: 'npc:relationship:changed',

    // UI相关
    UI_PAGE_CHANGED: 'ui:page:changed',
    UI_MODAL_OPENED: 'ui:modal:opened',
    UI_MODAL_CLOSED: 'ui:modal:closed',
    UI_POPUP_OPENED: 'ui:popup:opened',
    UI_POPUP_CLOSED: 'ui:popup:closed',

    // 存档相关
    SAVE_CREATED: 'save:created',
    SAVE_LOADED: 'save:loaded',
    SAVE_DELETED: 'save:deleted',
    AUTO_SAVE: 'save:auto',

    // 模块相关
    MODULE_LOADED: 'module:loaded',
    GAME_FLOW_UPDATE: 'game:flow:update',
    GAME_PHASE_ADVANCE: 'game:phase:advance'
};

Object.freeze(EVENT_TYPES);

// 导出到全局（浏览器环境）
if (typeof window !== 'undefined') {
    window.Events = Events;
    window.EventBus = EventBus;
    window.EVENT_TYPES = EVENT_TYPES;
}

// 导出（Node.js环境）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { EventBus, Events, EVENT_TYPES };
}
