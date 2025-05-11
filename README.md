# VConverter

视频转换服务，支持下载、转换和上传视频文件。

## 项目结构

```
src/
  ├── core/            # 核心架构
  │   ├── TaskState.ts   # 任务状态接口和处理器
  │   ├── TaskStates.ts  # 具体任务状态实现
  │   └── TaskQueue.ts   # 任务队列管理
  ├── services/        # 服务
  │   └── runner.ts      # 运行器服务
  ├── task/            # 任务相关
  │   ├── converter.ts   # 视频转换
  │   ├── downloader.ts  # 文件下载
  │   ├── manager.ts     # 任务管理
  │   └── uploader.ts    # 文件上传
  ├── types/           # 类型定义
  │   ├── convert-params.ts  # 转换参数
  │   ├── runner.ts     # 运行器类型
  │   └── task.ts       # 任务类型
  └── utils/           # 工具
      ├── api.ts         # API客户端
      ├── logger.ts      # 日志工具
      └── system-info.ts # 系统信息
```

## 架构设计

### 核心架构

- **TaskProcessor**: 负责单个任务的生命周期管理
- **TaskQueue**: 管理任务队列和并发执行
- **TaskState**: 使用状态模式管理任务状态

### 状态模式

任务处理被分为以下状态：

1. **WaitingState**: 任务等待处理
2. **DownloadingState**: 下载阶段
3. **ConvertingState**: 转换阶段
4. **UploadingState**: 上传阶段
5. **CompleteState**: 完成阶段
6. **FailedState**: 失败处理

### 事件驱动

使用 EventEmitter 实现进度通知和事件处理：

- `progress`: 进度更新
- `stateChange`: 状态变更
- `complete`: 任务完成
- `error`: 错误发生

## 最近重构

### 问题

1. runner.ts 和 task/manager.ts 存在大量重复代码
2. 文件处理和错误处理不够健壮
3. 代码职责不清晰

### 改进

1. **统一架构**

   - 使用 TaskProcessor 作为任务处理的核心
   - 使用 TaskQueue 管理任务队列
   - 删除 manager.ts 中的重复代码

2. **文件处理改进**

   - 修复 Downloader 将路径创建为目录的问题
   - 修复 Converter 将输出路径创建为目录的问题
   - 统一使用 os.tmpdir()/videoconverter 作为临时目录
   - 为每个任务创建单独的子目录
   - 添加文件清理机制

3. **API 调用改进**

   - 统一使用 axios 进行 API 调用
   - 确保 API 路径和响应数据结构一致

4. **错误处理改进**

   - 每个状态都有专门的错误处理
   - 详细的错误日志记录
   - 统一的错误报告机制

5. **进度通知改进**
   - 使用 EventEmitter 实现统一的进度通知
   - 标准化进度事件格式

## 使用方法

### 作为服务运行

```typescript
import { RunnerService } from "./services/runner";

const runner = new RunnerService({
  machineId: "unique-machine-id",
  token: "api-token",
  apiUrl: "https://api.example.com",
  downloadDir: "/tmp/downloads",
  heartbeatInterval: 30000,
  taskCheckInterval: 5000,
});

runner.start();
```

### 处理单个任务

```typescript
import { TaskProcessor } from "./core/TaskState";
import api from "./utils/api";

const processor = new TaskProcessor("/tmp/workdir", api);
await processor.process({
  id: "task-id",
  status: TaskStatus.WAITING,
  source: "https://example.com/video.mp4",
  convertParams: {
    codec: "h264_nvenc",
    audioCodec: "aac",
    preset: "fast",
    resolution: "1080p",
  },
});
```

## 配置

环境变量配置：

- `API_URL`: API 服务器 URL
- `MACHINE_ID`: 机器 ID
- `API_TOKEN`: API 认证令牌
- `WORK_DIR`: 工作目录（默认为系统临时目录）
- `MAX_CONCURRENT`: 最大并发任务数（默认为 1）
