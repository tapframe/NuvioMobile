import * as WebBrowser from 'expo-web-browser';
import * as Crypto from 'expo-crypto';
import { mmkvStorage } from '../mmkvStorage';
import { MalToken } from '../../types/mal';

const CLIENT_ID = '4631b11b52008b79c9a05d63996fc5f8';
const REDIRECT_URI = 'nuvio://auth';

const KEYS = {
  ACCESS: 'mal_access_token',
  REFRESH: 'mal_refresh_token',
  EXPIRES: 'mal_expires_in',
  CREATED: 'mal_created_at',
};

const discovery = {
  authorizationEndpoint: 'https://myanimelist.net/v1/oauth2/authorize',
  tokenEndpoint: 'https://myanimelist.net/v1/oauth2/token',
};

class MalAuthService {
  private static instance: MalAuthService;
  private token: MalToken | null = null;
  private isAuthenticating = false;

  private constructor() {}

  static getInstance() {
    if (!MalAuthService.instance) {
      MalAuthService.instance = new MalAuthService();
    }
    return MalAuthService.instance;
  }

  getToken(): MalToken | null {
    if (!this.token) {
      const access = mmkvStorage.getString(KEYS.ACCESS);
      if (access) {
        this.token = {
          accessToken: access,
          refreshToken: mmkvStorage.getString(KEYS.REFRESH) || '',
          expiresIn: mmkvStorage.getNumber(KEYS.EXPIRES) || 0,
          createdAt: mmkvStorage.getNumber(KEYS.CREATED) || 0,
        };
      }
    }
    return this.token;
  }

  isAuthenticated(): boolean {
    return this.getToken() !== null;
  }

  saveToken(token: MalToken) {
    this.token = token;
    mmkvStorage.setString(KEYS.ACCESS, token.accessToken);
    mmkvStorage.setString(KEYS.REFRESH, token.refreshToken);
    mmkvStorage.setNumber(KEYS.EXPIRES, token.expiresIn);
    mmkvStorage.setNumber(KEYS.CREATED, token.createdAt);
  }

  clearToken() {
    this.token = null;
    mmkvStorage.delete(KEYS.ACCESS);
    mmkvStorage.delete(KEYS.REFRESH);
    mmkvStorage.delete(KEYS.EXPIRES);
    mmkvStorage.delete(KEYS.CREATED);
  }

  isTokenExpired(token: MalToken): boolean {
    const now = Date.now();
    const expiryTime = token.createdAt + (token.expiresIn * 1000);
    // Buffer of 5 minutes
    return now > (expiryTime - 300000);
  }

  private generateCodeVerifier(): string {
    const length = 128;
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    let result = '';
    const randomBytes = Crypto.getRandomBytes(length);
    for (let i = 0; i < length; i++) {
      result += charset[randomBytes[i] % charset.length];
    }
    return result;
  }

  private async exchangeToken(code: string, codeVerifier: string, uri: string) {
    console.log(`[MalAuth] Attempting token exchange with redirect_uri: '${uri}'`);
    const params = new URLSearchParams();
    params.append('client_id', CLIENT_ID);
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', uri);
    params.append('code_verifier', codeVerifier);

    const response = await fetch(discovery.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Nuvio-Mobile-App',
      },
      body: params.toString(),
    });

    // Handle non-JSON responses safely
    const text = await response.text();
    const data = (() => { try { return JSON.parse(text); } catch { return { message: text }; } })();

    if (!response.ok) {
      const error: any = new Error(data.message || 'Token exchange failed');
      error.response = { data };
      // Attach specific error fields if available for easier checking
      error.malError = data.error;
      throw error;
    }
    return data;
  }

  async login(): Promise<boolean | string> {
    if (this.isAuthenticating) return 'Authentication already in progress';
    this.isAuthenticating = true;

    try {
      console.log('[MalAuth] Starting login with redirectUri:', REDIRECT_URI);

      const codeVerifier = this.generateCodeVerifier();
      const state = this.generateCodeVerifier().substring(0, 20); // Simple random state

      const params = new URLSearchParams({
        response_type: 'code',
        client_id: CLIENT_ID,
        state: state,
        code_challenge: codeVerifier,
        code_challenge_method: 'plain',
        redirect_uri: REDIRECT_URI,
        scope: 'user_read write_share', // space separated
      });

      const authUrl = `${discovery.authorizationEndpoint}?${params.toString()}`;

      const result = await WebBrowser.openAuthSessionAsync(authUrl, REDIRECT_URI, {
        showInRecents: true,
      });
      
      console.log('[MalAuth] Auth prompt result:', result.type);

      if (result.type === 'success' && result.url) {
        // Parse code from URL
        const urlObj = new URL(result.url);
        const code = urlObj.searchParams.get('code');
        const returnedState = urlObj.searchParams.get('state');

        if (!code) {
          return 'No authorization code received';
        }
        
        // Optional: verify state if you want strict security, though MAL state is optional
        // if (returnedState !== state) console.warn('State mismatch');

        console.log('[MalAuth] Success! Code received.');

        try {
          console.log('[MalAuth] Exchanging code for token...');
          const data = await this.exchangeToken(code, codeVerifier, REDIRECT_URI);
          
          if (data.access_token) {
            console.log('[MalAuth] Token exchange successful');
            this.saveToken({
              accessToken: data.access_token,
              refreshToken: data.refresh_token,
              expiresIn: data.expires_in,
              createdAt: Date.now(),
            });
            return true;
          }
        } catch (e: any) {
          // Normalize error data
          const errorData = e.response?.data || (e instanceof Error ? { message: e.message, error: (e as any).malError } : e);
          console.error('[MalAuth] First Token Exchange Failed:', JSON.stringify(errorData));
          
          // Retry with trailing slash if invalid_grant
          if (errorData.error === 'invalid_grant' || (errorData.message && errorData.message.includes('redirection URI'))) {
              const retryUri = REDIRECT_URI + '/';
              console.log(`[MalAuth] Retrying with trailing slash: '${retryUri}'`);
              try {
                  const data = await this.exchangeToken(code, codeVerifier, retryUri);
                  if (data.access_token) {
                    console.log('[MalAuth] Retry Token exchange successful');
                    this.saveToken({
                      accessToken: data.access_token,
                      refreshToken: data.refresh_token,
                      expiresIn: data.expires_in,
                      createdAt: Date.now(),
                    });
                    return true;
                  }
              } catch (retryError: any) {
                   const retryErrorData = retryError.response?.data || (retryError instanceof Error ? { message: retryError.message, error: (retryError as any).malError } : retryError);
                   console.error('[MalAuth] Retry Token Exchange Also Failed:', JSON.stringify(retryErrorData));
                   return `MAL Error: ${retryErrorData.error || 'unknown'} - ${retryErrorData.message || 'No description'}`;
              }
          }

          if (errorData) {
            return `MAL Error: ${errorData.error || 'unknown'} - ${errorData.message || errorData.error_description || 'No description'}`;
          }
          return `Network Error: ${e.message}`;
        }
      } else if (result.type === 'cancel' || result.type === 'dismiss') {
        return 'Login cancelled';
      }
      
      return false;
    } catch (e: any) {
      console.error('[MalAuth] Login Exception', e);
      return `Login Exception: ${e.message}`;
    } finally {
      this.isAuthenticating = false;
    }
  }

  async refreshToken(): Promise<boolean> {
    const token = this.getToken();
    if (!token || !token.refreshToken) return false;

    try {
      const body = new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: token.refreshToken,
      }).toString();

      const response = await fetch(discovery.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      });

      const data = await response.json();

      if (data.access_token) {
        this.saveToken({
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresIn: data.expires_in,
          createdAt: Date.now(),
        });
        return true;
      }
    } catch (e) {
      console.error('MAL Token Refresh Error', e);
    }
    return false;
  }
}

export const MalAuth = MalAuthService.getInstance();
