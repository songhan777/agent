/* 使用系统随机编号区分并发任务和日志。 */ import { randomUUID } from "node:crypto";
/* 使用异步文件接口保存历史，避免同步文件操作阻塞主进程。 */ import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
/* 使用跨平台路径工具定位历史文件目录。 */ import path from "node:path";
/* 复用不依赖 Electron 的 Agent 执行逻辑。 */ import { runAgent } from "../../../../packages/core/src/index";
/* 只导入类型，避免把不需要的模块加入运行时代码。 */ import type { AppState, EventKind, RunMode, TaskEvent, TaskSnapshot } from "../../../../packages/shared/src/contracts";
/* 定义控制器的初始化参数，便于在测试中替换执行器。 */ export interface ManagerOptions {
  /* 指定首次启动时的演示工作目录。 */ workspacePath: string;
  /* 指定历史文件的保存位置。 */ historyFile: string;
  /* 指定离线或真实模型模式。 */ mode: RunMode;
  /* 真实模式需要用户指定模型名称。 */ model?: string;
  /* API Key 只留在主进程，绝不进入界面快照。 */ apiKey?: string;
  /* 状态更新时由主进程向界面广播。 */ onChange: (state: AppState) => void;
  /* 测试可以传入受控执行器，无需等待真实模型。 */ execute?: typeof runAgent;
/* 结束初始化参数定义。 */ }
/* 用有限容量的内存队列实现教学任务调度。 */ export class TaskManager {
  /* 保存从新到旧排列的任务记录。 */ private tasks: TaskSnapshot[] = [];
  /* 每个正在执行的任务拥有独立的取消控制器。 */ private controllers = new Map<string, AbortController>();
  /* 所有界面快照使用递增版本，避免异步响应倒退状态。 */ private revision = 0;
  /* 暂存新任务默认使用的目录。 */ private workspacePath: string;
  /* 合并短时间内连续出现的历史写入。 */ private saveTimer: ReturnType<typeof setTimeout> | undefined;
  /* 串行执行磁盘写入，避免临时文件被并发覆盖。 */ private saving: Promise<void> = Promise.resolve();
  /* 关闭时阻止新任务启动。 */ private closing = false;
  /* 固定两个并发槽，方便观察排队和任务隔离。 */ readonly maxConcurrent = 2;
  /* 创建管理器并记住默认目录。 */ constructor(private readonly options: ManagerOptions) { this.workspacePath = options.workspacePath; }
  /* 启动时恢复有限且经过校验的历史记录。 */ async restore(): Promise<void> {
    /* 历史缺失或损坏不应阻止首次打开应用。 */ try {
      /* 读取 JSON 文件；磁盘数据同样不能直接信任。 */ const data: unknown = JSON.parse(await readFile(this.options.historyFile, "utf8"));
      /* 只处理预期的数组结构。 */ if (!Array.isArray(data)) return;
      /* 限制历史条数并检查每条记录的关键字段。 */ this.tasks = data.filter(isSavedTask).slice(0, 20).map((task) => {
        /* 重启不能自动继续上次未完成的文件或模型操作。 */ const interrupted = task.status === "running" || task.status === "queued";
        /* 清理旧的日志数量，并把中断任务标记为取消。 */ return { ...task, events: task.events.filter(isSavedEvent).slice(-80), status: interrupted ? "cancelled" : task.status, error: interrupted ? "应用已重启；上次任务被中断，可重新提交。" : task.error };
      /* 结束历史转换。 */ });
    /* 只在文件存在但无效时输出本地诊断，不打印密钥。 */ } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn("历史记录无法恢复，将创建新记录。"); }
  /* 结束历史恢复方法。 */ }
  /* 返回深拷贝，避免调用者修改管理器内部对象。 */ snapshot(): AppState {
    /* 只返回公开字段；控制器、执行器和密钥不会被序列化。 */ return structuredClone({ revision: this.revision, workspacePath: this.workspacePath, mode: this.options.mode, model: this.options.model ?? null, maxConcurrent: this.maxConcurrent, tasks: this.tasks });
  /* 结束快照生成方法。 */ }
  /* 修改后续任务的默认目录，已经创建的任务保持原来的目录。 */ setWorkspace(workspacePath: string): AppState { this.workspacePath = workspacePath; this.publish(); return this.snapshot(); }
  /* 验证输入并立即建立排队记录。 */ start(prompt: unknown): AppState {
    /* 关闭阶段拒绝新工作。 */ if (this.closing) throw new Error("应用正在退出，请稍后重新启动。");
    /* IPC 输入必须运行时校验，TypeScript 无法检查进程外的数据。 */ if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 2000) throw new Error("请输入 1—2000 个字符的任务。");
    /* 防止连续点击或异常页面创建无界队列。 */ if (this.tasks.filter((task) => task.status === "queued" || task.status === "running").length >= 8) throw new Error("最多保留 8 个待处理任务，请等待或取消后重试。");
    /* 为创建时间和最近更新时间使用同一个初始值。 */ const now = new Date().toISOString();
    /* 固定本任务的目录与模式，确保任务之间互不串用。 */ const task: TaskSnapshot = { id: randomUUID(), prompt: prompt.trim(), workspacePath: this.workspacePath, mode: this.options.mode, status: "queued", createdAt: now, updatedAt: now, events: [] };
    /* 把最新任务放到列表顶部。 */ this.tasks.unshift(task);
    /* 保留全部活跃任务，以及足够的近期已结束任务。 */ this.tasks = this.tasks.filter((item, index) => index < 20 || item.status === "queued" || item.status === "running");
    /* 记录排队事件并通知页面。 */ this.event(task, "status", "任务已进入队列");
    /* 等当前 IPC 响应返回后再开始执行，保持交互及时。 */ queueMicrotask(() => this.pump());
    /* 返回排队后的完整状态。 */ return this.snapshot();
  /* 结束创建任务方法。 */ }
  /* 请求取消运行中或排队中的任务。 */ cancel(taskId: unknown): AppState {
    /* 校验任务编号的类型，避免不合法 IPC 数据继续传播。 */ if (typeof taskId !== "string" || taskId.length > 100) throw new Error("任务编号不合法。");
    /* 在当前历史里查找目标任务。 */ const task = this.tasks.find((item) => item.id === taskId);
    /* 取消已结束或不存在的任务不会产生副作用。 */ if (!task || (task.status !== "running" && task.status !== "queued")) return this.snapshot();
    /* 先标记取消，让后续异步结果不能覆盖该状态。 */ task.status = "cancelled";
    /* 把取消信号传入模型请求和文件工具。 */ this.controllers.get(task.id)?.abort();
    /* 页面明确展示取消请求的效果。 */ this.event(task, "status", "任务已取消；不再启动后续步骤");
    /* 尝试安排尚未开始的其他任务。 */ this.pump();
    /* 返回最新快照供按钮响应使用。 */ return this.snapshot();
  /* 结束取消方法。 */ }
  /* 在并发上限内按先到先执行的顺序调度。 */ private pump(): void {
    /* 退出中不能开启新任务。 */ if (this.closing) return;
    /* 控制器数量表示真正还没有释放的执行槽。 */ while (this.controllers.size < this.maxConcurrent) {
      /* 从较旧任务开始查找，避免新任务插队。 */ const next = [...this.tasks].reverse().find((task) => task.status === "queued");
      /* 没有待执行任务时停止调度。 */ if (!next) break;
      /* 创建独立取消控制器。 */ const controller = new AbortController();
      /* 先占用槽位，避免同步重入超过上限。 */ this.controllers.set(next.id, controller);
      /* 后续 Promise 由 executeTask 内部处理错误。 */ void this.executeTask(next, controller);
    /* 结束调度循环。 */ }
  /* 结束调度方法。 */ }
  /* 执行一个任务，并在所有退出路径释放资源。 */ private async executeTask(task: TaskSnapshot, controller: AbortController): Promise<void> {
    /* 把排队状态变为运行状态。 */ task.status = "running";
    /* 记录执行开始。 */ this.event(task, "status", "正在执行任务");
    /* 捕获模型或文件系统错误，避免未处理的 Promise 拒绝。 */ try {
      /* 使用公共 Agent 核心；测试时可以替换成确定性的执行器。 */ const answer = await (this.options.execute ?? runAgent)({ workspacePath: task.workspacePath, prompt: task.prompt, mode: task.mode, model: this.options.model, apiKey: this.options.apiKey, signal: controller.signal, onEvent: (event) => { if (!controller.signal.aborted) this.event(task, event.kind, event.message, event.detail); } });
      /* 已取消任务不能因迟到的结果重新变成成功。 */ if (!controller.signal.aborted) {
        /* 保存核心返回的最终结果。 */ task.answer = answer;
        /* 标记任务完成。 */ task.status = "completed";
        /* 广播结束状态。 */ this.event(task, "status", "任务已完成");
      /* 结束成功结果处理。 */ }
    /* 将错误转换成用户可以理解的任务状态。 */ } catch (error) {
      /* 取消引起的异常不应被标成模型失败。 */ task.status = controller.signal.aborted ? "cancelled" : "failed";
      /* 保存有限长度的错误说明。 */ task.error = controller.signal.aborted ? "任务已取消。" : error instanceof Error ? error.message.slice(0, 500) : "发生未知错误。";
      /* 记录失败或取消事件。 */ this.event(task, controller.signal.aborted ? "status" : "error", task.error);
    /* 不论成功、失败或取消，都释放并发槽。 */ } finally {
      /* 移除本任务的控制器，避免资源泄漏。 */ this.controllers.delete(task.id);
      /* 让队列中的下一个任务继续执行。 */ this.pump();
    /* 结束资源清理。 */ }
  /* 结束单任务执行方法。 */ }
  /* 为任务追加一条有限大小的日志。 */ private event(task: TaskSnapshot, kind: EventKind, message: string, detail?: string): void {
    /* 统一事件时间与任务更新时间。 */ const timestamp = new Date().toISOString();
    /* 限制日志正文长度，避免大文件内容挤满历史。 */ task.events.push({ id: randomUUID(), taskId: task.id, timestamp, kind, message: message.slice(0, 1000), ...(detail ? { detail: detail.slice(0, 8000) } : {}) });
    /* 每个任务仅保存最近 80 条事件。 */ task.events = task.events.slice(-80);
    /* 保存最近更新时间。 */ task.updatedAt = timestamp;
    /* 把变化广播给界面并安排落盘。 */ this.publish();
  /* 结束日志方法。 */ }
  /* 通知页面状态发生变化，并合并磁盘写入。 */ private publish(): void {
    /* 增加状态版本号。 */ this.revision += 1;
    /* 将深拷贝传给主进程的广播回调。 */ this.options.onChange(this.snapshot());
    /* 清除上一轮待执行的写入定时器。 */ clearTimeout(this.saveTimer);
    /* 150 毫秒内的连续日志合并成一次落盘。 */ this.saveTimer = setTimeout(() => { this.saveTimer = undefined; void this.flush(); }, 150);
  /* 结束状态广播方法。 */ }
  /* 立即保存当前历史；写入采用串行队列和临时文件替换。 */ async flush(): Promise<void> {
    /* 防止之后又出现重复的定时保存。 */ clearTimeout(this.saveTimer);
    /* 清空定时器引用。 */ this.saveTimer = undefined;
    /* 在排入保存队列前固定本次快照。 */ const json = JSON.stringify(this.tasks, null, 2);
    /* 串行写入，保证文件版本的顺序。 */ this.saving = this.saving.then(async () => {
      /* 创建首次启动时可能不存在的数据目录。 */ await mkdir(path.dirname(this.options.historyFile), { recursive: true });
      /* 临时文件与目标文件放在同一目录，便于替换。 */ const temporary = `${this.options.historyFile}.tmp`;
      /* 先完成临时文件写入，避免直接截断已有历史。 */ await writeFile(temporary, json, "utf8");
      /* 用新文件替换旧历史。 */ await rename(temporary, this.options.historyFile);
    /* 磁盘异常打印诊断，但不让后续保存队列永久失效。 */ }).catch(() => { console.warn("历史记录保存失败，请检查用户数据目录权限或磁盘空间。"); });
    /* 等待本次以及排在它前面的保存完成。 */ await this.saving;
  /* 结束历史落盘方法。 */ }
  /* 退出时停止所有任务并保存取消后的状态。 */ async close(): Promise<void> {
    /* 禁止 pump 创建新的执行任务。 */ this.closing = true;
    /* 遍历当前任务，让取消逻辑保持一致。 */ for (const task of this.tasks) this.cancel(task.id);
    /* 在退出前尽可能保存当前记录。 */ await this.flush();
  /* 结束关闭方法。 */ }
/* 结束任务管理器类。 */ }
/* 校验恢复日志的关键字段，避免损坏的数据使界面崩溃。 */ function isSavedEvent(value: unknown): value is TaskEvent {
  /* 先确认数据是普通的非空对象。 */ if (!value || typeof value !== "object") return false;
  /* 使用记录类型检查具体字段。 */ const item = value as Record<string, unknown>;
  /* 只接受契约规定的字段类型和事件种类。 */ return typeof item.id === "string" && typeof item.taskId === "string" && typeof item.timestamp === "string" && typeof item.message === "string" && ["status", "tool", "answer", "error", "info"].includes(String(item.kind)) && (item.detail === undefined || typeof item.detail === "string");
/* 结束事件校验方法。 */ }
/* 校验历史任务，过滤无效或不兼容的存储数据。 */ function isSavedTask(value: unknown): value is TaskSnapshot {
  /* 拒绝空值和非对象。 */ if (!value || typeof value !== "object") return false;
  /* 将未知对象转成可检查的字段映射。 */ const item = value as Record<string, unknown>;
  /* 检查界面依赖的必要字段与枚举值。 */ return typeof item.id === "string" && typeof item.prompt === "string" && typeof item.workspacePath === "string" && typeof item.createdAt === "string" && typeof item.updatedAt === "string" && ["demo", "openai"].includes(String(item.mode)) && ["queued", "running", "completed", "failed", "cancelled"].includes(String(item.status)) && Array.isArray(item.events) && (item.answer === undefined || typeof item.answer === "string") && (item.error === undefined || typeof item.error === "string");
/* 结束历史任务校验方法。 */ }
