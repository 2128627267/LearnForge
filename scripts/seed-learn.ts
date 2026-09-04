/**
 * 单词学习系统 - 测试数据种子脚本
 * 插入英语 subject、默认用户、若干单词 Card + WordProfile，供 /learn 页面测试
 * 运行：npx tsx scripts/seed-learn.ts
 */
import { prisma } from "../lib/db/prisma";

async function main() {
  // 1. 确保 english subject 存在
  const subject = await prisma.subject.upsert({
    where: { slug: "english" },
    update: {},
    create: {
      name: "英语",
      slug: "english",
      icon: "BookOpen",
      color: "#3b82f6",
      order: 1,
    },
  });

  // 2. 确保默认用户存在
  const user = await prisma.user.upsert({
    where: { email: "learn@local" },
    update: {},
    create: {
      email: "learn@local",
      name: "学习者",
      passwordHash: "x",
      role: "user",
    },
  });

  // 3. 测试单词数据
  const words = [
    {
      title: "alarm",
      phonetic: "/əˈlɑːm/",
      partOfSpeech: "n./v.",
      meanings: ["警报", "使惊恐"],
      sentences: ["The fire alarm went off. 火警警报响了。"],
    },
    {
      title: "authority",
      phonetic: "/ɔːˈθɒrəti/",
      partOfSpeech: "n.",
      meanings: ["权力", "当局", "权威"],
      sentences: ["The authority approved the plan. 当局批准了该计划。"],
    },
    {
      title: "construct",
      phonetic: "/kənˈstrʌkt/",
      partOfSpeech: "v.",
      meanings: ["建造", "构造"],
      sentences: ["They construct bridges. 他们建造桥梁。"],
    },
    {
      title: "diverse",
      phonetic: "/daɪˈvɜːs/",
      partOfSpeech: "adj.",
      meanings: ["不同的", "多样的"],
      sentences: ["The city is diverse. 这座城市很多样。"],
    },
    {
      title: "interact",
      phonetic: "/ˌɪntərˈækt/",
      partOfSpeech: "v.",
      meanings: ["互动", "相互作用"],
      sentences: ["People interact online. 人们在线互动。"],
    },
    {
      title: "finance",
      phonetic: "/ˈfaɪnæns/",
      partOfSpeech: "n.",
      meanings: ["财政", "金融"],
      sentences: ["She studies finance. 她学习金融。"],
    },
  ];

  // 4. 插入 Card + WordProfile
  for (const w of words) {
    const card = await prisma.card.upsert({
      where: { id: `seed-word-${w.title}` },
      update: {
        meanings: JSON.stringify(w.meanings),
        sentences: JSON.stringify(w.sentences),
        phonetic: w.phonetic,
        partOfSpeech: w.partOfSpeech,
      },
      create: {
        id: `seed-word-${w.title}`,
        title: w.title,
        content: `# ${w.title}\n**词性：** ${w.partOfSpeech}\n**释义：** ${w.meanings.join("、")}\n**例句：** ${w.sentences[0]}`,
        type: "word",
        subjectId: subject.id,
        difficulty: 2,
        status: "new",
        source: "imported",
        metadata: JSON.stringify({ seededFrom: "seed-learn" }),
        userId: user.id,
        phonetic: w.phonetic,
        partOfSpeech: w.partOfSpeech,
        meanings: JSON.stringify(w.meanings),
        sentences: JSON.stringify(w.sentences),
      },
    });

    await prisma.wordProfile.upsert({
      where: { cardId: card.id },
      update: {},
      create: {
        cardId: card.id,
        length: w.title.length,
        commonness: 0.6,
      },
    });

    console.log(`✓ ${w.title}`);
  }

  console.log(`\n种子完成：${words.length} 个单词，用户 ${user.email}，学科 ${subject.slug}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
