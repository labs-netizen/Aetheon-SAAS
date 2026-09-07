import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', isLoading = false, children, disabled, ...props }, ref) => {
    const baseStyles = 'inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none rounded-md';

    const variants = {
      primary: 'bg-primary text-primary-foreground hover:bg-primary-hover focus-visible:ring-primary shadow-sm',
      secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary-hover focus-visible:ring-secondary',
      outline: 'border border-slate-700 bg-transparent text-slate-200 hover:bg-slate-800 hover:text-white',
      danger: 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600 shadow-sm',
      ghost: 'bg-transparent text-slate-300 hover:bg-slate-800 hover:text-white',
    };

    const sizes = {
      sm: 'text-xs px-2.5 py-1.5',
      md: 'text-sm px-4 py-2',
      lg: 'text-base px-5 py-2.5',
    };

    return (
      <button
        ref={ref}
        className={twMerge(clsx(baseStyles, variants[variant], sizes[size], className))}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading ? (
          <span className="inline-flex items-center gap-2">
            <svg className="animate-spin h-4 w-4 text-current" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Loading...
          </span>
        ) : (
          children
        )}
      </button>
    );
  }
);

Button.displayName = 'Button';
