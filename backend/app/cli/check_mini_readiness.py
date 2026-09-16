"""Read-only deployment gate for the mini-program's backend dependencies."""

# Service contract, not a public HTTP endpoint. Keep credential values out of output.
ROOT = '/api/v1/learning/practice'
REQUIRED_ROUTES = {
    ('POST', '/api/v1/auth/mini/wechat/login'), ('POST', '/api/v1/auth/mini/bind'),
    ('POST', '/api/v1/auth/mini/register'), ('GET', '/api/v1/auth/mini/session'),
    ('POST', '/api/v1/auth/mini/logout'), ('GET', '/api/v1/paper-releases/catalog'),
    ('GET', '/api/v1/subscriptions/me'), ('GET', '/api/v1/question-assets/{asset_id}/content'),
    *((method, ROOT + path) for method, path in [
        ('GET', '/overview'), ('GET', '/experience-summary'), ('GET', '/revenge/summary'),
        ('GET', '/growth'), ('PUT', '/growth/goal'),
        ('GET', '/sessions'), ('GET', '/sessions/active'), ('POST', '/sessions/start'), ('POST', '/sessions/enter'),
        ('GET', '/sessions/{session_id}'), ('POST', '/sessions/{session_id}/answers'),
        ('PATCH', '/sessions/{session_id}/state'), ('POST', '/sessions/{session_id}/pause'),
        ('POST', '/sessions/{session_id}/abandon'), ('POST', '/sessions/{session_id}/complete'),
        ('GET', '/sessions/{session_id}/report'), ('POST', '/mistakes/{mistake_id}/revenge-answer'),
        ('GET', '/mistakes/{mistake_id}/remediation'), ('POST', '/mistakes/{mistake_id}/remediation-reviewed'),
        ('GET', '/mistakes/{mistake_id}/verification-candidate'), ('POST', '/mistakes/{mistake_id}/verification'),
    ]),
}
REQUIRED_TABLES = {
    'users', 'wechat_mini_auth_tickets', 'wechat_mini_sessions', 'subscriptions',
    'paper_releases', 'paper_release_questions', 'question_assets', 'practice_sessions',
    'practice_mistakes', 'practice_verifications', 'practice_growth_settings',
    'practice_growth_days', 'practice_growth_answers',
}

def evaluate(routes, tables, revisions, heads, config):
    errors = [f'missing route: {method} {path}' for method, path in sorted(REQUIRED_ROUTES - set(routes))]
    errors += [f'missing table: {name}' for name in sorted(REQUIRED_TABLES - set(tables))]
    if not heads or set(revisions) != set(heads):
        errors.append('database migrations are not at the current code head')
    if not str(config.get('app_id') or '').strip() or not str(config.get('app_secret') or '').strip():
        errors.append('mini-program credentials are not configured')
    if config.get('demo') is not False:
        errors.append('mini-program demo authentication must be explicitly disabled')
    return {'ok': not errors, 'errors': errors, 'requiredRoutes': len(REQUIRED_ROUTES), 'requiredTables': len(REQUIRED_TABLES)}


async def inspect_runtime():
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    from sqlalchemy import inspect, text
    from app.main import app
    from app.core.config import settings
    from app.db.session import engine
    routes = {(method, route.path) for route in app.routes for method in getattr(route, 'methods', set())}
    async with engine.connect() as connection:
        await connection.execute(text('SET TRANSACTION READ ONLY'))
        tables = set(await connection.run_sync(lambda sync: inspect(sync).get_table_names()))
        revisions = set((await connection.execute(text('SELECT version_num FROM alembic_version'))).scalars()) if 'alembic_version' in tables else set()
    heads = set(ScriptDirectory.from_config(Config('alembic.ini')).get_heads())
    return evaluate(routes, tables, revisions, heads, {
        'app_id': getattr(settings, 'WECHAT_MINI_APP_ID', ''),
        'app_secret': getattr(settings, 'WECHAT_MINI_APP_SECRET', ''),
        'demo': getattr(settings, 'WECHAT_MINI_ENABLE_DEMO', None),
    })


if __name__ == '__main__':
    import asyncio
    import json
    try:
        result = asyncio.run(inspect_runtime())
    except Exception as error:
        # Database URLs and provider query secrets must not leak through exceptions.
        result = {'ok': False, 'errors': [f'runtime inspection failed ({type(error).__name__})']}
    print(json.dumps(result, ensure_ascii=False))
    raise SystemExit(0 if result['ok'] else 1)
