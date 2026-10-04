/**
 * 文件下载与文字复制的统一入口。
 * 所有下载都走 FileDownload.save：文件名自动带保存时的日期时间，同一秒内再存自动加序号，
 * 同一个页面连续下载多个文件时名字不会重复（iOS 会拒收重名的后续下载）。
 * 下载被浏览器拦住时，调用方可以用 showText 把内容显示出来让玩家复制。
 */
const FileDownload = {
    _counts: {},

    _stamp(d) {
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    },

    /** 取下一个不重复的文件名：名字-日期时间[-序号].扩展名 */
    nextName(baseName, ext) {
        const safe = String(baseName || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim() || 'file';
        const stem = `${safe}-${this._stamp(new Date())}`;
        const key = `${stem}.${ext}`;
        this._counts[key] = (this._counts[key] || 0) + 1;
        return this._counts[key] === 1 ? key : `${stem}-${this._counts[key]}.${ext}`;
    },

    /**
     * 保存文件。
     * @param {string|Blob} content
     * @param {string} baseName 不含扩展名和日期时间
     * @param {string} ext 不含点
     * @param {string} [mime]
     * @returns {string} 实际使用的文件名
     */
    save(content, baseName, ext, mime) {
        const name = this.nextName(baseName, ext);
        const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        return name;
    },

    /** 复制文字：优先用剪贴板接口，不行再用选中复制；都不行返回 false */
    async copyText(text) {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (e) { /* 剪贴板接口被拒绝，改用选中复制 */ }
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;resize:none;';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, text.length);
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        document.body.removeChild(ta);
        return ok;
    },

    /** 弹出带全文的文本框和「复制」按钮；复制不了时文字已全选，玩家可手动复制 */
    showText(title, text) {
        const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const id = 'file-download-text';
        Modal.show(title, `<textarea id="${id}" readonly style="width:100%;height:50vh;resize:none;box-sizing:border-box;">${esc(text)}</textarea>`, {
            buttons: [
                { label: I18n.t('关闭'), action: 'close' },
                { label: I18n.t('复制'), action: 'copy', class: 'btn-primary' }
            ],
            onAction: async (action) => {
                if (action === 'close') { Modal.close(); return; }
                const ta = document.getElementById(id);
                const ok = await this.copyText(text);
                if (ok) { Toast.show(I18n.t('已复制'), 'success'); return; }
                if (ta) { ta.focus(); ta.select(); }
                Toast.show(I18n.t('这个浏览器不允许自动复制，文字已全选，请长按或按 Ctrl+C 复制。'), 'warning', 6000);
            }
        });
        setTimeout(() => { const ta = document.getElementById(id); if (ta) { ta.focus(); ta.select(); } }, 100);
    }
};

if (typeof window !== 'undefined') window.FileDownload = FileDownload;
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { FileDownload };
}
