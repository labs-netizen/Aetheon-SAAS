import type { Metadata } from 'next';
import './globals.css';
import { SiteProvider } from '@/components/layout/SiteContext';
import { AppShell } from '@/components/layout/AppShell';

export const metadata: Metadata = {
  title: 'Aetheon Energy Intelligence Platform',
  description: 'Algorithmic decision support for Indian Commercial & Industrial electricity consumers.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body data-demo-mode={process.env.NEXT_PUBLIC_DEMO_MODE === 'true' ? 'true' : 'false'} className="bg-slate-950 text-slate-100 min-h-screen">
        <SiteProvider>
          <AppShell>{children}</AppShell>
        </SiteProvider>
      </body>
    </html>
  );
}
