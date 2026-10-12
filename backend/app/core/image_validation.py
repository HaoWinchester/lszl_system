"""Pure byte validation shared by image domains; no authorization here."""
from io import BytesIO
import warnings
from PIL import Image
from fastapi import HTTPException


def validate_image_bytes(data: bytes, mime_type: str) -> tuple[int, int]:
    if not data or len(data) > 5 * 1024 * 1024:
        raise HTTPException(422, detail={'code': 'ASSET_SIZE_INVALID', 'message': '图片不能超过 5 MiB'})
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as image:
                if image.format != {'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/webp': 'WEBP'}.get(mime_type) or image.width * image.height > 40_000_000:
                    raise ValueError('format or pixels')
                dimensions = image.size
                image.verify()
                return dimensions
    except Exception:
        raise HTTPException(422, detail={'code': 'ASSET_INVALID', 'message': '仅支持有效的 PNG、JPEG、WebP 图片'})
