from app.cli.check_mini_readiness import REQUIRED_ROUTES, REQUIRED_TABLES, evaluate

def healthy(**overrides):
    args = dict(routes=REQUIRED_ROUTES, tables=REQUIRED_TABLES, revisions={'head-a'}, heads={'head-a'}, config={'app_id': 'wx-test', 'app_secret': 'never-print-this', 'demo': False})
    args.update(overrides)
    return evaluate(**args)

def test_missing_growth_route_is_not_a_healthy_mini_deployment():
    result = healthy(routes=REQUIRED_ROUTES - {('GET', '/api/v1/learning/practice/growth')})
    assert not result['ok']
    assert any('/growth' in error for error in result['errors'])

def test_route_method_tables_migrations_and_credentials_all_fail_closed():
    variants = [dict(routes={(m,p) for m,p in REQUIRED_ROUTES if m != 'PUT'}), dict(tables=REQUIRED_TABLES-{'practice_growth_answers'}),dict(revisions={'old'}),dict(heads=set()),dict(config={'app_id':'wx','app_secret':'','demo':False}),dict(config={'app_id':'wx','app_secret':'never-print-this','demo':True})]
    for args in variants:
        result=healthy(**args)
        assert not result['ok'], args
        assert 'never-print-this' not in str(result)

def test_complete_runtime_is_ready_without_exposing_secrets():
    result=healthy()
    assert result['ok'] and not result['errors']
    assert 'never-print-this' not in str(result)

def test_actual_application_exposes_all_client_routes():
    from app.main import app
    routes={(method,route.path) for route in app.routes for method in getattr(route,'methods',set())}
    assert REQUIRED_ROUTES <= routes
