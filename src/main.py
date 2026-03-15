"""
LearnForge (LFG) - 主入口程序
负责协调读取程序和处理程序，提供统一的启动入口
"""

import sys
import os

from reader import DataPackReader
from processor import DataProcessor
from logger import Logger, get_logger


def main():
    """主函数：协调整个数据处理流程"""
    # 初始化日志记录器
    logger = get_logger(name="LearnForge-Main", log_to_file=True, log_to_console=True)
    
    logger.section("LearnForge (LFG) - 数据处理系统")
    
    # 第一步：读取数据包
    logger.step(1, 2, "读取数据包")
    reader = DataPackReader()
    logger.info(f"数据包路径：{reader.databacks_path}")
    
    try:
        data_packs = reader.read_all_packs()
        logger.info(f"成功读取 {len(data_packs)} 个数据包")
    except Exception as e:
        logger.error(f"读取数据包失败：{str(e)}")
        return
    
    if not data_packs:
        logger.warning("未找到任何数据包！")
        return
    
    # 输出数据包内容
    logger.info("\n数据包内容：")
    logger.info("-" * 50)
    for pack_name, pack_info in data_packs.items():
        logger.info(f"\n  [{pack_name}]")
        logger.info(f"    名称：{pack_info.get('name', 'N/A')}")
        logger.info(f"    描述：{pack_info.get('description', 'N/A')}")
        logger.info(f"    类型：{pack_info.get('type', 'N/A')}")
        logger.info(f"    单词数：{pack_info.get('word_count', 0)}")
        logger.info(f"    文件数：{pack_info.get('file_count', 0)}")
        
        # 输出数据文件内容
        data_files = pack_info.get('data', [])
        if data_files:
            logger.info(f"    数据文件：")
            for file_data in data_files:
                filename = file_data.get('filename', 'N/A')
                word_count = file_data.get('count', 0)
                logger.info(f"      - {filename}: {word_count} 个单词")
                
                # 输出前3个单词作为示例
                words = file_data.get('words', [])
                if words:
                    logger.info(f"        示例单词：")
                    for i, word in enumerate(words[:3]):
                        word_name = word.get('name', 'N/A')
                        word_type = word.get('type', 'N/A')
                        word_mean = word.get('mean', [])
                        mean_str = '；'.join(word_mean) if word_mean else 'N/A'
                        logger.info(f"          {i+1}. {word_name} ({word_type}) - {mean_str}")
                    if len(words) > 3:
                        logger.info(f"          ... 还有 {len(words) - 3} 个单词")
    
    # 第二步：处理数据
    logger.step(2, 2, "处理数据")
    processor = DataProcessor()
    
    try:
        result = processor.process(data_packs)
        logger.info("数据处理完成！")
    except Exception as e:
        logger.error(f"处理数据失败：{str(e)}")
        return
    
    # 输出结果
    logger.section("处理结果")
    print_result(result, logger)
    
    # 保存处理结果到文件
    save_result(result, logger)
    
    logger.info("\n程序运行完成！")


def save_result(result, logger):
    """保存处理结果到文件"""
    import json
    
    # 获取项目根目录
    current_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(current_dir)
    
    # 构建输出路径
    output_dir = os.path.join(project_root, "data", "output")
    output_path = os.path.join(output_dir, "processed_data.json")
    
    # 确保输出目录存在
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
        logger.info(f"创建输出目录：{output_dir}")
    
    # 保存结果到文件
    try:
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        logger.info(f"\n处理结果已保存到：{output_path}")
    except Exception as e:
        logger.error(f"保存处理结果失败：{str(e)}")


def print_result(result, logger):
    """格式化输出处理结果"""
    if not result:
        logger.info("无数据")
        return
    
    # 输出统计信息
    logger.info(f"\n数据包总数：{result.get('total_packs', 0)}")
    logger.info(f"单词总数：{result.get('total_words', 0)}")
    logger.info(f"数据文件总数：{result.get('total_files', 0)}")
    
    # 输出数据包详情
    packs = result.get('packs', {})
    if packs:
        logger.info("\n数据包详情：")
        for pack_name, pack_info in packs.items():
            logger.info(f"\n  {pack_name}:")
            logger.info(f"    - 描述：{pack_info.get('description', 'N/A')}")
            logger.info(f"    - 类型：{pack_info.get('type', 'N/A')}")
            logger.info(f"    - 单词数：{pack_info.get('word_count', 0)}")
            logger.info(f"    - 文件数：{pack_info.get('file_count', 0)}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n错误：{str(e)}")
        sys.exit(1)
