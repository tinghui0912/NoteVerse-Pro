export function classifyRequest(value, origin, objectKey, ossHost) {
  const url = new URL(value), pathname = url.pathname;
  let classification = 'UNKNOWN';
  if (url.origin === origin) {
    if (pathname === '/api/v1/model-assets/practice-acoustic-robust-browser-v1/access') classification = 'MODEL_ACCESS_DESCRIPTOR_API';
    else if (pathname.startsWith('/api/v1/auth/') || pathname === '/api/v1/me/profile') classification = 'AUTH_API';
    else if (pathname.startsWith('/__v40/ort/')) classification = 'ORT_SUBORDINATE_RESOURCE';
    else classification = 'CUSTOMER_WEB_DOCUMENT_OR_STATIC';
  } else if (url.protocol === 'https:' && url.hostname === ossHost && pathname === '/' + objectKey) {
    classification = 'OSS_MODEL_PAYLOAD_GET';
  } else if (url.protocol === 'blob:') classification = 'OTHER_EXPECTED';
  return { classification, hostname: url.hostname, pathname };
}
