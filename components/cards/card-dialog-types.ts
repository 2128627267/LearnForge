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

/** 批量创建时的连线关系（支持任意节点间连线） */
export interface CreateRelation {
  /** 起点：本批次其他 item 的索引字符串（如 "0"）或画布已有节点 id；缺省用 sourceId */
  from?: string;
  /** 终点：本批次 item 索引（如 "0"）或画布已有节点 id；缺省为当前创建的节点 */
  to?: string;
  /** 关系线标签（如"延伸拓展"、"派生"） */
  label?: string;
}

/** AI 批量创建节点的描述（可带 sourceId 与任意连线关系） */
export interface CreateNodeItem {
  data: Partial<FreeCardData>;
  position?: { x: number; y: number };
  /** 若提供，则创建从该节点到新节点的关系线 */
  sourceId?: string;
  /** 关系线标签（如"延伸拓展"） */
  relationLabel?: string;
  /** 任意连线关系（from/to 支持本批次索引或已有节点 id） */
  relations?: CreateRelation[];
}
