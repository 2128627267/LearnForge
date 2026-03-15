"""
LearnForge (LFG) - 数据处理程序
负责将多个数据包的数据整合到一起
可以独立运行，也可以被其他程序调用
"""

import os
import json
import sys
from typing import Dict, List, Any


class DataProcessor:
    """数据处理器"""
    
    def __init__(self, input_path: str = None):
        """
        初始化处理器
        
        Args:
            input_path: 输入数据路径，如果为None则使用默认路径
        """
        if input_path is None:
            # 默认路径：项目根目录下的 data_packs.json
            self.input_path = self._get_default_input_path()
        else:
            self.input_path = input_path
        
        self.processed_data = {}
    
    def _get_default_input_path(self) -> str:
        """获取默认的输入数据路径"""
        # 获取项目根目录
        current_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.dirname(current_dir)
        return os.path.join(project_root, "data_packs.json")
    
    def _get_output_path(self) -> str:
        """获取默认的输出数据路径"""
        # 获取项目根目录
        current_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.dirname(current_dir)
        return os.path.join(project_root, "data", "output", "processed_data.json")
    
    def process(self, data_packs: Dict[str, Any] = None) -> Dict[str, Any]:
        """
        处理所有数据包
        
        Args:
            data_packs: 数据包字典，如果为None则从文件读取
            
        Returns:
            处理结果字典
        """
        # 如果没有提供数据包，从文件读取
        if data_packs is None:
            data_packs = self._load_data_packs()
        
        if not data_packs:
            return self._empty_result()
        
        # 初始化统计信息
        total_packs = len(data_packs)
        total_words = 0
        total_files = 0
        packs_info = {}
        
        # 处理每个数据包
        for pack_name, pack_info in data_packs.items():
            # 统计信息
            word_count = pack_info.get('word_count', 0)
            file_count = pack_info.get('file_count', 0)
            
            total_words += word_count
            total_files += file_count
            
            # 整合数据
            pack_data = self._process_pack_data(pack_info)
            
            # 保存数据包信息
            packs_info[pack_name] = {
                'name': pack_info.get('name', pack_name),
                'description': pack_info.get('description', ''),
                'type': pack_info.get('type', 'unknown'),
                'word_count': word_count,
                'file_count': file_count,
                'data': pack_data
            }
        
        # 构建处理结果
        result = {
            'total_packs': total_packs,
            'total_words': total_words,
            'total_files': total_files,
            'packs': packs_info,
            'integrated_data': self._integrate_all_data(packs_info)
        }
        
        return result
    
    def _load_data_packs(self) -> Dict[str, Any]:
        """
        从文件加载数据包
        
        Returns:
            数据包字典
        """
        if not os.path.exists(self.input_path):
            raise FileNotFoundError(f"输入数据文件不存在：{self.input_path}")
        
        with open(self.input_path, 'r', encoding='utf-8') as f:
            data_packs = json.load(f)
        
        return data_packs
    
    def _process_pack_data(self, pack_info: Dict) -> Dict[str, List]:
        """
        处理单个数据包的数据
        
        Args:
            pack_info: 数据包信息
            
        Returns:
            处理后的数据字典
        """
        processed_data = {
            'words': [],
            'types': {},
            'meanings': {}
        }
        
        data_files = pack_info.get('data', [])
        config = pack_info.get('config', {})
        
        # 获取词性映射
        type_map = config.get('type_map', {})
        
        # 处理每个数据文件
        for file_data in data_files:
            words = file_data.get('words', [])
            
            for word in words:
                # 提取单词信息
                word_name = word.get('name', '')
                word_type = word.get('type', '')
                word_mean = word.get('mean', [])
                word_sentence = word.get('sentence', [])
                
                if not word_name:
                    continue
                
                # 添加单词
                processed_data['words'].append({
                    'name': word_name,
                    'type': word_type,
                    'mean': word_mean,
                    'sentence': word_sentence
                })
                
                # 统计词性
                if word_type:
                    if word_type not in processed_data['types']:
                        processed_data['types'][word_type] = 0
                    processed_data['types'][word_type] += 1
                
                # 统计释义
                for meaning in word_mean:
                    if meaning not in processed_data['meanings']:
                        processed_data['meanings'][meaning] = 0
                    processed_data['meanings'][meaning] += 1
        
        return processed_data
    
    def _integrate_all_data(self, packs_info: Dict) -> Dict[str, Any]:
        """
        整合所有数据包的数据
        
        Args:
            packs_info: 数据包信息字典
            
        Returns:
            整合后的数据
        """
        integrated = {
            'all_words': [],
            'all_types': {},
            'all_meanings': {},
            'type_distribution': {}
        }
        
        # 整合所有单词
        for pack_name, pack_data in packs_info.items():
            processed = pack_data.get('data', {})
            words = processed.get('words', [])
            
            for word in words:
                integrated['all_words'].append({
                    'name': word['name'],
                    'type': word['type'],
                    'mean': word['mean'],
                    'sentence': word['sentence'],
                    'source': pack_name
                })
        
        # 统计所有词性
        for pack_name, pack_data in packs_info.items():
            processed = pack_data.get('data', {})
            types = processed.get('types', {})
            
            for word_type, count in types.items():
                if word_type not in integrated['all_types']:
                    integrated['all_types'][word_type] = 0
                integrated['all_types'][word_type] += count
        
        # 统计所有释义
        for pack_name, pack_data in packs_info.items():
            processed = pack_data.get('data', {})
            meanings = processed.get('meanings', {})
            
            for meaning, count in meanings.items():
                if meaning not in integrated['all_meanings']:
                    integrated['all_meanings'][meaning] = 0
                integrated['all_meanings'][meaning] += count
        
        # 计算词性分布
        total_words = len(integrated['all_words'])
        for word_type, count in integrated['all_types'].items():
            if total_words > 0:
                percentage = (count / total_words) * 100
                integrated['type_distribution'][word_type] = {
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
            'total_packs': 0,
            'total_words': 0,
            'total_files': 0,
            'packs': {},
            'integrated_data': {
                'all_words': [],
                'all_types': {},
                'all_meanings': {},
                'type_distribution': {}
            }
        }


def main():
    """独立运行时的主函数"""
    print("LearnForge (LFG) - 数据处理程序")
    print("=" * 50)
    
    # 初始化处理器（使用默认路径）
    processor = DataProcessor()
    
    print(f"输入数据路径：{processor.input_path}")
    print("\n开始处理数据...")
    
    # 处理数据
    result = processor.process()
    
    if not result or result.get('total_packs', 0) == 0:
        print("\n未找到任何数据！")
        return
    
    # 输出处理结果
    print(f"\n处理完成！")
    print(f"  - 数据包总数：{result.get('total_packs', 0)}")
    print(f"  - 单词总数：{result.get('total_words', 0)}")
    print(f"  - 数据文件总数：{result.get('total_files', 0)}")
    
    # 保存结果到文件
    output_path = processor._get_output_path()
    
    # 确保输出目录存在
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
