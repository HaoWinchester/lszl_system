"""updata-legacy 新业务存储必须进入服务端 runtime-state 白名单。"""

from app.services import runtime_state_service


def test_principle_and_star_practice_runtime_keys_are_registered() -> None:
    assert runtime_state_service.key_allowed("kg_principle_repository_v1")
    assert runtime_state_service.key_allowed("kg_synthesis_preset_repository_v1")
    assert runtime_state_service.key_allowed(
        "kg_practice_attempts_v1__student-1"
    )
    assert runtime_state_service.key_allowed(
        "kg_multi_question_release_selection_v1__student-1"
    )


def test_canvas_learning_context_and_resizable_keys_are_registered() -> None:
    for key in (
        "kg_canvas_view_preferences_v1",
        "kg_graph_recent_colors_v1",
        "kg_home_interaction_mode_v1",
        "kg_home_professional_flow_v1",
        "kg_learning_active_context_v1__student-1__guided",
        "kg_ui_resizable_region_v1__paper-library",
    ):
        assert runtime_state_service.key_allowed(key)


def test_principles_and_system_presets_are_shared_teaching_content() -> None:
    assert "kg_principle_repository_v1" in runtime_state_service.SHARED_KEYS
    assert "kg_synthesis_preset_repository_v1" in runtime_state_service.SHARED_KEYS
