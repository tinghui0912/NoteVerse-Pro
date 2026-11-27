import "./styles.css";
import { connection } from "next/server";
import { AdminSessionProvider } from "../components/admin-session";

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await connection();
  return (
    <html lang="en">
      <body>
        <AdminSessionProvider>{children}</AdminSessionProvider>
      </body>
    </html>
  );
}
