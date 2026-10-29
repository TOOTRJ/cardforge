// The site header's and footer's frame (TODO WD2, owner decision D7: they
// always use the WIDE size, so the logo never moves between a standard and
// a wide page): up to 1920 px, with the page frame's own side padding. Page
// content keeps its frame (`max-w-7xl`, 1280 px). TODO WD1's PageContainer
// brings the sizes into one component; this becomes its size="wide".
export const WIDE_FRAME_CLASS = "mx-auto w-full max-w-[1920px] px-4 sm:px-6 lg:px-8";
