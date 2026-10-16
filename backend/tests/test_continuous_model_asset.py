"""Docker-only, network-free delivery tests; no model or server Practice execution."""
import unittest
import alibabacloud_oss_v2 as oss
from pydantic import ValidationError
from app.modules.model_assets.schemas import ContinuousRobustAccessRead
from app.modules.model_assets.service import ModelAssetService


class ContinuousModelAssetTests(unittest.TestCase):
    def test_delivery_is_pinned_and_ignores_historical_object_key(self):
        config = oss.config.load_default()
        config.region = "cn-shenzhen"
        config.credentials_provider = oss.credentials.StaticCredentialsProvider("test-id", "test-secret")
        service = ModelAssetService(bucket="noteverse-model-assets", region="cn-shenzhen",
            object_key="models/historical/model.onnx", client=oss.Client(config))
        access = service.get_continuous_robust_access()
        self.assertEqual(access.expectedByteSize, 98_689_283)
        self.assertEqual(access.sha256, "4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3")
        self.assertEqual(access.assetId, "continuous-robust-browser")
        self.assertIn("/models/continuous/robust-browser-v1/", access.downloadUrl)
        self.assertIn(access.sha256, access.downloadUrl)
        self.assertNotIn("historical", access.downloadUrl)
        self.assertIn("x-oss-signature=", access.downloadUrl)

    def test_schema_rejects_the_old_export(self):
        with self.assertRaises(ValidationError):
            ContinuousRobustAccessRead(expectedByteSize=98_691_493,
                downloadUrl="https://example.invalid", downloadUrlExpiresAt="future")


if __name__ == "__main__":
    unittest.main()
