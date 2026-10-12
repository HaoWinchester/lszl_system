"""TableV1 服务端校验。与 new-legacy/src/canvas/table-model.js 保持同一限额语义。"""
import re
from pydantic import BaseModel, ConfigDict, Field, model_validator

LIMITS = {
    'MAX_ROWS': 100, 'MAX_COLS': 50,
    'MAX_CELLS_PER_TABLE': 5000, 'MAX_CELLS_PER_CANVAS': 20000,
    'MAX_CELL_CHARS': 3000, 'DEFAULT_ROWS': 3, 'DEFAULT_COLS': 3,
}
_CELL_KEY = re.compile(r'^(\d+),(\d+)$')


class TableMerge(BaseModel):
    model_config = ConfigDict(extra='forbid')
    row: int
    column: int
    rowSpan: int
    columnSpan: int


class CanvasTable(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: str
    schemaVersion: int
    x: float = 0
    y: float = 0
    rows: int
    cols: int
    columnWidths: list[float]
    rowHeights: list[float]
    cells: dict[str, str] = Field(default_factory=dict)
    merges: list[TableMerge] = Field(default_factory=list)

    @model_validator(mode='after')
    def check_contract(self):
        if self.schemaVersion != 1:
            raise ValueError('不支持的表格版本')
        if not 1 <= self.rows <= LIMITS['MAX_ROWS']:
            raise ValueError(f'表格行数必须在 1-{LIMITS["MAX_ROWS"]} 之间')
        if not 1 <= self.cols <= LIMITS['MAX_COLS']:
            raise ValueError(f'表格列数必须在 1-{LIMITS["MAX_COLS"]} 之间')
        if self.rows * self.cols > LIMITS['MAX_CELLS_PER_TABLE']:
            raise ValueError(f'表格单元格总数不能超过 {LIMITS["MAX_CELLS_PER_TABLE"]}')
        if len(self.columnWidths) != self.cols or not all(w > 0 for w in self.columnWidths):
            raise ValueError('列宽配置无效')
        if len(self.rowHeights) != self.rows or not all(h > 0 for h in self.rowHeights):
            raise ValueError('行高配置无效')
        if not self.id:
            raise ValueError('表格缺少 id')
        for key, value in self.cells.items():
            match = _CELL_KEY.match(key)
            if not match or int(match.group(1)) >= self.rows or int(match.group(2)) >= self.cols:
                raise ValueError(f'单元格坐标越界：{key}')
            if len(value) > LIMITS['MAX_CELL_CHARS']:
                raise ValueError(f'单元格 {key} 超过 {LIMITS["MAX_CELL_CHARS"]} 字符上限')
        taken: set[tuple[int, int]] = set()
        for merge in self.merges:
            if merge.rowSpan < 1 or merge.columnSpan < 1 or merge.row < 0 or merge.column < 0:
                raise ValueError('合并区域无效')
            if merge.row + merge.rowSpan > self.rows or merge.column + merge.columnSpan > self.cols:
                raise ValueError('合并区域越界')
            for r in range(merge.row, merge.row + merge.rowSpan):
                for c in range(merge.column, merge.column + merge.columnSpan):
                    if (r, c) in taken:
                        raise ValueError('合并区域相互重叠')
                    taken.add((r, c))
        return self


def tables_cell_count(tables: list[CanvasTable]) -> int:
    return sum(t.rows * t.cols for t in tables)


def validate_tables(tables: list[CanvasTable]) -> None:
    """画布级上限：超限整体拒绝。"""
    if tables_cell_count(tables) > LIMITS['MAX_CELLS_PER_CANVAS']:
        raise ValueError(f'画布单元格总数不能超过 {LIMITS["MAX_CELLS_PER_CANVAS"]}')
