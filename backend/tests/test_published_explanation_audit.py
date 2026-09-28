from scripts.audit_published_explanations import explanation_presence


def test_explanation_audit_detects_empty_markup_and_translation_only_content():
    assert explanation_presence({'analysis': '<p>&nbsp; </p>'}) == (False, False)
    assert explanation_presence({'analysis': '解析依据', 'translations': {'en': {'explanation': 'Because'}}}) == (True, True)
    assert explanation_presence({'translations': {'en': {'analysis': 'Because'}}}) == (False, True)
    assert explanation_presence({'explanation': '<img src="/example.png">'}) == (True, False)
    assert explanation_presence({'translations': None}) == (False, False)
