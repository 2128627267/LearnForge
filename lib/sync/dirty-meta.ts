/**
 * 画布未同步修改标记（F3，R4 根因修复）
 *
 * 语义：localStorage 中记录"本地最后一次未成功同步到服务器的编辑时间"。
 * - 用户编辑画布时写入（savedAt = 编辑时刻）
 * - 服务器保存成功后清除
 * - 下次会话加载时用于新旧协调（reconcileOnLoad）：
 *   若本地最后编辑时间明显晚于服务器更新时间 → 保留本地并推送服务器
 *
 * 采用独立 key 而非嵌入画布数据：保持 CANVAS_STORAGE_KEY 的数据结构
 * 向后兼容（旧版本写入的裸 CanvasState 无需迁移）。
 */

/** dirty meta 的 localStorage key */
export const DIRTY_META_KEY = "learnforge-canvas-dirty";

/**
 * 读取未同步修改时间戳
 * @returns 最后编辑时间戳；无标记或数据损坏时返回 null
 */
export function readDirtyMeta(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DIRTY_META_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: unknown };
    return typeof parsed?.savedAt === "number" ? parsed.savedAt : null;
  } catch {
    // 损坏数据视为无标记（不阻塞主流程）
    return null;
  }
}

/**
 * 写入未同步修改时间戳
 * @param at 编辑时刻（Date.now()）
 */
export function writeDirtyMeta(at: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      DIRTY_META_KEY,
      JSON.stringify({ savedAt: at })
    );
  } catch {
    // localStorage 写入失败（隐私模式/quota 超限）：静默降级
    // 后果仅是跨会话协调退回"服务器优先"，当前会话保存不受影响
  }
}

/**
 * 清除未同步修改标记（服务器保存成功后调用）
 */
export function clearDirtyMeta(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DIRTY_META_KEY);
  } catch {
    /* 忽略 removeItem 错误 */
  }
}
