"""Common bounded wire format for world-coordinate canvas strokes."""

import math
import re
from typing import Any


_COLOR = re.compile(r"#[0-9a-fA-F]{6}")
_FIELDS = {"id", "tool", "color", "width", "points"}
_TEXT_FIELDS = {"id", "tool", "color", "width", "points", "text"}
# 各工具允许的粗细/字号范围，须与前端 94-canvas-ink.js 的 TOOLS 保持一致
_TOOL_WIDTH_RANGE = {"pen": (1, 24), "highlighter": (4, 48), "text": (12, 72)}


def _number(value: Any, minimum: float, maximum: float) -> bool:
    return (
        type(value) in (int, float)
        and minimum <= value <= maximum
        and math.isfinite(value)
    )


def validate_strokes(value: Any) -> list[dict]:
    """Validate and clone strokes without coercing malformed wire values."""
    if not isinstance(value, list) or len(value) > 2000:
        raise ValueError("笔迹必须是数组，且最多 2000 笔")
    result = []
    ids = set()
    total_points = 0
    for stroke in value:
        if not isinstance(stroke, dict) or set(stroke) not in (_FIELDS, _TEXT_FIELDS):
            raise ValueError("笔迹必须包含 id、tool、color、width、points 且不能有额外字段")
        stroke_id = stroke["id"]
        if not isinstance(stroke_id, str) or not stroke_id.strip() or len(stroke_id) > 100:
            raise ValueError("笔迹 ID 必须是 1–100 字符的非空字符串")
        if stroke_id in ids:
            raise ValueError("笔迹 ID 不能重复")
        ids.add(stroke_id)
        tool = stroke["tool"]
        if tool not in _TOOL_WIDTH_RANGE:
            raise ValueError("笔迹工具必须是 pen、highlighter 或 text")
        color = stroke["color"]
        if not isinstance(color, str) or not _COLOR.fullmatch(color):
            raise ValueError("笔迹颜色必须是六位十六进制颜色")
        minimum, maximum = _TOOL_WIDTH_RANGE[tool]
        if not _number(stroke["width"], minimum, maximum):
            raise ValueError("笔迹粗细超出工具允许范围")
        points = stroke["points"]
        if not isinstance(points, list) or not 1 <= len(points) <= 5000:
            raise ValueError("每笔必须包含 1–5000 个坐标点")
        total_points += len(points)
        if total_points > 100000:
            raise ValueError("画布笔迹总点数最多 100000")
        if tool == "text" or "text" in stroke:
            text = stroke.get("text")
            if not isinstance(text, str) or not text.strip() or len(text) > 500:
                raise ValueError("文字笔迹内容必须是 1–500 字符的非空字符串")
        cloned_points = []
        for point in points:
            if (
                not isinstance(point, list) or len(point) != 2
                or not all(_number(axis, -10000000, 10000000) for axis in point)
            ):
                raise ValueError("笔迹坐标必须是有限的 [x,y] 数值对且绝对值不超过 10000000")
            cloned_points.append(list(point))
        result.append({**stroke, "points": cloned_points})
    return result
