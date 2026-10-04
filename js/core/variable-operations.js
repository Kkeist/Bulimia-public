/**
 * 系统内置变量操作（add、minus、set、时间推进等）
 * 对应不同类型的数据，由系统执行计算，防止 AI 自行算错。
 * 供 <variables> 解析与变量 changeRules 触发使用。
 */

const VariableOperations = {
    /**
     * 根据变量类型与操作名执行操作，返回新值（不写回 State，由调用方写入）
     * @param {string} op - 操作名：set | add | minus | multiply | advanceDay | advanceMonth | advanceYear | listAppend | listRemove | stringAppend
     * @param {any} currentValue - 当前变量值
     * @param {any} value - 操作参数（如 add 的加数、advanceDay 的天数）
     * @param {string} [type] - 变量类型：number | string | boolean | date | list | object
     * @returns {{ ok: boolean, value?: any, error?: string }}
     */
    apply(op, currentValue, value, type) {
        const t = (type || this._inferType(currentValue)).toLowerCase();
        try {
            if (op === 'set') return { ok: true, value: this._parseValue(value, t) };
            if (t === 'number') return this._opNumber(op, currentValue, value);
            if (t === 'date') return this._opDate(op, currentValue, value);
            if (t === 'list') return this._opList(op, currentValue, value);
            if (t === 'string') return this._opString(op, currentValue, value);
            if (t === 'boolean') return { ok: true, value: this._parseValue(value, 'boolean') };
            if (t === 'object') return this._opObject(op, currentValue, value);
            return { ok: false, error: I18n.t('未知类型: {type}', { type: t }) };
        } catch (e) {
            return { ok: false, error: (e && e.message) || String(e) };
        }
    },

    _inferType(v) {
        if (v === null || v === undefined) return 'string';
        if (typeof v === 'number') return 'number';
        if (typeof v === 'boolean') return 'boolean';
        if (Array.isArray(v)) return 'list';
        if (typeof v === 'object' && v !== null && ('year' in v || 'era' in v || 'day' in v)) return 'date';
        if (typeof v === 'object') return 'object';
        return 'string';
    },

    _parseValue(value, type) {
        if (value === undefined || value === null) return value;
        if (type === 'number') return Number(value);
        if (type === 'boolean') return value === true || value === 'true' || value === '1';
        if (type === 'list') return Array.isArray(value) ? value : (typeof value === 'string' && (value.startsWith('[') || value.startsWith('{')) ? (() => { try { return JSON.parse(value); } catch (_) { return [value]; } })() : [value]);
        if (type === 'date') return typeof value === 'object' && value !== null ? value : (typeof value === 'string' && value.startsWith('{') ? (() => { try { return JSON.parse(value); } catch (_) { return null; } })() : null);
        if (type === 'object') return typeof value === 'object' && value !== null ? value : (typeof value === 'string' && value.startsWith('{') ? (() => { try { return JSON.parse(value); } catch (_) { return {}; } })() : {});
        return String(value);
    },

    _opNumber(op, current, value) {
        const cur = Number(current);
        const delta = Number(value);
        if (Number.isNaN(cur)) return { ok: false, error: I18n.t('当前值非数字') };
        if (Number.isNaN(delta) && op !== 'set') return { ok: false, error: I18n.t('操作参数非数字') };
        switch (op) {
            case 'add': return { ok: true, value: cur + delta };
            case 'minus': return { ok: true, value: cur - delta };
            case 'multiply': return { ok: true, value: cur * delta };
            case 'divide': return delta === 0 ? { ok: false, error: I18n.t('除数为0') } : { ok: true, value: cur / delta };
            case 'set': return { ok: true, value: this._parseValue(value, 'number') };
            default: return { ok: false, error: I18n.t('number 不支持操作: {op}', { op }) };
        }
    },

    _addDays(cur, n) {
        let day = (cur.day != null ? cur.day : 1) + n;
        let month = cur.month != null ? cur.month : 1;
        let year = cur.year != null ? cur.year : 1;
        const daysInMonth = (m, y) => new Date(y, m, 0).getDate();
        while (day > daysInMonth(month, year)) {
            day -= daysInMonth(month, year);
            month++;
            if (month > 12) { month = 1; year++; }
        }
        while (day < 1) {
            month--;
            if (month < 1) { month = 12; year--; }
            day += daysInMonth(month, year);
        }
        return { ...cur, year, month, day };
    },

    _opDate(op, current, value) {
        const cur = current && typeof current === 'object' ? { ...current } : { era: '', year: 1, month: 1, day: 1 };
        const n = parseInt(value, 10) || 1;
        const hoursPerDay = 24;
        switch (op) {
            case 'advanceDay':
            case 'advance_day':
                return { ok: true, value: this._addDays(cur, n) };
            case 'advanceMonth':
            case 'advance_month': {
                let month = (cur.month != null ? cur.month : 1) + n;
                let year = cur.year != null ? cur.year : 1;
                while (month > 12) { month -= 12; year++; }
                while (month < 1) { month += 12; year--; }
                const day = Math.min(cur.day != null ? cur.day : 1, new Date(year, month, 0).getDate());
                return { ok: true, value: { ...cur, year, month, day } };
            }
            case 'advanceYear':
            case 'advance_year': {
                const year = (cur.year != null ? cur.year : 1) + n;
                return { ok: true, value: { ...cur, year } };
            }
            case 'advanceHour':
            case 'advance_hour': {
                let hour = (cur.hour != null ? cur.hour : 0) + n;
                let c = { ...cur };
                while (hour >= hoursPerDay) {
                    hour -= hoursPerDay;
                    c = this._addDays(c, 1);
                }
                while (hour < 0) {
                    hour += hoursPerDay;
                    c = this._addDays(c, -1);
                }
                return { ok: true, value: { ...c, hour } };
            }
            case 'advanceMinute':
            case 'advance_minute': {
                let minute = (cur.minute != null ? cur.minute : 0) + n;
                let hour = cur.hour != null ? cur.hour : 0;
                while (minute >= 60) {
                    minute -= 60;
                    hour++;
                }
                while (minute < 0) {
                    minute += 60;
                    hour--;
                }
                let c = { ...cur };
                while (hour >= hoursPerDay) {
                    hour -= hoursPerDay;
                    c = this._addDays(c, 1);
                }
                while (hour < 0) {
                    hour += hoursPerDay;
                    c = this._addDays(c, -1);
                }
                return { ok: true, value: { ...c, hour, minute } };
            }
            case 'set':
                return { ok: true, value: this._parseValue(value, 'date') || cur };
            default:
                return { ok: false, error: I18n.t('date 不支持操作: {op}', { op }) };
        }
    },

    _opList(op, current, value) {
        const cur = Array.isArray(current) ? [...current] : [];
        // 2026-06-05：append 长度 cap 防 AI 多次 append 累爆 State。超 MAX_LIST_LEN 时 FIFO 丢最早项。
        const MAX_LIST_LEN = 1000;
        switch (op) {
            case 'append':
            case 'listAppend':
            case 'list_append': {
                const item = typeof value === 'string' && (value.startsWith('[') || value.startsWith('{')) ? (() => { try { return JSON.parse(value); } catch (_) { return value; } })() : value;
                cur.push(item);
                while (cur.length > MAX_LIST_LEN) cur.shift();
                return { ok: true, value: cur };
            }
            case 'remove':
            case 'listRemove':
            case 'list_remove': {
                const idx = parseInt(value, 10);
                if (Number.isNaN(idx) || idx < 0 || idx >= cur.length) return { ok: false, error: I18n.t('无效索引') };
                cur.splice(idx, 1);
                return { ok: true, value: cur };
            }
            case 'set':
                return { ok: true, value: this._parseValue(value, 'list') };
            default:
                return { ok: false, error: I18n.t('list 不支持操作: {op}', { op }) };
        }
    },

    _opString(op, current, value) {
        const cur = current != null ? String(current) : '';
        // 2026-06-05：append 总长 cap 防 AI 多次 append 累爆 State。超 MAX_STRING_LEN 时滚动丢前 TRIM_LEN（保留最近上下文）。
        const MAX_STRING_LEN = 100000;
        const TRIM_LEN = 10000;
        switch (op) {
            case 'append':
            case 'stringAppend':
            case 'string_append': {
                let next = cur + String(value != null ? value : '');
                if (next.length > MAX_STRING_LEN) next = next.slice(TRIM_LEN);
                return { ok: true, value: next };
            }
            case 'set':
                return { ok: true, value: String(value != null ? value : '') };
            default:
                return { ok: false, error: I18n.t('string 不支持操作: {op}', { op }) };
        }
    },

    _opObject(op, current, value) {
        if (op !== 'set') return { ok: false, error: I18n.t('object 仅支持 set') };
        return { ok: true, value: this._parseValue(value, 'object') };
    },

    /**
     * 解析一行 <variables> 中的“值”部分：若为操作语法则返回 { op, value }，否则返回 null 表示直接赋值
     * 支持：add(10)、minus(5)、+10、-5、advanceDay(1)、listAppend({...}) 等
     */
    parseOperationSyntax(valueStr) {
        if (valueStr == null || typeof valueStr !== 'string') return null;
        const s = valueStr.trim();
        const addMatch = s.match(/^\+(\d*\.?\d+)$/);
        if (addMatch) return { op: 'add', value: parseFloat(addMatch[1]) };
        const minusMatch = s.match(/^-(\d*\.?\d+)$/);
        if (minusMatch) return { op: 'minus', value: parseFloat(minusMatch[1]) };
        const fnMatch = s.match(/^(\w+)\s*\(\s*([\s\S]*)\s*\)$/);
        if (fnMatch) {
            const op = fnMatch[1];
            let arg = fnMatch[2].trim();
            if ((arg.startsWith('{') && arg.endsWith('}')) || (arg.startsWith('[') && arg.endsWith(']'))) {
                try { arg = JSON.parse(arg); } catch (_) { }
            } else if (/^-?\d*\.?\d+$/.test(arg)) arg = parseFloat(arg);
            return { op, value: arg };
        }
        return null;
    }
};

if (typeof window !== 'undefined') {
    window.VariableOperations = VariableOperations;
}
