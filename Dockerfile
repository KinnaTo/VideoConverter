# 构建阶段
FROM oven/bun:1.0.35 AS builder

WORKDIR /app

# 复制项目文件
COPY package.json bun.lock ./
COPY . .

# 安装依赖并构建
RUN bun install --frozen-lockfile
RUN bun run build

# 生产阶段
FROM nvidia/cuda:12.3.1-runtime-ubuntu22.04 AS production

# 安装必要的系统依赖
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 安装 Bun
RUN curl -fsSL https://bun.sh/install | bash

# 设置工作目录
WORKDIR /app

# 从构建阶段复制必要文件
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/bun.lock ./
COPY --from=builder /app/node_modules ./node_modules
COPY .env.example .env

# 暴露应用端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# 设置环境变量
ENV NODE_ENV=production

# 运行应用
CMD ["bun", "run", "start"]

# NVIDIA运行时环境标签
LABEL com.nvidia.volumes.needed="nvidia_driver"
ENV NVIDIA_VISIBLE_DEVICES=all
ENV NVIDIA_DRIVER_CAPABILITIES=compute,utility,video 