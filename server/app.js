/**
 * 本机服务：托管游戏页面（只托管白名单里的文件）并提供只对本机开放的接口。
 */
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { localOnly, checkLocalRequest } from './lib/local-guard.js';
import { isPublicPath, isLocalOnlyPath, readModuleKeys, readModuleList } from './lib/publish-rules.js';
import { router as chatRouter, probeClaudeCli } from './routes/chat-completions.js';
import { createRelayRouter } from './routes/relay.js';
import { createModulesRouter } from './routes/modules.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const SERVICE_NAME = 'bulimia-local';

/**
 * @param {{root?:string, relayHeaderTimeoutMs?:number, localModules?:boolean}} [opts]
 *   root 默认是仓库根；localModules 为真时并入 module/list.local.json 里的本机自用模组（本机启动时开启，其余场合不开）
 */
export function createApp(opts = {}) {
    const root = path.resolve(opts.root || path.join(HERE, '..'));
    const listOpts = { withLocal: opts.localModules === true };
    let realRoot;
    try { realRoot = fs.realpathSync(root); } catch { realRoot = root; }

    const app = express();
    app.disable('x-powered-by');
    app.set('etag', 'strong');

    app.use((req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        next();
    });

    // 接口：只允许本机页面使用的放在 localOnly 后面
    // 能力探测：只有本机页面才会看到可用的转发、写模组、命令行通道
    app.get('/api/capabilities', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const isLocal = checkLocalRequest(req) === null;
        res.json({
            service: SERVICE_NAME,
            relay: isLocal,
            moduleWrite: isLocal,
            localCli: isLocal ? await probeClaudeCli() : false
        });
    });
    app.use('/api/chat', localOnly, chatRouter);
    app.use('/api/relay', localOnly, createRelayRouter({ headerTimeoutMs: opts.relayHeaderTimeoutMs }));
    app.use('/api/modules', localOnly, createModulesRouter(path.join(root, 'module'), listOpts));
    app.use('/api', (req, res) => {
        res.status(404).json({ error: true, code: 'not-found-api', message: '没有这个接口。' });
    });

    // 模组登记表：永远剔除不发布的模组；本机启动时再并入 list.local.json 里的自用模组
    app.get('/module/list.json', (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.json(readModuleList(root, listOpts));
    });

    // 静态文件：只给白名单里的
    app.use((req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        let rel;
        try {
            rel = decodeURIComponent(req.path);
        } catch {
            return next();
        }
        if (rel === '/' || rel === '') rel = '/index.html';
        rel = rel.replace(/^\/+/, '');
        if (rel.includes(':') || /[. ]$/.test(rel) || rel.split('/').some(s => /[. ]$/.test(s))) return next();
        const ctx = { moduleKeys: readModuleKeys(root, listOpts) };
        if (!isPublicPath(rel, ctx) && !isLocalOnlyPath(rel)) return next();
        const abs = path.join(root, ...rel.split('/'));
        let real;
        try { real = fs.realpathSync(abs); } catch { return next(); }
        if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return next();
        res.setHeader('Cache-Control', 'no-store');
        res.sendFile(real, { dotfiles: 'deny' }, (err) => { if (err && !res.headersSent) next(); });
    });

    app.use((req, res) => {
        res.status(404);
        if (req.accepts(['html', 'json']) === 'json' || req.path.startsWith('/api')) {
            res.json({ error: true, code: 'not-found', message: '没有找到。' });
        } else {
            res.type('text/plain').send('没有找到。');
        }
    });

    // 错误处理：不把内部信息带给页面
    app.use((err, req, res, next) => {
        if (res.headersSent) return res.end();
        if (err && err.type === 'entity.too.large') return res.status(413).json({ error: true, code: 'too-large', message: '内容太大。' });
        if (err && (err.type === 'entity.parse.failed' || err.status === 400)) return res.status(400).json({ error: true, code: 'bad-request', message: '请求内容不正确。' });
        console.error('[server]', err && err.message);
        res.status(500).json({ error: true, code: 'server-error', message: '服务出错了，请稍后再试。' });
    });

    return app;
}
