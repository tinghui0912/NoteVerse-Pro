// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import messages from "../../../messages/en/practice.json";
import { PracticeTempoPopover } from "./practice-tempo-popover";

describe("PracticeTempoPopover", () => {
  function openCustomEditor(bpm = 80) {
    const onTempoSelectionChange = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <PracticeTempoPopover
          tempoSelection={{ mode: "CUSTOM_FIXED_BPM", bpm }}
          scoreTempoSegments={[{ startTick: 0, bpm: 96 }]}
          onTempoSelectionChange={onTempoSelectionChange}
        />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /tempo/i }));
    return {
      input: screen.getByRole("spinbutton", { name: "BPM input" }),
      onTempoSelectionChange,
    };
  }

  it.each([0.1, 20, 20.5, 80.5, 300.25])(
    "commits exact positive decimal BPM %s",
    (bpm) => {
      const { input, onTempoSelectionChange } = openCustomEditor();
      fireEvent.change(input, { target: { value: String(bpm) } });
      expect(onTempoSelectionChange).not.toHaveBeenCalled();
      fireEvent.blur(input);
      expect(onTempoSelectionChange).toHaveBeenCalledExactlyOnceWith({
        mode: "CUSTOM_FIXED_BPM",
        bpm,
      });
      expect(input).toHaveValue(bpm);
      expect(input).not.toHaveAttribute("max");
      expect(input).toHaveAttribute("step", "any");
    },
  );

  it.each(["", "0", "-1", "NaN", "Infinity", "1e309"])(
    "keeps invalid numeric draft %s out of domain selection",
    (draft) => {
      const { input, onTempoSelectionChange } = openCustomEditor();
      fireEvent.change(input, { target: { value: draft } });
      fireEvent.keyDown(input, { key: "Enter" });
      fireEvent.blur(input);
      expect(onTempoSelectionChange).not.toHaveBeenCalled();
      expect(input).toHaveAttribute("aria-invalid", "true");
    },
  );

  it("commits a decimal with Enter and cancels a draft with Escape", () => {
    const { input, onTempoSelectionChange } = openCustomEditor();
    fireEvent.change(input, { target: { value: "300.25" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onTempoSelectionChange).toHaveBeenCalledExactlyOnceWith({
      mode: "CUSTOM_FIXED_BPM",
      bpm: 300.25,
    });
    onTempoSelectionChange.mockClear();
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue(80);
    fireEvent.blur(input);
    expect(onTempoSelectionChange).not.toHaveBeenCalled();
  });

  it("keeps +5 available at a high decimal tempo", () => {
    const { onTempoSelectionChange } = openCustomEditor(300.25);
    const increment = screen.getByRole("button", { name: "+5 BPM" });
    expect(increment).toBeEnabled();
    fireEvent.click(increment);
    expect(onTempoSelectionChange).toHaveBeenCalledWith({
      mode: "CUSTOM_FIXED_BPM",
      bpm: 305.25,
    });
  });

  it.each([0.1, 5])(
    "disables only a decrement that would make BPM nonpositive at %s",
    (bpm) => {
      const { onTempoSelectionChange } = openCustomEditor(bpm);
      const decrement = screen.getByRole("button", { name: "-5 BPM" });
      expect(decrement).toBeDisabled();
      fireEvent.click(decrement);
      expect(onTempoSelectionChange).not.toHaveBeenCalled();
    },
  );

  it("decrements a positive decimal without rounding", () => {
    const { onTempoSelectionChange } = openCustomEditor(20.5);
    fireEvent.click(screen.getByRole("button", { name: "-5 BPM" }));
    expect(onTempoSelectionChange).toHaveBeenCalledWith({
      mode: "CUSTOM_FIXED_BPM",
      bpm: 15.5,
    });
  });

  it("renders trigger button showing Score Tempo when explicit tempo exists", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <PracticeTempoPopover
          tempoSelection={{ mode: "SCORE" }}
          scoreTempoSegments={[{ startTick: 0, bpm: 96 }]}
          onTempoSelectionChange={vi.fn()}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole("button", { name: /tempo/i })).toHaveTextContent(
      /Score Tempo/,
    );
  });

  it("renders trigger button showing Default 80 BPM when score has no explicit tempo", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <PracticeTempoPopover
          tempoSelection={{ mode: "SCORE" }}
          scoreTempoSegments={[]}
          onTempoSelectionChange={vi.fn()}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole("button", { name: /tempo/i })).toHaveTextContent(
      "80 BPM",
    );
  });

  it("renders trigger button showing exact custom BPM in CUSTOM mode", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <PracticeTempoPopover
          tempoSelection={{ mode: "CUSTOM_FIXED_BPM", bpm: 72 }}
          scoreTempoSegments={[{ startTick: 0, bpm: 120 }]}
          onTempoSelectionChange={vi.fn()}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole("button", { name: /tempo/i })).toHaveTextContent(
      "72 BPM",
    );
  });

  it("allows adjusting BPM directly via -5 and +5 buttons without separate mode tabs", () => {
    const onTempoSelectionChange = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <PracticeTempoPopover
          tempoSelection={{ mode: "SCORE" }}
          scoreTempoSegments={[{ startTick: 0, bpm: 104 }]}
          onTempoSelectionChange={onTempoSelectionChange}
        />
      </NextIntlClientProvider>,
    );

    // Open popover
    fireEvent.click(screen.getByRole("button", { name: /tempo/i }));

    expect(screen.getByText(/Score: ♩ = 104 BPM/i)).toBeInTheDocument();
    expect(screen.getByText("104 BPM")).toBeInTheDocument();

    // Clicking +5 directly transitions SCORE -> CUSTOM_FIXED_BPM
    fireEvent.click(screen.getByRole("button", { name: "+5 BPM" }));
    expect(onTempoSelectionChange).toHaveBeenCalledWith({
      mode: "CUSTOM_FIXED_BPM",
      bpm: 109,
    });

    // Clicking -5 directly transitions SCORE -> CUSTOM_FIXED_BPM
    fireEvent.click(screen.getByRole("button", { name: "-5 BPM" }));
    expect(onTempoSelectionChange).toHaveBeenCalledWith({
      mode: "CUSTOM_FIXED_BPM",
      bpm: 99,
    });
  });

  it("allows restoring score tempo from custom mode", () => {
    const onTempoSelectionChange = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <PracticeTempoPopover
          tempoSelection={{ mode: "CUSTOM_FIXED_BPM", bpm: 100 }}
          scoreTempoSegments={[{ startTick: 0, bpm: 120 }]}
          onTempoSelectionChange={onTempoSelectionChange}
        />
      </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /tempo/i }));

    const restoreBtn = screen.getByRole("button", {
      name: /restore score tempo/i,
    });
    expect(restoreBtn).toBeEnabled();
    fireEvent.click(restoreBtn);
    expect(onTempoSelectionChange).toHaveBeenCalledWith({ mode: "SCORE" });
  });

  it("toggles metronome sound within the same popover", () => {
    const onMetronomeEnabledChange = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <PracticeTempoPopover
          tempoSelection={{ mode: "SCORE" }}
          scoreTempoSegments={[{ startTick: 0, bpm: 100 }]}
          metronomeEnabled={false}
          onMetronomeEnabledChange={onMetronomeEnabledChange}
          onTempoSelectionChange={vi.fn()}
        />
      </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /tempo/i }));

    const metronomeToggle = screen.getByRole("button", {
      name: /metronome sound/i,
    });
    expect(metronomeToggle).toHaveTextContent("Off");
    fireEvent.click(metronomeToggle);
    expect(onMetronomeEnabledChange).toHaveBeenCalledWith(true);
  });

  it("disables tempo controls while keeping metronome sound operable when tempoLocked is true", () => {
    const onMetronomeEnabledChange = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <PracticeTempoPopover
          tempoSelection={{ mode: "CUSTOM_FIXED_BPM", bpm: 90 }}
          scoreTempoSegments={[{ startTick: 0, bpm: 90 }]}
          tempoLocked={true}
          metronomeEnabled={true}
          onMetronomeEnabledChange={onMetronomeEnabledChange}
          onTempoSelectionChange={vi.fn()}
        />
      </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /tempo/i }));

    expect(
      screen.getByText(/Tempo is locked while practice is active/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "-5 BPM" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "+5 BPM" })).toBeDisabled();
    expect(screen.getByLabelText(/BPM input/i)).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /restore score tempo/i }),
    ).toBeDisabled();

    // Metronome toggle is NOT locked
    const metronomeToggle = screen.getByRole("button", {
      name: /metronome sound/i,
    });
    expect(metronomeToggle).toBeEnabled();
    expect(metronomeToggle).toHaveTextContent("On");
    fireEvent.click(metronomeToggle);
    expect(onMetronomeEnabledChange).toHaveBeenCalledWith(false);
  });
});
