export function AnYingMark({ size = 25 }: { size?: number }) {
  return (
    <svg
      className="anying-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      <rect x="2.5" y="3.5" width="27" height="25" rx="7" />
      <path d="M11 10.5v11l10-5.5-10-5.5Z" />
      <path className="anying-mark-glint" d="M22.5 7.5h3v3" />
    </svg>
  );
}
