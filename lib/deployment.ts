export function personaWritesEnabled() {
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_PERSONA_WRITES === "true";
}

export function personaWritesDisabledResponse() {
  return Response.json(
    {
      error:
        "Persona creation/editing is disabled on this hosted demo. Clone the repo and run it locally, or set ENABLE_PERSONA_WRITES=true for your own private deployment.",
    },
    { status: 403 }
  );
}
