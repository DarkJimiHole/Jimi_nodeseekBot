import { DatabaseService } from './database';
import { TelegramPushService, isRateLimitError } from './telegram/push';
import { logger } from '../utils/logger';
import { parseRegexKeyword } from '../utils/keyword-regex';
import type { Post, KeywordSub, BaseConfig, PushResult } from '../types';

// 推送失败（状态 1）的文章在入库后多长时间内自动重试
const RETRY_WINDOW_MINUTES = 120;
// 两次推送之间的间隔，避免触发 Telegram 群组限流（每分钟约 20 条）
const PUSH_INTERVAL_MS = 1000;

export interface MatchResult {
  matched: boolean;
  subscription?: KeywordSub;
  matchedKeywords: string[];
  matchType: 'title' | 'content' | 'author' | 'category' | 'mixed';
  matchDetails: {
    titleMatches: string[];
    contentMatches: string[];
    authorMatches: string[];
    categoryMatches: string[];
  };
}

export class MatcherService {
  constructor(
    private dbService: DatabaseService,
    private telegramService: TelegramPushService | null = null
  ) {}

  /**
   * 检查文章是否匹配任何订阅
   */
  checkPostMatches(post: Post): MatchResult[] {
    const subscriptions = this.dbService.getAllKeywordSubs();
    const config = this.dbService.getBaseConfig();

    if (!config) {
      return [];
    }

    return this.checkPostMatchesWithData(post, subscriptions, config);
  }

  /**
   * 检查文章是否匹配任何订阅 - 带缓存数据版本
   */
  private checkPostMatchesWithData(post: Post, subscriptions: KeywordSub[], config: BaseConfig): MatchResult[] {
    const results: MatchResult[] = [];

    // 预处理文章内容以提高匹配性能
    const preprocessedPost = {
      ...post,
      titleLower: post.title.toLowerCase(),
      memoLower: post.memo.toLowerCase(),
      creatorLower: post.creator.toLowerCase(),
      categoryLower: post.category.toLowerCase()
    };

    for (const sub of subscriptions) {
      const matchResult = this.matchPostWithSubscription(preprocessedPost, sub, config);
      if (matchResult.matched) {
        results.push(matchResult);
      }
    }

    return results;
  }

  /**
   * 执行匹配检查（字符串或正则）
   */
  private performMatch(text: string, keyword: string): boolean {
    const regexInfo = parseRegexKeyword(keyword);

    if (regexInfo.isRegex && regexInfo.pattern) {
      try {
        const flags = regexInfo.flags || 'i'; // 默认不区分大小写
        const regex = new RegExp(regexInfo.pattern, flags);
        return regex.test(text);
      } catch (error) {
        logger.warn(`正则表达式语法错误，回退到字符串匹配: ${keyword}`, error);
        // 回退到字符串匹配
        return text.toLowerCase().includes(keyword.toLowerCase());
      }
    } else {
      // 标准字符串匹配
      return text.toLowerCase().includes(keyword.toLowerCase());
    }
  }

  /**
   * 匹配单个文章与单个订阅
   */
  private matchPostWithSubscription(post: Post & {
    titleLower?: string;
    memoLower?: string;
    creatorLower?: string;
    categoryLower?: string;
  }, subscription: KeywordSub, config: BaseConfig): MatchResult {
    const keywords = [subscription.keyword1, subscription.keyword2, subscription.keyword3]
      .filter(k => k && k.trim().length > 0);

    if (keywords.length === 0 && !subscription.creator && !subscription.category) {
      return {
        matched: false,
        matchedKeywords: [],
        matchType: 'title',
        matchDetails: {
          titleMatches: [],
          contentMatches: [],
          authorMatches: [],
          categoryMatches: []
        }
      };
    }

    // 使用预处理的文本或实时转换
    const titleText = post.titleLower || post.title.toLowerCase();
    const contentText = post.memoLower || post.memo.toLowerCase();
    const creatorText = post.creatorLower || post.creator.toLowerCase();
    const categoryText = post.categoryLower || post.category.toLowerCase();

    // 检查作者精确匹配过滤（如果指定了creator，必须精确匹配，忽略大小写）
    if (subscription.creator && subscription.creator.trim().length > 0) {
      const targetCreator = subscription.creator.toLowerCase().trim();
      if (creatorText.trim() !== targetCreator) {
        return {
          matched: false,
          matchedKeywords: [],
          matchType: 'title',
          matchDetails: {
            titleMatches: [],
            contentMatches: [],
            authorMatches: [],
            categoryMatches: []
          }
        };
      }
    }

    // 检查分类精确匹配过滤（如果指定了category，必须精确匹配，忽略大小写）
    if (subscription.category && subscription.category.trim().length > 0) {
      const targetCategory = subscription.category.toLowerCase().trim();
      if (categoryText.trim() !== targetCategory) {
        return {
          matched: false,
          matchedKeywords: [],
          matchType: 'title',
          matchDetails: {
            titleMatches: [],
            contentMatches: [],
            authorMatches: [],
            categoryMatches: []
          }
        };
      }
    }

    // 关键词匹配（扩展到标题、内容、作者、分类）
    const matchDetails = {
      titleMatches: [] as string[],
      contentMatches: [] as string[],
      authorMatches: [] as string[],
      categoryMatches: [] as string[]
    };

    const matchedKeywords: string[] = [];
    let totalMatchedKeywords = 0;

    for (const keyword of keywords) {
      if (!keyword) continue;

      let keywordMatched = false;

      // 检查标题匹配
      if (this.performMatch(titleText, keyword)) {
        matchDetails.titleMatches.push(keyword);
        keywordMatched = true;
      }

      // 检查内容匹配（如果不是仅标题模式）
      if (!keywordMatched && !config.only_title && this.performMatch(contentText, keyword)) {
        matchDetails.contentMatches.push(keyword);
        keywordMatched = true;
      }

      // 检查作者匹配（如果没有指定具体的creator过滤条件）
      if (!keywordMatched && !subscription.creator && this.performMatch(creatorText, keyword)) {
        matchDetails.authorMatches.push(keyword);
        keywordMatched = true;
      }

      // 检查分类匹配（如果没有指定具体的category过滤条件）
      if (!keywordMatched && !subscription.category && this.performMatch(categoryText, keyword)) {
        matchDetails.categoryMatches.push(keyword);
        keywordMatched = true;
      }

      if (keywordMatched) {
        matchedKeywords.push(keyword);
        totalMatchedKeywords++;
      }
    }

    // 判断是否匹配（所有关键词都必须匹配）
    const matched = totalMatchedKeywords === keywords.length;

    if (!matched) {
      return {
        matched: false,
        matchedKeywords: [],
        matchType: 'title',
        matchDetails
      };
    }

    // 确定匹配类型
    let matchType: 'title' | 'content' | 'author' | 'category' | 'mixed';
    if (matchDetails.titleMatches.length === keywords.length) {
      matchType = 'title';
    } else if (matchDetails.contentMatches.length === keywords.length) {
      matchType = 'content';
    } else if (matchDetails.authorMatches.length === keywords.length) {
      matchType = 'author';
    } else if (matchDetails.categoryMatches.length === keywords.length) {
      matchType = 'category';
    } else {
      matchType = 'mixed';
    }

    return {
      matched: true,
      subscription,
      matchedKeywords,
      matchType,
      matchDetails
    };
  }

  /**
   * 处理待处理的文章：先匹配订阅，再尝试推送 Telegram
   *
   * push_status 语义：
   *   0 = 待处理（未比对过订阅）
   *   1 = 已匹配但未推送（命中订阅，推送失败或未配置推送）
   *   2 = 未匹配（没有命中任何订阅）
   *   3 = 已匹配且已推送成功
   */
  async processUnpushedPosts(): Promise<PushResult> {
    const config = this.dbService.getBaseConfig();
    const unpushedPosts = this.dbService.getUnpushedPosts();
    const subscriptions = this.dbService.getAllKeywordSubs();

    if (!config) {
      return { pushed: 0, failed: 0, skipped: 0 };
    }



    const result: PushResult = { pushed: 0, failed: 0, skipped: 0 };

    if (subscriptions.length === 0) {
      const batchUpdates = unpushedPosts.map(post => ({
        postId: post.post_id,
        pushStatus: 2
      }));

      if (batchUpdates.length > 0) {
        try {
          this.dbService.batchUpdatePostPushStatus(batchUpdates);
          result.skipped = batchUpdates.length;
        } catch (error) {
          logger.error('批量更新状态失败', error);
          result.failed = batchUpdates.length;
        }
      }
      return result;
    }

    const matchedUpdates: Array<{ postId: number; pushStatus: number; subId?: number }> = [];
    const unmatchedUpdates: Array<{ postId: number; pushStatus: number }> = [];

    // 第一步：比对所有帖子和订阅，确定匹配状态
    for (const post of unpushedPosts) {
      try {
        const matches = this.checkPostMatchesWithData(post, subscriptions, config);

        if (matches.length === 0) {
          unmatchedUpdates.push({ postId: post.post_id, pushStatus: 2 });
          result.skipped++;
        } else {
          const firstMatch = matches[0];
          matchedUpdates.push({
            postId: post.post_id,
            pushStatus: 1,
            subId: firstMatch.subscription?.id
          });
          result.pushed++;
        }
      } catch (error) {
        result.failed++;
        logger.error(`匹配失败: ${post.title}`, error);
      }
    }

    // 第二步：批量写入匹配状态
    const allUpdates = [...matchedUpdates, ...unmatchedUpdates];
    if (allUpdates.length > 0) {
      try {
        this.dbService.batchUpdatePostPushStatus(allUpdates);
      } catch (error) {
        logger.error('批量更新匹配状态失败', error);
      }
    }

    // 第三步：尝试推送 Telegram（本轮新匹配的文章 + 近期推送失败的文章）
    if (config.stop_push === 1) {
      logger.match('推送已停止');
    } else if (this.telegramService && config.bot_token && config.chat_id) {
      const subscriptionsById = new Map(subscriptions.map(sub => [sub.id, sub]));
      const postsToPush = this.dbService.getRetryablePosts(RETRY_WINDOW_MINUTES);
      let pushSuccess = 0;
      let pushFail = 0;

      for (const post of postsToPush) {
        const subscription = post.sub_id ? subscriptionsById.get(post.sub_id) : undefined;
        if (!subscription) continue;

        if (pushSuccess + pushFail > 0) {
          await new Promise(resolve => setTimeout(resolve, PUSH_INTERVAL_MS));
        }

        try {
          const success = await this.telegramService.pushPost(post, subscription);
          if (success) pushSuccess++;
          else pushFail++;
        } catch (error) {
          pushFail++;
          if (isRateLimitError(error)) {
            logger.warn(`Telegram 限流（retry_after=${error.parameters.retry_after ?? '?'}s），剩余文章下一轮再推送`);
            break;
          }
          logger.error(`推送失败: ${post.title}`, error);
        }
      }

      if (pushSuccess + pushFail > 0) {
        logger.telegram(`推送: ${pushSuccess} 成功, ${pushFail} 失败`);
      }
    }
    return result;
  }

  /**
   * 获取匹配统计信息
   */
  getMatchStats(): {
    totalPosts: number;
    pendingPosts: number;      // 待处理 (状态 0)
    matchedNotPushed: number;  // 已匹配但未推送 (状态 1)
    skippedPosts: number;      // 无需推送 (状态 2)
    pushedPosts: number;       // 已推送成功 (状态 3)
    totalSubscriptions: number;
  } {
    try {
      const totalPosts = this.dbService.getPostsCount();
      const pendingPosts = this.dbService.getPostsCountByStatus(0); // 待处理
      const matchedNotPushed = this.dbService.getPostsCountByStatus(1); // 已匹配但未推送
      const skippedPosts = this.dbService.getPostsCountByStatus(2); // 无需推送
      const pushedPosts = this.dbService.getPostsCountByStatus(3); // 已推送成功
      const totalSubscriptions = this.dbService.getSubscriptionsCount();

      return {
        totalPosts,
        pendingPosts,
        matchedNotPushed,
        skippedPosts,
        pushedPosts,
        totalSubscriptions
      };
    } catch (error) {
      logger.error('获取匹配统计失败:', error);
      return {
        totalPosts: 0,
        pendingPosts: 0,
        matchedNotPushed: 0,
        skippedPosts: 0,
        pushedPosts: 0,
        totalSubscriptions: 0
      };
    }
  }

  /**
   * 手动推送指定文章
   */
  async manualPushPost(postId: number, subscriptionId: number): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      if (!this.telegramService) {
        return { success: false, message: '未配置 Telegram 服务' };
      }

      const post = this.dbService.getPostByPostId(postId);
      const subscription = this.dbService.getKeywordSubById(subscriptionId);

      if (!post) {
        return { success: false, message: '文章不存在' };
      }

      if (!subscription) {
        return { success: false, message: '订阅不存在' };
      }

      const pushSuccess = await this.telegramService.pushPost(post, subscription);

      if (pushSuccess) {
        return {
          success: true,
          message: '推送成功'
        };
      } else {
        return {
          success: false,
          message: '推送失败'
        };
      }
    } catch (error) {
      return {
        success: false,
        message: `推送失败: ${error}`
      };
    }
  }
}