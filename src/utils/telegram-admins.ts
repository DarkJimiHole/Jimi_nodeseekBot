import { z } from 'zod';
import type { Context } from 'grammy';
import type { BaseConfig } from '../types';

// Telegram 用户 ID 为正整数；频道/群组 ID 不能成为管理员。
const userIdSchema = z.string().regex(/^[1-9]\d*$/, '管理员 ID 必须是正整数用户 ID')
    .refine(value => Number.isSafeInteger(Number(value)), '管理员 ID 超出有效范围');

export const adminUserIdsSchema = z.string()
    .transform(value => value.split(/[,，\s]+/).filter(Boolean))
    .pipe(z.array(userIdSchema))
    .transform(ids => [...new Set(ids)].join(','));

export function getAdminUserIds(value?: string): string[] {
    const parsed = adminUserIdsSchema.safeParse(value ?? '');
    // 无效配置拒绝授权，不回退到通知 Chat ID。
    return parsed.success && parsed.data ? parsed.data.split(',') : [];
}

export function isTelegramAdmin(config: BaseConfig | null, ctx: Context): boolean {
    return ctx.chat?.type === 'private'
        && !!ctx.from && !ctx.from.is_bot
        && getAdminUserIds(config?.admin_user_ids).includes(String(ctx.from.id));
}
