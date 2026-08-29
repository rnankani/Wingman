import { cn } from '@/lib/utils';

export type ChiknyPose =
  | 'idle'
  | 'greeting'
  | 'learning'
  | 'negotiating'
  | 'thinking'
  | 'matched'
  | 'passed'
  | 'resting';

interface ChiknyProps {
  pose: ChiknyPose;
  className?: string;
  label?: string;
}

export function Chikny({ pose, className, label = `Wingman is ${pose}` }: ChiknyProps) {
  if (pose === 'learning') {
    return (
      <img
        className={cn('chikny', 'chikny--learning-image', className)}
        src="/brand/chikny-learning-reference.png"
        alt={label}
      />
    );
  }

  return (
    <div
      className={cn('chikny', `chikny--${pose}`, className)}
      role="img"
      aria-label={label}
    />
  );
}
