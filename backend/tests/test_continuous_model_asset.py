"""Docker-only, network-free delivery tests; no model or server Practice execution."""
import unittest
import alibabacloud_oss_v2 as oss
from pydantic import ValidationError
from app.modules.model_assets.schemas import PracticeAcousticAccessRead
from app.modules.model_assets.service import ModelAssetService
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.api.deps import get_current_user
from app.modules.model_assets.router import router
from app.modules.model_assets.service import get_model_asset_service


class ContinuousModelAssetTests(unittest.TestCase):
    def test_delivery_is_pinned_and_ignores_historical_object_key(self):
        config = oss.config.load_default()
        config.region = "cn-shenzhen"
        config.credentials_provider = oss.credentials.StaticCredentialsProvider("test-id", "test-secret")
        service = ModelAssetService(bucket="noteverse-model-assets", region="cn-shenzhen",
            client=oss.Client(config))
        access = service.get_practice_acoustic_access()
        self.assertEqual(access.expectedByteSize, 98_689_283)
        self.assertEqual(access.sha256, "4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3")
        self.assertEqual(access.assetId, "practice-acoustic-robust-browser")
        self.assertIn("/models/continuous/robust-browser-v1/", access.downloadUrl)
        self.assertIn(access.sha256, access.downloadUrl)
        self.assertNotIn("historical", access.downloadUrl)
        self.assertIn("x-oss-signature=", access.downloadUrl)

    def test_schema_rejects_the_old_export(self):
        with self.assertRaises(ValidationError):
            PracticeAcousticAccessRead(expectedByteSize=98_691_493,
                downloadUrl="https://example.invalid", downloadUrlExpiresAt="future")

    def test_only_shared_endpoint_is_registered(self):
        self.assertEqual([route.path for route in router.routes], ["/practice-acoustic-robust-browser-v1/access"])

    def test_authenticated_delivery_over_http_without_practice_or_database(self):
        config = oss.config.load_default()
        config.region = "cn-shenzhen"
        config.credentials_provider = oss.credentials.StaticCredentialsProvider("test-id", "test-secret")
        service = ModelAssetService(bucket="noteverse-model-assets", client=oss.Client(config))
        application = FastAPI()
        application.include_router(router, prefix="/model-assets")
        application.dependency_overrides[get_current_user] = lambda: object()
        application.dependency_overrides[get_model_asset_service] = lambda: service
        with TestClient(application) as client:
            response = client.get("/model-assets/practice-acoustic-robust-browser-v1/access")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["data"]["assetId"], "practice-acoustic-robust-browser")
            self.assertEqual(client.get("/model-assets/continuous-robust-browser-v1/access").status_code, 404)
            self.assertEqual(client.get("/model-assets/bytedance-note/access").status_code, 404)


if __name__ == "__main__":
    unittest.main()
