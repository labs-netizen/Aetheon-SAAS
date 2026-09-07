import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', label, error, helperText, id, ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

    return (
      <div className="w-full space-y-1.5">
        {label && (
          <label htmlFor={inputId} className="block text-xs font-semibold text-slate-300 tracking-wide uppercase">
            {label}
          </label>
        )}
        <input
          id={inputId}
          ref={ref}
          type={type}
          className={twMerge(
            clsx(
              'flex h-10 w-full rounded-md border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500',
              'focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all',
              'disabled:cursor-not-allowed disabled:opacity-50',
              error && 'border-red-500 focus:ring-red-500',
              className
            )
          )}
          {...props}
        />
        {error && <p className="text-xs text-red-400 font-medium">{error}</p>}
        {helperText && !error && <p className="text-xs text-slate-400">{helperText}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';
