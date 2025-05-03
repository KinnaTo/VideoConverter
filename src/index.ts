import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { prettyJSON } from 'hono/pretty-json';
import { accessLogger, performanceLogger } from './core/middleware';
import { registerRoutes } from './core/router';
import { docs } from './routes/docs';
import logger from './utils/logger';

if (!Reflect || !Reflect.getMetadata) {
    throw new Error('reflect-metadata is not properly initialized');
}

const app = new Hono();

// 中间件
app.use('*', accessLogger);
app.use('*', performanceLogger());
app.use('*', prettyJSON());

// 托管前端静态文件
app.use('/main.js', serveStatic({ root: './frontend' }));
// 其他静态资源可按需添加

// 非 /api 路径的 HTML 路由返回 index.html
app.use((c, next) => {
    if (!c.req.path.startsWith('/api') && !c.req.path.startsWith('/docs') && !c.req.path.match(/\.[a-zA-Z0-9]+$/)) {
        return serveStatic({ path: './frontend/index.html' })(c, next);
    }
    return next();
});

// 先加载所有controllers
const controllerList = fs.readdirSync(path.join(__dirname, 'controllers'));
for (const controller of controllerList) {
    await import(`./controllers/${controller}`);
    logger.info(`Controller ${controller} loaded`);
}

// 注册路由（包括controllers的路由）
registerRoutes(app);

// 注册文档路由（确保在所有controllers加载完成后）
app.route('/docs', docs);

// 启动服务器
const port = process.env.PORT || 3000;
logger.info(`Server is running on port ${port}`);

await import('./utils/init');

export default app;
