import NextAuth from "next-auth"
import GitHub from "next-auth/providers/github"
import Google from "next-auth/providers/google"
import Credentials from "next-auth/providers/credentials"

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
      // For OAuth providers, auto-register with the API
      if (account && (account.provider === 'github' || account.provider === 'google')) {
        // Register or login via OAuth on our backend
        try {
          const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/v1/auth/oauth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              provider: account.provider,
              providerId: account.providerAccountId,
              email: token.email,
              name: token.name,
              avatar: token.picture,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            token.apiToken = data.token;
            token.tier = data.user.tier;
            token.userId = data.user.id;
            token.apiKey = data.apiKey;
          }
        } catch (e) {
          console.error('OAuth API registration failed:', e);
        }
      }
      return token;
    },
    async session({ session, token }) {
      (session as any).apiToken = token.apiToken;
      (session as any).tier = token.tier;
      (session as any).userId = token.userId;
      (session as any).apiKey = token.apiKey;
      return session;
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
});
