import { DatabaseService } from './database';
import { RSSService } from './rss';
import { TelegramPushService } from './telegram/push';
import { MatcherService } from './matcher';
import { getEnvConfig } from '../config/env';
import { logger } from '../utils/logger';

export class SchedulerService {
    private rssIntervalId?: NodeJS.Timeout;
    private dbService: DatabaseService;
    private isRunning: boolean = false;
    // 上一轮任务尚未结束时跳过本轮，避免并发抓取和写库
    private isExecuting: boolean = false;

    constructor(dbService: DatabaseService) {
        this.dbService = dbService;
    }

    /**
     * 获取 RSS 间隔秒数（从数据库）
     */
    private getRSSIntervalSeconds(): number {
        const config = this.dbService.getBaseConfig();
        const seconds = config?.rss_interval_seconds || 60;
        return Math.max(10, seconds);
    }

    /**
     * 启动所有定时任务
     */
    start(): void {
        const envConfig = getEnvConfig();

        logger.scheduler('启动定时任务服务');

        if (envConfig.RSS_CHECK_ENABLED) {
            this.startRSSTask();
        }

        logger.success('定时任务服务启动完成');
    }

    /**
     * 停止所有定时任务
     */
    stop(): void {
        logger.scheduler('停止定时任务服务');

        if (this.rssIntervalId) {
            clearInterval(this.rssIntervalId);
            this.rssIntervalId = undefined;
        }
        this.isRunning = false;

        logger.success('定时任务服务已停止');
    }

    /**
     * 启动 RSS 抓取和推送任务
     */
    private startRSSTask(): void {
        const intervalSeconds = this.getRSSIntervalSeconds();
        logger.rss(`启动 RSS 任务，间隔: ${intervalSeconds} 秒`);

        this.isRunning = true;
        this.executeRSSTask();

        this.rssIntervalId = setInterval(async () => {
            if (!this.isRunning) return;
            await this.executeRSSTask();
        }, intervalSeconds * 1000);
    }

    /**
     * 执行 RSS 抓取和推送任务，返回 false 表示上一轮仍在执行、本轮已跳过
     */
    private async executeRSSTask(): Promise<boolean> {
        if (this.isExecuting) {
            logger.task.warn('上一轮 RSS 任务仍在执行，跳过本轮');
            return false;
        }
        this.isExecuting = true;
        try {
            await this.runRSSTask();
            return true;
        } finally {
            this.isExecuting = false;
        }
    }

    private async runRSSTask(): Promise<void> {
        const startTime = Date.now();
        logger.task.start('RSS 任务');

        try {
            const config = this.dbService.getBaseConfig();
            if (!config) {
                logger.task.warn('系统未配置，跳过 RSS 任务');
                return;
            }

            const rssService = new RSSService(this.dbService);

            // 1. 抓取 RSS
            const rssResult = await rssService.processNewRSSData();
            if (rssResult.new > 0) {
                logger.task.info(`新增文章: ${rssResult.new} 篇`);
            }

            // 2. 匹配和推送（每轮都执行，以便重试近期推送失败的文章）
            let telegramService: TelegramPushService | null = null;
            if (config.bot_token) {
                try {
                    telegramService = new TelegramPushService(this.dbService, config.bot_token);
                } catch (e) {
                    logger.warn('Telegram 服务初始化失败，仅执行匹配');
                }
            }
            const matcherService = new MatcherService(this.dbService, telegramService);

            const pushResult = await matcherService.processUnpushedPosts();
            if (pushResult.pushed + pushResult.skipped + pushResult.failed > 0) {
                logger.task.info(`匹配: ${pushResult.pushed} | 未匹配: ${pushResult.skipped} | 失败: ${pushResult.failed}`);
            }

            const duration = Date.now() - startTime;
            logger.task.end('RSS 任务', duration);

        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.warn(`RSS 任务失败 (${duration}ms): ${errorMessage}`);
        }
    }

    /**
     * 手动执行 RSS 任务
     */
    async manualRSSTask(): Promise<{ success: boolean; message: string; data?: any }> {
        try {
            logger.scheduler('手动执行 RSS 任务');
            const executed = await this.executeRSSTask();
            if (!executed) {
                return { success: false, message: 'RSS 任务正在执行中，请稍后再试' };
            }
            return { success: true, message: 'RSS 任务执行成功' };
        } catch (error) {
            return { success: false, message: `RSS 任务执行失败: ${error}` };
        }
    }

    /**
     * 获取任务状态
     */
    getStatus(): {
        rssTask: {
            running: boolean;
            intervalSeconds: number;
        };
    } {
        return {
            rssTask: {
                running: this.isRunning,
                intervalSeconds: this.getRSSIntervalSeconds()
            }
        };
    }

    /**
     * 重启 RSS 任务
     */
    restartRSSTask(): void {
        logger.scheduler('重启 RSS 任务');

        if (this.rssIntervalId) {
            clearInterval(this.rssIntervalId);
            this.rssIntervalId = undefined;
        }
        this.isRunning = false;

        const envConfig = getEnvConfig();
        if (envConfig.RSS_CHECK_ENABLED) {
            this.startRSSTask();
        }
    }

    /**
     * 更新 RSS 间隔并重启任务
     */
    async updateIntervalAndRestart(newIntervalSeconds: number): Promise<{ success: boolean; message: string }> {
        try {
            const validInterval = Math.max(10, newIntervalSeconds);
            this.dbService.updateBaseConfig({ rss_interval_seconds: validInterval });
            this.restartRSSTask();

            return { success: true, message: `RSS 间隔已更新为 ${validInterval} 秒` };
        } catch (error) {
            return { success: false, message: `更新间隔失败: ${error}` };
        }
    }
}
