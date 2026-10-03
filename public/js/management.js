document.addEventListener('DOMContentLoaded', () => {
    const el = id => document.getElementById(id);
    const message = (id, text) => { el(id).textContent = text; };
    async function api(path, method = 'GET', data) {
        const response = await fetch('/api/management/' + path, {
            method, cache: 'no-store', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('sessionId') || ''}` },
            ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        });
        const result = await response.json();
        if (!response.ok || result.success === false) throw new Error(result.message || '请求失败，请检查登录状态');
        return result;
    }
    let generated = null;
    el('regexForm')?.addEventListener('submit', async event => {
        event.preventDefault();
        const words = id => el(id).value.split(/\r?\n/).map(v => v.trim()).filter(Boolean);
        try {
            generated = (await api('regex', 'POST', { all: words('regexAll'), any: words('regexAny'), exclude: words('regexExclude'), sample: el('regexSample').value })).data;
            el('regexOutput').value = generated.regex;
            message('regexResult', `测试文本：${generated.matched ? '命中' : '不命中'} · ${generated.regex.length} 字符`);
            ['regexUse', 'regexCopy', 'regexCommand'].forEach(id => { el(id).disabled = false; });
        } catch (error) { message('regexResult', error.message); }
    });
    el('regexForm')?.addEventListener('input', () => {
        generated = null;
        ['regexUse', 'regexCopy', 'regexCommand'].forEach(id => { el(id).disabled = true; });
        message('regexResult', '条件已更改，请重新生成。');
    });
    el('regexUse')?.addEventListener('click', () => {
        el('keyword1').value = generated.regex;
        el('keyword1').focus();
        message('regexResult', '已填入关键词 1，点击下方“添加订阅”保存。其他过滤条件保持不变。');
    });
    async function copy(value) {
        try { await navigator.clipboard.writeText(value); message('regexResult', '已复制'); }
        catch { el('regexOutput').value = value; el('regexOutput').select(); message('regexResult', '请复制已选中的文本'); }
    }
    el('regexCopy')?.addEventListener('click', () => copy(generated.regex));
    el('regexCommand')?.addEventListener('click', () => copy(generated.command));

    function modeChanged() {
        el('temporaryNamed').hidden = el('temporaryMode').value !== 'named';
        el('temporaryQuickHint').hidden = el('temporaryMode').value !== 'quick';
    }
    async function loadTemporary() {
        try {
            const { data } = await api('temporary');
            el('temporaryEnabled').checked = data.enabled;
            el('temporaryMode').value = data.mode;
            el('temporaryUrl').value = data.public_url;
            el('temporaryMinutes').value = data.duration_minutes;
            el('temporaryToken').value = '';
            el('temporaryClearToken').checked = false;
            el('temporaryToken').placeholder = data.has_token ? '已保存；留空保留原 Token' : '粘贴 CF Tunnel Token';
            modeChanged();
            message('temporaryStatus', data.status.starting ? '隧道正在启动…' : data.status.active ? `隧道运行中，${data.status.sessions.length} 个有效访问。` : '隧道已关闭。私聊 Bot 发送 /web 开启。');
        } catch (error) { message('temporaryStatus', error.message); }
    }
    document.querySelector('[data-drawer="management"].dropdown-item')?.addEventListener('click', loadTemporary);
    el('temporaryMode')?.addEventListener('change', modeChanged);
    el('temporaryRefresh')?.addEventListener('click', loadTemporary);
    el('temporaryForm')?.addEventListener('submit', async event => {
        event.preventDefault();
        try {
            const config = { enabled: el('temporaryEnabled').checked, mode: el('temporaryMode').value, public_url: el('temporaryUrl').value.trim(), duration_minutes: Number(el('temporaryMinutes').value) };
            if (el('temporaryToken').value.trim()) config.tunnel_token = el('temporaryToken').value.trim();
            if (el('temporaryClearToken').checked) config.tunnel_token = '';
            await api('temporary', 'PUT', config);
            await loadTemporary();
            message('temporaryStatus', '配置已保存，现有临时访问已关闭。');
        } catch (error) { message('temporaryStatus', error.message); }
    });
    el('temporaryClose')?.addEventListener('click', async () => {
        try { await api('temporary/close', 'POST'); await loadTemporary(); }
        catch (error) { message('temporaryStatus', error.message); }
    });
    el('backupDownload')?.addEventListener('click', async () => {
        try {
            const data = await api('backup');
            const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
            const link = document.createElement('a');
            link.href = url; link.download = `nodeseek-config-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
            link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
            message('backupResult', '备份已生成，请妥善保管其中的 Token。');
        } catch (error) { message('backupResult', error.message); }
    });
    let backup = null;
    let selection = 0;
    const allowRestore = () => { el('backupRestore').disabled = !backup || !el('backupConfirm').checked; };
    el('backupConfirm')?.addEventListener('change', allowRestore);
    el('backupFile')?.addEventListener('change', async () => {
        const current = ++selection;
        backup = null; el('backupConfirm').checked = false; allowRestore();
        try {
            const file = el('backupFile').files[0];
            if (!file) return;
            if (file.size > 4 * 1024 * 1024) throw new Error('文件不能超过 4 MB');
            const data = JSON.parse(await file.text());
            const result = await api('backup/preview', 'POST', data);
            if (current !== selection) return;
            backup = data;
            message('backupPreview', `${result.data.subscriptions} 条订阅；备份时间 ${new Date(result.data.exportedAt).toLocaleString()}；Telegram 模式 ${result.data.mode}`);
        } catch (error) { if (current === selection) message('backupPreview', '文件无效：' + error.message); }
    });
    el('backupRestore')?.addEventListener('click', async () => {
        el('backupRestore').disabled = true;
        try {
            const result = await api('backup/restore', 'POST', backup);
            message('backupResult', [result.message, ...result.data.warnings].join('。'));
            backup = null; el('backupFile').value = ''; el('backupConfirm').checked = false;
            document.dispatchEvent(new Event('subscriptions-changed'));
        } catch (error) { message('backupResult', error.message); }
        finally { allowRestore(); }
    });

    // Temporary origins disable PWA caching and visibly lock the page when access ends.
    fetch('/_temporary/status', { cache: 'no-store' }).then(async response => {
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return;
        const { expiresAt } = await response.json();
        if (!expiresAt) return;
        const banner = document.createElement('div');
        banner.className = 'temporary-banner'; document.body.prepend(banner);
        let ended = false;
        const lock = () => {
            if (ended) return;
            ended = true; localStorage.removeItem('sessionId');
            const panel = document.createElement('div'); panel.className = 'temporary-expired';
            panel.textContent = '临时访问已结束，请私聊 Bot 发送 /web 重新开启。';
            document.body.replaceChildren(panel);
        };
        const update = () => {
            const seconds = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
            banner.textContent = `临时管理 · 剩余 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
            if (!seconds) lock();
        };
        update(); const ticker = setInterval(() => { update(); if (ended) clearInterval(ticker); }, 1000);
        const checker = setInterval(async () => {
            if (ended) { clearInterval(checker); return; }
            try { const r = await fetch('/_temporary/status', { cache: 'no-store' }); if (!r.ok) lock(); } catch { lock(); }
        }, 5000);
    }).catch(() => {});
});
