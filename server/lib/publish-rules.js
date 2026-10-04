/**
 * 网页可见文件的白名单：本机服务按它托管静态文件，构建脚本按它拷贝发布目录。
 * 路径一律是相对仓库根的 POSIX 路径（正斜杠）。不在白名单里的文件对网页不可见。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 模组文件夹里允许发布的子目录（其余如 docs、tests、scripts 里的 .mjs 一律不发） */
const MODULE_SUBDIRS = ['plugins', 'random-pools', 'patches', 'scripts', 'assets'];

/** 允许出现在发布物里的扩展名 */
const ALLOWED_EXT = new Set([
    '.html', '.css', '.js', '.json', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico',
    '.woff', '.woff2', '.webmanifest', '.xml'
]);

/** 仓库根下的单个文件 */
const ROOT_FILES = new Set([
    'index.html', 'favicon.ico', 'apple-touch-icon.png', 'manifest.webmanifest', 'site.webmanifest', 'browserconfig.xml'
]);

/** 仓库根下按前缀整目录放行的静态资源目录 */
const ROOT_DIRS = ['css', 'js', 'vendor', 'icons'];

/** 目录里单独排除的子路径前缀 */
const EXCLUDED_PREFIXES = ['js/tests/'];

/** 备份、临时、编辑器残留文件 */
const JUNK_RE = /(\.bak(\.|$)|\.tmp(\.|$)|~$|\.orig$|\.swp$)/i;

/** 永远不发布的模组文件夹名（小写比较）：即使被登记进 list.json 也不放行 */
export const EXCLUDED_MODULES = [];

/** 只在本机使用的模组登记表（不进仓库、不进发布物）：格式与 list.json 相同 */
export const LOCAL_LIST_NAME = 'list.local.json';

export function isExcludedModule(key) {
    return EXCLUDED_MODULES.includes(String(key).toLowerCase());
}

function readListFile(file) {
    let arr;
    try {
        arr = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return [];
    }
    return Array.isArray(arr) ? arr : [];
}

/** 登记表里标了 isTest 的测试模组：本机开发测试用，出包与导出时去掉 */
export function isTestModule(entry) {
    return !!entry && typeof entry === 'object' && entry.isTest === true;
}

/**
 * module/list.json 里登记的条目；withLocal 为真时再并入 list.local.json（本机自用模组）。
 * 永远剔除不发布的模组；forPublish 为真（出包、导出）时再剔除 isTest 的测试模组。
 */
export function readModuleList(root, { withLocal = false, forPublish = false } = {}) {
    const dir = path.join(root, 'module');
    const entries = readListFile(path.join(dir, 'list.json'));
    if (!withLocal) return entries.filter(e => !isExcludedModule(moduleKeyOf(e) || '') && !(forPublish && isTestModule(e)));
    const seen = new Set(entries.map(moduleKeyOf));
    for (const e of readListFile(path.join(dir, LOCAL_LIST_NAME))) {
        const key = moduleKeyOf(e);
        if (key && !seen.has(key)) { entries.push(e); seen.add(key); }
    }
    return forPublish ? entries.filter(e => !isTestModule(e)) : entries;
}

/** 读出模组文件夹名 */
export function readModuleKeys(root, opts) {
    const keys = [];
    for (const entry of readModuleList(root, opts)) {
        const key = moduleKeyOf(entry);
        if (key && isSafeSegment(key)) keys.push(key);
    }
    return keys;
}

/** list.json 的一项对应的文件夹名：优先取 path 最后一段，其次 id */
export function moduleKeyOf(entry) {
    if (!entry || typeof entry !== 'object') return null;
    if (entry.path) {
        const segs = String(entry.path).split(/[\\/]/).filter(Boolean);
        return segs[segs.length - 1] || null;
    }
    if (entry.id) return String(entry.id);
    return null;
}

export function isSafeSegment(seg) {
    return typeof seg === 'string' && /^[A-Za-z0-9_\-]+$/.test(seg);
}

/**
 * 某个相对路径是否允许被网页访问。
 * @param {string} rel 相对仓库根的 POSIX 路径
 * @param {{moduleKeys:string[]}} ctx
 */
export function isPublicPath(rel, ctx) {
    if (typeof rel !== 'string' || !rel || rel.includes('\0') || rel.includes('\\')) return false;
    const segs = rel.split('/');
    if (segs.some(s => s === '' || s === '.' || s === '..' || s.startsWith('.'))) return false;
    const base = segs[segs.length - 1];
    if (JUNK_RE.test(base)) return false;
    const ext = path.posix.extname(base).toLowerCase();
    // 第三方脚本随带的许可证文本（vendor/<库名>/LICENSE.txt）
    const isVendorLicense = segs[0] === 'vendor' && segs.length >= 3 && /^LICENSE[\w.-]*\.txt$/i.test(base);
    if (!ALLOWED_EXT.has(ext) && !isVendorLicense) return false;

    if (segs.length === 1) {
        return ROOT_FILES.has(base);
    }

    if (EXCLUDED_PREFIXES.some(p => rel.startsWith(p))) return false;

    const top = segs[0];
    if (ROOT_DIRS.includes(top)) {
        if (top === 'js' && ext !== '.js') return false;
        if (top === 'vendor' && (ext === '.json' || ext === '.html')) return false;
        return true;
    }

    if (top === 'module') {
        if (segs.length === 2) return base === 'list.json';
        const key = segs[1];
        if (!isSafeSegment(key) || !ctx.moduleKeys.includes(key)) return false;
        if (segs.length === 3) return base === 'module.json';
        const sub = segs[2];
        if (!MODULE_SUBDIRS.includes(sub)) return false;
        if (sub === 'scripts' && ext !== '.js') return false;
        return true;
    }

    return false;
}

/**
 * 只有本机直接运行服务时才托管的文件：内置写作指导数据（data/builtin-presets/*.json）。
 * 它不在 isPublicPath 里，出包与导出都不会带上它；这个目录不存在是合法状态。
 */
export function isLocalOnlyPath(rel) {
    if (typeof rel !== 'string' || !rel || rel.includes('\0') || rel.includes('\\')) return false;
    const segs = rel.split('/');
    if (segs.length !== 3 || segs.some(s => s === '' || s === '.' || s === '..' || s.startsWith('.'))) return false;
    return segs[0] === 'data' && segs[1] === 'builtin-presets' && path.posix.extname(segs[2]).toLowerCase() === '.json' && !JUNK_RE.test(segs[2]);
}

/** 递归列出仓库里所有会被发布（出包、导出）的网页文件（相对路径）；不含测试模组 */
export function listPublicFiles(root) {
    const ctx = { moduleKeys: readModuleKeys(root, { forPublish: true }) };
    const out = [];
    const walk = (dirRel) => {
        const abs = path.join(root, dirRel);
        let entries;
        try {
            entries = fs.readdirSync(abs, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of entries) {
            if (e.name.startsWith('.') || e.name === 'node_modules') continue;
            const rel = dirRel ? `${dirRel}/${e.name}` : e.name;
            if (e.isDirectory()) {
                if (!dirRel && !ROOT_DIRS.includes(e.name) && e.name !== 'module') continue;
                walk(rel);
            } else if (e.isFile() && isPublicPath(rel, ctx)) {
                out.push(rel);
            }
        }
    };
    walk('');
    return out.sort();
}
