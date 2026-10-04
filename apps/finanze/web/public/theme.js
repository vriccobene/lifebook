// Apply before first paint so a saved dark preference never flashes a light page.
(() => {
  let preference;
  try {
    preference = localStorage.getItem("lifebook.theme");
  } catch {
    /* Use system preference. */
  }
  const dark =
    preference === "dark" ||
    (preference !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
})();
