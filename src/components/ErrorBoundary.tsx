import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Unexpected application error.',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#07080B] text-[#F5F2EB] flex items-center justify-center p-6">
          <div className="max-w-md w-full aurum-glass rounded-2xl p-6 border border-rose-500/30 space-y-4 text-center">
            <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto" />
            <h1 className="text-lg font-bold">خطای غیرمنتظره در رابط کاربری</h1>
            <p className="text-xs text-[#9A9891] leading-relaxed">
              لطفاً صفحه را بارگذاری مجدد کنید. در صورت تداوم مشکل، نشست خود را بررسی نمایید.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="aurum-gold-btn inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>بارگذاری مجدد صفحه</span>
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
