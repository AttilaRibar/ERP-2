import { resolveTokenPartner } from "@/server/actions/subcontractor-tokens";
import { SubcontractorPortal } from "@/components/modules/subcontractor/SubcontractorPortal";

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function SubcontractorPage({ params }: PageProps) {
  const { token } = await params;

  const resolved = await resolveTokenPartner(token);

  if (!resolved) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full mx-auto p-8 bg-white rounded-xl shadow-sm border border-red-100 text-center">
          <div className="text-5xl mb-4">🔒</div>
          <h1 className="text-xl font-semibold text-red-700 mb-2">
            Érvénytelen vagy lejárt link
          </h1>
          <p className="text-sm text-gray-500">
            Ez a hivatkozás nem érvényes, lejárt, vagy visszavonásra került.
            Kérjen új hozzáférési linket a megbízójától.
          </p>
        </div>
      </div>
    );
  }

  return (
    <SubcontractorPortal
      token={token}
      partnerId={resolved.partnerId}
    />
  );
}
