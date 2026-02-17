import { mmkvStorage } from './mmkvStorage';
import { supabaseSyncService, SupabaseUser } from './supabaseSyncService';
import { logger } from '../utils/logger';

export type AuthUser = {
  id: string;
  email?: string;
  avatarUrl?: string;
  displayName?: string;
};

const USER_DATA_KEY = '@user:data';
const USER_SCOPE_KEY = '@user:current';
const EMAIL_CONFIRMATION_REQUIRED_PREFIX = '__EMAIL_CONFIRMATION__';

class AccountService {
  private static instance: AccountService;
  private constructor() {}

  static getInstance(): AccountService {
    if (!AccountService.instance) AccountService.instance = new AccountService();
    return AccountService.instance;
  }

  private mapSupabaseUser(user: SupabaseUser): AuthUser {
    return {
      id: user.id,
      email: user.email,
      displayName: user.user_metadata?.display_name as string | undefined,
      avatarUrl: user.user_metadata?.avatar_url as string | undefined,
    };
  }

  private async persistUser(user: AuthUser): Promise<void> {
    await mmkvStorage.setItem(USER_DATA_KEY, JSON.stringify(user));
    await mmkvStorage.setItem(USER_SCOPE_KEY, 'local');
  }

  async signUpWithEmail(email: string, password: string): Promise<{ user?: AuthUser; error?: string }> {
    const result = await supabaseSyncService.signUpWithEmail(email, password);
    if (result.error) {
      return { error: result.error };
    }

    const sessionUser = supabaseSyncService.getCurrentSessionUser();
    if (!sessionUser) {
      return {
        error: `${EMAIL_CONFIRMATION_REQUIRED_PREFIX}Account created. Check your email to verify, then sign in.`,
      };
    }

    const mapped = this.mapSupabaseUser(sessionUser);
    await this.persistUser(mapped);

    try {
      await supabaseSyncService.onSignUpPushAll();
    } catch (error) {
      logger.error('[AccountService] Sign-up push-all failed:', error);
    }

    return { user: mapped };
  }

  async signInWithEmail(email: string, password: string): Promise<{ user?: AuthUser; error?: string }> {
    const result = await supabaseSyncService.signInWithEmail(email, password);
    if (result.error || !result.user) {
      return { error: result.error || 'Sign in failed' };
    }

    const mapped = this.mapSupabaseUser(result.user);
    await this.persistUser(mapped);

    try {
      await supabaseSyncService.onSignInPullAll();
    } catch (error) {
      logger.error('[AccountService] Sign-in pull-all failed:', error);
    }

    return { user: mapped };
  }

  async signOut(): Promise<void> {
    await supabaseSyncService.signOut();
    await mmkvStorage.removeItem(USER_DATA_KEY);
    await mmkvStorage.setItem(USER_SCOPE_KEY, 'local');
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    try {
      await supabaseSyncService.initialize();
      const sessionUser = supabaseSyncService.getCurrentSessionUser();
      if (sessionUser) {
        const mapped = this.mapSupabaseUser(sessionUser);
        await this.persistUser(mapped);
        return mapped;
      }

      const userData = await mmkvStorage.getItem(USER_DATA_KEY);
      if (!userData) return null;
      return JSON.parse(userData);
    } catch {
      return null;
    }
  }

  async updateProfile(partial: { avatarUrl?: string; displayName?: string }): Promise<string | null> {
    try {
      const currentUser = await this.getCurrentUser();
      if (!currentUser) return 'Not authenticated';

      const updatedUser = { ...currentUser, ...partial };
      await mmkvStorage.setItem(USER_DATA_KEY, JSON.stringify(updatedUser));
      return null;
    } catch {
      return 'Failed to update profile';
    }
  }

  async getCurrentUserIdScoped(): Promise<string> {
    const user = await this.getCurrentUser();
    if (user?.id) return user.id;
    // Guest scope
    const scope = (await mmkvStorage.getItem(USER_SCOPE_KEY)) || 'local';
    if (!scope) await mmkvStorage.setItem(USER_SCOPE_KEY, 'local');
    return scope || 'local';
  }
}

export const accountService = AccountService.getInstance();
export default accountService;
