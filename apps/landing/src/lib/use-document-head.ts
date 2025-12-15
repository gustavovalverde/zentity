import { useEffect } from "react";

interface DocumentHeadOptions {
  title?: string;
  description?: string;
}

/**
 * Updates document head (title, meta description) for SPA navigation.
 * Properly injects/updates meta tags in <head> instead of body.
 */
export function useDocumentHead({ title, description }: DocumentHeadOptions) {
  useEffect(() => {
    // Update title
    if (title) {
      document.title = title;
    }

    // Update or create meta description
    if (description) {
      let metaDescription = document.querySelector(
        'meta[name="description"]',
      ) as HTMLMetaElement | null;

      if (!metaDescription) {
        metaDescription = document.createElement("meta");
        metaDescription.name = "description";
        document.head.appendChild(metaDescription);
      }

      metaDescription.content = description;
    }

    // Cleanup: restore defaults on unmount (optional)
    return () => {
      // Could restore default title/description here if needed
    };
  }, [title, description]);
}
