/**
 * 加载时新旧数据协调决策（F3，R4/X1 根因修复）
 *
 * 场景：页面加载，localStorage 缓存与服务器数据同时存在，谁赢？
 *
 * 决策优先级（高 → 低）：
 * 1. sessionEdited：本次会话内用户已编辑（GET 返回前 canvas 引用已变化）
 *    → 本地胜。修复 X1 加载竞态：慢网下用户先编辑、后返回的旧服务器数据
 *      不得覆盖用户刚做的编辑。
 * 2. dirtySavedAt：上次会话结束时存在未成功同步到服务器的本地修改
 *    （hook 在用户编辑时写入 meta，保存成功后清除）
 *    → 若本地最后编辑时间明显晚于服务器更新时间（超出时钟偏差宽限），
 *      本地胜。修复 R4：防止旧的服务器数据覆盖因 PUT 失败滞留的新本地数据。
 * 3. 其他情况 → 服务器胜（服务器是最新保存，localStorage 仅缓存）。
 */
export type LoadDecision =
  /** 服务器数据覆盖本地（正常路径） */
  | { action: "use-server" }
  /** 保留本地（上次会话有未同步修改，R4 修复） */
  | { action: "keep-local" }
  /** 保留本地（本次会话已编辑，X1 加载竞态修复） */
  | { action: "keep-local-edited" };

/** 时钟偏差宽限：本地时间与服务器时间均为客户端时钟记录，留 5s 余量 */
export const DEFAULT_RECONCILE_TOLERANCE_MS = 5000;

export interface ReconcileInput {
  /** localStorage 中是否存在画布数据 */
  hasLocalCanvas: boolean;
  /** localStorage dirty meta 中的最后编辑时间戳；无未同步修改时为 null */
  dirtySavedAt: number | null;
  /** 服务器返回的 updatedAt（ISO 字符串）；服务器无数据时为 null */
  serverUpdatedAt: string | null;
  /** 本次会话内用户是否已编辑（GET 返回前 canvas 引用已变化） */
  sessionEdited: boolean;
  /** 时钟偏差宽限毫秒数 */
  toleranceMs?: number;
}

/**
 * 纯函数：决定加载后采用哪份数据
 */
export function reconcileOnLoad(input: ReconcileInput): LoadDecision {
  const { hasLocalCanvas, dirtySavedAt, serverUpdatedAt, sessionEdited } = input;

  // 本地无数据：无条件采用服务器（含服务器也为空的情况，保持初始空状态）
  if (!hasLocalCanvas) return { action: "use-server" };

  // 会话内已编辑：本地胜（最高优先级，防止慢网加载竞态覆盖用户编辑）
  if (sessionEdited) return { action: "keep-local-edited" };

  // 本地存在未同步修改：比较本地最后编辑时间与服务器更新时间
  if (dirtySavedAt != null) {
    if (serverUpdatedAt == null) {
      // 服务器无数据而本地有未同步修改：本地胜
      return { action: "keep-local" };
    }
    const tolerance = input.toleranceMs ?? DEFAULT_RECONCILE_TOLERANCE_MS;
    const serverTime = new Date(serverUpdatedAt).getTime();
    if (Number.isFinite(serverTime) && dirtySavedAt - serverTime > tolerance) {
      // 本地最后编辑时间明显晚于服务器更新：本地胜（上次 PUT 失败的滞留数据）
      return { action: "keep-local" };
    }
  }

  // 默认：服务器是最新保存，覆盖本地缓存
  return { action: "use-server" };
}
