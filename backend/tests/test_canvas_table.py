"""TableV1 服务端校验：与 JS 共享限额语义（new-legacy/src/canvas/table-model.js）。"""
import pytest
from pydantic import ValidationError
from app.schemas.canvas_table import CanvasTable, TableMerge, validate_tables, LIMITS


def table(**overrides):
    base = dict(id='tb_test', schemaVersion=1, x=10, y=20, rows=3, cols=3,
                columnWidths=[140.0] * 3, rowHeights=[40.0] * 3,
                cells={'0,0': '中文'}, merges=[])
    base.update(overrides)
    return CanvasTable(**base)


def test_accepts_valid_table_with_sparse_cells_and_merges():
    t = table(cells={'0,0': '第一', '2,2': '　'}, merges=[TableMerge(row=0, column=0, rowSpan=2, columnSpan=2)])
    assert t.rows * t.cols == 9
    assert t.merges[0].rowSpan == 2


def test_rejects_invalid_structure():
    with pytest.raises(ValidationError, match='版本'):
        table(schemaVersion=2)
    with pytest.raises(ValidationError, match='行数'):
        table(rows=0)
    with pytest.raises(ValidationError, match='行数'):
        table(rows=101)
    with pytest.raises(ValidationError, match='列数'):
        table(cols=51)
    with pytest.raises(ValidationError, match='列宽'):
        table(columnWidths=[140.0, 140.0])
    with pytest.raises(ValidationError, match='行高'):
        table(rowHeights=[40.0, 40.0, 40.0, 40.0])
    with pytest.raises(ValidationError, match='越界'):
        table(cells={'3,0': 'x'})
    with pytest.raises(ValidationError, match='3000'):
        table(cells={'0,0': 'x' * 3001})
    with pytest.raises(ValidationError, match='id'):
        table(id='')
    with pytest.raises(ValidationError):
        table(extra='nope')


def test_rejects_invalid_or_overlapping_merges():
    with pytest.raises(ValidationError, match='重叠'):
        table(merges=[TableMerge(row=0, column=0, rowSpan=2, columnSpan=2),
                      TableMerge(row=1, column=1, rowSpan=2, columnSpan=2)])
    with pytest.raises(ValidationError, match='越界'):
        table(merges=[TableMerge(row=2, column=2, rowSpan=2, columnSpan=1)])
    with pytest.raises(ValidationError, match='无效'):
        table(merges=[TableMerge(row=0, column=0, rowSpan=0, columnSpan=1)])


def test_table_and_canvas_cell_limits():
    big = table(id='tb_big', rows=100, cols=50,
                columnWidths=[140.0] * 50, rowHeights=[40.0] * 100)
    assert big.rows * big.cols == LIMITS['MAX_CELLS_PER_TABLE']
    # 恰好 20000 格合法（4 张满额表），25000 整体拒绝。
    validate_tables([big] * 4)
    with pytest.raises(ValueError, match='20000'):
        validate_tables([big] * 4 + [big.model_copy(deep=True)])
