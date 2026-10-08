interface Props {
  className?: string;
}

/** A jack-o'-lantern, used for headings and background decoration. */
export function Pumpkin({ className }: Props) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true" focusable="false">
      {/* stem and vine */}
      <path d="M47 27c1-7 5-11 11-12-2 4-3 8-2 12z" fill="#7cff4f" />
      <path d="M58 16c6-3 11-1 13 4-5-1-9-1-13 1z" fill="#4fae2f" />
      {/* body */}
      <ellipse cx="50" cy="58" rx="34" ry="30" fill="#ff7a18" />
      {/* ridges */}
      <g fill="none" stroke="#c24d00" strokeOpacity="0.75" strokeWidth="2.5" strokeLinecap="round">
        <path d="M50 28c-11 6-11 54 0 60" />
        <path d="M50 28c11 6 11 54 0 60" />
        <path d="M50 28v60" />
      </g>
      <ellipse cx="50" cy="58" rx="34" ry="30" fill="none" stroke="#a83f00" strokeWidth="2" />
      {/* carved face */}
      <g fill="#3a1500">
        <path d="M31 48l13 0-6-11z" />
        <path d="M69 48l-13 0 6-11z" />
        <path d="M30 66l8 8 6-8 6 8 6-8 6 8 8-8v15H30z" />
      </g>
    </svg>
  );
}
