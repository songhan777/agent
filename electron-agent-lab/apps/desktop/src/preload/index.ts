/* preload 在隔离环境中使用 Electron，只把包装后的函数暴露给页面。 */ import { contextBridge, ipcRenderer } from "electron";
/* 为事件包装器导入正确的参数类型。 */ import type { IpcRendererEvent } from "electron";
/* 复用通道名称，避免主进程和 preload 拼写不同。 */ import { CHANNELS } from "../../../../packages/shared/src/contracts";
/* 约束暴露给页面的接口和状态类型。 */ import type { AppState, DesktopBridge } from "../../../../packages/shared/src/contracts";
/* 为每项能力建立明确的调用函数，不提供任意通道发送接口。 */ const bridge: DesktopBridge = {
  /* 获取当前状态。 */ getState: () => ipcRenderer.invoke(CHANNELS.state),
  /* 请求主进程打开系统目录选择框。 */ selectWorkspace: () => ipcRenderer.invoke(CHANNELS.workspace),
  /* 把用户任务交给主进程排队。 */ startTask: (prompt) => ipcRenderer.invoke(CHANNELS.start, prompt),
  /* 把任务编号交给主进程取消执行。 */ cancelTask: (taskId) => ipcRenderer.invoke(CHANNELS.cancel, taskId),
  /* 订阅状态时隐藏原始 Electron 事件对象。 */ onState: (listener) => {
    /* 只把可序列化快照传给页面，避免泄漏事件上的底层能力。 */ const wrapped = (_event: IpcRendererEvent, state: AppState) => listener(state);
    /* 保存同一个包装函数引用，以便后续精准移除。 */ ipcRenderer.on(CHANNELS.changed, wrapped);
    /* 返回 React effect 可使用的清理函数。 */ return () => ipcRenderer.removeListener(CHANNELS.changed, wrapped);
  /* 结束订阅函数。 */ },
/* 结束桥接对象定义。 */ };
/* 把经过限定的接口放在页面的 window.desktop 上。 */ contextBridge.exposeInMainWorld("desktop", bridge);
