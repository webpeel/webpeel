'use client';

import { useSession } from 'next-auth/react';
import useSWR from 'swr';
import { useState } from 'react';
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
import { Plus, Trash2, AlertTriangle } from 'lucide-react';
import { apiClient, ApiKey } from '@/lib/api';
import { toast } from 'sonner';
import { CopyButton } from '@/components/copy-button';

const fetcher = async <T,>(url: string, token: string): Promise<T> => {
  return apiClient<T>(url, { token });
};

export default function ApiKeysPage() {
  const { data: session } = useSession();
  const token = (session as any)?.apiToken;

  const { data, isLoading, mutate } = useSWR<{ keys: ApiKey[] }>(
    token ? ['/v1/keys', token] : null,
    ([url, token]: [string, string]) => fetcher<{ keys: ApiKey[] }>(url, token)
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleCreate = async () => {
    if (!newKeyName.trim()) {
      toast.error('Please enter a key name');
      return;
    }

    setCreating(true);
    try {
      const result = await apiClient<{ key: string; id: string }>('/v1/keys', {
        method: 'POST',
        body: JSON.stringify({ name: newKeyName }),
        token,
      });
      setNewKey(result.key);
      setNewKeyName('');
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
      await apiClient(`/v1/keys/${id}`, {
        method: 'DELETE',
        token,
      });
      mutate();
      setDeleteId(null);
      toast.success('API key revoked');
    } catch (error: any) {
      toast.error(error.message || 'Failed to revoke key');
    } finally {
      setDeleting(false);
    }
  };

  const closeCreateDialog = () => {
    setCreateOpen(false);
    setNewKey(null);
    setNewKeyName('');
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 md:space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">API Keys</h1>
          <p className="text-sm md:text-base text-muted-foreground">Manage your WebPeel API keys</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 bg-violet-600 hover:bg-violet-700 w-full sm:w-auto">
              <Plus className="h-4 w-4" />
              Create New Key
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-[90vw] sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Create API Key</DialogTitle>
              <DialogDescription>
                {newKey ? 'Save this key now — it will not be shown again!' : 'Choose a name for your new API key'}
              </DialogDescription>
            </DialogHeader>
            {newKey ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 p-3 bg-zinc-50 border rounded-lg">
                  <code className="flex-1 text-xs sm:text-sm font-mono break-all">{newKey}</code>
                  <CopyButton text={newKey} />
                </div>
                <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs sm:text-sm text-amber-800">
                    Make sure to copy your API key now. You won't be able to see it again!
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="key-name">Key Name</Label>
                  <Input
                    id="key-name"
                    placeholder="e.g., Production API Key"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                  />
                </div>
              </div>
            )}
            <DialogFooter className="flex-col sm:flex-row gap-2">
              {newKey ? (
                <Button onClick={closeCreateDialog} className="w-full sm:w-auto">Done</Button>
              ) : (
                <>
                  <Button variant="outline" onClick={() => setCreateOpen(false)} className="w-full sm:w-auto">
                    Cancel
                  </Button>
                  <Button onClick={handleCreate} disabled={creating} className="w-full sm:w-auto">
                    {creating ? 'Creating...' : 'Create Key'}
                  </Button>
                </>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Warning */}
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="flex items-start gap-3 pt-4 md:pt-6">
          <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-amber-900">Keep your keys secure</p>
            <p className="text-xs sm:text-sm text-amber-700">
              API keys are shown only once when created. Store them securely and never share them publicly.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Keys Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg md:text-xl">Your API Keys</CardTitle>
          <CardDescription className="text-sm">
            {data?.keys?.length || 0} active {data?.keys?.length === 1 ? 'key' : 'keys'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-lg bg-zinc-100" />
              ))}
            </div>
          ) : data?.keys && data.keys.length > 0 ? (
            <>
              {/* Mobile: Card view */}
              <div className="space-y-3 md:hidden">
                {data.keys.map((key) => (
                  <div key={key.id} className="border rounded-lg p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{key.name}</p>
                        <code className="text-xs text-muted-foreground">{key.prefix}...</code>
                      </div>
                      <Badge variant={key.isActive ? 'default' : 'secondary'} className="text-xs">
                        {key.isActive ? 'active' : 'revoked'}
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
                    </div>
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
                            Are you sure you want to revoke "{key.name}"? This action cannot be undone.
                          </DialogDescription>
                        </DialogHeader>
                        <DialogFooter className="flex-col sm:flex-row gap-2">
                          <Button variant="outline" onClick={() => setDeleteId(null)} className="w-full sm:w-auto">
                            Cancel
                          </Button>
                          <Button
                            variant="destructive"
                            onClick={() => handleDelete(key.id)}
                            disabled={deleting}
                            className="w-full sm:w-auto"
                          >
                            {deleting ? 'Revoking...' : 'Revoke Key'}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                ))}
              </div>

              {/* Desktop: Table view */}
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Key</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Last Used</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.keys.map((key) => (
                      <TableRow key={key.id}>
                        <TableCell className="font-medium">{key.name}</TableCell>
                        <TableCell>
                          <code className="text-sm">{key.prefix}...</code>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(key.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : 'Never'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={key.isActive ? 'default' : 'secondary'}>
                            {key.isActive ? 'active' : 'revoked'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
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
                                  Are you sure you want to revoke "{key.name}"? This action cannot be undone.
                                </DialogDescription>
                              </DialogHeader>
                              <DialogFooter>
                                <Button variant="outline" onClick={() => setDeleteId(null)}>
                                  Cancel
                                </Button>
                                <Button
                                  variant="destructive"
                                  onClick={() => handleDelete(key.id)}
                                  disabled={deleting}
                                >
                                  {deleting ? 'Revoking...' : 'Revoke Key'}
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : (
            <div className="text-center py-12">
              <p className="text-muted-foreground mb-4 text-sm">No API keys yet</p>
              <Button onClick={() => setCreateOpen(true)} variant="outline" className="w-full sm:w-auto">
                Create your first key
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
