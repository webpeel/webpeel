const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.webpeel.dev';

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
  plan: {
    tier: string;
    weeklyLimit: number;
    burstLimit: number;
  };
  session: {
    burstUsed: number;
    burstLimit: number;
    resetsIn: string;
    percentUsed: number;
  };
  weekly: {
    week: string;
    basicUsed: number;
    stealthUsed: number;
    searchUsed: number;
    totalUsed: number;
    totalAvailable: number;
    rolloverCredits: number;
    remaining: number;
    percentUsed: number;
    resetsAt: string;
  };
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  isActive: boolean;
  createdAt: string;
  lastUsedAt?: string;
}

export interface User {
  id: string;
  email: string;
  tier: 'free' | 'pro' | 'max';
  created_at: string;
}
