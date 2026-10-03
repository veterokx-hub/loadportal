"use client";

export function LogoMark({
  size = 34,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src="/logo.jpg"
      alt=""
      width={size}
      height={size}
      className={className}
      draggable={false}
    />
  );
}
