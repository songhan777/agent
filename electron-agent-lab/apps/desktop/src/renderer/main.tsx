/* 导入 React 的创建元素方法、Hooks 和事件类型，使用普通函数调用让每行中文注释都保持合法。 */ import { createElement as h, useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
/* 导入 React 的桌面页面挂载入口。 */ import { createRoot } from "react-dom/client";
/* 只导入共享类型，避免将主进程或工具执行代码打包进页面。 */ import type { AppState, DesktopBridge, TaskEvent, TaskSnapshot, TaskStatus } from "../../../../packages/shared/src/contracts";
/* 引入仅负责展示的页面样式。 */ import "./styles.css";
/* 扩展浏览器全局类型；这个声明不会在运行时创建桥接对象。 */ declare global {
  /* 声明 preload 可以向当前窗口提供的受限接口。 */ interface Window {
    /* 使用可选属性，让直接打开浏览器时能够显示明确的启动提示。 */ desktop?: DesktopBridge;
  /* 结束窗口属性声明。 */ }
/* 结束全局类型扩展。 */ }
/* 将后台状态转换成用户能够读懂的中文标签。 */ const STATUS_LABEL: Record<TaskStatus, string> = { queued: "排队中", running: "执行中", completed: "已完成", failed: "失败", cancelled: "已取消" };
/* 给事件类型提供稳定的中文标题，界面不直接展示英文枚举。 */ const EVENT_LABEL: Record<TaskEvent["kind"], string> = { status: "任务状态", tool: "工具调用", answer: "生成回答", error: "执行错误", info: "执行说明" };
/* 保存两个可直接填入输入框的练习问题。 */ const EXAMPLES = ["概览项目结构", "搜索 TODO"];
/* 把未知异常转为可展示的文字，避免直接把对象交给 React。 */ function errorMessage(error: unknown): string {
  /* 优先使用标准 Error 的消息，否则转换为普通字符串。 */ return error instanceof Error ? error.message : String(error);
/* 结束异常转换函数。 */ }
/* 只在显示阶段格式化时间，后台仍保留可跨进程传输的 ISO 字符串。 */ function timeLabel(value: string): string {
  /* 使用中文地区的小时和分钟格式展示事件发生时间。 */ return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
/* 结束时间显示函数。 */ }
/* 提取路径最后一段作为目录标题，同时兼容 Windows 与 POSIX 分隔符。 */ function directoryName(value: string): string {
  /* 根路径没有最后一段时保留原始路径，未选择时使用提示文字。 */ return value.split(/[\\/]/).filter(Boolean).at(-1) ?? (value || "尚未选择目录");
/* 结束目录名称函数。 */ }
/* 用一个小组件统一任务状态的颜色、文本与运行中指示器。 */ function StatusBadge({ status }: { status: TaskStatus }) {
  /* 根据后台状态生成样式名，不在页面推测任务是否成功。 */ return h("span", { className: `status-badge status-${status}` },
    /* 显示状态圆点；它是装饰元素，不重复提供给读屏软件。 */ h("span", { className: "status-dot", "aria-hidden": true }),
    /* 显示共享状态对应的中文含义。 */ STATUS_LABEL[status],
  /* 结束状态标签元素。 */ );
/* 结束状态标签组件。 */ }
/* 渲染左侧的一项历史任务，并通过点击回调切换当前详情。 */ function TaskCard({ task, selected, onSelect }: { task: TaskSnapshot; selected: boolean; onSelect: () => void }) {
  /* 原生按钮自动支持键盘操作，aria-pressed 告诉辅助技术是否已选中。 */ return h("button", { type: "button", className: `task-card${selected ? " selected" : ""}`, onClick: onSelect, "aria-pressed": selected },
    /* 第一行展示执行状态和创建时间。 */ h("span", { className: "task-meta" }, h(StatusBadge, { status: task.status }), h("time", { dateTime: task.createdAt }, timeLabel(task.createdAt))),
    /* 使用完整问题作为标题属性，让截断后的任务名称仍可查看。 */ h("span", { className: "task-title", title: task.prompt }, task.prompt),
    /* 展示任务创建时固定的目录，而不是当前新任务所用的目录。 */ h("span", { className: "task-directory", title: task.workspacePath }, directoryName(task.workspacePath)),
  /* 结束任务按钮。 */ );
/* 结束历史任务组件。 */ }
/* 渲染单条执行事件；详情始终作为纯文本处理。 */ function EventCard({ event, index }: { event: TaskEvent; index: number }) {
  /* 每种事件使用独立的样式名，错误事件有更清楚的视觉提示。 */ return h("article", { className: `event-card event-${event.kind}` },
    /* 用序号表达执行顺序，避免依赖图标才能理解日志。 */ h("span", { className: "event-index", "aria-hidden": true }, String(index + 1).padStart(2, "0")),
    /* 把内容和序号分成两列，长文本可以正常换行。 */ h("div", { className: "event-body" },
      /* 展示事件分类及时间，便于回溯任务步骤。 */ h("div", { className: "event-meta" }, h("span", null, EVENT_LABEL[event.kind]), h("time", { dateTime: event.timestamp }, timeLabel(event.timestamp))),
      /* 直接显示后台事件文字，React 自动转义其中的 HTML。 */ h("p", { className: "event-message" }, event.message),
      /* 工具输出默认折叠，避免大型结果挤占主要工作区域。 */ event.detail ? h("details", { className: "event-details" },
        /* 原生 details/summary 支持键盘展开和关闭。 */ h("summary", null, "查看执行详情"),
        /* 使用 pre 保留缩进；禁止通过 innerHTML 渲染工具返回内容。 */ h("pre", null, event.detail),
      /* 没有详情时不创建空白容器。 */ ) : null,
    /* 结束事件正文。 */ ),
  /* 结束事件卡片。 */ );
/* 结束事件组件。 */ }
/* 用紧凑的侧栏解释真实代码中的进程边界。 */ function LearningPanel() {
  /* 学习提示只展示说明，不参与权限判断或任务调度。 */ return h("aside", { className: "learning-panel", "aria-label": "架构学习提示" },
    /* 展示固定的栏目标识。 */ h("p", { className: "eyebrow" }, "LEARNING NOTES"),
    /* 给读者一个与当前界面相关的学习入口。 */ h("h2", null, "一次任务，经过哪里？"),
    /* 用有序列表呈现从页面到工具的真实调用链。 */ h("ol", { className: "boundary-list" },
      /* 页面只负责输入和显示，没有直接读取文件的权限。 */ h("li", null, h("strong", null, "React 页面"), h("span", null, "收集问题，展示任务快照。"), h("code", null, "renderer/main.tsx")),
      /* preload 只暴露约定好的桥接方法。 */ h("li", null, h("strong", null, "Preload 桥接"), h("span", null, "通过受限接口发送 IPC 请求。"), h("code", null, "window.desktop")),
      /* 主进程拥有任务状态，并安排后台执行。 */ h("li", null, h("strong", null, "Electron 主进程"), h("span", null, "校验输入，排队、取消与广播。"), h("code", null, "startTask → onState")),
      /* 工具层执行受限的本地操作，将真实结果返回给 Agent。 */ h("li", null, h("strong", null, "Agent 与工具"), h("span", null, "在所选目录中读取、搜索文件。"), h("code", null, "工具结果 → 任务事件")),
    /* 结束调用链列表。 */ ),
    /* 给出可以在源码中验证的状态同步知识点。 */ h("div", { className: "learning-note" }, h("strong", null, "本页的学习重点"), h("p", null, "任务状态由后台决定。页面用 revision 忽略迟到的旧快照，并在卸载时清理事件订阅。")),
    /* 指出这个模板当前演示的操作边界。 */ h("p", { className: "learning-footnote" }, "先观察一次执行，再对照逐行注释阅读代码。"),
  /* 结束学习侧栏。 */ );
/* 结束学习提示组件。 */ }
/* 应用根组件协调受限桥接、快照状态以及页面操作。 */ function App() {
  /* 读取 preload 提供的接口；普通浏览器中该值为空。 */ const bridge = window.desktop;
  /* 保存后台完整快照，null 表示尚未获取成功。 */ const [state, setState] = useState<AppState | null>(null);
  /* 保存当前正在查看的任务编号，不把选中状态写入后台任务。 */ const [selectedId, setSelectedId] = useState<string | null>(null);
  /* 保存用户尚未提交的问题。 */ const [prompt, setPrompt] = useState("");
  /* 保存界面操作产生的错误，不篡改任务自身的失败状态。 */ const [actionError, setActionError] = useState<string | null>(null);
  /* 使用不同标识说明当前等待的是读取、选目录、提交还是取消。 */ const [pending, setPending] = useState<string | null>("loading");
  /* 记录组件是否仍然挂载，避免异步操作完成后继续更新已经卸载的页面。 */ const mounted = useRef(false);
  /* 保存输入框节点，以便快捷问题被填入后立即获得焦点。 */ const inputRef = useRef<HTMLTextAreaElement>(null);
  /* 同步锁阻止状态重新渲染前的连续点击发起重复请求。 */ const actionLock = useRef(false);
  /* 稳定的快照接收函数同时供事件订阅和请求响应调用。 */ const acceptState = useCallback((next: AppState) => {
    /* 组件卸载后丢弃迟到的异步结果。 */ if (!mounted.current) return;
    /* 仅采用不早于当前版本的快照，防止请求响应覆盖更新的事件广播。 */ setState((current) => current && current.revision > next.revision ? current : next);
  /* 快照处理不捕获变化中的状态，因此无需依赖具体 revision。 */ }, []);
  /* 在挂载时先订阅广播，再读取初始状态，减少启动期间丢失更新的可能。 */ useEffect(() => {
    /* 标记当前页面已经挂载。 */ mounted.current = true;
    /* 没有 preload 时停止初始化，交给下方的明确启动提示。 */ if (!bridge) return () => { mounted.current = false; };
    /* 保存取消订阅函数，React 卸载时会执行它。 */ const unsubscribe = bridge.onState(acceptState);
    /* 获取启动快照，并将初始化错误呈现给用户。 */ void bridge.getState().then(acceptState).catch((error: unknown) => { if (mounted.current) setActionError(errorMessage(error)); }).finally(() => { if (mounted.current) setPending(null); });
    /* 清理订阅并禁止后续异步回调更新页面。 */ return () => { mounted.current = false; unsubscribe(); };
  /* 仅在桥接引用或稳定快照函数变化时重新订阅。 */ }, [bridge, acceptState]);
  /* 把共用的等待、错误处理和重复点击保护集中到一个函数。 */ async function perform(label: string, operation: () => Promise<AppState>, selectNewTask = false): Promise<void> {
    /* 在按钮禁用状态生效前，也阻止第二次操作进入。 */ if (actionLock.current) return;
    /* 为本次操作持有同步锁。 */ actionLock.current = true;
    /* 设置等待标识，界面会显示相应的进行中文字。 */ setPending(label);
    /* 新操作开始时清除上一次界面错误。 */ setActionError(null);
    /* 记录提交前的任务编号，用来识别新创建的任务。 */ const previousIds = new Set(state?.tasks.map((task) => task.id) ?? []);
    /* 捕获 IPC 请求可能返回的异常，避免未处理的 Promise 拒绝。 */ try {
      /* 等待主进程操作完成并返回完整快照。 */ const next = await operation();
      /* 组件已经卸载时不再继续处理返回结果。 */ if (!mounted.current) return;
      /* 按 revision 合并响应，迟到的旧响应不会倒退界面状态。 */ acceptState(next);
      /* 创建成功后切换到本次响应中出现的新任务。 */ if (selectNewTask) {
        /* 根据提交前的编号集合识别新任务，而不是依赖界面当前选择。 */ const newTask = next.tasks.find((task) => !previousIds.has(task.id));
        /* 存在新任务时将它选中，方便立即查看执行过程。 */ if (newTask) setSelectedId(newTask.id);
        /* 只有成功创建后才清空输入，失败时保留用户问题。 */ setPrompt("");
      /* 结束创建任务后的界面处理。 */ }
    /* 将错误转为可见的提示，不把操作失败伪装成任务完成。 */ } catch (error: unknown) {
      /* 只在仍然挂载的页面中显示错误。 */ if (mounted.current) setActionError(errorMessage(error));
    /* 无论成功失败都释放界面操作锁。 */ } finally {
      /* 允许下一次点击发起新操作。 */ actionLock.current = false;
      /* 清除等待标识，使相应按钮恢复可用。 */ if (mounted.current) setPending(null);
    /* 结束异步操作保护。 */ }
  /* 结束公共操作函数。 */ }
  /* 表单提交同时支持鼠标按钮和输入框快捷键。 */ function submit(event?: FormEvent): void {
    /* 阻止原生表单刷新页面，以保留桌面任务状态。 */ event?.preventDefault();
    /* 校验桥接、快照、目录和问题，避免提交不完整任务。 */ if (!bridge || !state?.workspacePath || !prompt.trim() || pending) return;
    /* 将用户问题交给主进程创建任务，页面不直接运行模型或文件工具。 */ void perform("start", () => bridge.startTask(prompt.trim()), true);
  /* 结束提交处理函数。 */ }
  /* 普通浏览器中明确提示正确入口，避免构造虚假的桌面 API。 */ if (!bridge) return h("main", { className: "startup-screen" },
    /* 用与正式页面一致的品牌块建立清楚的应用身份。 */ h("div", { className: "brand-mark", "aria-hidden": true }, "A"),
    /* 标明当前页面缺少真实桌面环境。 */ h("p", { className: "eyebrow" }, "ELECTRON AGENT LAB"),
    /* 用直接的中文解释为什么此页面不能操作本地文件。 */ h("h1", null, "请使用桌面启动命令"),
    /* 明确指出浏览器页面没有 preload 桥接。 */ h("p", null, "当前页面没有 Electron 提供的 window.desktop 接口。"),
    /* 提示从项目根目录运行 README 中的启动步骤。 */ h("p", null, "请在项目根目录按照 README.md 启动桌面应用；该网页入口仅用于检查页面构建。"),
  /* 结束浏览器启动提示。 */ );
  /* 在收到初始快照前显示真实加载状态，并提供失败重试。 */ if (!state) return h("main", { className: "startup-screen" },
    /* 加载页沿用统一的应用标识。 */ h("div", { className: "brand-mark", "aria-hidden": true }, "A"),
    /* 区分正常读取与已经失败的读取过程。 */ h("h1", null, actionError ? "暂时无法读取应用状态" : "正在连接桌面工作区…"),
    /* 展示具体初始化错误，或说明当前等待内容。 */ h("p", { role: actionError ? "alert" : "status" }, actionError ?? "正在通过 preload 获取主进程快照。"),
    /* 初始化失败后仍可重试，不要求用户立即重启整个应用。 */ actionError ? h("button", { className: "button primary", type: "button", disabled: Boolean(pending), onClick: () => { void perform("loading", () => bridge.getState()); } }, pending ? "正在重试…" : "重新读取") : null,
  /* 结束初始状态页面。 */ );
  /* 优先显示用户选中的任务，否则显示最近创建的一项。 */ const selected = state.tasks.find((task) => task.id === selectedId) ?? state.tasks[0] ?? null;
  /* 统计正在运行的任务，用于展示并发限制是否已经达到。 */ const runningCount = state.tasks.filter((task) => task.status === "running").length;
  /* 统计等待执行的任务，向用户解释排队现象。 */ const queuedCount = state.tasks.filter((task) => task.status === "queued").length;
  /* 仅排队和运行中的任务可以发送取消请求。 */ const cancellable = selected?.status === "queued" || selected?.status === "running";
  /* 完整回答有单独区域时隐藏重复的回答日志，其他事件保持原有顺序。 */ const visibleEvents = selected?.events.filter((event) => event.kind !== "answer" || !selected.answer) ?? [];
  /* 快捷问题只填写输入框，让用户可以先检查目录和修改文字。 */ const fillExample = (text: string): void => { setPrompt(text); inputRef.current?.focus(); };
  /* 渲染应用整体：左侧目录和任务，中间详情，右侧学习提示。 */ return h("div", { className: "app-shell" },
    /* 左侧栏拥有独立滚动区域，任务变多时不会挤掉输入框。 */ h("aside", { className: "sidebar", "aria-label": "工作区和任务列表" },
      /* 品牌区使用本地文字，不依赖网络字体或图片。 */ h("div", { className: "brand" }, h("span", { className: "brand-mark", "aria-hidden": true }, "A"), h("div", null, h("strong", null, "Agent Lab"), h("span", null, "桌面智能体 · 学习模板"))),
      /* 目录区域说明新任务将要访问的范围。 */ h("section", { className: "workspace-box", "aria-labelledby": "workspace-heading" },
        /* 使用小标题帮助用户区分目录选择和任务列表。 */ h("h2", { id: "workspace-heading", className: "eyebrow" }, "当前工作目录"),
        /* 显示简短目录名，同时让完整路径可以通过悬停查看。 */ h("strong", { className: "workspace-name", title: state.workspacePath }, directoryName(state.workspacePath)),
        /* 完整路径允许换行，未选择时提供解释。 */ h("p", { className: "workspace-path" }, state.workspacePath || "选择一个本地项目，开始观察 Agent 的执行过程。"),
        /* 目录选择通过主进程打开系统对话框。 */ h("button", { type: "button", className: "button secondary workspace-button", disabled: Boolean(pending), onClick: () => { void perform("workspace", () => bridge.selectWorkspace()); } }, pending === "workspace" ? "正在选择目录…" : state.workspacePath ? "更换目录" : "选择工作目录"),
      /* 结束目录区域。 */ ),
      /* 用数量提示当前保存了多少个可查看的任务。 */ h("div", { className: "section-heading" }, h("h2", null, "任务记录"), h("span", { className: "count-pill" }, state.tasks.length)),
      /* 使用正常文档区域容纳可键盘操作的任务按钮。 */ h("nav", { className: "task-list", "aria-label": "选择任务" },
        /* 从后台快照渲染任务，保持后台提供的新到旧顺序。 */ ...state.tasks.map((task) => h(TaskCard, { key: task.id, task, selected: task.id === selected?.id, onSelect: () => setSelectedId(task.id) })),
        /* 还没有任务时解释下一步，并避免显示假的演示记录。 */ state.tasks.length === 0 ? h("div", { className: "sidebar-empty" }, h("span", { className: "empty-line", "aria-hidden": true }), h("p", null, "你的第一个任务将出现在这里。")) : null,
      /* 结束任务导航。 */ ),
      /* 并发信息来自后台配置，不在前端写死。 */ h("div", { className: "sidebar-footer" }, h("span", { className: "connection-dot", "aria-hidden": true }), h("span", null, `运行 ${runningCount} / ${state.maxConcurrent} · 排队 ${queuedCount}`), h("small", null, `状态版本 ${state.revision}`)),
    /* 结束左侧栏。 */ ),
    /* 主区域保留固定头部和底部输入，中间内容独立滚动。 */ h("main", { className: "main-panel" },
      /* 顶栏明确告诉用户当前是真实模型还是离线演示。 */ h("header", { className: "topbar" },
        /* 标题与说明解释当前页面的用途。 */ h("div", null, h("p", { className: "eyebrow" }, "BUILD · OBSERVE · UNDERSTAND"), h("h1", null, "工作台")),
        /* 模式信息只展示模型名称，不显示任何密钥或请求凭据。 */ h("div", { className: `mode-badge mode-${state.mode}`, title: state.mode === "demo" ? "确定性的本地工具演示，不会请求模型服务。" : "通过主进程调用配置的 OpenAI 模型。" }, h("span", { className: "status-dot", "aria-hidden": true }), state.mode === "demo" ? "离线演示" : `OpenAI · ${state.model ?? "未配置模型"}`),
      /* 结束顶部栏。 */ ),
      /* 操作错误放在固定位置，选择目录或提交失败时都能被看见。 */ actionError ? h("div", { className: "action-error", role: "alert" }, h("span", null, actionError), h("button", { type: "button", onClick: () => setActionError(null), "aria-label": "关闭错误提示" }, "×")) : null,
      /* 任务详情区域与学习侧栏共用可伸缩的内容区。 */ h("div", { className: "content-grid" },
        /* 中间滚动容器保证长日志不会把输入框挤出窗口。 */ h("section", { className: "conversation", "aria-label": "当前任务详情" },
          /* 有任务时展示真实任务，没有任务时展示引导。 */ selected ? h("div", { className: "task-detail" },
            /* 任务头部显示用户问题、状态及取消动作。 */ h("div", { className: "detail-heading" },
              /* 在窄窗口中让标题占据可用宽度并自然换行。 */ h("div", { className: "detail-title" }, h("p", { className: "eyebrow" }, "当前任务"), h("h2", null, selected.prompt), h("p", { className: "detail-path", title: selected.workspacePath }, selected.workspacePath)),
              /* 任务操作与内容分开摆放，取消按钮只在可取消状态显示。 */ h("div", { className: "detail-actions" }, h(StatusBadge, { status: selected.status }), cancellable ? h("button", { className: "button cancel", type: "button", disabled: Boolean(pending), onClick: () => { void perform(`cancel:${selected.id}`, () => bridge.cancelTask(selected.id)); } }, pending === `cancel:${selected.id}` ? "正在取消…" : "取消任务") : null),
            /* 结束任务头部。 */ ),
            /* 用明确文字解释等待或运行，不用动画代替任务状态。 */ selected.status === "queued" ? h("div", { className: "task-notice", role: "status" }, "任务已进入队列，空出执行位置后会自动开始。") : null,
            /* 运行中仍可继续创建其他任务，也可取消当前任务。 */ selected.status === "running" ? h("div", { className: "task-notice running-notice", role: "status" }, h("span", { className: "status-dot", "aria-hidden": true }), "正在执行，工具调用与进度将显示在下方。") : null,
            /* 取消状态不承诺已经完成原问题。 */ selected.status === "cancelled" ? h("div", { className: "task-notice", role: "status" }, "任务已取消。已发生的执行记录保留在下方，便于检查。") : null,
            /* 失败时直接展示后台的错误解释，避免只有颜色提示。 */ selected.status === "failed" ? h("div", { className: "task-notice failure-notice", role: "alert" }, selected.error || "任务执行失败，请查看执行记录。") : null,
            /* 展示实际事件数量，帮助用户观察一次任务包含的步骤。 */ h("div", { className: "timeline-heading" }, h("h3", null, "执行过程"), h("span", null, `${visibleEvents.length} 条记录`)),
            /* 使用稳定事件编号作为键，避免追加日志时重建旧节点。 */ h("div", { className: "event-list" }, ...visibleEvents.map((event, index) => h(EventCard, { key: event.id, event, index })), visibleEvents.length === 0 ? h("p", { className: "no-events" }, "等待后台返回第一条执行记录…") : null),
            /* 最终答案作为纯文本显示，保留模型返回的换行。 */ selected.answer ? h("section", { className: "answer-card", "aria-label": "任务回答" }, h("div", { className: "answer-heading" }, h("span", { "aria-hidden": true }, "↳"), h("h3", null, "任务回答")), h("pre", null, selected.answer)) : null,
          /* 没有任务时展示可操作的起步引导。 */ ) : h("div", { className: "welcome" },
            /* 用纯 CSS 的层叠卡片作为轻量本地插图。 */ h("div", { className: "welcome-art", "aria-hidden": true }, h("span", { className: "art-card art-back" }), h("span", { className: "art-card art-front" }, h("span", null, "⌘"), h("i"), h("i"), h("b", null, "ready"))),
            /* 引导标题说明这个模板的可观察特性。 */ h("p", { className: "eyebrow" }, "YOUR FIRST AGENT TASK"),
            /* 将用户关注点放到一个可以立即完成的小任务。 */ h("h2", null, "从一个本地项目开始"),
            /* 清楚说明离线演示和真实工具执行的区别。 */ h("p", { className: "welcome-description" }, "选择目录，提出一个问题。观察页面、IPC、任务队列和文件工具如何一起完成工作。"),
            /* 展示两个不会自动执行的快捷问题。 */ h("div", { className: "example-grid" }, ...EXAMPLES.map((example, index) => h("button", { key: example, type: "button", className: "example-card", onClick: () => fillExample(example) }, h("span", { className: "example-number" }, `0${index + 1}`), h("strong", null, example), h("span", null, index === 0 ? "读取目录，了解文件分布" : "搜索代码中的待办标记"), h("b", { "aria-hidden": true }, "↗")))),
            /* 根据是否已选目录给出准确的下一步。 */ h("p", { className: "welcome-tip" }, state.workspacePath ? "目录已就绪。选择一个示例，或在下方输入自己的问题。" : "第一步：点击左侧「选择工作目录」。"),
          /* 结束详情或空状态的条件渲染。 */ ),
        /* 结束中间滚动区。 */ ),
        /* 放入独立的教学侧栏，在较窄窗口自动隐藏以保护操作空间。 */ h(LearningPanel),
      /* 结束内容网格。 */ ),
      /* 表单固定在主区域下方，任务日志滚动时仍可使用。 */ h("form", { className: "composer", onSubmit: submit },
        /* 快捷问题在有历史任务时仍然可用。 */ h("div", { className: "composer-topline" }, h("label", { htmlFor: "task-prompt" }, "交给 Agent 的任务"), h("div", { className: "quick-prompts" }, ...EXAMPLES.map((example) => h("button", { type: "button", key: example, onClick: () => fillExample(example), disabled: pending === "start" }, example)))),
        /* 给输入框和提交按钮一个整体的边框与焦点反馈。 */ h("div", { className: "composer-input" },
          /* 输入限制与主进程一致；提交期间禁用编辑，避免成功响应清空用户刚写的下一条问题。 */ h("textarea", { id: "task-prompt", ref: inputRef, value: prompt, maxLength: 2000, rows: 2, disabled: pending === "start", placeholder: state.workspacePath ? "例如：概览这个项目的目录结构，并搜索 TODO…" : "先选择工作目录，再描述你想完成的任务…", onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setPrompt(event.target.value), onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); submit(); } } }),
          /* 禁止无目录、空输入或请求处理中重复提交。 */ h("button", { type: "submit", className: "button primary submit-button", disabled: !state.workspacePath || !prompt.trim() || Boolean(pending) }, pending === "start" ? "提交中…" : "创建任务", h("span", { "aria-hidden": true }, "↑")),
        /* 结束输入区。 */ ),
        /* 将运行模式与键盘快捷键放在不打扰阅读的位置。 */ h("div", { className: "composer-footer" }, h("span", null, state.mode === "demo" ? "离线模式 · 本地只读工具 · 无需 API Key" : "模型模式 · 工具仅在所选目录中执行"), h("span", null, "Ctrl / ⌘ + Enter 提交")),
      /* 结束任务表单。 */ ),
    /* 结束主区域。 */ ),
  /* 结束应用布局。 */ );
/* 结束根组件。 */ }
/* 查找 HTML 中专门提供给 React 的挂载容器。 */ const container = document.getElementById("root");
/* 缺少容器属于模板结构错误，立即给出可定位的异常。 */ if (!container) throw new Error("页面缺少 #root 挂载节点。");
/* 将真实 React 应用挂载到 Electron 的渲染进程页面。 */ createRoot(container).render(h(App));
