/**
 * 自动总结：已经滑出对话窗口的单条总结攒够数量，就请求 AI 压缩成一条大总结，保存后下一轮提示词里带上。
 * 扩展 App（app.js 先加载）。
 */
Object.assign(App, {
    /** 对话窗口覆盖多少个回合（一回合 = 一条用户消息 + 一条 AI 回复）。 */
    _windowTurns() {
        const size = Math.max(20, (Storage.getSettings() || {}).chatHistoryContextSize ?? 20);
        return Math.floor(size / 2);
    },

    /** 压缩总结时发给 AI 的消息。 */
    buildSummaryCompressionMessages(ss, singles) {
        const mega = ss.megaSummaries.map(m => m.content).filter(Boolean);
        let text = I18n.t('你是剧情记录员。请把下面的已有总结和新的剧情片段合并成一份新的总结。') + '\n';
        text += I18n.t('要求：按时间顺序，只写发生的事实，不评价；保留人物、关键事件、数值变化和约定；用简洁的叙述，不超过 400 字。') + '\n';
        text += I18n.t('只输出这一行，不要写别的：<summary|global|总结内容>') + '\n\n';
        if (mega.length) text += I18n.t('【已有总结】') + '\n' + mega.join('\n\n') + '\n\n';
        text += I18n.t('【新的剧情片段】') + '\n' + singles.map((s, i) => `${i + 1}. ${s.content}`).join('\n');
        return [{ role: 'user', content: text }];
    },

    /** 从压缩请求的回复里取出总结内容；格式不对返回 null。 */
    parseSummaryReply(text) {
        const s = String(text || '').trim();
        let m = s.match(/<summary\|global\|([\s\S]*)>\s*$/i);
        if (!m) m = s.match(/<summary>([\s\S]*?)<\/summary>/i);
        const body = m ? m[1].trim() : '';
        return body || null;
    },

    /**
     * 压缩一次。自动模式只在已滑出窗口的单条总结攒够数量时做；手动模式只要有已滑出的就做。
     * 失败会提示玩家，单条总结保持原样。返回 true 表示做了压缩。
     */
    async _runSummaryCompression(manual) {
        const ss = this.getSummarySystem();
        const turn = this._currentTurnNumber();
        const windowTurns = this._windowTurns();
        if (!manual && !ss.needsCompression(turn, windowTurns)) return false;
        const singles = ss.getSlidOutSingles(turn, windowTurns);
        if (!singles.length) {
            if (manual) Toast.show(I18n.t('没有已经滑出对话窗口的单条总结可以整理。'), 'info', 5000);
            return false;
        }
        const count = ss.singleSummaries.indexOf(singles[singles.length - 1]) + 1;
        const batch = ss.singleSummaries.slice(0, count);
        const messages = this.buildSummaryCompressionMessages(ss, batch);
        const retry = manual ? '' : I18n.t('下一轮会再试。');
        let response;
        try {
            response = await APIConnection.send(messages, { maxTokens: 1000, temperature: 0.3, stream: false });
        } catch (e) {
            Toast.show(I18n.t('整理剧情总结失败：{error}。', { error: e && e.message ? e.message : e }) + retry, 'warning', 8000);
            return false;
        }
        const body = this.parseSummaryReply(this._getRawContentFromResponse(response));
        if (!body) {
            Toast.show(I18n.t('AI 没有按格式给出剧情总结，这次没有保存。') + retry, 'warning', 8000);
            return false;
        }
        // 请求期间状态可能变了：重新读一份，只去掉已经并入的前 count 条
        const fresh = this.getSummarySystem();
        fresh.mergeIntoMegaSummary(body, count);
        this.saveSummarySystem(fresh);
        return true;
    },

    _compressSummariesIfNeeded() { return this._runSummaryCompression(false); },

    /** 手动整理：调试页的按钮。和自动整理共用一个任务，已有任务在跑时等它结束。 */
    compressSummariesNow() {
        if (this._summaryJob) {
            Toast.show(I18n.t('正在整理剧情总结，请稍等。'), 'info', 4000);
            return this._summaryJob;
        }
        this._summaryJob = this._runSummaryCompression(true)
            .catch(e => { Toast.show(I18n.t('整理剧情总结出错：{error}', { error: e && e.message ? e.message : e }), 'error', 8000); return false; })
            .finally(() => { this._summaryJob = null; });
        return this._summaryJob;
    },

    /** 一回合结束后调用：后台压缩，下一次发送会等它结束。 */
    scheduleSummaryJob() {
        if (this._summaryJob) return this._summaryJob;
        this._summaryJob = this._compressSummariesIfNeeded()
            .catch(e => { Toast.show(I18n.t('整理剧情总结出错：{error}', { error: e && e.message ? e.message : e }), 'error', 8000); return false; })
            .finally(() => { this._summaryJob = null; });
        return this._summaryJob;
    }
});
