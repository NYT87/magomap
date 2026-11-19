import { useEffect, useState } from "react";

export type Layout = "phone" | "desktop";
const QUERY = "(min-width: 768px)";

/** Phone below 768 px, desktop from 768 px; follows the window live. */
export function useLayout(): Layout {
  const [layout, setLayout] = useState<Layout>(() =>
    window.matchMedia(QUERY).matches ? "desktop" : "phone",
  );
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const update = () => setLayout(mq.matches ? "desktop" : "phone");
    mq.addEventListener("change", update);
    update();
    return () => mq.removeEventListener("change", update);
  }, []);
  return layout;
}
