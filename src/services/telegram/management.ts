import type { Bot, Context } from 'grammy';
import type { DatabaseService } from '../database';
import { getTemporaryAccess } from '../temporary-access';
import { isTelegramAdmin } from '../../utils/telegram-admins';
import { keywordSubSchema } from '../../utils/validation';
import { logger } from '../../utils/logger';

export async function replyPlain(ctx: Context, text: string) {
    const chars = Array.from(text);
    for (let i = 0; i < chars.length; i += 1800) await ctx.reply(chars.slice(i, i + 1800).join(''));
}

export async function addSubscription(ctx: Context, db: DatabaseService) {
    const input = (ctx.message?.text || '').replace(/^\S+\s*/, '').trim();
    // A complete /pattern/flags token may contain spaces; ordinary words keep the old AND behavior.
    const tokens = input.match(/\/(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\])+\/[dgimsuvy]*(?=\s|$)|\S+/g) || [];
    if (!tokens.length || tokens.length > 3) {
        await ctx.reply('用法：/add 关键词1 关键词2 关键词3（最多三个关键词，也支持 /正则/is）');
        return;
    }
    let sub;
    try {
        for (const token of tokens) {
            if (token.startsWith('/') && token.lastIndexOf('/') > 0) {
                const end = token.lastIndexOf('/');
                new RegExp(token.slice(1, end), token.slice(end + 1) || 'i');
            }
        }
        sub = db.createKeywordSub(keywordSubSchema.parse({ keyword1: tokens[0], keyword2: tokens[1], keyword3: tokens[2] }));
    } catch {
        await ctx.reply('添加失败：请检查正则语法和长度（每个关键词最多 1000 字符）。');
        return;
    }
    // A send failure must not be reported as a failed insert; otherwise retries create duplicates.
    await replyPlain(ctx, `✅ 订阅添加成功！\nID: ${sub.id}\n关键词：${tokens.join(' + ')}`);
}

export function registerTemporaryCommands(bot: Bot, db: DatabaseService) {
    const allowed = (ctx: Context) => isTelegramAdmin(db.getBaseConfig(), ctx);
    bot.command('web', async ctx => {
        if (!allowed(ctx)) { await ctx.reply('❌ 您没有权限使用此功能。'); return; }
        await ctx.reply('正在建立临时隧道，请稍候…');
        try {
            const result = await getTemporaryAccess().open(ctx.from!.id);
            await ctx.reply(`网页管理已开启，有效期 ${result.minutes} 分钟。\n进入后使用网页登录账号。再次 /web 会撤销你之前的链接。`, {
                reply_markup: { inline_keyboard: [[{ text: '打开管理页面', url: result.url }], [{ text: '关闭我的访问', callback_data: 'temporary_close' }]] },
                link_preview_options: { is_disabled: true },
            });
        } catch (error) {
            logger.error('开启临时访问失败');
            await ctx.reply(error instanceof Error ? error.message : '无法开启临时访问');
        }
    });
    bot.command('web_close', async ctx => {
        if (!allowed(ctx)) { await ctx.reply('❌ 您没有权限使用此功能。'); return; }
        getTemporaryAccess().close(ctx.from!.id);
        await ctx.reply('你的临时访问已关闭。');
    });
    bot.command('web_close_all', async ctx => {
        if (!allowed(ctx)) { await ctx.reply('❌ 您没有权限使用此功能。'); return; }
        getTemporaryAccess().closeAll();
        await ctx.reply('所有临时访问和隧道已关闭。');
    });
    bot.callbackQuery('temporary_close', async ctx => {
        if (!allowed(ctx)) { await ctx.answerCallbackQuery({ text: '无管理权限' }); return; }
        getTemporaryAccess().close(ctx.from!.id);
        await ctx.answerCallbackQuery({ text: '已关闭' });
        await ctx.reply('你的临时访问已关闭。');
    });
}
