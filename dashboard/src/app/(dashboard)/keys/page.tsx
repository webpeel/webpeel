'use client';

import { useSession } from 'next-auth/react';
import useSWR from 'swr';
import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Plus, Trash2, AlertTriangle, AlertCircle, Key, Copy, CheckCircle2, ChevronDown, ChevronUp, Globe, Pencil, X, Check } from 'lucide-react';
import { apiClient, ApiKey } from '@/lib/api';
import { toast } from 'sonner';
import { CopyButton } from '@/components/copy-button';
import { ApiErrorBanner } from '@/components/api-error-banner';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.webpeel.dev';

const fetcher = async <T,>(url: string, token: string): Promise<T> => {
  return apiClient<T>(url, { token });
};

function CurlExample({ keyPrefix }: { keyPrefix: string }) {
  const [expanded, setExpanded] = useState(false);
  const curlCmd = `curl "${API_URL}/v1/fetch?url=https://example.com" \\
  -H "Authorization: Bearer ${keyPrefix}..."`;

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600 transition-colors"
      >
        <Globe className="h-3 w-3" />
        {expanded ? 'Hide' : 'Show'} example
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {expanded && (
        <div className="mt-2 relative">
          <pre className="p-3 bg-zinc-900 text-zinc-100 rounded-lg text-xs overflow-x-auto pr-16">
            <code>{curlCmd}</code>
          </pre>
          <div className="absolute top-2 right-2">
            <CopyButton text={curlCmd} size="sm" variant="ghost" />
          </div>
        </div>
      )}
    </div>
  );
}

export default function ApiKeysPage() {
  const { data: session, status } = useSession();
  const token = (session as any)?.apiToken as string | undefined;

  const { data, isLoading, error, mutate } = useSWR<{ keys: ApiKey[] }>(
    token ? ['/v1/keys', token] : null,
    ([url, token]: [string, string]) => fetcher<{ keys: ApiKey[] }>(url, token)
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyExpiry, setNewKeyExpiry] = useState<string>('never');
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [newKeyKeyCopied, setNewKeyKeyCopied] = useState(false);

  // Banner dismiss
  const [bannerDismissed, setBannerDismissed] = useState(false);
  useEffect(() => {
    if (localStorage.getItem('webpeel-keys-banner-dismissed') === 'true') {
      setBannerDismissed(true);
    }
  }, []);
  const handleDismissBanner = () => {
    localStorage.setItem('webpeel-keys-banner-dismissed', 'true');
    setBannerDismissed(true);
  };

  // Inline key rename
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [saving, setSaving] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);

  const startEdit = (id: string, currentName: string) => {
    setEditingId(id);
    setEditingName(currentName);
    setTimeout(() => editInputRef.current?.focus(), 50);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingName('');
  };

  const saveEdit = async (id: string) => {
    if (!editingName.trim()) { cancelEdit(); return; }
    setSaving(true);
    try {
      await apiClient(`/v1/keys/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: editingName.trim() }),
        token,
      });
      mutate();
      toast.success('Key renamed');
      cancelEdit();
    } catch (err: any) {
      toast.error(err.message || 'Failed to rename key');
    } finally {
      setSaving(false);
    }
  };

  // Compute preview date for selected expiry option
  const expiryPreviewDate = (() => {
    if (newKeyExpiry === 'never') return null;
    const now = new Date();
    const map: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };
    const days = map[newKeyExpiry];
    if (!days) return null;
    const d = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  })();

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  if (error) return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <AlertCircle className="h-8 w-8 text-red-500 mb-3" />
      <p className="text-sm text-muted-foreground mb-3">Failed to load data. Please try again.</p>
      <Button variant="outline" size="sm" onClick={() => mutate()}>Retry</Button>
    </div>
  );

  if (status === 'authenticated' && !token) {
    return (
      <div className="mx-auto max-w-6xl">
        <ApiErrorBanner
          title="API Connection Issue"
          message="We couldn't connect your account to the WebPeel API. This can happen if the API was temporarily unavailable during sign-in. Please sign out and try again."
        />
      </div>
    );
  }

  const handleCreate = async () => {
    if (!newKeyName.trim()) {
      toast.error('Please enter a key name');
      return;
    }
    setCreating(true);
    try {
      const result = await apiClient<{ key: string; id: string }>('/v1/keys', {
        method: 'POST',
        body: JSON.stringify({ name: newKeyName, expiresIn: newKeyExpiry }),
        token,
      });
      setNewKey(result.key);
      setNewKeyName('');
      setNewKeyExpiry('never');
      mutate();
      toast.success('API key created successfully');
    } catch (error: any) {
      toast.error(error.message || 'Failed to create key');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleting(true);
    try {
      await apiClient(`/v1/keys/${id}`, { method: 'DELETE', token });
      mutate();
      setDeleteId(null);
      toast.success('API key revoked');
    } catch (error: any) {
      toast.error(error.message || 'Failed to revoke key');
    } finally {
      setDeleting(false);
    }
  };

  const handleCopyNewKey = () => {
    if (newKey) {
      navigator.clipboard.writeText(newKey);
      setNewKeyKeyCopied(true);
      toast.success('Key copied to clipboard!');
      setTimeout(() => setNewKeyKeyCopied(false), 2000);
    }
  };

  const closeCreateDialog = () => {
    setCreateOpen(false);
    setNewKey(null);
    setNewKeyName('');
    setNewKeyExpiry('never');
    setNewKeyKeyCopied(false);
  };

  const keys = data?.keys || [];
  const activeKeys = keys.filter((k) => k.isActive && !k.isExpired);

  // Keys expiring within 7 days (for warning banner)
  const expiringKeys = keys.filter((k) => {
    if (!k.isActive || !k.expiresAt || k.isExpired) return false;
    const daysLeft = (new Date(k.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    return daysLeft <= 7;
  });

  // Expiry badge renderer
  function ExpiryBadge({ apiKey }: { apiKey: typeof keys[0] }) {
    if (!apiKey.expiresAt) {
      return <span className="text-sm text-zinc-400 italic">Never</span>;
    }
    if (apiKey.isExpired) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 line-through">
          Expired
        </span>
      );
    }
    const daysLeft = (new Date(apiKey.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    const colorClass = daysLeft > 30
      ? 'bg-green-100 text-green-700'
      : daysLeft > 7
      ? 'bg-yellow-100 text-yellow-700'
      : 'bg-red-100 text-red-700';
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colorClass}`}>
        {apiKey.expiresIn}
      </span>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 md:space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
            <Key className="h-7 w-7 text-zinc-800" />
            API Keys
          </h1>
          <p className="text-sm md:text-base text-muted-foreground mt-1">
            Manage access credentials for the WebPeel API
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 bg-[#5865F2] hover:bg-[#4752C4] w-full sm:w-auto">
              <Plus className="h-4 w-4" />
              Create New Key
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-[90vw] sm:max-w-[460px]">
            <DialogHeader>
              <DialogTitle>
                {newKey ? (
                  <span className="flex items-center gap-2 text-amber-700">
                    <AlertTriangle className="h-5 w-5" />
                    Save your API key now!
                  </span>
                ) : 'Create API Key'}
              </DialogTitle>
              <DialogDescription>
                {newKey
                  ? 'This key will not be shown again. Copy and store it somewhere safe.'
                  : 'Give your key a descriptive name (e.g., "Production", "Local Dev")'}
              </DialogDescription>
            </DialogHeader>

            {newKey ? (
              <div className="space-y-4">
                {/* Key display */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 p-3 bg-zinc-50 border-2 border-zinc-200 rounded-lg">
                    <code className="flex-1 text-xs sm:text-sm font-mono break-all text-zinc-800">{newKey}</code>
                    <button
                      onClick={handleCopyNewKey}
                      className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                        newKeyKeyCopied
                          ? 'bg-emerald-600 text-white'
                          : 'bg-[#5865F2] hover:bg-[#4752C4] text-white'
                      }`}
                    >
                      {newKeyKeyCopied ? (
                        <><CheckCircle2 className="h-3.5 w-3.5" /> Copied!</>
                      ) : (
                        <><Copy className="h-3.5 w-3.5" /> Copy</>
                      )}
                    </button>
                  </div>
                  {!newKeyKeyCopied && (
                    <p className="text-xs text-amber-700 font-medium">
                      👆 Copy this key before closing — it cannot be recovered!
                    </p>
                  )}
                </div>

                {/* Where to store it */}
                <div className="p-3 bg-zinc-50 rounded-lg border border-zinc-200 space-y-1.5">
                  <p className="text-xs font-semibold text-zinc-700">Store it safely:</p>
                  <ul className="text-xs text-zinc-600 space-y-1 list-disc list-inside">
                    <li>Add to <code className="bg-zinc-200 px-1 rounded">.env</code> as <code className="bg-zinc-200 px-1 rounded">WEBPEEL_API_KEY</code></li>
                    <li>Save in 1Password, Bitwarden, or similar</li>
                    <li>Never commit to Git or share publicly</li>
                  </ul>
                </div>

                {/* Curl example with the new key */}
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-zinc-700">Try it right now:</p>
                  <div className="relative">
                    <pre className="p-3 bg-zinc-900 text-zinc-100 rounded-lg text-xs overflow-x-auto pr-12">
                      <code>{`curl "${API_URL}/v1/fetch?url=https://example.com" \\\n  -H "Authorization: Bearer ${newKey}"`}</code>
                    </pre>
                    <div className="absolute top-2 right-2">
                      <CopyButton
                        text={`curl "${API_URL}/v1/fetch?url=https://example.com" \\\n  -H "Authorization: Bearer ${newKey}"`}
                        size="sm"
                        variant="ghost"
                      />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="key-name">Key Name</Label>
                  <Input
                    id="key-name"
                    placeholder="e.g., Production, Local Dev, My Script"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="key-expiry">Expiration</Label>
                  <select
                    id="key-expiry"
                    value={newKeyExpiry}
                    onChange={(e) => setNewKeyExpiry(e.target.value)}
                    className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#5865F2] focus:border-transparent"
                  >
                    <option value="never">Never</option>
                    <option value="7d">7 days</option>
                    <option value="30d">30 days</option>
                    <option value="90d">90 days</option>
                    <option value="1y">1 year</option>
                  </select>
                  {expiryPreviewDate && (
                    <p className="text-xs text-zinc-500">
                      Key will expire on <strong>{expiryPreviewDate}</strong>
                    </p>
                  )}
                </div>
                <p className="text-xs text-zinc-500">
                  Use descriptive names to identify where each key is used.
                </p>
              </div>
            )}

            <DialogFooter className="flex-col sm:flex-row gap-2">
              {newKey ? (
                <Button
                  onClick={closeCreateDialog}
                  className={`w-full sm:w-auto ${newKeyKeyCopied ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-[#5865F2] hover:bg-[#4752C4]'}`}
                >
                  {newKeyKeyCopied ? '✓ Done' : "I've saved my key"}
                </Button>
              ) : (
                <>
                  <Button variant="outline" onClick={() => setCreateOpen(false)} className="w-full sm:w-auto">
                    Cancel
                  </Button>
                  <Button
                    onClick={handleCreate}
                    disabled={creating || !newKeyName.trim()}
                    className="w-full sm:w-auto bg-[#5865F2] hover:bg-[#4752C4] text-white"
                  >
                    {creating ? 'Creating...' : 'Create Key'}
                  </Button>
                </>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Expiring-soon warning banner */}
      {expiringKeys.length > 0 && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-lg border border-yellow-300 bg-yellow-50">
          <AlertTriangle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            {expiringKeys.map((k) => (
              <p key={k.id} className="text-sm text-yellow-800">
                <strong>{k.name}</strong> {k.expiresIn}. Rotate it to avoid service disruption.
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Security Warning */}
      {!bannerDismissed && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="flex items-start gap-3 pt-4 md:pt-6 relative">
            <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="space-y-1 flex-1">
              <p className="text-sm font-medium text-amber-900">Keep your keys secure</p>
              <p className="text-xs sm:text-sm text-amber-700">
                API keys are shown only once when created. Store them in environment variables or a password manager, never in source code.
              </p>
            </div>
            <button
              onClick={handleDismissBanner}
              className="absolute top-3 right-3 p-1 rounded-md text-amber-500 hover:text-amber-700 hover:bg-amber-100 transition-colors"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </CardContent>
        </Card>
      )}

      {/* Keys Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg md:text-xl">Your API Keys</CardTitle>
          <CardDescription className="text-sm">
            {isLoading ? 'Loading...' : `${activeKeys.length} active ${activeKeys.length === 1 ? 'key' : 'keys'}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-lg bg-zinc-100" />
              ))}
            </div>
          ) : keys.length > 0 ? (
            <>
              {/* Mobile: Card view */}
              <div className="space-y-3 md:hidden">
                {keys.map((key) => (
                  <div
                    key={key.id}
                    className={`border rounded-lg p-4 space-y-3 ${key.isActive && !key.isExpired ? 'border-l-4 border-l-zinc-900' : 'opacity-60'}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        {editingId === key.id ? (
                          <div className="flex items-center gap-1 mb-1">
                            <input
                              ref={editInputRef}
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveEdit(key.id);
                                if (e.key === 'Escape') cancelEdit();
                              }}
                              onBlur={() => saveEdit(key.id)}
                              className="flex-1 text-sm font-medium border border-zinc-300 rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-[#5865F2]"
                              disabled={saving}
                            />
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 mb-1">
                            <p className="font-medium text-sm truncate">{key.name}</p>
                            {key.isActive && (
                              <button onClick={() => startEdit(key.id, key.name)} className="p-0.5 text-zinc-400 hover:text-zinc-700 transition-colors flex-shrink-0">
                                <Pencil className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        )}
                        <div className="flex items-center gap-1">
                          <code className="text-xs text-muted-foreground">{key.prefix}...</code>
                          <button
                            onClick={() => { navigator.clipboard.writeText(key.prefix + '...'); toast.success('Prefix copied'); }}
                            className="p-0.5 text-zinc-400 hover:text-zinc-600 transition-colors"
                            title="Copy prefix"
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                      <Badge variant={key.isActive ? 'default' : 'secondary'} className={`text-xs ${key.isExpired ? 'bg-red-100 text-red-700 border-0' : ''}`}>
                        {key.isExpired ? 'expired' : key.isActive ? 'active' : 'revoked'}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                      <div>
                        <span className="block text-zinc-400">Created</span>
                        {new Date(key.createdAt).toLocaleDateString()}
                      </div>
                      <div>
                        <span className="block text-zinc-400">Last Used</span>
                        {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : 'Never'}
                      </div>
                      <div className="col-span-2">
                        <span className="block text-zinc-400 mb-1">Expires</span>
                        <ExpiryBadge apiKey={key} />
                      </div>
                    </div>
                    {key.isActive && <CurlExample keyPrefix={key.prefix} />}
                    {key.isActive && (
                      <Dialog open={deleteId === key.id} onOpenChange={(open) => !open && setDeleteId(null)}>
                        <DialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50 w-full"
                            onClick={() => setDeleteId(key.id)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Revoke Key
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-[90vw] sm:max-w-[425px]">
                          <DialogHeader>
                            <DialogTitle>Revoke API Key</DialogTitle>
                            <DialogDescription>
                              Are you sure you want to revoke "{key.name}"? Any app using this key will lose access immediately.
                            </DialogDescription>
                          </DialogHeader>
                          <DialogFooter className="flex-col sm:flex-row gap-2">
                            <Button variant="outline" onClick={() => setDeleteId(null)} className="w-full sm:w-auto">Cancel</Button>
                            <Button variant="destructive" onClick={() => handleDelete(key.id)} disabled={deleting} className="w-full sm:w-auto">
                              {deleting ? 'Revoking...' : 'Revoke Key'}
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    )}
                  </div>
                ))}
              </div>

              {/* Desktop: Table view */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Key Prefix</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Last Used</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {keys.map((key) => (
                      <TableRow key={key.id} className={`group ${!key.isActive || key.isExpired ? 'opacity-60' : ''}`}>
                        <TableCell>
                          <div>
                            {editingId === key.id ? (
                              <div className="flex items-center gap-1 mb-1">
                                <input
                                  ref={editInputRef}
                                  value={editingName}
                                  onChange={(e) => setEditingName(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') saveEdit(key.id);
                                    if (e.key === 'Escape') cancelEdit();
                                  }}
                                  onBlur={() => saveEdit(key.id)}
                                  className="flex-1 text-sm font-medium border border-zinc-300 rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-[#5865F2]"
                                  disabled={saving}
                                />
                                <button onClick={cancelEdit} className="p-0.5 text-zinc-400 hover:text-zinc-600"><X className="h-3.5 w-3.5" /></button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1 mb-0.5">
                                <p className="font-medium text-sm">{key.name}</p>
                                {key.isActive && (
                                  <button onClick={() => startEdit(key.id, key.name)} className="p-0.5 text-zinc-400 hover:text-zinc-700 transition-colors opacity-0 group-hover:opacity-100">
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            )}
                            {key.isActive && <CurlExample keyPrefix={key.prefix} />}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <code className="text-sm bg-zinc-100 px-2 py-0.5 rounded">{key.prefix}...</code>
                            <button
                              onClick={() => { navigator.clipboard.writeText(key.prefix + '...'); toast.success('Prefix copied'); }}
                              className="p-0.5 text-zinc-400 hover:text-zinc-600 transition-colors opacity-0 group-hover:opacity-100"
                              title="Copy prefix"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(key.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : (
                            <span className="text-zinc-400 italic">Never</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <ExpiryBadge apiKey={key} />
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={key.isActive ? 'default' : 'secondary'}
                            className={key.isActive && !key.isExpired ? 'bg-emerald-100 text-emerald-700 border-0' : ''}
                          >
                            {key.isExpired ? 'expired' : key.isActive ? 'active' : 'revoked'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {key.isActive && (
                            <Dialog open={deleteId === key.id} onOpenChange={(open) => !open && setDeleteId(null)}>
                              <DialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                  onClick={() => setDeleteId(key.id)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>Revoke API Key</DialogTitle>
                                  <DialogDescription>
                                    Are you sure you want to revoke "{key.name}"? Any app using this key will lose access immediately. This action cannot be undone.
                                  </DialogDescription>
                                </DialogHeader>
                                <DialogFooter>
                                  <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
                                  <Button variant="destructive" onClick={() => handleDelete(key.id)} disabled={deleting}>
                                    {deleting ? 'Revoking...' : 'Revoke Key'}
                                  </Button>
                                </DialogFooter>
                              </DialogContent>
                            </Dialog>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 px-4">
              <div className="w-16 h-16 rounded-full bg-zinc-100 flex items-center justify-center mb-4">
                <Key className="h-8 w-8 text-zinc-800" />
              </div>
              <h3 className="text-lg font-semibold text-zinc-900 mb-2">No API keys yet</h3>
              <p className="text-sm text-zinc-500 text-center mb-4 max-w-md">
                Create your first API key to start making requests to the WebPeel API.
              </p>
              <Button onClick={() => setCreateOpen(true)} className="bg-[#5865F2] hover:bg-[#4752C4] gap-2">
                <Plus className="h-4 w-4" />
                Create your first key
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Usage reminder */}
      {activeKeys.length > 0 && (
        <Card className="border-zinc-200 bg-zinc-50">
          <CardContent className="flex items-start gap-3 pt-4 md:pt-6">
            <Globe className="h-5 w-5 text-zinc-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-zinc-700">API Endpoint</p>
              <code className="text-xs text-zinc-500 font-mono">{API_URL}/v1/fetch</code>
              <p className="text-xs text-zinc-400 mt-1">
                Pass your API key as <code className="bg-zinc-200 px-1 rounded">Authorization: Bearer YOUR_KEY</code>
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
