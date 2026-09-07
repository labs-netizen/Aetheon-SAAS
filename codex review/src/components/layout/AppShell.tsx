'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';
import {
  LayoutDashboard,
  Zap,
  ShieldCheck,
  Activity,
  BatteryCharging,
  Sun,
  Bell,
  FileText,
  Settings,
  ShieldAlert,
  Building2,
  MapPin,
  HelpCircle,
  Menu,
  X,
  Radio,
  UserCheck,
} from 'lucide-react';
import { useSite } from './SiteContext';
import { DemoBadge } from '@/components/shared/DemoBadge';
import type { PlatformRole } from '@/types';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { currentOrg, currentSite, sites, switchSite, activeRole, switchRole } = useSite();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems = [
    { label: 'Dashboard', href: '/', icon: LayoutDashboard },
    { label: 'Grid Intelligence', href: '/grid-intelligence', icon: Zap, badge: 'Primary' },
    { label: 'Open Access Compliance', href: '/compliance', icon: ShieldCheck },
    { label: 'DSM Risk Monitor', href: '/dsm', icon: Activity },
    { label: 'BESS Arbitrage', href: '/bess', icon: BatteryCharging },
    { label: 'Renewable Portfolio', href: '/renewables', icon: Sun },
    { label: 'Alerts & Incidents', href: '/alerts', icon: Bell },
    { label: 'Reports', href: '/reports', icon: FileText },
    { label: 'Settings & Ingestion', href: '/settings', icon: Settings },
    { label: 'Help & Knowledge', href: '/help', icon: HelpCircle },
  ];

  const adminNav = [
    { label: 'Admin Console', href: '/admin', icon: ShieldAlert },
  ];

  const roles: PlatformRole[] = [
    'ORGANISATION_ADMIN',
    'ENERGY_MANAGER',
    'OPERATOR',
    'FINANCE_SUSTAINABILITY_VIEWER',
    'AETHEON_ANALYST',
    'AETHEON_REGULATORY_REVIEWER',
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col antialiased">
      {/* Top Header */}
      <header className="h-16 border-b border-slate-800 bg-slate-900/90 backdrop-blur-md sticky top-0 z-40 px-4 md:px-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden p-2 text-slate-400 hover:text-white"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded bg-gradient-to-br from-teal-500 to-emerald-700 flex items-center justify-center font-bold text-slate-950 text-lg shadow-md">
              Æ
            </div>
            <div>
              <span className="font-bold tracking-tight text-slate-100 text-sm block leading-none">
                AETHEON
              </span>
              <span className="text-[10px] tracking-wider text-teal-400 font-medium uppercase block mt-0.5">
                Energy Intelligence
              </span>
            </div>
          </Link>

          <div className="hidden lg:flex items-center gap-2 ml-4 pl-4 border-l border-slate-800">
            <Building2 className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-xs font-medium text-slate-300">{currentOrg.name}</span>
          </div>
        </div>

        {/* Center: Site Selector & Health status */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-1.5 bg-slate-950/80 px-2.5 py-1.5 rounded-md border border-slate-800 text-xs">
            <MapPin className="w-3.5 h-3.5 text-teal-400" />
            <span className="text-slate-400">Site:</span>
            <select
              value={currentSite.id}
              onChange={(e) => switchSite(e.target.value)}
              className="bg-transparent text-slate-200 font-medium focus:outline-none cursor-pointer"
            >
              {sites.map((s) => (
                <option key={s.id} value={s.id} className="bg-slate-900 text-slate-100">
                  {s.name} ({s.state} - {s.discom})
                </option>
              ))}
            </select>
          </div>

          <div className="hidden md:flex items-center gap-1.5 bg-slate-950/80 px-2.5 py-1.5 rounded-md border border-slate-800 text-xs">
            <Radio className={clsx("w-3 h-3", currentSite.activation_status === 'ACTIVE' ? 'text-emerald-400 animate-pulse' : 'text-amber-400')} />
            <span className="text-slate-400">Monitoring:</span>
            <span className={clsx("font-semibold", currentSite.activation_status === 'ACTIVE' ? 'text-emerald-300' : 'text-amber-300')}>
              {currentSite.activation_status}
            </span>
          </div>

          <DemoBadge />
        </div>

        {/* Right: Role Indicator / Demo Role Switcher & User Profile */}
        <div className="flex items-center gap-3">
          {process.env.NEXT_PUBLIC_DEMO_MODE !== 'false' ? (
            <div className="hidden xl:flex items-center gap-1 bg-slate-950/80 px-2 py-1 rounded border border-slate-800 text-xs">
              <UserCheck className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-slate-500">Demo Role:</span>
              <select
                aria-label="Demo Role Switcher"
                value={activeRole}
                onChange={(e) => switchRole(e.target.value as PlatformRole)}
                className="bg-transparent text-slate-300 text-xs focus:outline-none cursor-pointer font-medium"
              >
                {roles.map((r) => (
                  <option key={r} value={r} className="bg-slate-900 text-slate-100">
                    {r.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="hidden xl:flex items-center gap-1 bg-slate-950/80 px-2.5 py-1 rounded border border-slate-800 text-xs text-slate-400">
              <UserCheck className="w-3.5 h-3.5 text-teal-400" />
              <span>{activeRole.replace(/_/g, ' ')}</span>
            </div>
          )}

          <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-semibold text-teal-300">
            {activeRole === 'ORGANISATION_ADMIN' ? 'OA' : activeRole.substring(0, 2)}
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside
          className={clsx(
            'w-64 border-r border-slate-800 bg-slate-900/60 p-4 shrink-0 flex flex-col justify-between transition-all md:static fixed inset-y-16 left-0 z-30',
            mobileOpen ? 'block' : 'hidden md:flex'
          )}
        >
          <div className="space-y-6">
            <nav className="space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={clsx(
                      'flex items-center justify-between px-3 py-2 rounded-md text-xs font-medium transition-colors',
                      isActive
                        ? 'bg-primary/20 text-emerald-300 font-semibold border-l-2 border-primary'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <Icon className={clsx('w-4 h-4', isActive ? 'text-primary' : 'text-slate-500')} />
                      <span>{item.label}</span>
                    </div>
                    {item.badge && (
                      <span className="text-[10px] bg-teal-950 text-teal-300 px-1.5 py-0.2 rounded font-bold">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>

            <div className="pt-4 border-t border-slate-800">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block px-3 mb-2">
                Platform Operations
              </span>
              <nav className="space-y-1">
                {adminNav.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className={clsx(
                        'flex items-center gap-3 px-3 py-2 rounded-md text-xs font-medium transition-colors',
                        isActive
                          ? 'bg-amber-950/40 text-amber-300 font-semibold border-l-2 border-amber-500'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                      )}
                    >
                      <Icon className="w-4 h-4 text-amber-500" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </nav>
            </div>
          </div>

          <div className="p-3 bg-slate-950/80 rounded-md border border-slate-800 text-[11px] text-slate-400 space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-300">Sanctioned Demand:</span>
              <span className="text-slate-200 font-mono">{currentSite.contract_demand_value} {currentSite.contract_demand_unit}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-300">Voltage:</span>
              <span className="text-slate-200 font-mono">{currentSite.voltage_category}</span>
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-slate-800/80 text-[10px]">
              <span>Timezone:</span>
              <span className="text-teal-400">{currentSite.timezone}</span>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto p-4 md:p-8 bg-slate-950">
          <div className="max-w-7xl mx-auto space-y-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
