import type { Metadata } from 'next';
import './globals.css';
import { SiteProvider } from '@/components/layout/SiteContext';
import { AppShell } from '@/components/layout/AppShell';

export const metadata: Metadata = {
  title: 'Aetheon Energy Intelligence Platform',
  description: 'Algorithmic decision support for Indian Commercial & Industrial electricity consumers.',
};

export const dynamic = 'force-dynamic';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const env = process.env;
  const isDemo = env['NEXT_PUBLIC_DEMO_MODE'] === 'true' || env['DEMO_MODE'] === 'true';
  return (
    <html lang="en" className="dark">
      <body data-demo-mode={isDemo ? 'true' : 'false'} className="bg-slate-950 text-slate-100 min-h-screen">
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__NEXT_PUBLIC_DEMO_MODE__ = "${isDemo ? 'true' : 'false'}";`,
          }}
        />
        <SiteProvider initialDemoMode={isDemo}>
          <AppShell>{children}</AppShell>
        </SiteProvider>
      </body>
    </html>
  );
}
