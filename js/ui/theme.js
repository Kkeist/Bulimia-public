/**
 * 主题：浅色、深色、跟随系统。
 * 在页面头部载入，首次绘制前就写好 data-theme，避免先白后黑的闪动。
 */

const Theme = {
    SETTINGS_KEY: 'bulimia_settings',
    COLORS: { light: '#ffffff', dark: '#171717' },
    _mql: null,

    /** 设置里保存的主题偏好：minimal-white、minimal-dark 或 auto */
    getPreference() {
        try {
            const raw = window.localStorage.getItem(this.SETTINGS_KEY);
            const theme = raw ? JSON.parse(raw).theme : null;
            return theme === 'minimal-white' || theme === 'minimal-dark' ? theme : 'auto';
        } catch (e) {
            console.warn('主题偏好读取失败，按跟随系统处理：', e);
            return 'auto';
        }
    },

    systemPrefersDark() {
        return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    },

    resolve(pref) {
        if (pref === 'minimal-dark') return 'dark';
        if (pref === 'minimal-white') return 'light';
        return this.systemPrefersDark() ? 'dark' : 'light';
    },

    apply(pref) {
        const mode = this.resolve(pref);
        document.documentElement.setAttribute('data-theme', mode);
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', this.COLORS[mode]);
        this._pref = pref;
        return mode;
    },

    init() {
        this.apply(this.getPreference());
        if (window.matchMedia) {
            this._mql = window.matchMedia('(prefers-color-scheme: dark)');
            const onChange = () => { if (this._pref === 'auto') this.apply('auto'); };
            if (this._mql.addEventListener) this._mql.addEventListener('change', onChange);
            else this._mql.addListener(onChange);
        }
    }
};

Theme.init();
if (typeof window !== 'undefined') window.Theme = Theme;
