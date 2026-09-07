import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'industrial' | 'bordered';
}

export function Card({ className, variant = 'default', children, ...props }: CardProps) {
  const variants = {
    default: 'bg-slate-900 border border-slate-800 shadow-md',
    industrial: 'bg-slate-900/90 border border-slate-700/80 shadow-lg relative backdrop-blur-sm',
    bordered: 'bg-slate-950 border border-slate-800',
  };

  return (
    <div className={twMerge(clsx('rounded-lg p-5 text-slate-100', variants[variant], className))} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={twMerge(clsx('flex items-center justify-between pb-3 mb-3 border-b border-slate-800', className))} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({ className, children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={twMerge(clsx('text-base font-semibold text-slate-100 flex items-center gap-2', className))} {...props}>
      {children}
    </h3>
  );
}

export function CardDescription({ className, children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={twMerge(clsx('text-xs text-slate-400', className))} {...props}>
      {children}
    </p>
  );
}
