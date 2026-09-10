# 配置文件逐行说明

原始 JSON 保持标准语法；下面的 jsonc 代码块为逐行解释，不要直接复制覆盖 package.json。依赖锁文件由包管理器生成，不逐行手写注释。YAML 配置在原文件中已有中文注释。

## package.json

```jsonc
{ // 第 1 行：开始根配置对象。
  "name": "electron-agent-lab", // 第 2 行：项目包名称；这里是一个统一管理依赖的教学仓库。
  "version": "0.1.0", // 第 3 行：项目版本号，也是桌面分发产物的版本来源。
  "private": true, // 第 4 行：禁止意外将本项目发布为 npm 包。
  "description": "Electron + React + TypeScript 中文逐行注释教学模板", // 第 5 行：项目用途描述。
  "author": "Learning Lab", // 第 6 行：示例作者字段，使用模板时可改成自己的名字。
  "license": "MIT", // 第 7 行：本模板手写源码采用 MIT 许可，第三方依赖保留各自许可。
  "main": "dist/main/index.cjs", // 第 8 行：Electron 加载的主进程构建入口。
  "type": "module", // 第 9 行：根目录脚本使用 ES 模块；Electron 构建入口显式使用 .cjs。
  "engines": { // 第 10 行：开发运行时要求对象。
    "node": ">=22.12.0" // 第 11 行：开发命令需要的最低 Node.js 版本，Electron 自带自己的 Node 运行时。
  }, // 第 12 行：结束当前配置对象。
  "scripts": { // 第 13 行：通过 pnpm 命令名或 npm run 命令名执行的脚本集合。
    "dev": "node scripts/dev.mjs", // 第 14 行：启动桌面开发环境；页面热更新，主进程改动后需重启。
    "cli": "tsx apps/cli/src/index.ts", // 第 15 行：运行复用 Agent 核心的命令行子项目。
    "typecheck": "tsc --noEmit", // 第 16 行：检查全部 TypeScript 源码，不生成编译产物。
    "test": "tsx --test tests/*.test.ts", // 第 17 行：通过 tsx 运行 Node 内置测试，不发送真实模型请求。
    "build": "node scripts/build.mjs", // 第 18 行：生成 dist 中的桌面与命令行运行文件。
    "start": "electron .", // 第 19 行：直接启动构建版 Electron；首次使用前需要 build。
    "package:dir": "node scripts/build.mjs && electron-builder --dir", // 第 20 行：先构建，再生成可运行的未压缩分发目录。
    "package:win": "node scripts/build.mjs && electron-builder --win zip", // 第 21 行：先构建，再生成 Windows ZIP 分发包。
    "check:comments": "node scripts/check-comments.mjs", // 第 22 行：审计手写源码是否逐行提供中文说明。
    "check": "tsc --noEmit && tsx --test tests/*.test.ts && node scripts/check-comments.mjs", // 第 23 行：运行类型检查、离线测试和逐行注释检查。
    "test:desktop": "node scripts/smoke-desktop.mjs", // 第 24 行：启动隐藏的真实桌面实例，验证桥接和任务，并保存截图。
    "docs:config": "node scripts/explain-config.mjs" // 第 25 行：根据实际配置重新生成这份逐行说明。
  }, // 第 26 行：结束当前配置对象。
  "dependencies": { // 第 27 行：运行依赖集合。
    "react": "19.2.8", // 第 28 行：React 组件与状态管理运行时。
    "react-dom": "19.2.8" // 第 29 行：把 React 组件渲染到 DOM。
  }, // 第 30 行：结束当前配置对象。
  "devDependencies": { // 第 31 行：开发依赖集合；版本精确锁定以便复现。
    "@types/node": "22.20.1", // 第 32 行：Node 文件、进程等 API 的 TypeScript 类型。
    "@types/react": "19.2.18", // 第 33 行：React 组件、事件与 Hook 的 TypeScript 类型。
    "@types/react-dom": "19.2.7", // 第 34 行：React DOM 渲染接口的 TypeScript 类型。
    "electron": "44.3.0", // 第 35 行：Electron 桌面运行时及内置类型声明。
    "electron-builder": "26.15.3", // 第 36 行：制作桌面分发目录和 Windows ZIP 版。
    "esbuild": "0.28.2", // 第 37 行：编译并打包主进程、preload 和 CLI。
    "playwright": "1.63.0", // 第 38 行：自动启动并验证真实 Electron 实例。
    "tsx": "4.23.13", // 第 39 行：直接执行 TypeScript CLI 和测试文件。
    "typescript": "7.0.2", // 第 40 行：检查源码中的类型错误。
    "vite": "8.2.2" // 第 41 行：页面开发服务器及生产资源构建工具。
  } // 第 42 行：结束当前配置对象。
} // 第 43 行：结束当前配置对象。
```

## tsconfig.json

```jsonc
{ // 第 1 行：开始根配置对象。
  "compilerOptions": { // 第 2 行：TypeScript 检查器配置对象。
    "target": "ES2022", // 第 3 行：按 ES2022 语言能力检查代码；实际打包由 esbuild/Vite 完成。
    "lib": ["ES2022", "DOM", "DOM.Iterable"], // 第 4 行：同时提供 ES、DOM 与可迭代 DOM 类型。
    "module": "ESNext", // 第 5 行：使用 ES 模块语义，交给构建工具组织模块。
    "moduleResolution": "Bundler", // 第 6 行：使用适合 Vite/esbuild 的模块解析方式。
    "jsx": "react-jsx", // 第 7 行：允许 React JSX 自动运行时；本模板也可使用 createElement。
    "strict": true, // 第 8 行：开启严格类型检查，包括空值和隐式 any。
    "noEmit": true, // 第 9 行：只检查类型；避免与构建工具生成重复产物。
    "esModuleInterop": true, // 第 10 行：改善 CommonJS 与 ES 模块的导入兼容性。
    "skipLibCheck": true, // 第 11 行：跳过第三方声明文件内部检查，仍检查自己的使用方式。
    "resolveJsonModule": true, // 第 12 行：允许以模块方式导入 JSON 配置。
    "forceConsistentCasingInFileNames": true, // 第 13 行：要求导入文件名大小写一致。
    "types": ["node"] // 第 14 行：默认加载 Node 全局类型，React 类型通过导入获得。
  }, // 第 15 行：结束当前配置对象。
  "include": ["apps/**/*.ts", "apps/**/*.tsx", "packages/**/*.ts", "tests/**/*.ts"] // 第 16 行：检查应用、共享模块和测试的 TypeScript 文件。
} // 第 17 行：结束当前配置对象。
```
