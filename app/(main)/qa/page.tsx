import { redirect } from "next/navigation";

/**
 * AI 问答已合并至画布卡片对话框
 * /qa 重定向到 /canvas
 */
export default function QAPage() {
  redirect("/canvas");
}
