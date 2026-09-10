/* 使用子进程启动 Electron，并让它与开发服务器一起退出。 */ import { spawn } from "node:child_process";
/* 使用路径工具设置开发缓存目录。 */ import path from "node:path";
/* electron 包在 Node 环境中返回桌面运行时的可执行文件位置。 */ import electronPath from "electron";
/* 使用 Vite 的程序接口启动页面开发服务器。 */ import { createServer } from "vite";
/* 复用后台构建函数和项目目录。 */ import { buildMain, projectRoot } from "./build.mjs";
/* 先编译主进程和 preload；修改这两部分后需要重新启动本命令。 */ await buildMain();
/* 根据页面配置创建开发服务器。 */ const server = await createServer({ configFile: path.join(projectRoot, "apps/desktop/vite.config.ts") });
/* 等服务器真正开始监听之后再打开 Electron。 */ await server.listen();
/* 显示本机开发地址，便于确认端口。 */ server.printUrls();
/* 给开发实例单独的数据目录，避免影响已安装版本的历史。 */ const environment = { ...process.env, AGENT_LAB_DEV_URL: "http://127.0.0.1:5173", AGENT_LAB_USER_DATA: path.join(projectRoot, ".local-data", "dev") };
/* 防止父环境把 Electron 误当作普通 Node 运行。 */ delete environment.ELECTRON_RUN_AS_NODE;
/* 直接运行可执行文件，不通过字符串拼接 shell 命令。 */ const child = spawn(electronPath, [projectRoot], { cwd: projectRoot, env: environment, stdio: "inherit", windowsHide: true });
/* 防止关闭事件和中断信号重复清理。 */ let stopping = false;
/* 关闭 Electron 和 Vite，避免留下占用端口的后台程序。 */ async function stop(code = 0) {
  /* 已经开始清理时不重复执行。 */ if (stopping) return;
  /* 记录清理状态。 */ stopping = true;
  /* 向尚未结束的 Electron 发送退出信号。 */ if (child.exitCode === null) child.kill();
  /* 等开发服务器释放端口。 */ await server.close();
  /* 设置退出结果，让调用脚本知道是否发生错误。 */ process.exitCode = code;
/* 结束清理函数。 */ }
/* 用户按 Ctrl+C 时一起关闭两个进程。 */ process.once("SIGINT", () => { void stop(); });
/* 接到终止信号时同样清理。 */ process.once("SIGTERM", () => { void stop(); });
/* 用户关闭桌面窗口后不继续保留开发服务器。 */ child.once("exit", (code) => { void stop(code ?? 0); });
/* 启动可执行文件失败时输出原因并释放服务器。 */ child.once("error", (error) => { console.error(error.message); void stop(1); });
