// The @modal slot is empty everywhere except when the card-detail
// interceptor matches (see ./(.)card/[username]/[slug]/page.tsx). This
// default renders for every other route and on hard loads.
export default function ModalSlotDefault() {
  return null;
}
