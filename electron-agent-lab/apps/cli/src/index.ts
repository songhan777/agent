/* 使用 Node 路径工具解析命令行中的工作目录。 */ import path from "node:path";
/* 复用桌面应用使用的同一个 Agent 核心。 */ import { runAgent } from "../../../packages/core/src/index";
/* 导入执行模式类型，使 CLI 与桌面契约一致。 */ import type { RunMode } from "../../../packages/shared/src/contracts";
/* 读取可选参数并忽略包管理器传递的分隔符。 */ const argumentsList = process.argv.slice(2).filter((item) => item !== "--");
/* 为每项参数设置清楚的默认值。 */ const options = { workspace: "examples/workspace", prompt: "概览项目结构", mode: process.env.AGENT_MODE === "openai" ? "openai" : "demo" };
/* 包裹入口，统一处理参数和执行异常。 */ async function main(): Promise<void> {
  /* 按参数名和值逐对读取。 */ for (let index = 0; index < argumentsList.length; index += 2) {
    /* 读取本轮参数名。 */ const name = argumentsList[index];
    /* 读取本轮参数值。 */ const value = argumentsList[index + 1];
    /* 支持无需执行任务的帮助输出。 */ if (name === "--help") { console.log('pnpm cli -- --workspace examples/workspace --prompt "概览项目结构" --mode demo'); return; }
    /* 拒绝未知参数或缺少参数值，避免悄悄读取错误目录。 */ if (!value || !["--workspace", "--prompt", "--mode"].includes(name)) throw new Error(`未知参数或缺少参数值：${name}`);
    /* 通过显式分支写入对应配置。 */ if (name === "--workspace") options.workspace = value;
    /* 保存用户任务。 */ if (name === "--prompt") options.prompt = value;
    /* 保存执行模式。 */ if (name === "--mode") options.mode = value;
  /* 结束命令行参数解析。 */ }
  /* 只接受已实现的两种模式。 */ if (options.mode !== "demo" && options.mode !== "openai") throw new Error("--mode 只能是 demo 或 openai。");
  /* 创建可传播到文件和模型请求的取消控制器。 */ const controller = new AbortController();
  /* Ctrl+C 先请求合作式取消，不直接丢弃执行状态。 */ const cancel = () => controller.abort();
  /* 注册终端中断事件。 */ process.once("SIGINT", cancel);
  /* 在结束时保证清理事件监听。 */ try {
    /* 明确提示当前是否会访问模型服务。 */ console.log(options.mode === "demo" ? "[离线演示] 真实读取文件，回答由演示规则生成。" : "[OpenAI] 将把工具读取的内容发送给已配置的模型。");
    /* 把 CLI 配置转换成核心可复用的输入。 */ const answer = await runAgent({ workspacePath: path.resolve(options.workspace), prompt: options.prompt, mode: options.mode as RunMode, apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL, signal: controller.signal, onEvent: (event) => { if (event.kind !== "answer") console.log(`[${event.kind}] ${event.message}${event.detail ? `\n${event.detail}` : ""}`); } });
    /* 输出最终结果，便于从终端直接学习工具执行流程。 */ console.log(`\n${answer}`);
  /* 清理退出钩子，避免嵌入其他脚本时积累监听器。 */ } finally { process.removeListener("SIGINT", cancel); }
/* 结束 CLI 入口。 */ }
/* 入口错误使用非零退出码，便于脚本调用者判断失败。 */ void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "任务失败。"); process.exitCode = 1; });
