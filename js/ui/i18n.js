/**
 * 界面语言：中文（默认）与英文。
 * 按中文原文匹配并替换界面文字（文本、placeholder、aria-label、title），
 * 动态生成的界面通过 MutationObserver 同样处理；聊天内容不翻译。
 * 语言选择单独存在 localStorage 的 bulimia_lang 中。
 */

const I18n = {
    KEY: 'bulimia_lang',
    lang: 'zh',
    ATTRS: ['placeholder', 'aria-label', 'title'],
    SKIP: 'script,style,textarea,#chat-messages,.msg-content,.no-i18n',

    EN: {
        // 标题页 / 游戏页
        '需要开启 JavaScript 才能使用。': 'JavaScript must be enabled to use this app.',
        '交互插件': 'Interactive plugins',
        '状态插件': 'Status plugins',
        '基本信息': 'Basic info',
        '状态栏': 'Status bar',
        '删除所选': 'Delete selected',
        '取消': 'Cancel',
        '重新生成': 'Regenerate',
        '多选删除': 'Multi-delete',
        '下一事件': 'Next event',
        '下一天': 'Next day',
        '自定义推进': 'Custom advance',
        '新游戏': 'New game',
        '读取存档': 'Load save',
        '场外指令': 'OOC instruction',
        '输入场外指令': 'Enter an out-of-character instruction',
        '设置': 'Settings',
        '调试': 'Debug',
        '输入内容': 'Type a message',
        '停止': 'Stop',
        '发送': 'Send',
        '语言': 'Language',
        // 设置页
        '返回': 'Back',
        'API 连接': 'API connection',
        '模组管理': 'Modules',
        '存档管理': 'Saves',
        '显示设置': 'Display',
        '个人设定': 'Persona',
        '写作指导': 'Writing guide',
        '补丁': 'Patches',
        '输出预设': 'Output presets',
        '正则脚本': 'Regex scripts',
        '已保存的配置': 'Saved configs',
        '新配置': 'New config',
        '保存': 'Save',
        '删除': 'Delete',
        '服务商': 'Provider',
        '本机 Claude（无需密钥）': 'Local Claude (no key needed)',
        'Moonshot（月之暗面）': 'Moonshot',
        '智谱 AI': 'Zhipu AI',
        '通义千问': 'Qwen',
        '自定义（OpenAI 兼容）': 'Custom (OpenAI-compatible)',
        '接口地址': 'Endpoint',
        'API 密钥': 'API key',
        '显示': 'Show',
        '隐藏': 'Hide',
        '密钥只保存在本机浏览器中。': 'The key is stored only in this browser.',
        '模型': 'Model',
        '未选择': 'None selected',
        '获取模型列表': 'Fetch models',
        '手动填写模型名称': 'Enter model name manually',
        '连接方式': 'Connection',
        '直接连接': 'Direct',
        '经本机转发': 'Via local relay',
        '测试连接': 'Test connection',
        '使用本机已登录的 Claude，无需填写地址和密钥。': 'Uses the Claude signed in on this machine. No endpoint or key needed.',
        '使用写作指导': 'Use writing guide',
        '破限与 NSFW': 'Jailbreak & NSFW',
        '叙述视角': 'Narrative POV',
        '不指定': 'Unspecified',
        '第一人称（玩家称“我”）': 'First person (player is “I”)',
        '第二人称（玩家称“你”）': 'Second person (player is “you”)',
        '第三人称': 'Third person',
        '各条写作指导在调试页的写作指导中编辑。': 'Edit individual entries under Writing guide in the debug page.',
        '模组自带补丁': 'Module patches',
        '在模组管理中查看': 'View in Modules',
        '自定义补丁': 'Custom patches',
        '新建分组': 'New group',
        '导入世界书': 'Import lorebook',
        '当前预设': 'Current preset',
        '不使用预设': 'No preset',
        '新建': 'New',
        '导入': 'Import',
        '导出': 'Export',
        '启用预设': 'Enable preset',
        '生成参数': 'Generation parameters',
        '温度': 'Temperature',
        '频率惩罚': 'Frequency penalty',
        '存在惩罚': 'Presence penalty',
        '最大输出长度': 'Max output length',
        '提示词条目': 'Prompt entries',
        '新增条目': 'Add entry',
        '排序': 'Sort',
        '绑定模组': 'Bind module',
        '不绑定': 'Unbound',
        '绑定': 'Bind',
        '解绑': 'Unbind',
        '全部预设': 'All presets',
        '预设绑定的正则': 'Preset-bound regex',
        '选择预设': 'Select preset',
        '绑定全部': 'Bind all',
        '应用': 'Apply',
        '多选': 'Multi-select',
        '全选': 'Select all',
        '移到全局': 'Move to global',
        '全局正则': 'Global regex',
        '移到预设': 'Move to preset',
        '当前模组': 'Current module',
        '重新读取': 'Reload',
        '全部模组': 'All modules',
        '模组信息': 'Module info',
        '名称': 'Name',
        '描述': 'Description',
        '当前设定': 'Current persona',
        '不使用设定': 'No persona',
        '内容': 'Content',
        '当前存档': 'Current save',
        '存档名称': 'Save name',
        '重命名': 'Rename',
        '全部存档': 'All saves',
        '导出与导入': 'Export & import',
        '导出存档': 'Export save',
        '复制存档文字': 'Copy save text',
        '导入存档': 'Import save',
        '粘贴存档文字': 'Paste save text',
        '界面': 'Interface',
        'AI 名称': 'AI name',
        '皮肤': 'Theme',
        '云与灰（跟随系统）': 'Cloud & Gray (follow system)',
        '云与灰（浅色）': 'Cloud & Gray (light)',
        '云与灰（深色）': 'Cloud & Gray (dark)',
        '字体大小': 'Font size',
        '回复处理': 'Reply handling',
        '流式输出': 'Stream output',
        '去除回复首尾空白': 'Trim whitespace around replies',
        '去除回复末尾不完整的句子': 'Drop incomplete trailing sentence',
        '自动清理回复中的标签': 'Auto-clean tags in replies',
        '聊天中隐藏思考内容': 'Hide thinking in chat',
        '思考内容识别': 'Thinking detection',
        '使用默认标签': 'Use default tags',
        '使用自定义标签': 'Use custom tags',
        '不识别': 'Disabled',
        '开始标签': 'Start tag',
        '结束标签': 'End tag',
        '发送给 AI': 'Sent to AI',
        '提示词中始终包含角色名字': 'Always include character names in prompt',
        '角色名字作为停止字符串': 'Use character names as stop strings',
        '停止字符串': 'Stop strings',
        '出现这些内容时停止生成。': 'Generation stops when these appear.',
        // 调试页
        '调试工具': 'Debug tools',
        '模块跳转': 'Module jump',
        '作弊器': 'Cheats',
        '插件测试': 'Plugin tests',
        '总结': 'Summary',
        '模组编辑': 'Module editor',
        '提示词查看器': 'Prompt viewer',
        '原始回复': 'Raw replies',
        '查看内容': 'View',
        '即将发送': 'Next to send',
        '上次发送': 'Last sent',
        '刷新': 'Refresh',
        '复制': 'Copy',
        '全部折叠': 'Collapse all',
        '完整Prompt': 'Full prompt',
        '问答区': 'Q&A',
        '预测区': 'Prediction',
        '原始输出': 'Raw output',
        '添加条目': 'Add entry',
        '恢复默认': 'Restore defaults',
        '破限与 NSFW 条目的开关在设置的写作指导里。': 'The Jailbreak & NSFW toggles are in Settings → Writing guide.'
    },

    init() {
        try { this.lang = window.localStorage.getItem(this.KEY) === 'en' ? 'en' : 'zh'; } catch (e) { this.lang = 'zh'; }
        this._orig = new WeakMap();
        this._bind();
        this.apply();
        this._observe();
    },

    t(zh) {
        if (this.lang !== 'en' || typeof zh !== 'string') return zh;
        const key = zh.trim();
        return this.EN[key] !== undefined ? zh.replace(key, this.EN[key]) : zh;
    },

    set(lang) {
        this.lang = lang === 'en' ? 'en' : 'zh';
        try { window.localStorage.setItem(this.KEY, this.lang); } catch (e) { console.warn('语言偏好保存失败：', e); }
        this.apply();
    },

    apply(root) {
        const base = root || document.body;
        document.documentElement.lang = this.lang === 'en' ? 'en' : 'zh-CN';
        document.title = this.lang === 'en' ? 'Bulimia' : '贪食症 - Bulimia';
        this._busy = true;
        try { this._walk(base); } finally { this._busy = false; }
        document.querySelectorAll('.lang-select').forEach(s => { s.value = this.lang; });
    },

    _walk(node) {
        if (node.nodeType === 3) return this._text(node);
        if (node.nodeType !== 1) return;
        if (node.matches && node.matches(this.SKIP)) return;
        if (node.closest && node.closest(this.SKIP)) return;
        this._attrs(node);
        for (const c of node.childNodes) this._walk(c);
    },

    _text(node) {
        const orig = this._orig.has(node) ? this._orig.get(node) : node.nodeValue;
        if (!this._orig.has(node)) {
            if (!/[一-龥]/.test(orig)) return;
            this._orig.set(node, orig);
        } else if (node.nodeValue !== orig && node.nodeValue !== this.t(orig)) {
            // 文本被程序改写过，以新文本为准
            if (!/[一-龥]/.test(node.nodeValue)) { this._orig.delete(node); return; }
            this._orig.set(node, node.nodeValue);
            return this._text(node);
        }
        const out = this.lang === 'en' ? this.t(orig) : orig;
        if (node.nodeValue !== out) node.nodeValue = out;
    },

    _attrs(el) {
        for (const a of this.ATTRS) {
            if (!el.hasAttribute(a)) continue;
            const key = `data-i18n-${a}`;
            let orig = el.getAttribute(key);
            if (orig === null) {
                orig = el.getAttribute(a);
                if (!/[一-龥]/.test(orig)) continue;
                el.setAttribute(key, orig);
            }
            const out = this.lang === 'en' ? this.t(orig) : orig;
            if (el.getAttribute(a) !== out) el.setAttribute(a, out);
        }
    },

    _observe() {
        if (typeof MutationObserver === 'undefined') return;
        new MutationObserver(muts => {
            if (this._busy || this.lang !== 'en') return;
            this._busy = true;
            try {
                for (const m of muts) {
                    if (m.type === 'childList') m.addedNodes.forEach(n => this._walk(n));
                    else if (m.type === 'characterData') this._walk(m.target);
                    else if (m.type === 'attributes' && !m.attributeName.startsWith('data-i18n')) this._attrs(m.target);
                }
            } finally { this._busy = false; }
        }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: this.ATTRS });
    },

    _bind() {
        document.querySelectorAll('.lang-select').forEach(s => {
            s.addEventListener('change', () => this.set(s.value));
        });
    }
};

if (typeof window !== 'undefined') window.I18n = I18n;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => I18n.init());
else I18n.init();
