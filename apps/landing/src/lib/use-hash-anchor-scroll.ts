import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const DEFAULT_NAV_HEIGHT = 64;
const EXTRA_OFFSET = 16;
const MAX_SCROLL_RETRIES = 120;

function getAnchorOffset(): number {
  const header = document.querySelector("header");
  if (header instanceof HTMLElement && header.offsetHeight > 0) {
    return header.offsetHeight + EXTRA_OFFSET;
  }

  return DEFAULT_NAV_HEIGHT + EXTRA_OFFSET;
}

function scrollToHashTarget(hash: string): boolean {
  const id = decodeURIComponent(hash.replace(/^#/, ""));
  if (!id) return false;

  const target = document.getElementById(id);
  if (!target) return false;

  const top =
    window.scrollY + target.getBoundingClientRect().top - getAnchorOffset();

  const root = document.documentElement;
  const previousBehavior = root.style.scrollBehavior;
  root.style.scrollBehavior = "auto";
  window.scrollTo({ top: Math.max(top, 0), behavior: "auto" });
  root.style.scrollBehavior = previousBehavior;
  return true;
}

export function useHashAnchorScroll() {
  const location = useLocation();

  useEffect(() => {
    if (location.hash) return;
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [location.hash]);

  useEffect(() => {
    if (!location.hash) return;

    let frame = 0;
    let attempts = 0;

    const attemptScroll = () => {
      if (scrollToHashTarget(location.hash)) {
        return;
      }

      if (attempts >= MAX_SCROLL_RETRIES) {
        return;
      }

      attempts += 1;
      frame = window.requestAnimationFrame(attemptScroll);
    };

    frame = window.requestAnimationFrame(attemptScroll);

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [location.hash]);
}
