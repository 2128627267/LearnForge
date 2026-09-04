"""
LearnForge (LFG) - 日志记录程序
负责记录程序运行日志，支持控制台输出和文件记录
"""

import os
import sys
import logging
from datetime import datetime
from typing import Optional


class Logger:
    """日志记录器"""
    
    def __init__(self, name: str = "LearnForge", log_level: int = logging.INFO, 
                 log_to_file: bool = True, log_to_console: bool = True):
        """
        初始化日志记录器
        
        Args:
            name: 日志记录器名称
            log_level: 日志级别（DEBUG, INFO, WARNING, ERROR, CRITICAL）
            log_to_file: 是否记录到文件
            log_to_console: 是否输出到控制台
        """
        self.name = name
        self.log_level = log_level
        self.log_to_file = log_to_file
        self.log_to_console = log_to_console
        
        # 创建日志记录器
        self.logger = logging.getLogger(name)
        self.logger.setLevel(log_level)
        
        # 清除已有的处理器
        self.logger.handlers.clear()
        
        # 设置日志格式
        self.formatter = logging.Formatter(
            '[%(asctime)s] [%(levelname)s] %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
        
        # 添加控制台处理器
        if log_to_console:
            self._add_console_handler()
        
        # 添加文件处理器
        if log_to_file:
            self._add_file_handler()
    
    def _add_console_handler(self):
        """添加控制台处理器"""
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(self.log_level)
        console_handler.setFormatter(self.formatter)
        self.logger.addHandler(console_handler)
    
    def _add_file_handler(self):
        """添加文件处理器"""
        # 获取日志文件路径
        log_file_path = self._get_log_file_path()
        
        # 确保日志目录存在
        log_dir = os.path.dirname(log_file_path)
        if not os.path.exists(log_dir):
            os.makedirs(log_dir)
        
        # 创建文件处理器
        file_handler = logging.FileHandler(log_file_path, encoding='utf-8')
        file_handler.setLevel(self.log_level)
        file_handler.setFormatter(self.formatter)
        self.logger.addHandler(file_handler)
    
    def _get_log_file_path(self) -> str:
        """获取日志文件路径"""
        # 获取项目根目录
        current_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.dirname(current_dir)
        
        # 生成日志文件名（包含日期）
        current_date = datetime.now().strftime('%Y-%m-%d')
        log_filename = f"learnforge_{current_date}.log"
        
        return os.path.join(project_root, "logs", log_filename)
    
    def debug(self, message: str):
        """记录调试日志"""
        self.logger.debug(message)
    
    def info(self, message: str):
        """记录信息日志"""
        self.logger.info(message)
    
    def warning(self, message: str):
        """记录警告日志"""
        self.logger.warning(message)
    
    def error(self, message: str):
        """记录错误日志"""
        self.logger.error(message)
    
    def critical(self, message: str):
        """记录严重错误日志"""
        self.logger.critical(message)
    
    def section(self, title: str):
        """输出分隔线标题"""
        self.info("=" * 50)
        self.info(title)
        self.info("=" * 50)
    
    def step(self, step_num: int, total_steps: int, description: str):
        """记录步骤信息"""
        self.info(f"\n[步骤 {step_num}/{total_steps}] {description}")


# 全局日志记录器实例
_default_logger: Optional[Logger] = None


def get_logger(name: str = "LearnForge", log_level: int = logging.INFO,
               log_to_file: bool = True, log_to_console: bool = True) -> Logger:
    """
    获取全局日志记录器实例
    
    Args:
        name: 日志记录器名称
        log_level: 日志级别
        log_to_file: 是否记录到文件
        log_to_console: 是否输出到控制台
        
    Returns:
        Logger 实例
    """
    global _default_logger
    if _default_logger is None:
        _default_logger = Logger(name, log_level, log_to_file, log_to_console)
    return _default_logger


def set_logger(logger: Logger):
    """设置全局日志记录器实例"""
    global _default_logger
    _default_logger = logger


# 便捷的日志函数
def debug(message: str):
    """记录调试日志"""
    get_logger().debug(message)


def info(message: str):
    """记录信息日志"""
    get_logger().info(message)


def warning(message: str):
    """记录警告日志"""
    get_logger().warning(message)


def error(message: str):
    """记录错误日志"""
    get_logger().error(message)


def critical(message: str):
    """记录严重错误日志"""
    get_logger().critical(message)


def section(title: str):
    """输出分隔线标题"""
    get_logger().section(title)


def step(step_num: int, total_steps: int, description: str):
    """记录步骤信息"""
    get_logger().step(step_num, total_steps, description)
