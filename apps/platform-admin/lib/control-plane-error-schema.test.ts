import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { ControlPlaneErrorResponseSchema } from "../generated/api/schemas.gen";

it("runtime error validation consumes the committed server representation schema", () => {
  const contract = JSON.parse(readFileSync(new URL("../../../backend/docs/contracts/openapi/control-plane-api.json", import.meta.url), "utf8"));
  expect(ControlPlaneErrorResponseSchema).toEqual(contract.components.schemas.ControlPlaneErrorResponse);
});
