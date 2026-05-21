type HippoLogoProps = {
  className?: string
  size?: number
}

export const HippoLogo = ({ className, size = 16 }: HippoLogoProps) => (
  <svg
    aria-label="HippoTeam logo"
    className={className}
    fill="none"
    height={size}
    role="img"
    viewBox="0 0 16 16"
    width={size}
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle cx="8" cy="8" r="6.75" stroke="currentColor" strokeWidth="1.5" />
    <path
      d="M5.25 4.75V11.25M10.75 4.75V11.25M5.25 8H10.75"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="1.7"
    />
  </svg>
)
