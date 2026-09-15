import { redirect } from "next/navigation";

// The deck is edited in place on its own page now (owner tools + inline
// pencils). Old links and bookmarks land there, keeping ?import=1.
export default async function EditDeckPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ import?: string }>;
}) {
  const { slug } = await params;
  const { import: importFlag } = await searchParams;
  redirect(`/deck/${slug}${importFlag === "1" ? "?import=1" : ""}`);
}
