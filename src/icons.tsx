import type { SVGProps } from "react";

type IconName = "ball" | "swap" | "card" | "play" | "pause" | "whistle" | "clock" | "list" | "download" | "print" | "trash" | "close" | "check";

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
    print: <><path d="M7 8V3h10v5M7 17H4V9h16v8h-3M7 14h10v7H7z"/></>,
    trash: <><path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7M10 11v6M14 11v6"/></>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    check: <path d="m5 12 4 4L19 6"/>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" {...common} {...props}>{paths[name]}</svg>;
}
