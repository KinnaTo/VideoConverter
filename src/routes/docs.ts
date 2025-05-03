import { Hono } from 'hono';
import * as yaml from 'js-yaml';
import { controllerRegistry } from '../core/controller-registry';
import { generateOpenApiDocument } from '../decorators/openapi';

const docs = new Hono();

// 使用controllerRegistry获取所有已注册的控制器
const controllers = controllerRegistry.getControllers();

// 生成 OpenAPI 文档
const openApiDoc = generateOpenApiDocument(controllers);

// 提供 Swagger UI
docs.get('/', (c) => {
    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>API Documentation</title>
        <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
    </head>
    <body>
        <div id="swagger-ui"></div>
        <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script>
        <script>
            window.onload = () => {
                window.ui = SwaggerUIBundle({
                    url: '/docs/openapi.json',
                    dom_id: '#swagger-ui',
                });
            };
        </script>
    </body>
    </html>
    `;
    return c.html(html);
});

// 提供 OpenAPI JSON
docs.get('/openapi.json', (c) => {
    return c.json(openApiDoc);
});

// 提供 OpenAPI YAML
docs.get('/openapi.yaml', (c) => {
    const yamlDoc = yaml.dump(openApiDoc);
    return new Response(yamlDoc, {
        headers: {
            'Content-Type': 'text/yaml',
        },
    });
});

export { docs };
