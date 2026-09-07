'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Zap, Lock, Mail, ArrowRight, AlertCircle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setErrorMessage(error.message);
        setIsLoading(false);
        return;
      }

      router.push('/');
      router.refresh();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'An unexpected error occurred during sign in.');
      setIsLoading(false);
    }
  };

  const handleDemoSignIn = async () => {
    setEmail('rajesh.demo@demo.aetheonlabs.in');
    setPassword('AetheonDemo2026!');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4 text-slate-100">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center p-3 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-400 mb-2">
            <Zap className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Aetheon Energy Intelligence</h1>
          <p className="text-xs text-slate-400">Algorithmic Decision Support for Indian C&I Power Consumers</p>
        </div>

        <Card variant="industrial" className="border-slate-800 bg-slate-900/60 shadow-xl">
          <CardHeader>
            <CardTitle>Sign in to your account</CardTitle>
            <CardDescription>Enter your verified enterprise credentials to access your site telemetry.</CardDescription>
          </CardHeader>

          <form onSubmit={handleLogin} className="p-6 pt-0 space-y-4">
            {errorMessage && (
              <div className="p-3 rounded bg-rose-950/40 border border-rose-800/60 text-xs text-rose-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-slate-400" />
                Corporate Email
              </label>
              <Input
                id="email"
                type="email"
                required
                placeholder="name@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-slate-400" />
                  Password
                </label>
                <Link
                  href="/auth/forgot-password"
                  className="text-[11px] text-sky-400 hover:text-sky-300 transition-colors"
                >
                  Forgot password?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                required
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
              />
            </div>

            <Button
              type="submit"
              variant="primary"
              size="md"
              className="w-full justify-center gap-2 mt-2"
              disabled={isLoading}
            >
              {isLoading ? 'Authenticating...' : 'Sign In'}
              <ArrowRight className="w-4 h-4" />
            </Button>

            {process.env.NEXT_PUBLIC_DEMO_MODE !== 'false' && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full text-xs text-slate-400 border-slate-800 hover:text-slate-200"
                onClick={handleDemoSignIn}
              >
                Fill Demo Credentials (Rajesh Sharma, Org Admin)
              </Button>
            )}
          </form>
        </Card>

        <div className="text-center space-y-2">
          <p className="text-xs text-slate-400">
            Don&apos;t have an enterprise account?{' '}
            <Link href="/auth/register" className="text-sky-400 font-semibold hover:underline">
              Create an organization
            </Link>
          </p>
          <div className="flex items-center justify-center gap-4 text-[11px] text-slate-400">
            <Link href="/help" className="hover:text-slate-300">
              Security & Compliance
            </Link>
            <span>•</span>
            <Link href="/help" className="hover:text-slate-300">
              Decision Support Notice
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
