'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function Nav() {
  const path = usePathname();
  return (
    <div className="topbar">
      <div className="brand">
        <h1>DeskHR</h1>
        <span className="tag">workforce analytics + scheduling</span>
      </div>
      <nav className="nav">
        <Link href="/" className={path === '/' ? 'active' : ''}>
          Dashboard
        </Link>
        <Link href="/calendar" className={path === '/calendar' ? 'active' : ''}>
          Calendar
        </Link>
      </nav>
    </div>
  );
}
