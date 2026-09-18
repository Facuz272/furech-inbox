// Sin UI en este alcance (elegí el test como opcional). Esta página solo lista la API.
export default function Home() {
  return (
    <main className="mx-auto max-w-xl p-8 font-mono text-sm">
      <h1 className="mb-4 text-lg font-bold">Furech · Mini bandeja omnicanal</h1>
      <ul className="space-y-1">
        <li>POST /api/webhooks/[channel]</li>
        <li>GET &nbsp;/api/conversations?limit=&amp;cursor=</li>
        <li>POST /api/conversations/[id]/messages</li>
      </ul>
      <p className="mt-4 text-neutral-500">Ver README.md</p>
    </main>
  );
}
