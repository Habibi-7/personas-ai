export default function NotFound() {
  return (
    <main className="min-h-dvh bg-background text-foreground flex items-center justify-center px-6">
      <div className="max-w-md border border-border p-6 shadow-border-small">
        <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">404</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-[-0.06em]">Page not found</h1>
        <p className="readable-text mt-3 text-sm text-muted-foreground">
          This page does not exist. Return to Persona Generator to choose a persona and start a chat.
        </p>
      </div>
    </main>
  );
}
