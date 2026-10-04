export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    "/": "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    "/analytics": "M4 20V10 M10 20V4 M16 20v-7 M22 20H2",
    "/giro": "M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16 M8 15l3 3 5-5",
    "/trasferimenti": "M3 7h17l-4-4 M21 17H4l4 4",
    "/conti": "M3 8l9-5 9 5H3z M5 11v7 M12 11v7 M19 11v7 M3 21h18",
    "/rendimenti": "M3 18l6-6 4 3 8-11 M15 4h6v6",
    "/entrate": "M12 3v12 M7 10l5 5 5-5 M4 15v6h16v-6",
    "/essenziale": "M4 4h2l3 12h10l3-8H7 M10 21h.01 M18 21h.01",
    "/firefly":
      "M10 14l4-4 M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0 M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0",
    "/impostazioni": "M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6",
    menu: "M4 6h16 M4 12h16 M4 18h16",
    close: "M6 6l12 12 M18 6L6 18",
    plus: "M12 5v14 M5 12h14",
    book: "M3 4h7l2 2 2-2h7v15h-7l-2 2-2-2H3z M12 6v15",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.book} />
    </svg>
  );
}
