'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Zap, Lock, Mail, User, Building, ArrowRight, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { createClient } from '@/lib/supabase/client';

export default function RegisterPage() {
  const router = useRouter();
  const supabase = createClient();

  const [orgName, setOrgName] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            organisation_name: orgName,
          },
        },
      });

      if (error) {
        setErrorMessage(error.message);
        setIsLoading(false);
        return;
      }

      if (data?.session) {
        router.push('/');
        router.refresh();
      } else {
        setSuccessMessage('Registration successful! Please check your email to verify your account.');
        setIsLoading(false);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'An unexpected error occurred during registration.');
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
          <h1 className="text-2xl font-bold tracking-tight">Create Your Enterprise Account</h1>
          <p className="text-xs text-slate-400">Algorithmic Decision Support for Indian C&I Power Consumers</p>
        </div>

        <Card variant="industrial" className="border-slate-800 bg-slate-900/60 shadow-xl">
          <CardHeader>
            <CardTitle>Organisation Onboarding</CardTitle>
            <CardDescription>Register your facility or corporate entity for grid intelligence access.</CardDescription>
          </CardHeader>

          <form onSubmit={handleRegister} className="p-6 pt-0 space-y-4">
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
                <Building className="w-3.5 h-3.5 text-slate-400" />
                Enterprise / Legal Entity Name
              </label>
              <Input
                type="text"
                required
                placeholder="e.g. Acme Auto Components Ltd"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                disabled={isLoading}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-slate-400" />
                Full Name
              </label>
              <Input
                type="text"
                required
                placeholder="e.g. Priya Sundaram"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                disabled={isLoading}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-slate-400" />
                Corporate Email
              </label>
              <Input
                type="email"
                required
                placeholder="priya.s@acme-auto.in"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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

            <Button
              type="submit"
              variant="primary"
              className="w-full bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs mt-2"
              disabled={isLoading}
            >
              {isLoading ? 'Creating Account...' : 'Register Organisation'}
              <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
            </Button>
          </form>

          <div className="p-4 border-t border-slate-800/80 text-center text-xs text-slate-400">
            Already have an account?{' '}
            <Link href="/auth/login" className="text-sky-400 hover:text-sky-300 font-medium">
              Sign In
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
