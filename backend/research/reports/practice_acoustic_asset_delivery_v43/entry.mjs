import * as ort from "/__v43/ort/ort.webgpu.min.mjs";
//#region apps/customer-web/src/lib/auth/return-url.ts
var DEFAULT_LOGIN_PATH = "/auth/login";
var LOCALE_PATTERN = /^\/(zh|en)(\/|$)/;
function getSafeReturnUrl(value, fallback = "/upload") {
	if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
	return value;
}
function getLoginPath(pathname) {
	const localeMatch = pathname.match(LOCALE_PATTERN);
	return localeMatch ? `/${localeMatch[1]}${DEFAULT_LOGIN_PATH}` : DEFAULT_LOGIN_PATH;
}
function withReturnUrl(path, returnUrl) {
	const safeReturnUrl = getSafeReturnUrl(returnUrl, "");
	if (!safeReturnUrl) return path;
	return `${path}?${new URLSearchParams({ returnUrl: safeReturnUrl }).toString()}`;
}
function getLoginHrefForReturnUrl(returnUrl) {
	return withReturnUrl(getLoginPath(returnUrl), returnUrl);
}
function getCurrentPathWithSearch() {
	if (typeof window === "undefined") return "/";
	const { pathname, search } = window.location;
	return `${pathname}${search}`;
}
function getCurrentLoginHref() {
	return getLoginHrefForReturnUrl(getCurrentPathWithSearch());
}
//#endregion
//#region apps/customer-web/src/lib/app-protocol.ts
var API_BASE_URL = "/api/v1";
`${API_BASE_URL}`;
var CSRF_COOKIE_NAME = "noteverse_csrf";
var CSRF_HEADER_NAME = "x-csrf-token";
//#endregion
//#region apps/customer-web/src/lib/api-client.ts
var ApiError = class extends Error {
	constructor(status, code, message, requestId) {
		super(message);
		this.status = status;
		this.code = code;
		this.requestId = requestId;
		this.name = "ApiError";
	}
};
function buildHeaders(customHeaders) {
	const headers = new Headers(customHeaders);
	if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
	return headers;
}
function getCookie(name) {
	if (typeof document === "undefined") return void 0;
	return document.cookie.split("; ").map((cookie) => cookie.split("=")).find(([key]) => key === name)?.[1];
}
function addCsrfHeader(headers, options) {
	const csrfToken = getCookie(CSRF_COOKIE_NAME);
	if (csrfToken && (options?.overwrite || !headers.has("x-csrf-token"))) headers.set(CSRF_HEADER_NAME, decodeURIComponent(csrfToken));
	return headers;
}
function isUnsafeMethod(method) {
	return ![
		"GET",
		"HEAD",
		"OPTIONS",
		"TRACE"
	].includes((method ?? "GET").toUpperCase());
}
function shouldSkipRefresh(url) {
	return url.endsWith("/auth/refresh") || url.endsWith("/auth/login") || url.endsWith("/auth/register") || url.includes("/auth/email/") || url.includes("/auth/password/");
}
function safeRequestPath(url) {
	try {
		return new URL(url, window.location.origin).pathname;
	} catch {
		return url.split("?")[0] ?? url;
	}
}
function redirectToLoginIfNeeded(options) {
	if (options?.suppressAuthRedirect || typeof window === "undefined") return;
	const { pathname } = window.location;
	if (pathname.endsWith("/auth/login")) return;
	window.location.href = getCurrentLoginHref();
}
async function readJsonSafely(response) {
	try {
		return await response.json();
	} catch {
		return {};
	}
}
function fallbackErrorCode(status) {
	return status >= 500 ? "internal_error" : "unknown_error";
}
function createApiError(response, data, fallbackCode = fallbackErrorCode(response.status), fallbackMessage = fallbackCode) {
	const publicCode = typeof data.public_code === "string" ? data.public_code : fallbackCode;
	const publicMessage = typeof data.public_message === "string" ? data.public_message : fallbackMessage;
	return new ApiError(response.status, publicCode, publicMessage, typeof data.request_id === "string" ? data.request_id : response.headers.get("X-Request-ID") ?? void 0);
}
async function handleResponse(response, options) {
	const contentType = response.headers.get("content-type");
	if (response.status === 401) redirectToLoginIfNeeded(options);
	if (contentType && !contentType.includes("application/json")) {
		if (!response.ok) {
			const code = fallbackErrorCode(response.status);
			throw new ApiError(response.status, code, code, response.headers.get("X-Request-ID") ?? void 0);
		}
		return response;
	}
	const data = await readJsonSafely(response);
	if (!response.ok) throw createApiError(response, data);
	return data;
}
var refreshPromise = null;
async function refreshSession() {
	if (!refreshPromise) {
		const headers = addCsrfHeader(buildHeaders());
		refreshPromise = fetch(`${API_BASE_URL}/auth/refresh`, {
			method: "POST",
			headers,
			credentials: "include"
		}).then((response) => response.ok).catch(() => false).finally(() => {
			refreshPromise = null;
		});
	}
	return refreshPromise;
}
async function fetchWithAuthRetry(url, init) {
	if (isUnsafeMethod(init.method) && !getCookie("noteverse_csrf") && !shouldSkipRefresh(url)) {
		await refreshSession();
		if (init.headers instanceof Headers) addCsrfHeader(init.headers, { overwrite: true });
	}
	let response;
	try {
		response = await fetch(url, init);
	} catch (error) {
		init.method, safeRequestPath(url);
		throw error;
	}
	if (response.status !== 401 || shouldSkipRefresh(url)) return response;
	if (!await refreshSession()) return response;
	if (init.headers instanceof Headers) addCsrfHeader(init.headers, { overwrite: true });
	return fetch(url, init);
}
function toQueryString(params) {
	if (!params) return "";
	const queryString = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== void 0).map(([key, value]) => [key, String(value)])).toString();
	return queryString ? `?${queryString}` : "";
}
async function get(url, params, options) {
	return handleResponse(await fetchWithAuthRetry(`${API_BASE_URL}${url}${toQueryString(params)}`, {
		method: "GET",
		headers: addCsrfHeader(buildHeaders()),
		credentials: "include",
		signal: options?.signal
	}), options);
}
async function post(url, data, options) {
	return handleResponse(await fetchWithAuthRetry(`${API_BASE_URL}${url}`, {
		method: "POST",
		headers: addCsrfHeader(buildHeaders(options?.headers)),
		body: data ? JSON.stringify(data) : void 0,
		credentials: "include"
	}), options);
}
async function put(url, data) {
	return handleResponse(await fetchWithAuthRetry(`${API_BASE_URL}${url}`, {
		method: "PUT",
		headers: addCsrfHeader(buildHeaders()),
		body: data ? JSON.stringify(data) : void 0,
		credentials: "include"
	}));
}
async function patch(url, data) {
	return handleResponse(await fetchWithAuthRetry(`${API_BASE_URL}${url}`, {
		method: "PATCH",
		headers: addCsrfHeader(buildHeaders()),
		body: data ? JSON.stringify(data) : void 0,
		credentials: "include"
	}));
}
async function del(url) {
	return handleResponse(await fetchWithAuthRetry(`${API_BASE_URL}${url}`, {
		method: "DELETE",
		headers: addCsrfHeader(buildHeaders()),
		credentials: "include"
	}));
}
async function upload(url, file, fieldName = "file") {
	const formData = new FormData();
	formData.append(fieldName, file);
	return handleResponse(await fetchWithAuthRetry(`${API_BASE_URL}${url}`, {
		method: "POST",
		headers: addCsrfHeader(new Headers()),
		body: formData,
		credentials: "include"
	}));
}
async function putBlobToUrl(url, blob, headers) {
	const uploadUrl = url.startsWith("http://") || url.startsWith("https://") ? url : `${API_BASE_URL}${url}`;
	const requestHeaders = new Headers(headers);
	if (!url.startsWith("http://") && !url.startsWith("https://")) addCsrfHeader(requestHeaders);
	let response;
	try {
		response = await fetchWithAuthRetry(uploadUrl, {
			method: "PUT",
			headers: requestHeaders,
			body: blob,
			credentials: url.startsWith("http://") || url.startsWith("https://") ? "omit" : "include"
		});
	} catch (error) {
		throw new ApiError(0, "direct_upload_failed", error instanceof Error ? error.message : "direct_upload_failed");
	}
	if (!response.ok) {
		const data = response.headers.get("content-type")?.includes("application/json") ? await readJsonSafely(response) : {};
		throw createApiError(response, data, "direct_upload_failed", "direct_upload_failed");
	}
}
async function download(url, options) {
	const response = await fetchWithAuthRetry(`${API_BASE_URL}${url}`, {
		method: "GET",
		headers: addCsrfHeader(new Headers()),
		credentials: "include",
		signal: options?.signal
	});
	if (response.status === 401) redirectToLoginIfNeeded();
	if (!response.ok) throw createApiError(response, response.headers.get("content-type")?.includes("application/json") ? await readJsonSafely(response) : {}, "file_read_failed", "file_read_failed");
	return response.blob();
}
async function postForm(url, data) {
	const headers = new Headers();
	headers.set("Content-Type", "application/x-www-form-urlencoded");
	return handleResponse(await fetchWithAuthRetry(`${API_BASE_URL}${url}`, {
		method: "POST",
		headers: addCsrfHeader(headers),
		body: new URLSearchParams(data),
		credentials: "include"
	}));
}
async function postDownload(url, data) {
	const response = await fetchWithAuthRetry(`${API_BASE_URL}${url}`, {
		method: "POST",
		headers: addCsrfHeader(buildHeaders()),
		body: data ? JSON.stringify(data) : void 0,
		credentials: "include"
	});
	if (response.status === 401) redirectToLoginIfNeeded();
	if (!response.ok) throw createApiError(response, response.headers.get("content-type")?.includes("application/json") ? await readJsonSafely(response) : {}, fallbackErrorCode(response.status));
	return response;
}
async function getRaw(url, params, options) {
	const response = await fetchWithAuthRetry(`${API_BASE_URL}${url}${toQueryString(params)}`, {
		method: "GET",
		headers: addCsrfHeader(buildHeaders()),
		credentials: "include",
		signal: options?.signal
	});
	if (response.status === 401) redirectToLoginIfNeeded(options);
	if (!response.ok) throw createApiError(response, response.headers.get("content-type")?.includes("application/json") ? await readJsonSafely(response) : {}, fallbackErrorCode(response.status));
	return response;
}
var apiClient = {
	get,
	getRaw,
	post,
	postDownload,
	put,
	patch,
	delete: del,
	upload,
	putBlobToUrl,
	download,
	postForm
};
var acoustic_core_identity_default = {
	acousticPublication: {
		"executorSource": {
			"bytes": 3277,
			"path": "backend/research/browser_runtime/xc2_r1_browser_acoustic.mjs",
			"sha256": "eae417d8011e7df1f8b30bf4588cfbaedc695a5f66ea2bf1a2043c4b1a419f83"
		},
		"publicationReferenceSource": {
			"bytes": 12936,
			"path": "backend/research/browser_runtime/xc2_r1_runtime.mjs",
			"sha256": "72e45a94a245d34a40afba53fd18b0c685efa16f5981c46766a61d0c1aa26ab1"
		},
		"scope": "Acoustic semantics only; reference runtime downstream finalizer is explicitly excluded from default. No production wiring.",
		"semantics": "One session per execution, sequential windows, all-pitch decoder A, half-open ownership, stable observation ID, immutable performanceTimeMs and confidence; availabilityTimeMs uses actual acoustic publication on performance-origin clock; analyzed-through frontier is preceding float64 of ownedEnd. No score, labels, final verdicts or expected pitch in acoustic execution."
	},
	decoder: {
		"authoritativeSource": {
			"bytes": 5006,
			"path": "apps/customer-web/src/lib/practice/acoustic-inference/bytedance-decoder.ts",
			"sha256": "07d5cb1d709c99ab85f8b701fd0bdf1744b4135b4d7dbd21deb679029e541311"
		},
		"default": "A",
		"frameThreshold": .05,
		"function": "decodeByteDanceRawOutputs",
		"onsetThreshold": .3,
		"outputFrameRateHz": 100,
		"researchParitySource": {
			"bytes": 5477,
			"path": "backend/research/browser_runtime/xc1_robust_decoder.mjs",
			"sha256": "33a032a7508c488cf7eb1db9b60b3f6a921756eab798c5d84875d634b5925125"
		},
		"semantics": "Contiguous >=onset threshold region; first maximum peak; reject peak if frame support <threshold; confidence=min(onset,frame); piano MIDI21..108; sort by time,pitch,stable ID.",
		"timeMapping": "inputWindowStartMs + round(peakFrame/100*16000)/16000*1000"
	},
	identityName: "robust-browser-engineering-default-xc4-v1",
	input: {
		"dtype": "float32",
		"modelInputMs": 1820,
		"modelInputSamples": 29120,
		"sampleRateHz": 16e3,
		"shape": [1, 29120]
	},
	model: {
		"candidateId": "bytedance-robust-augmented-calibrated-v1",
		"checkpointBytes": 103815845,
		"checkpointSha256": "b20f72053abc15b78f689b2a8b04c0a06529c8466e898b915803a1daa2011b9e",
		"onnxBytes": 98689283,
		"onnxSha256": "4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3",
		"sourceConfigurationSha256": "10ca01435f68b0672d01e2328762ea0773efb15b318dcd1c21105e05f9ee51ce"
	},
	ownership: {
		"fullWindowPastMs": 1050,
		"futureContextMs": 170,
		"input": "inputEnd=ownedEnd+170ms; inputStart=inputEnd-1820ms; exactly29120 real samples; final partial ownership shifts full input without padding.",
		"ownedMs": 600,
		"plannerFunction": "planXc2Windows; selected parameters ownedMs=600,futureMs=170; historical common clip guard remains historical, not a new live startup specification.",
		"plannerSource": {
			"bytes": 4785,
			"path": "backend/research/browser_runtime/xc2_decoders.mjs",
			"sha256": "4a81ac847b62485ff1ed13e865736b418c798515abd886b0fdef7dfdd992efbf"
		},
		"rule": "[ownedStartMs,ownedEndMs)"
	},
	resampler: {
		"algorithm": "Frozen SciPy 1.14.1 firwin(8821,1/441,kaiser beta=5); float32 coefficients multiplied by160; float32 products/accumulation.",
		"boundary": "Preserve state across chunks. Zero only at stream origin or explicit finish; padded finish cannot qualify real-context owned observations.",
		"coefficients": {
			"bytes": 35284,
			"path": "backend/data/work/xc2_r1_bounded_runtime/audio_only/fir_160_441.f32",
			"sha256": "d54df355dba1e60395e165f0a44a3d016e25632af639be767c861e1bfd61e620"
		},
		"conservativeReadyLookaheadMs": .6349206349206349,
		"conservativeReadyLookaheadSamples": 28,
		"default": "BAND_LIMITED",
		"down": 441,
		"lookaheadSourceSamples": 27.5625,
		"source": {
			"bytes": 2289,
			"path": "backend/research/browser_runtime/xc2_r1_streaming_resampler.mjs",
			"sha256": "5f57a366bd3c264bee427caa33f892c1ea69d5954c5074a9c37f5167d3f07583"
		},
		"sourceRateHz": 44100,
		"tapCount": 8821,
		"targetRateHz": 16e3,
		"timeMapping": "Output m represents source m*441/160; wait for real source floor((m*441+4410)/160). No fitted shift or gain normalization.",
		"up": 160
	},
	runtime: {
		"automaticFallback": false,
		"browserLibrary": {
			"bytes": 333594,
			"path": "backend/research/browser_runtime/xc1_ort120_runtime/node_modules/onnxruntime-web/dist/ort.webgpu.min.js",
			"sha256": "8443389bf14b34582ea40c590b5007bb652d6ac07dd76829a5bd82d2372e6895"
		},
		"graphOptimizationLevel": "disabled",
		"ortWebVersion": "1.20.1",
		"packageLock": {
			"bytes": 6697,
			"path": "backend/research/browser_runtime/xc1_ort120_runtime/package-lock.json",
			"sha256": "7268737984b6c01ca800a3512a69c7656215fc7f19dede78b43f40752bc4f449"
		},
		"provider": "webgpu"
	}
};
//#endregion
//#region apps/customer-web/src/lib/practice/acoustic/model/model-contract.ts
var ACOUSTIC_MODEL = Object.freeze({
	identityName: "robust-browser-engineering-default-xc4-v1",
	identitySha256: "93a9914278e3aa3d659ca73aec8ac10dde5bb51d2101a87abfadcbc75ed01443",
	modelSha256: "4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3",
	modelBytes: 98689283,
	ortVersion: "1.20.1",
	provider: "webgpu",
	automaticFallback: false,
	inputSamples: 29120,
	sampleRateHz: 16e3,
	inputMs: 1820,
	onsetThreshold: .3,
	frameThreshold: .05,
	ownedMs: 600,
	futureMs: 170,
	pastMs: 1050
});
function canonicalJson(value) {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}
async function sha256(bytes) {
	const buffer = new Uint8Array(bytes).buffer;
	return [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))].map((v) => v.toString(16).padStart(2, "0")).join("");
}
async function assertAcousticIdentity() {
	if (await sha256(new TextEncoder().encode(canonicalJson(acoustic_core_identity_default))) !== ACOUSTIC_MODEL.identitySha256 || acoustic_core_identity_default.model.onnxSha256 !== ACOUSTIC_MODEL.modelSha256 || acoustic_core_identity_default.model.onnxBytes !== ACOUSTIC_MODEL.modelBytes || acoustic_core_identity_default.input.modelInputSamples !== ACOUSTIC_MODEL.inputSamples || acoustic_core_identity_default.input.sampleRateHz !== ACOUSTIC_MODEL.sampleRateHz || acoustic_core_identity_default.input.modelInputMs !== ACOUSTIC_MODEL.inputMs || acoustic_core_identity_default.runtime.ortWebVersion !== ACOUSTIC_MODEL.ortVersion || acoustic_core_identity_default.runtime.provider !== ACOUSTIC_MODEL.provider || acoustic_core_identity_default.runtime.automaticFallback !== ACOUSTIC_MODEL.automaticFallback || acoustic_core_identity_default.decoder.default !== "A" || acoustic_core_identity_default.decoder.onsetThreshold !== ACOUSTIC_MODEL.onsetThreshold || acoustic_core_identity_default.decoder.frameThreshold !== ACOUSTIC_MODEL.frameThreshold || acoustic_core_identity_default.ownership.ownedMs !== ACOUSTIC_MODEL.ownedMs || acoustic_core_identity_default.ownership.futureContextMs !== ACOUSTIC_MODEL.futureMs || acoustic_core_identity_default.ownership.fullWindowPastMs !== ACOUSTIC_MODEL.pastMs) fail("ACOUSTIC_IDENTITY_DRIFT");
}
var AcousticAnalysisError = class extends Error {
	constructor(code, options) {
		super(code, options);
		this.code = code;
		this.name = "AcousticAnalysisError";
	}
};
function fail(code) {
	throw new AcousticAnalysisError(code);
}
function onlyFields(value, allowed) {
	if (!value || Object.keys(value).some((k) => !allowed.includes(k))) fail("ACOUSTIC_FIELD_VIOLATION");
}
//#endregion
//#region apps/customer-web/src/lib/api/practice-acoustic-model-asset.ts
function assertPracticeAcousticModelAccess(value) {
	if (!value || typeof value !== "object") throw new Error("INVALID_PRACTICE_ACOUSTIC_MODEL_ACCESS");
	const data = value;
	if (data.schemaVersion !== 1 || data.assetId !== "practice-acoustic-robust-browser" || data.assetVersion !== "v1" || data.expectedByteSize !== ACOUSTIC_MODEL.modelBytes || data.sha256 !== ACOUSTIC_MODEL.modelSha256 || data.mediaType !== "application/octet-stream" || typeof data.downloadUrl !== "string" || !data.downloadUrl.startsWith("https://") || !data.downloadUrlExpiresAt || !(Date.parse(data.downloadUrlExpiresAt) > Date.now())) throw new Error("PRACTICE_ACOUSTIC_MODEL_ACCESS_IDENTITY_MISMATCH");
}
async function getPracticeAcousticModelAccess(signal) {
	const response = await apiClient.get("/model-assets/practice-acoustic-robust-browser-v1/access", void 0, {
		signal,
		suppressAuthRedirect: true
	});
	assertPracticeAcousticModelAccess(response.data);
	return Object.freeze({ ...response.data });
}
//#endregion
//#region apps/customer-web/src/lib/model-assets/types.ts
var ASSET_ID_REGEX = /^[a-z0-9][a-z0-9._-]{0,127}$/;
var ModelAssetStorageUnavailableError = class extends Error {
	constructor(message = "OPFS storage is unavailable in this browser environment.") {
		super(message);
		this.name = "ModelAssetStorageUnavailableError";
	}
};
var ModelAssetDownloadError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "ModelAssetDownloadError";
	}
};
var ModelAssetIntegrityError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "ModelAssetIntegrityError";
	}
};
var ModelAssetStorageError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "ModelAssetStorageError";
	}
};
function sanitizeUrlForError(rawUrl) {
	try {
		const parsed = new URL(rawUrl, "http://127.0.0.1");
		return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
	} catch {
		return "redacted-url";
	}
}
//#endregion
//#region apps/customer-web/src/lib/model-assets/model-asset-store.ts
var MODEL_ASSET_STORAGE_ROOT = "noteverse-model-assets";
var MODEL_ASSET_SCHEMA_VERSION_DIR = "v1";
var ModelAssetStore = class {
	constructor(options = {}) {
		this.options = options;
		this.inFlight = /* @__PURE__ */ new Map();
	}
	async ensureAsset(descriptor, onProgress) {
		validateModelAssetDescriptor(descriptor);
		const key = `${descriptor.assetId.toLowerCase()}:${descriptor.sha256.toLowerCase()}`;
		const existing = this.inFlight.get(key);
		if (existing) return existing;
		const loadPromise = this.loadAssetInternal(descriptor, onProgress);
		this.inFlight.set(key, loadPromise);
		try {
			return await loadPromise;
		} finally {
			this.inFlight.delete(key);
		}
	}
	async loadAssetInternal(descriptor, onProgress) {
		const root = await this.getRootDirectory();
		const persistentStorageGranted = await this.requestPersistence();
		const loadStartedAt = this.now();
		let baseDir;
		let v1Dir;
		let assetDir;
		let entryDir;
		try {
			baseDir = await root.getDirectoryHandle(MODEL_ASSET_STORAGE_ROOT, { create: true });
			v1Dir = await baseDir.getDirectoryHandle(MODEL_ASSET_SCHEMA_VERSION_DIR, { create: true });
			assetDir = await v1Dir.getDirectoryHandle(descriptor.assetId, { create: true });
			entryDir = await assetDir.getDirectoryHandle(descriptor.sha256.toLowerCase(), { create: true });
		} catch (error) {
			throw new ModelAssetStorageError(`Failed to initialize OPFS directory structure: ${error instanceof Error ? error.message : String(error)}`);
		}
		const cacheResult = await this.tryReadCachedAsset(assetDir, entryDir, descriptor, loadStartedAt, persistentStorageGranted);
		if (cacheResult) return cacheResult;
		await entryDir.removeEntry("verified.json").catch(() => void 0);
		await entryDir.removeEntry("model.bin").catch(() => void 0);
		const fetchImpl = this.options.fetch ?? globalThis.fetch;
		let response;
		try {
			response = await fetchImpl(descriptor.url);
		} catch (error) {
			throw new ModelAssetDownloadError(`Network fetch failed for ${sanitizeUrlForError(descriptor.url)}: ${error instanceof Error ? error.message : String(error)}`);
		}
		if (!response.ok) throw new ModelAssetDownloadError(`Download failed with HTTP ${response.status} for ${sanitizeUrlForError(descriptor.url)}.`);
		if (!response.body) throw new ModelAssetDownloadError(`Download response body is empty for ${sanitizeUrlForError(descriptor.url)}.`);
		const downloadStartedAt = this.now();
		let binHandle;
		try {
			binHandle = await entryDir.getFileHandle("model.bin", { create: true });
		} catch (error) {
			throw new ModelAssetStorageError(`Failed to create model.bin: ${error instanceof Error ? error.message : String(error)}`);
		}
		let writable;
		try {
			writable = await binHandle.createWritable();
		} catch (error) {
			throw new ModelAssetStorageError(`Failed to open writable stream for model.bin: ${error instanceof Error ? error.message : String(error)}`);
		}
		const totalBytesHeader = response.headers.get("content-length");
		const totalBytes = totalBytesHeader ? Number(totalBytesHeader) : null;
		let bytesDownloaded = 0;
		const reader = response.body.getReader();
		try {
			while (true) {
				let readResult;
				try {
					readResult = await reader.read();
				} catch (readError) {
					await writable.abort().catch(() => void 0);
					await entryDir.removeEntry("model.bin").catch(() => void 0);
					throw new ModelAssetDownloadError(`Streaming download failed for ${sanitizeUrlForError(descriptor.url)}: ${readError instanceof Error ? readError.message : String(readError)}`);
				}
				if (readResult.done) break;
				try {
					await writable.write(readResult.value);
				} catch (writeError) {
					await writable.abort().catch(() => void 0);
					await entryDir.removeEntry("model.bin").catch(() => void 0);
					throw new ModelAssetStorageError(`Failed to write to model.bin: ${writeError instanceof Error ? writeError.message : String(writeError)}`);
				}
				bytesDownloaded += readResult.value.byteLength;
				onProgress?.({
					bytesDownloaded,
					totalBytes: Number.isFinite(totalBytes) ? totalBytes : null
				});
			}
			try {
				await writable.close();
			} catch (closeError) {
				await entryDir.removeEntry("model.bin").catch(() => void 0);
				throw new ModelAssetStorageError(`Failed to close writable stream for model.bin: ${closeError instanceof Error ? closeError.message : String(closeError)}`);
			}
		} catch (error) {
			if (error instanceof ModelAssetDownloadError || error instanceof ModelAssetStorageError || error instanceof ModelAssetIntegrityError) throw error;
			await writable.abort().catch(() => void 0);
			await entryDir.removeEntry("model.bin").catch(() => void 0);
			throw new ModelAssetStorageError(`Unexpected error during model download/storage: ${error instanceof Error ? error.message : String(error)}`);
		}
		const downloadMs = this.now() - downloadStartedAt;
		const readStartedAt = this.now();
		let file;
		let bytes;
		try {
			file = await binHandle.getFile();
			bytes = new Uint8Array(await file.arrayBuffer());
		} catch (error) {
			await entryDir.removeEntry("model.bin").catch(() => void 0);
			throw new ModelAssetStorageError(`Failed to read downloaded model.bin from OPFS: ${error instanceof Error ? error.message : String(error)}`);
		}
		const cacheReadMs = this.now() - readStartedAt;
		if (bytes.byteLength !== descriptor.expectedByteSize) {
			await entryDir.removeEntry("model.bin").catch(() => void 0);
			throw new ModelAssetIntegrityError(`Downloaded model byte size mismatch: expected ${descriptor.expectedByteSize}, got ${bytes.byteLength}.`);
		}
		const verifyStartedAt = this.now();
		const digest = await computeSha256Hex(bytes);
		const verificationMs = this.now() - verifyStartedAt;
		if (digest.toLowerCase() !== descriptor.sha256.toLowerCase()) {
			await entryDir.removeEntry("model.bin").catch(() => void 0);
			throw new ModelAssetIntegrityError(`Downloaded model SHA256 mismatch: expected ${descriptor.sha256}, got ${digest}.`);
		}
		const marker = {
			schemaVersion: 1,
			assetId: descriptor.assetId,
			assetVersion: descriptor.assetVersion,
			expectedByteSize: descriptor.expectedByteSize,
			sha256: descriptor.sha256.toLowerCase(),
			verifiedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
		try {
			const markerWritable = await (await entryDir.getFileHandle("verified.json", { create: true })).createWritable();
			await markerWritable.write(JSON.stringify(marker, null, 2));
			await markerWritable.close();
		} catch (error) {
			await entryDir.removeEntry("verified.json").catch(() => void 0);
			await entryDir.removeEntry("model.bin").catch(() => void 0);
			throw new ModelAssetStorageError(`Failed to write activation marker: ${error instanceof Error ? error.message : String(error)}`);
		}
		await this.pruneOtherVersionsForAsset(assetDir, descriptor.sha256.toLowerCase());
		return {
			bytes,
			diagnostics: {
				source: "network",
				downloadMs,
				cacheReadMs,
				verificationMs,
				totalLoadMs: this.now() - loadStartedAt,
				byteSize: bytes.byteLength,
				sha256: descriptor.sha256,
				persistentStorageGranted
			}
		};
	}
	async tryReadCachedAsset(assetDir, entryDir, descriptor, loadStartedAt, persistentStorageGranted) {
		let markerHandle;
		try {
			markerHandle = await entryDir.getFileHandle("verified.json");
		} catch (error) {
			if (isNotFoundError(error)) return null;
			throw new ModelAssetStorageError(`Failed to access verified.json from OPFS: ${error instanceof Error ? error.message : String(error)}`);
		}
		let markerFile;
		try {
			markerFile = await markerHandle.getFile();
		} catch (error) {
			throw new ModelAssetStorageError(`Failed to get File for verified.json from OPFS: ${error instanceof Error ? error.message : String(error)}`);
		}
		let markerText;
		try {
			markerText = await markerFile.text();
		} catch (error) {
			throw new ModelAssetStorageError(`Failed to read verified.json text from OPFS: ${error instanceof Error ? error.message : String(error)}`);
		}
		let marker;
		try {
			marker = JSON.parse(markerText);
		} catch {
			return null;
		}
		if (!marker || typeof marker !== "object" || marker.schemaVersion !== 1 || marker.assetId !== descriptor.assetId || marker.expectedByteSize !== descriptor.expectedByteSize || marker.sha256?.toLowerCase() !== descriptor.sha256.toLowerCase()) return null;
		let binHandle;
		try {
			binHandle = await entryDir.getFileHandle("model.bin");
		} catch (error) {
			if (isNotFoundError(error)) return null;
			throw new ModelAssetStorageError(`Failed to access model.bin from OPFS: ${error instanceof Error ? error.message : String(error)}`);
		}
		const readStartedAt = this.now();
		let file;
		try {
			file = await binHandle.getFile();
		} catch (error) {
			throw new ModelAssetStorageError(`Failed to get File for model.bin from OPFS: ${error instanceof Error ? error.message : String(error)}`);
		}
		let arrayBuffer;
		try {
			arrayBuffer = await file.arrayBuffer();
		} catch (error) {
			throw new ModelAssetStorageError(`Failed to read model.bin arrayBuffer from OPFS: ${error instanceof Error ? error.message : String(error)}`);
		}
		const bytes = new Uint8Array(arrayBuffer);
		const cacheReadMs = this.now() - readStartedAt;
		if (bytes.byteLength !== descriptor.expectedByteSize) return null;
		const verifyStartedAt = this.now();
		const digest = await computeSha256Hex(bytes);
		const verificationMs = this.now() - verifyStartedAt;
		if (digest.toLowerCase() !== descriptor.sha256.toLowerCase()) return null;
		if (marker.assetVersion !== descriptor.assetVersion) try {
			const markerWritable = await markerHandle.createWritable();
			const updatedMarker = {
				...marker,
				assetVersion: descriptor.assetVersion,
				verifiedAt: (/* @__PURE__ */ new Date()).toISOString()
			};
			await markerWritable.write(JSON.stringify(updatedMarker, null, 2));
			await markerWritable.close();
		} catch {}
		await this.pruneOtherVersionsForAsset(assetDir, descriptor.sha256.toLowerCase());
		return {
			bytes,
			diagnostics: {
				source: "opfs-cache",
				cacheReadMs,
				verificationMs,
				totalLoadMs: this.now() - loadStartedAt,
				byteSize: bytes.byteLength,
				sha256: descriptor.sha256,
				persistentStorageGranted
			}
		};
	}
	async pruneOtherVersionsForAsset(assetDir, activeDirName) {
		try {
			const entries = assetDir.entries?.();
			if (entries && typeof entries[Symbol.asyncIterator] === "function") {
				for await (const [name, handle] of entries) if (handle.kind === "directory" && name.toLowerCase() !== activeDirName.toLowerCase()) await assetDir.removeEntry(name, { recursive: true }).catch(() => void 0);
			}
		} catch {}
	}
	async getRootDirectory() {
		if (this.options.getDirectory) return this.options.getDirectory();
		if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) throw new ModelAssetStorageUnavailableError();
		return navigator.storage.getDirectory();
	}
	async requestPersistence() {
		if (this.options.persist) return this.options.persist();
		try {
			if (typeof navigator !== "undefined" && navigator.storage?.persist) return await navigator.storage.persist();
		} catch {
			return null;
		}
		return null;
	}
	now() {
		return this.options.nowMs?.() ?? globalThis.performance?.now?.() ?? Date.now();
	}
};
function createModelAssetStore(options) {
	return new ModelAssetStore(options);
}
function validateModelAssetDescriptor(descriptor) {
	if (descriptor.schemaVersion !== 1) throw new Error("Unsupported model asset descriptor schema version.");
	if (!descriptor.assetId || typeof descriptor.assetId !== "string" || !ASSET_ID_REGEX.test(descriptor.assetId)) throw new Error("Model asset descriptor assetId must match /^[a-z0-9][a-z0-9._-]{0,127}$/.");
	if (!descriptor.assetVersion || typeof descriptor.assetVersion !== "string") throw new Error("Model asset descriptor must include an assetVersion.");
	if (!descriptor.url || typeof descriptor.url !== "string") throw new Error("Model asset descriptor must include a URL.");
	if (!Number.isFinite(descriptor.expectedByteSize) || descriptor.expectedByteSize <= 0) throw new Error("Model asset descriptor expectedByteSize must be a positive number.");
	if (!/^[a-f0-9]{64}$/i.test(descriptor.sha256)) throw new Error("Model asset descriptor sha256 must be a 64-character hex string.");
	if (descriptor.mediaType !== "application/octet-stream") throw new Error("Model asset descriptor mediaType must be 'application/octet-stream'.");
}
async function computeSha256Hex(bytes) {
	if (!globalThis.crypto?.subtle) throw new Error("Web Crypto SHA-256 is unavailable; cannot verify model integrity.");
	const copy = new Uint8Array(bytes);
	const digest = await globalThis.crypto.subtle.digest("SHA-256", copy.buffer);
	return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
}
function isNotFoundError(error) {
	return typeof error === "object" && error !== null && error.name === "NotFoundError";
}
//#endregion
//#region apps/customer-web/src/lib/model-assets/verified-model-asset-loader.ts
/** Truthful immutable asset identity, independent of model family or inference policy. */
function createVerifiedModelAssetLoader(options) {
	const store = createModelAssetStore(options);
	return (asset) => store.ensureAsset(asset);
}
//#endregion
//#region apps/customer-web/src/lib/practice/acoustic/model/robust-piano-decoder.ts
/** Region peak (earliest on a tie), gated by support at that exact frame. */
function decodeRobustPiano(raw, inputStartSample, thresholds) {
	const onset = matrix(raw.reg_onset_output, raw.reg_onset_shape);
	const frame = matrix(raw.frame_output, raw.frame_shape);
	if (onset.frameCount !== frame.frameCount) fail("ACOUSTIC_OUTPUT_DESCRIPTOR_MISMATCH");
	const events = [];
	for (let pitchIndex = 0; pitchIndex < 88; pitchIndex++) {
		let index = 0;
		while (index < onset.frameCount) {
			while (index < onset.frameCount && onset.value(index, pitchIndex) < thresholds.onsetThreshold) index++;
			if (index >= onset.frameCount) break;
			let peak = index, peakScore = onset.value(index, pitchIndex);
			while (index + 1 < onset.frameCount && onset.value(index + 1, pitchIndex) >= thresholds.onsetThreshold) {
				index++;
				const score = onset.value(index, pitchIndex);
				if (score > peakScore) {
					peak = index;
					peakScore = score;
				}
			}
			index++;
			const frameScore = frame.value(peak, pitchIndex);
			if (frameScore < thresholds.frameThreshold) continue;
			const midiPitch = 21 + pitchIndex;
			const sampleOffset = Math.round(peak / 100 * ACOUSTIC_MODEL.sampleRateHz);
			events.push(Object.freeze({
				pitch: pitchName(midiPitch),
				midiPitch,
				targetSample: inputStartSample + sampleOffset,
				confidence: Math.min(peakScore, frameScore),
				onsetScore: peakScore,
				frameScore
			}));
		}
	}
	return events.sort((a, b) => a.targetSample - b.targetSample || a.midiPitch - b.midiPitch);
}
function matrix(data, shape) {
	if (shape.length !== 2 && shape.length !== 3 || shape.length === 3 && shape[0] !== 1) fail("ACOUSTIC_OUTPUT_DESCRIPTOR_MISMATCH");
	const frameCount = shape.length === 3 ? shape[1] : shape[0];
	if (shape.at(-1) !== 88 || !Number.isInteger(frameCount) || frameCount <= 0 || data.length !== frameCount * 88) fail("ACOUSTIC_OUTPUT_DESCRIPTOR_MISMATCH");
	if (data.some((v) => !Number.isFinite(v))) fail("ACOUSTIC_NONFINITE_OUTPUT");
	return {
		frameCount,
		value: (frame, pitch) => data[frame * 88 + pitch]
	};
}
function pitchName(midi) {
	return `${[
		"C",
		"C#",
		"D",
		"D#",
		"E",
		"F",
		"F#",
		"G",
		"G#",
		"A",
		"A#",
		"B"
	][midi % 12]}${Math.floor(midi / 12) - 1}`;
}
//#endregion
//#region apps/customer-web/src/lib/practice/acoustic/model/model-validation.ts
function assertWindowGeometry(w) {
	if (w.ownedEndTarget <= w.ownedStartTarget || w.ownedEndTarget > w.ownedStartTarget + ACOUSTIC_MODEL.ownedMs * 16 || w.endSample - w.startSample !== ACOUSTIC_MODEL.inputSamples || Math.abs(w.endSample - w.ownedEndTarget - ACOUSTIC_MODEL.futureMs * 16) > 1) fail("ACOUSTIC_WORKER_WINDOW_MISMATCH");
}
function assertModelNames(inputNames, outputNames) {
	if (inputNames?.join() !== "audio" || outputNames?.join() !== "reg_onset_output,frame_output") fail("ACOUSTIC_MODEL_DESCRIPTOR_MISMATCH");
}
function checkedOutput(tensor) {
	if (!tensor || tensor.dims.join() !== "1,183,88" || tensor.data.length !== 16104) fail("ACOUSTIC_OUTPUT_DESCRIPTOR_MISMATCH");
	const data = Float32Array.from(tensor.data);
	if (data.some((v) => !Number.isFinite(v))) fail("ACOUSTIC_NONFINITE_OUTPUT");
	return data;
}
//#endregion
//#region apps/customer-web/src/lib/practice/acoustic/model/acoustic-model-manifest.ts
function practiceAcousticModelManifest(url) {
	const asset = Object.freeze({
		schemaVersion: 1,
		assetId: "practice-acoustic-robust-browser",
		assetVersion: "v1",
		url,
		expectedByteSize: ACOUSTIC_MODEL.modelBytes,
		sha256: ACOUSTIC_MODEL.modelSha256,
		mediaType: "application/octet-stream"
	});
	return Object.freeze({
		asset,
		ortVersion: ACOUSTIC_MODEL.ortVersion,
		provider: ACOUSTIC_MODEL.provider,
		automaticFallback: ACOUSTIC_MODEL.automaticFallback,
		acousticCoreIdentitySha256: ACOUSTIC_MODEL.identitySha256,
		input: Object.freeze({
			name: "audio",
			dtype: "float32",
			shape: Object.freeze([1, 29120])
		}),
		outputs: Object.freeze(["reg_onset_output", "frame_output"].map((name) => Object.freeze({
			name,
			dtype: "float32",
			shape: Object.freeze([
				1,
				183,
				88
			])
		}))),
		decoder: Object.freeze({
			identity: "A",
			sourceSha256: acoustic_core_identity_default.decoder.authoritativeSource.sha256,
			function: acoustic_core_identity_default.decoder.function,
			onsetThreshold: ACOUSTIC_MODEL.onsetThreshold,
			frameThreshold: ACOUSTIC_MODEL.frameThreshold
		})
	});
}
//#endregion
//#region apps/customer-web/src/lib/practice/acoustic/model/model-inference.ts
function decodeAcousticOutputs(raw, input) {
	return decodeRobustPiano(raw, input.window.startSample, ACOUSTIC_MODEL);
}
async function verifyAcousticModel(bytes) {
	if (bytes.byteLength !== ACOUSTIC_MODEL.modelBytes || await sha256(bytes) !== ACOUSTIC_MODEL.modelSha256) fail("ACOUSTIC_MODEL_IDENTITY_MISMATCH");
}
function outputData(tensor) {
	if (!tensor || tensor.type !== "float32" || !(tensor.data instanceof Float32Array)) fail("ACOUSTIC_OUTPUT_DESCRIPTOR_MISMATCH");
	return checkedOutput({
		dims: tensor.dims,
		data: tensor.data
	});
}
/** One ONNX session. Window context is explicit; no recurrent state crosses segments. */
var AcousticModelSession = class {
	constructor() {
		this.state = "EMPTY";
		this.busy = false;
		this.session = null;
		this.nextJob = 0;
		this.loads = 0;
		this.runs = 0;
	}
	async load(modelUrl) {
		if (this.busy || this.state !== "EMPTY") fail("ACOUSTIC_WORKER_NOT_EMPTY");
		this.busy = true;
		let session = null;
		try {
			await assertAcousticIdentity();
			if (ort.env.versions.web !== ACOUSTIC_MODEL.ortVersion) fail("ORT_VERSION_MISMATCH");
			if (typeof navigator === "undefined" || !navigator.gpu) fail("ACOUSTIC_WEBGPU_UNAVAILABLE");
			const manifest = practiceAcousticModelManifest(modelUrl), started = performance.now();
			const loaded = await createVerifiedModelAssetLoader()(manifest.asset);
			await verifyAcousticModel(loaded.bytes);
			const verifiedAt = performance.now();
			session = await ort.InferenceSession.create(loaded.bytes, {
				executionProviders: [manifest.provider],
				graphOptimizationLevel: "disabled"
			});
			this.loads++;
			assertModelNames(session.inputNames, session.outputNames);
			this.session = session;
			this.state = "READY";
			return {
				...loaded.diagnostics,
				assetId: manifest.asset.assetId,
				assetVersion: manifest.asset.assetVersion,
				modelByteSize: loaded.bytes.length,
				modelSha256: manifest.asset.sha256,
				executionProvider: manifest.provider,
				modelFetchAndVerifyMs: verifiedAt - started,
				sessionCreateMs: performance.now() - verifiedAt,
				acousticCoreIdentitySha256: ACOUSTIC_MODEL.identitySha256,
				ortWebVersion: ort.env.versions.web,
				automaticFallback: false,
				actualSessionLoadCount: this.loads,
				inputDescriptor: {
					name: "audio",
					dtype: "float32",
					shape: [1, 29120]
				},
				outputDescriptors: {
					reg_onset_output: [
						1,
						183,
						88
					],
					frame_output: [
						1,
						183,
						88
					]
				}
			};
		} catch (error) {
			this.state = "FAILED";
			await session?.release();
			throw error;
		} finally {
			this.busy = false;
		}
	}
	async run(input) {
		onlyFields(input, ["window", "pcm"]);
		onlyFields(input.window, [
			"jobIndex",
			"regionIndex",
			"windowIndex",
			"ownedStartTarget",
			"ownedEndTarget",
			"startSample",
			"endSample"
		]);
		if (this.busy) fail("ACOUSTIC_WORKER_CONCURRENCY_REJECTED");
		if (this.state !== "READY" || !this.session) fail("ACOUSTIC_WORKER_NOT_READY");
		const w = input.window;
		assertWindowGeometry(w);
		if (w.jobIndex !== this.nextJob || !(input.pcm instanceof Float32Array) || input.pcm.length !== ACOUSTIC_MODEL.inputSamples || input.pcm.some((v) => !Number.isFinite(v))) fail("ACOUSTIC_WORKER_WINDOW_MISMATCH");
		this.busy = true;
		try {
			const started = performance.now();
			const audio = new ort.Tensor("float32", input.pcm, [1, 29120]);
			let tensors;
			let raw;
			try {
				this.runs++;
				tensors = await this.session.run({ audio }, ["reg_onset_output", "frame_output"]);
				raw = {
					reg_onset_output: outputData(tensors.reg_onset_output),
					reg_onset_shape: [
						1,
						183,
						88
					],
					frame_output: outputData(tensors.frame_output),
					frame_shape: [
						1,
						183,
						88
					]
				};
			} finally {
				audio.dispose();
				for (const tensor of Object.values(tensors ?? {})) tensor.dispose();
			}
			const inferred = performance.now(), events = decodeAcousticOutputs(raw, input), decoded = performance.now();
			this.nextJob++;
			return {
				events,
				inferenceMs: inferred - started,
				decodeMs: decoded - inferred,
				actualSessionRunCount: this.runs
			};
		} catch (error) {
			this.state = "FAILED";
			throw error;
		} finally {
			this.busy = false;
		}
	}
	async dispose() {
		if (this.busy) fail("ACOUSTIC_WORKER_CONCURRENCY_REJECTED");
		try {
			await this.session?.release();
		} finally {
			this.session = null;
			this.state = "DISPOSED";
		}
	}
};
//#endregion
//#region backend/research/practice_acoustic_asset_delivery_v43/oss-expiry.mjs
var HOST = "noteverse-model-assets.oss-cn-shenzhen.aliyuncs.com";
var PATH = "/models/continuous/robust-browser-v1/4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3/model.onnx";
var OSS4_FIELDS = [
	"x-oss-signature-version",
	"x-oss-date",
	"x-oss-expires",
	"x-oss-credential",
	"x-oss-signature"
];
var demand$1 = (condition, code) => {
	if (!condition) throw Error(code);
};
var iso = (ms) => Number.isFinite(ms) ? new Date(ms).toISOString() : null;
function signedMetadata(downloadUrl, descriptorExpiry) {
	const url = new URL(downloadUrl), query = url.searchParams;
	const stamp = query.get("x-oss-date"), duration = query.get("x-oss-expires");
	return {
		https: url.protocol === "https:",
		hostname: url.hostname,
		pathname: url.pathname,
		signatureVersion: query.get("x-oss-signature-version") === "OSS4-HMAC-SHA256" ? "OSS4-HMAC-SHA256" : null,
		oss4FieldPresence: Object.fromEntries(OSS4_FIELDS.map((name) => [name, query.has(name)])),
		awsSigningAbsent: ![...query.keys()].some((name) => name.toLowerCase().startsWith("x-amz-")),
		xOssDate: /^[0-9]{8}T[0-9]{6}Z$/.test(stamp ?? "") ? stamp : null,
		xOssExpires: /^[0-9]{1,6}$/.test(duration ?? "") ? duration : null,
		descriptorExpiry: iso(Date.parse(descriptorExpiry))
	};
}
function expiryObservation(metadata, receivedAtMs) {
	const stamp = metadata.xOssDate;
	const dateMs = typeof stamp === "string" && /^[0-9]{8}T[0-9]{6}Z$/.test(stamp) ? Date.parse(stamp.slice(0, 4) + "-" + stamp.slice(4, 6) + "-" + stamp.slice(6, 8) + "T" + stamp.slice(9, 11) + ":" + stamp.slice(11, 13) + ":" + stamp.slice(13, 15) + "Z") : NaN;
	const effective = dateMs + (typeof metadata.xOssExpires === "string" && /^[0-9]+$/.test(metadata.xOssExpires) ? Number(metadata.xOssExpires) : NaN) * 1e3, descriptor = Date.parse(metadata.descriptorExpiry);
	return {
		descriptorExpiry: iso(descriptor),
		xOssDate: metadata.xOssDate,
		xOssExpires: metadata.xOssExpires,
		signingDateMs: Number.isFinite(dateMs) ? dateMs : null,
		effectiveSignedExpiry: iso(effective),
		effectiveSignedExpiryMs: Number.isFinite(effective) ? effective : null,
		descriptorExpiryMs: Number.isFinite(descriptor) ? descriptor : null,
		deltaMs: Number.isFinite(descriptor - effective) ? descriptor - effective : null,
		receivedAtMs
	};
}
function validateSignedMetadata(metadata, receivedAtMs) {
	demand$1(metadata.https === true, "OSS_HTTPS_REQUIRED");
	demand$1(metadata.hostname === HOST, "OSS_AUTHORITY_UNEXPECTED");
	demand$1(metadata.pathname === PATH, "OSS_OBJECT_UNEXPECTED");
	demand$1(OSS4_FIELDS.every((name) => metadata.oss4FieldPresence[name] === true), "OSS4_FIELDS_MISSING");
	demand$1(metadata.signatureVersion === "OSS4-HMAC-SHA256", "OSS4_VERSION_REQUIRED");
	demand$1(metadata.awsSigningAbsent === true, "AWS_SIGNING_FORBIDDEN");
	const observation = expiryObservation(metadata, receivedAtMs);
	demand$1(observation.signingDateMs !== null && new Date(observation.signingDateMs).toISOString().replace(/[-:]/g, "").replace(".000", "") === metadata.xOssDate, "OSS_DATE_INVALID");
	const ttl = Number(metadata.xOssExpires);
	demand$1(typeof metadata.xOssExpires === "string" && /^[0-9]+$/.test(metadata.xOssExpires) && Number.isInteger(ttl) && ttl > 0 && ttl <= 604800, "OSS_TTL_INVALID");
	demand$1(observation.effectiveSignedExpiryMs > receivedAtMs, "OSS_EFFECTIVE_EXPIRY_NOT_FUTURE");
	demand$1(observation.descriptorExpiryMs !== null && observation.descriptorExpiryMs > receivedAtMs, "OSS_DESCRIPTOR_EXPIRY_NOT_FUTURE");
	demand$1(observation.deltaMs >= 0 && observation.deltaMs < 2e3, "OSS_EXPIRY_RELATION_OUTSIDE_PROVEN_ENVELOPE");
	return observation;
}
//#endregion
//#region backend/research/practice_acoustic_asset_delivery_v43/browser-entry.mjs
var SHA = "4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3";
var SIZE = 98689283;
var ROOT = "noteverse-model-assets/v1/practice-acoustic-robust-browser/4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3";
var endpoint = "/api/v1/model-assets/practice-acoustic-robust-browser-v1/access";
var events = [], currentCell = null, ordinal = 0, active = false, cellsRun = 0;
var emit = (kind, detail = {}) => events.push({
	order: ++ordinal,
	cell: currentCell,
	kind,
	...detail
});
var demand = (condition, code) => {
	if (!condition) throw Error(code);
};
var labels = /* @__PURE__ */ new WeakMap(), streams = /* @__PURE__ */ new WeakMap(), fileLabels = /* @__PURE__ */ new WeakMap();
var hex = (buffer) => Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
var target = (value) => typeof value === "string" && value.startsWith("noteverse-model-assets/");
function installObservation() {
	const directory = FileSystemDirectoryHandle.prototype;
	const getDirectoryHandle = directory.getDirectoryHandle;
	directory.getDirectoryHandle = async function(...args) {
		const result = await Reflect.apply(getDirectoryHandle, this, args);
		const parent = labels.get(this);
		const label = parent ? parent + "/" + args[0] : args[0] === "noteverse-model-assets" ? args[0] : null;
		if (label) {
			labels.set(result, label);
			if (active) emit("DIRECTORY", {
				path: label,
				create: args[1]?.create === true
			});
		}
		return result;
	};
	const getFileHandle = directory.getFileHandle;
	directory.getFileHandle = async function(...args) {
		const result = await Reflect.apply(getFileHandle, this, args), parent = labels.get(this);
		if (parent) {
			const label = parent + "/" + args[0];
			labels.set(result, label);
			if (active) emit("FILE_HANDLE", {
				path: label,
				create: args[1]?.create === true
			});
		}
		return result;
	};
	const removeEntry = directory.removeEntry;
	directory.removeEntry = async function(...args) {
		const result = await Reflect.apply(removeEntry, this, args);
		if (active && labels.has(this)) emit("REMOVE", { path: labels.get(this) + "/" + args[0] });
		return result;
	};
	const getFile = FileSystemFileHandle.prototype.getFile;
	FileSystemFileHandle.prototype.getFile = async function(...args) {
		const result = await Reflect.apply(getFile, this, args), label = labels.get(this);
		if (target(label)) {
			fileLabels.set(result, label);
			if (active) emit("FILE_READ", {
				path: label,
				byteSize: result.size
			});
		}
		return result;
	};
	const arrayBuffer = Blob.prototype.arrayBuffer;
	Blob.prototype.arrayBuffer = async function(...args) {
		const result = await Reflect.apply(arrayBuffer, this, args), label = fileLabels.get(this);
		if (active && target(label)) emit("OPFS_BYTES_READ", {
			path: label,
			byteSize: result.byteLength
		});
		return result;
	};
	const createWritable = FileSystemFileHandle.prototype.createWritable;
	FileSystemFileHandle.prototype.createWritable = async function(...args) {
		const result = await Reflect.apply(createWritable, this, args), label = labels.get(this);
		if (target(label)) {
			streams.set(result, label);
			if (active) emit("WRITE_OPEN", { path: label });
		}
		return result;
	};
	const write = FileSystemWritableFileStream.prototype.write;
	FileSystemWritableFileStream.prototype.write = async function(...args) {
		const result = await Reflect.apply(write, this, args), label = streams.get(this);
		if (active && target(label)) {
			let detail = {};
			if (label.endsWith("/verified.json") && typeof args[0] === "string") {
				const marker = JSON.parse(args[0]);
				detail = { marker: {
					schemaVersion: marker.schemaVersion,
					assetId: marker.assetId,
					assetVersion: marker.assetVersion,
					expectedByteSize: marker.expectedByteSize,
					sha256: marker.sha256,
					verifiedAt: marker.verifiedAt
				} };
			} else detail = { byteSize: args[0]?.byteLength ?? 0 };
			emit("WRITE", {
				path: label,
				...detail
			});
		}
		return result;
	};
	const close = FileSystemWritableFileStream.prototype.close;
	FileSystemWritableFileStream.prototype.close = async function(...args) {
		const result = await Reflect.apply(close, this, args), label = streams.get(this);
		if (active && target(label)) emit("WRITE_CLOSE", { path: label });
		return result;
	};
	const digest = SubtleCrypto.prototype.digest;
	SubtleCrypto.prototype.digest = async function(...args) {
		const result = await Reflect.apply(digest, this, args);
		if (active && args[1]?.byteLength === SIZE) emit("SHA256_VERIFIED_BYTES", {
			byteSize: SIZE,
			sha256: hex(result)
		});
		return result;
	};
	const nativeFetch = window.fetch;
	window.fetch = async function(...args) {
		const url = new URL(typeof args[0] === "string" ? args[0] : args[0].url, location.origin);
		const response = await Reflect.apply(nativeFetch, this, args);
		if (active && url.origin === location.origin && url.pathname === endpoint) {
			const body = await response.clone().json();
			emit("ACCESS_RESPONSE", {
				status: response.status,
				credentials: args[1]?.credentials,
				success: body.success === true,
				pathname: url.pathname
			});
		}
		return response;
	};
}
async function entryDirectory(create = false) {
	let directory = await navigator.storage.getDirectory();
	for (const name of ROOT.split("/")) directory = await directory.getDirectoryHandle(name, { create });
	return directory;
}
async function clearOnlyTarget() {
	let directory = await navigator.storage.getDirectory();
	try {
		for (const name of ROOT.split("/").slice(0, -1)) directory = await directory.getDirectoryHandle(name);
		await directory.removeEntry(SHA, { recursive: true });
	} catch (error) {
		if (error.name !== "NotFoundError") throw error;
	}
	let absent = false;
	try {
		await entryDirectory();
	} catch (error) {
		if (error.name === "NotFoundError") absent = true;
		else throw error;
	}
	demand(absent, "COLD_CACHE_NOT_ABSENT");
	return {
		exactTargetEntryAbsent: true,
		unrelatedStorageCleared: false
	};
}
function sanitizeAccess(access) {
	const metadata = signedMetadata(access.downloadUrl, access.downloadUrlExpiresAt), receivedAtMs = Date.now();
	emit("SIGNED_EXPIRY_OBSERVED", expiryObservation(metadata, receivedAtMs));
	const expiry = validateSignedMetadata(metadata, receivedAtMs);
	return {
		schemaVersion: access.schemaVersion,
		assetId: access.assetId,
		assetVersion: access.assetVersion,
		expectedByteSize: access.expectedByteSize,
		sha256: access.sha256,
		mediaType: access.mediaType,
		signedAccess: {
			...metadata,
			...expiry,
			expiresAt: metadata.descriptorExpiry,
			ttlSeconds: Number(metadata.xOssExpires)
		}
	};
}
installObservation();
window.v43 = Object.freeze({
	async login(identity, credential) {
		demand((await apiClient.postForm("/auth/login", {
			username: identity,
			password: credential
		})).success === true, "REAL_LOGIN_REJECTED");
		demand((await apiClient.get("/me/profile", void 0, { suppressAuthRedirect: true })).success === true, "REAL_PRINCIPAL_UNAVAILABLE");
		return {
			authenticated: true,
			mechanism: "UNCHANGED_API_CLIENT_REAL_CUSTOMER_LOGIN"
		};
	},
	async runCell(name) {
		demand(!active && cellsRun < 2, "NO_RETRY");
		demand(name === ["authenticated-cold-network-delivery", "authenticated-warm-opfs-cache"][cellsRun], "CELL_ORDER");
		currentCell = name;
		events = [];
		ordinal = 0;
		cellsRun++;
		const initialState = cellsRun === 1 ? await clearOnlyTarget() : { verifiedEntryPreserved: true };
		active = true;
		emit("CELL_BEGIN", initialState);
		const session = new AcousticModelSession();
		try {
			const access = await getPracticeAcousticModelAccess();
			emit("PRODUCTION_DESCRIPTOR_ACCEPTED", sanitizeAccess(access));
			const adapter = await navigator.gpu.requestAdapter();
			demand(adapter && !adapter.isFallbackAdapter, "HARDWARE_WEBGPU_REQUIRED");
			const adapterInfo = adapter.info ?? await adapter.requestAdapterInfo();
			emit("GPU", {
				vendor: adapterInfo.vendor,
				architecture: adapterInfo.architecture,
				device: adapterInfo.device,
				description: adapterInfo.description,
				fallback: adapter.isFallbackAdapter === true
			});
			emit("SESSION_READY", { diagnostics: await session.load(access.downloadUrl) });
			const directory = await entryDirectory();
			const bytes = await (await (await directory.getFileHandle("model.bin")).getFile()).arrayBuffer();
			const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
			const marker = JSON.parse(await (await (await directory.getFileHandle("verified.json")).getFile()).text());
			emit("FINAL_OPFS_CHECK", {
				byteSize: bytes.byteLength,
				sha256,
				marker
			});
			await session.dispose();
			emit("SESSION_DISPOSED");
			active = false;
			return {
				name,
				result: "RECEIPTS_READY_FOR_INDEPENDENT_AUDIT",
				events,
				inferenceRuns: 0
			};
		} catch (error) {
			try {
				await session.dispose();
				emit("SESSION_DISPOSED_AFTER_FAILURE");
			} catch {
				emit("SESSION_DISPOSAL_FAILED");
			}
			active = false;
			return {
				name,
				result: "CELL_EXECUTION_BLOCKED",
				events,
				errorClass: error.name,
				safeCode: /^[A-Z0-9_]+$/.test(error.message) ? error.message : "UNSAFE_DETAIL_OMITTED",
				inferenceRuns: 0
			};
		}
	}
});
//#endregion
