// biome-ignore-all lint/suspicious/noExplicitAny: reason
import 'reflect-metadata';
import { getControllerMetadata } from './controller';
import { ROUTE_METADATA } from './http';
import { TYPE_METADATA } from './types';

const OPENAPI_TAGS_KEY = 'openapi:tags';
const OPENAPI_OPERATION_KEY = 'openapi:operation';
const OPENAPI_PROPERTY_KEY = 'openapi:property';
const OPENAPI_RESPONSE_KEY = 'openapi:response';

interface ApiResponse {
    description: string;
    type?: any;
    example?: any;
}

/**
 * OpenAPI 属性装饰器选项
 */
export interface ApiPropertyOptions {
    type?: any;
    description?: string;
    required?: boolean;
    example?: any;
    format?: string;
    enum?: any[];
    default?: any;
    minimum?: number;
    maximum?: number;
    pattern?: string;
    nullable?: boolean;
}

/**
 * OpenAPI 操作装饰器选项
 */
export interface ApiOperationOptions {
    summary?: string;
    description?: string;
    deprecated?: boolean;
    tags?: string[];
    responses?: {
        [key: number]: ApiResponse;
    };
}

/**
 * OpenAPI 参数装饰器选项
 */
export interface ApiParameterOptions {
    name: string;
    in: 'path' | 'query' | 'header' | 'cookie';
    description?: string;
    required?: boolean;
    schema?: any;
}

/**
 * OpenAPI 请求体装饰器选项
 */
export interface ApiRequestBodyOptions {
    description?: string;
    required?: boolean;
    content: Record<string, { schema: any }>;
}

/**
 * OpenAPI 响应装饰器选项
 */
export interface ApiResponseOptions {
    description: string;
    content?: Record<string, { schema: any }>;
}

/**
 * 属性装饰器
 * 用于描述实体和DTO的属性
 */
export function ApiProperty(options: ApiPropertyOptions = {}) {
    return (target: any, propertyKey: string) => {
        const properties = Reflect.getMetadata(OPENAPI_PROPERTY_KEY, target.constructor) || {};
        properties[propertyKey] = options;
        Reflect.defineMetadata(OPENAPI_PROPERTY_KEY, properties, target.constructor);
    };
}

/**
 * 生成示例值
 */
function generateExample(type: any): any {
    if (!type) return null;

    // 如果是数组类型
    if (Array.isArray(type)) {
        return [generateExample(type[0])];
    }

    // 如果是基本类型
    if (typeof type === 'string') {
        switch (type.toLowerCase()) {
            case 'string':
                return 'example string';
            case 'number':
                return 0;
            case 'boolean':
                return true;
            case 'date':
                return new Date().toISOString();
            default:
                return null;
        }
    }

    // 如果是类
    if (type.name) {
        switch (type.name) {
            case 'String':
                return 'example string';
            case 'Number':
                return 0;
            case 'Boolean':
                return true;
            case 'Date':
                return new Date().toISOString();
            default: {
                // 为自定义类型生成示例
                const example: any = {};
                let currentTarget = type.prototype;
                while (currentTarget && currentTarget !== Object.prototype) {
                    for (const propertyKey of Object.getOwnPropertyNames(currentTarget)) {
                        if (propertyKey === 'constructor' || typeof currentTarget[propertyKey] === 'function') {
                            continue;
                        }
                        const typeMetadata = Reflect.getMetadata(TYPE_METADATA, currentTarget, propertyKey);
                        if (typeMetadata) {
                            switch (typeMetadata.type) {
                                case 'string':
                                    example[propertyKey] = typeMetadata.format === 'email' ? 'user@example.com' : `example ${propertyKey}`;
                                    break;
                                case 'number':
                                    example[propertyKey] = 1;
                                    break;
                                case 'boolean':
                                    example[propertyKey] = true;
                                    break;
                                case 'date-time':
                                    example[propertyKey] = new Date().toISOString();
                                    break;
                                default:
                                    example[propertyKey] = null;
                            }
                        }
                    }
                    currentTarget = Object.getPrototypeOf(currentTarget);
                }
                return example;
            }
        }
    }

    return null;
}

/**
 * 获取实际的返回类型
 */
function getActualType(type: any): any {
    if (!type) return null;

    // 如果是数组类型
    if (Array.isArray(type)) {
        return {
            type: 'array',
            items: { $ref: `#/components/schemas/${type[0].name}` },
        };
    }

    // 如果是基本类型
    if (typeof type === 'string') {
        return { type: type.toLowerCase() };
    }
    if (type.name && ['String', 'Number', 'Boolean', 'Date'].includes(type.name)) {
        return { type: type.name.toLowerCase() };
    }

    // 如果是自定义类型
    return type.name ? { $ref: `#/components/schemas/${type.name}` } : null;
}

/**
 * 收集实体类的模型信息
 */
function collectModelSchema(target: any): any {
    const properties: Record<string, any> = {};
    const required: string[] = [];

    // 获取原型链上的所有属性
    let currentTarget = target.prototype;
    while (currentTarget && currentTarget !== Object.prototype) {
        for (const propertyKey of Object.getOwnPropertyNames(currentTarget)) {
            // 跳过构造函数和方法
            if (propertyKey === 'constructor' || typeof currentTarget[propertyKey] === 'function') {
                continue;
            }

            const typeMetadata = Reflect.getMetadata(TYPE_METADATA, currentTarget, propertyKey);
            if (typeMetadata) {
                properties[propertyKey] = {
                    type: typeMetadata.type === 'date-time' ? 'string' : typeMetadata.type,
                    format: typeMetadata.format,
                    minimum: typeMetadata.min,
                    maximum: typeMetadata.max,
                    minLength: typeMetadata.minLength,
                    maxLength: typeMetadata.maxLength,
                    pattern: typeMetadata.pattern?.source,
                    nullable: typeMetadata.nullable,
                    example: generateExample({ name: typeMetadata.type }),
                };

                if (typeMetadata.required) {
                    required.push(propertyKey);
                }
            }
        }
        currentTarget = Object.getPrototypeOf(currentTarget);
    }

    return {
        type: 'object',
        properties,
        required: required.length > 0 ? required : undefined,
    };
}

/**
 * 类装饰器
 * 用于API分组
 */
export function ApiTags(...tags: string[]) {
    return (target: any) => {
        Reflect.defineMetadata(OPENAPI_TAGS_KEY, tags, target);
    };
}

/**
 * 方法装饰器
 * 用于描述API操作
 */
export function ApiOperation(options: ApiOperationOptions) {
    return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
        Reflect.defineMetadata(OPENAPI_OPERATION_KEY, options, target.constructor, propertyKey);
    };
}

/**
 * 方法装饰器
 * 用于描述API响应
 */
export function ApiResponse(statusCode: number, options: ApiResponseOptions) {
    return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
        const responses = Reflect.getMetadata(OPENAPI_RESPONSE_KEY, target.constructor, propertyKey) || {};
        responses[statusCode] = options;
        Reflect.defineMetadata(OPENAPI_RESPONSE_KEY, responses, target.constructor, propertyKey);
    };
}

/**
 * 规范化路径，确保：
 * 1. 以/开头
 * 2. 不以/结尾（除非是根路径）
 * 3. 不会有重复的/
 */
function normalizePath(inputPath: string): string {
    // 确保以/开头
    const withLeadingSlash = inputPath.startsWith('/') ? inputPath : `/${inputPath}`;

    // 移除结尾的/（除非是根路径）
    const withoutTrailingSlash = withLeadingSlash.length > 1 && withLeadingSlash.endsWith('/') ? withLeadingSlash.slice(0, -1) : withLeadingSlash;

    // 替换多个连续的/为单个/
    return withoutTrailingSlash.replace(/\/+/g, '/');
}

/**
 * 生成OpenAPI文档
 */
export function generateOpenApiDocument(controllers: any[]): any {
    const paths: Record<string, any> = {};
    const schemas: Record<string, any> = {};

    // 首先收集所有模型
    const models = new Set<any>();
    for (const controller of controllers) {
        // 收集控制器中使用的所有模型
        const routes = Reflect.getMetadata(ROUTE_METADATA, controller) || [];
        for (const route of routes) {
            const operation = Reflect.getMetadata(OPENAPI_OPERATION_KEY, controller, route.handlerName) || {};
            if (operation.responses) {
                for (const response of Object.values(operation.responses)) {
                    const apiResponse = response as ApiResponse;
                    if (apiResponse.type) {
                        if (Array.isArray(apiResponse.type)) {
                            models.add(apiResponse.type[0]);
                        } else {
                            models.add(apiResponse.type);
                        }
                    }
                }
            }
        }
    }

    // 生成模型的 schema
    for (const model of models) {
        if (model?.name && !['String', 'Number', 'Boolean', 'Date'].includes(model.name)) {
            const schema = collectModelSchema(model);
            schemas[model.name] = {
                ...schema,
                example: generateExample(model),
            };
        }
    }

    // 处理路由
    for (const controller of controllers) {
        const tags = Reflect.getMetadata(OPENAPI_TAGS_KEY, controller) || [];
        const routes = Reflect.getMetadata(ROUTE_METADATA, controller) || [];
        // 获取控制器基础路径
        const prefix = getControllerMetadata(controller.prototype.constructor);

        for (const route of routes) {
            const operation = Reflect.getMetadata(OPENAPI_OPERATION_KEY, controller, route.handlerName) || {};

            // 处理路径参数
            const pathParams = (route.path.match(/:[a-zA-Z][a-zA-Z0-9]*/g) || []).map((param: string) => ({
                name: param.slice(1),
                in: 'path',
                required: true,
                schema: { type: 'string' },
                example: '1',
            }));

            // 构建响应模型
            const responses: Record<string, any> = {};
            if (operation.responses) {
                for (const [status, response] of Object.entries(operation.responses)) {
                    const apiResponse = response as ApiResponse;
                    const schema = getActualType(apiResponse.type);
                    responses[status] = {
                        description: apiResponse.description,
                        content: schema
                            ? {
                                  'application/json': {
                                      schema,
                                      example: apiResponse.example || generateExample(apiResponse.type),
                                  },
                              }
                            : undefined,
                    };
                }
            }

            // 构建路径对象，合并控制器前缀和路由路径
            const fullPath = normalizePath(`${prefix}${route.path}`);
            const normalizedPath = fullPath.replace(/:[a-zA-Z][a-zA-Z0-9]*/g, (param: string) => `{${param.slice(1)}}`);
            paths[normalizedPath] = paths[normalizedPath] || {};
            paths[normalizedPath][route.method.toLowerCase()] = {
                tags,
                ...operation,
                parameters: pathParams,
                responses,
            };
        }
    }

    return {
        openapi: '3.0.0',
        info: {
            title: 'API Documentation',
            version: '1.0.0',
        },
        paths,
        components: {
            schemas,
        },
    };
}
