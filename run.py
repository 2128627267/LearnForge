"""
LearnForge (LFG) - 启动脚本
用于快速启动主程序
"""

import sys
import os

# 添加 src 目录到 Python 路径
src_path = os.path.join(os.path.dirname(__file__), "src")
sys.path.insert(0, src_path)

from main import main

if __name__ == "__main__":
    main()
