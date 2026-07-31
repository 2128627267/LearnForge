import type { FreeCardData } from "./free-card-node";
import type { LearningMode } from "@/lib/hooks/use-card-dialog-draft";

/** 卡片对话框打开状态 */
export type CardDialogState =
  | { mode: "create" }
  | { mode: "edit"; nodeId: string }
  | { mode: "ai"; nodeId: string };

/** 保存到画布节点的载荷 */
export interface CardDialogPayload {
  title: string;
  content: string;
  tags: string[];
  color: string;
  learningMode: LearningMode;
  width: number;
}

/** AI 批量创建节点的描述（可带 sourceId 与关系线标签） */
export interface CreateNodeItem {
  data: Partial<FreeCardData>;
  position?: { x: number; y: number };
  /** 若提供，则创建从该节点到新节点的关系线 */
  sourceId?: string;
  /** 关系线标签（如"延伸拓展"） */
  relationLabel?: string;
}
