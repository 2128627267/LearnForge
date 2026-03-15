# LearnForge (LFG)

## 项目简介

**LearnForge**（简称 **LFG**）是整个学习系统的数据核心项目，专门负责数据包的自定义、数据提取、数据库配置和算法自我调控。本项目提供对外的标准化的数据接口。

### 项目定位

LearnForge 是学习生态系统的**数据中枢**，通过结构化的数据包系统实现学习资源的高效管理和配置。它不直接面向终端用户，而是作为数据引擎提供数据支持。

### 核心功能

- **数据开源生态**： LearnForge 致力于构建一个开放、透明的学习数据生态系统，鼓励开发者和学习资源创作者贡献自己的数据包。
- **数据包管理**：创建、配置和管理各种类型的数据包（单词包、句子包、复合包）
- **数据提取与处理**：从数据包中提取结构化数据，进行智能处理和优化
- **算法自我配置**：通过算法自动配置和优化整体数据库，提升数据质量
- **对外接口**：提供标准化的数据接口，支持前端项目的数据调用
- **模块化设计**：通过数据包系统实现学习资源的模块化管理

### 系统架构

```
LearnForge (LFG) - 数据
    ↓ 数据接口
其他项目（学习应用、题目生成程序等）
    ↓ 用户交互
终端用户
```

### 项目目标

LearnForge 致力于成为学习生态系统的数据引擎，通过标准化的数据包格式和智能算法，为各种学习应用提供高质量、可配置的数据支持，让学习资源的创建、管理和使用变得高效便捷。

### 版本信息

- **当前版本**：1.0.0
- **Python 要求**：Python 3.6+
- **依赖**：仅使用 Python 标准库，无需额外安装依赖

---

## 项目结构

```
LearnForge/
├── src/                    # 源代码目录
│   ├── __init__.py         # 包初始化文件
│   ├── main.py             # 主入口程序
│   ├── reader.py            # 数据包读取程序
│   └── processor.py         # 数据处理程序
├── datapacks/              # 数据包文件夹
│   └── your-pack-name/     # 你的数据包
│       ├── pack.json        # 数据包配置文件
│       ├── README.md        # 数据包说明文档（可选）
│       └── data/           # 数据文件夹
│           ├── 1.json
│           ├── 2.json
│           └── ...
├── run.py                  # 启动脚本
└── README.md               # 项目说明文档
```

## 程序使用

### 快速开始

1. **安装依赖**
   ```bash
   # 本项目使用 Python 标准库，无需额外安装依赖
   ```

2. **运行主程序**
   ```bash
   python run.py
   ```

   或直接运行主程序：
   ```bash
   python src/main.py
   ```

### 程序架构

LearnForge 包含三个核心程序，它们可以独立运行，也可以通过主入口程序协调运行：

#### 1. 读取程序 (reader.py)
- **功能**：读取和解析数据包及其配置文件
- **职责**：
  - 扫描数据包目录
  - 读取 pack.json 配置文件
  - 解析数据结构映射
  - 提取数据文件中的单词数据
  - 统计数据包信息
- **独立运行**：
  ```bash
  python src/reader.py
  ```
  独立运行时会自动读取 `datapacks/` 文件夹下的所有数据包，并保存到 `data_packs.json` 文件

#### 2. 处理程序 (processor.py)
- **功能**：将多个数据包的数据整合到一起
- **职责**：
  - 处理每个数据包的数据
  - 整合所有数据包的数据
  - 统计词性分布
  - 生成处理结果
- **独立运行**：
  ```bash
  python src/processor.py
  ```
  独立运行时会从 `data_packs.json` 文件读取数据，处理后保存到 `processed_data.json` 文件

#### 3. 主入口程序 (main.py)
- **功能**：协调读取程序和处理程序，提供统一的启动入口
- **职责**：
  - 调用读取程序获取数据包
  - 调用处理程序处理数据
  - 输出最终结果
- **运行方式**：
  ```bash
  python src/main.py
  ```
  或使用启动脚本：
  ```bash
  python run.py
  ```

### 使用场景

#### 场景 1：使用主入口程序（推荐）
```bash
python run.py
```
主程序会自动完成所有步骤，输出最终结果。

#### 场景 2：分步执行
```bash
# 第一步：读取数据包
python src/reader.py

# 第二步：处理数据
python src/processor.py
```
适合需要查看中间结果或调试的情况。

#### 场景 3：在其他程序中调用
```python
from src.reader import DataPackReader
from src.processor import DataProcessor

# 读取数据包
reader = DataPackReader()
data_packs = reader.read_all_packs()

# 处理数据
processor = DataProcessor()
result = processor.process(data_packs)

# 使用结果
print(result)
```

### 输出示例

运行主程序后，将输出类似以下内容：

```
LearnForge (LFG) - 数据处理系统
==================================================

[步骤 1/2] 读取数据包...
数据包路径：...\datapacks
成功读取 1 个数据包

[步骤 2/2] 处理数据...
数据处理完成！

==================================================
处理结果：
==================================================

数据包总数：1
单词总数：XXX
数据文件总数：X

数据包详情：

  your-pack-name:
    - 描述：你的数据包描述
    - 类型：words_pack
    - 单词数：XXX
    - 文件数：X
```

### 数据流

```
datapacks/ (数据包文件夹)
    ↓
reader.py (读取程序)
    ↓
data_packs.json （中间数据文件）
    ↓
processor.py (处理程序)
    ↓
processed_data.json （最终处理结果）
    ↓
main.py （主入口程序）输出结果
```

---

## DataPack 配置说明

本文档介绍如何配置和使用数据包（DataPack）。

## 目录结构

```
datapacks/              # 数据包文件夹
└── your-pack-name/     # 你的数据包
    ├── pack.json        # 核心配置文件
    └── data/           # 默认数据入口文件夹
        ├── 1.json
        ├── 2.json
        ├── 3.json
        └── ...
```

## pack.json 配置详解

`pack.json` 是数据包的核心配置文件，包含三个主要部分：

### 1. information - 数据包信息

```json
{
    "information": {
        "name": "YourPackName",
        "description": "你的数据包描述",
        "uuid": "",
        "type": "words_pack"
    }
}
```

| 字段 | 说明 | 是否必填 | 初始值 |
|------|------|------|------|
| `name` | 数据包名称，用于标识 | 否 ||
| `description` | 数据包描述 | 否 ||
| `uuid` | 唯一标识符 | 是 | **程序随机生成** |
| `type` | 数据包类型，当前可选项：`words_pack`(单词包)、`sentence_pack`(句子包)、`compound_pack`(复合包) | 是 | `words_pack` |

### 2. structure - 数据结构映射

```json
{
    "structure": {
        "entrance": "data",
        "key_map": {
            "word": "words",
            "type": "words.type",
            "mean": "words.mean",
            "sentence": "words.sentence"
        }
    }
}
```

#### 单词包数据结构

| 字段 | 说明 | 程序所做的事 |
|------|------|------|
| `entrance` | 数据文件夹入口，指向包含单词数据文件的文件夹 | 程序会读取该文件夹下所有 JSON 文件 |
| `key_map` | 字段映射，定义程序如何读取单词数据 | 程序会根据此映射解析 JSON 文件中的数据 |
| `key_map.word` | 单词数组的键名 | 程序会根据此键名从对应数组(列表)中尝试提取单词数据 |
| `key_map.type` | 单词词性字段的路径 | 程序会根据此键名从对应键值中尝试提取单词词性信息 |
| `key_map.mean` | 释义字段的路径 | 程序会根据此键名从对应键值中尝试提取单词中文释义 |
| `key_map.sentence` | 例句字段的路径 | 程序会根据此键名从对应键值中尝试提取单词例句 |

### 3. type_map - 词性映射

```json
{
    "type_map": {
        "noun": ["名词", "n."],
        "verb": ["动词", "v."],
        "adjective": ["形容词", "adj.", "a."],
        "adverb": ["副词", "adv.", "ad."],
        "preposition": ["介词", "prep."],
        "conjunction": ["连词", "conj."]
    }
}
```

`type_map` 用于将标准词性映射到多种显示格式。

## 默认数据文件格式（自定义）

数据文件（包含数据文件的文件夹下所有的 JSON 文件）存储的实际的单词数据：

```json
{
    "words": [
        {
            "name": "word1",
            "type": "noun",
            "mean": ["释义1", "释义2"],
            "sentence": ["例句1"]
        },
        {
            "name": "word2",
            "type": "verb",
            "mean": ["释义1", "释义2", "释义3"],
            "sentence": ["例句1"]
        }
    ]
}
```