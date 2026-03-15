"""
LearnForge (LFG) - 主入口程序
负责协调读取程序和处理程序，提供统一的启动入口
"""

import sys

from reader import DataPackReader
from processor import DataProcessor


def main():
    """主函数：协调整个数据处理流程"""
    print("LearnForge (LFG) - 数据处理系统")
    print("=" * 50)
    
    # 第一步：读取数据包
    print("\n[步骤 1/2] 读取数据包...")
    reader = DataPackReader()
    print(f"数据包路径：{reader.databacks_path}")
    
    try:
        data_packs = reader.read_all_packs()
        print(f"成功读取 {len(data_packs)} 个数据包")
    except Exception as e:
        print(f"读取数据包失败：{str(e)}")
        return
    
    if not data_packs:
        print("未找到任何数据包！")
        return
    
    # 第二步：处理数据
    print("\n[步骤 2/2] 处理数据...")
    processor = DataProcessor()
    
    try:
        result = processor.process(data_packs)
        print("数据处理完成！")
    except Exception as e:
        print(f"处理数据失败：{str(e)}")
        return
    
    # 输出结果
    print("\n" + "=" * 50)
    print("处理结果：")
    print("=" * 50)
    print_result(result)


def print_result(result):
    """格式化输出处理结果"""
    if not result:
        print("无数据")
        return
    
    # 输出统计信息
    print(f"\n数据包总数：{result.get('total_packs', 0)}")
    print(f"单词总数：{result.get('total_words', 0)}")
    print(f"数据文件总数：{result.get('total_files', 0)}")
    
    # 输出数据包详情
    packs = result.get('packs', {})
    if packs:
        print("\n数据包详情：")
        for pack_name, pack_info in packs.items():
            print(f"\n  {pack_name}:")
            print(f"    - 描述：{pack_info.get('description', 'N/A')}")
            print(f"    - 类型：{pack_info.get('type', 'N/A')}")
            print(f"    - 单词数：{pack_info.get('word_count', 0)}")
            print(f"    - 文件数：{pack_info.get('file_count', 0)}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n错误：{str(e)}")
        sys.exit(1)
