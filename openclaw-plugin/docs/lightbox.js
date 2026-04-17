import PhotoSwipeLightbox from "https://cdn.jsdelivr.net/npm/photoswipe@5.4.4/dist/photoswipe-lightbox.esm.min.js";

const PHOTO_SWIPE_CSS =
  "https://cdn.jsdelivr.net/npm/photoswipe@5.4.4/dist/photoswipe.css";
const FIGURE_SELECTOR = "figure.shot, figure.feature-shot, figure.ios-shot";
const GALLERY_CONTAINER_SELECTOR =
  ".ios-shot-grid, .section-grid, .card-grid, .hero-card, .section, .page";

function ensurePhotoSwipeStylesheet() {
  if (document.querySelector(`link[href="${PHOTO_SWIPE_CSS}"]`)) {
    return;
  }

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = PHOTO_SWIPE_CSS;
  document.head.appendChild(link);
}

function ensureImageReady(image) {
  if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const done = () => {
      image.removeEventListener("load", done);
      image.removeEventListener("error", done);
      resolve();
    };
    image.addEventListener("load", done, { once: true });
    image.addEventListener("error", done, { once: true });
  });
}

function ensureTrigger(figure, image) {
  const existing = figure.querySelector(":scope > a.lightbox-trigger");
  if (existing) {
    return existing;
  }

  const anchor = document.createElement("a");
  anchor.className = "lightbox-trigger";
  anchor.href = image.currentSrc || image.src;
  anchor.setAttribute("data-pswp-src", image.currentSrc || image.src);
  image.replaceWith(anchor);
  anchor.appendChild(image);
  return anchor;
}

function captionFromFigure(figure, image) {
  const figcaption = figure.querySelector("figcaption");
  if (figcaption && figcaption.innerHTML.trim()) {
    return figcaption.innerHTML.trim();
  }
  return image.getAttribute("alt") || "";
}

function assignGalleryContainer(figure, index) {
  const container =
    figure.closest(GALLERY_CONTAINER_SELECTOR) || document.querySelector(".page");
  if (!container) {
    return null;
  }
  if (!container.dataset.pswpGallery) {
    container.dataset.pswpGallery = `forge-gallery-${index}`;
  }
  return container;
}

async function prepareFigures() {
  const figures = [...document.querySelectorAll(FIGURE_SELECTOR)].filter((figure) =>
    figure.querySelector("img"),
  );

  let galleryIndex = 0;

  await Promise.all(
    figures.map(async (figure) => {
      const image = figure.querySelector("img");
      if (!image) {
        return;
      }

      await ensureImageReady(image);

      const trigger = ensureTrigger(figure, image);
      const triggerImage = trigger.querySelector("img");
      const width = triggerImage?.naturalWidth || image.naturalWidth;
      const height = triggerImage?.naturalHeight || image.naturalHeight;

      if (!width || !height) {
        return;
      }

      galleryIndex += 1;
      assignGalleryContainer(figure, galleryIndex);

      const caption = captionFromFigure(figure, image);
      const labelBase = triggerImage?.alt || image.alt || "Screenshot";

      trigger.href = triggerImage?.currentSrc || triggerImage?.src || image.currentSrc || image.src;
      trigger.setAttribute("data-pswp-src", trigger.href);
      trigger.setAttribute("data-pswp-width", String(width));
      trigger.setAttribute("data-pswp-height", String(height));
      trigger.setAttribute("data-pswp-caption", caption);
      trigger.setAttribute("aria-label", `Open image modal for ${labelBase}`);
      trigger.setAttribute("title", "Open image");
      figure.classList.add("lightbox-ready");
    }),
  );
}

function registerCaption(lightbox) {
  lightbox.on("uiRegister", () => {
    lightbox.pswp.ui.registerElement({
      name: "custom-caption",
      appendTo: "root",
      order: 9,
      onInit: (el, pswp) => {
        const updateCaption = () => {
          const caption = pswp.currSlide?.data?.caption || "";
          el.innerHTML = caption;
        };

        pswp.on("change", updateCaption);
        pswp.on("afterInit", updateCaption);
      },
    });
  });
}

async function main() {
  ensurePhotoSwipeStylesheet();
  await prepareFigures();

  if (!document.querySelector("[data-pswp-gallery] a[data-pswp-width]")) {
    return;
  }

  const lightbox = new PhotoSwipeLightbox({
    gallery: "[data-pswp-gallery]",
    children: "a[data-pswp-width]",
    bgOpacity: 0.92,
    wheelToZoom: true,
    showHideAnimationType: "zoom",
    imageClickAction: "zoom-or-close",
    tapAction: "toggle-controls",
    doubleTapAction: "zoom",
    paddingFn: (viewportSize) => {
      const edge = viewportSize.x < 768 ? 12 : 30;
      const bottom = viewportSize.x < 768 ? 92 : 108;
      return { top: edge, right: edge, bottom, left: edge };
    },
    pswpModule: () =>
      import("https://cdn.jsdelivr.net/npm/photoswipe@5.4.4/dist/photoswipe.esm.min.js"),
  });

  lightbox.addFilter("domItemData", (itemData, element) => ({
    ...itemData,
    caption: element.dataset.pswpCaption || "",
    alt:
      itemData.alt ||
      element.querySelector("img")?.getAttribute("alt") ||
      "Screenshot",
  }));

  registerCaption(lightbox);
  lightbox.init();
}

main();
