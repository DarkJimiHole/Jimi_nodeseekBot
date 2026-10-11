import { GrammyError } from 'grammy';
import { TelegramBaseService } from './base';
import type { Post, KeywordSub } from '../../types';
import { logger } from '../../utils/logger';
import { escapeHtml } from '../../utils/helpers';

/**
 * 是否为 Telegram 限流错误（429）
 */
export function isRateLimitError(error: unknown): error is GrammyError {
  return error instanceof GrammyError && error.error_code === 429;
}

export class TelegramPushService extends TelegramBaseService {
  /**
   * 发送消息到 Telegram
   */
  async sendMessage(chatId: string | number, text: string): Promise<boolean> {
    try {
      await this.bot.api.sendMessage(chatId, text, { parse_mode: 'Markdown' });
      return true;
    } catch (error) {
      logger.error('发送 Telegram 消息时出错:', error);
      return false;
    }
  }

  /**
   * 推送文章到 Telegram
   *
   * 遇到 Telegram 限流（429）时抛出错误，由调用方中断本轮推送，其余失败返回 false
   */
  async pushPost(post: Post, matchedSub: KeywordSub): Promise<boolean> {
    const config = this.dbService.getBaseConfig();
    if (!config || config.stop_push === 1) {
      return false;
    }

    // 构建帖子链接
    const postUrl = `https://www.nodeseek.com/post-${post.post_id}-1`;

    // 使用 HTML 模式，标题中的 _ * ` 等字符不会再导致解析失败
    const text = `<b><a href="${escapeHtml(postUrl)}">${escapeHtml(post.title)}</a></b>`;

    try {
      await this.bot.api.sendMessage(config.chat_id, text, { parse_mode: 'HTML' });
    } catch (error) {
      if (isRateLimitError(error)) {
        throw error;
      }
      logger.error('推送文章失败:', error);
      return false;
    }

    // 更新推送状态为 3（已匹配且已推送成功）
    this.dbService.updatePostPushStatus(
      post.post_id,
      3, // 已匹配且已推送成功
      matchedSub.id,
      new Date().toISOString()
    );
    return true;
  }

  /**
   * 测试发送消息（简化版，仅用于测试连通性）
   */
  async testSendMessage(chatId: string | number, message?: string): Promise<boolean> {
    const testMessage = message || '🧪 这是一条测试消息，表明 Bot 推送功能正常工作。';
    return await this.sendMessage(chatId, testMessage);
  }
}