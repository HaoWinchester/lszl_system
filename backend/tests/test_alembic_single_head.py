from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory


def test_repository_has_one_upgrade_head() -> None:
    backend_dir = Path(__file__).resolve().parents[1]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("script_location", str(backend_dir / "alembic"))

    heads = ScriptDirectory.from_config(config).get_heads()

    assert len(heads) == 1, f"expected one Alembic head, found {heads}"
