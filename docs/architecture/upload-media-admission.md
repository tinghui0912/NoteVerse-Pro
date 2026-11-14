# Score-import upload media admission

`app.modules.files.upload_admission` is the backend product authority for uploaded
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
