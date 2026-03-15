"""
LearnForge (LFG) - 数据包读取程序
负责读取和解析数据包及其配置文件
可以独立运行，也可以被其他程序调用
"""

import os
import json
import sys
from typing import Dict, List, Any


class DataPackReader:
    """数据包读取器"""
    
    def __init__(self, databacks_path: str = None):
        """
        初始化读取器
        
        Args:
            databacks_path: 数据包根目录路径，如果为None则使用默认路径
        """
        if databacks_path is None:
            # 默认路径：项目根目录下的 databacks 文件夹
            self.databacks_path = self._get_default_databacks_path()
        else:
            self.databacks_path = databacks_path
        
        self.data_packs = {}
    
    def _get_default_databacks_path(self) -> str:
        """获取默认的数据包路径"""
        # 获取项目根目录
        current_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.dirname(current_dir)
        return os.path.join(project_root, "datapacks")
    
    def _get_output_path(self) -> str:
        """获取默认的输出数据路径"""
        # 获取项目根目录
        current_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.dirname(current_dir)
        return os.path.join(project_root, "data", "data_packs.json")
    
    def read_all_packs(self) -> Dict[str, Any]:
        """
        读取所有数据包
        
        Returns:
            包含所有数据包信息的字典
        """
        if not os.path.exists(self.databacks_path):
            raise FileNotFoundError(f"数据包目录不存在：{self.databacks_path}")
        
        # 遍历数据包目录下的所有文件夹
        for pack_name in os.listdir(self.databacks_path):
            pack_path = os.path.join(self.databacks_path, pack_name)
            
            # 跳过非目录文件
            if not os.path.isdir(pack_path):
                continue
            
            # 读取数据包
            try:
                pack_info = self._read_pack(pack_path, pack_name)
                if pack_info:
                    self.data_packs[pack_name] = pack_info
            except Exception as e:
                print(f"警告：读取数据包 {pack_name} 失败：{str(e)}")
                continue
        
        return self.data_packs
    
    def _read_pack(self, pack_path: str, pack_name: str) -> Dict[str, Any]:
        """
        读取单个数据包
        
        Args:
            pack_path: 数据包路径
            pack_name: 数据包名称
            
        Returns:
            数据包信息字典
        """
        # 读取 pack.json 配置文件
        pack_config_path = os.path.join(pack_path, "pack.json")
        if not os.path.exists(pack_config_path):
            raise FileNotFoundError(f"未找到 pack.json 配置文件")
        
        with open(pack_config_path, 'r', encoding='utf-8') as f:
            pack_config = json.load(f)
        
        # 获取数据入口文件夹
        structure = pack_config.get('structure', {})
        entrance = structure.get('entrance', 'data')
        data_path = os.path.join(pack_path, entrance)
        
        if not os.path.exists(data_path):
            raise FileNotFoundError(f"数据入口文件夹不存在：{data_path}")
        
        # 读取数据文件
        data_files = self._read_data_files(data_path, pack_config)
        
        # 构建数据包信息
        pack_info = {
            'name': pack_config.get('information', {}).get('name', pack_name),
            'description': pack_config.get('information', {}).get('description', ''),
            'type': pack_config.get('information', {}).get('type', 'unknown'),
            'config': pack_config,
            'data': data_files,
            'word_count': self._count_words(data_files),
            'file_count': len(data_files)
        }
        
        return pack_info
    
    def _read_data_files(self, data_path: str, pack_config: Dict) -> List[Dict]:
        """
        读取数据文件夹中的所有 JSON 文件
        
        Args:
            data_path: 数据文件夹路径
            pack_config: 数据包配置
            
        Returns:
            数据文件列表
        """
        data_files = []
        structure = pack_config.get('structure', {})
        key_map = structure.get('key_map', {})
        
        # 获取单词数组的键名
        words_key = key_map.get('word', 'words')
        
        # 遍历数据文件夹
        for filename in os.listdir(data_path):
            if not filename.endswith('.json'):
                continue
            
            file_path = os.path.join(data_path, filename)
            
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    file_data = json.load(f)
                
                # 提取单词数据
                if words_key in file_data:
                    words = file_data[words_key]
                    data_files.append({
                        'filename': filename,
                        'words': words,
                        'count': len(words)
                    })
            
            except Exception as e:
                print(f"警告：读取文件 {filename} 失败：{str(e)}")
                continue
        
        return data_files
    
    def _count_words(self, data_files: List[Dict]) -> int:
        """
        统计单词总数
        
        Args:
            data_files: 数据文件列表
            
        Returns:
            单词总数
        """
        total = 0
        for file_data in data_files:
            total += file_data.get('count', 0)
        return total


def main():
    """独立运行时的主函数"""
    print("LearnForge (LFG) - 数据包读取程序")
    print("=" * 50)
    
    # 初始化读取器（使用默认路径）
    reader = DataPackReader()
    
    print(f"数据包路径：{reader.databacks_path}")
    print("\n开始读取数据包...")
    
    # 读取数据包
    data_packs = reader.read_all_packs()
    
    if not data_packs:
        print("\n未找到任何数据包！")
        return
    
    # 输出读取结果
    print(f"\n成功读取 {len(data_packs)} 个数据包：")
    for pack_name, pack_info in data_packs.items():
        print(f"  - {pack_name}: {pack_info.get('word_count', 0)} 个单词")
    
    # 保存结果到文件（供处理程序使用）
    output_path = reader._get_output_path()
    
    # 确保输出目录存在
    output_dir = os.path.dirname(output_path)
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
    
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(data_packs, f, ensure_ascii=False, indent=2)
    
    print(f"\n数据包已保存到：{output_path}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n错误：{str(e)}")
        sys.exit(1)
