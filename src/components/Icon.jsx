const paths = {
  inbox: <><path d="M4 4h16l2 11v5H2v-5L4 4Z" /><path d="M2 14h6l2 3h4l2-3h6" /></>,
  unread: <><rect x="3" y="5" width="18" height="15" rx="2" /><path d="m3 7 9 6 9-6M15 3h6" /></>,
  star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" />,
  article: <path d="M12 5c-3-2-6-2-10-1v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-4-1-7-1-10 1Zm0 0v15" />,
  video: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="m10 9 5 3-5 3V9Z" /></>,
  podcast: <><rect x="9" y="2" width="6" height="13" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
  refresh: <path d="M20 8a9 9 0 1 0 1 8M20 2v6h-6" />,
  check: <path d="m5 12 4 4L20 5" />,
  arrow: <path d="m14 5-7 7 7 7" />,
  external: <path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7" />,
  settings: <><path d="M5 3v18M12 3v18M19 3v18" /><path d="M2 8h6M9 16h6m1-10h6" /></>,
  play: <path d="m8 4 13 8-13 8V4Z" />,
  pause: <path d="M8 5v14M16 5v14" />,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
};

export default function Icon({ name, size = 20, className = '' }) {
  return <svg aria-hidden="true" className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{paths[name] || paths.article}</svg>;
}
