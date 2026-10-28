import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../auth/AuthContext.jsx';
import {
  firstAllowedPath,
  hasRoutePermission,
  permissionForPath,
} from '../lib/navigation.js';

// Client-side access gate for every routed page. It sits just inside Layout, so
// each navigation is checked against the current user's permissions: if the
// path needs a permission the user does not hold, they are bounced to the first
// page they ARE allowed to see (never left staring at a page they can't use).
//
// This mirrors the sidebar (both read ROUTE_PERMISSIONS), so a link the user
// cannot see is also a page they cannot reach by typing the URL or following an
// old bookmark. The server still enforces the real permission on every API
// call — this guard is the matching client behaviour, not a replacement for it.
function RequirePermission() {
  const { can } = useAuth();
  const location = useLocation();

  const needed = permissionForPath(location.pathname);
  if (!hasRoutePermission(can, needed)) {
    return <Navigate to={firstAllowedPath(can)} replace />;
  }
  return <Outlet />;
}

export default RequirePermission;
