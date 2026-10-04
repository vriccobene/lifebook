import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ThemeProvider, ThemeControl } from "./ThemeControl";

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
});
function system(dark: boolean) {
  const media = new EventTarget() as EventTarget & { matches: boolean };
  media.matches = dark;
  vi.stubGlobal("matchMedia", () => media);
  return media;
}
it("follows the system and remembers an explicit choice across remounts", async () => {
  const media = system(true);
  const user = userEvent.setup();
  const view = render(
    <ThemeProvider>
      <ThemeControl />
    </ThemeProvider>,
  );
  expect(document.documentElement.dataset.theme).toBe("dark");
  await user.selectOptions(screen.getByLabelText("Tema"), "light");
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(localStorage.getItem("lifebook.theme")).toBe("light");
  act(() => {
    media.dispatchEvent(new Event("change"));
  });
  expect(document.documentElement.dataset.theme).toBe("light");
  view.unmount();
  render(
    <ThemeProvider>
      <ThemeControl />
    </ThemeProvider>,
  );
  expect((screen.getByLabelText("Tema") as HTMLSelectElement).value).toBe("light");
});
it("responds to system changes only in automatic mode", async () => {
  const media = system(false);
  const user = userEvent.setup();
  render(
    <ThemeProvider>
      <ThemeControl />
    </ThemeProvider>,
  );
  act(() => {
    media.matches = true;
    media.dispatchEvent(new Event("change"));
  });
  expect(document.documentElement.dataset.theme).toBe("dark");
  await user.selectOptions(screen.getByLabelText("Tema"), "dark");
  act(() => {
    media.matches = false;
    media.dispatchEvent(new Event("change"));
  });
  expect(document.documentElement.dataset.theme).toBe("dark");
  await user.selectOptions(screen.getByLabelText("Tema"), "system");
  expect(document.documentElement.dataset.theme).toBe("light");
});
it("works when preference storage is unavailable", async () => {
  system(false);
  const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  try {
    render(
      <ThemeProvider>
        <ThemeControl />
      </ThemeProvider>,
    );
    await userEvent.setup().selectOptions(screen.getByLabelText("Tema"), "dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  } finally {
    read.mockRestore();
    write.mockRestore();
  }
});
