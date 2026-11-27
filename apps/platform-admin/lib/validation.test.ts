import { it, expect } from "vitest";
import { reasonError, passwordError, normalizedPassword } from "./validation";
it.each(["ab", "   ", "x".repeat(501)])(
  "rejects invalid reason length",
  (value) => expect(reasonError(value)).not.toBeNull(),
);
it.each(["  abc  ", "x".repeat(500)])(
  "accepts trimmed 3–500 character reasons",
  (value) => expect(reasonError(value)).toBeNull(),
);
it.each(["x".repeat(11), " ".repeat(12), "x".repeat(129)])(
  "rejects invalid password length or whitespace",
  (value) => expect(passwordError(value)).not.toBeNull(),
);
it.each(["x".repeat(12), "x".repeat(128), "é".repeat(128), "😀".repeat(128)])(
  "accepts the shared Unicode codepoint password bounds",
  (value) => expect(passwordError(value)).toBeNull(),
);
it("normalizes passwords to NFC before measuring", () => {
  expect(normalizedPassword("e\u0301")).toBe("é");
  expect(passwordError("e\u0301".repeat(128))).toBeNull();
});
