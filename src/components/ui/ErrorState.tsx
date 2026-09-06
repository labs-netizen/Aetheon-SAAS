import React from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from './Button';

export interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = 'System Error Encountered',
  message,
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center rounded-lg border border-red-900/50 bg-red-950/20">
      <div className="p-3 mb-3 rounded-full bg-red-900/30 border border-red-800/60">
        <AlertCircle className="h-8 w-8 text-red-400" />
      </div>
      <h4 className="text-sm font-semibold text-red-200 mb-1">{title}</h4>
      <p className="text-xs text-red-300/80 max-w-md mb-4 leading-relaxed">{message}</p>
      {onRetry && (
        <Button onClick={onRetry} variant="outline" size="sm" className="border-red-800 text-red-300 hover:bg-red-900/40">
          Try Again
        </Button>
      )}
    </div>
  );
}
