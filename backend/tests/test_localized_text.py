import pytest
from app.core.localized_text import localized_text

@pytest.mark.parametrize('value,expected',[
 ({'zh':' 人 ','en':'People'},'人'),({'zh':'','en':'Process'},'Process'),
 ('过程','过程'),("{'zh': '环境', 'en': 'Environment'}",'环境'),
 ('{"en":"","zh":"PMP"}','PMP'),
 ("{'zh': __import__('os').getcwd()}","{'zh': __import__('os').getcwd()}"),
 ('{项目约束}','{项目约束}'),("{'other':'原样'}","{'other':'原样'}"),
 (None,''),
])
def test_localized_text_preserves_plain_labels_and_safely_reads_legacy_values(value,expected):
 assert localized_text(value)==expected
