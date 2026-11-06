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
        "runtimeContractSha256": "d469a156a0acbe34ab3e3285d4d6857824f0d71992deae4f3e2b1a03e839304f",
        "evidenceAttestationSha256": "5ac985faec8fce506a37d393959e5f04fb3464896a2c7edeb82517eb113c9b6b",
        "analysisIdentitySha256": "87f9ec2a352b8aa2eaa94326b66f5196946525dd11a48d1fe839b769a682c5b9",
    }
)
