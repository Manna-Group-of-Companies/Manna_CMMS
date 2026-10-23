/**
 * The CMMS mark (23 Oct 2026): a solid gear with a wrench cut through it, on
 * the brand orange tile. The same drawing as public/favicon.svg, the Android
 * launch screen and the phone app's assets/brand/cmms_mark.png - change them
 * together.
 */
const GEAR =
  "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z";
const WRENCH =
  "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z";

const CmmsMark = ({ className = "h-10 w-10", title = "Manna CMMS" }) => (
  <svg viewBox="0 0 64 64" className={className} role="img" aria-label={title}>
    <rect width="64" height="64" rx="14" fill="#d14a0c" />
    <g transform="translate(11.6 11.6) scale(1.7)" strokeLinecap="round" strokeLinejoin="round">
      <path d={GEAR} fill="#fff" stroke="#fff" strokeWidth="1.2" />
      <path d={WRENCH} fill="none" stroke="#d14a0c" strokeWidth="3.6" transform="translate(4.8 4.8) scale(.6)" />
    </g>
  </svg>
);

export default CmmsMark;
