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
  const incomingUrl = new URL(request.url);
  const projectHost = firebaseConfig.projectId
    ? `${firebaseConfig.projectId}.firebaseapp.com`
    : 'totemic-booking-rvc14.firebaseapp.com';
  const configuredAuth = (firebaseConfig.authDomain || '').trim();
  const safeConfigured =
    configuredAuth.endsWith('.firebaseapp.com') || configuredAuth.endsWith('.web.app')
      ? configuredAuth
      : projectHost;
  const candidateUpstream = (env.FIREBASE_AUTH_UPSTREAM || safeConfigured).trim() || projectHost;
  const upstreamHost =
    candidateUpstream.toLowerCase() === incomingUrl.hostname.toLowerCase()
      ? projectHost
      : candidateUpstream;

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
