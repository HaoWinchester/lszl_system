"""P4.6 第 1 轮性能门禁：练题页发布试卷改走 paper-releases 细粒度 API。

bootstrap 不再向任何页面整包下发发布试卷大键；
catalog 必须分页且有响应上限。
"""

import inspect

from app.services import paper_release_service


def test_paper_release_catalog_is_paginated_and_limited() -> None:
    signature = inspect.signature(paper_release_service.catalog)
    assert "page_size" in signature.parameters
    # /questions 响应有 1MB 上限（MAX_QUESTIONS_RESPONSE_BYTES）
    assert paper_release_service.MAX_QUESTIONS_RESPONSE_BYTES <= 1024 * 1024
