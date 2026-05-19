import argparse
import sys

import pyperclip

from scripts.common_py.log import guohub_logger, guohub_text_print, guohub_success_print, guohub_error_print


OPEN_DQ = "“"
CLOSE_DQ = "”"
OPEN_SQ = "‘"
CLOSE_SQ = "’"


def fix_quotes(text):
    text = text.replace("“", '"').replace("”", '"').replace("„", '"').replace("‟", '"')
    text = text.replace("‘", "'").replace("’", "'").replace("‚", "'").replace("‛", "'")

    out = []
    dq_open = False
    sq_open = False
    for ch in text:
        if ch == '"':
            out.append(OPEN_DQ if not dq_open else CLOSE_DQ)
            dq_open = not dq_open
        elif ch == "'":
            out.append(OPEN_SQ if not sq_open else CLOSE_SQ)
            sq_open = not sq_open
        else:
            out.append(ch)
    return "".join(out)


def check_quotes(text):
    issues = []
    dq_open = False
    sq_open = False
    for i, ch in enumerate(text):
        if ch == '"':
            dq_open = not dq_open
        elif ch == "'":
            sq_open = not sq_open
        elif ch in (OPEN_DQ, CLOSE_DQ):
            if ch == OPEN_DQ:
                if dq_open:
                    issues.append(f"第 {i + 1} 字符：双引号未闭合就开了新的")
                dq_open = True
            else:
                if not dq_open:
                    issues.append(f"第 {i + 1} 字符：双引号多了一个右引号")
                dq_open = False
        elif ch in (OPEN_SQ, CLOSE_SQ):
            if ch == OPEN_SQ:
                if sq_open:
                    issues.append(f"第 {i + 1} 字符：单引号未闭合就开了新的")
                sq_open = True
            else:
                if not sq_open:
                    issues.append(f"第 {i + 1} 字符：单引号多了一个右引号")
                sq_open = False
    if dq_open:
        issues.append("双引号未闭合")
    if sq_open:
        issues.append("单引号未闭合")
    return issues


def main():
    parser = argparse.ArgumentParser(description="将英文直引号转为中文弯引号")
    parser.add_argument("-f", "--file", help="从文件读取")
    parser.add_argument("--from-clipboard", action="store_true", help="从剪贴板读取")
    parser.add_argument("--to-clipboard", action="store_true", help="结果写回剪贴板")
    parser.add_argument("--check", action="store_true", help="只检查引号问题，不修复")
    args = parser.parse_args()

    if args.file:
        from pathlib import Path
        text = Path(args.file).read_text(encoding="utf-8")
    elif args.from_clipboard:
        text = pyperclip.paste()
    elif not sys.stdin.isatty():
        text = sys.stdin.read()
    else:
        parser.print_help()
        return

    if args.check:
        issues = check_quotes(text)
        if issues:
            for issue in issues:
                guohub_logger.info(issue)
            guohub_error_print("引号检查未通过")
        else:
            guohub_logger.info("引号检查通过")
            guohub_success_print()

    result = fix_quotes(text)
    if args.to_clipboard:
        pyperclip.copy(result)
        guohub_logger.info("已复制到剪贴板")
    guohub_text_print(result)


if __name__ == "__main__":
    main()
