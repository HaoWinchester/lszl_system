import inspect

from app.db.base import Base


def test_teaching_content_relational_tables_are_registered():
    assert {
        "content_subjects", "content_taxonomies", "taxonomy_nodes",
        "activity_collections", "activity_tags", "activity_overrides",
        "recall_association_libraries", "teaching_content_audits",
    } <= set(Base.metadata.tables)


def test_taxonomy_has_subject_fk_and_lifecycle_constraint():
    table = Base.metadata.tables["content_taxonomies"]
    assert any(f.target_fullname == "content_subjects.id" for f in table.foreign_keys)
    assert any("status IN" in str(c.sqltext) for c in table.constraints if hasattr(c, "sqltext"))


def test_activity_resources_have_nullable_server_owner_foreign_keys():
    for table_name in (
        "activity_collections",
        "activity_tags",
        "activity_overrides",
    ):
        table = Base.metadata.tables[table_name]
        assert table.columns["owner_username"].nullable is True
        assert any(
            foreign_key.target_fullname == "users.username"
            and foreign_key.ondelete == "SET NULL"
            for foreign_key in table.columns["owner_username"].foreign_keys
        )


def test_content_services_do_not_import_shared_runtime_state():
    from app.services import content_prep_shared_service, content_reference_service

    assert "SharedRuntimeState" not in inspect.getsource(content_prep_shared_service)
    assert "SharedRuntimeState" not in inspect.getsource(content_reference_service)


def test_retired_legacy_teaching_mutation_service_symbols_are_absent():
    from app.services import teaching_content_service

    source = inspect.getsource(teaching_content_service)
    for name in (
        "upsert_subject",
        "release_taxonomy",
        "delete_taxonomy",
        "apply_activity_override",
        "delete_activity_override",
    ):
        assert f"def {name}(" not in source


def test_recall_library_is_subject_scoped_and_auditable():
    table = Base.metadata.tables["recall_association_libraries"]
    assert any(f.target_fullname == "content_subjects.id" for f in table.foreign_keys)
    audit = Base.metadata.tables["teaching_content_audits"]
    assert {"entity_type", "entity_id", "action", "actor_username"} <= set(audit.columns.keys())
