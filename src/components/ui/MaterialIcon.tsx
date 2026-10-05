import type { ComponentProps } from 'react';

/** Same mounted icon/control in both styles; the alternate glyph is CSS-only. */
export function MaterialIcon({ name, children, className = '', ...props }: ComponentProps<'span'> & { name: string }) {
  return <span className={`material-icon-pair ${className}`} aria-hidden="true" {...props}>
    {children && <span className="material-icon-classic">{children}</span>}
    <span className={`material-symbol${children ? '' : ' material-icon-only'}`}>{name}</span>
  </span>;
}
