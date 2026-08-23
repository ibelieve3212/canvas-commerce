"use client";

import * as React from "react";

/**
 * 鼠标悬停延迟放大预览。
 * 鼠标移入后延迟 400ms 显示大图浮层，移出立即取消。
 *
 * @param src       缩略图 URL（列表显示用）
 * @param fullSrc   大图 URL（浮层显示用，默认同 src）
 * @param alt       图片描述
 * @param className 外层容器 class
 * @param imgClassName 缩略图 img class
 */
export function HoverPreview({
  src,
  fullSrc,
  alt,
  className,
  imgClassName,
}: {
  src: string;
  fullSrc?: string;
  alt: string;
  className?: string;
  imgClassName?: string;
}) {
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [show, setShow] = React.useState(false);

  const handleEnter = () => {
    timerRef.current = setTimeout(() => setShow(true), 700);
  };

  const handleLeave = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setShow(false);
  };

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const largeSrc = fullSrc ?? src;

  return (
    <div
      className={className}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      style={{ position: "relative" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className={imgClassName} />

      {show && (
        <div
          className="pointer-events-none fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-2xl"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={largeSrc}
            alt={alt}
            className="max-h-[70vh] max-w-[70vw] rounded object-contain"
          />
        </div>
      )}
    </div>
  );
}
