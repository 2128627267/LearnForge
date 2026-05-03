"""
LearnForge (LFG) - 主入口程序
负责协调读取程序和处理程序，提供统一的启动入口
"""

import os
import sys
import json
from typing import Dict

from reader import DataPackReader
from processor import DataProcessor
from logger import Logger, get_logger


def _get_project_root() -> str:
    """获取项目根目录"""
    current_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.dirname(current_dir)


def _get_output_dir() -> str:
    """获取输出目录路径"""
    return os.path.join(_get_project_root(), "data", "output")


def _ensure_output_dir(logger: Logger) -> str:
    """确保输出目录存在"""
    output_dir = _get_output_dir()
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
        logger.info(f"创建输出目录：{output_dir}")
    return output_dir


def _save_reader_output(reader: DataPackReader, logger: Logger):
    """保存Reader输出到文件"""
    output_dir = _ensure_output_dir(logger)
    output_path = os.path.join(output_dir, "reader_output.json")

    try:
        reader_dict = reader.to_dict()
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(reader_dict, f, ensure_ascii=False, indent=2)
        logger.info(f"Reader输出已保存到：{output_path}")
    except Exception as e:
        logger.error(f"保存Reader输出失败：{str(e)}")
        raise


def _save_processed_data(result: Dict, logger: Logger):
    """保存Processor输出到文件"""
    output_dir = _ensure_output_dir(logger)
    output_path = os.path.join(output_dir, "processed_data.json")

    try:
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        logger.info(f"处理结果已保存到：{output_path}")
    except Exception as e:
        logger.error(f"保存处理结果失败：{str(e)}")
        raise


def _print_reader_summary(reader: DataPackReader, logger: Logger):
    """输出Reader读取结果的汇总信息"""
    stats = reader.stats
    logger.info("")
    logger.info(f"读取统计：共发现 {stats.file_count} 个数据文件")
    logger.info(f"  - Word文件：{len(reader.get_words())} 个，包含 {stats.word_count} 个单词")
    logger.info(f"  - Phrase文件：{len(reader.get_phrases())} 个，包含 {stats.phrase_count} 个短语")
    logger.info(f"  - 总数据项：{stats.total} 个")


def _print_file_details(reader: DataPackReader, logger: Logger):
    """输出每个文件的详细信息"""
    logger.info("")
    logger.info("文件详情：")
    logger.info("-" * 60)

    for data_file in reader.data_files:
        logger.info(f"  文件名：{data_file.filename}")
        logger.info(f"  UUID：{data_file.uuid}")
        logger.info(f"  类型：{data_file.type}")
        logger.info(f"  数据项数量：{data_file.count}")

        if data_file.data and len(data_file.data) > 0:
            logger.info(f"  前 {min(3, len(data_file.data))} 个数据项：")
            for i, item in enumerate(data_file.data[:3]):
                name = item.get('name', 'N/A')
                item_type = item.get('type', 'N/A')
                means = item.get('mean', [])
                sentences = item.get('sentence', [])

                mean_str = '；'.join(means) if means else 'N/A'
                sentence_str = sentences[0] if sentences else 'N/A'

                logger.info(f"    {i+1}. 名称：{name}")
                logger.info(f"       类型：{item_type}")
                logger.info(f"       含义：{mean_str}")
                logger.info(f"       例句：{sentence_str}")

        if data_file.count > 3:
            logger.info(f"    ... 还有 {data_file.count - 3} 个数据项")

        logger.info("")


def _print_processed_result(result: Dict, logger: Logger):
    """输出处理结果的汇总信息"""
    stats = result.get('stats', {})
    integrated_data = result.get('integrated_data', {})

    logger.info("")
    logger.info("处理结果汇总：")
    logger.info("-" * 60)
    logger.info(f"  Word数量：{stats.get('word_count', 0)}")
    logger.info(f"  Phrase数量：{stats.get('phrase_count', 0)}")
    logger.info(f"  文件数量：{stats.get('file_count', 0)}")
    logger.info(f"  总数据项：{stats.get('total_count', 0)}")

    word_types = integrated_data.get('word_types', {})
    phrase_types = integrated_data.get('phrase_types', {})
    type_distribution = integrated_data.get('type_distribution', {})

    if word_types:
        logger.info("")
        logger.info("  Word类型分布：")
        for word_type, count in word_types.items():
            dist = type_distribution.get(word_type, {})
            percentage = dist.get('percentage', 0)
            logger.info(f"    - {word_type}：{count} 个 ({percentage}%)")

    if phrase_types:
        logger.info("")
        logger.info("  Phrase类型分布：")
        for phrase_type, count in phrase_types.items():
            dist = type_distribution.get(phrase_type, {})
            percentage = dist.get('percentage', 0)
            logger.info(f"    - {phrase_type}：{count} 个 ({percentage}%)")


def main():
    """主函数：协调整个数据处理流程"""
    logger = get_logger(name="LearnForge-Main", log_to_file=True, log_to_console=True)

    logger.section("LearnForge (LFG) - 数据处理系统")

    reader_output_path = os.path.join(_get_output_dir(), "reader_output.json")
    processed_output_path = os.path.join(_get_output_dir(), "processed_data.json")

    logger.info(f"Reader输出路径：{reader_output_path}")
    logger.info(f"处理结果路径：{processed_output_path}")

    logger.step(1, 4, "读取数据包")
    reader = DataPackReader()
    logger.info(f"数据包路径：{reader.datapacks_path}")

    try:
        reader.read_all_files()
    except FileNotFoundError as e:
        logger.error(f"数据包目录不存在：{str(e)}")
        return
    except Exception as e:
        logger.error(f"读取数据包失败：{str(e)}")
        return

    if not reader.data_files:
        logger.warning("未找到任何数据包文件！")
        return

    _print_reader_summary(reader, logger)
    _print_file_details(reader, logger)

    logger.step(2, 4, "保存Reader输出")
    try:
        _save_reader_output(reader, logger)
    except Exception:
        return

    logger.step(3, 4, "处理数据")
    processor = DataProcessor()

    try:
        result = processor.process()
    except FileNotFoundError as e:
        logger.error(f"输入数据文件不存在：{str(e)}")
        return
    except Exception as e:
        logger.error(f"处理数据失败：{str(e)}")
        return

    logger.info("数据处理完成！")

    _print_processed_result(result, logger)

    logger.step(4, 4, "保存处理结果")
    try:
        _save_processed_data(result, logger)
    except Exception:
        return

    logger.section("程序运行完成")
    logger.info("所有数据处理流程已成功完成！")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n错误：{str(e)}")
        sys.exit(1)
