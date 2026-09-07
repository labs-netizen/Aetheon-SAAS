'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Zap, Mail, ArrowRight, ArrowLeft, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { createClient } from '@/lib/supabase/client';

export default function ForgotPasswordPage() {
  const supabase = createClient();

  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const redirectUrl = typeof window !== 'undefined'
        ? `${window.location.origin}/auth/reset-password`
        : undefined;

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: redirectUrl,
      });

      if (error) {
        setErrorMessage(error.message);
        setIsLoading(false);
        return;
      }

      setSuccessMessage('Password reset link has been dispatched to your email address.');
      setIsLoading(false);
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
          <h1 className="text-2xl font-bold tracking-tight">Reset Password</h1>
          <p className="text-xs text-slate-400">Algorithmic Decision Support for Indian C&I Power Consumers</p>
        </div>

        <Card variant="industrial" className="border-slate-800 bg-slate-900/60 shadow-xl">
          <CardHeader>
            <CardTitle>Recover Access</CardTitle>
            <CardDescription>Enter your registered corporate email to receive password recovery instructions.</CardDescription>
          </CardHeader>

          <form onSubmit={handleReset} className="p-6 pt-0 space-y-4">
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
                <Mail className="w-3.5 h-3.5 text-slate-400" />
                Corporate Email
              </label>
              <Input
                type="email"
                required
                placeholder="name@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
              />
            </div>

            <Button
              type="submit"
              variant="primary"
              className="w-full bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs mt-2"
              disabled={isLoading}
            >
              {isLoading ? 'Sending Link...' : 'Send Password Reset Link'}
              <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
            </Button>
          </form>

          <div className="p-4 border-t border-slate-800/80 text-center text-xs text-slate-400">
            <Link href="/auth/login" className="text-sky-400 hover:text-sky-300 inline-flex items-center gap-1">
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to Sign In
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
