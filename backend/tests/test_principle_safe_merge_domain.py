from app.services import teaching_content_projection_service as service


def _principle(principle_id: str, name: str) -> dict:
    return {
        "id": principle_id,
        "name": name,
        "status": "active",
        "confusablePrincipleIds": [],
    }


def _preset(preset_id: str, principle_id: str) -> dict:
    return {
        "id": preset_id,
        "principleId": principle_id,
        "title": "会被规范化",
        "content": f"{principle_id} 内容",
        "status": "active",
        "version": 1,
    }


def _kg(principles: list[dict], presets: list[dict]) -> dict:
    return {
        "format": "kg-principle-card-bundle-v1",
        "principles": {"schemaVersion": 1, "items": principles},
        "synthesisPresets": {"schemaVersion": 1, "items": presets},
    }


def test_pmp_bundle_and_kg_bundle_have_the_same_canonical_shape() -> None:
    principles = [_principle("p-1", "先分析")]
    presets = [_preset("card-1", "p-1")]
    kg = service.validate_principle_card_bundle(_kg(principles, presets))
    pmp = service.validate_principle_card_bundle(
        {
            "format": "pmp-principle-preset-bundle-v1",
            "principles": principles,
            "presets": presets,
        }
    )
    assert pmp == kg


def test_safe_merge_plan_never_silently_overwrites_conflicts() -> None:
    existing = service.validate_principle_card_bundle(
        _kg(
            [_principle("p-1", "先分析"), _principle("p-2", "先沟通")],
            [_preset("card-1", "p-1"), _preset("card-2", "p-2")],
        )
    )
    incoming = service.validate_principle_card_bundle(
        _kg(
            [
                _principle("p-1", "先行动"),
                _principle("p-3", " 先 沟通 "),
                _principle("p-4", "先复盘"),
            ],
            [
                _preset("card-1-new", "p-1"),
                _preset("card-3", "p-3"),
                _preset("card-2", "p-4"),
            ],
        )
    )

    plan = service.plan_principle_bundle_merge(incoming, existing)

    assert [item["id"] for item in plan["added"]] == ["p-4"]
    assert plan["unchanged"] == []
    assert {item["type"] for item in plan["conflicts"]} == {
        "same-id-different-name",
        "same-normalized-name-different-id",
        "preset-rebind",
    }
