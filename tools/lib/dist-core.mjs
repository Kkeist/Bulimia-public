// 出包的共用部分：白名单拷贝进发布目录、写缓存策略与 404 页、发布目录的结构自检。
// 私有仓库的 tools/build.mjs（再加内容扫描）和公开仓库里的构建脚本都用它；它只依赖 server/lib/publish-rules.js。
import fs from 'node:fs';
import path from 'node:path';
import { listPublicFiles, isPublicPath, readModuleKeys, readModuleList, isExcludedModule, moduleKeyOf, isTestModule } from '../../server/lib/publish-rules.js';

/** 发布目录里不许出现的内容（路径里的任一段，或扩展名） */
const FORBIDDEN_SEGMENTS = new Set(['tests', 'tools', 'server', 'docs', 'node_modules', '预览', '_templates']);
const FORBIDDEN_EXT = new Set(['.md', '.txt', '.bat', '.cmd', '.sh', '.ps1', '.docx', '.doc', '.log', '.cjs', '.mjs', '.map', '.bak', '.tmp', '.py']);

/** 缓存策略：发新版本后用户下次打开就是新版本，不需要清缓存 */
export const HEADERS_FILE = '/*\n  Cache-Control: no-cache\n  X-Content-Type-Options: nosniff\n';

/**
 * 404 页。托管平台在没有 404.html 时会把所有找不到的地址当单页应用回成 index.html（状态 200），
 * 页面里「这个文件不存在」的判断（如可选的数据文件）会被它骗过去；有了这一页，找不到的地址才会回 404。
 */
export const NOT_FOUND_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="only light">
<title>404</title>
<link rel="icon" href="/favicon.ico">
<style>
:root { color-scheme: only light; }
body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 1rem; background: #fff; color: #111; font: 1rem/1.6 system-ui, sans-serif; }
a { color: #111; }
</style>
</head>
<body>
<p>没有找到这个页面。 Page not found.</p>
<a href="/">返回首页 / Back</a>
</body>
</html>
`;

/** 不属于白名单、由构建单独写入的文件 */
const GENERATED = new Set(['_headers', '404.html']);

/**
 * 把 root 里的白名单文件拷进 outDir，写缓存策略与 404 页；extra 是 {from, to} 数组，额外拷进来的根文件。
 * 登记表只留下要发布的模组（不含测试模组）。
 * @returns {string[]} 白名单文件的相对路径
 */
export function copyWhitelist(root, outDir, extra = []) {
    const sourceFiles = listPublicFiles(root);
    fs.rmSync(outDir, { recursive: true, force: true });
    for (const rel of sourceFiles) {
        const dest = path.join(outDir, ...rel.split('/'));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (rel === 'module/list.json') fs.writeFileSync(dest, JSON.stringify(readModuleList(root, { forPublish: true }), null, 2) + '\n');
        else fs.copyFileSync(path.join(root, ...rel.split('/')), dest);
    }
    fs.mkdirSync(outDir, { recursive: true });
    for (const e of extra) fs.copyFileSync(path.join(root, ...e.from.split('/')), path.join(outDir, ...e.to.split('/')));
    fs.writeFileSync(path.join(outDir, '_headers'), HEADERS_FILE);
    fs.writeFileSync(path.join(outDir, '404.html'), NOT_FOUND_HTML);
    return sourceFiles;
}

/** 递归列出目录里的文件（相对路径） */
export function listFiles(dir) {
    const files = [];
    const walk = (rel) => {
        for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
            const r = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) walk(r); else files.push(r);
        }
    };
    walk('');
    return files;
}

/**
 * 发布目录的结构自检：不该出现的文件、登记表、页面引用、模组文件。
 * extraAllowed：除白名单外允许存在的根文件名。
 * @returns {string[]} 问题列表
 */
export function checkStructure(dir, extraAllowed = []) {
    const problems = [];
    const files = listFiles(dir);
    const ctx = { moduleKeys: readModuleKeys(dir, { forPublish: true }) };

    for (const f of files) {
        if (GENERATED.has(f) || f === '_redirects' || extraAllowed.includes(f)) continue;
        const segs = f.split('/');
        if (segs[0] === 'module' && segs.length > 1 && isExcludedModule(segs[1])) problems.push(`发布目录里有不发布的模组：${f}`);
        if (segs[0] === 'data') problems.push(`发布目录里有内容数据（data/ 不进发布物）：${f}`);
        const bad = segs.slice(0, -1).find(s => FORBIDDEN_SEGMENTS.has(s));
        if (bad) problems.push(`发布目录里有不该发布的目录：${f}`);
        const ext = path.posix.extname(f).toLowerCase();
        const isLicense = segs[0] === 'vendor' && /^LICENSE[\w.-]*\.txt$/i.test(segs[segs.length - 1]);
        if (FORBIDDEN_EXT.has(ext) && !isLicense) problems.push(`发布目录里有不该发布的文件类型：${f}`);
        if (/\.bak\b|\.tmp\b/.test(f)) problems.push(`发布目录里有备份或临时文件：${f}`);
        if (!isPublicPath(f, ctx)) problems.push(`不在白名单里的文件：${f}`);
    }

    // 登记表里不许有不发布的模组和测试模组
    try {
        const listed = JSON.parse(fs.readFileSync(path.join(dir, 'module', 'list.json'), 'utf8'));
        for (const e of Array.isArray(listed) ? listed : []) {
            if (isExcludedModule(moduleKeyOf(e) || '')) problems.push(`module/list.json 里登记了不发布的模组：${moduleKeyOf(e)}`);
            if (isTestModule(e)) problems.push(`module/list.json 里登记了测试模组：${moduleKeyOf(e)}`);
        }
    } catch { problems.push('缺少或读不出 module/list.json'); }

    // 页面引用的文件都在
    const indexPath = path.join(dir, 'index.html');
    if (!fs.existsSync(indexPath)) {
        problems.push('缺少 index.html');
    } else {
        const html = fs.readFileSync(indexPath, 'utf8');
        const refs = [...html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)=["']([^"']+)["']/gi)].map(m => m[1]);
        for (const ref of refs) {
            if (/^(?:[a-z]+:)?\/\//i.test(ref) || ref.startsWith('data:')) {
                problems.push(`页面引用了外部地址（离线或国内网络下会失效）：${ref}`);
                continue;
            }
            const clean = ref.split(/[?#]/)[0].replace(/^\.?\//, '');
            if (!fs.existsSync(path.join(dir, clean))) problems.push(`index.html 引用的文件不存在：${ref}`);
        }
    }

    // 运行时按路径取的文件也都在
    for (const key of ctx.moduleKeys) {
        if (!fs.existsSync(path.join(dir, 'module', key, 'module.json'))) problems.push(`模组 ${key} 缺少 module.json`);
    }
    // 没有 404 页时，找不到的地址会被回成 index.html
    if (!fs.existsSync(path.join(dir, '404.html'))) problems.push('缺少 404.html');
    return problems;
}
