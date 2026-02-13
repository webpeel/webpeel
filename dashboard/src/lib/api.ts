const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://webpeel-api.onrender.com';

export async function apiClient<T>(
  path: string,
  options: RequestInit & { token?: string } = {}
): Promise<T> {
  const { token, ...fetchOptions } = options;
  const res = await fetch(`${API_URL}${path}`, {
    ...fetchOptions,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...fetchOptions.headers,
    },
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `API error: ${res.status}`);
  }
  return res.json();
}

// Type definitions for API responses
export interface Usage {
  current_session: {
    used: number;
    limit: number;
    resets_in: string;
  };
  weekly: {
    all_fetches: { used: number; limit: number };
    captcha_solves: { used: number; limit: number };
    resets_at: string;
  };
  extra_usage: {
    enabled: boolean;
    spent: number;
    limit: number;
    balance: number;
    auto_reload: boolean;
  };
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used?: string;
  status: 'active' | 'revoked';
}

export interface User {
  id: string;
  email: string;
  tier: 'free' | 'pro' | 'max';
  created_at: string;
}
