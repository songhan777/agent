/* 导入 Electron 的主进程能力；页面不会直接接触这些接口。 */ import { app, BrowserWindow, dialog, ipcMain, net, protocol } from "electron";
/* 导入事件类型，帮助校验 IPC 请求来源。 */ import type { IpcMainInvokeEvent } from "electron";
/* 使用异步文件接口检查目录和建立用户数据路径。 */ import { mkdir, realpath, stat } from "node:fs/promises";
/* 使用标准路径运算，兼容带空格和中文的目录。 */ import path from "node:path";
/* 把本地文件转换成安全的 file URL 供内部资源读取。 */ import { pathToFileURL } from "node:url";
/* 主进程和 preload 共享同一组通信通道。 */ import { CHANNELS } from "../../../../packages/shared/src/contracts";
/* 引入公开快照类型，广播时不包含密钥。 */ import type { AppState, RunMode } from "../../../../packages/shared/src/contracts";
/* 引入任务调度和持久化实现。 */ import { TaskManager } from "./task-manager";
/* 使用自定义安全协议加载生产资源，避免向页面开放任意本地文件。 */ protocol.registerSchemesAsPrivileged([{ scheme: "lab", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
/* 隐藏的自动化实例使用软件离屏绘制，不依赖桌面当前是否有可见 GPU 帧。 */ if (process.env.AGENT_LAB_HEADLESS === "1") app.disableHardwareAcceleration();
/* 保存当前窗口引用，关闭后会置空。 */ let mainWindow: BrowserWindow | null = null;
/* 保存应用唯一的任务管理器，窗口重开时继续复用。 */ let manager: TaskManager;
/* 防止退出保存过程重复触发。 */ let quitting = false;
/* 仅开发脚本可以提供本机 Vite 地址；打包版本完全忽略该变量。 */ const developmentUrl = app.isPackaged ? undefined : process.env.AGENT_LAB_DEV_URL;
/* 固定生产页面地址，所有页面导航都必须保持在这一个文档。 */ const productionUrl = "lab://bundle/index.html";
/* 提前拒绝任意远程开发地址，避免意外给远程页面注入桌面接口。 */ if (developmentUrl && developmentUrl !== "http://127.0.0.1:5173") throw new Error("开发地址必须是 http://127.0.0.1:5173。");
/* 确认 IPC 来自当前应用自己的主页面。 */ function assertSender(event: IpcMainInvokeEvent): void {
  /* 其他窗口、子框架或未知发送者不能调用文件和任务接口。 */ if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error("拒绝未授权的 IPC 来源。");
  /* 解析发送方文档地址。 */ const url = new URL(event.senderFrame.url);
  /* 开发模式只允许指定的本机服务器。 */ const trusted = developmentUrl ? url.origin === developmentUrl : url.protocol === "lab:" && url.hostname === "bundle" && url.pathname === "/index.html";
  /* 来源文档不匹配时立即拒绝。 */ if (!trusted) throw new Error("页面来源不受信任。");
/* 结束 IPC 来源校验。 */ }
/* 将完整状态广播给当前仍然存在的窗口。 */ function broadcast(state: AppState): void {
  /* 窗口可能在任务执行期间关闭，因此发送前先检查生命周期。 */ if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send(CHANNELS.changed, state);
/* 结束状态广播。 */ }
/* 创建主窗口并设置最小权限。 */ async function createWindow(): Promise<void> {
  /* 生产与开发共用安全配置，仅自动化实例启用隐藏的离屏绘制。 */ const window = new BrowserWindow({ width: 1320, height: 880, minWidth: 900, minHeight: 680, title: "Electron Agent Lab · 桌面智能体实验室", backgroundColor: "#f5f6f2", show: process.env.AGENT_LAB_HEADLESS !== "1", webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, offscreen: process.env.AGENT_LAB_HEADLESS === "1" } });
  /* 更新当前主窗口引用。 */ mainWindow = window;
  /* 教学界面自行提供主要交互，隐藏系统默认菜单。 */ window.setMenuBarVisibility(false);
  /* 所有新窗口请求默认拒绝。 */ window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  /* 页面中的链接不能把带有桌面桥接的窗口带到其他网站。 */ window.webContents.on("will-navigate", (event) => event.preventDefault());
  /* 页面中的子框架同样不能发起任意导航。 */ window.webContents.on("will-frame-navigate", (event) => event.preventDefault());
  /* 禁止页面创建 webview 来扩大可访问能力。 */ window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  /* 页面不需要摄像头、定位等额外权限，因此统一拒绝。 */ window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  /* 同步权限检查也采用拒绝策略。 */ window.webContents.session.setPermissionCheckHandler(() => false);
  /* 清理已关闭的窗口引用。 */ window.on("closed", () => { if (mainWindow === window) mainWindow = null; });
  /* 加载本机开发页面或应用自己的资源协议。 */ await window.loadURL(developmentUrl ?? productionUrl);
/* 结束窗口创建。 */ }
/* 启动应用前建立资源协议、任务管理器和 IPC 路由。 */ async function startApplication(): Promise<void> {
  /* 等待 Electron 运行时初始化。 */ await app.whenReady();
  /* 自动化验证可以把用户数据明确放到项目内的临时目录。 */ if (process.env.AGENT_LAB_USER_DATA) {
    /* 将相对覆盖路径规范化为绝对路径。 */ const dataDirectory = path.resolve(process.env.AGENT_LAB_USER_DATA);
    /* 确保指定目录存在。 */ await mkdir(dataDirectory, { recursive: true });
    /* 后续缓存与历史使用这个目录。 */ app.setPath("userData", dataDirectory);
  /* 结束测试数据目录配置。 */ }
  /* 生产资源目录只有已构建的 HTML、CSS 和 JavaScript。 */ const rendererRoot = path.join(app.getAppPath(), "dist", "renderer");
  /* 把 lab 协议映射到允许的资源目录。 */ protocol.handle("lab", (request) => {
    /* 解析协议地址并检查主机。 */ const url = new URL(request.url);
    /* 拒绝资源读取以外的请求。 */ if (url.hostname !== "bundle" || request.method !== "GET") return new Response("Forbidden", { status: 403 });
    /* 解码路径并强制基于 renderer 目录解析。 */ const filename = path.resolve(rendererRoot, `.${decodeURIComponent(url.pathname)}`);
    /* 获取相对路径，用于防止目录逃逸。 */ const relative = path.relative(rendererRoot, filename);
    /* 越界资源不能被读取。 */ if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return new Response("Forbidden", { status: 403 });
    /* 使用 Electron 网络栈读取已验证的本地资源。 */ return net.fetch(pathToFileURL(filename).toString());
  /* 结束资源协议处理器。 */ });
  /* 打包样例放在 ASAR 外，确保文件工具读取真实目录而非归档虚拟路径。 */ const sampleDirectory = app.isPackaged ? path.join(process.resourcesPath, "workspace") : path.join(app.getAppPath(), "examples", "workspace");
  /* 默认使用随项目附带的演示资料，用户也可以选择自己的目录。 */ const workspacePath = await realpath(sampleDirectory);
  /* 只有显式指定 openai 才启用真实模型请求。 */ const mode: RunMode = process.env.AGENT_MODE === "openai" ? "openai" : "demo";
  /* 在主进程保存运行配置，密钥不会进入 IPC 状态。 */ manager = new TaskManager({ workspacePath, historyFile: path.join(app.getPath("userData"), "history.json"), mode, model: mode === "openai" ? process.env.OPENAI_MODEL : undefined, apiKey: mode === "openai" ? process.env.OPENAI_API_KEY : undefined, onChange: broadcast });
  /* 恢复可展示的历史，并把旧的活跃任务标记为中断。 */ await manager.restore();
  /* 页面首次加载时通过该路由获取状态。 */ ipcMain.handle(CHANNELS.state, (event) => { assertSender(event); return manager.snapshot(); });
  /* 创建任务前同时校验来源与输入。 */ ipcMain.handle(CHANNELS.start, (event, prompt: unknown) => { assertSender(event); return manager.start(prompt); });
  /* 取消任务前校验来源，编号由管理器继续检查。 */ ipcMain.handle(CHANNELS.cancel, (event, taskId: unknown) => { assertSender(event); return manager.cancel(taskId); });
  /* 用系统目录选择框授予新任务可读取的目录范围。 */ ipcMain.handle(CHANNELS.workspace, async (event) => {
    /* 先确认调用来自当前主页面。 */ assertSender(event);
    /* 目录选择期间窗口可能关闭，因此保留当前引用。 */ const window = mainWindow;
    /* 没有窗口时返回错误。 */ if (!window) throw new Error("窗口已关闭。");
    /* 只允许选择文件夹。 */ const selected = await dialog.showOpenDialog(window, { title: "选择允许 Agent 读取的目录", properties: ["openDirectory"] });
    /* 用户取消选择时保持当前目录。 */ if (selected.canceled || !selected.filePaths[0]) return manager.snapshot();
    /* 解析真实目录路径，减少符号链接和相对路径歧义。 */ const directory = await realpath(selected.filePaths[0]);
    /* 再次确认选择结果确实是目录。 */ if (!(await stat(directory)).isDirectory()) throw new Error("请选择一个文件夹。");
    /* 仅修改后续新任务使用的默认目录。 */ return manager.setWorkspace(directory);
  /* 结束目录选择路由。 */ });
  /* 在通信路由就绪后加载页面。 */ await createWindow();
  /* macOS 点击 Dock 图标时重新打开已关闭的主窗口。 */ app.on("activate", () => { if (!mainWindow) void createWindow(); });
/* 结束应用初始化。 */ }
/* 关闭最后窗口时让 Windows 和 Linux 正常退出。 */ app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
/* 退出前保存历史，避免任务状态停留在运行中。 */ app.on("before-quit", (event) => {
  /* 第二次退出说明清理已完成，不再阻止。 */ if (quitting || !manager) return;
  /* 先暂停退出，等待历史写入。 */ event.preventDefault();
  /* 标记清理正在进行。 */ quitting = true;
  /* 清理完成或失败后都允许应用退出。 */ void manager.close().finally(() => app.quit());
/* 结束退出事件处理。 */ });
/* 启动失败时给出可见错误并退出，避免留下空白窗口。 */ void startApplication().catch((error: unknown) => { dialog.showErrorBox("模板启动失败", error instanceof Error ? error.message : "未知错误"); app.exit(1); });
