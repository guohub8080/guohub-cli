import sys
from pathlib import Path

from PIL import Image

from scripts.common_py.log import guohub_error_print, guohub_json_print, guohub_logger


def trim_transparent(input_path: str, output_path: str | None = None) -> dict:
    src = Path(input_path)
    if not src.exists():
        guohub_error_print(f"文件不存在: {input_path}")

    if src.suffix.lower() != ".png":
        guohub_error_print(f"只支持 PNG 格式: {input_path}")

    img = Image.open(src)

    if img.mode != "RGBA":
        guohub_error_print(f"图片必须是 RGBA 模式（带透明通道），当前: {img.mode}")

    alpha = img.split()[3]

    # 找到非透明像素的边界框
    bbox = alpha.getbbox()
    if bbox is None:
        guohub_error_print("图片完全透明，无可裁剪内容")

    left, upper, right, lower = bbox
    trimmed = [left, upper, img.width - right, img.height - lower]
    is_trimmed = any(t > 0 for t in trimmed)

    if not is_trimmed:
        guohub_error_print(f"图片无透明边，无需裁剪: {src.name} ({img.width}x{img.height})")

    cropped = img.crop(bbox)

    # 确定输出路径
    if output_path:
        dest = Path(output_path)
    else:
        dest = src.parent / f"{src.stem}_trimmed.png"

    dest.parent.mkdir(parents=True, exist_ok=True)
    cropped.save(dest, "PNG")

    guohub_logger.info(
        f"裁剪: {src.name} ({img.width}x{img.height}) → {dest.name} ({cropped.width}x{cropped.height}), "
        f"裁掉 左={left} 上={upper} 右={trimmed[2]} 下={trimmed[3]}"
    )

    return {
        "input": str(src),
        "output": str(dest),
        "original_size": [img.width, img.height],
        "trimmed_size": [cropped.width, cropped.height],
        "trimmed_pixels": {
            "left": left,
            "upper": upper,
            "right": trimmed[2],
            "lower": trimmed[3],
        },
    }


def main():
    args = sys.argv[1:]
    if not args:
        guohub_error_print("用法: trim-transparent <png文件路径> [输出路径]")

    input_path = args[0]
    output_path = args[1] if len(args) > 1 else None

    result = trim_transparent(input_path, output_path)
    guohub_json_print(result)


if __name__ == "__main__":
    main()
