import { NextResponse, type NextRequest } from "next/server";
import { isUnsubscribeToken, parseEmailList } from "@/lib/email/lists";
import { unsubscribeByToken } from "@/lib/email/preferences";

// ---------------------------------------------------------------------------
// RFC 8058 one-click unsubscribe — the URL in every non-auth email's
// List-Unsubscribe header. Mail clients POST here (body
// `List-Unsubscribe=One-Click`) when the user presses the client's own
// "Unsubscribe"; Gmail and Yahoo require it of bulk senders.
//
// POST only mutates. A GET (a person pasting the header URL, or a scanner)
// is sent to the /unsubscribe page, which asks for a button press.
// The response never says whether the token matched — it is a bearer key.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const token = searchParams.get("token");
  const list = parseEmailList(searchParams.get("list"));
  if (isUnsubscribeToken(token) && list) {
    await unsubscribeByToken(token, list);
  }
  return new NextResponse(null, { status: 200 });
}

export function GET(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/unsubscribe";
  return NextResponse.redirect(url, 303);
}
