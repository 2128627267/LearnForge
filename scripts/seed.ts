/**
 * 种子数据脚本
 * 初始化学科、分类、示例卡片
 * 运行：npm run db:seed
 */
import { PrismaClient } from "@prisma/client";
import { getLogger } from "../lib/utils/logger";

const prisma = new PrismaClient();
const logger = getLogger("Seed");

async function main() {
  logger.info("开始种子数据初始化...");

  // 1. 创建学科
  const english = await prisma.subject.upsert({
    where: { slug: "english" },
    update: {},
    create: {
      name: "英语",
      slug: "english",
      icon: "BookOpen",
      color: "#10b981",
      order: 1,
    },
  });

  const math = await prisma.subject.upsert({
    where: { slug: "math" },
    update: {},
    create: {
      name: "数学",
      slug: "math",
      icon: "Calculator",
      color: "#f59e0b",
      order: 2,
    },
  });

  logger.info("学科已创建", { english: english.id, math: math.id });

  // 2. 创建分类
  const vocabulary = await prisma.category.upsert({
    where: { id: "cat-vocabulary" },
    update: {},
    create: {
      id: "cat-vocabulary",
      name: "词汇",
      subjectId: english.id,
      order: 1,
    },
  });

  const grammar = await prisma.category.upsert({
    where: { id: "cat-grammar" },
    update: {},
    create: {
      id: "cat-grammar",
      name: "语法",
      subjectId: english.id,
      order: 2,
    },
  });

  const algebra = await prisma.category.upsert({
    where: { id: "cat-algebra" },
    update: {},
    create: {
      id: "cat-algebra",
      name: "代数",
      subjectId: math.id,
      order: 1,
    },
  });

  logger.info("分类已创建");

  // 3. 创建标签
  const tags = await Promise.all(
    ["基础", "进阶", "高频", "易错", "重要"].map((name) =>
      prisma.tag.upsert({
        where: { name },
        update: {},
        create: { name },
      })
    )
  );
  const tagMap = new Map(tags.map((t) => [t.name, t.id]));

  // 4. 创建示例用户
  const user = await prisma.user.upsert({
    where: { email: "dev@learnforge.local" },
    update: {},
    create: {
      email: "dev@learnforge.local",
      name: "开发者",
      passwordHash: "$2a$10$placeholder", // 仅开发用
      role: "admin",
    },
  });

  logger.info("用户已创建", { userId: user.id });

  // 5. 创建示例卡片
  const sampleCards = [
    {
      title: "abandon",
      type: "word" as const,
      content: "# abandon\n\n**词性：** verb\n\n**释义：** 放弃、抛弃",
      subjectId: english.id,
      categoryId: vocabulary.id,
      difficulty: 1,
      phonetic: "/əˈbændən/",
      partOfSpeech: "v.",
      meanings: JSON.stringify(["放弃", "抛弃", "放纵"]),
      sentences: JSON.stringify([
        "He abandoned his car on the highway.",
        "The game was abandoned due to rain.",
      ]),
      tagIds: [tagMap.get("高频")!, tagMap.get("基础")!],
    },
    {
      title: "一般现在时",
      type: "grammar" as const,
      content: "# 一般现在时\n\n表示经常发生的动作或客观真理。\n\n**构成：** 主语 + 动词原形（第三人称单数加 -s/-es）",
      subjectId: english.id,
      categoryId: grammar.id,
      difficulty: 2,
      tagIds: [tagMap.get("基础")!, tagMap.get("重要")!],
    },
    {
      title: "一元二次方程求根公式",
      type: "formula" as const,
      content: "# 一元二次方程求根公式\n\n对于 $ax^2 + bx + c = 0$ ($a \\neq 0$)，求根公式为：\n\n$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$\n\n判别式 $\\Delta = b^2 - 4ac$ 决定根的性质。",
      subjectId: math.id,
      categoryId: algebra.id,
      difficulty: 3,
      problemStatement: "求解 $x^2 - 5x + 6 = 0$",
      solution: "代入求根公式：\n\n$x = \\frac{5 \\pm \\sqrt{25 - 24}}{2} = \\frac{5 \\pm 1}{2}$\n\n$x_1 = 3, x_2 = 2$",
      answer: "x₁ = 3, x₂ = 2",
      latexFormulas: JSON.stringify(["x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}", "\\Delta = b^2 - 4ac"]),
      tagIds: [tagMap.get("重要")!, tagMap.get("高频")!],
    },
    {
      title: "导数的基本概念",
      type: "concept" as const,
      content: "# 导数\n\n导数是函数在某一点处的瞬时变化率，几何意义是切线斜率。\n\n**定义：**\n\n$$f'(x) = \\lim_{\\Delta x \\to 0} \\frac{f(x + \\Delta x) - f(x)}{\\Delta x}$$",
      subjectId: math.id,
      categoryId: algebra.id,
      difficulty: 4,
      tagIds: [tagMap.get("进阶")!],
    },
  ];

  for (const cardData of sampleCards) {
    const { tagIds, ...rest } = cardData;
    const card = await prisma.card.create({
      data: {
        ...rest,
        userId: user.id,
        source: "manual",
        metadata: "{}",
        latexFormulas: (rest as { latexFormulas?: string }).latexFormulas || "[]",
        tags: { create: tagIds.map((tagId) => ({ tagId })) },
      },
    });
    logger.info("示例卡片已创建", { id: card.id, title: card.title });
  }

  logger.info("种子数据初始化完成！");
}

main()
  .catch((e) => {
    logger.error("种子数据初始化失败", { error: String(e) });
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
