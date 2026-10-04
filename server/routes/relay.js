/**
 * /api/relay —— 本机转发：页面把请求交给本机服务，由本机服务去访问用户填写的 AI 服务地址。
 * 用来绕开浏览器对跨域的限制（例如没有开放跨域的官方接口、没开跨域的本地模型）。
 *
 * 约束：
 *  - 只允许本机页面调用（见 app.js 的挂载）。
 *  - 目标地址只能是 http / https，且不带账号密码；不跟随跳转。
 *  - 只转发白名单里的请求头；密钥随请求头经过这里，不写日志、不落盘。
 *  - 请求体和响应体都不记录。
 * 本机服务只对本机页面开放，所以回环地址、局域网地址（本地模型）都允许作为目标。
 */
import express, { Router } from 'express';
import { Readable } from 'node:stream';

const ALLOWED_HEADERS = new Set([
    'content-type', 'accept', 'authorization', 'x-api-key', 'x-goog-api-key',
    'anthropic-version', 'anthropic-beta', 'anthropic-dangerous-direct-browser-access',
    'http-referer', 'x-title', 'openai-organization'
]);
const ALLOWED_METHODS = new Set(['GET', 'POST']);
const DEFAULT_HEADER_TIMEOUT_MS = 60 * 1000;
const MAX_BODY_CHARS = 16 * 1024 * 1024;

function relayError(res, status, code, message) {
    if (res.headersSent) { res.end(); return; }
    res.status(status).set('X-Relay-Error', code).json({ error: true, code, message });
}

/** @param {{headerTimeoutMs?:number}} [opts] 等待服务商开始响应的最长时间 */
export function createRelayRouter({ headerTimeoutMs = DEFAULT_HEADER_TIMEOUT_MS } = {}) {
const router = Router();
router.post('/', express.json({ limit: '20mb' }), async (req, res) => {
    const spec = req.body;
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
        return relayError(res, 400, 'bad-request', '请求内容不正确。');
    }
    const method = String(spec.method || 'POST').toUpperCase();
    if (!ALLOWED_METHODS.has(method)) return relayError(res, 400, 'bad-request', '请求内容不正确。');

    let target;
    try { target = new URL(String(spec.url)); } catch { return relayError(res, 400, 'bad-url', 'API 地址不正确，请检查后重试。'); }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        return relayError(res, 400, 'bad-url', 'API 地址必须以 http 或 https 开头。');
    }
    if (target.username || target.password) {
        return relayError(res, 400, 'bad-url', 'API 地址里不能包含账号密码，请把密钥填在密钥栏。');
    }

    const headers = {};
    const given = spec.headers && typeof spec.headers === 'object' ? spec.headers : {};
    for (const [k, v] of Object.entries(given)) {
        const name = k.toLowerCase();
        if (!ALLOWED_HEADERS.has(name) || typeof v !== 'string' || /[\r\n]/.test(v)) continue;
        headers[name] = v;
    }

    let body;
    if (method === 'POST') {
        if (typeof spec.body !== 'string') return relayError(res, 400, 'bad-request', '请求内容不正确。');
        if (spec.body.length > MAX_BODY_CHARS) return relayError(res, 413, 'too-large', '内容太长，无法转发。');
        body = spec.body;
    }

    const controller = new AbortController();
    let clientGone = false;
    res.on('close', () => { if (!res.writableEnded) { clientGone = true; controller.abort(); } });
    const headerTimer = setTimeout(() => controller.abort(), headerTimeoutMs);

    let upstream;
    try {
        upstream = await fetch(target, { method, headers, body, redirect: 'manual', signal: controller.signal });
    } catch (e) {
        clearTimeout(headerTimer);
        if (clientGone) return;
        const timedOut = e && e.name === 'AbortError';
        return relayError(res, 502, timedOut ? 'upstream-timeout' : 'upstream-unreachable',
            timedOut ? `等待 ${target.host} 响应超时。` : `无法连接到 ${target.host}，请检查地址和网络。`);
    }
    clearTimeout(headerTimer);

    if (upstream.status >= 300 && upstream.status < 400) {
        controller.abort();
        return relayError(res, 502, 'upstream-redirect', '服务返回了跳转，请把 API 地址改成最终地址。');
    }

    res.status(upstream.status);
    const ct = upstream.headers.get('content-type');
    if (ct) res.set('Content-Type', ct);
    const retryAfter = upstream.headers.get('retry-after');
    if (retryAfter) res.set('Retry-After', retryAfter);
    res.set('Cache-Control', 'no-cache');
    res.set('X-Accel-Buffering', 'no');
    if (!upstream.body) { res.end(); return; }
    const stream = Readable.fromWeb(upstream.body);
    stream.on('error', () => { if (!res.writableEnded) res.destroy(); });
    stream.pipe(res);
}, (err, req, res, next) => {
    // 请求体解析失败等
    if (err && err.type === 'entity.too.large') return relayError(res, 413, 'too-large', '内容太长，无法转发。');
    return relayError(res, 400, 'bad-request', '请求内容不正确。');
});
return router;
}
