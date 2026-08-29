'use client';

import { ArrowRight } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface FlowButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  text?: string;
}

export function FlowButton({
  text = 'Modern Button',
  className,
  type = 'button',
  ...props
}: FlowButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'group relative flex items-center gap-1 overflow-hidden rounded-[100px] border-[1.5px] border-[#f3c742]/55 bg-transparent px-8 py-3 text-sm font-semibold text-[#f3c742] cursor-pointer transition-all duration-[600ms] ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-transparent hover:text-[#191919] hover:rounded-[12px] active:scale-[0.95] disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <ArrowRight
        className="absolute left-[-25%] z-[9] h-4 w-4 fill-none stroke-[#f3c742] transition-all duration-[800ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:left-4 group-hover:stroke-[#191919]"
      />

      <span className="relative z-[1] -translate-x-3 transition-all duration-[800ms] ease-out group-hover:translate-x-3">
        {text}
      </span>

      <span className="absolute top-1/2 left-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-[50%] bg-[#f3c742] opacity-0 transition-all duration-[800ms] ease-[cubic-bezier(0.19,1,0.22,1)] group-hover:h-[220px] group-hover:w-[220px] group-hover:opacity-100" />

      <ArrowRight
        className="absolute right-4 z-[9] h-4 w-4 fill-none stroke-[#f3c742] transition-all duration-[800ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:right-[-25%] group-hover:stroke-[#191919]"
      />
    </button>
  );
}
