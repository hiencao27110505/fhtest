/**
 * Loading placeholder.
 *
 * A neutral pulsing block that stands in for content while it loads. Shape it
 * with `className` (size, radius) at the call site so one primitive covers
 * avatars, lines of text, and cards.
 */
export default function Skeleton({
  className = "",
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-[var(--chip-bg)] ${className}`}
      {...props}
    />
  );
}