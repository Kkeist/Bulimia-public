/**
 * /api/modules —— 作者在调试页「覆盖原模组」时，把改动写回 module/<folderKey>/module.json。
 * folderKey 必须是 module/list.json 登记过的文件夹名；写入先写临时文件再替换，写失败不会动原文件。
 */
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { moduleKeyOf, isSafeSegment, readModuleList } from '../lib/publish-rules.js';

const MAX_BACKUPS = 30;

/** @param {string} moduleRoot module 文件夹  @param {{withLocal?:boolean}} [listOpts] 是否并入本机自用模组 */
export function createModulesRouter(moduleRoot, listOpts = {}) {
    const router = express.Router();
    const jsonBody = express.json({ limit: '20mb' });
    const locks = new Map();

    /** 同一个模组的写操作排队，避免两个请求同时改同一个文件 */
    function withLock(key, fn) {
        const prev = locks.get(key) || Promise.resolve();
        const next = prev.catch(() => { }).then(fn);
        locks.set(key, next);
        const clear = () => { if (locks.get(key) === next) locks.delete(key); };
        next.then(clear, clear);
        return next;
    }

    async function readList() {
        return readModuleList(path.dirname(moduleRoot), listOpts);
    }

    /** 校验 folderKey：格式合法且在 list.json 里；不合法时直接回应并返回 null */
    async function knownKey(req, res) {
        const key = req.params.folderKey;
        if (!isSafeSegment(key)) {
            res.status(400).json({ error: true, code: 'bad-module-key', message: '模组文件夹名不正确。' });
            return null;
        }
        const known = (await readList()).map(moduleKeyOf).filter(Boolean);
        if (!known.includes(key)) {
            res.status(404).json({ error: true, code: 'module-not-found', message: '没有找到这个模组。' });
            return null;
        }
        return key;
    }

    router.get('/', async (req, res) => {
        const out = [];
        for (const entry of await readList()) {
            const key = moduleKeyOf(entry);
            if (!key || !isSafeSegment(key)) continue;
            let exists = false;
            try { await fs.access(path.join(moduleRoot, key, 'module.json')); exists = true; } catch { /* 文件不存在 */ }
            out.push({ folderKey: key, id: entry.id || key, name: entry.name || key, enabled: entry.enabled !== false, exists });
        }
        res.json({ modules: out });
    });

    router.get('/:folderKey/raw', async (req, res) => {
        const key = await knownKey(req, res);
        if (!key) return;
        try {
            const txt = await fs.readFile(path.join(moduleRoot, key, 'module.json'), 'utf8');
            res.type('application/json').send(txt);
        } catch {
            res.status(404).json({ error: true, code: 'module-file-not-found', message: '没有找到这个模组的文件。' });
        }
    });

    router.post('/:folderKey/save', jsonBody, async (req, res) => {
        const key = await knownKey(req, res);
        if (!key) return;
        const body = req.body;
        if (!body || typeof body !== 'object' || Array.isArray(body)
            || typeof body.id !== 'string' || !body.id || typeof body.name !== 'string') {
            return res.status(400).json({ error: true, code: 'module-incomplete', message: '模组内容不完整，没有保存。' });
        }
        const dirPath = path.join(moduleRoot, key);
        const filePath = path.join(dirPath, 'module.json');
        try {
            await fs.access(dirPath);
        } catch {
            return res.status(404).json({ error: true, code: 'module-dir-missing', message: '模组文件夹不存在。' });
        }
        const txt = JSON.stringify(body, null, 2);
        const tmpPath = `${filePath}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
        try {
            await withLock(key, async () => {
                try {
                    await fs.writeFile(tmpPath, txt, 'utf8');
                    await fs.rename(tmpPath, filePath);
                } catch (e) {
                    await fs.rm(tmpPath, { force: true }).catch(() => { });
                    throw e;
                }
            });
            res.json({ ok: true, bytes: Buffer.byteLength(txt, 'utf8'), folderKey: key });
        } catch {
            res.status(500).json({ error: true, code: 'write-failed', message: '写入失败，原文件没有被改动。请确认磁盘空间和文件权限。' });
        }
    });

    router.post('/:folderKey/backup', async (req, res) => {
        const key = await knownKey(req, res);
        if (!key) return;
        const filePath = path.join(moduleRoot, key, 'module.json');
        try {
            await fs.access(filePath);
        } catch {
            return res.status(404).json({ error: true, code: 'no-backup-source', message: '没有现有的模组文件可备份。' });
        }
        try {
            const name = await withLock(key, async () => {
                const bakName = `module.json.bak.${Date.now()}.${crypto.randomBytes(2).toString('hex')}`;
                await fs.copyFile(filePath, path.join(moduleRoot, key, bakName));
                const files = (await fs.readdir(path.join(moduleRoot, key))).filter(f => f.startsWith('module.json.bak.')).sort();
                for (const old of files.slice(0, Math.max(0, files.length - MAX_BACKUPS))) {
                    await fs.rm(path.join(moduleRoot, key, old), { force: true });
                }
                return bakName;
            });
            res.json({ ok: true, backup: name });
        } catch {
            res.status(500).json({ error: true, code: 'backup-failed', message: '备份失败，请确认磁盘空间和文件权限。' });
        }
    });

    return router;
}
