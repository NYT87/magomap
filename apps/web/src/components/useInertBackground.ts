import { useEffect } from "react";

let open = 0;

/** While a modal is open, everything behind it (the app root) can't be focused or read. */
export function useInertBackground() {
  useEffect(() => {
    const root = document.getElementById("root");
    if (!root) return;
    open += 1;
    root.inert = true;
    return () => {
      open -= 1;
      if (open === 0) root.inert = false;
    };
  }, []);
}
