import { memo, useEffect, useRef } from 'react';
import $ from './styles.module.css';
import { Sig, useWatch } from '@site/src/_stm/react/react';
import useVisibilitySignal from '@site/src/_stm/react/animation/useVisibilitySignal';
import useIsWide from '@site/src/hooks/useWide';

interface Props {
  id?: string;
  type: 'img' | 'video';
  className?: string;

  src?: string;
  preview?: string;
  isStoppedVideo?: Sig<boolean> | ((video: HTMLVideoElement) => Sig<boolean>);

  onProgress?: (percent: number, video: HTMLVideoElement) => void;

  autoplay?: boolean;

  loop?: boolean;
  onEnded?: (video: HTMLVideoElement) => void;
}

const RESPONSIVE_WIDTHS = [640, 750, 828, 1080, 1200, 1920, 2048, 3840];

function Media({
  src,
  preview,
  type,
  id,
  isStoppedVideo,
  onProgress,
  autoplay = true,
  loop = true,
  onEnded,
  className = '',
}: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const loadedRef = useRef(false);
  const lastProgressRef = useRef<number>(-1);

  const isTable = useIsWide(1024, 'max');
  const height = isTable ? 480 : 1024;

  const { ref: containerRef, visible } = useVisibilitySignal<HTMLDivElement>({
    enterAt: [[-0.1, 1.4]],
  });

  const isImage = type === 'img';
  const isVideo = type === 'video';

  const buildUrl = () => {
    if (isVideo) return src ?? '';
    return src ?? (id ? assetUrl(id, { height }) : '');
  };

  const buildSrcSet = () => {
    if (!isImage || !id || src) return '';
    return RESPONSIVE_WIDTHS.map((w) => `${assetUrl(id, { width: w })} ${w}w`).join(', ');
  };

  const sizesAttr = '(max-width: 1193px) 100vw, 75vw';

  useEffect(() => {
    const img = imgRef.current;
    const video = videoRef.current;

    if (img) {
      img.removeAttribute('src');
      img.removeAttribute('srcset');
      img.removeAttribute('sizes');
      img.style.display = 'none';
      img.classList.remove($.visible);
    }

    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.style.display = 'none';
      video.classList.remove($.visible);
    }

    loadedRef.current = false;
    lastProgressRef.current = -1;
    containerRef.current?.toggleAttribute?.('data-loaded', false);
  }, [id, src, type]);

  useEffect(() => {
    if (loadedRef.current) return;

    const img = imgRef.current;
    const video = videoRef.current;

    if (isImage) {
      const url = buildUrl();
      if (!url || !img) return;

      const srcSet = buildSrcSet();

      img.style.display = 'block';
      img.src = url;

      if (srcSet) {
        img.srcset = srcSet;
        img.sizes = sizesAttr;
      }

      img.onload = () => {
        img.classList.add($.visible);
        containerRef.current?.toggleAttribute?.('data-loaded', true);
      };

      img.onerror = () => {
        loadedRef.current = false;
        img.style.display = 'none';
      };

      loadedRef.current = true;
      if (video) video.style.display = 'none';
      return;
    }

    if (isVideo) {
      if (!src || !video) return;

      video.style.display = 'block';
      video.src = src;

      video.onplaying = () => {
        video.classList.add($.visible);
        containerRef.current?.toggleAttribute?.('data-loaded', true);
      };

      video.onerror = () => {
        loadedRef.current = false;
        video.style.display = 'none';
      };

      loadedRef.current = true;
      if (img) img.style.display = 'none';

      if (autoplay) video.play().catch(() => {});
      else video.pause();
    }
  }, [id, src, type, height, isImage, isVideo, autoplay]);

  useWatch(() => {
    if (!isVideo) return;
    if (!autoplay) return;

    const video = videoRef.current;
    if (!video) return;

    if (!visible.v) video.pause();
    else if (video.paused) video.play().catch(() => {});
  }, [visible.v, isVideo, src, autoplay]);

  useEffect(() => {
    if (!isVideo || !onProgress) return;

    const video = videoRef.current;
    if (!video) return;

    const emit = () => {
      const d = video.duration;
      if (!Number.isFinite(d) || d <= 0) return;

      const percent = Math.max(0, Math.min(100, (video.currentTime / d) * 100));
      const rounded = Math.round(percent * 100) / 100;

      if (rounded !== lastProgressRef.current) {
        lastProgressRef.current = rounded;
        onProgress(rounded, video);
      }
    };

    video.addEventListener('timeupdate', emit);
    video.addEventListener('loadedmetadata', emit);

    return () => {
      video.removeEventListener('timeupdate', emit);
      video.removeEventListener('loadedmetadata', emit);
    };
  }, [isVideo, onProgress, src]);

  useEffect(() => {
    if (!isVideo || !onEnded) return;

    const video = videoRef.current;
    if (!video) return;

    const handleEnded = () => onEnded(video);

    video.addEventListener('ended', handleEnded);
    return () => video.removeEventListener('ended', handleEnded);
  }, [isVideo, onEnded, src]);

  useWatch(() => {
    if (!isStoppedVideo || !videoRef.current) return;
    const sig =
      typeof isStoppedVideo === 'function' ? isStoppedVideo(videoRef.current) : isStoppedVideo;

    if (sig.v) videoRef.current.pause();
    else videoRef.current.play().catch(() => {});
  }, [isStoppedVideo]);

  const urlForPrefetch = buildUrl();
  const canPrefetch = (isImage && !!urlForPrefetch) || (isVideo && !!src);

  return (
    <>
      {canPrefetch && (
        <link
          rel="prefetch"
          as={isImage ? 'image' : 'video'}
          href={isVideo ? (src as string) : urlForPrefetch}
        />
      )}

      {isVideo && preview && <link rel="prefetch" as="image" href={preview} />}

      <div
        className={`${$.Media} ${className}`}
        data-media-file
        ref={(e) => {
          containerRef.current = e;
        }}
      >
        <img
          ref={imgRef}
          className={$.content}
          alt=""
          style={{ display: 'none' }}
          loading="lazy"
          decoding="async"
        />

        <video
          ref={videoRef}
          className={$.content}
          muted
          playsInline
          loop={loop}
          preload="none"
          poster={preview}
          style={{ display: 'none' }}
        />
      </div>
    </>
  );
}

export default memo(Media);

export function assetUrl(
  id: string,
  opts?: { height?: number; width?: number; quality?: number; format?: string }
): string {
  const params = new URLSearchParams();
  params.set('format', opts?.format ?? 'webp');
  if (opts?.width != null) params.set('width', String(opts.width));
  if (opts?.height != null) params.set('height', String(opts.height));
  params.set('quality', String(opts?.quality ?? 75));

  const qs = params.toString();
  return `/assets/${id}${qs ? `?${qs}` : ''}`;
}
