from app.cli.files_runtime_migration import build_parser, report_exit_code


def test_cli_supports_read_only_scan_without_requiring_report_file() -> None:
    args = build_parser().parse_args(["scan"])

    assert args.command == "scan"
    assert args.report_json is None


def test_cli_supports_migrate_verify_and_non_destructive_drop_check() -> None:
    parser = build_parser()

    assert parser.parse_args(["migrate"]).command == "migrate"
    assert parser.parse_args(["verify"]).command == "verify"
    assert parser.parse_args(["drop-check"]).command == "drop-check"


def test_report_exit_code_blocks_failed_migration_or_verification() -> None:
    assert report_exit_code("scan", {"warnings": 4}) == 0
    assert report_exit_code("migrate", {"failedOwners": 1}) == 1
    assert report_exit_code("verify", {"verified": False}) == 1
    assert report_exit_code("drop-check", {"safeToDrop": False}) == 1
    assert report_exit_code("drop-check", {"safeToDrop": True}) == 0
