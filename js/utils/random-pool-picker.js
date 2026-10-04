/**
 * RandomPoolPicker —— 通用随机池抽取工具，支持模组 random-pools 文件夹里的随机池格式：
 *   poolType: single | multi | weighted | multi_dimension
 *   pickCount / pickCountRange: { min, max }
 *   conditions: { module:[...], gender:[...], ... } —— 池级与条级共用 matchConditions()
 *   entries: 字符串数组 或 [{ value, label?, weight?, conditions? }, ...]
 *   sections: { [sectionId]: <子池> } —— 复合池，每个 section 独立抽
 *
 * 设计目标：与 RandomizerPlugin 解耦，作者新池只需写 JSON 不动代码；
 * 抽取结果格式：
 *   single → 一个 entry（字符串或对象）
 *   multi → 数组
 *   weighted → 一个 entry
 *   multi_dimension → object，按 entries 内 dim 字段分桶各抽 1，{ dim: pickedEntry }
 *   sections → object { [sectionId]: 该 section 的抽取结果 }
 *
 * 错误处理：池为空 / 条件全过滤 / 格式不合法时返回 null，不抛异常。
 */
const RandomPoolPicker = {
    /** 主入口：传入完整 pool JSON 与上下文（如 { module:'high_school', gender:'female' }）→ 抽取结果。 */
    pick(pool, ctx) {
        if (pool == null) return null;
        const context = ctx && typeof ctx === 'object' ? ctx : {};
        // 裸数组：当 single 池处理（pool 即 entries），模组里较早写的池子是这种格式
        if (Array.isArray(pool)) return this._pickOne(this._normalizeEntries(pool));
        if (typeof pool !== 'object') return null;
        // 旧格式兼容：pool.items / pool.events / pool.values 当成 entries
        if (!pool.entries && !pool.sections && !pool.poolType && !pool.dimensions && !pool.categories) {
            const altList = Array.isArray(pool.items) ? pool.items
                : (Array.isArray(pool.events) ? pool.events
                : (Array.isArray(pool.values) ? pool.values
                : (Array.isArray(pool.list) ? pool.list : null)));
            if (altList) return this._pickOne(this._normalizeEntries(altList));
        }
        // 池级条件不过 → 返回 null（调用方可决定是否回退到别的池）
        if (pool.conditions && !this.matchConditions(pool.conditions, context)) return null;
        // 复合池（sections）→ 各 section 独立抽，结果是 dict
        if (pool.sections && typeof pool.sections === 'object') {
            const out = {};
            for (const [k, sub] of Object.entries(pool.sections)) {
                out[k] = this.pick(sub, context);
            }
            return out;
        }
        // 复合池另一形态：categories（与 sections 同义；部分模组的池子用这种结构）
        // 默认行为：所有 category 都抽一份；如调用方在 ctx 给 category（数组或字符串），只抽指定 category
        if (pool.categories && typeof pool.categories === 'object') {
            const out = {};
            const wanted = context.category || context.categories;
            const wantedSet = Array.isArray(wanted) ? new Set(wanted) : (wanted ? new Set([wanted]) : null);
            for (const [k, sub] of Object.entries(pool.categories)) {
                if (wantedSet && !wantedSet.has(k)) continue;
                out[k] = this.pick(sub, context);
            }
            return out;
        }
        const type = pool.poolType || 'single';
        // multi_dimension 用 pool.dimensions 数组时不走 entries 路径，需提前处理
        if (type === 'multi_dimension' && Array.isArray(pool.dimensions) && pool.dimensions.length > 0) {
            const dims = pool.dimensions.slice();
            const n = this._resolvePickCount(pool, dims.length);
            const picked = [];
            while (picked.length < n && dims.length > 0) {
                const idx = Math.floor(Math.random() * dims.length);
                picked.push(dims[idx]);
                dims.splice(idx, 1);
            }
            return picked.map(d => {
                const side = Math.random() < 0.5 ? 'left' : 'right';
                const words = Array.isArray(d[side]) && d[side].length ? d[side] : (Array.isArray(d.left) ? d.left : (Array.isArray(d.right) ? d.right : []));
                const word = words.length ? words[Math.floor(Math.random() * words.length)] : null;
                return { dimensionId: d.id, side, value: word };
            });
        }
        let entries = this._normalizeEntries(pool.entries);
        // 兜底：自定义嵌套对象（如 hs_food / clothes / city_build）没标准 entries，但深层有 array 字段；
        // 递归扫描所有 array 字段平铺当 entries（语义降级，但至少不报错；作者后续可改格式到标准 sections/categories 保留语义）
        if (entries.length === 0) {
            const collected = [];
            const walk = (v) => {
                if (Array.isArray(v)) {
                    v.forEach(it => { if (it != null && typeof it !== 'object') collected.push(it); else if (it && typeof it === 'object') collected.push(it); });
                } else if (v && typeof v === 'object') {
                    Object.values(v).forEach(walk);
                }
            };
            // 不走 description / version / poolId / strategy 等 meta 字段，避免误命中
            const META = new Set(['description','version','poolId','strategy','total_item_estimate','poolType','pickCount','pickCountRange','conditions','dimensions','sections','categories','entries','items','events','values','list','weights','note','zodiacByDate']);
            for (const [k, v] of Object.entries(pool)) {
                if (META.has(k)) continue;
                walk(v);
            }
            if (collected.length > 0) entries = this._normalizeEntries(collected);
        }
        const filtered = entries.filter(e => !e.conditions || this.matchConditions(e.conditions, context));
        if (filtered.length === 0) return null;
        if (type === 'weighted') return this._pickWeighted(filtered);
        if (type === 'multi') {
            const n = this._resolvePickCount(pool, filtered.length);
            return this._pickN(filtered, n);
        }
        if (type === 'multi_dimension') {
            // 形态 B：entries[].dimension 字段分桶（兼容旧实现）；形态 A 已在前面 pool.dimensions 路径处理
            const buckets = {};
            filtered.forEach(e => {
                const dim = e.dimension || e.dim || '__default__';
                (buckets[dim] = buckets[dim] || []).push(e);
            });
            const out = {};
            for (const [d, arr] of Object.entries(buckets)) {
                out[d] = this._pickOne(arr);
            }
            return out;
        }
        // single（默认）
        return this._pickOne(filtered);
    },

    /** 把 entries 归一为 [{ value, label, weight, conditions, ...rest }] —— 字符串项变 {value:str}，对象项保留全部字段。 */
    _normalizeEntries(entries) {
        if (!Array.isArray(entries)) return [];
        return entries.map(e => {
            if (e == null) return null;
            if (typeof e === 'string' || typeof e === 'number') return { value: e };
            if (typeof e !== 'object') return { value: e };
            return e;
        }).filter(Boolean);
    },

    /** 条件匹配：conditions 是 { key: [allowedValues] }；context[key] 在 allowed 列表里就算通过；所有 key 必须全过 = AND。 */
    matchConditions(conditions, context) {
        if (!conditions || typeof conditions !== 'object') return true;
        for (const [k, allowed] of Object.entries(conditions)) {
            const val = context[k];
            if (!Array.isArray(allowed)) {
                // 不是数组（如布尔/字符串）：直接相等比对
                if (val !== allowed) return false;
                continue;
            }
            if (allowed.length === 0) continue; // 空白名单视为不限制
            if (!allowed.includes(val)) return false;
        }
        return true;
    },

    _resolvePickCount(pool, available) {
        if (pool.pickCountRange && typeof pool.pickCountRange === 'object') {
            const min = Math.max(0, pool.pickCountRange.min | 0);
            const max = Math.max(min, pool.pickCountRange.max | 0);
            const n = min + Math.floor(Math.random() * (max - min + 1));
            return Math.min(n, available);
        }
        const fixed = pool.pickCount | 0;
        if (fixed > 0) return Math.min(fixed, available);
        return Math.min(1, available);
    },

    _pickOne(arr) {
        if (!arr || arr.length === 0) return null;
        const idx = Math.floor(Math.random() * arr.length);
        return arr[idx];
    },

    _pickWeighted(arr) {
        if (!arr || arr.length === 0) return null;
        const total = arr.reduce((s, e) => s + (Number(e.weight) > 0 ? Number(e.weight) : 1), 0);
        let r = Math.random() * total;
        for (const e of arr) {
            r -= Number(e.weight) > 0 ? Number(e.weight) : 1;
            if (r <= 0) return e;
        }
        return arr[arr.length - 1];
    },

    /** 不重复抽 n 个（按 weight 也支持，权重高优先）。 */
    _pickN(arr, n) {
        const pool = arr.slice();
        const out = [];
        while (out.length < n && pool.length > 0) {
            const total = pool.reduce((s, e) => s + (Number(e.weight) > 0 ? Number(e.weight) : 1), 0);
            let r = Math.random() * total;
            let idx = -1;
            for (let i = 0; i < pool.length; i++) {
                r -= Number(pool[i].weight) > 0 ? Number(pool[i].weight) : 1;
                if (r <= 0) { idx = i; break; }
            }
            if (idx < 0) idx = pool.length - 1;
            out.push(pool[idx]);
            pool.splice(idx, 1);
        }
        return out;
    },

    /** 仅取 value 字段的便捷形式（绝大多数调用方只关心 value）。 */
    pickValue(pool, ctx) {
        const r = this.pick(pool, ctx);
        if (r == null) return null;
        if (Array.isArray(r)) return r.map(it => (it && typeof it === 'object' && 'value' in it) ? it.value : it);
        if (typeof r === 'object' && 'value' in r) return r.value;
        // sections / multi_dimension：递归提
        if (typeof r === 'object') {
            const out = {};
            for (const [k, v] of Object.entries(r)) {
                if (v && typeof v === 'object' && 'value' in v) out[k] = v.value;
                else if (Array.isArray(v)) out[k] = v.map(it => (it && typeof it === 'object' && 'value' in it) ? it.value : it);
                else out[k] = v;
            }
            return out;
        }
        return r;
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = RandomPoolPicker;
} else if (typeof window !== 'undefined') {
    window.RandomPoolPicker = RandomPoolPicker;
}
