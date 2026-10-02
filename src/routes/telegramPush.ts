import { Hono } from 'hono';
import { z } from 'zod';
import { TelegramPushService } from '../services/telegram/push';
import { createValidationMiddleware } from '../utils/validation';
import { createSuccessResponse, createErrorResponse } from '../utils/helpers';
import type { ContextVariables } from '../types';
import { logger } from '../utils/logger';

type Variables = ContextVariables;

export const telegramPushRoutes = new Hono<{ Variables: Variables }>();

// 验证 schemas
const sendMessageSchema = z.object({
  message: z.string().min(1, '消息内容不能为空').max(4096, '消息内容过长'),
  chat_id: z.string().optional()
});

// 获取 Bot 基础信息
telegramPushRoutes.get('/bot-info', async (c) => {
  try {
    const dbService = c.get('dbService');
    const config = dbService.getBaseConfig();

    if (!config?.bot_token) {
      return c.json(createErrorResponse('未配置 Bot Token'), 400);
    }

    const telegramService = new TelegramPushService(dbService, config.bot_token);
    const botInfo = await telegramService.getBotInfo();

    if (botInfo) {
      return c.json(createSuccessResponse({
        id: botInfo.id,
        username: botInfo.username,
        first_name: botInfo.first_name,
        can_join_groups: botInfo.can_join_groups,
        can_read_all_group_messages: botInfo.can_read_all_group_messages,
        supports_inline_queries: botInfo.supports_inline_queries
      }));
    } else {
      return c.json(createErrorResponse('获取 Bot 信息失败'), 500);
    }
  } catch (error) {
    return c.json(createErrorResponse(`获取 Bot 信息失败: ${error}`), 500);
  }
});

// 发送消息
telegramPushRoutes.post('/send-message', createValidationMiddleware(sendMessageSchema), async (c) => {
  try {
    const { message, chat_id } = c.get('validatedData');
    const dbService = c.get('dbService');
    const config = dbService.getBaseConfig();

    if (!config?.bot_token) {
      return c.json(createErrorResponse('未配置 Bot Token'), 400);
    }

    // 使用提供的 chat_id 或配置中的 chat_id
    const targetChatId = chat_id || config.chat_id;
    if (!targetChatId) {
      return c.json(createErrorResponse('未指定目标聊天或未绑定用户'), 400);
    }

    const telegramService = new TelegramPushService(dbService, config.bot_token);
    const success = await telegramService.sendMessage(targetChatId, message);

    if (success) {
      return c.json(createSuccessResponse({ sent: true }, '消息发送成功'));
    } else {
      return c.json(createErrorResponse('消息发送失败'), 500);
    }
  } catch (error) {
    return c.json(createErrorResponse(`发送消息失败: ${error}`), 500);
  }
});

// 测试发送消息
telegramPushRoutes.post('/test-send', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { message } = body;

    const dbService = c.get('dbService');
    const config = dbService.getBaseConfig();

    if (!config?.bot_token) {
      return c.json(createErrorResponse('未配置 Bot Token'), 400);
    }

    if (!config.chat_id) {
      return c.json(createErrorResponse('用户未绑定'), 400);
    }

    const telegramService = new TelegramPushService(dbService, config.bot_token);
    const testMessage = message || `🧪 **推送服务测试消息**\n\n⏰ **时间:** ${new Date().toLocaleString('zh-CN')}\n💡 **说明:** 这是来自推送服务的测试消息，表明推送功能正常工作。`;

    const success = await telegramService.testSendMessage(config.chat_id, testMessage);

    if (success) {
      return c.json(createSuccessResponse({ sent: true }, '测试消息发送成功'));
    } else {
      return c.json(createErrorResponse('测试消息发送失败'), 500);
    }
  } catch (error) {
    return c.json(createErrorResponse(`发送测试消息失败: ${error}`), 500);
  }
});

// 设置 Chat ID
telegramPushRoutes.post('/set-chat-id', async (c) => {
  try {
    const body = await c.req.json();
    const { chat_id } = body;

    if (!chat_id) {
      return c.json(createErrorResponse('请提供 Chat ID'), 400);
    }

    const dbService = c.get('dbService');
    const config = dbService.getBaseConfig();

    if (!config?.bot_token) {
      return c.json(createErrorResponse('请先设置 Bot Token'), 400);
    }

    // 验证 Chat ID 格式（应该是数字）
    const chatIdStr = chat_id.toString().trim();
    if (!/^-?\d+$/.test(chatIdStr)) {
      return c.json(createErrorResponse('Chat ID 格式不正确，应该是数字'), 400);
    }

    // 更新配置
    dbService.updateBaseConfig({ chat_id: chatIdStr });

    return c.json(createSuccessResponse({
      chat_id: chatIdStr,
      updated: true
    }, 'Chat ID 设置成功'));

  } catch (error) {
    return c.json(createErrorResponse(`设置 Chat ID 失败: ${error}`), 500);
  }
});

// 推送服务设置（Bot Token）
telegramPushRoutes.post('/setup', async (c) => {
  try {
    const body = await c.req.json();
    const { bot_token } = body;

    if (!bot_token) {
      return c.json(createErrorResponse('请提供 Bot Token'), 400);
    }

    const dbService = c.get('dbService');
    const telegramService = new TelegramPushService(dbService, bot_token);

    // 验证 Bot Token
    const botInfo = await telegramService.getBotInfo();
    if (!botInfo) {
      return c.json(createErrorResponse('Bot Token 无效或无法连接到 Telegram'), 400);
    }

    // 保存 Bot Token
    dbService.updateBaseConfig({ bot_token });

    return c.json(createSuccessResponse({
      bot_info: {
        id: botInfo.id,
        username: botInfo.username,
        first_name: botInfo.first_name
      },
      configured: true
    }, '推送服务设置成功'));

  } catch (error) {
    return c.json(createErrorResponse(`推送服务设置失败: ${error}`), 500);
  }
});

// 获取推送服务状态
telegramPushRoutes.get('/status', async (c) => {
  try {
    const dbService = c.get('dbService');
    const config = dbService.getBaseConfig();

    const status = {
      configured: !!config?.bot_token,
      connected: false,
      bot_info: null,
      can_send: false,
      config: {
        has_chat_id: !!config?.chat_id,
        stop_push: config?.stop_push === 1
      }
    };

    if (config?.bot_token) {
      try {
        const telegramService = new TelegramPushService(dbService, config.bot_token);
        const botInfo = await telegramService.getBotInfo();

        if (botInfo) {
          status.connected = true;
          status.bot_info = botInfo;
          status.can_send = !!config.chat_id;
        }
      } catch (error) {
        logger.error('检查推送服务状态失败:', error);
      }
    }

    return c.json(createSuccessResponse(status));
  } catch (error) {
    return c.json(createErrorResponse(`获取推送服务状态失败: ${error}`), 500);
  }
});