/* 使用 Node.js 自带测试运行器组织行为测试。 */ import test from "node:test";
/* 用严格断言检查调度、取消与历史恢复结果。 */ import assert from "node:assert/strict";
/* 仅对本测试创建的临时目录执行文件操作。 */ import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
/* 获取可写的系统临时位置。 */ import os from "node:os";
/* 统一计算和校验绝对路径。 */ import path from "node:path";
/* 导入真实管理器，测试不会复制其调度逻辑。 */ import { TaskManager } from "../apps/desktop/src/main/task-manager.js";
/* 导入核心输入类型，使模拟执行器和生产执行器接口一致。 */ import type { AgentInput } from "../packages/core/src/index.js";
/* 导入公开状态类型，观察者只能读取对外快照。 */ import type { AppState, TaskStatus } from "../packages/shared/src/contracts.js";
/* 创建可以由测试主动完成的 Promise，避免依赖随机延时。 */ function deferred<T>() {
  /* 保存后续才会由 Promise 构造器赋值的完成函数。 */ let resolve!: (value: T) => void;
  /* 保存后续才会由 Promise 构造器赋值的失败函数。 */ let reject!: (reason: unknown) => void;
  /* Promise 保持等待，直到测试显式完成或拒绝它。 */ const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  /* 暴露受控的执行结果与两个结算入口。 */ return { promise, resolve, reject };
/* 结束可控 Promise 工厂。 */ }
/* 定义一次模拟执行调用，便于检查参数、信号和迟到结果。 */ interface Execution { input: AgentInput; result: ReturnType<typeof deferred<string>>; }
/* 创建一个不访问模型或文件工具的可观察管理器。 */ function createHarness(workspacePath: string, historyFile: string) {
  /* 记录真正开始执行的任务；排队中的任务不会进入这里。 */ const calls: Execution[] = [];
  /* 用状态广播唤醒断言，避免 sleep 和频繁轮询。 */ const watchers = new Set<(state: AppState) => void>();
  /* 创建真实调度器，并注入受控执行器。 */ const manager = new TaskManager({
    /* 指定首次创建任务使用的目录。 */ workspacePath,
    /* 所有历史都保存到测试自己的临时文件。 */ historyFile,
    /* 固定离线模式，整个测试不需要密钥。 */ mode: "demo",
    /* 每次真实管理器发布状态时通知所有等待条件。 */ onChange: (state) => { for (const watcher of [...watchers]) watcher(state); },
    /* 执行器记录调用后保持等待，由测试决定何时完成。 */ execute: async (input) => {
      /* 为本次执行创建独立 Promise。 */ const result = deferred<string>();
      /* 保存实际传入的目录、提示词、取消信号和事件回调。 */ calls.push({ input, result });
      /* 调度器的开始广播早于调用执行器，所以这里额外通知调用数量观察者。 */ for (const watcher of [...watchers]) watcher(manager.snapshot());
      /* 等待测试明确控制执行结果。 */ return result.promise;
    /* 结束模拟执行器。 */ },
  /* 结束管理器配置。 */ });
  /* 等待快照满足某个条件，已满足时立即返回。 */ function waitFor(predicate: (state: AppState) => boolean): Promise<AppState> {
    /* 先读取快照，避免错过已经发生的状态变更。 */ const current = manager.snapshot();
    /* 条件已经满足时不再创建监听器。 */ if (predicate(current)) return Promise.resolve(current);
    /* 否则等待下一次相关状态变更。 */ return new Promise<AppState>((resolve) => {
      /* 只在断言需要的状态出现时完成等待。 */ const watcher = (state: AppState) => { if (predicate(state)) { watchers.delete(watcher); resolve(state); } };
      /* 注册观察者，同步注册过程没有异步检查间隙。 */ watchers.add(watcher);
    /* 结束条件等待 Promise。 */ });
  /* 结束状态等待辅助方法。 */ }
  /* 用实际执行次数判断任务是否开始，避免仅相信 running 文本。 */ const waitForCalls = (count: number) => waitFor(() => calls.length >= count);
  /* 通过任务编号等待指定最终或中间状态。 */ const waitForStatus = (id: string, status: TaskStatus) => waitFor((state) => state.tasks.some((task) => task.id === id && task.status === status));
  /* 提交任务并返回其新生成的编号。 */ const start = (prompt: string) => manager.start(prompt).tasks[0].id;
  /* 暴露公开管理器和受控测试入口，不访问私有字段。 */ return { manager, calls, waitFor, waitForCalls, waitForStatus, start };
/* 结束调度器测试包装。 */ }
/* 创建唯一临时根目录并统一清理所有管理器。 */ async function fixture() {
  /* 记录解析后的临时父目录，清理前会再次核对。 */ const temporaryRoot = path.resolve(os.tmpdir());
  /* 为本测试分配独立且可识别的根目录。 */ const root = path.resolve(await mkdtemp(path.join(temporaryRoot, "electron-task-manager-test-")));
  /* 准备两个真实目录用于工作空间切换测试。 */ const workspaceA = path.join(root, "workspace-a");
  /* 第二目录和第一目录同属测试根目录。 */ const workspaceB = path.join(root, "workspace-b");
  /* 并行创建互不依赖的两个目录。 */ await Promise.all([mkdir(workspaceA), mkdir(workspaceB)]);
  /* 历史文件仅位于本测试创建的目录内。 */ const historyFile = path.join(root, "history", "tasks.json");
  /* 保存所有管理器，以便结束时停止任务和写入定时器。 */ const harnesses: ReturnType<typeof createHarness>[] = [];
  /* 创建管理器，恢复测试可指定同一历史文件。 */ const create = () => { const harness = createHarness(workspaceA, historyFile); harnesses.push(harness); return harness; };
  /* 关闭管理器并核实目录后再删除测试数据。 */ const cleanup = async () => {
    /* 逐个关闭管理器，防止清理后仍有延时历史写入。 */ for (const harness of harnesses) {
      /* close 会取消所有活跃任务、禁止调度并等待当前历史落盘。 */ await harness.manager.close();
      /* 即使执行器忽略取消，也让它成功结算，验证迟到结果路径并释放槽位。 */ for (const call of harness.calls) call.result.resolve("测试结束时清理执行器");
      /* 等待执行器 Promise 结算后，管理器才能清理对应控制器。 */ await Promise.all(harness.calls.map((call) => call.result.promise));
      /* 再等待一轮微任务，使 executeTask 的 finally 完成。 */ await Promise.resolve();
      /* 清除潜在的历史写入定时器并等待所有写入结束。 */ await harness.manager.flush();
    /* 结束各管理器的关闭清理。 */ }
    /* 确认删除目标仍然是先前记录的绝对路径。 */ assert.equal(path.resolve(root), root);
    /* 根目录必须直接属于系统临时目录。 */ assert.equal(path.dirname(root), temporaryRoot);
    /* 独特测试前缀进一步避免误删无关数据。 */ assert.ok(path.basename(root).startsWith("electron-task-manager-test-"));
    /* 确认历史文件位于本测试根目录内部而非其他目录。 */ const historyRelative = path.relative(root, path.resolve(historyFile));
    /* 拒绝任何上级跳转或其他磁盘路径。 */ assert.ok(historyRelative && !historyRelative.startsWith("..") && !path.isAbsolute(historyRelative));
    /* 删除已核验且由本测试创建的唯一临时根目录。 */ await rm(root, { recursive: true, force: true });
  /* 结束统一清理方法。 */ };
  /* 返回工作目录、历史位置和管理器创建方法。 */ return { workspaceA, workspaceB, historyFile, create, cleanup };
/* 结束测试环境工厂。 */ }
/* 检查两个实际执行槽和第三个排队任务，并验证排队取消不会执行。 */ test("两个任务并发，第三个排队；取消排队任务后不会调用执行器", { timeout: 5000 }, async () => {
  /* 创建隔离测试环境。 */ const data = await fixture();
  /* 无论断言是否成功都关闭管理器并清理磁盘。 */ try {
    /* 获取真实管理器和受控执行调用记录。 */ const harness = data.create();
    /* 同一轮事件循环提交三个任务，验证排队顺序。 */ const first = harness.start("first");
    /* 第二个任务应占用第二执行槽。 */ const second = harness.start("second");
    /* 第三个任务在槽位未释放时必须保持排队。 */ const third = harness.start("third");
    /* 以真实执行器调用次数确认前两个任务已启动。 */ await harness.waitForCalls(2);
    /* 调度顺序应是先到先执行。 */ assert.deepEqual(harness.calls.map((call) => call.input.prompt), ["first", "second"]);
    /* 第三个任务必须仍为 queued。 */ assert.equal(harness.manager.snapshot().tasks.find((task) => task.id === third)?.status, "queued");
    /* 取消排队任务，无需等待前两个任务结束。 */ harness.manager.cancel(third);
    /* 让第一个真实执行结果返回。 */ harness.calls[0].result.resolve("first answer");
    /* 等待第一个任务完成并执行后续调度。 */ await harness.waitForStatus(first, "completed");
    /* 第二个任务也按正常流程完成。 */ harness.calls[1].result.resolve("second answer");
    /* 等待第二个任务的完成状态。 */ await harness.waitForStatus(second, "completed");
    /* 被取消的第三个任务不能占用刚释放的槽位。 */ assert.equal(harness.calls.length, 2);
    /* 历史里应保留明确的取消状态。 */ assert.equal(harness.manager.snapshot().tasks.find((task) => task.id === third)?.status, "cancelled");
  /* 清理测试资源。 */ } finally { await data.cleanup(); }
/* 结束队列取消行为测试。 */ });
/* 检查取消后迟到事件和迟到答案都不能覆盖 cancelled，真实槽位也不能提前释放。 */ test("运行任务取消后忽略迟到结果，并等待执行器退出后才释放槽位", { timeout: 5000 }, async () => {
  /* 准备临时环境。 */ const data = await fixture();
  /* 保证管理器和文件会被清理。 */ try {
    /* 创建管理器。 */ const harness = data.create();
    /* 启动将被取消的第一个任务。 */ const first = harness.start("cancel-running");
    /* 第二个任务占用另一个槽位。 */ harness.start("keep-running");
    /* 第三个任务等待释放槽位。 */ const third = harness.start("queued-next");
    /* 等待前两个任务真正进入执行器。 */ await harness.waitForCalls(2);
    /* 在执行器仍未结算时请求取消。 */ harness.manager.cancel(first);
    /* 取消必须传到核心执行器收到的信号。 */ assert.equal(harness.calls[0].input.signal.aborted, true);
    /* 已显示取消的任务仍未实际退出，因此第三个任务不能提前运行。 */ assert.equal(harness.calls.length, 2);
    /* 队列状态应与实际槽位保持一致。 */ assert.equal(harness.manager.snapshot().tasks.find((task) => task.id === third)?.status, "queued");
    /* 模拟不遵守取消的执行器继续发送最终回答事件。 */ harness.calls[0].input.onEvent({ kind: "answer", message: "不应显示的迟到事件" });
    /* 模拟执行器忽略取消并返回成功答案。 */ harness.calls[0].result.resolve("不应保存的迟到答案");
    /* 只有执行器实际结算后，第三个任务才应开始。 */ await harness.waitForCalls(3);
    /* 第三个实际执行任务应是原来的队首。 */ assert.equal(harness.calls[2].input.prompt, "queued-next");
    /* 查看被取消任务的最新公开状态。 */ const cancelled = harness.manager.snapshot().tasks.find((task) => task.id === first)!;
    /* 迟到 Promise 不能把状态改回 completed。 */ assert.equal(cancelled.status, "cancelled");
    /* 迟到结果不能被写成任务答案。 */ assert.equal(cancelled.answer, undefined);
    /* 迟到事件也不能污染事件历史。 */ assert.ok(cancelled.events.every((event) => !event.message.includes("不应显示")));
  /* 统一取消剩余受控任务并清理数据。 */ } finally { await data.cleanup(); }
/* 结束运行中取消和槽位释放测试。 */ });
/* 检查真实落盘文件可以恢复已完成任务，并把中断任务标记取消而不自动续跑。 */ test("历史落盘恢复完成任务，运行中与排队任务恢复为 cancelled", { timeout: 5000 }, async () => {
  /* 创建独立历史目录。 */ const data = await fixture();
  /* 保证两个管理器都被关闭。 */ try {
    /* 创建写入历史的第一个管理器。 */ const original = data.create();
    /* 先提交一个可以正常完成的任务。 */ const completedId = original.start("completed-before-restart");
    /* 等待受控执行器开始。 */ await original.waitForCalls(1);
    /* 为完成任务发送一条可保存的工具日志。 */ original.calls[0].input.onEvent({ kind: "tool", message: "读取 README", detail: "真实执行结果的模拟数据" });
    /* 让该任务成功结束。 */ original.calls[0].result.resolve("应被恢复的完成答案");
    /* 等待管理器标记完成。 */ await original.waitForStatus(completedId, "completed");
    /* 再创建两个保持运行的任务。 */ const runningId = original.start("interrupted-running-a");
    /* 第二个运行任务填满剩余槽位。 */ original.start("interrupted-running-b");
    /* 第三个活跃任务因并发限制保持排队。 */ const queuedId = original.start("interrupted-queued");
    /* 完成任务加上两个新运行任务，总计三次实际执行调用。 */ await original.waitForCalls(3);
    /* 主动保存此时状态，模拟程序中断前最近一次历史快照。 */ await original.manager.flush();
    /* 从磁盘读取真实保存内容，确认 fixture 没有自行伪造状态。 */ const persisted = JSON.parse(await readFile(data.historyFile, "utf8")) as AppState["tasks"];
    /* 文件应确实包含一个运行中任务。 */ assert.equal(persisted.find((task) => task.id === runningId)?.status, "running");
    /* 文件也应包含一个排队任务。 */ assert.equal(persisted.find((task) => task.id === queuedId)?.status, "queued");
    /* 创建新的管理器模拟应用重新启动。 */ const restored = data.create();
    /* 从同一历史文件执行真实恢复逻辑。 */ await restored.manager.restore();
    /* 检查恢复后的公开快照。 */ const snapshot = restored.manager.snapshot();
    /* 已完成任务保留完成状态。 */ assert.equal(snapshot.tasks.find((task) => task.id === completedId)?.status, "completed");
    /* 已完成任务的答案仍然可查看。 */ assert.equal(snapshot.tasks.find((task) => task.id === completedId)?.answer, "应被恢复的完成答案");
    /* 工具日志也应被恢复。 */ assert.ok(snapshot.tasks.find((task) => task.id === completedId)?.events.some((event) => event.message === "读取 README"));
    /* 运行中任务不能在重启后被误认为仍在执行。 */ assert.equal(snapshot.tasks.find((task) => task.id === runningId)?.status, "cancelled");
    /* 排队任务同样不会自动重新执行。 */ assert.equal(snapshot.tasks.find((task) => task.id === queuedId)?.status, "cancelled");
    /* 重启中断原因应能直接给用户解释。 */ assert.match(snapshot.tasks.find((task) => task.id === runningId)?.error ?? "", /重启|中断/);
    /* 恢复历史绝不能主动调用执行器。 */ assert.equal(restored.calls.length, 0);
  /* 清理原管理器、恢复管理器和历史文件。 */ } finally { await data.cleanup(); }
/* 结束历史保存与恢复测试。 */ });
/* 检查任务绑定创建时的目录，包括尚未实际启动的排队任务。 */ test("切换工作目录只影响新任务，排队任务保留创建时目录", { timeout: 5000 }, async () => {
  /* 创建两个可切换的工作目录。 */ const data = await fixture();
  /* 确保测试结束后清理。 */ try {
    /* 初始工作目录为 A。 */ const harness = data.create();
    /* 在 A 目录下占用两个执行槽。 */ harness.start("a-first");
    /* 第二任务同样绑定 A。 */ harness.start("a-second");
    /* 第三个任务虽然尚未运行，也已经绑定 A。 */ const queuedA = harness.start("a-queued");
    /* 等待两个实际调用开始。 */ await harness.waitForCalls(2);
    /* 将后续任务默认目录切换到 B。 */ harness.manager.setWorkspace(data.workspaceB);
    /* 在切换后创建的新任务应绑定 B。 */ const queuedB = harness.start("b-queued");
    /* 查看任务快照，验证两个排队任务已经有各自固定目录。 */ const snapshot = harness.manager.snapshot();
    /* 已建任务保留原目录 A。 */ assert.equal(snapshot.tasks.find((task) => task.id === queuedA)?.workspacePath, data.workspaceA);
    /* 新建任务记录目录 B。 */ assert.equal(snapshot.tasks.find((task) => task.id === queuedB)?.workspacePath, data.workspaceB);
    /* 释放第一个槽位，让最早排队的 A 任务运行。 */ harness.calls[0].result.resolve("a-first done");
    /* 等待第三个真正执行调用。 */ await harness.waitForCalls(3);
    /* 实际传给核心的目录仍然是 A，而不是当前默认目录 B。 */ assert.equal(harness.calls[2].input.workspacePath, data.workspaceA);
    /* 释放第二个原任务的槽位。 */ harness.calls[1].result.resolve("a-second done");
    /* 等待后创建的 B 任务开始。 */ await harness.waitForCalls(4);
    /* 执行顺序和输入都应对应新建的 B 任务。 */ assert.equal(harness.calls[3].input.prompt, "b-queued");
    /* 核心实际接收到目录 B。 */ assert.equal(harness.calls[3].input.workspacePath, data.workspaceB);
  /* 关闭未完成的模拟任务并清理。 */ } finally { await data.cleanup(); }
/* 结束工作目录隔离测试。 */ });
/* 验证 IPC 运行时输入、活跃任务上限和快照深拷贝边界。 */ test("校验输入、限制八个活跃任务，并隔离快照外部修改", { timeout: 5000 }, async () => {
  /* 创建隔离环境。 */ const data = await fixture();
  /* 使用 finally 统一清理资源。 */ try {
    /* 创建真实管理器。 */ const harness = data.create();
    /* 对非字符串、空白和过长输入逐一检查。 */ for (const invalid of [null, 123, "   ", "x".repeat(2001)]) assert.throws(() => harness.manager.start(invalid), /1—2000/);
    /* 无效请求不应留下任务记录。 */ assert.equal(harness.manager.snapshot().tasks.length, 0);
    /* 创建允许的最大活跃任务数量。 */ const ids = Array.from({ length: 8 }, (_, index) => harness.start(`bounded-${index}`));
    /* 第九个活跃任务必须明确拒绝。 */ assert.throws(() => harness.start("overflow"), /8 个待处理/);
    /* 不合法取消参数也应在入口被拒绝。 */ assert.throws(() => harness.manager.cancel(123), /编号不合法/);
    /* 取消尚未开始的最后任务，释放一个活跃记录名额。 */ harness.manager.cancel(ids[7]);
    /* 取消之后允许用户重新提交任务。 */ const replacement = harness.start("replacement");
    /* 获取可以由 UI 自由读取的快照。 */ const copy = harness.manager.snapshot();
    /* 故意修改快照字段模拟不可信调用方。 */ copy.tasks.find((task) => task.id === replacement)!.prompt = "external mutation";
    /* 清空快照中的任务数组。 */ copy.tasks.length = 0;
    /* 管理器内部记录不得跟着外部快照被改变。 */ assert.equal(harness.manager.snapshot().tasks.find((task) => task.id === replacement)?.prompt, "replacement");
    /* 等待两个任务真正运行后检查硬并发上限。 */ await harness.waitForCalls(2);
    /* 无论队列多长都只能启动两个执行器。 */ assert.equal(harness.calls.length, 2);
    /* 关闭后应拒绝继续接受任务。 */ await harness.manager.close();
    /* 退出阶段输入不能再创建排队记录。 */ assert.throws(() => harness.start("after-close"), /退出/);
  /* 处理未结算执行器并清理文件。 */ } finally { await data.cleanup(); }
/* 结束输入、容量和快照隔离测试。 */ });
