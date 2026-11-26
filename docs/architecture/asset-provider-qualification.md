# Object-storage capability evidence

This page indexes scientific observations, not runtime authority or deployment approval.
The active contract is [ADR 0009](../adr/0009-media-storage-refoundation.md).
No observation establishes untested cross-provider behavior.

## Evidence

- [OSS container observations](evidence/asset-provider-oss-container.json)
- [OSS host observations](evidence/asset-provider-oss-host.json)
- [OSS isolated namespace observations](evidence/asset-provider-oss-review-02.json)
- [Reproducible experimental source](evidence/provider-probe/README.md)

The JSON files contain the experiment's recorded outcomes and observation bounds.
They contain no credentials or signed URLs. Experimental source and its doubles
harness are inert text artifacts outside application imports and pytest collection.
Doubles establish harness behavior, not real-provider capabilities.

## Verified scope

The isolated OSS experiment observes multipart creation, part replacement,
pagination, completion, and a completed handle returning NoSuchUpload while the
complete object exists. It observes small-object copy and a full read hash.
It does not qualify a cross-provider conditional PutObject overwrite barrier,
Content-Length enforcement, a maximum copy size, or permanent cessation of late IO.
The native SHA-256 qualification is UNKNOWN; an ETag or composite checksum is not
proof of full-object SHA-256.

SINGLE_PUT therefore uses a disposable staging key, server verification and copy
to a server-only immutable final key. Multipart uses final-key in-place adoption
and signs only UploadPart capability for its handle.

Production provider/version, IAM, encryption policy and browser origins require
deployment evidence. Managed OSS version is UNKNOWN. Missing incomplete multipart
lifecycle policy is an operational gap. Cleanup observations are bounded and do
not establish permanent settlement of uncertain network side effects.
