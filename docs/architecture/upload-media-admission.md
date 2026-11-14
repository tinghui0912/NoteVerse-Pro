# Score-import upload media admission

`app.modules.uploads.upload_admission` is the backend product authority for uploaded
Score-import images. Support is source-owned, not environment configuration.
The maximum is 20 MiB per file; no separate deployment file-size contract narrows
this application policy. Bounded reading requests at most the limit plus one byte.
Empty and oversized inputs fail before quota reservation or ObjectWriteIntent.

| Detected container | Filename extensions | Canonical MIME | Storage extension |
| --- | --- | --- | --- |
| PNG | `.png` | `image/png` | `.png` |
| JPEG | `.jpg`, `.jpeg` | `image/jpeg` | `.jpg` |
| BMP | `.bmp` | `image/bmp` | `.bmp` |
| GIF | `.gif` | `image/gif` | `.gif` |
| WebP | `.webp` | `image/webp` | `.webp` |
| TIFF | `.tif`, `.tiff` | `image/tiff` | `.tiff` |

Pillow verifies the container and decodes its frames. Corrupt, truncated,
non-image, unsupported and extension/container-mismatched inputs fail closed with
a stable public validation code. Decoder diagnostics are not browser responses.
Client MIME is advisory and never establishes durable physical facts.

ObjectWriteIntent and StoredObject use the detected canonical MIME. The physical
key is `blobs/{sha-prefix}/{sha}.{canonical-extension}`. Identical JPEG bytes named
`.jpg` and `.jpeg` share one canonical object through Upload-owned deduplication;
each Upload keeps its original filename. A matching SHA in a different domain is
not an authority to reuse that domain's object.

Physical prewrite precedes semantic admission. Upload, StoredObject adoption and
UPLOAD reservation commit remain atomic. Semantic rollback leaves a releasable
reservation and cleanup-owned physical write. StorageUsage policy is independent
of physical IO scheduling.

The frontend picker recommends PNG, JPEG or BMP as a narrower UX choice. Its
constants and localized copy express recommendations, not a backend allowlist.
Avatar retains its 5 MiB input policy and normalized JPEG representation;
PerformanceTake retains its independent recording-container contract.

## Upload resource contract

`app.modules.uploads` owns Upload admission, persistence and semantic deletion;
`app.db.models.upload.Upload` maps to the `uploads` table. `UploadService` and
`UploadRepository` operate on Upload identities. `POST /api/v1/uploads`
(`uploadsCreate`) returns `UploadRead { upload_id, original_filename, byte_size }`.
`DELETE /api/v1/uploads/{upload_id}` (`uploadDelete`) accepts the public Upload UUID
and returns bodyless 204. `original_filename` remains browser-supplied display metadata;
byte size comes from StoredObject, and a blob key is never a public resource identity.

The frontend `uploadsApi` owns createUpload/createUploads/deleteUpload transport through
generated operations. Browser `File`, multipart `UploadFile` and physical/download
filenames retain their meanings. The `/upload` page is a user action, independent of
the `/api/v1/uploads` resource collection. Import submission accepts ordered `upload_ids`.
