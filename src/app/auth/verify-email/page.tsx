'use client';

import React from 'react';
import Link from 'next/link';
import { Zap, MailCheck, ArrowRight } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export default function VerifyEmailPage() {
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

        <Card variant="industrial" className="border-slate-800 bg-slate-900/60 shadow-xl text-center p-6 space-y-4">
          <div className="inline-flex items-center justify-center p-4 rounded-full bg-sky-500/10 text-sky-400 mx-auto">
            <MailCheck className="w-10 h-10" />
          </div>

          <CardHeader className="p-0">
            <CardTitle className="text-xl">Check your email</CardTitle>
            <CardDescription className="text-xs text-slate-300 mt-2">
              We have dispatched a verification link to your corporate email address. Click the link to complete authentication and access your platform tenancy.
            </CardDescription>
          </CardHeader>

          <div className="pt-4 border-t border-slate-800/80">
            <Link href="/auth/login">
              <Button variant="outline" className="w-full text-xs">
                Back to Sign In
                <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
