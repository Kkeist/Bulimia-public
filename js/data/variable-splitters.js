/**
 * 内置变量拆分器（日期/时间）
 * 约定：模组可定义 calendar（type: date）作为日期；未定义则用默认 time（时间流逝用）。
 * 读取 calendar_* 时优先从 content.timeVariableId 指向的变量取，否则 calendar，再否则 time。
 * 默认时间格式：前缀 + 年/月/日 + 星期X + 时:分（可由模组绑定并自定义命名与单位）。
 */

const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];
/** 显示用的星期全称（按界面语言翻译） */
const WEEKDAY_LABELS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

const VariableSplitters = {
    /** 日期/时间：优先用模组绑定的时间变量（timeVariableId），否则 calendar，再否则 time（默认） */
    date: {
        partIds: ['calendar_era', 'calendar_year', 'calendar_month', 'calendar_day', 'calendar_dayOfWeek', 'calendar_hour', 'calendar_minute'],
        getPart(vars, partId, timeVarId) {
            const byId = timeVarId && vars && vars[timeVarId] != null && typeof vars[timeVarId] === 'object' ? vars[timeVarId] : null;
            const cal = vars && vars.calendar != null && typeof vars.calendar === 'object' ? vars.calendar : null;
            const t = vars && vars.time != null && typeof vars.time === 'object' ? vars.time : null;
            const src = byId || cal || t;
            if (!src) return undefined;
            if (partId === 'calendar_era') return (src.era != null ? String(src.era) : '') || (src.prefix != null ? String(src.prefix) : '');
            if (partId === 'calendar_year') return src.year != null ? Number(src.year) : undefined;
            if (partId === 'calendar_month') return src.month != null ? Number(src.month) : undefined;
            if (partId === 'calendar_day') return src.day != null ? Number(src.day) : undefined;
            if (partId === 'calendar_dayOfWeek') {
                if (src.dayOfWeek != null) return Number(src.dayOfWeek);
                if (src.weekday != null) return Number(src.weekday);
                if (src.year != null && src.month != null && src.day != null)
                    return new Date(Number(src.year), Number(src.month) - 1, Number(src.day)).getDay();
                return undefined;
            }
            if (partId === 'calendar_hour') return src.hour != null ? Number(src.hour) : undefined;
            if (partId === 'calendar_minute') return src.minute != null ? Number(src.minute) : undefined;
            return undefined;
        },
        format(vars, timeVarId) {
            const byId = timeVarId && vars && vars[timeVarId] != null && typeof vars[timeVarId] === 'object' ? vars[timeVarId] : null;
            const cal = vars && vars.calendar != null && typeof vars.calendar === 'object' ? vars.calendar : null;
            const t = vars && vars.time != null && typeof vars.time === 'object' ? vars.time : null;
            const src = byId || cal || t;
            if (src) {
                const era = src.era != null ? String(src.era) : (src.prefix != null ? String(src.prefix) : '');
                const y = src.year != null ? Number(src.year) : 1;
                const m = src.month != null ? Number(src.month) : 1;
                const d = src.day != null ? Number(src.day) : 1;
                const dw = src.dayOfWeek != null ? src.dayOfWeek : (src.weekday != null ? src.weekday : new Date(y, m - 1, d).getDay());
                const h = src.hour != null ? Number(src.hour) : 8;
                const min = src.minute != null ? Number(src.minute) : 0;
                const timePart = (src.hour != null || src.minute != null) ? ` ${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}` : '';
                const weekPart = dw != null ? ' ' + I18n.t(WEEKDAY_LABELS[dw % 7]) : '';
                if (!era) return `${I18n.t('{y}年{m}月{d}日', { y, m, d })}${weekPart}${timePart}`.trim();
                return `${I18n.t('{era}{y}年{m}月{d}日', { era, y, m, d })}${weekPart}${timePart}`.trim();
            }
            return '';
        }
    }
};

/**
 * 从 State.variables 中按 variableId 取值；若为日期拆分 id 则从模组绑定的时间变量（timeVarId）或 calendar/time 取
 * @param {Object} vars - State.variables
 * @param {string} variableId - 如 calendar_year、或任意变量 id
 * @param {string} [timeVarId] - 模组 content.timeVariableId，绑定系统时间用的变量 id；不传则用 calendar 再 time
 * @returns {any}
 */
function getVariableValue(vars, variableId, timeVarId) {
    if (!vars || variableId == null) return undefined;
    if (VariableSplitters.date.partIds.indexOf(variableId) !== -1) {
        const v = VariableSplitters.date.getPart(vars, variableId, timeVarId);
        if (v !== undefined) return v;
    }
    return vars[variableId];
}

/**
 * 格式化日期变量用于展示（一条组合）
 * @param {Object} vars - State.variables
 * @returns {string}
 */
function formatDateForDisplay(vars) {
    return VariableSplitters.date.format(vars || {});
}

if (typeof window !== 'undefined') {
    window.VariableSplitters = VariableSplitters;
    window.getVariableValue = getVariableValue;
    window.formatDateForDisplay = formatDateForDisplay;
}
