import { redirect } from "next/navigation";

/**
 * 首页：跳转到统计页面
 * 统计页面已设为默认打开项（提供学习数据概览）
 */
export default function HomePage() {
  redirect("/stats");
}
