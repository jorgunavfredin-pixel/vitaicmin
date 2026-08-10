import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// cn: gabung className kondisional + resolve konflik Tailwind (standar shadcn/ui).
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
