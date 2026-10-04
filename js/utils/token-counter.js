/**
 * Token计数器
 * 使用简单的估算方法（基于字符数）
 * 对于OpenAI模型，可以使用更精确的tiktoken库
 */

const TokenCounter = {
    /**
     * 估算token数量（简单方法：中文按2字符=1token，英文按4字符=1token）
     * @param {string} text - 要计算的文本
     * @returns {number} token数量
     */
    estimateTokens(text) {
        if (!text || typeof text !== 'string') return 0;

        // 2026-06-05：用 codePointAt 处理 surrogate pair（BMP 外的 emoji / 扩展汉字 B-E 是 supplementary plane，
        // 必须用 codePointAt 才能拿到真实 codepoint；高低位 surrogate 单独看 charCodeAt 落不在中文范围）。
        // 简单估算：中文字符按2字符=1token，英文按4字符=1token
        let chineseChars = 0;
        let englishChars = 0;

        for (let i = 0; i < text.length;) {
            const code = text.codePointAt(i);
            // 中文字符范围（含 supplementary plane 扩展 B-E）
            if (code >= 0x4E00 && code <= 0x9FFF) {
                chineseChars++;
            } else if ((code >= 0x3400 && code <= 0x4DBF) || // 扩展A
                       (code >= 0x20000 && code <= 0x2A6DF) || // 扩展B
                       (code >= 0x2A700 && code <= 0x2B73F) || // 扩展C
                       (code >= 0x2B740 && code <= 0x2B81F) || // 扩展D
                       (code >= 0x2B820 && code <= 0x2CEAF)) { // 扩展E
                chineseChars++;
            } else {
                // 非中文：trim 检查（emoji 的 ' ' 不是空白）
                const char = String.fromCodePoint(code);
                if (char.trim()) englishChars++;
            }
            // supplementary plane 占 2 个 code units (high+low surrogate)
            i += (code > 0xFFFF) ? 2 : 1;
        }

        // 估算：中文2字符=1token，英文4字符=1token
        const tokens = Math.ceil(chineseChars / 2) + Math.ceil(englishChars / 4);
        return tokens;
    },
    
    /**
     * 计算消息数组的token数量
     * @param {Array} messages - 消息数组
     * @returns {number} token数量
     */
    countMessages(messages) {
        if (!Array.isArray(messages)) return 0;
        
        let totalTokens = 0;
        
        // 每条消息的格式：{ role: '...', content: '...' }
        // 需要加上role和格式化的开销（大约4-5个token）
        const messageOverhead = 4;
        
        for (const msg of messages) {
            if (msg.content) {
                totalTokens += this.estimateTokens(msg.content);
            }
            totalTokens += messageOverhead; // role和格式开销
        }
        
        return totalTokens;
    },
    
    /**
     * 计算文本的token数量（用于显示）
     * @param {string} text - 文本
     * @returns {number} token数量
     */
    countText(text) {
        return this.estimateTokens(text);
    }
};

// 导出
if (typeof window !== 'undefined') {
    window.TokenCounter = TokenCounter;
}
