/* 使用 Node 的 URL 转换函数，将配置文件位置转换成当前平台的真实目录。 */ import { fileURLToPath } from "node:url";
/* 导入 Vite 配置帮助函数，以获得类型检查和编辑器提示。 */ import { defineConfig } from "vite";
/* 导出渲染进程专用配置；主进程和 preload 由根目录构建脚本编译。 */ export default defineConfig({
  /* 固定页面根目录，避免从仓库其他目录执行命令时找错 HTML。 */ root: fileURLToPath(new URL(".", import.meta.url)),
  /* 使用相对资源地址，让打包后的 lab:// 页面也能加载脚本和样式。 */ base: "./",
  /* 将开发服务限制到本机回环地址，并与启动脚本约定固定端口。 */ server: { host: "127.0.0.1", port: 5173, strictPort: true },
  /* 使用 Vite 内置的 esbuild 即可处理本模板的 TypeScript；不注入需要内联脚本的 React 刷新前导。 */ esbuild: { jsx: "automatic" },
  /* 输出到仓库统一的 dist/renderer，清理动作只影响该构建输出目录。 */ build: { outDir: "../../dist/renderer", emptyOutDir: true },
/* 结束渲染进程构建配置。 */ });
