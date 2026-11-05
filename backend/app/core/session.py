"""Keep late read-only responses from restoring a logged-out session cookie."""
from copy import deepcopy

from starlette.middleware.sessions import SessionMiddleware as StarletteSessionMiddleware


class SessionMiddleware(StarletteSessionMiddleware):
    def __init__(self, app, **kwargs):
        async def track_session(scope, receive, send):
            if scope['type'] not in ('http', 'websocket'):
                await app(scope, receive, send)
                return
            scope['_kg_initial_session'] = deepcopy(scope['session'])

            async def track_headers(message):
                if message['type'] == 'http.response.start':
                    initial, session = scope['_kg_initial_session'], scope['session']
                    if (initial.get('username') and session != initial
                            and session.get('username') == initial.get('username')
                            and not session.get('login_session_id')):
                        # Preserve the legacy identity across *any* cookie write,
                        # including OAuth state changes before the first /me read.
                        from starlette.requests import Request
                        from app.services.browser_session_service import identity
                        legacy_id = identity(Request(scope))
                        if legacy_id:
                            session['login_session_id'] = legacy_id
                    scope['_kg_application_header_count'] = len(message.get('headers', []))
                await send(message)

            await app(scope, receive, track_headers)

        super().__init__(track_session, **kwargs)

    async def __call__(self, scope, receive, send):
        async def send_changed_session(message):
            initial = scope.get('_kg_initial_session')
            if (message['type'] == 'http.response.start'
                    and ((initial and scope.get('session') == initial
                          and not scope.get('_kg_refresh_session'))
                         or (scope.get('_kg_rejected_session') and not scope.get('session')))):
                # Keep route cookies (including explicit deletion); suppress only
                # the refresh appended by Starlette after the application headers.
                count = scope['_kg_application_header_count']
                message['headers'] = message['headers'][:count]
            await send(message)

        # Starlette still owns signing, expiry validation and cookie attributes.
        # Read-only requests do not extend expiry; authenticated refresh is explicit.
        await super().__call__(scope, receive, send_changed_session)
