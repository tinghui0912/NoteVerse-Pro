# Browser Security Baseline

## Ownership and rendering

| Layer | Authority |
| --- | --- |
| HTTPS Edge Gateway | TLS termination; exactly one `Strict-Transport-Security: max-age=63072000; includeSubDomains` response header on every Customer/Admin route rule; no preload |
| Next.js 16 `proxy.ts` | Document CSP, 128-bit CSPRNG Base64 nonce, Fetch response security headers, scoped Permissions-Policy and Referrer-Policy |
| FastAPI | [Browser request admission](browser-request-security.md), authentication, authorization and distributed abuse limits |

Gateway response filters preserve application CSP unchanged. Next config owns
routing/build settings without static CSP. Neither Next app emits HSTS. Proxy
sets a fresh nonce in the internal `x-nonce` and request CSP headers; Next.js
extracts the request CSP nonce for framework scripts during SSR. Incoming client
nonce/CSP headers cannot select the rendering nonce. Both root layouts call
`connection()` and render on demand. HTML responses are private, no-store;
a nonce-bearing document is never a shared static or CDN-cached HTML artifact.

Customer Proxy passes the enriched request into next-intl, which preserves it
when adding the locale and rewriting. Redirects retain security headers. API and
static-resource requests bypass locale/auth redirects. Customer static resources
receive a dedicated CSP: default/object/base/frame
authorities are none, script permits self and wasm-unsafe-eval, worker permits
self/blob, and connect permits self/blob plus S. Standalone Workers therefore
have a bounded physical-resource policy and do not acquire the strict default
document's no-WASM policy. Direct document navigation to an asset path uses the
strict document policy. Blob workers inherit the creating document's CSP. Admin has one strict CSP profile.

CSP and Permissions-Policy remain attached to a document for its lifetime.
`SecurityDocumentBoundary` prevents a new capability profile's children from
mounting during client navigation and replaces the document at its current URL.
Query and fragment are preserved. Same-profile navigation retains the SPA.
Authentication routes have their own profile so entering one establishes
no-referrer even when coming from another strict route.

## Common document headers

Both apps emit `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and
`Cross-Origin-Opener-Policy: same-origin`. Common CSP directives are:

```text
default-src 'self'; base-uri 'none'; form-action 'self';
frame-ancestors 'none'; object-src 'none'; font-src 'self'
```

Production scripts accept `'self'` and `'nonce-<request nonce>'`. Only verified
WASM routes add `'wasm-unsafe-eval'`. JavaScript `'unsafe-inline'` and
`'unsafe-eval'` are absent. Next development debugging may add `'unsafe-eval'`
only when NODE_ENV is development. No script/connect/default source accepts a
wildcard, `http:` or `https:` scheme authority.

Admin uses `style-src 'self' 'nonce-<nonce>'; style-src-attr 'none'`. Its UI uses
static CSS and local SVG QR paths, with no runtime inline style requirement.
Customer uses `style-src 'self' 'unsafe-inline'`: Radix positioning and scroll
locking, animated/resizable layout style attributes, and Verovio-generated SVG
styles require inline CSS. This permission applies only to styles. Tailwind,
fonts, framework code and all application scripts remain local/nonce governed.

## Customer route profiles

Locale prefixes `/en` and `/zh` are removed before segment-exact classification.
Unmatched routes use the strict default. `S` below is the explicit configured set
of browser-facing object storage/CDN origins, and `N` is the current nonce.

| Tier / profile | Paths | script-src additions to self + N | worker-src | connect-src | media-src |
| --- | --- | --- | --- | --- | --- |
| 1 auth | `/auth/**` | none | none | self | self |
| 1 default | `/settings/**`, `/help`, `/plans`, `/invite/**`, public/unmatched routes | none | none | self | self |
| 1 library | `/library/**` | none | none | self | self, blob, S |
| 2 upload | `/upload/**` | none | none | self, blob, S | self |
| 2 score | `/score/{id}`, `/score/{id}/edit` and score subroutes outside Practice | wasm-unsafe-eval | none | self, blob, S | self, blob, S |
| 2 review | `/imports/{id}/review/**` | wasm-unsafe-eval | none | self, blob, S | self |
| 2 media | `/my-performances/**`, except score-video | none | none | self, blob, S | self, blob, S |
| 2 score-video | `/my-performances/{id}/score-video/**` | wasm-unsafe-eval | none | self, blob, S | self, blob, S |
| 2 preview | `/preview/{token}/**` | none | none | self, blob, S | self, blob, S |
| 3 Practice | `/score/{id}/practice/**` | wasm-unsafe-eval | self, blob | self, blob, S | self, blob, S |

Every Customer profile permits `img-src 'self' data: S` because authenticated
navigation/profile components display avatars through signed redirects. Library
and all tier 2/3 profiles add blob images for decoded upload previews, editor
sources and canvas exports. Settings avatar submission uses same-origin API
Multipart, so settings require no external connect authority. Library's signed
playback uses an audio element, requiring external media but no external fetch.
Guest preview displays server render assets and signed audio; it needs no WASM.

Customer auth uses `Referrer-Policy: no-referrer`; all other Customer profiles
use `strict-origin-when-cross-origin`. Admin always uses no-referrer.

All non-Practice routes and Admin deny camera, microphone, geolocation, MIDI,
payment and USB. Practice alone permits `camera=(self), microphone=(self),
midi=(self)`; geolocation/payment/USB remain denied. Its video recording uses
`getUserMedia({video: ...})`, audio capture uses an AudioWorklet, and MIDI access
uses `requestMIDIAccess({sysex:false})`. Browser permission prompts still apply.

## Capability evidence

- `lib/score/verovio/toolkit.ts` instantiates the local Verovio WASM module for
  editor/review/score-video/Practice notation. It needs WASM compilation authority.
- `lib/score-preview/local-soundfont-audio-engine.ts` uses AudioContext and the
  local MusyngKite asset. audio-loader parses its MIDI.js payload through
  JSON.parse; it does not execute the soundfont as arbitrary JavaScript.
- `lib/practice/acoustic/model/worker-client.ts` creates the local module Worker;
  `model-inference.ts` uses onnxruntime-web/webgpu, WebGPU and verified ONNX bytes.
  Practice uses same-origin runtime assets plus the explicitly configured signed
  model origin. The policy does not grant broad external script origins.
- Practice media/score-video export uses Canvas, video, MediaRecorder and Blob
  URLs. Editor image previews and upload selection also use object URLs.
- UploadSession uses signed S3 PUT/UploadPart URLs; media delivery uses signed
  URLs. These require explicit connect/media/image origins, not script access.

## Runtime and deployment configuration

`CSP_OBJECT_STORAGE_ORIGINS` is a server-only comma-separated public origin list,
for example `https://bucket.storage.example,https://media.example`. Entries are
normalized HTTP(S) scheme/host/optional port only; wildcards, null, credentials,
paths, query, fragment, malformed and empty entries are rejected. Root trailing
slashes are normalized and duplicates removed. No credentials or signed URLs
belong in this value. It is a Customer Web ConfigMap input, never a Secret.
An empty local list permits only local media. Deployed uploads/model/media need
the complete explicit HTTPS origin list, including any CDN redirect target.

Application templates carry explicit placeholders. GitOps staging lists the
browser origin matching its checked-in storage endpoint/bucket/addressing policy.
Release rendering requires `--csp-object-storage-origins`; release workflows use
`STAGING_CSP_OBJECT_STORAGE_ORIGINS` / `PRODUCTION_CSP_OBJECT_STORAGE_ORIGINS`
public variables. Minikube rendering takes `NOTEVERSE_CSP_OBJECT_STORAGE_ORIGINS`.
The frontend Proxy reads this value at request time, so no build-time public
NEXT_PUBLIC credential or bucket-specific application logic is required.

## Verification and operations

Unit tests cover nonce uniqueness, request forwarding, locale routing, every
route profile, sensitive-feature denial, exact origins and cross-profile document
navigation. Manifest guards validate every HTTPS route rule's exact HSTS, reject
CSP emission/removal by the gateway, and validate Customer ConfigMap origins.

Build both production apps, then run the Customer Playwright security config:

```shell
npm run build
NEXT_BACKEND_ORIGIN=http://127.0.0.1:8000 npx playwright test -c playwright.security.config.ts
```

The browser suite starts both production servers, uses API doubles, listens for
securitypolicyviolation and CSP console errors, verifies SSR script nonces and
hydration, and exercises real Verovio/WASM plus Practice Worker admission.
It does not qualify physical recording hardware or cloud object-store behavior.
Before release, verify each public hostname over HTTPS returns exact HSTS and a
single app CSP; inspect auth/editor/Practice runtime violations. Never reuse or
cache nonce-bearing HTML. Keep origin allowlists synchronized with signed URL
and CDN routing. Dependency vulnerability remediation has separate ownership.
