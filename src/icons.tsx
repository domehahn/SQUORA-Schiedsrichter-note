import type { SVGProps } from "react";

type IconName =
  | "ball" | "swap" | "card" | "play" | "pause" | "whistle" | "clock" | "list"
  | "download" | "upload" | "print" | "trash" | "close" | "check" | "logout"
  | "edit" | "stopwatch" | "alert" | "trophy" | "plus" | "refresh" | "user" | "info"
  | "penalty" | "undo" | "share" | "sound" | "mute" | "chart" | "book" | "shield"
  | "sun" | "moon" | "monitor";

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const paths: Record<IconName, React.ReactNode> = {
    ball: <><circle cx="12" cy="12" r="9"/><path d="m9.5 8.5 2.5-2 2.5 2-.9 3h-3.2l-.9-3Zm.9 3-3.1 2.2.9 3.3m5.4-5.5 3.1 2.2-.9 3.3M8.5 5.2l-3 .2m10 0 3 .2M8.2 17h7.6"/></>,
    swap: <><path d="M7 7h11l-3-3m3 3-3 3M17 17H6l3 3m-3-3 3-3"/></>,
    card: <rect x="7" y="3" width="10" height="18" rx="1.5" transform="rotate(8 12 12)"/>,
    play: <path d="m8 5 11 7-11 7V5Z" fill="currentColor" stroke="none"/>,
    pause: <><path d="M9 5v14M15 5v14"/></>,
    whistle: <><path d="M5 13a5 5 0 1 0 10 0V9H8a5 5 0 0 0-3 4Z"/><path d="m15 9 4-3 2 3-6 3M4 5h3M3 8l3 1"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    list: <><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/></>,
    download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14"/></>,
    upload: <><path d="M12 20V8m0 0 4 4m-4-4-4 4M5 4h14"/></>,
    print: <><path d="M7 8V3h10v5M7 17H4V9h16v8h-3M7 14h10v7H7z"/></>,
    trash: <><path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7M10 11v6M14 11v6"/></>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    logout: <><path d="M10 4H5v16h5M14 8l4 4-4 4m4-4H9"/></>,
    edit: <><path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m14 6 4 4"/></>,
    stopwatch: <><circle cx="12" cy="13" r="8"/><path d="M12 13V9M9 2h6M18 6l1.5-1.5"/></>,
    alert: <><path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v5M12 18h.01"/></>,
    trophy: <><path d="M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M9 20h6M12 14v6"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    refresh: <><path d="M20 11a8 8 0 1 0-.9 5"/><path d="M20 4v6h-6"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></>,
    penalty: <><circle cx="12" cy="12" r="2.5"/><path d="M4 7h16M6 7v10M18 7v10"/></>,
    undo: <><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10H9"/></>,
    share: <><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.6 6.8-4M8.6 13.4l6.8 4"/></>,
    sound: <><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/></>,
    mute: <><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="m17 9 4 6m0-6-4 6"/></>,
    chart: <><path d="M4 20V4M4 20h16M8 16v-5M13 16V8M18 16v-8"/></>,
    book: <><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Z"/><path d="M5 17a3 3 0 0 1 3-3h11"/></>,
    shield: <><path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></>,
    moon: <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"/>,
    monitor: <><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" {...common} {...props}>{paths[name]}</svg>;
}
