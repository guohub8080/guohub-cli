import logging
import sys
import json

# Windows 下强制 stdout/stderr 使用 UTF-8，避免中文乱码
if sys.platform == "win32":
    sys.stdout = open(sys.stdout.fileno(), mode="w", encoding="utf-8", closefd=False)
    sys.stderr = open(sys.stderr.fileno(), mode="w", encoding="utf-8", closefd=False)

from scripts.common_py.GUOHUB_CLI_CONFIG import NAME_SPACE

logging.basicConfig(level=logging.INFO, stream=sys.stderr, format='[%(asctime)s %(levelname)s] %(message)s', datefmt='%Y-%m-%d %H:%M:%S')
guohub_logger = logging.getLogger(NAME_SPACE)


def guohub_json_print(data):
    """成功"""
    print(json.dumps(data))
    sys.exit(0)


def guohub_error_print(error_info):
    """失败，输出错误信息并以退出码 1 结束"""
    print(json.dumps({"error_info": str(error_info)}))
    sys.exit(1)


def guohub_text_print(text):
    """成功，直接输出纯文本"""
    print(text)
    sys.exit(0)


def guohub_success_print():
    """成功，只返回 is_success: true"""
    print(json.dumps({"is_success": True}))
    sys.exit(0)
