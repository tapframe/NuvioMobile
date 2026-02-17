import React, { createContext, useContext, useEffect, useMemo, useState, useRef } from 'react';
import accountService, { AuthUser } from '../services/AccountService';

type AccountContextValue = {
  user: AuthUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  refreshCurrentUser: () => Promise<void>;
  updateProfile: (partial: { avatarUrl?: string; displayName?: string }) => Promise<string | null>;
};

const AccountContext = createContext<AccountContextValue | undefined>(undefined);

export const AccountProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const loadingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Initial user load
    const loadUser = async () => {
      try {
        const u = await accountService.getCurrentUser();
        setUser(u);
      } catch (error) {
        console.warn('[AccountContext] Failed to load user:', error);
      } finally {
        setLoading(false);
      }
    };

    loadUser();
  }, []);

  const value = useMemo<AccountContextValue>(() => ({
    user,
    loading,
    signIn: async (email: string, password: string) => {
      const { user: signedInUser, error } = await accountService.signInWithEmail(email, password);
      if (!error && signedInUser) {
        setUser(signedInUser);
      }
      return error || null;
    },
    signUp: async (email: string, password: string) => {
      const { user: signedUpUser, error } = await accountService.signUpWithEmail(email, password);
      if (!error && signedUpUser) {
        setUser(signedUpUser);
      }
      return error || null;
    },
    signOut: async () => {
      await accountService.signOut();
      setUser(null);
    },
    refreshCurrentUser: async () => {
      // Don't set loading if already loading to avoid conflicts
      if (loading) {
        if (__DEV__) console.log('[AccountContext] Already loading, skipping refresh');
        return;
      }

      if (__DEV__) console.log('[AccountContext] Starting refreshCurrentUser');
      setLoading(true);

      // Set a timeout to prevent loading from getting stuck
      loadingTimeoutRef.current = setTimeout(() => {
        console.warn('[AccountContext] Account loading timeout, forcing loading to false');
        setLoading(false);
      }, 5000); // Reduced to 5 seconds for faster fallback

      try {
        const u = await accountService.getCurrentUser();
        if (__DEV__) console.log('[AccountContext] refreshCurrentUser completed:', u ? 'user found' : 'no user');
        setUser(u);
      } catch (error) {
        console.error('[AccountContext] Failed to refresh current user:', error);
        // Still set user to null on error to ensure we don't get stuck
        setUser(null);
      } finally {
        if (loadingTimeoutRef.current) {
          clearTimeout(loadingTimeoutRef.current);
          loadingTimeoutRef.current = null;
        }
        setLoading(false);
        if (__DEV__) console.log('[AccountContext] refreshCurrentUser finished');
      }
    },
    updateProfile: async (partial) => {
      const err = await accountService.updateProfile(partial);
      if (!err) {
        // Refresh user from server to pick updated fields
        const u = await accountService.getCurrentUser();
        setUser(u);
      }
      return err;
    }
  }), [user, loading]);

  return (
    <AccountContext.Provider value={value}>
      {children}
    </AccountContext.Provider>
  );
};

export const useAccount = (): AccountContextValue => {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error('useAccount must be used within AccountProvider');
  return ctx;
};

export default AccountContext;
