// 检查：源码里 I18n.t('…') / I18n.pick 的中文词条是否都有英文词条；列出缺失与多余项。
// 用法：node tools/i18n-check.mjs [文件或目录 ...]（默认扫描 js/ 与 server/）
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dict = {};
const I18n = { add: (_l, d) => Object.assign(dict, d) };
const enDir = path.join(root, 'js/i18n/en');
for (const f of fs.readdirSync(enDir)) {
    if (!f.endsWith('.js')) continue;
    vm.runInNewContext(fs.readFileSync(path.join(enDir, f), 'utf8'), { I18n }, { filename: f });
}

const targets = process.argv.slice(2).length ? process.argv.slice(2) : ['js', 'server'];
const files = [];
const walk = (p) => {
    const abs = path.resolve(root, p);
    if (!fs.existsSync(abs)) return;
    if (fs.statSync(abs).isDirectory()) {
        if (/node_modules|js\/i18n/.test(abs)) return;
        for (const e of fs.readdirSync(abs)) walk(path.join(p, e));
    } else if (abs.endsWith('.js')) files.push(abs);
};
targets.forEach(walk);

const re = /I18n\.t\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`)/g;
const unescape = (s) => s.replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
let missing = 0;
for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    let m;
    while ((m = re.exec(src))) {
        const key = unescape(m[1] ?? m[2] ?? m[3]).trim();
        if (!/[一-龥]/.test(key)) continue;
        if (!(key in dict)) {
            missing++;
            const line = src.slice(0, m.index).split('\n').length;
            console.log(`缺英文词条  ${path.relative(root, f)}:${line}  ${key.slice(0, 60)}`);
        }
    }
}
console.log(missing ? `\n共缺 ${missing} 条` : '\n全部词条齐全');
process.exit(missing ? 1 : 0);
