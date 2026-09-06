import React, { useState } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface TabItem {
  id: string;
  label: string;
  count?: number;
  disabled?: boolean;
}

export interface TabsProps {
  tabs: TabItem[];
  activeTab?: string;
  onChange?: (tabId: string) => void;
  className?: string;
}

export function Tabs({ tabs, activeTab, onChange, className }: TabsProps) {
  const [internalActive, setInternalActive] = useState(activeTab || tabs[0]?.id);
  const current = activeTab !== undefined ? activeTab : internalActive;

  const handleSelect = (id: string) => {
    setInternalActive(id);
    onChange?.(id);
  };

  return (
    <div className={twMerge(clsx('border-b border-slate-800 flex gap-4', className))}>
      {tabs.map((tab) => {
        const isActive = tab.id === current;
        return (
          <button
            key={tab.id}
            onClick={() => handleSelect(tab.id)}
            disabled={tab.disabled}
            className={clsx(
              'flex items-center gap-2 pb-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
              isActive
                ? 'border-primary text-primary-foreground font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700',
              tab.disabled && 'opacity-40 cursor-not-allowed'
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={clsx(
                  'text-xs px-1.5 py-0.2 rounded-full',
                  isActive ? 'bg-primary/30 text-emerald-200' : 'bg-slate-800 text-slate-400'
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
