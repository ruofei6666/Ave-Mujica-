#!/usr/bin/env python3
"""把 art-inbox/ 里的生图原图处理成界面实际加载的素材，输出到 assets/ui/art/。

用法：
    python scripts/prepare-ui-art.py            处理 art-inbox/ 里找到的所有素材
    python scripts/prepare-ui-art.py --check    只检查哪些已放入、哪些缺失，不写文件
    python scripts/prepare-ui-art.py --only bg-menu emblem

按文件名（不含扩展名）识别素材，png / jpg / webp 都可以：
    背景图  bg-menu  bg-arena-a  bg-arena-b   居中裁成 16:9，缩到 1920x1080，存为不透明 webp
    遮罩图  fx-grunge fx-speed fx-burst emblem 黑底白图 -> 白色 + 透明度（亮度变成 alpha），界面里用 CSS 染色
    图集    deco-shards deco-marks             黑底白图集，自动切成 deco-shards-1.webp ... 单图

遮罩图为什么不直接用黑底：带 alpha 的白图可以直接叠在任何颜色上，也能用 CSS mask 染成角色主题色，
而且不需要 mix-blend-mode，手机上更省。
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
EXTENSIONS = ('.png', '.jpg', '.jpeg', '.webp')

# 槽位名 -> 输出尺寸。背景是 (宽, 高)；遮罩同样；图集是切片后的最长边。
PLATES = {'bg-menu': (1920, 1080), 'bg-arena-a': (1920, 1080), 'bg-arena-b': (1920, 1080)}
MASKS = {'fx-grunge': (1600, 900), 'fx-speed': (1600, 900), 'fx-burst': (768, 768), 'emblem': (512, 512)}
SHEETS = {'deco-shards': (640, 8, (4, 2)), 'deco-marks': (512, 12, (4, 3))}  # 最长边, 提示词里要求的形状数, 网格(列, 行)
ALL_SLOTS = [*PLATES, *MASKS, *SHEETS]


def find_source(inbox: Path, slot: str) -> Path | None:
    for path in sorted(inbox.iterdir()) if inbox.is_dir() else []:
        if path.stem.lower() == slot and path.suffix.lower() in EXTENSIONS:
            return path
    return None


def load_rgb(path: Path) -> Image.Image:
    with Image.open(path) as source:
        return ImageOps.exif_transpose(source).convert('RGB')


def alpha_from_light(image: Image.Image) -> np.ndarray:
    """黑底白图 -> 0..1 的透明度。取 RGB 最大通道，彩色亮线也能保住；再按分位数归一化，容忍不够黑的底。"""
    value = np.asarray(image, dtype=np.float32).max(axis=2) / 255.0
    black = float(np.clip(np.percentile(value, 2), 0.02, 0.30))
    white = float(max(0.55, np.percentile(value, 99.7)))
    return np.clip((value - black) / max(white - black, 1e-3), 0.0, 1.0)


def white_rgba(alpha: np.ndarray) -> Image.Image:
    rgba = np.empty((*alpha.shape, 4), dtype=np.uint8)
    rgba[..., :3] = 255
    rgba[..., 3] = np.round(alpha * 255).astype(np.uint8)
    return Image.fromarray(rgba, 'RGBA')


def save_webp(image: Image.Image, path: Path, quality: int) -> tuple[int, int, int]:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, 'WEBP', quality=quality, method=6)
    return image.width, image.height, path.stat().st_size


def label_components(binary: np.ndarray) -> tuple[np.ndarray, int]:
    """四连通标记。图已经缩小到几百像素，用纯 Python 广度优先就够快，也避免依赖 scipy。"""
    height, width = binary.shape
    labels = np.zeros((height, width), dtype=np.int32)
    count = 0
    for start_y, start_x in zip(*np.nonzero(binary)):
        if labels[start_y, start_x]:
            continue
        count += 1
        labels[start_y, start_x] = count
        queue = deque([(start_y, start_x)])
        while queue:
            y, x = queue.popleft()
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < height and 0 <= nx < width and binary[ny, nx] and not labels[ny, nx]:
                    labels[ny, nx] = count
                    queue.append((ny, nx))
    return labels, count


def dilate(binary: np.ndarray, radius: int) -> np.ndarray:
    """方形膨胀（先横后竖），让一个形状里零散的碎片（碎玻璃、喷溅、网点）连成一块。"""
    height, width = binary.shape
    padded = np.pad(binary, ((0, 0), (radius, radius)))
    wide = np.zeros_like(binary)
    for dx in range(2 * radius + 1):
        wide |= padded[:, dx:dx + width]
    padded = np.pad(wide, ((radius, radius), (0, 0)))
    out = np.zeros_like(binary)
    for dy in range(2 * radius + 1):
        out |= padded[dy:dy + height, :]
    return out


Box = tuple[int, int, int, int, int]  # (label, x0, y0, x1, y1)


def reading_order(boxes: list[Box]) -> list[Box]:
    """先按行（容忍纵向抖动）再按列，得到人眼阅读顺序。"""
    if not boxes:
        return boxes
    heights = sorted(b[4] - b[2] for b in boxes)
    tolerance = max(4, heights[len(heights) // 2] * 0.5)
    rows: list[list[Box]] = []
    for box in sorted(boxes, key=lambda b: (b[2] + b[4]) / 2):
        center = (box[2] + box[4]) / 2
        if rows and abs(center - np.mean([(b[2] + b[4]) / 2 for b in rows[-1]])) <= tolerance:
            rows[-1].append(box)
        else:
            rows.append([box])
    return [box for row in rows for box in sorted(row, key=lambda b: b[1])]


def find_shapes(small: np.ndarray, radius_fraction: float) -> tuple[np.ndarray, list[Box]]:
    """按给定的合并半径做连通域标记，丢掉小于画面 0.25% 的噪点。"""
    height, width = small.shape
    labels, count = label_components(dilate(small, max(2, round(max(width, height) * radius_fraction))))
    boxes: list[Box] = []
    for label in range(1, count + 1):
        ys, xs = np.nonzero(labels == label)
        if len(xs) >= width * height * 0.0025:
            boxes.append((label, int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
    return labels, boxes


def cut_piece(alpha: np.ndarray, labels: np.ndarray, group: list[int], max_side: int) -> Image.Image | None:
    small_h, small_w = labels.shape
    height, width = alpha.shape
    region = np.isin(labels, group)
    ys, xs = np.nonzero(region)
    if not len(xs):
        return None
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()) + 1, int(ys.min()), int(ys.max()) + 1
    sx, sy = width / small_w, height / small_h
    left, top, right, bottom = max(0, int(x0 * sx)), max(0, int(y0 * sy)), min(width, int(x1 * sx) + 1), min(height, int(y1 * sy) + 1)
    mask = np.asarray(Image.fromarray((region[y0:y1, x0:x1] * 255).astype(np.uint8)).resize((right - left, bottom - top), Image.NEAREST)) > 0
    piece = alpha[top:bottom, left:right] * mask
    ys, xs = np.nonzero(piece > 0.04)
    if not len(xs):
        return None
    pad = max(2, round(max(piece.shape) * 0.02))
    image = white_rgba(np.pad(piece[ys.min():ys.max() + 1, xs.min():xs.max() + 1], pad))
    if max(image.size) > max_side:
        ratio = max_side / max(image.size)
        image = image.resize((max(1, round(image.width * ratio)), max(1, round(image.height * ratio))), Image.LANCZOS)
    return image


def slice_sheet(alpha: np.ndarray, max_side: int, expected: int, grid: tuple[int, int]) -> tuple[list[Image.Image], str]:
    """把图集切成单图。

    先逐档加大合并半径，找到恰好得到 expected 个形状的一档；找不到时退回网格归并：
    细碎片按重心落入的格子（列x行）合并，空格子跳过。返回 (切片, 说明)。
    """
    height, width = alpha.shape
    scale = min(1.0, 420 / max(height, width))
    small = np.asarray(
        Image.fromarray((alpha * 255).astype(np.uint8)).resize((max(1, round(width * scale)), max(1, round(height * scale))), Image.BILINEAR)
    ) > 40
    for fraction in (0.012, 0.02, 0.03, 0.045, 0.06, 0.08):
        labels, boxes = find_shapes(small, fraction)
        if len(boxes) == expected:
            pieces = [cut_piece(alpha, labels, [box[0]], max_side) for box in reading_order(boxes)]
            return [p for p in pieces if p is not None], f'合并半径 {fraction:.1%}，正好 {expected} 个形状'

    labels, boxes = find_shapes(small, 0.012)
    cols, rows = grid
    cells: dict[tuple[int, int], list[int]] = {}
    for label, x0, y0, x1, y1 in boxes:
        cell = (min(rows - 1, int((y0 + y1) / 2 / small.shape[0] * rows)), min(cols - 1, int((x0 + x1) / 2 / small.shape[1] * cols)))
        cells.setdefault(cell, []).append(label)
    pieces = [cut_piece(alpha, labels, group, max_side) for _, group in sorted(cells.items())]
    return [p for p in pieces if p is not None], f'没有正好 {expected} 个形状的合并档，已按 {cols}x{rows} 网格归并，请核对切图'


def describe(path: Path | None) -> str:
    if path is None:
        return '缺失'
    with Image.open(path) as image:
        return f'{path.name}  {image.width}x{image.height}  {path.stat().st_size // 1024} KB'


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--input', type=Path, default=ROOT / 'art-inbox', help='生图原图所在目录')
    parser.add_argument('--output', type=Path, default=ROOT / 'assets' / 'ui' / 'art', help='输出目录（界面从这里读取）')
    parser.add_argument('--only', nargs='+', choices=ALL_SLOTS, metavar='SLOT', help=f'只处理这些素材：{" ".join(ALL_SLOTS)}')
    parser.add_argument('--check', action='store_true', help='只列出放入/缺失情况，不写任何文件')
    args = parser.parse_args()

    inbox, out_dir = args.input, args.output
    slots = args.only or ALL_SLOTS
    sources = {slot: find_source(inbox, slot) for slot in slots}

    print(f'输入 {inbox}\n输出 {out_dir}\n')
    for slot in slots:
        print(f'  {slot:<12} {describe(sources[slot])}')
    missing = [slot for slot, path in sources.items() if path is None]
    if args.check:
        print(f'\n已放入 {len(slots) - len(missing)} / {len(slots)} 张' + (f'，缺：{", ".join(missing)}' if missing else ''))
        return 0

    manifest_path = out_dir / 'manifest.json'
    previous = {}
    if manifest_path.is_file():
        try:
            previous = json.loads(manifest_path.read_text(encoding='utf-8')).get('slots', {})
        except json.JSONDecodeError:
            previous = {}
    entries = dict(previous)
    notes: list[str] = []

    for slot in slots:
        path = sources[slot]
        if path is None:
            continue
        image = load_rgb(path)
        if slot in PLATES:
            size = PLATES[slot]
            ratio = image.width / image.height
            if abs(ratio - 16 / 9) > 0.03:
                notes.append(f'{slot}: 比例 {ratio:.2f}，不是 16:9，已居中裁切，边缘内容会丢失')
            if image.width < size[0] * 0.66:
                notes.append(f'{slot}: 宽度只有 {image.width}px，放大后会偏糊，建议出 1920px 以上')
            width, height, size_bytes = save_webp(ImageOps.fit(image, size, Image.LANCZOS), out_dir / f'{slot}.webp', 82)
            entries[slot] = {'file': f'{slot}.webp', 'width': width, 'height': height, 'kind': 'plate'}
        elif slot in MASKS:
            corner = np.asarray(image, dtype=np.float32).max(axis=2)[:16, :16].mean() / 255
            if corner > 0.2:
                notes.append(f'{slot}: 左上角不够黑（亮度 {corner:.2f}），已自动压黑，但最好让模型出纯黑底')
            size = MASKS[slot]
            fitted = ImageOps.fit(image, size, Image.LANCZOS) if slot.startswith('fx-') else image.resize(size, Image.LANCZOS)
            width, height, size_bytes = save_webp(white_rgba(alpha_from_light(fitted)), out_dir / f'{slot}.webp', 80)
            entries[slot] = {'file': f'{slot}.webp', 'width': width, 'height': height, 'kind': 'mask'}
        else:
            for stale in [key for key in entries if key.startswith(f'{slot}-')]:
                (out_dir / entries.pop(stale)['file']).unlink(missing_ok=True)
            max_side, expected, grid = SHEETS[slot]
            pieces, how = slice_sheet(alpha_from_light(image), max_side, expected, grid)
            if not pieces:
                notes.append(f'{slot}: 没有找到可切的形状，请确认是黑底白图')
            elif len(pieces) != expected:
                notes.append(f'{slot}: 切出 {len(pieces)} 张，提示词要求 {expected} 个（{how}）')
            size_bytes = 0
            for index, piece in enumerate(pieces, start=1):
                width, height, piece_bytes = save_webp(piece, out_dir / f'{slot}-{index}.webp', 85)
                entries[f'{slot}-{index}'] = {'file': f'{slot}-{index}.webp', 'width': width, 'height': height, 'kind': 'mask'}
                size_bytes += piece_bytes
            width = height = len(pieces)
            print(f'  -> {slot}: 切出 {len(pieces)} 张 ({size_bytes // 1024} KB)')
            continue
        print(f'  -> {slot}: {width}x{height}  {size_bytes // 1024} KB')

    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps({'version': int(time.time()), 'slots': dict(sorted(entries.items()))}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    total = sum((out_dir / entry['file']).stat().st_size for entry in entries.values() if (out_dir / entry['file']).is_file())
    print(f'\n已写入 {len(entries)} 个素材，合计 {total // 1024} KB -> {manifest_path}')
    if missing:
        print(f'未放入：{", ".join(missing)}（界面会继续使用代码绘制的备用效果）')
    for note in notes:
        print(f'注意：{note}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
