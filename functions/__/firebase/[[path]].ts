import firebaseConfig from '../../../firebase-applet-config.json';

interface PagesProxyContext {
  request: Request;
  env: Record<string, string | undefined>;
}

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

  const upstreamRes = await fetch(upstreamUrl.toString(), {
    method: request.method,
    redirect: 'manual',
  });

  const responseHeaders = new Headers();
  for (const [key, value] of upstreamRes.headers.entries()) {
    if (!HOP_BY_HOP_RES_HEADERS.has(key.toLowerCase())) {
      responseHeaders.append(key, value);
    }
  }

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    statusText: upstreamRes.statusText,
    headers: responseHeaders,
  });
}
