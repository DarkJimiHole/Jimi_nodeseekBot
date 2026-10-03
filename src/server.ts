#!/usr/bin/env bun
import { app, initializeApp, startServer } from './index';
import { DatabaseService } from './services/database';
import { SchedulerService } from './services/scheduler';
import { logger } from './utils/logger';
import { restoreTelegramPolling } from './routes/telegramWebhook';
import { initializeTemporaryAccess, getTemporaryAccess } from './services/temporary-access';

export let schedulerService: SchedulerService | null = null;

// 启动服务器
async function main() {
    try {
        // 初始化应用和数据库
        const config = await startServer();
        initializeTemporaryAccess(request => app.fetch(request));

        // 创建定时任务服务
        const dbService = DatabaseService.create();
        schedulerService = new SchedulerService(dbService);

        // 启动定时任务
        schedulerService.start();

        // 启动 Bun 服务器
        const server = Bun.serve({
            port: config!.PORT,
            hostname: config!.HOST,
            fetch: request => {
                // A CF route accidentally targeting 3010 must not bypass the temporary gateway.
                if (request.headers.has('cf-ray') || request.headers.has('cf-connecting-ip')) {
                    return new Response('CF 临时隧道的服务地址必须指向 http://127.0.0.1:3011', { status: 403 });
                }
                return app.fetch(request);
            },
        });

        logger.server(`服务器运行在: http://${server.hostname}:${server.port}`);

        // Telegram 暂时不可达时，网页仍需可用以便调整配置。
        void restoreTelegramPolling(dbService).catch(error => {
            logger.error('恢复 Telegram Polling 失败:', error);
        });

        // 优雅关闭处理
        process.on('SIGINT', gracefulShutdown);
        process.on('SIGTERM', gracefulShutdown);

    } catch (error) {
        logger.error('启动失败:', error);
        process.exit(1);
    }
}

// 优雅关闭
function gracefulShutdown() {
    getTemporaryAccess().closeAll();
    logger.warn('收到关闭信号，正在优雅关闭...');

    if (schedulerService) {
        schedulerService.stop();
    }

    logger.success('服务器已关闭');
    process.exit(0);
}

// 运行主函数
main();
