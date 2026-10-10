import {
  clearStoredToken,
  getStoredToken,
  shouldInvalidateSessionForRequest,
} from '../auth-storage';
import { notifyUnauthorized } from '../unauthorized-bus';

// 认证入口自身的 401 是"密码错误"，不能触发登出跳转，否则会打断登录流程
const AUTH_ENTRY_PATHS = ['/auth/login', '/auth/register'];

declare const __API_BASE_URL__: string | undefined;

const API_BASE_URL_OVERRIDE_KEY = 'infohub_v3_api_base_url';

function readApiBaseUrlOverride(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(API_BASE_URL_OVERRIDE_KEY) || '';
  } catch {
    return '';
  }
}

export const API_BASE_URL = (
  readApiBaseUrlOverride()
  || __API_BASE_URL__
  || import.meta.env.VITE_API_BASE_URL
  || '/api'
).replace(/\/$/, '');

export type RequestBody = BodyInit | object | null | undefined;

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: RequestBody;
  asText?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractDetailMessages(detail: unknown): string {
  if (!Array.isArray(detail)) return '';
  return detail
    .flatMap((item) => {
      if (!isRecord(item)) return [];
      return typeof item.msg === 'string' ? [item.msg] : [];
    })
    .join('; ');
}

function extractErrorMessage(payload: unknown, statusText: string, status: number): string {
  if (!isRecord(payload)) {
    return statusText || `HTTP ${status}`;
  }

  const detail =
    (typeof payload.detail === 'string' && payload.detail) ||
    (typeof payload.error === 'string' && payload.error) ||
    (typeof payload.message === 'string' && payload.message) ||
    extractDetailMessages(payload.detail) ||
    statusText ||
    `HTTP ${status}`;

  return detail;
}

export function withQuery(
  path: string,
  params?: Record<string, string | number | boolean | null | undefined>,
): string {
  if (!params) return path;
  const cleaned = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (cleaned.length === 0) return path;
  return `${path}?${new URLSearchParams(cleaned.map(([key, value]) => [key, String(value)])).toString()}`;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let body: BodyInit | undefined;
  if (options.body instanceof FormData) {
    body = options.body;
  } else if (typeof options.body === 'string' || options.body instanceof Blob) {
    body = options.body;
    if (typeof options.body === 'string' && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
  } else if (options.body !== undefined && options.body !== null) {
    body = JSON.stringify(options.body);
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
  }

  const resp = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
    body,
  });

  if (!resp.ok) {
    const payload = await resp.json().catch(() => null);

    // SEC-008：会话中途失效时，此前只弹一条裸英文 Unauthorized，既不清 token 也不跳登录，
    // 页面继续显示旧数据，用户会陷入"操作全失败但看起来还登录着"的死循环。
    if (resp.status === 401 && !AUTH_ENTRY_PATHS.some((p) => path.startsWith(p))) {
      if (shouldInvalidateSessionForRequest(token, getStoredToken())) {
        clearStoredToken();
        notifyUnauthorized();
        throw new Error('登录状态已失效，请重新登录');
      }
      // A response from an older token must not invalidate a newer login from
      // this tab or another tab. Preserve the ordinary request error instead.
      throw new Error(extractErrorMessage(payload, resp.statusText, resp.status));
    }

    throw new Error(extractErrorMessage(payload, resp.statusText, resp.status));
  }

  if (options.asText) {
    return (await resp.text()) as T;
  }

  return (await resp.json()) as T;
}
