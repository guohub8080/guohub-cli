import argparse
import secrets
import string

import pyperclip

from scripts.common_py.log import guohub_logger, guohub_text_print, guohub_error_print


UPPER = string.ascii_uppercase
LOWER = string.ascii_lowercase
DIGITS = string.digits
SAFE_SYMBOLS = "!@#$%&-_+="
ALL_SYMBOLS = "!@#$%^&*()-_=+[]{}|;:',.<>?/`~"


def gen_password(length, upper=True, lower=True, digits=True, symbols=True, symbols_set=SAFE_SYMBOLS):
    chars = ""
    required = []
    if upper:
        chars += UPPER
        required.append(secrets.choice(UPPER))
    if lower:
        chars += LOWER
        required.append(secrets.choice(LOWER))
    if digits:
        chars += DIGITS
        required.append(secrets.choice(DIGITS))
    if symbols:
        chars += symbols_set
        required.append(secrets.choice(symbols_set))
    if not chars:
        return ""

    rest = [secrets.choice(chars) for _ in range(length - len(required))]
    result = required + rest
    secrets.SystemRandom().shuffle(result)
    return "".join(result)


def main():
    parser = argparse.ArgumentParser(description="生成随机密码")
    parser.add_argument("--length", type=int, default=18, help="密码长度（默认 18）")
    parser.add_argument("--no-upper", action="store_true", help="不含大写字母")
    parser.add_argument("--no-lower", action="store_true", help="不含小写字母")
    parser.add_argument("--no-digits", action="store_true", help="不含数字")
    parser.add_argument("--no-symbols", action="store_true", help="不含符号")
    parser.add_argument("--count", type=int, default=1, help="生成数量（默认 1）")
    parser.add_argument("--no-copy", action="store_true", help="不复制到剪贴板")
    parser.add_argument("--all-symbols", action="store_true", help="使用完整符号集（含易冲突符号）")
    args = parser.parse_args()

    symbols = ALL_SYMBOLS if args.all_symbols else SAFE_SYMBOLS
    results = []
    for _ in range(args.count):
        pwd = gen_password(
            length=max(args.length, 4),
            upper=not args.no_upper,
            lower=not args.no_lower,
            digits=not args.no_digits,
            symbols=not args.no_symbols,
            symbols_set=symbols,
        )
        results.append(pwd)

    if not args.no_copy:
        pyperclip.copy(results[-1])
        guohub_logger.info("已复制最后一个密码到剪贴板")

    guohub_text_print("\n".join(results))


if __name__ == "__main__":
    main()
