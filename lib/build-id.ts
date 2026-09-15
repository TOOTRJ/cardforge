/** This deployment's identity (next.config.ts → NEXT_PUBLIC_BUILD_ID):
 *  Vercel's deployment id in production, "dev" locally. */
export const BUILD_ID: string = process.env.NEXT_PUBLIC_BUILD_ID || "dev";
