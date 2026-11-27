import "./styles.css";
import { AdminSessionProvider } from "../components/admin-session";

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AdminSessionProvider>{children}</AdminSessionProvider>
      </body>
    </html>
  );
}
