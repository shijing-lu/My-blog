import type { ReactNode } from 'react';

export function Columns({ count, children }: { count?: string; children?: ReactNode }): ReactNode {
  const columns = count === '3' ? 3 : 2;
  return (
    <div className="md-columns-container">
      <div className="md-columns" data-columns={columns}>
        {children}
      </div>
    </div>
  );
}

export function Column({ number, children }: { number?: string; children?: ReactNode }): ReactNode {
  return <section className="md-column" role="group" aria-label={`第 ${number === '2' || number === '3' ? number : '1'} 栏`}>{children}</section>;
}
