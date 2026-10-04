/**
 * 调试面板「原始回复」标签（写作指导标签下半部分的世界书见 debug-tab-tavern.js）。
 * 扩展 DebugModuleJump（debug-module-jump.js 先加载）。
 */
Object.assign(DebugModuleJump, {
    /**
     * 原始回复 tab：列历史 AI 回复（原始版/文字版 + 操作记录）。
     */
    renderRawTab() {
        const box = document.getElementById('debug-raw-replies-list') || document.querySelector('#debug-panel-raw-replies .debug-list') || document.getElementById('debug-panel-raw-replies');
        if (!box) return;
        const esc = this._esc.bind(this);
        const src = (typeof ChatDisplay !== 'undefined' && ChatDisplay.messages && ChatDisplay.messages.length) ? ChatDisplay.messages : ((typeof State !== 'undefined' && State.chatHistory) || []);
        const msgs = src.filter(m => m && m.role === 'assistant');
        const opRe = /<(var|rule|module|delivery|time|foreshadow|plugin|summary)\|[^>]*>/g;
        const textOf = (raw) => {
            let t = String(raw || '');
            const cm = t.match(/<content>([\s\S]*?)<\/content>/i);
            if (cm) t = cm[1];
            t = t.replace(/<(thinking|turn_summary|ecot|prediction|qa)[^>]*>[\s\S]*?<\/\1>/gi, '');
            t = t.replace(opRe, '');
            t = t.replace(/<\/?[\w-]+(\|[^>]*)?>/g, '');
            return t.trim();
        };
        this._rawCache = {};
        let h = `<div class="mjx" id="mjx-raw">`;
        if (!msgs.length) {
            h += `<div class="mjx-empty">${I18n.t('还没有历史 AI 回复。')}</div></div>`;
            box.innerHTML = h;
            this._bindRawTab(box);
            return;
        }
        msgs.slice().reverse().forEach((m, idx) => {
            const n = msgs.length - idx;
            const raw = String(m.rawContent || m.content || '');
            const ops = raw.match(opRe) || [];
            const effects = Array.isArray(m.effects) ? m.effects : [];
            const k = 'raw' + n;
            const showRaw = !!this._rawShowRaw && this._rawShowRaw[k];
            this._rawCache[k] = { raw, text: textOf(raw) };
            h += `<div class="mjx-sec"><div class="mjx-sttl">${I18n.t('第 {n} 条回复', { n })}` +
                `<span><button type="button" class="mjx-b${!showRaw ? ' mjx-b-jump' : ''}" data-rawmode="text|${k}">${I18n.t('文字版')}</button>` +
                `<button type="button" class="mjx-b${showRaw ? ' mjx-b-jump' : ''}" data-rawmode="raw|${k}">${I18n.t('原始版')}</button></span></div>` +
                `<pre class="mjx-pre">${esc(showRaw ? raw : textOf(raw))}</pre>` +
                `<div class="mjx-drow"><b>${I18n.t('抽出的操作（{n}）', { n: ops.length })}</b><div class="mjx-qitems">${ops.length ? ops.map(o => `<span class="mjx-qchip">${esc(o)}</span>`).join('') : `<span class="mjx-qnone">${I18n.t('无')}</span>`}</div></div>` +
                (effects.length ? `<div class="mjx-drow"><b>${I18n.t('执行结果（{n}）', { n: effects.length })}</b><div class="mjx-qitems">${effects.map(e => `<div class="mjx-qchip">${esc((e.ok ? I18n.t('生效：') : I18n.t('没生效：')) + (e.ok ? e.summary : (e.tag ? e.tag + I18n.t('，') : '') + e.reason))}</div>`).join('')}</div></div>` : '') + `</div>`;
        });
        h += `</div>`;
        box.innerHTML = h;
        this._bindRawTab(box);
    },

    /** 绑定原始回复 tab 的交互：每条回复自己切换原始版 / 文字版，只改这一条 */
    _bindRawTab(box) {
        box.querySelectorAll('[data-rawmode]').forEach(b => b.addEventListener('click', () => {
            const [mode, k] = b.getAttribute('data-rawmode').split('|');
            this._rawShowRaw = this._rawShowRaw || {};
            this._rawShowRaw[k] = (mode === 'raw');
            const card = b.closest('.mjx-sec');
            const pre = card.querySelector('.mjx-pre');
            pre.textContent = this._rawCache[k][mode === 'raw' ? 'raw' : 'text'];
            card.querySelectorAll('[data-rawmode]').forEach(x => x.classList.toggle('mjx-b-jump', x === b));
        }));
    }
});
