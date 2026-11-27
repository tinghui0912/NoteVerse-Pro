// @vitest-environment jsdom
import { useCallback } from "react";
import {
  cleanup,
  render,
  screen,
  waitFor,
  act,
  fireEvent,
} from "@testing-library/react";
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { AdminSessionProvider, useAdminSession } from "./admin-session";
import { AdminConsole } from "./admin-console";
import { listUsers } from "../lib/control-plane-api";
import { useAdminQuery } from "../lib/use-admin-query";
import { operatorFor } from "../tests/support";
const { router, pathname } = vi.hoisted(() => ({
  router: { replace: vi.fn() },
  pathname: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => pathname(),
}));
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
beforeEach(() => {
  vi.clearAllMocks();
  pathname.mockReturnValue("/users");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("immediately removes authenticated state and private page data on a console 401", async () => {
  let resolve!: (value: string) => void;
  const delayed = new Promise<string>((done) => {
    resolve = done;
  });
  function PrivateData() {
    const load = useCallback(() => delayed, []);
    const result = useAdminQuery(load);
    return <div>Private customer data{result.data}</div>;
  }
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(json(operatorFor()))
    .mockResolvedValue(
      json({ code: "token_invalid_expired", request_id: "request" }, 401),
    );
  vi.stubGlobal("fetch", fetch);
  render(
    <AdminSessionProvider>
      <AdminConsole>
        <PrivateData />
      </AdminConsole>
    </AdminSessionProvider>,
  );
  await screen.findByText("Private customer data");
  await act(async () => {
    await listUsers().catch(() => {});
  });
  expect(screen.queryByText("Private customer data")).toBeNull();
  expect(screen.queryByRole("navigation")).toBeNull();
  expect(router.replace).toHaveBeenCalledWith("/login");
  await act(async () => {
    resolve("Sensitive late result");
  });
  expect(screen.queryByText("Sensitive late result")).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("shows and dismisses a low recovery-code warning without storing codes", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(operatorFor())));
  function Status() {
    const session = useAdminSession();
    return (
      <button onClick={() => session.authenticate(operatorFor(), 2)}>
        Complete recovery verification
      </button>
    );
  }
  render(
    <AdminSessionProvider>
      <AdminConsole>
        <Status />
      </AdminConsole>
    </AdminSessionProvider>,
  );
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Complete recovery verification",
    }),
  );
  expect(screen.getByRole("status").textContent).toContain(
    "2 recovery codes remain",
  );
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(screen.queryByText(/recovery codes remain/)).toBeNull();
});
it("does not replay an unauthenticated session probe", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      json({ code: "token_invalid_expired", request_id: "request" }, 401),
    );
  vi.stubGlobal("fetch", fetch);
  render(
    <AdminSessionProvider>
      <AdminConsole>
        <div>Private console</div>
      </AdminConsole>
    </AdminSessionProvider>,
  );
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
  expect(screen.queryByText("Private console")).toBeNull();
  expect(fetch).toHaveBeenCalledOnce();
});

it("does not restore identity from a session probe that arrives after a 401", async () => {
  let resolve!: (value: Response) => void;
  const probe = new Promise<Response>((done) => {
    resolve = done;
  });
  const fetch = vi
    .fn()
    .mockReturnValueOnce(probe)
    .mockResolvedValue(
      json({ code: "token_invalid_expired", request_id: "request" }, 401),
    );
  vi.stubGlobal("fetch", fetch);
  render(
    <AdminSessionProvider>
      <AdminConsole>
        <div>Private console</div>
      </AdminConsole>
    </AdminSessionProvider>,
  );
  await act(async () => {
    await listUsers().catch(() => {});
  });
  await act(async () => {
    resolve(json(operatorFor()));
  });
  expect(screen.queryByRole("navigation")).toBeNull();
  expect(screen.queryByText("Private console")).toBeNull();
  expect(router.replace).toHaveBeenCalledWith("/login");
});

it("keeps the current login page in place on a challenge 401", async () => {
  pathname.mockReturnValue("/login");
  const fetch = vi
    .fn()
    .mockResolvedValue(
      json({ code: "invalid_credentials", request_id: "request" }, 401),
    );
  vi.stubGlobal("fetch", fetch);
  render(
    <AdminSessionProvider>
      <div>Sign-in steps</div>
    </AdminSessionProvider>,
  );
  await act(async () => {
    await listUsers().catch(() => {});
  });
  expect(router.replace).not.toHaveBeenCalled();
  expect(screen.getByText("Sign-in steps")).toBeTruthy();
});
