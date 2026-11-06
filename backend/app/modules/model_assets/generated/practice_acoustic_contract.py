"""Generated from contracts/practice/acoustic/runtime-contract.json and evidence-attestation.json. Do not edit."""

from types import MappingProxyType
from typing import NamedTuple


class ModelAssetContract(NamedTuple):
    schema_version: int
    asset_id: str
    asset_version: str
    byte_size: int
    sha256: str
    media_type: str
    storage_key: str


MODEL_ASSET = ModelAssetContract(
    schema_version=1,
    asset_id="practice-acoustic-robust-browser",
    asset_version="v1",
    byte_size=98689283,
    sha256="4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3",
    media_type="application/octet-stream",
    storage_key="models/continuous/robust-browser-v1/4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3/model.onnx",
)
MODEL_ASSET_DESCRIPTOR = MappingProxyType(
    {
        "schemaVersion": 1,
        "assetId": "practice-acoustic-robust-browser",
        "assetVersion": "v1",
        "expectedByteSize": 98689283,
        "sha256": "4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3",
        "mediaType": "application/octet-stream",
    }
)
ANALYSIS_IDENTITY = MappingProxyType(
    {
        "identityName": "practice-acoustic-robust-browser@v1",
        "runtimeContractSha256": "e009b656bc73df18192d012d36170dcd9b5d05f9739bfa179293315baf1bb562",
        "evidenceAttestationSha256": "a02cde8335103152dd8949abdfb6868b890e59e12b7064572fa8884941978cb2",
        "analysisIdentitySha256": "242820728f9acccfe3bf2b1402ae79ccb0e14c6894e1a52a3f1637425d198e51",
    }
)
