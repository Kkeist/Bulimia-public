/**
 * 只允许本机页面使用的接口守卫。
 * 同时检查：连接来自回环地址、Host 是本机名、带 Origin 时 Origin 与 Host 一致。
 * 这样既拦局域网里的其他设备，也拦用户浏览器里别的网站对本机服务的跨站请求和域名重绑定。
 * 经反向代理转来的请求（带 X-Forwarded-* / Forwarded 头）一律不算本机：代理在本机时连接地址也是回环地址，
 * 不能因此把公网来的请求当成本机页面。
 */

const PROXY_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'forwarded'];

const LOCAL_NAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isLoopbackAddress(addr) {
    if (!addr) return false;
    return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1' || addr.startsWith('127.');
}

export function hostnameOf(hostHeader) {
    if (!hostHeader) return '';
    const h = String(hostHeader).trim().toLowerCase();
    if (h.startsWith('[')) {
        const end = h.indexOf(']');
        return end > 0 ? h.slice(0, end + 1) : h;
    }
    return h.split(':')[0];
}

/** 返回 null 表示放行，否则返回拒绝原因（给日志/测试用，不给最终用户看） */
export function checkLocalRequest(req) {
    if (!isLoopbackAddress(req.socket && req.socket.remoteAddress)) return 'remote-address';
    if (PROXY_HEADERS.some(h => req.headers[h] !== undefined)) return 'proxied';
    const host = req.headers.host;
    if (!LOCAL_NAMES.has(hostnameOf(host))) return 'host';
    const origin = req.headers.origin;
    if (origin !== undefined) {
        let o;
        try { o = new URL(origin); } catch { return 'origin'; }
        if (o.host.toLowerCase() !== String(host).toLowerCase()) return 'origin';
    }
    const site = req.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin' && site !== 'none') return 'fetch-site';
    return null;
}

export function localOnly(req, res, next) {
    const reason = checkLocalRequest(req);
    if (reason) {
        res.set('X-Relay-Error', 'local-only').status(403).json({ error: true, code: 'local-only', message: '这项功能只能在本机运行游戏时使用。' });
        return;
    }
    next();
}
