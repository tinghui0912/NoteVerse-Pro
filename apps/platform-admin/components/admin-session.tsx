"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import type { OperatorRead } from "../generated/api/types.gen";
import { currentOperator } from "../lib/control-plane-api";
import {
  isUnauthorized,
  onUnauthorized,
} from "../lib/control-plane-browser-transport";

type SessionState =
  | { status: "loading" | "anonymous" | "error"; operator: null }
  | { status: "authenticated"; operator: OperatorRead };
type SessionContext = SessionState & {
  authenticate: (operator: OperatorRead, remaining?: number) => void;
  clear: () => void;
  reload: () => void;
  lowRecoveryCodes: number | null;
  dismissRecoveryWarning: () => void;
};
const Context = createContext<SessionContext | null>(null);

export function AdminSessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const generation = useRef(0);
  const [state, setState] = useState<SessionState>({
    status: "loading",
    operator: null,
  });
  const [revision, setRevision] = useState(0);
  const [lowRecoveryCodes, setLowRecoveryCodes] = useState<number | null>(null);
  const clear = useCallback(() => {
    generation.current++;
    setState({ status: "anonymous", operator: null });
    setLowRecoveryCodes(null);
  }, []);
  useEffect(
    () =>
      onUnauthorized(() => {
        clear();
        if (pathname !== "/login") router.replace("/login");
      }),
    [clear, router, pathname],
  );
  useEffect(() => {
    const controller = new AbortController();
    const epoch = generation.current;
    currentOperator(controller.signal)
      .then((operator) => {
        if (!controller.signal.aborted && epoch === generation.current)
          setState({ status: "authenticated", operator });
      })
      .catch((error) => {
        if (!controller.signal.aborted && epoch === generation.current)
          setState({
            status: isUnauthorized(error) ? "anonymous" : "error",
            operator: null,
          });
      });
    return () => controller.abort();
  }, [revision]);
  const authenticate = (operator: OperatorRead, remaining?: number) => {
    generation.current++;
    setState({ status: "authenticated", operator });
    setLowRecoveryCodes(
      remaining !== undefined && remaining <= 2 ? remaining : null,
    );
  };
  return (
    <Context.Provider
      value={{
        ...state,
        authenticate,
        clear,
        lowRecoveryCodes,
        reload: () => {
          generation.current++;
          setState({ status: "loading", operator: null });
          setRevision((value) => value + 1);
        },
        dismissRecoveryWarning: () => setLowRecoveryCodes(null),
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useAdminSession(): SessionContext {
  const context = useContext(Context);
  if (!context) throw new Error("AdminSessionProvider is required");
  return context;
}
