/**
 * 数据导入工具（TypeScript 重写）
 * 对标原 Python 项目 src/reader.py + src/processor.py
 *
 * 功能：
 * 1. 读取原 LearnForge 数据包格式（pack.json + data/*.json）
 * 2. 解析数据结构映射（key_map / type_map）
 * 3. 整合并转换为统一卡片格式
 * 4. 写入新数据库
 *
 * 兼容性：支持原 Python 项目的数据包目录结构
 *
 * ============================================================
 * 设计文档：.doc/WORD_LEARNING_DESIGN.md §5
 * 关键约束：
 *   - 禁止删除原始数据：ImportLayout.rawItem 必须完整保存原始 item JSON
 *   - ImportPack.rawConfig 必须完整保存 pack.json
 *   - 卡片删除时 ImportLayout.cardId 设为 null（onDelete: SetNull），布局记录保留
 *   - 不提供任何"清理原始数据"的 API
 * ============================================================
 */
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db/prisma";
import { getLogger } from "@/lib/utils/logger";
import { cardService } from "@/lib/services/cards/service";
import type { CreateCardInput } from "@/lib/services/cards/types";
import type { HierarchyTags } from "@/lib/learning/types";

const logger = getLogger("ImportService");

// ============ 原 Python 数据包格式定义 ============

/** 数据包配置文件 pack.json（标准格式） */
interface PackConfig {
  information: {
    name: string;
    description?: string;
    uuid?: string;
    type: "words_pack" | "sentence_pack" | "compound_pack";
  };
  structure: {
    entrance: string; // 数据文件夹入口，如 "data"
    key_map: {
      word: string; // 单词数组的键名
      type?: string; // 词性字段路径
      mean?: string; // 释义字段路径
      sentence?: string; // 例句字段路径
    };
  };
  type_map?: Record<string, string[]>; // 词性映射
}

/**
 * 兼容格式的 config.json（用户实际数据格式）
 *
 * 与标准 PackConfig 的差异：
 *   - 无 information 字段（name/type 由目录名推断）
 *   - 无 structure.entrance 字段（数据文件直接在 packDir 下）
 *   - key_map 在 words.key_map 下，而非 structure.key_map
 *   - 顶层 type_map 用于词性映射
 */
interface CompatConfig {
  type_map?: Record<string, string[]>;
  words?: {
    path?: string;
    key_map?: {
      word?: string;
      type?: string;
      mean?: string;
      sentence?: string;
    };
  };
}

/** 原 Python 数据文件结构 */
interface LegacyDataFile {
  type: string; // word | phrase
  uuid?: string;
  data: Array<{
    name: string;
    type?: string;
    mean?: string[];
    sentence?: string[];
  }>;
}

// ============ 读取器（对标 reader.py）============

/**
 * 扫描目录下所有 JSON 文件
 */
function scanJsonFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  const result: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(".json")) {
        result.push(fullPath);
      }
    }
  };
  walk(directory);
  return result;
}

/**
 * 读取并解析数据包
 * 对标 Python DataPackReader.read_all_files
 */
export interface ReadResult {
  packName: string;
  packType: string;
  files: Array<{
    filename: string;
    type: string;
    uuid: string;
    items: Array<{
      name: string;
      type?: string;
      mean?: string[];
      sentence?: string[];
    }>;
  }>;
  stats: { wordCount: number; phraseCount: number; fileCount: number };
}

export function readDataPack(packDir: string): ReadResult | null {
  // ===== 1. 探测配置文件：优先 pack.json（标准格式），回退 config.json（兼容格式）=====
  //         兼容格式的 config.json 可能位于 packDir 或其上级目录（datapacks/）
  const packJsonPath = path.join(packDir, "pack.json");
  const configJsonPath = path.join(packDir, "config.json");
  const parentConfigJsonPath = path.join(
    path.dirname(packDir),
    "config.json"
  );

  let packName: string;
  let packType: string;
  let entrance: string; // 数据文件夹入口（绝对路径）
  let configSource: "pack" | "config" | "parent_config";

  if (fs.existsSync(packJsonPath)) {
    // 1.1 标准格式：pack.json + structure.entrance
    const config: PackConfig = JSON.parse(fs.readFileSync(packJsonPath, "utf-8"));
    packName = config.information.name;
    packType = config.information.type;
    entrance = path.join(packDir, config.structure.entrance);
    configSource = "pack";
  } else if (fs.existsSync(configJsonPath)) {
    // 1.2 兼容格式 A：config.json 与数据文件同目录
    //      （如 datapacks/SZFL-Hz-1/config.json + datapacks/SZFL-Hz-1/*.json）
    packName = path.basename(packDir);
    packType = "words_pack";
    entrance = packDir;
    configSource = "config";
  } else if (fs.existsSync(parentConfigJsonPath)) {
    // 1.3 兼容格式 B：config.json 在上级目录，数据文件在 packDir 下
    //      （如 datapacks/config.json + datapacks/SZFL-Hz-1/*.json）
    packName = path.basename(packDir);
    packType = "words_pack";
    entrance = packDir;
    configSource = "parent_config";
    logger.info("使用上级目录 config.json", {
      packDir,
      parentConfig: parentConfigJsonPath,
    });
  } else {
    logger.warn("未找到 pack.json 或 config.json", { packDir });
    return null;
  }

  // ===== 2. 扫描数据文件 =====
  // 注意：scanJsonFiles 会递归扫描，需排除 config.json / pack.json 自身
  const allJsonFiles = scanJsonFiles(entrance);
  const jsonFiles = allJsonFiles.filter((fp) => {
    const basename = path.basename(fp).toLowerCase();
    return basename !== "pack.json" && basename !== "config.json";
  });

  if (configSource !== "pack") {
    logger.info("使用兼容格式读取数据包", {
      packDir,
      packName,
      configSource,
      fileCount: jsonFiles.length,
    });
  }

  const files: ReadResult["files"] = [];
  let wordCount = 0;
  let phraseCount = 0;

  for (const filePath of jsonFiles) {
    try {
      const fileData: LegacyDataFile = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      const filename = path.basename(filePath);
      const fileType = fileData.type || "word";
      const items = fileData.data || [];

      if (fileType === "word") wordCount += items.length;
      else if (fileType === "phrase") phraseCount += items.length;

      files.push({
        filename,
        type: fileType,
        uuid: fileData.uuid || "",
        items,
      });
    } catch (err) {
      logger.warn("解析文件失败", { filePath, error: String(err) });
    }
  }

  logger.info("数据包读取完成", {
    pack: packName,
    files: files.length,
    words: wordCount,
    phrases: phraseCount,
  });

  return {
    packName,
    packType,
    files,
    stats: { wordCount, phraseCount, fileCount: files.length },
  };
}

/**
 * 读取数据包配置文件完整内容（用于写入 ImportPack.rawConfig）
 *
 * 设计文档 §5.2 / §5.4：
 *   - ImportPack.rawConfig 永久保存原始 pack.json / config.json
 *   - 任何后续计算只读取不删除
 *
 * 兼容策略（与 readDataPack 一致）：
 *   - 优先读 packDir/pack.json（标准格式）
 *   - 回退读 packDir/config.json（兼容格式 A）
 *   - 再回退读上级目录 config.json（兼容格式 B，如 datapacks/config.json）
 *   - 都无则返回空对象（不阻塞导入）
 *
 * @param packDir 数据包目录
 * @returns 完整的配置文件解析对象；若都不存在返回空对象
 */
export function readPackJson(packDir: string): Record<string, unknown> {
  // 1. 优先读 packDir/pack.json
  const packJsonPath = path.join(packDir, "pack.json");
  if (fs.existsSync(packJsonPath)) {
    try {
      return JSON.parse(fs.readFileSync(packJsonPath, "utf-8"));
    } catch (err) {
      logger.warn("readPackJson: pack.json 解析失败", { packDir, error: String(err) });
    }
  }
  // 2. 回退读 packDir/config.json
  const configJsonPath = path.join(packDir, "config.json");
  if (fs.existsSync(configJsonPath)) {
    try {
      return JSON.parse(fs.readFileSync(configJsonPath, "utf-8"));
    } catch (err) {
      logger.warn("readPackJson: config.json 解析失败", { packDir, error: String(err) });
    }
  }
  // 3. 再回退读上级目录 config.json
  const parentConfigJsonPath = path.join(path.dirname(packDir), "config.json");
  if (fs.existsSync(parentConfigJsonPath)) {
    try {
      return JSON.parse(fs.readFileSync(parentConfigJsonPath, "utf-8"));
    } catch (err) {
      logger.warn("readPackJson: 上级 config.json 解析失败", {
        packDir,
        error: String(err),
      });
    }
  }
  // 4. 都无：返回空对象（不阻塞导入，仅 rawConfig 为空）
  logger.warn("readPackJson: 未找到任何配置文件", { packDir });
  return {};
}

/**
 * 从原始布局信息提取层级标签（软相关性基础）
 *
 * 设计文档 §5.2 / §5.3：
 *   层级结构 pack → file(单元) → item(单词位置)，
 *   导入时将 packName/fileName/fileType/order 序列化为 JSON
 *   存入 ImportLayout.hierarchyTags，作为后续软相关性向量化（§5.3）的输入。
 *
 * @param packName 数据包名（如 SZFL-HZ-1）
 * @param fileName 文件名（如 1.json，对应"单元1"）
 * @param fileType 文件类型（word | phrase）
 * @param order    在原文件中的顺序索引
 * @returns HierarchyTags 对象（待 JSON.stringify 后存入 ImportLayout.hierarchyTags）
 */
export function extractHierarchyTags(
  packName: string,
  fileName: string,
  fileType: string,
  order: number
): HierarchyTags {
  return {
    pack: packName,
    unit: fileName,
    fileType,
    order,
  };
}

// ============ 处理器（对标 processor.py）============

/**
 * 同 fileName 内按 name 合并同名词多词性
 *
 * 应用场景：1.json 中 "alarm" 同时以 noun / verb 出现两条记录，
 *           应合并为一张 Card，避免同名词被重复创建。
 *
 * 合并策略：
 *   - name: 保持不变（作为 Card.title 唯一标识）
 *   - type: 多词性用 "/" 拼接，如 "noun/verb"；单一词性保持原值
 *   - mean: 多条记录的释义数组去重合并（保留首次出现顺序）
 *   - sentence: 多条记录的例句数组去重合并（保留首次出现顺序）
 *
 * @param items 原始 items（同 fileName 内）
 * @returns 合并后的 items（同 name 仅保留一条）
 */
function mergeItemsByName(
  items: ReadResult["files"][0]["items"]
): ReadResult["files"][0]["items"] {
  const merged = new Map<string, ReadResult["files"][0]["items"][0]>();

  for (const item of items) {
    const existing = merged.get(item.name);
    if (!existing) {
      // 首次出现：直接放入
      merged.set(item.name, { ...item });
      continue;
    }

    // 已存在：合并字段
    // 1) 词性合并：去重后用 "/" 拼接
    if (item.type && item.type !== existing.type) {
      const existingTypes = (existing.type ?? "").split("/").filter(Boolean);
      if (!existingTypes.includes(item.type)) {
        existingTypes.push(item.type);
      }
      existing.type = existingTypes.join("/");
    }

    // 2) 释义合并：去重保留顺序
    if (item.mean?.length) {
      const existingMeans = existing.mean ?? [];
      const seen = new Set(existingMeans);
      for (const m of item.mean) {
        if (!seen.has(m)) {
          existingMeans.push(m);
          seen.add(m);
        }
      }
      existing.mean = existingMeans;
    }

    // 3) 例句合并：去重保留顺序
    if (item.sentence?.length) {
      const existingSentences = existing.sentence ?? [];
      const seen = new Set(existingSentences);
      for (const s of item.sentence) {
        if (!seen.has(s)) {
          existingSentences.push(s);
          seen.add(s);
        }
      }
      existing.sentence = existingSentences;
    }
  }

  return Array.from(merged.values());
}

/**
 * 将原数据项转换为新卡片创建输入
 */
function convertToCardInput(
  item: ReadResult["files"][0]["items"][0],
  fileType: string,
  subjectId: string | undefined
): CreateCardInput {
  const cardType = fileType === "phrase" ? "phrase" : "word";

  return {
    title: item.name,
    content: buildCardContent(item),
    type: cardType,
    subjectId,
    difficulty: 1,
    status: "new",
    source: "imported",
    metadata: { importedFrom: "legacy_datapack" },
    phonetic: cardType === "word" ? undefined : undefined,
    partOfSpeech: item.type,
    meanings: item.mean || [],
    sentences: item.sentence || [],
    // CreateCardSchema 中 latexFormulas 有 default([])，但 z.infer 推导为输出类型必填，
    // 这里显式提供空数组以满足类型约束（单词数据包无 LaTeX 公式）
    latexFormulas: [],
    tagIds: [],
  };
}

/**
 * 构建卡片内容（Markdown 格式）
 */
function buildCardContent(item: ReadResult["files"][0]["items"][0]): string {
  const parts: string[] = [`# ${item.name}`];
  if (item.type) parts.push(`**词性：** ${item.type}`);
  if (item.mean?.length) {
    parts.push(`**释义：**`);
    item.mean.forEach((m, i) => parts.push(`${i + 1}. ${m}`));
  }
  if (item.sentence?.length) {
    parts.push(`**例句：**`);
    item.sentence.forEach((s) => parts.push(`- ${s}`));
  }
  return parts.join("\n");
}

/**
 * 导入数据包到数据库
 *
 * 设计文档 §5.2 适配方案：
 *   1. 调用 readDataPack 读取数据
 *   2. 创建 ImportPack 记录（name=packName, packType, rawConfig=完整 pack.json, fileCount, wordCount）
 *   3. 遍历 files 和 items，对每个 item：
 *      - 调用 cardService.create 创建 Card（复用现有 convertToCardInput）
 *      - 创建 ImportLayout 记录（packId, cardId, fileName, fileType, itemOrder=索引, itemUuid, hierarchyTags, rawItem=JSON.stringify(item)）
 *      - 若 card.type 是 word/phrase，创建 WordProfile 记录（cardId, length=item.name 去空格后的长度）
 *   4. 返回 { imported, skipped, packId }
 *
 * 向后兼容：原有的 imported/skipped 返回字段保留，新增 packId 字段
 *
 * @param packDir   数据包目录
 * @param userId    用户 ID（用于 cardService.create 关联）
 * @param subjectId 可选学科 ID
 */
export async function importDataPack(
  packDir: string,
  userId: string,
  subjectId?: string
): Promise<{ imported: number; skipped: number; packId: string | null }> {
  // 1. 读取数据包（保留现有读取器逻辑）
  const result = readDataPack(packDir);
  if (!result) {
    return { imported: 0, skipped: 0, packId: null };
  }

  // 2. 读取 pack.json 完整配置（禁止删除原始数据约束）
  const rawConfig = readPackJson(packDir);

  // 3. 创建 ImportPack 记录（完整保留原始配置）
  //    - packType: words_pack | sentence_pack | compound_pack
  //    - rawConfig: 完整 pack.json，序列化为字符串永久保存
  //    - fileCount/wordCount: 来自 readDataPack 统计
  const pack = await prisma.importPack.create({
    data: {
      name: result.packName,
      packType: result.packType,
      rawConfig: JSON.stringify(rawConfig),
      fileCount: result.stats.fileCount,
      wordCount: result.stats.wordCount,
      sourcePath: packDir,
    },
  });

  let imported = 0;
  let skipped = 0;

  // 跨 fileName 同名词去重集合：记录已成功导入的 name（小写归一化）
  // 策略：同名词仅在首次出现时创建 Card，后续 fileName 中的同名记录跳过
  //       （避免跨文件重复创建同 title 的 Card，WordProfile.cardId 唯一约束也会失败）
  const importedNames = new Set<string>();

  // 4. 遍历 files 和 items，逐项写入 Card + ImportLayout + WordProfile
  for (const file of result.files) {
    // 4.0 同 fileName 内合并同名词多词性
    //     例：1.json 中 "alarm" 同时为 noun/verb，合并为一条
    const mergedItems = mergeItemsByName(file.items);

    for (let i = 0; i < mergedItems.length; i++) {
      const item = mergedItems[i];
      const normalizedTitle = item.name.trim().toLowerCase();

      // 4.0.1 跨 fileName 同名词跳过
      if (importedNames.has(normalizedTitle)) {
        logger.debug("跨文件重复词跳过", {
          name: item.name,
          fileName: file.filename,
        });
        skipped++;
        continue;
      }

      try {
        // 4.1 创建 Card（复用现有 cardService.create + convertToCardInput）
        const card = await cardService.create(
          userId,
          convertToCardInput(item, file.type, subjectId)
        );

        // 4.2 写 ImportLayout（保留原始布局作为软相关性基础）
        //     - itemOrder=i：原始顺序，供 §5.3 邻接加成计算使用
        //     - itemUuid=file.uuid：原始文件级 uuid，便于追溯
        //     - hierarchyTags：层级标签 JSON（pack/unit/fileType/order）
        //     - rawItem：原始 item 完整快照（禁止删除，便于追溯与重建）
        const hierarchyTags = extractHierarchyTags(
          result.packName,
          file.filename,
          file.type,
          i
        );
        await prisma.importLayout.create({
          data: {
            packId: pack.id,
            cardId: card.id,
            fileName: file.filename,
            fileType: file.type,
            itemOrder: i,
            itemUuid: file.uuid || null,
            hierarchyTags: JSON.stringify(hierarchyTags),
            rawItem: JSON.stringify(item),
          },
        });

        // 4.3 初始化 WordProfile（仅 word/phrase 类型，与 Card 1:1）
        //     - length: 单词字母长度（去空格，冗余存储加速查询）
        if (card.type === "word" || card.type === "phrase") {
          await prisma.wordProfile.create({
            data: {
              cardId: card.id,
              length: item.name.replace(/\s/g, "").length,
            },
          });
        }

        // 4.4 记录已导入的 name（用于跨 fileName 去重）
        importedNames.add(normalizedTitle);
        imported++;
      } catch (err) {
        logger.warn("导入失败", { name: item.name, error: String(err) });
        skipped++;
      }
    }
  }

  logger.info("数据包导入完成", {
    pack: result.packName,
    packId: pack.id,
    imported,
    skipped,
    uniqueNames: importedNames.size,
  });

  return { imported, skipped, packId: pack.id };
}

/**
 * 批量导入 datapacks 目录下所有数据包
 *
 * 向后兼容：保留 totalImported/totalSkipped/packs 字段
 * 新增：packIds 数组（每个数据包的 ImportPack.id），便于上层 API 触发软相关性构建
 *
 * @param datapacksDir 数据包根目录（每个子目录为一个 pack）
 * @param userId       用户 ID
 * @param subjectId    可选学科 ID
 */
export async function importAllDataPacks(
  datapacksDir: string,
  userId: string,
  subjectId?: string
): Promise<{
  totalImported: number;
  totalSkipped: number;
  packs: number;
  packIds: string[];
}> {
  if (!fs.existsSync(datapacksDir)) {
    throw new Error(`数据包目录不存在：${datapacksDir}`);
  }

  const packDirs = fs
    .readdirSync(datapacksDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(datapacksDir, e.name));

  let totalImported = 0;
  let totalSkipped = 0;
  const packIds: string[] = [];

  for (const packDir of packDirs) {
    const result = await importDataPack(packDir, userId, subjectId);
    totalImported += result.imported;
    totalSkipped += result.skipped;
    if (result.packId) packIds.push(result.packId);
  }

  return {
    totalImported,
    totalSkipped,
    packs: packDirs.length,
    packIds,
  };
}
