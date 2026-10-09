import { useAuth } from '../../lib/use-auth';
import { Settings } from '../settings/page';
import { Navigate } from 'react-router-dom';

export function Admin() {
  const { user } = useAuth();
  if (user?.role !== 'admin') {
    return <Navigate to="/settings" replace />;
  }
  return <Settings mode="admin" />;
}
