/**
 * Time System - 时间系统
 * Implements flexible time parameter system supporting base and computed types
 * Based on game-v4/docs/01-core-schemas.md
 */

/**
 * TimePoint - represents an absolute time point
 */
class TimePoint {
    constructor(config = {}) {
        this.year = config.year || 1;
        this.month = config.month || 1;
        this.day = config.day || 1;
        this.hour = config.hour || 0;
        this.minute = config.minute || 0;
    }

    clone() {
        return new TimePoint({
            year: this.year,
            month: this.month,
            day: this.day,
            hour: this.hour,
            minute: this.minute
        });
    }

    /**
     * Compare two time points
     * @returns -1 if this < other, 0 if equal, 1 if this > other
     */
    compare(other) {
        const fields = ['year', 'month', 'day', 'hour', 'minute'];
        for (const field of fields) {
            if (this[field] < other[field]) return -1;
            if (this[field] > other[field]) return 1;
        }
        return 0;
    }

    /**
     * Check if this time point is after or equal to another
     */
    isAfterOrEqual(other) {
        return this.compare(other) >= 0;
    }
}

/**
 * RelativeTimePoint - represents a time relative to a module event
 */
class RelativeTimePoint {
    constructor(config) {
        this.moduleId = config.moduleId;
        this.state = config.state; // 'entered' or 'completed'
        this.offset = config.offset || {}; // { year, month, day, hour, minute }
    }

    /**
     * Calculate absolute time based on module timestamp
     * @param {TimePoint} baseTime - the timestamp when the module reached the state
     * @returns {TimePoint}
     */
    calculateAbsoluteTime(baseTime, units) {
        const result = baseTime.clone();

        if (this.offset.year) result.year += this.offset.year;
        if (this.offset.month) result.month += this.offset.month;
        if (this.offset.day) result.day += this.offset.day;
        if (this.offset.hour) result.hour += this.offset.hour;
        if (this.offset.minute) result.minute += this.offset.minute;

        // 偏移加完后按模组的进位单位整理（日超过每月天数就进到下个月，依此类推）
        return units ? TimeSystem.normalize(result, units) : result;
    }
}

/**
 * TimeParameter - represents a single time parameter
 */
class TimeParameter {
    constructor(config) {
        this.id = config.id;
        this.type = config.type; // 'base' or 'computed'
        this.systemBinding = config.systemBinding; // for base type
        this.formula = config.formula; // for computed type, e.g., "day/12"
        this.labels = config.labels; // for computed type
        this.calculationOnly = config.calculationOnly || false;
    }

    /**
     * Calculate the value for this parameter
     * @param {Object} systemValues - current system parameter values
     * @returns {number} - the calculated index or value
     */
    calculate(systemValues) {
        if (this.type === 'base') {
            return systemValues[this.systemBinding];
        } else if (this.type === 'computed') {
            // Parse formula like "day/12"
            const [param, divisor] = this.formula.split('/');
            const value = systemValues[param.trim()];
            const div = parseInt(divisor.trim());
            return Math.floor(value / div) % this.labels.length;
        }
        return 0;
    }

    /**
     * Get display value (label or raw value)
     */
    getDisplayValue(systemValues) {
        const value = this.calculate(systemValues);
        if (this.labels && this.labels.length > 0) {
            return this.labels[value];
        }
        return value;
    }
}

/**
 * TimeSystem - manages the entire time system for a module
 */
class TimeSystem {
    constructor(config = {}) {
        this.parameters = [];
        this.systemValues = {
            year: 1,
            month: 1,
            day: 1,
            hour: 0,
            minute: 0,
            prefix: ''
        };
        this.displayFormat = (config && config.displayFormat) || '{{year}}-{{month}}-{{day}}';
        this.units = TimeSystem.resolveUnits(null);

        // Create parameter objects
        if (config.parameters && config.parameters.length > 0) {
            this.parameters = config.parameters.map(p => new TimeParameter(p));
        } else {
            // Default: 01-core-schemas 六项系统时间参数 year, month, day, hour, minute, prefix
            this.parameters = [
                new TimeParameter({ id: 'year', type: 'base', systemBinding: 'year' }),
                new TimeParameter({ id: 'month', type: 'base', systemBinding: 'month' }),
                new TimeParameter({ id: 'day', type: 'base', systemBinding: 'day' }),
                new TimeParameter({ id: 'hour', type: 'base', systemBinding: 'hour' }),
                new TimeParameter({ id: 'minute', type: 'base', systemBinding: 'minute' }),
                new TimeParameter({ id: 'prefix', type: 'base', systemBinding: 'prefix' })
            ];
        }

        // Set initial values
        if (config.initialValues) {
            this.setInitialValues(config.initialValues);
        }

        /** 上次时间推进的简要描述，用于 prompt 中的「时间已推进」提示，读取后清空 */
        this._lastTimeChange = null;
    }

    /** 进位单位的默认值：每小时 60 分、每天 24 小时、每月 30 天、每年 12 个月 */
    static resolveUnits(raw) {
        const u = raw && typeof raw === 'object' ? raw : {};
        const pos = (x, d) => (Number(x) > 0 ? Number(x) : d);
        return { mph: pos(u.minutesPerHour, 60), hpd: pos(u.hoursPerDay, 24), dpm: pos(u.daysPerMonth, 30), mpy: pos(u.monthsPerYear, 12) };
    }

    /** 进位：分 -> 时 -> 日 -> 月 -> 年（日、月从 1 起算）；直接改传入的对象并返回它 */
    static normalize(sv, units) {
        const mph = units.mph, hpd = units.hpd, dpm = units.dpm, mpy = units.mpy;
        if (typeof sv.minute === 'number') {
            while (sv.minute >= mph) { sv.minute -= mph; sv.hour = (sv.hour || 0) + 1; }
            while (sv.minute < 0) { sv.minute += mph; sv.hour = (sv.hour || 0) - 1; }
        }
        while (sv.hour >= hpd) { sv.hour -= hpd; sv.day = (sv.day || 1) + 1; }
        while (sv.hour < 0) { sv.hour += hpd; sv.day = (sv.day || 1) - 1; }
        while (sv.day > dpm) { sv.day -= dpm; sv.month = (sv.month || 1) + 1; }
        while (sv.day < 1) { sv.day += dpm; sv.month = (sv.month || 1) - 1; }
        while (sv.month > mpy) { sv.month -= mpy; sv.year = (sv.year || 1) + 1; }
        while (sv.month < 1) { sv.month += mpy; sv.year = (sv.year || 1) - 1; }
        return sv;
    }

    /** 设置进位单位；参数是模组配置里的 timeUnits（可以为空，用默认值） */
    setUnits(raw) {
        this.units = TimeSystem.resolveUnits(raw);
    }

    getUnits() {
        return this.units;
    }

    /**
     * Set initial time values
     */
    setInitialValues(initialValues) {
        // Set system values from initial values
        for (const param of this.parameters) {
            if (param.type === 'base' && initialValues[param.id] !== undefined) {
                this.systemValues[param.systemBinding] = initialValues[param.id];
            }
        }

        // Handle prefix separately
        if (initialValues.prefix !== undefined) {
            this.systemValues.prefix = initialValues.prefix;
        }
    }

    /**
     * Get current time point
     */
    getCurrentTime() {
        return new TimePoint({
            year: this.systemValues.year,
            month: this.systemValues.month,
            day: this.systemValues.day,
            hour: this.systemValues.hour,
            minute: this.systemValues.minute
        });
    }

    /**
     * 将普通对象转为 TimePoint（用于存档恢复等）
     * @param {Object} obj - { year, month, day, hour?, minute? }
     * @returns {TimePoint}
     */
    toTimePoint(obj) {
        if (!obj || typeof obj !== 'object') {
            return new TimePoint({});
        }
        if (obj instanceof TimePoint) return obj;
        return new TimePoint({
            year: obj.year ?? 1,
            month: obj.month ?? 1,
            day: obj.day ?? 1,
            hour: obj.hour ?? 0,
            minute: obj.minute ?? 0
        });
    }

    /**
     * Advance time by modifying bound parameters
     * @param {Object} changes - { parameterId: newValue }
     */
    advanceTime(changes) {
        const parts = [];
        for (const [parameterId, newValue] of Object.entries(changes)) {
            const param = this.parameters.find(p => p.id === parameterId);

            if (!param) {
                console.warn(`Parameter ${parameterId} not found`);
                continue;
            }

            if (param.calculationOnly) {
                console.warn(`Parameter ${parameterId} is calculationOnly, cannot be modified`);
                continue;
            }

            if (param.type === 'base') {
                const oldVal = this.systemValues[param.systemBinding];
                this.systemValues[param.systemBinding] = newValue;
                const displayVal = param.labels && param.labels[newValue] != null ? param.labels[newValue] : newValue;
                if (oldVal !== newValue) {
                    parts.push(`${param.id}→${displayVal}`);
                }
            } else {
                console.warn(`Cannot directly modify computed parameter ${parameterId}`);
            }
        }
        if (parts.length > 0) {
            this._lastTimeChange = parts.join(', ');
        }
    }

    /**
     * 获取上次时间推进的简要描述（用于 prompt 背景段「时间已推进」提示）
     * 调用后清空，保证只提示一次
     * @returns {string|null} 如 "day→8, hour→14" 或 null
     */
    getLastTimeChange() {
        const desc = this._lastTimeChange;
        this._lastTimeChange = null;
        return desc || null;
    }

    /**
     * Get all current parameter values for display
     */
    getAllValues() {
        const result = {};
        for (const param of this.parameters) {
            result[param.id] = param.getDisplayValue(this.systemValues);
        }
        return result;
    }

    /**
     * Format time for display
     */
    formatDisplay() {
        let result = this.displayFormat;
        const values = this.getAllValues();

        for (const [id, value] of Object.entries(values)) {
            result = result.replace(new RegExp(`\\{\\{${id}\\}\\}`, 'g'), value);
        }

        // Handle prefix separately
        if (this.systemValues.prefix) {
            result = result.replace(/\{\{prefix\}\}/g, () => this.systemValues.prefix); // 2026-06-05：function 形式防 $-marker（同 [[replace-dollar-marker-2026-06-05]] pattern）
        }

        return result;
    }

    /**
     * Get parameter by ID
     */
    getParameter(parameterId) {
        return this.parameters.find(p => p.id === parameterId);
    }

    /**
     * Get all parameters that can be advanced (not calculationOnly)
     */
    getAdvancableParameters() {
        return this.parameters.filter(p => !p.calculationOnly && p.type === 'base');
    }

    /**
     * Get formatted display time (alias for formatDisplay for compatibility)
     */
    getDisplayTime() {
        return this.formatDisplay();
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TimeSystem, TimePoint, RelativeTimePoint, TimeParameter };
}
