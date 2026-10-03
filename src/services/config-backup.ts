import { z } from 'zod';
import { keywordSubSchema } from '../utils/validation';
import { adminUserIdsSchema } from '../utils/telegram-admins';
import type { DatabaseService } from './database';

const httpUrl = z.string().url().refine(v => /^https?:\/\//i.test(v), '只支持 HTTP/HTTPS 地址');
export const backupSchema = z.object({
    format: z.literal('jimi-nodeseek-config'),
    version: z.literal(1),
    exportedAt: z.string().datetime(),
    subscriptions: z.array(keywordSubSchema).max(5000),
    rss: z.object({
        rss_url: httpUrl,
        rss_interval_seconds: z.number().int().min(10).max(3600),
        rss_proxy: z.string().max(2000),
    }).strict(),
    telegram: z.object({
        bot_token: z.string().max(300).refine(v => !v || /^\d+:[\w-]+$/.test(v), 'Bot Token 格式无效'),
        chat_id: z.string().max(100),
        admin_user_ids: adminUserIdsSchema,
        telegram_mode: z.enum(['disabled', 'polling', 'webhook']),
        stop_push: z.number().int().min(0).max(1),
        only_title: z.number().int().min(0).max(1),
    }).strict(),
}).strict();

export function exportBackup(db: DatabaseService) {
    const config = db.getBaseConfig();
    if (!config) throw new Error('请先初始化系统');
    return backupSchema.parse({
        format: 'jimi-nodeseek-config', version: 1, exportedAt: new Date().toISOString(),
        subscriptions: db.getAllKeywordSubs().map(sub => ({
            keyword1: sub.keyword1 || '', keyword2: sub.keyword2 || '', keyword3: sub.keyword3 || '',
            creator: sub.creator || '', category: sub.category || '',
        })),
        rss: { rss_url: config.rss_url || 'https://rss.nodeseek.com/', rss_interval_seconds: config.rss_interval_seconds || 60, rss_proxy: config.rss_proxy || '' },
        telegram: {
            bot_token: config.bot_token || '', chat_id: config.chat_id || '', admin_user_ids: config.admin_user_ids || '',
            telegram_mode: config.telegram_mode || 'disabled', stop_push: config.stop_push, only_title: config.only_title,
        },
    });
}

export function restoreBackup(db: DatabaseService, input: unknown) {
    const backup = backupSchema.parse(input);
    db.restoreConfiguration(backup.subscriptions, { ...backup.rss, ...backup.telegram });
    return backup;
}
