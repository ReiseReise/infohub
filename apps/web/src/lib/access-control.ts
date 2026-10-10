export function isAdminRole(role?: string | null): boolean {
  return role === 'admin';
}

export function adminRouteTarget(role?: string | null): '/admin' | '/feed' {
  return isAdminRole(role) ? '/admin' : '/feed';
}
