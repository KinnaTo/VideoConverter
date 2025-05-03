# Video Convert Queue

## 工具链

[![Bun](https://img.shields.io/badge/bun-black?style=for-the-badge&logo=bun&logoColor=white)](https://bun.sh/)
[![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Biome](https://img.shields.io/badge/biome-60A5FA?style=for-the-badge&logo=biome&logoColor=white)](https://biomejs.dev/)
[![Prisma](https://img.shields.io/badge/Prisma-16A394?style=for-the-badge&logo=Prisma&logoColor=white)](https://www.prisma.io/)
[![Commitizen](https://img.shields.io/badge/commitizen-143157?style=for-the-badge&logo=git&logoColor=white)](https://github.com/commitizen/czg)

## 开始运行

```bash
bun install
bun db:generate
bun db:migrate
bun run dev
```

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