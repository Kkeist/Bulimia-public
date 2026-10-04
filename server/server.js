/**
 * 启动本机服务。默认只监听 127.0.0.1；需要局域网访问页面时设置 HOST=0.0.0.0（此时转发、命令行通道、写模组等接口仍只对本机开放）。
 */
import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';

const PORT = Number(process.env.PORT) || 36426;
const HOST = process.env.HOST || '127.0.0.1';

export const app = createApp({ localModules: true });

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const server = app.listen(PORT, HOST, () => {
        const shown = HOST === '0.0.0.0' || HOST === '::' ? 'localhost' : HOST;
        console.log(`Server started: http://${shown}:${PORT}`);
        if (HOST === '0.0.0.0' || HOST === '::') {
            console.log('Listening on all network interfaces: other devices can open the game page; relay, local CLI and module writing stay local-only.');
        }
    });
    server.on('error', (err) => {
        console.error(err && err.code === 'EADDRINUSE' ? `Port ${PORT} is in use.` : `Server error: ${err && err.message}`);
        process.exit(1);
    });
}
