import firebaseConfig from '../../../firebase-applet-config.json';

interface PagesProxyContext {
  request: Request;
  env: Record<string, string | undefined>;
}

const HOP_BY_HOP_REQ_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'cf-connecting-ip',
  'cf-ipcountry',
  'cf-ray',
  'cf-visitor',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
]);

const HOP_BY_HOP_RES_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'transfer-encoding',
]);

export async function onRequest(context: PagesProxyContext): Promise<Response> {
  const { request, env } = context;
  const upstreamHost =
    (env.FIREBASE_AUTH_UPSTREAM || firebaseConfig.authDomain || '').trim() ||
    'totemic-booking-rvc14.firebaseapp.com';

  const incomingUrl = new URL(request.url);
  const upstreamUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, `https://${upstreamHost}`);

  const outgoingHeaders = new Headers();
  for (const [key, value] of request.headers.entries()) {
    if (!HOP_BY_HOP_REQ_HEADERS.has(key.toLowerCase())) {
      outgoingHeaders.set(key, value);
    }
  }

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const upstreamRes = await fetch(upstreamUrl.toString(), {
    method: request.method,
    headers: outgoingHeaders,
    body: hasBody ? request.body : undefined,
    redirect: 'manual',
  });

  const responseHeaders = new Headers();
  for (const [key, value] of upstreamRes.headers.entries()) {
    if (!HOP_BY_HOP_RES_HEADERS.has(key.toLowerCase())) {
      responseHeaders.append(key, value);
    }
  }

  const ct = responseHeaders.get('content-type') || '';
  if (ct.includes('text/html')) {
    responseHeaders.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  }

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    statusText: upstreamRes.statusText,
    headers: responseHeaders,
  });
}
