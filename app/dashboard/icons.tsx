const paths = {
  home: "m3 10 9-7 9 7M5 9v12h14V9M9 21v-7h6v7",
  catalog: "M3 4h7l2 2 2-2h7v16h-7l-2 2-2-2H3V4Zm9 2v16",
  box: "m3 7 9-4 9 4v10l-9 4-9-4V7Zm0 0 9 5 9-5M12 12v9",
  pin: "M18 10c0 5-6 11-6 11S6 15 6 10a6 6 0 1 1 12 0ZM10 10h4",
  users: "M3 21v-2a5 5 0 0 1 10 0v2M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M17 4a4 4 0 0 1 0 8M17 15a5 5 0 0 1 4 5",
  personal: "M4 21v-2a8 8 0 0 1 16 0v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
  settings: "M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6",
  logout: "M9 3H4v18h5M13 8l5 4-5 4M8 12h12",
  panel: "M3 4h18v16H3V4ZM9 4v16",
  menu: "M4 6h16M4 12h16M4 18h16",
  search: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Zm5-1 5.5 5.5",
  close: "m6 6 12 12M6 18 18 6",
  folder: "M3 7V4h6l3 3h9v13H3V7Z",
  list: "M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01",
  template: "M4 3h16v18H4V3Zm0 6h16M9 9v12",
  fields: "M3 5h18v5H3V5Zm0 10h8v5H3v-5Zm13 0h5v5h-5v-5Z",
  import: "M12 3v12m-4-4 4 4 4-4M4 15v6h16v-6",
  scan: "M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5M7 8v8M11 8v8M14 8v8M17 8v8",
  check: "M9 3h6v4H9V3Zm-1 2H5v16h14V5h-3M8 14l3 3 5-6",
  request: "M4 4h16v13H9l-5 4V4Zm4 5h8M8 13h5",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  chevron: "m9 5 7 7-7 7",
  warning: "m12 3 10 18H2L12 3Zm0 6v5m0 3v.01"
};

export type IconName = keyof typeof paths;

export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  return <svg className={`ec-icon ${className}`} width="20" height="20" aria-hidden="true" focusable="false" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}
