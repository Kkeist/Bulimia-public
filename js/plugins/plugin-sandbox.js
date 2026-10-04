/**
 * PluginSandbox —— 插件界面（作者提供的 HTML / CSS / 脚本）的隔离运行层。
 *
 * 所有插件界面（游戏两侧、调试里的插件测试、模组编辑预览、AI 回复里的页面）都用 PluginSandbox.mount() 显示。
 *
 * 隔离方式：
 *   1. iframe sandbox="allow-scripts"：独立来源，读不到本页的存储、文档，不能导航顶层、不能弹窗、不能提交表单；
 *   2. 页面内注入 CSP：禁止网络请求（connect-src 'none'）、嵌套 iframe、<base>、表单提交；图片 / 字体 / 样式只允许 data: blob: 和本站；
 *   3. 页面经 DOM 解析后再生成：去掉 <base>、<meta http-equiv>、嵌套框架；{{变量}} 在 DOM 上代入（文字、属性、脚本、样式各自转义），不拼字符串；
 *   4. 本页只接受来自自己某个插件 iframe 的消息（校验 event.source + 口令），逐插件限流、逐类型校验；
 *   5. 看门狗：心跳超时、载入超时、消息洪水、页面跳走都会把插件停用，并给出原因和「重新载入」按钮。
 */
(function (global) {
    'use strict';

    var I18n = global.I18n || { t: function (s, p) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return p && p[k] != null ? p[k] : m; }); }, lang: 'zh' };

    var LIMITS = {
        maxDocChars: 1500000,        // 页面 + 样式（代入变量后）的总长度上限
        bootTimeoutMs: 8000,         // 创建后这么久没收到启动消息 → 停用
        heartbeatTimeoutMs: 6000,    // 启动后这么久没收到心跳 → 停用（脚本卡住）
        watchdogTickMs: 1000,
        maxMsgPerSec: 100,           // 一个插件每秒发来的消息总数上限
        maxActionsPerSec: 8,         // 每秒最多处理的操作数，超出的被忽略并提示
        maxActionFloodPerSec: 60,    // 每秒操作数超过这个值直接停用
        maxResizePerSec: 25,
        maxFieldLen: 5000,           // 消息里单个文字的最大长度；超出的整条消息被拒绝并提示
        maxErrorsBeforeNotice: 5,
        maxHeapMb: 300,              // 插件页面报告的脚本内存超过这个值（MB）就停用（仅 Chrome 内核能读到）
        heightFactor: 0.9,           // 高度上限 = 窗口高度 × 这个值
        minHeightCap: 240
    };

    var NAME_RE = /^[A-Za-z0-9_\-.:\u4e00-\u9fa5]{1,64}$/;
    var instances = [];
    var listening = false;
    var seq = 0;

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function now() { return Date.now(); }
    function formatValue(v) { return global.PluginRuntime ? global.PluginRuntime.formatValue(v) : (v == null ? '' : String(v)); }

    function newToken() {
        var s = '';
        try {
            var a = new Uint32Array(4);
            (global.crypto || global.msCrypto).getRandomValues(a);
            for (var i = 0; i < a.length; i++) s += a[i].toString(36);
        } catch (e) {
            s = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
        }
        return 'ps' + (++seq) + '_' + s;
    }

    // ---------- 页面生成 ----------
    function escJs(v) {
        return formatValue(v)
            .replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "\\'").replace(/`/g, '\\`')
            .replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
            .replace(/</g, '\\x3c').replace(/>/g, '\\x3e');
    }

    function escCss(v) {
        return formatValue(v)
            .replace(/url\s*\(/gi, '').replace(/expression\s*\(/gi, '').replace(/@import/gi, '')
            .replace(/[^A-Za-z0-9_\s#%.,()+\-\/\u4e00-\u9fa5]/g, '');
    }

    var PH = /\{\{\s*([A-Za-z0-9_\u4e00-\u9fa5]+)\s*\}\}/g;

    function substitute(text, vars, escaper) {
        if (text.indexOf('{{') < 0) return text;
        return text.replace(PH, function (m, name) {
            var v = Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : undefined;
            return escaper ? escaper(v) : formatValue(v);
        });
    }

    var REMOVE_SELECTORS = 'base, meta[http-equiv], iframe, frame, frameset, object, embed, portal, applet';

    function substituteDom(doc, vars) {
        var walker = doc.createTreeWalker(doc.documentElement, 4 | 1, null, false); // 文字节点 + 元素
        var node = walker.currentNode;
        var textNodes = [], elements = [];
        while (node) {
            if (node.nodeType === 3) textNodes.push(node);
            else if (node.nodeType === 1) elements.push(node);
            node = walker.nextNode();
        }
        elements.forEach(function (el) {
            var attrs = el.attributes;
            for (var i = 0; i < attrs.length; i++) {
                var a = attrs[i];
                if (a.value.indexOf('{{') < 0) continue;
                var name = a.name.toLowerCase();
                var escaper = name.indexOf('on') === 0 ? escJs : (name === 'style' ? escCss : null);
                a.value = substitute(a.value, vars, escaper);
            }
        });
        textNodes.forEach(function (t) {
            if (t.nodeValue.indexOf('{{') < 0) return;
            var p = t.parentNode && t.parentNode.nodeName ? t.parentNode.nodeName.toLowerCase() : '';
            var escaper = p === 'script' ? escJs : (p === 'style' ? escCss : null);
            t.nodeValue = substitute(t.nodeValue, vars, escaper);
        });
    }

    function cspFor(origin, allowExternalImages) {
        var self = origin && origin !== 'null' ? ' ' + origin : '';
        return [
            "default-src 'none'",
            "script-src 'unsafe-inline'" + self,
            "style-src 'unsafe-inline' data: blob:" + self,
            'img-src data: blob:' + self + (allowExternalImages ? ' https:' : ''),
            'font-src data: blob:' + self,
            'media-src data: blob:' + self,
            "connect-src 'none'",
            "form-action 'none'",
            "frame-src 'none'",
            "child-src 'none'",
            "object-src 'none'",
            "base-uri 'none'"
        ].join('; ');
    }

    // 在隔离页面内运行的桥接脚本（序列化后注入，不能引用外部变量）
    function bridgeMain(cfg) {
        var T = cfg.token, P = window.parent;
        try { window.pluginLang = cfg.lang; document.documentElement.setAttribute('data-lang', cfg.lang); } catch (e) { /* 忽略 */ }
        var vars = {};
        var listeners = [];
        function send(k, d) {
            try { var m = d || {}; m.__ps = 1; m.t = T; m.k = k; P.postMessage(m, '*'); } catch (e) { /* 父页面已不在 */ }
        }
        function fmt(v) {
            if (v === undefined || v === null) return '';
            if (typeof v === 'object') { try { return JSON.stringify(v); } catch (e) { return ''; } }
            return String(v);
        }
        function applyBinds() {
            var els = document.querySelectorAll('[data-bind]');
            for (var i = 0; i < els.length; i++) {
                var el = els[i], k = el.getAttribute('data-bind');
                if (!k || !Object.prototype.hasOwnProperty.call(vars, k)) continue;
                var v = vars[k];
                var as = el.getAttribute('data-bind-as') || (el.classList && el.classList.contains('hp-fill') ? 'width' : 'text');
                if (as === 'width') {
                    var n = Number(v), max = Number(el.getAttribute('data-bind-max') || 100);
                    if (isFinite(n) && isFinite(max) && max > 0) el.style.width = Math.max(0, Math.min(100, n / max * 100)) + '%';
                } else if (as === 'value') {
                    if (el.value !== fmt(v)) el.value = fmt(v);
                } else if (el.textContent !== fmt(v)) {
                    el.textContent = fmt(v);
                }
            }
        }
        function pushVars(next) {
            vars = next && typeof next === 'object' ? next : {};
            applyBinds();
            for (var i = 0; i < listeners.length; i++) { try { listeners[i](vars); } catch (e) { send('error', { message: String(e && e.message || e).slice(0, 300) }); } }
        }
        window.addEventListener('message', function (ev) {
            if (ev.source !== P) return;
            var d = ev.data;
            if (!d || d.__ps !== 1 || d.t !== T) return;
            if (d.k === 'vars') pushVars(d.vars);
        });
        window.PluginAPI = {
            action: function (name, text) { send('action', { action: String(name), label: '', text: text == null ? '' : String(text) }); },
            onVars: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
            get vars() { return vars; }
        };
        document.addEventListener('click', function (e) {
            var el = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
            if (!el) return;
            var action = el.getAttribute('data-action');
            if (!action) return;
            var text = '';
            var sel = el.getAttribute('data-action-input');
            if (sel) {
                var inp = document.querySelector(sel);
                if (inp) { text = String(inp.value || ''); if (text.trim() === '') return; inp.value = ''; }
            }
            send('action', { action: action, label: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80), text: text });
        }, false);
        window.addEventListener('error', function (e) { send('error', { message: String(e && e.message || cfg.scriptError).slice(0, 300) }); });
        window.addEventListener('unhandledrejection', function (e) { send('error', { message: String(e && e.reason && e.reason.message || e && e.reason || cfg.scriptError).slice(0, 300) }); });
        document.addEventListener('securitypolicyviolation', function (e) { send('blocked', { uri: String(e.blockedURI || '').slice(0, 200), dir: String(e.violatedDirective || '').slice(0, 60) }); });
        var lastH = -1, pend = false, lastSent = 0;
        function measure() {
            pend = false;
            var b = document.body, de = document.documentElement;
            var h = Math.ceil(Math.max(b ? b.scrollHeight : 0, b ? b.offsetHeight : 0, de ? de.offsetHeight : 0));
            if (h > 0 && Math.abs(h - lastH) >= 2) { lastH = h; lastSent = Date.now(); send('resize', { h: h }); }
        }
        function queueMeasure() {
            if (pend) return;
            pend = true;
            var wait = Math.max(0, 100 - (Date.now() - lastSent)); // 高度消息每 100ms 最多一条
            setTimeout(function () { (window.requestAnimationFrame || setTimeout)(measure); }, wait);
        }
        window.addEventListener('load', queueMeasure);
        if (window.MutationObserver) new MutationObserver(queueMeasure).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
        if (window.ResizeObserver && document.body) { try { new ResizeObserver(queueMeasure).observe(document.body); } catch (e) { /* 旧内核无此接口 */ } }
        setInterval(function () {
            var mem = 0;
            try { if (performance && performance.memory) mem = Math.round(performance.memory.usedJSHeapSize / 1048576); } catch (e) { /* 无此接口 */ }
            send('hb', { mem: mem });
            queueMeasure();
        }, 1000);
        document.addEventListener('DOMContentLoaded', function () { applyBinds(); queueMeasure(); });
        send('boot');
    }

    /**
     * 生成隔离页面。返回 { srcdoc } 或 { error }。
     * opts: { origin, allowExternalImages, baseUrl, token }
     */
    function buildDoc(html, css, vars, opts) {
        opts = opts || {};
        html = html == null ? '' : String(html);
        css = css == null ? '' : String(css);
        if (html.length + css.length > LIMITS.maxDocChars) return { error: I18n.t('页面内容太大（超过 {n}K 字），已停止显示。', { n: Math.round(LIMITS.maxDocChars / 1000) }) };
        var doc;
        try { doc = new DOMParser().parseFromString(html, 'text/html'); } catch (e) { return { error: I18n.t('页面内容无法读取。') }; }
        var rm = doc.querySelectorAll(REMOVE_SELECTORS);
        var removed = [];
        for (var i = 0; i < rm.length; i++) { removed.push(rm[i].nodeName.toLowerCase()); rm[i].parentNode.removeChild(rm[i]); }
        if (css) {
            var st = doc.createElement('style');
            st.textContent = css;
            doc.head.appendChild(st);
        }
        substituteDom(doc, vars || {});
        if (opts.js) {
            var logic = doc.createElement('script');
            logic.textContent = String(opts.js);
            (doc.body || doc.documentElement).appendChild(logic);
        }
        var head = doc.head;
        var first = head.firstChild;
        function put(el) { head.insertBefore(el, first); }
        var bridge = doc.createElement('script');
        bridge.textContent = '(' + bridgeMain.toString() + ')(' + JSON.stringify({ token: opts.token || '', lang: I18n.lang || 'zh', scriptError: I18n.t('脚本出错') }).replace(/</g, '\\u003c') + ');';
        // 顺序：字符集 → base → CSP → 桥接脚本 → 作者内容
        var nodes = [];
        var charset = doc.createElement('meta'); charset.setAttribute('charset', 'utf-8'); nodes.push(charset);
        if (opts.baseUrl) { var base = doc.createElement('base'); base.setAttribute('href', opts.baseUrl); nodes.push(base); }
        var csp = doc.createElement('meta');
        csp.setAttribute('http-equiv', 'Content-Security-Policy');
        csp.setAttribute('content', cspFor(opts.origin, !!opts.allowExternalImages));
        nodes.push(csp);
        nodes.push(bridge);
        nodes.forEach(put);
        var out = '<!DOCTYPE html>' + doc.documentElement.outerHTML;
        if (out.length > LIMITS.maxDocChars + 20000) return { error: I18n.t('页面内容太大（代入变量后超过上限），已停止显示。') };
        return { srcdoc: out, removed: removed };
    }

    // ---------- 消息校验 ----------
    function isPlain(o) { return o !== null && typeof o === 'object' && !Array.isArray(o); }

    /** 校验一条来自插件的消息，返回 { ok, kind, data } 或 { ok:false, reason, notice } */
    function parseMessage(inst, d) {
        if (!isPlain(d)) return { ok: false, reason: 'shape' };
        var T = LIMITS.maxFieldLen;
        function str(v) { return typeof v === 'string'; }
        if (d.__ps === 1) {
            if (d.t !== inst.token) return { ok: false, reason: 'token' };
            var k = d.k;
            if (k === 'boot') return { ok: true, kind: k, data: {} };
            if (k === 'hb') return { ok: true, kind: k, data: { mem: isFinite(Number(d.mem)) ? Number(d.mem) : 0 } };
            if (k === 'resize') {
                var h = Number(d.h);
                if (!isFinite(h) || h < 0) return { ok: false, reason: 'resize' };
                return { ok: true, kind: k, data: { h: h } };
            }
            if (k === 'action') {
                if (!str(d.action) || !NAME_RE.test(d.action)) return { ok: false, reason: 'action-name', notice: I18n.t('插件发来的操作名称不合规，已忽略。') };
                var label = d.label == null ? '' : d.label, text = d.text == null ? '' : d.text;
                if (!str(label) || !str(text)) return { ok: false, reason: 'action-field', notice: I18n.t('插件发来的操作内容格式不对，已忽略。') };
                if (label.length > T || text.length > T) return { ok: false, reason: 'too-long', notice: I18n.t('插件发来的内容太长（超过 {n} 字），已忽略。', { n: T }) };
                return { ok: true, kind: k, data: { action: d.action, label: label, text: text } };
            }
            if (k === 'error') return { ok: true, kind: k, data: { message: str(d.message) ? d.message.slice(0, 300) : I18n.t('脚本出错') } };
            if (k === 'blocked') return { ok: true, kind: k, data: { uri: str(d.uri) ? d.uri.slice(0, 200) : '', dir: str(d.dir) ? d.dir.slice(0, 60) : '' } };
            return { ok: false, reason: 'kind' };
        }
        // 作者脚本直接 postMessage({ type: '动作名', text, label }) 的写法
        if (str(d.type)) {
            if (d.type.indexOf('__') === 0 || !NAME_RE.test(d.type)) return { ok: false, reason: 'action-name', notice: I18n.t('插件发来的操作名称不合规，已忽略。') };
            var lb = d.label == null ? '' : d.label, tx = d.text == null ? '' : d.text;
            if (!str(lb) || !str(tx)) return { ok: false, reason: 'action-field', notice: I18n.t('插件发来的操作内容格式不对，已忽略。') };
            if (lb.length > T || tx.length > T) return { ok: false, reason: 'too-long', notice: I18n.t('插件发来的内容太长（超过 {n} 字），已忽略。', { n: T }) };
            return { ok: true, kind: 'action', data: { action: d.type, label: lb, text: tx } };
        }
        return { ok: false, reason: 'shape' };
    }

    // ---------- 全局消息入口 ----------
    /**
     * 给本页加一条 CSP：框架只允许 about:（也就是 srcdoc）。
     * 这样插件页面自己跳转（location、meta refresh）到任何网址都会被浏览器直接拒绝，请求发不出去。
     */
    function ensureHostPolicy() {
        var d = global.document;
        if (!d || !d.head || d.querySelector('meta[data-plugin-frame-policy]')) return;
        var m = d.createElement('meta');
        m.setAttribute('http-equiv', 'Content-Security-Policy');
        m.setAttribute('content', 'frame-src about:');
        m.setAttribute('data-plugin-frame-policy', '1');
        d.head.appendChild(m);
    }

    function ensureListening() {
        if (listening) return;
        listening = true;
        ensureHostPolicy();
        global.addEventListener('message', function (ev) {
            var inst = null;
            for (var i = 0; i < instances.length; i++) {
                if (instances[i].frame && instances[i].frame.contentWindow === ev.source) { inst = instances[i]; break; }
            }
            if (!inst || inst.state === 'stopped') return;
            inst._onMessage(ev.data);
        });
        global.addEventListener('pagehide', function () {
            instances.forEach(function (i) { i._clearLoadingFlag(); });
        });
        if (global.document) {
            global.document.addEventListener('visibilitychange', function () {
                if (global.document.hidden) return;
                // 页面刚回到前台：后台期间定时器被降频，不能算作插件无响应
                instances.forEach(function (i) { i.lastBeat = now(); });
            });
        }
        setInterval(function () {
            for (var i = instances.length - 1; i >= 0; i--) instances[i]._watch();
        }, LIMITS.watchdogTickMs);
    }

    function lsGet(k) { try { return global.localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { global.localStorage.setItem(k, v); } catch (e) { /* 存储不可用就不做防卡死记号 */ } }
    function lsDel(k) { try { global.localStorage.removeItem(k); } catch (e) { /* 同上 */ } }

    // ---------- 实例 ----------
    /**
     * PluginSandbox.mount(container, opts)
     * opts:
     *   pluginId, name
     *   getDoc(): Promise<{ html, css }> | { html, css }   取最新页面内容；抛错 / 返回 error 会显示在停用提示里
     *   vars: 初始变量表；getVars(): 取最新变量表（生成页面时调用）
     *   allowExternalImages, baseUrl
     *   minHeight: 最小高度（px）
     *   onAction(msg, inst): 收到操作（msg = { action, label, text }）
     *   onNotice(text, inst): 需要让用户看到的提示（脚本报错、被拦截的请求、操作太快等）
     *   onStateChange(state, reason, inst)
     */
    function mount(container, opts) {
        opts = opts || {};
        ensureListening();
        var inst = {
            id: opts.pluginId || '',
            name: opts.name || I18n.t('插件'),
            opts: opts,
            token: newToken(),
            state: 'loading',
            reason: '',
            frame: null,
            vars: opts.vars || {},
            lastVarsJson: '',
            lastSrcdoc: '',
            usesTemplate: false,
            createdAt: now(),
            lastBeat: now(),
            booted: false,
            expectLoads: 0,
            windowStart: now(),
            msgCount: 0,
            actionCount: 0,
            actionDropped: 0,
            resizeCount: 0,
            errorCount: 0,
            blockedSeen: {},
            lastWatch: now(),
            notices: [],
            destroyed: false
        };

        var wrap = document.createElement('div');
        wrap.className = 'plugin-sandbox';
        wrap.setAttribute('data-state', 'loading');
        var notice = document.createElement('div');
        notice.className = 'plugin-sandbox-notice';
        notice.hidden = true;
        var stage = document.createElement('div');
        stage.className = 'plugin-sandbox-stage';
        var stopped = document.createElement('div');
        stopped.className = 'plugin-sandbox-stopped';
        stopped.hidden = true;
        var stoppedText = document.createElement('div');
        stoppedText.className = 'plugin-sandbox-stopped-text';
        var reloadBtn = document.createElement('button');
        reloadBtn.type = 'button';
        reloadBtn.className = 'plugin-sandbox-reload';
        reloadBtn.textContent = I18n.t('重新载入');
        stopped.appendChild(stoppedText);
        stopped.appendChild(reloadBtn);
        wrap.appendChild(notice);
        wrap.appendChild(stage);
        wrap.appendChild(stopped);
        container.appendChild(wrap);
        inst.el = wrap;

        function setState(state, reason) {
            inst.state = state;
            inst.reason = reason || '';
            wrap.setAttribute('data-state', state);
            if (state === 'stopped') {
                stoppedText.textContent = I18n.t('「{name}」已停用：{reason}', { name: inst.name, reason: inst.reason });
                stopped.hidden = false;
            } else {
                stopped.hidden = true;
            }
            if (opts.onStateChange) { try { opts.onStateChange(state, inst.reason, inst); } catch (e) { console.error('[PluginSandbox] onStateChange 出错', e); } }
        }

        function showNotice(text) {
            inst.notices.push({ at: now(), text: text });
            if (inst.notices.length > 20) inst.notices.shift();
            notice.textContent = text;
            notice.hidden = false;
            if (opts.onNotice) { try { opts.onNotice(text, inst); } catch (e) { console.error('[PluginSandbox] onNotice 出错', e); } }
        }
        inst.notice = showNotice;

        function destroyFrame() {
            if (inst.frame) {
                try { inst.frame.parentNode && inst.frame.parentNode.removeChild(inst.frame); } catch (e) { /* 已脱离 */ }
                inst.frame = null;
            }
        }

        inst.stop = function (reason) {
            if (inst.state === 'stopped' || inst.destroyed) return;
            destroyFrame();
            inst._clearLoadingFlag();
            setState('stopped', reason);
        };

        var flagKey = function () { return 'pluginLoading:' + (inst.id || 'x'); };
        inst._clearLoadingFlag = function () {
            var v = lsGet(flagKey());
            if (v && v.split('|')[0] === inst.token) lsDel(flagKey());
        };

        function maxHeight() {
            var vh = global.innerHeight || 700;
            return Math.max(LIMITS.minHeightCap, Math.floor(vh * LIMITS.heightFactor));
        }

        function createFrame(srcdoc) {
            destroyFrame();
            var f = document.createElement('iframe');
            f.className = 'plugin-iframe';
            f.setAttribute('sandbox', 'allow-scripts');
            f.setAttribute('referrerpolicy', 'no-referrer');
            f.setAttribute('allow', '');
            f.setAttribute('title', inst.name);
            f.dataset.pluginId = inst.id;
            f.style.width = '100%';
            f.style.border = '0';
            f.style.display = 'block';
            f.style.height = (opts.minHeight || 60) + 'px';
            inst.frame = f;
            inst.booted = false;
            inst.createdAt = now();
            inst.lastBeat = now();
            inst.expectLoads = 1;
            f.addEventListener('load', function () {
                if (inst.frame !== f || inst.state === 'stopped') return;
                if (inst.expectLoads > 0) { inst.expectLoads--; return; }
                inst.stop(I18n.t('页面试图跳转到别的地址。'));
            });
            f.srcdoc = srcdoc; // 先设内容再加入页面，避免多出一次空白页面的 load
            stage.appendChild(f);
        }

        inst._render = function (docResult) {
            if (docResult.error) { inst.stop(docResult.error); return false; }
            inst.lastSrcdoc = docResult.srcdoc;
            if (inst.frame && inst.state !== 'stopped') {
                inst.expectLoads++;
                inst.booted = false;
                inst.createdAt = now();
                inst.frame.srcdoc = docResult.srcdoc;
            } else {
                createFrame(docResult.srcdoc);
            }
            setState('loading', '');
            return true;
        };

        function compose(doc) {
            var html = doc && doc.html != null ? doc.html : '';
            var css = doc && doc.css != null ? doc.css : '';
            var js = doc && doc.js != null ? doc.js : '';
            if (opts.getVars) { try { inst.vars = opts.getVars() || {}; } catch (e) { inst.vars = {}; } }
            var d = buildDoc(html, css, inst.vars, { origin: global.location && global.location.origin, allowExternalImages: !!opts.allowExternalImages, baseUrl: opts.baseUrl, token: inst.token, js: js });
            inst.usesTemplate = (String(html) + String(css)).indexOf('{{') >= 0;
            inst.srcRaw = { html: html, css: css, js: js };
            return d;
        }

        inst.load = function () {
            if (inst.destroyed) return Promise.resolve();
            var prev = lsGet(flagKey());
            if (prev) {
                // 记号里的口令不属于当前页面里任何一个插件 = 上次载入时页面卡死、没来得及清掉
                var owner = prev.split('|')[0], alive = false;
                for (var q = 0; q < instances.length; q++) if (instances[q].token === owner) alive = true;
                if (!alive) {
                    lsDel(flagKey());
                    inst.stop(I18n.t('上次载入这个插件时页面卡住了，已先暂停。点「重新载入」再试一次。'));
                    return Promise.resolve();
                }
            }
            var p;
            try { p = Promise.resolve(opts.getDoc ? opts.getDoc() : { html: '', css: '' }); } catch (e) { p = Promise.reject(e); }
            return p.then(function (doc) {
                if (inst.destroyed) return;
                if (doc && doc.error) { inst.stop(doc.error); return; }
                var d = compose(doc);
                lsSet(flagKey(), inst.token + '|' + now());
                if (!inst._render(d)) return;
            }, function (e) {
                if (!inst.destroyed) inst.stop(I18n.t('页面内容读取失败：{error}', { error: e && e.message ? e.message : e }));
            });
        };

        inst.reload = function () {
            if (inst.destroyed) return Promise.resolve();
            destroyFrame();
            inst.errorCount = 0;
            inst.blockedSeen = {};
            notice.hidden = true;
            setState('loading', '');
            return inst.load();
        };

        /** 变量变了：只改界面里 data-bind 的值；页面里写了 {{变量}} 时需要重新生成页面 */
        inst.setVars = function (vars) {
            if (!vars && opts.getVars) vars = opts.getVars();
            vars = vars || {};
            var j = global.PluginRuntime ? global.PluginRuntime.safeStringify(vars) : JSON.stringify(vars);
            if (j === inst.lastVarsJson) return;
            inst.lastVarsJson = j;
            inst.vars = vars;
            if (inst.state === 'stopped' || !inst.srcRaw) return;
            if (inst.usesTemplate) {
                var d = compose(inst.srcRaw);
                if (d.error) { inst.stop(d.error); return; }
                if (d.srcdoc !== inst.lastSrcdoc) { inst._render(d); return; }
            }
            inst._postVars();
        };

        inst._postVars = function () {
            if (!inst.booted || !inst.frame || !inst.frame.contentWindow) return;
            try { inst.frame.contentWindow.postMessage({ __ps: 1, t: inst.token, k: 'vars', vars: inst.vars }, '*'); } catch (e) { /* 页面已被移除 */ }
        };

        inst._onMessage = function (data) {
            var t = now();
            if (t - inst.windowStart >= 1000) {
                inst.windowStart = t; inst.msgCount = 0; inst.actionCount = 0; inst.actionDropped = 0; inst.resizeCount = 0;
            }
            inst.msgCount++;
            if (inst.msgCount > LIMITS.maxMsgPerSec) { inst.stop(I18n.t('发来的消息太多（每秒超过 {n} 条）。', { n: LIMITS.maxMsgPerSec })); return; }
            var r = parseMessage(inst, data);
            if (!r.ok) { if (r.notice) showNotice(r.notice); return; }
            var d = r.data;
            switch (r.kind) {
                case 'boot':
                    inst.booted = true;
                    inst.lastBeat = t;
                    if (inst.state === 'loading') setState('running', '');
                    inst._postVars();
                    break;
                case 'hb':
                    inst.lastBeat = t;
                    inst._clearLoadingFlag();
                    if (d.mem > LIMITS.maxHeapMb) { inst.stop(I18n.t('占用的内存过多（超过 {n} MB）。', { n: LIMITS.maxHeapMb })); return; }
                    break;
                case 'resize':
                    inst.resizeCount++;
                    if (inst.resizeCount > LIMITS.maxResizePerSec) { inst.stop(I18n.t('页面高度变化过于频繁。')); return; }
                    if (inst.frame) {
                        var cap = maxHeight();
                        var h = Math.max(opts.minHeight || 60, Math.min(cap, Math.ceil(d.h)));
                        inst.frame.style.height = h + 'px';
                        inst.heightCapped = d.h > cap;
                    }
                    break;
                case 'action':
                    inst.actionCount++;
                    if (inst.actionCount > LIMITS.maxActionFloodPerSec) { inst.stop(I18n.t('操作发送得太快（每秒超过 {n} 次）。', { n: LIMITS.maxActionFloodPerSec })); return; }
                    if (inst.actionCount > LIMITS.maxActionsPerSec) {
                        if (!inst.actionDropped) showNotice(I18n.t('操作太快，部分点击被忽略。'));
                        inst.actionDropped++;
                        return;
                    }
                    if (opts.onAction) { try { opts.onAction(d, inst); } catch (e) { console.error('[PluginSandbox] onAction 出错', e); showNotice(I18n.t('处理这次操作时出错：{error}', { error: e && e.message ? e.message : e })); } }
                    break;
                case 'error':
                    inst.errorCount++;
                    if (inst.errorCount <= LIMITS.maxErrorsBeforeNotice) showNotice(I18n.t('插件脚本出错：{error}', { error: d.message }));
                    break;
                case 'blocked':
                    var key = d.dir + '|' + d.uri;
                    if (!inst.blockedSeen[key] && Object.keys(inst.blockedSeen).length < 5) {
                        inst.blockedSeen[key] = 1;
                        showNotice(I18n.t('插件想加载的外部内容被拦截了：{uri}。', { uri: d.uri || I18n.t('未知') }));
                    }
                    break;
            }
        };

        inst._watch = function () {
            if (inst.destroyed) return;
            var t = now();
            var gap = t - inst.lastWatch;
            inst.lastWatch = t;
            if (global.document && global.document.hidden) { inst.lastBeat = t; return; }
            if (gap > LIMITS.watchdogTickMs * 3) { inst.lastBeat = t; inst.createdAt = Math.max(inst.createdAt, t - 1000); return; } // 本页自己刚被卡住过，不算插件的问题
            if (!inst.frame || inst.state === 'stopped') return;
            if (!inst.booted) {
                if (t - inst.createdAt > LIMITS.bootTimeoutMs) inst.stop(I18n.t('没有正常载入，可能脚本卡住了。'));
                return;
            }
            if (t - inst.lastBeat > LIMITS.heartbeatTimeoutMs) inst.stop(I18n.t('长时间没有响应，可能脚本陷入了死循环。'));
        };

        inst.destroy = function () {
            inst.destroyed = true;
            destroyFrame();
            inst._clearLoadingFlag();
            var i = instances.indexOf(inst);
            if (i >= 0) instances.splice(i, 1);
            if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        };

        reloadBtn.addEventListener('click', function () { inst.reload(); });

        instances.push(inst);
        inst.load();
        return inst;
    }

    global.PluginSandbox = {
        LIMITS: LIMITS,
        mount: mount,
        buildDoc: buildDoc,
        parseMessage: parseMessage,
        instances: function () { return instances.slice(); },
        _escJs: escJs,
        _escCss: escCss
    };
})(typeof window !== 'undefined' ? window : this);
