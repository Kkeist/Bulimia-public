/**
 * Condition System - 条件系统
 * Implements nested AND/OR condition evaluation
 * Based on game-v4/docs/01-core-schemas.md
 */

/**
 * ConditionEvaluator - evaluates conditions for modules, variables, and plugins
 */
class ConditionEvaluator {
    constructor(context) {
        // Context provides access to: variableSystem, moduleSystem, timeSystem
        this.context = context;
        /** 评估过程中遇到的配置问题（引用不存在的变量、条件缺少必要内容等），去重后保存，面向创作者的中文 */
        this.problems = new Set();
    }

    /** 记录并输出一条配置问题；条件按「不满足」处理 */
    _report(message) {
        if (!this.problems.has(message)) console.warn('[ConditionEvaluator] ' + message);
        this.problems.add(message);
        return false;
    }

    /** 取走并清空已记录的问题 */
    drainProblems() {
        const list = Array.from(this.problems);
        this.problems.clear();
        return list;
    }

    /**
     * Evaluate a ConditionDef (nested AND/OR structure)
     * @param {Object} conditionDef - { logic: 'AND'|'OR', groups: [...] }
     * @param {string} mode - 'precondition' or 'display'
     * @returns {boolean}
     */
    evaluate(conditionDef, mode = 'precondition') {
        if (!conditionDef || !Array.isArray(conditionDef.groups) || conditionDef.groups.length === 0) {
            return true; // No conditions = always true
        }

        const { logic, groups } = conditionDef;
        const results = groups.map(group => this.evaluateGroup(group, mode));
        // 2026-06-05：兼容作者手写 'and'/'or' 小写 + invalid 时 warn 而非 silent false
        const normLogic = typeof logic === 'string' ? logic.toUpperCase() : '';
        if (normLogic === 'AND') {
            return results.every(r => r);
        } else if (normLogic === 'OR') {
            return results.some(r => r);
        }
        console.warn(`[ConditionEvaluator] 顶层 logic 无效（应为 'AND' 或 'OR'），实际：`, logic, '——按 OR 处理（任一组满足即可），请检查 conditionDef');
        return results.some(r => r); // fallback OR 比 silent false 友好
    }

    /**
     * Evaluate a condition group
     * @param {Object} group - { logic: 'AND'|'OR', items: [...] }
     * @param {string} mode
     * @returns {boolean}
     */
    evaluateGroup(group, mode) {
        if (!group || !Array.isArray(group.items) || group.items.length === 0) {
            return true;
        }

        const { logic, items } = group;
        const results = items.map(item => this.evaluateItem(item, mode));
        // 2026-06-05：同 evaluate，兼容小写 + invalid warn 而非 silent false（按 AND 处理：组内通常 AND 居多）
        const normLogic = typeof logic === 'string' ? logic.toUpperCase() : '';
        if (normLogic === 'AND') {
            return results.every(r => r);
        } else if (normLogic === 'OR') {
            return results.some(r => r);
        }
        console.warn(`[ConditionEvaluator] group logic 无效（应为 'AND' 或 'OR'），实际：`, logic, '——按 AND 处理（全部满足才行），请检查 condition group');
        return results.every(r => r);
    }

    /**
     * Evaluate a single item (condition or nested group)
     * @param {Object} item - { itemType: 'condition'|'group', condition/group: {...} }
     * @param {string} mode
     * @returns {boolean}
     */
    evaluateItem(item, mode) {
        if (item.itemType === 'condition') {
            return this.evaluateCondition(item.condition, mode);
        } else if (item.itemType === 'group') {
            return this.evaluateGroup(item.group, mode);
        }
        return this._report('有一条条件既不是单个条件也不是条件组，已按不满足处理。');
    }

    /**
     * Evaluate a single condition
     * @param {Object} condition
     * @param {string} mode
     * @returns {boolean}
     */
    evaluateCondition(condition, mode) {
        if (!condition || typeof condition !== 'object') return this._report('有一条条件是空的，已按不满足处理。');
        switch (condition.type) {
            case 'none':
                return this.evaluateNone();

            case 'variable':
                return this.evaluateVariable(condition);

            case 'variable_compare':
                return this.evaluateVariableCompare(condition);

            case 'module':
                return this.evaluateModule(condition);

            case 'stage_completed':
                // 旧版条件：pathIds 数组里所有模块都必须已完成
                if (!Array.isArray(condition.pathIds) || !condition.pathIds.length) return false;
                return condition.pathIds.every(id => this.context.moduleSystem.checkModuleState(id, 'completed'));

            case 'event_completed':
                // 时间线事件已触发：等价于 module(eventId, completed) 的语义化别名
                if (!condition.eventId) return false;
                return this.context.moduleSystem.checkModuleState(condition.eventId, 'completed');

            case 'time':
                return this.evaluateTime(condition);

            case 'time_range':
                return this.evaluateTimeRange(condition);

            case 'tag':
                return this.evaluateTag(condition);

            default:
                return this._report(`条件类型「${condition.type}」不认识，已按不满足处理。`);
        }
    }

    /**
     * none - always true
     */
    evaluateNone() {
        return true;
    }

    /**
     * variable - check variable value
     * { type: 'variable', variableId: 'xxx', operator: '>=', value: 60 }
     */
    evaluateVariable(condition) {
        const { variableId, operator, value } = condition;
        const varValue = this.context.variableSystem.getValue(variableId);

        if (varValue === undefined) {
            return this._report(`条件引用的变量「${variableId}」不存在，已按不满足处理。`);
        }

        return this.compareValues(varValue, operator, value);
    }

    /**
     * variable_compare - compare two variables
     * { type: 'variable_compare', variableId: 'score', operator: '>=', compareVariableId: 'passScore' }
     */
    evaluateVariableCompare(condition) {
        const { variableId, operator, compareVariableId } = condition;
        const value1 = this.context.variableSystem.getValue(variableId);
        const value2 = this.context.variableSystem.getValue(compareVariableId);

        if (value1 === undefined || value2 === undefined) {
            return this._report(`条件引用的变量「${value1 === undefined ? variableId : compareVariableId}」不存在，已按不满足处理。`);
        }

        return this.compareValues(value1, operator, value2);
    }

    /**
     * module - check module state
     * { type: 'module', moduleId: 'xxx', state: 'entered'|'completed' }
     */
    evaluateModule(condition) {
        const { moduleId, state } = condition;
        return this.context.moduleSystem.checkModuleState(moduleId, state);
    }

    /** 时间系统的进位单位；没有时间系统时返回 undefined（偏移不整理） */
    _timeUnits() {
        const ts = this.context.timeSystem;
        return ts && typeof ts.getUnits === 'function' ? ts.getUnits() : undefined;
    }

    /**
     * time - check if current time has reached/passed a time point.
     * 三种 mode：
     * - absolute：精确日期，{ time: { year, month, day, ... } }
     * - relative：相对模块进入/完成后偏移，{ relative: { moduleId, state, offset: {year,month,day,...} } }
     * - variable_compare：日期变量比较——把某变量值当作 TimePoint，比较当前时间与它的关系
     *   { variableId, operator: '>='|'<=' }
     * 兼容旧字段 timeType（同 mode）。
     */
    evaluateTime(condition) {
        const currentTime = this.context.timeSystem.getCurrentTime();
        const mode = condition.mode || condition.timeType || 'absolute';

        if (mode === 'absolute') {
            if (!condition.time || typeof condition.time !== 'object') return this._report('有一条时间条件没有设置时间，已按不满足处理。');
            const targetTime = new TimePoint(condition.time);
            return currentTime.isAfterOrEqual(targetTime);
        }
        if (mode === 'relative') {
            if (!condition.relative || !condition.relative.moduleId) return this._report('有一条相对时间条件没有设置参照事件，已按不满足处理。');
            const baseTime = this.context.moduleSystem.getModuleTimestamp(
                condition.relative.moduleId,
                condition.relative.state
            );
            if (!baseTime) return false;
            const relativePoint = new RelativeTimePoint(condition.relative);
            const targetTime = relativePoint.calculateAbsoluteTime(baseTime, this._timeUnits());
            return currentTime.isAfterOrEqual(targetTime);
        }
        if (mode === 'variable_compare') {
            // 日期变量比较：变量值应是 { year, month, day, ... } 形态
            const v = this.context.variableSystem.getValue(condition.variableId);
            if (!v || typeof v !== 'object') return false;
            const targetTime = new TimePoint(v);
            const cmp = currentTime.compare(targetTime);
            const op = condition.operator || '>=';
            if (op === '>=') return cmp >= 0;
            if (op === '<=') return cmp <= 0;
            if (op === '>') return cmp > 0;
            if (op === '<') return cmp < 0;
            if (op === '==') return cmp === 0;
            return false;
        }
        return false;
    }

    /**
     * time_range - check if current time is within a range
     * { type: 'time_range', timeType: 'absolute'|'relative', start: {...}, end: {...}, repeat?: { enabled, interval } }
     * repeat: 周期重复，如 interval: { month: 1 } 表示每月、{ year: 1 } 表示每年
     */
    evaluateTimeRange(condition) {
        const currentTime = this.context.timeSystem.getCurrentTime();
        const repeat = condition.repeat;

        if (repeat && repeat.enabled && repeat.interval) {
            return this._evaluateTimeRangeRepeat(condition, currentTime);
        }

        let startTime, endTime;

        if (condition.timeType === 'absolute') {
            startTime = new TimePoint(condition.start);
            endTime = new TimePoint(condition.end);
        } else if (condition.timeType === 'relative') {
            const startBase = this.context.moduleSystem.getModuleTimestamp(
                condition.start.moduleId,
                condition.start.state
            );
            const endBase = this.context.moduleSystem.getModuleTimestamp(
                condition.end.moduleId,
                condition.end.state
            );

            if (!startBase || !endBase) {
                return false;
            }

            const startRelative = new RelativeTimePoint(condition.start);
            const endRelative = new RelativeTimePoint(condition.end);
            startTime = startRelative.calculateAbsoluteTime(startBase, this._timeUnits());
            endTime = endRelative.calculateAbsoluteTime(endBase, this._timeUnits());
        } else {
            return false;
        }

        return currentTime.isAfterOrEqual(startTime) &&
            endTime.isAfterOrEqual(currentTime);
    }

    /**
     * 周期重复 time_range：当前时间是否落在「区间按 interval 重复」的某段内
     * interval 仅支持单键：year | month | day；区间内单位及更细单位参与比较
     * 支持 firstDayOnly：仅在每个周期的「区间起点等价位」触发——把区间起点当作"周期内第几天/月"，只在该位置满足
     */
    _evaluateTimeRangeRepeat(condition, currentTime) {
        const interval = condition.repeat.interval;
        const intervalKey = typeof interval === 'object' && interval !== null ? Object.keys(interval)[0] : null;
        if (!intervalKey || !['year', 'month', 'day'].includes(intervalKey)) {
            return false;
        }

        const unitOrder = ['year', 'month', 'day', 'hour', 'minute'];
        const idx = unitOrder.indexOf(intervalKey);
        const inCycleUnits = unitOrder.slice(idx);

        const startObj = condition.start || {};
        const endObj = condition.end || {};
        const presentFields = new Set([...Object.keys(startObj), ...Object.keys(endObj)].filter(k => unitOrder.includes(k)));

        // firstDayOnly：当前时间须恰好等于区间起点（按周期内单位）才触发，其它日期不算
        if (condition.firstDayOnly) {
            for (const unit of inCycleUnits) {
                if (!presentFields.has(unit)) continue;
                const startVal = startObj[unit] !== undefined ? startObj[unit] : 1;
                if (currentTime[unit] !== startVal) return false;
            }
            return true;
        }

        const defaultStart = { year: 1, month: 1, day: 1, hour: 0, minute: 0 };
        const defaultEnd = { year: 9999, month: 12, day: 31, hour: 23, minute: 59 };

        for (const unit of inCycleUnits) {
            if (!presentFields.has(unit)) continue;
            const startVal = startObj[unit] !== undefined ? startObj[unit] : defaultStart[unit];
            const endVal = endObj[unit] !== undefined ? endObj[unit] : defaultEnd[unit];
            const cur = currentTime[unit];
            if (cur < startVal || cur > endVal) {
                return false;
            }
        }
        return true;
    }

    /**
     * tag - check if tags match
     * { type: 'tag', matchType: 'any'|'all', tags: ['tag1', 'tag2'] }
     */
    evaluateTag(condition) {
        const { matchType, tags } = condition;
        if (!Array.isArray(tags)) return this._report('有一条标签条件没有设置标签，已按不满足处理。');
        const currentTags = this.context.getCurrentTags ? this.context.getCurrentTags() : [];

        if (matchType === 'any') {
            return tags.some(tag => currentTags.includes(tag));
        } else if (matchType === 'all') {
            return tags.every(tag => currentTags.includes(tag));
        }

        return false;
    }

    /**
     * Compare two values using an operator
     */
    compareValues(value1, operator, value2) {
        // 2026-06-05：condition-builder 保存 value 为 string（'10'），但 varValue 通常是 number → 严格 === 永远 false。
        // 数值类 operator 比较前都试 Number 双方 coerce；NaN 时 fallback 字符串严格比较；boolean 不动；in 不变。
        const tryNum = (v) => {
            if (typeof v === 'number') return v;
            if (typeof v === 'string' && v !== '' && /^-?\d*\.?\d+$/.test(v.trim())) return Number(v);
            return NaN;
        };
        const n1 = tryNum(value1);
        const n2 = tryNum(value2);
        const bothNum = !Number.isNaN(n1) && !Number.isNaN(n2);
        switch (operator) {
            case '>=':
                return bothNum ? n1 >= n2 : value1 >= value2;
            case '<=':
                return bothNum ? n1 <= n2 : value1 <= value2;
            case '==':
                if (bothNum) return n1 === n2;
                // 非数值场景：boolean 严格、字符串 trim 后比较（消除作者侧空格）
                if (typeof value1 === 'boolean' || typeof value2 === 'boolean') return value1 === value2;
                return String(value1).trim() === String(value2).trim();
            case '!=':
                if (bothNum) return n1 !== n2;
                if (typeof value1 === 'boolean' || typeof value2 === 'boolean') return value1 !== value2;
                return String(value1).trim() !== String(value2).trim();
            case '>':
                return bothNum ? n1 > n2 : value1 > value2;
            case '<':
                return bothNum ? n1 < n2 : value1 < value2;
            case 'in':
                // For arrays/lists；value2 是数组，bothNum 对它不适用，需对 value1 单独 coerce + 数组元素逐个比
                if (Array.isArray(value2)) {
                    if (value2.includes(value1)) return true;
                    const n1Try = tryNum(value1);
                    if (!Number.isNaN(n1Try) && value2.some(x => tryNum(x) === n1Try)) return true;
                    return false;
                }
                return false;
            default:
                return this._report(`比较方式「${operator}」不认识，已按不满足处理。`);
        }
    }

    /**
     * Evaluate a ConditionWrapper
     * @param {Object} wrapper - { type: 'precondition'|'display', conditionDef: {...} }
     * @returns {boolean}
     */
    evaluateWrapper(wrapper) {
        if (!wrapper || !wrapper.conditionDef) {
            return true;
        }

        return this.evaluate(wrapper.conditionDef, wrapper.type);
    }

    /**
     * Evaluate multiple ConditionWrappers (all must be true)
     * @param {Array} wrappers
     * @returns {boolean}
     */
    evaluateWrappers(wrappers) {
        if (!wrappers || wrappers.length === 0) {
            return true;
        }

        return wrappers.every(wrapper => this.evaluateWrapper(wrapper));
    }
}

// 导出到全局（浏览器环境）
if (typeof window !== 'undefined') {
    window.ConditionEvaluator = ConditionEvaluator;
}

// 导出（Node.js环境）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ConditionEvaluator };
}
