import { AdminConsole } from "../../components/admin-console";
export default function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AdminConsole>{children}</AdminConsole>;
}
