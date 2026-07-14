import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import admin from 'firebase-admin';
import storyEngine from './story-engine.mjs';

let s3;
let firebaseApp;

export async function handler(event) {
  event = event || {};
  const method = String(event.httpMethod || 'GET').toUpperCase();
  const path = String(event.path || '/');
  const headers = event.headers || {};
  const origin = getHeader(headers, 'origin');

  if (method === 'POST' && path.endsWith('/upload')) {
    if (typeof event.body === 'string' && event.body.length > 3 * 1024 * 1024) {
      return jsonResponse(413, { error: 'Story file is too large. Maximum size is 2 MB.' }, origin);
    }
    try {
      await requireFirebaseUser(headers);
    } catch (error) {
      return jsonResponse(error.status || 500, { error: error.status ? error.message : 'Story authentication failed.' }, origin);
    }
  }

  const host = getHeader(headers, 'host') || process.env.API_GATEWAY_HOST;
  if (!host) return jsonResponse(500, { error: 'API_GATEWAY_HOST is not configured.' }, origin);
  const query = event.queryStringParameters || {};
  const url = new URL('https://' + host + path);
  Object.keys(query).forEach((key) => url.searchParams.append(key, String(query[key])));
  let body = event.body || undefined;
  if (event.isBase64Encoded && body) body = Buffer.from(body, 'base64');

  try {
    const request = new Request(url, { method, headers, body: method === 'GET' || method === 'HEAD' ? undefined : body });
    const result = await storyEngine.fetch(request, { STORIES: createStoryStore(), ROUTE_PREFIX: '/api/rekindle/story' }, {});
    const resultHeaders = {};
    result.headers.forEach((value, key) => { resultHeaders[key] = value; });
    return {
      statusCode: result.status,
      headers: resultHeaders,
      isBase64Encoded: false,
      body: await result.text()
    };
  } catch (error) {
    return jsonResponse(error.status || 500, { error: error.status ? error.message : 'Story service failed.' }, origin);
  }
}

function createStoryStore() {
  return {
    async put(key, value) {
      const body = value instanceof ArrayBuffer ? Buffer.from(value) : String(value);
      await getS3().send(new PutObjectCommand({ Bucket: required('S3_BUCKET'), Key: objectKey(key), Body: body }));
    },
    async get(key, options) {
      try {
        const result = await getS3().send(new GetObjectCommand({ Bucket: required('S3_BUCKET'), Key: objectKey(key) }));
        const bytes = await result.Body.transformToByteArray();
        if (options && options.type === 'arrayBuffer') return Uint8Array.from(bytes).buffer;
        return Buffer.from(bytes).toString('utf8');
      } catch (error) {
        if (error.name === 'NoSuchKey' || error.$metadata && error.$metadata.httpStatusCode === 404) return null;
        throw error;
      }
    },
    async delete(key) {
      await getS3().send(new DeleteObjectCommand({ Bucket: required('S3_BUCKET'), Key: objectKey(key) }));
    }
  };
}

function objectKey(key) {
  return 'story-runtime/' + String(key).replace(/[^a-zA-Z0-9:_-]/g, '');
}

function getS3() {
  if (s3) return s3;
  s3 = new S3Client({
    region: 'ru-central1',
    endpoint: 'https://storage.yandexcloud.net',
    credentials: { accessKeyId: required('S3_ACCESS_KEY_ID'), secretAccessKey: required('S3_SECRET_ACCESS_KEY') }
  });
  return s3;
}

async function requireFirebaseUser(headers) {
  const token = getHeader(headers, 'x-firebase-token');
  if (!token) throw httpError(401, 'Authentication is required.');
  try { await getFirebaseApp().auth().verifyIdToken(token, true); } catch (error) { throw httpError(401, 'Session is invalid or expired.'); }
}

function getFirebaseApp() {
  if (firebaseApp) return firebaseApp;
  const serviceAccount = JSON.parse(required('FIREBASE_SERVICE_ACCOUNT_JSON'));
  if (serviceAccount.private_key) serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  firebaseApp = admin.initializeApp({ credential: admin.credential.cert(serviceAccount), projectId: 'rekindle-fork' }, 'rekindle-yandex-story');
  return firebaseApp;
}

function getHeader(headers, name) {
  const target = name.toLowerCase();
  const key = Object.keys(headers).find((item) => item.toLowerCase() === target);
  return key ? headers[key] : '';
}

function jsonResponse(statusCode, body, origin) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin || 'https://rekindle.website.yandexcloud.net' }, body: JSON.stringify(body) };
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function required(name) {
  if (!process.env[name]) throw new Error(name + ' is not configured.');
  return process.env[name];
}
