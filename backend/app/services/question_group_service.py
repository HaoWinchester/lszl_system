"""Shared case integrity checks and deterministic, indivisible selection units."""
from __future__ import annotations


def validate_case_groups(snapshots: list[dict]) -> None:
    groups = {}
    for index, snapshot in enumerate(snapshots):
        group = snapshot.get('caseGroup')
        if group is None:
            continue
        material = snapshot.get('material')
        if not isinstance(group, dict) or not isinstance(material, dict):
            raise ValueError('案例题必须引用材料')
        if not group.get('id') or group['id'] != material.get('id'):
            raise ValueError('caseGroup.id 必须等于 material.id')
        if any(isinstance(group.get(k), bool) or not isinstance(group.get(k), int) or group[k] < 1 for k in ('order', 'total')):
            raise ValueError('案例子题顺序和总数必须为正整数')
        groups.setdefault(group['id'], []).append((index, group, material))
    for rows in groups.values():
        total = rows[0][1]['total']
        material = rows[0][2]
        if len(rows) != total or any(g['total'] != total or m != material for _, g, m in rows):
            raise ValueError('案例子题必须完整且使用同一材料版本')
        if [g['order'] for _, g, _ in rows] != list(range(1, total + 1)):
            raise ValueError('案例子题必须按 order 排序')
        positions = [i for i, _, _ in rows]
        if positions != list(range(positions[0], positions[0] + total)):
            raise ValueError('案例子题必须连续排列')


def select_grouped(rows: list, count: int, *, random_key=None) -> tuple[list, list[int]]:
    units = []
    groups = {}
    for row in sorted(rows, key=lambda item: item.order_index):
        group = (row.snapshot or {}).get('caseGroup')
        if group:
            key = group['id']
            if key not in groups:
                groups[key] = []
                units.append(groups[key])
            groups[key].append(row)
        else:
            units.append([row])
    for unit in units:
        unit.sort(key=lambda row: ((row.snapshot or {}).get('caseGroup') or {}).get('order', 1))
    if random_key:
        units.sort(key=lambda unit: random_key(unit[0]))
    reachable = {0: []}
    for index, unit in enumerate(units):
        for size, picked in list(reachable.items()):
            target = size + len(unit)
            if target not in reachable:
                reachable[target] = picked + [index]
    return ([row for i in reachable[count] for row in units[i]] if count in reachable else []), sorted(reachable)
