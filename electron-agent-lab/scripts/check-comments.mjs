/* 用文件接口遍历手写源码，跳过 node_modules 和生成文件。 */ import { readdir, readFile } from "node:fs/promises";
/* 使用路径工具解析各个教学子项目。 */ import path from "node:path";
/* 从脚本 URL 得到项目目录。 */ import { fileURLToPath } from "node:url";
/* 固定检查根目录，不向项目以外扫描。 */ const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/* 这些目录只存放教学源码和验证脚本。 */ const sourceRoots = ["apps", "packages", "scripts", "tests", "examples"];
/* 标准 JSON 不能直接写注释，由独立配置文档逐行解释。 */ const extensions = new Set([".ts", ".tsx", ".mjs", ".css", ".html"]);
/* 接受同一行中的中文块注释、行注释或 HTML 注释。 */ const chineseComment = /\/\*.*\p{Script=Han}.*\*\/|\/\/.*\p{Script=Han}|<!--.*\p{Script=Han}.*-->/u;
/* 保存缺少注释的文件和行号。 */ const missing = [];
/* 统计实际检查过的非空源码行。 */ let checkedLines = 0;
/* 统计源码文件数量。 */ let checkedFiles = 0;
/* 递归检查指定目录下的源文件。 */ async function inspect(directory) {
  /* 一次读取当前目录中的文件和子目录。 */ for (const entry of await readdir(directory, { withFileTypes: true })) {
    /* 拼出当前条目的完整路径。 */ const filename = path.join(directory, entry.name);
    /* 进入普通子目录，但不跟随符号链接。 */ if (entry.isDirectory()) await inspect(filename);
    /* 对指定扩展名的普通文件检查逐行注释。 */ else if (entry.isFile() && extensions.has(path.extname(filename))) {
      /* 增加源文件计数。 */ checkedFiles += 1;
      /* 兼容 Windows 和其他系统的换行。 */ const lines = (await readFile(filename, "utf8")).split(/\r?\n/);
      /* 每一个非空源代码行都应该带有作用说明。 */ lines.forEach((line, index) => {
        /* 空行只承担排版作用，无需注释。 */ if (!line.trim()) return;
        /* 累加参与检查的行数。 */ checkedLines += 1;
        /* 记录没有中文注释的具体位置，便于修改。 */ if (!chineseComment.test(line)) missing.push(`${path.relative(root, filename)}:${index + 1}`);
      /* 结束单文件检查。 */ });
    /* 结束文件分支。 */ }
  /* 结束当前目录遍历。 */ }
/* 结束递归函数。 */ }
/* 依次检查各个已知源码目录。 */ for (const directory of sourceRoots) await inspect(path.join(root, directory));
/* 有遗漏时输出清单，并让检查命令失败。 */ if (missing.length) { console.error(`以下源码行缺少中文注释：\n${missing.join("\n")}`); process.exitCode = 1; }
/* 全部通过时报告实际检查范围。 */ else console.log(`逐行中文注释检查通过：${checkedFiles} 个源码文件，${checkedLines} 个非空行。`);
