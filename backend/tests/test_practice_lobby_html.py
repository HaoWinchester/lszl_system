from app.web.html import inject_bootstrap


def test_guest_lobby_preserves_visible_loading_layout_before_javascript():
    html = '<html><head><!-- kg-direct-bootstrap-anchor --></head><body data-practice-view="lobby"><section class="practice-library">Loading</section></body></html>'
    result = inject_bootstrap(html, {"page": "practice-mode.html", "authenticated": False})
    assert 'window.__KG_DIRECT_BOOTSTRAP__=' in result
    assert 'kg-practice-guest-first-paint' not in result
    assert 'display:none!important' not in result
    assert 'data-practice-view="lobby"' in result
