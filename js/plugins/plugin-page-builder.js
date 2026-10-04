/**
 * PluginPageBuilder —— 用「内容块」搭出插件的页面（纯逻辑，不碰 DOM，浏览器与 Node 都能加载）。
 *
 * 编辑器里点选添加的内容块 [{ type, key, ... }] 在这里生成插件的 HTML 和 CSS；
 * 生成结果和手写的页面走同一条显示路径（data-bind 绑定变量、data-action 触发按钮）。
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.PluginPageBuilder = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var I18n = (typeof self !== 'undefined' && self.I18n) || { t: function (s) { return s; } };

    var TYPES = {
        title: { label: I18n.t('标题') },
        text: { label: I18n.t('文字') },
        value: { label: I18n.t('变量的值') },
        bar: { label: I18n.t('进度条') },
        button: { label: I18n.t('按钮') },
        input: { label: I18n.t('输入框和发送按钮') }
    };
    var ORDER = ['title', 'text', 'value', 'bar', 'button', 'input'];

    var seq = 0;
    function newKey() {
        seq++;
        return Date.now().toString(36) + seq.toString(36) + Math.random().toString(36).slice(2, 5);
    }

    /** 新内容块：字段全部留空，由作者填写 */
    function newBlock(type) {
        if (!TYPES[type]) throw new Error('不认识的内容块：' + type);
        var b = { type: type, key: newKey() };
        if (type === 'title' || type === 'text') b.text = '';
        if (type === 'value') { b.label = ''; b.variableId = ''; }
        if (type === 'bar') { b.label = ''; b.variableId = ''; b.max = 100; }
        if (type === 'button') b.label = '';
        if (type === 'input') { b.label = ''; b.placeholder = ''; }
        return b;
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
    }

    function safeKey(b) { return String(b.key || '').replace(/[^A-Za-z0-9_]/g, ''); }

    function placeholder(id) {
        var clean = String(id || '').replace(/[^A-Za-z0-9_一-龥]/g, '');
        return clean ? '{{' + clean + '}}' : '';
    }

    function maxOf(b) {
        var n = Number(b.max);
        return isFinite(n) && n > 0 ? n : 100;
    }

    function blockHtml(b) {
        var k = safeKey(b);
        var text = function (s) { return esc(s).replace(/\n/g, '<br>'); };
        switch (b && b.type) {
            case 'title': return '<h3 class="pb-title">' + text(b.text) + '</h3>';
            case 'text': return '<p class="pb-text">' + text(b.text) + '</p>';
            case 'value':
                return '<div class="pb-row"><span class="pb-label">' + esc(b.label) + '</span><b class="pb-val" data-bind="' + esc(b.variableId) + '">' + placeholder(b.variableId) + '</b></div>';
            case 'bar':
                return '<div class="pb-row"><span class="pb-label">' + esc(b.label) + '</span><b class="pb-val" data-bind="' + esc(b.variableId) + '">' + placeholder(b.variableId) + '</b></div>' +
                    '<div class="pb-bar"><div class="pb-fill" data-bind="' + esc(b.variableId) + '" data-bind-as="width" data-bind-max="' + maxOf(b) + '"></div></div>';
            case 'button':
                return '<button type="button" class="pb-btn" data-action="a_' + k + '">' + esc(b.label) + '</button>';
            case 'input':
                return '<div class="pb-send"><input type="text" class="pb-in" id="in_' + k + '" placeholder="' + esc(b.placeholder) + '">' +
                    '<button type="button" class="pb-btn" data-action="a_' + k + '" data-action-input="#in_' + k + '">' + esc(b.label) + '</button></div>';
        }
        return '';
    }

    var CSS = [
        'html,body{margin:0;padding:0}',
        'body{padding:.5rem;font:14px/1.5 sans-serif;color:#222;background:transparent;box-sizing:border-box}',
        '.pb-title{margin:0 0 .5rem;font-size:1.1em}',
        '.pb-text{margin:0 0 .5rem;word-break:break-word}',
        '.pb-row{display:flex;justify-content:space-between;gap:.5rem;margin:0 0 .25rem}',
        '.pb-label{color:#555}',
        '.pb-val{text-align:right;word-break:break-all}',
        '.pb-bar{height:.6rem;margin:0 0 .5rem;background:#e3e5e8;border-radius:.3rem;overflow:hidden}',
        '.pb-fill{height:100%;width:0;background:#555555}',
        '.pb-btn{display:block;width:100%;margin:0 0 .5rem;padding:.55rem .75rem;font:inherit;color:#222;background:#f2f3f5;border:1px solid #c5c8cd;border-radius:.4rem;cursor:pointer}',
        '.pb-btn:active{background:#e3e5e8}',
        '.pb-send{display:flex;gap:.5rem;margin:0 0 .5rem}',
        '.pb-send .pb-btn{width:auto;margin:0;flex:none}',
        '.pb-in{flex:1;min-width:0;padding:.5rem;font:inherit;color:#222;background:#fff;border:1px solid #c5c8cd;border-radius:.4rem}',
        '@media (prefers-color-scheme:dark){body{color:#e6e6e6}.pb-label{color:#aaa}.pb-bar{background:#3a3d42}.pb-btn{color:#e6e6e6;background:#2c2f34;border-color:#555}.pb-btn:active{background:#3a3d42}.pb-in{color:#e6e6e6;background:#1f2124;border-color:#555}}'
    ].join('\n');

    /** 内容块 → { html, css } */
    function build(blocks) {
        var list = Array.isArray(blocks) ? blocks : [];
        if (!list.length) return { html: '', css: '' };
        return { html: list.map(blockHtml).join('\n'), css: CSS };
    }

    /** 每个内容块还缺什么：[{ index, text }]，空数组 = 都填好了 */
    function problems(blocks) {
        var out = [];
        (Array.isArray(blocks) ? blocks : []).forEach(function (b, i) {
            if (!b || !TYPES[b.type]) { out.push({ index: i, text: I18n.t('这个内容块不认识。') }); return; }
            if ((b.type === 'title' || b.type === 'text') && !String(b.text || '').trim()) out.push({ index: i, text: I18n.t('还没有写内容。') });
            if ((b.type === 'value' || b.type === 'bar') && !b.variableId) out.push({ index: i, text: I18n.t('还没有选变量。') });
            if (b.type === 'bar' && !(Number(b.max) > 0)) out.push({ index: i, text: I18n.t('最大值要大于 0。') });
            if ((b.type === 'button' || b.type === 'input') && !String(b.label || '').trim()) out.push({ index: i, text: I18n.t('还没有写按钮上的字。') });
        });
        return out;
    }

    return { TYPES: TYPES, ORDER: ORDER, newBlock: newBlock, build: build, problems: problems };
});
