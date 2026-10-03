import { randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';
import { DatabaseService } from './database';
import { getAdminUserIds } from '../utils/telegram-admins';
import { logger } from '../utils/logger';

export const temporaryAccessSchema = z.object({
    enabled: z.boolean(),
    mode: z.enum(['quick', 'named']),
    public_url: z.string().max(300).default('').refine(value => {
        if (!value) return true;
        try {
            const url = new URL(value);
            return url.protocol === 'https:' && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password;
        } catch { return false; }
    }, '请输入 HTTPS 域名，不含路径或参数').transform(value => value ? new URL(value).origin : ''),
    tunnel_token: z.string().max(4096).optional(),
    duration_minutes: z.number().int().min(1).max(30).default(5),
}).strict();

type Lease = { adminId: number; expiresAt: number; claimHash: string; cookieHash?: string };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const cookieName = '__Host-nodeseek-gate';

// The credential is in the URL fragment, so it is not sent to proxy access logs or link previews.
const landing = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>临时管理入口</title><body style="font:16px system-ui;max-width:520px;margin:15vh auto;padding:24px"><h1>临时网页管理</h1><p id="message">验证后仍需使用网页登录账号。链接仅可兑换一次。</p><button id="enter">进入管理页面</button><script>
const token=location.hash.slice(1);history.replaceState(null,'',location.pathname);
document.getElementById('enter').onclick=async()=>{const b=document.getElementById('enter');b.disabled=true;try{const r=await fetch('/_temporary/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});if(!r.ok)throw Error();location.replace('/');}catch{document.getElementById('message').textContent='链接已过期、已使用或已关闭，请私聊 Bot 重新获取。';}};
</script></body></html>`;

export class TemporaryAccessService {
    private leases = new Map<number, Lease>();
    private server: ReturnType<typeof Bun.serve> | null = null;
    private child: ReturnType<typeof Bun.spawn> | null = null;
    private timer: ReturnType<typeof setInterval> | null = null;
    private starting: Promise<void> | null = null;
    private generation = 0;
    private publicUrl = '';
    private cancelStart: (() => void) | null = null;

    constructor(private db: DatabaseService, private forward: (request: Request) => Response | Promise<Response>) {}

    status() {
        this.prune();
        return { active: !!this.child, starting: !!this.starting, sessions: [...this.leases.values()].map(l => ({ adminId: l.adminId, expiresAt: l.expiresAt })) };
    }

    private valid(lease: Lease) {
        const config = this.db.getBaseConfig();
        return lease.expiresAt > Date.now() && getAdminUserIds(config?.admin_user_ids).includes(String(lease.adminId));
    }

    private prune() {
        for (const [id, lease] of this.leases) if (!this.valid(lease)) this.leases.delete(id);
        if (!this.leases.size && !this.starting && this.child) this.closeAll();
    }

    async open(adminId: number) {
        const config = this.db.getTemporaryAccessConfig();
        if (!config.enabled) throw new Error('请先在网页的“临时访问与备份”中启用 CF 隧道');
        if (!getAdminUserIds(this.db.getBaseConfig()?.admin_user_ids).includes(String(adminId))) throw new Error('无管理权限');
        if (!this.child || this.starting) {
            if (!this.starting) this.starting = this.start(config).finally(() => { this.starting = null; });
            await this.starting;
        }
        if (!this.child || !this.publicUrl) throw new Error('隧道已关闭，请重新开启');
        const token = randomBytes(32).toString('hex');
        const expiresAt = Date.now() + config.duration_minutes * 60000;
        this.leases.set(adminId, { adminId, expiresAt, claimHash: hash(token) });
        if (!this.timer) this.timer = setInterval(() => this.prune(), 1000);
        return { url: `${this.publicUrl}/_temporary#${token}`, expiresAt, minutes: config.duration_minutes };
    }

    close(adminId: number) {
        this.leases.delete(adminId);
        this.prune();
    }

    closeAll() {
        this.generation++;
        this.leases.clear();
        this.publicUrl = '';
        this.cancelStart?.();
        this.cancelStart = null;
        const child = this.child;
        this.child = null;
        if (child) { try { child.kill('SIGKILL'); } catch { /* already exited */ } }
        if (this.server) { this.server.stop(true); this.server = null; }
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
    }

    private async start(config: ReturnType<DatabaseService['getTemporaryAccessConfig']>) {
        const generation = this.generation;
        try {
            this.server = Bun.serve({ hostname: '127.0.0.1', port: 3011, fetch: request => this.handle(request), maxRequestBodySize: 4 * 1024 * 1024 });
            const args = ['cloudflared', 'tunnel', '--no-autoupdate', '--metrics', '127.0.0.1:0'];
            if (config.mode === 'named') {
                if (!config.tunnel_token || !config.public_url) throw new Error('请填写 Tunnel Token 和 HTTPS 域名');
                args.push('run');
                this.publicUrl = config.public_url.replace(/\/$/, '');
            } else args.push('--url', 'http://127.0.0.1:3011');
            const child = Bun.spawn(args, {
                env: { ...process.env, TUNNEL_TOKEN: config.mode === 'named' ? config.tunnel_token : '' },
                stdout: 'pipe', stderr: 'pipe', stdin: 'ignore',
            });
            this.child = child;
            await new Promise<void>((resolve, reject) => {
                let ready = false;
                let connected = false;
                const timeout = setTimeout(() => reject(new Error('隧道连接超时，请检查 VPS 出站网络和 CF 配置')), 45000);
                const finish = () => {
                    if (!ready && connected && this.publicUrl && generation === this.generation) {
                        ready = true; clearTimeout(timeout); this.cancelStart = null; resolve();
                    }
                };
                this.cancelStart = () => { clearTimeout(timeout); reject(new Error('隧道启动已取消')); };
                const read = async (stream: ReadableStream<Uint8Array>) => {
                    const reader = stream.getReader();
                    const decoder = new TextDecoder();
                    let buffer = '';
                    try {
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            buffer = (buffer + decoder.decode(value, { stream: true })).slice(-16000);
                            if (generation !== this.generation) continue;
                            if (config.mode === 'quick') {
                                const url = buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/);
                                if (url) this.publicUrl = url[0];
                            }
                            if (buffer.includes('Registered tunnel connection')) connected = true;
                            finish();
                        }
                    } catch { /* process shutdown closes the streams */ }
                };
                void read(child.stdout as ReadableStream<Uint8Array>);
                void read(child.stderr as ReadableStream<Uint8Array>);
                void child.exited.then(() => {
                    clearTimeout(timeout);
                    if (!ready) reject(new Error('cloudflared 启动失败，请检查 Token、域名和网络'));
                    if (this.child === child) this.closeAll();
                });
            });
        } catch (error) {
            this.closeAll();
            // Never log cloudflared output: it may contain remote tunnel credentials.
            logger.error('临时隧道启动失败');
            throw new Error(error instanceof Error && !error.message.includes('spawn') ? error.message : '无法启动 cloudflared，请更新到包含隧道组件的镜像');
        }
    }

    async handle(request: Request): Promise<Response> {
        const wrap = (body: BodyInit | null, status = 200, headers: HeadersInit = {}) => {
            const h = new Headers(headers);
            h.set('Cache-Control', 'no-store, private');
            h.set('Referrer-Policy', 'no-referrer');
            h.set('X-Content-Type-Options', 'nosniff');
            h.set('X-Frame-Options', 'DENY');
            return new Response(body, { status, headers: h });
        };
        const denied = () => wrap('临时访问已关闭或过期，请私聊 Bot 重新获取链接。', 403, { 'Content-Type': 'text/plain; charset=utf-8', 'Clear-Site-Data': '"cache", "storage", "cookies"' });
        if (!this.publicUrl) return denied();
        const path = new URL(request.url).pathname;
        if (!['GET', 'HEAD'].includes(request.method) && request.headers.get('origin') !== this.publicUrl) return denied();
        if (path === '/_temporary' && request.method === 'GET') return wrap(landing, 200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (path === '/_temporary/claim' && request.method === 'POST') {
            try {
                const body = await request.json();
                if (typeof body.token !== 'string' || body.token.length !== 64) return denied();
                const lease = [...this.leases.values()].find(l => l.claimHash === hash(body.token) && this.valid(l));
                if (!lease) return denied();
                const cookie = randomBytes(32).toString('hex');
                lease.claimHash = ''; // Single use, previews cannot consume it.
                lease.cookieHash = hash(cookie);
                return wrap('{}', 200, { 'Content-Type': 'application/json', 'Set-Cookie': `${cookieName}=${cookie}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, Math.floor((lease.expiresAt - Date.now()) / 1000))}` });
            } catch { return denied(); }
        }
        const cookie = request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
        const lease = cookie && [...this.leases.values()].find(l => l.cookieHash === hash(cookie) && this.valid(l));
        if (!lease) return denied();
        // Temporary web access never accepts Telegram webhook updates; the bot uses polling.
        if (path.startsWith('/telegram/')) return denied();
        if (path === '/_temporary/status') return wrap(JSON.stringify({ expiresAt: lease.expiresAt }), 200, { 'Content-Type': 'application/json' });
        if (path === '/sw.js' || path === '/js/pwa-register.js' || path === '/js/pwa-debug.js') return wrap('', 200, { 'Content-Type': 'application/javascript' });
        const response = await this.forward(request);
        // Expiry is checked again after slow operations; no fresh data escapes an expired lease.
        if (!this.valid(lease) || this.leases.get(lease.adminId) !== lease) return denied();
        const headers = new Headers(response.headers);
        headers.set('X-Temporary-Access', '1');
        return wrap(response.body, response.status, headers);
    }
}

let service: TemporaryAccessService | null = null;
export function initializeTemporaryAccess(forward: (request: Request) => Response | Promise<Response>) {
    service = new TemporaryAccessService(DatabaseService.create(), forward);
    return service;
}
export function getTemporaryAccess() {
    if (!service) throw new Error('临时访问服务尚未启动');
    return service;
}
