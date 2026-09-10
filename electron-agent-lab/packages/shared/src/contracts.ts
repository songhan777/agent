/* 定义可选择的执行模式；demo 完全离线，openai 使用用户自行配置的模型。 */ export type RunMode = "demo" | "openai";
/* 用联合类型限制任务状态，避免界面和后台使用不一致的字符串。 */ export type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
/* 区分状态、工具、回答、错误和说明事件，供界面采用不同展示方式。 */ export type EventKind = "status" | "tool" | "answer" | "error" | "info";
/* 定义一条可跨 IPC 传输的日志；它只包含可以序列化的数据。 */ export interface TaskEvent {
  /* 使用唯一编号作为 React 列表键，也方便追踪单条事件。 */ id: string;
  /* 记录事件所属任务，避免并发任务的消息混在一起。 */ taskId: string;
  /* 使用 ISO 时间字符串，方便存储和跨进程传输。 */ timestamp: string;
  /* 告诉界面这条事件属于哪一类。 */ kind: EventKind;
  /* 保存用户能够直接理解的简短说明。 */ message: string;
  /* 可选地保存工具输出等展开后阅读的细节。 */ detail?: string;
/* 结束单条任务事件的定义。 */ }
/* 定义任务的完整快照；控制器和 API Key 不会出现在这个公开类型中。 */ export interface TaskSnapshot {
  /* 保存任务的唯一编号。 */ id: string;
  /* 保存创建任务时的用户问题。 */ prompt: string;
  /* 固定任务创建时的工作目录，不随界面后续选择变化。 */ workspacePath: string;
  /* 标记本任务使用的模型模式。 */ mode: RunMode;
  /* 保存当前执行状态。 */ status: TaskStatus;
  /* 保存任务创建时间。 */ createdAt: string;
  /* 保存最近一次状态或日志更新时间。 */ updatedAt: string;
  /* 保存有限数量的日志，用于回放执行过程。 */ events: TaskEvent[];
  /* 成功结束后保存回答，执行期间可以不存在。 */ answer?: string;
  /* 失败结束后保存错误说明。 */ error?: string;
/* 结束任务快照定义。 */ }
/* 定义页面启动时读取以及每次更新时接收的应用快照。 */ export interface AppState {
  /* 每次变更递增，帮助页面忽略比当前状态更旧的异步响应。 */ revision: number;
  /* 保存当前为新任务选择的工作目录。 */ workspacePath: string;
  /* 告诉用户当前使用离线演示还是真实模型。 */ mode: RunMode;
  /* 仅展示模型名称；离线模式中为 null。 */ model: string | null;
  /* 告诉页面同时运行任务的上限。 */ maxConcurrent: number;
  /* 保存从新到旧排列的任务快照。 */ tasks: TaskSnapshot[];
/* 结束应用快照定义。 */ }
/* 定义 preload 允许页面调用的全部能力，不暴露原始 ipcRenderer。 */ export interface DesktopBridge {
  /* 读取当前完整状态。 */ getState(): Promise<AppState>;
  /* 打开系统目录选择框，返回选择完成后的状态。 */ selectWorkspace(): Promise<AppState>;
  /* 使用当前目录创建一个新任务，并返回排队后的状态。 */ startTask(prompt: string): Promise<AppState>;
  /* 取消指定任务；具体中断由后台的 AbortController 完成。 */ cancelTask(taskId: string): Promise<AppState>;
  /* 订阅状态广播并返回取消订阅函数，供 React 在卸载时清理。 */ onState(listener: (state: AppState) => void): () => void;
/* 结束页面能力接口定义。 */ }
/* 把 IPC 通道集中管理，让主进程和 preload 共用相同名称。 */ export const CHANNELS = {
  /* 用于读取状态的请求通道。 */ state: "lab:get-state",
  /* 用于选择目录的请求通道。 */ workspace: "lab:select-workspace",
  /* 用于创建任务的请求通道。 */ start: "lab:start-task",
  /* 用于取消任务的请求通道。 */ cancel: "lab:cancel-task",
  /* 用于主进程向页面广播状态的事件通道。 */ changed: "lab:state-changed",
/* 保留通道字符串字面量类型，防止被意外改写。 */ } as const;
