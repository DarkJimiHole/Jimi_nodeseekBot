import { Bot, Context } from 'grammy';
import { DatabaseService } from './database';
import { logger } from '../utils/logger';
import { getAdminUserIds, isTelegramAdmin } from '../utils/telegram-admins';
import type { Post, KeywordSub } from '../types';

export class TelegramService {
  private bot: Bot;
  private initialized: boolean = false;

  constructor(
    private dbService: DatabaseService,
    private botToken: string
  ) {
    this.bot = new Bot(botToken);
    this.setupHandlers();
  }

  /**
   * 初始化 Bot（获取Bot信息并缓存）
   */
  async initialize(): Promise<boolean> {
    if (this.initialized) {
      return true;
    }

    try {
      const botInfo = await this.bot.api.getMe();
      if (botInfo) {
        // 设置 botInfo 到 Bot 实例中
        this.bot.botInfo = botInfo;
        this.initialized = true;
        logger.telegram(`Bot 初始化成功: ${botInfo.username} (${botInfo.id})`);
        return true;
      }
      return false;
    } catch (error) {
      logger.error('Bot 初始化失败:', error);
      return false;
    }
  }

  /**
   * 获取分类对应的图标
   */
  private getCategoryIcon(category: string): string {
    const categoryMap: { [key: string]: string } = {
      'daily': '📅',
      'tech': '💻',
      'info': 'ℹ️',
      'review': '⭐',
      'trade': '💰',
      'carpool': '🚗',
      'promotion': '📢',
      'life': '🏠',
      'dev': '⚡',
      'photo': '📷',
      'expose': '🚨',
      'sandbox': '🏖️'
    };
    return categoryMap[category] || '📂';
  }

  private getCategoryName(category: string): string {
    const categoryMap: { [key: string]: string } = {
      'daily': '日常',
      'tech': '技术',
      'info': '情报',
      'review': '测评',
      'trade': '交易',
      'carpool': '拼车',
      'promotion': '推广',
      'life': '生活',
      'dev': 'Dev',
      'photo': '贴图',
      'expose': '曝光',
      'sandbox': '沙盒'
    };
    return categoryMap[category] || category;
  }

  /**
   * 验证用户权限
   */
  private checkUserPermission(ctx: Context): boolean {
    return isTelegramAdmin(this.dbService.getBaseConfig(), ctx);
  }

  /**
   * 设置命令处理器
   */
  private setupHandlers(): void {
    // 所有交互仅接受私聊；频道及群组消息直接忽略，避免频道出现命令回复。
    this.bot.use(async (ctx, next) => {
      if (ctx.chat?.type === 'private') await next();
    });
    // 处理 /start 命令（特殊处理，不需要权限验证）
    this.bot.command('start', async (ctx) => {
      await this.handleStartCommand(ctx);
    });

    // 处理 /stop 命令
    this.bot.command('stop', async (ctx) => {
      if (!this.checkUserPermission(ctx)) {
        await ctx.reply('❌ 您没有权限使用此功能。请在网页端将您的用户 ID 加入管理员列表（私聊 /getme 可查看 ID）。');
        return;
      }
      await this.handleStopCommand(ctx);
    });

    // 处理 /resume 命令
    this.bot.command('resume', async (ctx) => {
      if (!this.checkUserPermission(ctx)) {
        await ctx.reply('❌ 您没有权限使用此功能。请在网页端将您的用户 ID 加入管理员列表（私聊 /getme 可查看 ID）。');
        return;
      }
      await this.handleResumeCommand(ctx);
    });

    // 处理 /list 命令
    this.bot.command('list', async (ctx) => {
      if (!this.checkUserPermission(ctx)) {
        await ctx.reply('❌ 您没有权限使用此功能。请在网页端将您的用户 ID 加入管理员列表（私聊 /getme 可查看 ID）。');
        return;
      }
      await this.handleListCommand(ctx);
    });

    // 处理 /add 命令
    this.bot.command('add', async (ctx) => {
      if (!this.checkUserPermission(ctx)) {
        await ctx.reply('❌ 您没有权限使用此功能。请在网页端将您的用户 ID 加入管理员列表（私聊 /getme 可查看 ID）。');
        return;
      }
      await this.handleAddCommand(ctx);
    });

    // 处理 /del 命令
    this.bot.command('del', async (ctx) => {
      if (!this.checkUserPermission(ctx)) {
        await ctx.reply('❌ 您没有权限使用此功能。请在网页端将您的用户 ID 加入管理员列表（私聊 /getme 可查看 ID）。');
        return;
      }
      await this.handleDeleteCommand(ctx);
    });

    // 处理 /post 命令
    this.bot.command('post', async (ctx) => {
      if (!this.checkUserPermission(ctx)) {
        await ctx.reply('❌ 您没有权限使用此功能。请在网页端将您的用户 ID 加入管理员列表（私聊 /getme 可查看 ID）。');
        return;
      }
      await this.handlePostCommand(ctx);
    });

    // 处理 /help 命令（允许所有人查看）
    this.bot.command('help', async (ctx) => {
      await this.handleHelpCommand(ctx);
    });

    // 处理 /getme 命令（允许所有人查看）
    this.bot.command('getme', async (ctx) => {
      await this.handleGetMeCommand(ctx);
    });

    // 处理 /unbind 命令
    this.bot.command('unbind', async (ctx) => {
      if (!this.checkUserPermission(ctx)) {
        await ctx.reply('❌ 您没有权限使用此功能。请在网页端将您的用户 ID 加入管理员列表（私聊 /getme 可查看 ID）。');
        return;
      }
      await this.handleUnbindCommand(ctx);
    });

    // 处理其他消息
    this.bot.on('message:text', async (ctx) => {
      if (!ctx.message.text.startsWith('/')) {
        if (!this.checkUserPermission(ctx)) {
          await ctx.reply('❌ 您没有权限使用此功能。请在网页端将您的用户 ID 加入管理员列表（私聊 /getme 可查看 ID）。\n\n发送 /help 查看可用命令。');
          return;
        }
        await ctx.reply('请使用命令与我交互。发送 /help 查看可用命令。');
      }
    });
  }

  /**
   * 获取 webhook 回调（适配 Bun 环境）
   */
  getWebhookCallback() {
    return async (request: Request) => {
      try {
        // 确保 Bot 已初始化
        if (!this.initialized) {
          const initResult = await this.initialize();
          if (!initResult) {
            logger.error('Bot 初始化失败，无法处理 webhook');
            return new Response('Bot initialization failed', { status: 500 });
          }
        }

        const body = await request.json() as any;
        await this.bot.handleUpdate(body);
        return new Response('OK');
      } catch (error) {
        logger.error('处理 Telegram webhook 失败:', error);
        return new Response('Error', { status: 500 });
      }
    };
  }

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
   * 设置 Webhook
   */
  async setWebhook(webhookUrl: string): Promise<{
    success: boolean;
    error?: string;
    errorCode?: number;
    suggestions?: string[];
  }> {
    try {
      logger.telegram('正在设置 Webhook: ' + webhookUrl);
      await this.bot.api.setWebhook(webhookUrl);
      logger.telegram('Webhook 设置成功: ' + webhookUrl);
      return { success: true };
    } catch (error: any) {
      logger.error('设置 Webhook 失败:', error);
      logger.error('Webhook URL:', webhookUrl);

      // 解析 Grammy 错误
      let errorMessage = 'Webhook 设置失败';
      let errorCode = 0;
      let suggestions: string[] = [];

      if (error && error.error_code && error.description) {
        errorCode = error.error_code;
        errorMessage = error.description;

        // 根据不同错误类型提供建议
        if (error.description.includes('Failed to resolve host')) {
          suggestions = [
            '域名无法解析，请检查：',
            '1. 域名DNS记录是否正确配置',
            '2. 域名是否已完成DNS传播（可能需要等待几分钟到几小时）',
            '3. 尝试使用 dig 或 nslookup 命令验证DNS解析',
            '4. 确认域名拼写正确且可以从外网访问'
          ];
        } else if (error.description.includes('SSL')) {
          suggestions = [
            'SSL证书问题，请检查：',
            '1. 确保使用HTTPS协议',
            '2. SSL证书是否有效且未过期',
            '3. 证书链是否完整',
            '4. 证书是否被信任的CA签发'
          ];
        } else if (error.description.includes('Connection')) {
          suggestions = [
            '网络连接问题，请检查：',
            '1. 服务器防火墙设置',
            '2. 端口是否正确开放（通常是443）',
            '3. CDN或代理服务配置',
            '4. 网络连通性'
          ];
        } else if (error.description.includes('timeout')) {
          suggestions = [
            '连接超时，请检查：',
            '1. 服务器响应时间',
            '2. 网络延迟问题',
            '3. 服务器负载状况',
            '4. CDN配置是否正确'
          ];
        } else {
          suggestions = [
            '请检查以下项目：',
            '1. URL格式是否正确（必须是HTTPS）',
            '2. 域名是否可以从外网访问',
            '3. 端口和路径配置是否正确',
            '4. 服务器是否正常运行'
          ];
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      return {
        success: false,
        error: errorMessage,
        errorCode,
        suggestions
      };
    }
  }

  /**
   * 获取 Bot 信息
   */
  async getBotInfo() {
    try {
      const botInfo = await this.bot.api.getMe();
      // 同时进行初始化，设置 botInfo 到实例中
      if (botInfo && !this.initialized) {
        this.bot.botInfo = botInfo;
        this.initialized = true;
        logger.telegram(`Bot 初始化成功: ${botInfo.username} (${botInfo.id})`);
      }
      return botInfo;
    } catch (error) {
      logger.error('获取 Bot 信息失败:', error);
      return null;
    }
  }

  /**
   * 设置 Bot 命令菜单
   */
  async setBotCommands(): Promise<boolean> {
    try {
      const commands = [
        { command: 'start', description: '查看管理权限和使用说明' },
        { command: 'help', description: '查看帮助信息' },
        { command: 'getme', description: '查看自己的用户 ID 和管理权限' },
        { command: 'list', description: '查看订阅列表' },
        { command: 'add', description: '添加订阅 (用法: /add 关键词1 关键词2)' },
        { command: 'del', description: '删除订阅 (用法: /del 订阅ID)' },
        { command: 'post', description: '查看最近文章' },
        { command: 'stop', description: '停止推送' },
        { command: 'resume', description: '恢复推送' },
        { command: 'unbind', description: '移除自己的管理权限' }
      ];

      await this.bot.api.setMyCommands(commands);
      logger.telegram('Bot 命令菜单设置成功');
      return true;
    } catch (error) {
      logger.error('设置 Bot 命令菜单失败:', error);
      return false;
    }
  }

  /**
   * 处理 /start 命令
   */
  private async handleStartCommand(ctx: Context): Promise<void> {
    if (!this.dbService.getBaseConfig()) {
      await ctx.reply('系统尚未初始化，请先在网页端完成初始化设置。');
      return;
    }
    const userId = ctx.from?.id;
    if (!this.checkUserPermission(ctx)) {
      await ctx.reply(`您的 Telegram 用户 ID：${userId}\n尚无管理权限，请在网页端的「管理员用户 ID」中添加此 ID。\n/start 不会自动授权或修改通知目标。`);
      return;
    }
    await ctx.reply('✅ 您是管理员，可以在此私聊中使用 /list、/add、/del、/post、/stop、/resume。\n帖子通知发送到网页端配置的通知目标。发送 /help 查看帮助。');
  }

  /**
   * 处理 /stop 命令
   */
  private async handleStopCommand(ctx: Context): Promise<void> {
    this.dbService.updateBaseConfig({ stop_push: 1 });
    await ctx.reply('✅ 已停止推送。发送 /resume 可恢复推送。');
  }

  /**
   * 处理 /resume 命令
   */
  private async handleResumeCommand(ctx: Context): Promise<void> {
    this.dbService.updateBaseConfig({ stop_push: 0 });
    await ctx.reply('✅ 已恢复推送。');
  }

  /**
   * 处理 /list 命令
   */
  private async handleListCommand(ctx: Context): Promise<void> {
    const subscriptions = this.dbService.getAllKeywordSubs();

    if (subscriptions.length === 0) {
      await ctx.reply('📝 暂无订阅记录。使用 /add 添加订阅。');
      return;
    }

    let text = '📋 当前订阅列表\n\n';
    subscriptions.forEach((sub, index) => {
      const keywords = [sub.keyword1, sub.keyword2, sub.keyword3]
        .filter(k => k && k.trim().length > 0);

      text += `${index + 1}. ID:${sub.id}\n`;

      if (keywords.length > 0) {
        text += `🔍 ${keywords.join(' + ')}\n`;
      }

      if (sub.creator) {
        text += `👤 ${sub.creator}\n`;
      }

      if (sub.category) {
        text += `${this.getCategoryIcon(sub.category)} ${this.getCategoryName(sub.category)}\n`;
      }

    });

    text += '💡 使用 /del 订阅ID 删除订阅';

    await ctx.reply(text, { parse_mode: 'Markdown' });
  }

  /**
   * 处理 /add 命令
   */
  private async handleAddCommand(ctx: Context): Promise<void> {
    const args = ctx.message?.text?.split(' ').slice(1) || [];

    if (args.length === 0) {
      await ctx.reply('❌ 请提供关键词。\n**用法：** /add 关键词1 关键词2 关键词3', { parse_mode: 'Markdown' });
      return;
    }

    const keywords = args.slice(0, 3); // 最多3个关键词

    try {
      const sub = this.dbService.createKeywordSub({
        keyword1: keywords[0],
        keyword2: keywords[1] || undefined,
        keyword3: keywords[2] || undefined
      });

      let text = `✅ **订阅添加成功！**\n\n**ID:** ${sub.id}\n**关键词：** ${sub.keyword1}`;
      if (sub.keyword2) text += ` \\+ ${sub.keyword2}`;
      if (sub.keyword3) text += ` \\+ ${sub.keyword3}`;

      await ctx.reply(text, { parse_mode: 'Markdown' });
    } catch (error) {
      await ctx.reply(`❌ 添加订阅失败：${error}`);
    }
  }

  /**
   * 处理 /del 命令
   */
  private async handleDeleteCommand(ctx: Context): Promise<void> {
    const args = ctx.message?.text?.split(' ').slice(1) || [];

    if (args.length === 0) {
      await ctx.reply('❌ 请提供订阅 ID。\n**用法：** /del 订阅ID', { parse_mode: 'Markdown' });
      return;
    }

    const id = parseInt(args[0]);
    if (isNaN(id)) {
      await ctx.reply('❌ 订阅 ID 必须是数字。');
      return;
    }

    try {
      const success = this.dbService.deleteKeywordSub(id);
      if (success) {
        await ctx.reply(`✅ 订阅 ${id} 删除成功。`);
      } else {
        await ctx.reply(`❌ 订阅 ${id} 不存在。`);
      }
    } catch (error) {
      await ctx.reply(`❌ 删除订阅失败：${error}`);
    }
  }

  /**
   * 处理 /post 命令
   */
  private async handlePostCommand(ctx: Context): Promise<void> {
    const posts = this.dbService.getRecentPosts(10);

    if (posts.length === 0) {
      await ctx.reply('📝 暂无文章数据。');
      return;
    }

    let text = '📰 最近10条文章\n\n';
    posts.forEach((post, index) => {
      text += `${index + 1}. [${post.title}](https://www.nodeseek.com/post-${post.post_id}-1)\n`;
    });

    await ctx.reply(text, { parse_mode: 'Markdown' });
  }

  /**
   * 处理 /help 命令
   */
  private async handleHelpCommand(ctx: Context): Promise<void> {
    await ctx.reply(`🤖 NodeSeek RSS 监控机器人

/start - 查看管理权限和使用说明
/getme - 查看自己的用户 ID 和管理权限
/list - 列出所有订阅
/add 关键词1 关键词2 关键词3 - 添加订阅（最多3个关键词）
/del 订阅ID - 删除订阅
/post - 查看最近10条文章
/stop - 停止所有帖子推送
/resume - 恢复帖子推送
/unbind - 仅移除自己的管理权限
/help - 显示帮助

管理员由网页端「管理员用户 ID」指定，只能在私聊中管理。
所有管理员共同管理同一套订阅和推送设置。
帖子通知发送到「通知目标 Chat ID」，命令回复留在私聊。
多个关键词需要同时匹配；支持 /javascript/i 等正则表达式。`);
  }

  /**
   * 处理 /getme 命令
   */
  private async handleGetMeCommand(ctx: Context): Promise<void> {
    const config = this.dbService.getBaseConfig();
    const isAdmin = this.checkUserPermission(ctx);
    const status = isAdmin
      ? `✅ 您有管理权限\n通知目标：${config?.chat_id || '未配置'}`
      : '❌ 您没有管理权限，请在网页端的「管理员用户 ID」中添加下面的用户 ID。';
    await ctx.reply(`您的 Telegram 用户 ID：${ctx.from?.id}\n${status}`);
  }

  /**
   * 处理 /unbind 命令
   */
  private async handleUnbindCommand(ctx: Context): Promise<void> {
    const config = this.dbService.getBaseConfig();
    if (!isTelegramAdmin(config, ctx)) return;

    const remainingIds = getAdminUserIds(config?.admin_user_ids)
      .filter(id => id !== String(ctx.from?.id));
    this.dbService.updateBaseConfig({ admin_user_ids: remainingIds.join(',') });
    await ctx.reply('✅ 已移除您的管理权限。其他管理员和通知目标保持原设置。\n如需恢复权限，请在网页端重新添加您的用户 ID。');
  }

  /**
   * 推送文章到 Telegram
   */
  async pushPost(post: Post, matchedSub: KeywordSub): Promise<boolean> {
    try {
      const config = this.dbService.getBaseConfig();
      if (!config || config.stop_push === 1) {
        return false;
      }

      // 构建关键词字符串，用markdown格式的标签包裹
      const keywords = [matchedSub.keyword1, matchedSub.keyword2, matchedSub.keyword3]
        .filter(k => k && k.trim().length > 0)
        .join(' ');

      const keywordsStr = keywords ? `🎯 ${keywords}` : '';

      const creator = matchedSub.creator ? `👤 ${matchedSub.creator}` : '';
      const category = matchedSub.category ? `🗂️ ${this.getCategoryName(matchedSub.category)}` : '';

      // 构建帖子链接
      const postUrl = `https://www.nodeseek.com/post-${post.post_id}-1`;

      // 去除 post.title 会影响markdown链接的符号
      const title = post.title
        .replace(/\[/g, "「")
        .replace(/\]/g, "」")
        .replace(/\(/g, "（")
        .replace(/\)/g, "）");

      const text = `
**${keywordsStr} ${creator} ${category}**

**[${title}](${postUrl})**
      `;

      const success = await this.sendMessage(config.chat_id, text);

      if (success) {
        // 更新推送状态
        this.dbService.updatePostPushStatus(
          post.post_id,
          1, // 已推送
          matchedSub.id,
          new Date().toISOString()
        );
        return true;
      }

      return false;
    } catch (error) {
      logger.error('推送文章失败:', error);
      return false;
    }
  }
}
