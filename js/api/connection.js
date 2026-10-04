/**
 * API 连接：向各家 AI 服务发请求，并把回复整理成统一结构。
 *
 * 流式、非流式、本机命令行三条路径最后都经过 finalizeReply，返回同一结构：
 *   { content, thinking, ecot, qa, prediction, usage, finishReason, incomplete, incompleteReason, raw }
 * 出错一律抛 APIError（message 是给玩家看的话，kind 是类别）；玩家点停止抛 name 为 AbortError 的错误。
 * 流式过程中断但已经收到内容时，不抛错，返回 incomplete: true 的结果，让调用方决定怎么保留。
 */

class APIError extends Error {
    /**
     * @param {string} kind config | unsupported | network | timeout | auth | not-found | rate-limit | server | http | bad-response | empty | blocked | aborted
     * @param {string} message 给玩家看的话
     * @param {Object} [extra] status 等附加字段
     */
    constructor(kind, message, extra) {
        super(message);
        this.name = 'APIError';
        this.kind = kind;
        if (extra) Object.assign(this, extra);
    }
}

function makeAbortError() {
    const e = new Error('已停止生成');
    e.name = 'AbortError';
    e.kind = 'aborted';
    return e;
}

const APIConnection = {
    config: {
        provider: 'openai',
        endpoint: '',
        apiKey: '',
        model: '',
        relay: false,
        maxTokens: 4096,
        temperature: 0.8,
        topP: 0.9,
        frequencyPenalty: 0,
        presencePenalty: 0
    },

    /** 等待服务响应的最长时间（毫秒）：流式是两次数据之间的间隔，非流式是整次生成 */
    STREAM_IDLE_MS: 120000,
    REQUEST_MS: 300000,

    capabilities: null,

    providers: {
        claude_cli: {
            name: '本机 Claude 命令行',
            defaultEndpoint: '',
            defaultModels: ['sonnet', 'opus', 'haiku'],
            supportsModelsList: false,
            isLocalCli: true
        },
        openai: {
            name: 'OpenAI',
            defaultEndpoint: 'https://api.openai.com/v1',
            defaultModels: ['gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'],
            supportsModelsList: true
        },
        claude: {
            name: 'Claude (Anthropic)',
            defaultEndpoint: 'https://api.anthropic.com/v1',
            defaultModels: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-1'],
            supportsModelsList: true
        },
        google: {
            name: 'Google Gemini',
            defaultEndpoint: 'https://generativelanguage.googleapis.com',
            defaultModels: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-pro'],
            supportsModelsList: true
        },
        cohere: {
            name: 'Cohere',
            defaultEndpoint: 'https://api.cohere.ai/v2',
            defaultModels: ['command-r-plus', 'command-r', 'command'],
            supportsModelsList: false
        },
        mistral: {
            name: 'Mistral AI',
            defaultEndpoint: 'https://api.mistral.ai/v1',
            defaultModels: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest', 'open-mixtral-8x22b'],
            supportsModelsList: true
        },
        openrouter: {
            name: 'OpenRouter',
            defaultEndpoint: 'https://openrouter.ai/api/v1',
            defaultModels: ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'google/gemini-pro-1.5', 'meta-llama/llama-3.1-405b-instruct'],
            supportsModelsList: true
        },
        groq: {
            name: 'Groq',
            defaultEndpoint: 'https://api.groq.com/openai/v1',
            defaultModels: ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
            supportsModelsList: true
        },
        together: {
            name: 'Together AI',
            defaultEndpoint: 'https://api.together.xyz/v1',
            defaultModels: ['meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo', 'mistralai/Mixtral-8x22B-Instruct-v0.1'],
            supportsModelsList: true
        },
        deepseek: {
            name: 'DeepSeek',
            defaultEndpoint: 'https://api.deepseek.com/v1',
            defaultModels: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'],
            supportsModelsList: false
        },
        moonshot: {
            name: 'Moonshot 月之暗面',
            defaultEndpoint: 'https://api.moonshot.cn/v1',
            defaultModels: ['moonshot-v1-128k', 'moonshot-v1-32k', 'moonshot-v1-8k'],
            supportsModelsList: false
        },
        zhipu: {
            name: '智谱AI (GLM)',
            defaultEndpoint: 'https://open.bigmodel.cn/api/paas/v4',
            defaultModels: ['glm-4-plus', 'glm-4', 'glm-4-flash', 'glm-3-turbo'],
            supportsModelsList: false
        },
        qwen: {
            name: '通义千问',
            defaultEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            defaultModels: ['qwen-max', 'qwen-plus', 'qwen-turbo'],
            supportsModelsList: false
        },
        custom: {
            name: '自定义 (OpenAI兼容)',
            defaultEndpoint: '',
            defaultModels: [],
            supportsModelsList: true
        }
    },

    // ==================== 初始化与配置 ====================

    init() {
        const saved = Storage.getAPIConfig();
        if (saved) {
            Object.assign(this.config, saved);
        }
    },

    updateConfig(newConfig) {
        Object.assign(this.config, newConfig);
        return Storage.saveAPIConfig(this.config);
    },

    getCurrentProvider() {
        return this.providers[this.config.provider] || this.providers.custom;
    },

    /** 把错误文字里出现的密钥换成 ***，避免错误提示、日志带出密钥 */
    _redact(text) {
        let s = String(text == null ? '' : text);
        const key = this.config.apiKey;
        if (key && key.length >= 6) s = s.split(key).join('***');
        return s;
    },

    _isLocalEndpoint(endpoint) {
        let host;
        try { host = new URL(endpoint).hostname; } catch (e) { return false; }
        return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1' ||
            /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
    },

    /** 发送前检查配置是否填全；返回给玩家看的话，没问题返回 null */
    checkConfigured(cfg) {
        cfg = cfg || this.config;
        if (cfg.provider === 'claude_cli') return null;
        if (!cfg.endpoint) return '请先在设置里填写 API 地址。';
        let u;
        try { u = new URL(cfg.endpoint); } catch (e) { u = null; }
        if (!u || (u.protocol !== 'http:' && u.protocol !== 'https:')) {
            return 'API 地址不正确，需要以 http:// 或 https:// 开头。';
        }
        if (!cfg.apiKey && !this._isLocalEndpoint(cfg.endpoint)) return '请先在设置里填写 API 密钥。';
        if (!cfg.model) return '请先在设置里选择模型。';
        return null;
    },

    // ==================== 本机服务能力探测 ====================

    /**
     * 探测本机服务提供的能力（转发、命令行通道、写模组）。
     * 线上静态站点没有这个服务，结果里全部为 false。结果缓存，force 为 true 时重新探测。
     */
    async probeCapabilities(force) {
        if (this.capabilities && !force) return this.capabilities;
        const none = { service: false, relay: false, localCli: false, moduleWrite: false };
        try {
            const resp = await fetch('api/capabilities', { cache: 'no-store' });
            const ct = resp.headers.get('content-type') || '';
            if (resp.ok && ct.indexOf('json') >= 0) {
                const data = await resp.json();
                if (data && data.service === 'bulimia-local') {
                    this.capabilities = {
                        service: true,
                        relay: !!data.relay,
                        localCli: !!data.localCli,
                        moduleWrite: !!data.moduleWrite
                    };
                    return this.capabilities;
                }
            }
        } catch (e) { /* 没有本机服务：按不可用处理，界面会明确说明 */ }
        this.capabilities = none;
        return none;
    },

    // ==================== 错误整理 ====================

    /** 从服务商返回的错误正文里取出可读的话；网页或空内容返回空串 */
    _extractErrorText(bodyText) {
        const t = String(bodyText == null ? '' : bodyText).trim();
        if (!t) return '';
        if (t.charAt(0) === '<') return '';
        try {
            const j = JSON.parse(t);
            const e = j && (j.error !== undefined ? j.error : j);
            if (typeof e === 'string') return e;
            if (e && typeof e === 'object') {
                if (typeof e.message === 'string') return e.message;
                if (Array.isArray(e.errors) && e.errors[0] && e.errors[0].message) return String(e.errors[0].message);
                if (typeof e.detail === 'string') return e.detail;
            }
            if (j && typeof j.message === 'string') return j.message;
            if (j && typeof j.detail === 'string') return j.detail;
            return '';
        } catch (e) {
            return t;
        }
    },

    _hostOf(url) {
        try { return new URL(url).host; } catch (e) { return String(url || ''); }
    },

    _httpError(status, bodyText, resp, host) {
        const detail = this._redact(this._extractErrorText(bodyText));
        const tail = detail ? `\n服务商返回：${detail}` : '';
        if (status === 401 || status === 403) {
            return new APIError('auth', `服务商没有接受密钥（${status}），请在设置里检查密钥和 API 地址。${tail}`, { status });
        }
        if (status === 404) {
            return new APIError('not-found', `没有找到这个接口或模型（404），请检查 API 地址（常见是少了 /v1）和模型名称。${tail}`, { status });
        }
        if (status === 429) {
            const wait = resp && resp.headers && resp.headers.get('retry-after');
            const w = wait && /^\d+$/.test(wait) ? `，服务商建议 ${wait} 秒后再试` : '，请稍后再试';
            return new APIError('rate-limit', `服务商提示请求太频繁或额度用完（429）${w}。${tail}`, { status });
        }
        if (status === 408 || status === 504) {
            return new APIError('timeout', `服务商响应超时（${status}），请稍后再试。${tail}`, { status });
        }
        if (status === 413) {
            return new APIError('http', `发送的内容太长（413），服务商拒绝了。可以在设置里减少历史或总结长度。${tail}`, { status });
        }
        if (status >= 500) {
            return new APIError('server', `服务商暂时出错（${status}），请稍后再试。${tail}`, { status });
        }
        return new APIError('http', `服务商拒绝了这次请求（${status}）。${tail}`, { status });
    },

    _networkError(host) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            return new APIError('network', '当前没有网络连接，请联网后重试。');
        }
        const hint = (this.capabilities && this.capabilities.relay)
            ? '如果地址没有填错，可能是该服务不允许网页直接连接，请在设置里把连接方式改为「经本机转发」。'
            : '如果地址没有填错，可能是该服务不允许网页直接连接，请换一个允许网页访问的服务，或填写反向代理地址。';
        return new APIError('network', `无法连接到 ${host}。请检查网络和 API 地址。${hint}`);
    },

    // ==================== 各家请求格式 ====================

    _adapterFor(provider) {
        if (provider === 'claude') return this._adapters.claude;
        if (provider === 'google') return this._adapters.google;
        if (provider === 'cohere') return this._adapters.cohere;
        return this._adapters.openai;
    },

    /** 把 system 消息和对话消息分开，去掉只有空白的消息（部分服务商不接受空文本） */
    _splitMessages(messages) {
        const system = messages.filter(m => m.role === 'system').map(m => m.content).filter(Boolean).join('\n\n');
        const chat = messages.filter(m => m.role !== 'system' && String(m.content == null ? '' : m.content).trim() !== '');
        return { system, chat };
    },

    _stopList(cfg) {
        return Array.isArray(cfg.stop) ? cfg.stop.filter(s => typeof s === 'string' && s.length > 0) : [];
    },

    /** 该格式要求 user / assistant 交替、第一条是 user */
    _convertMessagesForClaude(messages) {
        const converted = [];
        for (const msg of messages) {
            const role = msg.role === 'user' ? 'user' : 'assistant';
            if (converted.length > 0 && converted[converted.length - 1].role === role) {
                converted[converted.length - 1].content += '\n\n' + msg.content;
            } else {
                converted.push({ role, content: msg.content });
            }
        }
        if (converted.length === 0 || converted[0].role !== 'user') {
            converted.unshift({ role: 'user', content: '(Continue)' });
        }
        return converted;
    },

    _adapters: {
        openai: {
            request(self, messages, cfg, stream) {
                const base = cfg.endpoint.replace(/\/+$/, '');
                const headers = { 'Content-Type': 'application/json' };
                if (cfg.apiKey) headers['Authorization'] = 'Bearer ' + cfg.apiKey;
                if (stream) headers['Accept'] = 'text/event-stream';
                if (cfg.provider === 'openrouter') {
                    headers['HTTP-Referer'] = window.location.href;
                    headers['X-Title'] = 'Bulimia Game';
                }
                const body = { model: cfg.model, messages: messages, temperature: cfg.temperature, top_p: cfg.topP, stream: !!stream };
                // 官方接口新模型只认 max_completion_tokens
                body[cfg.provider === 'openai' ? 'max_completion_tokens' : 'max_tokens'] = cfg.maxTokens;
                if (cfg.frequencyPenalty) body.frequency_penalty = cfg.frequencyPenalty;
                if (cfg.presencePenalty) body.presence_penalty = cfg.presencePenalty;
                const stop = self._stopList(cfg);
                if (stop.length) body.stop = stop;
                return { url: base + '/chat/completions', headers, body };
            },
            parse(self, data) {
                const choice = data && data.choices && data.choices[0];
                const msg = (choice && choice.message) || {};
                let text = msg.content;
                if (Array.isArray(text)) text = text.map(p => (p && p.text) || '').join('');
                return {
                    text: typeof text === 'string' ? text : '',
                    reasoning: msg.reasoning_content || msg.reasoning || '',
                    finish: (choice && choice.finish_reason) || null,
                    usage: data && data.usage ? data.usage : null
                };
            },
            event(self, name, obj, acc) {
                if (obj && obj.error) throw self._streamError(obj.error);
                const choice = obj && obj.choices && obj.choices[0];
                let delta = '';
                if (choice) {
                    const d = choice.delta || {};
                    if (typeof d.content === 'string') delta = d.content;
                    else if (typeof d.text === 'string') delta = d.text;
                    const r = d.reasoning_content || d.reasoning;
                    if (r) acc.reasoning += r;
                    if (choice.finish_reason) { acc.finish = choice.finish_reason; acc.ended = true; }
                }
                if (obj && obj.usage) acc.usage = obj.usage;
                return delta;
            },
            modelsRequest(self, cfg) {
                const headers = { 'Content-Type': 'application/json' };
                if (cfg.apiKey) headers['Authorization'] = 'Bearer ' + cfg.apiKey;
                if (cfg.provider === 'openrouter') {
                    headers['HTTP-Referer'] = window.location.href;
                    headers['X-Title'] = 'Bulimia Game';
                }
                return { url: cfg.endpoint.replace(/\/+$/, '') + '/models', headers };
            },
            parseModels(data) {
                const list = Array.isArray(data) ? data : (data && (data.data || data.models)) || [];
                return list.map(m => typeof m === 'string' ? { id: m } : { id: m.id || m.name, name: m.name }).filter(m => m.id);
            }
        },

        claude: {
            request(self, messages, cfg, stream) {
                const base = cfg.endpoint.replace(/\/+$/, '');
                const split = self._splitMessages(messages);
                const headers = {
                    'Content-Type': 'application/json',
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true',
                    'x-api-key': cfg.apiKey
                };
                // 新模型不允许同时给 temperature 和 top_p，只发 temperature
                const body = {
                    model: cfg.model,
                    max_tokens: cfg.maxTokens,
                    temperature: cfg.temperature,
                    messages: self._convertMessagesForClaude(split.chat),
                    stream: !!stream
                };
                if (split.system) body.system = split.system;
                const stop = self._stopList(cfg).filter(s => s.trim() !== '');
                if (stop.length) body.stop_sequences = stop;
                return { url: base + '/messages', headers, body };
            },
            parse(self, data) {
                const blocks = Array.isArray(data && data.content) ? data.content : [];
                const u = data && data.usage;
                const stopReason = data && data.stop_reason;
                return {
                    text: blocks.filter(b => b.type === 'text').map(b => b.text || '').join(''),
                    reasoning: blocks.filter(b => b.type === 'thinking').map(b => b.thinking || '').join(''),
                    finish: stopReason === 'max_tokens' ? 'length' : (stopReason === 'refusal' ? 'content_filter' : stopReason || null),
                    usage: u ? { prompt_tokens: u.input_tokens, completion_tokens: u.output_tokens, total_tokens: (u.input_tokens || 0) + (u.output_tokens || 0) } : null
                };
            },
            event(self, name, obj, acc) {
                const type = (obj && obj.type) || name;
                if (type === 'error') throw self._streamError(obj.error || obj);
                if (type === 'message_start' && obj.message && obj.message.usage) {
                    acc.usage = { prompt_tokens: obj.message.usage.input_tokens || 0, completion_tokens: obj.message.usage.output_tokens || 0 };
                } else if (type === 'content_block_delta' && obj.delta) {
                    if (obj.delta.type === 'text_delta') return obj.delta.text || '';
                    if (obj.delta.type === 'thinking_delta') acc.reasoning += obj.delta.thinking || '';
                } else if (type === 'message_delta') {
                    const sr = obj.delta && obj.delta.stop_reason;
                    if (sr) acc.finish = sr === 'max_tokens' ? 'length' : (sr === 'refusal' ? 'content_filter' : sr);
                    if (obj.usage) {
                        acc.usage = acc.usage || { prompt_tokens: 0 };
                        acc.usage.completion_tokens = obj.usage.output_tokens || 0;
                    }
                } else if (type === 'message_stop') {
                    acc.ended = true;
                }
                return '';
            },
            modelsRequest(self, cfg) {
                return {
                    url: cfg.endpoint.replace(/\/+$/, '') + '/models?limit=1000',
                    headers: { 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true', 'x-api-key': cfg.apiKey }
                };
            },
            parseModels(data) {
                return ((data && data.data) || []).map(m => ({ id: m.id, name: m.display_name })).filter(m => m.id);
            }
        },

        google: {
            request(self, messages, cfg, stream) {
                const base = cfg.endpoint.replace(/\/+$/, '');
                const model = String(cfg.model).replace(/^models\//, '');
                const split = self._splitMessages(messages);
                // 密钥放请求头，不放地址里
                const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey };
                const generationConfig = { maxOutputTokens: cfg.maxTokens, temperature: cfg.temperature, topP: cfg.topP, candidateCount: 1 };
                const stop = self._stopList(cfg);
                if (stop.length) generationConfig.stopSequences = stop;
                const body = {
                    contents: split.chat.map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] })),
                    generationConfig,
                    safetySettings: [
                        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
                    ]
                };
                if (split.system) body.systemInstruction = { parts: [{ text: split.system }] };
                const url = `${base}/v1beta/models/${encodeURIComponent(model)}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
                return { url, headers, body };
            },
            _fromResponse(self, data, acc) {
                if (data && data.promptFeedback && data.promptFeedback.blockReason) {
                    throw new APIError('blocked', `这次请求被 Google 的安全过滤拦截了（${data.promptFeedback.blockReason}）。`);
                }
                const cand = data && data.candidates && data.candidates[0];
                const parts = (cand && cand.content && cand.content.parts) || [];
                const text = parts.filter(p => p.text && !p.thought).map(p => p.text).join('');
                const reasoning = parts.filter(p => p.text && p.thought).map(p => p.text).join('');
                const fr = cand && cand.finishReason;
                let finish = null;
                if (fr) {
                    if (fr === 'STOP') finish = 'stop';
                    else if (fr === 'MAX_TOKENS') finish = 'length';
                    else finish = 'content_filter';
                }
                const m = data && data.usageMetadata;
                const usage = m ? { prompt_tokens: m.promptTokenCount, completion_tokens: m.candidatesTokenCount, total_tokens: m.totalTokenCount } : null;
                return { text, reasoning, finish, usage, rawFinish: fr || null };
            },
            parse(self, data) {
                return this._fromResponse(self, data);
            },
            event(self, name, obj, acc) {
                if (obj && obj.error) throw self._streamError(obj.error);
                const r = this._fromResponse(self, obj);
                if (r.reasoning) acc.reasoning += r.reasoning;
                if (r.usage) acc.usage = r.usage;
                if (r.finish) { acc.finish = r.finish; acc.ended = true; }
                return r.text;
            },
            modelsRequest(self, cfg) {
                return {
                    url: cfg.endpoint.replace(/\/+$/, '') + '/v1beta/models?pageSize=1000',
                    headers: { 'x-goog-api-key': cfg.apiKey }
                };
            },
            parseModels(data) {
                return ((data && data.models) || [])
                    .filter(m => !m.supportedGenerationMethods || m.supportedGenerationMethods.indexOf('generateContent') >= 0)
                    .map(m => ({ id: String(m.name).replace(/^models\//, ''), name: m.displayName }));
            }
        },

        cohere: {
            request(self, messages, cfg, stream) {
                const base = cfg.endpoint.replace(/\/+$/, '');
                const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey };
                const body = {
                    model: cfg.model,
                    messages: messages.map(m => ({ role: m.role === 'user' ? 'user' : (m.role === 'system' ? 'system' : 'assistant'), content: m.content })),
                    max_tokens: cfg.maxTokens,
                    temperature: cfg.temperature,
                    p: cfg.topP,
                    stream: !!stream
                };
                const stop = self._stopList(cfg);
                if (stop.length) body.stop_sequences = stop;
                return { url: base + '/chat', headers, body };
            },
            _finish(fr) {
                if (!fr) return null;
                if (fr === 'COMPLETE' || fr === 'STOP_SEQUENCE') return 'stop';
                if (fr === 'MAX_TOKENS') return 'length';
                return fr;
            },
            _usage(u) {
                const t = u && (u.tokens || u.billed_units);
                if (!t) return null;
                return { prompt_tokens: t.input_tokens, completion_tokens: t.output_tokens, total_tokens: (t.input_tokens || 0) + (t.output_tokens || 0) };
            },
            parse(self, data) {
                const blocks = Array.isArray(data && data.message && data.message.content) ? data.message.content : [];
                return {
                    text: blocks.filter(b => b.type === 'text').map(b => b.text || '').join(''),
                    reasoning: blocks.filter(b => b.type === 'thinking').map(b => b.thinking || '').join(''),
                    finish: this._finish(data && data.finish_reason),
                    usage: this._usage(data && data.usage)
                };
            },
            event(self, name, obj, acc) {
                const type = (obj && obj.type) || name;
                if (type === 'content-delta') {
                    const c = obj.delta && obj.delta.message && obj.delta.message.content;
                    if (c && c.thinking) acc.reasoning += c.thinking;
                    return (c && c.text) || '';
                }
                if (type === 'message-end') {
                    acc.ended = true;
                    acc.finish = this._finish(obj.delta && obj.delta.finish_reason) || 'stop';
                    const u = this._usage(obj.delta && obj.delta.usage);
                    if (u) acc.usage = u;
                }
                return '';
            },
            modelsRequest() { return null; },
            parseModels() { return []; }
        }
    },

    /** 流式事件里带的错误对象转成 APIError */
    _streamError(err) {
        const msg = typeof err === 'string' ? err : (err && (err.message || err.type)) || '';
        return new APIError('server', `服务商在回复过程中报错：${this._redact(msg) || '未知错误'}`);
    },

    // ==================== 发送：主入口 ====================

    /**
     * @param {Array|string} messages
     * @param {Object} options maxTokens / temperature / topP / frequencyPenalty / presencePenalty / stop /
     *   stream + onChunk(chunk, full) / signal（外部中断）/ timeoutMs
     */
    async send(messages, options = {}) {
        if (typeof messages === 'string') messages = [{ role: 'user', content: messages }];
        const cfg = Object.assign({}, this.config, options);
        const problem = this.checkConfigured(cfg);
        if (problem) throw new APIError('config', problem);

        Events.emit(EVENT_TYPES.API_REQUEST_START, { messages });
        try {
            const result = cfg.provider === 'claude_cli'
                ? await this._sendClaudeCli(messages, cfg, options)
                : await this._sendHttp(messages, cfg, options);
            Events.emit(EVENT_TYPES.API_REQUEST_SUCCESS, result);
            if (result.usage) {
                State.tokenStats = State.tokenStats || { history: [] };
                State.tokenStats.history.push({
                    timestamp: Date.now(),
                    tokens: result.usage.total_tokens || 0,
                    prompt: result.usage.prompt_tokens,
                    completion: result.usage.completion_tokens
                });
                if (State.tokenStats.history.length > 100) State.tokenStats.history.shift();
            }
            return result;
        } catch (error) {
            Events.emit(EVENT_TYPES.API_REQUEST_ERROR, error);
            throw error;
        }
    },

    /** 一次请求的中断控制：外部 signal、等待超时合并成一个 AbortController */
    _makeGuard(externalSignal) {
        const ctl = new AbortController();
        const guard = { ctl, timedOut: false, userAborted: false, timer: null };
        const onExternal = () => { guard.userAborted = true; ctl.abort(); };
        if (externalSignal) {
            if (externalSignal.aborted) { guard.userAborted = true; ctl.abort(); }
            else externalSignal.addEventListener('abort', onExternal);
        }
        guard.arm = (ms) => {
            clearTimeout(guard.timer);
            guard.timer = setTimeout(() => { guard.timedOut = true; ctl.abort(); }, ms);
        };
        guard.done = () => {
            clearTimeout(guard.timer);
            if (externalSignal) externalSignal.removeEventListener('abort', onExternal);
        };
        return guard;
    },

    /** 发请求；经本机转发时把请求交给本机服务 */
    async _fetch(req, cfg, signal) {
        const hasBody = req.body !== undefined;
        const bodyText = hasBody ? JSON.stringify(req.body) : undefined;
        if (cfg.relay) {
            const caps = await this.probeCapabilities();
            if (!caps.relay) {
                throw new APIError('unsupported', '「经本机转发」只能在本机运行游戏时使用，请在设置里把连接方式改回直连。');
            }
            const resp = await fetch('api/relay', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: req.url, method: hasBody ? 'POST' : 'GET', headers: req.headers, body: bodyText }),
                signal
            });
            const relayError = resp.headers.get('X-Relay-Error');
            if (relayError) {
                let msg = '';
                try { msg = (await resp.json()).message; } catch (e) { /* 没有说明文字 */ }
                throw new APIError('network', msg || '本机转发失败，请重试。');
            }
            return resp;
        }
        return fetch(req.url, { method: hasBody ? 'POST' : 'GET', headers: req.headers, body: bodyText, signal });
    },

    /** 发请求并把各种失败整理成 APIError / AbortError；成功返回 Response */
    async _request(req, cfg, guard, waitMs) {
        guard.arm(waitMs);
        let resp;
        try {
            resp = await this._fetch(req, cfg, guard.ctl.signal);
        } catch (e) {
            guard.done();
            if (guard.userAborted) throw makeAbortError();
            if (guard.timedOut) throw new APIError('timeout', `等待 ${this._hostOf(req.url)} 响应超过 ${Math.round(waitMs / 1000)} 秒，已停止。请检查网络，或稍后再试。`);
            if (e instanceof APIError) throw e;
            throw this._networkError(this._hostOf(req.url));
        }
        if (!resp.ok) {
            let text = '';
            try { text = await resp.text(); } catch (e) { /* 错误正文读不出来，只报状态码 */ }
            guard.done();
            throw this._httpError(resp.status, text, resp, this._hostOf(req.url));
        }
        return resp;
    },

    async _sendHttp(messages, cfg, options) {
        const adapter = this._adapterFor(cfg.provider);
        const wantStream = !!(options.stream && options.onChunk);
        const req = adapter.request(this, messages, cfg, wantStream);
        const guard = this._makeGuard(options.signal);
        const waitMs = options.timeoutMs || (wantStream ? this.STREAM_IDLE_MS : this.REQUEST_MS);
        const resp = await this._request(req, cfg, guard, waitMs);

        const acc = { text: '', reasoning: '', usage: null, finish: null, ended: false };
        let incompleteReason = null;
        let incompleteDetail = null;

        // 要流式却收到网页：地址不对；收到整块 JSON：服务不支持流式，按非流式读
        const contentType = resp.headers.get('content-type') || '';
        if (wantStream && /html/i.test(contentType)) {
            guard.done();
            throw new APIError('bad-response', '服务返回了网页而不是 AI 回复，可能不是 AI 服务的地址（常见是少了 /v1）。');
        }
        const readAsJson = !wantStream || /json/i.test(contentType);

        if (readAsJson) {
            let data;
            try {
                const raw = await resp.text();
                try { data = JSON.parse(raw); } catch (e) {
                    guard.done();
                    throw new APIError('bad-response', '服务返回的内容无法读取，可能不是 AI 服务的地址（常见是少了 /v1）。');
                }
            } catch (e) {
                guard.done();
                if (e instanceof APIError) throw e;
                if (guard.userAborted) throw makeAbortError();
                if (guard.timedOut) throw new APIError('timeout', `等待 ${this._hostOf(req.url)} 响应超过 ${Math.round(waitMs / 1000)} 秒，已停止。`);
                throw this._networkError(this._hostOf(req.url));
            }
            guard.done();
            if (data && data.error) throw this._streamError(data.error);
            const p = adapter.parse(this, data);
            acc.text = p.text; acc.reasoning = p.reasoning; acc.finish = p.finish; acc.usage = p.usage;
            if (wantStream && acc.text) options.onChunk(acc.text, acc.text);
            return this._completeResult(messages, acc, wantStream, null, null);
        }

        // 流式
        const parser = this._makeSSEParser((name, payload) => {
            if (payload === '[DONE]') { acc.ended = true; return; }
            let obj;
            try { obj = JSON.parse(payload); } catch (e) { return; }
            const delta = adapter.event(this, name, obj, acc);
            if (delta) {
                acc.text += delta;
                options.onChunk(delta, acc.text);
            }
        });
        try {
            if (resp.body && resp.body.getReader) {
                const reader = resp.body.getReader();
                const decoder = new TextDecoder();
                for (;;) {
                    guard.arm(waitMs);
                    const { done, value } = await reader.read();
                    if (done) break;
                    parser.push(decoder.decode(value, { stream: true }));
                }
                parser.push(decoder.decode());
            } else {
                parser.push(await resp.text());
            }
            parser.end();
        } catch (e) {
            guard.done();
            if (guard.userAborted) throw makeAbortError();
            if (e instanceof APIError) {
                // 流到一半服务商报错：已收到内容就保留，没有就直接报错
                if (!acc.text.trim()) throw e;
                incompleteReason = 'error';
                incompleteDetail = e.message;
            } else {
                incompleteReason = guard.timedOut ? 'timeout' : 'interrupted';
            }
        }
        guard.done();
        if (!incompleteReason && !acc.ended) incompleteReason = 'cut';
        return this._completeResult(messages, acc, true, incompleteReason, incompleteDetail);
    },

    /** 流式/非流式共用的收尾：空回复、被截断、被过滤的判断，然后统一整理 */
    _completeResult(messages, acc, streamed, incompleteReason, incompleteDetail) {
        if (!acc.text.trim()) {
            if (incompleteReason) {
                throw new APIError('network', '回复中途断开了，没有收到任何内容。请重试。');
            }
            if (acc.finish === 'content_filter') {
                throw new APIError('blocked', '回复被服务商的内容过滤拦截了，请调整输入后重试。');
            }
            if (acc.finish === 'length' && acc.reasoning) {
                throw new APIError('empty', '回复是空的：模型把长度上限都用在思考上了。请在输出预设里调大最大长度。');
            }
            throw new APIError('empty', '服务返回了空回复，请重试。如果经常出现，请检查模型名称。');
        }
        return this.finalizeReply({
            text: acc.text, reasoning: acc.reasoning, usage: acc.usage, finish: acc.finish,
            messages, streamed, incomplete: !!incompleteReason, incompleteReason, incompleteDetail
        });
    },

    /**
     * SSE 解析：按空行分事件，data 多行合并，兼容 \r\n，兼容 "data:" 后没有空格。
     * @param {function(string, string)} onEvent (事件名, data 文本)
     */
    _makeSSEParser(onEvent) {
        let buf = '';
        let eventName = '';
        let dataLines = [];
        const flush = () => {
            if (dataLines.length) onEvent(eventName, dataLines.join('\n'));
            eventName = '';
            dataLines = [];
        };
        const line = (l) => {
            if (l === '') { flush(); return; }
            if (l.charAt(0) === ':') return;
            const i = l.indexOf(':');
            const field = i < 0 ? l : l.slice(0, i);
            let value = i < 0 ? '' : l.slice(i + 1);
            if (value.charAt(0) === ' ') value = value.slice(1);
            if (field === 'data') dataLines.push(value);
            else if (field === 'event') eventName = value;
        };
        return {
            push(text) {
                buf += text;
                let m;
                while ((m = /\r\n|\n|\r/.exec(buf))) {
                    // 末尾单独的 \r 可能是 \r\n 的前半，等下一块
                    if (m[0] === '\r' && m.index === buf.length - 1) break;
                    const l = buf.slice(0, m.index);
                    buf = buf.slice(m.index + m[0].length);
                    line(l);
                }
            },
            end() {
                if (buf) { line(buf.replace(/\r$/, '')); buf = ''; }
                flush();
            }
        };
    },

    // ==================== 回复整理（三条路径共用） ====================

    /**
     * 把收到的全文整理成统一结构：取出 ECoT、思考、问答区、预测区，去掉角色标签，补 token 用量。
     * @param {{text:string, reasoning?:string, usage?:Object, finish?:string, messages?:Array, streamed?:boolean, incomplete?:boolean, incompleteReason?:string, incompleteDetail?:string}} p
     */
    finalizeReply(p) {
        const original = p.text || '';
        let content = original;
        const reasoning = p.reasoning || '';

        let ecot = null;
        const ecotCommentRe = /<!--\s*Start\s+the\s+ECoT\s*-->([\s\S]*?)<!--\s*End\s+of\s+(?:The\s+)?ECoT\s*-->/i;
        const ecotCommentMatch = content.match(ecotCommentRe);
        if (ecotCommentMatch) {
            ecot = ecotCommentMatch[1].trim();
            content = content.replace(ecotCommentRe, '');
        } else {
            const ecotTagRe = /<e-cot>([\s\S]*?)<\/e-cot>/i;
            const ecotTagMatch = content.match(ecotTagRe);
            if (ecotTagMatch) {
                ecot = ecotTagMatch[1].trim();
                content = content.replace(ecotTagRe, '');
            }
        }

        // 思考块：按显示设置里的标签，另外认模型自带的 <think>
        let thinking = null;
        const settings = Storage.getSettings() || {};
        const format = settings.thinkingFormat || 'tags';
        const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pairs = [];
        if (format === 'tags' || format === 'custom') {
            const s = format === 'custom' ? (settings.thinkingStartTag || '<thinking>') : '<thinking>';
            const e = format === 'custom' ? (settings.thinkingEndTag || '</thinking>') : '</thinking>';
            pairs.push([s, e]);
        }
        pairs.push(['<think>', '</think>']);
        for (const pair of pairs) {
            const re = new RegExp(escapeRegex(pair[0]) + '([\\s\\S]*?)' + escapeRegex(pair[1]), 'i');
            const m = content.match(re);
            if (m) {
                thinking = thinking ? thinking + '\n\n' + m[1].trim() : m[1].trim();
                if (settings.hide_thinking !== false) {
                    content = content.replace(new RegExp(escapeRegex(pair[0]) + '[\\s\\S]*?' + escapeRegex(pair[1]), 'gi'), '');
                }
            }
        }
        if (reasoning && reasoning.trim()) {
            thinking = thinking ? reasoning.trim() + '\n\n' + thinking : reasoning.trim();
        }

        // 问答区、预测区只提取，不从正文里移除（后面的解析还要用）
        let qa = null;
        let prediction = null;
        const qaMatch = content.match(/<!--\s*问答区\s*-->([\s\S]*?)<!--\s*结束问答区\s*-->/i) ||
            content.match(/<qa>([\s\S]*?)<\/qa>/i) ||
            content.match(/【问答区】([\s\S]*?)【结束问答区】/i);
        if (qaMatch) qa = qaMatch[1].trim();
        const predictionMatch = content.match(/<!--\s*预测区\s*-->([\s\S]*?)<!--\s*结束预测区\s*-->/i) ||
            content.match(/<prediction>([\s\S]*?)<\/prediction>/i) ||
            content.match(/【预测区】([\s\S]*?)【结束预测区】/i);
        if (predictionMatch) prediction = predictionMatch[1].trim();

        content = content
            .replace(/【User[：:]\s*】/gi, '').replace(/【AI[：:]\s*】/gi, '').replace(/【系统[：:]\s*】/gi, '')
            .replace(/\[User[：:]\s*\]/gi, '').replace(/\[AI[：:]\s*\]/gi, '').replace(/\[System[：:]\s*\]/gi, '')
            .replace(/\n{3,}/g, '\n\n').trim();

        let usage = p.usage || null;
        if (usage && usage.total_tokens == null) {
            usage = Object.assign({}, usage, { total_tokens: (usage.prompt_tokens || 0) + (usage.completion_tokens || 0) });
        }
        if (!usage && typeof TokenCounter !== 'undefined') {
            const inputTokens = Array.isArray(p.messages) ? TokenCounter.countMessages(p.messages) : 0;
            const outputTokens = TokenCounter.countText(content);
            usage = { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens, estimated: true };
        }

        return {
            content,
            thinking,
            ecot,
            qa,
            prediction,
            usage,
            finishReason: p.finish || null,
            incomplete: !!p.incomplete,
            incompleteReason: p.incompleteReason || null,
            incompleteDetail: p.incompleteDetail || null,
            raw: { fullContent: original, thinking, ecot, qa, prediction, streamed: !!p.streamed }
        };
    },

    // ==================== 本机命令行 ====================

    /** 本机服务 /api/chat：服务端用本机的 claude 命令行回答，SSE 回传 */
    async _sendClaudeCli(messages, cfg, options) {
        const caps = await this.probeCapabilities();
        if (!caps.service) {
            throw new APIError('unsupported', '「本机 Claude 命令行」只能在本机运行游戏时使用，请在设置里换一个 API 服务商。');
        }
        if (!caps.localCli) {
            throw new APIError('unsupported', '本机没有找到 Claude 命令行，请先安装并登录，或在设置里换一个 API 服务商。');
        }
        const sys = messages.find(m => m.role === 'system');
        const chat = messages.filter(m => m.role !== 'system');
        const body = { system: sys ? sys.content : '', messages: chat.length ? chat : messages, model: cfg.model || '' };

        const guard = this._makeGuard(options.signal);
        guard.arm(options.timeoutMs || this.REQUEST_MS);
        let resp;
        try {
            resp = await fetch('api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
                body: JSON.stringify(body),
                signal: guard.ctl.signal
            });
        } catch (e) {
            guard.done();
            if (guard.userAborted) throw makeAbortError();
            if (guard.timedOut) throw new APIError('timeout', '等待本机 Claude 命令行响应超时，已停止。');
            throw new APIError('network', '无法连接本机服务，请确认游戏是用 Start.bat 启动的。');
        }
        if (!resp.ok) {
            let msg = '';
            try { msg = (await resp.json()).message; } catch (e) { /* 没有说明文字 */ }
            guard.done();
            throw new APIError(resp.status === 429 ? 'rate-limit' : 'http', msg || `本机 Claude 命令行请求失败（${resp.status}）。`, { status: resp.status });
        }

        const acc = { text: '', reasoning: '', usage: null, finish: null, ended: false };
        let errMsg = '';
        const parser = this._makeSSEParser((name, payload) => {
            let evt;
            try { evt = JSON.parse(payload); } catch (e) { return; }
            if (evt.type === 'text' && evt.text) {
                acc.text += evt.text;
                if (typeof options.onChunk === 'function') options.onChunk(evt.text, acc.text);
            } else if (evt.type === 'error' && evt.error) {
                errMsg = evt.error;
            } else if (evt.type === 'done') {
                acc.ended = true;
            }
        });
        let incompleteReason = null;
        try {
            const reader = resp.body.getReader();
            const decoder = new TextDecoder();
            for (;;) {
                guard.arm(options.timeoutMs || this.REQUEST_MS);
                const { done, value } = await reader.read();
                if (done) break;
                parser.push(decoder.decode(value, { stream: true }));
            }
            parser.push(decoder.decode());
            parser.end();
        } catch (e) {
            guard.done();
            if (guard.userAborted) throw makeAbortError();
            incompleteReason = guard.timedOut ? 'timeout' : 'interrupted';
        }
        guard.done();
        if (!acc.text.trim() && errMsg) throw new APIError('server', errMsg);
        if (errMsg && acc.text) incompleteReason = incompleteReason || 'interrupted';
        if (!incompleteReason && !acc.ended) incompleteReason = 'cut';
        return this._completeResult(messages, acc, true, incompleteReason, errMsg || null);
    },

    // ==================== 测试连接与读取模型 ====================

    async testConnection() {
        try {
            const response = await this.send([{ role: 'user', content: 'Say "OK" if you can hear me.' }], { maxTokens: 256, stream: false });
            return { success: true, response: response.content };
        } catch (error) {
            return { success: false, error: error.message, kind: error.kind || null };
        }
    },

    /**
     * 读取服务商的模型列表。失败时抛 APIError（调用方要让玩家看到原因）；
     * 服务商本来就没有列表接口时，返回内置的常用模型。
     */
    async fetchModels() {
        const cfg = Object.assign({}, this.config);
        const provider = this.getCurrentProvider();
        if (!provider.supportsModelsList || cfg.provider === 'claude_cli') {
            return provider.defaultModels.map(id => ({ id }));
        }
        const problem = this.checkConfigured(Object.assign({}, cfg, { model: cfg.model || '-' }));
        if (problem) throw new APIError('config', problem);

        const adapter = this._adapterFor(cfg.provider);
        const req = adapter.modelsRequest(this, cfg);
        const guard = this._makeGuard(null);
        const resp = await this._request(req, cfg, guard, 30000);
        let data;
        try {
            data = await resp.json();
        } catch (e) {
            guard.done();
            throw new APIError('bad-response', '服务返回的模型列表无法读取，可能不是 AI 服务的地址（常见是少了 /v1）。');
        }
        guard.done();
        const models = adapter.parseModels(data);
        if (!models.length) throw new APIError('empty', '服务没有返回可用的模型。');
        return models;
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { APIConnection, APIError };
}
