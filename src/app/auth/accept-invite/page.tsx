'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Zap, Lock, User, ArrowRight, AlertCircle, CheckCircle2, ShieldCheck } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { createClient } from '@/lib/supabase/client';

function AcceptInviteForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const orgId = searchParams.get('org_id') || '';
  const email = searchParams.get('email') || '';

  const handleAccept = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      setIsLoading(false);
      return;
    }

    try {
      const { error } = await supabase.auth.updateUser({
        password,
        data: {
          full_name: fullName,
        },
      });

      if (error) {
        setErrorMessage(error.message);
        setIsLoading(false);
        return;
      }

      setSuccessMessage('Invitation accepted and account activated! Redirecting...');
      setTimeout(() => {
        router.push('/');
      }, 1500);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'An unexpected error occurred.');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4 text-slate-100">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center p-3 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-400 mb-2">
            <Zap className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Accept Invitation</h1>
          <p className="text-xs text-slate-400">Algorithmic Decision Support for Indian C&I Power Consumers</p>
        </div>

        <Card variant="industrial" className="border-slate-800 bg-slate-900/60 shadow-xl">
          <CardHeader>
            <div className="flex items-center gap-2 mb-1 text-sky-400">
              <ShieldCheck className="w-4 h-4" />
              <span className="text-xs font-semibold uppercase tracking-wider">Enterprise Invitation</span>
            </div>
            <CardTitle>Join Your Organisation</CardTitle>
            <CardDescription>
              {email ? `Accepting invite for ${email}.` : 'Set your enterprise account password to access your team.'}
            </CardDescription>
          </CardHeader>

          <form onSubmit={handleAccept} className="p-6 pt-0 space-y-4">
            {errorMessage && (
              <div className="p-3 rounded bg-rose-950/40 border border-rose-800/60 text-xs text-rose-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            {successMessage && (
              <div className="p-3 rounded bg-emerald-950/40 border border-emerald-800/60 text-xs text-emerald-300 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>{successMessage}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-slate-400" />
                Full Name
              </label>
              <Input
                type="text"
                required
                placeholder="e.g. Vikram Desai"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                disabled={isLoading}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-slate-400" />
                Password (min 8 chars)
              </label>
              <Input
                type="password"
                required
                minLength={8}
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-slate-400" />
                Confirm Password
              </label>
              <Input
                type="password"
                required
                minLength={8}
                placeholder="••••••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={isLoading}
              />
            </div>

            <Button
              type="submit"
              variant="primary"
              className="w-full bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs mt-2"
              disabled={isLoading}
            >
              {isLoading ? 'Activating Account...' : 'Accept Invite & Sign In'}
              <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
            </Button>
          </form>

          <div className="p-4 border-t border-slate-800/80 text-center text-xs text-slate-400">
            <Link href="/auth/login" className="text-sky-400 hover:text-sky-300">
              Back to Sign In
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <React.Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-400 text-xs">
          Loading invitation...
        </div>
      }
    >
      <AcceptInviteForm />
    </React.Suspense>
  );
}
