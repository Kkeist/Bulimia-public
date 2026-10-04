// 公开仓库的构建脚本：node tools/build.mjs（导出到公开仓库时，本文件以 tools/build.mjs 的名字放进去）
// 把网页需要的文件（白名单）拷进 dist/，拷完做结构自检，不过不出包。
// 部署到静态托管时：构建命令 node tools/build.mjs，输出目录 dist。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyWhitelist, checkStructure, listFiles } from './lib/dist-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_NAME = 'dist';
const OUT = path.join(ROOT, OUT_NAME);

/** 许可证文本随网页一起发布（网页里的脚本就是受许可证约束的源码） */
const EXTRA = [{ from: 'LICENSE', to: 'LICENSE.txt' }];

/** 把 root 里的白名单文件拷进 outDir 并自检；有问题时 outDir 已被删除 */
export function runBuild(root, outDir) {
    const files = copyWhitelist(root, outDir, EXTRA);
    const problems = checkStructure(outDir, ['LICENSE.txt']);
    if (problems.length) fs.rmSync(outDir, { recursive: true, force: true });
    return { files, problems };
}

function main() {
    const { problems } = runBuild(ROOT, OUT);
    if (problems.length) {
        console.error(`\n构建没有通过自检，已删除 ${OUT_NAME}/，没有出包。共 ${problems.length} 个问题：`);
        for (const p of problems.slice(0, 80)) console.error('  - ' + p);
        process.exit(1);
    }
    console.log(`构建完成：${OUT_NAME}/ 共 ${listFiles(OUT).length} 个文件，自检通过。`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
