"""
LearnForge (LFG) - 数据处理程序
负责将多个数据包的数据整合到一起
可以独立运行，也可以被其他程序调用
"""

import os
import json
import sys
from typing import Dict, List, Any
from collections import defaultdict


class DataProcessor:
    """数据处理器"""

    def __init__(self, input_path: str = None):
        """
        初始化处理器

        Args:
            input_path: 输入数据路径，如果为None则使用默认路径
        """
        if input_path is None:
            self.input_path = self._get_default_input_path()
        else:
            self.input_path = input_path

        self.processed_data = {}

    def _get_default_input_path(self) -> str:
        """获取默认的输入数据路径"""
        current_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.dirname(current_dir)
        return os.path.join(project_root, "data", "output", "reader_output.json")

    def _get_output_path(self) -> str:
        """获取默认的输出数据路径"""
        current_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.dirname(current_dir)
        return os.path.join(project_root, "data", "output", "processed_data.json")

    def process(self, input_data: Dict[str, Any] = None) -> Dict[str, Any]:
        """
        处理所有数据包

        Args:
            input_data: 输入数据字典，如果为None则从文件读取

        Returns:
            处理结果字典
        """
        if input_data is None:
            input_data = self._load_input_data()

        if not input_data:
            return self._empty_result()

        stats = input_data.get('stats', {})
        files = input_data.get('files', [])

        word_files = []
        phrase_files = []
        word_items = []
        phrase_items = []

        for file_info in files:
            file_type = file_info.get('type', '')
            filename = file_info.get('filename', '')
            file_uuid = file_info.get('uuid', '')
            file_data = file_info.get('data', [])
            file_count = file_info.get('count', 0)

            if file_type == 'word':
                word_files.append({
                    'filename': filename,
                    'uuid': file_uuid,
                    'count': file_count,
                    'data': file_data
                })
                for item in file_data:
                    item_with_source = self._add_source_info(item, filename, file_uuid, 'word')
                    word_items.append(item_with_source)
            elif file_type == 'phrase':
                phrase_files.append({
                    'filename': filename,
                    'uuid': file_uuid,
                    'count': file_count,
                    'data': file_data
                })
                for item in file_data:
                    item_with_source = self._add_source_info(item, filename, file_uuid, 'phrase')
                    phrase_items.append(item_with_source)

        result = {
            'stats': {
                'word_count': stats.get('word_count', 0),
                'phrase_count': stats.get('phrase_count', 0),
                'file_count': stats.get('file_count', 0),
                'total_count': stats.get('total_count', 0)
            },
            'files': {
                'word_files': word_files,
                'phrase_files': phrase_files
            },
            'integrated_data': self._integrate_all_data(word_items, phrase_items)
        }

        self.processed_data = result
        return result

    def _add_source_info(self, item: Dict, filename: str, uuid: str, data_type: str) -> Dict:
        """
        为数据项添加来源信息

        Args:
            item: 原始数据项
            filename: 来源文件名
            uuid: 文件UUID
            data_type: 数据类型（word或phrase）

        Returns:
            添加来源信息后的数据项
        """
        item_copy = item.copy()
        item_copy['source_filename'] = filename
        item_copy['source_uuid'] = uuid
        item_copy['data_type'] = data_type
        return item_copy

    def _load_input_data(self) -> Dict[str, Any]:
        """
        从文件加载输入数据

        Returns:
            输入数据字典
        """
        if not os.path.exists(self.input_path):
            raise FileNotFoundError(f"输入数据文件不存在：{self.input_path}")

        with open(self.input_path, 'r', encoding='utf-8') as f:
            input_data = json.load(f)

        return input_data

    def _integrate_all_data(self, word_items: List[Dict], phrase_items: List[Dict]) -> Dict[str, Any]:
        """
        整合所有数据包的数据

        Args:
            word_items: 单词列表
            phrase_items: 短语列表

        Returns:
            整合后的数据
        """
        integrated = {
            'all_words': [],
            'all_phrases': [],
            'all_items': [],
            'word_types': {},
            'phrase_types': {},
            'all_types': {},
            'type_distribution': {},
            'word_type_distribution': {},
            'phrase_type_distribution': {}
        }

        all_items = word_items + phrase_items

        for item in all_items:
            item_type = item.get('type', '')
            item_name = item.get('name', '')
            item_mean = item.get('mean', [])
            item_sentence = item.get('sentence', [])
            source_filename = item.get('source_filename', '')
            source_uuid = item.get('source_uuid', '')
            data_type = item.get('data_type', '')

            integrated['all_items'].append({
                'name': item_name,
                'type': item_type,
                'mean': item_mean,
                'sentence': item_sentence,
                'source_filename': source_filename,
                'source_uuid': source_uuid,
                'data_type': data_type
            })

            if item_type:
                if item_type not in integrated['all_types']:
                    integrated['all_types'][item_type] = 0
                integrated['all_types'][item_type] += 1

        for item in word_items:
            item_type = item.get('type', '')

            if item_type:
                if item_type not in integrated['word_types']:
                    integrated['word_types'][item_type] = 0
                integrated['word_types'][item_type] += 1

        for item in phrase_items:
            item_type = item.get('type', 'phrase')

            if item_type:
                if item_type not in integrated['phrase_types']:
                    integrated['phrase_types'][item_type] = 0
                integrated['phrase_types'][item_type] += 1

        integrated['all_words'] = word_items
        integrated['all_phrases'] = phrase_items

        total_words = len(word_items)
        if total_words > 0:
            for word_type, count in integrated['word_types'].items():
                percentage = (count / total_words) * 100
                integrated['word_type_distribution'][word_type] = {
                    'count': count,
                    'percentage': round(percentage, 2)
                }

        total_phrases = len(phrase_items)
        if total_phrases > 0:
            for phrase_type, count in integrated['phrase_types'].items():
                percentage = (count / total_phrases) * 100
                integrated['phrase_type_distribution'][phrase_type] = {
                    'count': count,
                    'percentage': round(percentage, 2)
                }

        total_items = len(all_items)
        if total_items > 0:
            for item_type, count in integrated['all_types'].items():
                percentage = (count / total_items) * 100
                integrated['type_distribution'][item_type] = {
                    'count': count,
                    'percentage': round(percentage, 2)
                }

        return integrated

    def _empty_result(self) -> Dict[str, Any]:
        """
        返回空结果

        Returns:
            空的结果字典
        """
        return {
            'stats': {
                'word_count': 0,
                'phrase_count': 0,
                'file_count': 0,
                'total_count': 0
            },
            'files': {
                'word_files': [],
                'phrase_files': []
            },
            'integrated_data': {
                'all_words': [],
                'all_phrases': [],
                'all_items': [],
                'word_types': {},
                'phrase_types': {},
                'all_types': {},
                'type_distribution': {},
                'word_type_distribution': {},
                'phrase_type_distribution': {}
            }
        }

    def get_words_by_type(self, target_type: str) -> List[Dict]:
        """
        获取指定类型的单词

        Args:
            target_type: 目标词性类型

        Returns:
            符合条件的数据项列表
        """
        if not self.processed_data:
            return []

        integrated = self.processed_data.get('integrated_data', {})
        all_items = integrated.get('all_items', [])

        return [item for item in all_items if item.get('type') == target_type]

    def get_words_by_source(self, filename: str = None, uuid: str = None) -> List[Dict]:
        """
        获取指定来源的单词

        Args:
            filename: 文件名
            uuid: 文件UUID

        Returns:
            符合条件的数据项列表
        """
        if not self.processed_data:
            return []

        integrated = self.processed_data.get('integrated_data', {})
        all_items = integrated.get('all_items', [])

        result = []
        for item in all_items:
            if filename and item.get('source_filename') == filename:
                result.append(item)
            elif uuid and item.get('source_uuid') == uuid:
                result.append(item)

        return result


def main():
    """独立运行时的主函数"""
    print("LearnForge (LFG) - 数据处理程序")
    print("=" * 50)

    processor = DataProcessor()

    print(f"输入数据路径：{processor.input_path}")
    print("\n开始处理数据...")

    try:
        result = processor.process()
    except FileNotFoundError as e:
        print(f"\n错误：{str(e)}")
        sys.exit(1)

    if not result or result.get('stats', {}).get('total_count', 0) == 0:
        print("\n未找到任何数据！")
        return

    stats = result.get('stats', {})

    print(f"\n处理完成！")
    print(f"  - 单词总数：{stats.get('word_count', 0)}")
    print(f"  - 短语总数：{stats.get('phrase_count', 0)}")
    print(f"  - 文件总数：{stats.get('file_count', 0)}")
    print(f"  - 数据项总数：{stats.get('total_count', 0)}")

    output_path = processor._get_output_path()

    output_dir = os.path.dirname(output_path)
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"\n处理结果已保存到：{output_path}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n错误：{str(e)}")
        sys.exit(1)
