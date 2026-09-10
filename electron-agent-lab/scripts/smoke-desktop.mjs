/* 使用断言验证真实桌面行为，而不是只检查代码能否编译。 */ import assert from "node:assert/strict";
/* 使用文件接口准备独立历史目录并保存原生截图。 */ import { mkdir, writeFile } from "node:fs/promises";
/* 为每轮验证生成唯一目录，避免旧任务污染结果。 */ import { randomUUID } from "node:crypto";
/* 使用路径工具定位模板与打包程序。 */ import path from "node:path";
/* 将脚本 URL 转换成文件系统位置。 */ import { fileURLToPath } from "node:url";
/* Node 中的 electron 包导出开发运行时路径。 */ import electronPath from "electron";
/* 使用 Playwright 专门提供的 Electron 测试接口。 */ import { _electron } from "playwright";
/* 开发模式验证复用 Vite 的真实开发服务器。 */ import { createServer } from "vite";
/* 计算模板根目录。 */ const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/* 每次测试都使用项目内独立用户数据，不访问日常应用历史。 */ const dataDirectory = path.join(root, ".local-data", `smoke-${randomUUID()}`);
/* 把截图保存为用户可以直接打开的文档附件。 */ const imageDirectory = path.join(root, "docs", "images");
/* 创建测试和截图目录，不删除既有用户数据。 */ await Promise.all([mkdir(dataDirectory, { recursive: true }), mkdir(imageDirectory, { recursive: true })]);
/* 可通过环境变量指定打包后的可执行文件，复用同一组验证。 */ const packagedExecutable = process.env.AGENT_LAB_EXECUTABLE;
/* 传入 --dev 时验证开发服务器，否则验证本地生产资源。 */ const development = process.argv.includes("--dev");
/* 打包程序只使用生产资源，不能同时要求开发模式。 */ assert.ok(!(development && packagedExecutable), "打包验证与开发模式不能同时启用");
/* 仅开发验证需要创建 Vite 服务。 */ const server = development ? await createServer({ configFile: path.join(root, "apps/desktop/vite.config.ts") }) : undefined;
/* 等服务器就绪后再让 Electron 请求开发页面。 */ if (server) await server.listen();
/* 强制离线、隐藏窗口，并隔离测试历史。 */ const environment = { ...process.env, AGENT_MODE: "demo", AGENT_LAB_USER_DATA: dataDirectory, AGENT_LAB_HEADLESS: "1" };
/* 开发运行时必须按桌面模式启动。 */ delete environment.ELECTRON_RUN_AS_NODE;
/* 验证期间不能意外继承真实模型凭据。 */ delete environment.OPENAI_API_KEY;
/* 验证构建版时不连接可能遗留的开发服务器。 */ delete environment.AGENT_LAB_DEV_URL;
/* 开发模式只使用与主进程白名单一致的本机地址。 */ if (development) environment.AGENT_LAB_DEV_URL = "http://127.0.0.1:5173";
/* 打包与开发运行时的入口参数不同。 */ const launchOptions = { executablePath: packagedExecutable ?? electronPath, args: packagedExecutable ? [] : [root], cwd: root, env: environment, timeout: 30000 };
/* 保存本轮任务编号，稍后重启验证持久化。 */ let completedId;
/* 保存页面运行时异常，出现任何异常都让测试失败。 */ const pageErrors = [];
/* 隐藏窗口使用 Electron 原生截图接口，避免浏览器截图等待可见窗口帧。 */ async function capture(application, filename) {
  /* 在主进程捕获完整页面并保持窗口隐藏。 */ const base64 = await application.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString("base64"));
  /* 空图片不能当作有效的视觉验证结果。 */ assert.ok(base64.length > 1000, "截图不能为空");
  /* 把图片从进程间传输的字符串恢复为 PNG 文件。 */ await writeFile(path.join(imageDirectory, filename), Buffer.from(base64, "base64"));
/* 结束原生截图方法。 */ }
/* IPC 状态读取是异步函数，因此在 Node 侧轮询结果，而不把 Promise 当成浏览器真值。 */ async function waitState(page, predicate) {
  /* 为每次状态等待设置明确截止时间。 */ const deadline = Date.now() + 15000;
  /* 在截止时间内读取真实后台状态。 */ while (Date.now() < deadline) {
    /* 等待 IPC 真正返回快照。 */ const state = await page.evaluate(() => window.desktop.getState());
    /* 只有快照满足条件时才完成等待。 */ if (predicate(state)) return state;
    /* 短暂让出执行时间，避免忙循环。 */ await new Promise((resolve) => setTimeout(resolve, 25));
  /* 结束状态等待循环。 */ }
  /* 超时明确失败，不能继续对不存在的结果做断言。 */ throw new Error("等待桌面任务状态超时。");
/* 结束异步快照等待方法。 */ }
/* 启动真实 Electron；启动失败也必须释放可能存在的开发端口。 */ let application = await _electron.launch(launchOptions).catch(async (error) => { await server?.close(); throw error; });
/* 无论断言是否成功，最终都关闭测试进程。 */ try {
  /* 等待主窗口创建。 */ const page = await application.firstWindow();
  /* 收集页面未捕获异常。 */ page.on("pageerror", (error) => pageErrors.push(error.message));
  /* 等待 preload 成功注入且 React 完成初始状态读取。 */ await page.locator(".welcome").waitFor({ timeout: 15000 });
  /* 从真实 BrowserWindow 核对进程隔离配置。 */ const security = await application.evaluate(({ BrowserWindow }) => { const preferences = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(); return { sandbox: preferences.sandbox, contextIsolation: preferences.contextIsolation, nodeIntegration: preferences.nodeIntegration }; });
  /* 验证预期的安全选项没有因构建而改变。 */ assert.deepEqual(security, { sandbox: true, contextIsolation: true, nodeIntegration: false });
  /* 保存首次打开的空状态，供查看整体布局。 */ await capture(application, "desktop-empty.png");
  /* 通过可见输入框提交第一个任务。 */ await page.getByLabel("交给 Agent 的任务", { exact: true }).fill("概览项目结构");
  /* 点击真正的提交按钮，覆盖 React 到主进程的整条链路。 */ await page.getByRole("button", { name: "创建任务", exact: true }).click();
  /* 等后台任务完成，避免使用固定等待时间。 */ await waitState(page, (state) => state.tasks.some((task) => task.status === "completed"));
  /* 读取真实快照并检查结果来自离线工具。 */ const initial = await page.evaluate(() => window.desktop.getState());
  /* 找到刚完成的概览任务。 */ const completed = initial.tasks.find((task) => task.status === "completed");
  /* 保留任务编号用于重启验证。 */ completedId = completed.id;
  /* 回答必须明确标注没有调用真实模型。 */ assert.match(completed.answer, /离线规则演示/);
  /* 回答必须引用样例中实际存在的文件。 */ assert.match(completed.answer, /README\.md/);
  /* 执行过程应当确实包含工具事件。 */ assert.ok(completed.events.some((event) => event.kind === "tool"));
  /* 展开第一个工具详情，确保折叠交互可用。 */ await page.locator(".event-details summary").first().click();
  /* 等待答案卡真正呈现在页面中。 */ await page.locator(".answer-card").waitFor();
  /* 保存有任务状态的界面。 */ await capture(application, "desktop-task.png");
  /* 第二个任务验证搜索链路，同时保留第一个历史任务。 */ const search = await page.evaluate(async () => (await window.desktop.startTask("搜索 TODO")).tasks[0].id);
  /* 等待搜索结束后检查内容。 */ await waitState(page, (state) => state.tasks.find((task) => task.id === search)?.status === "completed");
  /* 搜索结果必须能定位真实样例文件。 */ const searchState = await page.evaluate(() => window.desktop.getState());
  /* 检查搜索命中的任务文件。 */ assert.match(searchState.tasks.find((task) => task.id === search).answer, /src\/tasks\.ts/);
  /* 快速创建多个任务，验证真实桥接能观察到排队状态。 */ const queueObservation = await page.evaluate(async () => { const one = await window.desktop.startTask("概览项目结构 一"); const two = await window.desktop.startTask("概览项目结构 二"); const three = await window.desktop.startTask("概览项目结构 三"); const queued = three.tasks.find((task) => task.status === "queued"); const running = three.tasks.find((task) => task.status === "running"); if (queued) await window.desktop.cancelTask(queued.id); if (running) await window.desktop.cancelTask(running.id); return { queued: queued?.id, running: running?.id, runningCount: three.tasks.filter((task) => task.status === "running").length, first: one.tasks[0].id, second: two.tasks[0].id }; });
  /* 最多两个任务同时运行。 */ assert.ok(queueObservation.runningCount <= 2);
  /* 第三个任务应该进入队列。 */ assert.ok(queueObservation.queued);
  /* 运行取消也必须被覆盖。 */ assert.ok(queueObservation.running);
  /* 等所有任务进入终止状态，覆盖取消传播和后续调度。 */ await waitState(page, (state) => state.tasks.every((task) => !["running", "queued"].includes(task.status)));
  /* 获取取消完成后的快照。 */ const final = await page.evaluate(() => window.desktop.getState());
  /* 排队取消的任务不能被启动。 */ assert.equal(final.tasks.find((task) => task.id === queueObservation.queued).status, "cancelled");
  /* 运行取消的任务不能被迟到结果覆盖为成功。 */ assert.equal(final.tasks.find((task) => task.id === queueObservation.running).status, "cancelled");
  /* 非法输入必须由主进程拒绝。 */ const rejected = await page.evaluate(async () => { try { await window.desktop.startTask(42); return false; } catch { return true; } });
  /* 确认运行时校验真的生效。 */ assert.equal(rejected, true);
  /* 自动化阶段不能出现未处理的页面异常。 */ assert.deepEqual(pageErrors, []);
/* 断言失败时先释放开发端口，避免测试进程一直等待。 */ } catch (error) { await server?.close(); throw error;
/* 退出应用会触发真实的历史保存逻辑。 */ } finally { await application.close(); }
/* 使用相同目录重启验证持久化；启动失败时也释放开发服务器。 */ application = await _electron.launch(launchOptions).catch(async (error) => { await server?.close(); throw error; });
/* 第二次启动结束后仍要释放桌面进程。 */ try {
  /* 获取重启后的主窗口。 */ const page = await application.firstWindow();
  /* 等待历史任务展示出来。 */ await page.locator(".task-card").first().waitFor({ timeout: 15000 });
  /* 获取恢复后的后台快照。 */ const recovered = await page.evaluate(() => window.desktop.getState());
  /* 原来的已完成任务必须仍然存在且保持完成状态。 */ assert.equal(recovered.tasks.find((task) => task.id === completedId)?.status, "completed");
  /* 输出验证范围，不声称测试了真实 API 或其他操作系统。 */ console.log("真实 Electron 验证通过：安全选项、IPC、目录概览、TODO 搜索、队列、取消、输入校验、历史恢复与页面渲染。");
  /* 提示截图的保存位置。 */ console.log(`截图：${imageDirectory}`);
/* 清理重启后的测试实例，并释放可能存在的开发服务器。 */ } finally { await application.close(); await server?.close(); }
