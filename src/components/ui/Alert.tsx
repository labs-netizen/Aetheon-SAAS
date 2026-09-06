import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'info' | 'warning' | 'error' | 'success';
  title?: string;
}

export function Alert({ className, variant = 'info', title, children, ...props }: AlertProps) {
  const icons = {
    info: <Info className="h-5 w-5 text-sky-400 shrink-0 mt-0.5" />,
    warning: <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />,
    error: <AlertCircle className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />,
    success: <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />,
  };

  const variants = {
    info: 'bg-sky-950/40 border-sky-800/60 text-sky-200',
    warning: 'bg-amber-950/40 border-amber-800/60 text-amber-200',
    error: 'bg-rose-950/40 border-rose-800/60 text-rose-200',
    success: 'bg-emerald-950/40 border-emerald-800/60 text-emerald-200',
  };

  return (
    <div
      role="alert"
      className={twMerge(
        clsx('flex items-start gap-3 p-4 rounded-md border text-sm', variants[variant], className)
      )}
      {...props}
    >
      {icons[variant]}
      <div className="space-y-1">
        {title && <h5 className="font-semibold leading-none tracking-tight">{title}</h5>}
        <div className="text-xs opacity-90 leading-relaxed">{children}</div>
      </div>
    </div>
  );
}
