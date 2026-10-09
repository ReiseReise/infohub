// SEC-008：api/shared.ts 是纯模块，拿不到 router 的 navigate。
// 这里做一个极小的订阅点：请求层发现 401 就广播，AuthProvider 订阅后清空会话状态，
// 再由 App.tsx 既有的 RequireAuth 完成跳转（它会自动带上 state.from 用于回跳）。
type UnauthorizedHandler = () => void;

let handler: UnauthorizedHandler | null = null;

export function registerUnauthorizedHandler(next: UnauthorizedHandler | null): void {
  handler = next;
}

export function notifyUnauthorized(): void {
  handler?.();
}
