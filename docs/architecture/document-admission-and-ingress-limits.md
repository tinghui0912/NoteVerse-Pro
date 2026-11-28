# Document Admission and Ingress Limits

## HTTP admission

Pure ASGI `RequestBodyLimit` checks Content-Length before dispatch and counts
actual bytes on every receive. Invalid, negative or repeated lengths return 400;
a declared or observed excess returns 413. Chunked bodies and understated lengths
have the same ceiling. The excess chunk never reaches JSON or multipart parsers,
no subsequent chunk is requested, and downstream body-parser errors cannot replace
413 with 400 or 500. Middleware does not preload request bodies or buffer SSE
responses. A handler must consume its body before starting a response; an overrun
after response start terminates that response rather than sending a second status.
Unread bodies are not drained into application memory.

| Surface / path | HTTP bytes |
| --- | ---: |
| Customer API default, including Activity and UploadSession creation | 2,097,152 (2 MiB) |
| `/api/v1/me/avatar` | 6,291,456 (6 MiB) |
| `/api/v1/scores/{id}/revisions` | 33,554,432 (32 MiB) |
| `/api/v1/scores/{id}/fingering` | 33,554,432 (32 MiB) |
| `/api/v1/import-jobs/{id}/review` and `/review/confirm` | 33,554,432 (32 MiB) |
| `/api/v1/playback/performance-plan` | 33,554,432 (32 MiB) |
| Control Plane default | 524,288 (512 KiB) |

XML has a separate 5 MiB UTF-8 budget. A JSON string can encode one document byte
as six ASCII bytes (`\u0009`, for example); 32 MiB admits the complete worst-case
JSON envelope plus bounded command metadata. Schema character limits do not
replace UTF-8 byte checks. Avatar independently limits image bytes to 5 MiB;
its HTTP allowance includes multipart headers and boundaries. Fingering also
applies its configured execution byte budget. Large media travels directly to
object storage, outside API request bodies.

Platform bootstrap installs the pinned Envoy extension CRDs, including
BackendTrafficPolicy, separately from the Gateway API CRDs.
Gateway API HTTPRoutes have Envoy Gateway `BackendTrafficPolicy.requestBuffer`
limits of 32Mi for Customer and 512Ki for Admin. Envoy rejects larger requests
with 413; ASGI applies the tighter endpoint-specific limits. This is finite full
request buffering at the gateway, not a claim of streaming rejection by Envoy.
SSE uses bodyless GET requests; response streaming remains unbuffered. These
policies are incompatible with request-streaming/upgraded protocols and must be
reviewed if such a protocol is introduced. See the pinned release family's
[Envoy Gateway request buffering contract](https://gateway.envoyproxy.io/v1.8/tasks/traffic/request-buffering/).
Manifest tests enforce exact limits; live controller acceptance and public-edge
behavior require deployment verification.

## XML resource boundary

`app.platform.document_admission.musicxml` owns XML parsing capabilities. Expat
consumes 64 KiB chunks using strict incremental UTF-8 decoding and namespace-aware
start/end/text callbacks. It counts resources without constructing elements.
Only a completely validated byte sequence reaches ElementTree construction.
Native renderers receive admitted bytes rather than reopening input filenames.

`MusicXmlAdmissionLimits` is immutable:

| Resource | Ceiling |
| --- | ---: |
| Raw UTF-8 bytes | 5,242,880 |
| Elements | 250,000 |
| Depth, including root | 32 |
| Attributes per element, including namespace declarations | 32 |
| Attribute/namespace URI value characters | 4,096 |
| Direct text characters per element, including child tails | 65,536 |
| Total text characters | 5,242,880 |
| Processing instructions | 0 |

NUL and invalid UTF-8 are rejected. Encoding declarations accept only UTF-8
or UTF8, case-insensitively. The only admitted DOCTYPE is an external-only
MusicXML 3.1 public header for `score-partwise` or `score-timewise`, with exact
public ID `-//Recordare//DTD MusicXML 3.1 Partwise//EN` (or `Timewise`) and exact
system ID `http://www.musicxml.org/dtds/partwise.dtd` (or `timewise.dtd`). The
document root must match. All other DOCTYPE headers, every internal subset,
entity declaration, notation and external entity reference are rejected. Parameter entity parsing is disabled. No file, URL,
DTD or schema is resolved. XML declarations and predefined XML character escapes
remain supported. Comments remain bounded by raw bytes. The repository MusicXML
backend fixtures contain no DOCTYPE; the largest fixture is 2,479 bytes.
The derived-asset K8s smoke document uses the admitted MusicXML 3.1 Partwise
public header. Fixture coverage
establishes compatibility with those scores, not a product claim about arbitrary
orchestral exports. Byte/element/depth ceilings bound parser work without flaky
wall-clock timeouts or repeated parsing retries.

The primitive owns XML safety; `processing.musicxml.admission` owns score-partwise
admission, tempo materialization and written score semantics. No full external
MusicXML schema validator is implied. SVG header post-processing uses the same
structural/entity guard with a separate 16 MiB raw-byte ceiling and SVG root check.
ET APIs outside admission only construct, inspect or serialize admitted trees.

## Read symmetry and failures

`read_admitted_bytes` uses provider iteration in 64 KiB chunks, rejects oversized
metadata before reading and counts actual bytes even if metadata understates size.
XML reads use the default 5 MiB ceiling regardless of physical MIME metadata.
Non-XML bundle JSON and render archive entries explicitly use their admitted byte
size as the read ceiling; write-receipt read-back uses the known representation
length. These bounds preserve each resource domain's size contract while stopping
physical overrun. XML structure is validated by the document admission owner before parsing; physical byte reads
do not replace domain checksum checks or domain failure classification. Iterator closure
releases provider resources after success or failure. MusicXML streaming delivery
and local materialization count actual bytes; native/parser file admission also
checks file size and actual bytes. OMR page merging bounds aggregate bytes and
elements before appending copied measures. Domain media delivery keeps streaming
or signed URL semantics rather than loading large media through this helper.

`DocumentAdmissionError` contains an `AdmissionReason`. SIZE_EXCEEDED maps to
HTTP 413 / `payload_too_large`; structural/security failures map to 422 / the
surface validation code (score admission uses `revision_content_invalid`).
XML request-field `string_too_long` validation at the 5 MiB character ceiling
also maps to 413, so ASCII documents cannot acquire a different size status from
multibyte documents. Other schema validation failures remain 422.
Malformed request lengths map to 400 / `validation_error`. Logs carry the reason
and request correlation without document content. Worker failures follow their
domain job failure handling and do not adopt rejected XML.

AST tests confine parser imports/calls to the vetted module, permit an explicit
ElementTree construction/serialization vocabulary elsewhere, and prohibit native
renderer filename parsing. Platform admission imports neither business nor runtime
modules. Adversarial tests cover DTD/XXE/entity bombs, depth, element/attribute/text
budgets, exact byte boundaries, invalid encodings, chunked/understated HTTP bodies,
and provider streams that exceed declared object size.
