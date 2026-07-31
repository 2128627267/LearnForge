/**
 * 画布数据导出适配器
 *
 * 将知识卡片画布（CanvasState）转换为两种可被单词学习系统消费的格式：
 * 1. 单词树（WordTreeExport）：保留节点与连接关系，体现"衍生"结构
 * 2. 学习数据包（LearnPackExport）：兼容 data_packs.json 格式，可被 importDataPack 导入
 *
 * 设计原则：
 * - 不修改原始画布数据（只读转换）
 * - 从 FreeCardData.content（markdown）启发式解析释义/例句
 * - 导出格式自描述（含 format/version 字段），便于未来扩展
 */

import type { CanvasState } from "@/lib/hooks/use-local-storage";

// ==================== 类型定义 ====================

/** 画布节点数据（FreeCardData 的可序列化子集） */
export interface CanvasNodeData {
  title: string;
  content: string;
  tags: string[];
  color?: string;
  /** 是否收藏（extractNodeData 总是用 Boolean() 转换，确保非 undefined） */
  favorite: boolean;
}

/**
 * 单词树导出格式
 * 保留画布的节点与边（衍生关系），用于可视化单词间的连接结构
 */
export interface WordTreeExport {
  /** 格式标识 */
  format: "word-tree";
  /** 格式版本 */
  version: 1;
  /** 导出时间（ISO） */
  exportedAt: string;
  /** 数据包名称（用于导入时识别） */
  packName: string;
  /** 单词节点列表 */
  nodes: Array<{
    id: string;
    /** 单词/标题 */
    title: string;
    /** 原始内容（markdown） */
    content: string;
    /** 标签（可作为软相关性分类） */
    tags: string[];
    /** 画布位置（用于恢复布局） */
    position: { x: number; y: number };
    /** 是否收藏 */
    favorite: boolean;
  }>;
  /** 衍生关系（画布连线） */
  edges: Array<{
    source: string;
    target: string;
  }>;
  /** 画布标签集合 */
  tags: Array<{ name: string; color?: string }>;
}

/**
 * 学习数据包导出格式（兼容 data_packs.json）
 * 可被 lib/import/legacy-importer.ts 的 readDataPack 逻辑消费
 */
export interface LearnPackExport {
  [packName: string]: {
    name: string;
    description: string;
    type: "words_pack";
    /** 原始配置（保留结构信息） */
    config: {
      information: {
        name: string;
        description: string;
        type: string;
      };
      structure: {
        filename: string;
        type: string;
      }[];
    };
    /** 数据文件列表 */
    data: Array<{
      filename: string;
      type: "word" | "phrase";
      /** 单词列表 */
      words: Array<{
        name: string;
        type: string;
        /** 释义数组 */
        mean: string[];
        /** 例句数组 */
        sentence: string[];
      }>;
    }>;
  };
}

// ==================== 内部工具 ====================

/**
 * 从画布节点提取可序列化的 CanvasNodeData
 * 容错处理：data 可能缺少某些字段
 */
export function extractNodeData(data: Record<string, unknown>): CanvasNodeData {
  return {
    title: (data.title as string) || "未命名",
    content: (data.content as string) || "",
    tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
    color: data.color as string | undefined,
    favorite: Boolean(data.favorite),
  };
}

/**
 * 从 markdown content 启发式解析释义和例句
 *
 * 解析规则：
 * - 含"释义"/"mean"标记的行 → 释义
 * - 含"例句"/"sentence"标记的行 → 例句
 * - 加粗标记行（**释义：** / **例句：** 等）先归一化为纯文本标记再解析
 * - 音标/词性元信息行（**音标：** / 词性： 等）直接跳过，不计入释义或例句
 * - 无标记时，整行作为释义候选
 * - 过滤空行和纯标记行
 *
 * @returns { mean: string[], sentence: string[] }
 */
export function parseContentToLearnData(
  content: string
): { mean: string[]; sentence: string[] } {
  const mean: string[] = [];
  const sentence: string[] = [];

  if (!content) return { mean, sentence };

  const lines = content.split("\n");
  let currentSection: "mean" | "sentence" | null = null;

  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) continue;

    // 归一化加粗标记行：**释义：** apple → 释义： apple，与纯文本标记统一处理
    const boldMatch = line.match(
      /^\*\*(释义|意思|含义|mean|例句|例子|sentence|example|音标|词性)\s*[：:]\s*\*\*(.*)$/i
    );
    if (boldMatch) {
      line = `${boldMatch[1]}：${boldMatch[2].trim()}`;
    }

    // 跳过音标/词性元信息行（不计入释义或例句）
    if (/^(#+\s*)?(音标|词性)\s*[：:]/i.test(line)) {
      continue;
    }

    // 检测释义标记
    if (/^(#+\s*)?(释义|意思|含义|mean)/i.test(line)) {
      currentSection = "mean";
      // 提取标记后的内容（如 "释义： 警报" → "警报"）
      const rest = line.replace(/^(#+\s*)?(释义|意思|含义|mean)[：:]*\s*/i, "");
      if (rest) mean.push(rest);
      continue;
    }

    // 检测例句标记
    if (/^(#+\s*)?(例句|例子|sentence|example)/i.test(line)) {
      currentSection = "sentence";
      const rest = line.replace(
        /^(#+\s*)?(例句|例子|sentence|example)[：:]*\s*/i,
        ""
      );
      if (rest) sentence.push(rest);
      continue;
    }

    // 按当前分区归类
    if (currentSection === "mean") {
      mean.push(line.replace(/^[-*]\s*/, ""));
    } else if (currentSection === "sentence") {
      sentence.push(line.replace(/^[-*]\s*/, ""));
    } else {
      // 无标记时，首行作为释义
      mean.push(line.replace(/^[-*]\s*/, ""));
      currentSection = "mean";
    }
  }

  // 兜底：若完全没解析出释义，用 title 外的 content 作为释义
  if (mean.length === 0 && content.trim()) {
    mean.push(content.trim().split("\n")[0]);
  }

  return { mean, sentence };
}

/**
 * 判断节点是否为单词类卡片（用于学习数据包导出过滤）
 * 启发式：title 是纯字母（可能是英文单词）或 tags 含"单词"标记
 */
export function isWordLikeNode(nodeData: CanvasNodeData): boolean {
  const title = nodeData.title.trim();
  // 纯英文字母（含连字符/空格，如 "take off"）
  if (/^[a-zA-Z][a-zA-Z\s\-']*$/.test(title)) return true;
  // tags 含单词相关标记
  if (nodeData.tags.some((t) => /word|单词|vocab/i.test(t))) return true;
  return false;
}

// ==================== 导出函数 ====================

/**
 * 导出画布为单词树格式
 *
 * 保留所有节点（不限单词）和边（衍生关系），
 * 适用于可视化单词间的连接结构和作为学习路径导入。
 *
 * @param canvas 画布状态
 * @param packName 数据包名称（默认 "canvas-export"）
 */
export function exportWordTree(
  canvas: CanvasState,
  packName = "canvas-export"
): WordTreeExport {
  return {
    format: "word-tree",
    version: 1,
    exportedAt: new Date().toISOString(),
    packName,
    nodes: canvas.nodes.map((n) => {
      const data = extractNodeData(n.data);
      return {
        id: n.id,
        title: data.title,
        content: data.content,
        tags: data.tags,
        position: n.position,
        favorite: data.favorite,
      };
    }),
    edges: canvas.edges.map((e) => ({
      source: e.source,
      target: e.target,
    })),
    tags: canvas.tags || [],
  };
}

/**
 * 导出画布为学习数据包格式（兼容 data_packs.json）
 *
 * 仅导出单词类卡片（title 为英文或标记为单词），
 * 按 tag 分组为不同文件（单元），从 content 解析释义/例句。
 *
 * @param canvas 画布状态
 * @param packName 数据包名称（默认 "canvas-words"）
 */
export function exportToLearnPack(
  canvas: CanvasState,
  packName = "canvas-words"
): LearnPackExport {
  // 按 tag 分组单词节点（无 tag 的归入 "未分类"）
  const groups = new Map<string, typeof canvas.nodes>();

  for (const node of canvas.nodes) {
    const data = extractNodeData(node.data);
    if (!isWordLikeNode(data)) continue; // 跳过非单词卡片

    const groupKeys = data.tags.length > 0 ? data.tags : ["未分类"];
    for (const key of groupKeys) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(node);
    }
  }

  // 构建数据文件列表
  const dataFiles: LearnPackExport[string]["data"] = [];
  let fileIndex = 0;

  for (const [tagName, nodes] of groups) {
    const words = nodes.map((node) => {
      const data = extractNodeData(node.data);
      const { mean, sentence } = parseContentToLearnData(data.content);
      return {
        name: data.title,
        type: "word",
        mean: mean.length > 0 ? mean : [data.title],
        sentence,
      };
    });

    fileIndex++;
    dataFiles.push({
      filename: `${fileIndex}.json`,
      type: "word",
      words,
    });
  }

  return {
    [packName]: {
      name: packName,
      description: `从知识卡片画布导出（${new Date().toLocaleString("zh-CN")}），共 ${dataFiles.reduce((s, f) => s + f.words.length, 0)} 个单词`,
      type: "words_pack",
      config: {
        information: {
          name: packName,
          description: "画布导出的单词数据包",
          type: "words_pack",
        },
        structure: dataFiles.map((f) => ({
          filename: f.filename,
          type: f.type,
        })),
      },
      data: dataFiles,
    },
  };
}

// ==================== 浏览器下载工具 ====================

/**
 * 在浏览器中下载 JSON 文件
 * @param data 要序列化的数据
 * @param filename 文件名（不含扩展名）
 */
export function downloadJSON(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 统计画布中可导出的单词数量
 * 用于 UI 显示（如按钮提示"导出 12 个单词"）
 */
export function countExportableWords(canvas: CanvasState): number {
  return canvas.nodes.filter((n) =>
    isWordLikeNode(extractNodeData(n.data))
  ).length;
}
