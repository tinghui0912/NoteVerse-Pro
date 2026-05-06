'use client';

export default function GlobalNotFound() {
  return (
    <html lang="en">
      <body className="antialiased">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
          <h1 style={{ fontSize: '3rem', fontWeight: 'bold', margin: '0 0 1rem 0' }}>404</h1>
          <h2 style={{ fontSize: '1.5rem', margin: '0 0 2rem 0', color: '#4b5563' }}>Page Not Found</h2>
          <a href="/" style={{ padding: '0.75rem 1.5rem', backgroundColor: '#f97316', color: 'white', borderRadius: '0.5rem', textDecoration: 'none', fontWeight: 'bold' }}>
            Return Home
          </a>
        </div>
      </body>
    </html>
  );
}
