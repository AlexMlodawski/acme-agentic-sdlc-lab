export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    {
      status: "ready",
      service: "acme-support-portal",
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
