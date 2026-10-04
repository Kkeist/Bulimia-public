/**
 * /api/chat —— 本机 Claude 命令行通道（只允许本机页面使用，见 app.js 里的挂载）。
 *
 * 浏览器不能启动进程，所以由这里用本机的 claude 命令行（-p 打印模式）生成回复，
 * 再用 SSE 回传：data: {type:'text',text} / {type:'error',error} / {type:'done'}。
 * 提示词走标准输入；参数里只有固定的系统提示和校验过的模型名，不拼接任何用户输入。
 */
import express, { Router } from 'express';
import { spawn, execFile } from 'node:child_process';
import os from 'node:os';

export const router = Router();

const MAX_CONCURRENT = 2;
const RUN_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_INPUT_CHARS = 4 * 1024 * 1024;
const MODEL_RE = /^[A-Za-z0-9._:\-\[\]]{1,80}$/;

let running = 0;

export const RP_SYSTEM = '你是一套互动叙事系统的文本生成引擎，按输入里的格式要求生成剧情正文和规定的结构化标签。';

/** 命令名：环境变量 CLAUDE_BIN 可指向别的可执行文件，CLAUDE_BIN_ARGS（JSON 数组）是它的前置参数（自动化测试用假命令） */
function claudeCommand() {
    return process.env.CLAUDE_BIN || 'claude';
}
function claudePrefixArgs() {
    try {
        const a = JSON.parse(process.env.CLAUDE_BIN_ARGS || '[]');
        return Array.isArray(a) ? a.map(String) : [];
    } catch {
        return [];
    }
}

/** messages[] 转成单个提示文本（system 单独前置；多轮按角色标注拼接） */
export function buildInput({ system, messages }) {
    let input = '';
    if (system) input += `[系统指令]\n${system}\n\n`;
    const list = Array.isArray(messages) ? messages : [];
    if (list.length === 1 && list[0] && list[0].role !== 'system') {
        input += String(list[0].content ?? '');
        return input;
    }
    input += list.map((m) => {
        const role = m.role === 'user' ? '用户' : m.role === 'system' ? '系统' : '助手';
        return `[${role}]\n${m.content ?? ''}`;
    }).join('\n\n');
    return input;
}

let probeCache = null;

/** 本机有没有可用的 claude 命令行（结果缓存 60 秒） */
export function probeClaudeCli() {
    if (probeCache && Date.now() - probeCache.at < 60000) return probeCache.promise;
    const promise = new Promise((resolve) => {
        try {
            execFile(claudeCommand(), [...claudePrefixArgs(), '--version'], { timeout: 8000, windowsHide: true }, (err) => resolve(!err));
        } catch {
            resolve(false);
        }
    });
    probeCache = { at: Date.now(), promise };
    return promise;
}

function killTree(child) {
    if (!child || child.exitCode !== null) return;
    if (process.platform === 'win32') {
        execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => { });
    } else {
        child.kill('SIGKILL');
    }
}

function friendlyCliError(stderrText, code) {
    if (/log\s*in|logged in|auth|credential|api key/i.test(stderrText)) {
        return '本机的 Claude 命令行还没有登录，请先在终端里登录后再试。';
    }
    return `本机的 Claude 命令行没有正常结束（退出码 ${code}），请在终端里运行 claude 确认能正常使用。`;
}

router.post('/', express.json({ limit: '8mb' }), (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return res.status(400).json({ error: true, message: '请求内容不正确。' });
    }
    let system = typeof body.system === 'string' ? body.system : '';
    let messages = Array.isArray(body.messages) ? body.messages : [];
    if (messages.some(m => !m || typeof m !== 'object')) {
        return res.status(400).json({ error: true, message: '请求内容不正确。' });
    }
    if (!system) {
        const sys = messages.find((m) => m.role === 'system');
        if (sys) { system = String(sys.content || ''); messages = messages.filter((m) => m !== sys); }
    }
    const model = body.model === undefined || body.model === null ? '' : String(body.model);
    if (model && !MODEL_RE.test(model)) {
        return res.status(400).json({ error: true, message: '模型名称不正确。' });
    }
    const input = buildInput({ system, messages });
    if (input.length > MAX_INPUT_CHARS) {
        return res.status(413).json({ error: true, message: '内容太长，本机 Claude 命令行无法处理。' });
    }
    if (running >= MAX_CONCURRENT) {
        return res.status(429).json({ error: true, message: '本机 Claude 命令行正忙，请稍后再试。' });
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    const sse = (obj) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`); };
    let finished = false;
    const finish = () => {
        if (finished) return;
        finished = true;
        running--;
        clearTimeout(timer);
        sse({ type: 'done' });
        if (!res.writableEnded) res.end();
    };

    // 不用 --bare：它会关掉登录态。cwd 用系统临时目录，claude 就不会读到本项目的记忆文件。
    const cliArgs = [...claudePrefixArgs(), '-p', '--output-format', 'stream-json', '--verbose', '--system-prompt', RP_SYSTEM];
    if (model) cliArgs.push('--model', model);

    running++;
    let child;
    let timer;
    try {
        child = spawn(claudeCommand(), cliArgs, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, cwd: os.tmpdir() });
    } catch (e) {
        sse({ type: 'error', error: '无法启动本机的 Claude 命令行，请确认已安装并登录。' });
        finish();
        return;
    }
    timer = setTimeout(() => {
        sse({ type: 'error', error: '本机 Claude 命令行等待太久，已停止。' });
        killTree(child);
    }, RUN_TIMEOUT_MS);

    child.stdin.on('error', () => { /* 子进程提前退出，错误由 close/error 事件报告 */ });
    child.stdin.write(input);
    child.stdin.end();

    let buffer = '';
    let sentText = false;
    let stderrText = '';
    const processLine = (line) => {
        let obj;
        try { obj = JSON.parse(line); } catch { return; }
        if (obj.type === 'assistant' && obj.message?.content) {
            for (const block of obj.message.content) {
                if (block.type === 'text' && block.text) { sse({ type: 'text', text: block.text }); sentText = true; }
            }
        }
        if (obj.type === 'content_block_delta' && obj.delta?.text) { sse({ type: 'text', text: obj.delta.text }); sentText = true; }
        if (obj.type === 'result' && obj.result && !sentText) { sse({ type: 'text', text: obj.result }); sentText = true; }
    };

    child.stdout.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const l of lines) { const t = l.trim(); if (t) processLine(t); }
    });
    child.stderr.on('data', (chunk) => {
        if (stderrText.length < 4000) stderrText += chunk.toString();
    });
    child.on('close', (code) => {
        if (buffer.trim()) processLine(buffer.trim());
        if (code !== 0 && code !== null) sse({ type: 'error', error: friendlyCliError(stderrText, code) });
        finish();
    });
    child.on('error', (err) => {
        sse({
            type: 'error',
            error: err && err.code === 'ENOENT'
                ? '本机没有找到 Claude 命令行，请先安装并登录。'
                : '无法启动本机的 Claude 命令行，请确认已安装并登录。'
        });
        finish();
    });
    res.on('close', () => { if (!finished) killTree(child); });
});
