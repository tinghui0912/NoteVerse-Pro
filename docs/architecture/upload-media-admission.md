# Score-import upload admission

The Upload domain owns image validation, original filename, command identity and
semantic lifetime. Media storage owns transfer, verified copy, adoption and cleanup.
Storage governance owns UPLOAD capacity Holds and logical allocations.

`POST /api/v1/uploads` (`uploadRequestsCreate`) accepts JSON `client_request_id`,
`filename`, `byte_size` and `content_type`. It returns UploadAdmissionRead with the
server-created UploadSession and optional completed Upload. The maximum image size
is 20 MiB. Admission validates filename/type and reserves exact capacity before any
provider transfer. Repeated command facts return the same session; different facts
for the same user/command fail closed.

The browser PUTs to its precisely signed staging capability. Session completion
checks metadata, reads at most the admitted size and computes a full SHA-256.
`POST /uploads/{session_id}/finalize` validates image container, filename extension
and every Pillow frame, then uses ObjectWriteCoordinator for a verified copy to the
immutable final key. Adoption, Upload, Hold consumption, UPLOAD allocation and command
completion share a single business transaction. Unknown commit recovery reads fresh
persistent command lineage. Known rollback preserves the Hold/session for safe retry.

| Container | Allowed filename extensions | Canonical MIME |
| --- | --- | --- |
| PNG | .png | image/png |
| JPEG | .jpg, .jpeg | image/jpeg |
| BMP | .bmp | image/bmp |
| GIF | .gif | image/gif |
| WebP | .webp | image/webp |
| TIFF | .tif, .tiff | image/tiff |

Corrupt, truncated, unsupported, decompression-bomb and mismatched inputs fail closed.
Paths and control characters are not accepted as filenames. Decoder diagnostics and
internal physical locators do not become customer error details. Identical file bytes
in different Upload commands remain independent logical resources and physical keys;
matching content hashes grant no cross-domain reuse authority.

`POST /uploads/{session_id}/cancel` cancels an incomplete request and releases its
unconsumed Hold. Session GC owns staging deletion after capability expiry. Formal
UploadRead exposes only upload_id, original_filename and byte_size. Import submission
uses ordered upload_ids. `DELETE /uploads/{upload_id}` releases the semantic allocation
and registers retirement after all actual references permit deletion. A completed
command cannot recreate a deleted Upload through replay.

Avatar uses its independent bounded 5 MiB API and normalized JPEG. Performance Take
uses its own Manifest, capture admission and Finalization Lease while sharing the
UploadSession transport contract. See [media storage](object-storage.md).
