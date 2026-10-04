/**
 * 全局配置文件
 * 包含游戏的基础配置和常量
 */

const CONFIG = {
    // 版本信息
    version: '0.1.0',
    gameName: '贪食症',

    // 游戏阶段枚举（通用占位，具体阶段由模组定义）
    PHASES: {},


    // 数值类型（通用占位，具体由模组通过 State.variables 等管理）
    VALUE_TYPES: {},

    // 存储键名
    STORAGE_KEYS: {
        API_CONFIG: 'bulimia_api_config',
        API_PRESETS: 'bulimia_api_presets',
        PROMPT_PRESETS: 'bulimia_prompt_presets',
        PERSONAS: 'bulimia_personas',
        CURRENT_PERSONA: 'bulimia_current_persona',
        SETTINGS: 'bulimia_settings',
        THEME: 'bulimia_theme',
        MODULES: 'bulimia_modules',
        CURRENT_MODULE: 'bulimia_current_module',
        REGEX_SCRIPTS: 'bulimia_regex_scripts',
        // 插件数据前缀（系统通用）：实际键为 PLUGIN_DATA + '_' + pluginId + '_' + moduleId + '_' + saveId，由插件/存档使用
        PLUGIN_DATA: 'bulimia_plugin_data',
        // 总结按存档存储：SUMMARIES 存于 IndexedDB，id 含 saveId
        SUMMARY_PREFIX: 'bulimia_summary_'
    },

    // IndexedDB配置
    DB_NAME: 'BulimiaGameDB',
    DB_VERSION: 2,
    DB_STORES: {
        SAVES: 'saves',
        CHAT_HISTORY: 'chatHistory',
        NPCS: 'npcs',
        WORLDBOOKS: 'worldbooks',
        SUMMARIES: 'summaries',
        MODULES: 'modules'
    },

    // 总结配置
    SUMMARY: {
        AUTO_TRIGGER_MESSAGES: 20,  // 每20条自动总结
        KEEP_RECENT_MESSAGES: 5,    // 保留最近5条不总结
        MAX_SUMMARY_LENGTH: 2000    // 总结最大长度
    },

    // API默认配置
    API_DEFAULTS: {
        endpoint: '',
        model: '',
        maxTokens: 4096,
        temperature: 0.8,
        topP: 0.9
    },

    // 时间配置（通用）
    TIME: {
        DEFAULT_ADVANCE_MINUTES: 60
    },
    // 默认初始状态（通用空对象，具体由模组通过 State.variables / content.initialStates 等管理）
    DEFAULT_GAME_STATE: {},

    // UI配置
    UI: {
        TOAST_DURATION: 3000,
        ANIMATION_DURATION: 300,
        AUTO_SAVE_INTERVAL: 60000  // 1分钟自动存档
    }
};

// 冻结配置防止修改
Object.freeze(CONFIG);
Object.freeze(CONFIG.PHASES);
Object.freeze(CONFIG.VALUE_TYPES);
Object.freeze(CONFIG.STORAGE_KEYS);
Object.freeze(CONFIG.DB_STORES);
Object.freeze(CONFIG.SUMMARY);
Object.freeze(CONFIG.API_DEFAULTS);
Object.freeze(CONFIG.TIME);
Object.freeze(CONFIG.DEFAULT_GAME_STATE);
Object.freeze(CONFIG.UI);

// 导出到全局（浏览器环境）
if (typeof window !== 'undefined') {
    window.CONFIG = CONFIG;
}

// 导出（Node.js环境）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}
