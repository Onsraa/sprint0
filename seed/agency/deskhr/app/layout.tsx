import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'DeskHR — Workforce Dashboard & Scheduling',
  description:
    'Role-gated HR analytics dashboard + shift-conflict scheduling calendar. Runnable demo, no external keys.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">{children}</div>
      </body>
    </html>
  );
}
