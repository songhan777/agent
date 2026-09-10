/* 配置说明根据实际 JSON 生成，避免行号与源文件不一致。 */ import { mkdir, readFile, writeFile } from "node:fs/promises";
/* 使用跨平台路径工具。 */ import path from "node:path";
/* 从当前模块计算项目根目录。 */ import { fileURLToPath } from "node:url";
/* 固定所有输入和输出都在本项目内。 */ const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/* 为每个配置字段提供中文作用说明。 */ const meanings = {
  /* 包名称便于包管理器和构建工具识别项目。 */ name: "项目包名称；这里是一个统一管理依赖的教学仓库。",
  /* 版本用于展示和命名分发产物。 */ version: "项目版本号，也是桌面分发产物的版本来源。",
  /* 防止误把整个模板发布到 npm。 */ private: "禁止意外将本项目发布为 npm 包。",
  /* 说明项目目的。 */ description: "项目用途描述。",
  /* 记录示例作者标识。 */ author: "示例作者字段，使用模板时可改成自己的名字。",
  /* 声明自有模板源码的使用许可。 */ license: "本模板手写源码采用 MIT 许可，第三方依赖保留各自许可。",
  /* 告诉 Electron 从哪个编译文件启动。 */ main: "Electron 加载的主进程构建入口。",
  /* 指定普通 JavaScript 文件使用 ESM 语义。 */ type: "根目录脚本使用 ES 模块；Electron 构建入口显式使用 .cjs。",
  /* 声明开发环境约束。 */ engines: "开发运行时要求对象。",
  /* 固定最低 Node 版本，匹配工具链要求。 */ node: "开发命令需要的最低 Node.js 版本，Electron 自带自己的 Node 运行时。",
  /* 汇总可以从终端执行的教学命令。 */ scripts: "通过 pnpm 命令名或 npm run 命令名执行的脚本集合。",
  /* 编译后台并启动 Vite 与 Electron。 */ dev: "启动桌面开发环境；页面热更新，主进程改动后需重启。",
  /* 直接用 tsx 运行命令行入口。 */ cli: "运行复用 Agent 核心的命令行子项目。",
  /* 单独检查 TypeScript 类型。 */ typecheck: "检查全部 TypeScript 源码，不生成编译产物。",
  /* 执行离线自动化行为测试。 */ test: "通过 tsx 运行 Node 内置测试，不发送真实模型请求。",
  /* 生成主进程、preload、CLI 和页面。 */ build: "生成 dist 中的桌面与命令行运行文件。",
  /* 启动已经完成构建的桌面应用。 */ start: "直接启动构建版 Electron；首次使用前需要 build。",
  /* 生成展开的桌面分发目录。 */ "package:dir": "先构建，再生成可运行的未压缩分发目录。",
  /* 生成 Windows 解压即可使用的分发包。 */ "package:win": "先构建，再生成 Windows ZIP 分发包。",
  /* 检查每行源码的中文注释。 */ "check:comments": "审计手写源码是否逐行提供中文说明。",
  /* 串联静态检查和行为测试。 */ check: "运行类型检查、离线测试和逐行注释检查。",
  /* 运行真实 Electron 的端到端验证。 */ "test:desktop": "启动隐藏的真实桌面实例，验证桥接和任务，并保存截图。",
  /* 自动更新本配置文档。 */ "docs:config": "根据实际配置重新生成这份逐行说明。",
  /* 声明应用运行需要的依赖。 */ dependencies: "运行依赖集合。",
  /* 声明 React 组件运行时。 */ react: "React 组件与状态管理运行时。",
  /* 声明 React 挂载页面所用运行时。 */ "react-dom": "把 React 组件渲染到 DOM。",
  /* 声明仅开发、编译和验证需要的依赖。 */ devDependencies: "开发依赖集合；版本精确锁定以便复现。",
  /* 提供 Node 类型。 */ "@types/node": "Node 文件、进程等 API 的 TypeScript 类型。",
  /* 提供 React 类型。 */ "@types/react": "React 组件、事件与 Hook 的 TypeScript 类型。",
  /* 提供 React DOM 类型。 */ "@types/react-dom": "React DOM 渲染接口的 TypeScript 类型。",
  /* 提供桌面运行时。 */ electron: "Electron 桌面运行时及内置类型声明。",
  /* 提供分发构建工具。 */ "electron-builder": "制作桌面分发目录和 Windows ZIP 版。",
  /* 提供后台代码打包工具。 */ esbuild: "编译并打包主进程、preload 和 CLI。",
  /* 提供桌面自动化验证工具。 */ playwright: "自动启动并验证真实 Electron 实例。",
  /* 提供开发时 TypeScript 执行器。 */ tsx: "直接执行 TypeScript CLI 和测试文件。",
  /* 提供静态类型检查器。 */ typescript: "检查源码中的类型错误。",
  /* 提供前端构建与开发服务器。 */ vite: "页面开发服务器及生产资源构建工具。",
  /* 开始 TypeScript 编译选项。 */ compilerOptions: "TypeScript 检查器配置对象。",
  /* 指定目标 JavaScript 语义。 */ target: "按 ES2022 语言能力检查代码；实际打包由 esbuild/Vite 完成。",
  /* 启用需要的标准库类型。 */ lib: "同时提供 ES、DOM 与可迭代 DOM 类型。",
  /* 保留 ES 模块供构建工具处理。 */ module: "使用 ES 模块语义，交给构建工具组织模块。",
  /* 按打包工具的方式查找模块。 */ moduleResolution: "使用适合 Vite/esbuild 的模块解析方式。",
  /* 启用现代 JSX 编译约定。 */ jsx: "允许 React JSX 自动运行时；本模板也可使用 createElement。",
  /* 开启严格检查。 */ strict: "开启严格类型检查，包括空值和隐式 any。",
  /* 禁止 tsc 输出文件。 */ noEmit: "只检查类型；避免与构建工具生成重复产物。",
  /* 兼容 CommonJS 模块导入。 */ esModuleInterop: "改善 CommonJS 与 ES 模块的导入兼容性。",
  /* 缩短依赖类型检查时间。 */ skipLibCheck: "跳过第三方声明文件内部检查，仍检查自己的使用方式。",
  /* 支持需要时导入 JSON。 */ resolveJsonModule: "允许以模块方式导入 JSON 配置。",
  /* 提前发现跨平台文件名大小写问题。 */ forceConsistentCasingInFileNames: "要求导入文件名大小写一致。",
  /* 明确全局类型来源。 */ types: "默认加载 Node 全局类型，React 类型通过导入获得。",
  /* 说明静态检查覆盖范围。 */ include: "检查应用、共享模块和测试的 TypeScript 文件。",
/* 结束配置字段解释映射。 */ };
/* 先写明注释版只供阅读，不能覆盖原始标准 JSON。 */ let document = "# 配置文件逐行说明\n\n原始 JSON 保持标准语法；下面的 jsonc 代码块为逐行解释，不要直接复制覆盖 package.json。依赖锁文件由包管理器生成，不逐行手写注释。YAML 配置在原文件中已有中文注释。\n";
/* 按实际文件内容生成对应说明。 */ for (const filename of ["package.json", "tsconfig.json"]) {
  /* 读取文件并按换行拆分。 */ const lines = (await readFile(path.join(root, filename), "utf8")).trimEnd().split(/\r?\n/);
  /* 提取配置字段并解释每个非空行。 */ const annotated = lines.map((line, index) => {
    /* 匹配 JSON 属性名。 */ const key = /^\s*"([^"]+)"\s*:/.exec(line)?.[1];
    /* 结构行同样解释作用，避免只解释属性。 */ const meaning = key ? meanings[key] ?? "声明此配置字段。" : index === 0 ? "开始根配置对象。" : line.trim().startsWith("}") ? "结束当前配置对象。" : "结束当前配置结构。";
    /* 保留原始配置，在同一行追加编号与中文说明。 */ return `${line} // 第 ${index + 1} 行：${meaning}`;
  /* 结束单文件注释生成。 */ }).join("\n");
  /* 把该文件的注释版本加入文档。 */ document += `\n## ${filename}\n\n\`\`\`jsonc\n${annotated}\n\`\`\`\n`;
/* 结束配置文件循环。 */ }
/* 确保文档目录存在。 */ await mkdir(path.join(root, "docs"), { recursive: true });
/* 保存可点击阅读的 Markdown 文件。 */ await writeFile(path.join(root, "docs", "CONFIG_EXPLAINED.md"), document, "utf8");
/* 输出完成提示。 */ console.log("已生成 docs/CONFIG_EXPLAINED.md。");
