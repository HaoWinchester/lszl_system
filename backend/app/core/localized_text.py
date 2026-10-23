"""Display text for localized labels, including legacy stringified locale maps."""
import ast
import json


def localized_text(value: object) -> str:
    if isinstance(value, str):
        raw = value.strip()
        # Old imports persisted str({'zh': ..., 'en': ...}) in title columns.
        if raw.startswith('{') and raw.endswith('}') and len(raw) <= 4096:
            try:
                parsed = json.loads(raw)
            except (ValueError, RecursionError):
                try:
                    parsed = ast.literal_eval(raw)
                except (ValueError, SyntaxError, RecursionError):
                    parsed = None
            if (isinstance(parsed, dict) and parsed and parsed.keys() <= {'zh', 'en'}
                    and all(v is None or isinstance(v, str) for v in parsed.values())):
                value = parsed
    if isinstance(value, dict):
        return str(value.get('zh') or value.get('en') or '').strip()
    return str(value or '').strip()
