"""Shared ink wire validation, exercised through both persistence boundaries."""

from copy import deepcopy

import pytest

from app.schemas.deep_recall import RecallProgressSaveRequest


def stroke(**changes):
    return {"id": "ink-1", "tool": "pen", "color": "#12AbEF", "width": 3,
            "points": [[0, 0], [-12.5, 22]], **changes}


def request(**changes):
    return RecallProgressSaveRequest.model_validate({
        "expectedRevision": 0, "questionRevision": 1, "libraryHash": "0" * 64,
        "graphSchemaVersion": 3, "nodes": [], "edges": [], **changes,
    })


def test_recall_request_accepts_ink_and_defaults_older_requests_to_empty():
    ink = [stroke(), stroke(id="highlight", tool="highlighter", width=16)]
    assert request(strokes=ink).strokes == ink
    assert request().strokes == []


def test_shared_validator_clones_valid_world_coordinate_points():
    from app.schemas.canvas_ink import validate_strokes

    ink = [stroke()]
    original = deepcopy(ink)
    result = validate_strokes(ink)
    result[0]["points"][0][0] = 999
    assert ink == original
    assert validate_strokes([]) == []


@pytest.mark.parametrize("changes", [
    {"id": ""}, {"id": " "}, {"id": "x" * 101}, {"id": 1},
    {"tool": "eraser"}, {"color": "red"}, {"color": "#fff"},
    {"color": "#123456\n"}, {"width": 0}, {"width": 25},
    {"width": True}, {"width": "3"}, {"width": float("nan")},
    {"tool": "highlighter", "width": 3}, {"tool": "highlighter", "width": 49},
    {"points": []}, {"points": [[0]]}, {"points": [[0, 1, 2]]},
    {"points": [[True, 0]]}, {"points": [["0", 0]]},
    {"points": [[float("inf"), 0]]}, {"points": [[float("nan"), 0]]},
    {"points": [[10000001, 0]]}, {"points": [[0, -10000001]]},
    {"points": [[0, 0]] * 5001}, {"opacity": .3},
])
def test_malformed_ink_is_rejected_by_both_consumers(changes):
    from app.schemas.canvas_ink import validate_strokes
    from app.services.learning_service import _workspace_values

    ink = [stroke(**changes)]
    with pytest.raises(ValueError):
        validate_strokes(ink)
    with pytest.raises(ValueError):
        request(strokes=ink)
    with pytest.raises(ValueError):
        _workspace_values({"title": "ink", "payload": {"strokes": ink}})


@pytest.mark.parametrize("value", [None, {}, "ink", [None], [stroke(), stroke()]])
def test_rejects_invalid_collections_and_duplicate_ids(value):
    from app.schemas.canvas_ink import validate_strokes

    with pytest.raises(ValueError):
        validate_strokes(value)


def test_resource_limits_and_inclusive_numeric_boundaries():
    from app.schemas.canvas_ink import validate_strokes

    many = [stroke(id=str(i), points=[[0, 0]]) for i in range(2000)]
    assert len(validate_strokes(many)) == 2000
    with pytest.raises(ValueError):
        validate_strokes(many + [stroke(id="overflow")])
    dense = [stroke(id=str(i), points=[[0, 0]] * 5000) for i in range(20)]
    assert sum(len(s["points"]) for s in validate_strokes(dense)) == 100000
    with pytest.raises(ValueError):
        validate_strokes(dense + [stroke(id="overflow", points=[[0, 0]])])
    for tool, width in [("pen", 1), ("pen", 24), ("highlighter", 4), ("highlighter", 48)]:
        ink = [stroke(tool=tool, width=width, points=[[-10000000, 10000000]])]
        assert validate_strokes(ink) == ink
