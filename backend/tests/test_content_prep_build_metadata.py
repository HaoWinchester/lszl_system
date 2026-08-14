from fastapi.testclient import TestClient

from app.main import app


def test_content_prep_build_metadata_exposes_contract_and_policy_versions() -> None:
    with TestClient(app) as client:
        login = client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "jbgsnmm~123"},
        )
        assert login.status_code == 200, login.text
        response = client.get("/api/v1/content-prep/build-metadata")
        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["serverBuild"] == "backend-api-v1"
        assert payload["authoringContract"] == {
            "id": "pmp-authoring-contract-v1",
            "version": "1.0.0",
        }
        assert payload["registryManifest"]["version"] == "1.0.0"
        assert payload["policies"] == {
            "keywordLocation": "source-isolated-derived",
            "recallBinding": "optional-existing-id-only",
            "deepRecallReveal": "click-to-reveal-all-keywords",
            "keywordCorePriority": "overlap-match-priority-only",
        }
        assert isinstance(payload["contentRevision"], int)
