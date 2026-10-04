/**
 * Variable System - 变量系统
 * Comprehensive variable management with types, categories, scopes, and operations
 * Based on game-v4/docs/01-core-schemas.md
 */

const VARIABLE_TYPES = ['number', 'string', 'boolean', 'list', 'object', 'list_of_object'];

/** 各类型的默认初始值 */
function defaultValueForType(type) {
    switch (type) {
        case 'number': return 0;
        case 'string': return '';
        case 'boolean': return false;
        case 'list': return [];
        case 'object': return {};
        case 'list_of_object': return [];
        default: return undefined;
    }
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * 公式求值：只支持数字、字符串、布尔、{{变量}}、四则与取余、比较、&&、||、!、三目、
 * floor/ceil/round/min/max/abs。不执行任何其他代码。
 */
const FormulaEvaluator = {
    evaluate(source, lookup) {
        const tokens = this._tokenize(String(source));
        const state = { tokens, pos: 0, lookup };
        const value = this._ternary(state);
        if (state.pos < tokens.length) throw new Error('公式里有多余的内容');
        return value;
    },

    _tokenize(src) {
        const tokens = [];
        let i = 0;
        while (i < src.length) {
            const ch = src[i];
            if (/\s/.test(ch)) { i++; continue; }
            if (ch === '{' && src[i + 1] === '{') {
                const end = src.indexOf('}}', i + 2);
                if (end < 0) throw new Error('变量引用缺少结尾');
                tokens.push({ t: 'var', v: src.slice(i + 2, end).trim() });
                i = end + 2;
                continue;
            }
            if (/[0-9.]/.test(ch)) {
                let j = i;
                while (j < src.length && /[0-9.]/.test(src[j])) j++;
                const num = Number(src.slice(i, j));
                if (!Number.isFinite(num)) throw new Error('数字格式不正确');
                tokens.push({ t: 'num', v: num });
                i = j;
                continue;
            }
            if (ch === '"' || ch === "'") {
                let j = i + 1;
                let out = '';
                while (j < src.length && src[j] !== ch) {
                    if (src[j] === '\\' && j + 1 < src.length) { out += src[j + 1]; j += 2; } else { out += src[j]; j++; }
                }
                if (j >= src.length) throw new Error('文字缺少结尾引号');
                tokens.push({ t: 'str', v: out });
                i = j + 1;
                continue;
            }
            if (/[A-Za-z_]/.test(ch)) {
                let j = i;
                while (j < src.length && /[A-Za-z0-9_.]/.test(src[j])) j++;
                tokens.push({ t: 'id', v: src.slice(i, j) });
                i = j;
                continue;
            }
            const two = src.slice(i, i + 2);
            if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) { tokens.push({ t: 'op', v: two }); i += 2; continue; }
            if ('+-*/%()<>!?:,'.includes(ch)) { tokens.push({ t: 'op', v: ch }); i++; continue; }
            throw new Error('公式里有不能识别的字符：' + ch);
        }
        return tokens;
    },

    _peek(s) { return s.tokens[s.pos]; },
    _isOp(s, v) { const t = s.tokens[s.pos]; return t && t.t === 'op' && t.v === v; },
    _expect(s, v) { if (!this._isOp(s, v)) throw new Error('公式缺少 ' + v); s.pos++; },

    _ternary(s) {
        const cond = this._or(s);
        if (this._isOp(s, '?')) {
            s.pos++;
            const a = this._ternary(s);
            this._expect(s, ':');
            const b = this._ternary(s);
            return cond ? a : b;
        }
        return cond;
    },
    _or(s) { let v = this._and(s); while (this._isOp(s, '||')) { s.pos++; const r = this._and(s); v = v || r; } return v; },
    _and(s) { let v = this._cmp(s); while (this._isOp(s, '&&')) { s.pos++; const r = this._cmp(s); v = v && r; } return v; },
    _cmp(s) {
        let v = this._add(s);
        for (;;) {
            const t = this._peek(s);
            if (!(t && t.t === 'op' && ['==', '!=', '<', '>', '<=', '>='].includes(t.v))) return v;
            s.pos++;
            const r = this._add(s);
            switch (t.v) {
                case '==': v = v === r; break;
                case '!=': v = v !== r; break;
                case '<': v = v < r; break;
                case '>': v = v > r; break;
                case '<=': v = v <= r; break;
                default: v = v >= r;
            }
        }
    },
    _add(s) {
        let v = this._mul(s);
        for (;;) {
            if (this._isOp(s, '+')) { s.pos++; v = v + this._mul(s); }
            else if (this._isOp(s, '-')) { s.pos++; v = v - this._mul(s); }
            else return v;
        }
    },
    _mul(s) {
        let v = this._unary(s);
        for (;;) {
            if (this._isOp(s, '*')) { s.pos++; v = v * this._unary(s); }
            else if (this._isOp(s, '/')) { s.pos++; v = v / this._unary(s); }
            else if (this._isOp(s, '%')) { s.pos++; v = v % this._unary(s); }
            else return v;
        }
    },
    _unary(s) {
        if (this._isOp(s, '-')) { s.pos++; return -this._unary(s); }
        if (this._isOp(s, '!')) { s.pos++; return !this._unary(s); }
        return this._primary(s);
    },
    _primary(s) {
        const t = this._peek(s);
        if (!t) throw new Error('公式不完整');
        s.pos++;
        if (t.t === 'num' || t.t === 'str') return t.v;
        if (t.t === 'var') {
            const v = s.lookup(t.v);
            return v === undefined ? 0 : v;
        }
        if (t.t === 'id') {
            if (t.v === 'true') return true;
            if (t.v === 'false') return false;
            if (t.v === 'null') return null;
            const fn = t.v.replace(/^Math\./, '');
            const fns = { floor: Math.floor, ceil: Math.ceil, round: Math.round, min: Math.min, max: Math.max, abs: Math.abs };
            if (!fns[fn]) throw new Error('公式里不支持：' + t.v);
            this._expect(s, '(');
            const args = [];
            if (!this._isOp(s, ')')) {
                for (;;) { args.push(this._ternary(s)); if (this._isOp(s, ',')) { s.pos++; continue; } break; }
            }
            this._expect(s, ')');
            return fns[fn](...args);
        }
        if (t.t === 'op' && t.v === '(') {
            const v = this._ternary(s);
            this._expect(s, ')');
            return v;
        }
        throw new Error('公式里有多余的符号：' + t.v);
    }
};

/**
 * Variable - represents a single variable
 */
class Variable {
    constructor(config, ownerModuleId) {
        this.id = config.id;
        this.name = config.name;
        this.type = config.type; // number, string, boolean, list, object, list_of_object
        this.category = config.category; // module, switch, builtin, temp
        const initial = config.initialValue === undefined ? defaultValueForType(config.type) : config.initialValue;
        this.value = this.cloneValue(initial);
        this.initialValue = this.cloneValue(initial);
        this.readonly = config.readonly || false;
        this.ownerModuleId = ownerModuleId; // Which module owns this variable

        // AI interaction
        this.generalRules = config.generalRules || '';
        this.changeRules = config.changeRules || [];
        this.supportedOperations = config.supportedOperations || [];

        // Switch variable conditions
        this.switchConditions = config.switchConditions || [];

        // Builtin variable compute conditions
        this.computeConditions = config.computeConditions || [];

        // 类型扩展：数值范围、文字最大长度、列表元素类型、对象字段
        this.min = typeof config.min === 'number' && Number.isFinite(config.min) ? config.min : null;
        this.max = typeof config.max === 'number' && Number.isFinite(config.max) ? config.max : null;
        this.maxLength = typeof config.maxLength === 'number' && config.maxLength >= 0 ? config.maxLength : null;
        this.elementType = config.elementType || config.listItemType || null;

        // Schema for object/list_of_object
        this.listItemType = config.listItemType;
        this.objectSchema = config.objectSchema || [];
        this.fields = Array.isArray(config.fields) ? this.cloneValue(config.fields) : null;
        this.formulaError = null;
    }

    cloneValue(value) {
        if (value === null || value === undefined) return value;
        if (typeof value !== 'object') return value;
        return JSON.parse(JSON.stringify(value));
    }

    /**
     * 统一后的字段定义：[{ key, label, type, default, listItemType }]。
     * 来源可以是 fields（[{name,type,default}] 或字符串数组）或 objectSchema（[{id,name,type,listItemType}]）。
     */
    getFields() {
        const out = [];
        const push = (key, label, type, def, listItemType) => {
            const k = String(key == null ? '' : key).trim();
            if (!k || out.some(f => f.key === k)) return;
            const t = VARIABLE_TYPES.includes(type) ? type : 'string';
            out.push({ key: k, label: label || k, type: t, default: def === undefined ? defaultValueForType(t) : def, listItemType });
        };
        if (Array.isArray(this.fields)) {
            for (const f of this.fields) {
                if (typeof f === 'string') push(f, f, 'string');
                else if (isPlainObject(f)) push(f.name != null ? f.name : f.key, f.label || f.name || f.key, f.type, f.default, f.listItemType);
            }
        }
        if (Array.isArray(this.objectSchema)) {
            for (const f of this.objectSchema) {
                if (typeof f === 'string') push(f, f, 'string');
                else if (isPlainObject(f)) push(f.id != null ? f.id : f.name, f.name || f.id, f.type, f.default, f.listItemType);
            }
        }
        return out;
    }

    /**
     * Find a changeRule by name
     */
    getChangeRule(ruleName) {
        return this.changeRules.find(r => r.name === ruleName);
    }

    /**
     * Validate value against variable type
     */
    validateValue(value) {
        switch (this.type) {
            case 'number':
                return typeof value === 'number' && Number.isFinite(value);
            case 'string':
                return typeof value === 'string';
            case 'boolean':
                return typeof value === 'boolean';
            case 'list':
                return Array.isArray(value);
            case 'object':
                return isPlainObject(value) || (value === null && this.category === 'temp');
            case 'list_of_object':
                return Array.isArray(value) && value.every(item => isPlainObject(item));
            default:
                return false;
        }
    }

    /**
     * 把值收回到变量定义允许的范围内（数值 min/max、文字 maxLength）。
     * @returns {{ value: any, adjusted: boolean }}
     */
    clampValue(value) {
        if (this.type === 'number' && typeof value === 'number') {
            let v = value;
            if (this.min !== null && v < this.min) v = this.min;
            if (this.max !== null && v > this.max) v = this.max;
            return { value: v, adjusted: v !== value };
        }
        if (this.type === 'string' && typeof value === 'string' && this.maxLength !== null && value.length > this.maxLength) {
            return { value: value.slice(0, this.maxLength), adjusted: true };
        }
        return { value, adjusted: false };
    }

    /**
     * Reset to initial value
     */
    reset() {
        this.value = this.cloneValue(this.initialValue);
    }

    /**
     * Check if variable should be sent to AI based on category and conditions
     */
    shouldSendToAI(conditionEvaluator) {
        if (this.category === 'builtin' || this.category === 'temp') {
            return false;
        }

        if (this.category === 'module') {
            return true;
        }

        if (this.category === 'switch') {
            // Evaluate switchConditions（01-core-schemas: type 为 display | trigger，逻辑一致）
            for (const switchCond of this.switchConditions) {
                const isDisplay = switchCond.type === 'display';
                const isTrigger = switchCond.type === 'trigger';
                if (isDisplay || isTrigger) {
                    const mode = isDisplay ? 'display' : 'precondition';
                    const result = conditionEvaluator.evaluate(switchCond.condition, mode);
                    if (switchCond.action === 'open' && result) {
                        return true;
                    }
                    if (switchCond.action === 'close' && result) {
                        return false;
                    }
                }
            }
            // 无 switchConditions 时：有值则展示（常见「开关变量有值即开放」语义）
            if (this.switchConditions.length === 0) {
                const v = this.value;
                if (typeof v === 'string') return v.length > 0;
                if (typeof v === 'number') return v !== 0;
                if (typeof v === 'boolean') return v;
                if (v != null && typeof v === 'object') return Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0;
                return false;
            }
            return false;
        }

        return false;
    }

    /**
     * Compute value for builtin variables
     */
    computeValue(conditionEvaluator, variableSystem) {
        // 内置或带计算规则的 module 变量（如境界由修为推导）均参与计算
        const canCompute = this.category === 'builtin' || (this.category === 'module' && this.computeConditions && this.computeConditions.length > 0);
        if (!canCompute) return;

        for (const computeCond of this.computeConditions) {
            if (conditionEvaluator.evaluate(computeCond.conditionDef)) {
                const evaluated = this.evaluateFormula(computeCond.formula, variableSystem);
                if (evaluated.ok) {
                    this.formulaError = null;
                    this.value = evaluated.value;
                } else {
                    this.formulaError = evaluated.error;
                }
                return;
            }
        }
        // 无一满足时回退到初始值
        this.formulaError = null;
        this.value = this.cloneValue(this.initialValue);
    }

    /**
     * Evaluate a formula string。失败时返回 { ok:false, error }，由调用方决定如何呈现，不抛出也不改变当前值。
     * @returns {{ ok: boolean, value?: any, error?: string }}
     */
    evaluateFormula(formula, variableSystem) {
        try {
            const value = FormulaEvaluator.evaluate(formula, (id) => variableSystem.getValue(id));
            return { ok: true, value };
        } catch (e) {
            return { ok: false, error: `变量「${this.name || this.id}」的计算公式有误：${e.message}` };
        }
    }
}

/**
 * VariableSystem - manages all variables with scope resolution
 */
class VariableSystem {
    constructor() {
        this.variables = new Map(); // Map<variableId, Variable>
        this.moduleHierarchy = new Map(); // Map<moduleId, parentModuleId>
        this.conditionEvaluator = null; // Set externally
        /** 最近一次失败的写操作原因（面向创作者的中文），成功时为 null */
        this.lastError = null;
        /** 最近一次成功写入时被收回到范围内的说明，没有收回时为 null */
        this.lastAdjust = null;
    }

    /**
     * Set the condition evaluator for use in switch conditions
     */
    setConditionEvaluator(evaluator) {
        this.conditionEvaluator = evaluator;
    }

    /**
     * Register a variable
     */
    registerVariable(variable) {
        const existing = this.variables.get(variable.id);
        // 同一个模块重复注册（重新加载）是正常的；不同模块定义同名变量才是冲突
        if (existing && existing.ownerModuleId !== variable.ownerModuleId) {
            console.warn(`Variable ${variable.id} already defined by another module, overwriting`);
        }
        this.variables.set(variable.id, variable);
    }

    /**
     * Register multiple variables from a module
     */
    registerVariables(variableConfigs, ownerModuleId) {
        for (const config of variableConfigs) {
            const variable = new Variable(config, ownerModuleId);
            this.registerVariable(variable);
        }
    }

    /**
     * 移除一个变量
     * @returns {boolean} 是否存在并已移除
     */
    removeVariable(variableId) {
        return this.variables.delete(variableId);
    }

    /** 记录所有变量当前值，供重新注册后恢复 */
    snapshotValues() {
        const snap = new Map();
        for (const [id, v] of this.variables) snap.set(id, { type: v.type, value: v.cloneValue(v.value) });
        return snap;
    }

    /**
     * 把 snapshotValues 的值写回；类型变了的变量不恢复（取新定义的初始值）。
     * @param {Map} snap
     * @param {Set<string>} [onlyIds] 只恢复这些变量；省略则全部
     */
    restoreValues(snap, onlyIds) {
        for (const [id, rec] of snap) {
            if (onlyIds && !onlyIds.has(id)) continue;
            const v = this.variables.get(id);
            if (!v || v.type !== rec.type) continue;
            v.value = v.cloneValue(rec.value);
        }
    }

    /**
     * Set module hierarchy for scope resolution
     */
    setModuleHierarchy(hierarchy) {
        this.moduleHierarchy = new Map(Object.entries(hierarchy));
    }

    /**
     * Update module hierarchy with a new entry
     */
    addModuleToHierarchy(moduleId, parentModuleId) {
        this.moduleHierarchy.set(moduleId, parentModuleId);
    }

    /**
     * Get variable by ID
     */
    getVariable(variableId) {
        return this.variables.get(variableId);
    }

    /**
     * Get variable value
     */
    getValue(variableId) {
        const variable = this.getVariable(variableId);
        return variable ? variable.value : undefined;
    }

    /**
     * Check if a variable is visible from a given module (scope check)
     * Variable is visible if defined in the module or any ancestor module
     */
    isVariableVisibleInModule(variableId, moduleId) {
        const variable = this.getVariable(variableId);
        if (!variable) return false;

        // Check if moduleId is variable's owner or a descendant
        let currentModule = moduleId;
        const seen = new Set();
        while (currentModule && !seen.has(currentModule)) {
            if (currentModule === variable.ownerModuleId) {
                return true;
            }
            seen.add(currentModule);
            currentModule = this.moduleHierarchy.get(currentModule);
        }

        return false;
    }

    /**
     * Get all variables visible in a module
     */
    getVisibleVariables(moduleId) {
        const visible = [];
        for (const variable of this.variables.values()) {
            if (this.isVariableVisibleInModule(variable.id, moduleId)) {
                visible.push(variable);
            }
        }
        return visible;
    }

    /**
     * Get all variables that should be sent to AI from a module's perspective
     */
    getAIVisibleVariables(moduleId) {
        if (!this.conditionEvaluator) {
            console.warn('ConditionEvaluator not set, cannot determine switch variable visibility');
        }

        const visible = this.getVisibleVariables(moduleId);
        return visible.filter(v => v.shouldSendToAI(this.conditionEvaluator));
    }

    _fail(message) {
        this.lastError = message;
        console.error(message);
        return false;
    }

    /**
     * Execute an operation on a variable。成功返回 true；失败返回 false，原因在 lastError；
     * 数值或文字被收回到允许范围时，说明在 lastAdjust。
     * @param {string} variableId
     * @param {string} operation - e.g., 'add', 'set', 'append'
     * @param {*} params - operation parameters
     */
    executeOperation(variableId, operation, params) {
        this.lastError = null;
        this.lastAdjust = null;
        const variable = this.getVariable(variableId);
        if (!variable) {
            return this._fail(`没有找到变量「${variableId}」`);
        }

        if (variable.readonly) {
            return this._fail(`变量「${variable.name || variableId}」是只读的`);
        }

        const ok = this._dispatch(variable, operation, params);
        if (ok) this.updateBuiltinVariables();
        return ok;
    }

    _dispatch(variable, operation, params) {
        switch (operation) {
            case 'set':
                return this.opSet(variable, params);
            case 'add':
                return this.opAdd(variable, params);
            case 'subtract':
                return this.opSubtract(variable, params);
            case 'multiply':
                return this.opMultiply(variable, params);
            case 'divide':
                return this.opDivide(variable, params);
            case 'append':
                return this.opAppend(variable, params);
            case 'remove':
                return this.opRemove(variable, params);
            case 'extend':
                return this.opExtend(variable, params);
            case 'add_item':
                return this.opAddItem(variable, params);
            case 'modify_item':
                return this.opModifyItem(variable, params);
            case 'remove_item':
                return this.opRemoveItem(variable, params);
            default:
                return this._fail(`不支持的操作：${operation}`);
        }
    }

    /**
     * Execute a changeRule by name
     */
    executeChangeRule(variableId, ruleName, aiParams = {}) {
        const variable = this.getVariable(variableId);
        if (!variable) {
            return this._fail(`没有找到变量「${variableId}」`);
        }

        const rule = variable.getChangeRule(ruleName);
        if (!rule) {
            return this._fail(`变量「${variable.name || variableId}」没有名为「${ruleName}」的规则`);
        }

        // Process rule value, replacing $param placeholders with aiParams
        let processedValue = rule.value;
        if (rule.value !== null && typeof rule.value === 'object' && !Array.isArray(rule.value)) {
            processedValue = {};
            for (const [key, val] of Object.entries(rule.value)) {
                if (typeof val === 'string' && val.startsWith('$')) {
                    const paramName = val.substring(1);
                    processedValue[key] = aiParams[paramName];
                } else {
                    processedValue[key] = val;
                }
            }
        }

        return this.executeOperation(variableId, rule.operation, processedValue);
    }

    // ===== Operation Implementations =====

    /** 写入前统一收回范围，并记录收回说明 */
    _store(variable, value) {
        const { value: v, adjusted } = variable.clampValue(value);
        if (adjusted) {
            this.lastAdjust = variable.type === 'number'
                ? `变量「${variable.name || variable.id}」超出范围，已收回到 ${v}`
                : `变量「${variable.name || variable.id}」超出最大长度，已截取`;
        }
        variable.value = variable.cloneValue(v);
        return true;
    }

    _unwrap(params) {
        return (params && typeof params === 'object' && !Array.isArray(params) && 'value' in params) ? params.value : params;
    }

    opSet(variable, params) {
        // 内置变量不可被 set，仅由 computeConditions 计算
        if (variable.category === 'builtin') {
            return this._fail(`变量「${variable.name || variable.id}」是自动计算的，不能直接修改`);
        }
        // params can be either a direct value or {value: actualValue}
        const value = this._unwrap(params);

        if (!variable.validateValue(value)) {
            return this._fail(`变量「${variable.name || variable.id}」的值类型不正确`);
        }
        return this._store(variable, value);
    }

    _numericOperand(variable, params, opName) {
        if (variable.type !== 'number') {
            this._fail(`${opName}只能用于数值变量`);
            return null;
        }
        const value = this._unwrap(params);
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            this._fail(`变量「${variable.name || variable.id}」的${opName}需要一个数字`);
            return null;
        }
        return value;
    }

    opAdd(variable, params) {
        const value = this._numericOperand(variable, params, '加法');
        if (value === null) return false;
        return this._store(variable, variable.value + value);
    }

    opSubtract(variable, params) {
        const value = this._numericOperand(variable, params, '减法');
        if (value === null) return false;
        return this._store(variable, variable.value - value);
    }

    opMultiply(variable, params) {
        const value = this._numericOperand(variable, params, '乘法');
        if (value === null) return false;
        const result = variable.value * value;
        if (!Number.isFinite(result)) return this._fail(`变量「${variable.name || variable.id}」乘法的结果超出范围`);
        return this._store(variable, result);
    }

    opDivide(variable, params) {
        const value = this._numericOperand(variable, params, '除法');
        if (value === null) return false;
        if (value === 0) {
            return this._fail(`变量「${variable.name || variable.id}」不能除以 0`);
        }
        return this._store(variable, variable.value / value);
    }

    _elementOk(variable, item) {
        const t = variable.elementType;
        if (!t) return true;
        switch (t) {
            case 'number': return typeof item === 'number' && Number.isFinite(item);
            case 'string': return typeof item === 'string';
            case 'boolean': return typeof item === 'boolean';
            case 'object': return isPlainObject(item);
            default: return true;
        }
    }

    opAppend(variable, value) {
        if (variable.type !== 'list') {
            return this._fail('追加只能用于列表变量');
        }
        if (!this._elementOk(variable, value)) {
            return this._fail(`变量「${variable.name || variable.id}」的列表元素类型不符`);
        }
        variable.value.push(value);
        return true;
    }

    opRemove(variable, value) {
        if (variable.type !== 'list') {
            return this._fail('移除只能用于列表变量');
        }
        const index = variable.value.indexOf(value);
        if (index > -1) {
            variable.value.splice(index, 1);
        }
        return true;
    }

    opExtend(variable, values) {
        if (variable.type !== 'list') {
            return this._fail('合并只能用于列表变量');
        }
        if (!Array.isArray(values)) {
            return this._fail('合并需要一个列表');
        }
        if (!values.every(x => this._elementOk(variable, x))) {
            return this._fail(`变量「${variable.name || variable.id}」的列表元素类型不符`);
        }
        variable.value.push(...values);
        return true;
    }

    opAddItem(variable, item) {
        if (variable.type !== 'list_of_object') {
            return this._fail('添加条目只能用于对象列表变量');
        }
        if (!isPlainObject(item)) {
            return this._fail('添加的条目必须是对象');
        }
        variable.value.push(item);
        return true;
    }

    opModifyItem(variable, params) {
        if (variable.type !== 'list_of_object' && variable.type !== 'object') {
            return this._fail('修改字段只能用于对象或对象列表变量');
        }
        if (!isPlainObject(params)) {
            return this._fail('修改字段需要说明字段与操作');
        }

        const { index, field, op, value } = params;
        if (typeof field !== 'string' || !field) {
            return this._fail('修改字段需要字段名');
        }

        let target;
        if (variable.type === 'list_of_object') {
            if (!Number.isInteger(index) || index < 0 || index >= variable.value.length) {
                return this._fail(`序号 ${index} 超出范围`);
            }
            target = variable.value[index];
        } else {
            target = variable.value;
        }
        if (op === 'set') {
            target[field] = value;
        } else if ((op === 'add' || op === 'subtract') && typeof target[field] === 'number' && typeof value === 'number' && Number.isFinite(value)) {
            target[field] = op === 'add' ? target[field] + value : target[field] - value;
        } else {
            return this._fail(`字段「${field}」不支持操作 ${op}`);
        }
        return true;
    }

    opRemoveItem(variable, index) {
        if (variable.type !== 'list_of_object') {
            return this._fail('移除条目只能用于对象列表变量');
        }
        if (!Number.isInteger(index) || index < 0 || index >= variable.value.length) {
            return this._fail(`序号 ${index} 超出范围`);
        }
        variable.value.splice(index, 1);
        return true;
    }

    /**
     * Update all builtin variables
     */
    updateBuiltinVariables() {
        if (!this.conditionEvaluator) return;

        for (const variable of this.variables.values()) {
            if (variable.category === 'builtin' || (variable.category === 'module' && variable.computeConditions && variable.computeConditions.length > 0)) {
                variable.computeValue(this.conditionEvaluator, this);
            }
        }
    }

    /**
     * 当前所有变量的问题（公式出错等），每条是可直接给创作者看的中文。
     * @returns {string[]}
     */
    problems() {
        const out = [];
        for (const v of this.variables.values()) if (v.formulaError) out.push(v.formulaError);
        return out;
    }

    /**
     * Reset all variables to initial values
     */
    resetAll() {
        for (const variable of this.variables.values()) {
            variable.reset();
        }
    }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.VARIABLE_TYPES = VARIABLE_TYPES;
    window.FormulaEvaluator = FormulaEvaluator;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { VariableSystem, Variable, FormulaEvaluator, VARIABLE_TYPES };
}
