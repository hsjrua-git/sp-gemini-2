import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { changePassword, fetchMe, login, logout } from '../api/auth.js';
import { AuthContext } from './AuthContext.jsx';

// Holds the signed-in user (from the `me` query) and the login/logout/
// change-password mutations, and exposes a `can(permission)` helper. The
// context object and the useAuth() hook live in AuthContext.jsx; keeping the
// provider component in its own file is what lets Fast Refresh work cleanly.
export function AuthProvider({ children }) {
  const queryClient = useQueryClient();

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: fetchMe,
    retry: false,
    // Re-check who we are (and what we're allowed to do) whenever the user
    // returns to the tab. The global default turns this off, but the identity
    // query is the exception: if an admin changes this user's role or
    // permissions, refetching on focus makes the sidebar, page access, and
    // landing reflect it on the next glance instead of only after a full
    // re-login. The route guard then bounces them off any page they just lost.
    refetchOnWindowFocus: true,
  });
  const user = meQuery.data ?? null;

  function forgetEverythingExceptMe() {
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] !== 'me',
    });
  }

  const loginMutation = useMutation({
    mutationFn: login,
    onSuccess: (signedInUser) => {
      forgetEverythingExceptMe();
      queryClient.setQueryData(['me'], signedInUser);
    },
  });

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSettled: () => {
      forgetEverythingExceptMe();
      queryClient.setQueryData(['me'], null);
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: changePassword,
    onSuccess: (updatedUser) => {
      queryClient.setQueryData(['me'], updatedUser);
    },
  });

  const value = {
    user,
    isLoading: meQuery.isPending,
    loadError: meQuery.isError ? meQuery.error : null,
    can: (permission) =>
      user !== null &&
      Array.isArray(user.permissions) &&
      user.permissions.includes(permission),
    login: loginMutation,
    logout: logoutMutation,
    changePassword: changePasswordMutation,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
