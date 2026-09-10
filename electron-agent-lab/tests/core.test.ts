/* 使用 Node.js 内置测试运行器，不需要额外测试框架。 */ import test from "node:test";
/* 引入严格断言，明确检查值、错误和取消行为。 */ import assert from "node:assert/strict";
/* 引入临时文件操作，所有测试数据都在独立临时目录中创建。 */ import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
/* 获取系统临时目录，不依赖个人机器上的项目文件。 */ import os from "node:os";
/* 使用跨平台路径拼接。 */ import path from "node:path";
/* 导入实际核心实现，而不是复制实现逻辑。 */ import { createReadOnlyTools, runAgent, TOOL_LIMITS, type AgentEvent } from "../packages/core/src/index.js";
/* 创建一份包含源码、待办和敏感文件的隔离测试工作空间。 */ async function fixture() {
  /* 使用唯一前缀创建目录，避免并发测试相互影响。 */ const base = await mkdtemp(path.join(os.tmpdir(), "electron-agent-core-test-"));
  /* 把工作目录与越界文件放在不同位置。 */ const workspace = path.join(base, "workspace");
  /* 创建两级源码目录以覆盖递归枚举。 */ await mkdir(path.join(workspace, "src"), { recursive: true });
  /* README 为目录概览提供真实可读内容。 */ await writeFile(path.join(workspace, "README.md"), "# 测试项目\n这是实际读取的项目说明。\n");
  /* 源码中保留 TODO，以验证搜索返回的真实行号。 */ await writeFile(path.join(workspace, "src", "main.ts"), "export const value = 1;\n// TODO: 补充错误处理\n");
  /* 创建隐藏凭据文件，验证忽略和拒绝机制。 */ await writeFile(path.join(workspace, ".env"), "SECRET=do-not-read");
  /* 创建工作空间之外的文件，用于目录穿越和符号链接测试。 */ const outside = path.join(base, "outside.txt");
  /* 测试越界文件中的内容不应被工具读取。 */ await writeFile(outside, "outside-secret");
  /* 提供明确限定在测试临时目录中的清理方法。 */ const cleanup = async () => {
    /* 删除前检查完整路径属于预期临时目录且前缀正确。 */ assert.equal(path.dirname(base), path.resolve(os.tmpdir()));
    /* 同时检查唯一测试前缀，防止误删其他临时数据。 */ assert.ok(path.basename(base).startsWith("electron-agent-core-test-"));
    /* 递归移除本次测试创建的独立目录；不会使用跟随链接的扫描删除。 */ await rm(base, { recursive: true, force: true });
  /* 结束测试清理方法。 */ };
  /* 返回测试所需的路径与资源清理函数。 */ return { workspace, outside, cleanup };
/* 结束测试数据工厂。 */ }
/* 将模拟 Responses API 的 JSON 包装为标准 Response。 */ function jsonResponse(output: unknown[], status = "completed") { return new Response(JSON.stringify({ status, output }), { headers: { "Content-Type": "application/json" } }); }
/* 验证真实磁盘读取、敏感文件过滤与搜索行号。 */ test("只读工具读取真实目录并返回准确搜索行号", async () => {
  /* 为本测试准备独立数据。 */ const data = await fixture();
  /* 使用 finally 保证断言失败时也清理文件。 */ try {
    /* 创建未取消的工具实例。 */ const tools = await createReadOnlyTools(data.workspace, new AbortController().signal);
    /* 列出工作目录并检查嵌套文件被发现。 */ const listing = await tools.listFiles({ path: "." });
    /* 应当找到源码文件。 */ assert.ok(listing.entries.some((entry) => entry.path === "src/main.ts"));
    /* 列表不得暴露隐藏凭据文件。 */ assert.ok(!listing.entries.some((entry) => entry.path.includes(".env")));
    /* 读取工具应返回磁盘中真实的中文内容。 */ assert.match((await tools.readFile({ path: "README.md" })).content, /实际读取/);
    /* 搜索应定位到第二行的 TODO。 */ const search = await tools.searchText({ query: "todo", path: "." });
    /* 检查结果路径和行号，避免只验证存在任意字符串。 */ assert.deepEqual(search.matches.map((match) => [match.path, match.line]), [["src/main.ts", 2]]);
    /* 小型测试目录不应被标记截断。 */ assert.equal(search.truncated, false);
  /* 进入清理阶段。 */ } finally { await data.cleanup(); }
/* 结束正常文件工具测试。 */ });
/* 验证不同平台的目录穿越语法和敏感文件访问都被拒绝。 */ test("拒绝目录穿越、绝对路径、敏感文件与未知参数", async () => {
  /* 创建测试工作空间。 */ const data = await fixture();
  /* 测试结束后一定删除临时文件。 */ try {
    /* 创建工具实例。 */ const tools = await createReadOnlyTools(data.workspace, new AbortController().signal);
    /* 逐个验证 POSIX 与 Windows 风格路径。 */ for (const unsafe of ["../outside.txt", "..\\outside.txt", "/etc/passwd", "C:\\Windows\\win.ini", ".env", "src/../README.md"]) {
      /* 任何不安全路径都必须失败。 */ await assert.rejects(tools.readFile({ path: unsafe }));
    /* 结束危险路径枚举。 */ }
    /* 未知工具不能映射到任意本地函数。 */ await assert.rejects(tools.invoke("run_shell", { command: "echo unsafe" }), /未知工具/);
    /* 禁止调用者通过额外字段提高读取上限。 */ await assert.rejects(tools.readFile({ path: "README.md", maxBytes: Infinity }), /未支持/);
    /* 非对象工具参数在执行前被拒绝。 */ await assert.rejects(tools.invoke("list_files", null), /必须是对象/);
  /* 释放测试数据。 */ } finally { await data.cleanup(); }
/* 结束工具边界测试。 */ });
/* 验证符号链接真实位置检查；Windows 未授权创建链接时明确跳过。 */ test("拒绝通过符号链接读取目录外文件", async (context) => {
  /* 创建独立的内外目录。 */ const data = await fixture();
  /* 保证无论链接权限如何都清理测试目录。 */ try {
    /* 捕获 Windows 普通账号可能缺少的符号链接创建权限。 */ try { await symlink(data.outside, path.join(data.workspace, "linked.txt"), "file"); }
    /* 仅在明确的平台权限限制下跳过这一项。 */ catch (error) {
      /* 提取 Node.js 文件系统错误码。 */ const code = (error as NodeJS.ErrnoException).code;
      /* 没有权限创建链接时记录原因，不能把未经验证说成通过。 */ if (code === "EPERM" || code === "EACCES") { context.skip("当前账号没有创建符号链接权限"); return; }
      /* 其他错误表示测试设置异常，必须让测试失败。 */ throw error;
    /* 结束符号链接创建处理。 */ }
    /* 创建受限文件工具。 */ const tools = await createReadOnlyTools(data.workspace, new AbortController().signal);
    /* realpath 检查应拒绝链接指向的目录外内容。 */ await assert.rejects(tools.readFile({ path: "linked.txt" }), /工作目录之外/);
    /* 枚举过程也不能跟随或展示符号链接。 */ assert.ok(!(await tools.listFiles()).entries.some((entry) => entry.path === "linked.txt"));
  /* 删除链接和测试文件。 */ } finally { await data.cleanup(); }
/* 结束符号链接越界测试。 */ });
/* Windows 目录 junction 通常不需要创建文件符号链接的权限，可额外验证真实路径边界。 */ test("目录链接不能把授权范围扩展到其他目录", async (context) => {
  /* 准备独立测试根目录。 */ const data = await fixture();
  /* 无论平台是否支持链接都清理测试文件。 */ try {
    /* 在授权工作目录的同级建立一个未授权目录。 */ const outsideDirectory = path.join(path.dirname(data.workspace), "outside-directory");
    /* 创建链接目标目录。 */ await mkdir(outsideDirectory);
    /* 目标中的文件不应能被只读工具访问。 */ await writeFile(path.join(outsideDirectory, "secret.txt"), "private-directory-content");
    /* Windows 使用 junction，其他平台使用目录符号链接。 */ try { await symlink(outsideDirectory, path.join(data.workspace, "linked-directory"), process.platform === "win32" ? "junction" : "dir"); }
    /* 只在创建链接被平台明确禁止时跳过。 */ catch (error) {
      /* 获取操作系统错误码。 */ const code = (error as NodeJS.ErrnoException).code;
      /* 记录无法验证的原因。 */ if (code === "EPERM" || code === "EACCES") { context.skip("当前账号没有创建目录链接权限"); return; }
      /* 非权限异常应报告测试失败。 */ throw error;
    /* 结束链接创建处理。 */ }
    /* 创建限制到原工作目录的工具。 */ const tools = await createReadOnlyTools(data.workspace, new AbortController().signal);
    /* 通过链接读取文件必须被 realpath 边界检查拒绝。 */ await assert.rejects(tools.readFile({ path: "linked-directory/secret.txt" }), /工作目录之外/);
    /* 以链接目录为扫描起点同样不能越界。 */ await assert.rejects(tools.listFiles({ path: "linked-directory" }), /工作目录之外/);
  /* 只删除本测试拥有的临时目录。 */ } finally { await data.cleanup(); }
/* 结束目录链接越界测试。 */ });
/* 验证字节、字符和搜索结果三种不同资源限制。 */ test("文件大小、文本长度与搜索结果均有上限", async () => {
  /* 准备测试目录。 */ const data = await fixture();
  /* 用 finally 处理清理。 */ try {
    /* 创建超过字节限制的文件。 */ await writeFile(path.join(data.workspace, "large.txt"), "x".repeat(TOOL_LIMITS.maxBytes + 1));
    /* 创建未超字节限制但超过展示字符上限的文本。 */ await writeFile(path.join(data.workspace, "long.txt"), "a".repeat(TOOL_LIMITS.maxText + 10));
    /* 创建超过搜索命中上限的文本。 */ await writeFile(path.join(data.workspace, "todos.txt"), "TODO item\n".repeat(TOOL_LIMITS.maxResults + 10));
    /* 创建文件工具。 */ const tools = await createReadOnlyTools(data.workspace, new AbortController().signal);
    /* 大文件必须被拒绝，不能先读完整文件再判断。 */ await assert.rejects(tools.readFile({ path: "large.txt" }), /字节读取上限/);
    /* 普通长文本返回受限内容并明确截断。 */ const long = await tools.readFile({ path: "long.txt" });
    /* 检查返回字符数量。 */ assert.equal(long.content.length, TOOL_LIMITS.maxText);
    /* 检查完整性标记。 */ assert.equal(long.truncated, true);
    /* 搜索不得返回超过最大条数的结果。 */ const search = await tools.searchText({ query: "TODO" });
    /* 检查实际结果数量。 */ assert.equal(search.matches.length, TOOL_LIMITS.maxResults);
    /* 达到搜索限制必须向调用方说明。 */ assert.equal(search.truncated, true);
  /* 释放临时文件。 */ } finally { await data.cleanup(); }
/* 结束资源限制测试。 */ });
/* 验证大量文件和二进制内容不能绕过资源与格式限制。 */ test("目录结果数量有上限，二进制文件被拒绝", async () => {
  /* 为数量边界建立独立目录。 */ const data = await fixture();
  /* 确保所有测试文件最终被清理。 */ try {
    /* 创建超过返回条目限制的小文件；测试设置允许短时间并发写入。 */ await Promise.all(Array.from({ length: TOOL_LIMITS.maxFiles + 5 }, (_, index) => writeFile(path.join(data.workspace, `item-${index}.txt`), "small")));
    /* 创建含空字节的数据以验证二进制拒绝。 */ await writeFile(path.join(data.workspace, "binary.bin"), Buffer.from([1, 0, 2, 3]));
    /* 创建受资源限制的工具。 */ const tools = await createReadOnlyTools(data.workspace, new AbortController().signal);
    /* 运行目录枚举。 */ const result = await tools.listFiles();
    /* 返回条目不得超过固定上限。 */ assert.equal(result.entries.length, TOOL_LIMITS.maxFiles);
    /* 省略条目时必须设置截断标记。 */ assert.equal(result.truncated, true);
    /* 显式读取二进制文件应失败，而不是向模型发送无意义文本。 */ await assert.rejects(tools.readFile({ path: "binary.bin" }), /UTF-8/);
  /* 释放测试目录。 */ } finally { await data.cleanup(); }
/* 结束目录数量与二进制测试。 */ });
/* 验证预取消不会先尝试读取不存在的目录或调用网络。 */ test("预取消任务直接返回 AbortError", async () => {
  /* 创建任务控制器并在执行前取消。 */ const controller = new AbortController();
  /* 标记取消状态。 */ controller.abort();
  /* 即使路径不存在，也应优先返回取消错误。 */ await assert.rejects(runAgent({ workspacePath: "does-not-exist", prompt: "概览项目结构", mode: "demo", signal: controller.signal, onEvent: () => {} }), { name: "AbortError" });
/* 结束预取消测试。 */ });
/* 验证默认离线模式真实执行工具并准确标注规则演示。 */ test("离线概览与 TODO 搜索完成真实工具流程", async () => {
  /* 准备项目文件。 */ const data = await fixture();
  /* 确保测试完成后清理。 */ try {
    /* 收集真实发生的核心事件。 */ const events: AgentEvent[] = [];
    /* 执行默认概览；若误调用网络，注入函数会立即使测试失败。 */ const answer = await runAgent({ workspacePath: data.workspace, prompt: "概览项目结构", mode: "demo", signal: new AbortController().signal, onEvent: (event) => events.push(event), fetchImpl: async () => { throw new Error("离线模式不得请求网络"); } });
    /* 回答必须明确声明没有进行模型推理。 */ assert.match(answer, /非模型推理/);
    /* 回答应包含实际读取到的项目文本。 */ assert.match(answer, /实际读取/);
    /* 确保列表、读取、最终回答三个阶段均真实发生。 */ assert.ok(events.some((event) => event.message.startsWith("list_files")) && events.some((event) => event.message.startsWith("read_file")) && events.at(-1)?.kind === "answer");
    /* 搜索规则应调用真实搜索工具并给出行号。 */ const search = await runAgent({ workspacePath: data.workspace, prompt: "搜索 TODO", mode: "demo", signal: new AbortController().signal, onEvent: () => {} });
    /* 结果必须对应测试源码中的第二行。 */ assert.match(search, /src\/main\.ts:2/);
  /* 释放测试目录。 */ } finally { await data.cleanup(); }
/* 结束离线流程测试。 */ });
/* 验证工具事件后取消不会产生成功回答事件。 */ test("离线运行途中可以取消，且不会发送迟到答案", async () => {
  /* 准备项目文件。 */ const data = await fixture();
  /* 测试结束后清理。 */ try {
    /* 创建可以在事件回调中控制的取消器。 */ const controller = new AbortController();
    /* 记录是否出现不应发生的最终回答。 */ let answered = false;
    /* 在首个工具完成时主动取消。 */ await assert.rejects(runAgent({ workspacePath: data.workspace, prompt: "概览项目结构", mode: "demo", signal: controller.signal, onEvent: (event) => { if (event.kind === "tool") controller.abort(); if (event.kind === "answer") answered = true; } }), { name: "AbortError" });
    /* 取消后禁止发布成功答案。 */ assert.equal(answered, false);
  /* 清理临时目录。 */ } finally { await data.cleanup(); }
/* 结束运行中取消测试。 */ });
/* 验证真实适配器完整续接 reasoning、函数调用和实际工具结果。 */ test("Responses 适配器保留完整 output 并关联 function_call_output", async () => {
  /* 准备真实工具读取的文件。 */ const data = await fixture();
  /* 测试结束后清理。 */ try {
    /* 保存模拟网络调用次数。 */ let calls = 0;
    /* 模拟必须被原样传回的 reasoning 项。 */ const reasoning = { type: "reasoning", id: "rs_test", summary: [], encrypted_content: "opaque-test-value" };
    /* 模拟模型提出读取 README 的函数调用。 */ const toolCall = { type: "function_call", id: "fc_test", call_id: "call_read", name: "read_file", arguments: JSON.stringify({ path: "README.md" }) };
    /* 注入本地 fetch 替身，全程不会访问外网。 */ const fetchImpl: typeof fetch = async (url, init) => {
      /* 验证服务地址固定为官方 Responses endpoint。 */ assert.equal(url, "https://api.openai.com/v1/responses");
      /* 解析实际发送的请求体以验证协议。 */ const body = JSON.parse(String(init?.body));
      /* 模型名称来自调用者配置。 */ assert.equal(body.model, "test-model");
      /* 禁用服务端响应存储。 */ assert.equal(body.store, false);
      /* 首轮返回一项推理状态和一个函数调用。 */ if (calls++ === 0) return jsonResponse([reasoning, toolCall]);
      /* 第二轮必须保留原始 reasoning 项。 */ assert.deepEqual(body.input[1], reasoning);
      /* 第二轮必须保留原始 function_call 项。 */ assert.deepEqual(body.input[2], toolCall);
      /* 工具结果通过正确的协议类型回传。 */ assert.equal(body.input[3].type, "function_call_output");
      /* 结果关联到原始调用编号。 */ assert.equal(body.input[3].call_id, "call_read");
      /* 工具结果确实来自磁盘读取。 */ assert.match(JSON.parse(body.input[3].output).content, /实际读取/);
      /* 返回最终模型消息。 */ return jsonResponse([{ type: "message", role: "assistant", content: [{ type: "output_text", text: "已根据 README 完成说明。" }] }]);
    /* 结束网络替身定义。 */ };
    /* 运行真实协议路径，但使用模拟服务响应。 */ const answer = await runAgent({ workspacePath: data.workspace, prompt: "阅读项目说明", mode: "openai", model: "test-model", apiKey: "stub-secret", signal: new AbortController().signal, onEvent: () => {}, fetchImpl });
    /* 最终回答应来自第二次模型响应。 */ assert.equal(answer, "已根据 README 完成说明。");
    /* 整个流程应恰好请求两轮。 */ assert.equal(calls, 2);
  /* 清理测试文件。 */ } finally { await data.cleanup(); }
/* 结束 Responses 协议测试。 */ });
/* 验证服务端要求未知工具时不能扩大本地工具集合。 */ test("未知模型工具被拒绝并以工具错误结果反馈", async () => {
  /* 创建测试目录。 */ const data = await fixture();
  /* 保证资源清理。 */ try {
    /* 用调用次数区分模型请求轮次。 */ let count = 0;
    /* 定义本地模型服务替身。 */ const fetchImpl: typeof fetch = async (_url, init) => {
      /* 第一轮故意提出不受支持的命令执行工具。 */ if (count++ === 0) return jsonResponse([{ type: "function_call", call_id: "bad_call", name: "run_shell", arguments: "{}" }]);
      /* 检查核心返回的是错误而不是命令执行结果。 */ assert.match(JSON.parse(JSON.parse(String(init?.body)).input.at(-1).output).error, /工具拒绝/);
      /* 模拟模型根据工具拒绝说明能力边界。 */ return jsonResponse([{ type: "message", content: [{ type: "output_text", text: "当前只能使用只读工具。" }] }]);
    /* 结束网络替身。 */ };
    /* 检查受限执行流程可以正确收尾。 */ assert.equal(await runAgent({ workspacePath: data.workspace, prompt: "说明工具能力", mode: "openai", model: "test-model", apiKey: "stub-secret", signal: new AbortController().signal, onEvent: () => {}, fetchImpl }), "当前只能使用只读工具。");
  /* 释放测试目录。 */ } finally { await data.cleanup(); }
/* 结束未知工具测试。 */ });
/* 验证网络失败和 HTTP 错误不会把原始密钥带入异常消息。 */ test("模型错误消息不泄露 API Key 或原始响应体", async () => {
  /* 准备合法工作空间，让测试能够到达网络阶段。 */ const data = await fixture();
  /* 使用 finally 清理。 */ try {
    /* 固定其余输入，只替换网络行为。 */ const input = { workspacePath: data.workspace, prompt: "概览", mode: "openai" as const, model: "test-model", apiKey: "super-secret-key", signal: new AbortController().signal, onEvent: () => {} };
    /* 即使底层异常伪装成应用错误前缀，也不能信任或回显其中的密钥。 */ await assert.rejects(runAgent({ ...input, fetchImpl: async () => { throw new Error("模型请求失败 super-secret-key"); } }), (error: unknown) => error instanceof Error && !error.message.includes("super-secret-key") && error.message.includes("无法完成"));
    /* 模拟 HTTP 错误体包含敏感文本，也不能回显。 */ await assert.rejects(runAgent({ ...input, fetchImpl: async () => new Response("super-secret-key", { status: 401 }) }), (error: unknown) => error instanceof Error && !error.message.includes("super-secret-key") && error.message.includes("HTTP 401"));
    /* 不完整模型响应不能被当成最终成功结果。 */ await assert.rejects(runAgent({ ...input, fetchImpl: async () => jsonResponse([], "incomplete") }), /未完成/);
  /* 清理临时文件。 */ } finally { await data.cleanup(); }
/* 结束模型错误安全测试。 */ });
/* 验证任务取消会实际传递给正在等待的网络请求。 */ test("用户取消会中断真实适配器的 fetch 信号", async () => {
  /* 准备测试目录。 */ const data = await fixture();
  /* 使用 finally 清理文件。 */ try {
    /* 保存上层任务取消器。 */ const controller = new AbortController();
    /* 记录 fetch 是否收到了 abort 事件。 */ let networkAborted = false;
    /* 模拟一个只会因取消而结束的网络请求。 */ const fetchImpl: typeof fetch = async (_url, init) => new Promise<Response>((_resolve, reject) => {
      /* 监听实际传入 fetch 的内部信号。 */ init?.signal?.addEventListener("abort", () => { networkAborted = true; reject(new DOMException("aborted", "AbortError")); }, { once: true });
      /* 在监听器就绪后触发上层用户取消。 */ queueMicrotask(() => controller.abort());
    /* 结束模拟网络等待。 */ });
    /* 模型执行应当以标准取消错误结束。 */ await assert.rejects(runAgent({ workspacePath: data.workspace, prompt: "概览", mode: "openai", model: "test-model", apiKey: "stub-secret", signal: controller.signal, onEvent: () => {}, fetchImpl }), { name: "AbortError" });
    /* 证明取消不仅影响 UI 状态，还传到了网络层。 */ assert.equal(networkAborted, true);
  /* 清理测试文件。 */ } finally { await data.cleanup(); }
/* 结束网络取消测试。 */ });
/* 验证模型持续调用工具时最终会因轮数上限停止。 */ test("工具循环不会突破最大模型请求轮数", async () => {
  /* 创建工具读取目录。 */ const data = await fixture();
  /* 保证临时文件清理。 */ try {
    /* 统计实际模型请求次数。 */ let count = 0;
    /* 每次都返回同一种工具调用，不主动产生最终答案。 */ const fetchImpl: typeof fetch = async () => { count += 1; return jsonResponse([{ type: "function_call", call_id: `call_${count}`, name: "list_files", arguments: "{\"path\":\".\"}" }]); };
    /* 最大两轮后必须报告未完成。 */ await assert.rejects(runAgent({ workspacePath: data.workspace, prompt: "概览", mode: "openai", model: "test-model", apiKey: "stub-secret", maxSteps: 2, signal: new AbortController().signal, onEvent: () => {}, fetchImpl }), /轮数上限/);
    /* 实際请求数必须与配置上限一致。 */ assert.equal(count, 2);
  /* 清理测试目录。 */ } finally { await data.cleanup(); }
/* 结束执行轮数限制测试。 */ });
