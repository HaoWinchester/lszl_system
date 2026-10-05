"""留言敏感词过滤：命中脏话、反国家等不允许内容时拒绝发布。

词表按类别分组，直接改本文件维护；匹配前先做归一化
（全角转半角、大小写折叠、剔除标点/空白），避免用符号变体绕过。
"""
import unicodedata
from functools import lru_cache

# 类别词表：先窄后宽，宁缺勿滥（归一化去标点会放大命中，词要足够具体）。
WORD_LISTS = {
    # 脏话与辱骂
    "profanity": (
        "傻逼", "煞笔", "傻B", "傻b", "屄", "逼样", "妈逼", "他妈的", "特么的",
        "草泥马", "操你", "草你", "艹你", "fuck", "shit", "bitch", "damn",
        "智障", "白痴", "废物", "贱人", "婊子", "母狗", "去死", "滚蛋",
        "nmsl", "nm$l", "混账", "王八蛋", "龟儿子", "狗娘养",
    ),
    # 反国家/政治敏感
    "political": (
        "颠覆国家", "推翻共产党", "打倒共产党", "反共", "反华", "分裂国家",
        "台独", "港独", "藏独", "疆独", "东突", "法轮功", "六四事件",
        "达赖", "煽动颠覆", "危害国家安全", "恐怖袭击", "圣战", "制造爆炸",
    ),
    # 色情低俗
    "pornography": (
        "嫖娼", "卖淫", "援交", "约炮", "一夜情", "裸聊", "色情网站",
        "porn", "nude", "开价睡", "包夜",
    ),
}

SENSITIVE_HINT = "留言包含不允许的内容，请修改后发布"


def _clean_word(word: str) -> str:
    return normalize(word)


def normalize(text: str) -> str:
    """NFKC 全角转半角 + 大小写折叠 + 剔除标点/符号/空白，防止变体绕过。"""
    if not text:
        return ""
    folded = unicodedata.normalize("NFKC", str(text)).casefold()
    return "".join(
        char for char in folded
        if not unicodedata.category(char).startswith(("P", "Z", "S", "C"))
    )


@lru_cache(maxsize=1)
def all_words() -> tuple:
    return tuple(
        _clean_word(word)
        for words in WORD_LISTS.values() for word in words
        if _clean_word(word)
    )


def find_hits(text: str) -> list:
    """返回命中的原始词表词条（仅用于日志/测试，不对外回显）。"""
    normalized = normalize(text)
    if not normalized:
        return []
    return [word for word in all_words() if word in normalized]


def contains_sensitive(text: str) -> bool:
    return bool(find_hits(text))
