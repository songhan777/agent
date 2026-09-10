/* 引入异步文件 API，使目录和文件操作不会直接阻塞界面线程。 */ import { open, opendir, realpath, stat } from "node:fs/promises";
/* 引入路径工具，统一处理 Windows 与其他平台的目录边界。 */ import path from "node:path";
/* 集中定义教学项目的资源上限，生产项目应按实际需求调整并测量。 */ export const TOOL_LIMITS = { maxBytes: 128 * 1024, maxText: 32000, maxFiles: 200, maxEntries: 1000, maxDirectories: 80, maxDepth: 8, maxResults: 40, maxLine: 240 } as const;
/* 定义目录列表中一条记录的数据结构。 */ export interface FileEntry { path: string; type: "file" | "directory"; }
/* 定义一次目录遍历的结果，truncated 表示达到限制后提前结束。 */ interface WalkResult { entries: FileEntry[]; truncated: boolean; }
/* 在异步步骤之间主动检查取消，保持取消语义一致。 */ export function checkCancelled(signal: AbortSignal): void {
  /* 抛出标准 AbortError，方便调用方区分用户取消与普通失败。 */ if (signal.aborted) throw new DOMException("任务已取消", "AbortError");
/* 结束取消检查函数。 */ }
/* 判断任意运行时输入是否为普通参数对象。 */ function objectInput(value: unknown): Record<string, unknown> {
  /* 拒绝 null、数组与其他非对象值，不能依赖 TypeScript 检查模型输出。 */ if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("工具参数必须是对象");
  /* 在完成运行时检查后把输入作为键值对象使用。 */ return value as Record<string, unknown>;
/* 结束参数对象校验。 */ }
/* 校验调用者只传入该工具声明过的字段。 */ function knownKeys(input: Record<string, unknown>, allowed: string[]): void {
  /* 未知字段不会被忽略，避免模型误以为额外参数可以改变工具行为。 */ if (Object.keys(input).some((key) => !allowed.includes(key))) throw new Error("工具包含未支持的参数");
/* 结束字段白名单校验。 */ }
/* 判断路径中的单个部分是否属于模板拒绝访问的目录或敏感文件。 */ function isIgnored(part: string): boolean {
  /* 使用小写形式检查，覆盖 Windows 常见的大小写差异。 */ const name = part.toLowerCase();
  /* 忽略隐藏路径、构建产物、依赖目录、凭据名称和常见私钥后缀。 */ return name.startsWith(".") || ["node_modules", "dist", "build", "coverage", "credentials", "credentials.json", "secrets.json", "id_rsa", "id_ed25519"].includes(name) || /\.(pem|key|p12|pfx)$/.test(name);
/* 结束敏感路径判断；文件名过滤无法识别普通文件中偶然出现的秘密。 */ }
/* 创建绑定一个工作目录和取消信号的只读工具集合。 */ export async function createReadOnlyTools(workspacePath: string, signal: AbortSignal) {
  /* 在任何文件系统读取之前处理已经取消的任务。 */ checkCancelled(signal);
  /* 将用户授权的根目录转成真实路径，避免根目录自身是符号链接时边界不一致。 */ const root = await realpath(workspacePath);
  /* 只接受目录，避免把普通文件当作工作空间。 */ if (!(await stat(root)).isDirectory()) throw new Error("工作空间必须是目录");
  /* 判断真实路径是否仍然位于授权的工作目录中。 */ function relativeInside(target: string): string {
    /* 计算相对路径，以路径段而不是字符串前缀判断目录归属。 */ const relative = path.relative(root, target);
    /* 拒绝上级目录、不同磁盘和绝对路径，防止同名前缀目录误判。 */ if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("禁止访问工作目录之外的路径");
    /* 返回已经确认位于根目录中的相对路径。 */ return relative;
  /* 结束目录边界判断。 */ }
  /* 同时验证用户输入路径与解析符号链接后的真实路径。 */ async function resolveSafe(rawPath: unknown = "."): Promise<string> {
    /* 每次解析前检查任务是否取消。 */ checkCancelled(signal);
    /* 限定相对路径的类型和长度，并拒绝空值及空字符。 */ if (typeof rawPath !== "string" || !rawPath || rawPath.length > 1024 || rawPath.includes("\0")) throw new Error("路径必须是 1 至 1024 字符的相对路径");
    /* 统一拒绝 Windows 和 POSIX 的绝对路径，包括 Windows 磁盘语法。 */ if (path.posix.isAbsolute(rawPath) || path.win32.isAbsolute(rawPath) || rawPath.includes(":")) throw new Error("工具只接受工作目录内的相对路径");
    /* 把两种路径分隔符统一拆成路径段，以便跨平台检查。 */ const parts = rawPath.split(/[\\/]+/).filter((part) => part !== "" && part !== ".");
    /* 即使最终路径落回目录内，也拒绝显式的上级跳转。 */ if (parts.includes("..")) throw new Error("禁止使用上级目录跳转");
    /* 检查用户提交的路径名称，敏感目录和文件不能由提示词放行。 */ if (parts.some(isIgnored)) throw new Error("该路径属于忽略目录或敏感文件");
    /* 将相对路径转换为工作空间中的绝对路径。 */ const candidate = path.resolve(root, ...parts);
    /* 在访问文件系统前先检查词法路径的目录边界。 */ relativeInside(candidate);
    /* 解析所有符号链接，再检查真实位置。 */ const resolved = await realpath(candidate);
    /* 获取真实路径在工作目录中的相对表示。 */ const canonicalRelative = relativeInside(resolved);
    /* 阻止通过安全名称的符号链接访问隐藏目录或密钥文件。 */ if (canonicalRelative.split(path.sep).filter(Boolean).some(isIgnored)) throw new Error("符号链接指向忽略目录或敏感文件");
    /* 文件系统操作完成后再次检查取消。 */ checkCancelled(signal);
    /* 返回通过两次目录验证的真实路径。 */ return resolved;
  /* 结束安全路径解析。 */ }
  /* 以统一的正斜杠相对路径返回结果，避免把本机绝对路径传给模型。 */ function displayPath(absolute: string): string { return relativeInside(absolute).split(path.sep).join("/") || "."; }
  /* 广度优先遍历有限数量目录和文件，并跳过枚举得到的符号链接。 */ async function walk(rawPath: unknown = "."): Promise<WalkResult> {
    /* 对遍历的起始目录执行完整边界校验。 */ const start = await resolveSafe(rawPath);
    /* 文件路径不能作为目录扫描的起点。 */ if (!(await stat(start)).isDirectory()) throw new Error("扫描路径必须是目录");
    /* 通过队列存储待处理目录及其深度。 */ const queue = [{ directory: start, depth: 0 }];
    /* 保存有限数量的枚举结果。 */ const entries: FileEntry[] = [];
    /* 记录实际读取目录数量，避免宽目录树导致无限扫描。 */ let visited = 0;
    /* 把被忽略的条目也计入枚举预算，避免大量隐藏文件绕过扫描限制。 */ let scannedEntries = 0;
    /* 记录是否因任何边界限制而省略结果。 */ let truncated = false;
    /* 逐个处理待扫描目录，不对整个目录树创建无限 Promise。 */ while (queue.length) {
      /* 每轮扫描前允许用户中断。 */ checkCancelled(signal);
      /* 达到目录、返回条目或枚举总数上限时立即结束。 */ if (visited >= TOOL_LIMITS.maxDirectories || entries.length >= TOOL_LIMITS.maxFiles || scannedEntries >= TOOL_LIMITS.maxEntries) { truncated = true; break; }
      /* 取出队首目录，广度优先能优先展示项目顶层结构。 */ const current = queue.shift()!;
      /* 增加目录计数以控制扫描成本。 */ visited += 1;
      /* 再次解析排队后的目录，避免依赖早先的路径检查结果。 */ const safeDirectory = await resolveSafe(displayPath(current.directory));
      /* 用流式目录句柄读取条目，避免一次载入超大目录的全部元数据。 */ const children = await opendir(safeDirectory);
      /* 异步迭代器在正常结束、break 或抛错时自动关闭目录句柄。 */ for await (const child of children) {
        /* 高频文件循环也需要检查取消。 */ checkCancelled(signal);
        /* 对忽略条目也实施枚举数量上限。 */ if (scannedEntries >= TOOL_LIMITS.maxEntries) { truncated = true; break; }
        /* 记录已经检查的目录项数量。 */ scannedEntries += 1;
        /* 忽略敏感名称与所有枚举出的符号链接，避免循环和越界扫描。 */ if (isIgnored(child.name) || child.isSymbolicLink() || (!child.isFile() && !child.isDirectory())) continue;
        /* 所有目录项共用总量限制，因此目录和文件数量均有上界。 */ if (entries.length >= TOOL_LIMITS.maxFiles) { truncated = true; break; }
        /* 构造当前条目的绝对路径，仅用于本地文件访问。 */ const absolute = path.join(safeDirectory, child.name);
        /* 向外只返回相对路径与简单类型。 */ entries.push({ path: displayPath(absolute), type: child.isDirectory() ? "directory" : "file" });
        /* 只有普通目录且深度未超限时才继续下探。 */ if (child.isDirectory() && current.depth < TOOL_LIMITS.maxDepth) queue.push({ directory: absolute, depth: current.depth + 1 });
        /* 超过深度限制的目录仍展示名称，但声明内容未完全扫描。 */ else if (child.isDirectory()) truncated = true;
      /* 结束一个目录中的条目处理。 */ }
    /* 结束有界目录遍历。 */ }
    /* 对有界结果排序，方便界面和测试稳定展示。 */ entries.sort((left, right) => left.path.localeCompare(right.path));
    /* 把完整性标记与结果一起返回，避免把截断结果说成全部文件。 */ return { entries, truncated };
  /* 结束遍历辅助函数。 */ }
  /* 对外提供列目录工具，并严格检查其唯一可选参数。 */ async function listFiles(value: unknown = {}) {
    /* 验证输入为键值对象。 */ const input = objectInput(value);
    /* list_files 只允许 path 参数。 */ knownKeys(input, ["path"]);
    /* 执行有界扫描，未指定路径时使用工作目录根部。 */ return walk(input.path ?? ".");
  /* 结束列目录工具。 */ }
  /* 读取一个有限大小的文本文件。 */ async function readFile(value: unknown) {
    /* 验证读取参数对象。 */ const input = objectInput(value);
    /* 禁止通过参数额外指定编码、权限或读取上限。 */ knownKeys(input, ["path"]);
    /* 读取文件必须明确提供路径。 */ if (typeof input.path !== "string") throw new Error("read_file 缺少 path");
    /* 校验真实路径是否属于工作目录并排除敏感名称。 */ const absolute = await resolveSafe(input.path);
    /* 以只读模式打开文件，不创建或覆盖任何内容。 */ const handle = await open(absolute, "r");
    /* 确保成功、失败或取消时都释放文件句柄。 */ try {
      /* 对已经打开的文件获取大小和类型，而不是只依赖之前的路径状态。 */ const metadata = await handle.stat();
      /* 只读取普通文件，拒绝目录和特殊设备。 */ if (!metadata.isFile()) throw new Error("只能读取普通文件");
      /* 拒绝超过字节上限的文件，避免把大文件全部载入内存。 */ if (metadata.size > TOOL_LIMITS.maxBytes) throw new Error(`文件超过 ${TOOL_LIMITS.maxBytes} 字节读取上限`);
      /* 分配有硬上限的缓冲区，多读一个字节以检测读取期间文件变大。 */ const buffer = Buffer.alloc(TOOL_LIMITS.maxBytes + 1);
      /* 记录已经读取的总字节数。 */ let total = 0;
      /* 文件读取可能分多次完成，因此循环读取至结束或上限。 */ while (total < buffer.length) {
        /* 每个读取批次之间检查取消。 */ checkCancelled(signal);
        /* 读取剩余容量内的数据，保持内存大小不随文件增长。 */ const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
        /* 文件结束时退出读取循环。 */ if (!bytesRead) break;
        /* 更新实际读取字节计数。 */ total += bytesRead;
      /* 结束有界文件读取。 */ }
      /* 检测文件在打开之后增长并超过限制的情况。 */ if (total > TOOL_LIMITS.maxBytes) throw new Error(`文件超过 ${TOOL_LIMITS.maxBytes} 字节读取上限`);
      /* 只检查实际读取到的部分，排除缓冲区未写入区域。 */ const data = buffer.subarray(0, total);
      /* 采用简单的空字节判断跳过常见二进制文件，UTF-16 也不会作为 UTF-8 误读。 */ if (data.includes(0)) throw new Error("仅支持 UTF-8 文本文件");
      /* 将字节解码为 UTF-8 文本。 */ const text = data.toString("utf8");
      /* 读取完成后检查取消，防止边界时刻返回迟到内容。 */ checkCancelled(signal);
      /* 返回受字符上限约束的内容，并告诉调用方是否截断。 */ return { path: displayPath(absolute), content: text.slice(0, TOOL_LIMITS.maxText), truncated: text.length > TOOL_LIMITS.maxText };
    /* 无论读取结果如何都进入清理阶段。 */ } finally {
      /* 释放操作系统文件句柄。 */ await handle.close();
    /* 结束文件句柄清理。 */ }
  /* 结束文本读取工具。 */ }
  /* 在有限数量文本文件内执行不区分大小写的字面量搜索。 */ async function searchText(value: unknown) {
    /* 验证搜索参数为对象。 */ const input = objectInput(value);
    /* 只允许查询文本与起始路径，禁止模型调整资源限制。 */ knownKeys(input, ["query", "path"]);
    /* 限制查询长度并拒绝空白搜索。 */ if (typeof input.query !== "string" || !input.query.trim() || input.query.length > 200) throw new Error("query 必须是 1 至 200 字符的非空文本");
    /* 统一查询大小写，使用字面量匹配避免正则表达式资源风险。 */ const query = input.query.toLowerCase();
    /* 使用与列目录相同的边界和忽略规则。 */ const listing = await walk(input.path ?? ".");
    /* 保存有限数量的路径、行号和命中文本。 */ const matches: Array<{ path: string; line: number; text: string }> = [];
    /* 累积遍历和文件读取产生的截断标记。 */ let truncated = listing.truncated;
    /* 统计因大小、编码或权限等问题跳过的文件。 */ let skippedFiles = 0;
    /* 逐个读取文件，避免无限并发消耗文件句柄。 */ for (const entry of listing.entries) {
      /* 目录自身没有文本内容。 */ if (entry.type !== "file") continue;
      /* 每个文件之前检查取消。 */ checkCancelled(signal);
      /* 单个文件失败可以跳过，取消则必须向上抛出。 */ try {
        /* 复用安全读取逻辑，不能绕过文件大小和真实路径校验。 */ const file = await readFile({ path: entry.path });
        /* 字符截断意味着搜索结果可能不完整。 */ truncated ||= file.truncated;
        /* 拆分行以返回面向阅读的行号。 */ const lines = file.content.split(/\r?\n/);
        /* 按行查找关键词。 */ for (let index = 0; index < lines.length; index += 1) {
          /* 未命中的行无需加入结果。 */ if (!lines[index].toLowerCase().includes(query)) continue;
          /* 保存从 1 开始的行号和有长度上限的文本。 */ matches.push({ path: entry.path, line: index + 1, text: lines[index].slice(0, TOOL_LIMITS.maxLine) });
          /* 达到结果上限时立即返回，并保守标记可能还有更多结果。 */ if (matches.length >= TOOL_LIMITS.maxResults) return { matches, truncated: true, skippedFiles };
        /* 结束当前文件的逐行匹配。 */ }
      /* 处理单个文件的读取异常。 */ } catch {
        /* 取消不能被当成普通文件失败吞掉。 */ checkCancelled(signal);
        /* 记录跳过数量供界面与模型解释搜索覆盖范围。 */ skippedFiles += 1;
      /* 结束当前文件的异常处理。 */ }
    /* 结束有界全文搜索。 */ }
    /* 返回结果和覆盖范围信息。 */ return { matches, truncated, skippedFiles };
  /* 结束搜索工具。 */ }
  /* 将模型给出的工具名称映射到唯一允许的本地实现。 */ async function invoke(name: string, args: unknown): Promise<unknown> {
    /* 调用前检查取消。 */ checkCancelled(signal);
    /* 仅允许访问已经列出的三个只读工具。 */ switch (name) {
      /* 执行目录列表并保持同一套参数校验。 */ case "list_files": return listFiles(args);
      /* 执行文本读取。 */ case "read_file": return readFile(args);
      /* 执行字面量搜索。 */ case "search_text": return searchText(args);
      /* 明确拒绝未知工具，模型文本不能注册新工具或扩大权限。 */ default: throw new Error("不允许调用未知工具");
    /* 结束工具分发。 */ }
  /* 结束通用工具调用函数。 */ }
  /* 仅导出受保护的操作，不向调用方暴露文件句柄或绝对根路径。 */ return { listFiles, readFile, searchText, invoke };
/* 结束只读工具集合的创建。 */ }
