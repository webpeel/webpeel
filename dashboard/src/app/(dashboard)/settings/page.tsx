'use client';

import { useSession } from 'next-auth/react';
import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle2, Github, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api';

// ---------------------------------------------------------------------------
// Reusable Toggle Switch
// ---------------------------------------------------------------------------
function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#5865F2] focus:ring-offset-2 ${
        checked ? 'bg-[#5865F2]' : 'bg-zinc-600'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      aria-checked={checked}
      role="switch"
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-zinc-900 rounded-full shadow-sm transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Styled select for dark-theme dropdowns
// ---------------------------------------------------------------------------
function StyledSelect({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={`rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-[#5865F2]/40 focus:border-[#5865F2] ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
      }`}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Segmented control for API preference selectors
// ---------------------------------------------------------------------------
function SegmentedControl({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-zinc-700 bg-zinc-900 p-0.5 gap-0.5">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
            value === opt
              ? 'bg-zinc-900 text-zinc-100 shadow-sm border border-zinc-700'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings page
// ---------------------------------------------------------------------------
export default function SettingsPage() {
  const { data: session } = useSession();

  // --- Profile ---
  const [name, setName] = useState('');
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  useEffect(() => {
    if (session?.user?.name) setName(session.user.name);
  }, [session?.user?.name]);

  const token = (session as any)?.apiToken;
  const provider = (session as any)?.provider as string | undefined;
  const tier = ((session as any)?.tier as string | undefined) || 'free';
  const isOAuthUser = provider !== 'credentials';

  const providerLabel =
    provider === 'google'
      ? 'Google'
      : provider === 'github'
      ? 'GitHub'
      : 'Email';

  const tierLabel = tier === 'admin' ? 'Admin' : tier === 'pro' ? 'Pro' : tier === 'max' ? 'Max' : 'Free';
  const tierColor =
    tier === 'admin'
      ? 'bg-emerald-100 text-emerald-700'
      : tier === 'pro'
      ? 'bg-[#5865F2] text-white'
      : tier === 'max'
      ? 'bg-amber-500 text-white'
      : 'bg-zinc-800 text-zinc-600';

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setProfileLoading(true);
    try {
      await apiClient('/v1/me', {
        method: 'PATCH',
        body: JSON.stringify({ name }),
        token,
      });
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2000);
      toast.success('Profile updated');
    } catch (error: any) {
      toast.error(error.message || 'Failed to update profile');
    } finally {
      setProfileLoading(false);
    }
  };

  // --- Password ---
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) { toast.error('Passwords do not match'); return; }
    if (newPassword.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    setPasswordLoading(true);
    try {
      await apiClient('/v1/user/password', {
        method: 'PATCH',
        body: JSON.stringify({ currentPassword, newPassword }),
        token,
      });
      toast.success('Password changed successfully');
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch (error: any) {
      toast.error(error.message || 'Failed to change password');
    } finally {
      setPasswordLoading(false);
    }
  };

  // --- API Preferences (localStorage) ---
  const [defaultFormat, setDefaultFormat] = useState<string>('Markdown');
  const [defaultDetail, setDefaultDetail] = useState<string>('Standard');

  useEffect(() => {
    const fmt = localStorage.getItem('wp_pref_format');
    const det = localStorage.getItem('wp_pref_detail');
    if (fmt) setDefaultFormat(fmt);
    if (det) setDefaultDetail(det);
  }, []);

  const handleFormatChange = (v: string) => {
    setDefaultFormat(v);
    localStorage.setItem('wp_pref_format', v);
    toast.success(`Default format set to ${v}`);
  };

  const handleDetailChange = (v: string) => {
    setDefaultDetail(v);
    localStorage.setItem('wp_pref_detail', v);
    toast.success(`Default detail level set to ${v}`);
  };

  // --- Default Request Settings + Notifications (localStorage) ---
  const [defaultRender, setDefaultRender] = useState<string>('basic');
  const [articleMode, setArticleMode] = useState<boolean>(false);
  const [usageAlertThreshold, setUsageAlertThreshold] = useState<string>('disabled');
  const [alertEmail, setAlertEmail] = useState<string>('');
  const [alertEmailSaving, setAlertEmailSaving] = useState<boolean>(false);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.webpeel.dev';

  // Helper: save alert preferences to API
  const saveAlertPreferences = async (threshold: string, email: string) => {
    if (!token) return;
    const numericThreshold = threshold === 'disabled' ? null : parseInt(threshold, 10);
    try {
      await fetch(`${API_URL}/v1/user/alert-preferences`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          threshold: numericThreshold,
          email: email.trim() || null,
        }),
      });
    } catch (err) {
      // Non-blocking: silently fail if API is unreachable
      console.warn('[settings] Failed to sync alert preferences to API:', err);
    }
  };

  useEffect(() => {
    const render = localStorage.getItem('wp-default-render');
    const readable = localStorage.getItem('wp-default-readable');
    const localAlert = localStorage.getItem('wp-usage-alert');
    if (render) setDefaultRender(render);
    if (readable) setArticleMode(readable === 'true');

    // Load alert preferences from API (source of truth), fall back to localStorage
    if (token) {
      fetch(`${API_URL}/v1/user/alert-preferences`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.threshold !== undefined && data.threshold !== null) {
            const thresh = String(data.threshold);
            setUsageAlertThreshold(thresh);
            localStorage.setItem('wp-usage-alert', thresh);
          } else if (localAlert) {
            setUsageAlertThreshold(localAlert);
          }
          if (data.email) {
            setAlertEmail(data.email);
          }
        })
        .catch(() => {
          // Fall back to localStorage if API is unreachable
          if (localAlert) setUsageAlertThreshold(localAlert);
        });
    } else if (localAlert) {
      setUsageAlertThreshold(localAlert);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const saveToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSaveToast = () => {
    if (saveToastTimer.current) clearTimeout(saveToastTimer.current);
    saveToastTimer.current = setTimeout(() => toast.success('Settings saved'), 500);
  };

  const handleRenderChange = (v: string) => {
    setDefaultRender(v);
    localStorage.setItem('wp-default-render', v);
    scheduleSaveToast();
  };

  const handleArticleModeChange = (v: boolean) => {
    setArticleMode(v);
    localStorage.setItem('wp-default-readable', String(v));
    scheduleSaveToast();
  };

  const handleUsageAlertChange = (v: string) => {
    setUsageAlertThreshold(v);
    localStorage.setItem('wp-usage-alert', v);
    // Sync to API
    saveAlertPreferences(v, alertEmail);
    scheduleSaveToast();
  };

  const handleAlertEmailSave = async () => {
    setAlertEmailSaving(true);
    try {
      await saveAlertPreferences(usageAlertThreshold, alertEmail);
      toast.success('Alert email saved');
    } catch {
      toast.error('Failed to save alert email');
    } finally {
      setAlertEmailSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 md:space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-zinc-100">Settings</h1>
        <p className="text-sm md:text-base text-zinc-500 mt-1">Manage your account settings and preferences</p>
      </div>

      {/* ── Section 1: Profile ── */}
      <Card className="border-zinc-700">
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Profile</CardTitle>
          <CardDescription>Your personal information and account details</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleUpdateProfile} className="space-y-6">
            {/* Avatar + badges */}
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-[#5865F2]/10 flex items-center justify-center flex-shrink-0">
                <span className="text-xl font-semibold text-[#5865F2]">
                  {(session?.user?.name || session?.user?.email || 'U')
                    .split(' ')
                    .map((n: string) => n[0])
                    .join('')
                    .toUpperCase()
                    .slice(0, 2)}
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-zinc-100">{session?.user?.name || 'User'}</span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${tierColor}`}>
                    {tierLabel}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                  {provider === 'github' ? (
                    <Github className="h-3 w-3" />
                  ) : (
                    <Mail className="h-3 w-3" />
                  )}
                  <span>Connected via {providerLabel}</span>
                </div>
              </div>
            </div>

            <Separator className="bg-zinc-800" />

            {/* Email (read-only) */}
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sm font-medium text-zinc-300">Email</Label>
              <Input
                id="email"
                type="email"
                value={session?.user?.email || ''}
                disabled
                className="bg-zinc-900 border-zinc-700 text-zinc-400 cursor-not-allowed"
              />
              <p className="text-xs text-zinc-400">
                {isOAuthUser ? `Managed by ${providerLabel} — cannot be changed here` : 'Email address cannot be changed'}
              </p>
            </div>

            {/* Name (editable) */}
            <div className="space-y-1.5">
              <Label htmlFor="name" className="text-sm font-medium text-zinc-300">Display Name</Label>
              <Input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="border-zinc-700 focus-visible:ring-[#5865F2]/30 focus-visible:border-[#5865F2]"
              />
            </div>

            <div className="flex items-center gap-3">
              <Button
                type="submit"
                disabled={profileLoading}
                className="bg-[#5865F2] hover:bg-[#4752C4] text-white"
              >
                {profileLoading ? 'Saving…' : 'Save Changes'}
              </Button>
              {profileSaved && (
                <span className="flex items-center gap-1 text-sm text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" />
                  Saved
                </span>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      {/* ── Password (credentials users only) ── */}
      {!isOAuthUser && (
        <Card className="border-zinc-700">
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Password</CardTitle>
            <CardDescription>Change your account password</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="current-password" className="text-sm font-medium text-zinc-300">Current Password</Label>
                <Input
                  id="current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  className="border-zinc-700 focus-visible:ring-[#5865F2]/30 focus-visible:border-[#5865F2]"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-password" className="text-sm font-medium text-zinc-300">New Password</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  className="border-zinc-700 focus-visible:ring-[#5865F2]/30 focus-visible:border-[#5865F2]"
                />
                <p className="text-xs text-zinc-400">Must be at least 8 characters</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-password" className="text-sm font-medium text-zinc-300">Confirm New Password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="border-zinc-700 focus-visible:ring-[#5865F2]/30 focus-visible:border-[#5865F2]"
                />
              </div>
              <Button type="submit" disabled={passwordLoading} className="bg-[#5865F2] hover:bg-[#4752C4] text-white">
                {passwordLoading ? 'Changing…' : 'Change Password'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* ── Section 2: API Preferences ── */}
      <Card className="border-zinc-700">
        <CardHeader>
          <CardTitle className="text-lg font-semibold">API Preferences</CardTitle>
          <CardDescription>Default parameters used when making API requests from the Playground</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Default format */}
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-zinc-100">Default Output Format</p>
              <p className="text-xs text-zinc-400">
                Sets the <code className="font-mono bg-zinc-800 px-1 rounded">format</code> query param automatically
              </p>
            </div>
            <SegmentedControl
              options={['Markdown', 'HTML', 'Text']}
              value={defaultFormat}
              onChange={handleFormatChange}
            />
          </div>

          <Separator className="bg-zinc-800" />

          {/* Default detail */}
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-zinc-100">Default Detail Level</p>
              <p className="text-xs text-zinc-400">
                Sets the <code className="font-mono bg-zinc-800 px-1 rounded">detail</code> query param automatically
              </p>
            </div>
            <SegmentedControl
              options={['Brief', 'Standard', 'Full']}
              value={defaultDetail}
              onChange={handleDetailChange}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Section 3: Default Request Settings ── */}
      <Card className="border-zinc-800 bg-[#111116]">
        <CardHeader>
          <CardTitle className="text-lg font-semibold text-white">Default Request Settings</CardTitle>
          <CardDescription className="text-zinc-400">
            Pre-fill the Playground and set defaults for API requests
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Default render mode */}
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-zinc-100">Default Render Mode</p>
              <p className="text-xs text-zinc-400">
                Sets how pages are fetched when no explicit mode is specified
              </p>
            </div>
            <StyledSelect
              value={defaultRender}
              onChange={handleRenderChange}
              options={[
                { value: 'basic', label: 'Basic (Fast)' },
                { value: 'browser', label: 'Browser (JS-heavy sites)' },
                { value: 'stealth', label: 'Stealth (Bot detection)' },
              ]}
            />
          </div>

          <Separator className="bg-zinc-800" />

          {/* Article mode toggle */}
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-zinc-100">Article Mode</p>
              <p className="text-xs text-zinc-400">
                Extract article content only by default
              </p>
            </div>
            <Toggle checked={articleMode} onChange={handleArticleModeChange} />
          </div>

          {/* Helper text */}
          <p className="text-xs text-zinc-500 border-t border-zinc-800 pt-4">
            These defaults pre-fill the Playground and are used when no explicit params are set.
          </p>
        </CardContent>
      </Card>

      {/* ── Section 4: Notifications ── */}
      <Card className="border-zinc-800 bg-[#111116]">
        <CardHeader>
          <CardTitle className="text-lg font-semibold text-white">Notifications</CardTitle>
          <CardDescription className="text-zinc-400">
            Control how WebPeel alerts you about your usage
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Usage alert threshold */}
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-zinc-100">Usage Alert Threshold</p>
              <p className="text-xs text-zinc-400">
                Get an email when your weekly API usage reaches this percentage.
              </p>
            </div>
            <StyledSelect
              value={usageAlertThreshold}
              onChange={handleUsageAlertChange}
              options={[
                { value: 'disabled', label: 'Disabled' },
                { value: '50', label: '50%' },
                { value: '75', label: '75%' },
                { value: '80', label: '80%' },
                { value: '90', label: '90%' },
              ]}
            />
          </div>

          <Separator className="bg-zinc-800" />

          {/* Alert email input */}
          <div className="space-y-1.5">
            <Label htmlFor="alert-email" className="text-sm font-medium text-zinc-300">
              Alert Email
            </Label>
            <div className="flex gap-2">
              <Input
                id="alert-email"
                type="email"
                value={alertEmail}
                onChange={(e) => setAlertEmail(e.target.value)}
                placeholder={session?.user?.email || 'your@email.com'}
                className="bg-zinc-900 border-zinc-700 text-zinc-100 flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAlertEmailSave}
                disabled={alertEmailSaving}
                className="shrink-0 border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              >
                {alertEmailSaving ? 'Saving…' : 'Save'}
              </Button>
            </div>
            <p className="text-xs text-zinc-500">
              Leave blank to use your account email. Alerts are sent at most once per week.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── Section 4: Danger Zone ── */}
      <Card className="border-l-4 border-l-red-500 border-t border-r border-b border-red-500/30 bg-red-500/5">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            <CardTitle className="text-lg font-semibold text-red-600">Danger Zone</CardTitle>
          </div>
          <CardDescription>Irreversible and permanent actions</CardDescription>
        </CardHeader>
        <CardContent>
          <Separator className="bg-red-100 mb-4" />
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="space-y-1">
              <p className="font-medium text-zinc-100">Delete Account</p>
              <p className="text-sm text-zinc-500">
                Permanently delete your account and all associated data.{' '}
                <span className="font-medium text-red-600">This action cannot be undone.</span>
              </p>
            </div>
            <Button
              variant="outline"
              disabled
              className="w-full sm:w-auto border-red-500/50 text-red-400 hover:bg-red-500/10 hover:border-red-500 disabled:opacity-60 disabled:cursor-not-allowed"
              title="Account deletion is coming soon"
            >
              <AlertTriangle className="h-4 w-4 mr-2" />
              Delete Account
            </Button>
          </div>
          <p className="text-xs text-zinc-400 mt-3">Account deletion is not yet available. Contact support if you need assistance.</p>
        </CardContent>
      </Card>
    </div>
  );
}
