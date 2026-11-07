import "@testing-library/jest-dom/vitest";
import { createElement, type ImgHTMLAttributes } from "react";
import { vi } from "vitest";

// next/image needs Next's image loader and static-import metadata, neither of which exists under
// Vitest (Vite imports a .jpg as a plain URL string). Render a plain <img> instead.
vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    preload: _preload,
    priority: _priority,
    placeholder: _placeholder,
    blurDataURL: _blurDataURL,
    fill: _fill,
    ...rest
  }: ImgHTMLAttributes<HTMLImageElement> & {
    src: string | { src: string };
    preload?: boolean;
    priority?: boolean;
    placeholder?: string;
    blurDataURL?: string;
    fill?: boolean;
  }) => createElement("img", { src: typeof src === "string" ? src : src.src, alt, ...rest }),
}));

Object.defineProperty(window, "scrollTo", {
  writable: true,
  value: () => {},
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// jsdom doesn't implement scrollIntoView (used to keep the active listbox option visible).
Element.prototype.scrollIntoView = function scrollIntoView() {};
