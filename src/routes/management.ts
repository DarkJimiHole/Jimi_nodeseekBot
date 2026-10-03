import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createSuccessResponse, createErrorResponse } from '../utils/helpers';
import { createValidationMiddleware } from '../utils/validation';
import { generateRegex, regexGeneratorSchema } from '../utils/regex-generator';
import { temporaryAccessSchema, getTemporaryAccess } from '../services/temporary-access';
import { exportBackup, restoreBackup, backupSchema } from '../services/config-backup';
import { restartTelegramAfterRestore } from './telegramWebhook';
import { logger } from '../utils/logger';
import type { ContextVariables } from '../types';

// Mounted after the existing session middleware in /api.
export const managementRoutes = new Hono<{ Variables: ContextVariables }>();
managementRoutes.use('*', bodyLimit({ maxSize: 4 * 1024 * 1024, onError: c => c.json(createErrorResponse('文件不能超过 4 MB'), 413) }));
managementRoutes.post('/regex', createValidationMiddleware(regexGeneratorSchema), c => {
    try { return c.json(createSuccessResponse(generateRegex(c.get('validatedData')))); }
    catch { return c.json(createErrorResponse('规则太长，请减少关键词'), 400); }
});
managementRoutes.get('/temporary', c => {
    const { tunnel_token, ...config } = c.get('dbService').getTemporaryAccessConfig();
    return c.json(createSuccessResponse({ ...config, enabled: !!config.enabled, has_token: !!tunnel_token, status: getTemporaryAccess().status() }));
});
managementRoutes.put('/temporary', createValidationMiddleware(temporaryAccessSchema), c => {
    const db = c.get('dbService');
    const config = c.get('validatedData');
    config.tunnel_token = config.tunnel_token === undefined ? db.getTemporaryAccessConfig().tunnel_token : config.tunnel_token.trim();
    if (config.mode === 'named' && (!config.public_url || !config.tunnel_token)) return c.json(createErrorResponse('自有域名模式需要域名和 Tunnel Token'), 400);
    db.saveTemporaryAccessConfig(config);
    getTemporaryAccess().closeAll();
    return c.json(createSuccessResponse(null, '已保存，现有临时访问已关闭'));
});
managementRoutes.post('/temporary/close', c => {
    getTemporaryAccess().closeAll();
    return c.json(createSuccessResponse(null, '全部临时访问已关闭'));
});
managementRoutes.get('/backup', c => {
    c.header('Cache-Control', 'no-store');
    c.header('Content-Disposition', 'attachment; filename="nodeseek-config.json"');
    return c.json(exportBackup(c.get('dbService')));
});
managementRoutes.post('/backup/preview', createValidationMiddleware(backupSchema), c => {
    const data = c.get('validatedData');
    return c.json(createSuccessResponse({ subscriptions: data.subscriptions.length, exportedAt: data.exportedAt, mode: data.telegram.telegram_mode }));
});
managementRoutes.post('/backup/restore', createValidationMiddleware(backupSchema), async c => {
    try {
        const db = c.get('dbService');
        restoreBackup(db, c.get('validatedData'));
        // Config is already committed. Report runtime restart failures separately from restore success.
        const warnings: string[] = [];
        try {
            const { schedulerService } = await import('../server');
            schedulerService?.restartRSSTask();
        } catch { warnings.push('RSS 配置已保存，重启容器后生效'); }
        try { await restartTelegramAfterRestore(db); }
        catch { warnings.push('Telegram 配置已保存，未能重连，请检查 Token 或重启容器'); }
        return c.json(createSuccessResponse({ warnings }, '配置已恢复；订阅使用新 ID，历史文章保留并解除旧订阅关联'));
    } catch (error) {
        logger.error('恢复配置备份失败:', error);
        return c.json(createErrorResponse('恢复失败，数据库修改已回滚'), 500);
    }
});
