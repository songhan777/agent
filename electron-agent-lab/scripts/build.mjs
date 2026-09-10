/* 使用路径工具定位项目，避免依赖调用命令时的工作目录。 */ import path from "node:path";
/* 将模块 URL 转为本机文件路径。 */ import { fileURLToPath } from "node:url";
/* 使用 esbuild 编译运行在 Node/Electron 中的代码。 */ import { build as bundle } from "esbuild";
/* 使用 Vite 构建浏览器页面。 */ import { build as buildVite } from "vite";
/* 从脚本所在目录计算项目根目录。 */ export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/* 只构建主进程和 preload，供开发启动复用。 */ export async function buildMain() {
  /* 定义两个后台入口共用的编译选项。 */ const shared = { bundle: true, platform: "node", format: "cjs", target: "node22", external: ["electron"], sourcemap: true, logLevel: "info" };
  /* 两个入口没有构建依赖，可以并行编译。 */ await Promise.all([
    /* 主进程包含任务管理器和 Agent 核心。 */ bundle({ ...shared, entryPoints: [path.join(projectRoot, "apps/desktop/src/main/index.ts")], outfile: path.join(projectRoot, "dist/main/index.cjs") }),
    /* preload 编译成单文件，使沙箱无需加载额外本地模块。 */ bundle({ ...shared, entryPoints: [path.join(projectRoot, "apps/desktop/src/preload/index.ts")], outfile: path.join(projectRoot, "dist/main/preload.cjs") }),
  /* 等待两个后台入口全部生成。 */ ]);
/* 结束后台构建函数。 */ }
/* 完整构建同时生成桌面页面和可单独运行的 CLI。 */ export async function buildAll() {
  /* 优先构建后台，提前发现共享逻辑中的编译问题。 */ await buildMain();
  /* 生成带相对资源路径的静态页面。 */ await buildVite({ configFile: path.join(projectRoot, "apps/desktop/vite.config.ts") });
  /* 输出独立 CLI 文件，构建后不再需要 tsx 来执行。 */ await bundle({ entryPoints: [path.join(projectRoot, "apps/cli/src/index.ts")], outfile: path.join(projectRoot, "dist/cli/index.cjs"), bundle: true, platform: "node", format: "cjs", target: "node22", sourcemap: true, logLevel: "info" });
/* 结束完整构建函数。 */ }
/* 仅直接执行本脚本时构建，被 dev 脚本导入时不自动运行。 */ if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await buildAll();
