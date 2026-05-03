"""
LearnForge (LFG) - 数据包读取程序
负责读取和解析数据包目录下的所有JSON文件
可以独立运行，也可以被其他程序调用
"""

import os
import json
import sys
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, field


@dataclass
class DataItem:
    """数据条目结构"""
    name: str
    mean: List[str]
    sentence: List[str]
    type: Optional[str] = None


@dataclass
class DataFile:
    """数据文件结构"""
    filename: str
    type: str
    uuid: str
    data: List[Dict[str, Any]]
    count: int


@dataclass
class PackStats:
    """数据包统计信息"""
    word_count: int = 0
    phrase_count: int = 0
    file_count: int = 0

    @property
    def total(self) -> int:
        return self.word_count + self.phrase_count


class DataPackReader:
    """数据包读取器 - 适配新版JSON格式"""

    def __init__(self, datapacks_path: str = None):
        if datapacks_path is None:
            self.datapacks_path = self._get_default_datapacks_path()
        else:
            self.datapacks_path = datapacks_path

        self.data_files: List[DataFile] = []
        self.stats = PackStats()

    def _get_default_datapacks_path(self) -> str:
        current_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.dirname(current_dir)
        return os.path.join(project_root, "datapacks")

    def _get_output_path(self) -> str:
        current_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.dirname(current_dir)
        return os.path.join(project_root, "data", "output", "reader_output.json")

    def _scan_json_files(self, directory: str) -> List[str]:
        json_files = []
        if not os.path.exists(directory):
            return json_files

        for root, _, files in os.walk(directory):
            for filename in files:
                if filename.endswith('.json'):
                    json_files.append(os.path.join(root, filename))

        return json_files

    def _parse_json_file(self, file_path: str) -> Optional[DataFile]:
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                file_data = json.load(f)

            file_type = file_data.get('type', 'unknown')
            file_uuid = file_data.get('uuid', '')
            file_items = file_data.get('data', [])

            if not isinstance(file_items, list):
                return None

            filename = os.path.basename(file_path)

            return DataFile(
                filename=filename,
                type=file_type,
                uuid=file_uuid,
                data=file_items,
                count=len(file_items)
            )

        except (json.JSONDecodeError, IOError) as e:
            print(f"警告：解析文件失败 {file_path}，错误：{str(e)}")
            return None

    def _update_stats(self, data_file: DataFile):
        self.stats.file_count += 1
        if data_file.type == 'word':
            self.stats.word_count += data_file.count
        elif data_file.type == 'phrase':
            self.stats.phrase_count += data_file.count

    def read_all_files(self) -> List[DataFile]:
        if not os.path.exists(self.datapacks_path):
            raise FileNotFoundError(f"数据包目录不存在：{self.datapacks_path}")

        json_files = self._scan_json_files(self.datapacks_path)

        for file_path in json_files:
            data_file = self._parse_json_file(file_path)
            if data_file is not None:
                self._update_stats(data_file)
                self.data_files.append(data_file)

        return self.data_files

    def get_words(self) -> List[DataFile]:
        return [f for f in self.data_files if f.type == 'word']

    def get_phrases(self) -> List[DataFile]:
        return [f for f in self.data_files if f.type == 'phrase']

    def get_all_items(self) -> List[Dict[str, Any]]:
        all_items = []
        for data_file in self.data_files:
            for item in data_file.data:
                item_copy = item.copy()
                item_copy['_source_file'] = data_file.filename
                item_copy['_source_uuid'] = data_file.uuid
                item_copy['_source_type'] = data_file.type
                all_items.append(item_copy)
        return all_items

    def get_words_items(self) -> List[Dict[str, Any]]:
        all_items = []
        for data_file in self.get_words():
            for item in data_file.data:
                item_copy = item.copy()
                item_copy['_source_file'] = data_file.filename
                item_copy['_source_uuid'] = data_file.uuid
                all_items.append(item_copy)
        return all_items

    def get_phrases_items(self) -> List[Dict[str, Any]]:
        all_items = []
        for data_file in self.get_phrases():
            for item in data_file.data:
                item_copy = item.copy()
                item_copy['_source_file'] = data_file.filename
                item_copy['_source_uuid'] = data_file.uuid
                all_items.append(item_copy)
        return all_items

    def to_dict(self) -> Dict[str, Any]:
        return {
            'stats': {
                'word_count': self.stats.word_count,
                'phrase_count': self.stats.phrase_count,
                'file_count': self.stats.file_count,
                'total_count': self.stats.total
            },
            'files': [
                {
                    'filename': f.filename,
                    'type': f.type,
                    'uuid': f.uuid,
                    'data': f.data,
                    'count': f.count
                }
                for f in self.data_files
            ]
        }


def main():
    print("LearnForge (LFG) - 数据包读取程序")
    print("=" * 50)

    reader = DataPackReader()

    print(f"数据包路径：{reader.datapacks_path}")
    print("\n开始扫描数据包...")

    try:
        reader.read_all_files()
    except FileNotFoundError as e:
        print(f"\n错误：{str(e)}")
        sys.exit(1)

    if not reader.data_files:
        print("\n未找到任何数据包文件！")
        return

    print(f"\n读取完成，共发现 {reader.stats.file_count} 个数据文件：")
    print(f"  - 单词(Word)文件：{len(reader.get_words())} 个，包含 {reader.stats.word_count} 个单词")
    print(f"  - 短语(Phrase)文件：{len(reader.get_phrases())} 个，包含 {reader.stats.phrase_count} 个短语")

    print("\n文件列表：")
    for data_file in reader.data_files:
        print(f"  [{data_file.type.upper():6s}] {data_file.filename} (UUID: {data_file.uuid}, 包含 {data_file.count} 条记录)")

    output_path = reader._get_output_path()
    output_dir = os.path.dirname(output_path)

    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(reader.to_dict(), f, ensure_ascii=False, indent=2)

    print(f"\n数据包已保存到：{output_path}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n错误：{str(e)}")
        sys.exit(1)
