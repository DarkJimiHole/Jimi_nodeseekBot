import type { FC } from 'hono/jsx';

export const RegexGenerator: FC = () => (
    <details class="management-card">
        <summary>正则生成工具</summary>
        <p class="form-hint">每行一个词，按普通文字处理，自动转义符号并忽略大小写。</p>
        <form id="regexForm">
            <label class="form-label" for="regexAll">全部包含</label>
            <textarea id="regexAll" class="input-field" rows={2} placeholder="新商家" />
            <label class="form-label" for="regexAny">至少包含一个（可选）</label>
            <textarea id="regexAny" class="input-field" rows={2} placeholder={'VPS\n服务器'} />
            <label class="form-label" for="regexExclude">排除这些词（可选）</label>
            <textarea id="regexExclude" class="input-field" rows={2} placeholder="tamago" />
            <label class="form-label" for="regexSample">测试文本（单个字段）</label>
            <textarea id="regexSample" class="input-field" rows={3} placeholder="在这里粘贴标题或 RSS 摘要" />
            <p class="form-hint">正则对标题、摘要等字段分别匹配。标题命中时，摘要中的排除词不会拦截通知。</p>
            <button class="btn btn-primary" type="submit">生成并测试</button>
        </form>
        <label class="form-label" for="regexOutput">生成结果</label>
        <textarea id="regexOutput" class="input-field regex-output" rows={3} readonly />
        <p id="regexResult" class="management-message" role="status" />
        <div class="management-actions">
            <button id="regexUse" class="btn btn-secondary" type="button" disabled>填入关键词 1</button>
            <button id="regexCopy" class="btn btn-secondary" type="button" disabled>复制正则</button>
            <button id="regexCommand" class="btn btn-secondary" type="button" disabled>复制 /add 命令</button>
        </div>
    </details>
);

export const ManagementTools: FC = () => (
    <div id="managementDrawer" class="drawer drawer-large" style="display: none;">
        <div class="drawer-header">
            <h3 class="drawer-title">临时访问与备份</h3>
            <button class="drawer-close" data-drawer="management" aria-label="关闭临时访问与备份">×</button>
        </div>
        <div class="drawer-content">
            <section class="management-card">
                <h4>Cloudflare 临时访问</h4>
                <p class="form-hint">管理员私聊 Bot 发送 /web 获取一次性链接，进入后仍需网页登录。到期或 /web_close 后失效，所有人的访问结束后自动停止隧道。</p>
                <form id="temporaryForm">
                    <label class="form-label"><input type="checkbox" id="temporaryEnabled" /> 启用临时访问</label>
                    <label class="form-label" for="temporaryMode">隧道方式</label>
                    <select id="temporaryMode" class="input-field"><option value="quick">快速隧道 · 无需域名或 Token</option><option value="named">自有域名 · Cloudflare Tunnel</option></select>
                    <p id="temporaryQuickHint" class="form-hint">快速隧道每次生成随机域名，依赖 Cloudflare 测试服务，无可用性保证。</p>
                    <div id="temporaryNamed" hidden>
                        <label class="form-label" for="temporaryUrl">HTTPS 域名</label>
                        <input id="temporaryUrl" class="input-field" type="url" placeholder="https://manage.example.com" />
                        <label class="form-label" for="temporaryToken">Tunnel Token</label>
                        <input id="temporaryToken" class="input-field" type="password" autocomplete="new-password" placeholder="首次填写；留空保留已保存的 Token" />
                        <p class="form-hint">先在 CF 控制台创建专用 Tunnel。域名对应的服务地址必须为 http://127.0.0.1:3011，不能指向 3010。无需在 VPS 安装另一个连接器，也不要给此隧道配置其他服务或常驻副本。</p>
                    </div>
                    <label class="form-label"><input id="temporaryClearToken" type="checkbox" /> 清除已保存的 Token（切换到快速隧道后可用）</label>
                    <label class="form-label" for="temporaryMinutes">每次有效分钟数</label>
                    <input id="temporaryMinutes" class="input-field" type="number" min="1" max="30" value="5" required />
                    <p class="form-hint">默认 5 分钟，最长 30 分钟。保存配置会关闭所有现有临时访问。管理流量经过 Cloudflare；VPS 只需允许出站连接，3010 保持本机访问。</p>
                    <button class="btn btn-primary" type="submit">保存隧道配置</button>
                </form>
                <p id="temporaryStatus" class="management-message" role="status" />
                <div class="management-actions">
                    <button id="temporaryRefresh" class="btn btn-secondary" type="button">刷新状态</button>
                    <button id="temporaryClose" class="btn btn-secondary" type="button">关闭全部临时访问</button>
                </div>
            </section>
            <section class="management-card">
                <h4>配置备份与恢复</h4>
                <p class="form-hint">保存订阅、RSS 地址与抓取频率、代理、Telegram Bot Token、通知目标、管理员 ID 和推送设置。不包含网页登录密码、历史文章、CF 凭证及临时链接。</p>
                <p class="management-sensitive">备份是含 Bot Token 和可能的代理密码的明文 JSON，请保存在私人位置，不要上传 GitHub。</p>
                <button id="backupDownload" class="btn btn-primary" type="button">下载配置备份</button>
                <label class="form-label" for="backupFile">选择备份文件（最大 4 MB）</label>
                <input id="backupFile" class="input-field" type="file" accept="application/json,.json" />
                <p id="backupPreview" class="management-message" role="status">恢复前会校验文件并显示订阅数量。</p>
                <p class="form-hint">恢复会替换全部订阅、RSS 和 Telegram 配置，订阅会分配新 ID。历史文章保留，但解除旧订阅关联；网页登录账号和 CF 配置保留。Webhook 模式在迁移服务器后需要重新设置地址。</p>
                <label class="form-label"><input id="backupConfirm" type="checkbox" /> 我已保存当前备份，确认替换上述配置</label>
                <button id="backupRestore" class="btn btn-secondary" type="button" disabled>恢复选中的备份</button>
                <p id="backupResult" class="management-message" role="status" />
            </section>
        </div>
    </div>
);
