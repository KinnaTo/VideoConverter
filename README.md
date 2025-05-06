# Video Convert Queue

## 工具链

[![Bun](https://img.shields.io/badge/bun-black?style=for-the-badge&logo=bun&logoColor=white)](https://bun.sh/)
[![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Biome](https://img.shields.io/badge/biome-60A5FA?style=for-the-badge&logo=biome&logoColor=white)](https://biomejs.dev/)
[![Prisma](https://img.shields.io/badge/Prisma-16A394?style=for-the-badge&logo=Prisma&logoColor=white)](https://www.prisma.io/)
[![Commitizen](https://img.shields.io/badge/commitizen-143157?style=for-the-badge&logo=git&logoColor=white)](https://github.com/commitizen/czg)
[![Docker](https://img.shields.io/badge/docker-%230db7ed.svg?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![NVIDIA](https://img.shields.io/badge/NVIDIA-%2376B900.svg?style=for-the-badge&logo=nvidia&logoColor=white)](https://www.nvidia.com/)

## 开始运行

### 本地运行

```bash
bun install
bun db:generate
bun db:migrate
bun run dev
```

### Docker运行

确保你的系统已安装：
- [Docker](https://www.docker.com/)
- [Docker Compose](https://docs.docker.com/compose/)
- [NVIDIA Container Toolkit](https://github.com/NVIDIA/nvidia-container-toolkit)

#### 使用 Docker Compose（推荐）

1. 创建环境配置文件：

```bash
cp .env.example .env
```

2. 编辑 `.env` 文件，设置必要的环境变量：

```env
POSTGRES_PASSWORD=your_password
POSTGRES_DB=video_converter
```

3. 启动所有服务：

```bash
docker compose up -d
```

4. 查看服务状态：

```bash
docker compose ps
```

5. 查看服务日志：

```bash
# 查看所有服务日志
docker compose logs -f

# 查看特定服务日志
docker compose logs -f app
```

6. 停止所有服务：

```bash
docker compose down
```

#### 使用单独的Docker容器

1. 构建Docker镜像：

```bash
docker build -t video-converter .
```

2. 运行容器：

```bash
docker run --gpus all -d \
  -p 3000:3000 \
  --name video-converter \
  video-converter
```

3. 查看容器日志：

```bash
docker logs -f video-converter
```

4. 停止容器：

```bash
docker stop video-converter
```

## Windows 兼容性与运行说明

1. **安装 ffmpeg**
   - 请从 [ffmpeg 官网](https://ffmpeg.org/download.html) 下载 Windows 版本，并将 ffmpeg.exe 所在目录加入系统 PATH。
   - 可在命令行输入 `ffmpeg -version` 验证安装。

2. **GPU 编码支持（可选）**
   - 若需使用 NVIDIA 显卡加速（NVENC），请确保已安装 NVIDIA 显卡驱动，并将 `nvidia-smi.exe` 加入 PATH。
   - 可在命令行输入 `nvidia-smi` 验证。

3. **Bun 兼容性**
   - 本项目所有 bun 命令在 Windows 下同样适用。
   - 推荐使用 PowerShell 或 Windows Terminal。

4. **其他注意事项**
   - 路径和文件名建议避免使用特殊字符。
   - 如遇权限问题，请以管理员身份运行命令行。

## 规范

### 开发规范

使用 [Biome](https://biomejs.dev/) 进行代码格式化和质量检查：

```bash
bun check
```

### 提交规范

生成 `.env.example` 文件：

```bash
bun run scripts/generate-env.ts
```

使用 [czg](https://github.com/commitizen/czg) 生成提交信息：

```bash
bun czg
```