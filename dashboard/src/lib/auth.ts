import NextAuth from "next-auth"
import GitHub from "next-auth/providers/github"
import Google from "next-auth/providers/google"
import Credentials from "next-auth/providers/credentials"

// ---------------------------------------------------------------------------
// Retry helper (server-side only — used inside jwt callback)
// ---------------------------------------------------------------------------

const AUTH_RETRY_DELAYS = [1000, 2000, 4000] as const;

/**
 * Fetch with retry and a per-attempt timeout (15 s).
 * Retries on network errors and HTTP 5xx.
 * Returns the Response (possibly non-ok) on client errors so the caller
 * can decide what to do.
 */
async function retryFetch(
  url: string,
  options: RequestInit,
  maxAttempts: number = 3
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    let res: Response | null = null;

    try {
      res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err;
    }

    if (res) {
      // 2xx/3xx or any 4xx → return immediately (no point retrying client errors)
      if (res.ok || (res.status >= 400 && res.status < 500)) {
        return res;
      }
      // 5xx on the last attempt → return it for the caller to handle
      if (attempt >= maxAttempts - 1) {
        return res;
      }
    } else if (attempt >= maxAttempts - 1) {
      // Last attempt was a network error — fall through to throw
      break;
    }

    // Wait before the next attempt
    const delay = AUTH_RETRY_DELAYS[attempt] ?? AUTH_RETRY_DELAYS[AUTH_RETRY_DELAYS.length - 1];
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  throw lastError instanceof Error ? lastError : new Error('OAuth API request failed after retries');
}

// ---------------------------------------------------------------------------
// NextAuth configuration
// ---------------------------------------------------------------------------

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID!,
      clientSecret: process.env.AUTH_GITHUB_SECRET!,
    }),
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
    }),
    Credentials({
      credentials: {
        email: {},
        password: {},
      },
      authorize: async (credentials) => {
        // Call WebPeel API to verify credentials
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(credentials),
        });
        if (!res.ok) return null;
        const data = await res.json();
        return { 
          id: data.user.id, 
          email: data.user.email,
          name: data.user.email,
          token: data.token,
          tier: data.user.tier,
        } as any;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, account }) {
      if (user) {
        token.apiToken = (user as any).token;
        token.tier = (user as any).tier;
        token.userId = user.id;
      }

      // Track the auth provider so the dashboard can detect OAuth users
      token.provider = account?.provider || token.provider || 'credentials';

      // For OAuth providers, auto-register / login with our backend
      if (account && (account.provider === 'github' || account.provider === 'google')) {
        // Send the OAuth token for server-side verification
        // GitHub: access_token, Google: id_token
        const accessToken = account.provider === 'github'
          ? account.access_token
          : account.id_token;

        // Save credentials in the encrypted JWT so we can retry if API is down
        token.oauthCredentials = {
          provider: account.provider,
          accessToken,
          name: token.name,
          avatar: token.picture,
        };

        try {
          const res = await retryFetch(
            `${process.env.NEXT_PUBLIC_API_URL}/v1/auth/oauth`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                provider: account.provider,
                accessToken,
                name: token.name,
                avatar: token.picture,
              }),
            }
          );

          if (res.ok) {
            const data = await res.json();
            token.apiToken = data.token;
            token.tier = data.user.tier;
            token.userId = data.user.id;
            token.apiKey = data.apiKey;
            // Success — clean up stored credentials
            delete token.oauthCredentials;
          } else {
            // Non-ok response even after retries (e.g. 5xx or unexpected 4xx)
            console.error('OAuth API registration returned non-ok status:', res.status);
            token.apiError = true;
          }
        } catch (e) {
          // Network error or timeout after all retries
          console.error('OAuth API registration failed after all retries:', e);
          token.apiError = true;
        }
      }

      // ---------------------------------------------------------------
      // Auto-recovery: retry API registration on subsequent session
      // checks when the initial sign-in failed due to API downtime.
      // Throttled to once per 30 seconds to avoid hammering.
      // ---------------------------------------------------------------
      if (token.apiError && token.oauthCredentials && !token.apiToken) {
        const now = Date.now();
        const lastRetry = (token.apiRetryAt as number) || 0;

        if (now - lastRetry > 30_000) {
          token.apiRetryAt = now;
          const creds = token.oauthCredentials as {
            provider: string;
            accessToken: string;
            name: string;
            avatar: string;
          };

          try {
            const res = await retryFetch(
              `${process.env.NEXT_PUBLIC_API_URL}/v1/auth/oauth`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(creds),
              },
              2 // fewer retries for background recovery
            );

            if (res.ok) {
              const data = await res.json();
              token.apiToken = data.token;
              token.tier = data.user.tier;
              token.userId = data.user.id;
              token.apiKey = data.apiKey;
              // Recovered — clear error state and stored credentials
              delete token.apiError;
              delete token.oauthCredentials;
              delete token.apiRetryAt;
              console.log('Auto-recovered API session for:', token.email);
            }
          } catch {
            // Still failing — will retry on next session check
          }
        }
      }

      return token;
    },

    async session({ session, token }) {
      (session as any).apiToken = token.apiToken;
      (session as any).tier = token.tier;
      (session as any).userId = token.userId;
      (session as any).apiKey = token.apiKey;
      (session as any).provider = token.provider;
      // Surface the error flag so the dashboard can show recovery UI
      (session as any).apiError = token.apiError ?? false;
      return session;
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
});
