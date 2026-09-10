# Electron Agent Lab

面向“会 JavaScript 和 React/Vue、还没有 Electron 经验”的中文教学模板。使用 **Electron + React + TypeScript**，把文件工具、Agent 执行与桌面界面分开，方便你逐层学习和修改。

默认使用离线 `demo` 模式：不需要 API Key，也不会请求模型服务。工具会真实读取你选择的目录；演示回答由确定性流程生成，**不是大模型推理结果**。

## 你会得到什么

这是一份根目录统一管理依赖的工程，包含三个可分别阅读的学习单元，并非三个独立发布的 npm 包。

| 学习单元 | 位置 | 学习重点 |
|---|---|---|
| 文件工具与 Agent 核心 | `packages/core` | Node.js 文件操作、参数校验、工具调用循环、取消 |
| 命令行应用 | `apps/cli` | 不依赖桌面界面运行核心逻辑、命令参数、终端日志 |
| 桌面应用 | `apps/desktop` | Electron 主进程、preload、IPC、React、任务队列和历史记录 |

`packages/shared` 保存桌面进程之间共用的类型和 IPC 通道。它是公共契约层，避免主进程与页面各自定义不一致的数据结构。

手写源码中的每个非空行都带有中文注释，包括作用域结束行，便于初学者对应代码阅读。标准 JSON 文件不支持注释，对应说明放在 [配置逐行说明](docs/CONFIG_EXPLAINED.md)。

## 快速开始

只想先体验界面，可以打开已生成的 `release/win-unpacked` 文件夹，双击其中的 **Electron Agent Lab.exe**。这个 Windows 分发目录版不需要另装 Node.js 或 pnpm；复制到其他位置时请保留整个文件夹及其资源，不要只复制里面的 exe。Windows ZIP 分发文件为 `release/Electron-Agent-Lab-0.1.0-x64.zip`，使用时先完整解压，再运行其中的 exe；生成与验收状态以 [验证报告](docs/VERIFICATION.md) 为准。

修改源码需要 Node.js **22.12 或以上**，以及可用的 pnpm。本次开发环境采用 Node.js 24 与 pnpm 11，具体版本和验收结果见验证报告。

如果终端还不认识 `pnpm`，先准备包含 npm 的完整 Node.js 安装，再安装 pnpm；仅有一个 `node.exe` 不代表 npm 也已就绪。已有可用 pnpm 时跳过下面这段：

```powershell
# 检查当前终端是否可以调用 Node.js。
node --version
# 检查 Node.js 安装中是否包含可调用的 npm。
npm --version
# 在 npm 可用的环境中安装本模板使用的 pnpm 主版本。
npm install --global pnpm@11
# 确认 pnpm 已经可用。
pnpm --version
```

首次安装项目依赖需要网络，并会下载 Electron；这里的“离线演示”指依赖安装后运行演示任务不需要模型网络服务。

在 PowerShell 中进入本模板根目录：

```powershell
# 安装当前项目的依赖。
pnpm install
# 同时启动开发构建、界面开发服务器和 Electron。
pnpm dev
```

打开应用后，默认目录是随模板附带的 `examples/workspace`，也可以通过目录按钮重新选择。打包版会把同一份资料复制到 `resources/workspace`，保留为 ASAR 外的真实文件。输入“概览项目结构”并运行，观察任务从排队、执行到完成，以及工具日志与最终回答。输入“搜索 TODO”可以体验另一条固定演示规则。

也可以先运行命令行版本，排除 Electron 和界面因素：

```powershell
# 使用仓库里的小型示例目录运行离线演示。
pnpm cli -- --workspace examples/workspace --prompt "概览项目结构"
```

界面使用 Vite 热更新；修改 Electron 主进程或 preload 后，需要停止并重新执行 `pnpm dev`。开发历史保存在项目内 `.local-data/dev/history.json`；构建启动和分发版本默认使用 Electron 的用户数据目录。

## 真实模型模式

先用不含敏感信息的小型目录练习。真实模式会把问题以及实际调用工具取得的部分文件内容发送给模型服务；路径过滤无法识别普通源码中偶然出现的秘密。

```powershell
# 将桌面应用的执行模式设为真实模型模式。
$env:AGENT_MODE = "openai"
# 在自己的终端中设置 API Key，不要把真实密钥提交到源码。
$env:OPENAI_API_KEY = "填写你自己的密钥"
# 填写你的账户可用、支持所用接口和工具调用的模型名称。
$env:OPENAI_MODEL = "填写你的模型名称"
# 从当前终端启动，让主进程继承上述环境变量。
pnpm dev
```

CLI 也可显式选择模式：

```powershell
# 使用相同的模型环境变量，从终端运行真实模型任务。
pnpm cli -- --mode openai --workspace examples/workspace --prompt "说明示例项目怎样运行"
# 学习结束后恢复桌面应用的离线演示模式。
$env:AGENT_MODE = "demo"
```

API Key 留在本地执行侧，不作为页面状态通过 IPC 传输。这是使用个人环境变量的教学方式；企业共享凭据需要另行设计认证和服务端代理。

## 常用命令

所有命令均在本模板根目录执行。

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 启动桌面开发环境 |
| `pnpm cli -- --workspace examples/workspace --prompt "概览项目结构"` | 运行离线 CLI |
| `pnpm typecheck` | 检查 TypeScript 类型 |
| `pnpm test` | 运行自动化测试 |
| `pnpm check:comments` | 检查手写源码非空行的注释覆盖 |
| `pnpm check` | 顺序运行类型、测试和注释检查 |
| `pnpm build` | 构建主进程、preload、CLI 和页面 |
| `pnpm start` | 启动已经构建好的桌面应用，首次使用前先 build |
| `pnpm test:desktop` | 验证构建后的桌面应用，首次运行或修改源码后先执行 `pnpm build` |
| `pnpm test:desktop --dev` | 启动本机 Vite 并验证开发页面，需先构建后台入口 |
| `pnpm docs:config` | 根据实际 JSON 重新生成配置逐行说明 |
| `pnpm package:dir` | 构建后生成未封装的桌面分发目录 |
| `pnpm package:win` | 构建 Windows ZIP 分发包 |

Windows ZIP 是便于学习的分发形式，需要完整解压后运行。模板没有完成代码签名、自动更新服务和多平台发布验证。

桌面验证使用真实 Electron、preload 和 IPC，并通过隐藏的离屏窗口保存截图。`--dev` 验证开发页面；设置 `AGENT_LAB_EXECUTABLE` 可复用同一脚本验证打包目录内的 exe，不能同时使用 `--dev`。每种模式的实际结果与测试跳过项见验证报告。

## 目录与源码阅读顺序

```text
electron-agent-lab/
├─ apps/
│  ├─ cli/                命令行入口
│  └─ desktop/
│     └─ src/
│        ├─ main/         Electron 生命周期、任务管理、存储、IPC
│        ├─ preload/      页面能力白名单
│        └─ renderer/     React 页面与交互
├─ packages/
│  ├─ core/               文件工具、Agent 和模型适配
│  └─ shared/             共享类型与 IPC 通道
├─ examples/workspace/    可放心修改的学习输入目录
├─ scripts/               开发、构建、检查与桌面验证脚本
├─ tests/                 核心行为与边界测试
├─ docs/                  架构、学习、配置和验证文档
├─ package.json           统一依赖与命令
└─ electron-builder.yml   桌面分发配置
```

建议先读 `packages/shared/src/contracts.ts` 理解状态，再读 `packages/core/src/tools.ts` 理解工具边界，然后按 **core → CLI → main → preload → renderer** 的顺序阅读。这样进入界面之前，已经知道它显示的数据从哪里来。

## 文档导航

- [架构分析：三个学习单元、进程边界与执行流程](docs/ARCHITECTURE.md)
- [学习指南：按你的现有基础安排练习与验收](docs/LEARNING_GUIDE.md)
- [配置逐行说明](docs/CONFIG_EXPLAINED.md)
- [验证报告：实际执行结果与未验证范围](docs/VERIFICATION.md)

## 已有能力与扩展边界

模板用于学习只读文件工具、Agent 调用、桌面 IPC、任务取消、受限并发与历史回放。它不是完整的生产级编程助手。

文件写入、Shell 执行、浏览器自动化、MCP、任意模型提供商、多智能体、逐字流式回答、完整长上下文压缩、更新发布服务与企业凭据管理，均需另行设计与实现。历史记录用于回放任务，不能等同于运行中任务的断点续跑。

不要仅凭注释检查通过认定程序正确。注释检查确认覆盖，类型检查确认静态约束，行为测试和桌面验证用于检查实际结果；最终验收范围以生成的验证报告为准。
