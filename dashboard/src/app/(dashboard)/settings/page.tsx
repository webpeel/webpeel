'use client';

import { useSession } from 'next-auth/react';
import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api';

export default function SettingsPage() {
  const { data: session } = useSession();
  const [name, setName] = useState(session?.user?.name || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [loading, setLoading] = useState(false);

  const token = (session as any)?.apiToken;
  const isOAuthUser = session?.user?.email?.endsWith('@github.com') || session?.user?.email?.endsWith('@google.com');

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await apiClient('/v1/user/profile', {
        method: 'PATCH',
        body: JSON.stringify({ name }),
        token,
      });
      toast.success('Profile updated successfully');
    } catch (error: any) {
      toast.error(error.message || 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }

    setLoading(true);
    try {
      await apiClient('/v1/user/password', {
        method: 'PATCH',
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
        token,
      });
      toast.success('Password changed successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      toast.error(error.message || 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirm !== 'DELETE') {
      toast.error('Please type DELETE to confirm');
      return;
    }

    setLoading(true);
    try {
      await apiClient('/v1/user/account', {
        method: 'DELETE',
        body: JSON.stringify({
          confirmEmail: session?.user?.email,
          ...(deletePassword ? { password: deletePassword } : {}),
        }),
        token,
      });
      toast.success('Account deleted successfully');
      // Redirect to login or home
      window.location.href = '/';
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete account');
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 md:space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Settings</h1>
        <p className="text-sm md:text-base text-muted-foreground">Manage your account settings and preferences</p>
      </div>

      {/* Profile */}
      <Card className="border-zinc-200">
        <CardHeader>
          <CardTitle className="text-xl">Profile</CardTitle>
          <CardDescription>Update your personal information</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleUpdateProfile} className="space-y-6">
            {/* Avatar Display */}
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0">
                <span className="text-2xl font-semibold text-violet-700">
                  {(session?.user?.name || session?.user?.email || 'U')
                    .split(' ')
                    .map(n => n[0])
                    .join('')
                    .toUpperCase()
                    .slice(0, 2)}
                </span>
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-zinc-900">{session?.user?.name || 'User'}</p>
                <p className="text-xs text-zinc-500">{session?.user?.email}</p>
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium text-zinc-900">Email</Label>
              <Input
                id="email"
                type="email"
                value={session?.user?.email || ''}
                disabled
                className="bg-zinc-50 border-zinc-200"
              />
              <p className="text-xs text-zinc-500">
                {isOAuthUser ? 'Email cannot be changed for OAuth accounts' : 'Email cannot be changed'}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name" className="text-sm font-medium text-zinc-900">Name</Label>
              <Input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="focus:ring-2 focus:ring-violet-100 focus:border-violet-300"
              />
            </div>

            <Button type="submit" disabled={loading} className="bg-violet-600 hover:bg-violet-700">
              {loading ? 'Saving...' : 'Save Changes'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Password */}
      {!isOAuthUser && (
        <Card className="border-zinc-200">
          <CardHeader>
            <CardTitle className="text-xl">Password</CardTitle>
            <CardDescription>Change your password</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="current-password" className="text-sm font-medium text-zinc-900">Current Password</Label>
                <Input
                  id="current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  className="focus:ring-2 focus:ring-violet-100 focus:border-violet-300"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-password" className="text-sm font-medium text-zinc-900">New Password</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  className="focus:ring-2 focus:ring-violet-100 focus:border-violet-300"
                />
                <p className="text-xs text-zinc-500">Must be at least 8 characters</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password" className="text-sm font-medium text-zinc-900">Confirm New Password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="focus:ring-2 focus:ring-violet-100 focus:border-violet-300"
                />
              </div>
              <Button type="submit" disabled={loading} className="bg-violet-600 hover:bg-violet-700">
                {loading ? 'Changing...' : 'Change Password'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Danger Zone */}
      <Card className="border-l-4 border-l-red-500 border-t border-r border-b border-red-200 bg-red-50/30">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-600" />
            <CardTitle className="text-xl text-red-600">Danger Zone</CardTitle>
          </div>
          <CardDescription>Irreversible and permanent actions</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Separator className="bg-red-200" />
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="space-y-1 flex-1">
              <p className="font-medium text-zinc-900">Delete Account</p>
              <p className="text-sm text-zinc-600">
                Permanently delete your account and all associated data. This action cannot be undone.
              </p>
            </div>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="destructive" className="w-full sm:w-auto text-sm">Delete Account</Button>
              </DialogTrigger>
              <DialogContent className="max-w-[90vw] sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-red-600">
                    <AlertTriangle className="h-5 w-5" />
                    Delete Account
                  </DialogTitle>
                  <DialogDescription>
                    This action is permanent and cannot be undone. All your data, API keys, and usage history will be deleted.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  {!isOAuthUser && (
                    <div className="space-y-2">
                      <Label htmlFor="delete-password">Your password</Label>
                      <Input
                        id="delete-password"
                        type="password"
                        value={deletePassword}
                        onChange={(e) => setDeletePassword(e.target.value)}
                        placeholder="Enter your password"
                      />
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="delete-confirm">
                      Type <strong>DELETE</strong> to confirm
                    </Label>
                    <Input
                      id="delete-confirm"
                      value={deleteConfirm}
                      onChange={(e) => setDeleteConfirm(e.target.value)}
                      placeholder="DELETE"
                    />
                  </div>
                </div>
                <DialogFooter className="flex-col sm:flex-row gap-2">
                  <Button variant="outline" onClick={() => { setDeleteConfirm(''); setDeletePassword(''); }} className="w-full sm:w-auto">
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleDeleteAccount}
                    disabled={deleteConfirm !== 'DELETE' || loading}
                    className="w-full sm:w-auto"
                  >
                    {loading ? 'Deleting...' : 'Delete Account'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
